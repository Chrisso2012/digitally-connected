# DC-005 — Operations Controller

## OC-001: Manual Operations Controller

Status: **workflow authored, not yet imported or executed.** The original repository-visibility blocker (container mounted into an unrelated, actively-developed DC-004 branch) is now resolved — a dedicated, permanently-`main` runtime clone exists and is mounted read-only into `n8n-test`. A second, previously-undiscovered blocker was found while verifying that fix: see "Current Blockers" below before attempting a live run.

---

## Purpose

OC-001 is the first Operations Controller workflow. It lets the CEO manually
trigger one approved DC-003 Engineering Work Order and reacts to the result
DC-003 itself already decided:

```
Engineering Work Order
  → Delivery Office Runner        (DC-003-I029.2)
  → Engineering Delivery Report
  → Automated Strategy Review     (DC-003-I029.3, corrected by I029.3.1)
  → Final structured outcome      (DC-003-I029.4, machine-readable since I029.4.1)
```

n8n is a thin orchestration layer only. It starts DC-003 and reacts to
DC-003's own result — it never decides whether engineering work passed. Every
eligibility check, lock, Git verification, Delivery Report, Strategy Review,
authority gate, correction decision, CEO-escalation decision, and persisted
record is owned entirely by DC-003. See DC-003's own README ("End-to-End
Operations Bridge", "Automated Strategy Review", "Delivery Status Authority
Gate") for how those decisions are actually made — this document does not
repeat that logic, only how n8n invokes and presents it.

---

## Architecture

One Execute Command node calls the existing
`operations-bridge.mjs run ... --json` CLI exactly once. That single call
already performs the entire Delivery Office → Strategy Review chain
synchronously (DC-003-I029.4 collapsed what was originally a multi-stage
diagram into one blocking call) — n8n does not orchestrate two separate DC-003
systems, poll for completion, or wait between stages. Its job is: trigger,
invoke once, parse one JSON response, route on the already-decided `decision`
field, present the outcome.

```
Manual Trigger
  → Build Work Order Input          (Set — operator edits work_order_id)
  → Validate Work Order Input       (IF — regex gate, wo_[A-Za-z0-9]+)
      ├─ invalid → Prepare Input Error Output                    [terminal]
      └─ valid   → Run Operations Bridge (Execute Command, --json)
                     → Parse Operations Bridge Result (Code)
                       → Route Outcome (Switch, on routeKey)
                           ├─ approved             → Prepare Approved Output
                           ├─ correction_required   → Prepare Correction Required Output
                           ├─ ceo_decision_required → Prepare CEO Decision Required Output
                           ├─ rejected              → Prepare Rejected Output
                           └─ (fallback)            → Prepare Technical Failure Output
```

13 nodes total (12 functional + 1 sticky note). Exactly one trigger, exactly
one Execute Command invocation, no webhook, no schedule, no polling, no
automatic queueing or retry.

---

## Node-by-node

1. **Manual Trigger** (`n8n-nodes-base.manualTrigger`) — the CEO explicitly
   starts each run. No other trigger exists anywhere in this workflow.
2. **Build Work Order Input** (`n8n-nodes-base.set`, raw mode) — the one
   operator-editable field, `work_order_id` (e.g. `wo_...`). Store
   directories, the repository path, branch, and policy flags are deployment
   configuration baked into the Execute Command node below, never exposed
   here as routine operator input.
3. **Validate Work Order Input** (`n8n-nodes-base.if`) — regex-checks
   `work_order_id` against `^wo_[A-Za-z0-9]+$` (the same pattern
   `engineering-work-order.mjs` itself enforces). On failure, DC-003 is never
   invoked; the run terminates at **Prepare Input Error Output** with a plain
   explanation and no side effects.
4. **Run Operations Bridge** (`n8n-nodes-base.executeCommand`) — the single
   DC-003 invocation. See "Exact command" below. `continueOnFail`/`onError`
   are set so a non-zero exit still reaches the parse step — see "Command
   output and exit handling."
5. **Parse Operations Bridge Result** (`n8n-nodes-base.code`, one JS Code
   node) — parses stdout as JSON, computes a single `routeKey`, never invents
   business meaning beyond what DC-003 returned. See "JSON contract" below.
6. **Route Outcome** (`n8n-nodes-base.switch`, rules mode) — routes strictly
   on `routeKey`: `approved` / `correction_required` / `ceo_decision_required`
   / `rejected` each get their own explicit rule; anything else (including
   `technical_failure`) falls through to the switch's own `extra` output,
   which is wired to **Prepare Technical Failure Output**. No DC-003 authority
   logic is reimplemented in a Switch expression — the rule is a literal
   string match against a field DC-003 already decided.
7–11. **Prepare {Approved, Correction Required, CEO Decision Required,
   Rejected, Technical Failure} Output** (five `n8n-nodes-base.set` nodes,
   raw mode) — one formatter per outcome; see "Outcome fields" below for
   exactly what each surfaces.

---

## Exact Operations Bridge command

```sh
RUN_DIR=/tmp/dc005-oc001-run-{{ $now.toFormat('yyyyLLdd-HHmmssSSS') }}
mkdir -p "$RUN_DIR"
cd /data/dc003-repo
node tests/validation/operations-bridge.mjs run \
  "{{ $json.work_order_id }}" \
  /home/node/.n8n/dc003/engineering/work-orders \
  /home/node/.n8n/dc003/engineering/delivery-reports \
  /home/node/.n8n/dc003/engineering/strategy-reviews \
  /home/node/.n8n/dc003/engineering/bridge \
  /data/dc003-repo \
  --repo=/data/dc003-repo \
  --delivery-lock=/home/node/.n8n/dc003/engineering/locks/delivery \
  --review-lock=/home/node/.n8n/dc003/engineering/locks/review \
  --drop=/home/node/.n8n/dc003/engineering/drop \
  --export=/home/node/.n8n/dc003/engineering/export \
  --json > "$RUN_DIR/stdout.json" 2> "$RUN_DIR/stderr.log"
DC005_EXIT_CODE=$?
cat "$RUN_DIR/stdout.json"
echo "DC005_EXIT_CODE=$DC005_EXIT_CODE"
cat "$RUN_DIR/stderr.log" 1>&2
```

This is the real, current `operations-bridge.mjs run` positional/flag
contract, taken directly from the CLI's own source
(`tests/validation/operations-bridge.mjs`, DC-003-I029.4/I029.4.1) — not
guessed. No `--live-runner`, no `--live-review`, no other flag exists in this
command anywhere: mock mode is the only mode this workflow can reach, because
the flag that would change that literally isn't present, not because a
boolean is set to `false` somewhere.

No second CLI call is made for any reason — `--json`'s own enriched result
(DC-003-I029.4.1) already carries everything the "Prepare ... Output" nodes
need.

---

## Command output and exit handling

`operations-bridge.mjs run --json` always prints **exactly one line of
JSON** to stdout, whether the run's own `decision` was `approved` or not —
and separately, if a Work Order is ineligible (wrong status, already
delivered, already reviewed, lock held), it throws before ever producing a
decision, and `--json` mode still prints one line, but a different shape:
`{"success":false,"error":{"code":"...","message":"..."}}`. The CLI's own
process exit code is `0` for any completed run (any decision) and `1` for a
thrown eligibility/lock/configuration error — but **exit code alone cannot
distinguish these two JSON shapes**, so this workflow does not rely on it as
the primary signal. Instead:

- The Execute Command node's `continueOnFail`/`onError` settings let a
  non-zero exit still reach the Parse step (a hard node failure would
  otherwise stop the workflow before the JSON body — which may well be a
  perfectly valid, useful result — is ever read).
- The exit code is still captured explicitly (`$?` into `DC005_EXIT_CODE`,
  echoed on its own delimited line after the JSON body) and carried through
  as evidence, never silently discarded by an unconditional `|| true`.
- The Parse node decides `routeKey` from the **JSON body's own shape**, not
  the exit code: no parseable JSON at all → `technical_failure`; parseable
  JSON with `success: false` and no `decision` (the thrown-error shape) →
  `technical_failure`; parseable JSON with a real `decision` value → that
  value, verbatim, becomes the route key.

This is exactly the required distinction: **a `correction_required` or
`ceo_decision_required` result is a successfully completed workflow run, not
an n8n or infrastructure failure** — it only reaches `technical_failure` when
DC-003 never got far enough to produce a decision at all.

---

## JSON contract

The Parse node's own output shape (after spreading whatever
`operations-bridge.mjs --json` returned):

```json
{
  "routeKey": "correction_required",
  "validJsonResultProduced": true,
  "exitCode": 0,
  "parseError": null,
  "stderrExcerpt": "",
  "workOrderId": "wo_...",
  "success": true,
  "workOrderTitle": "...",
  "deliveryReportId": "dr_...",
  "deliveryStatus": "failed",
  "deliveryCommit": null,
  "deliveryTimestamp": "2026-...",
  "strategyReviewId": "esr_...",
  "decision": "correction_required",
  "reviewedAt": "2026-...",
  "summary": "...",
  "risks": ["..."],
  "correction": { "failed_criteria": [1], "required_outcome": "...", "prohibited_scope_expansion": "...", "verification_required": "..." },
  "ceoEscalation": null,
  "transportRecordIds": { "delivery": "bt_...", "review": "bt_..." }
}
```

Every field beyond `routeKey`/`validJsonResultProduced`/`exitCode`/
`parseError`/`stderrExcerpt` is a direct passthrough of what
`operations-bridge.mjs --json` returned — see DC-003's own README, "Rich
Orchestration Result (DC-003-I029.4.1)", for exactly where each of those
fields is sourced from inside DC-003. Nothing here adds business meaning
DC-003 didn't already compute.

---

## Outcome fields (what each "Prepare ... Output" node surfaces)

| Outcome | Fields surfaced |
|---|---|
| **Approved** | `workOrderId`, `workOrderTitle`, `deliveryReportId`, `deliveryCommit`, `strategyReviewId`, `summary`, `status: "completed"` |
| **Correction Required** | `workOrderId`, `deliveryStatus`, `strategyReviewId`, `summary`, `requiredOutcome`, `verificationRequired`, `risks` |
| **CEO Decision Required** | `workOrderId`, `summary`, `decisionRequired`, `reason`, `safeOptions`, `defaultSafeAction: "stop"`, `risks` |
| **Rejected** | `workOrderId`, `summary`, `risks`, `safeAction: "stop"` |
| **Technical Failure** | `workOrderId`, `safeErrorSummary`, `exitCode`, `validJsonResultProduced`, `suggestedSafeAction` |
| **Input Error** (pre-invocation) | `work_order_id`, `safeErrorSummary`, `suggestedSafeAction` |

None of these ever include: credentials, raw prompts, raw transcripts,
complete stdout/stderr, environment dumps, stack traces, or hidden
reasoning. `stderrExcerpt` (in the Parse node's own intermediate output,
capped at 1000 characters) is the only raw command evidence retained at
all, and it is not surfaced in any of the six "Prepare ... Output" nodes
above — only `safeErrorSummary` (a short, already-safe string) is.

---

## Mock-only execution mode

The only mode this workflow can run in: DC-003's own default mock Delivery
Office runner (`mock-delivery-office-runner`) and default mock Strategy
Review adapter (`mock-strategy-review-adapter`). No Claude Code execution.
No OpenAI request. No production-provider request.

**Live mode does not exist as a toggle in this workflow at all** —
`--live-runner`/`--live-review` are simply never in the command string. A
future live-verification milestone would need to reintroduce them
deliberately, under fresh Strategy Office and CEO approval, and per
DC-003-I029.2/I029.3's own established one-shot safety ceilings
(`resolveLiveMaxAttempts()`/`MAX_OPENAI_REQUESTS = 1`) — this workflow
neither includes nor bypasses those; they simply aren't reachable from here.

**Required flags/controls for a later live run, reported now as requested,
not implemented:**
- `--live-runner` on the Execute Command node's own command string — real
  Claude Code execution via `npx --yes @anthropic-ai/claude-code` (per
  `delivery-office-runner-config.mjs`'s own default) or a configured
  `CLAUDE_CODE_COMMAND`.
- `--live-review` — real OpenAI Strategy Review, requires `OPENAI_API_KEY`
  to be present in the container's own environment (confirmed absent today
  — see "Investigation findings" below).
- Both remain independently gated exactly as DC-003's own standalone CLIs
  already gate them — this workflow would need to add them explicitly, not
  infer them from any existing setting.
- A real live run additionally requires: the repository mount to be
  writable (currently read-only, correct for mock mode, insufficient for a
  real Claude Code commit), fresh Strategy Office + CEO approval per
  DC-003's own established ceremony, and the Initial Real-Runner
  Verification Gate / Initial Live Review Verification Gate DC-003's own
  README already describes as still pending.

---

## Investigation findings (as originally delivered — items 2–6 superseded, see "Current Blockers" above for the post-remount state)

1. **n8n MCP connection:** unavailable (disconnected) at the time of this
   milestone. No workflow could be created or inspected through it.
2. **`n8n-test` container:** running (`n8nio/n8n:latest`), confirmed via
   `docker ps`/`docker inspect` (read-only inspection only — not recreated,
   not reconfigured).
3. **DC-003 repository mount:** `C:\Users\Evans\OneDrive\Documents\GitHub\digitally-connected\Active Projects\DC-003 - Automated Content Generation` → `/data/dc003-repo`, **read-only** (`ro`).
4. **Does that mount expose commit `4ca2429`? No.** The mounted checkout is
   currently on branch `dc-004/i001-industry-library-structure` at `2016f57`
   — an unrelated, actively-worked branch (its own HEAD had moved since
   earlier in this session, confirming live use). Commit `4ca2429` is not an
   ancestor of that HEAD, and `operations-bridge.mjs` does not exist in that
   checked-out tree at all. **This is the primary blocker** — not an n8n
   problem, a repository-visibility problem. See "Current Blockers" below.
5. **Read-only or writable:** read-only, confirmed via `docker inspect`
   (`mode=ro`, `rw=false`). Correct and sufficient for mock-mode OC-001 (mock
   adapters never write to the repository); insufficient for any future
   `--live-runner` work, which would need real commits.
6. **Can `npm run operations-bridge` execute from inside the container
   today?** No — not because of the runtime (node v24.18.0, npm 11.18.0, git
   2.55.0 are all present and confirmed working inside `n8n-test`), but
   because the mounted repository tree doesn't contain the file at all (see
   #4).
7. **Is Claude Code available from n8n's own execution environment?** No —
   `claude` is not on `PATH` inside the container, and no cached copy of
   `@anthropic-ai/claude-code` was found; a real `--live-runner` invocation
   would rely on `npx --yes @anthropic-ai/claude-code` fetching it fresh at
   run time. `LLM_API_KEY` (Anthropic, used by DC-003's own carousel
   generation path) is present in the container's environment; `OPENAI_API_KEY`
   is not. Neither is exercised by OC-001 (mock-only).
8. **Can I029.2's live-runner requirements operate from n8n's Execute
   Command node?** Structurally yes (the container has node/npm/npx/git),
   but whether headless `npx`-launched Claude Code can actually authenticate
   in this container remains the same open, pre-existing question DC-003's
   own README already documents (its own "Initial Real-Runner Verification
   Gate" — host-side interactive sessions use Desktop-managed OAuth, not a
   bare API key; this was never verified for a headless subprocess before
   OC-001 and isn't verified now either, since OC-001 is mock-only).
9–10. **Persistent directories:** `/home/node/.n8n/dc003/` already exists
   inside the durable `n8n_data` volume, with prior milestones' own
   subdirectories (`finished-carousels/`, `publisher-results/`,
   `social-publisher-results/`, `production-metrics/`, `exports/`) —
   confirmed via `docker exec ... find`. **No `engineering/` subdirectory
   exists yet** for Work Orders/Delivery Reports/Strategy
   Reviews/Bridge/locks/drop/export — this workflow does not pre-create it;
   every DC-003 store adapter and the delivery/review services themselves
   already `mkdir -p` their own target directory on first write (the same
   behavior every prior DC-003 milestone relies on), so the first real OC-001
   run creates the whole `engineering/` tree automatically.
11. **Existing workflow/export convention:** DC-003's own `workflows/`
   directory (`dc003-i013-production-workflow.json`,
   `dc003-i017-content-request-workflow.json`) was inspected directly and
   its exact JSON shape (top-level `id`/`name`/`description`/`active`/
   `nodes`/`connections`/`settings`/`pinData`/`tags`, per-node
   `id`/`name`/`type`/`typeVersion`/`position`/`parameters`, the
   `RUN_DIR`/`cd /data/dc003-repo`/`--json`/`|| true`-then-`cat` Execute
   Command shell pattern) was reused for OC-001's own export — this
   milestone's own JSON is DC-005's, not DC-003's, so it lives under this
   project's own `workflows/` folder instead, per this milestone's own scope.
12. **Existing notification credential/channel:** not enumerated — no n8n
   MCP access and no n8n API credentials available to query the credential
   store safely. Out of scope for OC-001 regardless (see "Current
   limitation" below) — this is a future CEO Notifications milestone's own
   question, not something this delivery needed an answer to.

---

## Current Blockers

**Blocker 1 — RESOLVED.** The mounted DC-003 repository did not contain
commit `4ca2429`, because the container's bind mount targeted the original
shared checkout, which was on an unrelated, actively-worked DC-004 branch.
Per explicit Strategy Office direction, that checkout is now treated as
protected infrastructure — never to be branch-switched, reset, remounted,
or used as a runtime source for DC-003 or DC-005. Instead, a **dedicated
runtime repository** was created:
`C:\Users\Evans\OneDrive\Documents\GitHub\digitally-connected-runtime` — a
genuinely independent `git clone` of `origin` (not a `git worktree add`
linked worktree; see Blocker 3 for exactly why that distinction mattered),
pinned to `main` only, intended to remain permanently on `main` and never
receive direct commits — it should only ever be fast-forwarded once new
work is merged into `main` elsewhere. `n8n-test` was recreated (image,
env vars, ports, the `n8n_data` volume, the `/data/production-assets`
mount, `NODES_EXCLUDE`, and every credential all preserved exactly — only
the DC-003 repository bind-mount **source** changed) to mount
`/data/dc003-repo` read-only from this new runtime clone. Confirmed after
recreation: container starts cleanly, "Campaign Intelligence Engine v1.0"
reactivated automatically (workflows/credentials intact — same untouched
`n8n_data` volume), `/data/dc003-repo` is genuinely read-only (a write
attempt is rejected by the filesystem), the mounted `operations-bridge.mjs`
is checksum-identical to the runtime clone's own `main`-at-`4ca2429` copy
on the host, and the original DC-004 checkout was independently confirmed
unchanged (branch, HEAD, working tree) both before and after.

**Blocker 3 — NEW, found while verifying Blocker 1's own fix: `git` is not
reachable from inside the container at all, for any DC-003 mount, and
never has been.** The bind mount only ever covers the project subfolder
(`.../Active Projects/DC-003 - Automated Content Generation`), never the
repository root — so `.git` (which lives at the root) has never been part
of what `n8n-test` can see. `git` refuses to search upward past a mount
boundary by default (`fatal: not a git repository ... Stopping at
filesystem boundary`), so any DC-003 CLI that calls real git (I029.2's own
`readGitState()`, used by `operations-bridge.mjs`, `delivery-office-runner.mjs`,
and `strategy-review-agent.mjs` — **not** I013/I017's own workflows, which
never touch git) crashes with an uncaught exception the moment it tries.
Confirmed directly: seeding a real, eligible Work Order and running
`operations-bridge.mjs run ... --json` against it inside the recreated
container produces no JSON at all — a raw `git rev-parse HEAD` stack trace
on stderr. This is **not a regression from the Blocker 1 fix** — the exact
same gap existed identically under the OLD mount; it was simply never
discovered before, because no git-dependent DC-003 CLI had ever actually
been run through this container prior to this verification pass (every
I029.2–I029.4.1 smoke test in this project's own history ran against a
real git repository on the host directly, never through `n8n-test`).

**Not fixed here, deliberately** — the explicit authorization for this
session's container recreation was "change only the DC-003 repository bind
mount... preserve everything else exactly," and the correct fix (adding a
**second**, new bind mount exposing the runtime clone's repository root —
e.g. `/data/dc003-repo-root:ro` — so a git-dependent CLI can be pointed at
`/data/dc003-repo-root/Active Projects/DC-003 - Automated Content
Generation` instead of the existing subfolder-only `/data/dc003-repo`)
is a second, additional mount, not a change to the one already authorized.
The existing `/data/dc003-repo` mount must stay exactly as-is regardless —
I013's and I017's own existing workflows hardcode it as their project-folder
path and never needed git, so they are unaffected either way. This
workflow's own Execute Command node (see "Exact Operations Bridge command"
above) will need updating to the new root-mounted path once that second
mount is approved and added.

**Blocker 2 — n8n MCP is disconnected.** This workflow could not be created,
imported, or executed through it. The workflow JSON in this folder was
hand-authored against the real, current `operations-bridge.mjs` CLI contract
and DC-003's own established real-export conventions (I013/I017), and
validated statically (see "Static verification" below) — but it has not
been imported into the live `n8n-test` instance, has no real n8n-assigned
workflow ID yet (`id: null` in the export, intentionally, so it is never
mistaken for an already-imported workflow), and has not been executed.

**Manual import steps, once Blocker 3 is resolved:** open the `n8n-test`
UI at `http://localhost:5678`, use "Import from File", select
`workflows/dc005-oc001-manual-operations-controller.json` from this project
folder, confirm the imported workflow's node graph matches this document,
edit `work_order_id` in the "Build Work Order Input" node to a real,
`ready`/approved Engineering Work Order, and execute manually. Leave the
workflow **inactive** after import (manual-trigger workflows do not require
activation to run via the editor's own Execute button — same convention
DC-003's own I013/I017 workflows already use).

---

## Static verification performed

Confirmed directly against the exported JSON file (Node.js, not the n8n
runtime, since MCP/live access was unavailable):

- Valid JSON, matches the real n8n workflow-export shape.
- Exactly one node of a trigger type (`Manual Trigger`).
- Exactly one `n8n-nodes-base.executeCommand` node (`Run Operations Bridge`).
- Zero webhook/schedule/poll-type nodes.
- Every connection's source and target resolves to a real node name — no
  dangling references.
- All 12 non-sticky nodes are reachable from `Manual Trigger` by following
  `connections` — no orphaned node.
- No credential fields, embedded secrets, or credential exports present
  anywhere in the file.
- No retry/`retryOnFail` configuration on any node.
- `active: false`.

**Not performed** (blocked by the two items above, honestly not claimed):
live import, live execution, mock end-to-end verification against the real
`n8n-test` instance, duplicate-run verification, Control Centre
cross-check of an OC-001-produced record, or any live confirmation that
zero Claude/OpenAI/provider requests occurred during an actual run (no run
occurred). DC-003's own equivalent guarantees (mock-by-default, no live
call without an explicit flag this workflow never sends) were verified at
the DC-003 layer during I029.4/I029.4.1's own delivery, and this workflow
sends the exact same mock-only command — but that is a structural argument,
not a fresh live observation of *this* workflow.

---

## Duplicate-run and idempotency handling

OC-001 introduces no new protection of its own — it relies entirely on
DC-003's own existing rules:

- A second `run` against the same Work Order after a completed delivery
  fails DC-003's own `DuplicateDeliveryError` check.
- A second review attempt against the same Delivery Report fails DC-003's
  own `DeliveryReportNotEligibleForReviewError` check (a Strategy Review
  already exists).
- A concurrent run against a Work Order currently mid-execution fails
  DC-003's own `ExecutionLockAlreadyHeldError`/lock checks.

Every one of these arrives at the Parse node as valid JSON with
`success: false` and no `decision` — routed to **Technical Failure**,
surfaced honestly (not silently retried, not silently swallowed). OC-001
never clears a lock, deletes a Delivery Report or Strategy Review, forces a
rerun, or alters Work Order status.

---

## Security considerations

- No credentials are embedded in the workflow JSON — none exist in it to
  begin with (the CLI reads none for mock mode).
- The Execute Command node's own shell script never echoes an environment
  variable or credential value.
- `stderrExcerpt` is capped at 1000 characters in the Parse node's own
  intermediate output and is never surfaced in any of the six CEO-facing
  "Prepare ... Output" nodes — only a short `safeErrorSummary` is.
- The repository mount this workflow depends on is read-only; OC-001 cannot
  write to, or otherwise modify, the DC-003 repository itself.
- Duplicate/lock protection is DC-003's own, not reimplemented here (see
  above) — reduces the risk of two OC-001 runs racing each other.

---

## Current limitation: CEO notifications

For OC-001, the CEO outcome is visible directly in the n8n execution data
(the final "Prepare ... Output" node's own item) once a run completes —
there is no email/Slack/Teams delivery yet. This is a deliberate scope
boundary, not an oversight: the brief for this milestone explicitly
excludes adding a notification channel, and no existing DC-003 module
handles notification (confirmed during the earlier DC-005 OC-001
architecture investigation — notification has never been a DC-003
responsibility, consistent with the DC-005 Project Brief's own
architecture). A dedicated CEO Notifications milestone may follow later,
once a channel is explicitly approved.

---

## Future path

- **CEO Notifications** — a real delivery channel (Slack/email/Teams),
  explicitly approved and configured, replacing "visible in n8n execution
  output only."
- **Queueing / multiple Work Orders** — Phase 2 of the DC-005 Project Brief.
- **Scheduled execution** — Phase 2/3, explicitly out of scope here.
- **Live execution** — a separate, explicitly-approved milestone, using the
  exact flags and safety controls documented above, once the Initial
  Real-Runner/Live Review Verification Gates DC-003's own README describes
  are actually exercised.
- **Resolving Blocker 1** — a Strategy Office decision on how the
  `n8n-test` container should reach `main`-or-later without disrupting
  DC-004's own active work.
