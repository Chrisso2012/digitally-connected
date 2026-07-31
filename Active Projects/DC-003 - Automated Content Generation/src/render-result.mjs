// DC-003-I006 — RenderResult: the provider-independent domain object every
// downstream consumer should depend on. Never a raw transport/HTTP
// response — renderer-response-validator.mjs is the only place a raw
// transport response is inspected before being normalized into this shape.

import { deepFreezeClone } from "./immutable.mjs";

const REQUIRED_FIELDS = [
  "renderId",
  "status",
  "imageUrl",
  "templateId",
  "slideType",
  "provider",
  "requestedAt",
  "completedAt",
  "durationMs",
];

// Reuses the same status vocabulary as finished-carousel.schema.json's
// SlideRender.status, so a future milestone assembling a Finished Carousel
// Object from RenderResults doesn't need to translate between two enums.
// DC-003-I006 does not poll, so "pending"/"processing" are legitimate,
// non-error outcomes here — not every RenderResult represents a finished image.
export const RENDER_STATUSES = ["pending", "processing", "completed", "failed"];

/**
 * Builds an immutable RenderResult. Throws TypeError (a plain
 * precondition failure, not a RendererError — this is a programmer error
 * in how the renderer assembled its own output, not an external failure)
 * if a required field is missing or status is outside RENDER_STATUSES.
 */
export function createRenderResult(fields) {
  for (const field of REQUIRED_FIELDS) {
    if (!(field in fields)) {
      throw new TypeError(`createRenderResult: missing required field "${field}"`);
    }
  }
  if (!RENDER_STATUSES.includes(fields.status)) {
    throw new TypeError(`createRenderResult: invalid status "${fields.status}"`);
  }

  const result = {};
  for (const field of REQUIRED_FIELDS) {
    result[field] = fields[field];
  }
  return deepFreezeClone(result);
}
