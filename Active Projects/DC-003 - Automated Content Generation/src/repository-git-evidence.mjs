// DC-003-I029.2 — Repository Git Evidence: small, shared, dependency-free
// git state reader used independently by BOTH the real Claude Code
// Delivery Runner Adapter (to fill its own Structured Runner Result
// repository.* fields) and automated-delivery-office-service.mjs (to
// independently re-verify that runner result before any of it is trusted
// — see the service's own header comment on why it never accepts a
// runner's own self-reported repository state as final). Every function
// here shells out to a real local `git` binary via an injectable
// `runGit` — no network, no GitHub API, no shell interpolation (execFileSync
// with an argv array, never a shell string).

import { execFileSync } from "node:child_process";

export function defaultRunGit(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

/** Current commit, branch, and clean/dirty working tree — one snapshot. */
export function readGitState(repositoryPath, runGit = defaultRunGit) {
  const commit = runGit(["rev-parse", "HEAD"], repositoryPath).trim();
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"], repositoryPath).trim();
  const statusOutput = runGit(["status", "--porcelain"], repositoryPath).trim();
  return { commit, branch, workingTreeClean: statusOutput === "" };
}

/** The remote-tracking branch's own commit, or null when none is configured — never throws. */
export function readUpstreamCommit(repositoryPath, runGit = defaultRunGit) {
  try {
    return runGit(["rev-parse", "@{u}"], repositoryPath).trim();
  } catch {
    return null;
  }
}

/**
 * Files created/modified between two real commits, purely from `git diff
 * --name-status` — never from a runner's own self-report. Deletions are
 * deliberately not represented here (engineering-delivery-report.schema.json
 * has no files_deleted field).
 */
export function computeChangedFiles(repositoryPath, fromCommit, toCommit, runGit = defaultRunGit) {
  if (!fromCommit || !toCommit || fromCommit === toCommit) {
    return { filesCreated: [], filesModified: [] };
  }
  const output = runGit(["diff", "--name-status", fromCommit, toCommit], repositoryPath).trim();
  if (output === "") return { filesCreated: [], filesModified: [] };

  const filesCreated = [];
  const filesModified = [];
  for (const line of output.split("\n")) {
    const [statusCode, ...pathParts] = line.split("\t");
    const filePath = pathParts[pathParts.length - 1];
    if (!filePath) continue;
    if (statusCode.startsWith("A")) filesCreated.push(filePath);
    else if (statusCode.startsWith("M") || statusCode.startsWith("R")) filesModified.push(filePath);
  }
  return { filesCreated, filesModified };
}
