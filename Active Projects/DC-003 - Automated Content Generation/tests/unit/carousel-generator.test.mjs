import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { generateCarouselFromTopicPackage } from "../../src/carousel-generator.mjs";
import { createMockProvider } from "../../src/carousel-mock-provider.mjs";
import { loadTopicPackage } from "../../src/topic-package-loader.mjs";
import { CarouselGenerationFailedError, PromptBuilderError } from "../../src/carousel-generator-errors.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPROVED_TOPIC_PATH = path.join(
  __dirname,
  "..",
  "fixtures",
  "topic-packages",
  "approved.valid.json"
);

function loadApprovedTopic() {
  return loadTopicPackage(APPROVED_TOPIC_PATH);
}

// A stub provider that always returns malformed JSON — for retry-exhaustion tests.
function createAlwaysBrokenProvider() {
  let calls = 0;
  return {
    name: "always-broken-stub",
    calls: () => calls,
    async generateCarousel() {
      calls += 1;
      return "{ this is not valid json";
    },
  };
}

// A stub provider that fails N times then succeeds, delegating to the real
// mock provider for its eventual valid output — for retry-success tests.
function createFlakyProvider(failuresBeforeSuccess) {
  let calls = 0;
  const good = createMockProvider();
  return {
    name: "flaky-stub",
    calls: () => calls,
    async generateCarousel(prompt, context) {
      calls += 1;
      if (calls <= failuresBeforeSuccess) {
        return "{ not valid json on attempt " + calls;
      }
      return good.generateCarousel(prompt, context);
    },
  };
}

// A minimal alternative provider, structurally unrelated to the mock
// provider — proves the orchestrator only depends on the interface shape.
function createAlternativeStubProvider() {
  return {
    name: "alternative-stub-provider",
    async generateCarousel(prompt, context) {
      const t = context.topicPackage;
      const slide = (slide_type, content) => ({ slide_type, content });
      return JSON.stringify({
        slides: [
          slide("cover", { eyebrow_text: "X", headline_text: t.working_title, body_text: t.core_message }),
          slide("content", {
            eyebrow_text: "X",
            headline_text: "Y",
            body_text: "Z",
            list_items: ["a", "b", "c"],
          }),
          slide("statistic", { eyebrow_text: "X", stat_value: "1%", supporting_stat_text: "Y", stat_caption: "Z" }),
          slide("quote", { quote_text: "Q", attribution_name: "N", attribution_role: "R" }),
          slide("infographic", {
            eyebrow_text: "X",
            headline_text: "Y",
            steps: [1, 2, 3, 4].map((n) => ({ title: `Step ${n}`, description: `Desc ${n}` })),
          }),
          slide("cta", { eyebrow_text: "X", headline_text: "Y", body_text: "Z", button_label: t.cta }),
        ],
      });
    },
  };
}

test("a valid, ready Topic Package produces a valid Carousel Content Object with the mock provider", async () => {
  const topic = loadApprovedTopic();
  const carousel = await generateCarouselFromTopicPackage(topic);

  assert.equal(carousel.topic_id, topic.topic_id);
  assert.equal(carousel.slides.length, 6);
  assert.equal(carousel.llm_model, "mock-provider-v1");
  assert.match(carousel.carousel_content_id, /^cc_[A-Za-z0-9]+$/);
});

test("the returned Carousel Content Object cannot be mutated", async () => {
  const carousel = await generateCarouselFromTopicPackage(loadApprovedTopic());
  assert.throws(() => {
    carousel.topic_id = "tampered";
  }, TypeError);
  assert.throws(() => {
    carousel.slides.push({});
  }, TypeError);
  assert.equal(carousel.topic_id, loadApprovedTopic().topic_id);
});

test("the orchestrator works identically with a structurally different provider (provider abstraction)", async () => {
  const carousel = await generateCarouselFromTopicPackage(loadApprovedTopic(), {
    provider: createAlternativeStubProvider(),
  });
  assert.equal(carousel.llm_model, "alternative-stub-provider");
  assert.equal(carousel.slides.length, 6);
});

test("retry: succeeds on the second attempt after the first is malformed", async () => {
  const provider = createFlakyProvider(1);
  const carousel = await generateCarouselFromTopicPackage(loadApprovedTopic(), { provider, maxAttempts: 3 });
  assert.equal(provider.calls(), 2, "provider should have been called exactly twice");
  assert.equal(carousel.slides.length, 6);
});

test("retry: fails after the configured retry limit, calling the provider exactly that many times", async () => {
  const provider = createAlwaysBrokenProvider();
  await assert.rejects(
    () => generateCarouselFromTopicPackage(loadApprovedTopic(), { provider, maxAttempts: 2 }),
    CarouselGenerationFailedError
  );
  assert.equal(provider.calls(), 2, "provider should have been called exactly maxAttempts times");
});

test("retry failure preserves structured per-attempt details, not a generic message", async () => {
  const provider = createAlwaysBrokenProvider();
  try {
    await generateCarouselFromTopicPackage(loadApprovedTopic(), { provider, maxAttempts: 2 });
    assert.fail("expected generateCarouselFromTopicPackage to throw");
  } catch (error) {
    assert.ok(error instanceof CarouselGenerationFailedError);
    assert.equal(error.attempts.length, 2);
    assert.equal(error.maxAttempts, 2);
    for (const attempt of error.attempts) {
      assert.equal(attempt.stage, "parse");
      assert.notEqual(attempt.message.trim(), "");
    }
  }
});

test("a Topic Package with no usable content throws PromptBuilderError without calling the provider", async () => {
  const topic = { ...loadApprovedTopic(), working_title: "   " };
  let providerCalled = false;
  const provider = {
    name: "should-not-be-called",
    async generateCarousel() {
      providerCalled = true;
      return "{}";
    },
  };
  await assert.rejects(
    () => generateCarouselFromTopicPackage(topic, { provider }),
    PromptBuilderError
  );
  assert.equal(providerCalled, false, "the provider must never be called when the prompt can't be built");
});

// --- DC-003-I019: retry classification for provider errors carrying a
// `.retryable` field (see carousel-generator.mjs header comment) ---------

function createProviderThatThrows(error) {
  let calls = 0;
  return {
    name: "throwing-stub",
    calls: () => calls,
    async generateCarousel() {
      calls += 1;
      throw error;
    },
  };
}

test("a provider error with retryable:false propagates immediately, bypassing retry", async () => {
  class FakeNonRetryableError extends Error {
    constructor(message) {
      super(message);
      this.retryable = false;
    }
  }
  const error = new FakeNonRetryableError("fake authentication failure");
  const provider = createProviderThatThrows(error);

  await assert.rejects(
    () => generateCarouselFromTopicPackage(loadApprovedTopic(), { provider, maxAttempts: 5 }),
    (thrown) => {
      assert.equal(thrown, error, "the exact original error must propagate, not a wrapped CarouselGenerationFailedError");
      return true;
    }
  );
  assert.equal(provider.calls(), 1, "a non-retryable provider error must stop the retry loop after exactly one attempt");
});

test("a provider error with retryable:true is still retried up to maxAttempts, then wrapped as before", async () => {
  class FakeRetryableError extends Error {
    constructor(message) {
      super(message);
      this.retryable = true;
    }
  }
  const provider = createProviderThatThrows(new FakeRetryableError("fake transient failure"));

  await assert.rejects(
    () => generateCarouselFromTopicPackage(loadApprovedTopic(), { provider, maxAttempts: 3 }),
    CarouselGenerationFailedError
  );
  assert.equal(provider.calls(), 3, "a retryable provider error must still exhaust maxAttempts");
});

test("a provider error with no retryable field at all is treated as retryable (unchanged, backward-compatible default)", async () => {
  const provider = createProviderThatThrows(new Error("plain error, no retryable field"));

  await assert.rejects(
    () => generateCarouselFromTopicPackage(loadApprovedTopic(), { provider, maxAttempts: 2 }),
    CarouselGenerationFailedError
  );
  assert.equal(provider.calls(), 2, "an error with no retryable field must retry exactly as it did before this milestone");
});

test("generated Carousel Content Object independently re-validates against the I002 schema runtime", async () => {
  const { createValidator } = await import("../../src/validator.mjs");
  const carousel = await generateCarouselFromTopicPackage(loadApprovedTopic());
  const validator = createValidator();
  // structuredClone: the frozen return value must be safe to hand to Ajv,
  // which only needs to read it, not mutate it — this also proves nothing
  // about the object's frozen-ness trips up validation.
  const result = validator.validate("carouselContent", structuredClone(carousel));
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});
