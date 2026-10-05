/**
 * 앱 전역 설정 + 환경변수 검증.
 *
 * 주의: 이 모듈은 import 시점에 예외를 던지면 안 된다.
 * ESM 의 import 평가는 `createRoot().render()` 보다 먼저 일어나기 때문에,
 * 여기서 throw 하면 ErrorBoundary 조차 마운트되지 않아 다시 흰 화면이 된다.
 * 대신 문제를 CONFIG_ERROR 문자열로 노출하고, App 이 이를 감지해 안내 화면을 렌더링한다.
 */

const raw = import.meta.env as Record<string, string | undefined>;

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const REQUIRED_ADDRESSES = ["VITE_FACTORY_ADDRESS", "VITE_WLD_ADDRESS"] as const;

const problems: string[] = [];

for (const key of REQUIRED_ADDRESSES) {
  const value = (raw[key] ?? "").trim();
  if (!value) {
    problems.push(`${key} is not set.`);
  } else if (!ADDRESS_RE.test(value)) {
    problems.push(`${key} is not a valid EVM address: ${value}`);
  }
}
if (raw.VITE_LEGACY_FACTORY_ADDRESS && !ADDRESS_RE.test(raw.VITE_LEGACY_FACTORY_ADDRESS.trim())) {
  problems.push("The earlier vault configuration is invalid.");
}
const yieldFactory = (raw.VITE_YIELD_FACTORY_ADDRESS ?? "").trim();
const morphoVault = (raw.VITE_MORPHO_VAULT_ADDRESS ?? "").trim();
const usdcFactory = (raw.VITE_USDC_YIELD_FACTORY_ADDRESS ?? "").trim();
const usdcStrategy = (raw.VITE_USDC_MORPHO_VAULT_ADDRESS ?? "").trim();
const usdc = (raw.VITE_USDC_ADDRESS ?? "").trim();
const wldAddress = (raw.VITE_WLD_ADDRESS ?? "").trim();
if (usdcFactory || usdcStrategy || usdc) {
  if (![usdcFactory, usdcStrategy, usdc].every(value => ADDRESS_RE.test(value) && !/^0x0{40}$/i.test(value))) {
    problems.push("USDC token, yield factory and Morpho strategy must be configured together.");
  }
  if ([raw.VITE_FACTORY_ADDRESS, raw.VITE_LEGACY_FACTORY_ADDRESS, yieldFactory].some(a => a && a.toLowerCase() === usdcFactory.toLowerCase())
    || usdc.toLowerCase() === (raw.VITE_WLD_ADDRESS ?? "").toLowerCase()
    || new Set([usdc, usdcFactory, usdcStrategy].map(a => a.toLowerCase())).size !== 3) {
    problems.push("USDC must use its own token and yield factory.");
  }
}
if (yieldFactory || morphoVault) {
  if (!ADDRESS_RE.test(yieldFactory) || !ADDRESS_RE.test(morphoVault)) {
    problems.push("Both yield factory and Morpho vault addresses must be configured together.");
  }
  if ([raw.VITE_FACTORY_ADDRESS, raw.VITE_LEGACY_FACTORY_ADDRESS].some(a => a && a.toLowerCase() === yieldFactory.toLowerCase())) {
    problems.push("The yield factory must be separate from the existing factories.");
  }
}

const ZERO_ADDRESS_RE = /^0x0{40}$/i;
const isNonzeroAddress = (value: string): boolean => ADDRESS_RE.test(value) && !ZERO_ADDRESS_RE.test(value);
const parseLegacyFactoryList = (key: string): { configured: boolean; valid: boolean; addresses: string[] } => {
  const value = (raw[key] ?? "").trim();
  if (!value) return { configured: false, valid: true, addresses: [] };

  const entries = value.split(",").map(entry => entry.trim());
  let valid = true;
  if (entries.length > 8) {
    problems.push(`${key} can contain at most 8 factory addresses.`);
    valid = false;
  }
  if (entries.some(entry => !entry)) {
    problems.push(`${key} cannot contain empty entries.`);
    valid = false;
  }
  if (entries.some(entry => !isNonzeroAddress(entry))) {
    problems.push(`${key} must contain only nonzero EVM addresses.`);
    valid = false;
  }
  const normalized = entries.filter(isNonzeroAddress).map(entry => entry.toLowerCase());
  if (new Set(normalized).size !== normalized.length) {
    problems.push(`${key} cannot contain duplicate factory addresses.`);
    valid = false;
  }
  return { configured: true, valid, addresses: valid ? entries : [] };
};

const legacyWldList = parseLegacyFactoryList("VITE_LEGACY_YIELD_FACTORY_ADDRESSES");
const legacyUsdcList = parseLegacyFactoryList("VITE_LEGACY_USDC_YIELD_FACTORY_ADDRESSES");
const parseLegacyDeployBlock = (key: string, configured: boolean): number | null => {
  if (!configured) return null;
  const value = (raw[key] ?? "").trim();
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed <= 0) {
    problems.push(`${key} must be a positive integer when its legacy factory list is configured.`);
    return null;
  }
  return parsed;
};
const legacyWldBlock = parseLegacyDeployBlock("VITE_LEGACY_YIELD_FACTORY_DEPLOY_BLOCK", legacyWldList.configured);
const legacyUsdcBlock = parseLegacyDeployBlock("VITE_LEGACY_USDC_YIELD_FACTORY_DEPLOY_BLOCK", legacyUsdcList.configured);

if (legacyWldList.configured && ![wldAddress, yieldFactory, morphoVault].every(isNonzeroAddress)) {
  problems.push("Legacy WLD yield factories require the primary WLD token, yield factory and Morpho strategy to be configured.");
}
if (legacyUsdcList.configured && ![usdc, usdcFactory, usdcStrategy].every(isNonzeroAddress)) {
  problems.push("Legacy USDC yield factories require the primary USDC token, yield factory and Morpho strategy to be configured.");
}

const legacyDuplicates = new Set<"WLD" | "USDC">();
const reservedAddresses = new Set([
  raw.VITE_FACTORY_ADDRESS,
  raw.VITE_LEGACY_FACTORY_ADDRESS,
  yieldFactory,
  usdcFactory,
  wldAddress,
  usdc,
  morphoVault,
  usdcStrategy,
].map(value => (value ?? "").trim().toLowerCase()).filter(Boolean));
const seenLegacyAddresses = new Map<string, "WLD" | "USDC">();
let hasLegacyFactoryCollision = false;
for (const [symbol, addresses] of [["WLD", legacyWldList.addresses], ["USDC", legacyUsdcList.addresses]] as const) {
  for (const address of addresses) {
    const normalized = address.toLowerCase();
    const priorSymbol = seenLegacyAddresses.get(normalized);
    if (reservedAddresses.has(normalized) || priorSymbol) {
      hasLegacyFactoryCollision = true;
      legacyDuplicates.add(symbol);
      if (priorSymbol) legacyDuplicates.add(priorSymbol);
    }
    seenLegacyAddresses.set(normalized, symbol);
  }
}
if (hasLegacyFactoryCollision) {
  problems.push("Legacy yield factory addresses must be unique and separate from configured factories, asset tokens and strategies.");
}

const legacyWldPrimaryReady = [wldAddress, yieldFactory, morphoVault].every(isNonzeroAddress);
const legacyUsdcPrimaryReady = [usdc, usdcFactory, usdcStrategy].every(isNonzeroAddress);
export const LEGACY_YIELD_FACTORY_ADDRESSES = legacyWldList.valid && legacyWldPrimaryReady
  && legacyWldBlock !== null && !legacyDuplicates.has("WLD") ? legacyWldList.addresses : [];
export const LEGACY_YIELD_FACTORY_DEPLOY_BLOCK = legacyWldBlock;
export const LEGACY_USDC_YIELD_FACTORY_ADDRESSES = legacyUsdcList.valid && legacyUsdcPrimaryReady
  && legacyUsdcBlock !== null && !legacyDuplicates.has("USDC") ? legacyUsdcList.addresses : [];
export const LEGACY_USDC_YIELD_FACTORY_DEPLOY_BLOCK = legacyUsdcBlock;

/** 환경변수 문제로 앱을 시작할 수 없을 때 채워지는 안내 문자열. null 이면 정상. */
export const CONFIG_ERROR: string | null =
  problems.length === 0
    ? null
    : [
        "The app cannot start because its configuration is incomplete.",
        "",
        ...problems.map((p) => `• ${p}`),
        "",
        "How to fix it",
        "  1) Copy the example file:",
        "       cp .env.example .env",
        "  2) Fill in VITE_FACTORY_ADDRESS and VITE_WLD_ADDRESS with real values.",
        "",
        "The current deployment addresses are in the deploy log:",
        "  forge script script/DeployWLDFactory.s.sol:DeployWLDFactory --rpc-url <rpc>",
      ].join("\n");

// ===== World Chain (chainId 480)
export const CHAIN_ID = 480;
export const CHAIN_ID_HEX = "0x1e0";
export const CHAIN_NAME = "World Chain";
export const EXPLORER = "https://worldscan.org";

// 잘못된 설정일 때는 빈 문자열을 쓴다. CONFIG_ERROR 가 있는 상태에서는
// App 이 설정 안내 화면만 그리기 때문에 이 값들이 실제 호출에 쓰이지는 않는다.
export const FACTORY_ADDRESS = (raw.VITE_FACTORY_ADDRESS ?? "").trim();
/** The previous immutable factory remains accessible for existing vaults. */
export const LEGACY_FACTORY_ADDRESS = (raw.VITE_LEGACY_FACTORY_ADDRESS ?? "").trim();
export const LEGACY_FACTORY_DEPLOY_BLOCK = Number(raw.VITE_LEGACY_FACTORY_DEPLOY_BLOCK) || null;
export const WLD_ADDRESS = wldAddress;
export const YIELD_FACTORY_ADDRESS = yieldFactory;
export const MORPHO_VAULT_ADDRESS = morphoVault;
export const YIELD_ENABLED = ADDRESS_RE.test(yieldFactory) && ADDRESS_RE.test(morphoVault);
export const YIELD_FACTORY_DEPLOY_BLOCK = Number(raw.VITE_YIELD_FACTORY_DEPLOY_BLOCK) || null;
export const USDC_ADDRESS = usdc;
export const USDC_YIELD_FACTORY_ADDRESS = usdcFactory;
export const USDC_MORPHO_VAULT_ADDRESS = usdcStrategy;
export const USDC_YIELD_FACTORY_DEPLOY_BLOCK = Number(raw.VITE_USDC_YIELD_FACTORY_DEPLOY_BLOCK) || null;
export const USDC_ENABLED = [usdc, usdcFactory, usdcStrategy].every(value => ADDRESS_RE.test(value) && !/^0x0{40}$/i.test(value));
export const RPC_URL =
  (raw.VITE_RPC ?? "").trim() || "https://worldchain-mainnet.g.alchemy.com/public";

export const REQUIRE_VERIFY = (raw.VITE_REQUIRE_VERIFY ?? "false").trim().toLowerCase() === "true";
export const ACTION_ID = (raw.VITE_WORLD_ACTION_ID ?? "").trim() || "inheritance_access";
export const RELEASE_SUPPORTED =
  (raw.VITE_FACTORY_RELEASE_SUPPORTED ?? "").trim().toLowerCase() === "true";

export const NOTIFY_BACKEND_URL = (raw.VITE_NOTIFY_BACKEND_URL ?? "").trim().replace(/\/+$/, "");
export const NOTIFY_BACKEND_ENABLED = NOTIFY_BACKEND_URL.length > 0;

/**
 * 상속인에게 보낼 링크의 기준 주소.
 *
 * 예전에는 `window.location.origin` 을 그대로 썼다. 문제는 World App 안에서 이 값이
 * **앱의 공개 주소라는 보장이 없다**는 것이다 — 미니앱은 클라이언트가 프록시해서
 * 보여주므로 origin 이 래퍼일 수 있다. 그러면 "Copy link" 로 복사한 것이 래퍼를 가리키고,
 * 상속인이 그 링크를 열면 앱으로 못 가는 링크가 된다. 상속 절차는 **링크가 유일한
 * 전달 수단** 이므로(알림은 상속인이 이 앱을 깔았어야만 닿는다) 이 링크가 틀리면
 * 상속 자체가 성립하지 않는다.
 *
 * 그래서 배포 시 `VITE_APP_ORIGIN` 을 명시한다. 값이 없으면 `window.location.origin`
 * 으로 물러나므로 로컬 개발과 기존 배포는 그대로 동작한다.
 */
export const APP_ORIGIN =
  (raw.VITE_APP_ORIGIN ?? "").trim().replace(/\/+$/, "") ||
  (typeof window !== "undefined" ? window.location.origin : "");

/** 팩토리 배포 블록. 없으면 로그 조회 범위 축소를 위한 폴백 경로를 사용한다. */
export const FACTORY_DEPLOY_BLOCK: number | null = (() => {
  const parsed = Number.parseInt((raw.VITE_FACTORY_DEPLOY_BLOCK ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
})();
