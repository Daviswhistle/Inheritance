import { FACTORY_ADDRESS, LEGACY_FACTORY_ADDRESS, WLD_ADDRESS, YIELD_ENABLED, YIELD_FACTORY_ADDRESS,
  YIELD_FACTORY_DEPLOY_BLOCK, MORPHO_VAULT_ADDRESS, USDC_ENABLED, USDC_ADDRESS,
  USDC_YIELD_FACTORY_ADDRESS, USDC_YIELD_FACTORY_DEPLOY_BLOCK, USDC_MORPHO_VAULT_ADDRESS } from "./config";
import { YIELD_FACTORY_ABI, YIELD_VAULT_ABI, USDC_YIELD_FACTORY_ABI, USDC_YIELD_VAULT_ABI } from "./yield";
import type { InterfaceAbi } from "ethers";

export type AssetSymbol = "WLD" | "USDC";
export type YieldRoute = { symbol: AssetSymbol; asset: string; decimals: number; factory: string; strategy: string;
  block: number | null; factoryAbi: InterfaceAbi; vaultAbi: InterfaceAbi; tokenGetter: "WLD" | "asset" };
export const YIELD_ROUTES: YieldRoute[] = [
  ...(YIELD_ENABLED ? [{ symbol: "WLD" as const, asset: WLD_ADDRESS, decimals: 18, factory: YIELD_FACTORY_ADDRESS,
    strategy: MORPHO_VAULT_ADDRESS, block: YIELD_FACTORY_DEPLOY_BLOCK, factoryAbi: YIELD_FACTORY_ABI,
    vaultAbi: YIELD_VAULT_ABI, tokenGetter: "WLD" as const }] : []),
  ...(USDC_ENABLED ? [{ symbol: "USDC" as const, asset: USDC_ADDRESS, decimals: 6, factory: USDC_YIELD_FACTORY_ADDRESS,
    strategy: USDC_MORPHO_VAULT_ADDRESS, block: USDC_YIELD_FACTORY_DEPLOY_BLOCK, factoryAbi: USDC_YIELD_FACTORY_ABI,
    vaultAbi: USDC_YIELD_VAULT_ABI, tokenGetter: "asset" as const }] : []),
];
export const HAS_YIELD_ROUTES = YIELD_ROUTES.length > 0;
export const yieldRouteFor = (factory: string): YieldRoute | undefined =>
  YIELD_ROUTES.find(route => route.factory.toLowerCase() === factory.toLowerCase());
export const vaultLabel = (factory: string): string => {
  const route = yieldRouteFor(factory);
  return route ? `${route.symbol} · Morpho yield` : "WLD · Basic vault";
};
export const TRUSTED_FACTORIES = [FACTORY_ADDRESS, LEGACY_FACTORY_ADDRESS, ...YIELD_ROUTES.map(route => route.factory)].filter(Boolean);
