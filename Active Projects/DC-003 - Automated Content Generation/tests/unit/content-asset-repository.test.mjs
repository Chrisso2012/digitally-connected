import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createContentAssetRepository } from "../../src/content-asset-repository.mjs";
import {
  UnknownContentAssetError,
  DuplicateContentAssetIdError,
  ContentAssetSchemaError,
  ContentAssetReadFailureError,
  InvalidContentAssetError,
} from "../../src/content-asset-errors.mjs";

function baseTopicPackage(overrides = {}) {
  return {
    topic_id: "topic_01J9REPO0001",
    working_title: "A repository test topic",
    audience: "Owner-operators",
    primary_goal: "Book a call",
    funnel_stage: "consideration",
    core_message: "Core message",
    supporting_points: ["Point one", "Point two"],
    cta: "Book now",
    keywords: [],
    brand_voice: "confident-direct",
    status: "approved",
    created_date: "2026-08-01T00:00:00Z",
    updated_date: "2026-08-01T00:00:00Z",
    version: 1,
    schema_version: "1.0",
    source: "backlog",
    backlog_reference_id: null,
    content_pillar: null,
    tags: [],
    priority: null,
    related_topic_ids: [],
    locale: "en",
    owner: "chris@digitallyconnected.net",
    notes: null,
    ...overrides,
  };
}

function baseAsset(overrides = {}) {
  return {
    asset_id: "TEST01",
    title: "Test Asset",
    summary: "A test content asset.",
    topic_package: baseTopicPackage(),
    status: "approved",
    created_at: "2026-08-01T00:00:00Z",
    metadata: null,
    ...overrides,
  };
}

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-content-asset-repo-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeAsset(dir, filename, asset) {
  writeFileSync(path.join(dir, filename), JSON.stringify(asset), "utf-8");
}

// --- get() ---------------------------------------------------------------

test("get() retrieves a valid, immutable asset with its embedded topic_package intact", () => {
  withTempDir((dir) => {
    writeAsset(dir, "TEST01.json", baseAsset());
    const repo = createContentAssetRepository({ assetsDir: dir });

    const asset = repo.get("TEST01");
    assert.equal(asset.asset_id, "TEST01");
    assert.equal(asset.topic_package.topic_id, "topic_01J9REPO0001");
    assert.ok(Object.isFrozen(asset));
    assert.ok(Object.isFrozen(asset.topic_package));
    assert.throws(() => {
      asset.title = "changed";
    }, TypeError);
  });
});

test("get() throws UnknownContentAssetError for a missing asset", () => {
  withTempDir((dir) => {
    const repo = createContentAssetRepository({ assetsDir: dir });
    assert.throws(() => repo.get("NOPE"), UnknownContentAssetError);
  });
});

for (const badId of ["", "../etc/passwd", "GS01/../../etc", "with slash/x", "bad\\path", "has space"]) {
  test(`get() throws InvalidContentAssetError for a malformed/path-traversal asset_id: ${JSON.stringify(badId)}`, () => {
    withTempDir((dir) => {
      const repo = createContentAssetRepository({ assetsDir: dir });
      assert.throws(() => repo.get(badId), InvalidContentAssetError);
    });
  });
}

test("get() throws ContentAssetReadFailureError for content that is not valid JSON", () => {
  withTempDir((dir) => {
    writeFileSync(path.join(dir, "BROKEN.json"), "{ not valid json", "utf-8");
    const repo = createContentAssetRepository({ assetsDir: dir });
    assert.throws(() => repo.get("BROKEN"), ContentAssetReadFailureError);
  });
});

test("get() throws ContentAssetSchemaError when the outer envelope fails schema validation", () => {
  withTempDir((dir) => {
    writeAsset(dir, "INVALID.json", { asset_id: "INVALID" }); // missing required fields
    const repo = createContentAssetRepository({ assetsDir: dir });
    assert.throws(() => repo.get("INVALID"), ContentAssetSchemaError);
  });
});

test("get() throws InvalidContentAssetError when the stored asset_id does not match its own filename", () => {
  withTempDir((dir) => {
    writeAsset(dir, "MISMATCH.json", baseAsset({ asset_id: "SOMETHING_ELSE" }));
    const repo = createContentAssetRepository({ assetsDir: dir });
    assert.throws(() => repo.get("MISMATCH"), InvalidContentAssetError);
  });
});

test("get() throws InvalidContentAssetError when the embedded topic_package fails its own schema validation", () => {
  withTempDir((dir) => {
    const badTopicPackage = baseTopicPackage();
    delete badTopicPackage.working_title; // required field missing
    writeAsset(dir, "BADTOPIC.json", baseAsset({ asset_id: "BADTOPIC", topic_package: badTopicPackage }));
    const repo = createContentAssetRepository({ assetsDir: dir });
    assert.throws(() => repo.get("BADTOPIC"), InvalidContentAssetError);
  });
});

test("get() never leaks a host path in a read-failure message", () => {
  withTempDir((dir) => {
    const repo = createContentAssetRepository({ assetsDir: dir });
    try {
      repo.get("MISSING");
      assert.fail("expected to throw");
    } catch (err) {
      assert.doesNotMatch(err.message, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
});

// --- exists() --------------------------------------------------------

test("exists() reflects presence and is false for an unknown asset_id", () => {
  withTempDir((dir) => {
    writeAsset(dir, "TEST01.json", baseAsset());
    const repo = createContentAssetRepository({ assetsDir: dir });
    assert.equal(repo.exists("TEST01"), true);
    assert.equal(repo.exists("NOPE"), false);
  });
});

test("exists() throws InvalidContentAssetError for a path-traversal asset_id", () => {
  withTempDir((dir) => {
    const repo = createContentAssetRepository({ assetsDir: dir });
    assert.throws(() => repo.exists("../../etc/passwd"), InvalidContentAssetError);
  });
});

// --- list() ------------------------------------------------------------

test("list() returns [] for an empty or nonexistent repository directory", () => {
  withTempDir((dir) => {
    const repo = createContentAssetRepository({ assetsDir: dir });
    assert.deepEqual(repo.list(), []);
  });

  const repo = createContentAssetRepository({ assetsDir: "/definitely/does/not/exist/anywhere" });
  assert.deepEqual(repo.list(), []);
});

test("list() returns every asset, ordered deterministically by asset_id ascending", () => {
  withTempDir((dir) => {
    writeAsset(dir, "C3.json", baseAsset({ asset_id: "C3" }));
    writeAsset(dir, "A1.json", baseAsset({ asset_id: "A1" }));
    writeAsset(dir, "B2.json", baseAsset({ asset_id: "B2" }));

    const repo = createContentAssetRepository({ assetsDir: dir });
    const ids = repo.list().map((a) => a.asset_id);
    assert.deepEqual(ids, ["A1", "B2", "C3"]);
  });
});

test("list() throws DuplicateContentAssetIdError when two files declare the same asset_id", () => {
  withTempDir((dir) => {
    writeAsset(dir, "one.json", baseAsset({ asset_id: "DUPLICATE" }));
    writeAsset(dir, "two.json", baseAsset({ asset_id: "DUPLICATE" }));
    const repo = createContentAssetRepository({ assetsDir: dir });
    assert.throws(() => repo.list(), DuplicateContentAssetIdError);
  });
});

test("list() fails on the first corrupted entry rather than silently skipping it", () => {
  withTempDir((dir) => {
    writeAsset(dir, "OK.json", baseAsset({ asset_id: "OK" }));
    writeFileSync(path.join(dir, "BROKEN.json"), "not json at all", "utf-8");
    const repo = createContentAssetRepository({ assetsDir: dir });
    assert.throws(() => repo.list(), ContentAssetReadFailureError);
  });
});

test("list() returns a deep-frozen array of deep-frozen assets", () => {
  withTempDir((dir) => {
    writeAsset(dir, "TEST01.json", baseAsset());
    const repo = createContentAssetRepository({ assetsDir: dir });
    const assets = repo.list();
    assert.ok(Object.isFrozen(assets));
    assert.ok(Object.isFrozen(assets[0]));
    assert.ok(Object.isFrozen(assets[0].topic_package));
  });
});
