import { ethers } from "ethers";
import { readPlanJournal, replacePlanJournal } from "./plan-storage";
import { ConfirmedTransactionFailure, confirmTransaction } from "./transactions";
import type { TxResult } from "./minikit";

/** An approval may execute even when its response never reaches this device. */
export type OwnerWithdrawal = {
  version: 1; requestId: string; chainId: 480; account: string; factory: string; vault: string;
  asset: string; symbol: "WLD" | "USDC"; decimals: number; recipient: string;
  mode: "plain" | "morpho"; kind: "partial" | "all";
  amount: string; minNetAssets: string; beforeBlock: number;
  txHash?: string; hashType?: "transaction" | "user-operation";
};
const hash = /^0x[0-9a-fA-F]{64}$/;
const positiveAddress = (value: string) => ethers.isAddress(value) && value.toLowerCase() !== ethers.ZeroAddress;
const uint = (value: unknown): value is string => typeof value === "string" && /^\d+$/.test(value);
const key = (account: string) => `inheritance:owner-withdrawal:${account.toLowerCase()}`;
export const WITHDRAWAL_UNRESOLVED = "Your previous withdrawal has not been confirmed yet. Check its result before making another withdrawal.";

export function parseOwnerWithdrawal(raw: string, account: string): OwnerWithdrawal | null {
  try {
    const r = JSON.parse(raw) as OwnerWithdrawal;
    if (r.version !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(r.requestId) || r.chainId !== 480 || !positiveAddress(r.account)
      || r.account.toLowerCase() !== account.toLowerCase()
      || ![r.factory, r.vault, r.asset, r.recipient].every(positiveAddress)
      || !["WLD", "USDC"].includes(r.symbol) || !["plain", "morpho"].includes(r.mode)
      || !["partial", "all"].includes(r.kind) || r.mode === "plain" && (r.kind !== "partial" || r.symbol !== "WLD")
      || !Number.isInteger(r.decimals) || r.decimals < 0 || r.decimals > 18
      || !uint(r.amount) || BigInt(r.amount) <= 0n || !uint(r.minNetAssets)
      || r.kind === "all" && BigInt(r.minNetAssets) <= 0n
      || r.kind === "partial" && r.minNetAssets !== "0"
      || !Number.isSafeInteger(r.beforeBlock) || r.beforeBlock < 0
      || r.txHash !== undefined && (!hash.test(r.txHash) || !["transaction", "user-operation"].includes(String(r.hashType)))) return null;
    return r;
  } catch { return null; }
}
export const readOwnerWithdrawal = (account: string) => readPlanJournal(key(account), raw => parseOwnerWithdrawal(raw, account));
export async function saveOwnerWithdrawal(r: OwnerWithdrawal, previous: OwnerWithdrawal | null) {
  if (!await replacePlanJournal(key(r.account), previous && JSON.stringify(previous), JSON.stringify(r))) {
    throw new Error(WITHDRAWAL_UNRESOLVED);
  }
}
export async function clearOwnerWithdrawal(r: OwnerWithdrawal) {
  if (!await replacePlanJournal(key(r.account), JSON.stringify(r), null)) throw new Error(WITHDRAWAL_UNRESOLVED);
}

const events = new ethers.Interface([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "event OwnerWithdrawnWLD(address indexed to,uint256 amount)",
  "event OwnerWithdrawnAsset(address indexed to,uint256 amount)",
  "event PerformanceFeePaid(address indexed recipient,uint256 assets,uint256 shares)",
]);

/** Prove the original vault's payout and gross amount (including its fee),
 * rather than attributing any later balance movement to this request. */
export function verifyOwnerWithdrawal(receipt: Pick<ethers.TransactionReceipt, "logs" | "blockNumber">, r: OwnerWithdrawal): boolean {
  if (receipt.blockNumber <= r.beforeBlock) return false;
  const payouts: bigint[] = [], transfers: bigint[] = [];
  let fee = 0n;
  for (const log of receipt.logs) {
    try {
      const e = events.parseLog({ topics: [...log.topics], data: log.data });
      if (!e) continue;
      if (log.address.toLowerCase() === r.vault.toLowerCase()) {
        if (e.name === (r.symbol === "USDC" ? "OwnerWithdrawnAsset" : "OwnerWithdrawnWLD")
          && String(e.args.to).toLowerCase() === r.recipient.toLowerCase()) payouts.push(BigInt(e.args.amount));
        if (e.name === "PerformanceFeePaid") {
          if (BigInt(e.args.shares) !== 0n) return false;
          fee += BigInt(e.args.assets);
        }
      }
      if (e.name === "Transfer" && log.address.toLowerCase() === r.asset.toLowerCase()
        && String(e.args.from).toLowerCase() === r.vault.toLowerCase()
        && String(e.args.to).toLowerCase() === r.recipient.toLowerCase()) transfers.push(BigInt(e.args.value));
    } catch { /* unrelated logs */ }
  }
  if (payouts.length !== 1 || payouts[0] <= 0n || !transfers.includes(payouts[0])) return false;
  return r.kind === "all" ? payouts[0] >= BigInt(r.minNetAssets)
    : payouts[0] + fee === BigInt(r.amount) && (r.mode === "morpho" || fee === 0n);
}

export async function confirmOwnerWithdrawal(provider: ethers.AbstractProvider, request: OwnerWithdrawal,
  options: { timeoutMs?: number; intervalMs?: number } = {}) {
  if ((await provider.getNetwork()).chainId !== 480n) throw new Error("Withdrawal confirmation requires World Chain.");
  if (!request.txHash) throw new Error(WITHDRAWAL_UNRESOLVED);
  await confirmTransaction(provider, { ...options, txHash: request.txHash, hashType: request.hashType,
    verifyReceipt: receipt => verifyOwnerWithdrawal(receipt, request) });
}

export async function submitOwnerWithdrawal(request: OwnerWithdrawal, ports: {
  read: () => Promise<OwnerWithdrawal | null>;
  save: (r: OwnerWithdrawal, previous: OwnerWithdrawal | null) => Promise<void>;
  clear: (r: OwnerWithdrawal) => Promise<void>;
  send: () => Promise<TxResult>; confirm: (r: OwnerWithdrawal) => Promise<void>;
}): Promise<void> {
  if (await ports.read()) throw new Error(WITHDRAWAL_UNRESOLVED);
  await ports.save(request, null);
  const sent = await ports.send();
  if (!sent.ok) {
    if (sent.definitelyNotSubmitted) await ports.clear(request);
    throw new Error(sent.error);
  }
  const submitted = typeof sent.tx.hash === "string" && hash.test(sent.tx.hash)
    ? { ...request, txHash: sent.tx.hash, hashType: sent.tx.hashType } : request;
  await ports.save(submitted, request);
  try { await ports.confirm(submitted); }
  catch (error) {
    if (error instanceof ConfirmedTransactionFailure && submitted.txHash
      && error.txHash.toLowerCase() === submitted.txHash.toLowerCase()) await ports.clear(submitted);
    throw error;
  }
  await ports.clear(submitted);
}
