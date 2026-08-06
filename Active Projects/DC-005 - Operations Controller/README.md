# DC-005 — Operations Controller

## OC-001: Manual Operations Controller

Status: **imported into live n8n by the CEO; live node configuration inspected read-only via n8n's own database and found to contain two real, silently-dropped configuration bugs, both traced to this assistant's own earlier hand-authoring and now fixed in the repository JSON — but not yet in the live workflow, since no safe write path to it exists.** The DC-003 side of the chain remains fully proven via `docker exec` (see "End-to-end verification"), but the first actual manual execution *through n8n itself* has deliberately not happened yet, per this task's own "verify before executing" gate. See "Live import verification (2026-08-06)" for the full finding and exactly what is and isn't affected.

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
DC003_DIR="/data/dc003-repo-root/Active Projects/DC-003 - Automated Content Generation"
RUN_DIR=/tmp/dc005-oc001-run-{{ $now.toFormat('yyyyLLdd-HHmmssSSS') }}
mkdir -p "$RUN_DIR"
cd "$DC003_DIR"
node tests/validation/operations-bridge.mjs run \
  "{{ $json.work_order_id }}" \
  /home/node/.n8n/dc003/engineering/work-orders \
  /home/node/.n8n/dc003/engineering/delivery-reports \
  /home/node/.n8n/dc003/engineering/strategy-reviews \
  /home/node/.n8n/dc003/engineering/bridge \
  "$DC003_DIR" \
  --repo="$DC003_DIR" \
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

**Updated 2026-08-06** to use `/data/dc003-repo-root` (a repo-root mount)
instead of the original `/data/dc003-repo` (a subfolder-only mount) — see
"Current Blockers" for why the subfolder-only mount can never support this
command (it has no working `.git`), and "End-to-end verification" below for
proof this exact command now works. The original `/data/dc003-repo` mount
still exists, unchanged, for I013/I017's own workflows, which never needed
git and are unaffected either way.

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

**Blocker 3 — RESOLVED.** `git` was not reachable from inside the container
for any DC-003 mount, and never had been (not a regression from the
Blocker 1 fix — the identical gap existed under the OLD mount too; it was
simply never discovered, because no git-dependent DC-003 CLI — anything
from I029.2 onward — had ever actually been run through this container
before this verification pass; I013/I017's own workflows never call git
at all, and every prior I029.2–I029.4.1 smoke test in this project's
history ran against the host directly). Root cause: the bind mount only
ever covered the project subfolder, never the repository root where
`.git` lives — `git` refuses to search upward past a Docker mount
boundary by default. **Fix, explicitly approved and applied:** a
**second**, additional read-only bind mount exposing the runtime clone's
full repository root — `digitally-connected-runtime` → `/data/dc003-repo-root:ro`
— alongside (not replacing) the original `/data/dc003-repo` subfolder
mount, which I013/I017 still use unchanged. Two further, smaller fixes
were needed to make that mount actually usable, both applied via
container-level git config passed as env vars (`GIT_CONFIG_COUNT`/
`GIT_CONFIG_KEY_N`/`GIT_CONFIG_VALUE_N` — no persisted config file needed,
survives any future recreation the same way `NODES_EXCLUDE`/`LLM_API_KEY`
already do): `safe.directory=/data/dc003-repo-root` (git's own "dubious
ownership" protection otherwise refuses to operate on a bind-mounted
directory at all) and `core.autocrlf=true` (matching the Windows host's
own global git setting — without it, every text file in the mount falsely
appeared 100% modified to the container's own git, since the on-disk CRLF
line endings didn't match what the container's default-`autocrlf=false`
git expected against the LF-stored blobs; this was pure line-ending noise,
never real content divergence). Ports, credentials, volumes, workflows,
permissions, and every other env var were preserved exactly across all
three recreations this fix required. See "End-to-end verification" below
for full proof.

**Blocker 2 — n8n MCP is disconnected.** This workflow could not be created,
imported, or executed through it. The workflow JSON in this folder is
authored against the real, current `operations-bridge.mjs` CLI contract
and DC-003's own established real-export conventions (I013/I017), and
validated both statically (see "Static verification" below) and, now,
by literally running the exact command it contains via `docker exec` (see
"End-to-end verification") — but the WORKFLOW ITSELF has still not been
imported into the live `n8n-test` instance, has no real n8n-assigned
workflow ID yet (`id: null` in the export, intentionally, so it is never
mistaken for an already-imported workflow), and has not been executed
through n8n's own UI or engine.

**Attempted again 2026-08-06 with a second route, also blocked, reported
honestly rather than worked around:** with n8n MCP still disconnected, the
n8n web UI (`http://localhost:5678`) was opened directly to check for a
genuine programmatic path in. It requires a password sign-in against an
existing owner account (not first-time setup — an owner account already
exists on this instance). No credentials for it exist in this session, and
even if they did, entering a password into any field is outside what this
assistant will do under any authorization — that boundary doesn't bend for
infrastructure convenience. This is a real, final stop condition, not a
workaround-and-continue situation.

**The smallest remaining action, and it belongs to the CEO, not to further
automation:** log into `http://localhost:5678` directly, use "Import from
File", select
`workflows/dc005-oc001-manual-operations-controller.json` from this project
folder (already fully updated and `docker exec`-proven working — see
"End-to-end verification" below), confirm the imported workflow's node
graph matches this document, edit `work_order_id` in the "Build Work Order
Input" node to a real `ready`/approved Engineering Work Order, and execute
manually. Leave the workflow **inactive** after import (manual-trigger
workflows do not require activation to run via the editor's own Execute
button — same convention DC-003's own I013/I017 workflows already use).
Alternatively, provide a valid n8n API token scoped for this purpose and
this can be revisited — though note the same credential-handling boundary
would still apply to how that token is used.

---

## Live import verification (2026-08-06) — Step 3, two real bugs found and fixed in the repository

**The CEO imported the workflow into the live `n8n-test` instance.** n8n
MCP remained disconnected and the web UI login wall (see above) still
applied, so live inspection used a third route: read-only access to
n8n's own SQLite database (`/home/node/.n8n/database.sqlite`) via
`docker exec` and Node's built-in `node:sqlite` module — pure OS-level
file access, nothing to do with n8n's own web-app authentication, so the
credential boundary above never applied to this. n8n was never paused or
restarted for this; the running instance's own storage was read directly.

**Import itself confirmed genuine and clean:**
- Workflow present: `id typVLZ7OssFsK76j`, `name "DC-005 OC-001 — Manual
  Operations Controller"`, `active: false`, `createdAt == updatedAt`
  (2026-08-06 12:13:45 — a fresh import, never re-saved since).
- Exactly one OC-001 workflow — no duplicate left behind.
- All 11 pre-existing workflows present and unchanged, including
  `"Campaign Intelligence Engine v1.0"` still the only active one and
  I013's/I017's own DC-003 workflows untouched.
- 13 nodes, matching the repository's own node count.
- Zero credentials attached to any node.
- No webhook/schedule node anywhere in the live definition.

**Two real, functionally significant bugs found — not cosmetic — both
traced to this assistant's own hand-authoring mistakes when n8n access
was unavailable, confirmed against n8n's own real, authoritative source
(not guessed a second time):**

1. **`executeOnce`/`continueOnFail`/`onError` were silently dropped from
   the "Run Operations Bridge" node on import**, because the repository
   JSON nested them inside `parameters` — n8n's real `INode` TypeScript
   interface (confirmed by reading
   `n8n-workflow/dist/esm/interfaces.d.ts` directly inside the container)
   defines all three as **top-level node properties**, siblings of
   `parameters`, not parameters themselves. Import silently discards
   unrecognized parameter keys rather than erroring, so this failed
   silently.
2. **`fallbackOutput` was silently dropped from the "Route Outcome"
   (Switch) node**, because the repository JSON placed it as a top-level
   `parameters.fallbackOutput` — the real Switch v3.2 Zod schema
   (confirmed by reading the node's own generated
   `mode_rules.schema.js` directly inside the container) requires it
   nested at `parameters.options.fallbackOutput`.

**Confirmed cosmetic, no fix needed (also checked against real schemas,
not assumed):** `mode: "rules"` on the Switch node — the same schema
shows `mode: z.literal('rules').default('rules')`, so omitting it
resolves to the identical value. `language: "javaScript"` on the Code
node — the real Code v2 schema shows it `.optional()` with
`jsCode`'s own default already assuming `language: "javaScript"`. The
`"options": {}` n8n added to several Set nodes — a normal, harmless
default-filling behavior common to every n8n node type.

**Impact assessed precisely, not assumed uniform:** neither dropped
property affects the **Approved / Correction Required / CEO Decision
Required / Rejected** paths — all four are reached only when
`operations-bridge.mjs run` exits `0` (a successful decision, whatever it
is), which n8n's Execute Command node never treats as a node failure, so
`continueOnFail`/`onError` are irrelevant there, and Switch routing for
these four is governed by rule array position, not by the dropped
`fallbackOutput`. **The Technical Failure and duplicate-run paths are the
ones actually affected**: both require `operations-bridge.mjs` to exit
non-zero (a thrown eligibility/lock error) or route to the Switch's
unmatched/"extra" output — without `continueOnFail`/`onError`, a non-zero
exit would hard-stop the n8n execution entirely (visible as a failed
execution, not a silently wrong one — safe, but not the intended clean
routed outcome); without `options.fallbackOutput`, an unmatched
`routeKey` may not reach a 5th output at all.

**Fixed in the repository JSON** (this file's own workflow export,
committed alongside this README update) — moved both properties to their
correct, schema-verified locations. **The LIVE n8n workflow still needs
re-import for this fix to take effect** — there is no safe way for this
assistant to patch the live workflow directly (n8n MCP and UI access are
both still unavailable, and writing directly into a running n8n
instance's own SQLite database while it's live is a real risk of
corruption or a race with n8n's own in-memory cache; reading it was
judged safe, writing to it was not, and was never attempted).

**Per this task's own "verify before the first manual execution" gate:
execution has not proceeded past this point.** Steps 4 onward
(prepare a mock Work Order, execute, verify all outcome paths, duplicate
run, technical-failure run, export, final documentation) are not yet
performed. Everything below this section and "End-to-end verification"
following it describes the DC-003-side proof already completed via
`docker exec` (unaffected by either bug, since it never went through
n8n's own Execute Command/Switch nodes at all) — not a claim that the
live n8n workflow itself has been executed.

---

## End-to-end verification (2026-08-06)

Performed via `docker exec` against the recreated `n8n-test` container —
not through n8n itself (Blocker 2) — using the exact command this
workflow's own Execute Command node now contains. Mock mode throughout;
no live Claude Code or OpenAI request was made at any point.

1. **`git rev-parse HEAD` inside the mounted runtime repository** —
   succeeded (`4ca2429`), `git branch --show-current` reported `main`,
   `git status --porcelain` returned zero lines (genuinely clean, once the
   `core.autocrlf` fix above was applied).
2. **A real Operations Bridge run** — seeded a real `ready`/approved
   Engineering Work Order (`wo_d1712a1acf194261`) via `npm run engineering --
   work create` inside the container, then ran the exact command from
   "Exact Operations Bridge command" above. Produced exactly one line of
   valid JSON, exit code `0`: delivery self-reported success but
   (correctly, independently) verified as `"failed"` (the mock runner
   never lands a real commit — the same well-understood behaviour
   documented throughout DC-003's own I029.4/I029.3.1 history), and the
   Strategy Review correctly resolved to `"correction_required"` via the
   Delivery Status Authority Gate — proving the full I029.2 → I029.3.1 →
   I029.4 → I029.4.1 chain genuinely works end-to-end through this
   container for the first time.
3. **Control Centre** — ran `control-centre.mjs dashboard` with the
   matching `--engineering-*`/`--bridge=`/`--strategy-review=` flags
   against the same persistent directories: correctly showed
   `Failed Executions: 1`, `Corrections Required: 1`, and the exact
   `delivery_report_id`/`strategy_review_id` from step 2 as the latest
   record in each section.
4. **Duplicate protection** — re-running the identical command against the
   same Work Order (still not `"completed"`) correctly succeeded again
   with a NEW delivery/review attempt — this is DC-003's own deliberate
   design, not a gap: `DuplicateDeliveryError` only fires once a PRIOR
   delivery has genuinely reached `"completed"` (a failed delivery is
   meant to be retried after correction). To verify the real rule
   honestly, a genuinely `"completed"` Delivery Report was seeded directly
   (via a short `node --input-type=module -e` script importing DC-003's
   own domain modules from the read-only mount and writing only to the
   persistent volume — the same technique this project's own test suite
   already uses to seed fixtures) against the same Work Order, and the
   command was run a third time: it correctly failed fast with
   `{"success":false,"error":{"code":"DuplicateDeliveryError", ...}}`,
   exit code `1`, no new delivery or review record created.
5. **Read-only enforcement** — both `/data/dc003-repo` and
   `/data/dc003-repo-root` still reject writes (`touch` fails with
   "Read-only file system") after all of the above.
6. **DC-004 checkout** — independently confirmed unchanged (branch, HEAD,
   clean working tree) before this verification pass and again after.

**This verification data was deliberately left in the persistent store**
(Work Order `wo_d1712a1acf194261`, its three Delivery Reports, two
Strategy Reviews, four Bridge Transport records) rather than deleted —
matching this project's own established precedent (DC-003-I029.1's own
README: a controlled test execution is "desirable evidence, not something
to clean up"). It is clearly a test fixture (title: "OC-001 mock
verification") and does not represent a real engineering delivery.

**What this proves, and what it doesn't:** every piece of DC-003 logic the
Operations Bridge depends on now demonstrably works when invoked exactly
the way this n8n workflow will invoke it. What it does NOT prove is that
n8n's own Execute Command node behaves identically to a bare `docker exec`
shell (variable interpolation, `continueOnFail`/`onError` handling,
`$now.toFormat(...)` expression evaluation) — that can only be confirmed
by actually importing and running the workflow inside n8n itself, which
still requires Blocker 2 (n8n MCP, or manual UI import) to be resolved.

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

**Updated 2026-08-06 — most of what was "not performed" here now has real
evidence, just not through n8n itself.** See "End-to-end verification"
above: mock end-to-end execution, duplicate-run behaviour, and a Control
Centre cross-check were all performed for real, via `docker exec` against
the real recreated container, using the literal command this workflow's
Execute Command node contains. Zero live Claude/OpenAI/provider requests
were made (mock mode throughout — verified by construction, since no
`--live-*` flag was ever passed).

**Still genuinely not performed, honestly not claimed:** import into n8n
itself, and execution through n8n's own engine (Blocker 2, n8n MCP still
disconnected). The `docker exec` verification above proves DC-003's own
side of the contract works; it cannot prove n8n's own Execute Command node
(variable interpolation, `continueOnFail`/`onError`, `$now.toFormat(...)`
expression evaluation) behaves identically to a bare shell invocation —
only a real n8n import and run can confirm that.

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
