// DC-003-I032 — mock Social Media provider. Mirrors
// editorial-analysis-mock-provider.mjs exactly: deterministic, derives
// every field directly from the input (here, an Editorial Package
// record's own fields — never Ingested Content, never a raw article) via
// simple string manipulation, never real NLP, never randomness, never
// the current time. The same Editorial Package always produces the exact
// same output. Reads ONLY editorialPackage — the structural enforcement
// of this milestone's "consume only the Editorial Package" boundary.
//
// Every extracted field is either a genuine substring of the real
// Editorial Package (carousel headings/slide copy, hashtags reused
// as-is) or an honestly generic derived statement marked `[mock]` —
// never a fabricated fact, matching this codebase's established
// "mark anything illustrative as illustrative" mock-content discipline.

const MOCK_PROVIDER_NAME = "mock-social-media-provider-v1";
const X_CHARACTER_LIMIT = 280;
const CAROUSEL_SLIDE_COUNT = 6;

function sanitize(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function truncate(value, maxLength) {
  const clean = sanitize(value);
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1).trim()}…`;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

// Builds a pool of at least 6 distinct, genuine Editorial Package
// strings to draw carousel content from — always well over 6 even for a
// minimal Editorial Package (6 fixed fields + at least 1 key insight +
// 1 pull quote).
function buildContentPool(ep) {
  return [ep.primary_headline, ep.supporting_headline, ep.core_message, ep.desired_outcome, ep.primary_problem, ep.executive_summary, ...ep.key_insights, ...ep.pull_quotes].filter(
    isNonEmptyString
  );
}

function takeCarouselItems(pool) {
  const items = [];
  for (let i = 0; i < CAROUSEL_SLIDE_COUNT; i += 1) {
    items.push(pool[i % pool.length]);
  }
  return items;
}

function buildXPostText(hook, hashtagsSuffix) {
  const budget = X_CHARACTER_LIMIT - hashtagsSuffix.length - 1; // -1 for the joining space
  return `${truncate(hook, Math.max(budget, 10))} ${hashtagsSuffix}`.trim();
}

function buildSocialMediaContent(ep) {
  const hook = sanitize(ep.primary_headline);
  const hashtags = (ep.suggested_hashtags ?? []).map(sanitize);
  const xHashtags = hashtags.slice(0, 2).map((h) => `#${h.replace(/\s+/g, "")}`).join(" ");

  const pool = buildContentPool(ep);
  const carouselSource = takeCarouselItems(pool);

  return {
    hook,
    callToAction: sanitize(ep.call_to_action),
    tone: "informative and professional — illustrative only, not derived from real brand voice data [mock]",
    audience: sanitize(ep.primary_audience),
    platforms: {
      linkedin: {
        postText: `${sanitize(ep.core_message)} ${sanitize(ep.executive_summary)} ${sanitize(ep.call_to_action)}`,
        hashtags: hashtags.slice(0, 5),
      },
      facebook: {
        postText: `${hook} — ${sanitize(ep.core_message)} ${sanitize(ep.call_to_action)}`,
        hashtags: hashtags.slice(0, 3),
      },
      x: {
        postText: buildXPostText(hook, xHashtags || "#update"),
        hashtags: hashtags.slice(0, 2),
      },
      instagram: {
        caption: `${hook}\n\n${sanitize(ep.core_message)}\n\n${sanitize(ep.call_to_action)}`,
        hashtags: hashtags.slice(0, 8),
      },
    },
    carousel: {
      headings: carouselSource.map((item) => truncate(item, 50)),
      slideCopy: carouselSource,
      imageGuidance: carouselSource.map(
        (item, index) => `Slide ${index + 1}: an image evoking "${truncate(item, 40)}" — illustrative guidance only, not a real creative brief [mock]`
      ),
    },
  };
}

/**
 * Creates the mock provider. `generateSocialMedia` returns a raw JSON
 * string (never a pre-parsed object) so it behaves exactly like a real
 * text-completion API — mirrors createEditorialAnalysisMockProvider()'s
 * own return contract.
 */
export function createSocialMediaMockProvider() {
  return {
    name: MOCK_PROVIDER_NAME,
    async generateSocialMedia(prompt, context = {}) {
      const { editorialPackage } = context;
      if (!editorialPackage) {
        throw new Error("mock provider requires context.editorialPackage — call generateSocialMedia(prompt, { editorialPackage })");
      }
      return JSON.stringify(buildSocialMediaContent(editorialPackage));
    },
  };
}
