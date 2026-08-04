// DC-003 — configuration integrity checks.
//
// Semantic checks on already-parsed config (structural JSON validity is the
// config loader's job, see config-loader.mjs). Collects every issue found
// rather than stopping at the first one, since these are independent checks
// and a caller fixing config wants the whole list at once.

const EXPECTED_SLIDE_TYPES = ["cover", "content", "statistic", "quote", "infographic", "cta"];
const REQUIRED_TEMPLATE_FIELDS = [
  "template_id",
  "name",
  "slide_number",
  "background",
  "width",
  "height",
  "format",
  "template_version",
  "layers",
];
const REQUIRED_TOP_LEVEL_VERSION_FIELDS = [
  "project_version",
  "design_system_version",
  "template_registry_version",
  "schema_versions",
];
const REQUIRED_SCHEMA_VERSION_KEYS = [
  "topic_package",
  "carousel_content",
  "templated_payload",
  "finished_carousel",
  "execution_log",
  "execution_record",
  "invocation_request",
  "invocation_response",
  "content_request",
  "content_asset",
  "production_metrics",
];
// Deliberately loose substring match — this is a safety net against obvious
// mistakes (pasting a real key into config), not a secrets scanner.
const CREDENTIAL_KEY_PATTERN = /(api[_-]?key|secret|password|token|credential)/i;

function scanForCredentialLikeValues(obj, pathPrefix, issues) {
  if (obj === null || typeof obj !== "object") return;
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (CREDENTIAL_KEY_PATTERN.test(key) && typeof value === "string" && value.length > 0) {
      issues.push({
        check: "no-embedded-credentials",
        message: `Field "${currentPath}" looks like a credential and has a non-empty value`,
      });
    }
    if (typeof value === "object") {
      scanForCredentialLikeValues(value, currentPath, issues);
    }
  }
}

function checkTemplateRegistry(templates, constants, issues) {
  const registryKeys = Object.keys(templates?.templates ?? {});

  for (const slideType of EXPECTED_SLIDE_TYPES) {
    if (!registryKeys.includes(slideType)) {
      issues.push({ check: "template-exists", message: `Missing template registry entry for slide type "${slideType}"` });
    }
  }

  const constantsSlideTypes = constants?.slide_types ?? [];
  const missingFromConstants = EXPECTED_SLIDE_TYPES.filter((t) => !constantsSlideTypes.includes(t));
  if (missingFromConstants.length > 0) {
    issues.push({
      check: "constants-slide-types",
      message: `config/constants.json slide_types is missing: ${missingFromConstants.join(", ")}`,
    });
  }

  const seenIds = new Map();
  for (const [key, entry] of Object.entries(templates?.templates ?? {})) {
    if (!key || typeof key !== "string") {
      issues.push({ check: "template-key", message: `Template registry has an invalid internal key: ${JSON.stringify(key)}` });
      continue;
    }
    for (const field of REQUIRED_TEMPLATE_FIELDS) {
      if (!(field in entry)) {
        issues.push({ check: "template-metadata", message: `Template "${key}" is missing required field "${field}"` });
      }
    }
    if (entry.template_id) {
      if (seenIds.has(entry.template_id)) {
        issues.push({
          check: "unique-template-id",
          message: `Duplicate template_id "${entry.template_id}" used by both "${seenIds.get(entry.template_id)}" and "${key}"`,
        });
      } else {
        seenIds.set(entry.template_id, key);
      }
    }
  }
}

function checkVersionIdentifiers(versions, issues) {
  for (const field of REQUIRED_TOP_LEVEL_VERSION_FIELDS) {
    if (!(field in (versions ?? {}))) {
      issues.push({ check: "version-identifier-present", message: `config/versions.json is missing required field "${field}"` });
    }
  }
  if (!("prompt_version" in (versions ?? {}))) {
    issues.push({
      check: "version-identifier-present",
      message: `config/versions.json is missing required field "prompt_version" (its value may be null until a prompt exists, but the key must be present)`,
    });
  }

  for (const field of ["project_version", "design_system_version", "template_registry_version"]) {
    if (field in (versions ?? {}) && (typeof versions[field] !== "string" || versions[field].trim() === "")) {
      issues.push({ check: "version-value-non-empty", message: `config/versions.json field "${field}" must be a non-empty string` });
    }
  }

  for (const key of REQUIRED_SCHEMA_VERSION_KEYS) {
    const value = versions?.schema_versions?.[key];
    if (typeof value !== "string" || value.trim() === "") {
      issues.push({
        check: "schema-version-value-non-empty",
        message: `config/versions.json schema_versions.${key} must be a non-empty string`,
      });
    }
  }
}

function checkInfographicIconLayersAreFixed(templates, issues) {
  const infographic = templates?.templates?.infographic;
  if (!infographic) {
    issues.push({ check: "infographic-icon-fixed", message: `Template registry has no "infographic" entry to check` });
    return;
  }
  const variableNames = new Set((infographic.layers?.variable ?? []).map((l) => l.name));
  const fixedLayers = infographic.layers?.fixed ?? [];

  for (let n = 1; n <= 4; n++) {
    const iconName = `step_${n}_icon`;
    const fixedEntry = fixedLayers.find((l) => l.name === iconName);
    if (!fixedEntry) {
      issues.push({ check: "infographic-icon-fixed", message: `Expected "${iconName}" to be listed as a fixed layer on the infographic template` });
    } else if (fixedEntry.type !== "shape") {
      issues.push({
        check: "infographic-icon-fixed",
        message: `"${iconName}" is listed as fixed but has type "${fixedEntry.type}", expected "shape"`,
      });
    }
    if (variableNames.has(iconName)) {
      issues.push({ check: "infographic-icon-fixed", message: `"${iconName}" must not appear in the variable layer list` });
    }
  }
}

/**
 * Runs every configuration integrity check against an already-loaded config
 * object (as returned by loadConfig()). Returns { ok, issues } — never
 * throws on its own; callers decide whether to raise ConfigIntegrityError.
 */
export function runIntegrityChecks(config) {
  const issues = [];
  const { templates, constants, versions } = config;

  checkTemplateRegistry(templates, constants, issues);
  checkVersionIdentifiers(versions, issues);
  scanForCredentialLikeValues(templates, "templates", issues);
  scanForCredentialLikeValues(constants, "constants", issues);
  scanForCredentialLikeValues(versions, "versions", issues);
  checkInfographicIconLayersAreFixed(templates, issues);

  return { ok: issues.length === 0, issues };
}
