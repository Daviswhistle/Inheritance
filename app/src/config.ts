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
export const WLD_ADDRESS = (raw.VITE_WLD_ADDRESS ?? "").trim();
export const RPC_URL =
  (raw.VITE_RPC ?? "").trim() || "https://worldchain-mainnet.g.alchemy.com/public";

export const REQUIRE_VERIFY = (raw.VITE_REQUIRE_VERIFY ?? "false").trim().toLowerCase() === "true";
export const ACTION_ID = (raw.VITE_WORLD_ACTION_ID ?? "").trim() || "inheritance_access";
export const RELEASE_SUPPORTED =
  (raw.VITE_FACTORY_RELEASE_SUPPORTED ?? "").trim().toLowerCase() === "true";

export const NOTIFY_BACKEND_URL = (raw.VITE_NOTIFY_BACKEND_URL ?? "").trim().replace(/\/+$/, "");
export const NOTIFY_BACKEND_ENABLED = NOTIFY_BACKEND_URL.length > 0;

/** 팩토리 배포 블록. 없으면 로그 조회 범위 축소를 위한 폴백 경로를 사용한다. */
export const FACTORY_DEPLOY_BLOCK: number | null = (() => {
  const parsed = Number.parseInt((raw.VITE_FACTORY_DEPLOY_BLOCK ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
})();
