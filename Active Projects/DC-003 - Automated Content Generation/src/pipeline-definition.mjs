// DC-003-I009 — the declarative pipeline: an ordered array of stages,
// each implementing { name, execute(context, options) }. The orchestrator
// (pipeline-orchestrator.mjs) loops over this list without knowing
// anything about what any individual stage does — adding a future stage
// means extending this array, never rewriting the orchestrator itself. If
// the new stage needs an event_type execution-record.schema.json doesn't
// already list, that's a schema change (like DC-003-I007's addition of
// execution_metadata), not an orchestrator change.

import {
  LoadTopicStage,
  GenerateCarouselStage,
  MapPayloadStage,
  RenderStage,
  BuildFinishedCarouselStage,
} from "./pipeline-stages.mjs";

export const DEFAULT_PIPELINE = [
  LoadTopicStage,
  GenerateCarouselStage,
  MapPayloadStage,
  RenderStage,
  BuildFinishedCarouselStage,
];
