import { ethers } from "ethers";

export type BlockRange = { fromBlock: number; toBlock: number };

export type IncomeReceipt = {
  key: string;
  vault: string;
  recipient: string;
  gross: bigint;
  fee: bigint;
  net: bigint;
  blockNumber: number;
  blockHash: string;
  transactionHash: string;
  transactionIndex: number;
  logIndex: number;
  timestamp: number;
};

export type IncomeHistoryPage = {
  entries: IncomeReceipt[];
  coverage: BlockRange[];
  failed: BlockRange[];
  errors: string[];
};

export type FinalizedBoundary = { blockNumber: number; timestamp: number; hash: string };

type Provider = Pick<ethers.JsonRpcProvider, "getBlock" | "getLogs" | "getTransactionReceipt">;

const INCOME_EVENT_INTERFACE = new ethers.Interface([
  "event IncomeWithdrawn(address indexed to, uint256 gross, uint256 fee, uint256 net)",
]);
export const INCOME_WITHDRAWN_TOPIC = INCOME_EVENT_INTERFACE.getEvent("IncomeWithdrawn")!.topicHash;

export class FinalityUnavailableError extends Error {
  constructor() {
    super("A finalized block boundary is unavailable.");
    this.name = "FinalityUnavailableError";
  }
}

export async function readFinalizedBoundary(provider: Provider): Promise<FinalizedBoundary> {
  try {
    const block = await provider.getBlock("finalized");
    if (!block || !Number.isInteger(block.number) || !block.hash || !Number.isInteger(block.timestamp)) {
      throw new FinalityUnavailableError();
    }
    return { blockNumber: block.number, timestamp: block.timestamp, hash: block.hash };
  } catch {
    throw new FinalityUnavailableError();
  }
}

async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await map(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
}

function normalizedAddress(value: string): string {
  return value.toLowerCase();
}

function normalizedHex(value: string): string {
  return value.toLowerCase();
}

function getLogIndex(log: { index?: number; logIndex?: number }): number | null {
  const value = Number.isInteger(log.index) ? log.index : log.logIndex;
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function sameReceiptLog(a: {
  address: string; topics: readonly string[]; data: string; blockHash: string | null; transactionHash: string | null;
  index?: number; logIndex?: number;
}, b: {
  address: string; topics: readonly string[]; data: string; blockHash: string | null; transactionHash: string | null;
  index?: number; logIndex?: number;
}): boolean {
  return normalizedAddress(a.address) === normalizedAddress(b.address)
    && getLogIndex(a) === getLogIndex(b)
    && normalizedHex(a.data) === normalizedHex(b.data)
    && normalizedHex(a.blockHash ?? "") === normalizedHex(b.blockHash ?? "")
    && normalizedHex(a.transactionHash ?? "") === normalizedHex(b.transactionHash ?? "")
    && a.topics.length === b.topics.length
    && a.topics.every((topic, index) => normalizedHex(topic) === normalizedHex(b.topics[index]));
}

function sameIncomeReceipt(a: IncomeReceipt, b: IncomeReceipt): boolean {
  return a.vault.toLowerCase() === b.vault.toLowerCase()
    && a.recipient.toLowerCase() === b.recipient.toLowerCase()
    && a.gross === b.gross && a.fee === b.fee && a.net === b.net
    && a.blockNumber === b.blockNumber && a.blockHash.toLowerCase() === b.blockHash.toLowerCase()
    && a.transactionHash.toLowerCase() === b.transactionHash.toLowerCase()
    && a.transactionIndex === b.transactionIndex && a.logIndex === b.logIndex && a.timestamp === b.timestamp;
}

async function verifyIncomeLog(provider: Provider, vault: string, log: {
  address: string; topics: readonly string[]; data: string; blockNumber: number | null; blockHash: string | null;
  transactionHash: string | null; transactionIndex: number | null; index?: number; logIndex?: number; removed?: boolean;
}): Promise<IncomeReceipt | null> {
  // eth_getLogs is requested with this exact topic. Ignore unrelated logs even if an
  // RPC fixture or proxy returns a broader result than requested.
  if (normalizedAddress(log.address) !== normalizedAddress(vault)
    || normalizedHex(log.topics[0] ?? "") !== normalizedHex(INCOME_WITHDRAWN_TOPIC)) return null;
  const logIndex = getLogIndex(log);
  if (log.removed || !Number.isInteger(log.blockNumber) || !isHex(log.blockHash) || !isHex(log.transactionHash)
    || !Number.isInteger(log.transactionIndex) || logIndex === null || !isHex(log.data)) {
    throw new Error("Income log is incomplete or marked removed.");
  }
  const blockNumber = Number(log.blockNumber);
  const txHash = log.transactionHash;
  const [block, receipt] = await Promise.all([
    provider.getBlock(blockNumber),
    provider.getTransactionReceipt(txHash),
  ]);
  if (!block || !block.hash || normalizedHex(block.hash) !== normalizedHex(log.blockHash)) {
    throw new Error("Income log block hash is not canonical.");
  }
  if (!receipt || Number(receipt.status) !== 1 || receipt.blockNumber !== blockNumber
    || normalizedHex(receipt.blockHash ?? "") !== normalizedHex(block.hash)
    || !receipt.logs.some(receiptLog => sameReceiptLog(receiptLog, log))) {
    throw new Error("Income log does not match a successful canonical receipt.");
  }
  const parsed = INCOME_EVENT_INTERFACE.parseLog({ topics: [...log.topics], data: log.data });
  if (!parsed) throw new Error("Income log does not decode as IncomeWithdrawn.");
  const recipient = ethers.getAddress(String(parsed.args.to));
  return {
    key: `${txHash.toLowerCase()}:${logIndex}`,
    vault: ethers.getAddress(vault),
    recipient,
    gross: BigInt(parsed.args.gross),
    fee: BigInt(parsed.args.fee),
    net: BigInt(parsed.args.net),
    blockNumber,
    blockHash: block.hash,
    transactionHash: txHash,
    transactionIndex: Number(log.transactionIndex),
    logIndex,
    timestamp: block.timestamp,
  };
}

function sortEntries(entries: IncomeReceipt[]): IncomeReceipt[] {
  return entries.sort((a, b) => b.blockNumber - a.blockNumber
    || b.transactionIndex - a.transactionIndex || b.logIndex - a.logIndex);
}

export function mergeIncomeReceipts(...groups: readonly IncomeReceipt[][]): IncomeReceipt[] {
  const byKey = new Map<string, IncomeReceipt>();
  for (const entry of groups.flat()) {
    const previous = byKey.get(entry.key);
    if (previous && !sameIncomeReceipt(previous, entry)) {
      throw new Error(`Conflicting income logs share receipt key ${entry.key}.`);
    }
    if (!previous) byKey.set(entry.key, entry);
  }
  return sortEntries([...byKey.values()]);
}

export function mergeBlockRanges(ranges: readonly BlockRange[]): BlockRange[] {
  const sorted = ranges.filter(range => Number.isInteger(range.fromBlock) && Number.isInteger(range.toBlock)
    && range.fromBlock >= 0 && range.toBlock >= range.fromBlock)
    .map(range => ({ ...range })).sort((a, b) => a.fromBlock - b.fromBlock || a.toBlock - b.toBlock);
  const merged: BlockRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.fromBlock <= last.toBlock + 1) last.toBlock = Math.max(last.toBlock, range.toBlock);
    else merged.push(range);
  }
  return merged;
}

export function rangesCover(ranges: readonly BlockRange[], fromBlock: number, toBlock: number): boolean {
  if (toBlock < fromBlock) return true;
  return mergeBlockRanges(ranges).some(range => range.fromBlock <= fromBlock && range.toBlock >= toBlock);
}

export function uncoveredBlockRanges(ranges: readonly BlockRange[], fromBlock: number, toBlock: number): BlockRange[] {
  if (toBlock < fromBlock) return [];
  const result: BlockRange[] = [];
  let next = fromBlock;
  for (const range of mergeBlockRanges(ranges)) {
    if (range.toBlock < next) continue;
    if (range.fromBlock > toBlock) break;
    if (range.fromBlock > next) result.push({ fromBlock: next, toBlock: Math.min(toBlock, range.fromBlock - 1) });
    next = Math.max(next, range.toBlock + 1);
    if (next > toBlock) break;
  }
  if (next <= toBlock) result.push({ fromBlock: next, toBlock });
  return result;
}

export async function readIncomeHistoryPage(provider: Provider, {
  vault,
  fromBlock,
  toBlock,
  chunkSize = 90,
  retries = 2,
  retryDelayMs = 150,
}: {
  vault: string;
  fromBlock: number;
  toBlock: number;
  chunkSize?: number;
  retries?: number;
  retryDelayMs?: number;
}): Promise<IncomeHistoryPage> {
  if (!ethers.isAddress(vault) || ethers.getAddress(vault) === ethers.ZeroAddress) throw new Error("A nonzero vault address is required.");
  if (!Number.isInteger(fromBlock) || !Number.isInteger(toBlock) || fromBlock < 0 || toBlock < fromBlock) {
    throw new Error("An inclusive block range is required.");
  }
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 90) throw new Error("Log chunks must be between 1 and 90 blocks.");
  const chunks: BlockRange[] = [];
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    chunks.push({ fromBlock: start, toBlock: Math.min(toBlock, start + chunkSize - 1) });
  }
  const result: IncomeHistoryPage = { entries: [], coverage: [], failed: [], errors: [] };
  let cursor = 0;
  const worker = async () => {
    while (cursor < chunks.length) {
      const range = chunks[cursor++];
      let completed = false;
      let lastError = "History block range could not be verified.";
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const logs = await provider.getLogs({
            address: ethers.getAddress(vault),
            topics: [INCOME_WITHDRAWN_TOPIC],
            fromBlock: range.fromBlock,
            toBlock: range.toBlock,
          });
          const verified = (await mapWithConcurrency(logs, 6, log => verifyIncomeLog(provider, vault, log)))
            .filter((entry): entry is IncomeReceipt => entry !== null);
          if (verified.some(entry => entry.blockNumber < range.fromBlock || entry.blockNumber > range.toBlock)) {
            throw new Error("Income log is outside the requested coverage.");
          }
          const merged = mergeIncomeReceipts(verified);
          result.entries.push(...merged);
          result.coverage.push(range);
          completed = true;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : lastError;
          if (attempt < retries && retryDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, retryDelayMs * (attempt + 1)));
          }
        }
      }
      if (!completed) {
        result.failed.push(range);
        result.errors.push(lastError);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, () => worker()));
  result.entries = mergeIncomeReceipts(result.entries);
  result.coverage = mergeBlockRanges(result.coverage);
  result.failed = mergeBlockRanges(result.failed);
  return result;
}

export function formatExactTokenAmount(amount: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return amount.toString();
  const formatted = ethers.formatUnits(amount, decimals);
  if (!formatted.includes(".")) return formatted;
  return formatted.replace(/0+$/, "").replace(/\.$/, "");
}

export type IncomeMonthGroup = {
  month: string;
  entries: IncomeReceipt[];
  completeTotal: { gross: bigint; fee: bigint; net: bigint } | null;
  inProgress: boolean;
};

export function groupIncomeReceiptsByMonth(entries: readonly IncomeReceipt[], complete: boolean, finalizedTimestamp: number): IncomeMonthGroup[] {
  const finalizedMonth = new Date(finalizedTimestamp * 1000).toISOString().slice(0, 7);
  const groups = new Map<string, IncomeReceipt[]>();
  for (const entry of sortEntries([...entries])) {
    const month = new Date(entry.timestamp * 1000).toISOString().slice(0, 7);
    const current = groups.get(month) ?? [];
    current.push(entry);
    groups.set(month, current);
  }
  return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([month, monthEntries]) => ({
    month,
    entries: monthEntries,
    completeTotal: complete && month < finalizedMonth ? monthEntries.reduce((total, entry) => ({
      gross: total.gross + entry.gross,
      fee: total.fee + entry.fee,
      net: total.net + entry.net,
    }), { gross: 0n, fee: 0n, net: 0n }) : null,
    inProgress: month === finalizedMonth,
  }));
}
