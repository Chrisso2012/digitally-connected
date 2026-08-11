// DC-003 — schema registry.
//
// Loads the approved JSON Schemas (five from DC-003-T002, plus
// DC-003-I008's execution-record.schema.json, DC-003-I010's
// invocation-request.schema.json / invocation-response.schema.json,
// DC-003-I016's content-request.schema.json, DC-003-I018's
// content-asset.schema.json, DC-003-I023's production-metrics.schema.json,
// DC-003-I024's control-centre.schema.json, and DC-003-I030's
// ingested-content.schema.json — none part of the original T002 five) and
// exposes them behind stable, camelCase identifiers
// (matching the JS-side naming convention documented in DC-003-T002 §8) so
// later modules never need to know a schema's filesystem path — only its
// identifier.
//
// Compile order matters: object key insertion order here is the order
// validator.mjs calls ajv.compile() in, and control-centre.schema.json
// $refs finished-carousel/production-metrics by $id, so both must already
// be registered with Ajv (i.e. appear earlier in this object) before
// controlCentre is compiled.

import { readJsonFileSync } from "./read-json-file.mjs";
import { resolveFromRoot } from "./paths.mjs";

const SCHEMA_FILES = {
  topicPackage: "topic-package.schema.json",
  carouselContent: "carousel-content.schema.json",
  templatedPayload: "templated-payload.schema.json",
  finishedCarousel: "finished-carousel.schema.json",
  // DEPRECATED (DC-003-I008.1) — not part of the active architecture, no
  // production consumer. Retained (not removed) for the schema's own
  // fixture/validation coverage and a possible future rolled-up-summary
  // role; see README "execution-log.schema.json — deprecated".
  executionLog: "execution-log.schema.json",
  // The active operational record model — see README "Operational layer".
  executionRecord: "execution-record.schema.json",
  // The platform's first external boundary — see README "External
  // Invocation Adapter".
  invocationRequest: "invocation-request.schema.json",
  invocationResponse: "invocation-response.schema.json",
  // DC-003-I016 — the first user-facing command's domain object.
  contentRequest: "content-request.schema.json",
  // DC-003-I018 — the Content Asset Repository's domain object.
  contentAsset: "content-asset.schema.json",
  // DC-003-I023 — the production cost-accounting/telemetry record.
  productionMetrics: "production-metrics.schema.json",
  // DC-003-I025 — the authoritative local record of one successful
  // publish. Must be registered BEFORE controlCentre below, since
  // control-centre.schema.json $refs it by $id (DC-003-I025 extends the
  // Control Centre's own jobDetail.publishing to embed it).
  publisherResult: "publisher-result.schema.json",
  // DC-003-I027 — the approved, platform-specific publishing instruction
  // the Social Publisher Service executes exactly. No $refs to or from
  // any other schema, so its position here is not order-sensitive.
  socialPublishingManifest: "social-publishing-manifest.schema.json",
  // DC-003-I028 — one immutable observation of a published social post's
  // performance at one point in time. Must be registered BEFORE
  // controlCentre below, since control-centre.schema.json $refs it by $id
  // (the Job Detail's own Social Performance section embeds it).
  socialAnalyticsSnapshot: "social-analytics-snapshot.schema.json",
  // DC-003-I029 — structured Strategy Office <-> Delivery Office
  // engineering objects, replacing informal markdown briefs/delivery
  // summaries. Must be registered BEFORE controlCentre below, since
  // control-centre.schema.json $refs the delivery report by $id (the
  // Engineering section embeds the latest one).
  engineeringWorkOrder: "engineering-work-order.schema.json",
  engineeringDeliveryReport: "engineering-delivery-report.schema.json",
  // DC-003-I029.1, extended by DC-003-I029.3 — one immutable transport
  // event moving a Work Order out, a Delivery Report in, or (as of
  // I029.3) a Strategy Review out. Must be registered BEFORE
  // controlCentre below, since control-centre.schema.json $refs it by
  // $id.
  bridgeTransportRecord: "bridge-transport-record.schema.json",
  // DC-003-I029.3 — one immutable review of one Delivery Report against
  // the Work Order it answers. Must be registered BEFORE controlCentre
  // below, since control-centre.schema.json $refs it by $id.
  engineeringStrategyReview: "engineering-strategy-review.schema.json",
  // DC-003-I030 — the canonical, immutable record produced by the
  // Content Ingestion Engine for one retrieved source article. Unrelated
  // to contentRequest (I016) or contentAsset (I018) above — see this
  // schema's own header comment. Registered before controlCentre for
  // consistency with every other domain object above, though the Control
  // Centre's own Content Ingestion section embeds a lean summary shape,
  // not a $ref to this schema (see README "Control Centre").
  ingestedContent: "ingested-content.schema.json",
  // DC-003-I031 — the canonical strategic representation of one approved
  // article, derived from exactly one Ingested Content record above.
  // Registered before controlCentre for consistency, though the Control
  // Centre's own Editorial Package section embeds a lean summary shape,
  // not a $ref to this schema (see README "Control Centre").
  editorialPackage: "editorial-package.schema.json",
  // DC-003-I032 — the canonical marketing package used by every
  // downstream rendering milestone, derived from exactly one Editorial
  // Package above. Unrelated to socialPublishingManifest (that's a
  // downstream, human-approved, post-rendering publishing instruction;
  // this is an upstream, AI-generated, pre-rendering draft). Registered
  // before controlCentre for consistency, though the Control Centre's
  // own Social Media Package section embeds a lean summary shape, not a
  // $ref to this schema.
  socialMediaPackage: "social-media-package.schema.json",
  // DC-003-I033 — the canonical renderer-ready package used by every
  // downstream rendering engine, derived from exactly one Social Media
  // Package above via a pure, deterministic transformation (no AI/LLM
  // call). Registered before controlCentre for consistency, though the
  // Control Centre's own Production Package section embeds a lean
  // summary shape, not a $ref to this schema.
  productionPackage: "production-package.schema.json",
  // DC-003-I032.10.1 — a genuinely new, independent object: the final
  // CEO-approved production specification for one carousel, authored
  // entirely upstream (Claude Cowork) — never derived from, and never
  // referencing, editorialPackage/socialMediaPackage/productionPackage
  // above. Registered before controlCentre for consistency with every
  // other domain object.
  carouselContentPackage: "carousel-content-package.schema.json",
  // DC-003-I024, extended by DC-003-I028/I029/I029.1/I029.3 — the Control
  // Centre's in-memory read model. Must be compiled AFTER
  // finishedCarousel/productionMetrics/publisherResult/socialAnalyticsSnapshot/engineeringDeliveryReport/bridgeTransportRecord/engineeringStrategyReview
  // above (object key order = compile order in validator.mjs) since it
  // $refs all of them by $id.
  controlCentre: "control-centre.schema.json",
};

export const SCHEMA_IDS = Object.keys(SCHEMA_FILES);

/**
 * Loads all twenty-four schemas and returns them keyed by identifier, e.g.
 * `registry.topicPackage`. Fails fast on the first missing or malformed
 * schema file.
 */
export function loadSchemaRegistry(options = {}) {
  const registry = {};
  for (const [id, filename] of Object.entries(SCHEMA_FILES)) {
    registry[id] = readJsonFileSync(resolveFromRoot(options.rootDir, "schemas", filename));
  }
  return registry;
}
