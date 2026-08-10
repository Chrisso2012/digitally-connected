// DC-003-I032.8 — regression coverage for deriveLineage(): pure,
// dependency-free reconstruction/validation of one Editorial Package's
// Social Media Package revision chain. No filesystem/store involved —
// social-media-package-store.test.mjs and social-media-package-generator.test.mjs
// cover this wired through the real store/generator.

import test from "node:test";
import assert from "node:assert/strict";
import { deriveLineage } from "../../src/social-media-package-lineage.mjs";
import { MalformedSocialMediaPackageLineageError } from "../../src/social-media-package-errors.mjs";

function record(id, revision, supersedes, overrides = {}) {
  return {
    social_media_package_id: id,
    editorial_package_id: "ep_a1b2c3d4e5f60708",
    revision,
    supersedes,
    hook: `Hook for ${id}`,
    ...overrides,
  };
}

test("returns an empty chain and null latest for zero records", () => {
  const { chain, latest } = deriveLineage([]);
  assert.deepEqual(chain, []);
  assert.equal(latest, null);
});

test("a single V1 record is its own chain and its own latest", () => {
  const v1 = record("sm_v1", 1, null);
  const { chain, latest } = deriveLineage([v1]);
  assert.equal(chain.length, 1);
  assert.equal(chain[0].social_media_package_id, "sm_v1");
  assert.equal(chain[0].is_latest, true);
  assert.equal(latest.social_media_package_id, "sm_v1");
  assert.equal(latest.is_latest, true);
});

test("reconstructs a 3-revision chain in true V1->V2->V3 order regardless of input array order", () => {
  const v1 = record("sm_v1", 1, null);
  const v2 = record("sm_v2", 2, "sm_v1");
  const v3 = record("sm_v3", 3, "sm_v2");
  // Deliberately supplied out of order — the function must not trust
  // array order, only the supersedes chain itself.
  const { chain, latest } = deriveLineage([v3, v1, v2]);

  assert.deepEqual(
    chain.map((r) => r.social_media_package_id),
    ["sm_v1", "sm_v2", "sm_v3"]
  );
  assert.deepEqual(
    chain.map((r) => r.is_latest),
    [false, false, true]
  );
  assert.equal(latest.social_media_package_id, "sm_v3");
});

test("does not mutate or alias the input records", () => {
  const v1 = record("sm_v1", 1, null);
  const { chain } = deriveLineage([v1]);
  assert.notEqual(chain[0], v1);
  assert.equal("is_latest" in v1, false, "the original record object must never gain is_latest");
});

test("throws MalformedSocialMediaPackageLineageError when supersedes names an id not present in the supplied records", () => {
  const v2 = record("sm_v2", 2, "sm_v1_never_supplied");
  assert.throws(() => deriveLineage([v2]), MalformedSocialMediaPackageLineageError);
});

test("throws MalformedSocialMediaPackageLineageError on a fork — two records both supersede the same parent", () => {
  const v1 = record("sm_v1", 1, null);
  const v2a = record("sm_v2a", 2, "sm_v1");
  const v2b = record("sm_v2b", 2, "sm_v1");
  assert.throws(() => deriveLineage([v1, v2a, v2b]), MalformedSocialMediaPackageLineageError);
});

test("throws MalformedSocialMediaPackageLineageError when there is no root record (every record has a non-null supersedes)", () => {
  const v2 = record("sm_v2", 2, "sm_v1");
  const v1MissingButReferenced = record("sm_v1", 1, "sm_v0_also_missing");
  assert.throws(() => deriveLineage([v1MissingButReferenced, v2]), MalformedSocialMediaPackageLineageError);
});

test("throws MalformedSocialMediaPackageLineageError when there are two roots (two records both supersedes: null)", () => {
  const v1a = record("sm_v1a", 1, null);
  const v1b = record("sm_v1b", 1, null);
  assert.throws(() => deriveLineage([v1a, v1b]), MalformedSocialMediaPackageLineageError);
});

test("throws MalformedSocialMediaPackageLineageError when a disconnected record shares no path back to the root", () => {
  const v1 = record("sm_v1", 1, null);
  // Its own editorial_package_id/supersedes both look self-consistent in
  // isolation, but nothing in this record set points to it as a child of
  // the real chain, and it declares no parent of its own either — this
  // exact shape can't legitimately occur (findByEditorialPackageId()
  // scopes to one editorial_package_id and every record but the root
  // must declare *some* supersedes), so model it the way it could really
  // arise: a stray root-shaped record alongside the real one.
  const strayRoot = record("sm_stray", 1, null);
  assert.throws(() => deriveLineage([v1, strayRoot]), MalformedSocialMediaPackageLineageError);
});

test("throws MalformedSocialMediaPackageLineageError when a record's own revision disagrees with its true chain position", () => {
  const v1 = record("sm_v1", 1, null);
  const v2WrongRevision = record("sm_v2", 5, "sm_v1"); // should be revision 2
  assert.throws(() => deriveLineage([v1, v2WrongRevision]), MalformedSocialMediaPackageLineageError);
});

test("a well-formed chain with every field intact is returned with all original fields preserved on each chain entry", () => {
  const v1 = record("sm_v1", 1, null, { hook: "Original hook" });
  const { chain } = deriveLineage([v1]);
  assert.equal(chain[0].hook, "Original hook");
  assert.equal(chain[0].editorial_package_id, "ep_a1b2c3d4e5f60708");
});
