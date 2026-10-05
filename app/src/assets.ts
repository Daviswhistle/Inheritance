import { FACTORY_ADDRESS, LEGACY_FACTORY_ADDRESS, WLD_ADDRESS, YIELD_ENABLED, YIELD_FACTORY_ADDRESS,
  YIELD_FACTORY_DEPLOY_BLOCK, MORPHO_VAULT_ADDRESS, USDC_ENABLED, USDC_ADDRESS,
  USDC_YIELD_FACTORY_ADDRESS, USDC_YIELD_FACTORY_DEPLOY_BLOCK, USDC_MORPHO_VAULT_ADDRESS,
  LEGACY_YIELD_FACTORY_ADDRESSES, LEGACY_YIELD_FACTORY_DEPLOY_BLOCK,
  LEGACY_USDC_YIELD_FACTORY_ADDRESSES, LEGACY_USDC_YIELD_FACTORY_DEPLOY_BLOCK } from "./config";
import { INCOME_YIELD_FACTORY_ABI, INCOME_YIELD_VAULT_ABI, YIELD_FACTORY_ABI, YIELD_VAULT_ABI,
  USDC_INCOME_YIELD_FACTORY_ABI, USDC_INCOME_YIELD_VAULT_ABI, USDC_YIELD_FACTORY_ABI, USDC_YIELD_VAULT_ABI } from "./yield";
import type { InterfaceAbi } from "ethers";

export type AssetSymbol = "WLD" | "USDC";
export type YieldRoute = { symbol: AssetSymbol; asset: string; decimals: number; factory: string; strategy: string;
  block: number | null; factoryAbi: InterfaceAbi; vaultAbi: InterfaceAbi; tokenGetter: "WLD" | "asset"; legacy?: boolean };
const primaryWldRoute: YieldRoute = { symbol: "WLD", asset: WLD_ADDRESS, decimals: 18, factory: YIELD_FACTORY_ADDRESS,
    strategy: MORPHO_VAULT_ADDRESS, block: YIELD_FACTORY_DEPLOY_BLOCK, factoryAbi: INCOME_YIELD_FACTORY_ABI,
    vaultAbi: INCOME_YIELD_VAULT_ABI, tokenGetter: "WLD" };
const primaryUsdcRoute: YieldRoute = { symbol: "USDC", asset: USDC_ADDRESS, decimals: 6, factory: USDC_YIELD_FACTORY_ADDRESS,
    strategy: USDC_MORPHO_VAULT_ADDRESS, block: USDC_YIELD_FACTORY_DEPLOY_BLOCK, factoryAbi: USDC_INCOME_YIELD_FACTORY_ABI,
    vaultAbi: USDC_INCOME_YIELD_VAULT_ABI, tokenGetter: "asset" };
export const PRIMARY_YIELD_ROUTES: YieldRoute[] = [
  ...(YIELD_ENABLED ? [primaryWldRoute] : []),
  ...(USDC_ENABLED ? [primaryUsdcRoute] : []),
];
const legacyYieldRoutes: YieldRoute[] = [
  ...(YIELD_ENABLED ? LEGACY_YIELD_FACTORY_ADDRESSES.map(factory => ({ ...primaryWldRoute,
    factory, block: LEGACY_YIELD_FACTORY_DEPLOY_BLOCK, legacy: true,
    factoryAbi: YIELD_FACTORY_ABI, vaultAbi: YIELD_VAULT_ABI })) : []),
  ...(USDC_ENABLED ? LEGACY_USDC_YIELD_FACTORY_ADDRESSES.map(factory => ({ ...primaryUsdcRoute,
    factory, block: LEGACY_USDC_YIELD_FACTORY_DEPLOY_BLOCK, legacy: true,
    factoryAbi: USDC_YIELD_FACTORY_ABI, vaultAbi: USDC_YIELD_VAULT_ABI })) : []),
];
export const YIELD_ROUTES: YieldRoute[] = [
  ...PRIMARY_YIELD_ROUTES,
  ...legacyYieldRoutes,
];
export const HAS_YIELD_ROUTES = YIELD_ROUTES.length > 0;
export const yieldRouteFor = (factory: string): YieldRoute | undefined =>
  YIELD_ROUTES.find(route => route.factory.toLowerCase() === factory.toLowerCase());
export const vaultLabel = (factory: string): string => {
  const route = yieldRouteFor(factory);
  return route ? `${route.symbol} · ${route.legacy ? "Legacy Morpho yield" : "Morpho yield"}` : "WLD · Basic vault";
};
export const TRUSTED_FACTORIES = [FACTORY_ADDRESS, LEGACY_FACTORY_ADDRESS, ...YIELD_ROUTES.map(route => route.factory)].filter(Boolean);
