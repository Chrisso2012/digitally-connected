// DC-003-I033 — Renderer Adapter: the generic contract every rendering
// engine's adapter (the Templated Adapter in templated-renderer-adapter
// .mjs now; a future Canva/Adobe Express/Figma/HTML/PowerPoint adapter
// later) must satisfy. This is the milestone's equivalent of I004/I019's
// AI Provider interface and I005's Mapping Registry combined — pure,
// synchronous, deterministic, no network of any kind (this milestone
// never renders anything or calls a renderer's API — see README "Out of
// scope").
//
//   { name: string,
//     renderer: string,
//     buildSlideSequence(socialMediaPackage): {
//       slideSequence: ProductionSlide[],   // 6 entries, renderer-agnostic
//       templateId: string,                 // renderer-agnostic template family name
//       renderingMetadata: { mappingStrategy, slideCount, generator },
//     },
//     mapToRendererPayload(productionPackage): array }
//
// buildSlideSequence() is called once by production-package-generator.mjs
// to assemble a new Production Package. mapToRendererPayload() maps an
// already-built Production Package onto this renderer's own real payload
// shape (Templated template IDs and literal layer names, for example) —
// never persisted as part of the Production Package itself (which stays
// renderer-agnostic on disk), but exercised during generation as this
// milestone's own concrete implementation of "reject creation when
// required renderer mappings are missing / template mapping is invalid",
// and reusable as-is by a future I034 renderer milestone.

import { InvalidRendererAdapterError } from "./production-package-errors.mjs";

export function assertValidRendererAdapter(adapter) {
  if (
    !adapter ||
    typeof adapter.name !== "string" ||
    typeof adapter.renderer !== "string" ||
    typeof adapter.buildSlideSequence !== "function" ||
    typeof adapter.mapToRendererPayload !== "function"
  ) {
    throw new InvalidRendererAdapterError();
  }
}
