// DC-003-I027 — mock Instagram Publisher Adapter. The ONLY Instagram
// adapter automated tests and the CLI's own default (non---live) mode
// use — no network dependency, fully deterministic. Mirrors
// production-asset-publisher-mock-adapter.mjs (I022) exactly: same
// `options.mode` convention, same "returns the same shape the real
// adapter would" discipline. Never used outside tests/CLI local
// verification; the real endpoint is
// instagram-carousel-publisher-adapter.mjs.

import { InstagramClientError } from "./instagram-publisher-errors.mjs";

/**
 * options.mode — "success" (default) | "failure"
 * options.postId / postUrl / itemCount — override the returned result
 *   fields (used by tests that need specific values).
 * options.destination — override the adapter's own reported destination
 *   identifier (used by duplicate-detection tests).
 * options.now — override the clock (used by tests).
 */
export function createMockInstagramPublisherAdapter(options = {}) {
  let calls = 0;
  const mode = options.mode ?? "success";
  const now = options.now ?? (() => new Date().toISOString());

  return {
    name: "mock-instagram-publisher-adapter",
    provider: "instagram",
    destination: options.destination ?? "instagram:mock-account",
    callCount: () => calls,

    async publish({ finishedCarousel }) {
      calls += 1;

      if (mode === "failure") {
        throw new InstagramClientError("Instagram rejected the request (HTTP 400) [mock]", { status: 400, errorType: "mock_error", message: "simulated failure" });
      }

      return {
        postId: options.postId ?? "17800000000000000_mock",
        postUrl: options.postUrl ?? null,
        publishedAt: now(),
        itemCount: options.itemCount ?? finishedCarousel.slides.length,
      };
    },
  };
}
