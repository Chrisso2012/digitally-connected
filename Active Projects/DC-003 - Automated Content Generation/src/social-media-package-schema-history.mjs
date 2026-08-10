// DC-003-I032.7 — Social Media Package historical schema archive.
//
// Investigation finding (not assumed): the Social Media Package Store
// (and, structurally, every one of this project's other stores — see
// this file's own header comment continuation below) validates every
// stored record against whatever schema is CURRENTLY loaded, on every
// single read. That is correct for a record created under the current
// schema, but wrong for a record created earlier: DC-003-I031.8 made
// `industry_context` a required field, and DC-003-I032.6 extended the
// `slide_role` enum — both genuinely additive changes to the CURRENT
// contract, but a record persisted before I031.8 (schema_version "1.1")
// was never written with `industry_context` at all, because that field
// did not exist yet. Re-validating it against TODAY's schema reports it
// as "corrupted" — a false accusation against a record that was, and
// remains, perfectly valid under the schema version it actually
// declares (`schema_version`, a field every Social Media Package has
// always carried).
//
// Architectural principle this file exists to serve: a persisted record
// is an immutable historical fact, validated against the schema/version
// contract under which it was created — never against whatever the
// schema has since evolved into. This file is the small, CONTAINED
// archive that makes that possible for exactly the schema versions that
// have ever existed for this one object type — not a repository-wide
// persistence-versioning framework. See this milestone's own report for
// why a full cross-store refactor is a separate, larger architectural
// question this file deliberately does not attempt to answer.
//
// --- Historical versions archived here -------------------------------
// Every commit that ever changed schemas/social-media-package.schema.json,
// confirmed via `git log --follow`:
//   1.0 — DC-003-I032           (c7136b5) — original shape, no `slides`.
//   1.1 — DC-003-I032.1         (1eb42e7) — added semantically-typed
//                                 `carousel.slides`, no `industry_context`.
//   1.2 — DC-003-I031.8         (36a25c0) — added `industry_context`
//                                 (this is the version boundary that made
//                                 sm_cb4c4bcf72b14c9f, at 1.1, fail).
//   1.3 — DC-003-I032.6         (0859f18) — extended `slide_role` to
//                                 include "evidence". This is the version
//                                 sm_cb4c4bcf72b14c9f, pp_95be2c6a4b424803,
//                                 and car_3479ca8ac2af40b8's own lineage was
//                                 generated under — the real historical
//                                 record DC-003-I032.8's own compatibility
//                                 view (revision/supersedes below) exists
//                                 to serve.
//   1.4 — DC-003-I032.8         (175a2f5) — added `revision`/`supersedes`
//                                 revision-lineage fields.
//   1.5 — DC-003-I032.9 (CURRENT, schemas/social-media-package.schema.json
//                                 itself — not duplicated here) — added
//                                 `corrections`, the append-only audit log
//                                 for correctSocialMediaPackageSlideField().
//
// Each archived file below is a byte-for-byte copy of the real schema at
// that commit (`git show <commit>:.../social-media-package.schema.json`)
// — never hand-retyped or reconstructed, so there is no risk of this
// archive silently drifting from what the schema actually was.
//
// --- Additive fields introduced after a given version -----------------
// Used to build a compatibility VIEW only — never written back to disk.
// A field name here means: "absent on a record whose own schema_version
// predates the version listed is not corruption; the correct in-memory
// representation is the value shown."
//
// revision/supersedes (DC-003-I032.8): every record persisted before
// schema_version 1.4 predates revision-lineage entirely — but duplicate
// protection (findByEditorialPackageId(), enforced since I032 itself)
// guaranteed at most one Social Media Package could ever exist per
// editorial_package_id before this milestone, so a pre-1.4 record is
// deterministically the first (and, until revised, only) record in its
// own lineage: revision 1, supersedes null. This is not a guess — it
// follows necessarily from the duplicate-protection invariant that has
// held since I032's very first commit.
//
// corrections (DC-003-I032.9): every record persisted before schema
// 1.5 predates the correction mechanism entirely, so it necessarily has
// never had a correction applied — deterministically corrections: [].
const COMPATIBILITY_FIELDS = [
  { field: "industry_context", introducedAtVersion: "1.2", compatibilityValue: null },
  { field: "revision", introducedAtVersion: "1.4", compatibilityValue: 1 },
  { field: "supersedes", introducedAtVersion: "1.4", compatibilityValue: null },
  { field: "corrections", introducedAtVersion: "1.5", compatibilityValue: [] },
];

// Ajv's own $id-based schema registry means two schemas sharing an $id
// cannot both be compiled into the SAME Ajv instance (every historical
// version here shares the current schema's own $id, by design — they
// describe the same conceptual object at different points in time). Each
// historical version therefore gets its own dedicated Ajv instance,
// entirely separate from validator.mjs's own shared instance (which only
// ever knows the CURRENT schema) — no shared mutable state between them.
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readJsonFileSync } from "./read-json-file.mjs";
import { resolveFromRoot } from "./paths.mjs";

const HISTORICAL_VERSIONS = ["1.0", "1.1", "1.2", "1.3", "1.4"];

function loadHistoricalSchema(version, rootDir) {
  return readJsonFileSync(resolveFromRoot(rootDir, "schemas", "history", "social-media-package", `${version}.json`));
}

/**
 * Compiles every archived historical schema version once. Each version
 * gets its own Ajv instance (see this file's own header comment on why).
 *
 * options.rootDir — passed through when resolving the archive directory
 *   (used by tests pointing at a temporary schema directory instead of
 *   the real project's schemas/history/social-media-package/).
 */
export function createSocialMediaPackageSchemaHistory(options = {}) {
  const compiled = {};
  for (const version of HISTORICAL_VERSIONS) {
    const schema = loadHistoricalSchema(version, options.rootDir);
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    compiled[version] = ajv.compile(schema);
  }

  return {
    /** Every historical (i.e. NOT current) version this archive knows. */
    knownVersions: [...HISTORICAL_VERSIONS],

    isKnownHistoricalVersion(version) {
      return HISTORICAL_VERSIONS.includes(version);
    },

    /**
     * Validates `record` against the archived schema for `version`.
     * Throws if `version` isn't one of the versions this archive knows —
     * callers must check isKnownHistoricalVersion() first (mirrors
     * validator.mjs's own UnknownSchemaError discipline: an unrecognised
     * identifier is a caller bug, not a data problem).
     */
    validate(version, record) {
      const validateFn = compiled[version];
      if (!validateFn) {
        throw new RangeError(`createSocialMediaPackageSchemaHistory has no archived schema for version "${version}"`);
      }
      const valid = validateFn(record);
      return { valid, errors: valid ? [] : validateFn.errors ?? [] };
    },
  };
}

/**
 * Builds the in-memory-only compatibility view for a record that has
 * already been confirmed valid under its OWN declared schema_version.
 * Never mutates `record`; returns a new object. A field is added only
 * when it is genuinely absent AND the record's own version predates the
 * version that introduced it — never overwrites a value the record
 * actually has, historical or otherwise.
 */
export function applyCompatibilityView(record, version) {
  let view = record;
  for (const { field, introducedAtVersion, compatibilityValue } of COMPATIBILITY_FIELDS) {
    if (!(field in view) && isVersionBefore(version, introducedAtVersion)) {
      view = { ...view, [field]: compatibilityValue };
    }
  }
  return view;
}

// Compares two "MAJOR.MINOR" version strings numerically (never as
// plain strings — "1.10" must sort after "1.2", not before it).
function isVersionBefore(version, otherVersion) {
  const [major, minor] = String(version).split(".").map(Number);
  const [otherMajor, otherMinor] = String(otherVersion).split(".").map(Number);
  if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(otherMajor) || Number.isNaN(otherMinor)) return false;
  return major !== otherMajor ? major < otherMajor : minor < otherMinor;
}
