// DC-003-I004 — CLI inspection command: generate a mock Carousel Content
// Object from a Topic Package file and print a readable summary.
//
// Thin wrapper around src/topic-package-loader.mjs + src/carousel-generator.mjs
// — no independent loading, generation, or validation logic lives here.
// Does not render slides. Does not write any file.
//
// Usage: node tests/validation/generate-mock-carousel.mjs <path-to-topic-package.json>
//    or: npm run generate:mock -- <path-to-topic-package.json>

import { loadTopicPackage } from "../../src/topic-package-loader.mjs";
import { generateCarouselFromTopicPackage } from "../../src/carousel-generator.mjs";
import {
  TopicPackageNotFoundError,
  TopicPackageUnreadableError,
  TopicPackageParseError,
  TopicPackageValidationError,
  TopicPackageReadinessError,
} from "../../src/topic-package-errors.mjs";
import { PromptBuilderError, CarouselGenerationFailedError } from "../../src/carousel-generator-errors.mjs";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: node tests/validation/generate-mock-carousel.mjs <path-to-topic-package.json>");
  process.exit(1);
}

try {
  const topic = loadTopicPackage(filePath);
  const carousel = await generateCarouselFromTopicPackage(topic);
  const cover = carousel.slides.find((slide) => slide.slide_type === "cover");

  console.log("Carousel generated OK");
  console.log(`  topic:              ${topic.working_title}`);
  console.log(`  generated title:    ${cover?.content?.headline_text ?? "(n/a)"}`);
  console.log(`  slide count:        ${carousel.slides.length}`);
  console.log(`  generation version: prompt=${carousel.prompt_version} schema=${carousel.schema_version}`);
  console.log(`  provider:           ${carousel.llm_model}`);
  process.exit(0);
} catch (error) {
  if (
    error instanceof TopicPackageNotFoundError ||
    error instanceof TopicPackageUnreadableError ||
    error instanceof TopicPackageParseError
  ) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else if (error instanceof TopicPackageValidationError) {
    console.error(`FAIL  Topic Package is schema-invalid (${error.errors.length} error(s))`);
    for (const e of error.errors) console.error(`  - ${e.path}: ${e.message}`);
  } else if (error instanceof TopicPackageReadinessError) {
    console.error(`FAIL  Topic Package is not operationally ready (${error.issues.length} issue(s))`);
    for (const i of error.issues) console.error(`  - [${i.check}] ${i.message}`);
  } else if (error instanceof PromptBuilderError) {
    console.error(`FAIL  Cannot build prompt: ${error.message}`);
  } else if (error instanceof CarouselGenerationFailedError) {
    console.error(`FAIL  Carousel generation failed after ${error.attempts.length}/${error.maxAttempts} attempt(s)`);
    error.attempts.forEach((attempt, index) => {
      console.error(`  attempt ${index + 1}: [${attempt.stage}] ${attempt.message}`);
    });
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}
