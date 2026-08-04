import test from "node:test";
import assert from "node:assert/strict";
import { calculateAnthropicCost, calculateTemplatedCost, calculateGoogleDriveCost, calculateTotalCost } from "../../src/production-cost-calculator.mjs";

const CONFIG = {
  anthropicInputCostPerMillionTokens: 3.0,
  anthropicOutputCostPerMillionTokens: 15.0,
  templatedCostPerRender: 0.05,
  googleDriveCostPerUpload: 0,
  currency: "USD",
};

// --- Anthropic ---------------------------------------------------------

test("calculates Anthropic cost from input/output token usage and configured rates", () => {
  const result = calculateAnthropicCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, CONFIG);
  assert.equal(result.amount, 18); // 3.00 + 15.00
  assert.equal(result.calculationType, "estimated");
});

test("Anthropic cost scales proportionally for a fraction of a million tokens", () => {
  const result = calculateAnthropicCost({ inputTokens: 500_000, outputTokens: 200_000 }, CONFIG);
  // 500,000/1,000,000 * 3.00 = 1.5 ; 200,000/1,000,000 * 15.00 = 3.0 ; total 4.5
  assert.equal(result.amount, 4.5);
});

test("zero-token usage is real evidence (amount 0, still \"estimated\"), not \"unavailable\"", () => {
  const result = calculateAnthropicCost({ inputTokens: 0, outputTokens: 0 }, CONFIG);
  assert.equal(result.amount, 0);
  assert.equal(result.calculationType, "estimated");
});

test("missing usage (null/undefined) is \"unavailable\", amount 0 — never a guessed token count", () => {
  assert.deepEqual(calculateAnthropicCost(null, CONFIG), { amount: 0, calculationType: "unavailable" });
  assert.deepEqual(calculateAnthropicCost(undefined, CONFIG), { amount: 0, calculationType: "unavailable" });
});

test("malformed usage (non-numeric fields) is \"unavailable\"", () => {
  const result = calculateAnthropicCost({ inputTokens: "many", outputTokens: 10 }, CONFIG);
  assert.equal(result.calculationType, "unavailable");
});

test("a configured rate of 0 still classifies as \"estimated\" when usage is present (a real, if free, calculation)", () => {
  const freeConfig = { ...CONFIG, anthropicInputCostPerMillionTokens: 0, anthropicOutputCostPerMillionTokens: 0 };
  const result = calculateAnthropicCost({ inputTokens: 1000, outputTokens: 1000 }, freeConfig);
  assert.equal(result.amount, 0);
  assert.equal(result.calculationType, "estimated");
});

// --- Templated -----------------------------------------------------------

test("calculates Templated cost from render count and configured per-render rate", () => {
  const result = calculateTemplatedCost(6, CONFIG);
  assert.equal(result.amount, 0.3);
  assert.equal(result.calculationType, "estimated");
});

test("a render count of 0 (e.g. generation failed before any render) is real evidence, still \"estimated\"", () => {
  const result = calculateTemplatedCost(0, CONFIG);
  assert.equal(result.amount, 0);
  assert.equal(result.calculationType, "estimated");
});

test("a partial render failure (some slides rendered, then stopped) costs only for the slides that actually rendered", () => {
  const result = calculateTemplatedCost(2, CONFIG); // e.g. slides 1-2 succeeded, slide 3 failed and stopped the run
  assert.equal(result.amount, 0.1);
});

test("a malformed render count is \"unavailable\"", () => {
  assert.equal(calculateTemplatedCost(-1, CONFIG).calculationType, "unavailable");
  assert.equal(calculateTemplatedCost(1.5, CONFIG).calculationType, "unavailable");
  assert.equal(calculateTemplatedCost("6", CONFIG).calculationType, "unavailable");
});

// --- Google Drive ----------------------------------------------------

test("calculates Google Drive cost from upload count and configured per-upload rate", () => {
  const paidConfig = { ...CONFIG, googleDriveCostPerUpload: 0.01 };
  const result = calculateGoogleDriveCost(7, paidConfig);
  assert.equal(result.amount, 0.07);
  assert.equal(result.calculationType, "estimated");
});

test("the default configured rate of 0 produces amount 0, still classified \"estimated\" (a real calculation from a configured zero rate)", () => {
  const result = calculateGoogleDriveCost(7, CONFIG);
  assert.equal(result.amount, 0);
  assert.equal(result.calculationType, "estimated");
});

test("a malformed upload count is \"unavailable\"", () => {
  assert.equal(calculateGoogleDriveCost(-1, CONFIG).calculationType, "unavailable");
});

// --- Total -----------------------------------------------------------

test("total cost sums all three provider costs and carries the configured currency", () => {
  const anthropic = calculateAnthropicCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, CONFIG); // 18
  const templated = calculateTemplatedCost(6, CONFIG); // 0.3
  const googleDrive = calculateGoogleDriveCost(0, CONFIG); // 0
  const totalResult = calculateTotalCost({ anthropic, templated, googleDrive, currency: CONFIG.currency });
  assert.equal(totalResult.total, 18.3);
  assert.equal(totalResult.currency, "USD");
  assert.deepEqual(totalResult.anthropic, anthropic);
  assert.deepEqual(totalResult.templated, templated);
  assert.deepEqual(totalResult.googleDrive, googleDrive);
});

test("total cost with every provider unavailable is 0", () => {
  const totalResult = calculateTotalCost({
    anthropic: { amount: 0, calculationType: "unavailable" },
    templated: { amount: 0, calculationType: "unavailable" },
    googleDrive: { amount: 0, calculationType: "unavailable" },
    currency: "USD",
  });
  assert.equal(totalResult.total, 0);
});

// --- Rounding --------------------------------------------------------

test("amounts are rounded to 6 decimal places", () => {
  // 333333 tokens * 3.00 / 1,000,000 = 0.999999 exactly at 6dp already
  const result = calculateAnthropicCost({ inputTokens: 333_333, outputTokens: 0 }, CONFIG);
  assert.equal(result.amount, 0.999999);
});

test("rounding rounds (not floors) a value whose 7th decimal digit is unambiguously above the midpoint", () => {
  const oddConfig = { ...CONFIG, templatedCostPerRender: 0.1234567 };
  const result = calculateTemplatedCost(1, oddConfig);
  // 0.1234567 → the 7th decimal digit is 7, so the 6th decimal (6) rounds up to 7.
  assert.equal(result.amount, 0.123457);
});
