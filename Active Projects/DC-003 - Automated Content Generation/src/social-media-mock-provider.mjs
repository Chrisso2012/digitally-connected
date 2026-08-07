// DC-003-I032 — mock Social Media provider. Mirrors
// editorial-analysis-mock-provider.mjs exactly: deterministic, derives
// every field directly from the input (here, an Editorial Package
// record's own fields — never Ingested Content, never a raw article) via
// simple string manipulation, never real NLP, never randomness, never
// the current time. The same Editorial Package always produces the exact
// same output. Reads ONLY editorialPackage — the structural enforcement
// of this milestone's "consume only the Editorial Package" boundary.
//
// Every extracted field is either a genuine substring of the real
// Editorial Package (carousel headings/slide copy, hashtags reused
// as-is) or an honestly generic derived statement marked `[mock]` —
// never a fabricated fact, matching this codebase's established
// "mark anything illustrative as illustrative" mock-content discipline.
//
// DC-003-I032.1 — the six carousel slides are now semantically typed
// (cover/insight/statistic/quote/takeaway/cta, fixed positional order —
// see social-media-provider.mjs's own CAROUSEL_SLIDE_ROLE_ORDER), not a
// uniform six-item pool. No-fabrication policy: the "statistic" and
// "quote" roles' own structured evidence fields are populated ONLY when
// the Editorial Package genuinely contains a detectable, real value —
// detectStatistic()/selectQuote() below never invent a figure, a
// quotation, or an attribution. When no real evidence exists for a role,
// that role's structured field is null and its heading/body fall back to
// a different, still-genuine piece of Editorial Package content (a real
// key insight) — an honest degradation, never a fabricated substitute.
// See DC-003-I032.1 README "No-fabrication policy" for the full rationale.

const MOCK_PROVIDER_NAME = "mock-social-media-provider-v1";
const X_CHARACTER_LIMIT = 280;
const HEADING_MAX_LENGTH = 60;

// Matches a genuine numeric/percentage/currency figure — deliberately
// conservative so a bare year ("2026") or a list marker ("01") is never
// misread as a statistic. Requires an explicit magnitude signal (%, $, or
// a "percent"/"times"/"x" word) alongside the digits, not digits alone.
const STATISTIC_PATTERN = /(\$\d[\d,]*(?:\.\d+)?|\d+(?:\.\d+)?%|\d+(?:\.\d+)?\s?(?:percent|percentage points|times|x\b))/i;

// Fields scanned for real statistical evidence, in priority order — every
// one of these is genuine Editorial Package prose, never Ingested Content
// or a raw article (this module never reads either).
function statisticCandidateSentences(ep) {
  return [...(ep.key_insights ?? []), ...(ep.pull_quotes ?? []), ep.executive_summary, ep.core_message, ep.primary_problem, ep.desired_outcome].filter(isNonEmptyString);
}

/**
 * Scans real Editorial Package prose for a genuine, already-present
 * numeric/percentage/currency figure. Returns { value, context } drawn
 * verbatim from the source sentence, or null if no real evidence exists
 * anywhere in the package — never synthesises a number.
 */
function detectStatistic(ep) {
  for (const sentence of statisticCandidateSentences(ep)) {
    const match = STATISTIC_PATTERN.exec(sentence);
    if (match) {
      return { value: sanitize(match[1]), context: sanitize(sentence) };
    }
  }
  return null;
}

/**
 * Selects a real pull quote for the "quote" role. Returns
 * { quoteText } drawn verbatim from pull_quotes, or null if the
 * Editorial Package genuinely has none (defensive — the schema
 * guarantees minItems 1, but this module never trusts that alone).
 */
function selectQuote(ep) {
  const quotes = (ep.pull_quotes ?? []).filter(isNonEmptyString);
  if (quotes.length === 0) return null;
  return { quoteText: quotes[0] };
}

/**
 * Up to 4 real key insights for the "takeaway" role — never padded with
 * invented content when fewer than 4 exist.
 */
function selectKeyPoints(ep) {
  return (ep.key_insights ?? []).filter(isNonEmptyString).slice(0, 4);
}

function sanitize(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function truncate(value, maxLength) {
  const clean = sanitize(value);
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1).trim()}…`;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function imageGuidanceFor(slideNumber, sourceText) {
  return `Slide ${slideNumber}: an image evoking "${truncate(sourceText, 40)}" — illustrative guidance only, not a real creative brief [mock]`;
}

// One entry per fixed carousel position, each drawing on a distinct real
// Editorial Package field so slides read as genuinely different content,
// never a repeated pool cycled through. The "statistic" and "quote"
// entries carry their own real-evidence-or-null fallback logic; every
// other role always has real source text (schema-guaranteed non-empty
// fields), so no fallback is needed for them.
function buildCarouselSlides(ep) {
  const insightSource = (ep.key_insights ?? []).filter(isNonEmptyString)[0] ?? ep.core_message;
  const detectedStatistic = detectStatistic(ep);
  // Falls back to a DIFFERENT real key insight than the "insight" slide
  // used, when one exists — never the same string twice by coincidence
  // alone, though reusing real content is honest either way.
  const statisticFallbackSource = (ep.key_insights ?? []).filter(isNonEmptyString)[1] ?? insightSource;
  const statisticSourceText = detectedStatistic ? detectedStatistic.context : statisticFallbackSource;
  const quote = selectQuote(ep);
  const quoteSourceText = quote ? quote.quoteText : ep.core_message;

  const slides = [
    { slideRole: "cover", sourceText: ep.core_message, heading: sanitize(ep.primary_headline) },
    { slideRole: "insight", sourceText: insightSource },
    { slideRole: "statistic", sourceText: statisticSourceText, statistic: detectedStatistic },
    { slideRole: "quote", sourceText: quoteSourceText, quote },
    { slideRole: "takeaway", sourceText: ep.desired_outcome, keyPoints: selectKeyPoints(ep) },
    { slideRole: "cta", sourceText: ep.call_to_action },
  ];

  return slides.map((slide, index) => {
    const slideNumber = index + 1;
    const body = sanitize(slide.sourceText);
    const heading = slide.heading ?? truncate(slide.sourceText, HEADING_MAX_LENGTH);
    return {
      slideNumber,
      slideRole: slide.slideRole,
      heading,
      body,
      imageGuidance: imageGuidanceFor(slideNumber, slide.sourceText),
      statistic: slide.statistic ?? null,
      quote: slide.quote ?? null,
      keyPoints: slide.keyPoints ?? [],
    };
  });
}

function buildXPostText(hook, hashtagsSuffix) {
  const budget = X_CHARACTER_LIMIT - hashtagsSuffix.length - 1; // -1 for the joining space
  return `${truncate(hook, Math.max(budget, 10))} ${hashtagsSuffix}`.trim();
}

function buildSocialMediaContent(ep) {
  const hook = sanitize(ep.primary_headline);
  const hashtags = (ep.suggested_hashtags ?? []).map(sanitize);
  const xHashtags = hashtags.slice(0, 2).map((h) => `#${h.replace(/\s+/g, "")}`).join(" ");

  const slides = buildCarouselSlides(ep);

  return {
    hook,
    callToAction: sanitize(ep.call_to_action),
    tone: "informative and professional — illustrative only, not derived from real brand voice data [mock]",
    audience: sanitize(ep.primary_audience),
    platforms: {
      linkedin: {
        postText: `${sanitize(ep.core_message)} ${sanitize(ep.executive_summary)} ${sanitize(ep.call_to_action)}`,
        hashtags: hashtags.slice(0, 5),
      },
      facebook: {
        postText: `${hook} — ${sanitize(ep.core_message)} ${sanitize(ep.call_to_action)}`,
        hashtags: hashtags.slice(0, 3),
      },
      x: {
        postText: buildXPostText(hook, xHashtags || "#update"),
        hashtags: hashtags.slice(0, 2),
      },
      instagram: {
        caption: `${hook}\n\n${sanitize(ep.core_message)}\n\n${sanitize(ep.call_to_action)}`,
        hashtags: hashtags.slice(0, 8),
      },
    },
    carousel: {
      headings: slides.map((slide) => slide.heading),
      slideCopy: slides.map((slide) => slide.body),
      imageGuidance: slides.map((slide) => slide.imageGuidance),
      slides,
    },
  };
}

/**
 * Creates the mock provider. `generateSocialMedia` returns a raw JSON
 * string (never a pre-parsed object) so it behaves exactly like a real
 * text-completion API — mirrors createEditorialAnalysisMockProvider()'s
 * own return contract.
 */
export function createSocialMediaMockProvider() {
  return {
    name: MOCK_PROVIDER_NAME,
    async generateSocialMedia(prompt, context = {}) {
      const { editorialPackage } = context;
      if (!editorialPackage) {
        throw new Error("mock provider requires context.editorialPackage — call generateSocialMedia(prompt, { editorialPackage })");
      }
      return JSON.stringify(buildSocialMediaContent(editorialPackage));
    },
  };
}
