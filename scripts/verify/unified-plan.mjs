import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { buildPlanRoutes, findUniquePlanReceipt, parseAssetAmount, runRemainingPlanSteps } from "../../app/src/plan.ts";
import { verifyIncomeWithdrawalReceipt } from "../../app/src/transactions.ts";
import { isDefinitelyNotSubmittedCode, isDefinitelyNotSubmittedResponse } from "../../app/src/transaction-safety.ts";

const require = createRequire(new URL("../../app/package.json", import.meta.url));
const { Interface } = require("ethers");

const wldYield = {
  symbol: "WLD", asset: "0x0000000000000000000000000000000000000011", decimals: 18,
  factory: "0x0000000000000000000000000000000000000021", mode: "morpho", details: "wld-yield",
};
const usdcYield = {
  symbol: "USDC", asset: "0x0000000000000000000000000000000000000012", decimals: 6,
  factory: "0x0000000000000000000000000000000000000022", mode: "morpho", details: "usdc-yield",
};
const wldBasic = {
  symbol: "WLD", asset: "0x0000000000000000000000000000000000000011", decimals: 18,
  factory: "0x0000000000000000000000000000000000000023", mode: "plain", details: "basic",
};

assert.deepEqual(buildPlanRoutes([wldYield, usdcYield], wldBasic, true), [wldYield, usdcYield]);
assert.deepEqual(buildPlanRoutes([usdcYield], wldBasic, false), [wldBasic]);
assert.equal(parseAssetAmount("1.25", 18), 1_250_000_000_000_000_000n);
assert.equal(parseAssetAmount("1.25", 6), 1_250_000n);
assert.equal(parseAssetAmount("0.0000001", 6), null);
assert.equal(parseAssetAmount("1e3", 18), null);

assert.equal(isDefinitelyNotSubmittedCode("simulation_failed"), true);
assert.equal(isDefinitelyNotSubmittedCode("invalid_contract"), true);
assert.equal(isDefinitelyNotSubmittedCode("input_error"), true);
assert.equal(isDefinitelyNotSubmittedCode("user_rejected"), true);
for (const code of ["invalid_operation", "disallowed_operation", "validation_error", "malicious_operation",
  "daily_tx_limit_reached", "permitted_amount_exceeds_slippage", "permitted_amount_not_found"]) {
  assert.equal(isDefinitelyNotSubmittedResponse(code, false), true);
  assert.equal(isDefinitelyNotSubmittedResponse(code, true), false);
}
assert.equal(isDefinitelyNotSubmittedCode("transaction_failed"), false);
assert.equal(isDefinitelyNotSubmittedCode("generic_error"), false);
assert.equal(isDefinitelyNotSubmittedCode("transport request rejected"), false);
assert.equal(isDefinitelyNotSubmittedResponse("simulation_failed", false), true);
assert.equal(isDefinitelyNotSubmittedResponse("simulation_failed", true), false);
assert.equal(isDefinitelyNotSubmittedResponse("generic_error", false), false);

const recoveryHashA = `0x${"a1".repeat(32)}`;
const recoveryHashB = `0x${"b2".repeat(32)}`;
const recoveryRanges = [];
const recoveryReceipt = { hash: recoveryHashA, status: 1 };
const recovered = await findUniquePlanReceipt(
  5,
  async () => 250,
  async (fromBlock, toBlock) => {
    recoveryRanges.push([fromBlock, toBlock]);
    return fromBlock <= 6 && toBlock >= 6 ? [{ transactionHash: recoveryHashA, amount: 10n }] : [];
  },
  async hash => hash === recoveryHashA ? recoveryReceipt : null,
  log => log.amount === 10n,
  receipt => receipt.status === 1,
);
assert.equal(recovered, recoveryReceipt);
assert.deepEqual(recoveryRanges, [[6, 105], [106, 205], [206, 250]]);
assert.ok(recoveryRanges.every(([fromBlock, toBlock]) => toBlock - fromBlock < 100));
// A deposit already present in the saved pre-request head is unrelated to this request.
const boundaryRanges = [];
assert.equal(await findUniquePlanReceipt(5, async () => 5, async (from, to) => {
  boundaryRanges.push([from, to]); return [{ transactionHash: recoveryHashA }];
}, async () => recoveryReceipt, () => true, () => true), null);
assert.deepEqual(boundaryRanges, []);

await assert.rejects(findUniquePlanReceipt(undefined, async () => 1, async () => [], async () => null,
  () => true, () => true), /start block is missing or invalid/);
await assert.rejects(findUniquePlanReceipt("5", async () => 1, async () => [], async () => null,
  () => true, () => true), /start block is missing or invalid/);
await assert.rejects(findUniquePlanReceipt(0, async () => 1, async () => { throw new Error("range failed"); }, async () => null,
  () => true, () => true), /range failed/);
await assert.rejects(findUniquePlanReceipt(
  0,
  async () => 1,
  async () => [{ transactionHash: recoveryHashA, amount: 10n }, { transactionHash: recoveryHashB, amount: 10n }],
  async hash => ({ hash, status: 1 }),
  log => log.amount === 10n,
  () => true,
), /More than one canonical receipt/);

const completed = new Set();
const executions = [];
const steps = [
  { key: "WLD", value: { route: wldYield, amount: 2n } },
  { key: "USDC", value: { route: usdcYield, amount: 3_000_000n } },
];
await assert.rejects(runRemainingPlanSteps(
  steps,
  key => completed.has(key),
  async item => {
    executions.push(item.route.symbol);
    if (item.route.symbol === "USDC") throw new Error("wallet rejected USDC");
  },
  key => completed.add(key),
), /wallet rejected USDC/);
await runRemainingPlanSteps(
  steps,
  key => completed.has(key),
  async item => { executions.push(item.route.symbol); },
  key => completed.add(key),
);
assert.deepEqual(executions, ["WLD", "USDC", "USDC"]);
assert.deepEqual([...completed], ["WLD", "USDC"]);

const income = new Interface(["event IncomeWithdrawn(address indexed to,uint256 gross,uint256 fee,uint256 net)"]);
const vault = "0x0000000000000000000000000000000000000031";
const factory = "0x0000000000000000000000000000000000000032";
const recipient = "0x0000000000000000000000000000000000000033";
const makeReceipt = (emitter, to = recipient, gross = 110n, fee = 10n, net = 100n) => {
  const encoded = income.encodeEventLog(income.getEvent("IncomeWithdrawn"), [to, gross, fee, net]);
  return { logs: [{ address: emitter, topics: encoded.topics, data: encoded.data }] };
};
const expected = { vault, factory, to: recipient, minNetAssets: 99n };
assert.equal(verifyIncomeWithdrawalReceipt(makeReceipt(vault), expected), true);
assert.equal(verifyIncomeWithdrawalReceipt(makeReceipt(factory), expected), false);
assert.equal(verifyIncomeWithdrawalReceipt(makeReceipt(vault, "0x0000000000000000000000000000000000000034"), expected), false);
assert.equal(verifyIncomeWithdrawalReceipt(makeReceipt(vault, recipient, 110n, 10n, 98n), expected), false);
assert.equal(verifyIncomeWithdrawalReceipt(makeReceipt("0x0000000000000000000000000000000000000035"), expected), false);
assert.equal(verifyIncomeWithdrawalReceipt(makeReceipt(vault, recipient, 110n, 9n, 100n), expected), false);

console.log("PASS unified routing, transaction safety, chunked deposit recovery, partial resume, and canonical income receipt proof");
