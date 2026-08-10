// DC-003-I032.8 — Social Media Package Revision Lineage: pure functions
// only, no filesystem/store access. Mirrors this project's established
// "domain logic lives in a small, dependency-free module; the Store
// composes it" discipline (see social-media-package-schema-history.mjs's
// own applyCompatibilityView()).
//
// Architectural principle (from the brief): "latest revision" is never a
// stored, mutable flag on a record — it is always DERIVED from the
// immutable supersedes chain. This file is the single place that
// derivation happens, reused by both the Store (read-side lineage
// lookups) and the Generator (the revise operation's own safety checks)
// — never duplicated.
//
// A lineage is exactly the set of Social Media Package records sharing
// one editorial_package_id. Because ordinary generateSocialMediaPackage()
// enforces "at most one Social Media Package per Editorial Package" via
// its own duplicate check, and reviseSocialMediaPackage() only ever
// creates a new record superseding the CURRENT latest, a well-formed
// lineage is always a straight, single-rooted chain:
//
//   V1 (supersedes: null) -> V2 (supersedes: V1) -> V3 (supersedes: V2) -> ...
//
// deriveLineage() reconstructs this chain from an unordered set of
// records and proves it is genuinely well-formed — never assumes it.

import { MalformedSocialMediaPackageLineageError } from "./social-media-package-errors.mjs";

/**
 * Reconstructs and validates the revision chain for one Editorial
 * Package's worth of Social Media Package records.
 *
 * records — an array of full Social Media Package records (as returned
 *   by socialMediaPackageStore.findByEditorialPackageId()), all already
 *   confirmed to share the same editorial_package_id. May be empty.
 *
 * Returns { chain, latest }:
 *   chain  — every record, in true revision order (V1 first), each
 *            annotated with `is_latest: boolean`. A new array/objects —
 *            never mutates or aliases the input records.
 *   latest — the chain's last entry (revision N, is_latest: true), or
 *            null when records is empty.
 *
 * Throws MalformedSocialMediaPackageLineageError (never silently
 * tolerated, never guessed around) when:
 *   - a record's `supersedes` names an id not present in `records`;
 *   - two records both declare the same `supersedes` (a fork);
 *   - `records` has zero or more than one root (supersedes: null);
 *   - the reconstructed chain doesn't account for every supplied record
 *     (a disconnected/cyclic record);
 *   - a record's own `revision` field disagrees with its true position
 *     in the reconstructed chain.
 */
export function deriveLineage(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return { chain: [], latest: null };
  }

  const editorialPackageId = records[0].editorial_package_id;
  const byId = new Map(records.map((record) => [record.social_media_package_id, record]));
  const childBySupersededId = new Map();
  const roots = [];

  for (const record of records) {
    if (record.supersedes === null) {
      roots.push(record);
      continue;
    }
    if (!byId.has(record.supersedes)) {
      throw new MalformedSocialMediaPackageLineageError(
        editorialPackageId,
        `record "${record.social_media_package_id}" declares supersedes="${record.supersedes}", which is not among the records supplied for this lineage`
      );
    }
    if (childBySupersededId.has(record.supersedes)) {
      const other = childBySupersededId.get(record.supersedes).social_media_package_id;
      throw new MalformedSocialMediaPackageLineageError(
        editorialPackageId,
        `fork detected — both "${other}" and "${record.social_media_package_id}" declare supersedes="${record.supersedes}"`
      );
    }
    childBySupersededId.set(record.supersedes, record);
  }

  if (roots.length !== 1) {
    throw new MalformedSocialMediaPackageLineageError(
      editorialPackageId,
      `expected exactly 1 root record (supersedes: null), found ${roots.length}`
    );
  }

  const chain = [];
  const visited = new Set();
  let current = roots[0];
  while (current) {
    if (visited.has(current.social_media_package_id)) {
      throw new MalformedSocialMediaPackageLineageError(editorialPackageId, `cycle detected at record "${current.social_media_package_id}"`);
    }
    visited.add(current.social_media_package_id);
    chain.push(current);
    current = childBySupersededId.get(current.social_media_package_id) ?? null;
  }

  if (chain.length !== records.length) {
    throw new MalformedSocialMediaPackageLineageError(
      editorialPackageId,
      `the reconstructed chain reached ${chain.length} record(s) but ${records.length} were supplied — at least one record is disconnected from the root`
    );
  }

  chain.forEach((record, index) => {
    const expectedRevision = index + 1;
    if (record.revision !== expectedRevision) {
      throw new MalformedSocialMediaPackageLineageError(
        editorialPackageId,
        `record "${record.social_media_package_id}" declares revision=${record.revision}, but its position in the lineage chain implies revision=${expectedRevision}`
      );
    }
  });

  const lastIndex = chain.length - 1;
  return {
    chain: chain.map((record, index) => ({ ...record, is_latest: index === lastIndex })),
    latest: { ...chain[lastIndex], is_latest: true },
  };
}
