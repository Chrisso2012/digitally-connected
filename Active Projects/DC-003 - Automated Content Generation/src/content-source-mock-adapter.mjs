// DC-003-I030 — Mock Content Source Adapter: the ONLY source adapter
// automated tests and the CLI's default mode use — no network dependency.
// Mirrors delivery-office-mock-runner-adapter.mjs's own `options.mode`
// pattern: deterministic, no timers, no real waiting.
//
// options.mode — "success" (default) | "not-found" | "authentication-error"
//   | "rate-limit" | "transport-error".
// options.fixtures — an object keyed by sourceReference, each value
//   { title, body, metadata? } — overrides/extends DEFAULT_FIXTURES.
//   Any sourceReference not present in fixtures falls back to
//   DEFAULT_FIXTURE, so the CLI works zero-config for a smoke test.

import {
  ContentSourceNotFoundError,
  ContentSourceAuthenticationError,
  ContentSourceRateLimitError,
  ContentSourceTransportError,
} from "./content-source-errors.mjs";

const DEFAULT_FIXTURE = {
  title: "Why Local Businesses Need a Digital Marketing Strategy in 2026",
  // Deliberately over DEFAULT_MIN_WORD_COUNT (200 words) so the CLI's own
  // `create` subcommand succeeds zero-config, with no --title/--body
  // override needed, for a genuine smoke test — see README "Manual smoke
  // test of CLI end-to-end (mock mode)".
  body:
    "Local businesses across every sector are discovering that a coherent digital marketing strategy is no longer " +
    "optional. This article explores the core reasons small and mid-sized businesses benefit from investing in " +
    "structured digital marketing, covering search visibility, social proof, and content consistency as the three " +
    "pillars of sustainable growth. A clear content calendar, consistent brand voice, and measurable goals turn " +
    "scattered marketing activity into a repeatable system that compounds over time rather than resetting every " +
    "quarter. Search visibility matters because most buying journeys now begin with a search engine query, and a " +
    "business absent from those results is effectively invisible to a large share of its potential customers. " +
    "Social proof matters because prospective customers increasingly trust the experiences of other customers more " +
    "than any claim a business makes about itself, so reviews, testimonials, and visible engagement all compound " +
    "into a credibility signal that advertising alone cannot buy. Content consistency matters because algorithms " +
    "and audiences alike reward a steady, predictable cadence over sporadic bursts of activity followed by long " +
    "silences, and a business that shows up reliably earns both platform reach and audience trust over time. " +
    "Taken together, these three pillars form a system rather than a checklist: each one reinforces the others, " +
    "and a business that treats them as a connected whole, rather than three separate tasks, is the one most " +
    "likely to see compounding returns on its marketing effort over a full year rather than a single campaign.",
  metadata: {
    author: "mock-content-source-adapter",
    source_created_at: "2026-07-01T09:00:00.000Z",
    source_modified_at: "2026-08-05T14:30:00.000Z",
    source_revision_id: null,
    source_url: null,
  },
};

export function createContentSourceMockAdapter(options = {}) {
  const mode = options.mode ?? "success";
  const fixtures = options.fixtures ?? {};

  return {
    name: "mock-content-source-adapter",

    async fetch({ sourceReference }) {
      if (mode === "not-found") {
        throw new ContentSourceNotFoundError(sourceReference);
      }
      if (mode === "authentication-error") {
        throw new ContentSourceAuthenticationError(`simulated authentication failure for "${sourceReference}" [mock]`);
      }
      if (mode === "rate-limit") {
        throw new ContentSourceRateLimitError(`simulated rate limit for "${sourceReference}" [mock]`, 1000);
      }
      if (mode === "transport-error") {
        throw new ContentSourceTransportError(`simulated transport failure for "${sourceReference}" [mock]`);
      }

      const fixture = fixtures[sourceReference] ?? DEFAULT_FIXTURE;
      return {
        title: fixture.title,
        body: fixture.body,
        metadata: fixture.metadata ?? null,
        sourceIdentifier: sourceReference,
      };
    },
  };
}
