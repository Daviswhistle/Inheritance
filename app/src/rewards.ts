import { isAddress } from "ethers";
import { WLD_ADDRESS, CHAIN_ID } from "./config";

export type WldRewards = {
  cumulative: bigint; claimed: bigint; claimable: bigint; pending: bigint; proof: string[];
};
const empty = (): WldRewards => ({ cumulative: 0n, claimed: 0n, claimable: 0n, pending: 0n, proof: [] });
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid rewards response.");
  return value as Record<string, unknown>;
};
const amount = (value: unknown): bigint => {
  if (typeof value !== "string" || !/^\d{1,63}$/.test(value)) throw new Error("Invalid rewards amount.");
  const parsed = BigInt(value);
  if (parsed > (1n << 208n) - 1n) throw new Error("Rewards amount is outside the supported range.");
  return parsed;
};

/** External data proposes a claim; the fixed on-chain distributor proves it.
 * Reject ambiguity, other assets/chains, malformed proofs and impossible totals. */
export function parseWldRewards(data: unknown): WldRewards {
  if (!Array.isArray(data) || data.length > 32) throw new Error("Invalid rewards response.");
  let result: WldRewards | null = null;
  for (const item of data) {
    const entry = object(item);
    if (object(entry.chain).id !== CHAIN_ID) continue;
    if (!Array.isArray(entry.rewards) || entry.rewards.length > 256) throw new Error("Invalid rewards response.");
    for (const raw of entry.rewards) {
      const reward = object(raw), token = object(reward.token);
      if (typeof token.address !== "string" || token.address.toLowerCase() !== WLD_ADDRESS.toLowerCase()) continue;
      if (token.decimals !== 18 || result) throw new Error("Ambiguous WLD rewards response.");
      const cumulative = amount(reward.amount), claimed = amount(reward.claimed), pending = amount(reward.pending ?? "0");
      if (claimed > cumulative) throw new Error("Rewards changed. Refresh and try again.");
      if (!Array.isArray(reward.proofs) || reward.proofs.length > 64
        || reward.proofs.some(value => typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value))) {
        throw new Error("Invalid rewards proof.");
      }
      const proof = reward.proofs as string[];
      result = { cumulative, claimed, pending, proof, claimable: proof.length ? cumulative - claimed : 0n };
    }
  }
  return result ?? empty();
}

export async function fetchWldRewards(vault: string, signal: AbortSignal): Promise<WldRewards> {
  if (!isAddress(vault)) throw new Error("Invalid rewards vault.");
  const response = await fetch(`https://api.merkl.xyz/v4/users/${vault.toLowerCase()}/rewards?chainId=${CHAIN_ID}`, {
    signal, credentials: "omit", referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error("Rewards are temporarily unavailable. Refresh to try again.");
  return parseWldRewards(await response.json());
}
