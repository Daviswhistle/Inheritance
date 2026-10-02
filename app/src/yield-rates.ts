import { isAddress } from "ethers";
import { CHAIN_ID, MORPHO_VAULT_ADDRESS, WLD_ADDRESS } from "./config";

export type YieldRates = { lendingApr: number; rewardApr: number; reportedAt: number; campaignEndsAt: number };
export const RATE_MAX_AGE_SECONDS = 36 * 60 * 60;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Rates are unavailable.");
  return value as Record<string, unknown>;
};
const percent = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10_000) throw new Error("Rates are unavailable.");
  return value;
};
const timestamp = (value: unknown): number => {
  if (typeof value !== "string" || !/^\d{1,12}$/.test(value)) throw new Error("Rates are unavailable.");
  return Number(value);
};

/** Display-only public rates. Never add the separate verified-human campaign,
 * accept another chain/strategy/reward asset, or turn a stale quote into a promise. */
export function parseYieldRates(data: unknown, now: number, strategy = MORPHO_VAULT_ADDRESS, token = WLD_ADDRESS): YieldRates {
  if (!Array.isArray(data) || data.length > 32 || !isAddress(strategy) || !isAddress(token)) throw new Error("Rates are unavailable.");
  const matches = data.map(object).filter(item => item.chainId === CHAIN_ID && item.type === "MORPHOVAULT"
    && typeof item.identifier === "string" && item.identifier.toLowerCase() === strategy.toLowerCase());
  if (matches.length !== 1) throw new Error("Rates are unavailable.");
  const item = matches[0], native = object(item.nativeAprRecord), rewards = object(item.aprRecord);
  const nativeAt = timestamp(native.timestamp), rewardAt = timestamp(rewards.timestamp);
  const reportedAt = Math.min(nativeAt, rewardAt), campaignEndsAt = timestamp(item.latestCampaignEnd);
  if (item.status !== "LIVE" || campaignEndsAt <= now || Math.max(nativeAt, rewardAt) > now + 300
    || now - reportedAt > RATE_MAX_AGE_SECONDS) throw new Error("Rates are unavailable.");
  const breakdowns = object(item.rewardsRecord).breakdowns;
  if (!Array.isArray(breakdowns) || !breakdowns.length || breakdowns.length > 64) throw new Error("Rates are unavailable.");
  for (const breakdown of breakdowns) {
    const rewardToken = object(object(breakdown).token);
    if (rewardToken.chainId !== CHAIN_ID || rewardToken.decimals !== 18 || typeof rewardToken.address !== "string"
      || rewardToken.address.toLowerCase() !== token.toLowerCase()) throw new Error("Rates are unavailable.");
  }
  // Use the dated records rather than mixing undated top-level totals.
  return { lendingApr: percent(native.value), rewardApr: percent(rewards.cumulated), reportedAt, campaignEndsAt };
}

export function formatRate(value: number): string {
  if (value > 0 && value < 0.01) return "<0.01%";
  return `${value.toFixed(2)}%`;
}

export async function fetchYieldRates(signal: AbortSignal, strategy = MORPHO_VAULT_ADDRESS): Promise<YieldRates> {
  const response = await fetch(`https://api.merkl.xyz/v4/opportunities?chainId=${CHAIN_ID}&identifier=${strategy}`, {
    signal, credentials: "omit", referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error("Rates are unavailable.");
  return parseYieldRates(await response.json(), Math.floor(Date.now() / 1000), strategy);
}
