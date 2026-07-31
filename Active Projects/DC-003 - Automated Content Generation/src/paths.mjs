// DC-003 — project-root path resolution. Cross-platform (uses node:path,
// never a hardcoded separator or absolute path) and independent of the
// caller's current working directory.

import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// This file lives at <project root>/src/paths.mjs, so the root is one level up.
export const PROJECT_ROOT = path.resolve(__dirname, "..");

/**
 * Resolve a path relative to the project root, or to an override root
 * (used by tests to point at temporary, isolated directories instead of
 * the real project's config/schemas).
 */
export function resolveFromRoot(rootDir, ...segments) {
  return path.join(rootDir ?? PROJECT_ROOT, ...segments);
}
