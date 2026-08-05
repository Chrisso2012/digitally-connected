// Unit tests for repository-git-evidence.mjs (DC-003-I029.2). Every test
// injects a fake `runGit` — no real `git` binary is required (this
// project's own Docker test image has none installed).

import test from "node:test";
import assert from "node:assert/strict";
import { readGitState, readUpstreamCommit, computeChangedFiles } from "../../src/repository-git-evidence.mjs";

function fakeRunGit(responses) {
  const calls = [];
  const fn = (args) => {
    calls.push(args);
    const key = args.join(" ");
    if (key in responses) {
      const value = responses[key];
      if (value instanceof Error) throw value;
      return value;
    }
    throw new Error(`unexpected git invocation: ${key}`);
  };
  fn.calls = calls;
  return fn;
}

// --- readGitState --------------------------------------------------------

test("readGitState(): reports a clean tree when `git status --porcelain` is empty", () => {
  const runGit = fakeRunGit({
    "rev-parse HEAD": "abc1234\n",
    "rev-parse --abbrev-ref HEAD": "main\n",
    "status --porcelain": "",
  });
  const state = readGitState("/repo", runGit);
  assert.deepEqual(state, { commit: "abc1234", branch: "main", workingTreeClean: true });
});

test("readGitState(): reports a dirty tree for any non-empty status output", () => {
  const runGit = fakeRunGit({
    "rev-parse HEAD": "abc1234",
    "rev-parse --abbrev-ref HEAD": "main",
    "status --porcelain": " M src/foo.mjs\n?? new-file.txt\n",
  });
  assert.equal(readGitState("/repo", runGit).workingTreeClean, false);
});

test("readGitState(): trims trailing whitespace/newlines from commit and branch", () => {
  const runGit = fakeRunGit({
    "rev-parse HEAD": "abc1234\n\n",
    "rev-parse --abbrev-ref HEAD": "  feature-x  \n",
    "status --porcelain": "",
  });
  const state = readGitState("/repo", runGit);
  assert.equal(state.commit, "abc1234");
  assert.equal(state.branch, "feature-x");
});

// --- readUpstreamCommit ---------------------------------------------------

test("readUpstreamCommit(): returns the trimmed upstream commit when one exists", () => {
  const runGit = fakeRunGit({ "rev-parse @{u}": "def5678\n" });
  assert.equal(readUpstreamCommit("/repo", runGit), "def5678");
});

test("readUpstreamCommit(): returns null, never throws, when no upstream is configured", () => {
  const runGit = fakeRunGit({ "rev-parse @{u}": new Error("fatal: no upstream configured") });
  assert.equal(readUpstreamCommit("/repo", runGit), null);
});

// --- computeChangedFiles ------------------------------------------------

test("computeChangedFiles(): returns empty arrays when fromCommit equals toCommit — no diff call made", () => {
  const runGit = fakeRunGit({});
  const result = computeChangedFiles("/repo", "abc1234", "abc1234", runGit);
  assert.deepEqual(result, { filesCreated: [], filesModified: [] });
  assert.equal(runGit.calls.length, 0);
});

test("computeChangedFiles(): returns empty arrays when either commit is null — no diff call made", () => {
  const runGit = fakeRunGit({});
  assert.deepEqual(computeChangedFiles("/repo", null, "abc1234", runGit), { filesCreated: [], filesModified: [] });
  assert.deepEqual(computeChangedFiles("/repo", "abc1234", null, runGit), { filesCreated: [], filesModified: [] });
});

test("computeChangedFiles(): classifies A as created, M and R (rename) as modified, ignores D", () => {
  const runGit = fakeRunGit({
    "diff --name-status abc1234 def5678": ["A\tsrc/new.mjs", "M\tREADME.md", "D\tsrc/old.mjs", "R100\tsrc/old-name.mjs\tsrc/new-name.mjs"].join("\n"),
  });
  const result = computeChangedFiles("/repo", "abc1234", "def5678", runGit);
  assert.deepEqual(result.filesCreated, ["src/new.mjs"]);
  assert.deepEqual(result.filesModified, ["README.md", "src/new-name.mjs"]);
});

test("computeChangedFiles(): returns empty arrays when the diff output itself is empty", () => {
  const runGit = fakeRunGit({ "diff --name-status abc1234 def5678": "" });
  assert.deepEqual(computeChangedFiles("/repo", "abc1234", "def5678", runGit), { filesCreated: [], filesModified: [] });
});
