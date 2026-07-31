// DC-003 — shared deep-clone-then-freeze helper.
//
// Used by both the Topic Package Loader (I003) and the Carousel Content
// Generator (I004) to return data that's safe for downstream consumers: a
// separate copy of the input, with every nested object/array frozen so
// mutation attempts throw (strict-mode/ESM callers, which every .mjs file
// in this codebase is) or silently no-op (non-strict callers) — the value
// itself never actually changes either way.

function deepFreeze(value) {
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
