// DC-003-I026 — Windows Production Asset Export configuration, sourced
// from environment variables. Never reads config/*.json (see README
// "Configuration vs. credentials") — these two paths are deployment
// topology, not shared/non-secret project config, so they belong here
// exactly like every other *-config.mjs in this codebase.
//
// Both values are CONTAINER-VISIBLE paths, never a raw Windows host path
// — the host path (e.g. `E:\...\Production Assets`) lives entirely in
// Docker infrastructure configuration (the `docker run -v` bind mount
// this milestone's own README documents), never in committed source.
// This module only ever sees the container side of that mount.
//
// Deliberately DOES default both roots (unlike this codebase's usual
// "storeDirectory is always an explicit argument, never a built-in
// default" rule for I015/I023/I025's own CLIs) — the I026 brief itself
// asks for this: "The CLI should use configured archive and Windows
// delivery roots rather than requiring the user to type Docker paths
// every time." Both defaults are the already-established container-
// internal conventions this project has used since I017/I021 — not
// secrets, not host-specific, safe to hardcode as an overridable default.

const DEFAULT_ARCHIVE_ROOT = "/home/node/.n8n/dc003/exports";
const DEFAULT_WINDOWS_DELIVERY_ROOT = "/data/production-assets";

export function loadWindowsProductionExportConfig(env = process.env) {
  return {
    archiveRoot: env.PRODUCTION_ASSET_ARCHIVE_ROOT || DEFAULT_ARCHIVE_ROOT,
    windowsDeliveryRoot: env.WINDOWS_PRODUCTION_DELIVERY_ROOT || DEFAULT_WINDOWS_DELIVERY_ROOT,
  };
}
