import { ethers } from "ethers";
import { yieldRouteFor } from "./assets";
import { WLD_ADDRESS } from "./config";
import { ownerInheritancePositions, type SettingsTarget } from "./inheritance";
import { minimumOutput, readExitPosition } from "./yield";

export type ExitAmounts = {
  gross: string; net: string; fee: string; minNet: string; shares: string;
  rewards: string; rewardFee: string; minRewards: string; hasAssets: boolean; claimFiledAt: string; rewardsUnknown?: boolean;
};
export class PlanExitError extends Error {
  code: "unavailable" | "liquidity" | "empty";
  constructor(code: "unavailable" | "liquidity" | "empty") { super(code); this.code = code; }
}
const tokenAbi = ["function balanceOf(address) view returns (uint256)"];
const transfer = new ethers.Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);

export async function readExitTargets(provider: ethers.JsonRpcProvider, account: string): Promise<SettingsTarget[]> {
  const rows = (await ownerInheritancePositions(provider, account)).filter(p => p.claimedAt === 0n);
  if (!rows.length || rows.every(p => !p.hasAssets && p.heir.toLowerCase() === account.toLowerCase())) throw new PlanExitError("empty");
  return Promise.all(rows.map(async p => {
    if (p.owner.toLowerCase() !== account.toLowerCase() || !yieldRouteFor(p.factory) && p.amount === null) throw new PlanExitError("unavailable");
    const route = yieldRouteFor(p.factory);
    let gross = p.amount ?? 0n, net = p.amount ?? 0n, fee = 0n, shares = 0n, rewards = 0n, rewardFee = 0n, rewardsUnknown = false;
    if (route) {
      const child = new ethers.Contract(p.address, route.vaultAbi, provider);
      const result = await readExitPosition<{ valued: boolean; gross: bigint; net: bigint; fee: bigint; shares: bigint }>({
        position: () => child.position(), principalPosition: () => child.principalPosition(),
      });
      const quote = result.quote; rewardsUnknown = result.rewardsUnknown;
      if (!quote.valued) throw new PlanExitError("unavailable");
      gross = BigInt(quote.gross); net = BigInt(quote.net); fee = BigInt(quote.fee); shares = BigInt(quote.shares);
      if (shares > 0n) {
        // A maxRedeem quote may round down even when every share can redeem.
        // eth_call rehearses the exact redemption without moving any assets.
        const strategy = new ethers.Contract(route.strategy, ["function redeem(uint256,address,address) returns (uint256)"], provider);
        try { await strategy.redeem.staticCall(shares, p.address, p.address, { from: p.address }); }
        catch (error) { throw new PlanExitError(ethers.isError(error, "CALL_EXCEPTION") ? "liquidity" : "unavailable"); }
      }
      if (route.symbol === "USDC") {
        try { const reward = await child.rewardPosition(); rewards = BigInt(reward.net); rewardFee = BigInt(reward.fee); }
        catch (error) { if (!ethers.isError(error, "CALL_EXCEPTION")) throw error; await child.principalPosition(); rewardsUnknown = true; }
      }
      // WLD's deployed full-exit method cannot dispose of a total-loss position.
      if (route.symbol === "WLD" && p.hasAssets && net <= 0n) throw new PlanExitError("liquidity");
    }
    return { factory: p.factory, vault: p.address, symbol: p.symbol, heir: p.heir, period: p.period.toString(),
      lastPing: p.lastPing.toString(), nextHeir: account, nextPeriod: p.period.toString(), checkIn: true,
      exit: { gross: gross.toString(), net: net.toString(), fee: fee.toString(), shares: shares.toString(),
        minNet: net > 0n ? minimumOutput(net).toString() : "0", rewards: rewards.toString(), rewardFee: rewardFee.toString(),
        rewardsUnknown, minRewards: rewards > 0n ? minimumOutput(rewards).toString() : "0", hasAssets: p.hasAssets, claimFiledAt: p.claimFiledAt.toString() } };
  }));
}

// Require the reviewed asset set and protected minimum, while allowing accrued yield.
export function exitQuoteStillValid(reviewed: readonly SettingsTarget[], fresh: readonly SettingsTarget[]) {
  return reviewed.length === fresh.length && reviewed.every(before => {
    const after = fresh.find(t => t.vault.toLowerCase() === before.vault.toLowerCase());
    return before.exit && after?.exit && before.exit.shares === after.exit.shares
      && Boolean(before.exit.rewardsUnknown) === Boolean(after.exit.rewardsUnknown) && before.exit.hasAssets === after.exit.hasAssets && before.exit.claimFiledAt === after.exit.claimFiledAt
      && BigInt(after.exit.net) >= BigInt(before.exit.minNet) && BigInt(after.exit.rewards) >= BigInt(before.exit.minRewards);
  });
}
export function verifyExitTransfers(receipt: { logs: readonly { address: string; topics: readonly string[]; data: string }[] }, targets: readonly SettingsTarget[]) {
  return targets.every(t => {
    if (!t.exit) return false;
    const route = yieldRouteFor(t.factory);
    const received = (token: string) => receipt.logs.reduce((sum, log) => {
      if (log.address.toLowerCase() !== token.toLowerCase()) return sum;
      try { const e = transfer.parseLog({ topics: [...log.topics], data: log.data });
        return e && String(e.args.from).toLowerCase() === t.vault.toLowerCase() && String(e.args.to).toLowerCase() === t.nextHeir.toLowerCase() ? sum + BigInt(e.args.value) : sum;
      } catch { return sum; }
    }, 0n);
    return received(route?.asset ?? WLD_ADDRESS) >= BigInt(t.exit.minNet)
      && (t.symbol !== "USDC" || received(WLD_ADDRESS) >= BigInt(t.exit.minRewards));
  });
}
export async function verifyExitEmpty(provider: ethers.JsonRpcProvider, targets: readonly SettingsTarget[], blockTag: number) {
  for (const t of targets) {
    const route = yieldRouteFor(t.factory);
    const addresses = route ? [route.asset, route.strategy, ...(route.symbol === "USDC" ? [WLD_ADDRESS] : [])] : [WLD_ADDRESS];
    for (const token of addresses) {
      if (BigInt(await new ethers.Contract(token, tokenAbi, provider).balanceOf(t.vault, { blockTag })) !== 0n) return false;
    }
  }
  return true;
}
