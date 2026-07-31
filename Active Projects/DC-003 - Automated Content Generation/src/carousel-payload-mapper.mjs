// DC-003-I005 — Carousel Payload Mapper.
//
// Carousel Content Object -> Payload Mapper -> Templated Payload Object[6]
//                                            -> I002 schema validation
//                                            -> immutable output
//
// Deterministic: the same Carousel Content Object always produces the same
// six payloads (given the same clock/ID-generator injection — see options
// below, used by tests to make this genuinely checkable). No rendering, no
// Templated API calls, no external calls of any kind.
//
// This module does not re-validate that its input is a schema-valid
// Carousel Content Object (that's the I004 Carousel Content Validator's
// job) — but it does NOT blindly trust slide_type well-formedness either.
// Every check below is this mapper's own defense-in-depth, consistent with
// how the Prompt Builder (I004) and Topic Package Loader (I003) each
// re-check the specific things they depend on rather than assuming an
// upstream stage already ran.

import { randomUUID } from "node:crypto";
import { loadTemplatesConfig } from "./config-loader.mjs";
import { createValidator } from "./validator.mjs";
import { deepFreezeClone } from "./immutable.mjs";
import { getSlideMapping, expandLayerTemplate } from "./carousel-payload-mapping.mjs";
import {
  UnknownTemplateError,
  MissingLayerError,
  DuplicateLayerMappingError,
  UnsupportedContentError,
  TemplatedPayloadValidationError,
} from "./carousel-payload-errors.mjs";

function isBlank(value) {
  return typeof value !== "string" || value.trim().length === 0;
}

function generatePayloadId() {
  return "pl_" + randomUUID().replace(/-/g, "").slice(0, 16);
}

// Applies one slide's mapping entries against its content, tracking every
// layer key as it's assigned so a mapping entry that targets an
// already-assigned layer (a registry-authoring bug) is caught immediately
// — see the "duplicate-layer-in-registry" check in
// carousel-payload-mapping.mjs's validateMappingRegistry() for the static
// counterpart of this same guard.
function applySlideMapping(slideType, content, mapping) {
  const layers = {};
  const seenLayers = new Set();

  function assign(layerName, value) {
    if (seenLayers.has(layerName)) {
      throw new DuplicateLayerMappingError(slideType, layerName);
    }
    seenLayers.add(layerName);
    layers[layerName] = { text: value };
  }

  for (const entry of mapping.layers) {
    if (entry.kind === "direct") {
      const value = content[entry.contentField];
      if (isBlank(value)) {
        throw new MissingLayerError(slideType, entry.layer, entry.contentField);
      }
      assign(entry.layer, value);
    } else if (entry.kind === "array-fanout") {
      const value = content[entry.contentField];
      if (!Array.isArray(value) || value.length < entry.min || value.length > entry.max || value.some(isBlank)) {
        throw new UnsupportedContentError(
          slideType,
          entry.contentField,
          `expected an array of ${entry.min}-${entry.max} non-blank strings`
        );
      }
      value.forEach((item, index) => {
        assign(expandLayerTemplate(entry.layerTemplate, index + 1), item);
      });
    } else if (entry.kind === "object-array-fanout") {
      const value = content[entry.contentField];
      if (!Array.isArray(value) || value.length !== entry.exact) {
        throw new UnsupportedContentError(
          slideType,
          entry.contentField,
          `expected an array of exactly ${entry.exact} objects`
        );
      }
      value.forEach((item, index) => {
        for (const field of entry.fields) {
          if (!item || isBlank(item[field.subField])) {
            throw new UnsupportedContentError(
              slideType,
              `${entry.contentField}[${index}].${field.subField}`,
              "value is blank or missing"
            );
          }
          assign(expandLayerTemplate(field.layerTemplate, index + 1), item[field.subField]);
        }
      });
    }
  }

  return layers;
}

function checkAllRequiredLayersPopulated(slideType, templateEntry, layers) {
  for (const layerDef of templateEntry.layers?.variable ?? []) {
    if (layerDef.optional) continue;
    if (!(layerDef.name in layers)) {
      throw new MissingLayerError(slideType, layerDef.name, null);
    }
  }
}

function checkNoUnknownLayers(slideType, templateEntry, layers) {
  const validNames = new Set((templateEntry.layers?.variable ?? []).map((l) => l.name));
  for (const layerName of Object.keys(layers)) {
    if (!validNames.has(layerName)) {
      throw new UnsupportedContentError(
        slideType,
        layerName,
        "resolves to a layer name that is not a variable layer on this template"
      );
    }
  }
}

/**
 * Maps a validated Carousel Content Object onto six Templated Payload
 * Objects — one per slide, each independently schema-valid.
 *
 * options.templatesConfig — inject a pre-loaded config/templates.json
 *   (from loadTemplatesConfig()) instead of loading the real one.
 * options.validator — inject a pre-built validator instead of constructing
 *   a new one.
 * options.now — override the clock (used by tests).
 * options.payloadId — (slideType) => string, override ID generation
 *   (used by tests for deterministic output).
 * options.rootDir — passed through to loadTemplatesConfig when no
 *   templatesConfig is injected.
 *
 * Returns a deep-frozen array of six Templated Payload Objects, in the
 * same order as the input carousel's slides.
 */
export function mapCarouselToTemplatedPayload(carouselContent, options = {}) {
  const templatesConfig = options.templatesConfig ?? loadTemplatesConfig(options);
  const validator = options.validator ?? createValidator(options);
  const now = options.now ?? (() => new Date().toISOString());

  if (!Array.isArray(carouselContent?.slides)) {
    throw new UnsupportedContentError("(root)", "slides", "expected an array of slides");
  }

  // Carousel-level guard: two slides of the same slide_type would both
  // resolve to the same template and attempt to populate the same set of
  // layers for two different slide_numbers — a duplicate assignment.
  const seenSlideTypes = new Set();
  for (const slide of carouselContent.slides) {
    if (seenSlideTypes.has(slide.slide_type)) {
      throw new DuplicateLayerMappingError(
        slide.slide_type,
        null,
        `slide_type "${slide.slide_type}" appears more than once in this carousel — each template may only be used once, and this would produce duplicate layer assignments for the same template.`
      );
    }
    seenSlideTypes.add(slide.slide_type);
  }

  const payloads = carouselContent.slides.map((slide) => {
    const mapping = getSlideMapping(slide.slide_type);
    const templateEntry = mapping ? templatesConfig.templates?.[mapping.templateKey] : undefined;
    if (!mapping || !templateEntry) {
      throw new UnknownTemplateError(slide.slide_type);
    }

    const layers = applySlideMapping(slide.slide_type, slide.content ?? {}, mapping);
    checkAllRequiredLayersPopulated(slide.slide_type, templateEntry, layers);
    checkNoUnknownLayers(slide.slide_type, templateEntry, layers);

    const payload = {
      payload_id: options.payloadId?.(slide.slide_type) ?? generatePayloadId(),
      carousel_content_id: carouselContent.carousel_content_id,
      slide_number: templateEntry.slide_number,
      slide_type: slide.slide_type,
      template_id: templateEntry.template_id,
      template_version: templateEntry.template_version ?? null,
      format: templateEntry.format,
      layers,
      created_at: now(),
    };

    const validation = validator.validate("templatedPayload", payload);
    if (!validation.valid) {
      throw new TemplatedPayloadValidationError(slide.slide_type, validation.errors);
    }

    return payload;
  });

  return deepFreezeClone(payloads);
}
