import { ethers } from "ethers";
import { readPlanJournal, writePlanJournal, clearPlanJournal } from "./plan-storage";
import { ConfirmedTransactionFailure, confirmTransaction } from "./transactions";
import type { TxResult } from "./minikit";

export type AdditionalDeposit = {
  version: 1; chainId: 480; account: string; factory: string; vault: string;
  asset: string; symbol: "WLD" | "USDC"; decimals: number; amount: string;
  mode: "plain" | "morpho"; beforeBlock: number;
  txHash?: string; hashType?: "transaction" | "user-operation";
};
const hash = /^0x[0-9a-fA-F]{64}$/;
const key = (account: string) => `inheritance:additional-deposit:${account.toLowerCase()}`;
export function parseAdditionalDeposit(raw: string, account: string): AdditionalDeposit | null {
  try {
    const r = JSON.parse(raw) as AdditionalDeposit;
    if (r.version !== 1 || r.chainId !== 480 || !ethers.isAddress(r.account)
      || r.account.toLowerCase() !== account.toLowerCase()
      || ![r.factory, r.vault, r.asset].every(ethers.isAddress)
      || !["WLD", "USDC"].includes(r.symbol) || !["plain", "morpho"].includes(r.mode)
      || !Number.isInteger(r.decimals) || r.decimals < 0 || r.decimals > 18
      || !/^\d+$/.test(r.amount) || BigInt(r.amount) <= 0n
      || !Number.isSafeInteger(r.beforeBlock) || r.beforeBlock < 0
      || r.txHash !== undefined && (!hash.test(r.txHash) || !["transaction", "user-operation"].includes(String(r.hashType)))) return null;
    return r;
  } catch { return null; }
}
export const readAdditionalDeposit = (account: string) => readPlanJournal(key(account), raw => parseAdditionalDeposit(raw, account));
export const saveAdditionalDeposit = (r: AdditionalDeposit) => writePlanJournal(key(r.account), JSON.stringify(r));
export const clearAdditionalDeposit = (account: string) => clearPlanJournal(key(account));
const events = new ethers.Interface([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "event Deposited(uint256 assets,uint256 shares)",
]);
/** The specific receipt must prove exact account, token, vault and amount; balance growth is never evidence. */
export function verifyAdditionalDeposit(receipt: Pick<ethers.TransactionReceipt, "logs" | "blockNumber">, r: AdditionalDeposit): boolean {
  if (receipt.blockNumber <= r.beforeBlock) return false;
  let transferred = false, deposited = r.mode === "plain";
  for (const log of receipt.logs) {
    try {
      const e = events.parseLog({ topics: [...log.topics], data: log.data });
      if (e?.name === "Transfer" && log.address.toLowerCase() === r.asset.toLowerCase()
        && String(e.args.from).toLowerCase() === r.account.toLowerCase()
        && String(e.args.to).toLowerCase() === r.vault.toLowerCase()
        && BigInt(e.args.value) === BigInt(r.amount)) transferred = true;
      if (e?.name === "Deposited" && log.address.toLowerCase() === r.vault.toLowerCase()
        && BigInt(e.args.assets) === BigInt(r.amount) && BigInt(e.args.shares) > 0n) deposited = true;
    } catch { /* unrelated logs */ }
  }
  return transferred && deposited;
}

export async function confirmAdditionalDeposit(provider: ethers.AbstractProvider, request: AdditionalDeposit,
  options: { timeoutMs?: number; intervalMs?: number } = {}) {
  if ((await provider.getNetwork()).chainId !== 480n) throw new Error("Deposit confirmation requires World Chain.");
  if (!request.txHash) throw new Error("The deposit result is unknown. No new deposit was sent.");
  await confirmTransaction(provider, { ...options, txHash: request.txHash, hashType: request.hashType,
    verifyReceipt: receipt => verifyAdditionalDeposit(receipt, request) });
}

/** Strictly persist BEFORE the wallet call. Only a structured non-submission or a
 * verified terminal failure may unlock a retry. Throws/timeouts keep the journal. */
export async function submitAdditionalDeposit(request: AdditionalDeposit, ports: {
  read: () => Promise<AdditionalDeposit | null>;
  save: (r: AdditionalDeposit) => Promise<void>; clear: () => Promise<void>;
  send: () => Promise<TxResult>; confirm: (r: AdditionalDeposit) => Promise<void>;
}): Promise<boolean> {
  if (await ports.read()) throw new Error("The deposit result is unknown. No new deposit was sent.");
  await ports.save(request);
  const sent = await ports.send();
  if (!sent.ok) {
    if (sent.definitelyNotSubmitted) await ports.clear();
    throw new Error(sent.error);
  }
  // SDKs may coerce a missing identifier to an empty string. Preserve the valid
  // pre-send journal rather than writing an unreadable recovery record.
  const submitted = typeof sent.tx.hash === "string" && hash.test(sent.tx.hash)
    ? { ...request, txHash: sent.tx.hash, hashType: sent.tx.hashType } : request;
  await ports.save(submitted);
  try { await ports.confirm(submitted); }
  catch (error) {
    if (error instanceof ConfirmedTransactionFailure && submitted.txHash
      && error.txHash.toLowerCase() === submitted.txHash.toLowerCase()) await ports.clear();
    throw error;
  }
  await ports.clear();
  return true;
}
