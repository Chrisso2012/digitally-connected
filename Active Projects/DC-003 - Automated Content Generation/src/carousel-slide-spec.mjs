// DC-003-I004 — canonical per-slide-type content shape.
//
// The single source of truth both the Prompt Builder (what to ask the LLM
// for) and the Carousel Content shape checker (what to reject if missing)
// read from — kept in one place specifically so those two can never drift
// apart. Field names match config/templates.json's "variable" layer lists
// and DC-003-T002 §2 exactly; SLIDE_ORDER matches config/templates.json's
// slide_order.
//
// This does not change the approved carousel-content.schema.json — that
// schema deliberately leaves each slide's `content` as a generic object
// (see its own description) so a future template addition doesn't require
// a schema edit. This module is where the *current* six templates' shape
// requirements are enforced, at the application layer, not the schema layer.

export const SLIDE_ORDER = ["cover", "content", "statistic", "quote", "infographic", "cta"];

export const SLIDE_CONTENT_SPEC = {
  cover: {
    fields: ["eyebrow_text", "headline_text", "body_text"],
  },
  content: {
    fields: ["eyebrow_text", "headline_text", "body_text"],
    arrayFields: {
      list_items: { min: 3, max: 4 },
    },
  },
  statistic: {
    fields: ["eyebrow_text", "stat_value", "supporting_stat_text", "stat_caption"],
  },
  quote: {
    fields: ["quote_text", "attribution_name", "attribution_role"],
  },
  infographic: {
    fields: ["eyebrow_text", "headline_text"],
    objectArrayFields: {
      steps: { exact: 4, fields: ["title", "description"] },
    },
  },
  cta: {
    fields: ["eyebrow_text", "headline_text", "body_text", "button_label"],
  },
};
