// DC-003 — CLI fixture-validation command.
//
// This file has NO validation logic of its own. It is a thin wrapper around
// src/validator.mjs, the single source of truth for validation (see the
// DC-003-I002 README section "Existing validator" for why the I001
// hand-rolled validator was retired in favor of this). It exists purely to
// give a quick pass/fail summary across all approved fixtures.
//
// Usage: node tests/validation/validate.mjs  (or: npm run validate)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createValidator } from "../../src/validator.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "..", "fixtures");

const APPROVED_FIXTURES = [
  ["topicPackage", "topic-package.example.json"],
  ["carouselContent", "carousel-content.example.json"],
  ["templatedPayload", "templated-payload.example.json"],
  ["finishedCarousel", "finished-carousel.example.json"],
  ["executionLog", "execution-log.example.json"],
  ["executionRecord", "execution-record.example.json"],
  ["invocationRequest", "invocation-request.example.json"],
  ["invocationResponse", "invocation-response.example.json"],
  ["contentRequest", "content-request.example.json"],
  ["contentAsset", "content-asset.example.json"],
  ["productionMetrics", "production-metrics.example.json"],
  ["publisherResult", "publisher-result.example.json"],
  ["socialPublishingManifest", "social-publishing-manifest.example.json"],
  ["socialAnalyticsSnapshot", "social-analytics-snapshot.example.json"],
  ["controlCentre", "control-centre.example.json"],
];

const validator = createValidator();
let hadFailure = false;

for (const [schemaId, fixtureFile] of APPROVED_FIXTURES) {
  const data = JSON.parse(readFileSync(path.join(FIXTURES_DIR, fixtureFile), "utf-8"));
  const result = validator.validate(schemaId, data);

  if (result.valid) {
    console.log(`PASS  ${fixtureFile}  against  ${schemaId}`);
  } else {
    hadFailure = true;
    console.log(`FAIL  ${fixtureFile}  against  ${schemaId}`);
    for (const err of result.errors) console.log(`  - ${err.path}: ${err.message}`);
  }
}

process.exit(hadFailure ? 1 : 0);
