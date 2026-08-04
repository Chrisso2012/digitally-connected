// Unit tests for production-asset-publisher-mock-adapter.mjs (DC-003-I022).
// No filesystem, no network — this adapter never touches either.

import test from "node:test";
import assert from "node:assert/strict";
import { createMockPublisherAdapter } from "../../src/production-asset-publisher-mock-adapter.mjs";
import { DuplicatePackageError } from "../../src/production-asset-publisher-errors.mjs";

test("default mode resolves with a well-formed result, never touching the filesystem", async () => {
  const adapter = createMockPublisherAdapter();
  const result = await adapter.publishPackage("/this/path/does/not/exist/on/disk", {});
  assert.equal(result.status, "completed");
  assert.equal(result.publisher, "mock-publisher");
  assert.match(result.packageId, /^car_/);
  assert.match(result.folderUrl, /^https:\/\/drive\.google\.com\/drive\/folders\//);
  assert.equal(result.filesUploaded, 7);
  assert.equal(adapter.callCount(), 1);
});

test("result fields are overridable for tests that need specific values", async () => {
  const adapter = createMockPublisherAdapter({ packageId: "car_custom", folderId: "folder_custom", folderUrl: "https://example.test/folder_custom", filesUploaded: 3 });
  const result = await adapter.publishPackage("/x", {});
  assert.equal(result.packageId, "car_custom");
  assert.equal(result.folderId, "folder_custom");
  assert.equal(result.folderUrl, "https://example.test/folder_custom");
  assert.equal(result.filesUploaded, 3);
});

test("\"duplicate\" mode throws DuplicatePackageError unless options.replace is true", async () => {
  const adapter = createMockPublisherAdapter({ mode: "duplicate" });
  await assert.rejects(() => adapter.publishPackage("/x", {}), DuplicatePackageError);
  const result = await adapter.publishPackage("/x", { replace: true });
  assert.equal(result.status, "completed");
});

test("callCount tracks the number of publishPackage() invocations", async () => {
  const adapter = createMockPublisherAdapter();
  await adapter.publishPackage("/x", {});
  await adapter.publishPackage("/x", {});
  assert.equal(adapter.callCount(), 2);
});
