import { ethers } from "ethers";
import { FACTORY_ABI, VAULT_ABI } from "./abis";
import { TRUSTED_FACTORIES, yieldRouteFor, type AssetSymbol } from "./assets";
import { FACTORY_DEPLOY_BLOCK, LEGACY_FACTORY_ADDRESS, LEGACY_FACTORY_DEPLOY_BLOCK, WLD_ADDRESS } from "./config";
import { MERKL_DISTRIBUTOR } from "./yield";

export type InheritanceReceipt = {
  transactionHash: string; blockHash: string; blockNumber: number; timestamp: number;
  cash: bigint; shares: bigint; rewardsWld: bigint; finalized: boolean;
};
export type InheritancePosition = {
  address: string; factory: string; owner: string; ownerName?: string; heir: string;
  recipient: string; symbol: AssetSymbol; decimals: number; period: bigint; lastPing: bigint;
  deadline: bigint; claimFiledAt: bigint; challengeEndsAt: bigint; claimedAt: bigint;
  amount: bigint | null; additionalWld: bigint | null; hasAssets: boolean; now: bigint;
  receipt: InheritanceReceipt | null; receiptError: boolean;
};
export type HeirReadiness = {
  address: string; openedAt: string; notificationPermission: "granted" | "denied" | "unknown";
  permissionReportedAt: string;
};
export type SettingsTarget = {
  factory: string; vault: string; symbol: AssetSymbol; heir: string; period: string; lastPing: string;
  nextHeir: string; nextPeriod: string; checkIn: boolean;
};
export type SettingsRequest = {
  version: 1; account: string; beforeBlock: number; targets: SettingsTarget[];
  txHash?: string; hashType?: "transaction" | "user-operation";
};
export const SETTING_EVENTS = new ethers.Interface([
  "event HeirUpdated(address indexed oldHeir, address indexed newHeir)",
  "event HeartbeatUpdated(uint256 oldInterval, uint256 newInterval)",
  "event Ping(uint256 timestamp)",
]);
const PAYOUT_EVENTS = new ethers.Interface([
  "event InheritanceFinalized(address indexed recipient, uint256 amount, uint256 claimedAt)",
  "event InheritanceSharesFinalized(address indexed recipient, uint256 shares, uint256 claimedAt)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const settingsKey = (account: string) => `inheritance:settings-request:${account.toLowerCase()}`;
const historyKey = (account: string) => `inheritance:received-vaults:${account.toLowerCase()}`;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const trusted = (factory: string) => TRUSTED_FACTORIES.some(address => same(address, factory));

export function readSettingsRequest(account: string): SettingsRequest | null {
  const raw = sessionStorage.getItem(settingsKey(account));
  if (!raw) return null;
  const r = JSON.parse(raw) as SettingsRequest;
  if (r.version !== 1 || !same(r.account, account) || !Number.isSafeInteger(r.beforeBlock) || r.beforeBlock < 0
    || !Array.isArray(r.targets) || !r.targets.length || r.targets.length > TRUSTED_FACTORIES.length
    || new Set(r.targets.map(t => t.factory.toLowerCase())).size !== r.targets.length
    || r.txHash !== undefined && !/^0x[\da-f]{64}$/i.test(r.txHash)
    || r.hashType !== undefined && r.hashType !== "transaction" && r.hashType !== "user-operation"
    || !r.targets.every(t => trusted(t.factory) && ethers.isAddress(t.vault) && ethers.isAddress(t.heir)
      && ethers.isAddress(t.nextHeir) && t.nextHeir !== ethers.ZeroAddress && (t.symbol === "WLD" || t.symbol === "USDC")
      && t.symbol === (yieldRouteFor(t.factory)?.symbol ?? "WLD")
      && /^\d+$/.test(t.period) && /^\d+$/.test(t.nextPeriod) && /^\d+$/.test(t.lastPing)
      && BigInt(t.nextPeriod) >= 86400n && BigInt(t.nextPeriod) <= 365n * 86400n && typeof t.checkIn === "boolean")) {
    throw new Error("The saved settings request cannot be verified. No new request was sent.");
  }
  return r;
}
export function saveSettingsRequest(r: SettingsRequest) {
  const text = JSON.stringify(r);
  sessionStorage.setItem(settingsKey(r.account), text);
  if (sessionStorage.getItem(settingsKey(r.account)) !== text) throw new Error("Your browser could not save settings recovery. No new request was sent.");
}
export function clearSettingsRequest(account: string) {
  sessionStorage.removeItem(settingsKey(account));
  if (sessionStorage.getItem(settingsKey(account)) !== null) throw new Error("Settings recovery could not be cleared. Reopen the app before continuing.");
}
export function settingsFingerprint(targets: readonly SettingsTarget[]) {
  return targets.map(t => [t.factory.toLowerCase(), t.vault.toLowerCase(), t.heir.toLowerCase(), t.period, t.lastPing,
    t.nextHeir.toLowerCase(), t.nextPeriod, t.checkIn].join(":")).sort().join("|");
}
export function verifySettingsReceipt(receipt: { logs: readonly { address: string; topics: readonly string[]; data: string }[] }, targets: readonly SettingsTarget[]) {
  const heirs = new Set<string>(), periods = new Set<string>(), pings = new Set<string>();
  for (const log of receipt.logs) {
    const t = targets.find(t => same(t.vault, log.address));
    if (!t) continue;
    try {
      const e = SETTING_EVENTS.parseLog({ topics: [...log.topics], data: log.data });
      const address = t.vault.toLowerCase();
      if (e?.name === "HeirUpdated" && same(String(e.args.oldHeir), t.heir) && same(String(e.args.newHeir), t.nextHeir)) heirs.add(address);
      if (e?.name === "HeartbeatUpdated" && BigInt(e.args.oldInterval) === BigInt(t.period) && BigInt(e.args.newInterval) === BigInt(t.nextPeriod)) periods.add(address);
      if (e?.name === "Ping" && BigInt(e.args.timestamp) >= BigInt(t.lastPing)) pings.add(address);
    } catch { /* A different event cannot prove this request. */ }
  }
  return targets.length > 0 && targets.every(t => (same(t.heir, t.nextHeir) || heirs.has(t.vault.toLowerCase()))
    && (t.period === t.nextPeriod || periods.has(t.vault.toLowerCase())) && (!t.checkIn || pings.has(t.vault.toLowerCase())));
}
export function rememberedInheritances(account: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(historyKey(account)) || "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && ethers.isAddress(v)) : [];
  } catch { return []; }
}
export function rememberInheritances(account: string, addresses: readonly string[]) {
  try { localStorage.setItem(historyKey(account), JSON.stringify([...new Set([...rememberedInheritances(account), ...addresses].map(v => v.toLowerCase()))])); }
  catch { /* A chain/backend read remains authoritative when local storage is unavailable. */ }
}
export function inheritanceStage(p: InheritancePosition) {
  return p.claimedAt > 0n ? "completed" : same(p.heir, p.owner) ? "cancelled"
    : p.claimFiledAt > 0n ? p.now >= p.challengeEndsAt ? "ready" : "waiting" : p.now >= p.deadline ? "expired" : "active";
}
export function groupInheritances(positions: readonly InheritancePosition[]) {
  const groups = new Map<string, InheritancePosition[]>();
  for (const p of positions) {
    const key = p.owner.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.values()];
}

// Locate a settlement by its onchain timestamp instead of scanning years of blocks.
// The receipt and its block must agree; provisional transfers stay visibly provisional.
export async function readInheritanceReceipt(provider: ethers.JsonRpcProvider, address: string, factory: string, claimedAt: bigint, recipient: string): Promise<InheritanceReceipt> {
  const route = yieldRouteFor(factory);
  const deployBlock = route?.block ?? (same(factory, LEGACY_FACTORY_ADDRESS) ? LEGACY_FACTORY_DEPLOY_BLOCK : FACTORY_DEPLOY_BLOCK) ?? 0;
  const latest = await provider.getBlock("latest");
  if (!latest || claimedAt === 0n) throw new Error("Settlement is unavailable");
  let lo = Math.min(deployBlock, latest.number), hi = latest.number;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const block = await provider.getBlock(mid);
    if (!block) throw new Error("Settlement block is unavailable");
    if (BigInt(block.timestamp) < claimedAt) lo = mid + 1; else hi = mid;
  }
  // Local/dev chains can share a timestamp across several successive blocks.
  const logs = await provider.getLogs({ address, fromBlock: lo, toBlock: Math.min(latest.number, lo + 89),
    topics: [PAYOUT_EVENTS.getEvent("InheritanceFinalized")!.topicHash, ethers.zeroPadValue(recipient, 32)] });
  for (const log of logs) {
    const event = PAYOUT_EVENTS.parseLog({ topics: [...log.topics], data: log.data });
    if (!event || BigInt(event.args.claimedAt) !== claimedAt) continue;
    const [receipt, block, finalized] = await Promise.all([
      provider.getTransactionReceipt(log.transactionHash), provider.getBlock(log.blockNumber), provider.getBlock("finalized").catch(() => null),
    ]);
    if (!receipt || receipt.status !== 1 || !block?.hash || block.hash !== log.blockHash || receipt.blockHash !== block.hash
      || !receipt.logs.some(l => same(l.address, address) && l.index === log.index && l.data === log.data && l.topics.join() === log.topics.join())) continue;
    const finalizedCanonical = finalized?.hash && finalized.number >= block.number
      ? await provider.getBlock(finalized.number).catch(() => null) : null;
    let shares = 0n, rewardsWld = 0n;
    for (const item of receipt.logs) {
      try {
        const e = PAYOUT_EVENTS.parseLog({ topics: [...item.topics], data: item.data });
        if (same(item.address, address) && e?.name === "InheritanceSharesFinalized" && same(String(e.args.recipient), recipient)
          && BigInt(e.args.claimedAt) === claimedAt) shares += BigInt(e.args.shares);
        if (route?.symbol === "USDC" && same(item.address, WLD_ADDRESS) && e?.name === "Transfer"
          && same(String(e.args.from), address) && same(String(e.args.to), recipient)) rewardsWld += BigInt(e.args.value);
      } catch { /* Only the matching payout's events are part of this receipt. */ }
    }
    return { transactionHash: receipt.hash, blockHash: block.hash, blockNumber: block.number, timestamp: block.timestamp,
      cash: BigInt(event.args.amount), shares, rewardsWld, finalized: Boolean(finalizedCanonical?.hash && finalizedCanonical.hash === finalized?.hash) };
  }
  throw new Error("The settlement receipt could not be verified");
}
export async function readInheritancePosition(provider: ethers.JsonRpcProvider, address: string): Promise<InheritancePosition> {
  const basic = new ethers.Contract(address, VAULT_ABI, provider);
  const [factory, owner, heir] = await Promise.all([basic.factory(), basic.owner(), basic.heir()]).then(v => v.map(String));
  if (!trusted(factory)) throw new Error("Unsupported inheritance source");
  const route = yieldRouteFor(factory), tokenAddress = route?.asset ?? WLD_ADDRESS;
  const child = new ethers.Contract(address, route?.vaultAbi ?? VAULT_ABI, provider);
  const source = new ethers.Contract(factory, route?.factoryAbi ?? FACTORY_ABI, provider);
  const [token, period, lastPing, deadline, filedAt, endsAt, claimedAt, latest] = await Promise.all([
    child[route?.tokenGetter ?? "WLD"](), child.heartbeatInterval(), child.lastPing(), child.deadline(),
    child.claimFiledAt(), child.challengeEndsAt(), child.claimedAt(), provider.getBlock("latest"),
  ]);
  if (!same(String(token), tokenAddress) || !latest) throw new Error("Asset or chain identity unavailable");
  if (route) {
    const [strategy, known, distributor] = await Promise.all([child.strategy(), source.knownVaults(address), child.MERKL_DISTRIBUTOR()]);
    if (!known || !same(String(strategy), route.strategy) || !same(String(distributor), MERKL_DISTRIBUTOR)
      || route.symbol === "USDC" && !same(String(await child.rewardToken()), WLD_ADDRESS)) throw new Error("Yield identity unavailable");
  } else if (!same(String(await source.vaultOf(owner)), address)) throw new Error("This basic inheritance has been released");
  let recipient = heir, receipt: InheritanceReceipt | null = null, receiptError = false;
  if (claimedAt > 0n) {
    try {
      if (route) recipient = String(await child.inheritanceRecipient());
      else {
        // Basic contracts clear heir without a recipient getter. A verified receipt supplies the recipient.
        // Callers pass discovered event-linked addresses; topics cannot grant onchain action authority.
        const event = await findBasicRecipient(provider, address, factory, BigInt(claimedAt));
        recipient = event;
      }
      receipt = await readInheritanceReceipt(provider, address, factory, BigInt(claimedAt), recipient);
    } catch { receiptError = true; }
  }
  let amount: bigint | null = null, additionalWld: bigint | null = null, hasAssets = false;
  if (claimedAt === 0n) {
    if (route) {
      hasAssets = Boolean(await child.hasAssets());
      try { const position = await child.position(); amount = position.valued ? BigInt(position.net) : null; } catch { /* Claims remain available without a quote. */ }
      if (route.symbol === "USDC") {
        try { additionalWld = BigInt(await new ethers.Contract(WLD_ADDRESS, ["function balanceOf(address) view returns (uint256)"], provider).balanceOf(address)); }
        catch { /* A rewards quote cannot erase the USDC position. */ }
      }
    } else {
      amount = BigInt(await new ethers.Contract(tokenAddress, ["function balanceOf(address) view returns (uint256)"], provider).balanceOf(address));
      hasAssets = amount > 0n;
    }
  }
  return { address, factory, owner, heir, recipient, symbol: route?.symbol ?? "WLD", decimals: route?.decimals ?? 18,
    period: BigInt(period), lastPing: BigInt(lastPing), deadline: BigInt(deadline), claimFiledAt: BigInt(filedAt),
    challengeEndsAt: BigInt(endsAt), claimedAt: BigInt(claimedAt), now: BigInt(latest.timestamp), amount, additionalWld, hasAssets, receipt, receiptError };
}
async function findBasicRecipient(provider: ethers.JsonRpcProvider, address: string, factory: string, claimedAt: bigint) {
  const latest = await provider.getBlock("latest");
  if (!latest) throw new Error("Chain unavailable");
  let lo = Math.min((same(factory, LEGACY_FACTORY_ADDRESS) ? LEGACY_FACTORY_DEPLOY_BLOCK : FACTORY_DEPLOY_BLOCK) ?? 0, latest.number), hi = latest.number;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2), b = await provider.getBlock(mid);
    if (!b) throw new Error("Block unavailable");
    if (BigInt(b.timestamp) < claimedAt) lo = mid + 1; else hi = mid;
  }
  const logs = await provider.getLogs({ address, fromBlock: lo, toBlock: Math.min(latest.number, lo + 89), topics: [PAYOUT_EVENTS.getEvent("InheritanceFinalized")!.topicHash] });
  for (const log of logs) {
    const e = PAYOUT_EVENTS.parseLog(log);
    if (e && BigInt(e.args.claimedAt) === claimedAt) return String(e.args.recipient);
  }
  throw new Error("Recipient receipt unavailable");
}
export async function ownerInheritancePositions(provider: ethers.JsonRpcProvider, owner: string) {
  const rows = await Promise.all(TRUSTED_FACTORIES.map(async factory => {
    const route = yieldRouteFor(factory);
    const address = String(await new ethers.Contract(factory, route?.factoryAbi ?? FACTORY_ABI, provider).vaultOf(owner));
    return address === ethers.ZeroAddress ? null : await readInheritancePosition(provider, address);
  }));
  return rows.filter((row): row is InheritancePosition => Boolean(row));
}
