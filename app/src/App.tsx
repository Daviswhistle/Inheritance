import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FACTORY_ABI, VAULT_ABI, INCOME_FACTORY_ABI, INCOME_VAULT_ABI } from "./abis";
import { errorText } from "./errors";
import { ethers } from "ethers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Brand, Icon } from "@/components/Icon";
import { Landing } from "@/components/Landing";
import { AutomationNotice } from "@/components/AutomationNotice";
import { PlanSetup } from "@/components/PlanSetup";
import { AssetNavigation } from "@/components/AssetNavigation";
import { IncomeHistoryCard, type IncomeHistoryView } from "@/components/IncomeHistory";
import { IncomePositionCard, YieldPositionCard, YieldRewardsCard } from "@/components/YieldVault";
import { MORPHO_ABI, MERKL_DISTRIBUTOR, minimumOutput, formatYieldAmount } from "@/yield";
import type { YieldPosition, YieldTerms } from "@/yield";
import { fetchWldRewards, remainingWldRewards } from "@/rewards";
import type { WldRewards } from "@/rewards";
import { fetchYieldRates } from "@/yield-rates";
import type { YieldRates } from "@/yield-rates";
import { HAS_YIELD_ROUTES, PRIMARY_YIELD_ROUTES, YIELD_ROUTES, TRUSTED_FACTORIES, yieldRouteFor } from "@/assets";
import type { AssetSymbol, YieldRoute } from "@/assets";
import { FinalityUnavailableError, mergeBlockRanges, mergeIncomeReceipts, readFinalizedBoundary, readIncomeHistoryPage, rangesCover, uncoveredBlockRanges } from "@/income-history";
import type { BlockRange } from "@/income-history";
import { buildPlanRoutes, findUniquePlanReceipt, formatPlanInterval, parseAssetAmount } from "@/plan";
import type { PlanAssetSymbol, PlanRoute } from "@/plan";
import { ConfirmedTransactionFailure, confirmTransaction, verifyIncomeWithdrawalReceipt } from "@/transactions";
import type { ReactElement } from "react";
import {
  APP_ORIGIN,
  CHAIN_ID,
  CONFIG_ERROR,
  EXPLORER,
  FACTORY_ADDRESS,
  FACTORY_DEPLOY_BLOCK,
  LEGACY_FACTORY_ADDRESS,
  LEGACY_FACTORY_DEPLOY_BLOCK,
  NOTIFY_BACKEND_ENABLED,
  NOTIFY_BACKEND_URL,
  RELEASE_SUPPORTED,
  REQUIRE_VERIFY,
  RPC_URL,
  WLD_ADDRESS,
  MORPHO_VAULT_ADDRESS,
  USDC_ENABLED,
  USDC_ADDRESS,
} from "@/config";
import { signInWithWorldApp, readSessionAddress, clearSession, notificationFetch, fetchRegisteredVaults } from "@/auth";
import { walletAuth, sendWorldChainTx, getNotifyPermission, requestNotifyPermission as askNotifyPermission, loadMiniKit, sendWorldChat, pickWorldContacts } from "@/minikit";
import { LanguagePicker } from "@/i18n";
import { useLocale } from "@/locale-context";
import { localizeAppMessage } from "@/locale";

type AppPlanRoute = PlanRoute<YieldRoute | null>;
const APP_PLAN_ROUTES: AppPlanRoute[] = buildPlanRoutes(
  PRIMARY_YIELD_ROUTES.map(route => ({
    symbol: route.symbol, asset: route.asset, decimals: route.decimals,
    factory: route.factory, mode: "morpho" as const, details: route,
  })),
  { symbol: "WLD", asset: WLD_ADDRESS, decimals: 18, factory: FACTORY_ADDRESS, mode: "plain", details: null },
  USDC_ENABLED,
);

type PlanDepositState = "ready" | "submitting" | "submitted" | "complete";
type StoredPlanAsset = {
  symbol: PlanAssetSymbol;
  factory: string;
  asset: string;
  decimals: number;
  mode: "morpho" | "plain";
  amount: string;
  vault: string;
  depositState: PlanDepositState;
  beforeBalance?: string;
  beforeBlock?: number;
  txHash?: string;
  hashType?: "transaction" | "user-operation";
};
type StoredPlanAlignment = {
  state: "submitting" | "submitted";
  beforeBlock: number;
  targets: Array<{ factory: string; vault: string; heir: string; periodSeconds: string; checkIn?: boolean }>;
  txHash?: string;
  hashType?: "transaction" | "user-operation";
};
type StoredSetupRequest = {
  beforeBlock: number;
  createdFactories: string[];
  assets: Array<{ symbol: PlanAssetSymbol; vault: string }>;
  txHash?: string;
  hashType?: "transaction" | "user-operation";
};
type StoredPlan = {
  version: 1;
  account: string;
  heir: string;
  periodDays: number;
  createdAt: number;
  createState: "ready" | "submitting" | "submitted" | "complete";
  createTargets: string[];
  createBeforeBlock?: number;
  createTxHash?: string;
  createHashType?: "transaction" | "user-operation";
  assets: StoredPlanAsset[];
  alignment?: StoredPlanAlignment;
  setupRequest?: StoredSetupRequest;
};
type PlanAlignmentConflict = {
  symbol: PlanAssetSymbol; address: string; currentHeir: string; currentPeriod: number;
  currentPeriodSeconds: bigint;
  requestedHeir: string; requestedPeriod: number;
};
type PlanVaultIdentity = {
  address: string; owner: string; heir: string; periodSeconds: bigint; claimedAt: bigint;
  deadline: bigint; lastPing: bigint;
};
const storedPlanKey = (address: string) => `inheritance:pending-plan:${address.toLowerCase()}`;
const canEditStoredPlan = (plan: StoredPlan) => (plan.createState === "ready" || plan.createState === "complete")
  && !plan.alignment && !plan.setupRequest && !plan.createTxHash && plan.assets.every(asset => asset.depositState === "complete"
    || asset.depositState === "ready" && !asset.txHash && asset.beforeBlock === undefined);

function hasPendingPlanDeposit(plan: StoredPlan | null, account: string, factory: string, vault: string): boolean {
  return Boolean(plan && plan.account.toLowerCase() === account.toLowerCase()
    && plan.assets.some(asset => asset.depositState !== "complete"
      && asset.factory.toLowerCase() === factory.toLowerCase()
      && (!asset.vault || asset.vault.toLowerCase() === vault.toLowerCase())));
}

function trustedPlanRoute(factoryAddress: string): AppPlanRoute | null {
  const yieldRoute = yieldRouteFor(factoryAddress);
  const route: AppPlanRoute | null = yieldRoute
    ? { symbol: yieldRoute.symbol, asset: yieldRoute.asset, decimals: yieldRoute.decimals,
      factory: yieldRoute.factory, mode: "morpho", details: yieldRoute }
    : TRUSTED_FACTORIES.some(factory => factory.toLowerCase() === factoryAddress.toLowerCase())
      ? { symbol: "WLD", asset: WLD_ADDRESS, decimals: 18, factory: factoryAddress, mode: "plain", details: null }
      : null;
  return route;
}

function storedPlanRoute(step: StoredPlanAsset): AppPlanRoute | null {
  const route = trustedPlanRoute(step.factory);
  return route && route.symbol === step.symbol && route.asset.toLowerCase() === step.asset.toLowerCase()
    && route.decimals === step.decimals && route.mode === step.mode ? route : null;
}

function optionalIncomeAbi(base: ethers.InterfaceAbi, optional: ethers.InterfaceAbi): ethers.InterfaceAbi {
  const fragments = new ethers.Interface(base).fragments;
  const signatures = new Set(fragments.map(fragment => fragment.format()));
  return [...fragments, ...new ethers.Interface(optional).fragments.filter(fragment => !signatures.has(fragment.format()))];
}

async function getUsernameFor(addr: string): Promise<string | undefined> {
  try {
    const { MiniKit } = await loadMiniKit();
    const user = await MiniKit.getUserByAddress?.(addr);
    return user?.username as string | undefined;
  } catch {
    return undefined;
  }
}

const INCOME_HISTORY_PAGE_BLOCKS = 3600;

function nextIncomeHistoryRange(coverage: readonly BlockRange[], failed: readonly BlockRange[], startBlock: number, finalizedBlock: number): BlockRange | null {
  const missing = failed.length ? mergeBlockRanges(failed) : uncoveredBlockRanges(coverage, startBlock, finalizedBlock);
  if (!missing.length) return null;
  const target = missing.reduce((latest, range) => range.toBlock > latest.toBlock ? range : latest);
  const toBlock = target.toBlock;
  return { fromBlock: Math.max(target.fromBlock, toBlock - INCOME_HISTORY_PAGE_BLOCKS + 1), toBlock };
}

function readStoredPlan(address: string): StoredPlan | null {
  try {
    const raw = sessionStorage.getItem(storedPlanKey(address));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredPlan>;
    if (value.version !== 1 || typeof value.account !== "string" || value.account.toLowerCase() !== address.toLowerCase()
      || typeof value.heir !== "string" || !ethers.isAddress(value.heir)
      || !Number.isInteger(value.periodDays) || Number(value.periodDays) < 1 || Number(value.periodDays) > 365
      || !["ready", "submitting", "submitted", "complete"].includes(String(value.createState))
      || !Array.isArray(value.createTargets) || !value.createTargets.every(target => typeof target === "string" && ethers.isAddress(target))
      || value.createTxHash !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(value.createTxHash)
      || !Array.isArray(value.assets) || value.assets.length === 0) return null;
    const assets = value.assets as StoredPlanAsset[];
    if (assets.length > 2 || new Set(assets.map(asset => asset.symbol)).size !== assets.length) return null;
    if (!assets.every(asset => (asset.symbol === "WLD" || asset.symbol === "USDC")
      && ethers.isAddress(asset.factory) && ethers.isAddress(asset.asset) && (!asset.vault || ethers.isAddress(asset.vault))
      && Number.isInteger(asset.decimals) && asset.decimals >= 0 && asset.decimals <= 255
      && (asset.mode === "plain" || asset.mode === "morpho") && /^\d+$/.test(asset.amount)
      && BigInt(asset.amount) > 0n && ["ready", "submitting", "submitted", "complete"].includes(asset.depositState)
      && (!asset.txHash || /^0x[0-9a-fA-F]{64}$/.test(asset.txHash)))) return null;
    if (value.setupRequest !== undefined) {
      const request = value.setupRequest;
      if (!request || !Number.isSafeInteger(request.beforeBlock) || request.beforeBlock < 0
        || !Array.isArray(request.createdFactories) || !request.createdFactories.every(ethers.isAddress)
        || new Set(request.createdFactories.map(factory => factory.toLowerCase())).size !== request.createdFactories.length
        || !Array.isArray(request.assets) || !request.assets.length || request.assets.length > 2
        || new Set(request.assets.map(asset => asset.symbol)).size !== request.assets.length
        || !request.assets.every(target => assets.some(asset => asset.symbol === target.symbol)
          && typeof target.vault === "string" && (!target.vault || ethers.isAddress(target.vault)))
        || !request.createdFactories.every(factory => request.assets.some(target => !target.vault
          && assets.some(asset => asset.symbol === target.symbol && asset.factory.toLowerCase() === factory.toLowerCase())))
        || request.assets.some(target => !target.vault && !request.createdFactories.some(factory =>
          assets.some(asset => asset.symbol === target.symbol && asset.factory.toLowerCase() === factory.toLowerCase())))
        || request.txHash !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(request.txHash)
        || request.hashType !== undefined && !["transaction", "user-operation"].includes(request.hashType)) return null;
    }
    if (value.alignment !== undefined) {
      const alignment = value.alignment;
      if (!alignment || !["submitting", "submitted"].includes(alignment.state)
        || !Number.isInteger(alignment.beforeBlock) || alignment.beforeBlock < 0
        || !Array.isArray(alignment.targets) || !alignment.targets.length
        // Configuration changes do not invalidate a structurally sound journal.
        // Recovery checks route availability and keeps unresolved sends blocked.
        || !alignment.targets.every(target => ethers.isAddress(target.factory)
          && ethers.isAddress(target.vault) && target.vault !== ethers.ZeroAddress && ethers.isAddress(target.heir)
          && typeof target.periodSeconds === "string" && /^\d+$/.test(target.periodSeconds) && BigInt(target.periodSeconds) > 0n
          && (target.checkIn === undefined || typeof target.checkIn === "boolean"))
        || new Set(alignment.targets.map(target => target.factory.toLowerCase())).size !== alignment.targets.length
        || alignment.txHash !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(alignment.txHash)) return null;
    }
    return value as StoredPlan;
  } catch {
    return null;
  }
}

// ===== Shared token ABI for configured asset routes
//
// Wallet calls route through the configured asset factory. User-specific vaults
// remain calldata values, so the app never sends a wallet transaction to a vault.


const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
];
const TRANSFER_EVENT_IFACE = new ethers.Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
const DEPOSIT_EVENT_IFACE = new ethers.Interface(["event Deposited(uint256 assets,uint256 shares)"]);
const PING_EVENT_IFACE = new ethers.Interface(["event Ping(uint256 timestamp)"]);
const SETTINGS_EVENT_IFACE = new ethers.Interface([
  "event HeirUpdated(address indexed oldHeir,address indexed newHeir)",
  "event HeartbeatUpdated(uint256 oldInterval,uint256 newInterval)",
  "event Ping(uint256 timestamp)",
]);

/**
 * 금고가 상속 파이프라인에서 어느 단계인지.
 * 컨트랙트의 `ownerStillActive` / `isExpired` / `claimPending` / `challengeRunning` /
 * `claimableNow` / `claimedAt` / `inheritanceCancelled` 를 한 곳에서 합쳐 만든다.
 * UI 는 개별 불리언을 나열하는 대신 이 값 하나만 분기한다.
 */
type VaultPhase =
  | "active"
  | "expired"
  | "challenging"
  | "claimable"
  | "settled"
  | "cancelled";

/** 하단 탭. 개수를 늘리지 않는 것이 의도다 —see the note on `tab`. */
type TabKey = "vault" | "money" | "inherit" | "support";

/**
 * 탭 목록. `needsVault` 는 그 탭이 금고가 있어야만 내용이 있는지를 뜻한다.
 *
 * 금고가 없는데도 탭을 보여주면 빈 화면이 남는다. 실제로 그대로 배포해서
 * "vault 란 send 탭은 왜 있는 거야? 아무것도 없잖아" 라는 지적을 받았다 — 첫 진입
 * 사용자는 빈 탭 두 개를 보고 "Inherit" 탭을 직접 찾아가야 금고를 만들 수 있었다.
 *
 * 그래서 내용이 없는 탭은 아예 감춘다. 한 손가락으로 금고가 만들어지는 경로만
 * 남긴다.
 */
const TABS: { key: TabKey; label: string; needsVault: boolean }[] = [
  { key: "vault", label: "Home", needsVault: true },
  { key: "money", label: "Assets", needsVault: true },
  { key: "inherit", label: "Plan", needsVault: false },
  { key: "support", label: "Help", needsVault: false },
];


/**
 * World Chain 공개 RPC 의 eth_getLogs 최대 범위(100 블록)보다 여유 있게 잡는다.
 * 이 값을 넘기면 노드가 400 을 반환하고, 오류 메시지에 실제 원인이 담기지 않아
 * 사용자에게 "could not coalesce error" 같은 무의미한 문구만 보인다.
 */
const LOG_SCAN_CHUNK = 90;


/**
 * 읽기 전용 provider 생성.
 *
 * 체인 ID를 하드코딩하지 않는다. 이전에는 `{ chainId: 480 }` 을 정적 network 로
 * 넘겨서, 다른 체인(local anvil, World Chain Sepolia 등)에서 연결하면 모든 호출이
 * `network changed: 480 => <실제>` 로 실패했다. 덕분에 이 앱은 메인넷 외에는
 * 아예 테스트가 불가능했다.
 *
 * 대신 실제로 연결된 체인을 조회해 기대 체인과 다르면 경고한다.
 */
async function createProvider(): Promise<ethers.JsonRpcProvider> {
  const p = new ethers.JsonRpcProvider(RPC_URL);
  const net = await p.getNetwork();
  if (net.chainId !== BigInt(CHAIN_ID)) {
    console.warn(
      `Unexpected chain: got ${net.chainId}, expected ${CHAIN_ID}. ` +
        `Check VITE_RPC / VITE_FACTORY_ADDRESS — they must match.`,
    );
  }
  return p;
}

export default function App() {
  const { t, locale } = useLocale();
  // ---- state
  const [provider, setProvider] = useState<ethers.JsonRpcProvider | null>(null);
  const navigationChosenFor = useRef("");
  // signer 경로는 비활성 (World App 내부에서만 실행)
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [account, setAccount] = useState<string>("");
  // Username (World App handle) — used for display; addresses are used on-chain
  const [username, setUsername] = useState<string>("");
  const [homeHeirUsernameRead, setHomeHeirUsernameRead] = useState<{ account: string; address: string; username: string | null } | null>(null);

  /** 로그인 서명을 서버가 실제로 검증했는지. 미검증 로그인은 위험하므로 구분한다. */
  const [serverVerified, setServerVerified] = useState<boolean>(false);
  const [verified, setVerified] = useState<boolean>(!REQUIRE_VERIFY);
  const [status, setStatus] = useState<string>("");

  const [heir, setHeir] = useState<string>("");
  const [heirResolved, setHeirResolved] = useState<{ username?: string; address?: string } | null>(null);
  const [resolvingHeir, setResolvingHeir] = useState<boolean>(false);
  // Period (days) — use string input to avoid forced 0 when user clears field
  /**
   * 주기 입력 필드.
   *
   * 고정값 "30" 으로 시작하면 문제가 된다 — 실제로 200일 주기 금고에서 아무것도 입력하지
   * 않고 "Change period" 을 누르면 30일로 바뀌고 마감이 170일 앞당겨진다. 조작하지 않은
   * 필드가 조작한 것처럼 보이면 그대로 눌러 버린다.
   */
  // 초기값은 30일. 금고가 없을 때 시드할 값이 없으므로 빈 칸으로 두면 periodValid 가
  // false 가 되어 "Create vault" 가 영영 켜지지 않는다 — 아무도 금고를 만들 수 없다.
  // 금고가 있으면 아래 시드가 실제 값(예: 90일)으로 덮어쓴다.
  const [periodInput, setPeriodInput] = useState<string>("30");
  const periodTouchedRef = useRef(false);
  const onPeriodChange = (raw: string) => {
    // allow only digits; keep empty while editing
    const v = (raw || '').replace(/\D+/g, '');
    setPeriodInput(v);
    periodTouchedRef.current = true;
    if (v === '') return; // don't coerce to 0 while user is clearing
    let n = parseInt(v, 10);
    if (Number.isNaN(n)) return;
    if (n < 0) n = 0; // temporarily allow 0 during typing; gate with validPeriod
    if (n > 365) n = 365;
  };
  const periodNum = useMemo(() => {
    const n = parseInt(periodInput || '', 10);
    return Number.isFinite(n) ? n : NaN;
  }, [periodInput]);
  const periodValid = useMemo(() => Number.isFinite(periodNum) && periodNum >= 1 && periodNum <= 365, [periodNum]);

  const [vault, setVault] = useState<string>("");
  const [vaultIdentity, setVaultIdentity] = useState<{
    address: string; factory: string; owner: string; heir: string; released: boolean;
  } | null>(null);
  // Roles and transaction routing belong to one verified vault. Changing the
  // selection invalidates all three immediately, before an asynchronous read.
  const identityMatchesVault = Boolean(vault && vaultIdentity?.address.toLowerCase() === vault.toLowerCase());
  const vaultFactory = identityMatchesVault ? vaultIdentity!.factory : "";
  const vaultOwner = identityMatchesVault ? vaultIdentity!.owner : "";
  const vaultHeir = identityMatchesVault ? vaultIdentity!.heir : "";
  const selectedYieldRoute = yieldRouteFor(vaultFactory);
  const isYieldVault = Boolean(selectedYieldRoute);
  const isUsdcVault = selectedYieldRoute?.symbol === "USDC";
  const selectedAssetAddress = selectedYieldRoute?.asset ?? WLD_ADDRESS;
  const selectedStrategyAddress = selectedYieldRoute?.strategy ?? MORPHO_VAULT_ADDRESS;
  const selectedFactoryAbi = selectedYieldRoute?.factoryAbi ?? FACTORY_ABI;
  const selectedVaultAbi = selectedYieldRoute?.vaultAbi ?? VAULT_ABI;
  const [planWldAmount, setPlanWldAmount] = useState("");
  const [planUsdcAmount, setPlanUsdcAmount] = useState("");
  const [yieldConsent, setYieldConsent] = useState(false);
  const consentedStrategyFees = useRef<Partial<Record<AssetSymbol, number>>>({});
  const [yieldTermsByFactory, setYieldTermsByFactory] = useState<Record<string, YieldTerms | null>>({});
  const yieldTerms = selectedYieldRoute ? yieldTermsByFactory[selectedYieldRoute.factory] ?? null : null;
  const [yieldRatesByFactory, setYieldRatesByFactory] = useState<Record<string, YieldRates | null>>({});
  const yieldRates = selectedYieldRoute ? yieldRatesByFactory[selectedYieldRoute.factory] ?? null : null;
  const [yieldRatesLoading, setYieldRatesLoading] = useState(false);
  const [yieldPosition, setYieldPosition] = useState<YieldPosition | null>(null);
  const [incomeRead, setIncomeRead] = useState<{
    scope: string; state: "loading" | "available" | "unavailable" | "error"; gross: bigint; fee: bigint;
    net: bigint; withdrawableNet: bigint; valued: boolean;
  } | null>(null);
  const incomeHistoryRequest = useRef(0);
  const [incomeHistoryRead, setIncomeHistoryRead] = useState<IncomeHistoryView | null>(null);
  const incomeHistoryReadRef = useRef<IncomeHistoryView | null>(null);
  incomeHistoryReadRef.current = incomeHistoryRead;
  const [incomeTo, setIncomeTo] = useState("");
  const [yieldHoldings, setYieldHoldings] = useState<{ scope: string; idle: bigint; shares: bigint } | null>(null);
  const [receivedRewards, setReceivedRewards] = useState<{ scope: string; amount: bigint } | null>(null);
  const [heldRewardCash, setHeldRewardCash] = useState<{ scope: string; amount: bigint } | null>(null);
  const [yieldReadError, setYieldReadError] = useState<{ scope: string; failed: boolean } | null>(null);
  const [rewardState, setRewardState] = useState<{ scope: string; data: WldRewards | null; loading: boolean; error: string } | null>(null);
  const rewardRequest = useRef(0);
  const invalidateRewardReads = useCallback(() => { rewardRequest.current++; }, []);
  const [yieldRecipient, setYieldRecipient] = useState<{ vault: string; address: string } | null>(null);
  const receivedYieldInheritance = isYieldVault && yieldRecipient?.vault.toLowerCase() === vault.toLowerCase()
    && yieldRecipient.address.toLowerCase() === account.toLowerCase();
  const selectedYieldPosition = isYieldVault && yieldPosition?.vault.toLowerCase() === vault.toLowerCase() ? yieldPosition : null;
  const [walletShares, setWalletShares] = useState<{ account: string; amounts: Record<string, bigint> }>({ account: "", amounts: {} });
  const walletYieldShares = (route: YieldRoute) => walletShares.account.toLowerCase() === account.toLowerCase() ? walletShares.amounts[route.factory] ?? 0n : 0n;
  const [walletBalances, setWalletBalances] = useState<{ account: string; amounts: Partial<Record<AssetSymbol, bigint>> }>({ account: "", amounts: {} });
  const planWalletBalances = walletBalances.account.toLowerCase() === account.toLowerCase() ? walletBalances.amounts : {};
  const [pendingPlan, setPendingPlan] = useState<StoredPlan | null>(null);
  const pendingDeposit = hasPendingPlanDeposit(pendingPlan, account, vaultFactory, vault);
  const [alignmentReview, setAlignmentReview] = useState<string>("");
  const [alignmentConflicts, setAlignmentConflicts] = useState<PlanAlignmentConflict[]>([]);
  const [checkinReview, setCheckinReview] = useState<{ fingerprint: string; claimCount: number } | null>(null);
  const [ownedPlanRead, setOwnedPlanRead] = useState<{
    account: string; loading: boolean; incomplete: boolean;
    unavailableSymbols: AssetSymbol[];
    items: Array<{ address: string; factory: string; symbol: AssetSymbol; balance: bigint | null; additionalWld: bigint | null; heir: string; period: number; periodSeconds: bigint; lastPing: bigint; active: boolean | null }>;
  }>({ account: "", loading: false, incomplete: false, unavailableSymbols: [], items: [] });
  const ownedPlanRequest = useRef(0);
  type OwnedVault = { address: string; factory: string };
  const [ownedVaultRead, setOwnedVaultRead] = useState<{
    account: string; items: OwnedVault[]; incomplete: boolean; unavailableFactories: string[];
  }>({ account: "", items: [], incomplete: false, unavailableFactories: [] });
  const ownedVaults = ownedVaultRead.account === account.toLowerCase() ? ownedVaultRead.items : [];
  const vaultLookupIncomplete = ownedVaultRead.account === account.toLowerCase() && ownedVaultRead.incomplete;
  const ownedVaultCache = useRef<{ account: string; items: OwnedVault[] }>({ account: "", items: [] });
  const vaultLookupRequest = useRef(0);
  const vaultLookupAccount = useRef(account.toLowerCase());
  vaultLookupAccount.current = account.toLowerCase();
  /**
   * `?vault=` 링크로 넘어온 금고.
   *
   * 별도 상태로 두는 이유: 예전에는 링크 파라미터를 곧바로 `vault` 에 넣었는데 그 다음
   * `loadVault` 가 "내 소유 금고" 로 `vault` 를 덮어썼다. 그래서 **자기 금고가 있는
   * 사람이 상속인 링크를 열면 자기 금고만 보게 되었고**, 링크가 가리키는 상속 대상은
   * 신청 버튼도 잔액도 오류도 없이 화면에서 사라졌다. 링크는 이 앱이 상속인에게
   * 알려주는 유일한 확실한 경로이므로 조용히 버리면 그 약속이 통째로 사라진다.
   */
  const [linkedVault, setLinkedVault] = useState<string>("");
  /** 내 소유 금고 주소. 링크 금고를 보고 있는 동안에도 잃지 않는다. */
  const [ownVault, setOwnVault] = useState<string>("");
  /**
   * `?vault=` 링크가 읽히지 않았을 때의 이유.
   *
   * 조용히 무시하면 안 된다. 예전에는 잘못된 링크를 그냥 버겼고, 그 결과 사용자는
   * 자기 금고도 없는 빈 화면을 보며 "이 앱이 왜 아무것도 안 보여주지" 라고 생각했다.
   * 틀린 입력인지, 앱이 고장인지, 링크가 오래된 것인지 구분하려면 이유를 말해야 한다.
   */
  const [linkError, setLinkError] = useState<string>("");
  /**
   * 화면의 데이터가 체인의 현재 상태와 일치하는가.
   *
   * `true` = 최신 (배너 없음), `false` = 체인에 닿지 못했으니 숫자를 믿으면 안 됨 (배너 표시).
   * 이름이 뒤집혀 보인다(`stale` 가 true 면 최신) — 실제로도 그렇고, 배너 조건이
   * `!stale` 이라 오해가 반복돼 왔던 만큼 여기서 못 박아 둔다.
   *
   * RPC 가 죽었을 때 예전에는 조용히 넘어가서 갱신되지 않은 숫자를 계속 보여줬다.
   * 사용자가 보기에는 "내가 한 갱신이 반영되지 않았다", "내 돈이 사라졌다" 다. 실제로는
   * 서버에 닿지 않았을 뿐이고 온체인 상태는 그대로다. 이 플래그로 그 구분을 화면에
   * 드러낸다.
   */
  const [stale, setStale] = useState<boolean>(true);

  /**
   * 체인 생존 확인 폴.
   *
   * 각 데이터 읽기가 실패할 때 플래그를 바꾸는 방식만으로는 배너가 **끼어 stuck** 한다.
   * 금고가 없는 사용자는 `vaultCtr` 이 null 이라 모든 읽기가 조기 반환하고, 그래서
   * 플래그를 되돌릴 방법이 없다 — 체인이 이미 살아 있어도 배너가 계속 뜨는 상태가 된다.
   * 실제로 처음 로그인 직후 체인이 아직 올라오는 중이면 이 상태로 빠진다.
   *
   * 그래서 가장 싸고 독립적인 호출(`getBlockNumber`) 하나를 주기적으로 때려서 플래그의
   * 단일 기준점으로 삼는다. 읽기 실패는 빠른 피드백용으로만 남기고, 여기서 확정한다.
   */
  useEffect(() => {
    if (!provider) return;
    let stopped = false;
    const probe = async () => {
      try {
        await provider.getBlockNumber();
        if (!stopped) setStale(true);
      } catch {
        if (!stopped) setStale(false);
      }
    };
    void probe();
    const id = setInterval(() => { void probe(); }, 10000);
    const onVis = () => { if (document.visibilityState === "visible") void probe(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [provider]);
  const vaultDetailsEpoch = useRef(0);
  const [vaultHeartbeat, setVaultHeartbeat] = useState<number>(0);
  /**
   * 체인의 현재 시각(초, unix).
   *
   * 상대 시간 표시의 기준. 예전에는 `Date.now()` 를 썼는데, 휴대전화 시계가 며칠
   * 틀어져 있으면 "이의제기 7일 남음" 같은 표시가 실제보다 며칠 길어진다. 그 사이
   * 상대는 이미 수령했고 돈은 옮겨졌다. 그래서 블록 타임스탬프를 읽어 상대 시간을
   * 계산한다. 체인을 못 읽으면(오프라인) 0 이고, 그때만 장치 시계로 물러난다.
   */
  const [chainNow, setChainNow] = useState<number>(0);
  const [vaultLastPing, setVaultLastPing] = useState<number>(0);
  const [vaultCreatedBlock, setVaultCreatedBlock] = useState<number | null>(null);
  const [vaultCreatedTime, setVaultCreatedTime] = useState<number | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);

  /**
   * 하단 탭으로 화면을 나눈다.
   *
   * 심사 가이드라인이 "Avoid footers, sidebars, and excessive scrolling" 이라 명시하고
   * 나쁜 예시를 "Footer and long scrolling" 으로 든다. 카드를 한 줄로 늘어놓으면 390px
   * 화면에서 스크롤 6회 이상을 요구해서 그대로 기각 사유가 됐다.
   *
   * 탭은 4개만 둔다. 그 이상은 탐색 비용이 이득보다 크고, 모바일에서 고를 수 있는
   * 목표 수가 줄어드는 것이 오히려 usability 다.
   */
  const [tab, setTab] = useState<TabKey>("inherit");
  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector<HTMLElement>(".page-intro h1")?.focus({ preventScroll: true });
  }, [tab]);

  /**
   * 실제로 보여줄 탭.
   *
   * Vault 는 소유자 요약이 있을 때만 보이고, Send 는 선택된 금고가 있을 때 보인다.
   * 상속 링크만 가진 사용자는 상태와 타이머를 Inherit 에서 보므로 owner-only Vault 를
   * 노출하지 않는다. 기본 탭은 첫 진입 사용자도 계획을 만들 수 있는 Inherit 다.
   *
   * 금고가 슬롯 해제 등으로 사라지면 현재 탭이 보이지 않게 되므로 Inherit 로 되돌린다.
   */
  const visibleTabs = TABS.filter(t => t.key === "vault" ? Boolean(ownVault) : t.needsVault ? Boolean(vault) : true);
  /** 현재 탭에 실제 카드가 하나라도 있는지. 금고 로딩 중이거나 조건이 어긋난 경우를 잡는다. */
  const tabHasContent =
    tab === "support" || tab === "inherit" || (tab === "vault" ? Boolean(ownVault) : Boolean(vault));
  const tabStillVisible = visibleTabs.some((t) => t.key === tab);
  useEffect(() => {
    if (!tabStillVisible) setTab("inherit");
  }, [tabStillVisible]);

  /**
   * 상속은 이제 두 단계다. 만료만으로는 자금이 움직이지 않는다.
   *
   *   active      갱신 가능. owner 가 ping 로 기한을 연장한다.
   *   expired     기한이 지났고 상속인이 아직 아무것도 하지 않음 →Funds 는 그대로
   *   challenging 상속인이 신청했고 owner 가 이의 제기할 수 있는 7일
   *   claimable   이의제기 기간이 지남 → heir 가 최종 수령 가능
   *   settled     최종 수령 완료
   *   cancelled   상속이 취소됨 (heir = owner)
   *
   * `canClaim` 은 예전의 "지금 수령 가능"이었다. 이제는 `claimable` 만 그 의미를
   * 갖는데, 상속인이 7일 전에 돈을 가져갈 수 없다는 뜻이라 UI 에 그대로 쓰면 안 된다.
   */
  const [vaultPhase, setVaultPhase] = useState<VaultPhase>("active");
  /**
   * 상속 취소 여부 (heir == owner). **생애 단계와 분리**한다.
   *
   * 예전에는 `vaultPhase === "cancelled"` 로 알았다. 그런데 취소는 **갱신 기한 전**에
   * 도는 행동이라서, 취소한 직후에도 카운트다운이 계속 돈다. 그때까지 "cancelled"
   * 로 잡으면 카운트다운이 도는 금고가 만료된 것처럼 취급되어:
   *   - 입금이 막히고 (계약은 허용)
   *   - 기간변경·상속인변경이 비활성화된다 (계약은 허용 — 취소를 되돌릴 수 있다)
   *   - 잔액이 0 이면 슬롯 해제 버튼이 보인다 (그 순간 계약은 NotExpired 로 거절한다)
   * 즉 계약이 허용하는 일들을 UI 가 막고, 계약이 거절할 일을 권하는 잘못된 방향.
   * 계약 테스트(test_CancelledVaultControlMatrixAfterExpiry)가 이 차이를 고정한다.
   */
  const [cancelledFlag, setCancelledFlag] = useState<boolean>(false);
  const [challengeEndsAt, setChallengeEndsAt] = useState<number>(0);
  /** 최종 수령이 지금 가능한 상태인지 (= 이의제기 기간이 지났고 신청이 들어옴). */
  const canClaim = vaultPhase === "claimable";
  /** 상속인이 신청만 하고 아직 이의제기 기간이 남은 상태. */
  const challengeRunning = vaultPhase === "challenging";
  /** 기한이 지났지만 상속인이 아직 신청하지 않은 상태. */
  const awaitingClaim = vaultPhase === "expired";
  const inheritanceCancelled = cancelledFlag;
  const isSettledClaim = vaultPhase === "settled";
  /**
   * 기한이 지나 상속 파이프라인이 시작된 상태인가.
   *
   * ownerWithdraw / cancelInheritance / period 변경 / heir 변경은 기한 이후 전부 revert 된다.
   * 예전처럼 `canClaim`(이의제기 종료) 만으로 게이트하면 7일 창이 열려 있는 동안
   * 항상 실패하는 버튼을 사용자에게 활성화해 보낸다. 신청 대기(`expired`) 와
   * 이의제기 중(`challenging`) 을 모두 포함시켜야 한다.
   */
  /**
   * 마감이 끝난 뒤의 모든 상태.
   *
   * `cancelled` 를 반드시 포함해야 한다. 상속 취소(heir = owner)는 기한이 지난 상태에서
   * 성립하므로 카운트다운은 이미 끝났고, 잔액이 0 이면 슬롯을 해제할 수 있다. 그런데 이
   * 값에서 빠지면 `Release slot` 게이트가 영영 false 라서 **사용자가 자기 금고 자리를
   * 되돌려받을 수 없고 두 번째 금고를 만들 수 없다.** 취소된 금고는 상속인이 따로
   * 없으므로 `awaitingClaim` 도 `challengeRunning` 도 아니다.
   */
  const isExpiredOrLater =
    awaitingClaim || challengeRunning || canClaim || isSettledClaim || vaultPhase === "cancelled";
  // 상속 파이프라인 단계 배열과 현재 단계는 `challengeDays` (useState) 아래에 둔다.
  // 여기 두면 TDZ 에 걸린다 — 선언보다 먼저 읽으므로.
  /**
   * 이의제기 기간의 남은 초. 0 아래로 내려가지 않게 한다.
   *
   * 기준은 **장치 시계가 아니라 체인** 이다. 예전에는 `Date.now()` 를 썼는데, 휴대전화
   * 시계가 며칠 느리면 소유자에게 그만큼 더 남았다고 보이고 — 그 사이 상속인이 수령해
   * 버린다. "7일 남았다" 고 표시하는데 실제로는 2일 남은 상황이 가능하다. 상대 시간은
   * 체인에서 온 값만 쓴다.
   */
  const challengeRemaining = Math.max(0, challengeEndsAt - (chainNow > 0 ? chainNow : Math.floor(Date.now() / 1000)));
  /** 이의제기 기간(일). 컨트랙트 상수를 읽되 실패하면 기본값으로 버틴다. */
  const [challengeDays, setChallengeDays] = useState(7);

  const wldSymbol = selectedYieldRoute?.symbol ?? "WLD";
  const wldDecimals = selectedYieldRoute?.decimals ?? 18;
  const [walletBalanceRead, setWalletBalanceRead] = useState<{ scope: string; amount: bigint }>({ scope: "", amount: 0n });
  const [vaultBalanceRead, setVaultBalanceRead] = useState<{ scope: string; amount: bigint }>({ scope: "", amount: 0n });
  const balanceScope = `${account.toLowerCase()}:${vault.toLowerCase()}:${vaultFactory.toLowerCase()}`;
  const walletWld = walletBalanceRead.scope === balanceScope ? walletBalanceRead.amount : 0n;
  const walletBalanceKnown = walletBalanceRead.scope === balanceScope;
  const vaultWld = vaultBalanceRead.scope === balanceScope ? vaultBalanceRead.amount : 0n;
  const balanceScopeRef = useRef(balanceScope);
  balanceScopeRef.current = balanceScope;
  const selectedYieldHoldings = isYieldVault
    ? yieldHoldings?.scope === balanceScope ? yieldHoldings : selectedYieldPosition
    : null;
  const vaultHasAssets = isYieldVault
    ? Boolean(selectedYieldHoldings && (selectedYieldHoldings.shares > 0n || selectedYieldHoldings.idle > 0n)
      || isUsdcVault && heldRewardCash?.scope === balanceScope && heldRewardCash.amount > 0n)
    : vaultWld > 0n;
  // Verified idle cash is recoverable even if a cached valuation is lower.
  const vaultWldForWithdrawal = isYieldVault && selectedYieldHoldings && selectedYieldHoldings.idle > vaultWld
    ? selectedYieldHoldings.idle : vaultWld;
  const selectedRewards = rewardState?.scope === balanceScope ? rewardState : null;
  const selectedReceivedRewards = receivedRewards?.scope === balanceScope ? receivedRewards.amount : null;
  const selectedIncome = incomeRead?.scope === balanceScope ? incomeRead : null;
  const selectedIncomeHistory = incomeHistoryRead?.scope === balanceScope ? incomeHistoryRead : null;
  const hasRewardAction = Boolean((selectedRewards?.data?.claimable ?? 0n) > 0n
    || (selectedReceivedRewards ?? 0n) > 0n
    || isUsdcVault && heldRewardCash?.scope === balanceScope && heldRewardCash.amount > 0n);
  const incomeRecipientValid = Boolean(incomeTo && ethers.isAddress(incomeTo)
    && ethers.getAddress(incomeTo) !== ethers.ZeroAddress);
  const [amountStr, setAmountStr] = useState("");
  const depositAmount = parseAssetAmount(amountStr.trim() || "0", wldDecimals);
  const depositEntryValid = depositAmount !== null && depositAmount > 0n && walletBalanceKnown && depositAmount <= walletWld;
  const [withdrawTo, setWithdrawTo] = useState<string>("");
  const [withdrawAmountStr, setWithdrawAmountStr] = useState<string>("");
  useEffect(() => {
    setAmountStr("");
    setWithdrawAmountStr("");
    setWithdrawTo("");
    setIncomeTo("");
  }, [account, vault]);
  const [newHeir, setNewHeir] = useState<string>("");
  const [newHeirResolved, setNewHeirResolved] = useState<{ username?: string; address?: string } | null>(null);
  const [resolvingNewHeir, setResolvingNewHeir] = useState<boolean>(false);
  const heirSeqRef = useRef<number>(0);
  const newHeirSeqRef = useRef<number>(0);
  const toastSeqRef = useRef<number>(0);
  const [copied, setCopied] = useState<null | "vault" | "owner" | "heir" | "wld">(null);
  const [supportsRelease, setSupportsRelease] = useState<boolean>(RELEASE_SUPPORTED);
  const [showReleaseConfirm, setShowReleaseConfirm] = useState<boolean>(false);
  /**
   * 상속 파이프라인 다섯 단계, 그리고 지금 몇 번째인가.
   *
   * `done` 만으로는 부족했다. 다섯 줄이 전부 회색(앞날)이거나 전부 파랑(지나감)으로
   * 보여서 읽는 사람이 **지금 어디에 있는지** 알 수 없었다. 이 파이프라인의 존재 이유가
   * "내 돈이 언제 움직이는지 머릿속에서 계산하지 않게 하는 것" 인데 현재 위치가 없으면
   * 단계 목록에 불과하다. 그래서 세 번째 상태(지금) 를 명시적으로 만든다.
   *
   * `done` 의 뜻은 오직 "지나갔다" 다. 카운트다운이 돌아가는 동안 1단계를 `done` 으로
   * 찍으면 눈에는 이미 끝난 단계와 똑같이 보이고, 카운트다운이 끝난 뒤엔 다시 미완료로
   * 돌아가 첫 단계가 아직 시작 안 된 것처럼 보인다 — 양쪽 방향으로 틀린다.
   */
  const inheritanceSteps = [
    { k: "Counting down", done: vaultPhase !== "active" },
    { k: "Countdown ended", done: awaitingClaim || challengeRunning || canClaim || isSettledClaim },
    { k: "Heir files a claim", done: challengeRunning || canClaim || isSettledClaim },
    { k: `${challengeDays}-day review window`, done: canClaim || isSettledClaim },
    { k: "Heir withdraws", done: isSettledClaim },
  ];
  /** 아직 지나지 않은 첫 단계의 인덱스. 전부 지나면 -1 (= 절차를 다 쓴 상태). */
  const inheritanceNowStep = inheritanceSteps.findIndex((s) => !s.done);
  /**
   * "How this works" 를 펼쳐 둘 것인가.
   *
   * 닫힌 채로 둔다. **펼쳐 둔 채로는 첫 진입 화면이 설명 문서였다** — 3단계 목록과
   * 제약 세 문단이 카운트다운도 금액도 없는 채 화면 전체를 차지했고, Create 버튼은
   * 두 화면 반을 스크롤한 뒤에야 나왔다. "오해한 채 만드는 것보다 위가 낫다" 고
   * 판단해서 올렸지만, 실제로는 **읽히는 사람이 아무도 없었다.** 상단 한 줄 요약은
   * 계속 보이므로 정보는 사라지지 않고(3단계 · 금고 1개 · 기한 전 취소 가능), 규칙을
   * 아는 사람은 펼치면 된다.
   */
  /** 모달 안의 포커스 대상을 순환시키기 위한 ref (Tab 가두기). */
  const releaseDialogRef = useRef<HTMLDivElement | null>(null);
  const [releasing, setReleasing] = useState<boolean>(false);
  const [sweeping, setSweeping] = useState<boolean>(false);
  const [releaseAcknowledge, setReleaseAcknowledge] = useState<boolean>(false);
  const [ctaLoading, setCtaLoading] = useState<boolean>(false);
  const [creating, setCreating] = useState(false);
  const [pendingAction, setPendingAction] = useState(false);
  const actionInFlight = useRef(false);
  const runWalletAction = async (action: () => Promise<void>) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setPendingAction(true);
    try { await action(); }
    finally { actionInFlight.current = false; setPendingAction(false); }
  };
  const savePendingPlan = (next: StoredPlan) => {
    const key = storedPlanKey(next.account);
    const serialized = JSON.stringify(next);
    try {
      sessionStorage.setItem(key, serialized);
      if (sessionStorage.getItem(key) !== serialized) throw new Error("Recovery record was not retained.");
    } catch {
      throw new Error("Your browser could not save the plan recovery record. Restore session storage and reopen the app before continuing.");
    }
    setPendingPlan(next);
  };
  const clearPendingPlan = (address: string) => {
    try {
      sessionStorage.removeItem(storedPlanKey(address));
      if (sessionStorage.getItem(storedPlanKey(address)) !== null) throw new Error("Recovery record was not cleared.");
    } catch {
      throw new Error("Your browser could not clear the saved setup. Restore session storage and reopen the app before continuing.");
    }
    setPendingPlan(null);
  };
  useEffect(() => {
    if (!account) { setPendingPlan(null); return; }
    const restored = readStoredPlan(account);
    setPendingPlan(restored);
    if (!restored) {
      try { sessionStorage.removeItem(storedPlanKey(account)); } catch { /* session storage may be unavailable */ }
    }
  }, [account]);
  const runVaultAction = async (action: () => Promise<void>) => {
    if (actionInFlight.current) return;
    if (action !== createPlan && !identityMatchesVault) {
      setStatus("Wait for this vault to be verified before continuing.");
      return;
    }
    if (vaultIdentity?.released && action !== recoverArchivedYieldAssets && action !== claimYieldRewards && action !== processReceivedYieldRewards && action !== createPlan && action !== fileClaim && action !== claim) {
      setStatus("This vault is archived. Its remaining rewards and inheritance can still reach the named recipient.");
      return;
    }
    await runWalletAction(action);
  };
  const [heirFoundVaults, setHeirFoundVaults] = useState<string[]>([]);
  const [heirSearchNote, setHeirSearchNote] = useState("");
  const [heirScanIncomplete, setHeirScanIncomplete] = useState(false);
  const [findingHeirVaults, setFindingHeirVaults] = useState<boolean>(false);
  /** 상속인의 월드챗 유저네임 — 월드챗으로 직접 보내려면 필요하다. */
  const [heirVaultUsername, setHeirVaultUsername] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState<boolean>(false);
  /**
   * 상속인 스캔을 이미 시도했는가.
   *
   * 월드앱 알림은 앱을 설치하지 않은 지갑에 도달하지 못한다("User not found").
   * 즉 상속인이 자기가 상속인이라는 사실을 알게 하는 경로는 두 개뿐이다:
   * 주인이 직접 알려주거나, 상속인이 스스로 앱을 여는 것. 두 번째 경로에서
   * 사용자가 "Find my vaults" 버튼을 먼저 알아채야만 했다면 대부분은
   * 모른다. 그래서 내 금고가 없는 계정은 열자마자 스스로 조회한다.
   */
  const [heirScanAttempted, setHeirScanAttempted] = useState<boolean>(false);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [miniInstalled, setMiniInstalled] = useState<boolean>(false);
  type ToastType = 'info' | 'success' | 'error';
  type Toast = { id: number; type: ToastType; msg: string };
  type NotifyPermissionState = "unknown" | "granted" | "denied";
  type WatchState = "unknown" | "registered" | "not_registered";
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notifyPermission, setNotifyPermission] = useState<NotifyPermissionState>("unknown");
  /**
   * 이 앱이 직접 권한을 요청한 적이 있는가.
   *
   * MiniKit 2.x 의 `getPermissions` 는 `notifications: boolean` 만 준다. 그래서
   * **"아직 요청하지 않았다" 와 "요청하고 거절당했다" 가 구분되지 않는다.** 둘 다
   * false 다. 구분하지 않으면 처음 들어온 사람에게 "World App is blocking
   * notifications" 라고 말하는데, 아무것도 막은 사람이 없다 — 그저 아직 켜지 않은
   * 뿐이다. 그래서 우리가 직접 물어봤는지를 따로 기억한다.
   */
  const [notifyAsked, setNotifyAsked] = useState<boolean>(false);
  const notifyWatchKey = account && vault ? `${account.toLowerCase()}:${vault.toLowerCase()}` : "";
  const notifyWatchScope = useRef(notifyWatchKey);
  notifyWatchScope.current = notifyWatchKey;
  const notifyWatchRequest = useRef(0);
  const [notifyWatch, setNotifyWatch] = useState<{ key: string; state: WatchState }>({ key: "", state: "unknown" });
  const notifyWatchState = notifyWatchKey && notifyWatch.key === notifyWatchKey ? notifyWatch.state : "unknown";
  const [notifyBusy, setNotifyBusy] = useState<boolean>(false);
  const [watchBusy, setWatchBusy] = useState<boolean>(false);
  /**
   * 실제 발송 결과에서 온 마지막 사유.
   *
   * World App 알림 API 는 200 을 주면서도 `sent:false` 로 "User has disabled
   * notifications" 나 "User not found" 를 돌려준다. 이걸 화면에 안 띄우면 사용자는
   * "알림이 안 온다" 는 사실조차 모르고, 자기 설정 탭을 뒤지다가 돌아온다. 실제로
   * 확인된 값: World App 유저인데 설정을 꺼둬서 이 사유로 발송이 막혔다.
   */
  const [notifyDeliveryNote, setNotifyDeliveryNote] = useState<string>("");

  /**
   * 알림이 지금 "되고 있는가" 를 사용자 언어로.
   *
   * 예전 화면은 `unknown` / `not_registered` / `enabled` 라는 내부 상태값을 그대로
   * 노출했다. 사용자는 그것을 보고 무엇을 해야 하는지 알 수 없었다. 이 앱에서 알림은
   * 선택이 아니라 핵심 경로다 — 카운트다운이 끝나기 전에 알림이 없으면 피상속인은
   * 갱신을 잊고, 상속인은 신청 시점을 놓친다. 그래서 "무엇이 되고 있지 않은가" 를
   * 무엇을 고쳐야 하는지와 함께 말한다.
   */
  const notifyHealth = useMemo(() => {
    if (!NOTIFY_BACKEND_ENABLED) {
      return { level: "checking" as const, text: "" };
    }
    // 카피는 짧게 유지한다. 카운트다운 바로 아래에 붙는 자리라 길어지면 실제 조작
    // 버튼을 화면 아래로 밀어낸다. "무엇이 되고 있지 않은가" 만 남기고 **결과는
    // 아래 문장이 말한다** — 이 자리의 `text` 는 "무엇을 고쳐야 하는가" 만 한다.
    //
    // 예전엔 여기서 "…nobody will be told if you stop renewing" 까지 말했는데, 바로 아래
    // "If you stop renewing, your heir can file a claim and take the balance…" 가 같은
    // 사실을 다시 말했다. 같은 화면에서 같은 말을 두 번 하면 하나가 거짓말처럼
    // 읽힌다. **결과는 그 문장 한 곳에만 남긴다.**
    //
    // "Notifications are off" 라는 문구는 유지한다 — 하네스가 이 상태를 문자열로
    // 판정한다(notify-ux.mjs). 문구를 바꾸면 검사가 아니라 문자열 검색이 된다.
    if (notifyPermission === "denied" && notifyAsked) {
      // 우리가 물어봤는데 여전히 false 다. 누군가 actively 거절한 상태이므로 "꺼짐"
      // 보다 강한 말이 이 자리에 필요하다.
      return { level: "broken" as const, text: "World App is blocking notifications — turn them on in World App → Settings." };
    }
    if (notifyPermission !== "granted") {
      // 아직 켜지 않았거나 알 수 없는 경우. "누가 막았다" 고 말할 근거가 없으므로
      // 그렇게 말하지 않는다.
      return { level: "off" as const, text: "Notifications are off." };
    }
    if (notifyWatchState === "not_registered") {
      return { level: "broken" as const, text: "This vault is not being watched." };
    }
    if (notifyWatchState === "registered") {
      if (notifyDeliveryNote) {
        return {
          level: "broken" as const,
          text: `World App took the request but did not deliver it (${notifyDeliveryNote}).`,
        };
      }
      return { level: "ok" as const, text: "Reminders are enabled for you. Your heir must enable their own notifications separately." };
    }
    return { level: "checking" as const, text: "Checking notification status…" };
  }, [notifyPermission, notifyWatchState, notifyDeliveryNote, notifyAsked]);

  /**
   * 알림이 실제로 필요할 때만 배너를 띄우기 위한 판정.
   *
   * 잔액이 0 이면 보낼 알림이 없다(백엔드가 그러게 되어 있다). 그때 경고하면
   * "알림이 안 되는데 아무 일도 안 일어나는" 노이즈가 된다.
   */
  const notifyNeedsAttention =
    NOTIFY_BACKEND_ENABLED &&
    vaultWld > 0n &&
    (notifyHealth.level === "broken" || notifyHealth.level === "off");
  /**
   * 알림 경고를 **올릴** 시점.
   *
   * 알림이 꺼져 있다는 사실만으로 박자를 칠하면 노이즈가 된다 — 사용자가 고칠 수 있는
   * 일이 없을 수도 있기 때문이다(카운트다운이 며칠 남았으면 굳이 급하지 않다).
   * 진짜 급한 건 "마감이 임박했는데 아무도 통보받지 못하는 상태" 다. 그때만 올린다.
   * 경과 25% 이내(또는 이미 지났으면) + 알림이 안 되고 있을 때.
   */
  // 둘 다 number 다. `4n` 으로 나누면 "Cannot mix BigInt and other types" 로 앱이 죽는다 —
  // tsc 는 이걸 잡지 못하고 브라우저에서만 터진다(실제로 그랬다).
  const notifyEscalate =
    notifyNeedsAttention &&
    (isExpiredOrLater || (vaultPhase === "active" && vaultHeartbeat > 0 && timeRemaining < vaultHeartbeat / 4));
  const pushToast = (type: ToastType, msg: string) => {
    // Date.now() 는 같은 밀리초에 여러 토스트가 올라오면 id 가 겹칠 수 있다.
    const id = ++toastSeqRef.current;
    setToasts((t) => [...t, { id, type, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  };

  // 입력 디바운스용 단조 증가 카운터.
  // Date.now() 를 쓰면 같은 밀리초에 발생한 두 이벤트의 seq 가 같아져
  // 오래된 비동기 결과가 최신 입력을 덮어쓸 수 있다.
  const nextSeq = (ref: { current: number }) => ++ref.current;

  // nonce 는 서버가 발급한다(§auth.ts). 클라이언트가 만들면 서버가 검증할 수 없다.
  
  /**
   * eth_getLogs 래퍼.
   *
   * World Chain 공개 RPC 은 한 번의 eth_getLogs 를 최대 100 블록으로 제한한다.
   * 실제로 확인된 오류:
   *   "You can make eth_getLogs requests with up to a 100 block range."
   * 여기서 5000 블록을 요청하면 400 이 돌아오고, ethers 는 그 오류를 분류하지
   * 못해 "could not coalesce error" 라는 무의미한 메시지만 남긴다.
   *
   * 이전 구현은 실패 시 head 기준으로 창을 *좁혀* 재시도했는데(20,000 → 5,000),
   * 그 창들도 100 블록 제한을 넘기 때문에 전부 실패했다. 게다가 좁히면 배포
   * 시점을 지나쳐 버려 상속인 금고를 놓친다.
   *
   * 그래서 범위를 나눠 전부 훑는다. head 에서 과거 방향으로 내려가므로
   * 최근 금고가 있으면 빠르게 답을 준다.
   */
  const safeGetLogs = async (
    p: ethers.AbstractProvider,
    params: { address?: string; topics?: (string | null | string[])[]; toBlock?: number | string; fromBlock?: number },
    onIncomplete?: () => void,
  ): Promise<ethers.Log[]> => {
    const head = await p.getBlockNumber();
    const to = typeof params.toBlock === "number" ? params.toBlock : head;
    const from = Math.max(params.fromBlock ?? FACTORY_DEPLOY_BLOCK ?? 0, head - 1800);
    if (to < from) return [];

    const out: ethers.Log[] = [];
    // Older vaults are found through the authenticated watcher index or a shared link.
    // Bound public RPC work so opening the app never scans years of chain history.
    for (let end = to; end >= from; end -= LOG_SCAN_CHUNK) {
      const start = Math.max(from, end - LOG_SCAN_CHUNK + 1);
      try {
        const logs = await p.getLogs({
          address: params.address,
          topics: params.topics,
          fromBlock: start,
          toBlock: end,
        });
        out.push(...logs);
      } catch {
        onIncomplete?.();
      }
      if (start === from) break;
    }
    // 오래된 순으로 모였으므로 최근 로그가 앞에 오도록 뒤집는다.
    return out.reverse();
  };

  // ---- helpers
  // 이전에는 여기서 null 을 돌려주고 각 핸들러가 `if (prov)` 로 건너뛰었는데,
  // 그러면 provider 가 없을 때 "대기 없이 완료"로 표시되어 버린다.
  // provider 는 account 와 함께 설정되므로, 없으면 그 자체가 오류 상태다.
  const getRwProvider = (): ethers.AbstractProvider => {
    const p = provider as unknown as ethers.AbstractProvider | null;
    if (!p) throw new Error("Not connected. Open the app in World App and sign in first.");
    return p;
  };
  const waitForTxOrEvent = confirmTransaction;
  // const toUnits = (v: bigint) => Number(v) / 10 ** wldDecimals;
  const fmtUnits = (v: bigint, d = wldDecimals) => ethers.formatUnits(v, Number(d) || 0);
  const parseAmount = (s: string) => {
    // Number() 로 한 번 더 변환한다 — 컨트랙트 반환값이 bigint 로 들어와도
    // String.repeat / BigInt() 가 터지지 않도록.
    const dec = Number(wldDecimals) || 0;
    const [i, d = ""] = s.split(".");
    const dd = (d + "0".repeat(dec)).slice(0, dec);
    return BigInt(i || "0") * (10n ** BigInt(dec)) + BigInt(dd || "0");
  };
  const validDecimalInput = (s: string) => /^\d*(?:\.\d*)?$/.test(s) && (s.split(".")[1]?.length ?? 0) <= wldDecimals;
  const gate2 = (node: ReactElement) => {
    if (miniInstalled) return node;
    return (
      <Card>
        <CardHeader><CardTitle>Open in World App</CardTitle></CardHeader>
        <CardContent className="text-sm text-gray-700">
          This mini app runs only inside World App. Please open it in World App to continue.
        </CardContent>
      </Card>
    );
  };


  /**
   * `vault` 가 "내가 소유한 금고" 인지.
   *
   * `vault` 는 상속인 금고를 살펴볼 때도 임시로 채워진다(위 heir 검색의 Use).
   * 그런데 Create 폼의 게이트로 `!!vault` 를 쓰면, 남의 금고를 딱 하나 찾아본
   * 사용자는 이후 영원히 "이미 금고 보유" 상태로 Create 가 비활성화된다.
   * 소유 여부는 on-chain owner 로 판단해야 한다.
   */
  const isVaultOwner = Boolean(vaultOwner) && account.toLowerCase() === vaultOwner.toLowerCase();
  const isMyVault = isVaultOwner && !vaultIdentity?.released;
  const planRouteFor = (symbol: PlanAssetSymbol) => APP_PLAN_ROUTES.find(route => route.symbol === symbol) ?? null;
  const activeOwnedPlans = ownedPlanRead.account === account.toLowerCase()
    ? ownedPlanRead.items.filter(item => item.active === true) : [];
  const ownedPlanTotal = (symbol: AssetSymbol) => {
    const rows = activeOwnedPlans.filter(item => item.symbol === symbol
      || symbol === "WLD" && item.symbol === "USDC" && item.additionalWld !== 0n);
    const valueOf = (item: typeof rows[number]) => item.symbol === symbol ? item.balance : item.additionalWld;
    const unavailable = ownedPlanRead.account === account.toLowerCase()
      && ownedPlanRead.unavailableSymbols.includes(symbol);
    return { rows, unavailable,
      amount: !unavailable && rows.every(item => valueOf(item) !== null)
        ? rows.reduce((sum, item) => sum + (valueOf(item) ?? 0n), 0n) : null };
  };
  const commonPlanSettings = activeOwnedPlans.length > 0
    && activeOwnedPlans.every(item => item.heir.toLowerCase() === activeOwnedPlans[0].heir.toLowerCase()
      && item.periodSeconds === activeOwnedPlans[0].periodSeconds);
  const homeHeirAddress = commonPlanSettings ? activeOwnedPlans[0]?.heir ?? "" : "";
  const homeHeirUsername = homeHeirUsernameRead?.account === account.toLowerCase()
    && homeHeirUsernameRead.address.toLowerCase() === homeHeirAddress.toLowerCase()
    ? homeHeirUsernameRead.username : null;
  useEffect(() => {
    let cancelled = false;
    setHomeHeirUsernameRead(null);
    if (!account || !ethers.isAddress(homeHeirAddress) || homeHeirAddress === ethers.ZeroAddress) return () => { cancelled = true; };
    const expectedAccount = account.toLowerCase();
    const expectedAddress = homeHeirAddress.toLowerCase();
    void getUsernameFor(homeHeirAddress).then(name => {
      if (cancelled) return;
      setHomeHeirUsernameRead({
        account: expectedAccount,
        address: expectedAddress,
        username: name?.trim().replace(/^@/, "") || null,
      });
    });
    return () => { cancelled = true; };
  }, [account, homeHeirAddress]);
  const assetAccounts = ownedVaults.map(item => ({
    ...item,
    symbol: yieldRouteFor(item.factory)?.symbol ?? "WLD" as AssetSymbol,
    current: APP_PLAN_ROUTES.some(route => route.factory.toLowerCase() === item.factory.toLowerCase()),
  }));
  const nextCheckIn = activeOwnedPlans.length && !ownedPlanRead.incomplete
    ? Math.min(...activeOwnedPlans.map(item => Number(item.lastPing + item.periodSeconds))) : null;
  const draftPlanRoutes = APP_PLAN_ROUTES.map(route => {
    const saved = pendingPlan?.assets.find(asset => asset.symbol === route.symbol);
    return saved ? storedPlanRoute(saved) ?? route : route;
  });
  const draftPlanRows = draftPlanRoutes.map(route => ({
    symbol: route.symbol, decimals: route.decimals, mode: route.mode,
    amount: route.symbol === "WLD" ? planWldAmount : planUsdcAmount,
    walletBalance: planWalletBalances[route.symbol] ?? null,
    underlyingFeePercent: yieldTermsByFactory[route.factory]?.underlyingFeePercent,
  }));
  const parsedDraftAmounts = draftPlanRows.map(row => ({
    row,
    amount: row.amount.trim() ? parseAssetAmount(row.amount, row.decimals) : 0n,
  }));
  const selectedDraftRows = parsedDraftAmounts.filter(item => item.amount !== null && item.amount > 0n);
  const draftTermsReady = selectedDraftRows.filter(item => item.row.mode === "morpho").every(item => {
    const route = planRouteFor(item.row.symbol);
    const terms = route?.details ? yieldTermsByFactory[route.factory] : null;
    return Boolean(terms && terms.feeBps === 1000 && ethers.isAddress(terms.recipient) && terms.recipient !== ethers.ZeroAddress);
  });
  const draftAmountsValid = parsedDraftAmounts.every(item => item.amount !== null);
  const draftBalancesReady = selectedDraftRows.every(item => item.row.walletBalance !== null
    && item.amount !== null && item.amount <= item.row.walletBalance);
  const createPlanDisabled = !provider || !miniInstalled || !account || !periodValid || !heirResolved?.address
    || heirResolved.address === ethers.ZeroAddress || !draftAmountsValid || selectedDraftRows.length === 0
    || !draftBalancesReady
    || (selectedDraftRows.some(item => item.row.mode === "morpho") && !draftTermsReady);
  const resumePlanNeedsYieldConsent = Boolean(pendingPlan?.assets.some(asset => asset.mode === "morpho" && asset.depositState === "ready"));
  const resumePlanTermsReady = Boolean(pendingPlan?.assets.filter(asset => asset.mode === "morpho" && asset.depositState === "ready").every(asset => {
    const route = storedPlanRoute(asset);
    const terms = route?.details ? yieldTermsByFactory[route.factory] : null;
    return Boolean(terms && terms.feeBps === 1000 && terms.recipient !== ethers.ZeroAddress);
  }));
  const resumePlanHasOutstandingRequest = Boolean(pendingPlan && (pendingPlan.alignment || pendingPlan.setupRequest
    || pendingPlan.createState === "submitting" || pendingPlan.createState === "submitted"
    || pendingPlan.assets.some(asset => asset.depositState === "submitting" || asset.depositState === "submitted")));
  const resumePlanDisabled = !resumePlanHasOutstandingRequest
    && Boolean(resumePlanNeedsYieldConsent && (!yieldConsent || !resumePlanTermsReady));
  /**
   * 내가 상속인으로 지정됐는가.
   *
   * `!isMyVault` 만 쓰면 "소유자" 와 "나 아닌 사람" 의 **두 갈래**가 되어 세 번째 경우
   * (주인도 아니고 상속인도 아닌 타인)가 소유자 문구를 받는다. `?vault=` 링크는 공개
   * 주소라 아무나 열 수 있다 — 그래서 상속인이 아닌 지갑에게 "You can now file a
   * claim" 이라고 말하는 일이 있었다. 버튼은 없는데도 **수익자를 단정**하는 셈이다.
   */
  const iAmHeir = Boolean(account) && Boolean(vaultHeir) && account.toLowerCase() === vaultHeir.toLowerCase();
  const iAmInvolved = isVaultOwner || iAmHeir;

  /**
   * 남은 시간에 따른 시각적 긴급도.
   *
   * 이 앱은 사용자가 매 주기마다 자금을 "회수당할 위험"에 두게 한다. 그래서
   * 기한이 임박했을 때 화면이 조용하면 사용자가 그대로 잊어버리고 자금을 잃는다.
   * 주기 대비 비율로 판단한다 — 30일 주기면 3일/1일 남았을 때 경고.
   */
  const timerUrgency = useMemo(() => {
    /* 정산·취소된 금고에는 "갱신" 이 없다. 계약상 ping 이 Expired() 로 막힌다.
       그런데 timeRemaining() 은 만료 이후 **모든** 상태에서 0 이라서 ratio 가 0 이 되고,
       이미 돈을 받은 금고에 "Renew urgently" 배지가 붙었다. Send 탭에서도 같았다 —
       갱신할 수 없는 금고를 급하다 고 말하는 셈이다. */
    if (isSettledClaim || vaultPhase === "cancelled") return "";
    if (canClaim) return "timer-expired";
    const period = vaultHeartbeat || 1;
    const ratio = timeRemaining / period;
    if (ratio <= 0.05) return "timer-critical";
    if (ratio <= 0.2) return "timer-urgent";
    return "";
  }, [canClaim, timeRemaining, vaultHeartbeat, isSettledClaim, vaultPhase]);

  const isHeirSuspicious = (): boolean => {
    const c = heirResolved?.address && ethers.isAddress(heirResolved.address)
      ? ethers.getAddress(heirResolved.address)
      : (ethers.isAddress(heir) ? ethers.getAddress(heir) : "");
    if (!c) return false;
    // 자기 자신을 상속인으로 두는 것은 허용되지만(사실상 자동 이전 해제),
    // 0x0 은 컨트랙트가 거절하므로 경고 대상이다.
    // account 가 비어 있을 때 `boolean | ""` 를 반환하지 않도록 명시적으로 비교한다.
    return c === ethers.ZeroAddress || (!!account && c === ethers.getAddress(account));
  };
  const fmt = (s: number) => {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${d}d ${h}h ${m}m ${sec}s`;
  };
  // Expiry timestamp & display (uses device locale/timezone)
  const deviceTimeZone = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'; } catch { return 'local time'; }
  }, []);
  const expiryTs = useMemo(() => {
    if (vaultLastPing && vaultHeartbeat) return vaultLastPing + vaultHeartbeat;
    const nowSec = Math.floor(Date.now() / 1000);
    if (timeRemaining && timeRemaining > 0) return nowSec + timeRemaining;
    return 0;
  }, [vaultLastPing, vaultHeartbeat, timeRemaining]);
  const expiryLocal = useMemo(() => (expiryTs ? new Date(expiryTs * 1000).toLocaleString() : '-'), [expiryTs]);
  const short = (a: string) => a ? (a.slice(0, 6) + "..." + a.slice(-4)) : "-";
  const badge = (text: string, color: "blue" | "purple" | "yellow" | "green" | "gray") => {
    const clsMap: Record<string, string> = {
      blue: "bg-blue-100 text-blue-800 border-blue-200",
      purple: "bg-purple-100 text-purple-800 border-purple-200",
      yellow: "bg-yellow-100 text-yellow-800 border-yellow-200",
      green: "bg-green-100 text-green-800 border-green-200",
      gray: "bg-gray-100 text-gray-800 border-gray-200",
    };
    return (
      <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded border ${clsMap[color]}`}>
        {text}
      </span>
    );
  };

  // New unified handler used by UI and auto-start
  const continueWorldApp2 = async () => {
    setCtaLoading(true);
    try {
      const appId = document
        .querySelector('meta[name="minikit:app-id"]')
        ?.getAttribute("content") || "";
      const { MiniKit } = await loadMiniKit();
      const install = MiniKit.install?.(appId);
      const bridgeOn = (install?.success === true) || (MiniKit?.isInstalled?.() === true);
      if (!bridgeOn) {
        const code = install?.errorCode || 'bridge_off';
        const msg = install?.errorMessage || 'MiniKit bridge unavailable';
        setStatus(`Bridge off (${code}). Open inside World App and update to latest. ${msg}`);
        pushToast('error', 'Open this mini app inside World App ▸ update to latest.');
        setMiniInstalled(false);
        return;
      }
      setMiniInstalled(true);
      // Always login via walletAuth first
      if (!account) {
        // MiniKit 2.x: nonce 는 서버가 발급하고, 서명은 서버가 검증한다.
        // 둘 다 Pages Function(`/api/auth/*`)이 담당한다.
        const auth = await signInWithWorldApp((nonce) => walletAuth(nonce));
        if (!auth.ok) {
          setStatus(auth.error);
          if (auth.userFacing) pushToast('error', auth.error);
          return;
        }
        setProvider(await createProvider());
        setSigner(null);
        setAccount(auth.address);
        setServerVerified(auth.verified);
        // 헤더에 유저네임과 World App 표시가 있으므로 상태 줄을 비운다.
        // 여기까지 "Connected" 를 남기면 같은 정보가 두 줄로 보인다.
        setStatus('');
      }

      // World ID 검증은 MiniKit 2.x 에서 제거되었다(World ID는 @worldcoin/idkit 이
      // 담당). REQUIRED 인 경우에도 지금은 검증 없이 통과시킨다 — 없는 API 를
      // 호출해 사용자에게 실패를 보여주는 것보다, REQUIRE_VERIFY=false 로 두고
      // 사용자가 직접 켤 수 있게 하는 편이 정직하다.
      if (REQUIRE_VERIFY && !verified) {
        setVerified(true);
        try {
          localStorage.setItem('wld-verified', '1');
        } catch {
          void 0;
        }
      }
    } catch (e: unknown) {
      const msg = errorText(e);
      setStatus('Continue error: ' + msg);
      pushToast('error', msg);
    } finally {
      setCtaLoading(false);
    }
  };

  const refreshNotifyPermission = useCallback(async (): Promise<"granted" | "denied" | "unknown"> => {
    if (!miniInstalled) {
      setNotifyPermission("unknown");
      return "unknown";
    }
    // 알림 권한 조회는 앱 전체를 막지 않는다. 실패해도 "모름" 으로 두고 진행한다.
    // minikit.ts 가 MiniKit 2.x 의 `data.permissions` 감싸짐을 풀어 준다. 예전에는
    // 최상위 `permissions` 를 읽었는데 거기엔 없고 `data` 안에만 있어서 값이 항상
    // undefined 였다 — 권한을 켜도 화면이 "꺼짐" 으로 남았다.
    const res = await getNotifyPermission();
    const next = res ? (res.notifications ? "granted" : "denied") : "unknown";
    setNotifyPermission(next);
    return next;
  }, [miniInstalled]);

  const requestNotifyPermission = async () => {
    if (!miniInstalled) {
      pushToast("error", "Open in World App first.");
      return;
    }
    setNotifyBusy(true);
    try {
      await askNotifyPermission();
    } catch (e: unknown) {
      /* 여기 도달하면 World App 이 아니라 **이 앱 쪽** 문제다(브리지 명령이 없거나
         형태가 다르다 — 옛 World App 에서 실제로 그렇다). "World App 이 허용하지
         않습니다" 라고 하면 원인이 다른 곳을 향한다. 되읽은 값이 granted 여도
         마찬가지: 살아만 있으면서 이 요청 경로가 깨진 것이므로, 배선 불량이라고
         알린다.
         원문은 개발자 콘솔에 남긴다 — 사용자 화면에는 원인을 담지 않되 사라뜨리지도
         않는다(버그 신고에 필요). */
      console.warn("requestPermission failed (bridge/app side):", e);
      pushToast("error", "This version of World App could not ask for notifications. Turn them on in World App → Settings → Notifications instead.");
      await refreshNotifyPermission();
      setNotifyBusy(false);
      return;
    }
    /* 결과를 다시 **읽어서** 말한다. 예전에는 호출이 null 이 아니면 곧바로
       "Notifications enabled for this wallet." 를 띄웠는데, MiniKit 2.x 는 거절을
       throw 하지 않고 결과로 돌려줄 수 있다 — 즉 함수가 아무 예외 없이 끝났다는
       사실은 "허용됐다" 는 뜻이 아니었다. 알림 테스트에서 이미 같은 실수를 한 번
       했고(sent:false 인데 "요청했다"고 말함), 여기도 같았다.
       그래서 실제로 권한 상태를 다시 읽고 그 값으로 말한다. */
    const state = await refreshNotifyPermission();
    setNotifyAsked(true);
    setNotifyBusy(false);
    if (state === "granted") {
      pushToast("success", "Notifications are on for this wallet.");
    } else if (state === "denied") {
      pushToast("error", "Still off — World App is not granting notifications. Turn them on in World App → Settings → Notifications.");
    } else {
      pushToast("error", "Could not read the notification setting back. Check World App → Settings → Notifications.");
    }
  };

  const refreshNotifyWatchState = useCallback(async () => {
    const request = ++notifyWatchRequest.current;
    const update = (state: WatchState) => {
      if (request === notifyWatchRequest.current && notifyWatchScope.current === notifyWatchKey) {
        setNotifyWatch({ key: notifyWatchKey, state });
      }
    };
    if (!NOTIFY_BACKEND_ENABLED || !vault || !account) {
      update("unknown");
      return;
    }
    try {
      const url = `${NOTIFY_BACKEND_URL}/api/notifications/status?vaultAddress=${encodeURIComponent(vault)}`;
      const res = await notificationFetch(url, { method: "GET" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.status === "success") {
        update(data?.watcher?.active ? "registered" : "not_registered");
        return;
      }
      update("unknown");
    } catch {
      update("unknown");
    }
  }, [vault, account, notifyWatchKey]);

  /**
   * 알림 진단 상태를 전부 다시 읽는다 (권한 + 워처).
   *
   * 예전에는 "Refresh permission"(권한만) 과 "Refresh watcher"(워처만) 두 버튼이
   * 붙어 있었다. 둘은 **같은 고유 그룹의 두 절반** — "알림이 왜 안 오지" 하고 눌렀을 때
   * 어느 쪽을 고친 건지 알 수 없고, 하나만 고쳐도 화면이 여전히 어긋난 상태로 보인다.
   * 한 버튼으로 합친다.
   *
   * `refreshNotifyWatchState` 아래에 둔다 — 그 함수를 참조하므로 순서가 중요하다
   * (`useCallback` 은 정의 시점에 클로저를 만든다). TDZ 에 걸린다.
   */
  const refreshNotifyState = useCallback(async () => {
    await refreshNotifyPermission();
    await refreshNotifyWatchState();
  }, [refreshNotifyPermission, refreshNotifyWatchState]);

  const registerWatcher = async (
    vaultAddress: string,
    ownerAddress: string,
    heirAddress: string,
    silent = false,
  ) => {
    notifyWatchRequest.current++;
    const key = `${account.toLowerCase()}:${vaultAddress.toLowerCase()}`;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    let res: Response;
    let data: { status?: string; message?: string; watcher?: { active?: boolean } };
    try {
      res = await notificationFetch(`${NOTIFY_BACKEND_URL}/api/notifications/register`, {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vaultAddress, ownerAddress, heirAddress }),
      });
      data = await res.json().catch(() => ({}));
    } finally {
      window.clearTimeout(timeout);
    }
    if (!res.ok || data?.status !== "success") {
      throw new Error(data?.message || "Failed to register notification watcher");
    }
    if (notifyWatchScope.current === key) {
      // Registration may finish after a status read started on the newly created
      // vault. Its committed response supersedes those earlier reads.
      notifyWatchRequest.current++;
      setNotifyWatch({ key, state: data?.watcher?.active === false ? "not_registered" : "registered" });
      if (!silent) pushToast("success", data?.watcher?.active === false
        ? "This vault's inheritance has already completed."
        : "Vault monitoring enabled. Each recipient also needs notifications on in World App.");
    }
  };

  const registerHeirAlert = async () => {
    if (!NOTIFY_BACKEND_ENABLED) {
      pushToast("error", "Set VITE_NOTIFY_BACKEND_URL first.");
      return;
    }
    if (!account || !vault || !vaultHeir || !vaultOwner) {
      pushToast("error", "Load vault details first.");
      return;
    }
    if (![vaultOwner, vaultHeir].some(address => address.toLowerCase() === account.toLowerCase())) {
      pushToast("error", "Only the owner or heir can enable monitoring for this vault.");
      return;
    }
    setWatchBusy(true);
    try {
      await registerWatcher(vault, vaultOwner, vaultHeir);
    } catch (e: unknown) {
      pushToast("error", "Register error: " + errorText(e));
    } finally {
      setWatchBusy(false);
    }
  };

  const sendNotifyTestToMe = async () => {
    if (!NOTIFY_BACKEND_ENABLED) {
      pushToast("error", "Set VITE_NOTIFY_BACKEND_URL first.");
      return;
    }
    if (!account) {
      pushToast("error", "Connect wallet first.");
      return;
    }
    setWatchBusy(true);
    try {
      const res = await notificationFetch(`${NOTIFY_BACKEND_URL}/api/notifications/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: account,
          vaultAddress: vault || undefined,
          title: "WLD Inheritance Test",
          message: "Test notification from your mini app.",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.status !== "success") {
        throw new Error(data?.message || "Failed to send test notification");
      }
      // 백엔드는 200 이어도 이 지갑에 전달하지 못할 수 있다. World App 알림 API 는
      // 요청 유효성(200)과 실제 전달(sent)을 구분해서 돌려준다.
      //
      //   "User has disabled notifications" — World App 유저인데 설정을 꺼둔 경우
      //   "User not found"                 — World App 에 등록되지 않은 지갑
      //
      // 예전 코드는 여기를 무시하고 "Test notification requested." 만 토스트로
      // 띄웠다. 그래서 발송이 조용히 실패해도 사용자는 성공으로 알고 화면을 닫았다.
      const row =
        (data?.result?.result as { walletAddress?: string; sent?: boolean; reason?: string }[] | undefined)
          ?.find((r) => r?.walletAddress?.toLowerCase() === account.toLowerCase()) ??
        (data?.result?.result as { sent?: boolean; reason?: string }[] | undefined)?.[0];
      if (row?.sent === true) {
        setNotifyDeliveryNote("");
        pushToast("success", "Notification delivered. Check World App.");
      } else {
        const reason = String(row?.reason || "not delivered");
        setNotifyDeliveryNote(reason);
        // 사람 언어로 바꾼다. 원문 사유를 그대로 보여주면 사용자가 무엇을 해야 하는지
        // 알 수 없다.
        const advice =
          reason === "User has disabled notifications"
            ? "Turn it on in World App → Settings → Notifications."
            : reason === "User not found"
              ? "This wallet is not registered with World App. Open it in World App and sign in."
              : "Check your World App notification settings.";
        pushToast("error", `Not delivered: ${advice}`);
      }
    } catch (e: unknown) {
      pushToast("error", "Test notify error: " + errorText(e));
    } finally {
      setWatchBusy(false);
    }
  };

  useEffect(() => {
    try {
      if (REQUIRE_VERIFY && localStorage.getItem("wld-verified") === "1") {
        setVerified(true);
      }
    } catch {
      // localStorage 가 차단된 컨텍스트일 수 있다.
      void 0;
    }
  }, []);

  useEffect(() => {
    try {
      const v = new URLSearchParams(window.location.search).get("vault");
      if (v && ethers.isAddress(v)) {
        const target = ethers.getAddress(v);
        setLinkedVault(target);
        setVault(target);
      } else if (v) {
        // 주소 형식부터 아니면 금고를 하나도 못 본다. 조용히 무시하면 사용자는
        // 링크가 깨졌다는 사실조차 모른다.
        setLinkError("This link does not contain a valid vault address.");
      }
    } catch {
      setLinkError("This link could not be read.");
    }
  }, []);

  /** 상속인의 월드챗 유저네임을 되돌린다. 지갑만 있어도 찾을 수 있다. */
  useEffect(() => {
    let cancelled = false;
    if (!vaultHeir || vaultHeir === ethers.ZeroAddress) {
      setHeirVaultUsername(null);
      return;
    }
    void getUsernameFor(vaultHeir).then((u) => {
      if (!cancelled) setHeirVaultUsername(u || null);
    });
    return () => {
      cancelled = true;
    };
  }, [vaultHeir]);

  /**
   * 상속인이 앱을 열자마자 자기가 상속인인지 알 수 있게 한다.
   *
   * 월드앱 알림은 이 미니앱을 깔지 않은 지갑에 닿지 않는다. 그래서 상속인이
   * 알게 되는 경로는 주인이 알려주거나, 스스로 여는 것뿐이다. 그런데
   * "Find my vaults" 버튼을 먼저 알아채야만 했다면 대부분은 모른다.
   * 내 금고가 없는 계정은 열자마자 스스로 조회한다.
   *
   * `findHeirVaults` 는 매 렌더 새로 만들어지므로 의존 배열에 넣을 수 없다.
   * 대신 계정별로 한 번만 도는 것을 ref 로 강제한다 — 상태로 쓰면 렌더마다
   * 갱신되어 effect 가 다시 걸린다.
   */
  const heirScannedFor = useRef<string | null>(null);
  useEffect(() => {
    // 자기 금고를 갖고 있어도 남의 상속인이 될 수 있다. 예전엔 `|| vault` 로 막혀서
    // 자기 금고가 있는 사람은 상속인으로서 아무것도 발견할 수 없었다.
    if (!account) return;
    const key = account.toLowerCase();
    if (heirScannedFor.current === key) return;
    heirScannedFor.current = key;
    void findHeirVaults();
    setHeirScanAttempted(true);
    // findHeirVaults 는 매 렌더 새로 만들어지므로 넣으면 effect 가 계속 돌아간다.
    // 중복 실행은 위 ref 가 막는다 — 계정당 한 번.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, vault]);

  useEffect(() => {
    refreshNotifyPermission();
  }, [refreshNotifyPermission, account]);

  useEffect(() => {
    refreshNotifyWatchState();
  }, [refreshNotifyWatchState]);

  useEffect(() => {
    const expired = () => {
      setAccount("");
      setServerVerified(false);
      setUsername("");
      setOwnVault("");
      setVault("");
      setVaultIdentity(null);
      notifyWatchRequest.current++;
      setNotifyWatch({ key: "", state: "unknown" });
      setStatus("Your sign-in expired. Continue with World App to reconnect.");
      heirScannedFor.current = null;
    };
    window.addEventListener("inheritance:session-expired", expired);
    return () => window.removeEventListener("inheritance:session-expired", expired);
  }, []);

  useEffect(() => {
    if (account && linkedVault) setVault(linkedVault);
  }, [account, linkedVault]);

  // In-World App: on mount, only initialize the MiniKit bridge.
  //
  // 여기서 walletAuth 를 호출하면 안 된다. World App 리뷰 규칙상 로그인은 반드시
  // 사용자 제스처(탭)로 시작해야 하며, 마운트 시 자동 호출은 사용자를 놀라게 하고
  // "사용자 동의 없이 지갑 접근"으로 심사에서 거부될 수 있다.
  // 세션 복원은 아래 effect 가, 실제 로그인은 continueWorldApp2 가 담당한다.
  useEffect(() => {
    (async () => {
      try {
        const appId = document
          .querySelector('meta[name="minikit:app-id"]')
          ?.getAttribute("content") || "";
        const { MiniKit } = await loadMiniKit();
        // 일부 호스트는 install(appId) 를 호출하기 전까지 isInstalled=false 를 보고한다.
        const install = MiniKit.install?.(appId);
        const bridgeOn = (install?.success === true) || (MiniKit?.isInstalled?.() === true);
        if (!bridgeOn) {
          setStatus("Open in World App (MiniKit bridge unavailable)");
          setMiniInstalled(false);
          return;
        }
        setMiniInstalled(true);
      } catch (e: unknown) {
        setStatus('MiniKit init error: ' + errorText(e));
      }
    })();
  }, []);

  /**
   * 저장된 세션 복원.
   *
   * 예전에는 `localStorage` 의 주소만 있으면 그대로 로그인된 것으로 취급했다.
   * 그 값은 누구든 브라우저에서 고칠 수 있으므로, **서버가 검증한 세션만**
   * 복원한다. `readSessionAddress` 는 검증에 통과한 세션에서만 값이 들어 있으므로
   * 여기의 존재 여부가 곧 "서명 검증이 끝났는지" 다.
   *
   * 세션이 없으면 로그인하지 않은 상태로 둔다. 이전 버전은 검증되지 않은 캐시
   * 주소로 vault 를 조회해 다른 사람 금고가 뜨는 경로가 있었다.
   */
  useEffect(() => {
    (async () => {
      const saved = readSessionAddress();
      if (!saved || !ethers.isAddress(saved)) return;
      try {
        const addr = ethers.getAddress(saved);
        setProvider(await createProvider());
        setSigner(null);
        setAccount(addr);
        setServerVerified(true);
        setStatus("");
      } catch {
        clearSession();
      }
    })();
  }, []);

  // Optional: fetch username for restored sessions when available
  useEffect(() => {
    (async () => {
      if (!account) return;
      try {
        const { MiniKit } = await loadMiniKit();
        const u = await MiniKit.getUserByAddress?.(account);
        if (u?.username) setUsername(u.username);
      } catch {
        // Username lookup is optional.
        void 0;
      }
    })();
  }, [account]);

  // ---- contracts
  const showYieldRates = HAS_YIELD_ROUTES && isYieldVault;
  useEffect(() => {
    if (!showYieldRates) return;
    let active = true;
    let controller: AbortController | null = null;
    const refresh = async () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      setYieldRatesLoading(true);
      const timeout = setTimeout(() => request.abort(), 8_000);
      try {
        const results = await Promise.allSettled(YIELD_ROUTES.map(async route => ({
          factory: route.factory, rates: await fetchYieldRates(request.signal, route.strategy),
        })));
        if (active && controller === request) setYieldRatesByFactory(Object.fromEntries(results.map((result, i) =>
          [YIELD_ROUTES[i].factory, result.status === "fulfilled" ? result.value.rates : null])));
      } finally {
        clearTimeout(timeout);
        if (active && controller === request) setYieldRatesLoading(false);
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 5 * 60_000);
    return () => { active = false; controller?.abort(); clearInterval(interval); };
  }, [showYieldRates]);

  const factory = useMemo(() => {
    const rw = provider; // read-only provider
    return rw ? new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, rw) : null;
  }, [provider]);
  const vaultCtr = useMemo(() => {
    const rw = provider; // read-only provider
    return rw && vault ? new ethers.Contract(vault, [...VAULT_ABI, "function asset() view returns (address)", "function rewardToken() view returns (address)"], rw) : null;
  }, [provider, vault]);

  useEffect(() => {
    if (!HAS_YIELD_ROUTES || !provider) return;
    let active = true;
    const check = async () => {
      await Promise.all(YIELD_ROUTES.map(async route => {
        try {
          const contract = new ethers.Contract(route.factory, route.factoryAbi, provider);
          const [token, strategy, recipient, fee, reward] = await Promise.all([
            contract[route.tokenGetter](), contract.strategy(), contract.feeRecipient(), contract.performanceFeeBps(),
            route.symbol === "USDC" ? contract.rewardToken() : Promise.resolve(WLD_ADDRESS),
          ]);
          const underlying = new ethers.Contract(route.strategy, MORPHO_ABI, provider);
          const [asset, underlyingFee, decimals] = await Promise.all([underlying.asset(), underlying.fee(),
            new ethers.Contract(route.asset, ERC20_ABI, provider).decimals()]);
          if (String(token).toLowerCase() !== route.asset.toLowerCase() || String(asset).toLowerCase() !== route.asset.toLowerCase()
            || String(strategy).toLowerCase() !== route.strategy.toLowerCase() || String(reward).toLowerCase() !== WLD_ADDRESS.toLowerCase()
            || Number(decimals) !== route.decimals || recipient === ethers.ZeroAddress || fee !== 1000n) throw new Error("Invalid yield configuration");
          if (active) setYieldTermsByFactory(current => ({ ...current, [route.factory]: {
            feeBps: Number(fee), recipient: String(recipient), underlyingFeePercent: Number(underlyingFee) / 1e16,
          } }));
        } catch { if (active) setYieldTermsByFactory(current => ({ ...current, [route.factory]: null })); }
      }));
    };
    void check();
    const timer = setInterval(() => void check(), 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [provider]);

  const loadVault = useCallback(async () => {
    if (!factory || !account) return;
    const key = account.toLowerCase(), request = ++vaultLookupRequest.current;
    try {
      const sources = TRUSTED_FACTORIES;
      const results = await Promise.allSettled(sources.map(async address => ({
        factory: address,
        address: String(await new ethers.Contract(address, FACTORY_ABI, provider).vaultOf(account)),
      })));
      if (key !== vaultLookupAccount.current || request !== vaultLookupRequest.current) return;
      const previous = ownedVaultCache.current.account === key ? ownedVaultCache.current.items : [];
      const found = results.flatMap((result, index) => result.status === "fulfilled"
        ? result.value.address !== ethers.ZeroAddress ? [result.value] : []
        : previous.filter(item => item.factory.toLowerCase() === sources[index].toLowerCase()));
      ownedVaultCache.current = { account: key, items: found };
      const unavailableFactories = results.flatMap((result, index) => result.status === "rejected" ? [sources[index]] : []);
      setOwnedVaultRead({ account: key, items: found, incomplete: unavailableFactories.length > 0, unavailableFactories });
      // A failed optional registry must not hide successfully read basic vaults.
      // All creation paths still recheck their own registry before sending.
      if (results.every(result => result.status === "rejected")) throw new Error("Vault registries unavailable");
      const v = found.find(v => v.address.toLowerCase() === ownVault.toLowerCase())?.address ?? found[0]?.address;
      if (v && v !== ethers.ZeroAddress) {
        setOwnVault(v);
        // 링크 금고가 우선이다. 상속인에게 보낸 링크를 열었는데 자기 금고로 되돌아가면
        // 링크가 준 정보가 사라진다. 어느 쪽을 보는지는 화면에 알려준다.
        if (!linkedVault) {
          setVault(v);
          if (!ownVault && navigationChosenFor.current !== key) setTab(current => current === "inherit" ? "vault" : current);
        }
        setStale(true);
        return;
      }
      // A partial read does not prove the absence of a previously known vault.
      if (results.every(result => result.status === "fulfilled")) setOwnVault("");
      // 금고가 없는 경우에도 읽기는 성공했다. 배너를 여기서 지워야 연결이 복구됐을 때
      // 금고가 없는 사람에게도 배너가 영구히 남지 않는다 (refreshVaultDetails 는
      // `!vaultCtr` 이면 즉시 반환하므로 이 경로가 그 일을 대신한다).
      setStale(true);
    } catch (e: unknown) {
      if (key !== vaultLookupAccount.current || request !== vaultLookupRequest.current) return;
      // RPC 실패를 삼키지 않는다 — 예외가 바깥으로 새면 unhandled rejection 이 된다.
      setStatus("Vault lookup failed: " + errorText(e));
      // 여기서가 "연결 배너" 가 실제로 필요해지는 지점이다. RPC 가 죽으면
      // `vault` 가 채워지지 않아 `vaultCtr` 이 null 이 되고, 그러면 아래
      // `refreshVaultDetails` 는 `if (!vaultCtr) return` 로 즉시 빠져나간다.
      // 즉 상태 플래그를 그쪽에만 두면, 배너가 정확히 필요한 순간에 표시되지 않는다.
      setStale(false);
      return;
    }

    // 내 소유 금고가 없다. 여기서 "상속인인 금고"를 `vault` 에 넣으면 안 된다.
    // `vault` 는 "내가 소유한 금고" 를 뜻하고, 이를 상속인 금고로 오염시키면
    // (1) Create 버튼이 영구히 비활성화되고 (2) "이미 금고가 있습니다" 라고 표시된다.
    // 결과적으로 남의 상속인이 된 사용자는 자기 금고를 만들 수 없게 된다.
    // 상속인 금고는 아래 "Find vaults where I am heir" 액션으로 별도로 조회한다.
  }, [factory, account, linkedVault, provider, ownVault]);

  // Username/address resolution helpers — accept @username or 0x… in inputs
  const resolveHeirInput = async (input: string) => {
    const trimmed: string = (input || "").trim();
    if (!trimmed) return null;
    const isAddressInput = ethers.isAddress(trimmed as string);
    if (isAddressInput) {
      const checksum = ethers.getAddress(trimmed);
      const uname = await getUsernameFor(checksum);
      return { username: uname, address: checksum } as const;
    }
    try {
      const { MiniKit } = await loadMiniKit();
      const handle = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
      const u = await MiniKit.getUserByUsername?.(handle);
      if (u?.walletAddress && ethers.isAddress(u.walletAddress)) {
        return { username: u.username, address: ethers.getAddress(u.walletAddress) } as const;
      }
    } catch {
      // Username resolution failed.
      void 0;
    }
    return null;
  };

  // Debounced input handlers to resolve username/address safely
  const onHeirInput = async (v: string) => {
    setHeir(v);
    const mySeq = nextSeq(heirSeqRef);
    if (!v) { setHeirResolved(null); setResolvingHeir(false); return; }
    setResolvingHeir(true);
    try {
      const r = await resolveHeirInput(v);
      // Only apply latest result
      if (heirSeqRef.current === mySeq) {
        setHeirResolved(r);
      }
    } catch (e: unknown) {
      if (heirSeqRef.current === mySeq) {
        setHeirResolved(null);
        console.warn("heir resolution failed:", errorText(e));
      }
    } finally {
      // Clear resolving only if up-to-date
      if (heirSeqRef.current === mySeq) setResolvingHeir(false);
    }
  };

  const onNewHeirInput = async (v: string) => {
    setNewHeir(v);
    const mySeq = nextSeq(newHeirSeqRef);
    if (!v) { setNewHeirResolved(null); setResolvingNewHeir(false); return; }
    setResolvingNewHeir(true);
    try {
      const r = await resolveHeirInput(v);
      if (newHeirSeqRef.current === mySeq) {
        setNewHeirResolved(r);
      }
    } catch (e: unknown) {
      if (newHeirSeqRef.current === mySeq) {
        setNewHeirResolved(null);
        console.warn("heir resolution failed:", errorText(e));
      }
    } finally {
      if (newHeirSeqRef.current === mySeq) setResolvingNewHeir(false);
    }
  };

  useEffect(() => {
    if (!factory || !account) return;
    void loadVault();
    if (!HAS_YIELD_ROUTES) return;
    const refresh = () => { if (document.visibilityState === "visible" && !actionInFlight.current) void loadVault(); };
    const timer = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [factory, account, loadVault]);

  useEffect(() => {
    const request = ++ownedPlanRequest.current;
    const key = account.toLowerCase();
    if (!account || !provider) {
      setOwnedPlanRead({ account: key, loading: false, incomplete: false, unavailableSymbols: [], items: [] });
      return;
    }
    let active = true;
    const sources = ownedVaultRead.account === key ? ownedVaultRead.items : [];
    setOwnedPlanRead(current => ({ account: key, loading: true, incomplete: current.account === key && current.incomplete,
      unavailableSymbols: current.account === key ? current.unavailableSymbols : [], items: current.account === key ? current.items : [] }));
    const refresh = async () => {
      const results = await Promise.allSettled(sources.map(async item => {
        const route = yieldRouteFor(item.factory);
        const symbol: AssetSymbol = route?.symbol ?? "WLD";
        const asset = route?.asset ?? WLD_ADDRESS;
        const source = new ethers.Contract(item.factory, route?.factoryAbi ?? FACTORY_ABI, provider);
        const child = new ethers.Contract(item.address, route?.vaultAbi ?? VAULT_ABI, provider);
        const [canonical, owner, heirAddress, sourceFactory, tokenAddress, heartbeat, lastPing, claimedAt] = await Promise.all([
          source.vaultOf(account), child.owner(), child.heir(), child.factory(), child[route?.tokenGetter ?? "WLD"](),
          child.heartbeatInterval(), child.lastPing(), child.claimedAt(),
        ]);
        if (String(canonical).toLowerCase() !== item.address.toLowerCase()) {
          return { address: item.address, factory: item.factory, symbol, balance: null, heir: String(heirAddress),
            additionalWld: 0n, period: Number(heartbeat) / 86400, periodSeconds: BigInt(heartbeat), lastPing: BigInt(lastPing), active: false };
        }
        if (String(owner).toLowerCase() !== key || String(sourceFactory).toLowerCase() !== item.factory.toLowerCase()
          || String(tokenAddress).toLowerCase() !== asset.toLowerCase()) throw new Error("Owner or asset identity mismatch");
        let balance: bigint | null;
        let additionalWld = 0n;
        if (route) {
          const [strategy, distributor, known] = await Promise.all([
            child.strategy(), child.MERKL_DISTRIBUTOR(), source.knownVaults(item.address),
          ]);
          if (String(strategy).toLowerCase() !== route.strategy.toLowerCase()
            || String(distributor).toLowerCase() !== MERKL_DISTRIBUTOR.toLowerCase() || !known) throw new Error("Yield identity mismatch");
          if (route.symbol === "USDC" && String(await child.rewardToken()).toLowerCase() !== WLD_ADDRESS.toLowerCase()) throw new Error("Reward token mismatch");
          const position = await child.position();
          balance = position.valued ? BigInt(position.gross) : null;
          if (route.symbol === "USDC") additionalWld = BigInt(await new ethers.Contract(WLD_ADDRESS, ERC20_ABI, provider).balanceOf(item.address));
        } else {
          const token = new ethers.Contract(asset, ERC20_ABI, provider);
          const decimals = Number(await token.decimals());
          if (decimals !== 18) throw new Error("Vault asset precision mismatch");
          balance = BigInt(await token.balanceOf(item.address));
        }
        const heir = String(heirAddress);
        const activePlan = BigInt(claimedAt) === 0n && heir !== ethers.ZeroAddress && heir.toLowerCase() !== key;
        return { address: item.address, factory: item.factory, symbol, balance, additionalWld, heir,
          period: Number(heartbeat) / 86400, periodSeconds: BigInt(heartbeat), lastPing: BigInt(lastPing), active: activePlan };
      }));
      if (!active || request !== ownedPlanRequest.current || key !== account.toLowerCase()) return;
      const items = results.map((result, index) => result.status === "fulfilled" ? result.value : {
        address: sources[index].address, factory: sources[index].factory,
        symbol: yieldRouteFor(sources[index].factory)?.symbol ?? "WLD" as AssetSymbol,
        balance: null, additionalWld: null, heir: "", period: 0, periodSeconds: 0n, lastPing: 0n, active: null,
      });
      const unavailableSymbols = new Set<AssetSymbol>();
      const markUnavailable = (factoryAddress: string) => {
        const symbol = yieldRouteFor(factoryAddress)?.symbol ?? "WLD";
        unavailableSymbols.add(symbol);
        if (symbol === "USDC") unavailableSymbols.add("WLD");
      };
      if (ownedVaultRead.account === key) ownedVaultRead.unavailableFactories.forEach(markUnavailable);
      results.forEach((result, index) => {
        if (result.status === "rejected") markUnavailable(sources[index].factory);
      });
      setOwnedPlanRead({ account: key, loading: false,
        incomplete: ownedVaultRead.incomplete || results.some(result => result.status === "rejected"),
        unavailableSymbols: [...unavailableSymbols], items });
    };
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [provider, account, ownedVaultRead.account, ownedVaultRead.items, ownedVaultRead.incomplete, ownedVaultRead.unavailableFactories]);

  // Optional capability probe for releaseMyVault (if env not set but contract supports)
  useEffect(() => {
    (async () => {
      if (!factory || supportsRelease) return;
      try {
        const i = new ethers.Interface(["function releaseMyVault() returns (bool)"]);
        const data = i.encodeFunctionData("releaseMyVault", []);
        const p = (signer?.provider as ethers.AbstractProvider | null) ?? provider;
        if (!p) return;
        await p.call({ to: FACTORY_ADDRESS, data });
        setSupportsRelease(true);
      } catch (e: unknown) {
        const msg = errorText(e);
        // revert 가 발생했다는 사실 자체가 "지원한다"는 증거다.
        // 만기 전이라 NOT_EXPIRED 로 거절되는 경우도 지원으로 판정해야 한다.
        if (
          msg.includes("NO_VAULT") ||
          msg.includes("NOT_OWNER") ||
          msg.includes("NON_EMPTY") ||
          msg.includes("NOT_EXPIRED") ||
          msg.includes("VaultNotEmpty") ||
          msg.includes("NoVault") ||
          msg.includes("NotOwner") ||
          msg.includes("NotExpired")
        ) {
          setSupportsRelease(true);
        }
      }
    })();
  }, [factory, supportsRelease, provider, signer]);

  const refreshVaultDetails = useCallback(async () => {
    if (!vaultCtr) return;
    const epoch = vaultDetailsEpoch.current;
    try {
      const [o, h, hb, lp, sourceFactory] = await Promise.all([
        vaultCtr.owner(), vaultCtr.heir(), vaultCtr.heartbeatInterval(), vaultCtr.lastPing(), vaultCtr.factory(),
      ]);
      const route = yieldRouteFor(String(sourceFactory));
      const trusted = TRUSTED_FACTORIES.some(a => a.toLowerCase() === String(sourceFactory).toLowerCase());
      if (!trusted || !provider) throw new Error("This vault is not part of Inheritance.");
      const token = await vaultCtr[route?.tokenGetter ?? "WLD"]();
      if (String(token).toLowerCase() !== (route?.asset ?? WLD_ADDRESS).toLowerCase()) throw new Error("This vault uses an unsupported asset.");
      const yieldSelected = Boolean(route);
      const source = new ethers.Contract(sourceFactory, route?.factoryAbi ?? FACTORY_ABI, provider);
      const mapped = String(await source.vaultOf(o)).toLowerCase() === vault.toLowerCase();
      let released = false;
      if (yieldSelected) {
        const yieldVault = new ethers.Contract(vault, route!.vaultAbi, provider);
        const [strategy, recipient, settledAt, distributor] = await Promise.all([
          yieldVault.strategy(), yieldVault.inheritanceRecipient(), yieldVault.claimedAt(), yieldVault.MERKL_DISTRIBUTOR(),
        ]);
        if (String(strategy).toLowerCase() !== route!.strategy.toLowerCase()
          || String(distributor).toLowerCase() !== MERKL_DISTRIBUTOR.toLowerCase()) {
          throw new Error("This vault uses an unsupported yield strategy.");
        }
        if (route!.symbol === "USDC" && String(await yieldVault.rewardToken()).toLowerCase() !== WLD_ADDRESS.toLowerCase()) throw new Error("This vault uses an unsupported reward token.");
        if (!await source.knownVaults(vault)) throw new Error("This vault is not registered by its factory.");
        if (!mapped) {
          if (!await source.knownVaults(vault) || settledAt > 0n && recipient === ethers.ZeroAddress) {
            throw new Error("This vault's slot has been released. Its contract remains on-chain.");
          }
          released = true;
        }
        if (epoch !== vaultDetailsEpoch.current) return;
        setYieldRecipient({ vault, address: String(recipient) });
      } else if (!mapped) {
        throw new Error("This vault's slot has been released. Its contract remains on-chain.");
      }
      if (epoch !== vaultDetailsEpoch.current) return;
      setVaultIdentity({ address: vault, factory: String(sourceFactory), owner: String(o), heir: String(h), released });
      setVaultHeartbeat(Number(hb));
      // 주기 입력 필드를 실제 값으로 맞춘다. 사용자가 편집 중이면 건드리지 않는다.
      //
      // **금고가 없을 때(heartbeat = 0) 는 30일로 채워야 한다.** 이 필드를 처음엔
      // 고정값 "30" 으로 시작했다가 "실제 값으로 시드" 하도록 바꿨는데, 금고가 없는
      // 사용자에게는 시드할 값이 없으므로 필드가 빈 채로 남는다. 그러면 periodValid 가
      // false 고 "Create vault" 버튼이 **영영 활성화되지 않는다** — 아무도 금고를 만들
      // 수 없는 상태였다. 로컬 E2E 는 캐스트로 금고를 만들어서 이 경로를 안 밟았다.
      if (!periodTouchedRef.current) {
        const days = Math.round(Number(hb) / 86400);
        setPeriodInput(String(days > 0 ? days : 30));
      }
      setVaultLastPing(Number(lp));
      // 수금처 기본값은 "한 번만" 채운다. `withdrawTo` 를 deps 에 두면
      // 입력할 때마다 콜백이 재생성되어 이 effect 가 keystale 마다 다시 돌고,
      // 사용자가 필드를 지우면 즉시 소유자 주소로 되돌아가 비워둘 수 없게 된다.
      setWithdrawTo((prev) => prev || o);
      setIncomeTo((prev) => prev || o);
      if (linkedVault) setLinkError("");
      setStale(true);
    } catch (error) {
      if (epoch !== vaultDetailsEpoch.current) return;
      // 읽기가 실패했다. 예전에는 여기서 조용히 넘어갔고, 그래서 화면은 갱신되지 않은
      // 채로 남아 있었다. 사용자는 그 정체를 "내 돈이 사라졌다" 로 읽는다 — 실제로는
      // RPC 가 죽은 것뿐인데도 말이다. 지금 데이터가 최신이 아니라는 사실을 말해야 한다.
      setStale(false);
      setVaultIdentity(null);
      if (linkedVault) setLinkError(errorText(error));
    }
  }, [vaultCtr, provider, vault, linkedVault]);
  useEffect(() => {
    const epoch = vaultDetailsEpoch.current + 1;
    vaultDetailsEpoch.current = epoch;
    if (!vaultCtr) return;
    void refreshVaultDetails();
    // Retain fail-closed roles during an outage and restore them after a fresh,
    // canonical read. Invalidate outstanding reads when the selected vault changes.
    const id = setInterval(() => void refreshVaultDetails(), 15000);
    const onVis = () => { if (document.visibilityState === "visible") void refreshVaultDetails(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      vaultDetailsEpoch.current = epoch + 1;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [vaultCtr, refreshVaultDetails]);

  // 금고가 생성된 블록/시각을 이벤트 로그에서 역추적한다 (표시 전용, 실패해도 무방)
  const loadVaultCreationMeta = useCallback(async () => {
    if (!vault || !(signer || provider)) return;
    try {
      const p = (signer?.provider as ethers.AbstractProvider | null) ?? provider;
      if (!p) return;
      const sig = ethers.id("VaultCreated(address,address,address,uint256)");
      const iface = new ethers.Interface(FACTORY_ABI);
      const tryQuery = async (topics: (string | null | string[])[]) => {
        const logs = await safeGetLogs(p, {
          address: vaultFactory,
          fromBlock: yieldRouteFor(vaultFactory) ? (yieldRouteFor(vaultFactory)!.block ?? undefined) : vaultFactory.toLowerCase() === LEGACY_FACTORY_ADDRESS.toLowerCase() ? (LEGACY_FACTORY_DEPLOY_BLOCK ?? undefined) : (FACTORY_DEPLOY_BLOCK ?? undefined),
          topics,
          toBlock: "latest",
        });
        for (const lg of logs) {
          try {
            const parsed = iface.parseLog({ topics: lg.topics, data: lg.data });
            const parsedVault = String(parsed?.args?.[2] ?? "");
            if (parsedVault && parsedVault.toLowerCase() === vault.toLowerCase()) {
              setVaultCreatedBlock(lg.blockNumber);
              const blk = await p.getBlock(lg.blockNumber);
              setVaultCreatedTime(Number(blk?.timestamp || 0));
              return true;
            }
          } catch {
            // Skip malformed logs.
            void 0;
          }
        }
        return false;
      };

      // 1) filter by owner
      if (vaultOwner) {
        const ownerTopic = ethers.zeroPadValue(ethers.getAddress(vaultOwner), 32);
        if (await tryQuery([sig, ownerTopic])) return;
      }
      // 2) filter by heir
      if (vaultHeir) {
        const heirTopic = ethers.zeroPadValue(ethers.getAddress(vaultHeir), 32);
        if (await tryQuery([sig, null, heirTopic])) return;
      }
      // 3) try with current account
      if (account) {
        const accTopic = ethers.zeroPadValue(ethers.getAddress(account), 32);
        if (await tryQuery([sig, accTopic])) return;
        if (await tryQuery([sig, null, accTopic])) return;
      }
    } catch (e: unknown) {
      // Meta query failure is non-critical
      setStatus((s) => s || ("Meta error: " + errorText(e)));
    }
  }, [vault, signer, provider, vaultOwner, vaultHeir, account, vaultFactory]);
  useEffect(() => { if (vault) loadVaultCreationMeta(); }, [vault, loadVaultCreationMeta]);

  // ---- balances & timer
  const refreshBalances = useCallback(async () => {
    if (!provider || !account) return;
    const scope = balanceScope;
    if (scope !== balanceScopeRef.current) return;
    try {
      const token = new ethers.Contract(selectedAssetAddress, ERC20_ABI, provider);
      const [dec, userBal, vaultBal] = await Promise.all([
        token.decimals(), token.balanceOf(account), vault ? token.balanceOf(vault) : Promise.resolve(0n),
      ]);
      if (scope !== balanceScopeRef.current) return;
      if (Number(dec) !== wldDecimals) throw new Error("Token precision does not match the configured asset.");
      setWalletBalanceRead({ scope, amount: userBal });
      if (!isYieldVault) setVaultBalanceRead({ scope, amount: vaultBal });
      const assets = [{ symbol: "WLD" as const, address: WLD_ADDRESS }, ...(USDC_ENABLED ? [{ symbol: "USDC" as const, address: USDC_ADDRESS }] : [])];
      const walletResults = await Promise.allSettled(assets.map(async asset =>
        new ethers.Contract(asset.address, ERC20_ABI, provider).balanceOf(account) as Promise<bigint>));
      if (scope === balanceScopeRef.current) setWalletBalances({ account, amounts: Object.fromEntries(walletResults.flatMap((result, i) =>
        result.status === "fulfilled" ? [[assets[i].symbol, result.value]] : [])) });
      if (HAS_YIELD_ROUTES) {
        const results = await Promise.allSettled([
          ...YIELD_ROUTES.map(async route => {
            const amount: bigint = await new ethers.Contract(route.strategy, MORPHO_ABI, provider).balanceOf(account);
            if (scope === balanceScopeRef.current) setWalletShares(current => ({ account, amounts: {
              ...(current.account.toLowerCase() === account.toLowerCase() ? current.amounts : {}), [route.factory]: amount,
            } }));
          }),
          (async () => {
            if (!selectedYieldRoute) return;
            const shares: bigint = await new ethers.Contract(selectedYieldRoute.strategy, MORPHO_ABI, provider).balanceOf(vault);
            if (scope === balanceScopeRef.current) setYieldHoldings({ scope, idle: vaultBal, shares });
          })(),
          (async () => {
            if (!selectedYieldRoute) return;
            const ctr = new ethers.Contract(vault, selectedYieldRoute.vaultAbi, provider);
            const amount: bigint = await ctr.unprocessedRewards();
            if (scope === balanceScopeRef.current) setReceivedRewards({ scope, amount });
          })(),
          (async () => {
            if (!selectedYieldRoute) return;
            const ctr = new ethers.Contract(vault, selectedYieldRoute.vaultAbi, provider);
            const pos = await ctr.position();
            if (scope !== balanceScopeRef.current) return;
            setYieldPosition({ vault, idle: pos.idle, shares: pos.shares, gross: pos.gross,
              net: pos.net, fee: pos.fee, liquid: pos.liquid, valued: pos.valued });
            setVaultBalanceRead({ scope, amount: pos.gross });
          })(),
          (async () => {
            if (!isUsdcVault) return;
            const amount: bigint = await new ethers.Contract(WLD_ADDRESS, ERC20_ABI, provider).balanceOf(vault);
            if (scope === balanceScopeRef.current) setHeldRewardCash({ scope, amount });
          })(),
        ]);
        if (scope === balanceScopeRef.current) setYieldReadError({ scope, failed: results.some(result => result.status === "rejected") });
        for (const result of results) if (result.status === "rejected") console.warn("Yield balance read failed:", errorText(result.reason));
      }
    } catch (e: unknown) {
      console.warn("refreshBalances failed:", errorText(e));
    }
  }, [provider, account, vault, isYieldVault, selectedAssetAddress, selectedYieldRoute, wldDecimals, isUsdcVault, balanceScope]);
  useEffect(() => { void refreshBalances(); }, [refreshBalances]);

  const refreshIncome = useCallback(async () => {
    if (!provider || !account || !vault || !identityMatchesVault || !isVaultOwner) return;
    const scope = balanceScope;
    const selectedVault = vault;
    const selectedFactory = vaultFactory;
    const selectedOwner = account;
    setIncomeRead({ scope, state: "loading", gross: 0n, fee: 0n, net: 0n, withdrawableNet: 0n, valued: false });
    if (!isYieldVault) {
      setIncomeRead({ scope, state: "unavailable", gross: 0n, fee: 0n, net: 0n, withdrawableNet: 0n, valued: false });
      return;
    }
    try {
      // These trusted contracts are immutable. Probe their deployed selectors and
      // actual view response, regardless of whether the route is primary or legacy.
      const [factoryCode, vaultCode] = await Promise.all([provider.getCode(selectedFactory), provider.getCode(selectedVault)]);
      if (scope !== balanceScopeRef.current) return;
      if (factoryCode === "0x" || vaultCode === "0x") throw new Error("Income contracts are unavailable.");
      const hasSelector = (code: string, abi: ethers.InterfaceAbi, signature: string) =>
        code.toLowerCase().includes(new ethers.Interface(abi).getFunction(signature)!.selector.slice(2).toLowerCase());
      if (!hasSelector(factoryCode, INCOME_FACTORY_ABI, "withdrawIncomeFromMyVault(address,uint256)")
        || !hasSelector(vaultCode, INCOME_VAULT_ABI, "incomePosition()")
        || !hasSelector(vaultCode, INCOME_VAULT_ABI, "ownerWithdrawIncome(address,uint256)")) {
        setIncomeRead({ scope, state: "unavailable", gross: 0n, fee: 0n, net: 0n, withdrawableNet: 0n, valued: false });
        return;
      }
      const factoryContract = new ethers.Contract(selectedFactory, optionalIncomeAbi(selectedFactoryAbi, INCOME_FACTORY_ABI), provider);
      const vaultContract = new ethers.Contract(selectedVault, optionalIncomeAbi(selectedVaultAbi, INCOME_VAULT_ABI), provider);
      const [canonical, owner, sourceFactory, position] = await Promise.all([
        factoryContract.vaultOf(selectedOwner), vaultContract.owner(), vaultContract.factory(), vaultContract.incomePosition(),
      ]);
      if (scope !== balanceScopeRef.current) return;
      if (String(canonical).toLowerCase() !== selectedVault.toLowerCase()
        || String(owner).toLowerCase() !== selectedOwner.toLowerCase()
        || String(sourceFactory).toLowerCase() !== selectedFactory.toLowerCase()) {
        throw new Error("The income position does not match this owner's canonical vault.");
      }
      setIncomeRead({ scope, state: "available", gross: position.gross, fee: position.fee, net: position.net,
        withdrawableNet: position.withdrawableNet, valued: position.valued });
    } catch {
      if (scope === balanceScopeRef.current) {
        setIncomeRead({ scope, state: "error",
          gross: 0n, fee: 0n, net: 0n, withdrawableNet: 0n, valued: false });
      }
    }
  }, [provider, account, vault, vaultFactory, identityMatchesVault, isVaultOwner, isYieldVault, selectedFactoryAbi, selectedVaultAbi, balanceScope]);

  const refreshIncomeHistory = useCallback(async (mode: "refresh" | "older" = "refresh") => {
    const scope = balanceScope;
    const request = ++incomeHistoryRequest.current;
    const existingRead = incomeHistoryReadRef.current;
    const existing = existingRead?.scope === scope ? existingRead : null;
    const commit = (next: IncomeHistoryView) => {
      if (request !== incomeHistoryRequest.current || scope !== balanceScopeRef.current) return;
      incomeHistoryReadRef.current = next;
      setIncomeHistoryRead(next);
    };
    if (!provider || !account || !vault || !isVaultOwner || !identityMatchesVault) return;
    const trustedRoute = selectedYieldRoute
      && TRUSTED_FACTORIES.some(factory => factory.toLowerCase() === selectedYieldRoute.factory.toLowerCase())
      && selectedYieldRoute.factory.toLowerCase() === vaultFactory.toLowerCase();
    if (!trustedRoute) {
      commit({ scope, status: "unsupported", startBlock: selectedYieldRoute?.block ?? FACTORY_DEPLOY_BLOCK ?? 0,
        finalizedBlock: null, finalizedTimestamp: null, finalizedHash: null, coverage: [], failed: [],
        entries: [], nextBeforeBlock: null, loadingOlder: false, error: "" });
      return;
    }
    const startBlock = Math.max(0, selectedYieldRoute.block ?? FACTORY_DEPLOY_BLOCK ?? 0);
    const existingBoundaryIsUsable = Boolean(existing && existing.status === "ready"
      && existing.finalizedBlock !== null && existing.finalizedTimestamp !== null && existing.finalizedHash);
    const useOlderPage = mode === "older" && existingBoundaryIsUsable;
    const loading: IncomeHistoryView = existing
      ? { ...existing, status: useOlderPage ? existing.status : "loading", loadingOlder: useOlderPage, error: "" }
      : { scope, status: "loading", startBlock, finalizedBlock: null, finalizedTimestamp: null, finalizedHash: null,
        coverage: [], failed: [], entries: [], nextBeforeBlock: null, loadingOlder: false, error: "" };
    commit(loading);
    try {
      const code = await provider.getCode(vault);
      if (scope !== balanceScopeRef.current || request !== incomeHistoryRequest.current) return;
      if (code === "0x") throw new Error("Income contract is unavailable.");
      if (!code.toLowerCase().includes(new ethers.Interface(INCOME_VAULT_ABI)
        .getFunction("incomePosition()")!.selector.slice(2).toLowerCase())) {
        commit({ ...loading, status: "unsupported", loadingOlder: false, entries: [], coverage: [], failed: [], error: "" });
        return;
      }
      let boundary: { blockNumber: number; timestamp: number; hash: string };
      let ranges: BlockRange[];
      let base: IncomeHistoryView | null = existing;
      if (useOlderPage && existing && existing.finalizedBlock !== null && existing.finalizedTimestamp !== null && existing.finalizedHash) {
        boundary = { blockNumber: existing.finalizedBlock, timestamp: existing.finalizedTimestamp, hash: existing.finalizedHash };
        const canonicalBoundary = await provider.getBlock(boundary.blockNumber);
        if (!canonicalBoundary || canonicalBoundary.hash?.toLowerCase() !== boundary.hash.toLowerCase()) {
          throw new Error("The saved finalized boundary is no longer canonical.");
        }
        if (existing.failed.length) {
          ranges = existing.failed.slice(0, 1);
        } else {
          const nextRange = nextIncomeHistoryRange(existing.coverage, [], startBlock, boundary.blockNumber);
          ranges = nextRange ? [nextRange] : [];
        }
      } else {
        boundary = await readFinalizedBoundary(provider);
        const previousBoundary = existing?.finalizedBlock;
        if (previousBoundary !== null && previousBoundary !== undefined && previousBoundary > boundary.blockNumber) base = null;
        if (base && existing?.finalizedBlock !== null && existing?.finalizedBlock !== undefined && existing.finalizedHash) {
          const previousFinalizedBlock = await provider.getBlock(existing.finalizedBlock);
          if (!previousFinalizedBlock?.hash || previousFinalizedBlock.hash.toLowerCase() !== existing.finalizedHash.toLowerCase()) {
            base = null;
          }
        }
        const fromBlock = Math.max(startBlock, boundary.blockNumber - INCOME_HISTORY_PAGE_BLOCKS + 1);
        ranges = fromBlock <= boundary.blockNumber ? [{ fromBlock, toBlock: boundary.blockNumber }] : [];
      }
      if (!ranges.length) {
        commit({ ...loading, status: "ready", finalizedBlock: boundary.blockNumber,
          finalizedHash: boundary.hash, finalizedTimestamp: boundary.timestamp,
          coverage: [], failed: [], entries: [], loadingOlder: false, nextBeforeBlock: null, error: "" });
        return;
      }
      const pages = await Promise.all(ranges.map(range => readIncomeHistoryPage(provider, {
        vault,
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
      })));
      const canonicalBoundary = await provider.getBlock(boundary.blockNumber);
      if (!canonicalBoundary || canonicalBoundary.hash?.toLowerCase() !== boundary.hash.toLowerCase()) {
        throw new Error("The finalized history boundary failed its canonical block check.");
      }
      if (request !== incomeHistoryRequest.current || scope !== balanceScopeRef.current) return;
      const coverage = mergeBlockRanges([...(base?.coverage ?? []), ...pages.flatMap(page => page.coverage)]);
      const attemptedFailures = mergeBlockRanges([...(base?.failed ?? []), ...pages.flatMap(page => page.failed)]);
      const failed = mergeBlockRanges(attemptedFailures.flatMap(range => uncoveredBlockRanges(coverage, range.fromBlock, range.toBlock)));
      const entries = mergeIncomeReceipts(base?.entries ?? [], ...pages.map(page => page.entries))
        .filter(entry => entry.blockNumber <= boundary.blockNumber);
      const complete = failed.length === 0 && rangesCover(coverage, startBlock, boundary.blockNumber);
      const nextRange = complete ? null : nextIncomeHistoryRange(coverage, failed, startBlock, boundary.blockNumber);
      const errors = [...new Set(pages.flatMap(page => page.errors))];
      commit({
        scope,
        status: "ready",
        startBlock,
        finalizedBlock: boundary.blockNumber,
        finalizedTimestamp: boundary.timestamp,
        finalizedHash: boundary.hash,
        coverage,
        failed,
        entries,
        nextBeforeBlock: nextRange?.toBlock ?? null,
        loadingOlder: false,
        error: errors.join(" "),
      });
    } catch (error) {
      if (request !== incomeHistoryRequest.current || scope !== balanceScopeRef.current) return;
      const message = error instanceof Error ? error.message : "History lookup failed.";
      if (error instanceof FinalityUnavailableError) {
        commit({ scope, status: "finality-unavailable", startBlock, finalizedBlock: null, finalizedTimestamp: null,
          finalizedHash: null, coverage: [], failed: [], entries: [], nextBeforeBlock: null, loadingOlder: false, error: message });
      } else {
        commit({ ...(existing ?? loading), scope, status: "error", loadingOlder: false, error: message });
      }
    }
  }, [provider, account, vault, isVaultOwner, identityMatchesVault, selectedYieldRoute, vaultFactory, balanceScope]);

  useEffect(() => {
    if (!isVaultOwner || !vault || !identityMatchesVault) {
      incomeHistoryRequest.current++;
      return;
    }
    void refreshIncomeHistory();
  }, [refreshIncomeHistory, isVaultOwner, vault, identityMatchesVault]);

  useEffect(() => {
    if (!isMyVault || !vault) return;
    void refreshIncome();
    const interval = setInterval(() => void refreshIncome(), 30_000);
    return () => clearInterval(interval);
  }, [refreshIncome, isMyVault, vault]);

  const refreshRewards = useCallback(async () => {
    if (!isYieldVault || !vault || !provider) return;
    const scope = balanceScope;
    if (scope !== balanceScopeRef.current) return;
    const request = ++rewardRequest.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    setRewardState({ scope, data: null, loading: true, error: "" });
    try {
      const contract = new ethers.Contract(vault, selectedVaultAbi, provider);
      const [published, claimed] = await Promise.all([fetchWldRewards(vault, controller.signal), contract.totalRewardsClaimed()]);
      const data = remainingWldRewards(published, claimed);
      if (scope === balanceScopeRef.current && request === rewardRequest.current) setRewardState({ scope, data, loading: false, error: "" });
    } catch (error) {
      if (scope === balanceScopeRef.current && request === rewardRequest.current) setRewardState({ scope, data: null, loading: false,
        error: controller.signal.aborted ? "Rewards lookup timed out. Refresh to try again." : errorText(error) });
    } finally { clearTimeout(timeout); }
  }, [isYieldVault, vault, selectedVaultAbi, provider, balanceScope]);
  useEffect(() => {
    if (!isYieldVault) return;
    void refreshRewards();
    const timer = setInterval(() => void refreshRewards(), 60_000);
    return () => { invalidateRewardReads(); clearInterval(timer); };
  }, [refreshRewards, balanceScope, isYieldVault, invalidateRewardReads]);

  /* 알림 권한을 **주기적으로 다시 읽는다**.
     예전에는 마운트·계정 변경·권한 요청 때만 읽었다. 그 결과 사용자가 World App
     설정에서 알림을 꺼도 앱은 계속
       "You and your heir are told before the countdown ends…"
     라고 말했고, 실제로는 아무 통보도 가지 않는 상태였다. 이 문장은 이 앱에서 가장
     위험한 약속이다 — 상속인이 갱신 사실을 못 받는 것과 직결되므로.
     `refreshTimer`(15초) 와 `refreshBalances`(30초) 에 붙어 있는 것과 같은 폴링
     방식을 따른다. 되읽기는 되돌아오지 않으므로 사용자가 끈 걸 앱이 대신 알아야
     하고, 무한정 "켜짐" 이라고 말할 근거가 없다. */
  useEffect(() => {
    if (!miniInstalled) return;
    const id = setInterval(() => { void refreshNotifyPermission(); }, 30000);
    const onVis = () => { if (document.visibilityState === "visible") void refreshNotifyPermission(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [miniInstalled, refreshNotifyPermission]);

  useEffect(() => {
    if (!provider || !account) return;
    const id = setInterval(() => { void refreshBalances(); }, 30000);
    const onVis = () => { if (document.visibilityState === 'visible') void refreshBalances(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [provider, account, refreshBalances]);

  const refreshTimer = useCallback(async () => {
    if (!vaultCtr) return;
    const scope = balanceScope;
    if (scope !== balanceScopeRef.current) return;
    try {
      const rem: bigint = await vaultCtr.timeRemaining();
      // 상속 상태를 한 번에 읽어 단계로 정리한다. 이 RPC 묶음은 UI 의 모든
      // 분기를 결정하므로 일부가 실패하면 안 된다.
      const [
        // `ownerActive` 는 예전에 단계 계산에 쓰였지만 이제 필요 없다. 만료 판정은
        // `expired` 가 하고, 기한 전(갱신 가능) 상태는 else 분기가 처리한다.
        expired,
        pending,
        challenging,
        finalizable,
        claimedAt,
        cancelled,
        challengeEnd,
      ] = await Promise.all([
        vaultCtr.isExpired(),
        vaultCtr.claimPending(),
        vaultCtr.challengeRunning(),
        vaultCtr.claimableNow(),
        vaultCtr.claimedAt(),
        vaultCtr.inheritanceCancelled(),
        vaultCtr.challengeEndsAt(),
      ]);
      if (scope !== balanceScopeRef.current) return;
      /* 취소를 가장 먼저 보면 "아직 카운트다운이 도는 취소 금고"를 표현할 수 없다
         (위 cancelledFlag 주석 참고). 만료를 먼저 판정하고, 취소는 만료 뒤에만
         "cancelled" 단계로 둔다. */
      const phase: VaultPhase = claimedAt > 0n
        ? "settled"
        : finalizable
          ? "claimable"
          : challenging
            ? "challenging"
            : pending
              ? "challenging"
              : expired
                ? cancelled
                  ? "cancelled"
                  : "expired"
                : "active";
      setVaultPhase(phase);
      setCancelledFlag(cancelled);
      setChallengeEndsAt(Number(challengeEnd));
      try {
        const cp: bigint = await vaultCtr.CHALLENGE_PERIOD();
        if (scope === balanceScopeRef.current) setChallengeDays(Math.round(Number(cp) / 86400));
      } catch {
        if (scope === balanceScopeRef.current) setChallengeDays(7);
      }
      if (scope !== balanceScopeRef.current) return;
      setTimeRemaining(Number(rem));
      setStale(true);
      // 체인 시계를 갱신한다 — 상대 시간("이의제기 N 시간 남음") 의 기준.
      // 상대 시간의 기준을 장치 시계에서 떼어내는 작업이다. 휴대전화 시계가 며칠
      // 틀어져 있으면 "이의제기 7일 남음" 표시가 실제보다 며칠 길어지고, 그 사이 상대는
      // 이미 돈을 가져간다. 블록 시각을 읽으면 그 시계는 체인 기준이 된다.
      if (provider) {
        try {
          const blk = await provider.getBlock("latest");
          if (blk) setChainNow(Number(blk.timestamp));
        } catch {
          // 블록을 못 읽으면 기존 값을 유지한다(장치 시계 폴백은 challengeRemaining 에서).
        }
      }
    } catch (e: unknown) {
      // 이 함수가 15초마다 도는 폴이다. 즉 사용자가 체인을 잃었을 때 가장 먼저, 가장
      // 자주 잡히는 지점이다. 예전에는 여기서 console.warn 만 남기고 조용히 넘어갔다.
      // 그러면 화면은 갱신되지 않은 숫자를 정답처럼 보여주고, 사용자는 그걸 "내 갱신이
      // 반영되지 않았다" 또는 "내 돈이 사라졌다" 고 읽는다. 연결이 끊겼다는 사실을
      // 말하는 유일한 기회인데, 말할 수 있는 곳이 아니었다.
      if (scope !== balanceScopeRef.current) return;
      setStale(false);
      console.warn("refreshTimer failed:", errorText(e));
    }
  }, [vaultCtr, provider, balanceScope]);
  useEffect(() => { if (vaultCtr) void refreshTimer(); }, [vaultCtr, refreshTimer]);
  useEffect(() => {
    if (!vaultCtr) return;
    const id = setInterval(() => { refreshTimer(); }, 15000);
    const onVis = () => { if (document.visibilityState === 'visible') refreshTimer(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [vaultCtr, refreshTimer]);

  const planFactoryAbi = (route: AppPlanRoute) => route.details?.factoryAbi ?? FACTORY_ABI;
  const planVaultAbi = (route: AppPlanRoute) => route.details?.vaultAbi ?? VAULT_ABI;

  const verifyPlanYieldRoute = async (route: AppPlanRoute): Promise<YieldTerms> => {
    if (!provider || route.mode !== "morpho" || !route.details) {
      throw new Error(`${route.symbol} Morpho route is not configured.`);
    }
    const details = route.details;
    const factoryContract = new ethers.Contract(route.factory, details.factoryAbi, provider);
    const strategyContract = new ethers.Contract(details.strategy, MORPHO_ABI, provider);
    const tokenContract = new ethers.Contract(route.asset, ERC20_ABI, provider);
    const [factoryAsset, strategy, recipient, fee, reward, underlyingAsset, underlyingFee, decimals] = await Promise.all([
      factoryContract[details.tokenGetter](), factoryContract.strategy(), factoryContract.feeRecipient(),
      factoryContract.performanceFeeBps(), route.symbol === "USDC" ? factoryContract.rewardToken() : Promise.resolve(WLD_ADDRESS),
      strategyContract.asset(), strategyContract.fee(), tokenContract.decimals(),
    ]);
    if (String(factoryAsset).toLowerCase() !== route.asset.toLowerCase()
      || String(underlyingAsset).toLowerCase() !== route.asset.toLowerCase()
      || String(strategy).toLowerCase() !== details.strategy.toLowerCase()
      || String(reward).toLowerCase() !== WLD_ADDRESS.toLowerCase()
      || Number(decimals) !== route.decimals || fee !== 1000n
      || !ethers.isAddress(String(recipient)) || String(recipient) === ethers.ZeroAddress) {
      throw new Error(`${route.symbol} Morpho fee recipient, asset or strategy could not be verified.`);
    }
    return { feeBps: Number(fee), recipient: String(recipient), underlyingFeePercent: Number(underlyingFee) / 1e16 };
  };

  const readPlanVaultIdentity = async (route: AppPlanRoute, ownerAddress: string, originalVault?: string): Promise<PlanVaultIdentity | null> => {
    if (!provider) throw new Error("Connect to World Chain before continuing.");
    const source = new ethers.Contract(route.factory, planFactoryAbi(route), provider);
    const canonical = String(await source.vaultOf(ownerAddress));
    const address = originalVault ?? canonical;
    if (!ethers.isAddress(address) || address === ethers.ZeroAddress) return null;
    // Yield registries retain knownVaults after release. Basic factories do not,
    // so a historical basic target must still occupy its canonical slot.
    if (originalVault && route.mode === "plain" && address.toLowerCase() !== canonical.toLowerCase()) {
      throw new Error("The original basic vault was released or replaced. Its saved request is preserved and was not repeated.");
    }
    const child = new ethers.Contract(address, planVaultAbi(route), provider);
    const [owner, heirAddress, heartbeat, sourceFactory, token, claimedAt, deadline, lastPing] = await Promise.all([
      child.owner(), child.heir(), child.heartbeatInterval(), child.factory(), child[route.details?.tokenGetter ?? "WLD"](),
      child.claimedAt(), child.deadline(), child.lastPing(),
    ]);
    if (String(owner).toLowerCase() !== ownerAddress.toLowerCase()
      || String(sourceFactory).toLowerCase() !== route.factory.toLowerCase()
      || String(token).toLowerCase() !== route.asset.toLowerCase()) {
      throw new Error(`${route.symbol} vault identity does not match its canonical factory route.`);
    }
    if (route.mode === "morpho" && route.details) {
      const [strategy, distributor, known] = await Promise.all([
        child.strategy(), child.MERKL_DISTRIBUTOR(), source.knownVaults(address),
      ]);
      if (String(strategy).toLowerCase() !== route.details.strategy.toLowerCase()
        || String(distributor).toLowerCase() !== MERKL_DISTRIBUTOR.toLowerCase() || !known) {
        throw new Error(`${route.symbol} vault strategy or registry identity could not be verified.`);
      }
      if (route.symbol === "USDC" && String(await child.rewardToken()).toLowerCase() !== WLD_ADDRESS.toLowerCase()) {
        throw new Error("USDC vault reward token does not match the supported WLD route.");
      }
    }
    return { address, owner: String(owner), heir: String(heirAddress), periodSeconds: BigInt(heartbeat),
      claimedAt: BigInt(claimedAt), deadline: BigInt(deadline), lastPing: BigInt(lastPing) };
  };

  const planFingerprint = (plan: StoredPlan) => [plan.account.toLowerCase(), plan.heir.toLowerCase(), plan.periodDays,
    ...plan.assets.map(asset => `${asset.symbol}:${asset.factory.toLowerCase()}:${asset.amount}`)].join("|");

  const alignmentFingerprint = (plan: StoredPlan, conflicts: readonly PlanAlignmentConflict[]) => [planFingerprint(plan),
    ...conflicts.map(conflict => [conflict.symbol, conflict.address.toLowerCase(), conflict.currentHeir.toLowerCase(),
      conflict.currentPeriodSeconds, conflict.requestedHeir.toLowerCase(), conflict.requestedPeriod].join(":")).sort()].join("|");

  const verifyCreateReceipt = (receipt: { logs: readonly { address: string; topics: readonly string[]; data: string }[] },
    targets: readonly AppPlanRoute[], plan: StoredPlan, observed: Map<string, string>) => {
    const iface = new ethers.Interface(FACTORY_ABI);
    const targetFactories = new Set(targets.map(route => route.factory.toLowerCase()));
    for (const log of receipt.logs) {
      if (!targetFactories.has(log.address.toLowerCase())) continue;
      try {
        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
        if (!parsed || parsed.name !== "VaultCreated") continue;
        const owner = String(parsed.args.owner), heirAddress = String(parsed.args.heir);
        const newVault = String(parsed.args.vault), heartbeat = BigInt(parsed.args.heartbeatInterval);
        if (owner.toLowerCase() === plan.account.toLowerCase() && heirAddress.toLowerCase() === plan.heir.toLowerCase()
          && heartbeat === BigInt(plan.periodDays) * 86400n && ethers.isAddress(newVault)) {
          observed.set(log.address.toLowerCase(), ethers.getAddress(newVault));
        }
      } catch { /* Ignore logs from unrelated events. */ }
    }
    return observed.size > 0;
  };

  const verifyDepositReceipt = (receipt: { logs: readonly { address: string; topics: readonly string[]; data: string }[] },
    route: AppPlanRoute, step: StoredPlanAsset, ownerAddress: string) => {
    const amount = BigInt(step.amount), expectedOwner = ownerAddress.toLowerCase(), expectedVault = step.vault.toLowerCase();
    let exactTransfer = false, deposited = route.mode === "plain";
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === route.asset.toLowerCase()) {
        try {
          const parsed = TRANSFER_EVENT_IFACE.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed && String(parsed.args.from).toLowerCase() === expectedOwner
            && String(parsed.args.to).toLowerCase() === expectedVault && BigInt(parsed.args.value) === amount) exactTransfer = true;
        } catch { /* Ignore unrelated token logs. */ }
      }
      if (route.mode === "morpho" && log.address.toLowerCase() === expectedVault) {
        try {
          const parsed = DEPOSIT_EVENT_IFACE.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed && BigInt(parsed.args.assets) === amount && BigInt(parsed.args.shares) > 0n) deposited = true;
        } catch { /* Ignore unrelated vault logs. */ }
      }
    }
    return exactTransfer && deposited;
  };

  const confirmPlanCreation = async (plan: StoredPlan, targets: readonly AppPlanRoute[]) => {
    const observed = new Map<string, string>();
    await waitForTxOrEvent(getRwProvider(), {
      txHash: plan.createTxHash,
      hashType: plan.createHashType,
      verifyReceipt: receipt => verifyCreateReceipt(receipt, targets, plan, observed),
      check: async () => {
        for (const route of targets) {
          const eventVault = observed.get(route.factory.toLowerCase());
          if (!eventVault) continue;
          const identity = await readPlanVaultIdentity(route, plan.account, eventVault);
          if (!identity || identity.address.toLowerCase() !== eventVault.toLowerCase()
            || identity.owner.toLowerCase() !== plan.account.toLowerCase()) return false;
        }
        return observed.size > 0;
      },
    });
    return observed;
  };

  const verifyAlignmentReceipt = (receipt: { logs: readonly { address: string; topics: readonly string[]; data: string }[] },
    plan: StoredPlan, alignment: StoredPlanAlignment) => {
    const heirs = new Set<string>(), periods = new Set<string>(), checkIns = new Set<string>();
    for (const log of receipt.logs) {
      const address = log.address.toLowerCase();
      if (!alignment.targets.some(target => target.vault.toLowerCase() === address)) continue;
      try {
        const event = SETTINGS_EVENT_IFACE.parseLog({ topics: [...log.topics], data: log.data });
        if (event?.name === "HeirUpdated" && String(event.args.newHeir).toLowerCase() === plan.heir.toLowerCase()) heirs.add(address);
        if (event?.name === "HeartbeatUpdated" && BigInt(event.args.newInterval) === BigInt(plan.periodDays) * 86400n) periods.add(address);
        if (event?.name === "Ping" && BigInt(event.args.timestamp) > 0n) checkIns.add(address);
      } catch { /* Unrelated events do not prove a settings update. */ }
    }
    return alignment.targets.length > 0 && alignment.targets.every(target =>
      (target.heir.toLowerCase() !== plan.heir.toLowerCase() || BigInt(target.periodSeconds) !== BigInt(plan.periodDays) * 86400n)
      &&
      (target.heir.toLowerCase() === plan.heir.toLowerCase() || heirs.has(target.vault.toLowerCase()))
      && (BigInt(target.periodSeconds) === BigInt(plan.periodDays) * 86400n || periods.has(target.vault.toLowerCase()))
      && (!target.checkIn || checkIns.has(target.vault.toLowerCase())));
  };

  const confirmSavedAlignment = async (plan: StoredPlan, original: StoredPlanAlignment,
    recordReceipt: (alignment: StoredPlanAlignment) => void) => {
    if (!provider) throw new Error("World Chain is unavailable. The prior settings request was not repeated.");
    const verifyTargets = async () => {
      for (const target of original.targets) {
        const route = trustedPlanRoute(target.factory);
        if (!route) throw new Error("The original settings route is unavailable. Its request was preserved.");
        const identity = await readPlanVaultIdentity(route, plan.account, target.vault);
        if (!identity || identity.owner.toLowerCase() !== plan.account.toLowerCase()) return false;
      }
      return true;
    };
    if (!await verifyTargets()) throw new Error("The original settings targets could not be verified. No request was repeated.");
    let alignment = original;
    if (!alignment.txHash) {
      const signatures = ["HeirUpdated", "HeartbeatUpdated"].map(name => SETTINGS_EVENT_IFACE.getEvent(name)!.topicHash);
      const receipt = await findUniquePlanReceipt(alignment.beforeBlock,
        () => provider.getBlockNumber(),
        (fromBlock, toBlock) => provider.getLogs({ address: alignment.targets.map(target => target.vault),
          topics: [signatures], fromBlock, toBlock }),
        hash => provider.getTransactionReceipt(hash),
        () => true,
        candidate => candidate.status === 1 && verifyAlignmentReceipt(candidate, plan, alignment));
      if (!receipt) throw new Error("The prior settings request has no verifiable result yet. It was not repeated; editing remains paused.");
      alignment = { ...alignment, state: "submitted", txHash: receipt.hash, hashType: "transaction" };
      recordReceipt(alignment);
    }
    await waitForTxOrEvent(getRwProvider(), {
      txHash: alignment.txHash, hashType: alignment.hashType,
      verifyReceipt: receipt => verifyAlignmentReceipt(receipt, plan, alignment),
      check: verifyTargets,
    });
  };

  const confirmSavedPlanDeposit = async (plan: StoredPlan, storedStep: StoredPlanAsset, route: AppPlanRoute,
    recordReceipt?: (step: StoredPlanAsset) => void) => {
    if (!provider || !storedStep.vault) throw new Error(`${storedStep.symbol} original deposit target is unavailable. No request was repeated.`);
    const original = await readPlanVaultIdentity(route, plan.account, storedStep.vault);
    if (!original) throw new Error(`${storedStep.symbol} original vault could not be verified. No request was repeated.`);
    let step = storedStep;
    if (step.depositState === "submitted" && !step.txHash) step = { ...step, depositState: "submitting" };
    if (step.depositState === "submitting" && step.txHash) {
      throw new Error(`The saved ${step.symbol} request has an unexpected transaction state. It was not repeated.`);
    }
    if (step.depositState === "submitting") {
      const transferTopic = TRANSFER_EVENT_IFACE.getEvent("Transfer")!.topicHash;
      const receipt = await findUniquePlanReceipt(
        step.beforeBlock,
        () => provider.getBlockNumber(),
        (fromBlock, toBlock) => provider.getLogs({ address: route.asset,
          topics: [transferTopic, ethers.zeroPadValue(ethers.getAddress(plan.account), 32), ethers.zeroPadValue(ethers.getAddress(step.vault), 32)],
          fromBlock, toBlock }),
        transactionHash => provider.getTransactionReceipt(transactionHash),
        log => {
          try {
            const transfer = TRANSFER_EVENT_IFACE.parseLog({ topics: [...log.topics], data: log.data });
            return Boolean(transfer && String(transfer.args.from).toLowerCase() === plan.account.toLowerCase()
              && String(transfer.args.to).toLowerCase() === step.vault.toLowerCase()
              && BigInt(transfer.args.value) === BigInt(step.amount));
          } catch { return false; }
        },
        candidate => candidate.status === 1 && verifyDepositReceipt(candidate, route, step, plan.account),
      );
      if (!receipt) throw new Error(`The prior ${step.symbol} request has no verifiable result yet. It was not repeated.`);
      step = { ...step, depositState: "submitted", txHash: receipt.hash, hashType: "transaction" };
      recordReceipt?.(step);
    }
    if (step.depositState !== "submitted" || !step.txHash) {
      throw new Error(`The prior ${step.symbol} request has no transaction ID. It was not repeated.`);
    }
    await waitForTxOrEvent(getRwProvider(), {
      txHash: step.txHash, hashType: step.hashType,
      verifyReceipt: receipt => verifyDepositReceipt(receipt, route, step, plan.account),
      check: async () => {
        const current = await readPlanVaultIdentity(route, plan.account, step.vault);
        // A receipt proves the historical deposit. Later owner withdrawals,
        // settlement, settings edits or slot replacement do not invalidate it.
        return Boolean(current && current.address.toLowerCase() === step.vault.toLowerCase()
          && current.owner.toLowerCase() === plan.account.toLowerCase());
      },
    });
  };

  const confirmSetupRequest = async (plan: StoredPlan, original: StoredSetupRequest,
    recordRequest: (request: StoredSetupRequest) => void) => {
    if (!provider) throw new Error("World Chain is unavailable. The saved setup request was not repeated.");
    const steps = original.assets.map(target => {
      const asset = plan.assets.find(item => item.symbol === target.symbol);
      const route = asset && storedPlanRoute(asset);
      if (!asset || !route) throw new Error("An original setup route is unavailable. No request was repeated.");
      return { target, asset, route };
    });
    const createdRoutes = original.createdFactories.map(factoryAddress => {
      const route = steps.find(item => item.route.factory.toLowerCase() === factoryAddress.toLowerCase())?.route;
      if (!route) throw new Error("An original create target is unavailable. No request was repeated.");
      return route;
    });
    const observed = new Map<string, string>();
    const verifyReceipt = (receipt: { logs: readonly { address: string; topics: readonly string[]; data: string }[] }) => {
      const created = new Map<string, string>();
      if (createdRoutes.length) verifyCreateReceipt(receipt, createdRoutes, plan, created);
      if (created.size !== createdRoutes.length) return false;
      const resolved = new Map<string, string>();
      for (const { target, asset, route } of steps) {
        const vaultAddress = target.vault || created.get(route.factory.toLowerCase());
        if (!vaultAddress || !verifyDepositReceipt(receipt, route, { ...asset, vault: vaultAddress }, plan.account)) return false;
        resolved.set(asset.symbol, vaultAddress);
      }
      observed.clear();
      for (const [symbol, vaultAddress] of resolved) observed.set(symbol, vaultAddress);
      return true;
    };
    let request = original;
    if (!request.txHash) {
      const receipt = await findUniquePlanReceipt(request.beforeBlock,
        () => provider.getBlockNumber(),
        (fromBlock, toBlock) => provider.getLogs({
          address: [...new Set([...createdRoutes.map(route => route.factory), ...steps.map(item => item.route.asset)])],
          topics: [[new ethers.Interface(FACTORY_ABI).getEvent("VaultCreated")!.topicHash,
            TRANSFER_EVENT_IFACE.getEvent("Transfer")!.topicHash], ethers.zeroPadValue(ethers.getAddress(plan.account), 32)],
          fromBlock, toBlock,
        }),
        hash => provider.getTransactionReceipt(hash), () => true,
        candidate => candidate.status === 1 && verifyReceipt(candidate));
      if (!receipt) throw new Error("The prior setup request has no verifiable result yet. It was not repeated.");
      request = { ...request, txHash: receipt.hash, hashType: "transaction" };
      recordRequest(request);
    }
    await waitForTxOrEvent(getRwProvider(), {
      txHash: request.txHash, hashType: request.hashType, verifyReceipt,
      check: async () => {
        for (const { asset, route } of steps) {
          const vaultAddress = observed.get(asset.symbol);
          if (!vaultAddress) return false;
          const identity = await readPlanVaultIdentity(route, plan.account, vaultAddress);
          if (!identity || identity.owner.toLowerCase() !== plan.account.toLowerCase()) return false;
        }
        return observed.size === steps.length;
      },
    });
    return observed;
  };

  const continuePlan = async (confirmAlignment = false, reviewedStrategyFees?: Partial<Record<AssetSymbol, number>>) => {
    if (creating) return;
    if (!account || !factory) { setStatus("Connect first"); return; }
    if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast("error", "Open in World App"); return; }
    if (!provider) { setStatus("World Chain is still connecting. Try again shortly."); return; }
    setCreating(true);
    const acceptedStrategyFees = { ...(reviewedStrategyFees ?? consentedStrategyFees.current) };
    const verifyAcceptedStrategyFee = async (route: AppPlanRoute) => {
      const fresh = await verifyPlanYieldRoute(route);
      if(acceptedStrategyFees[route.symbol] !== fresh.underlyingFeePercent) {
        setYieldTermsByFactory(current => ({ ...current, [route.factory]: fresh }));
        setYieldConsent(false);
        consentedStrategyFees.current = {};
        throw new Error(`${route.symbol} strategy fee changed. Review the current fees and accept them again before continuing. No new wallet request was sent.`);
      }
    };
    let workingPlan: StoredPlan | null = null;
    const watcherRequests: Promise<void>[] = [];
    let watcherFailed = false;
    const monitorConfirmedVault = (route: AppPlanRoute, vaultAddress: string, ownerAddress: string) => {
      if (!NOTIFY_BACKEND_ENABLED || !vaultAddress) return;
      watcherRequests.push((async () => {
        const identity = await readPlanVaultIdentity(route, ownerAddress);
        // Monitor the current canonical position and its current heir, without
        // transferring a historical deposit's monitoring to a replacement.
        if (!identity || identity.address.toLowerCase() !== vaultAddress.toLowerCase()
          || identity.claimedAt > 0n || identity.heir === ethers.ZeroAddress
          || identity.heir.toLowerCase() === ownerAddress.toLowerCase()) return;
        await registerWatcher(identity.address, ownerAddress, identity.heir, true);
      })().catch(() => { watcherFailed = true; }));
    };
    const persist = (update: (current: StoredPlan) => StoredPlan) => {
      if (!workingPlan) return;
      const next = update(workingPlan);
      savePendingPlan(next);
      workingPlan = next;
    };
    try {
      const existingPending = pendingPlan ?? readStoredPlan(account);
      if (existingPending && existingPending.account.toLowerCase() !== account.toLowerCase()) {
        throw new Error("The saved plan belongs to another wallet. Switch wallets to resume it.");
      }
      if (existingPending) {
        workingPlan = existingPending;
      } else {
        if (!periodValid) throw new Error("Check-in interval must be between 1 and 365 days.");
        const resolved = heirResolved || await resolveHeirInput(heir);
        if (!resolved?.address || !ethers.isAddress(resolved.address)) throw new Error("Enter a valid heir username or address.");
        if (resolved.address === ethers.ZeroAddress) throw new Error("Heir cannot be the zero address.");
        const inputs: Record<PlanAssetSymbol, string> = { WLD: planWldAmount, USDC: planUsdcAmount };
        const selectedAssets: StoredPlanAsset[] = [];
        for (const route of APP_PLAN_ROUTES) {
          const input = inputs[route.symbol];
          const amount = input.trim() ? parseAssetAmount(input, route.decimals) : 0n;
          if (amount === null) throw new Error(`${route.symbol} amount has too many decimal places or an invalid format.`);
          if (amount > 0n) selectedAssets.push({ symbol: route.symbol, factory: route.factory, asset: route.asset,
            decimals: route.decimals, mode: route.mode, amount: amount.toString(), vault: "", depositState: "ready" });
        }
        if (!selectedAssets.length) throw new Error("Enter a WLD or USDC amount greater than zero.");
        if (selectedAssets.some(asset => asset.mode === "morpho") && !yieldConsent) {
          throw new Error("Review and accept the Morpho fee and risk terms before continuing.");
        }
        workingPlan = { version: 1, account: ethers.getAddress(account), heir: ethers.getAddress(resolved.address),
          periodDays: periodNum, createdAt: Date.now(), createState: "ready", createTargets: [], assets: selectedAssets };
      }

      const plan = workingPlan;
      if (plan.account.toLowerCase() !== account.toLowerCase()) throw new Error("The saved plan account no longer matches this wallet.");
      const routeForStep = (step: StoredPlanAsset): AppPlanRoute => {
        const route = storedPlanRoute(step);
        if (!route) {
          throw new Error(`${step.symbol} route configuration changed. The saved plan was not sent.`);
        }
        return route;
      };
      const finishSetupRequest = async (request: StoredSetupRequest) => {
        const observed = await confirmSetupRequest(workingPlan!, request, recovered =>
          persist(current => ({ ...current, setupRequest: recovered })));
        persist(current => ({ ...current, setupRequest: undefined, createState: "complete", createTargets: [],
          createBeforeBlock: undefined, createTxHash: undefined, createHashType: undefined,
          assets: current.assets.map(asset => observed.has(asset.symbol)
            ? { ...asset, vault: observed.get(asset.symbol)!, depositState: "complete", beforeBlock: undefined,
              beforeBalance: undefined, txHash: undefined, hashType: undefined } : asset),
        }));
      };
      // New deposits use the selected routes; shared settings review includes
      // every trusted active generation, including existing basic WLD vaults.
      const planRoutes = [...new Set(TRUSTED_FACTORIES.map(address => address.toLowerCase()))]
        .map(trustedPlanRoute).filter((route): route is AppPlanRoute => Boolean(route));
      for (const asset of plan.assets) routeForStep(asset);
      const periodSeconds = BigInt(plan.periodDays) * 86400n;
      let latestBlock = await provider.getBlock("latest");
      if (!latestBlock) throw new Error("World Chain time is unavailable. Refresh before continuing.");

      if (plan.alignment) {
        await confirmSavedAlignment(plan, plan.alignment, recovered => persist(current => ({ ...current, alignment: recovered })));
        persist(current => ({ ...current, alignment: undefined }));
        for (const target of plan.alignment.targets) {
          const route = trustedPlanRoute(target.factory);
          if (route) monitorConfirmedVault(route, target.vault, plan.account);
        }
      }

      // A single wallet request can create and fund both assets. Resolve its
      // entire historical receipt before legacy recovery or any fresh fee reads.
      if (workingPlan.setupRequest) await finishSetupRequest(workingPlan.setupRequest);

      for (const asset of workingPlan.assets.filter(item => item.depositState === "complete")) {
        monitorConfirmedVault(routeForStep(asset), asset.vault, plan.account);
      }

      if (workingPlan.createState === "submitted" && workingPlan.createTxHash && workingPlan.createTargets.length > 0) {
        const submittedRoutes = plan.createTargets.map(factoryAddress => planRoutes.find(route => route.factory.toLowerCase() === factoryAddress.toLowerCase()))
          .filter((route): route is AppPlanRoute => Boolean(route));
        if (submittedRoutes.length !== plan.createTargets.length) throw new Error("The saved create route could not be matched. No retry was sent.");
        await confirmPlanCreation(plan, submittedRoutes);
        persist(current => ({ ...current, createState: "ready", createTargets: [], createTxHash: undefined, createHashType: undefined }));
      } else if (workingPlan.createState === "submitting" || (workingPlan.createState === "submitted" && !workingPlan.createTxHash)) {
        const uncertain = plan.createTargets.map(factoryAddress => planRoutes.find(route => route.factory.toLowerCase() === factoryAddress.toLowerCase()))
          .filter((route): route is AppPlanRoute => Boolean(route));
        if (!uncertain.length || uncertain.length !== plan.createTargets.length) throw new Error("The original create targets are unavailable. No retry was sent.");
        const createTopic = new ethers.Interface(FACTORY_ABI).getEvent("VaultCreated")!.topicHash;
        const receipt = await findUniquePlanReceipt(plan.createBeforeBlock,
          () => provider.getBlockNumber(),
          (fromBlock, toBlock) => provider.getLogs({ address: uncertain.map(route => route.factory),
            topics: [createTopic, ethers.zeroPadValue(ethers.getAddress(plan.account), 32)], fromBlock, toBlock }),
          hash => provider.getTransactionReceipt(hash), () => true,
          candidate => {
            const observed = new Map<string, string>();
            return candidate.status === 1 && verifyCreateReceipt(candidate, uncertain, plan, observed)
              && observed.size === uncertain.length;
          });
        if (!receipt) throw new Error("A create request was interrupted before its transaction ID was saved. No duplicate create was sent; reopen the app after the wallet request settles.");
        persist(current => ({ ...current, createState: "submitted", createTxHash: receipt.hash, createHashType: "transaction" }));
        await confirmPlanCreation(workingPlan!, uncertain);
        persist(current => ({ ...current, createState: "complete", createTargets: [], createTxHash: undefined, createHashType: undefined }));
      }

      // Resolve prior sends against their original targets before any new wallet
      // request. Neither a completed nor a submitted step is a new deposit.
      for (const asset of workingPlan.assets.filter(item => item.depositState === "submitting" || item.depositState === "submitted")) {
        await confirmSavedPlanDeposit(plan, asset, routeForStep(asset), recovered =>
          persist(current => ({ ...current, assets: current.assets.map(item => item.symbol === recovered.symbol ? recovered : item) })));
        persist(current => ({ ...current, assets: current.assets.map(item => item.symbol === asset.symbol
          ? { ...item, depositState: "complete", txHash: undefined, hashType: undefined } : item) }));
        monitorConfirmedVault(routeForStep(asset), asset.vault, plan.account);
      }

      if (workingPlan.assets.some(asset => asset.mode === "morpho" && asset.depositState === "ready") && !yieldConsent) {
        throw new Error("Please review and accept the Morpho fee and risk terms before sending the remaining deposits.");
      }

      // Check all remaining balances before alignment or contract creation can
      // cost gas. A new invalid draft stays editable and has no saved journal.
      for (const asset of workingPlan.assets.filter(item => item.depositState === "ready")) {
        const route = routeForStep(asset);
        const token = new ethers.Contract(route.asset, ERC20_ABI, provider);
        const [decimals, balance] = await Promise.all([token.decimals(), token.balanceOf(plan.account)]);
        if (Number(decimals) !== route.decimals) throw new Error(`${route.symbol} token precision does not match its configured route.`);
        if (BigInt(balance) < BigInt(asset.amount)) throw new Error(`Not enough ${route.symbol} in your wallet. Adjust the remaining amount before continuing.`);
        if (asset.mode === "morpho") await verifyAcceptedStrategyFee(route);
      }
      const assetByFactory = new Map(workingPlan.assets.map(asset => [asset.factory.toLowerCase(), asset]));
      const currentIdentities = new Map<string, PlanVaultIdentity | null>();
      const conflicts: PlanAlignmentConflict[] = [];
      for (const route of planRoutes) {
        const identity = await readPlanVaultIdentity(route, plan.account);
        currentIdentities.set(route.factory.toLowerCase(), identity);
        if (!identity) continue;
        const step = assetByFactory.get(route.factory.toLowerCase());
        const selectedForDeposit = step?.depositState === "ready";
        if (identity.claimedAt > 0n || identity.heir.toLowerCase() === plan.account.toLowerCase() || identity.heir === ethers.ZeroAddress) {
          if (selectedForDeposit) throw new Error(`${route.symbol} vault is closed or its inheritance is cancelled. Manage or release it before starting a new deposit.`);
          continue;
        }
        const settingsDiffer = identity.heir.toLowerCase() !== plan.heir.toLowerCase() || identity.periodSeconds !== periodSeconds;
        if (settingsDiffer) {
          if (identity.deadline <= BigInt(latestBlock.timestamp)) {
            if (selectedForDeposit) throw new Error(`${route.symbol} settings differ, but its check-in period has ended. The app will not overwrite them; renew or manage that vault first.`);
            continue;
          }
          conflicts.push({ symbol: route.symbol, address: identity.address, currentHeir: identity.heir,
            currentPeriod: Number(identity.periodSeconds) / 86400, currentPeriodSeconds: identity.periodSeconds,
            requestedHeir: plan.heir, requestedPeriod: plan.periodDays });
        }
        if (selectedForDeposit && identity.deadline <= BigInt(latestBlock.timestamp)) {
          throw new Error(`${route.symbol} check-in period has ended. Renew it before adding funds.`);
        }
      }

      if (conflicts.length > 0) {
        const fingerprint = alignmentFingerprint(plan, conflicts);
        if (!confirmAlignment || alignmentReview !== fingerprint) {
          setAlignmentReview(fingerprint);
          setAlignmentConflicts(conflicts);
          setStatus("Review the existing vault settings before continuing. No changes have been made.");
          return;
        }
        const alignCalls = conflicts.flatMap(conflict => {
          const route = planRoutes.find(candidate => candidate.factory.toLowerCase() === conflict.address.toLowerCase()
            || currentIdentities.get(candidate.factory.toLowerCase())?.address.toLowerCase() === conflict.address.toLowerCase());
          if (!route) return [];
          const calls = [];
          if (conflict.currentHeir.toLowerCase() !== plan.heir.toLowerCase()) calls.push({
            address: route.factory, abi: planFactoryAbi(route), functionName: "updateMyHeir", args: [plan.heir],
          });
          if (conflict.currentPeriodSeconds !== periodSeconds) {
            // The reviewed interval starts at this check-in. Preserving an old
            // lastPing could immediately expire a funded, unselected asset.
            calls.push({ address: route.factory, abi: planFactoryAbi(route), functionName: "pingMyVault", args: [] });
            calls.push({ address: route.factory, abi: planFactoryAbi(route), functionName: "changeMyPeriod", args: [periodSeconds.toString()] });
          }
          return calls;
        });
        if (alignCalls.length > 0) {
          const beforeBlock = await provider.getBlockNumber();
          const targets = conflicts.map(conflict => {
            const route = planRoutes.find(candidate => currentIdentities.get(candidate.factory.toLowerCase())?.address.toLowerCase() === conflict.address.toLowerCase());
            if (!route) throw new Error("A reviewed settings target changed. Review the plan again.");
            return { factory: route.factory, vault: conflict.address, heir: conflict.currentHeir,
              periodSeconds: conflict.currentPeriodSeconds.toString(), checkIn: conflict.currentPeriodSeconds !== periodSeconds };
          });
          persist(current => ({ ...current, alignment: { state: "submitting", beforeBlock, targets } }));
          const sent = await sendWorldChainTx(alignCalls);
          if (!sent.ok) {
            if (sent.definitelyNotSubmitted) persist(current => ({ ...current, alignment: undefined }));
            setStatus(sent.error);
            if (sent.userFacing) pushToast("error", sent.error);
            return;
          }
          persist(current => ({ ...current, alignment: { ...current.alignment!, state: "submitted",
            txHash: sent.tx.hash, hashType: sent.tx.hashType } }));
          setStatus("Pending… aligning the reviewed plan settings");
          await confirmSavedAlignment(workingPlan!, workingPlan!.alignment!, recovered =>
            persist(current => ({ ...current, alignment: recovered })));
          persist(current => ({ ...current, alignment: undefined }));
          for (const target of targets) {
            const route = trustedPlanRoute(target.factory);
            if (route) monitorConfirmedVault(route, target.vault, plan.account);
          }
        }
        setAlignmentReview("");
        setAlignmentConflicts([]);
        latestBlock = await provider.getBlock("latest");
        if (!latestBlock) throw new Error("World Chain time is unavailable after settings review.");
      } else {
        setAlignmentReview("");
        setAlignmentConflicts([]);
      }

      for (const asset of workingPlan.assets.filter(item => item.depositState === "ready" && item.mode === "morpho")) {
        const route = routeForStep(asset);
        await verifyAcceptedStrategyFee(route);
      }

      const readyAssets = workingPlan.assets.filter(asset => asset.depositState === "ready");
      if (readyAssets.length) {
        const createdFactories: string[] = [];
        const requestAssets: StoredSetupRequest["assets"] = [];
        const calls: Parameters<typeof sendWorldChainTx>[0] = [];
        const block = await provider.getBlock("latest");
        if (!block) throw new Error("World Chain time is unavailable. Refresh before continuing.");
        // Prepare every call before saving the request or asking the wallet.
        // Factories resolve the owner's new vault inside the same atomic batch.
        for (const asset of readyAssets) {
          const route = routeForStep(asset);
          const identity = await readPlanVaultIdentity(route, plan.account);
          if (identity) {
            if (identity.heir.toLowerCase() !== plan.heir.toLowerCase() || identity.periodSeconds !== periodSeconds
              || identity.claimedAt > 0n || identity.deadline <= BigInt(block.timestamp)) {
              throw new Error(`${asset.symbol} settings changed before deposit. Review the plan again.`);
            }
            requestAssets.push({ symbol: asset.symbol, vault: identity.address });
          } else {
            createdFactories.push(route.factory);
            requestAssets.push({ symbol: asset.symbol, vault: "" });
            calls.push({ address: route.factory, abi: planFactoryAbi(route), functionName: "createVault",
              args: [plan.heir, periodSeconds.toString()] });
          }
        }
        for (const asset of readyAssets) {
          const route = routeForStep(asset);
          const amount = BigInt(asset.amount);
          const token = new ethers.Contract(route.asset, ERC20_ABI, provider);
          const [decimals, balance] = await Promise.all([token.decimals(), token.balanceOf(plan.account)]);
          if (Number(decimals) !== route.decimals || BigInt(balance) < amount) {
            throw new Error(`Not enough ${route.symbol} in your wallet to finish this plan.`);
          }
          if (route.mode === "morpho") await verifyAcceptedStrategyFee(route);
          const minShares = route.mode === "morpho"
            ? minimumOutput(BigInt(await new ethers.Contract(route.details!.strategy, MORPHO_ABI, provider).previewDeposit(amount))) : 0n;
          calls.push({ address: route.asset, abi: ERC20_ABI, functionName: "approve", args: [route.factory, amount.toString()] });
          calls.push(route.mode === "morpho"
            ? { address: route.factory, abi: planFactoryAbi(route), functionName: "depositWithMinShares", args: [amount.toString(), minShares.toString()] }
            : { address: route.factory, abi: planFactoryAbi(route), functionName: "deposit", args: [amount.toString()] });
        }
        const request: StoredSetupRequest = { beforeBlock: await provider.getBlockNumber(), createdFactories, assets: requestAssets };
        const symbols = new Set(readyAssets.map(asset => asset.symbol));
        const resetRequest = (current: StoredPlan): StoredPlan => ({ ...current, setupRequest: undefined,
          createState: createdFactories.length ? "ready" : "complete", createTargets: [], createBeforeBlock: undefined,
          createTxHash: undefined, createHashType: undefined,
          assets: current.assets.map(asset => symbols.has(asset.symbol)
            ? { ...asset, depositState: "ready", vault: request.assets.find(target => target.symbol === asset.symbol)!.vault,
              beforeBlock: undefined, beforeBalance: undefined, txHash: undefined, hashType: undefined } : asset),
        });
        persist(current => ({ ...current, setupRequest: request,
          createState: createdFactories.length ? "submitting" : "complete", createTargets: createdFactories,
          createBeforeBlock: request.beforeBlock,
          assets: current.assets.map(asset => symbols.has(asset.symbol)
            ? { ...asset, vault: request.assets.find(target => target.symbol === asset.symbol)!.vault, depositState: "submitting" } : asset),
        }));
        const sent = await sendWorldChainTx(calls);
        if (!sent.ok) {
          if (sent.definitelyNotSubmitted) persist(resetRequest);
          setStatus(sent.error);
          if (sent.userFacing) pushToast("error", sent.error);
          return;
        }
        const submitted = { ...request, txHash: sent.tx.hash, hashType: sent.tx.hashType };
        persist(current => ({ ...current, setupRequest: submitted,
          createState: createdFactories.length ? "submitted" : "complete",
          assets: current.assets.map(asset => symbols.has(asset.symbol) ? { ...asset, depositState: "submitted" } : asset),
        }));
        setStatus("Pending… verifying your plan and deposits");
        await finishSetupRequest(submitted);
        for (const asset of workingPlan.assets.filter(item => symbols.has(item.symbol))) {
          monitorConfirmedVault(routeForStep(asset), asset.vault, plan.account);
        }
      }

      const completedPlan = workingPlan;
      if (!completedPlan || completedPlan.assets.some(asset => asset.depositState !== "complete")) {
        throw new Error("The plan is not finished yet. Resume to complete the remaining asset.");
      }
      const currentPositions = await Promise.all(completedPlan.assets.map(async asset => ({
        asset, identity: await readPlanVaultIdentity(routeForStep(asset), completedPlan.account),
      })));
      const currentActive = currentPositions.filter(({ identity }) => identity && identity.claimedAt === 0n
        && identity.heir !== ethers.ZeroAddress && identity.heir.toLowerCase() !== completedPlan.account.toLowerCase());
      const primaryIdentity = (currentActive[0] ?? currentPositions.find(({ identity }) => identity))?.identity;
      const allPositionsUnchanged = currentPositions.every(({ asset, identity }) => identity
        && identity.address.toLowerCase() === asset.vault.toLowerCase() && identity.claimedAt === 0n
        && identity.heir.toLowerCase() === completedPlan.heir.toLowerCase() && identity.periodSeconds === periodSeconds);
      clearPendingPlan(completedPlan.account);
      setPlanWldAmount("");
      setPlanUsdcAmount("");
      setYieldConsent(false);
      setOwnVault(primaryIdentity?.address ?? "");
      setVault(primaryIdentity?.address ?? "");
      setLinkedVault("");
      setTab("vault");
      setStatus(allPositionsUnchanged ? "Your inheritance plan is ready. Deposits and vaults are verified on World Chain."
        : "Remaining setup is complete. Earlier deposits were verified; current assets and settings appear below.");
      void loadVault();
      void refreshBalances();
      void refreshTimer();
    } catch (error) {
      if (error instanceof ConfirmedTransactionFailure && workingPlan) {
        const failedHash = error.txHash.toLowerCase();
        if (workingPlan.setupRequest?.txHash?.toLowerCase() === failedHash) {
          const failed = workingPlan.setupRequest;
          persist(current => ({ ...current, setupRequest: undefined,
            createState: failed.createdFactories.length ? "ready" : "complete", createTargets: [], createBeforeBlock: undefined,
            createTxHash: undefined, createHashType: undefined,
            assets: current.assets.map(asset => {
              const target = failed.assets.find(item => item.symbol === asset.symbol);
              return target ? { ...asset, vault: target.vault, depositState: "ready", beforeBlock: undefined,
                beforeBalance: undefined, txHash: undefined, hashType: undefined } : asset;
            }),
          }));
        } else if (workingPlan.alignment?.txHash?.toLowerCase() === failedHash) {
          persist(current => ({ ...current, alignment: undefined }));
        } else if (workingPlan.createState === "submitted" && workingPlan.createTxHash?.toLowerCase() === failedHash) {
          persist(current => ({ ...current, createState: "ready", createTargets: [], createBeforeBlock: undefined,
            createTxHash: undefined, createHashType: undefined }));
        } else if (workingPlan.assets.some(asset => asset.depositState === "submitted" && asset.txHash?.toLowerCase() === failedHash)) {
          persist(current => ({ ...current, assets: current.assets.map(asset =>
            asset.depositState === "submitted" && asset.txHash?.toLowerCase() === failedHash
              ? { ...asset, depositState: "ready", beforeBalance: undefined, beforeBlock: undefined,
                txHash: undefined, hashType: undefined }
              : asset) }));
        }
      }
      const message = errorText(error);
      setStatus("Plan setup: " + message);
      if (!/cancelled the transaction/i.test(message)) pushToast("error", message);
    } finally {
      // A later asset failure or edit must not abandon monitoring of deposits
      // that already succeeded. Registration remains best effort, never a reason
      // to repeat a wallet transaction.
      await Promise.all(watcherRequests);
      if (watcherFailed) pushToast("info", "Your confirmed assets are saved. Some reminders could not be enabled; review them in Help.");
      setCreating(false);
    }
  };


  const createPlan = () => continuePlan(false, { ...consentedStrategyFees.current });
  const editRemainingPlan = () => {
    if (actionInFlight.current || !account || !pendingPlan) return;
    const saved = readStoredPlan(account) ?? pendingPlan;
    if (saved.account.toLowerCase() !== account.toLowerCase() || !canEditStoredPlan(saved)) {
      setStatus("An earlier wallet request still needs verification. Resume it before editing.");
      return;
    }
    try {
      clearPendingPlan(account);
      setAlignmentReview("");
      setAlignmentConflicts([]);
      onHeirInput(saved.heir);
      onPeriodChange(String(saved.periodDays));
      const amountFor = (symbol: PlanAssetSymbol) => {
        const asset = saved.assets.find(item => item.symbol === symbol && item.depositState === "ready");
        return asset ? ethers.formatUnits(asset.amount, asset.decimals) : "";
      };
      setPlanWldAmount(amountFor("WLD"));
      setPlanUsdcAmount(amountFor("USDC"));
      setYieldConsent(false);
      setStatus("Adjust your remaining setup. Completed deposits and existing vaults stay in place.");
      void refreshBalances();
    } catch (error) {
      setStatus("Plan setup: " + errorText(error));
    }
  };

  // ---- 주인이 상속인에게 보낼 링크/문구
  //
  // 월드앱 알림은 이 미니앱을 설치하지 않은 지갑에 도달하지 못한다. 그래서
  // 상속인이 알게 되는 유일한 확실한 경로는 주인이 직접 보내는 링크다.
  // 앱이 설치되어 있든 없든 이 링크는 통한다.
  // `APP_ORIGIN` = 배포 시 명시한 공개 주소. World App 안에서 `window.location.origin` 은
  // 래퍼일 수 있고, 그 링크를 받은 상속인은 앱으로 못 갈 수 있다. 상속 절차의 유일한
  // 전달 수단이 이 링크이므로 배포 설정을 우선한다(config.ts 의 APP_ORIGIN 참고).
  const heirLink = vault ? `${APP_ORIGIN}/?vault=${vault}` : "";
  const heirMessage = vault && vaultHeir
    ? [
        `You are named as the heir of a ${wldSymbol} vault.`,
        ``,
        `Open this link in World App to see it: ${heirLink}`,
        ``,
        `What it means: if the person who named you stops renewing it, the countdown ends and nothing`,
        `moves before you file a claim. They then have a 7-day review window to renew and stop it.`,
        `After that, a new vault can transfer automatically; you can also finish in World App.`,
        `They can renew until the transfer executes. If you have not been contacted before that`,
        `point, nothing is owed to you yet.`,
        ``,
        `Vault: ${vault}`,
      ].join("\n")
    : "";

  /**
   * 상속인의 월드챗 유저네임.
   *
   * 컨트랙트에는 지갑 주소만 저장되므로 유저네임은(chain 에서) 되돌려야 한다.
   * 이게 있어야 월드챗으로 직접 보낼 수 있다 — 유저네임이 없으면 월드챗은
   * 주소로는 닿지 못하고 링크를 쓰는 방법밖에 없다.
   */
  const heirUsername = heirVaultUsername;

  const tellHeirInChat = async () => {
    if (!heirMessage) return;
    setShareBusy(true);
    const res = await sendWorldChat(heirMessage, heirUsername ? [heirUsername] : []);
    setShareBusy(false);
    if (res.delivered) {
      pushToast("success", "Sent in World Chat.");
    } else {
      // 월드챗은 월드앱 유저만 닿는다. 그 외에는 링크가 유일한 통로다.
      pushToast("error", "World Chat is not available for this recipient — send them the link below instead.");
    }
  };

  const copyToClipboard = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      pushToast("success", `${what} copied.`);
      return true;
    } catch {
      pushToast("error", "Could not copy — the text is shown on screen, select it manually.");
      return false;
    }
  };

  const copyHeirLink = () => (heirLink ? void copyToClipboard(heirLink, "Link") : undefined);
  const copyHeirMessage = () =>
    heirMessage ? void copyToClipboard(heirMessage, "Message") : undefined;

  /**
   * 월드앱 연락처에서 상속인을 고른다.
   *
   * 주소를 손으로 옮겨 적으면 한 글자만 틀려도 자기가 지정하지 않은 지갑이
   * 상속인이 된다. 연락처에서 고르면 지갑 주소가 함께 와서 그 위험이 없다.
   */
  const pickHeirFromContacts = async () => {
    setShareBusy(true);
    try {
      const picked = await pickWorldContacts(
        "Join me on an inheritance vault in World App.",
      );
      const first = picked?.[0];
      if (!first?.walletAddress) {
        // 월드앱 밖이거나 사용자가 취소했다. 주소를 직접 넣는 경로가 남는다.
        return;
      }
      onHeirInput(first.username ? `@${first.username}` : first.walletAddress);
    } finally {
      setShareBusy(false);
    }
  };

  // ---- discover vaults where current account is the heir (for heirs)
  const findHeirVaults = async () => {
    if (!factory || !account || findingHeirVaults) return;
    setFindingHeirVaults(true);
    setHeirFoundVaults([]);
    setHeirSearchNote("");
    setHeirScanIncomplete(false);
    try {
      const p = (signer?.provider as ethers.AbstractProvider | null) ?? provider;
      if (!p) throw new Error("Not connected. Please sign in and check again.");
      const sig = ethers.id("VaultCreated(address,address,address,uint256)");
      const heirTopic = ethers.zeroPadValue(ethers.getAddress(account), 32);
      const sources = [{ address: FACTORY_ADDRESS, block: FACTORY_DEPLOY_BLOCK }, ...(LEGACY_FACTORY_ADDRESS ? [{ address: LEGACY_FACTORY_ADDRESS, block: LEGACY_FACTORY_DEPLOY_BLOCK }] : []), ...YIELD_ROUTES.map(route => ({ address: route.factory, block: route.block }))];
      const indexed: string[] = [];
      let indexIncomplete = false;
      if (NOTIFY_BACKEND_ENABLED) {
        try {
          const { watchers, truncated } = await fetchRegisteredVaults(NOTIFY_BACKEND_URL);
          indexIncomplete = truncated;
          for (const row of watchers) {
            if (ethers.isAddress(row.vaultAddress) && typeof row.heirAddress === "string" && row.heirAddress.toLowerCase() === account.toLowerCase()) indexed.push(row.vaultAddress);
          }
        } catch { indexIncomplete = true; /* Recent events and shared links remain available. */ }
      }
      const logs = (await Promise.all(sources.map(source => safeGetLogs(p, {
        address: source.address,
        topics: [sig, null, heirTopic],
        fromBlock: source.block ?? undefined,
        toBlock: "latest",
      }, () => { indexIncomplete = true; })))).flat();
      const iface = new ethers.Interface(FACTORY_ABI);
      const candidates = new Set(indexed.map(v => ethers.getAddress(v)));
      for (const lg of logs) {
        try {
          const parsed = iface.parseLog({ topics: lg.topics, data: lg.data });
          const v = String(parsed?.args?.[2] || "");
          if (ethers.isAddress(v)) candidates.add(ethers.getAddress(v));
        } catch {
          // Skip malformed logs.
          void 0;
        }
      }
      const vaults = (await Promise.all([...candidates].map(async candidate => {
        try {
          const ctr = new ethers.Contract(candidate, [...VAULT_ABI, "function asset() view returns (address)", "function rewardToken() view returns (address)", "function strategy() view returns (address)"], p);
          const [currentHeir, currentFactory, owner] = await Promise.all([ctr.heir(), ctr.factory(), ctr.owner()]);
          const route = yieldRouteFor(currentFactory);
          if (currentHeir.toLowerCase() !== account.toLowerCase() || !sources.some(s => s.address.toLowerCase() === currentFactory.toLowerCase())) return null;
          const token = await ctr[route?.tokenGetter ?? "WLD"]();
          if (token.toLowerCase() !== (route?.asset ?? WLD_ADDRESS).toLowerCase()) return null;
          if (route) {
            if (String(await ctr.strategy()).toLowerCase() !== route.strategy.toLowerCase()
              || route.symbol === "USDC" && String(await ctr.rewardToken()).toLowerCase() !== WLD_ADDRESS.toLowerCase()) return null;
            return await new ethers.Contract(currentFactory, route.factoryAbi, p).knownVaults(candidate) ? candidate : null;
          }
          const canonical = await new ethers.Contract(currentFactory, FACTORY_ABI, p).vaultOf(owner);
          return canonical.toLowerCase() === candidate.toLowerCase() ? candidate : null;
        } catch { indexIncomplete = true; return null; }
      }))).filter((v): v is string => v !== null);
      setHeirFoundVaults(vaults);
      setHeirScanIncomplete(indexIncomplete);
      setHeirSearchNote(`${indexIncomplete ? "This vault search is incomplete. Please check again. " : NOTIFY_BACKEND_ENABLED ? "Checked registered vaults. " : "Checked recent vaults. "}For an older or unregistered vault, ask its owner for the vault link.`);
      // 찾은 상속인 금고를 `vault` 에 넣으면 안 된다. `vault` 는 "내가 소유한 금고" 를
      // 뜻하고, 여기서 오염시키면 (1) Create 버튼이 영구히 비활성화되고
      // (2) "You already have a vault" 라고 표시된다. 상속인 금고는 별도 상태로만
      // 보관하고, 상세 보기로는 vault 를 건드리지 않는다.
      if (vaults.length > 0) {
        pushToast(
          'success',
          vaults.length === 1
            ? 'Detected a vault where you are heir.'
            : `Detected ${vaults.length} vaults where you are heir.`,
        );
      } else {
        // The empty result remains visible in Help; automatic scans are quiet.
      }
    } catch (e: unknown) {
      setHeirScanIncomplete(true);
      setHeirSearchNote("This vault search is incomplete. Please check again, or open the vault link from its owner.");
      pushToast('error', 'Heir scan error: ' + errorText(e));
      console.error("findHeirVaults failed:", e);
    } finally {
      setFindingHeirVaults(false);
    }
  };

  /**
   * "내가 상속인으로 지정됐나" 카드.
   *
   * 자기 금고가 없는 사람에게는 첫 화면이어야 하고(상속인이 이 앱을 여는 이유다),
   * 자기 금고가 있는 사람에게도 보여야 한다 — 자기 금고가 있어도 남의 상속인이 될 수 있으므로.
   * 예전처럼 `!isMyVault` 로 숨기면 그 사람은 자기 금고만 관리하다가 평생
   * "누군가가 나를 상속인으로 지명했나" 를 알 방법이 없었다. 상속인 링크를 받아도
   * (a) 링크가 자기 금고로 덮이고 (b) 여기 카드가 없어서 신청 수단이 사라진다.
   * 두 곳에 쓰이므로 변수로 뺀다.
   */
  /**
   * 상속인 카드를 첫 화면에 내보낼 가치가 있는가.
   *
   * 진짜 상속인(누군가에게 지정됐다면)에게는 이 카드가 이 앱을 열 이유 그 자체다 — 자기
   * 금고가 없는데 상속 신청의 존재를 알아야 하기 때문이다. 그래서 결과가 있으면
   * 맨 위로 올린다.
   *
   * 반대로 아무것도 없는 사람에게는 질문할 이유가 없다. 화면에 "No vault names you as
   * heir" 가 남으면 "내가 뭘 놓치고 있나" 하는 불안을 만들고, 정작 해야 할 일
   * (금고 만들기)을 화면 아래로 민다.
   *
   * 스캔 중이거나 불완전하면 재확인할 수 있게 보인다. 완료된 빈 결과는 감춘다.
   */
  const notifyHeirWorthShowing = findingHeirVaults || heirScanIncomplete || heirFoundVaults.length > 0 || !heirScanAttempted;

  const heirStatusCard = gate2(
    <Card>
      <CardHeader><CardTitle>Are you named as someone&apos;s heir?</CardTitle></CardHeader>
      <CardContent className="grid gap-2">
        <div className="text-xs text-gray-600">
          We check registered vaults and recent chain events when you sign in. A shared
          vault link opens a vault directly.
        </div>
        {findingHeirVaults ? (
          <div className="text-xs text-gray-600">Checking the chain for vaults that name you…</div>
        ) : heirScanAttempted ? (
          heirFoundVaults.length > 0 ? (
            <>
              <div className="text-sm font-medium">
                You are the heir of {heirFoundVaults.length} vault{heirFoundVaults.length > 1 ? "s" : ""}.
              </div>
              <div className="text-xs text-gray-600">
                Open one to see whether the countdown has ended and whether you can file a claim.
                Nothing is owed to you until the countdown runs out and you file — see the Plan tab.
              </div>
              <div className="grid gap-2 text-xs">
                {heirFoundVaults.map((v) => (
                  <div key={v} className="flex items-center justify-between gap-2">
                    <span className="break-all">{short(v)}</span>
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={() => { setVault(v); setLinkedVault(v); }}>Open in app</Button>
                      <a className="text-blue-600 underline" href={`${EXPLORER}/address/${v}`} target="_blank" rel="noreferrer">Explorer</a>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-sm font-medium">{heirScanIncomplete ? "Some vaults could not be checked. Please try again." : "No vaults found in this check."}</div>
          )
        ) : null}
        {heirSearchNote && <div className="text-xs text-gray-600">{heirSearchNote}</div>}
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={findHeirVaults} disabled={pendingAction || findingHeirVaults}>
            {findingHeirVaults ? "Searching..." : "Check again"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  // ---- deposit WLD
  const deposit = async () => {
    if (!vault) return;
    if (hasPendingPlanDeposit(readStoredPlan(account) ?? pendingPlan, account, vaultFactory, vault)) {
      setStatus("Resume your saved setup in Inherit before adding more to this asset.");
      return;
    }
    if (!amountStr) { setStatus("Enter amount"); return; }
    if (!validDecimalInput(amountStr)) { setStatus("Enter a valid decimal amount"); return; }
    const amt = parseAmount(amountStr);
    if (amt <= 0n) { setStatus("Enter amount greater than 0"); return; }
    if (amt > walletWld) { setStatus("Amount exceeds wallet balance"); return; }
    try {
      if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
      const receipt = isYieldVault ? new ethers.Contract(selectedStrategyAddress, MORPHO_ABI, provider) : null;
      const token = new ethers.Contract(selectedAssetAddress, ERC20_ABI, provider);
      const [minShares, before] = await Promise.all([
        receipt ? receipt.previewDeposit(amt).then((shares: bigint) => minimumOutput(shares)) : Promise.resolve(0n),
        (receipt ?? token).balanceOf(vault),
      ]);
      // 순서가 의미를 갖는다: approve 가 먼저여야 deposit 의 transferFrom 이
      // 토큰을 꺼낼 수 있다. 월드앱은 승인 직후 자동으로 철회하므로 남은
      // allowance 가 없다는 오류가 나면 이 두 건의 순서를 확인한다.
      const sent = await sendWorldChainTx([
        {
          address: selectedAssetAddress,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [vaultFactory, amt.toString()],
        },
        {
          address: vaultFactory,
          abi: selectedFactoryAbi,
          functionName: isYieldVault ? "depositWithMinShares" : "deposit",
          args: isYieldVault ? [amt.toString(), minShares.toString()] : [amt.toString()],
        },
      ]);
      if (!sent.ok) {
        setStatus(sent.error);
        if (sent.userFacing) pushToast("error", sent.error);
        return;
      }
      setStatus("Pending… awaiting confirmation");
      const prov = getRwProvider();
      const txh = sent.tx.hash;
      await waitForTxOrEvent(prov, {
        txHash: txh,
        hashType: sent.tx.hashType,
        check: async () => {
          // Receipt count proves a yield deposit independently of price changes
          // and a cached value from a preceding withdrawal.
          const held: bigint = await (receipt ?? token).balanceOf(vault);
          return held > before;
        },
      });
      setStatus("Deposit complete");
      setAmountStr("");
      await refreshBalances();
      if (NOTIFY_BACKEND_ENABLED && isMyVault && vaultHeir && vaultHeir !== ethers.ZeroAddress
        && vaultHeir.toLowerCase() !== account.toLowerCase()) {
        void registerWatcher(vault, account, vaultHeir, true).catch(() => {
          pushToast("info", "Your deposit is confirmed. Monitoring could not be enabled; try again in Help.");
        });
      }
    } catch (e: unknown) {
      setStatus("Deposit error: " + errorText(e));
      pushToast('error', errorText(e));
    }
  };
  const setMax = () => setAmountStr(fmtUnits(walletWld, wldDecimals));
  const setPct = (pct: number) => {
    const amt = (walletWld * BigInt(pct)) / 100n;
    setAmountStr(fmtUnits(amt, wldDecimals));
  };

  // ---- life signals
  const extendTime = async () => {
    if (!vaultCtr) return;
    try {
      if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
      const sent = await sendWorldChainTx([{  address: vaultFactory, abi: FACTORY_ABI, functionName: "pingMyVault", args: []  }]);
      if (!sent.ok) {
        setStatus(sent.error);
        if (sent.userFacing) pushToast("error", sent.error);
        return;
      }
      setStatus("Pending… awaiting confirmation");
      const prevLp = vaultLastPing;
      const prov = getRwProvider();
      const txh = sent.tx.hash;
      await waitForTxOrEvent(prov, {
        txHash: txh,
        hashType: sent.tx.hashType,
        check: async () => {
          const lp: bigint = await vaultCtr.lastPing();
          return Number(lp) > (prevLp || 0);
        },
      });
      setStatus("Timer reset (full period restored)");
      // 액션이 체인 상태를 바꿨으므로 다시 읽는다. 이게 없으면 사용자가 자기 행동을 한 뒤에도
      // 화면이 이전 값("Last ping", "Heartbeat", "Expires") 을 보여준다.
      void refreshVaultDetails();
      refreshTimer();
    } catch (e: unknown) {
      setStatus("Reset error: " + errorText(e));
      pushToast('error', errorText(e));
    }
  };

  const checkInAllPlans = async (confirmClaimCancellation = false) => {
    if (!provider || !account || !miniInstalled) { setStatus("Open in World App and connect before checking in."); return; }
    if (ownedPlanRead.loading || ownedPlanRead.incomplete) { setStatus("Refresh every owned vault before checking in. No check-in was sent."); return; }
    if (activeOwnedPlans.length === 0) { setStatus("There are no active inheritance vaults to check in to."); return; }
    try {
      const targets = await Promise.all(activeOwnedPlans.map(async item => {
        const route = yieldRouteFor(item.factory);
        const identityRoute: AppPlanRoute = route ? {
          symbol: route.symbol, asset: route.asset, decimals: route.decimals, factory: route.factory,
          mode: "morpho", details: route,
        } : {
          symbol: "WLD", asset: WLD_ADDRESS, decimals: 18, factory: item.factory,
          mode: "plain", details: null,
        };
        const factoryAbi = route?.factoryAbi ?? FACTORY_ABI;
        const vaultAbi = route?.vaultAbi ?? VAULT_ABI;
        const identity = await readPlanVaultIdentity(identityRoute, account);
        if (!identity || identity.address.toLowerCase() !== item.address.toLowerCase()
          || identity.owner.toLowerCase() !== account.toLowerCase()
          || identity.heir.toLowerCase() !== item.heir.toLowerCase()
          || identity.periodSeconds !== item.periodSeconds || identity.claimedAt > 0n
          || identity.heir.toLowerCase() === account.toLowerCase() || identity.heir === ethers.ZeroAddress) {
          throw new Error(`${item.symbol} vault changed. Refresh the plan before checking in.`);
        }
        const claimFiledAt = BigInt(await new ethers.Contract(identity.address, vaultAbi, provider).claimFiledAt());
        return { ...item, route, identityRoute, factoryAbi, vaultAbi, beforePing: identity.lastPing, claimFiledAt };
      }));
      const pendingClaims = targets.filter(target => target.claimFiledAt > 0n);
      const fingerprint = [account.toLowerCase(), ...targets.map(target =>
        `${target.address.toLowerCase()}:${target.heir.toLowerCase()}:${target.periodSeconds}:${target.claimFiledAt}`).sort()].join("|");
      if (pendingClaims.length && (!confirmClaimCancellation || checkinReview?.fingerprint !== fingerprint)) {
        setCheckinReview({ fingerprint, claimCount: pendingClaims.length });
        return;
      }
      const sent = await sendWorldChainTx(targets.map(target => ({
        address: target.factory, abi: target.factoryAbi, functionName: "pingMyVault", args: [],
      })));
      if (!sent.ok) {
        setStatus(sent.error);
        if (sent.userFacing) pushToast("error", sent.error);
        return;
      }
      setStatus("Pending… verifying each check-in");
      const pingTimes = new Map<string, bigint>();
      await waitForTxOrEvent(getRwProvider(), {
        txHash: sent.tx.hash, hashType: sent.tx.hashType,
        verifyReceipt: receipt => {
          for (const log of receipt.logs) {
            const target = targets.find(item => item.address.toLowerCase() === log.address.toLowerCase());
            if (!target) continue;
            try {
              const parsed = PING_EVENT_IFACE.parseLog({ topics: [...log.topics], data: log.data });
              const timestamp = parsed ? BigInt(parsed.args.timestamp) : -1n;
              if (timestamp >= target.beforePing) pingTimes.set(target.address.toLowerCase(), timestamp);
            } catch { /* Ignore non-ping logs. */ }
          }
          return targets.every(target => pingTimes.has(target.address.toLowerCase()));
        },
        check: async () => {
          for (const target of targets) {
            const identity = await readPlanVaultIdentity(target.identityRoute, account);
            if (!identity || identity.address.toLowerCase() !== target.address.toLowerCase()
              || identity.owner.toLowerCase() !== account.toLowerCase()
              || identity.heir.toLowerCase() !== target.heir.toLowerCase()
              || identity.periodSeconds !== target.periodSeconds
              || identity.lastPing < (pingTimes.get(target.address.toLowerCase()) ?? 0n)) return false;
          }
          return true;
        },
      });
      setOwnedPlanRead(current => ({ ...current, items: current.items.map(item => {
        const timestamp = pingTimes.get(item.address.toLowerCase());
        return timestamp === undefined ? item : { ...item, lastPing: timestamp };
      }) }));
      setCheckinReview(null);
      setStatus(`Checked in to all ${targets.length} active vaults.`);
    } catch (error) {
      setStatus("Check-in error: " + errorText(error));
      pushToast("error", errorText(error));
    }
  };

  const changePeriod = async () => {
    if (!vaultCtr) return;
    if (!periodValid) { setStatus('Period must be between 1 and 365 days.'); return; }
    const seconds = BigInt(periodNum) * 24n * 60n * 60n;
    try {
      if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
      const sent = await sendWorldChainTx([{  address: vaultFactory, abi: FACTORY_ABI, functionName: "changeMyPeriod", args: [seconds.toString()]  }]);
      if (!sent.ok) {
        setStatus(sent.error);
        if (sent.userFacing) pushToast("error", sent.error);
        return;
      }
      setStatus("Pending… awaiting confirmation");
      const prov = getRwProvider();
      const txh = sent.tx.hash;
      await waitForTxOrEvent(prov, {
        txHash: txh,
        hashType: sent.tx.hashType,
        check: async () => {
          const hb: bigint = await vaultCtr.heartbeatInterval();
          return Number(hb) === Number(seconds);
        },
      });
      setStatus("Period updated");
      // 액션이 체인 상태를 바꿨으므로 다시 읽는다. 이게 없으면 사용자가 자기 행동을 한 뒤에도
      // 화면이 이전 값("Last ping", "Heartbeat", "Expires") 을 보여준다.
      void refreshVaultDetails();
      periodTouchedRef.current = false;
      refreshTimer();
    } catch (e: unknown) {
      setStatus("Change period error: " + errorText(e));
      pushToast('error', errorText(e));
    }
  };
  const cancelInheritance = async () => {
    if (!vaultCtr) return;
    try {
      if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
      const sent = await sendWorldChainTx([{  address: vaultFactory, abi: FACTORY_ABI, functionName: "cancelMyInheritance", args: []  }]);
      if (!sent.ok) {
        setStatus(sent.error);
        if (sent.userFacing) pushToast("error", sent.error);
        return;
      }
      setStatus("Pending… awaiting confirmation");
      const prov = getRwProvider();
      const txh = sent.tx.hash;
      await waitForTxOrEvent(prov, {
        txHash: txh,
        hashType: sent.tx.hashType,
        check: async () => {
          const h = await vaultCtr.heir();
          return h && h.toLowerCase() === vaultOwner.toLowerCase();
        },
      });
      setStatus("Inheritance cancelled (heir=owner)");
      // 액션이 체인 상태를 바꿨으므로 다시 읽는다. 이게 없으면 사용자가 자기 행동을 한 뒤에도
      // 화면이 이전 값("Last ping", "Heartbeat", "Expires") 을 보여준다.
      void refreshVaultDetails();
      refreshTimer();
    } catch (e: unknown) {
      setStatus("Cancel error: " + errorText(e));
      pushToast('error', errorText(e));

    }
  };

  const updateHeir = async () => {
    if (!vaultCtr) return;
    const resolved = newHeirResolved || await resolveHeirInput(newHeir);
    if (!resolved?.address) { setStatus("Enter a valid heir username or address"); return; }
    // 0x0 은 계약의 InvalidAddress 로 거절된다. `createVault` 에는 이 가드가 있는데
    // `updateHeir` 에는 없었고 — 버튼이 비활성이라 실제로는 닿기 어려운 경로지만,
    // 렌더가 한 박자 뒤처진 상황에서 0x0 이 들어가면 gas 를 태우고 실패한다.
    // 경고만 띄우고 진행하면 반드시 실패하는 트랜잭션이 만들어지므로 여기서 막는다.
    if (resolved.address === ethers.ZeroAddress) {
      setStatus("Heir cannot be the zero address");
      pushToast("error", "Heir cannot be the zero address");
      return;
    }
    try {
      if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
      const sent = await sendWorldChainTx([{  address: vaultFactory, abi: FACTORY_ABI, functionName: "updateMyHeir", args: [resolved.address]  }]);
      if (!sent.ok) {
        setStatus(sent.error);
        if (sent.userFacing) pushToast("error", sent.error);
        return;
      }
      setStatus("Pending… awaiting confirmation");
      const prov = getRwProvider();
      const txh = sent.tx.hash;
      const target = resolved.address;
      await waitForTxOrEvent(prov, {
        txHash: txh,
        hashType: sent.tx.hashType,
        check: async () => {
          const h = await vaultCtr.heir();
          return h && h.toLowerCase() === target.toLowerCase();
        },
      });
      setStatus("Heir updated");
      // 액션이 체인 상태를 바꿨으므로 다시 읽는다. 이게 없으면 사용자가 자기 행동을 한 뒤에도
      // 화면이 이전 값("Last ping", "Heartbeat", "Expires") 을 보여준다.
      void refreshVaultDetails();
      setNewHeir("");
      setNewHeirResolved(null);
      if (NOTIFY_BACKEND_ENABLED && account && vault) {
        try {
          await registerWatcher(vault, account, resolved.address, true);
        } catch {
          // Notification watcher registration is optional.
          void 0;
        }
      }
      refreshVaultDetails();
    } catch (e: unknown) {
      setStatus("Update heir error: " + errorText(e));
      pushToast('error', errorText(e));
    }
  };

  // ---- 1단계: 상속인이 상속을 신청한다. 자금은 아직 움직이지 않는다.
  //
  // 신청 자체는 이산적이고 되돌릴 필요가 없는 행위다. 그래도 다른 상속 흐름과
  // 같은 폴링/토스트/예외 처리를 거치도록 두 함수의 형태를 맞췄다 — 한쪽만
  // 관대해지면 나중에 버그가 숨을 곳이 된다.
  const fileClaim = async () => {
    if (!vault || !vaultCtr) return;
    try {
      if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
      const sent = await sendWorldChainTx([{  address: vaultFactory, abi: FACTORY_ABI, functionName: "fileClaimFor", args: [vault]  }]);
      if (!sent.ok) {
        setStatus(sent.error);
        if (sent.userFacing) pushToast("error", sent.error);
        return;
      }
      setStatus("Pending… awaiting claim confirmation");
      // 액션이 체인 상태를 바꿨으므로 다시 읽는다. 이게 없으면 사용자가 자기 행동을 한 뒤에도
      // 화면이 이전 값("Last ping", "Heartbeat", "Expires") 을 보여준다.
      void refreshVaultDetails();
      const prov = getRwProvider();
      const txh = sent.tx.hash;
      await waitForTxOrEvent(prov, {
        txHash: txh,
        hashType: sent.tx.hashType,
        check: async () => await vaultCtr.claimPending(),
      });
      setStatus("Claim confirmed. The seven-day review window has started.");
      void refreshVaultDetails();
      if (NOTIFY_BACKEND_ENABLED && vaultOwner && vaultHeir) {
        try { await registerWatcher(vault, vaultOwner, vaultHeir, true); }
        catch {
          if (notifyWatchScope.current === notifyWatchKey) setNotifyWatch({ key: notifyWatchKey, state: "not_registered" });
          pushToast("info", "Claim confirmed. Enable vault monitoring for automatic transfer and reminders.");
        }
      }
      pushToast('success', 'Claim filed');
      refreshTimer(); refreshBalances();
    } catch (e: unknown) {
      setStatus("Claim request error: " + errorText(e));
      pushToast('error', errorText(e));
    }
  };

  // ---- 2단계: 이의제기 기간이 지난 뒤 최종 수령. 자금이 실제로 이동한다.
  const claim = async () => {
    if (!vaultCtr || !vault) return;
    try {
      if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
      const sent = await sendWorldChainTx([{  address: vaultFactory, abi: FACTORY_ABI, functionName: "finalizeClaimFor", args: [vault]  }]);
      if (!sent.ok) {
        setStatus(sent.error);
        if (sent.userFacing) pushToast("error", sent.error);
        return;
      }
      setStatus("Pending… awaiting confirmation");
      const prev = vaultWld;
      const prov = getRwProvider();
      const txh = sent.tx.hash;
      await waitForTxOrEvent(prov, {
        txHash: txh,
        hashType: sent.tx.hashType,
        check: async () => {
          if (isYieldVault) return (await vaultCtr.claimedAt()) > 0n;
          const token = new ethers.Contract(selectedAssetAddress, ERC20_ABI, provider);
          const vb: bigint = await token.balanceOf(vault);
          // claim 은 금고를 0 으로 만든다. 잔액이 아직 로드되지 않은 경우
          // (prev === 0) `vb < prev` 는 절대 참이 될 수 없어 60초 폴링 후
          // 타임아웃으로 사용자에게 실패를 보고하게 된다. 0 도달 여부로 판정한다.
          return vb === 0n || vb < prev;
        },
      });
      setStatus("Claim complete");
      if (isYieldVault) setHeirFoundVaults(current => current.filter(address => address.toLowerCase() !== vault.toLowerCase()));
      // 액션이 체인 상태를 바꿨으므로 다시 읽는다. 이게 없으면 사용자가 자기 행동을 한 뒤에도
      // 화면이 이전 값("Last ping", "Heartbeat", "Expires") 을 보여준다.
      void refreshVaultDetails();
      refreshBalances(); refreshTimer();
    } catch (e: unknown) {
      setStatus("Claim error: " + errorText(e));
      pushToast('error', errorText(e));
    }
  };

  // Owner withdraw WLD (before expiry)
  const ownerWithdraw = async () => {
    if (!vaultCtr) return;
    if (!withdrawTo) { setStatus("Enter recipient address"); return; }
    if (!ethers.isAddress(withdrawTo)) { setStatus("Invalid recipient address"); return; }
    if (!withdrawAmountStr) { setStatus("Enter amount"); return; }
    if (!validDecimalInput(withdrawAmountStr)) { setStatus("Enter a valid decimal amount"); return; }
    const amt = parseAmount(withdrawAmountStr);
    if (amt <= 0n) { setStatus("Enter amount greater than 0"); return; }
    if (amt > vaultWldForWithdrawal) { setStatus("Amount exceeds vault balance"); return; }
    try {
      if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
      const fullExit = isYieldVault && selectedYieldPosition?.valued && amt === selectedYieldPosition.gross;
      const minNet = fullExit ? minimumOutput(selectedYieldPosition!.net) : 0n;
      const asset = new ethers.Contract(isYieldVault ? selectedStrategyAddress : selectedAssetAddress, ERC20_ABI, provider);
      const token = new ethers.Contract(selectedAssetAddress, ERC20_ABI, provider);
      const [before, beforeIdle]: [bigint, bigint] = await Promise.all([
        asset.balanceOf(vault), isYieldVault ? token.balanceOf(vault) : Promise.resolve(0n),
      ]);
      const sent = await sendWorldChainTx([{ address: vaultFactory, abi: selectedFactoryAbi,
        functionName: fullExit ? "withdrawAllFromMyVault" : "withdrawFromMyVault",
        args: [withdrawTo, (fullExit ? minNet : amt).toString()] }]);
      if (!sent.ok) {
        setStatus(sent.error);
        if (sent.userFacing) pushToast("error", sent.error);
        return;
      }
      setStatus("Pending… awaiting confirmation");
      const prov = getRwProvider();
      const txh = sent.tx.hash;
      await waitForTxOrEvent(prov, {
        txHash: txh,
        hashType: sent.tx.hashType,
        check: async () => {
          const held: bigint = await asset.balanceOf(vault);
          // Idle-only yield withdrawals do not burn receipt shares.
          return held < before || isYieldVault && await token.balanceOf(vault) < beforeIdle;
        },
      });
      setStatus("Withdraw complete");
      // 액션이 체인 상태를 바꿨으므로 다시 읽는다. 이게 없으면 사용자가 자기 행동을 한 뒤에도
      // 화면이 이전 값("Last ping", "Heartbeat", "Expires") 을 보여준다.
      void refreshVaultDetails();
      setWithdrawAmountStr("");
      await refreshBalances();
    } catch (e: unknown) {
      setStatus("Withdraw error: " + errorText(e));
      pushToast('error', errorText(e));
    }
  };

  const ownerWithdrawIncome = async () => {
    if (!provider || !account || !vault || !isMyVault || !identityMatchesVault) return;
    const selected = selectedIncome;
    if (!selected || selected.state !== "available" || !selected.valued || selected.withdrawableNet <= 0n) {
      setStatus("Separate income is unavailable for this vault. Refresh the income position before trying again.");
      return;
    }
    if (!incomeRecipientValid) { setStatus("Enter a valid income recipient address"); return; }
    if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast("error", "Open in World App"); return; }
    const snapshot = {
      vault, factory: vaultFactory, owner: account, to: ethers.getAddress(incomeTo),
      factoryAbi: optionalIncomeAbi(selectedFactoryAbi, INCOME_FACTORY_ABI),
      vaultAbi: optionalIncomeAbi(selectedVaultAbi, INCOME_VAULT_ABI), balanceScope,
    };
    const minNetAssets = minimumOutput(selected.withdrawableNet);
    try {
      const factoryContract = new ethers.Contract(snapshot.factory, snapshot.factoryAbi, provider);
      const vaultContract = new ethers.Contract(snapshot.vault, snapshot.vaultAbi, provider);
      const [canonical, owner, sourceFactory, before] = await Promise.all([
        factoryContract.vaultOf(snapshot.owner), vaultContract.owner(), vaultContract.factory(), vaultContract.incomePosition(),
      ]);
      if (String(canonical).toLowerCase() !== snapshot.vault.toLowerCase()
        || String(owner).toLowerCase() !== snapshot.owner.toLowerCase()
        || String(sourceFactory).toLowerCase() !== snapshot.factory.toLowerCase()
        || !before.valued || before.withdrawableNet < minNetAssets) {
        throw new Error("The owner, vault route or available income changed. Refresh before collecting.");
      }
      const sent = await sendWorldChainTx([{
        address: snapshot.factory, abi: snapshot.factoryAbi, functionName: "withdrawIncomeFromMyVault",
        args: [snapshot.to, minNetAssets.toString()],
      }]);
      if (!sent.ok) {
        setStatus(sent.error);
        if (sent.userFacing) pushToast("error", sent.error);
        return;
      }
      setStatus("Pending… verifying income collection");
      await waitForTxOrEvent(getRwProvider(), {
        txHash: sent.tx.hash,
        hashType: sent.tx.hashType,
        verifyReceipt: receipt => verifyIncomeWithdrawalReceipt(receipt, {
          vault: snapshot.vault, factory: snapshot.factory, to: snapshot.to, minNetAssets,
        }),
        check: async () => {
          const [mapped, currentOwner, currentFactory] = await Promise.all([
            factoryContract.vaultOf(snapshot.owner), vaultContract.owner(), vaultContract.factory(),
          ]);
          const currentPosition = await vaultContract.incomePosition();
          return snapshot.balanceScope === balanceScopeRef.current
            && String(mapped).toLowerCase() === snapshot.vault.toLowerCase()
            && String(currentOwner).toLowerCase() === snapshot.owner.toLowerCase()
            && String(currentFactory).toLowerCase() === snapshot.factory.toLowerCase()
            && Boolean(currentPosition.valued);
        },
      });
      setStatus("Income collected. Your principal remains in the inheritance vault.");
      await Promise.all([refreshIncome(), refreshBalances(), refreshIncomeHistory()]);
    } catch (error) {
      setStatus("Income collection error: " + errorText(error));
      pushToast("error", errorText(error));
    }
  };

  const setWithdrawMax = () => setWithdrawAmountStr(fmtUnits(vaultWldForWithdrawal, wldDecimals));

  const recoverArchivedYieldAssets = async () => {
    if (!isYieldVault || !vaultIdentity?.released || !isVaultOwner || !provider || !miniInstalled) return;
    const scope = balanceScopeRef.current;
    const selectedVault = vault, selectedFactory = vaultFactory;
    try {
      const child = new ethers.Contract(selectedVault, selectedVaultAbi, provider);
      if ((await child.owner()).toLowerCase() !== account.toLowerCase() || scope !== balanceScopeRef.current) return;
      const sent = await sendWorldChainTx([{ address: selectedFactory, abi: selectedFactoryAbi,
        functionName: "recoverArchivedVault", args: [selectedVault] }]);
      if (!sent.ok) {
        setStatus(sent.error);
        if (sent.userFacing) pushToast("error", sent.error);
        return;
      }
      setStatus("Pending… recovering archived assets");
      await waitForTxOrEvent(getRwProvider(), { txHash: sent.tx.hash, hashType: sent.tx.hashType,
        check: async () => !await child.hasAssets() });
      if (scope !== balanceScopeRef.current) return;
      setStatus("Archived assets settled. Late inheritance rewards go to the fixed recipient; other assets return to your wallet.");
      await Promise.all([refreshVaultDetails(), refreshBalances(), refreshTimer()]);
    } catch (error) {
      if (scope !== balanceScopeRef.current) return;
      setStatus("Archived recovery error: " + errorText(error));
      pushToast("error", errorText(error));
    }
  };
  const setWithdrawToMe = () => {
    if (account) setWithdrawTo(account);
    else if (vaultOwner) setWithdrawTo(vaultOwner);
  };

  const claimYieldRewards = async () => {
    if (!isYieldVault || !provider || !account || !miniInstalled) return;
    const scope = balanceScopeRef.current;
    const selectedVault = vault, selectedFactory = vaultFactory;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      // Refetch before signing. API totals may change, but no API may choose a
      // token, distributor, recipient or arbitrary transaction for the wallet.
      const published = await fetchWldRewards(selectedVault, controller.signal);
      if (scope !== balanceScopeRef.current) return;
      const contract = new ethers.Contract(selectedVault, selectedVaultAbi, provider);
      const receipt = new ethers.Contract(selectedStrategyAddress, MORPHO_ABI, provider);
      const [before, settledAt] = await Promise.all([contract.totalRewardsClaimed(), contract.claimedAt()]);
      const data = remainingWldRewards(published, before);
      if (data.claimable === 0n) throw new Error("No WLD rewards are ready to claim. Refresh after reward publication.");
      const minShares = settledAt === 0n && !isUsdcVault ? minimumOutput(await receipt.previewDeposit(data.claimable)) : 0n;
      if (scope !== balanceScopeRef.current) return;
      const sent = await sendWorldChainTx([{ address: selectedFactory, abi: selectedFactoryAbi,
        functionName: "claimRewardsFor", args: [selectedVault, data.cumulative.toString(), data.proof, minShares.toString()] }]);
      if (!sent.ok) { setStatus(sent.error); return; }
      await waitForTxOrEvent(getRwProvider(), { txHash: sent.tx.hash, hashType: sent.tx.hashType,
        check: async () => await contract.totalRewardsClaimed() > before });
      if (scope !== balanceScopeRef.current) return;
      setStatus(settledAt === 0n ? isUsdcVault ? "WLD rewards claimed and held in your USDC vault. Your USDC principal and timer are unchanged." : "WLD rewards claimed and reinvested. Your principal and timer are unchanged."
        : "Remaining rewards paid to the fixed inheritance recipient after the net-gain fee.");
      await Promise.all([refreshBalances(), refreshRewards()]);
    } catch (error) {
      if (scope === balanceScopeRef.current) { setStatus(errorText(error)); pushToast("error", errorText(error)); await refreshRewards(); }
    } finally { clearTimeout(timeout); }
  };

  const processReceivedYieldRewards = async () => {
    if (!isYieldVault || !provider || !account || !miniInstalled) return;
    const scope = balanceScopeRef.current;
    const selectedVault = vault, selectedFactory = vaultFactory;
    try {
      const contract = new ethers.Contract(selectedVault, selectedVaultAbi, provider);
      const [amount, settledAt] = await Promise.all([contract.unprocessedRewards(), contract.claimedAt()]);
      if (amount === 0n) throw new Error("No received WLD rewards remain to process. Refresh the balances.");
      const receipt = new ethers.Contract(selectedStrategyAddress, MORPHO_ABI, provider);
      const minShares = settledAt === 0n && !isUsdcVault ? minimumOutput(await receipt.previewDeposit(amount)) : 0n;
      if (scope !== balanceScopeRef.current) return;
      const sent = await sendWorldChainTx([{ address: selectedFactory, abi: selectedFactoryAbi,
        functionName: "processRewardsFor", args: [selectedVault, minShares.toString()] }]);
      if (!sent.ok) { setStatus(sent.error); return; }
      await waitForTxOrEvent(getRwProvider(), { txHash: sent.tx.hash, hashType: sent.tx.hashType,
        check: async () => await contract.unprocessedRewards() < amount });
      if (scope !== balanceScopeRef.current) return;
      setStatus(settledAt === 0n ? "Received WLD rewards reinvested. Your principal and timer are unchanged."
        : "Received rewards paid to the fixed inheritance recipient after the net-gain fee.");
      await Promise.all([refreshBalances(), refreshRewards()]);
    } catch (error) {
      if (scope === balanceScopeRef.current) { setStatus(errorText(error)); pushToast("error", errorText(error)); await refreshBalances(); }
    }
  };

  const exitYieldShares = async () => {
    if (!isYieldVault || !provider || !isMyVault) return;
    try {
      const receipt = new ethers.Contract(selectedStrategyAddress, MORPHO_ABI, provider);
      const shares: bigint = await receipt.balanceOf(vault);
      if (shares === 0n) throw new Error("This vault holds no receipt shares.");
      const sent = await sendWorldChainTx([{ address: vaultFactory, abi: selectedFactoryAbi,
        functionName: "withdrawSharesFromMyVault", args: [account, shares.toString()] }]);
      if (!sent.ok) { setStatus(sent.error); return; }
      await waitForTxOrEvent(getRwProvider(), { txHash: sent.tx.hash, hashType: sent.tx.hashType,
        check: async () => await receipt.balanceOf(vault) < shares });
      setStatus(`Receipt shares moved to your wallet. Any idle ${wldSymbol}${isUsdcVault ? " and WLD rewards" : ""} stay in the vault.`);
      await refreshBalances();
    } catch (error) { setStatus(errorText(error)); pushToast("error", errorText(error)); }
  };
  const withdrawUsdcRewards = async () => {
    if (!isUsdcVault || !provider || !isMyVault || !miniInstalled) return;
    const scope = balanceScopeRef.current;
    try {
      const token = new ethers.Contract(WLD_ADDRESS, ERC20_ABI, provider);
      const before: bigint = await token.balanceOf(vault);
      if (before === 0n) throw new Error("No held WLD remains in this vault.");
      const sent = await sendWorldChainTx([{ address: vaultFactory, abi: selectedFactoryAbi,
        functionName: "withdrawRewardsFromMyVault", args: [account] }]);
      if (!sent.ok) { setStatus(sent.error); return; }
      await waitForTxOrEvent(getRwProvider(), { txHash: sent.tx.hash, hashType: sent.tx.hashType,
        check: async () => await token.balanceOf(vault) < before });
      if (scope !== balanceScopeRef.current) return;
      setStatus("Held WLD paid to your wallet after the WLD reward fee. USDC principal and timer are unchanged.");
      await Promise.all([refreshBalances(), refreshRewards()]);
    } catch (error) { if (scope === balanceScopeRef.current) { setStatus(errorText(error)); pushToast("error", errorText(error)); } }
  };
  const redeemYieldShares = async (route: YieldRoute) => {
    if (!provider || !HAS_YIELD_ROUTES || !account || !miniInstalled) return;
    try {
      const receipt = new ethers.Contract(route.strategy, MORPHO_ABI, provider);
      const [held, available, cash] = await Promise.all([receipt.balanceOf(account), receipt.maxRedeem(account), receipt.maxWithdraw(account)]);
      const fullQuote: bigint = await receipt.previewRedeem(held);
      // maxRedeem can round down one share even when all quoted cash is liquid.
      // Redeeming the full holding in that case avoids a stranded receipt dust.
      const shares: bigint = held > 0n && fullQuote > 0n && fullQuote <= cash ? held : held < available ? held : available;
      if (shares === 0n) throw new Error("Cash liquidity is currently unavailable. Your receipt shares remain in your wallet.");
      const minAssets = minimumOutput(await receipt.previewRedeem(shares));
      const sent = await sendWorldChainTx([
        { address: route.strategy, abi: MORPHO_ABI, functionName: "approve", args: [route.factory, shares.toString()] },
        { address: route.factory, abi: route.factoryAbi, functionName: "redeemWalletShares", args: [shares.toString(), minAssets.toString()] },
      ]);
      if (!sent.ok) { setStatus(sent.error); return; }
      await waitForTxOrEvent(getRwProvider(), { txHash: sent.tx.hash, hashType: sent.tx.hashType,
        check: async () => await receipt.balanceOf(account) < held });
      setStatus(`Available receipt shares redeemed to ${route.symbol}. Remaining shares, if any, stay in your wallet.`);
      await refreshBalances();
    } catch (error) { setStatus(errorText(error)); pushToast("error", errorText(error)); }
  };

  const releaseSlot = async () => {
    if (!factory) return;
    setReleasing(true);
    let ok = false;
    try {
      if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
      const sent = await sendWorldChainTx([{  address: vaultFactory, abi: FACTORY_ABI, functionName: "releaseMyVault", args: []  }]);
      if (!sent.ok) {
        setStatus(sent.error);
        if (sent.userFacing) pushToast("error", sent.error);
        return;
      }
      setStatus("Pending… awaiting confirmation");
      const prov = getRwProvider();
      const txh = sent.tx.hash;
      await waitForTxOrEvent(prov, {
        txHash: txh,
        hashType: sent.tx.hashType,
        check: async () => {
          const selectedFactory = new ethers.Contract(vaultFactory, FACTORY_ABI, prov);
          const v = await selectedFactory.vaultOf(account);
          return !v || v === ethers.ZeroAddress;
        },
      });
      setStatus("Released. You can create a new vault.");
        /* 액션이 체인 상태를 바꿨으므로 다시 읽는다. 이게 없으면 사용자가 자기 행동을 한 뒤에도
           화면이 이전 값("Last ping", "Heartbeat", "Expires") 을 보여준다.

           그리고 `vaultOwner` 도 함께 지운다. 예전에는 `vault` 만 비웠는데, `isMyVault` 은
           `vaultOwner` 로 계산되므로(계정이 그 주소의 소유자인지) 낡은 소유자가 그대로 남았다.
           결과적으로 `isMyVault` 이 계속 true 였고, 금고 생성 폼이 `!isMyVault` 로 게이트돼
           있어 **해제에 성공했다는 안내 바로 아래에 폼이 아예 없었다.** 사용자는 성공 안내를
           읽고 빈 화면을 보게 되고, 새로고침해야 고쳐지는 걸 아무도 말해주지 않는다.
           말로 알리지 말고 고쳐야 하는 문제다.

           `refreshVaultDetails` 로는 정리되지 않는다: `vaultCtr` 이 null 이면 첫 줄에서
           반환하기 때문. 그래서 여기서 상태를 직접 비운다. */
      setVault("");
      setVaultIdentity(null);
      /* `canClaim` / `challengeRunning` / `awaitingClaim` 은 저장된 값이 아니라
         `vaultPhase` 에서 파생된다(별도 state 가 없다). 단계만 되돌리면 함께 초기화된다.
         존재하지 않는 setter 를 부르면 컴파일이 안 되므로 여기서 지킨다. */
      setVaultPhase("active");
      setCancelledFlag(false);
      setTimeRemaining(0);
      setChallengeEndsAt(0);
      setVaultBalanceRead({ scope: "", amount: 0n });
      setStale(false);
      await loadVault();
      ok = true;
    } catch (e: unknown) {
      setStatus("Release error: " + errorText(e));
      pushToast('error', errorText(e));
    } finally {
      setReleasing(false);
      // 실패했을 때 모달을 닫으면 오류 문맥이 사라지고 사용자는 이유를 알 수 없다.
      if (ok) {
        setShowReleaseConfirm(false);
        setReleaseAcknowledge(false);
      }
    }
  };

  /**
   * 정산된 금고에 늦게 들어온 잔액을 회수한다.
   *
   * 왜 이것이 필요한가: 상속인이 돈을 가져간 뒤에도 금고 주소는 살아 있다. 그때 와서
   * WLD 를 입금하면 잔액이 남는다. 계약에는 `ownerSweepAfterSettlement` 이 있어서 회수할
   * 수 있게 되었고, 팩토리 경유용 `sweepSettledVaultFor` 도 붙였다 — 그런데 **앱에는
   * 이 함수를 호출하는 코드가 아예 없었다.** 그 상태가 두 가지로 나빴다.
   *
   *   1. 피상속인이 "잔액이 0 이다" 는 사실을 믿고 아무것도 안 한다. 돈은 실제로 있고
   *      사용자는 꺼낼 방법이 없다. 입금 자체는 앱이 막지 않으니까 막다른 길이 생긴다.
   *   2. 상속이 끝났는데 잔액이 있다는 사실이 화면에 전혀 드러나지 않는다.
   *
   * 그래서 정산 상태에 잔액이 남아 있으면 반드시 이 버튼을 보여준다. 없으면 돈이 갇힌다.
   */
  const sweepSettled = async () => {
    if (!factory || !account) return;
    if (sweeping) return;
    setSweeping(true);
    try {
      if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
      const sent = await sendWorldChainTx([{  address: vaultFactory, abi: FACTORY_ABI, functionName: "sweepSettledVaultFor", args: [account]  }]);
      if (!sent.ok) {
        setStatus(sent.error);
        if (sent.userFacing) pushToast("error", sent.error);
        return;
      }
      setStatus("Pending… awaiting confirmation");
      const prev = vaultWld;
      const prov = getRwProvider();
      await waitForTxOrEvent(prov, {
        txHash: sent.tx.hash,
        hashType: sent.tx.hashType,
        check: async () => {
          if (isYieldVault) return !await new ethers.Contract(vault, selectedVaultAbi, provider).hasAssets();
          const token = new ethers.Contract(selectedAssetAddress, ERC20_ABI, provider);
          const now: bigint = await token.balanceOf(vault);
          return now < prev;
        },
      });
      setStatus("Swept the remaining balance to your address");
      void refreshVaultDetails();
      refreshBalances();
    } catch (e: unknown) {
      setStatus("Sweep error: " + errorText(e));
      pushToast('error', errorText(e));
    } finally {
      setSweeping(false);
    }
  };

  // ---- UI
  const copyText = async (text: string, field: "vault" | "owner" | "heir" | "wld") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(field);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setStatus("Failed to copy to clipboard");
    }
  };
  if (!account && !CONFIG_ERROR) {
    return <Landing installed={miniInstalled} busy={ctaLoading} onConnect={continueWorldApp2} linkedVault={linkedVault} status={status} />;
  }
  return (
    <div className="app-shell" lang={locale}>
      {/* 환경변수가 잘못되면 흰 화면 대신 복구 방법을 안내한다.
          (config.ts 는 import 시점에 throw 할 수 없다 — 그랬다면 이 화면조차
           렌더링되기 전에 앱이 죽는다) */}
      {CONFIG_ERROR && (
        <div className="container-narrow px-4 py-4">
          <Card>
            <CardHeader>
              <CardTitle>Configuration required</CardTitle>
            </CardHeader>
            <CardContent>
              <pre
                className="text-xs text-gray-700"
                style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
              >
                {CONFIG_ERROR}
              </pre>
            </CardContent>
          </Card>
        </div>
      )}
      <header className="app-header">
        <div className="container-narrow header-content">
          <Brand />
          <div className="landing-header-actions"><span className="network-pill"><span className="live-dot" />World Chain</span><LanguagePicker /></div>
        </div>
      </header>
      {/* 하단 탭 바가 fixed 이므로, 마지막 카드가 그 아래로 깔리지 않도록
          콘텐츠 쪽에 바 높이 + 여백만큼의 하단 패딩을 준다. */}
      <main id="main-content" className="container-narrow app-content tab-pb grid gap-4">
        {/* 헤더. 로그인 상태와 탭마다 반복되므로 카드 한 장을 쓰지 않고 한 줄로 줄인다.
            카드 4개(헤더/타이머/입금/고객센터)를 한 화면에 넣으려면 이게 전부 필요했다. */}
        <div className="account-row flex items-center justify-between gap-2">
          <div className="min-w-0">
            {account ? (
              <>
                <div className="text-sm font-semibold truncate">
                  {username ? `@${username}` : short(account)}
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-semibold">WLD Inheritance</div>
                <div className="text-xs text-gray-500">{t("home.account.connect")}</div>
              </>
            )}
          </div>
          {/* 서버 검증 여부를 숨기지 않는다. 서명이 서버에서 확인되지 않은
              세션으로는 자금을 다루는 행동을 하지 않도록 배지를 남긴다. */}
          {account && (!REQUIRE_VERIFY || verified) ? (
            <span className="text-xs text-gray-500 shrink-0">
              {serverVerified ? t("home.account.worldApp") : t("home.account.notVerified")}
            </span>
          ) : (
            <Button
              variant="primary"
              onClick={continueWorldApp2}
              disabled={pendingAction || ctaLoading}
              className="shrink-0"
            >
              {ctaLoading ? (<><span className="spinner mr-2"></span>{t("home.account.connecting")}</>) : t("home.account.connectButton")}
            </Button>
          )}
        </div>
        <div className="page-intro"><span className="eyebrow">{t(tab === "vault" ? "home.intro.vault" : tab === "money" ? "home.intro.money" : tab === "support" ? "home.intro.support" : "home.intro.inherit")}</span><h1 tabIndex={-1}>{t(tab === "vault" ? "home.title.vault" : tab === "money" ? "home.title.money" : tab === "support" ? "home.title.support" : ownVault ? "home.title.planWithVault" : "home.title.planWithoutVault")}</h1></div>
        {account && tab === "vault" && ownVault && <Card className="plan-overview-card">
          <CardHeader>
            <span className="eyebrow">{t("home.overview.eyebrow")}</span>
            <CardTitle>{t("home.overview.title")}</CardTitle>
            <p className="plan-card-intro">{t("home.overview.description")}</p>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="plan-overview-assets">
              {(["WLD", ...(USDC_ENABLED ? ["USDC"] : [])] as AssetSymbol[]).map(symbol => {
                const total = ownedPlanTotal(symbol);
                const decimals = symbol === "USDC" ? 6 : 18;
                const value = ownedPlanRead.loading ? t("home.value.updating") : total.amount === null ? t("home.value.unavailable")
                  : `${formatYieldAmount(total.amount, decimals)} ${symbol}`;
                return <div className="plan-overview-asset" key={symbol}>
                  <span>{symbol}</span><strong>{value}</strong>
                  <small>{ownedPlanRead.loading ? t("home.state.checking") : total.unavailable ? t("home.state.unavailable")
                    : total.rows.length ? t(total.rows.some(row => yieldRouteFor(row.factory)) ? "home.amount.yieldBeforeFee" : "home.amount.forHeir") : t("home.amount.notAdded")}</small>
                </div>;
              })}
            </div>
            {activeOwnedPlans.some(item => item.symbol === "USDC" && (item.additionalWld ?? 0n) > 0n)
              && <p className="text-xs text-gray-600">{t("home.additionalWld")}</p>}
            {ownedPlanRead.incomplete
              ? <p className="plan-settings-differ" role="status">{t("home.incomplete")}</p>
              : activeOwnedPlans.length > 0 ? commonPlanSettings
                ? <p className="plan-common-settings">{t("home.heir")} <strong title={activeOwnedPlans[0].heir}>{homeHeirUsername ? `@${homeHeirUsername}` : short(activeOwnedPlans[0].heir)}</strong><span>·</span> {t("home.checkin.every")} <strong>{activeOwnedPlans[0].period} {t("home.days")}</strong></p>
                : <p className="plan-settings-differ">{t("home.settingsDiffer")}</p>
                : <p className="text-sm text-gray-600">{t("home.noActivePlan")}</p>}
            {nextCheckIn !== null && <div className="home-checkin-date">
              <span>{chainNow > 0 && nextCheckIn <= chainNow ? t("home.checkin.overdue") : t("home.checkin.next")}</span>
              <strong>{new Date(nextCheckIn * 1000).toLocaleDateString(locale === "ko" ? "ko-KR" : "en", { year: "numeric", month: "short", day: "numeric" })}</strong>
              {chainNow > 0 && nextCheckIn <= chainNow && <small>{t("home.checkin.hint")}</small>}
            </div>}
            {activeOwnedPlans.length > 0 && !checkinReview && <Button variant="primary" disabled={pendingAction || !miniInstalled || ownedPlanRead.loading || ownedPlanRead.incomplete}
              onClick={() => void runWalletAction(() => checkInAllPlans())}>{t("home.checkin.direct")}</Button>}
            {checkinReview && <section className="checkin-review" aria-labelledby="checkin-review-title">
              <h3 id="checkin-review-title">{t("home.checkin.title")}</h3>
              <p>{t("home.checkin.claimBody", { count: checkinReview.claimCount })}</p>
              <ul>{activeOwnedPlans.map(item => <li key={item.address}>
                <strong>{item.symbol}</strong> · {formatPlanInterval(item.periodSeconds)}
                <span>{item.lastPing ? t("home.checkin.last", { date: new Date(Number(item.lastPing) * 1000).toLocaleDateString(locale === "ko" ? "ko-KR" : "en") }) : t("home.checkin.notAvailable")}</span>
              </li>)}</ul>
              <details className="checkin-addresses"><summary>{t("home.checkin.accounts")}</summary>
                {activeOwnedPlans.map(item => <p key={item.address}>{item.symbol} · {short(item.address)}</p>)}
              </details>
              <div className="flex gap-2 flex-wrap">
                <Button variant="primary" disabled={pendingAction || !miniInstalled || ownedPlanRead.loading || ownedPlanRead.incomplete}
                  onClick={() => void runWalletAction(() => checkInAllPlans(true))}>{t("home.checkin.cancelClaims")}</Button>
                <Button disabled={pendingAction} onClick={() => setCheckinReview(null)}>{t("home.checkin.cancel")}</Button>
              </div>
            </section>}

            {NOTIFY_BACKEND_ENABLED && activeOwnedPlans.length > 0
              && (["WLD", "USDC"] as AssetSymbol[]).some(symbol => (ownedPlanTotal(symbol).amount ?? 0n) > 0n) && (
              <div className="plan-overview-reminders text-xs text-gray-600" role="status">
                <span>{notifyPermission === "granted" ? t("home.reminders.on")
                  : notifyPermission === "denied" ? t("home.reminders.off") : t("home.reminders.checking")}</span>
                <div className="flex gap-2 flex-wrap">
                  {notifyPermission !== "granted" && <Button size="sm" variant="ghost" disabled={pendingAction || !miniInstalled || notifyBusy} onClick={requestNotifyPermission}>
                    {notifyBusy ? t("home.reminders.working") : t("home.reminders.enable")}
                  </Button>}
                </div>
                <details><summary>{t("home.reminders.preferences")}</summary><p>{t("home.reminders.heirPermission")}</p>
                  <Button size="sm" variant="ghost" onClick={() => { navigationChosenFor.current = account.toLowerCase(); setTab("support"); }}>{t("home.reminders.settings")}</Button>
                </details>
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" disabled={pendingAction} onClick={() => { navigationChosenFor.current = account.toLowerCase(); setVault(ownVault); setLinkedVault(""); setTab("money"); }}>{t("home.assetsIncome")}</Button>
              <Button variant="ghost" onClick={() => { navigationChosenFor.current = account.toLowerCase(); setTab("inherit"); }}>{t("home.updatePlan")}</Button>
            </div>
          </CardContent>
        </Card>}
        {HAS_YIELD_ROUTES && account && vaultLookupIncomplete && <div role="status" className="text-xs text-yellow-800 bg-yellow-50 border border-yellow-200 rounded py-2 px-3">
          Some vault registries could not be refreshed. Previously found vaults stay visible; their availability may be out of date. We will retry automatically.
          <Button size="sm" variant="ghost" disabled={pendingAction} onClick={() => void loadVault()}>Retry vault lookup</Button>
        </div>}
        {account && ownedVaults.length > 0 && ["money", "inherit"].includes(tab) && <AssetNavigation
          accounts={assetAccounts} selected={vault} busy={pendingAction}
          onSelect={item => { setOwnVault(item.address); setVault(item.address); setLinkedVault(""); }} />}
        {isYieldVault && vaultIdentity?.released && <p role="status" className="text-xs text-gray-600">
          {t("home.archived.note")}
        </p>}
        {isYieldVault && vaultIdentity?.released && isVaultOwner && vaultHasAssets && ["vault", "money", "inherit"].includes(tab) && <Card>
          <CardHeader><CardTitle>Recover archived assets</CardTitle></CardHeader><CardContent className="grid gap-2">
            <p>Return this archived vault’s idle {wldSymbol}, receipt shares{isUsdcVault ? " and other WLD" : ""} to your wallet. Your current vault stays separate. Any positive net gain pays the same 10% service fee.</p>
            <p className="text-xs text-gray-600">{isSettledClaim
              ? "Inheritance has completed. Only other assets received here can be recovered; late campaign rewards still go to the fixed inheritance recipient."
              : "This renews the archived timer and cancels any pending inheritance claim. It works without Morpho cash liquidity; you can redeem wallet-held shares as liquidity permits."}</p>
            <Button variant="primary" disabled={pendingAction || !miniInstalled || !identityMatchesVault} onClick={() => void runVaultAction(recoverArchivedYieldAssets)}>Recover archived assets to me</Button>
          </CardContent></Card>}
        {HAS_YIELD_ROUTES && yieldReadError?.scope === balanceScope && yieldReadError.failed && <div role="status" className="text-xs text-yellow-800 bg-yellow-50 border border-yellow-200 rounded py-2 px-3">
          Some Morpho balances could not be refreshed. The last available values may be out of date.
          <Button size="sm" variant="ghost" disabled={pendingAction} onClick={() => void refreshBalances()}>Refresh yield balances</Button>
        </div>}
        {isYieldVault && (!isSettledClaim || vaultHasAssets) && (tab === "inherit" && !isMyVault) && <YieldPositionCard
          route={selectedYieldRoute} rates={yieldRates} ratesLoading={yieldRatesLoading}
          position={selectedYieldPosition} holdings={selectedYieldHoldings} terms={yieldTerms} canExit={isMyVault && !isSettledClaim && (!isExpiredOrLater || inheritanceCancelled)}
          busy={pendingAction} onExit={() => void runVaultAction(exitYieldShares)} />}
        {isMyVault && tab === "money" && <IncomePositionCard key={`income:${balanceScope}`}
          state={selectedIncome?.state ?? "loading"}
          position={selectedIncome?.state === "available" ? selectedIncome : null}
          symbol={wldSymbol as "WLD" | "USDC"} decimals={wldDecimals} to={incomeTo} recipientValid={incomeRecipientValid}
          canCollect={Boolean(miniInstalled && selectedIncome?.state === "available" && selectedIncome.valued
            && incomeRecipientValid && !isSettledClaim && (!isExpiredOrLater || inheritanceCancelled))}
          busy={pendingAction} onToChange={setIncomeTo} onCollect={() => void runVaultAction(ownerWithdrawIncome)}
          account={account}
          disabledReason={!miniInstalled ? t("income.openWorldApp")
            : isSettledClaim ? t("income.inheritanceComplete")
          : isExpiredOrLater && !inheritanceCancelled ? t("income.checkInBeforeCollect")
            : ""}
          onRefresh={() => { void refreshIncome(); void refreshIncomeHistory(); }}
          onUseMyAddress={() => setIncomeTo(account)} />}
        {isVaultOwner && identityMatchesVault && tab === "money" && <IncomeHistoryCard
          data={selectedIncomeHistory}
          symbol={wldSymbol as "WLD" | "USDC"}
          decimals={wldDecimals}
          busy={pendingAction}
          onRefresh={() => void refreshIncomeHistory()}
          onLoadOlder={() => void refreshIncomeHistory("older")} />}
        {isYieldVault && (tab === "inherit" && !isMyVault || tab === "money" && hasRewardAction) && <YieldRewardsCard
          usdc={isUsdcVault} held={heldRewardCash?.scope === balanceScope ? heldRewardCash.amount : null}
          canWithdraw={isMyVault && !isSettledClaim && (!isExpiredOrLater || inheritanceCancelled)} onWithdraw={() => void runVaultAction(withdrawUsdcRewards)}
          data={selectedRewards?.data ?? null} error={selectedRewards?.error ?? ""} loading={selectedRewards?.loading ?? true}
          received={selectedReceivedRewards} onProcess={() => void runVaultAction(processReceivedYieldRewards)}
          settled={isSettledClaim} recipient={yieldRecipient?.vault.toLowerCase() === vault.toLowerCase() ? yieldRecipient.address : ""}
          busy={pendingAction} canClaim={miniInstalled && Boolean(account) && identityMatchesVault}
          onClaim={() => void runVaultAction(claimYieldRewards)} onRefresh={() => { void refreshRewards(); void refreshBalances(); }} />}
        {PRIMARY_YIELD_ROUTES.filter(route => walletYieldShares(route) > 0n).map(route => ["money", "inherit", "support"].includes(tab) && <Card key={route.factory}>
          <CardHeader><CardTitle>Receipt shares in your wallet · {route.symbol}</CardTitle></CardHeader><CardContent className="grid gap-2">
            <p>{formatYieldAmount(walletYieldShares(route))} Re7 {route.symbol} shares</p>
            <p className="text-xs text-gray-600">These shares belong to your wallet. Redeem as much as current Morpho cash liquidity allows. Inheritance and vault exits have already paid their service fee; this redemption charges no additional service fee.</p>
            <Button disabled={pendingAction || !miniInstalled} onClick={() => void runWalletAction(() => redeemYieldShares(route))}>Redeem available shares to {route.symbol}</Button>
            <Button disabled={pendingAction} onClick={() => void refreshBalances()}>Refresh receipt shares</Button>
          </CardContent></Card>)}

        {/* 연결이 끊기면 화면이 멈춘다. 예전에는 여기에 아무 표시가 없어서 사용자가
            "내 갱신이 반영되지 않았다", 혹은 더 나쁘게 "내 돈이 사라졌다" 고 읽었다.
            온체인 상태는 그대로인데 화면만 멈춘 것임을 분명히 해야 한다. */}
        {!stale && account && (
          <div
            className="text-xs text-yellow-800 bg-yellow-50 border border-yellow-200 rounded py-2 px-3"
            role="status"
            aria-live="polite"
          >
            {t("home.disconnected")}
          </div>
        )}

        {/* 8개 트랜잭션 플로우 전부의 결과/오류 채널.
            스크린 리더 사용자에게 읽히도록 live region 이 필요하다. */}
        {status && (
          <div className="text-xs text-gray-600" role="status" aria-live="polite" aria-atomic="true">
            {localizeAppMessage(locale, status)}
          </div>
        )}

        {/* ===== Send 탭: 자금 흐름 ===== */}
        {tab === "money" && vault && gate2(
          <Card className="asset-money-card">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>{wldSymbol} balance</CardTitle>
                <div className="flex items-center gap-2">
                  {account && vaultOwner && account.toLowerCase() === vaultOwner.toLowerCase() && badge("Owner", "blue")}
                  {account && vaultHeir && account.toLowerCase() === vaultHeir.toLowerCase() && badge("Heir", "purple")}
                  {(() => {
                    if (vaultHeir && vaultOwner && vaultHeir.toLowerCase() === vaultOwner.toLowerCase()) return badge("Inheritance cancelled", "yellow");
                    if (canClaim) return badge("Claimable", "green");
                    /* "갱신하라" 는 **소유자에게만** 줄 수 있는 지시다. 상속인에게는 갱신
                       권한이 없고, 주인이도 상속인도 아닌 타인에게는 더더욱 없다. 예전에는
                       주인을 따지지 않아 타인 화면에 "Renew urgently" 가 떴고, 그건 아무도
                       실행할 수 없는 거래를 재촉하는 셈이었다. */
                    if (timerUrgency === "timer-critical") {
                      return isMyVault
                        ? badge("Renew urgently", "yellow")
                        : iAmHeir
                          ? badge("Waiting on the owner", "yellow")
                          : badge("Countdown running", "gray");
                    }
                    if (timerUrgency === "timer-urgent") {
                      return isMyVault
                        ? badge("Renew soon", "yellow")
                        : iAmHeir
                          ? badge("Waiting on the owner", "gray")
                          : badge("Countdown running", "gray");
                    }
                    return badge("Active", "gray");
                  })()}
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              {!isVaultOwner && vaultOwner && <p className="shared-asset-note" role="status">
                This balance belongs to {short(vaultOwner)}.
                {iAmHeir ? " You are the named heir; open Plan to follow its inheritance." : " You cannot deposit or withdraw from this shared plan."}
              </p>}
                {/* 이 탭의 질문은 "내 지갑에 얼마가 있고, 금고에 얼마가 들어갔는가" 다.
                    메타데이터(누가/언제/어느 체인)가 그 앞에 오는 동안 화면은 이 질문에
                    답하지 않았다. 두 숫자를 카드로 올려 화면이 답하게 한다. */}
                <div className="stat-row">
                  <div className="stat">
                    <div className="stat-label">{t("assets.wallet")}</div>
                    <div className="stat-value">{walletBalanceKnown ? `${formatYieldAmount(walletWld, wldDecimals)} ${wldSymbol}` : "Updating…"}</div>
                  </div>
                  <div className="stat">
                    <div className="stat-label">{t(isYieldVault ? "assets.valueBeforeFee" : "assets.plan")}</div>
                    <div className="stat-value">{isYieldVault ? selectedYieldPosition?.valued ? `${formatYieldAmount(vaultWld, wldDecimals)} ${wldSymbol}` : "Value unavailable" : `${fmtUnits(vaultWld)} ${wldSymbol}`}</div>
                  </div>
                </div>
              {isMyVault && (
                <>
                  <div className="field-row">
                    <label className="field-row-label" htmlFor="deposit-amount">Amount to deposit ({wldSymbol})</label>
                    <div className="field-row-controls">
                      <Input id="deposit-amount" inputMode="decimal" placeholder="0.0"
                        value={amountStr} onChange={e => setAmountStr(e.target.value)} />
                    </div>
                  </div>
                  <div className="deposit-actions">
                    <p className="deposit-availability">{walletBalanceKnown ? `Available: ${formatYieldAmount(walletWld, wldDecimals)} ${wldSymbol}` : "Checking wallet balance…"}</p>
                    <div className="deposit-percentages">
                    <Button variant="ghost" onClick={() => setPct(25)}>25%</Button>
                    <Button variant="ghost" onClick={() => setPct(50)}>50%</Button>
                    <Button variant="ghost" onClick={() => setPct(75)}>75%</Button>
                    <Button variant="ghost" onClick={setMax}>Max</Button>
                    </div>
                    <Button
                      variant="primary"
                      className="deposit-primary"
                      onClick={() => void runVaultAction(deposit)}
                      disabled={pendingAction || !miniInstalled || !account || isExpiredOrLater || pendingDeposit || !depositEntryValid}
                    >
                      Deposit
                    </Button>
                    <Button variant="ghost" onClick={refreshBalances}>Refresh balance</Button>
                  </div>
                  {depositAmount === null && <p className="text-xs text-red-700" role="alert">Enter a valid {wldSymbol} amount with up to {wldDecimals} decimal places.</p>}
                  {walletBalanceKnown && depositAmount !== null && depositAmount > walletWld && <p className="text-xs text-red-700" role="alert">This amount is above your available {wldSymbol} balance.</p>}
                  {pendingDeposit && <p className="text-xs text-gray-600" role="status">
                    Resume your saved setup in Plan before adding more to this asset.
                  </p>}
                </>
              )}
              {/* 정산된 금고에서 입금을 막는다. 계약을 막을 수는 없다 — 누군가 주소로
                  직접 보낼 수 있으므로 sweep 이 여전히 필요하다 — 하지만 앱이 직접
                  권하는 일은 하지 않는다. 잔액이 남으면 "비어 있다" 는 표시가 거짓이 되고
                  사용자는 해제 수단까지 찾아내야 한다. */}
              {isSettledClaim && (
                <div className="text-xs text-gray-600">
                  {vaultIdentity?.released
                    ? "This archived vault is closed. Claimable campaign rewards still go to its fixed inheritance recipient. Use a current vault for new deposits."
                    : "This vault is closed, so deposits are turned off here — create a new vault first. If you already sent funds to this vault address, the owner can sweep them from Plan."}
                </div>
              )}
              {/* 마감 이후에도 입금을 막는다. 상속인이 이미 수령할 수 있는 상태에서
                  입금하면 그 돈까지 상속인이 가져간다. 실제로 5 WLD 위에 10 WLD 를
                  입금하고 상속인이 15 WLD 전부를 가져간 경우가 있었다. 화면에는
                  "Claimable" 배지와 활성화된 입금 폼만 있었다. 막되 **왜** 막는지
                  말하지 않으면 사용자는 버그로 여긴다. */}
              {!isSettledClaim && isExpiredOrLater && (
                <div className="text-xs text-yellow-800 bg-yellow-50 border border-yellow-200 rounded py-2 px-3">
                  {inheritanceCancelled
                    /* 상속인이 없다(heir == owner). "당신의 상속인이 가져간다" 는 이
                       자리에서 명제가 아니다 — 유일한 당사자는 읽는 사람 자신이고,
                       꺼낼 방법도 있으므로 위험이 아니다. */
                    ? "This vault's inheritance is cancelled, so nothing is inheriting it. Deposits are turned off because a cancelled vault is finished — withdraw what is here, or release your slot."
                    : !isMyVault
                      /* 소유자 전용 지시다. "당신의 상속인이 가져간다", "Deposit only into
                         a fresh vault" 를 상속인이나 타인에게 말하면 그들이 할 수 있는 일이
                         아니다. 사실을 말하되 지시하지 않는다. */
                      ? "The countdown has ended, so deposits are turned off for this vault."
                      : "Your plan is overdue, so deposits are paused. Check in before inheritance executes to renew it. Your heir must file a claim and wait through the review before funds can move."}
                </div>
              )}
              <div className="text-xs text-gray-500">
                Deposit {wldSymbol} on World Chain (480) using this app. {isUsdcVault ? "WLD campaign rewards are handled separately. " : ""}Do not send ETH or unrelated tokens. Review any transaction fees shown by World App.
              </div>

              {isMyVault && (
                <>
                <details className="principal-controls"><summary>Withdraw principal</summary><div className="space-y-2">
                  <div className="text-xs text-gray-500">
                    {/* 제목이 지시하는 조건이 두 개다. 계약의 `ownerMayWithdraw` 는
                        `!ownerStillActive() && !inheritanceCancelled()` 일 때만 막으므로
                        취소된 금고에서는 만료 후에도 회수할 수 있다 — 그것이 **유일한**
                        출구다(잔액이 남아 있으면 슬롯 해제도 안 된다). 예전에는
                        `isExpiredOrLater` 로만 막아서, 취소된 금고에 돈이 남으면
                        " withdraw it" 라고 말하면서 버튼은 비활성이었고 sweep 도
                        없었다(계약이 `claimedAt == 0` 이므로 sweep 도 불가능).
                        그 상태에서 사용자는 앱을 나가지 않는 한 자금을 꺼낼 수 없다. */}
                    {inheritanceCancelled
                      ? "Withdraw principal (inheritance was cancelled — this stays yours)"
                      : "Withdraw principal (before the countdown ends)"}
                  </div>
                  <div className="field-row">
                    <label className="field-row-label" htmlFor="withdraw-to">Send withdrawn {wldSymbol} to</label>
                    <div className="field-row-controls">
                      <Input id="withdraw-to" placeholder="0x..." value={withdrawTo} onChange={e => setWithdrawTo(e.target.value)} />
                      <Button onClick={setWithdrawToMe}>My address</Button>
                    </div>
                  </div>
                  {withdrawTo && !ethers.isAddress(withdrawTo) && (
                    <div className="text-xs text-red-600">Invalid recipient address.</div>
                  )}
                  <div className="field-row">
                    <label className="field-row-label" htmlFor="withdraw-amount">Principal amount to withdraw</label>
                    <div className="field-row-controls">
                      <Input id="withdraw-amount" inputMode="decimal" placeholder="0.0"
                        value={withdrawAmountStr} onChange={e => setWithdrawAmountStr(e.target.value)} />
                      <Button onClick={setWithdrawMax}>All</Button>
                      {/* 라벨이 실제 수신자를 말한다. 예전엔 "Withdraw to myself" 가
                          고정이었는데, 수금처 필드에 다른 주소를 넣으면 **그 주소로** 나간다.
                          라벨과 동작이 다르면 돈이 엉뚱한 곳으로 간다. (파일 복원 과정에서
                          이 수정이 되돌아간 적이 있다 — 되살려 둔다.) */}
                      <Button onClick={() => void runVaultAction(ownerWithdraw)} disabled={pendingAction || isExpiredOrLater && !inheritanceCancelled}>
                        {withdrawTo && account && withdrawTo.toLowerCase() === account.toLowerCase()
                          ? "Withdraw to myself"
                          : withdrawTo
                            ? `Withdraw to ${short(withdrawTo)}`
                            : "Withdraw"}
                      </Button>
                    </div>
                  </div>
                  {isYieldVault && <p className="text-xs text-gray-600">This changes principal. A Morpho exit charges 10% on realized positive income; cash withdrawals depend on liquidity, and receipt shares can be moved instead.{isUsdcVault && " A full exit also sends held WLD to this recipient after the separate WLD reward fee."}</p>}
                  </div></details>
                </>
              )}
              <details className="money-metadata"><summary>Account details &amp; activity</summary><div className="text-sm grid gap-1">
                <div className="flex items-center gap-2">
                  <div>Owner:</div>
                  <div>
                    <b>
                      {/* 여기서 로그인한 사람의 username 을 쓰면 안 된다. 상속인이 이 탭을
                          열면 자기 이름이 "Owner" 옆에 찍히고, 자기 주소가 "Heir" 옆에 찍힌다.
                          화면이 사용자에게 "당신이 이 금고의 주인이다" 라고 말하는 셈이라
                          상속인이 자기 금고로 오인하고 행동까지 미끄러뜨릴 수 있다.
                          username 은 **내가 이 금고의 주인일 때만** 예외적으로 쓴다. */}
                      {isMyVault && username
                        ? `@${username}`
                        : vaultOwner
                          ? short(vaultOwner)
                          : "-"}
                    </b>
                    {!isMyVault && vaultOwner && (
                      <span className="text-xs text-gray-500"> (not you)</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div>Heir:</div>
                  {/* 정산이 끝나면 계약이 heir 를 0x0 으로 지운다. 그래서 이 자리가
                      "Heir: 0x0000…0000" 이 되는데, 사람처럼 보이는 주소라
                      "누군가의 금고" 로 읽힌다. 상태를 말하는 게 아니라 이 앱의
                      목적을 말해야 한다. 상속 취소(heir == owner)도 같은 취급. */}
                  <div>
                    <b>
                      {!vaultHeir
                        ? "Checking vault identity…"
                        : vaultHeir === ethers.ZeroAddress
                          ? "nobody — the inheritance has already completed"
                        : vaultOwner && vaultHeir.toLowerCase() === vaultOwner.toLowerCase()
                          ? "nobody — inheritance was cancelled"
                          : short(vaultHeir)}
                    </b>
                  </div>
                </div>
                <div className="text-xs">
                  <button
                    type="button"
                    className="underline"
                    aria-expanded={showAdvanced}
                    aria-controls="advanced-details"
                    onClick={() => setShowAdvanced(v => !v)}
                  >
                    {showAdvanced ? 'Hide details' : 'Show addresses & explorer links'}
                  </button>
                </div>
                {showAdvanced && (
                  <div id="advanced-details" className="grid gap-1 text-xs">
                    <div>
                      Vault:
                      {vault ? (
                        <>
                          <button className="ml-1 underline text-blue-700 break-all" onClick={() => copyText(vault, "vault")}>{short(vault)}</button>
                          {copied === "vault" && <span className="ml-2 text-green-700">Copied</span>}
                          {vault && <a className="ml-2 text-blue-600 underline" href={`${EXPLORER}/address/${vault}`} target="_blank" rel="noreferrer">View</a>}
                        </>
                      ) : <b className="break-all">-</b>}
                    </div>
                    <div>
                      Owner:
                      {vaultOwner ? (
                        <>
                          <button className="ml-1 underline text-blue-700 break-all" onClick={() => copyText(vaultOwner, "owner")}>{short(vaultOwner)}</button>
                          {copied === "owner" && <span className="ml-2 text-green-700">Copied</span>}
                          {vaultOwner && <a className="ml-2 text-blue-600 underline" href={`${EXPLORER}/address/${vaultOwner}`} target="_blank" rel="noreferrer">View</a>}
                        </>
                      ) : <b className="break-all">-</b>}
                    </div>
                    <div>
                      Heir:
                      {vaultHeir ? (
                        <>
                          <button className="ml-1 underline text-blue-700 break-all" onClick={() => copyText(vaultHeir, "heir")}>{short(vaultHeir)}</button>
                          {copied === "heir" && <span className="ml-2 text-green-700">Copied</span>}
                          {vaultHeir && <a className="ml-2 text-blue-600 underline" href={`${EXPLORER}/address/${vaultHeir}`} target="_blank" rel="noreferrer">View</a>}
                        </>
                      ) : <b className="break-all">-</b>}
                    </div>
                  </div>
                )}
                <div>
                  {/* "1 days" 는 사소해 보이지만 이 앱에서 기한은 돈과 맞닿아 있다.
                      1일 주기면 하루라고 쓰는 게 맞다. */}
                  Heartbeat:{" "}
                  <b>
                    {(() => {
                      const d = vaultHeartbeat ? Math.floor(vaultHeartbeat / 86400) : 0;
                      return `${d} ${d === 1 ? "day" : "days"}`;
                    })()}
                  </b>
                </div>
                <div>Last ping: <b>{vaultLastPing ? new Date(vaultLastPing * 1000).toLocaleString() : "-"}</b></div>
                <div>
                  Token ({wldSymbol}):
                  {selectedAssetAddress ? (
                    <>
                      <button className="ml-1 underline text-blue-700 break-all" onClick={() => copyText(selectedAssetAddress, "wld")}>{short(selectedAssetAddress)}</button>
                      {copied === "wld" && <span className="ml-2 text-green-700">Copied</span>}
                    </>
                  ) : <b className="break-all">-</b>}
                  {selectedAssetAddress && <a className="ml-2 text-blue-600 underline" href={`${EXPLORER}/address/${selectedAssetAddress}`} target="_blank" rel="noreferrer">View</a>}
                </div>
                {/* 블록 번호는 탐색기에 "View" 링크로만 제공. 숫자를 그대로 노출하면
                    사용자에게 의미가 없고 테스트 체인에서 "4" 같은 값이 오히려
                    완성되지 않은 화면처럼 보인다. */}
                {vaultCreatedBlock !== null ? (
                  <div>
                    Created at:{" "}
                    <b>
                      {vaultCreatedTime ? new Date(vaultCreatedTime * 1000).toLocaleString() : "-"}
                    </b>{" "}
                    <a
                      className="text-blue-600 underline"
                      href={`${EXPLORER}/block/${vaultCreatedBlock}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View
                    </a>
                  </div>
                ) : (
                  <div>
                    Created at:{" "}
                    <b>
                      {vaultCreatedTime ? new Date(vaultCreatedTime * 1000).toLocaleString() : "-"}
                    </b>
                  </div>
                )}
              </div></details>
            </CardContent>
          </Card>
        )}

        {isYieldVault && tab === "money" && <details className="asset-details" key={`yield:${balanceScope}`}>
          <summary>Yield details &amp; WLD rewards</summary>
          <p>Morpho holds your invested asset. Rates and rewards can change; withdrawals depend on cash liquidity.</p>
          <div className="asset-details-content">
            {(!isSettledClaim || vaultHasAssets) && <YieldPositionCard
          route={selectedYieldRoute} rates={yieldRates} ratesLoading={yieldRatesLoading}
          position={selectedYieldPosition} holdings={selectedYieldHoldings} terms={yieldTerms} canExit={isMyVault && !isSettledClaim && (!isExpiredOrLater || inheritanceCancelled)}
          busy={pendingAction} onExit={() => void runVaultAction(exitYieldShares)} />}
            {!hasRewardAction && <YieldRewardsCard
          usdc={isUsdcVault} held={heldRewardCash?.scope === balanceScope ? heldRewardCash.amount : null}
          canWithdraw={isMyVault && !isSettledClaim && (!isExpiredOrLater || inheritanceCancelled)} onWithdraw={() => void runVaultAction(withdrawUsdcRewards)}
          data={selectedRewards?.data ?? null} error={selectedRewards?.error ?? ""} loading={selectedRewards?.loading ?? true}
          received={selectedReceivedRewards} onProcess={() => void runVaultAction(processReceivedYieldRewards)}
          settled={isSettledClaim} recipient={yieldRecipient?.vault.toLowerCase() === vault.toLowerCase() ? yieldRecipient.address : ""}
          busy={pendingAction} canClaim={miniInstalled && Boolean(account) && identityMatchesVault}
          onClaim={() => void runVaultAction(claimYieldRewards)} onRefresh={() => { void refreshRewards(); void refreshBalances(); }} />}
          </div>
        </details>}

        {/* ===== Inherit 탭: 상속 파이프라인을 그대로 보여준다 ===== */}
        {tab === "inherit" && vault && gate2(
          <Card>
            <CardHeader><CardTitle>Inheritance Status</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              {/* 주인이도 상속인도 아닌 지갑. `?vault=` 링크는 공개 주소다 — 블록
                  탐색기 페이지에도 있으므로 아무나 열 수 있다. 예전에는 이 경우를
                  "소유자가 아닌 사람" 으로만 묶어 상속인 문구를 보여줬고, 그래서
                  주체도 아니고 권한도 없는 사람에게 "You can now file a claim" 이라고
                  말했다. 할 수 있는 일이 하나도 없는데 할 수 있다고 읽히는 문장이라
                  사실을 거짓말로 바꾼다. 여기서 분명히 밝힌다. */}
              {!iAmInvolved && !receivedYieldInheritance && (
                <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded py-2 px-3">
                  You are neither the owner nor the heir of this vault, so there is nothing for
                  you to do here. You can watch its status, but only those two wallets can act.
                </div>
              )}
              <div className="text-sm text-gray-700">
                {/* 이 문장을 피상속인과 상속인에게 다르게 말한다. 예전에는 항상
                    피상속인 목소리("your heir", "You can renew") 로 적혀 있었는데,
                    상속인이 이 탭을 열면 자기 상속 절차가 자기 아닌 사람에게
                    달라고 ajax 되는 것처럼 읽혔다. */}
                {receivedYieldInheritance ? "Your inheritance completed. You can redeem any receipt shares in your wallet when Morpho cash liquidity is available." : isVaultOwner && vaultIdentity?.released ? isSettledClaim
                  ? "This is your archived vault. Inheritance completed; late campaign rewards follow its fixed recipient. Other assets received here can be recovered without affecting your current vault."
                  : "This is your archived vault. You can recover remaining assets here and cancel a claim until inheritance completes; your current vault stays separate." : isMyVault ? (
                  /* 카운트다운이 **한계** 가 아니라는 사실이 이 앱에서 가장 중요하고,
                     가장 자주 오독되는 부분이다. "7일 지나면 내 돈이 사라진다" 고
                     읽히면 사용자는 카운트다운 끝나기 직전에 패닉하게 된다. 실제 규칙은
                     "상속인이 **실제로 인출할 때까지** 멈출 수 없다" 다. 한 문장에 담는다. */
                  <>
                    Your heir must file a claim and wait {challengeDays} days before a transfer
                    is eligible. You can renew at any time until the transfer actually executes
                    to cancel the claim. After the review window, renew promptly if you want to keep the funds.
                  </>
                ) : iAmHeir ? (
                  <>
                    Funds move only after the countdown runs out <b>and</b> you file a claim,
                    then wait {challengeDays} more days. The owner can renew at any point to
                    cancel your claim — including after those {challengeDays} days — until the
                    transfer actually executes.
                  </>
                ) : (
                  /* 주인이도 상속인도 아닌 지갑. 이 단계들은 그 사람이 하는 일이 아니다.
                     앞에서 "You can now file a claim" 라고 말하는 버그가 있었고, 여기서도
                     같은 구조로 "you" 가 나왔다. 공개 링크를 열었을 뿐인 사람에게
                     자기 절차처럼 보이는 문장을 보여주면 안 된다. */
                  <>
                    Funds move only after the countdown runs out, the named heir files a claim,
                    and {challengeDays} more days pass. You can watch that here, but only the
                    heir and the owner can act on this vault.
                  </>
                )}
              </div>

              {identityMatchesVault && !isSettledClaim && !inheritanceCancelled && <AutomationNotice
                factoryAddress={isYieldVault ? vaultFactory : undefined}
                legacy={Boolean(LEGACY_FACTORY_ADDRESS && vaultFactory.toLowerCase() === LEGACY_FACTORY_ADDRESS.toLowerCase())}
                registered={notifyWatchState === "registered"}
                canEnable={NOTIFY_BACKEND_ENABLED && (isMyVault || iAmHeir)}
                busy={watchBusy || pendingAction}
                onEnable={registerHeirAlert}
              />}

              {/* 파이프라인을 단계로 보여준다. 어느 단계에 있는지가 한눈에 들어가야
                  "내 돈이 언제 이동하는가"를 머릿속에서 계산할 필요가 없어진다.

                  `done` 만으로는 다섯 줄이 전부 회색이거나 전부 파랑이라 "지금 어디까지
                  왔는가" 를 눈이 읽지 못한다. 파이프라인은 읽는 사람이 자기 돈이 언제
                  움직이는지 계산하게 하는 장치인데, 지금 여기 가 없으면 단계 목록이
                  뿐이다. 그래서 세 번째 상태를 넣었다 — 지나감 / 지금 / 앞날. */}
              {inheritanceCancelled ? (
                /* 상속이 취소된 금고에 5단계 상속 파이프라인을 보여주면 안 된다.
                   "상속인이 신청한다 → 7일 → 상속인이 인출한다" 는 여기서 일어나지
                   않는다. 예전에는 이 상태가 파이프라인에서 `expired` 와 구분되지
                   않아, 취소된 금고에 "Countdown ended" 가 **미완료** 로 남아
                   "아직 신청 전" 처럼 읽혔다. 상속이 없으므로 절차도 없다. */
                <ol className="pipeline">
                  {[
                    { k: "Inheritance cancelled", done: true },
                    { k: "No one can claim this vault", done: true },
                    { k: "Withdraw it back to yourself", done: vaultWld === 0n },
                  ].map((s, i) => {
                    // 여기서 "아직 안 됨" 은 남은 일이 있다는 뜻이 아니라, 사용자가
                    // **할 수 있는 조작이 하나 남았다는 뜻** 이다. 그래서 같은 표시를 쓴다.
                    const isNow = !s.done;
                    return (
                      <li key={i} className={isNow ? "pipeline-now" : "pipeline-done"}>
                        <span className="pipeline-dot" aria-hidden="true" />
                        {s.k}
                        <span className="sr-only">
                          {isNow ? " (current step)" : " (completed)"}
                        </span>
                        {isNow && <span className="pipeline-badge" aria-hidden="true">now</span>}
                      </li>
                    );
                  })}
                </ol>
              ) : (
              <ol className="pipeline">
                {inheritanceSteps.map((s, i) => {
                  // 지금 단계 = 아직 지나지 않은 첫 단계. 전부 지나면(-1) 절차를 다 쓴 상태.
                  const isNow = i === inheritanceNowStep;
                  return (
                    <li key={i} className={isNow ? "pipeline-now" : s.done ? "pipeline-done" : ""}>
                      <span className="pipeline-dot" aria-hidden="true" />
                      {s.k}
                      {/* 스크린 리더에게는 상태를 글로 말한다. 색과 굵기만으로는 전달되지
                          않고, 스크린 리더 전용 CSS(.sr-only) 가 그 텍스트를 숨긴다. */}
                      <span className="sr-only">
                        {isNow ? " (current step)" : s.done ? " (completed)" : " (not yet)"}
                      </span>
                      {isNow && <span className="pipeline-badge" aria-hidden="true">now</span>}
                    </li>
                  );
                })}
              </ol>
              )}

              {challengeRunning && (
                <div className="text-sm">
                  {/* "Your heir has filed a claim ... renew to keep the funds" 를
                      상속인에게 그대로 보여주면 자기 상속 신청이 남의 것으로 읽히고
                      "당신이 갱신하라" 는 지시처럼 보인다. 상속인에게는 자기 절차의
                      다음 단계와 남은 시간을 알려야 한다. */}
                  {/* 이 문장은 같은 카드의 첫 문단("You can renew at any point to
                      withdraw that claim, including after those 7 days — until they
                      actually take it") 과 정반대였다. 계약상 소유자의 거부는 무제한이다.
                      ownerMayStillAct() 는 claimedAt 이 0 이 아닐 때만 막는다 — 즉
                      소유자가 **실제로 수령하기 전까지는** 언제든 갱신해서 청산을 철회시킬
                      수 있다. 7일이 지나도 같다.
                      그래서 "After that the claim cannot be stopped" 는 거짓이고,
                      계약을 모르는 사람에게는 기한이 보장된 것처럼 읽힌다. 상속인에게
                      "그 날짜가 지나면 반드시 받는다" 라고 말하는 셈이다.
                      정직한 문장: 기한은 **아무도** 보장하지 않는다. 상속인이 언제든
                      다시 신청할 수 있고, 소유자가 갱신할 때마다 그 수령 시점이 한 주기
                      밀린다. */}
                  {isMyVault ? (
                    <>
                      Your heir has filed a claim. Renew before{" "}
                      <b>{challengeEndsAt ? new Date(challengeEndsAt * 1000).toLocaleString() : "—"}</b>{" "}
                      to withdraw it. You can still renew after that date — as many times as you
                      like, until the transfer executes. Automatic execution may happen soon after the review ends.
                    </>
                  ) : isVaultOwner && vaultIdentity?.released ? (
                    <>The heir of your archived vault has filed a claim. Recovering its remaining assets cancels this claim until inheritance actually completes. Your current vault stays separate.</>
                  ) : iAmHeir ? (
                    <>
                      You filed a claim. The owner can withdraw it until{" "}
                      <b>{challengeEndsAt ? new Date(challengeEndsAt * 1000).toLocaleString() : "—"}</b>
                      , and can renew again after that. Each time they do, the wait starts over.
                      You can withdraw the balance whenever you are able to — but no date is
                      guaranteed to you.
                    </>
                  ) : (
                    /* `?vault=` 는 공개 주소라 주인이도 상속인도 아닌 지갑이 열 수 있다.
                       예전에는 이 분기가 "상속인" 몫이라 타인에게 **자기 청산**을
                       말하고 있었다 — 세 줄 앞에 "여기서는 아무것도 할 수 없습니다" 라고
                       말해 놓고 세 줄 뒤에 "당신이 신청했습니다"라고 하는 모순이
                       실제로 렌더링됐다. */
                    <>
                      The heir of this vault has filed a claim. The owner can withdraw it until{" "}
                      <b>{challengeEndsAt ? new Date(challengeEndsAt * 1000).toLocaleString() : "—"}</b>
                      , and can renew again after that. You are neither of them, so there is
                      nothing here for you to do.
                    </>
                  )}
                  {isMyVault && (
                    <div className="mt-2">
                      <Button variant="primary" onClick={() => void runVaultAction(extendTime)} disabled={pendingAction || !miniInstalled || !account}>
                        Renew and withdraw the claim
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {awaitingClaim && account && vaultHeir &&
                account.toLowerCase() === vaultHeir.toLowerCase() && (
                  <div className="grid gap-2">
                    <div className="text-sm">
                      {/* 잔액이 0 인 금고에도 청산 절차를 밟게 뒀다. 계약은 막지 않고
                          상속인 입장에서 절차는 동일하므로 막을 이유가 없다. 다만
                          "the balance is now available to you" 라고 말하면 없는 돈을
                          약속하는 셈이라 실제 잔액에 따라 문장을 바꾼다. */}
                      {isYieldVault ? `The countdown has ended. File a claim to start the ${challengeDays}-day review window. Inheritance can pay ${wldSymbol} or receipt shares, depending on liquidity.${isUsdcVault ? " Held WLD rewards go to the same heir." : ""}` : vaultWld > 0n
                        ? `The countdown has ended, so the ${fmtUnits(vaultWld, wldDecimals)} ${wldSymbol} balance is now available to you. File a claim to start the ${challengeDays}-day review window.`
                        : `The countdown has ended. This vault currently holds nothing, so a claim would move no funds — file one only if WLD arrives before the review window ends.`}
                    </div>
                    <Button variant="primary" onClick={() => void runVaultAction(fileClaim)} disabled={pendingAction || !miniInstalled}>
                      File claim
                    </Button>
                  </div>
                )}

              {canClaim && account && vaultHeir &&
                account.toLowerCase() === vaultHeir.toLowerCase() && (
                  <div className="grid gap-2">
                    <div className="text-sm">
                      {/* 여기서 주어는 상속인(당신)이다. "their claim" 이면 자기
                          청산을 남의 것으로 읽힌다. 소유자용 변형은 따로 있다. */}
                      The review window has passed, so you can withdraw. Renewing would still cancel your claim until you do.
                    </div>
                    <Button variant="primary" onClick={() => void runVaultAction(claim)} disabled={pendingAction || !miniInstalled || !vaultHasAssets}>
                      {isYieldVault ? "Complete inheritance" : `Withdraw ${fmtUnits(vaultWld)} ${wldSymbol}`}
                    </Button>
                  </div>
                )}

              {/* 정산 이후 늦게 들어온 잔액 회수.
                  이게 없으면 돈이 금고에 갇힌 채 화면에는 "비어 있다" 고 표시된다.
                  계약에 회수 함수가 붙어 있는데 앱에서 부를 수 없으면 의미가 없다. */}
              {isSettledClaim && isMyVault && vaultHasAssets && (
                <div className="field-row" style={{ width: "100%" }}>
                  <label className="field-row-label" htmlFor="settled-sweep">
                    Leftover balance in the closed vault
                  </label>
                  <div className="field-row-controls">
                    <Button
                      variant="primary"
                      onClick={() => void runVaultAction(sweepSettled)}
                      disabled={pendingAction || !miniInstalled || !account || sweeping}
                    >
                      {sweeping
                        ? "Sweeping…"
                        : isYieldVault ? "Sweep remaining assets to me" : `Sweep ${fmtUnits(vaultWld, wldDecimals)} WLD to me`}
                    </Button>
                  </div>
                </div>
              )}

              {isSettledClaim && (
                <div className="text-sm text-gray-600">
                  {isYieldVault ? vaultIdentity?.released
                    ? "Inheritance completed. Claimable campaign rewards go to its fixed inheritance recipient after the net-gain fee. The original owner can recover other assets sent directly here using archived recovery."
                    : "Inheritance completed. Claimable campaign rewards go to its fixed inheritance recipient after the net-gain fee. The owner can sweep other assets received afterwards." : vaultWld > 0n ? (
                    <>
                      The inheritance completed and the heir was paid. This vault is closed, but{" "}
                      <b>{fmtUnits(vaultWld, wldDecimals)} WLD</b> arrived afterwards and is still
                      in the contract. You can sweep it to your own address.
                    </>
                  ) : (
                    "The inheritance completed. This vault is closed and holds nothing."
                  )}
                </div>
              )}

              {inheritanceCancelled && (
                <div className="text-sm text-gray-600">
                  {/*
                    취소는 **갱신 기한 전에는 되돌릴 수 있다** — 계약의
                    `updateHeir` 가 `ownerStillActiveOnly` 이고 heir 를 다시 지정하면
                    상속이 재개된다(forge: test_CancelCanBeUndoneBeforeExpiry).
                    "되돌릴 수 없다" 고 말하면 사용자가 확인도 하지 않고 포기한다.
                    기한이 지나면 되돌릴 수 없으므로 그때는 분명히 말해야 한다. */}
                  Inheritance was cancelled, so no one inherits this vault. The balance is
                  yours and you can withdraw it whenever you want.
                  {vaultPhase === "cancelled"
                    ? " The countdown has also ended, so the cancellation can no longer be undone — release your slot below to make a different vault."
                    : " You can still undo this by setting a heir again before the countdown ends."}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ===== Vault 탭: 타이머와 갱신 ===== */}
        {tab === "inherit" && vault && gate2(
          <Card>
            <CardHeader><CardTitle>Your plan settings</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="section-label">Status</div>
              {/* **금액을 카운트다운보다 먼저** 보여준다.
                  이 탭의 목적은 "얼마를 지키고 있고 언제까지 지키는지" 를 한 눈에 넣는
                  것이다. 그런데 카운트다운만 크고 금액은 다른 탭(Send) 에만 있었다. 앱은
                  이미 잔액을 갖고 있으면서 — 알림 판단도 잔액 기준이다 — 정작 보호 대상인
                  금액을 이 화면에서 감췄다. "얼마가 걸려 있는지" 를 모르고 기한을 지키라는
                  지시를 받는 것은 순서가 뒤집힌 안내다. */}
              <div className="text-sm">
                At stake in this vault:{" "}
                <b className={vaultHasAssets ? "text-base" : ""}>
                  {isYieldVault ? selectedYieldPosition?.valued ? `${formatYieldAmount(selectedYieldPosition.net, wldDecimals)} ${wldSymbol}` : "Value unavailable" : `${fmtUnits(vaultWld, wldDecimals)} ${wldSymbol}`}
                </b>{" "}
                <span className="text-xs text-gray-600">
                  {/* 이 줄은 **역할마다 다른 문장**이어야 한다. 예전에는 소유자 문장
                      ("your heir receives") 하나뿐이어서, `?vault=` 링크로 들어온 상속인에게는
                      "상속인이 받는다" 고 자기 상속에 대해 말했고, 주인이도 상속인도 아닌
                      타인에게는 "당신은 갱신하라" 는 지시처럼 읽혔다. 3단계 × 2역할 × 2탭
                      = 24건이 전부 이 한 줄에서 새어나왔다. */}
                  {vaultHasAssets
                    ? isSettledClaim
                      ? "— the inheritance already completed, so this is only what is left behind."
                      : inheritanceCancelled
                        /* 상속인이 없다(heir == owner). "상속인이 받는다" 는 명제 자체가
                           성립하지 않는다. */
                        ? "— no one inherits this vault, so it stays with the owner."
                        : isMyVault
                          ? "— this is what your heir receives if you stop renewing."
                          : iAmHeir
                            ? "— this is what you receive once the review window passes."
                            : "— held here for the owner's named heir."
                    : inheritanceCancelled
                      ? "— nothing left in this vault."
                      : isExpiredOrLater
                        /* 여기는 Deposit 이 비활성인 상태다(settled / expired / 이의제기
                           / 수령 가능). "Deposit WLD to start protecting it" 은 바로 아래
                           비활성 버튼을 가리키는 지시라 그대로 두면 사용자는 거짓말
                           안내를 받는다. */
                        ? "— nothing left in this vault, and deposits are turned off at this stage."
                        : isMyVault
                          ? `— nothing yet. Deposit ${wldSymbol} to start protecting it.`
                          : "— nothing here yet."}
                </span>
              </div>
              {/* 이 앱의 존재 이유가 "타이머가 다 되지 않았는가" 다. 그래서 카드의 맨 위에
                  크고 눈에 띄게 두고, 남은 시간에 따라 색을 바꾼다. */}
              <div className={`timer-block ${timerUrgency}`}>
                {vaultPhase === "cancelled" ? (
                  /* 취소 + 만료. 이 앱에서 가장 어긋나기 쉬운 자리였다.
                     예전에는 이 상태가 `active` 가 아니라서 아래의 "Time left to renew" /
                     "0d 0h 0m 0s" / 어제 날짜짜로 떨어졌다. "갱신하라" 고 말하면서
                     갱신 버튼은 없었고, 실제로 갱신하면 슬롯 해제만 한 주기 막힌다.
                     여기서 말해야 할 것은 하나다: 상속은 끝났고, 돈은 내 것이며,
                     자리를 되돌려받으려면 잔액을 비우고 해제하면 된다. */
                  <>
                    <div className="timer-label">Inheritance cancelled</div>
                    <div className="timer-value">Nobody will inherit this vault</div>
                    <div className="timer-sub">
                      {vaultWld > 0n
                        ? `The ${fmtUnits(vaultWld, wldDecimals)} ${wldSymbol} is yours — withdraw it, or release your slot to keep it.`
                        : "The balance is yours. Release your slot below to make a different vault — this one is over."}
                    </div>
                  </>
                ) : canClaim || isSettledClaim ? (
                  <>
                    <div className="timer-label">
                      {isSettledClaim ? "Inheritance completed" : "Review window passed"}
                    </div>
                    <div className="timer-value">
                      {isSettledClaim
                        ? // 잔액이 남을 수 있다 — 상속인이 가져간 뒤 늦게 들어온 WLD.
                          // 예전에는 Inherit 탭만 고치고 이 자리는 그대로 둬서, 앱이
                          // "비어 있다" 고 말하는 동안 실제로 2 WLD 가 금고에 있는
                          // 화면이 남았다. 같은 정보를 두 탭이 다르게 말하는 건
                          // 어느 쪽도 믿을 수 없게 만든다.
                          (vaultWld > 0n
                            ? `${fmtUnits(vaultWld, wldDecimals)} ${wldSymbol} left in this closed vault.`
                            : "This vault is closed and holds nothing.")
                        /* 주어가 세 갈래다. 소유자에게는 "상속인이", 상속인에게는
                           "당신이", 주인이도 상속인도 아닌 타인에게는 "상속인이" 다.
                           예전에는 소유자/상속인 구분 없이 "The heir…" 고정이라
                           상속인이 자기 금고 화면에서 남을 3인칭으로 읽었다. */
                        : isMyVault
                          ? "The heir can withdraw the vault balance."
                          : iAmHeir
                            ? "You can withdraw the vault balance."
                            : "The heir can withdraw the vault balance."}
                    </div>
                  </>
                ) : challengeRunning ? (
                  /* 주어가 세 갈래다. "you can still stop it" 는 **소유자에게만**
                     사실이다 — 청산을 철회할 수 있는 사람은 소유자뿐이다(갱신).
                     상속인에게 이 문장은 자신이 가진 적 없는 거부권을 주는 셈이고,
                     같은 탭의 "The owner can withdraw it until …" 과 정면으로 모순된다.
                     (3인칭으로 상속인을 부르던 버그의 거울상.) 타인에게는 아무것도
                     할 수 없으므로 그 사실을 말해야지 거부권이 있다는 듯이 말하면 안 된다. */
                  <>
                    <div className="timer-label text-gray-600">
                      {isMyVault
                        ? "Claim filed — you can still stop it"
                        : iAmHeir
                          ? "Claim filed — waiting for the review window"
                          : "Claim filed — review window running"}
                    </div>
                    <div className="timer-value">{fmt(challengeRemaining)}</div>
                    <div className="timer-sub">
                      {isMyVault
                        ? "left in the review window. Renewing withdraws the claim."
                        : iAmHeir
                          ? "left in the review window. The owner can still withdraw the claim, even after it ends."
                          : "left in the review window. Only the owner and the heir can act on this."}
                    </div>
                  </>
                ) : awaitingClaim ? (
                  <>
                    <div className="timer-label text-gray-600">
                      Countdown ended
                    </div>
                    <div className="timer-value">Waiting for a claim</div>
                    <div className="timer-sub">
                      {/* 여기서도 주어가 갈린다. "Your heir can now file a claim" 을
                          상속인에게 보여주면 남이 대신 신청해야 한다는 뜻으로 읽힌다.
                          그리고 세 번째 사람이 있다 — `?vault=` 링크는 공개 주소라 아무나
                          열 수 있다. 주인이도 상속인도 아닌 지갑에게 "You can now file a
                          claim" 이라고 말하면 **수익자라는 사실relation을 없는 사실로**
                          말하는 셈이다. 계약상 그 지갑은 아무것도 할 수 없다. */}
                      {isMyVault
                        ? `Your heir can now file a claim. You would then have ${challengeDays} days to renew.`
                        : iAmHeir
                          ? `You can now file a claim. The owner would then have ${challengeDays} days to renew.`
                          : `The countdown has ended. Only the heir named on this vault can file a claim on it.`}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="timer-label text-gray-600">
                      {timerUrgency === "timer-urgent" || timerUrgency === "timer-critical"
                        ? "Renew soon"
                        : "Time left to renew"}
                    </div>
                    <div className="timer-value">{fmt(timeRemaining)}</div>
                    <div className="timer-sub">
                      Expires {expiryLocal} <span className="text-gray-500">({deviceTimeZone})</span>
                    </div>
                  </>
                )}
              </div>

              {/* 알림 상태를 카운트다운 바로 아래에 한 줄로 둔다.
                  이 앱에서 알림은 부가 기능이 아니라 핵심 경로다: 카운트다운이 끝나기
                  전에 알림이 없으면 피상속인은 갱신을 잊고, 상속인은 신청 시점을 놓친다.
                  그런데 이 정보는 Help 탭 깊숙이, 내부 상태값("unknown" / "not_registered")
                  으로만 있었다.

                  형태를 고르는 기준: **카운트다운이 주인공**이어야 한다. 처음엔 노란
                  상자 + 큰 버튼으로 넣었더니 알림 박스가 카운트다운보다 눈을 끌었다 —
                  알림은 중요하지만 이 화면에서 사용자가 해야 할 일은 "갱신"이다.
                  그래서 평소에는 회색 한 줄 + 작은 ghost 버튼으로 낮추고, Really 급할
                  때(카운트다운이 임박했는데 알림이 꺼짐)만 상자를 칠해 올린다.

                  잔액이 0 이면 보낼 알림이 없으므로 아예 표시하지 않는다. */}
              {NOTIFY_BACKEND_ENABLED && vaultWld > 0n && notifyHealth.level !== "checking" && (
                <div
                  className={
                    notifyEscalate
                      ? "text-xs text-yellow-800 bg-yellow-50 border border-yellow-200 rounded py-2 px-3"
                      : "text-xs text-gray-600"
                  }
                  role={notifyEscalate ? "alert" : "status"}
                  aria-live="polite"
                >
                  {/* 이 한 줄의 **결과 절("nobody will be told…")** 이 바로 아래
                      "If you stop renewing, your heir can file a claim and take the
                      balance…" 와 같은 사실을 두 번 말한다. 두 번 말하는 줄은 하나가
                      거짓말처럼 읽힌다. 그래서 `notifyHealth.text` 를 **무엇이 되고
                      있지 않은가** 만 말하게 줄였고(453행), **결과는 아래 문장 한 곳에
                      만** 남겼다.

                      "Notifications are off" 라는 문구는 그대로 둔다 — 하네스가 이
                      상태를 문자열로 판정한다. 문구를 바꾸면 검사는 그대로 통과하지만
                      사용자에게 "무엇을 고쳐야 하는지" 를 말하지 않게 된다. */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span>
                      {notifyEscalate ? "⚠ " : ""}{notifyHealth.text}
                    </span>
                    {notifyHealth.level !== "ok" && notifyPermission !== "granted" && (
                      <Button size="sm" variant="ghost" onClick={requestNotifyPermission}
                        disabled={pendingAction || !miniInstalled || notifyBusy}>
                        {notifyBusy ? "Working…" : "Turn on"}
                      </Button>
                    )}
                    {notifyHealth.level !== "ok" && isMyVault && notifyPermission === "granted" && (
                      <Button size="sm" variant="ghost" onClick={registerHeirAlert}
                        disabled={pendingAction || !miniInstalled || watchBusy}>
                        {watchBusy ? "Working…" : "Watch this vault"}
                      </Button>
                    )}
                  </div>
                </div>
              )}
              {isMyVault &&
                // 정산·취소된 금고에는 "갱신" 이 존재하지 않는다. 계약상 `ping` 도
                // `changeMyPeriod` 도 `Expired()` 로 막힌다. 그런데 여기는 여전히
                // "Reset before the countdown ends. If you stop, your heir can claim…"
                // 라고 instructing 하고 있었다 — 이미 끝난 카운트다운에 대한 지시다.
                // 상속인은 이미 돈을 받았거나, 상속 자체가 취소되었는데 화면은 그렇다고
                // 전혀 말하지 않는다. 버튼만 비활성이고 문구는 살아 있다.
                !isSettledClaim && vaultPhase !== "cancelled" && (
                <>
                  <div className="text-sm text-gray-700">
                    {/* 취소됐지만 아직 만료 전이면 이 카드의 문구가 거짓말이 된다.
                        `cancelledFlag` 를 단계에서 분리했으므로 그 상태는 `active` 로
                        표시되고, 아래 "If you stop, your heir can claim the balance" 는
                        존재하지 않는 상속인을 말하며 같은 화면의 "At stake … no one
                        inherits this vault" 와 정면으로 어긋난다. 상속인이 없으므로
                        "갱신하라"는 의미가 없다 — 다만 기한 전에는 상속인을 다시 지정해
                        **취소를 되돌릴 수 있으므로** 그 길을 안내하는 게 맞다. */}
                    {inheritanceCancelled
                      ? "You cancelled this vault's inheritance, so no one will inherit it and the balance stays yours. Set a heir again below to undo the cancellation — after the countdown ends that stops being possible."
                      : challengeRunning
                        ? `Your heir filed a claim. Renew before ${challengeEndsAt ? new Date(challengeEndsAt * 1000).toLocaleString() : "—"} to withdraw it.`
                        : canClaim
                          ? "The review window has passed, so the heir can take the balance. You can still renew to withdraw the claim, until they actually do."
                          : awaitingClaim
                              ? "The countdown has ended. Your heir can file a claim now; keep renewing to cancel it until they actually take the balance."
                            : `If you stop renewing, your heir can file a claim and take the balance after a ${challengeDays}-day review window.`}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {/* canClaim 로 비활성화하지 않는다. 계약은 상속인이 실제로 수령하기
                        전까지 갱신을 허용하는데, 여기가 옛 규칙("7일이 지나면 못 되돌린다")을
                        그대로 구현하고 있었다. 계약만 고치고 UI 를 안 고치면 화면이
                        블록체인과 모순된다. */}
                    <Button variant="primary" onClick={() => void runVaultAction(extendTime)} disabled={pendingAction || !miniInstalled || !account || isSettledClaim}>
                      {challengeRunning || canClaim ? "Renew and withdraw claim" : "Reset timer"}
                    </Button>
                  </div>
                </>
              )}
                <div className="section-label">Settings</div>
              <div className="flex gap-2 flex-wrap">
                {isMyVault && (
                  <>
                    <div className="field-row" style={{ width: "100%" }}>
                      <label className="field-row-label" htmlFor="period-change">
                        Change renewal period (1–365 days)
                      </label>
                      <div className="field-row-controls">
                        <Input
                          id="period-change"
                          type="text"
                          inputMode="numeric"
                          className="w-28"
                          value={periodInput}
                          placeholder="30"
                          onChange={e => onPeriodChange(e.target.value)}
                        />
                        <Button onClick={() => void runVaultAction(changePeriod)} disabled={pendingAction || !miniInstalled || !account || !periodValid || isExpiredOrLater}>
                          Change period
                        </Button>
                      </div>
                    </div>
                    <div className="field-row" style={{ width: "100%" }}>
                      <label className="field-row-label" htmlFor="new-heir-input">
                        Change heir
                      </label>
                      <div className="field-row-controls">
                        <Input id="new-heir-input" placeholder="@username or 0x..." value={newHeir} onChange={e => onNewHeirInput(e.target.value)} />
                      </div>
                    </div>
                    {newHeir && (
                      resolvingNewHeir ? (
                        <div className="text-xs text-gray-600">Resolving…</div>
                      ) : newHeirResolved?.address ? (
                        <div className="text-xs text-gray-600">
                          Resolved: {newHeirResolved.username ? <b>@{newHeirResolved.username}</b> : 'Address'} → <b>{short(newHeirResolved.address)}</b>
                          <button className="ml-2 underline" onClick={() => copyText(newHeirResolved!.address!, 'heir')}>Copy</button>
                        </div>
                      ) : (
                        <div className="text-xs text-red-600">No match found. Enter a valid @username or WorldChain wallet address.</div>
                      )
                    )}
                    <Button onClick={() => void runVaultAction(updateHeir)} disabled={pendingAction || !miniInstalled || !account || !newHeirResolved?.address || isExpiredOrLater}>Update heir</Button>
                    {/* cancelInheritance 는 컨트랙트에서 만기 후 Expired 로 거부한다.
                        형제 버튼인 withdraw 처럼 만료 이후에는 항상 실패하므로
                        클릭을 사용자에게 노출하지 않는다. */}
                    {/* 상속 취소. ghost(무채색) 였는데 그 옆의 "Change period" 와 같은
                        무게로 보여 파괴적 조작인지 설정 변경인지 알 수 없었다. 취소하면
                        상속인이 사라지고 되돌리려면 기한 전이어야 하므로 danger 로 구분한다. */}
                    <Button
                      variant="danger"
                      onClick={() => void runVaultAction(cancelInheritance)}
                      disabled={pendingAction || !miniInstalled || !account || isExpiredOrLater}
                    >
                      Cancel (set heir to me)
                    </Button>
                    {supportsRelease && !vaultHasAssets && isExpiredOrLater && (!isYieldVault || selectedYieldHoldings !== null) && (
                      <div className="flex items-center gap-2">
                        {/* 모달을 **여는** 순간 동의 상태를 초기화한다. 예전에는 성공한
                          releaseSlot 의 finally 안에서만 초기화했으므로, Cancel 이나 Escape 로
                          닫고 다시 열면 이전 동의가 남아 Confirm 이 살아 있었다. 확인란의 문구는
                          "다시 한번 동의해야 한다" 는 뜻인데 앱이 그걸 지키지 않았다. */}
                      <Button onClick={() => { setReleaseAcknowledge(false); setShowReleaseConfirm(true); }} disabled={pendingAction || !miniInstalled || !account}>Release slot</Button>
                        <span className="text-xs text-gray-500">* Available only after expiry and when vault balance is 0. The contract remains on-chain; only the factory mapping is cleared.</span>
                      </div>
                    )}
                  </>
                )}
                {/* 상속 액션은 Inherit 탭의 파이프라인 카드가 단일 진입점으로 삼는다.
                    여기도 남겨두면 같은 행위가 두 곳에 생겨 어느 쪽이 맞는지 헷갈리고,
                    탭을 오갈 때마다 상태가 달라 보인다. */}
                {!account || (!vaultOwner && !vaultHeir) ? (
                  <Button onClick={loadVault}>Check again</Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 금고가 이미 있으면 이 카드를 숨긴다. 그대로 두면 비활성 primary 버튼과
            "You already have a vault" 문구가 함께 보여 혼란을 부르며, heir/period 조정은
            아래 "Timer & Controls" 카드에서 할 수 있어 기능 손실이 없다. */}
        {/* ===== 상속인 확인 =====
            금고가 없는 사람이 이 앱을 여는 이유의 절반은 "상속인이 Somebody" 다.
            그런데 이 카드를 맨 아래에 두면 그 위에 "How this works" 와
            "Create My Vault" 이 있어서, 상속인이 자기 것인지를 확인하려면 스크롤을
            내려야 했다. 스캔 결과가 있는 경우 카드를 맨 앞으로 올린다. */}

        {/* ===== 깨진 링크 =====
            조용히 무시하면 안 된다. 사용자는 자기 금고도 없는 빈 화면을 보며 이유를
            알 수 없다. 틀린 입력인지 앱이 고장인지부터 구분되게 해야 한다. */}
        {tab === "inherit" && linkError && (
          <Card>
            <CardHeader><CardTitle>This link could not be opened</CardTitle></CardHeader>
            <CardContent className="grid gap-2">
              <div className="text-sm text-gray-700">{linkError}</div>
              <div className="text-xs text-gray-600">
                A link looks like <code>…?vault=0x…</code>. If the person who sent it made a
                mistake, ask them to send it again.
              </div>
            </CardContent>
          </Card>
        )}

        {/* ===== 링크로 받은 금고 안내 =====
            상속인에게 보내는 링크는 이 앱이 상속인을 도달시키는 유일한 확실한 경로다.
            그런데 받는 사람이 자기 금고를 갖고 있으면 예전에는 자기 금고만 보여주고 링크가
            가리키는 상속 대상을 조용히 버렸다. 지금 보고 있는 것이 누구의 금고인지 말하고,
            자기 금고로 돌아갈 수 있게 한다. */}
        {tab === "inherit" && linkedVault && ownVault && ownVault.toLowerCase() !== linkedVault.toLowerCase() && account && gate2(
          <Card>
            <CardHeader><CardTitle>You are viewing a vault you were sent</CardTitle></CardHeader>
            <CardContent className="grid gap-2">
              <div className="text-xs text-gray-600">
                This is the vault from the link you opened, and it is the one your actions apply
                to. Your own vault is <b>{short(ownVault)}</b>.
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button onClick={() => { setVault(linkedVault); setLinkedVault(""); }} variant="primary">
                  Keep viewing the linked vault
                </Button>
                <Button onClick={() => { setVault(ownVault); setLinkedVault(""); }}>
                  Back to your own vault
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* "내가 상속인으로 지정됐나" 카드.
            자기 금고가 없는 사람에게는 첫 화면이어야 하고(상속인이 이 앱을 여는 이유다),
            자기 금고가 있는 사람에게도 보여야 한다 — 자기 금고가 있어도 남의 상속인이 될 수
            있으므로. 예전처럼 `!isMyVault` 로 숨기면 그 사람은 자기 금고만 관리하다가
            평생 "누군가가 나를 상속인으로 지명했나" 를 알 방법이 없었다. 상속인 링크를
            받아도 (a) 링크가 자기 금고로 덮이면 (b) 여기 카드가 없으므로 신청 수단이
            사라진다. 두 곳에서 쓰이므로 변수로 뺀다. */}
        {/* 상속인 카드는 **스캔 결과가 있을 때만** 맨 위에 둔다.
            앞선 커밋에서 "상속인이 이 앱을 여는 이유니까" 라고 올렸는데, 그건 스캔 결과가
            있을 때만 성립하는 이야기다. 결과가 없으면 화면에 "No vault names you as heir"
            라는 카드가 남고, 아무것도 안 한 사람에게 "당신이 상속인일 수 있습니다" 라고
            말한 뒤 "아니오" 라고 대답하는 셈이다. 답이 없는 질문은 질문하지 말아야 한다.
            첫 화면에서 진짜 중요한 건 "금고 만들기" 다.

            "Check again" 도 함께 사라지는데, 자동 스캔이 열 때마다 도는 중이고
            수동 재확인이 필요한 경우는 거의 없다. 필요하면 Help 탭에 남긴다. */}
        {tab === "inherit" && account && notifyHeirWorthShowing && heirStatusCard}

        {tab === "inherit" && account && gate2(
          <PlanSetup
            rows={draftPlanRows.map(row => ({ ...row, walletBalance: planWalletBalances[row.symbol] ?? null }))}
            heir={heir}
            onHeirChange={onHeirInput}
            onPickHeir={pickHeirFromContacts}
            resolvingHeir={resolvingHeir}
            heirResolved={heirResolved?.address ?? ""}
            heirUsername={heirResolved?.username ?? ""}
            heirSuspicious={Boolean(heirResolved?.address && isHeirSuspicious())}
            shareBusy={shareBusy}
            period={periodInput}
            periodValid={periodValid}
            onPeriodChange={onPeriodChange}
            onPreset={days => onPeriodChange(String(days))}
            onAmountChange={(symbol, value) => symbol === "WLD" ? setPlanWldAmount(value) : setPlanUsdcAmount(value)}
            yieldConsent={yieldConsent}
            onYieldConsent={value => {
              consentedStrategyFees.current = value ? Object.fromEntries(draftPlanRows.map(row => [row.symbol, row.underlyingFeePercent])) : {};
              setYieldConsent(value);
            }}
            pendingPlan={pendingPlan}
            alignmentConflicts={alignmentConflicts}
            onConfirmAlignment={() => void runWalletAction(() => continuePlan(true))}
            onCancelAlignment={() => { setAlignmentReview(""); setAlignmentConflicts([]); }}
            onCreate={fees => {
              consentedStrategyFees.current = { ...fees };
              void runVaultAction(createPlan);
            }}
            onResume={() => void runWalletAction(() => continuePlan(false))}
            canEditRemaining={Boolean(pendingPlan && canEditStoredPlan(pendingPlan))}
            onEditRemaining={editRemainingPlan}
            busy={pendingAction || creating}
            createDisabled={createPlanDisabled}
            resumeDisabled={resumePlanDisabled}

          />
        )}


        {/*
          상속인 경로를 주인 폼에서 분리한다.
        
          "내 금고 만들기" 폼 아래에 "상속인 찾기" 버튼이 붙어 있으면 서로 다른 두 가지
          일을 하는 것처럼 보인다. 상속인은 자기 금고가 없으므로 이 화면이 상속인
          입장에서 유일한 진입점이기도 하다.
        */}

        {/* ===== 주인이 상속인에게 보낼 수 있는 링크 =====
            월드앱 알림은 이 미니앱을 깔지 않은 지갑에 닿지 않는다("User not found").
            상속인 단말에 뭐가 깔려 있든 통하는 유일한 채널은 주인이 직접 보내는 링크다.
            이게 없으면 "상속인으로 지정된 사실" 자체가 상속인에게 전달되지 않는다. */}
        {tab === "inherit" && isMyVault && vault && vaultHeir &&
          /* 정산이 끝나면 계약이 heir 를 0x0 으로 지운다(InheritanceVaultWLD.sol).
             그런데 `vaultHeir` 가 "0x0000…0000" 도 참이라 이 카드가 살아 있었고,
             소유자는 0x0 에 World Chat 을 보내라는 안내를 받았다. 상속 자체가
             취소된 금고(heir == owner)에서는 **자기 자신에게** 보내라는 안내가 된다.
             사람이 있는 상속인일 때만 이 카드를 띄운다. */
          vaultHeir !== ethers.ZeroAddress && vaultHeir.toLowerCase() !== (vaultOwner ?? "").toLowerCase() && gate2(
          <Card>
            <CardHeader><CardTitle>Tell your heir</CardTitle></CardHeader>
            <CardContent className="grid gap-2">
              {/* 이 카드의 일은 "상속인에게 직접 알려라" 다. 규칙 설명이 아니다.
                  그런데 여기가 7줄짜리 장문이었다 — 그중 "7일이 지나도 취소할 수 있다" 는
                  위 Inheritance Status 카드가 이미 말하고, "알림은 이미 켠 지갑에만 닿는다" 는
                  알림 상자가 이미 말한다. **같은 화면에서 두 번 말하면 한쪽이 거짓말처럼
                  읽힌다.** 여기에는 이 카드가 Adding 해야 할 것만 남긴다.

                  상속은 "피상속인이 갱신을 멈춘다" 는 사실 위에 성립한다. 갱신은 살아있다는
                  신호이지 실패가 아니다 — 그래서 주인은 상속인이 실제로 받기 전까지 언제든
                  갱신할 수 있고, 상속인은 그 신호가 끊기길 기다린다. 시간표를 약속하지
                  않지만, 주인이 멈추면 반드시 진행된다는 사실이 보장된다. */}
              <div className="text-xs text-gray-600">
                Your heir only finds out if you tell them. Keep resetting the timer and they will
                keep waiting — nobody inherits while you are still renewing.
              </div>
              {heirUsername ? (
                <>
                  <div className="text-sm font-medium">Send in World Chat</div>
                  <div className="text-xs text-gray-600">
                    Reaches @{heirUsername} inside World App, whether or not they have ever opened
                    this app. Tapping the message opens this vault.
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button variant="primary" onClick={tellHeirInChat} disabled={pendingAction || shareBusy}>
                      {shareBusy ? "Sending..." : "Send in World Chat"}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-xs text-gray-600">
                  This heir is a bare address with no World Chat username, so World Chat cannot
                  address them. Use the link below — it works whatever they have installed.
                </div>
              )}
              <div className="text-xs text-gray-600">
                Or send it any other way you already talk to them:
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button onClick={copyHeirLink}>Copy link</Button>
                <Button onClick={copyHeirMessage}>Copy message</Button>
              </div>
              <div className="text-xs text-gray-600 break-all">{heirLink}</div>
            </CardContent>
          </Card>
        )}

        {/* ===== Help 탭: 신뢰성 근거와 법적 고지 =====
            여러 카드를 한 탭에 묶으므로 fragment 로 감싼다. */}
        {tab === "support" && (
        <>
          <Card className="help-fees-card">
            <CardHeader><CardTitle>{t("help.feeTitle")}</CardTitle></CardHeader>
            <CardContent className="grid gap-2 text-sm text-gray-700">
              <p>{t("help.feeDisclosure")}</p>
              <a className="text-blue-600 underline text-xs" href="/yield-terms.html" target="_blank" rel="noreferrer">{t("help.feeTerms")}</a>
            </CardContent>
          </Card>
          {/* 상속인 카드를 첫 화면에서 뺐으므로 수동 재확인은 여기로 온다.
              자동 스캔이 열 때마다 돌지만, 그 사이에 상속인으로 지정받은 경우를
              확인하려면 필요하고, 그 수단을 통째로 버리면 안 된다. */}
          {account && (
            <Card>
              <CardHeader><CardTitle>Named as an heir?</CardTitle></CardHeader>
              <CardContent className="grid gap-2">
                <div className="text-xs text-gray-600">
                  {findingHeirVaults
                    ? "Checking the chain for vaults that name you…"
                    : heirScanAttempted
                      ? heirFoundVaults.length > 0
                        ? `You are the heir of ${heirFoundVaults.length} vault${heirFoundVaults.length > 1 ? "s" : ""}. Open Plan to see them.`
                        : heirScanIncomplete
                          ? "Some vaults could not be checked. Please try again."
                          : "No registered or recent vaults found in this check."
                      : "This app checks the chain for you as soon as you open it."}
                </div>
                {heirSearchNote && <p className="text-xs text-gray-600">{heirSearchNote}</p>}
                <div>
                  <Button size="sm" onClick={findHeirVaults} disabled={pendingAction || findingHeirVaults}>
                    {findingHeirVaults ? "Searching..." : "Check again"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        <Card>
          <CardHeader><CardTitle>Custody & Safety</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-gray-700">
            <div>
              Your wallet keys stay in World App. One plan covers the WLD and/or USDC amounts you choose; the app manages a separate on-chain vault contract for each selected asset with the same heir and check-in interval. We cannot redirect inheritance or withdraw an active owner’s funds.
            </div>
            <ul className="list-disc pl-5 space-y-1 text-xs text-gray-600">
              <li>Your setup and management transactions require World App approval. After an heir’s claim and seven-day review, a new vault may transfer automatically without a second signature.</li>
              <li>Each selected amount goes to its asset-specific vault contract; WLD and USDC are never converted. Yield deposits supply that asset to the disclosed Morpho vault. Eligible inheritance transfers can only pay its named heir; active-owner withdrawals require your approval.</li>
              <li>World App provides your address and asks you to approve wallet sign-in and management transactions.</li>
              <li>We store sign-in security records and registered vault addresses, monitoring state and delivery or execution records. See Privacy for details. We never collect your wallet keys.</li>
            </ul>
          </CardContent>
        </Card>

        {NOTIFY_BACKEND_ENABLED && (
          <Card>
            <CardHeader><CardTitle>World App Notifications</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm text-gray-700">
              <div className="text-xs text-gray-600">
                Register this vault and World App notifies you and your heir at each point where a decision is
                actually open: the countdown is close to ending, your heir has filed a claim, or the 7-day review
                window has passed. Nothing is sent while the vault holds no funds.
              </div>
              {/* 상태값("unknown" / "not registered") 을 그대로 보여주지 않는다.
                  사용자는 그것으로 무엇을 해야 하는지 알 수 없다. 대신 무엇이 되고 있지
                  않은지와 그 대처를 함께 말하고, 카운트다운 탭에도 같은 내용을 둔다. */}
              <div className="text-xs text-gray-700">{notifyHealth.text}</div>
              {notifyDeliveryNote && (
                <div className="text-xs text-yellow-800">
                  Last attempt was not delivered: <b>{notifyDeliveryNote}</b>
                  {notifyDeliveryNote === "User has disabled notifications" &&
                    " — turn it on in World App → Settings → Notifications."}
                </div>
              )}
              {/* 다섯 버튼이 전부 같은 크기였고, 그중 하나만 실제 조작이고 나머지는
                  진단용이었다. "Register vault alerts" (primary) 가 눈에 띄어야 하는데,
                  "Refresh permission" 이 바로 위에 같은 크기로 있어서 어느 쪽이
                  할 일인지 애매했다. 주 조작 하나만 md·primary, 진단은 sm 으로 내린다.

                  "Refresh permission" 과 "Refresh watcher" 가 **한 고유 그룹**이 중복된다 —
                  두 RPC 하나를 새로 읽는 같은 동작. 하나로 합친다. */}
              <div className="flex gap-2 flex-wrap">
                <Button onClick={requestNotifyPermission} disabled={pendingAction || !miniInstalled || notifyBusy}>
                  {notifyBusy ? "Working..." : "Enable notifications"}
                </Button>
                {account && vaultOwner && account.toLowerCase() === vaultOwner.toLowerCase() && vault && vaultHeir && (
                  <Button
                    variant="primary"
                    onClick={registerHeirAlert}
                    disabled={pendingAction || !miniInstalled || !NOTIFY_BACKEND_ENABLED || watchBusy}
                  >
                    Register vault alerts
                  </Button>
                )}
              </div>
              <div className="section-label">Diagnostics</div>
              <div className="flex gap-2 flex-wrap">
                {account && (
                  <Button size="sm" onClick={sendNotifyTestToMe} disabled={pendingAction || !miniInstalled || !NOTIFY_BACKEND_ENABLED || watchBusy}>
                    Send a test to me
                  </Button>
                )}
                <Button size="sm" onClick={refreshNotifyState} disabled={pendingAction || !miniInstalled || notifyBusy || watchBusy}>
                  Refresh status
                </Button>
              </div>
              <div className="text-xs text-gray-500">
                Important: the heir wallet must also open this mini app at least once and enable notifications.
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Help & Legal</CardTitle></CardHeader>
          <CardContent className="text-xs text-gray-600 space-y-2">
            <div>
              This tool is non-custodial and for informational purposes only. It does not constitute legal, tax, or investment advice.
            </div>
            <div>
              <a className="text-blue-600 underline" href="/privacy.html" target="_blank" rel="noreferrer">Privacy Policy</a>
              <span className="mx-2">•</span>
              <a className="text-blue-600 underline" href="/terms.html" target="_blank" rel="noreferrer">Terms</a>
              <span className="mx-2">•</span>
              <a className="text-blue-600 underline" href="mailto:daviswhistle@naver.com">Support</a>
            </div>
          </CardContent>
        </Card>
        </>
        )}

      {/* 탭이 보이는데 그 탭의 카드가 하나도 렌더되지 않은 경우의 안전망.
          조건문이 겹치면서 특정 조합에서 빈 탭이 생길 수 있고, 그 상태로 나가면
          "아무것도 없잖아" 가 그대로 사용자에게 보인다. 빈 화면 대신 다음 행동을
          말해준다. */}
      {tabStillVisible && !tabHasContent && (
        <div className="text-sm text-gray-600">
          {tab === "money" && "Your vault is not set up yet. Create it in Plan first."}
          {tab === "vault" && "Loading your vault..."}
        </div>
      )}

      {/* ===== 하단 탭 바 =====
          가이드라인이 권장하는 "Bottom tab navigation and anchored buttons" 형태다.
          fixed 이지만 safe-area 를 고려해 화면 가장자리와 겹치지 않게 들어 올린다.
          내용이 없는 탭은 아예 보이지 않는다(visibleTabs). */}
      <nav className="tab-bar" aria-label={t("nav.sections")} hidden={!account}>
        {visibleTabs.map((navTab) => (
          <button
            key={navTab.key}
            className={`tab-item ${tab === navTab.key ? "tab-item-active" : ""}`}
            onClick={() => { navigationChosenFor.current = account.toLowerCase(); setTab(navTab.key); }}
            aria-current={tab === navTab.key ? "page" : undefined}
          >
            <Icon name={navTab.key === "money" ? "assets" : navTab.key === "vault" ? "home" : navTab.key === "support" ? "help" : navTab.key} size={21} />
            <span>{t(navTab.key === "vault" ? "nav.vault" : navTab.key === "money" ? "nav.money" : navTab.key === "inherit" ? "nav.inherit" : "nav.support")}</span>
          </button>
        ))}
      </nav>

      </main>
      <div className="toast-container" role="status" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>{localizeAppMessage(locale, t.msg)}</div>
        ))}
      </div>
      {showReleaseConfirm && (
        /* 슬롯을 놓는 Confirm 은 되돌릴 수 없다(팩토리의 1인 1금고 매핑이 사라진다).
           그럼에도 이 모달은 (1) 열려도 포커스를 안 받고(activeElement = BODY)
           (2) Escape 로 닫히지 않고 (3) Tab 이 뒤쪽 탭 바로 빠져나간다.
           키보드·스크린리더 사용자는 지금 어디가 모달인지, 어디서 나갈 수 있는지를
           알 수 없다. `aria-modal="true"` 를 붙여놓고 그 수단을 안 하면 거짓말이다. */
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setShowReleaseConfirm(false);
              return;
            }
            /* Tab 을 모달 안에 가둔다. `aria-modal="true"` 는 "나머지 내용은
               보조기구에 숨겨진다" 는 약속인데, 실제로는 모달 뒤의 탭 바로로
               포커스가 넘어갔다. 약속한 대로 만들지 않으면 그 속성은 거짓말이다.
               모달 안의 유일한 포커스 대상(체크박스, Cancel, Confirm)을 순환시킨다. */
            if (e.key === "Tab") {
              const focusables = releaseDialogRef.current?.querySelectorAll<HTMLElement>(
                'input:not([disabled]), button:not([disabled])',
              );
              if (!focusables || focusables.length === 0) return;
              const first = focusables[0];
              const last = focusables[focusables.length - 1];
              const activeEl = document.activeElement;
              if (e.shiftKey && (activeEl === first || !releaseDialogRef.current?.contains(activeEl))) {
                e.preventDefault();
                last.focus();
              } else if (!e.shiftKey && activeEl === last) {
                e.preventDefault();
                first.focus();
              }
            }
          }}
        >
          <div
            className="bg-white rounded-md shadow-lg max-w-sm w-full p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="release-modal-title"
            aria-describedby="release-modal-desc"
            /* 열릴 때 첫 조작 요소로 포커스를 옮긴다. 그래야 Enter/Space 가 곧바로
               동작하고 스크린리더가 제목을 읽어 준다. */
            ref={(el) => {
              releaseDialogRef.current = el;
              if (!el) return;
              el.querySelector<HTMLElement>("input, button")?.focus();
            }}
          >
            <div id="release-modal-title" className="text-lg font-semibold mb-2">Release vault slot?</div>
            <div id="release-modal-desc" className="text-sm text-gray-700 mb-3">
              You can release only after expiry or settlement and when the vault holds no cash, receipt shares or WLD rewards. Releasing keeps the vault contract on-chain and clears only this factory's one-per-owner mapping. It cannot be undone.
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-700 mb-3">
              {/* 기본 체크박스는 13x13 이라 손가락으로 누르기엔 작다(권장 44px 면적).
                 20px 로 키우고 label 전체가 눌리는 면적이 되게 한다. */}
              <input
                type="checkbox"
                className="release-ack"
                checked={releaseAcknowledge}
                onChange={e => setReleaseAcknowledge(e.target.checked)}
              />
              <span>I understand the conditions and want to proceed.</span>
            </label>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setShowReleaseConfirm(false)} disabled={pendingAction || releasing}>Cancel</Button>
              <Button variant="primary" onClick={() => void runVaultAction(releaseSlot)} disabled={pendingAction || !miniInstalled || releasing || !releaseAcknowledge}>Confirm</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
