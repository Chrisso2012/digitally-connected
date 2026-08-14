// DC-003-I035 — Chromium executable resolution. Playwright's own bundled
// browser download does not support Alpine/musl (this project's
// canonical Docker environment) — the canonical setup instead installs
// Chromium as a system package (`apk add --no-cache chromium`, see this
// milestone's own README section) and this renderer drives that binary
// directly via `executablePath`, using `playwright-core` (no bundled
// browser, no download attempt at install time).
//
// CHROMIUM_EXECUTABLE_PATH — infrastructure config (mirrors this
// project's own LLM_API_KEY/TEMPLATED_API_KEY precedent: an explicit,
// documented env var with a sensible default), NOT a content/storage
// directory — unlike assetsRootDir/outputDir, which always remain
// explicit, required arguments per this codebase's dominant convention.
const DEFAULT_CHROMIUM_EXECUTABLE_PATH = "/usr/bin/chromium-browser";

export function resolveChromiumExecutablePath(env = process.env) {
  return env.CHROMIUM_EXECUTABLE_PATH?.trim() || DEFAULT_CHROMIUM_EXECUTABLE_PATH;
}
