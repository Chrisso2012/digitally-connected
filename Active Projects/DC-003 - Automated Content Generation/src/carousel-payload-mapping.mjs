// DC-003-I005 — Carousel Payload Mapping Registry.
//
// The single source of truth for how Carousel Content Object fields map
// onto Templated layer names, per slide_type. No layer name is hardcoded
// anywhere else in the mapper — everything reads from here.
//
// Three transform kinds:
//   - "direct"              one content field -> one layer, value as-is.
//   - "array-fanout"         one array field -> N indexed layers
//                             (list_items[0..3] -> list_item_1..4_text).
//   - "object-array-fanout"  one array-of-objects field -> N indexed layer
//                             pairs (steps[i].title/.description ->
//                             step_{i+1}_title/_description).
//
// Field and layer names here match src/carousel-slide-spec.mjs (the I004
// Carousel Content shape) on the source side, and config/templates.json's
// per-template "variable" layer lists on the target side — see
// validateMappingRegistry() below, which cross-checks this table against
// the live template registry so the two can never silently drift apart.

export const CAROUSEL_PAYLOAD_MAPPING = {
  cover: {
    templateKey: "cover",
    layers: [
      { contentField: "eyebrow_text", layer: "eyebrow_text", kind: "direct" },
      { contentField: "headline_text", layer: "headline_text", kind: "direct" },
      { contentField: "body_text", layer: "body_text", kind: "direct" },
    ],
  },
  content: {
    templateKey: "content",
    layers: [
      { contentField: "eyebrow_text", layer: "eyebrow_text", kind: "direct" },
      { contentField: "headline_text", layer: "headline_text", kind: "direct" },
      { contentField: "body_text", layer: "body_text", kind: "direct" },
      { contentField: "list_items", kind: "array-fanout", layerTemplate: "list_item_{n}_text", min: 3, max: 4 },
    ],
  },
  statistic: {
    templateKey: "statistic",
    layers: [
      { contentField: "eyebrow_text", layer: "eyebrow_text", kind: "direct" },
      { contentField: "stat_value", layer: "stat_value", kind: "direct" },
      { contentField: "supporting_stat_text", layer: "supporting_stat_text", kind: "direct" },
      { contentField: "stat_caption", layer: "stat_caption", kind: "direct" },
    ],
  },
  quote: {
    templateKey: "quote",
    layers: [
      { contentField: "quote_text", layer: "quote_text", kind: "direct" },
      { contentField: "attribution_name", layer: "attribution_name", kind: "direct" },
      { contentField: "attribution_role", layer: "attribution_role", kind: "direct" },
    ],
  },
  infographic: {
    templateKey: "infographic",
    layers: [
      { contentField: "eyebrow_text", layer: "eyebrow_text", kind: "direct" },
      { contentField: "headline_text", layer: "headline_text", kind: "direct" },
      {
        contentField: "steps",
        kind: "object-array-fanout",
        exact: 4,
        fields: [
          { subField: "title", layerTemplate: "step_{n}_title" },
          { subField: "description", layerTemplate: "step_{n}_description" },
        ],
      },
    ],
  },
  cta: {
    templateKey: "cta",
    layers: [
      { contentField: "eyebrow_text", layer: "eyebrow_text", kind: "direct" },
      { contentField: "headline_text", layer: "headline_text", kind: "direct" },
      { contentField: "body_text", layer: "body_text", kind: "direct" },
      { contentField: "button_label", layer: "button_label", kind: "direct" },
    ],
  },
};

export function getSlideMapping(slideType) {
  return CAROUSEL_PAYLOAD_MAPPING[slideType];
}

export function expandLayerTemplate(template, n) {
  return template.replace("{n}", String(n));
}

// Every literal layer name a mapping entry could ever produce, at its
// maximum extent — used both to detect duplicate targets within the
// registry and to cross-check against config/templates.json.
function expandPossibleLayerNames(entry) {
  if (entry.kind === "direct") return [entry.layer];
  if (entry.kind === "array-fanout") {
    const names = [];
    for (let n = 1; n <= entry.max; n += 1) names.push(expandLayerTemplate(entry.layerTemplate, n));
    return names;
  }
  if (entry.kind === "object-array-fanout") {
    const names = [];
    for (let n = 1; n <= entry.exact; n += 1) {
      for (const field of entry.fields) names.push(expandLayerTemplate(field.layerTemplate, n));
    }
    return names;
  }
  return [];
}

/**
 * Cross-checks this registry against the live template registry
 * (config/templates.json, via loadTemplatesConfig()). Returns
 * { ok, issues } — never throws. Two things can go wrong:
 *   - a mapping's templateKey doesn't exist in config/templates.json
 *   - a mapping produces a layer name that either (a) is targeted by more
 *     than one entry for the same slide_type ("mappings unique" /
 *     "no duplicate layer names"), or (b) isn't a real variable layer on
 *     that template ("mapping references only templates defined in
 *     templates.json").
 */
export function validateMappingRegistry(templatesConfig) {
  const issues = [];

  for (const [slideType, mapping] of Object.entries(CAROUSEL_PAYLOAD_MAPPING)) {
    const templateEntry = templatesConfig.templates?.[mapping.templateKey];
    if (!templateEntry) {
      issues.push({
        check: "unknown-template-key",
        message: `mapping for "${slideType}" references template key "${mapping.templateKey}", which does not exist in config/templates.json`,
      });
      continue;
    }

    const validLayerNames = new Set((templateEntry.layers?.variable ?? []).map((l) => l.name));
    const seen = new Set();

    for (const entry of mapping.layers) {
      for (const name of expandPossibleLayerNames(entry)) {
        if (seen.has(name)) {
          issues.push({
            check: "duplicate-layer-in-registry",
            message: `slide_type "${slideType}": layer "${name}" is targeted by more than one mapping entry`,
          });
        }
        seen.add(name);
        if (!validLayerNames.has(name)) {
          issues.push({
            check: "unregistered-layer-name",
            message: `slide_type "${slideType}": mapping produces layer "${name}", which is not a variable layer on template "${mapping.templateKey}"`,
          });
        }
      }
    }
  }

  return { ok: issues.length === 0, issues };
}
