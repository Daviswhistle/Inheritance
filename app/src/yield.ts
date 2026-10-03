import { FACTORY_ABI, INCOME_FACTORY_ABI, INCOME_VAULT_ABI, VAULT_ABI } from "./abis";
import { YIELD_FACTORY_ERROR_ABI, YIELD_VAULT_ERROR_ABI } from "./abi-errors";
import { formatUnits } from "ethers";

export const YIELD_FACTORY_ABI = [
  ...FACTORY_ABI.filter(fragment => typeof fragment !== "string" || !/^function (deposit|isHeirOf)\(/.test(fragment)),
  "function WLD() view returns (address)",
  "function strategy() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function performanceFeeBps() view returns (uint256)",
  "function depositWithMinShares(uint256 assets,uint256 minShares)",
  "function withdrawSharesFromMyVault(address to,uint256 shares)",
  "function withdrawAllFromMyVault(address to,uint256 minNetAssets)",
  "function redeemWalletShares(uint256 shares,uint256 minAssets) returns (uint256)",
  "function knownVaults(address) view returns (bool)",
  "function claimRewardsFor(address vault,uint256 amount,bytes32[] proof,uint256 minShares) returns (uint256)",
  "function processRewardsFor(address vault,uint256 minShares) returns (uint256)",
  "function recoverArchivedVault(address vault)",
  ...YIELD_FACTORY_ERROR_ABI,
  ...YIELD_VAULT_ERROR_ABI,
];
export const YIELD_VAULT_ABI = [
  ...VAULT_ABI,
  "function strategy() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function performanceFeeBps() view returns (uint256)",
  "function costBasis() view returns (uint256)",
  "function accountedShares() view returns (uint256)",
  "function inheritanceRecipient() view returns (address)",
  "function MERKL_DISTRIBUTOR() view returns (address)",
  "function realizedLoss() view returns (uint256)",
  "function totalRewardsClaimed() view returns (uint256)",
  "function unprocessedRewards() view returns (uint256)",
  "function hasAssets() view returns (bool)",
  "function totalAssets() view returns (uint256)",
  "function position() view returns (uint256 idle,uint256 shares,uint256 gross,uint256 net,uint256 fee,uint256 liquid,bool valued)",
  ...YIELD_VAULT_ERROR_ABI,
];
/** New primary routes opt in to the optional income API; legacy routes stay on the base ABI. */
export const INCOME_YIELD_FACTORY_ABI = [
  ...YIELD_FACTORY_ABI,
  ...INCOME_FACTORY_ABI,
];
export const INCOME_YIELD_VAULT_ABI = [
  ...YIELD_VAULT_ABI,
  ...INCOME_VAULT_ABI,
];
export const USDC_YIELD_FACTORY_ABI = [
  ...YIELD_FACTORY_ABI.filter(fragment => typeof fragment !== "string" || !/^function WLD\(/.test(fragment)),
  "function asset() view returns (address)",
  "function rewardToken() view returns (address)",
  "function withdrawRewardsFromMyVault(address to)",
];
export const USDC_YIELD_VAULT_ABI = [
  ...YIELD_VAULT_ABI.filter(fragment => typeof fragment !== "string" || !/^function WLD\(/.test(fragment)),
  "function asset() view returns (address)",
  "function rewardToken() view returns (address)",
  "function rewardPosition() view returns (uint256 held,uint256 feeBearing,uint256 net,uint256 fee)",
];
export const USDC_INCOME_YIELD_FACTORY_ABI = [
  ...USDC_YIELD_FACTORY_ABI,
  ...INCOME_FACTORY_ABI,
];
export const USDC_INCOME_YIELD_VAULT_ABI = [
  ...USDC_YIELD_VAULT_ABI,
  ...INCOME_VAULT_ABI,
];
export const MORPHO_ABI = [
  "function asset() view returns (address)",
  "function fee() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function previewDeposit(uint256) view returns (uint256)",
  "function previewRedeem(uint256) view returns (uint256)",
  "function maxRedeem(address) view returns (uint256)",
  "function maxWithdraw(address) view returns (uint256)",
];
export type YieldPosition = {
  vault: string; idle: bigint; shares: bigint; gross: bigint; net: bigint;
  fee: bigint; liquid: bigint; valued: boolean;
};
export type YieldTerms = { feeBps: number; recipient: string; underlyingFeePercent: number };
export const MERKL_DISTRIBUTOR = "0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae";

/** Display only: transaction amounts and minimum-output quotes retain all wei. */
export function formatYieldAmount(amount: bigint, decimals = 18): string {
  const raw = formatUnits(amount, decimals);
  const [integer, fraction = ""] = raw.split(".");
  if (fraction.length <= 6) return raw;
  const digits = fraction.slice(0, 6).replace(/0+$/, "");
  if (integer === "0" && !digits && amount > 0n) return "<0.000001";
  return integer + "." + (digits || "0");
}

/** Positive lower bound with 0.5% quote tolerance. Never silently submit zero. */
export function minimumOutput(quote: bigint): bigint {
  if (quote <= 0n) throw new Error("No output is currently available. Refresh and try again.");
  const minimum = quote * 9950n / 10000n;
  return minimum > 0n ? minimum : 1n;
}
