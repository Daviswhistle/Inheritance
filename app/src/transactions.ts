import { Interface } from "ethers";
import type { AbstractProvider, Log, TransactionReceipt } from "ethers";

type Confirmation = {
  txHash?: string;
  hashType?: "transaction" | "user-operation";
  confirmations?: number;
  timeoutMs?: number;
  intervalMs?: number;
  check?: () => Promise<boolean>;
  verifyReceipt?: (receipt: TransactionReceipt) => boolean | Promise<boolean>;
};

export type ConfirmedTransactionFailureCode = "USER_OPERATION_FAILED" | "TRANSACTION_REVERTED";

/** A terminal wallet/chain result. Other confirmation errors remain ambiguous. */
export class ConfirmedTransactionFailure extends Error {
  readonly code: ConfirmedTransactionFailureCode;
  readonly txHash: string;

  constructor(
    code: ConfirmedTransactionFailureCode,
    txHash: string,
    message: string,
  ) {
    super(message);
    this.name = "ConfirmedTransactionFailure";
    this.code = code;
    this.txHash = txHash;
  }
}

function revertedReceiptMatches(error: unknown, txHash: string): boolean {
  if (!error || typeof error !== "object") return false;
  const receipt = (error as { receipt?: { status?: unknown; hash?: unknown } }).receipt;
  return receipt?.status === 0
    && typeof receipt?.hash === "string"
    && HASH.test(receipt.hash)
    && receipt.hash.toLowerCase() === txHash.toLowerCase();
}

const HASH = /^0x[0-9a-fA-F]{64}$/;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const INCOME_EVENT = new Interface([
  "event IncomeWithdrawn(address indexed to,uint256 gross,uint256 fee,uint256 net)",
]);

export type IncomeReceiptExpectation = {
  vault: string;
  factory: string;
  to: string;
  minNetAssets: bigint;
};

/** IncomeWithdrawn is emitted by the personal vault, with the bound recipient and net floor. */
export function verifyIncomeWithdrawalReceipt(
  receipt: Pick<TransactionReceipt, "logs">,
  expected: IncomeReceiptExpectation,
): boolean {
  for (const log of receipt.logs as readonly Log[]) {
    if (log.address.toLowerCase() !== expected.vault.toLowerCase()) continue;
    try {
      const parsed = INCOME_EVENT.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed) continue;
      const [to, gross, fee, net] = parsed.args as unknown as [string, bigint, bigint, bigint];
      if (
        to.toLowerCase() === expected.to.toLowerCase()
        && net >= expected.minNetAssets
        && gross > 0n
        && net > 0n
        && fee <= gross
        && gross - fee === net
      ) return true;
    } catch {
      // Ignore unrelated or malformed receipt logs.
    }
  }
  return false;
}

/** MiniKit v2 returns a user-operation hash, which has to be resolved first. */
export async function confirmTransaction(provider: AbstractProvider, options: Confirmation): Promise<boolean> {
  const { txHash, hashType = "user-operation", confirmations = 1, timeoutMs = 60_000, intervalMs = 1500, check, verifyReceipt } = options;
  if (!txHash || !HASH.test(txHash)) throw new Error("World App did not return a valid transaction identifier. Check your vault before trying again.");
  const deadline = Date.now() + timeoutMs;
  let canonicalHash = hashType === "transaction" ? txHash : "";
  while (!canonicalHash && Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(5000, Math.max(1, deadline - Date.now())));
    try {
      const response = await fetch(`https://developer.world.org/api/v2/minikit/userop/${txHash}`, { signal: controller.signal });
      if (response.ok) {
        const data = await response.json() as { status?: string; transaction_hash?: string };
        if (data.status === "success" && data.transaction_hash && HASH.test(data.transaction_hash)) canonicalHash = data.transaction_hash;
        if (data.status === "failed") {
          throw new ConfirmedTransactionFailure("USER_OPERATION_FAILED", txHash,
            "The transaction was not executed. Your vault has not been changed by this request.");
        }
      }
    } catch (error) {
      if (error instanceof ConfirmedTransactionFailure) throw error;
    } finally { clearTimeout(timer); }
    if (!canonicalHash) await pause(intervalMs);
  }
  const remaining = deadline - Date.now();
  if (!canonicalHash || remaining <= 0) throw new Error("World App is still confirming this request. Check your vault before trying again.");
  let receipt: TransactionReceipt | null;
  try {
    receipt = await provider.waitForTransaction(canonicalHash, confirmations, remaining);
  } catch (error) {
    if (revertedReceiptMatches(error, canonicalHash)) {
      throw new ConfirmedTransactionFailure("TRANSACTION_REVERTED", txHash,
        "The transaction reverted. Your vault was not changed by this request.");
    }
    throw error;
  }
  if (receipt && receipt.status === 0 && typeof receipt.hash === "string"
    && receipt.hash.toLowerCase() === canonicalHash.toLowerCase()) {
    throw new ConfirmedTransactionFailure("TRANSACTION_REVERTED", txHash,
      "The transaction reverted. Your vault was not changed by this request.");
  }
  if (!receipt || Number(receipt.status) !== 1) throw new Error("World App is still confirming this request. Check your vault before trying again.");
  if (verifyReceipt && !await verifyReceipt(receipt)) {
    throw new Error("The transaction is confirmed, but its expected on-chain record could not be verified. Check the vault before trying again.");
  }
  if (!check) return true;
  do {
    try { if (await check()) return true; } catch { /* Retry a transient read failure. */ }
    if (Date.now() >= deadline) break;
    await pause(intervalMs);
  } while (Date.now() < deadline);
  throw new Error("The transaction is confirmed, but fresh vault details are unavailable. Reopen the app to check the result.");
}
