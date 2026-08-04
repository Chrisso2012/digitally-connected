// Unit tests for production-asset-publisher-service.mjs (DC-003-I022).
// Uses a small in-memory fake Publisher Adapter throughout — never the
// real Google Drive adapter — so these tests are pure validation-logic
// tests, matching how production-asset-export-service.test.mjs (I021)
// isolates its own service layer from its adapter.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { executeProductionAssetPublish } from "../../src/production-asset-publisher-service.mjs";
import { InvalidPublisherAdapterError, InvalidAssetPackageError } from "../../src/production-asset-publisher-errors.mjs";

async function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-publisher-service-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function seedPackage(dir, metadataOverrides = {}) {
  const metadata = {
    asset_package_id: "pkg_svctest0000001",
    carousel_id: "car_svctest0000001",
    carousel_content_id: "cc_svctest0000001",
    execution_id: "exec_20260804_deadbeefcafe",
    topic_id: "topic_01J9SVCTEST",
    export_timestamp: "2026-08-04T01:00:00.000Z",
    renderer_provider: "templated-http",
    render_duration_ms: 18000,
    total_duration_ms: 18000,
    slide_count: 6,
    export_version: "1.0",
    ...metadataOverrides,
  };
  writeFileSync(path.join(dir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");
  for (const name of ["01-cover.png", "02-content.png", "03-statistic.png", "04-quote.png", "05-infographic.png", "06-cta.png"]) {
    writeFileSync(path.join(dir, name), Buffer.from("fake-png-bytes"));
  }
  return metadata;
}

function createFakeAdapter(resultOverrides = {}) {
  let calls = 0;
  const seen = [];
  return {
    name: "fake-publisher-adapter",
    calls: () => calls,
    seen: () => seen,
    async publishPackage(assetPackagePath, options) {
      calls += 1;
      seen.push({ assetPackagePath, options });
      return {
        status: "completed",
        publisher: "fake-publisher",
        packageId: "car_svctest0000001",
        folderId: "folder_faketest0001",
        folderUrl: "https://drive.google.com/drive/folders/folder_faketest0001",
        filesUploaded: 7,
        ...resultOverrides,
      };
    },
  };
}

// --- Adapter validation --------------------------------------------------

test("requires a well-shaped adapter", () =>
  withTempDir(async (dir) => {
    seedPackage(dir);
    await assert.rejects(() => executeProductionAssetPublish(dir, {}), InvalidPublisherAdapterError);
    await assert.rejects(() => executeProductionAssetPublish(dir, { adapter: { name: "x" } }), InvalidPublisherAdapterError);
  }));

// --- Asset package validation ---------------------------------------------

test("rejects a non-existent assetPackagePath without ever calling the adapter", async () => {
  const adapter = createFakeAdapter();
  await assert.rejects(
    () => executeProductionAssetPublish("/this/path/does/not/exist/on/disk", { adapter }),
    InvalidAssetPackageError
  );
  assert.equal(adapter.calls(), 0);
});

test("rejects a package directory with no metadata.json", () =>
  withTempDir(async (dir) => {
    const adapter = createFakeAdapter();
    await assert.rejects(() => executeProductionAssetPublish(dir, { adapter }), InvalidAssetPackageError);
    assert.equal(adapter.calls(), 0);
  }));

test("rejects a package whose metadata.json is not valid JSON", () =>
  withTempDir(async (dir) => {
    writeFileSync(path.join(dir, "metadata.json"), "{ not valid json", "utf-8");
    const adapter = createFakeAdapter();
    await assert.rejects(() => executeProductionAssetPublish(dir, { adapter }), InvalidAssetPackageError);
    assert.equal(adapter.calls(), 0);
  }));

test("rejects a package whose metadata.json has no carousel_id", () =>
  withTempDir(async (dir) => {
    writeFileSync(path.join(dir, "metadata.json"), JSON.stringify({ foo: "bar" }), "utf-8");
    const adapter = createFakeAdapter();
    await assert.rejects(() => executeProductionAssetPublish(dir, { adapter }), InvalidAssetPackageError);
    assert.equal(adapter.calls(), 0);
  }));

test("rejects an empty or missing assetPackagePath", async () => {
  const adapter = createFakeAdapter();
  await assert.rejects(() => executeProductionAssetPublish("", { adapter }), InvalidAssetPackageError);
  await assert.rejects(() => executeProductionAssetPublish(undefined, { adapter }), InvalidAssetPackageError);
  assert.equal(adapter.calls(), 0);
});

// --- Successful delegation and safe result mapping ------------------------

test("delegates to the adapter exactly once with the given path and options, and passes the result through", () =>
  withTempDir(async (dir) => {
    seedPackage(dir);
    const adapter = createFakeAdapter();
    const result = await executeProductionAssetPublish(dir, { adapter, replace: true, maxAttempts: 2 });

    assert.equal(adapter.calls(), 1);
    assert.equal(adapter.seen()[0].assetPackagePath, dir);
    assert.deepEqual(adapter.seen()[0].options, { replace: true, maxAttempts: 2 });

    assert.deepEqual(result, {
      status: "completed",
      publisher: "fake-publisher",
      packageId: "car_svctest0000001",
      folderId: "folder_faketest0001",
      folderUrl: "https://drive.google.com/drive/folders/folder_faketest0001",
      filesUploaded: 7,
    });
  }));

test("replace defaults to false when not explicitly true", () =>
  withTempDir(async (dir) => {
    seedPackage(dir);
    const adapter = createFakeAdapter();
    await executeProductionAssetPublish(dir, { adapter });
    assert.equal(adapter.seen()[0].options.replace, false);
  }));

test("a truthy but non-boolean replace value is normalised to a strict boolean", () =>
  withTempDir(async (dir) => {
    seedPackage(dir);
    const adapter = createFakeAdapter();
    await executeProductionAssetPublish(dir, { adapter, replace: "yes" });
    assert.equal(adapter.seen()[0].options.replace, false, "only a literal true enables replace — never a truthy string");
  }));
