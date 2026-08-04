import test from "node:test";
import assert from "node:assert/strict";
import { loadWindowsProductionExportConfig } from "../../src/windows-production-export-config.mjs";

test("loadWindowsProductionExportConfig applies documented container-visible defaults when no env vars are set", () => {
  const config = loadWindowsProductionExportConfig({});
  assert.equal(config.archiveRoot, "/home/node/.n8n/dc003/exports");
  assert.equal(config.windowsDeliveryRoot, "/data/production-assets");
});

test("loadWindowsProductionExportConfig reads both values from the given env object", () => {
  const config = loadWindowsProductionExportConfig({
    PRODUCTION_ASSET_ARCHIVE_ROOT: "/custom/archive/root",
    WINDOWS_PRODUCTION_DELIVERY_ROOT: "/custom/windows/root",
  });
  assert.equal(config.archiveRoot, "/custom/archive/root");
  assert.equal(config.windowsDeliveryRoot, "/custom/windows/root");
});

test("neither value is ever a Windows-style host path — both are container-visible POSIX paths", () => {
  const config = loadWindowsProductionExportConfig({});
  assert.doesNotMatch(config.archiveRoot, /^[A-Za-z]:\\/);
  assert.doesNotMatch(config.windowsDeliveryRoot, /^[A-Za-z]:\\/);
});
