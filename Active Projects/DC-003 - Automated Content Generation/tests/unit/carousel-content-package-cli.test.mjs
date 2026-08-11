// Unit tests for tests/validation/carousel-content-package.mjs
// (DC-003-I032.10.1). No network, no AI provider — mirrors
// editorial-package-cli.test.mjs's own "spawnSync via process.execPath"
// pattern.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CCP_CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "carousel-content-package.mjs");

function runCli(...args) {
  return spawnSync(process.execPath, [CCP_CLI_PATH, ...args], { encoding: "utf-8" });
}

const INDUSTRY_SERIES = "Real Estate Industry Series";

function image(overrides = {}) {
  return { mode: "none", asset_reference: null, direction: null, ...overrides };
}

function buildValidFields(overrides = {}) {
  return {
    sourceArticleTitle: "The Myth of the Dead Database",
    sourceArticleReference: "cowork://articles/myth-dead-database",
    industryName: "Real Estate",
    industrySeries: INDUSTRY_SERIES,
    carouselTitle: "The Myth of the Dead Database",
    approvedBy: "chris@digitallyconnected.net",
    approvedAt: "2026-08-11T09:00:00.000Z",
    slides: [
      {
        slide_number: 1,
        role: "cover",
        template: "cover_black",
        industry_series: INDUSTRY_SERIES,
        headline: "The Myth of the Dead Database",
        supporting_line: "Why timing, not interest, is the real reason old enquiries go quiet.",
        image: image({ mode: "provided", asset_reference: "fixtures/images/cover.png" }),
      },
      { slide_number: 2, role: "content", template: "content_white", industry_series: INDUSTRY_SERIES, headline: "H2", body: "B2", image: image(), image_layout: "none", emphasis_instructions: [] },
      { slide_number: 3, role: "content", template: "content_orange", industry_series: INDUSTRY_SERIES, headline: "H3", body: "B3", image: image(), image_layout: "none", emphasis_instructions: [] },
      { slide_number: 4, role: "content", template: "content_white", industry_series: INDUSTRY_SERIES, headline: "H4", body: "B4", image: image(), image_layout: "none", emphasis_instructions: [] },
      { slide_number: 5, role: "content", template: "content_orange", industry_series: INDUSTRY_SERIES, headline: "H5", body: "B5", image: image(), image_layout: "none", emphasis_instructions: [] },
      { slide_number: 6, role: "content", template: "content_white", industry_series: INDUSTRY_SERIES, headline: "H6", body: "B6", image: image(), image_layout: "none", emphasis_instructions: [] },
      {
        slide_number: 7,
        role: "close",
        template: "close_black",
        industry_series: INDUSTRY_SERIES,
        headline: "One Question Reopens the Conversation",
        body: "Ask every old enquiry: has anything changed since we last spoke?",
        soft_cta: "See what's already in your CRM.",
        image: image({ mode: "provided", asset_reference: "fixtures/images/close.png" }),
        emphasis_instructions: [],
      },
    ],
    ...overrides,
  };
}

function withTempDirs(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "dc003-carousel-content-package-cli-"));
  const storeDir = path.join(base, "store");
  try {
    return fn({ base, storeDir });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function writeFieldsFile(base, fields) {
  const filePath = path.join(base, "fields.json");
  writeFileSync(filePath, JSON.stringify(fields));
  return filePath;
}

test("no subcommand prints usage and exits 1", () => {
  const result = runCli();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});

test("import with missing arguments prints usage and exits 1", () => {
  const result = runCli("import");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});

test("import (a valid fields file) creates and prints the full record", () =>
  withTempDirs(({ base, storeDir }) => {
    const fieldsPath = writeFieldsFile(base, buildValidFields());
    const result = runCli("import", fieldsPath, storeDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Carousel Content Package imported OK/);
    assert.match(result.stdout, /carousel_content_package_id:\s+ccp_/);
    assert.match(result.stdout, /package_type:\s+carousel_content_package/);
  }));

test("import never invokes any provider — no --live flag exists on this CLI's usage, and no AI-provider import appears anywhere in the source", () => {
  const source = readFileSync(CCP_CLI_PATH, "utf-8");
  assert.doesNotMatch(source, /--live|anthropic|Anthropic|createSocialMedia|generateSocialMedia/i);
});

test("import fails cleanly for structurally invalid fields (wrong slide count)", () =>
  withTempDirs(({ base, storeDir }) => {
    const fields = buildValidFields();
    fields.slides = fields.slides.slice(0, 6);
    const fieldsPath = writeFieldsFile(base, fields);
    const result = runCli("import", fieldsPath, storeDir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL\s+InvalidCarouselContentPackageInputError/);
  }));

test("import fails cleanly for an emphasis phrase not present in the slide's own text", () =>
  withTempDirs(({ base, storeDir }) => {
    const fields = buildValidFields();
    fields.slides[4] = { ...fields.slides[4], emphasis_instructions: [{ phrase: "nowhere in this text", style: "highlight" }] };
    const fieldsPath = writeFieldsFile(base, fields);
    const result = runCli("import", fieldsPath, storeDir);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /FAIL\s+EmphasisPhraseNotFoundError/);
  }));

test("inspect prints full JSON for a stored record; fails cleanly for an unknown id", () =>
  withTempDirs(({ base, storeDir }) => {
    const fieldsPath = writeFieldsFile(base, buildValidFields());
    const created = runCli("import", fieldsPath, storeDir);
    assert.equal(created.status, 0, created.stderr);
    const idMatch = created.stdout.match(/carousel_content_package_id:\s+(ccp_[A-Za-z0-9]+)/);
    assert.ok(idMatch);

    const inspected = runCli("inspect", idMatch[1], storeDir);
    assert.equal(inspected.status, 0, inspected.stderr);
    const parsed = JSON.parse(inspected.stdout.split("\n").slice(1).join("\n"));
    assert.equal(parsed.carousel_content_package_id, idMatch[1]);
    assert.equal(parsed.production_authority.publishing_authorized, false);

    const missing = runCli("inspect", "ccp_doesnotexist00001", storeDir);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /FAIL\s+CarouselContentPackageNotFoundError/);
  }));

test("list prints a summary line per stored record", () =>
  withTempDirs(({ base, storeDir }) => {
    const fieldsA = writeFieldsFile(path.join(base), buildValidFields({ carouselTitle: "Carousel A" }));
    runCli("import", fieldsA, storeDir);
    const fieldsBPath = path.join(base, "fields-b.json");
    writeFileSync(fieldsBPath, JSON.stringify(buildValidFields({ carouselTitle: "Carousel B" })));
    runCli("import", fieldsBPath, storeDir);

    const result = runCli("list", storeDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /2 carousel content package\(s\)/);
  }));
