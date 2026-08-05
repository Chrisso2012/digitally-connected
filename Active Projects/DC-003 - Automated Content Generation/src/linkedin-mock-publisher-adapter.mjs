// DC-003-I027 — mock LinkedIn Publisher Adapter. The ONLY LinkedIn
// adapter automated tests and the CLI's own default (non---live) mode
// use — no network dependency, fully deterministic. Mirrors
// production-asset-publisher-mock-adapter.mjs (I022) /
// instagram-mock-publisher-adapter.mjs exactly. Never reads the local
// asset package — a caller can pass any `assetPackagePath`, including
// one that doesn't exist on disk, and this adapter still resolves (or
// throws its simulated failure) without ever touching the filesystem.

import { LinkedInClientError } from "./linkedin-publisher-errors.mjs";

/**
 * options.mode — "success" (default) | "failure"
 * options.postId / postUrl / itemCount — override the returned result
 *   fields (used by tests that need specific values).
 * options.destination — override the adapter's own reported destination
 *   identifier (used by duplicate-detection tests).
 * options.now — override the clock (used by tests).
 */
export function createMockLinkedInPublisherAdapter(options = {}) {
  let calls = 0;
  const mode = options.mode ?? "success";
  const now = options.now ?? (() => new Date().toISOString());

  return {
    name: "mock-linkedin-publisher-adapter",
    provider: "linkedin",
    destination: options.destination ?? "urn:li:person:mock-author",
    callCount: () => calls,

    async publish({ finishedCarousel }) {
      calls += 1;

      if (mode === "failure") {
        throw new LinkedInClientError("LinkedIn rejected the request (HTTP 400) [mock]", { status: 400, message: "simulated failure" });
      }

      return {
        postId: options.postId ?? "urn:li:share:7000000000000000000",
        postUrl: options.postUrl ?? "https://www.linkedin.com/feed/update/urn:li:share:7000000000000000000/",
        publishedAt: now(),
        itemCount: options.itemCount ?? finishedCarousel.slides.length,
      };
    },
  };
}
