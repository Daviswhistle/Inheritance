#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Interface, JsonRpcProvider, parseUnits } from "ethers";
import { buildOpsReport, renderHtmlReport } from "./ops-report.mjs";

const address = (n) => `0x${BigInt(n).toString(16).padStart(40, "0")}`;
const WLD = address(1);
const USDC = address(2);
const FACTORY_WLD = address(3);
const FACTORY_USDC = address(4);
const STRATEGY_WLD = address(5);
const STRATEGY_USDC = address(6);
const VAULT_WLD = address(7);
const VAULT_USDC = address(8);
const RECIPIENT_WLD = address(9);
const RECIPIENT_USDC = address(10);
const OPERATOR = address(11);
const UNKNOWN_RECIPIENT = address(12);
const OTHER_VAULT = address(13);

const feeInterface = new Interface([
  "event PerformanceFeePaid(address indexed recipient,uint256 assets,uint256 shares)",
  "event RewardFeePaid(address indexed recipient,uint256 amount)",
]);
const tokenInterface = new Interface(["function decimals() view returns (uint8)"]);
const factoryInterface = new Interface([
  "function WLD() view returns (address)",
  "function asset() view returns (address)",
  "function rewardToken() view returns (address)",
  "function strategy() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function knownVaults(address) view returns (bool)",
]);
const vaultInterface = new Interface([
  "function factory() view returns (address)",
  "function WLD() view returns (address)",
  "function asset() view returns (address)",
  "function rewardToken() view returns (address)",
  "function strategy() view returns (address)",
  "function feeRecipient() view returns (address)",
]);
const strategyInterface = new Interface([
  "function asset() view returns (address)",
  "function decimals() view returns (uint8)",
  "function convertToAssets(uint256) view returns (uint256)",
]);
const oracleInterface = new Interface(["function getOperatorFee(uint256) view returns (uint256)"]);

const blockHash = (n) => `0x${(BigInt(n) + 900n).toString(16).padStart(64, "0")}`;
const txHash = (n) => `0x${BigInt(n).toString(16).padStart(64, "0")}`;
const monthStart = Math.floor(Date.parse("2026-09-01T00:00:00.000Z") / 1000);
const nextMonth = Math.floor(Date.parse("2026-10-01T00:00:00.000Z") / 1000);

function makeLog({ source, name, args, block = 110, index = 0, transaction = 1000 + index }) {
  const encoded = feeInterface.encodeEventLog(feeInterface.getEvent(name), args);
  return {
    address: source,
    topics: encoded.topics,
    data: encoded.data,
    blockNumber: block,
    blockHash: blockHash(block),
    transactionHash: txHash(transaction),
    transactionIndex: 0,
    index,
    removed: false,
  };
}

const baselineLogs = () => [
  makeLog({ source: VAULT_WLD, name: "PerformanceFeePaid", args: [RECIPIENT_WLD, parseUnits("1", 18), parseUnits("2", 18)], index: 1 }),
  makeLog({ source: VAULT_USDC, name: "PerformanceFeePaid", args: [RECIPIENT_USDC, parseUnits("3.5", 6), parseUnits("4", 6)], index: 2 }),
  makeLog({ source: VAULT_USDC, name: "RewardFeePaid", args: [RECIPIENT_USDC, parseUnits("1.25", 18)], index: 3 }),
];

class FixtureProvider {
  constructor({ logs = baselineLogs(), finalizedBlock = 300, canonicalOverrides = new Map(), receipt = null, transaction = null, blockTimes = new Map(), includeForeignLogs = false } = {}) {
    this.logs = logs;
    this.finalizedBlock = finalizedBlock;
    this.canonicalOverrides = canonicalOverrides;
    this.receipt = receipt;
    this.transaction = transaction;
    this.blockTimes = blockTimes;
    this.includeForeignLogs = includeForeignLogs;
    this.queries = [];
    this.vaults = new Map([
      [VAULT_WLD.toLowerCase(), { factory: FACTORY_WLD, wld: WLD, feeRecipient: RECIPIENT_WLD, strategy: STRATEGY_WLD }],
      [VAULT_USDC.toLowerCase(), { factory: FACTORY_USDC, asset: USDC, rewardToken: WLD, feeRecipient: RECIPIENT_USDC, strategy: STRATEGY_USDC }],
    ]);
    this.factories = new Map([
      [FACTORY_WLD.toLowerCase(), { kind: "wld", wld: WLD, feeRecipient: RECIPIENT_WLD, strategy: STRATEGY_WLD, known: new Set([VAULT_WLD.toLowerCase()]) }],
      [FACTORY_USDC.toLowerCase(), { kind: "usdc", asset: USDC, rewardToken: WLD, feeRecipient: RECIPIENT_USDC, strategy: STRATEGY_USDC, known: new Set([VAULT_USDC.toLowerCase()]) }],
    ]);
    this.strategies = new Map([
      [STRATEGY_WLD.toLowerCase(), { asset: WLD, decimals: 18 }],
      [STRATEGY_USDC.toLowerCase(), { asset: USDC, decimals: 6 }],
    ]);
    this.tokens = new Map([[WLD.toLowerCase(), 18], [USDC.toLowerCase(), 6]]);
  }

  async getNetwork() { return { chainId: 480n }; }
  async getCode() { return "0x60006000"; }
  async getBlock(tag) {
    if (tag === "finalized") return { number: this.finalizedBlock, hash: blockHash(this.finalizedBlock), timestamp: nextMonth + 86400 };
    const number = Number(tag);
    return {
      number,
      hash: this.canonicalOverrides.get(number) || blockHash(number),
      timestamp: this.blockTimes.get(number) ?? (number === 100 ? monthStart : number === 120 ? nextMonth : monthStart + (number - 100) * 3600),
    };
  }
  async getLogs(filter) {
    this.queries.push({ fromBlock: filter.fromBlock, toBlock: filter.toBlock, address: filter.address });
    return this.logs.filter((log) => log.blockNumber >= filter.fromBlock && log.blockNumber <= filter.toBlock &&
      (this.includeForeignLogs || log.address.toLowerCase() === filter.address.toLowerCase()));
  }
  async getTransaction(hash) {
    if (!this.transaction || this.transaction.hash.toLowerCase() !== hash.toLowerCase()) return null;
    return this.transaction;
  }
  async getTransactionReceipt(hash) {
    if (!this.receipt || this.receipt.hash.toLowerCase() !== hash.toLowerCase()) return null;
    return this.receipt;
  }
  async send(method, params) {
    if (method === "eth_chainId") return "0x1e0";
    if (method !== "eth_getTransactionReceipt") throw new Error("unexpected fixture RPC method");
    const receipt = await this.getTransactionReceipt(params[0]);
    if (!receipt) return null;
    const quantity = (value) => `0x${BigInt(value).toString(16)}`;
    return {
      transactionHash: receipt.hash,
      blockNumber: quantity(receipt.blockNumber),
      blockHash: receipt.blockHash,
      status: quantity(receipt.status),
      gasUsed: receipt.gasUsed == null ? null : quantity(receipt.gasUsed),
      effectiveGasPrice: receipt.effectiveGasPrice == null ? null : quantity(receipt.effectiveGasPrice),
      gasPrice: receipt.gasPrice == null ? null : quantity(receipt.gasPrice),
      l1Fee: receipt.l1Fee == null ? undefined : quantity(receipt.l1Fee),
      operatorFee: receipt.operatorFee == null ? undefined : quantity(receipt.operatorFee),
      operatorFeeScalar: receipt.operatorFeeScalar == null ? undefined : quantity(receipt.operatorFeeScalar),
      operatorFeeConstant: receipt.operatorFeeConstant == null ? undefined : quantity(receipt.operatorFeeConstant),
    };
  }
  async call(transaction) {
    assert.ok(Number.isSafeInteger(transaction.blockTag), "ethers v6 historical calls require transaction.blockTag");
    const target = transaction.to.toLowerCase();
    let iface;
    let value;
    const factory = this.factories.get(target);
    const vault = this.vaults.get(target);
    const strategy = this.strategies.get(target);
    if (factory) {
      iface = factoryInterface;
      const parsed = iface.parseTransaction({ data: transaction.data });
      switch (parsed.name) {
        case "WLD": value = factory.wld; break;
        case "asset": value = factory.asset; break;
        case "rewardToken": value = factory.rewardToken; break;
        case "strategy": value = factory.strategy; break;
        case "feeRecipient": value = factory.feeRecipient; break;
        case "knownVaults": value = factory.known.has(parsed.args[0].toLowerCase()); break;
        default: throw new Error("unknown fixture factory call");
      }
      return iface.encodeFunctionResult(parsed.name, [value]);
    }
    if (vault) {
      iface = vaultInterface;
      const parsed = iface.parseTransaction({ data: transaction.data });
      switch (parsed.name) {
        case "factory": value = vault.factory; break;
        case "WLD": value = vault.wld; break;
        case "asset": value = vault.asset; break;
        case "rewardToken": value = vault.rewardToken; break;
        case "strategy": value = vault.strategy; break;
        case "feeRecipient": value = vault.feeRecipient; break;
        default: throw new Error("unknown fixture vault call");
      }
      return iface.encodeFunctionResult(parsed.name, [value]);
    }
    if (strategy) {
      iface = strategyInterface;
      const parsed = iface.parseTransaction({ data: transaction.data });
      switch (parsed.name) {
        case "asset": value = strategy.asset; break;
        case "decimals": value = strategy.decimals; break;
        case "convertToAssets": value = parsed.args[0]; break;
        default: throw new Error("unknown fixture strategy call");
      }
      return iface.encodeFunctionResult(parsed.name, [value]);
    }
    if (this.tokens.has(target)) {
      iface = tokenInterface;
      const parsed = iface.parseTransaction({ data: transaction.data });
      if (parsed.name !== "decimals") throw new Error("unknown fixture token call");
      return iface.encodeFunctionResult(parsed.name, [this.tokens.get(target)]);
    }
    if (target === address(420).toLowerCase()) {
      iface = oracleInterface;
      const parsed = iface.parseTransaction({ data: transaction.data });
      return iface.encodeFunctionResult(parsed.name, [7n]);
    }
    throw new Error(`unconfigured fixture call at ${transaction.blockTag}`);
  }
}

function config(overrides = {}) {
  return {
    chainId: 480,
    wldToken: WLD,
    usdcToken: USDC,
    trustedFactories: [
      { address: FACTORY_WLD, kind: "wld" },
      { address: FACTORY_USDC, kind: "usdc" },
    ],
    vaults: [
      { address: VAULT_WLD, kind: "wld", factory: FACTORY_WLD },
      { address: VAULT_USDC, kind: "usdc", factory: FACTORY_USDC },
    ],
    operatorAddresses: [OPERATOR],
    ...overrides,
  };
}

const report = (provider, extra = {}) => buildOpsReport({
  config: config(), fromBlock: 100, toBlock: 120, provider, ...extra,
});
const passed = [];
async function check(name, work) {
  await work();
  passed.push(name);
  process.stdout.write(`PASS ${name}\n`);
}

await check("genuine fee events produce exact WLD, USDC, reward and receipt-share totals with duplicate-log dedupe", async () => {
  const logs = baselineLogs();
  const provider = new FixtureProvider({ logs: [...logs, logs[0]] });
  const result = await report(provider);
  assert.equal(result.status, "complete");
  assert.match(result.feeIncomeBasis, /events only/);
  assert.equal(result.feeEventCount, 3);
  assert.equal(result.duplicateLogsSkipped, 1);
  assert.equal(result.fees.cashFees.WLD.performanceAssetFee.amount, "1");
  assert.equal(result.fees.cashFees.WLD.rewardFee.amount, "1.25");
  assert.equal(result.fees.cashFees.WLD.totalCashFee.amount, "2.25");
  assert.equal(result.fees.cashFees.USDC.performanceAssetFee.amount, "3.5");
  assert.equal(result.fees.cashFees.USDC.rewardFee.amount, "0");
  assert.equal(result.fees.cashFees.USDC.totalCashFee.amount, "3.5");
  assert.deepEqual(result.fees.receiptShareFees.map((entry) => entry.amount).sort(), ["2", "4"]);
  assert.ok(result.fees.receiptShareFees.every((entry) => entry.valuation.startsWith("not-cash")));
  assert.ok(provider.queries.every((query) => query.toBlock - query.fromBlock < 90));
  assert.equal(result.netPnlEstimate.status, "unavailable");
  assert.ok(result.netPnlEstimate.missing.includes("fx_wld"));
  assert.ok(result.netPnlEstimate.missing.includes("monthly_server_cost"));
  assert.equal(result.netPnlEstimate.cashFeeIncomeUsd, null);
  assert.equal(result.netPnlEstimate.receiptShareFeeMarkUsd, null);
  assert.equal(result.expenses.totalWei, null);
});

await check("the default public-RPC page limit preserves fee events across a wider report range", async () => {
  const provider = new FixtureProvider({ finalizedBlock: 500 });
  const getLogs = provider.getLogs.bind(provider);
  provider.getLogs = async filter => {
    if (filter.toBlock - filter.fromBlock + 1 > 100) throw new Error("fixture RPC limits logs to 100 blocks");
    return getLogs(filter);
  };
  const result = await report(provider, { toBlock: 399 });
  assert.equal(result.status, "complete");
  assert.equal(result.coverage.logPageSize, 90);
  assert.equal(provider.queries.length, 8);
  assert.equal(result.feeEventCount, 3);
  assert.equal(result.fees.cashFees.USDC.totalCashFee.amount, "3.5");
  assert.ok(provider.queries.every(query => query.toBlock - query.fromBlock < 100));
});

await check("out-of-page canonical events cannot inflate the explicit fee range or its completeness", async () => {
  const outside = makeLog({ source: VAULT_WLD, name: "PerformanceFeePaid",
    args: [RECIPIENT_WLD, parseUnits("9", 18), 0n], block: 99, index: 7 });
  const provider = new FixtureProvider({ logs: [] });
  provider.getLogs = async filter => filter.address.toLowerCase() === VAULT_WLD.toLowerCase() ? [outside] : [];
  const result = await report(provider);
  assert.equal(result.status, "incomplete");
  assert.equal(result.coverage.complete, false);
  assert.equal(result.feeEventCount, 0);
  assert.equal(result.fees.cashFees.WLD.totalCashFee.raw, "0");
  assert.ok(result.errors.some(error => error.code === "fee_log_outside_requested_page"));
});

await check("block range and total log requests remain explicitly bounded", async () => {
  await assert.rejects(buildOpsReport({
    config: config(),
    fromBlock: 0,
    toBlock: 2_999_999,
    provider: new FixtureProvider(),
  }), (error) => error.code === "log_query_budget_exceeded");
  for (const logPageSize of [0, -1, 2001, 90.5]) {
    await assert.rejects(report(new FixtureProvider(), { config: config({ logPageSize }) }),
      error => error.code === "invalid_configuration");
  }
  const broaderRpc = new FixtureProvider();
  const result = await report(broaderRpc, { config: config({ logPageSize: 2000 }), toBlock: 299 });
  assert.equal(result.coverage.logPageSize, 2000);
  assert.equal(result.status, "complete");
});

await check("unknown recipient, source, and reward currency are rejected rather than counted", async () => {
  const base = baselineLogs();
  const wrongRecipient = makeLog({ source: VAULT_WLD, name: "PerformanceFeePaid", args: [UNKNOWN_RECIPIENT, parseUnits("10", 18), 0n], index: 4 });
  const foreignSource = { ...makeLog({ source: OTHER_VAULT, name: "PerformanceFeePaid", args: [RECIPIENT_WLD, parseUnits("20", 18), 0n], index: 5 }), address: OTHER_VAULT };
  const wrongCurrency = makeLog({ source: VAULT_WLD, name: "RewardFeePaid", args: [RECIPIENT_WLD, parseUnits("5", 18)], index: 6 });
  const provider = new FixtureProvider({ logs: [...base, wrongRecipient, foreignSource, wrongCurrency], includeForeignLogs: true });
  const result = await report(provider);
  assert.equal(result.status, "incomplete");
  assert.equal(result.fees.cashFees.WLD.performanceAssetFee.amount, "1");
  assert.ok(result.errors.some((item) => item.code === "unknown_fee_recipient"));
  assert.ok(result.errors.some((item) => item.code === "unknown_fee_source"));
  assert.ok(result.errors.some((item) => item.code === "currency_mismatch"));
});

await check("configured currency mismatch and wrong trusted factory do not pass vault validation", async () => {
  const wrongCurrencyProvider = new FixtureProvider();
  wrongCurrencyProvider.factories.get(FACTORY_USDC.toLowerCase()).asset = WLD;
  const currencyResult = await report(wrongCurrencyProvider);
  assert.equal(currencyResult.status, "incomplete");
  assert.ok(currencyResult.errors.some((item) => item.code === "currency_mismatch"));
  assert.equal(currencyResult.validatedVaults.length, 1);

  const unknownProvider = new FixtureProvider();
  unknownProvider.vaults.get(VAULT_WLD.toLowerCase()).factory = OTHER_VAULT;
  const unknownResult = await report(unknownProvider);
  assert.ok(unknownResult.errors.some((item) => item.code === "unknown_fee_source"));
});

await check("unfinalized range and canonical reorg are incomplete and never count affected logs", async () => {
  const notFinal = await report(new FixtureProvider({ finalizedBlock: 119 }));
  assert.equal(notFinal.feeEventCount, 0);
  assert.ok(notFinal.errors.some((item) => item.code === "range_not_finalized"));

  const reorg = await report(new FixtureProvider({ canonicalOverrides: new Map([[110, blockHash(9999)]]) }));
  assert.equal(reorg.feeEventCount, 0);
  assert.ok(reorg.errors.some((item) => item.code === "noncanonical_or_unfinalized_log"));
});

await check("explicit reverted operator receipt includes gas and known chain fees", async () => {
  const hash = txHash(77);
  const provider = new FixtureProvider({
    transaction: { hash, from: OPERATOR, chainId: 480n },
    receipt: {
      hash,
      status: 0,
      blockNumber: 115,
      blockHash: blockHash(115),
      gasUsed: 21_000n,
      effectiveGasPrice: 1_000_000_000n,
      l1Fee: 100n,
      operatorFee: 50n,
    },
  });
  const result = await report(provider, { operatorTxHashes: [hash], config: config({ operatorTransactionSetComplete: true }) });
  const expense = result.expenses.operatorTransactions[0];
  assert.equal(expense.status, "reverted");
  assert.equal(expense.gasCostWei, "21000000000000");
  assert.equal(expense.totalCostWei, "21000000000150");
  assert.equal(result.expenses.totalWei, "21000000000150");
  assert.equal(JSON.stringify(result).includes(hash), false);

  const partialSetResult = await report(provider, { operatorTxHashes: [hash] });
  assert.equal(partialSetResult.expenses.submittedReceiptsTotalWei, "21000000000150");
  assert.equal(partialSetResult.expenses.totalWei, null);
});

await check("missing receipt fee extras stay unknown rather than being reported as zero", async () => {
  const hash = txHash(78);
  const provider = new FixtureProvider({
    transaction: { hash, from: OPERATOR, chainId: 480n },
    receipt: {
      hash,
      status: 1,
      blockNumber: 115,
      blockHash: blockHash(115),
      gasUsed: 50_000n,
      gasPrice: 2_000_000_000n,
    },
  });
  const result = await report(provider, { operatorTxHashes: [hash], config: config({ operatorTransactionSetComplete: true }) });
  assert.equal(result.expenses.operatorTransactions[0].gasCostWei, "100000000000000");
  assert.equal(result.expenses.operatorTransactions[0].l1FeeWei, null);
  assert.equal(result.expenses.operatorTransactions[0].operatorFeeWei, null);
  assert.equal(result.expenses.totalWei, null);
  assert.ok(result.errors.some((item) => item.code === "l1_fee_unavailable"));
  assert.ok(result.errors.some((item) => item.code === "operator_fee_unavailable"));
  assert.equal(result.netPnlEstimate.status, "unavailable");
});

await check("operator receipt from an unconfigured wallet is rejected", async () => {
  const hash = txHash(781);
  const provider = new FixtureProvider({
    transaction: { hash, from: OTHER_VAULT, chainId: 480n },
    receipt: {
      hash,
      status: 1,
      blockNumber: 115,
      blockHash: blockHash(115),
      gasUsed: 21_000n,
      effectiveGasPrice: 1_000_000_000n,
      l1Fee: 100n,
      operatorFee: 50n,
    },
  });
  const result = await report(provider, { operatorTxHashes: [hash] });
  assert.equal(result.expenses.operatorTransactions[0].status, "unknown");
  assert.equal(result.expenses.knownGasWei, null);
  assert.ok(result.errors.some((item) => item.code === "unknown_operator_source"));
});

await check("complete explicit month, FX marks and server cost produce a labeled USD estimate", async () => {
  const hash = txHash(79);
  const provider = new FixtureProvider({
    blockTimes: new Map([[100, monthStart], [120, nextMonth]]),
    transaction: { hash, from: OPERATOR, chainId: 480n },
    receipt: {
      hash,
      status: 1,
      blockNumber: 115,
      blockHash: blockHash(115),
      gasUsed: 21_000n,
      effectiveGasPrice: 1_000_000_000n,
      l1Fee: 100n,
      operatorFee: 50n,
    },
  });
  const result = await report(provider, {
    operatorTxHashes: [hash],
    config: config({
      operatorTransactionSetComplete: true,
      fxMarksUsdPerToken: { WLD: "2", USDC: "1", ETH: "3000" },
      fxMarkAt: "2026-10-01T00:00:00.000Z",
      monthlyServerCostUsd: "1.00",
      serverCostMonth: "2026-09",
    }),
  });
  assert.equal(result.status, "complete");
  assert.equal(result.coverage.monthComplete, true);
  assert.equal(result.netPnlEstimate.status, "available_estimate");
  assert.ok(result.netPnlEstimate.amount.startsWith("14.9"));
  assert.equal(result.estimatedShareFeeValues.length, 2);
  assert.ok(result.estimatedShareFeeValues.every((entry) => entry.valuation.includes("not cash")));
  assert.equal(result.netPnlEstimate.scope, "estimate for explicit block range; includes server cost for 2026-09");
});

await check("HTML report is self-contained and omits transaction hashes and raw transaction fields", async () => {
  const hash = txHash(80);
  const provider = new FixtureProvider({
    transaction: { hash, from: OPERATOR, chainId: 480n },
    receipt: { hash, status: 1, blockNumber: 115, blockHash: blockHash(115), gasUsed: 1n, effectiveGasPrice: 2n, l1Fee: 0n, operatorFee: 0n },
  });
  const result = await report(provider, { operatorTxHashes: [hash] });
  const html = renderHtmlReport(result);
  assert.match(html, /<style>/);
  assert.doesNotMatch(html, /<script|https?:\/\//i);
  assert.equal(html.includes(hash), false);
  assert.equal(html.includes("rawTransaction"), false);
});

await check("the actual RPC chain ID overrides a statically configured World Chain provider", async () => {
  let calls = 0;
  const server = createServer(async (request, response) => {
    let text = "";
    for await (const part of request) text += part;
    const call = JSON.parse(text);
    calls++;
    assert.equal(call.method, "eth_chainId");
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: "0x1" }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const provider = new JsonRpcProvider(`http://127.0.0.1:${server.address().port}`, 480,
    { staticNetwork: true, batchMaxCount: 1 });
  try {
    assert.equal((await provider.getNetwork()).chainId, 480n);
    assert.equal(calls, 0);
    const result = await report(provider);
    assert.equal(calls, 1);
    assert.equal(result.status, "incomplete");
    assert.equal(result.coverage.finalizedBlock, null);
    assert.ok(result.errors.some(error => error.code === "chain_must_be_480"));
    assert.equal(result.fees, null);
  } finally {
    provider.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});

await check("no configured fee vaults cannot masquerade as zero lifetime revenue", async () => {
  const result = await report(new FixtureProvider(), { config: config({ vaults: [] }) });
  assert.equal(result.status, "incomplete");
  assert.equal(result.fees, null);
  assert.equal(result.netPnlEstimate.status, "unavailable");
  assert.ok(result.errors.some(error => error.code === "fee_vault_coverage_not_configured"));
});

process.stdout.write(`\n${passed.length} profitability report checks passed\n`);
