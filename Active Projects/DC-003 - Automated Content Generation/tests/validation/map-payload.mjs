// DC-003-I005 — CLI inspection command: map a Carousel Content Object file
// into six Templated Payload Objects and print a readable summary.
//
// Thin wrapper around src/carousel-payload-mapper.mjs — no independent
// mapping or validation logic lives here. Does not render. Does not call
// Templated or any external API. Does not write any file.
//
// Usage: node tests/validation/map-payload.mjs <path-to-carousel-content.json>
//    or: npm run map:payload -- <path-to-carousel-content.json>

import { readFileSync } from "node:fs";
import { mapCarouselToTemplatedPayload } from "../../src/carousel-payload-mapper.mjs";
import { loadTemplatesConfig } from "../../src/config-loader.mjs";
import {
  UnknownTemplateError,
  MissingLayerError,
  DuplicateLayerMappingError,
  UnsupportedContentError,
  TemplatedPayloadValidationError,
} from "../../src/carousel-payload-errors.mjs";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: node tests/validation/map-payload.mjs <path-to-carousel-content.json>");
  process.exit(1);
}

function findTemplateEntry(templatesConfig, templateId) {
  return Object.values(templatesConfig.templates ?? {}).find((entry) => entry.template_id === templateId);
}

try {
  const raw = readFileSync(filePath, "utf-8");
  const carouselContent = JSON.parse(raw);
  const payloads = mapCarouselToTemplatedPayload(carouselContent);
  const templatesConfig = loadTemplatesConfig();

  console.log(`Carousel mapped OK — ${payloads.length} payload(s)`);
  for (const payload of payloads) {
    const templateEntry = findTemplateEntry(templatesConfig, payload.template_id);
    const editableLayerCount = templateEntry?.layers?.variable?.length ?? 0;
    const mappedLayerCount = Object.keys(payload.layers).length;

    console.log(`  [slide ${payload.slide_number}] ${templateEntry?.name ?? payload.slide_type}`);
    console.log(`      template ID:          ${payload.template_id}`);
    console.log(`      editable layer count: ${editableLayerCount}`);
    console.log(`      mapped layer count:   ${mappedLayerCount}`);
    console.log(`      payload validation:   OK`);
  }
  process.exit(0);
} catch (error) {
  if (error.code === "ENOENT") {
    console.error(`FAIL  File not found: ${filePath}`);
  } else if (error instanceof SyntaxError) {
    console.error(`FAIL  Malformed JSON in ${filePath}: ${error.message}`);
  } else if (
    error instanceof UnknownTemplateError ||
    error instanceof MissingLayerError ||
    error instanceof DuplicateLayerMappingError ||
    error instanceof UnsupportedContentError
  ) {
    console.error(`FAIL  ${error.name}`);
    console.error(`  ${error.message}`);
  } else if (error instanceof TemplatedPayloadValidationError) {
    console.error(`FAIL  Payload validation failed for slide_type "${error.slideType}" (${error.errors.length} error(s))`);
    for (const e of error.errors) console.error(`  - ${e.path}: ${e.message}`);
  } else {
    // Genuinely unexpected — a stack trace is warranted here.
    throw error;
  }
  process.exit(1);
}
