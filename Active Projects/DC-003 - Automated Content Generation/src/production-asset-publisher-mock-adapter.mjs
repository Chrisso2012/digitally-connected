// DC-003-I022 — mock Publisher Adapter. The ONLY adapter automated tests
// and the CLI's own default (non---live) mode use — no network dependency,
// fully deterministic, configurable to simulate the failure modes the
// service needs to handle. Never used outside tests/CLI local
// verification; the real endpoint is google-drive-publisher-adapter.mjs.
// Mirrors renderer-transport-mock.mjs / llm-transport-mock.mjs exactly:
// same `options.mode` convention, same "returns the same shape the real
// adapter would" discipline.
//
// Never reads or writes the local asset package — a caller can pass any
// `assetPackagePath` string, including one that doesn't exist on disk,
// and this adapter still resolves (or throws its simulated failure)
// without ever touching the filesystem. Real completeness validation of
// the package happens in production-asset-publisher-service.mjs, before
// any adapter — mock or real — is ever called.

import { DuplicatePackageError } from "./production-asset-publisher-errors.mjs";

/**
 * options.mode — "success" (default) | "duplicate"
 * options.packageId / folderId / folderUrl / filesUploaded — override the
 *   returned result fields (used by tests that need specific values).
 */
export function createMockPublisherAdapter(options = {}) {
  let calls = 0;
  const mode = options.mode ?? "success";

  return {
    name: "mock-publisher-adapter",
    callCount: () => calls,

    async publishPackage(assetPackagePath, publishOptions = {}) {
      calls += 1;

      if (mode === "duplicate" && publishOptions.replace !== true) {
        throw new DuplicatePackageError(options.packageId ?? "car_mock0000000001", options.existingFilenames ?? ["01-cover.png"]);
      }

      return {
        status: "completed",
        publisher: "mock-publisher",
        packageId: options.packageId ?? "car_mock0000000001",
        folderId: options.folderId ?? "folder_mock0000000001",
        folderUrl: options.folderUrl ?? "https://drive.google.com/drive/folders/folder_mock0000000001",
        filesUploaded: options.filesUploaded ?? 7,
      };
    },
  };
}
