// DC-003-I029.2 — Claude Code Runner configuration: how the real
// (non-mock) claude-code-delivery-runner-adapter.mjs invokes Claude Code
// as a subprocess. Mirrors renderer-config.mjs (I006) / llm-provider-config
// .mjs (I019)'s own "read env, never assume, never guess" discipline.
//
// Feasibility investigation finding (see the DC-003-I029.2 investigation
// report): this host has no globally-installed `claude` on PATH, but
// `npx --yes @anthropic-ai/claude-code` reliably resolves and runs the
// real, officially-published CLI package from a non-interactive shell —
// that is this module's own default invocation. CLAUDE_CODE_COMMAND lets
// an operator point at a different, already-installed `claude` executable
// directly (e.g. once a real deployment installs it globally) — when set,
// no npx wrapping is added, since the supplied command is assumed to
// already BE the claude binary.
//
// `configured` is a structural signal only ("does an invocation mechanism
// exist"), never a live authentication check — this module makes no
// network call and never invokes Claude. Whether that invocation can
// actually authenticate is exactly what the brief's own "Initial
// Real-Runner Verification Gate" exists to determine, once, under
// separate authorisation — not something a config loader may probe.

const DEFAULT_NPX_PREFIX = ["--yes", "@anthropic-ai/claude-code"];

export function loadDeliveryOfficeRunnerConfig(env = process.env) {
  const explicitCommand = env.CLAUDE_CODE_COMMAND;
  if (explicitCommand && explicitCommand.trim() !== "") {
    return { command: explicitCommand, prefixArgs: [], configured: true, source: "CLAUDE_CODE_COMMAND" };
  }
  return { command: "npx", prefixArgs: [...DEFAULT_NPX_PREFIX], configured: true, source: "npx (default)" };
}

/**
 * Name-only authentication signal for reporting (§ "confirms credentials
 * only by availability/name" — CLI item 14, Control Centre item 15). Never
 * reveals a value. Reflects the DC-003-I029.2 investigation finding: this
 * host's own interactive session authenticates via Desktop-managed OAuth,
 * not a bare ANTHROPIC_API_KEY — a headless subprocess's own auth path is
 * unverified until the real-runner verification gate.
 */
export function describeAuthenticationAvailability(env = process.env) {
  if (env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.trim() !== "") {
    return { mechanism: "ANTHROPIC_API_KEY", available: true };
  }
  return { mechanism: "OAuth (host-managed) — unverified for a headless subprocess until the real-runner verification gate", available: false };
}
