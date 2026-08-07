// DC-003-I031 — mock Editorial Analysis provider. Mirrors
// carousel-mock-provider.mjs exactly: implements the same shape any real
// provider (Anthropic, or a future alternative) will implement, deriving
// deterministic-but-plausible editorial fields directly from the input
// (here, an Ingested Content record's own title/full_article_text) via
// simple string manipulation — never real NLP, never randomness, never
// the current time. The same Ingested Content always produces the exact
// same output.
//
// Every extracted field is either a direct substring of the real article
// (pull quotes, key insights, keywords) or an honestly generic derived
// statement — never a fabricated fact/statistic/claim, matching this
// codebase's own established "mark anything illustrative as illustrative"
// mock-content discipline (carousel-mock-provider.mjs's own statistic
// slide comment).

const MOCK_PROVIDER_NAME = "mock-editorial-analysis-provider-v1";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "is", "are", "was", "were",
  "this", "that", "these", "those", "it", "its", "as", "at", "by", "from", "be", "been", "has", "have", "had",
  "not", "no", "so", "than", "then", "into", "over", "under", "about", "than", "their", "they", "there", "when",
]);

function sanitize(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function splitSentences(text) {
  return sanitize(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function truncate(value, maxLength) {
  const clean = sanitize(value);
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1).trim()}…`;
}

function topKeywords(text, count) {
  const frequency = new Map();
  const words = sanitize(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOPWORDS.has(word));

  for (const word of words) {
    frequency.set(word, (frequency.get(word) ?? 0) + 1);
  }

  return [...frequency.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([word]) => word);
}

function buildEditorialAnalysis(ingestedContent) {
  const title = sanitize(ingestedContent.title);
  const sentences = splitSentences(ingestedContent.full_article_text);
  // Defensive fallback only — the Content Ingestion Service (DC-003-I030)
  // already enforces a 200-word minimum, so real input always yields at
  // least one sentence; this guarantees the non-empty-array contract
  // regardless.
  const safeSentences = sentences.length > 0 ? sentences : [title];
  const keywordsRaw = topKeywords(`${title} ${ingestedContent.full_article_text}`, 8);
  const keywords = keywordsRaw.length > 0 ? keywordsRaw : [title.toLowerCase()];
  const executiveSummary = safeSentences.slice(0, 2).join(" ");

  return {
    primaryHeadline: title,
    supportingHeadline: `A practical look at ${title.toLowerCase()}`,
    executiveSummary,
    coreMessage: safeSentences[0],
    primaryAudience: "readers researching this topic — illustrative only, not derived from real audience data [mock]",
    primaryProblem: `The challenge of understanding and acting on: ${title.toLowerCase()} — illustrative only [mock]`,
    desiredOutcome: `The reader understands ${title.toLowerCase()} well enough to act on it — illustrative only [mock]`,
    keyInsights: safeSentences.slice(0, 5),
    pullQuotes: safeSentences.slice(0, 2),
    callToAction: `Learn more about ${title.toLowerCase()}`,
    keywords,
    seoTitle: truncate(title, 60),
    seoDescription: truncate(executiveSummary, 160),
    suggestedHashtags: keywords.slice(0, 5).map((word) => word.replace(/-/g, "")),
    editorialThemes: keywords.slice(0, 3),
    contentCategories: ["content-marketing"],
  };
}

/**
 * Creates the mock provider. `analyzeContent` returns a raw JSON string
 * (never a pre-parsed object) so it behaves exactly like a real
 * text-completion API from the generator's point of view — mirrors
 * createMockProvider().generateCarousel()'s own return contract.
 */
export function createEditorialAnalysisMockProvider() {
  return {
    name: MOCK_PROVIDER_NAME,
    async analyzeContent(prompt, context = {}) {
      const { ingestedContent } = context;
      if (!ingestedContent) {
        throw new Error("mock provider requires context.ingestedContent — call analyzeContent(prompt, { ingestedContent })");
      }
      return JSON.stringify(buildEditorialAnalysis(ingestedContent));
    },
  };
}
