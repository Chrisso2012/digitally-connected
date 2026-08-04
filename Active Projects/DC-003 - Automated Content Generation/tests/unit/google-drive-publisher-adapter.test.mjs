// Unit tests for google-drive-publisher-adapter.mjs (DC-003-I022). Like
// the rest of this codebase's automated suite, these NEVER reach the
// network: global.fetch is stubbed per-test with a deterministic fake
// router (keyed by URL) and restored immediately afterward. No test in
// this file makes a real HTTP request, and no test authenticates against
// a real Google account.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createGoogleDrivePublisherAdapter } from "../../src/google-drive-publisher-adapter.mjs";
import {
  PublisherConfigurationError,
  PublisherAuthenticationError,
  PublisherClientError,
  PublisherTransportError,
  DuplicatePackageError,
  PublisherUploadError,
} from "../../src/production-asset-publisher-errors.mjs";

async function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "dc003-drive-adapter-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function withStubFetch(stubFetch, run) {
  const original = global.fetch;
  global.fetch = stubFetch;
  try {
    await run();
  } finally {
    global.fetch = original;
  }
}

const CONFIG = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  refreshToken: "test-refresh-token",
  rootFolderId: "root_folder_test",
  apiBaseUrl: "https://drive.example.test",
  tokenUrl: "https://oauth2.example.test/token",
  requestTimeoutMs: 5000,
  maxAttempts: 3,
};

function seedPackage(dir, overrides = {}) {
  const metadata = {
    asset_package_id: "pkg_adaptertest001",
    carousel_id: "car_adaptertest001",
    carousel_content_id: "cc_adaptertest001",
    execution_id: "exec_20260804_deadbeefcafe",
    topic_id: "topic_01J9ADAPTERTEST",
    export_timestamp: "2026-08-04T01:00:00.000Z",
    renderer_provider: "templated-http",
    render_duration_ms: 18000,
    total_duration_ms: 18000,
    slide_count: 6,
    export_version: "1.0",
    ...overrides,
  };
  writeFileSync(path.join(dir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf-8");
  for (const name of ["01-cover.png", "02-content.png", "03-statistic.png", "04-quote.png", "05-infographic.png", "06-cta.png"]) {
    writeFileSync(path.join(dir, name), Buffer.from(`fake-bytes-${name}`));
  }
  return metadata;
}

function jsonResponse(status, body, headers = {}) {
  const lower = Object.fromEntries(Object.entries({ "content-type": "application/json", ...headers }).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// A default, fully successful fetch router: token refresh succeeds, the
// campaign folder doesn't exist yet (so it gets created), the folder
// starts empty (so every upload is a create, never an update), and every
// upload succeeds. Call sites overwrite `routes[key]` per test.
function createDefaultRouter({ folderExists = false, existingFiles = [] } = {}) {
  const uploadedFiles = [];
  const requests = [];

  async function router(url, init) {
    requests.push({ url: String(url), method: init?.method ?? "GET" });
    const urlStr = String(url);

    if (urlStr.startsWith(CONFIG.tokenUrl)) {
      return jsonResponse(200, { access_token: "fake-access-token", expires_in: 3600, token_type: "Bearer" });
    }

    if (urlStr.includes("/drive/v3/files") && !urlStr.includes("/upload/") && (init?.method ?? "GET") === "GET") {
      // Folder lookup (q references mimeType=folder) vs file listing (q references a folder id 'in parents' only).
      if (urlStr.includes("mimeType") && urlStr.includes("folder")) {
        return jsonResponse(200, { files: folderExists ? [{ id: "campaign_folder_id", name: "car_adaptertest001" }] : [] });
      }
      return jsonResponse(200, { files: existingFiles });
    }

    if (urlStr.includes("/drive/v3/files") && !urlStr.includes("/upload/") && (init?.method ?? "GET") === "POST") {
      return jsonResponse(200, { id: "campaign_folder_id", name: "car_adaptertest001" });
    }

    if (urlStr.includes("/upload/drive/v3/files") && (init?.method ?? "GET") === "POST") {
      uploadedFiles.push({ kind: "create", body: init.body });
      return jsonResponse(200, { id: `new_file_${uploadedFiles.length}` });
    }

    if (urlStr.includes("/upload/drive/v3/files/") && (init?.method ?? "GET") === "PATCH") {
      uploadedFiles.push({ kind: "update", body: init.body });
      return jsonResponse(200, { id: "updated_file" });
    }

    throw new Error(`Unhandled stub route: ${init?.method ?? "GET"} ${urlStr}`);
  }

  router.uploadedFiles = uploadedFiles;
  router.requests = requests;
  return router;
}

// --- Configuration preconditions ------------------------------------

test("throws PublisherConfigurationError when clientId/clientSecret/refreshToken are missing — no fetch is ever called", () =>
  withTempDir(async (dir) => {
    seedPackage(dir);
    let fetchCalled = false;
    await withStubFetch(
      async () => {
        fetchCalled = true;
        return jsonResponse(200, {});
      },
      async () => {
        const adapter = createGoogleDrivePublisherAdapter({ ...CONFIG, clientId: null });
        await assert.rejects(() => adapter.publishPackage(dir, {}), PublisherConfigurationError);
        assert.equal(fetchCalled, false);
      }
    );
  }));

test("throws PublisherConfigurationError when rootFolderId is missing — no fetch is ever called", () =>
  withTempDir(async (dir) => {
    seedPackage(dir);
    let fetchCalled = false;
    await withStubFetch(
      async () => {
        fetchCalled = true;
        return jsonResponse(200, {});
      },
      async () => {
        const adapter = createGoogleDrivePublisherAdapter({ ...CONFIG, rootFolderId: null });
        await assert.rejects(() => adapter.publishPackage(dir, {}), PublisherConfigurationError);
        assert.equal(fetchCalled, false);
      }
    );
  }));

// --- Successful publish: folder creation, upload order, result shape ----

test("creates the campaign folder when it doesn't exist, uploads all 7 files, and returns a well-formed result", () =>
  withTempDir((dir) => {
    seedPackage(dir);
    const router = createDefaultRouter({ folderExists: false });
    return withStubFetch(router, async () => {
      const adapter = createGoogleDrivePublisherAdapter(CONFIG);
      const result = await adapter.publishPackage(dir, {});

      assert.equal(result.status, "completed");
      assert.equal(result.publisher, "google-drive");
      assert.equal(result.packageId, "car_adaptertest001");
      assert.equal(result.folderId, "campaign_folder_id");
      assert.equal(result.folderUrl, "https://drive.google.com/drive/folders/campaign_folder_id");
      assert.equal(result.filesUploaded, 7);
      assert.equal(router.uploadedFiles.length, 7);
      assert.ok(router.uploadedFiles.every((f) => f.kind === "create"));
    });
  }));

test("reuses an existing campaign folder instead of creating a duplicate one", () =>
  withTempDir((dir) => {
    seedPackage(dir);
    const router = createDefaultRouter({ folderExists: true });
    return withStubFetch(router, async () => {
      const adapter = createGoogleDrivePublisherAdapter(CONFIG);
      const result = await adapter.publishPackage(dir, {});
      assert.equal(result.folderId, "campaign_folder_id");
      // No POST to /drive/v3/files (folder create) should have happened.
      const folderCreateCalls = router.requests.filter((r) => r.url.includes("/drive/v3/files") && !r.url.includes("/upload/") && r.method === "POST");
      assert.equal(folderCreateCalls.length, 0);
    });
  }));

// --- Duplicate handling ---------------------------------------------------

test("throws DuplicatePackageError when matching filenames already exist and replace is not true — no upload is attempted", () =>
  withTempDir((dir) => {
    seedPackage(dir);
    const router = createDefaultRouter({ folderExists: true, existingFiles: [{ id: "existing1", name: "01-cover.png" }] });
    return withStubFetch(router, async () => {
      const adapter = createGoogleDrivePublisherAdapter(CONFIG);
      await assert.rejects(() => adapter.publishPackage(dir, {}), (error) => {
        assert.ok(error instanceof DuplicatePackageError);
        assert.equal(error.carouselId, "car_adaptertest001");
        assert.deepEqual(error.existingFilenames, ["01-cover.png"]);
        return true;
      });
      assert.equal(router.uploadedFiles.length, 0);
    });
  }));

test("with replace: true, an existing file is updated (PATCH) in place rather than duplicated", () =>
  withTempDir((dir) => {
    seedPackage(dir);
    const router = createDefaultRouter({ folderExists: true, existingFiles: [{ id: "existing_cover_id", name: "01-cover.png" }] });
    return withStubFetch(router, async () => {
      const adapter = createGoogleDrivePublisherAdapter(CONFIG);
      const result = await adapter.publishPackage(dir, { replace: true });
      assert.equal(result.filesUploaded, 7);
      const updates = router.uploadedFiles.filter((f) => f.kind === "update");
      const creates = router.uploadedFiles.filter((f) => f.kind === "create");
      assert.equal(updates.length, 1, "exactly the one pre-existing file (01-cover.png) is updated");
      assert.equal(creates.length, 6, "the other 6 files are newly created");
    });
  }));

// --- Never modifies the local package -------------------------------------

test("never writes to or modifies any file in the local asset package", () =>
  withTempDir((dir) => {
    seedPackage(dir);
    const beforeBytes = readFileSync(path.join(dir, "01-cover.png"));
    const router = createDefaultRouter({ folderExists: false });
    return withStubFetch(router, async () => {
      const adapter = createGoogleDrivePublisherAdapter(CONFIG);
      await adapter.publishPackage(dir, {});
      const afterBytes = readFileSync(path.join(dir, "01-cover.png"));
      assert.ok(beforeBytes.equals(afterBytes));
    });
  }));

// --- Error classification & safe diagnostics -------------------------

test("HTTP 401 from the token endpoint surfaces as PublisherAuthenticationError", () =>
  withTempDir((dir) => {
    seedPackage(dir);
    return withStubFetch(
      async (url) => (String(url).startsWith(CONFIG.tokenUrl) ? jsonResponse(401, {}) : jsonResponse(200, {})),
      async () => {
        const adapter = createGoogleDrivePublisherAdapter(CONFIG);
        await assert.rejects(() => adapter.publishPackage(dir, {}), PublisherAuthenticationError);
      }
    );
  }));

test("a token response with no access_token surfaces as PublisherAuthenticationError", () =>
  withTempDir((dir) => {
    seedPackage(dir);
    return withStubFetch(
      async () => jsonResponse(200, { token_type: "Bearer" }),
      async () => {
        const adapter = createGoogleDrivePublisherAdapter(CONFIG);
        await assert.rejects(() => adapter.publishPackage(dir, {}), PublisherAuthenticationError);
      }
    );
  }));

test("HTTP 400 from Drive surfaces as PublisherClientError with a safe diagnostic, never the raw body", () =>
  withTempDir((dir) => {
    seedPackage(dir);
    return withStubFetch(
      async (url) => {
        if (String(url).startsWith(CONFIG.tokenUrl)) return jsonResponse(200, { access_token: "fake-access-token" });
        return jsonResponse(400, { error: { code: 400, message: "Invalid query", errors: [{ reason: "invalidQuery", message: "Invalid query" }] } });
      },
      async () => {
        const adapter = createGoogleDrivePublisherAdapter(CONFIG);
        await assert.rejects(() => adapter.publishPackage(dir, {}), (error) => {
          assert.ok(error instanceof PublisherClientError);
          assert.equal(error.diagnostic.status, 400);
          assert.equal(error.diagnostic.reason, "invalidQuery");
          assert.equal(error.diagnostic.message, "Invalid query");
          return true;
        });
      }
    );
  }));

test("HTTP 5xx from Drive surfaces as PublisherTransportError", () =>
  withTempDir((dir) => {
    seedPackage(dir);
    return withStubFetch(
      async (url) => (String(url).startsWith(CONFIG.tokenUrl) ? jsonResponse(200, { access_token: "fake-access-token" }) : jsonResponse(503, {})),
      async () => {
        const adapter = createGoogleDrivePublisherAdapter(CONFIG);
        await assert.rejects(() => adapter.publishPackage(dir, {}), PublisherTransportError);
      }
    );
  }));

test("no thrown error ever includes the access token, client secret, or refresh token", () =>
  withTempDir((dir) => {
    seedPackage(dir);
    return withStubFetch(
      async (url) => (String(url).startsWith(CONFIG.tokenUrl) ? jsonResponse(200, { access_token: "sk-SUPER-SECRET-ACCESS-TOKEN-12345" }) : jsonResponse(401, {})),
      async () => {
        const adapter = createGoogleDrivePublisherAdapter(CONFIG);
        try {
          await adapter.publishPackage(dir, {});
          assert.fail("expected to throw");
        } catch (error) {
          assert.doesNotMatch(JSON.stringify(error), /SUPER-SECRET-ACCESS-TOKEN/);
          assert.doesNotMatch(JSON.stringify(error), new RegExp(CONFIG.clientSecret));
          assert.doesNotMatch(JSON.stringify(error), new RegExp(CONFIG.refreshToken));
        }
      }
    );
  }));

// --- Upload failure stops immediately -------------------------------

test("an upload failure on the 3rd file stops immediately — no requests for files 4-7", () =>
  withTempDir((dir) => {
    seedPackage(dir);
    let uploadAttempts = 0;
    const router = async (url, init) => {
      const urlStr = String(url);
      if (urlStr.startsWith(CONFIG.tokenUrl)) return jsonResponse(200, { access_token: "fake-access-token" });
      if (urlStr.includes("/drive/v3/files") && !urlStr.includes("/upload/") && (init?.method ?? "GET") === "GET") {
        return jsonResponse(200, { files: urlStr.includes("mimeType") ? [{ id: "campaign_folder_id", name: "car_adaptertest001" }] : [] });
      }
      if (urlStr.includes("/upload/drive/v3/files") && init?.method === "POST") {
        uploadAttempts += 1;
        if (uploadAttempts === 3) return { ok: false, status: 500, headers: { get: () => null } };
        return jsonResponse(200, { id: `new_file_${uploadAttempts}` });
      }
      throw new Error(`Unhandled stub route: ${init?.method ?? "GET"} ${urlStr}`);
    };
    return withStubFetch(router, async () => {
      const adapter = createGoogleDrivePublisherAdapter(CONFIG);
      await assert.rejects(() => adapter.publishPackage(dir, { maxAttempts: 1 }), PublisherUploadError);
      assert.equal(uploadAttempts, 3, "no upload attempts for files 4 through 7 after the 3rd fails");
    });
  }));
