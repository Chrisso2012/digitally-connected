import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "control-centre.mjs");
const CAROUSEL_CLI_PATH = path.join(PROJECT_ROOT, "tests", "validation", "carousel-store.mjs");
const FIXTURE_PATH = path.join(PROJECT_ROOT, "tests", "fixtures", "finished-carousel.example.json");

// No network anywhere in this CLI's own code path — but env is still
// scrubbed of provider credentials so a developer's real .env (if any) in
// this shell can never make a health check's "configured" status
// non-deterministic across machines.
const CLEAN_ENV = {
  ...process.env,
  LLM_API_KEY: undefined,
  TEMPLATED_API_KEY: undefined,
  GOOGLE_DRIVE_CLIENT_ID: undefined,
  GOOGLE_DRIVE_CLIENT_SECRET: undefined,
  GOOGLE_DRIVE_REFRESH_TOKEN: undefined,
  GOOGLE_DRIVE_ROOT_FOLDER_ID: undefined,
};

function runCli(...args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: "utf-8", env: CLEAN_ENV });
}

function runCarouselCli(...args) {
  return spawnSync(process.execPath, [CAROUSEL_CLI_PATH, ...args], { encoding: "utf-8", env: CLEAN_ENV });
}

function withTempDirs(fn) {
  const base = mkdtempSync(path.join(tmpdir(), "dc003-control-centre-cli-"));
  const carouselDir = path.join(base, "carousels");
  const metricsDir = path.join(base, "metrics");
  try {
    return fn({ base, carouselDir, metricsDir });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test("dashboard on an empty pair of stores prints a clean, plain-text overview with no ANSI codes", () => {
  withTempDirs(({ carouselDir, metricsDir }) => {
    const result = runCli("dashboard", carouselDir, metricsDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DC-003 CONTROL CENTRE/);
    assert.match(result.stdout, /System Health/);
    assert.match(result.stdout, /Production/);
    assert.match(result.stdout, /Recent Jobs \(0\)/);
    assert.match(result.stdout, /Recent Activity \(0\)/);
    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(result.stdout, /\x1b\[/, "must contain no ANSI escape codes, per the I024 brief");
  });
});

test("dashboard reflects a real saved carousel via the CLI, end to end", () => {
  withTempDirs(({ carouselDir, metricsDir }) => {
    const saveResult = runCarouselCli("save", FIXTURE_PATH, carouselDir);
    assert.equal(saveResult.status, 0, saveResult.stderr);

    const dashboardResult = runCli("dashboard", carouselDir, metricsDir);
    assert.equal(dashboardResult.status, 0, dashboardResult.stderr);
    assert.match(dashboardResult.stdout, /Completed\s+1/);
    assert.match(dashboardResult.stdout, /car_01J9X9C7/);
  });
});

test("health subcommand prints only the System Health section", () => {
  withTempDirs(({ carouselDir, metricsDir }) => {
    const result = runCli("health", carouselDir, metricsDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /System Health/);
    assert.match(result.stdout, /Overall:/);
    assert.doesNotMatch(result.stdout, /DC-003 CONTROL CENTRE/);
    assert.doesNotMatch(result.stdout, /Recent Jobs/);
  });
});

test("jobs subcommand prints only Recent Jobs", () => {
  withTempDirs(({ carouselDir, metricsDir }) => {
    const result = runCli("jobs", carouselDir, metricsDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Recent Jobs \(0\)/);
    assert.doesNotMatch(result.stdout, /System Health/);
  });
});

test("activity subcommand prints only Recent Activity", () => {
  withTempDirs(({ carouselDir, metricsDir }) => {
    const result = runCli("activity", carouselDir, metricsDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Recent Activity \(0\)/);
    assert.doesNotMatch(result.stdout, /System Health/);
  });
});

test("job <carouselId> prints full job detail for a real saved carousel", () => {
  withTempDirs(({ carouselDir, metricsDir }) => {
    runCarouselCli("save", FIXTURE_PATH, carouselDir);
    const result = runCli("job", "car_01J9X9C7", carouselDir, metricsDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /JOB DETAIL — car_01J9X9C7/);
    assert.match(result.stdout, /Generation & Rendering/);
    assert.match(result.stdout, /Approval/);
    assert.match(result.stdout, /Export/);
    assert.match(result.stdout, /Publishing/);
    assert.match(result.stdout, /Metrics/);
    assert.match(result.stdout, /Google Drive/); // the documented publishing gap note
  });
});

test("job <carouselId> fails with CarouselNotFoundError, not a stack trace, for an unknown carousel", () => {
  withTempDirs(({ carouselDir, metricsDir }) => {
    const result = runCli("job", "car_doesnotexist0000", carouselDir, metricsDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CarouselNotFoundError/);
    assert.doesNotMatch(result.stderr, /at file:\/\//);
  });
});

test("missing arguments print usage and exit non-zero, for every subcommand", () => {
  withTempDirs(({ carouselDir }) => {
    for (const args of [["dashboard"], ["dashboard", carouselDir], ["health"], ["jobs"], ["activity"], ["job"], ["job", "car_x"]]) {
      const result = runCli(...args);
      assert.notEqual(result.status, 0, `expected non-zero exit for args: ${JSON.stringify(args)}`);
      assert.match(result.stderr, /Usage:/);
    }
  });
});

test("an unknown subcommand prints usage and exits non-zero", () => {
  withTempDirs(({ carouselDir, metricsDir }) => {
    const result = runCli("not-a-real-command", carouselDir, metricsDir);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Usage:/);
  });
});

// --- read-only guarantees at the CLI level ----------------------------------

test("running every subcommand never modifies the carousel or metrics store directories on disk", () => {
  withTempDirs(({ carouselDir, metricsDir }) => {
    runCarouselCli("save", FIXTURE_PATH, carouselDir);
    const beforeFiles = readdirSync(carouselDir).sort();
    const beforeContent = readFileSync(path.join(carouselDir, beforeFiles[0]), "utf-8");

    runCli("dashboard", carouselDir, metricsDir);
    runCli("health", carouselDir, metricsDir);
    runCli("jobs", carouselDir, metricsDir);
    runCli("activity", carouselDir, metricsDir);
    runCli("job", "car_01J9X9C7", carouselDir, metricsDir);

    const afterFiles = readdirSync(carouselDir).sort();
    const afterContent = readFileSync(path.join(carouselDir, afterFiles[0]), "utf-8");

    assert.deepEqual(afterFiles, beforeFiles, "no files were created or removed by any Control Centre subcommand");
    assert.equal(afterContent, beforeContent, "the stored carousel's bytes are unchanged");
    assert.equal(existsSync(metricsDir), false, "metrics store directory was never created since it was never written to");
  });
});
