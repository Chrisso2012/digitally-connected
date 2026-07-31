// DC-003-I003 — CLI inspection command for a single Topic Package file.
//
// Thin wrapper around src/topic-package-loader.mjs — no independent
// validation or readiness logic lives here, matching the same "single
// source of truth" rule tests/validation/validate.mjs already follows.
//
// Usage: node tests/validation/check-topic-package.mjs <path-to-file.json>
//    or: npm run check:topic -- <path-to-file.json>

import { loadTopicPackage } from "../../src/topic-package-loader.mjs";
import {
  TopicPackageNotFoundError,
  TopicPackageUnreadableError,
  TopicPackageParseError,
  TopicPackageValidationError,
  TopicPackageReadinessError,
} from "../../src/topic-package-errors.mjs";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: node tests/validation/check-topic-package.mjs <path-to-topic-package.json>");
  process.exit(1);
}

try {
  const topic = loadTopicPackage(filePath);

  console.log("Topic Package OK — schema-valid and operationally ready");
  console.log(`  topic_id:       ${topic.topic_id}`);
  console.log(`  working_title:  ${topic.working_title}`);
  console.log(`  status:         ${topic.status}`);
  console.log(`  schema_version: ${topic.schema_version}`);
  console.log(`  version:        ${topic.version}`);
  console.log(`  readiness:      ready for content generation`);
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
  } else {
    // Genuinely unexpected — a stack trace is warranted here, unlike the
    // known/expected failure modes handled above.
    throw error;
  }
  process.exit(1);
}
