import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "../app/node_modules/typescript/lib/typescript.js";

const source = readFileSync(new URL("../app/src/income-history.ts", import.meta.url), "utf8");
const require = createRequire(new URL("../app/package.json", import.meta.url));
const ethersUrl = pathToFileURL(require.resolve("ethers")).href;
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replaceAll('from "ethers"', `from ${JSON.stringify(ethersUrl)}`);
const history = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const { ethers } = await import(ethersUrl);

const iface = new ethers.Interface([
  "event IncomeWithdrawn(address indexed to,uint256 gross,uint256 fee,uint256 net)",
  "event Deposited(uint256 assets,uint256 shares)",
  "event Withdrawn(address indexed to,uint256 amount)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const vault = ethers.getAddress(`0x${"11".repeat(20)}`);
const otherVault = ethers.getAddress(`0x${"22".repeat(20)}`);
const recipient = ethers.getAddress(`0x${"33".repeat(20)}`);
const hashFor = number => `0x${BigInt(number + 1000).toString(16).padStart(64, "0")}`;
const blockHash = number => `0x${BigInt(number + 5000).toString(16).padStart(64, "0")}`;
const logFrom = (eventName, values, { address = vault, blockNumber = 101, transactionHash = hashFor(blockNumber), index = 0, blockHashValue = blockHash(blockNumber) } = {}) => {
  const event = iface.encodeEventLog(iface.getEvent(eventName), values);
  return {
    address, topics: event.topics, data: event.data, blockNumber, blockHash: blockHashValue,
    transactionHash, transactionIndex: 0, index, removed: false,
  };
};
const historyLog = (gross, fee, net, options = {}) => logFrom("IncomeWithdrawn", [recipient, gross, fee, net], options);

function providerFixture({ logs = [], failedRanges = [], blockHashOverrides = new Map(), receiptOverrides = new Map(), finalizedBlock = 500 } = {}) {
  const receipts = new Map();
  for (const log of logs) {
    const key = log.transactionHash.toLowerCase();
    const receiptLogList = receipts.get(key)?.logs ?? [];
    if (!receiptLogList.some(existing => existing.index === log.index)) receiptLogList.push(log);
    receipts.set(key, { blockNumber: log.blockNumber, blockHash: log.blockHash, status: 1, logs: receiptLogList });
  }
  return {
    requested: [],
    async getBlock(tag) {
      if (tag === "finalized") return { number: finalizedBlock, hash: blockHash(finalizedBlock), timestamp: 1_735_689_600 };
      return { number: tag, hash: blockHashOverrides.get(tag) ?? blockHash(tag), timestamp: 1_704_067_200 + tag * 60 };
    },
    async getLogs(filter) {
      this.requested.push(filter);
      assert.equal(filter.address.toLowerCase(), vault.toLowerCase());
      assert.deepEqual(filter.topics, [history.INCOME_WITHDRAWN_TOPIC]);
      if (failedRanges.some(range => range.fromBlock === filter.fromBlock && range.toBlock === filter.toBlock)) throw new Error("fixture range unavailable");
      return logs.filter(log => log.blockNumber >= filter.fromBlock && log.blockNumber <= filter.toBlock);
    },
    async getTransactionReceipt(hash) {
      const receipt = receipts.get(hash.toLowerCase());
      return receiptOverrides.get(hash.toLowerCase()) ?? receipt ?? null;
    },
  };
}

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
};

await test("IncomeWithdrawn fields and WLD 18-decimal / USDC 6-decimal amounts stay exact", async () => {
  const wldGross = 1_234_567_890_123_456_789n;
  const wldFee = 123_456_789_012_345_678n;
  const usdcGross = 1_234_567n;
  const usdcFee = 12_345n;
  const logs = [
    historyLog(wldGross, wldFee, wldGross - wldFee, { blockNumber: 101 }),
    historyLog(usdcGross, usdcFee, usdcGross - usdcFee, { blockNumber: 102 }),
  ];
  const page = await history.readIncomeHistoryPage(providerFixture({ logs }), { vault, fromBlock: 100, toBlock: 110, retryDelayMs: 0 });
  assert.equal(page.failed.length, 0);
  assert.equal(page.entries.length, 2);
  assert.deepEqual(page.entries.map(entry => [entry.gross, entry.fee, entry.net]), [
    [usdcGross, usdcFee, usdcGross - usdcFee], [wldGross, wldFee, wldGross - wldFee],
  ]);
  assert.equal(history.formatExactTokenAmount(wldGross, 18), "1.234567890123456789");
  assert.equal(history.formatExactTokenAmount(usdcGross, 6), "1.234567");
});

await test("duplicate event logs deduplicate by transaction hash and log index", async () => {
  const event = historyLog(200n, 20n, 180n);
  const page = await history.readIncomeHistoryPage(providerFixture({ logs: [event, { ...event }] }), {
    vault, fromBlock: 100, toBlock: 110, retryDelayMs: 0,
  });
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0].key, `${event.transactionHash.toLowerCase()}:0`);
});

await test("receipt verification requests stay bounded within a log page", async () => {
  const logs = Array.from({ length: 20 }, (_, index) => historyLog(BigInt(index + 1), 1n, BigInt(index), {
    blockNumber: 101, transactionHash: hashFor(300 + index), index,
  }));
  const provider = providerFixture({ logs });
  const readReceipt = provider.getTransactionReceipt.bind(provider);
  let active = 0;
  let peak = 0;
  provider.getTransactionReceipt = async hash => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    try { return await readReceipt(hash); } finally { active--; }
  };
  const page = await history.readIncomeHistoryPage(provider, { vault, fromBlock: 100, toBlock: 110, retryDelayMs: 0 });
  assert.equal(page.entries.length, logs.length);
  assert.ok(peak <= 6, `receipt verification concurrency reached ${peak}`);
});

await test("deposits, principal withdrawals, ERC20 transfers and another vault are not income", async () => {
  const income = historyLog(500n, 50n, 450n);
  const noise = [
    logFrom("Deposited", [100n, 100n], { blockNumber: 101, transactionHash: hashFor(201), index: 1 }),
    logFrom("Withdrawn", [recipient, 100n], { blockNumber: 101, transactionHash: hashFor(202), index: 2 }),
    logFrom("Transfer", [vault, recipient, 100n], { blockNumber: 101, transactionHash: hashFor(203), index: 3 }),
    logFrom("IncomeWithdrawn", [recipient, 900n, 90n, 810n], { address: otherVault, blockNumber: 101, transactionHash: hashFor(204), index: 4 }),
  ];
  const provider = providerFixture({ logs: [income, ...noise] });
  const page = await history.readIncomeHistoryPage(provider, { vault, fromBlock: 100, toBlock: 110, retryDelayMs: 0 });
  assert.equal(provider.requested.length, 1);
  assert.equal(page.entries.length, 1);
  assert.equal(page.entries[0].gross, 500n);
});

await test("reorganized block hashes and nonmatching receipts are rejected", async () => {
  const reorganized = historyLog(300n, 30n, 270n, { blockNumber: 101 });
  const wrongCanonical = providerFixture({
    logs: [reorganized], blockHashOverrides: new Map([[101, blockHash(999)] ]),
  });
  const rejectedByBlock = await history.readIncomeHistoryPage(wrongCanonical, {
    vault, fromBlock: 100, toBlock: 110, retries: 1, retryDelayMs: 0,
  });
  assert.equal(rejectedByBlock.entries.length, 0);
  assert.deepEqual(rejectedByBlock.failed, [{ fromBlock: 100, toBlock: 110 }]);
  assert.equal(wrongCanonical.requested.length, 2);

  const receiptMismatch = historyLog(300n, 30n, 270n, { blockNumber: 102 });
  const badReceipt = providerFixture({
    logs: [receiptMismatch],
    receiptOverrides: new Map([[receiptMismatch.transactionHash.toLowerCase(), {
      blockNumber: 102, blockHash: blockHash(999), status: 1, logs: [receiptMismatch],
    }]]),
  });
  const rejectedByReceipt = await history.readIncomeHistoryPage(badReceipt, {
    vault, fromBlock: 100, toBlock: 110, retries: 0, retryDelayMs: 0,
  });
  assert.equal(rejectedByReceipt.entries.length, 0);
  assert.equal(rejectedByReceipt.failed.length, 1);
});

await test("incomplete block coverage stays explicit and cannot show a monthly total", async () => {
  const event = historyLog(1000n, 100n, 900n, { blockNumber: 115 });
  const provider = providerFixture({ logs: [event], failedRanges: [{ fromBlock: 100, toBlock: 109 }] });
  const page = await history.readIncomeHistoryPage(provider, {
    vault, fromBlock: 100, toBlock: 119, chunkSize: 10, retries: 0, retryDelayMs: 0,
  });
  assert.deepEqual(page.coverage, [{ fromBlock: 110, toBlock: 119 }]);
  assert.deepEqual(page.failed, [{ fromBlock: 100, toBlock: 109 }]);
  assert.equal(history.rangesCover(page.coverage, 100, 119), false);
  assert.deepEqual(history.uncoveredBlockRanges(page.coverage, 100, 119), [{ fromBlock: 100, toBlock: 109 }]);
  const partialGroup = history.groupIncomeReceiptsByMonth(page.entries, false, 1_767_225_600)[0];
  assert.equal(partialGroup.completeTotal, null);
  assert.equal(partialGroup.inProgress, false);
  const completeGroup = history.groupIncomeReceiptsByMonth(page.entries, true, 1_767_225_600)[0];
  assert.deepEqual(completeGroup.completeTotal, { gross: 1000n, fee: 100n, net: 900n });
});

await test("receipts group by UTC month and only closed complete months get exact totals", () => {
  const base = {
    key: "month-fixture",
    vault,
    recipient,
    gross: 1_250_000n,
    fee: 125_000n,
    net: 1_125_000n,
    blockNumber: 101,
    blockHash: blockHash(101),
    transactionHash: hashFor(401),
    transactionIndex: 0,
    logIndex: 0,
    timestamp: Date.parse("2024-01-01T00:00:00Z") / 1000,
  };
  const entries = [
    { ...base, key: "jan", timestamp: Date.parse("2024-01-20T00:00:00Z") / 1000 },
    { ...base, key: "feb", transactionHash: hashFor(402), timestamp: Date.parse("2024-02-20T00:00:00Z") / 1000 },
  ];
  const finalizedTimestamp = Date.parse("2024-03-01T00:00:00Z") / 1000;
  const complete = history.groupIncomeReceiptsByMonth(entries, true, finalizedTimestamp);
  assert.deepEqual(complete.map(group => group.month), ["2024-02", "2024-01"]);
  assert.deepEqual(complete[0].completeTotal, { gross: 1_250_000n, fee: 125_000n, net: 1_125_000n });
  assert.deepEqual(complete[1].completeTotal, { gross: 1_250_000n, fee: 125_000n, net: 1_125_000n });
  const partial = history.groupIncomeReceiptsByMonth(entries, false, finalizedTimestamp);
  assert.ok(partial.every(group => group.completeTotal === null));
});

await test("a finalized boundary must be available before it can authorize history totals", async () => {
  await assert.rejects(history.readFinalizedBoundary({ getBlock: async () => { throw new Error("unsupported tag"); } }),
    error => error instanceof history.FinalityUnavailableError);
  const boundary = await history.readFinalizedBoundary(providerFixture({ finalizedBlock: 250 }));
  assert.equal(boundary.blockNumber, 250);
  assert.equal(boundary.hash, blockHash(250));
});

await test("a canonical income event outside the requested block page cannot expand coverage", async () => {
  const event = historyLog(100n, 10n, 90n, { blockNumber: 111 });
  const provider = providerFixture({ logs: [event] });
  provider.getLogs = async () => [event];
  const page = await history.readIncomeHistoryPage(provider, { vault, fromBlock: 100, toBlock: 110, retries: 0 });
  assert.equal(page.entries.length, 0);
  assert.equal(page.coverage.length, 0);
  assert.deepEqual(page.failed, [{ fromBlock: 100, toBlock: 110 }]);
});

console.log(`${passed} passed, 0 failed`);
