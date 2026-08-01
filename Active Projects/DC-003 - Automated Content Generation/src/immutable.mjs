// DC-003 — shared deep-freeze helpers.
//
// deepFreezeClone() is used by most factories in this codebase (Topic
// Package Loader, Carousel Content Generator, and every schema-backed
// domain object since) to return data that's safe for downstream
// consumers: a separate copy of the input, with every nested
// object/array frozen so mutation attempts throw (strict-mode/ESM
// callers, which every .mjs file in this codebase is) or silently no-op
// (non-strict callers) — the value itself never actually changes either
// way.
//
// deepFreeze() (without cloning) is exported separately for DC-003-I009's
// PipelineContext, which can hold live, non-cloneable values — a mock
// transport/provider object with function properties — that
// structuredClone() (deepFreezeClone's first step) would throw
// DataCloneError on. Freezing in place is safe for functions (freezing an
// object with function-valued properties is always valid in JS; this
// helper's typeof check already skips recursing into a function itself),
// it just doesn't produce an independent copy the way deepFreezeClone
// does — acceptable for a context whose nested domain-object fields
// (topicPackage, carouselContent, etc.) are already independently
// deep-frozen by their own factories before ever reaching the context.

export function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  return Object.freeze(value);
}

export function deepFreezeClone(value) {
  return deepFreeze(structuredClone(value));
}
