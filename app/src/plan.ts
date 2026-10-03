export type PlanAssetSymbol = "WLD" | "USDC";

export type PlanRoute<TDetails = unknown> = {
  symbol: PlanAssetSymbol;
  asset: string;
  decimals: number;
  factory: string;
  mode: "morpho" | "plain";
  details: TDetails;
};

/** Keep non-day contract intervals visible without rounding away seconds. */
export function formatPlanInterval(seconds: bigint): string {
  const days = seconds / 86400n, remainder = seconds % 86400n;
  return `${days} days${remainder ? ` + ${remainder} ${remainder === 1n ? "second" : "seconds"}` : ""}`;
}

/** New plans use each configured Morpho route; WLD falls back to the basic vault. */
export function buildPlanRoutes<TDetails>(
  yieldRoutes: readonly PlanRoute<TDetails>[],
  wldFallback: PlanRoute<TDetails>,
  usdcEnabled: boolean,
): PlanRoute<TDetails>[] {
  if (wldFallback.symbol !== "WLD" || wldFallback.mode !== "plain") {
    throw new Error("The WLD fallback route must be a basic WLD vault.");
  }
  const wld = yieldRoutes.find(route => route.symbol === "WLD") ?? wldFallback;
  const usdc = yieldRoutes.find(route => route.symbol === "USDC");
  if (usdcEnabled && !usdc) throw new Error("USDC is enabled without a configured vault route.");
  return [wld, ...(usdcEnabled && usdc ? [usdc] : [])];
}

/** Parse an exact decimal amount without converting through floating point. */
export function parseAssetAmount(value: string, decimals: number): bigint | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null;
  const input = value.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(input)) return null;
  const [whole, fraction = ""] = input.split(".");
  if (fraction.length > decimals) return null;
  const scale = 10n ** BigInt(decimals);
  const fractionalUnits = BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  return BigInt(whole || "0") * scale + fractionalUnits;
}

export type PlanStep<T> = { key: string; value: T };

/** Run only unfinished asset steps; completed work survives a later wallet rejection. */
export async function runRemainingPlanSteps<T>(
  steps: readonly PlanStep<T>[],
  isComplete: (key: string) => boolean,
  execute: (value: T) => Promise<void>,
  onComplete: (key: string) => Promise<void> | void,
): Promise<void> {
  for (const step of steps) {
    if (isComplete(step.key)) continue;
    await execute(step.value);
    await onComplete(step.key);
  }
}

const TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * Scan every block after the saved pre-request boundary and return only one receipt
 * that proves the expected canonical request. A failed range or receipt read stays
 * unresolved; choosing among multiple matching receipts would be unsafe.
 */
export async function findUniquePlanReceipt<
  TLog extends { transactionHash: string },
  TReceipt extends { hash: string; status: unknown },
>(
  beforeBlock: unknown,
  getBlockNumber: () => Promise<number>,
  getLogs: (fromBlock: number, toBlock: number) => Promise<readonly TLog[]>,
  getReceipt: (transactionHash: string) => Promise<TReceipt | null>,
  isExpectedEvent: (log: TLog) => boolean,
  verifiesRequest: (receipt: TReceipt) => boolean,
): Promise<TReceipt | null> {
  if (typeof beforeBlock !== "number" || !Number.isSafeInteger(beforeBlock) || beforeBlock < 0) {
    throw new Error("The saved request start block is missing or invalid.");
  }
  const head = await getBlockNumber();
  if (!Number.isSafeInteger(head) || head < 0) throw new Error("The current block number is invalid.");

  const candidates = new Set<string>();
  for (let from = beforeBlock + 1; from <= head; from += 100) {
    const to = Math.min(head, from + 99);
    for (const log of await getLogs(from, to)) {
      if (!isExpectedEvent(log)) continue;
      if (!TRANSACTION_HASH.test(log.transactionHash)) {
        throw new Error("A matching event has no valid transaction identifier.");
      }
      candidates.add(log.transactionHash.toLowerCase());
    }
  }

  const matches: TReceipt[] = [];
  for (const transactionHash of candidates) {
    const receipt = await getReceipt(transactionHash);
    if (!receipt) throw new Error("A matching event has no available receipt yet.");
    if (!TRANSACTION_HASH.test(receipt.hash) || receipt.hash.toLowerCase() !== transactionHash) {
      throw new Error("A matching event returned a different transaction receipt.");
    }
    if (receipt.status === 0 || receipt.status === 0n) continue;
    if (receipt.status !== 1 && receipt.status !== 1n) {
      throw new Error("A matching receipt has no verified success status.");
    }
    if (verifiesRequest(receipt)) matches.push(receipt);
  }

  if (matches.length > 1) {
    throw new Error("More than one canonical receipt matches this saved request.");
  }
  return matches[0] ?? null;
}
