import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ReactElement } from "react";
import {
  CHAIN_ID,
  CONFIG_ERROR,
  EXPLORER,
  FACTORY_ADDRESS,
  FACTORY_DEPLOY_BLOCK,
  NOTIFY_BACKEND_ENABLED,
  NOTIFY_BACKEND_URL,
  RELEASE_SUPPORTED,
  REQUIRE_VERIFY,
  RPC_URL,
  WLD_ADDRESS,
} from "@/config";
import { signInWithWorldApp, readSessionAddress, clearSession } from "@/auth";
import { walletAuth, sendWorldChainTx, getNotifyPermission, requestNotifyPermission as askNotifyPermission, loadMiniKit, sendWorldChat, pickWorldContacts } from "@/minikit";

// ===== WLD-only factory/vault ABI
//
// 앱이 직접 호출하는 주소는 이 팩토리와 WLD 토큰 **두 곳뿐**이다.
// 월드앱은 전송 전에 대상 컨트랙트를 allowlist 로 검사하고 목록에 없는
// 컨트랙트는 `invalid_contract` 로 막는다. 사용자마다 주소가 다른 금고를 앱이
// 직접 두드리면 목록에 올릴 수 없으므로, 모든 사용자 액션은 팩토리가 중계한다.
// 금고는 calldata 인자로만 전달된다.
const FACTORY_ABI = [
  "event VaultCreated(address indexed owner, address indexed heir, address vault, uint256 heartbeatInterval)",
  "event VaultReleased(address indexed owner, address indexed vault)",
  "function createVault(address heir, uint256 heartbeatInterval) external returns (address)",
  "function vaultOf(address owner) external view returns (address)",
  "function myVault() external view returns (address)",
  "function releaseMyVault() external returns (bool)",
  "function deposit(uint256 amount) external",
  "function pingMyVault() external",
  "function updateMyHeir(address newHeir) external",
  "function changeMyPeriod(uint256 newInterval) external",
  "function cancelMyInheritance() external",
  "function withdrawFromMyVault(address to, uint256 amount) external",
  "function rescueFromMyVault(address token, uint256 amount, address to) external",
  "function sweepSettledVaultFor(address to) external",
  "function fileClaimFor(address vault) external",
  "function finalizeClaimFor(address vault) external",
  "function isHeirOf(address owner, address vault) external view returns (bool)",
];

const VAULT_ABI = [
  "function WLD() view returns (address)",
  "function heir() view returns (address)",
  "function owner() view returns (address)",
  "function factory() view returns (address)",
  "function heartbeatInterval() view returns (uint256)",
  "function lastPing() view returns (uint256)",
  "function deadline() view returns (uint256)",
  "function claimFiledAt() view returns (uint256)",
  "function claimedAt() view returns (uint256)",
  "function CHALLENGE_PERIOD() view returns (uint256)",
  // 만료만으로는 자금이 움직이지 않는다. 아래 세 함수가 상속의 단계를 나타낸다.
  "function ownerStillActive() view returns (bool)",
  "function isExpired() view returns (bool)",
  "function claimPending() view returns (bool)",
  "function challengeRunning() view returns (bool)",
  "function claimableNow() view returns (bool)",
  "function challengeEndsAt() view returns (uint256)",
  "function inheritanceCancelled() view returns (bool)",
  "function timeRemaining() view returns (uint256)",
  "function isSettled() view returns (bool)",
];

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
];

/**
 * 금고가 상속 파이프라인에서处于 어느 단계인지.
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
  { key: "vault", label: "Vault", needsVault: true },
  { key: "money", label: "Send", needsVault: true },
  { key: "inherit", label: "Inherit", needsVault: false },
  { key: "support", label: "Help", needsVault: false },
];


/**
 * World Chain 공개 RPC 의 eth_getLogs 최대 범위(100 블록)보다 여유 있게 잡는다.
 * 이 값을 넘기면 노드가 400 을 반환하고, 오류 메시지에 실제 원인이 담기지 않아
 * 사용자에게 "could not coalesce error" 같은 무의미한 문구만 보인다.
 */
const LOG_SCAN_CHUNK = 90;

const readErrorValue = (error: unknown, key: "reason" | "shortMessage" | "message"): string | undefined => {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : undefined;
};

/**
 * 사용자 모르는 revert 셀렉터를 사람이 읽을 문장으로.
 *
 * 컨트랙트는 상태를 모르는 셀렉터로 거부한다. 사용자는 4바이트를 볼 수 없고, 셀렉터만
 * 던져도 "왜" 를 알 수 없으므로 최소한 "무엇을 하면 되는가" 를 말해야 한다. 일부는
 * 이 앱의 컨트랙트에서 직접 읽어 이름을 되살린다.
 */
const REVERT_HINTS: Record<string, string> = {
  "0x203d82d8": "The countdown has already ended, so this cannot be changed now.",
  "0x0e87a172": "The vault holds a balance. Withdraw or sweep it before releasing the slot.",
  "0x3bd3a771": "Only the vault owner can do this.",
  "0x8419e550": "Only the named heir can do this.",
  "0x49ba9c81": "The vault is not empty yet, so the slot cannot be released.",
  "0x4f109875": "This wallet already has a vault.",
  "0xe6c4247b": "That address is not valid.",
  "0x0b8b7c78": "That renewal period is outside the allowed 1–365 day range.",
  "0xd0404f85": "The countdown has not ended yet.",
  "0xe7c47b46": "That renewal period is outside the allowed 1–365 day range.",
};

/**
 * ethers 의 문구에서 사람이 볼 필요 없는 덩어리를 걷어낸다.
 *
 * ethers v6 의 revert 메시지는 이렇게 생겼다:
 *   `execution reverted (unknown custom error) (action="estimateGas", data="0x203d82d8",
 *    reason=null, transaction={ "data": "0x06c84352…", "from": "0x…", "to": "0x…" },
 *    invocation=null, revert=null, code=CALL_EXCEPTION, version=6.15.0)`
 *
 * 이걸 그대로 토스트에 넣으면 (1) 사용자가 아무것도 할 수 없는 4바이트 셀렉터가 보이고
 * (2) 390px 화면을 넘쳐 **앱 전체가 옆으로 밀린다**(측정: 594px). 그래서 후행 괄호
 * 덩어리를 잘라내고 셀렉터를 문장으로 바꾼다.
 */
const humanizeRevert = (raw: string): string => {
  // `transaction={ … }` 같은 객체 덩어리를 먼저 제거한다.
  let s = raw
    .replace(/\b\w+=\{\s*"[\s\S]*?\}\s*,?/g, "")
    .replace(/\s*,\s*/g, ", ")
    .trim();
  // 남은 `key=value` 목록
  s = s.replace(/\s*\((?:action|reason|invocation|revert|code|version|transaction|data)=[\s\S]*$/i, "").trim();
  s = s.replace(/,?\s*\)$/, "").trim();
  // "unknown custom error" 를 셀렉터로 바꿔 해석한다.
  const sel = s.match(/0x[0-9a-fA-F]{8}/)?.[0]?.toLowerCase();
  if (/unknown custom error/i.test(s) || !/^[A-Za-z]/.test(s)) {
    if (sel && REVERT_HINTS[sel]) return REVERT_HINTS[sel];
    if (sel) return `The contract rejected this (${sel}). Nothing was changed.`;
    return "The contract rejected this. Nothing was changed.";
  }
  if (sel) return `${s.replace(/,?$/, "")} (${sel})`;
  return s;
};

/**
 * 오류에서 사람이 읽을 수 있는 문구를 뽑는다.
 *
 * ethers v6 는 노드의 JSON-RPC 오류를 분류하지 못하면
 * `could not coalesce error` 라는 범용 메시지만 남기고, 진짜 원인은
 * `info.error.message` 안쪽에 숨긴다. 예전 구현은 `reason` 만 읽으므로
 * 사용자에게 "could not coalesce error" 가 그대로 노출됐다.
 * 그래서 중첩 구조를 한 단계 파고들어 본문을 찾는다.
 */
const errorText = (error: unknown, depth = 0): string => {
  const direct =
    readErrorValue(error, "reason") ?? readErrorValue(error, "shortMessage") ?? readErrorValue(error, "message");
  const generic = direct === "could not coalesce error" || direct === "unknown error";
  if (direct && !generic) return humanizeRevert(direct);

  if (depth < 3 && error && typeof error === "object") {
    for (const key of ["info", "error", "cause", "payload"]) {
      const nested = (error as Record<string, unknown>)[key];
      if (nested && typeof nested === "object") {
        const found = errorText(nested, depth + 1);
        if (found && found !== String(nested)) return found;
      }
    }
  }
  if (generic && direct) return `${direct} (see the developer console for details)`;
  return direct ?? String(error);
};

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
  // ---- state
  const [provider, setProvider] = useState<ethers.JsonRpcProvider | null>(null);
  // signer 경로는 비활성 (World App 내부에서만 실행)
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [account, setAccount] = useState<string>("");
  // Username (World App handle) — used for display; addresses are used on-chain
  const [username, setUsername] = useState<string>("");

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
  const [periodTouched, setPeriodTouched] = useState<boolean>(false);
  const onPeriodChange = (raw: string) => {
    // allow only digits; keep empty while editing
    const v = (raw || '').replace(/\D+/g, '');
    setPeriodInput(v);
      setPeriodTouched(true);
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
  const [vaultOwner, setVaultOwner] = useState<string>("");
  const [vaultHeir, setVaultHeir] = useState<string>("");
  const [vaultHeartbeat, setVaultHeartbeat] = useState<number>(0);
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

  /**
   * 실제로 보여줄 탭.
   *
   * 금고가 없으면 Vault/Send 는 내용이 없으므로 감춘다. 기본 탭을 "inherit" 로 둔
   * 이유도 이것이다 — 첫 진입 사용자가 보게 되는 화면이 곧 "금고 만들기" 여야
   * 하고, 아무것도 없는 화면을 먼저 보여주면 무엇을 해야 하는지 알 수 없다.
   *
   * 금고가 슬롯 해제 등으로 사라지면 현재 탭이 보이지 않게 되므로 Inherit 로 되돌린다.
   */
  const visibleTabs = vault ? TABS : TABS.filter((t) => !t.needsVault);
  /** 현재 탭에 실제 카드가 하나라도 있는지. 금고 로딩 중이거나 조건이 어긋난 경우를 잡는다. */
  const tabHasContent =
    tab === "support" || tab === "inherit" || Boolean(vault);
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
  const [challengeEndsAt, setChallengeEndsAt] = useState<number>(0);
  /** 최종 수령이 지금 가능한 상태인지 (= 이의제기 기간이 지났고 신청이 들어옴). */
  const canClaim = vaultPhase === "claimable";
  /** 상속인이 신청만 하고 아직 이의제기 기간이 남은 상태. */
  const challengeRunning = vaultPhase === "challenging";
  /** 기한이 지났지만 상속인이 아직 신청하지 않은 상태. */
  const awaitingClaim = vaultPhase === "expired";
  const inheritanceCancelled = vaultPhase === "cancelled";
  const isSettledClaim = vaultPhase === "settled";
  /**
   * 기한이 지나 상속 파이프라인이 시작된 상태인가.
   *
   * ownerWithdraw / cancelInheritance / period 변경 / heir 변경은 기한 이후 전부 revert 된다.
   * 예전처럼 `canClaim`(이의제기 종료) 만으로 게이트하면 7일 창이 열려 있는 동안
   * 항상 실패하는 버튼을 사용자에게 활성화해 보낸다. 신청 대기(`expired`) 와
   * 이의제기 중(`challenging`) 을 모두 포함시켜야 한다.
   */
  const isExpiredOrLater = awaitingClaim || challengeRunning || canClaim || isSettledClaim;
  /** 이의제기 기간의 남은 초. 0 아래로 내려가지 않게 한다. */
  const challengeRemaining = Math.max(0, challengeEndsAt - Math.floor(Date.now() / 1000));
  /** 이의제기 기간(일). 컨트랙트 상수를 읽되 실패하면 기본값으로 버틴다. */
  const [challengeDays, setChallengeDays] = useState(7);

  const [wldSymbol, setWldSymbol] = useState("WLD");
  const [wldDecimals, setWldDecimals] = useState(18);
  const [walletWld, setWalletWld] = useState<bigint>(0n);
  const [vaultWld, setVaultWld] = useState<bigint>(0n);
  const [amountStr, setAmountStr] = useState("");
  const [withdrawTo, setWithdrawTo] = useState<string>("");
  const [withdrawAmountStr, setWithdrawAmountStr] = useState<string>("");
  const [newHeir, setNewHeir] = useState<string>("");
  const [newHeirResolved, setNewHeirResolved] = useState<{ username?: string; address?: string } | null>(null);
  const [resolvingNewHeir, setResolvingNewHeir] = useState<boolean>(false);
  const heirSeqRef = useRef<number>(0);
  const newHeirSeqRef = useRef<number>(0);
  const toastSeqRef = useRef<number>(0);
  const [copied, setCopied] = useState<null | "vault" | "owner" | "heir" | "wld">(null);
  const [supportsRelease, setSupportsRelease] = useState<boolean>(RELEASE_SUPPORTED);
  const [showReleaseConfirm, setShowReleaseConfirm] = useState<boolean>(false);
  const [releasing, setReleasing] = useState<boolean>(false);
  const [sweeping, setSweeping] = useState<boolean>(false);
  const [releaseAcknowledge, setReleaseAcknowledge] = useState<boolean>(false);
  const [ctaLoading, setCtaLoading] = useState<boolean>(false);
  const [heirFoundVaults, setHeirFoundVaults] = useState<string[]>([]);
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
  const [notifyWatchState, setNotifyWatchState] = useState<WatchState>("unknown");
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
    // 버튼을 화면 아래로 밀어낸다. "무엇이 되고 있지 않은가" + "그래서 무엇을 놓치는가"
    // 만 남기고 나머진 Help 탭으로 보낸다.
    const NOBODY = "nobody will be told";
    if (notifyPermission === "denied") {
      return { level: "broken" as const, text: `World App is blocking notifications — ${NOBODY} if you stop renewing.` };
    }
    if (notifyPermission !== "granted") {
      return { level: "off" as const, text: `Notifications are off — ${NOBODY} if you stop renewing.` };
    }
    if (notifyWatchState === "not_registered") {
      return { level: "broken" as const, text: `This vault is not being watched — ${NOBODY} about it.` };
    }
    if (notifyWatchState === "registered") {
      if (notifyDeliveryNote) {
        return {
          level: "broken" as const,
          text: `World App took the request but did not deliver it (${notifyDeliveryNote}) — ${NOBODY}.`,
        };
      }
      return { level: "ok" as const, text: "You and your heir are told before the countdown ends and at each claim step." };
    }
    return { level: "checking" as const, text: "Checking notification status…" };
  }, [NOTIFY_BACKEND_ENABLED, notifyPermission, notifyWatchState, notifyDeliveryNote]);

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
    params: { address?: string; topics?: (string | null | string[])[]; toBlock?: number | string }
  ): Promise<ethers.Log[]> => {
    const head = await p.getBlockNumber();
    const to = typeof params.toBlock === "number" ? params.toBlock : head;
    const from = FACTORY_DEPLOY_BLOCK ?? Math.max(0, head - 20_000);
    if (to < from) return [];

    const out: ethers.Log[] = [];
    // 실패한 청크는 조용히 건너뛴다 — 한 청크가 막혀도 나머지는 쓸 수 있다.
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
        // 다음 청크로 진행
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
  const waitForTxOrEvent = async (
    prov: ethers.AbstractProvider,
    opts: { txHash?: string; confirmations?: number; timeoutMs?: number; intervalMs?: number; check?: () => Promise<boolean> }
  ) => {
    const { txHash, confirmations = 1, timeoutMs = 60_000, intervalMs = 1500, check } = opts || {};
    const deadline = Date.now() + timeoutMs;

    // 1) 트랜잭션 해시가 있으면 먼저 온체인 포함(confirm)까지 대기한다.
    let receipt: ethers.TransactionReceipt | null = null;
    if (txHash && /^0x([A-Fa-f0-9]{64})$/.test(txHash)) {
      receipt = await prov.waitForTransaction(txHash, confirmations);
      if (!receipt || receipt.status !== 1) throw new Error("Transaction reverted or missing receipt");
    }

    // 2) `check` 는 상태 변화(잔액 증가 등)를 확인하는 후속 조건이다.
    //    이전에는 해시가 있는 정상 경로에서 아예 실행되지 않아,
    //    QA 체크리스트의 "금고 잔액이 늘어날 때까지 대기"가 사실상 동작하지 않았다.
    if (check) {
      while (Date.now() < deadline) {
        try {
          if (await check()) return true;
        } catch {
          // 폴링 중 일시적인 RPC 오류는 무시한다.
          void 0;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      // 트랜잭션 자체는 성공했을 수 있으므로, 이 경우를 "실패"로 뭉개지 않는다.
      if (receipt) {
        console.warn("State check timed out, but the transaction was confirmed on-chain.");
        return true;
      }
      throw new Error("Timed out waiting for on-chain confirmation");
    }
    return true;
  };
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
  const validDecimalInput = (s: string) => /^\d*(?:\.\d*)?$/.test(s);
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
  const isMyVault = Boolean(vaultOwner) && account.toLowerCase() === vaultOwner.toLowerCase();

  /**
   * 남은 시간에 따른 시각적紧急度.
   *
   * 이 앱은 사용자가 매 주기마다 자금을 "회수당할 위험"에 두게 한다. 그래서
   * 기한이 임박했을 때 화면이 조용하면 사용자가 그대로 잊어버리고 자금을 잃는다.
   * 주기 대비 비율로 판단한다 — 30일 주기면 3일/1일 남았을 때 경고.
   */
  const timerUrgency = useMemo(() => {
    if (canClaim) return "timer-expired";
    const period = vaultHeartbeat || 1;
    const ratio = timeRemaining / period;
    if (ratio <= 0.05) return "timer-critical";
    if (ratio <= 0.2) return "timer-urgent";
    return "";
  }, [canClaim, timeRemaining, vaultHeartbeat]);

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

  const refreshNotifyPermission = useCallback(async () => {
    if (!miniInstalled) {
      setNotifyPermission("unknown");
      return;
    }
    // 알림 권한 조회는 앱 전체를 막지 않는다. 실패해도 "모름" 으로 두고 진행한다.
    // minikit.ts 가 MiniKit 2.x 의 `data.permissions` 감싸짐을 풀어 준다. 예전에는
    // 최상위 `permissions` 를 읽었는데 거기엔 없고 `data` 안에만 있어서 값이 항상
    // undefined 였다 — 권한을 켜도 화면이 "꺼짐" 으로 남았다.
    const res = await getNotifyPermission();
    if (res) {
      setNotifyPermission(res.notifications ? "granted" : "denied");
    } else {
      setNotifyPermission("unknown");
    }
  }, [miniInstalled]);

  const requestNotifyPermission = async () => {
    if (!miniInstalled) {
      pushToast("error", "Open in World App first.");
      return;
    }
    setNotifyBusy(true);
    try {
      const res = (await askNotifyPermission()) as { description?: string } | null;
      if (res) {
        pushToast("success", "Notifications enabled for this wallet.");
      } else {
        pushToast("error", "Notification permission was not granted.");
      }
    } catch (e: unknown) {
      pushToast("error", "Permission error: " + errorText(e));
    } finally {
      await refreshNotifyPermission();
      setNotifyBusy(false);
    }
  };

  const refreshNotifyWatchState = useCallback(async () => {
    if (!NOTIFY_BACKEND_ENABLED || !vault) {
      setNotifyWatchState("unknown");
      return;
    }
    try {
      const url = `${NOTIFY_BACKEND_URL}/api/notifications/status?vaultAddress=${encodeURIComponent(vault)}`;
      const res = await fetch(url, { method: "GET" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.status === "success") {
        setNotifyWatchState(data?.watcher?.active ? "registered" : "not_registered");
        return;
      }
      setNotifyWatchState("unknown");
    } catch {
      setNotifyWatchState("unknown");
    }
  }, [vault]);

  const registerWatcher = async (
    vaultAddress: string,
    ownerAddress: string,
    heirAddress: string,
    silent = false,
  ) => {
    const res = await fetch(`${NOTIFY_BACKEND_URL}/api/notifications/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaultAddress,
        ownerAddress,
        heirAddress,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.status !== "success") {
      throw new Error(data?.message || "Failed to register notification watcher");
    }
    setNotifyWatchState("registered");
    if (!silent) pushToast("success", "Vault registered. You and your heir will be notified.");
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
    if (account.toLowerCase() !== vaultOwner.toLowerCase()) {
      pushToast("error", "Only the owner can register alerts for this vault.");
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
      const res = await fetch(`${NOTIFY_BACKEND_URL}/api/notifications/test`, {
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
   * 그 값은任何人이든 브라우저에서 고칠 수 있으므로, **서버가 검증한 세션만**
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
  const factory = useMemo(() => {
    const rw = provider; // read-only provider
    return rw ? new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, rw) : null;
  }, [provider]);
  const vaultCtr = useMemo(() => {
    const rw = provider; // read-only provider
    return rw && vault ? new ethers.Contract(vault, VAULT_ABI, rw) : null;
  }, [provider, vault]);

  const loadVault = useCallback(async () => {
    if (!factory || !account) return;
    try {
      const v = await factory.vaultOf(account);
      if (v && v !== ethers.ZeroAddress) {
        setOwnVault(v);
        // 링크 금고가 우선이다. 상속인에게 보낸 링크를 열었는데 자기 금고로 되돌아가면
        // 링크가 준 정보가 사라진다. 어느 쪽을 보는지는 화면에 알려준다.
        if (!linkedVault) setVault(v);
        setStale(true);
        return;
      }
      setOwnVault("");
      // 금고가 없는 경우에도 읽기는 성공했다. 배너를 여기서 지워야 연결이 복구됐을 때
      // 금고가 없는 사람에게도 배너가 영구히 남지 않는다 (refreshVaultDetails 는
      // `!vaultCtr` 이면 즉시 반환하므로 이 경로가 그 일을 대신한다).
      setStale(true);
    } catch (e: unknown) {
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
  }, [factory, account, linkedVault]);

  // Username/address resolution helpers — accept @username or 0x… in inputs
  const getUsernameFor = async (addr: string) => {
    try {
      const { MiniKit } = await loadMiniKit();
      const u = await MiniKit.getUserByAddress?.(addr);
      return u?.username as string | undefined;
    } catch {
      return undefined;
    }
  };
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

  useEffect(() => { if (factory && account) loadVault(); }, [factory, account, loadVault]);

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
    try {
      const [o, h, hb, lp] = await Promise.all([
        vaultCtr.owner(),
        vaultCtr.heir(),
        vaultCtr.heartbeatInterval(),
        vaultCtr.lastPing(),
      ]);
      setVaultOwner(o);
      setVaultHeir(h);
      setVaultHeartbeat(Number(hb));
      // 주기 입력 필드를 실제 값으로 맞춘다. 사용자가 편집 중이면 건드리지 않는다.
      //
      // **금고가 없을 때(heartbeat = 0) 는 30일로 채워야 한다.** 이 필드를 처음엔
      // 고정값 "30" 으로 시작했다가 "실제 값으로 시드" 하도록 바꿨는데, 금고가 없는
      // 사용자에게는 시드할 값이 없으므로 필드가 빈 채로 남는다. 그러면 periodValid 가
      // false 고 "Create vault" 버튼이 **영영 활성화되지 않는다** — 아무도 금고를 만들
      // 수 없는 상태였다. 로컬 E2E 는 캐스트로 금고를 만들어서 이 경로를 안 밟았다.
      if (!periodTouched) {
        const days = Math.round(Number(hb) / 86400);
        setPeriodInput(String(days > 0 ? days : 30));
      }
      setVaultLastPing(Number(lp));
      // 수금처 기본값은 "한 번만" 채운다. `withdrawTo` 를 deps 에 두면
      // 입력할 때마다 콜백이 재생성되어 이 effect 가 keystale 마다 다시 돌고,
      // 사용자가 필드를 지우면 즉시 소유자 주소로 되돌아가 비워둘 수 없게 된다.
      setWithdrawTo((prev) => prev || o);
      setStale(true);
    } catch {
      // 읽기가 실패했다. 예전에는 여기서 조용히 넘어갔고, 그래서 화면은 갱신되지 않은
      // 채로 남아 있었다. 사용자는 그 정체를 "내 돈이 사라졌다" 로 읽는다 — 실제로는
      // RPC 가 죽은 것뿐인데도 말이다. 지금 데이터가 최신이 아니라는 사실을 말해야 한다.
      setStale(false);
    }
  }, [vaultCtr, periodTouched]);
  useEffect(() => { if (vaultCtr) void refreshVaultDetails(); }, [vaultCtr, refreshVaultDetails]);

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
          address: FACTORY_ADDRESS,
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
  }, [vault, signer, provider, vaultOwner, vaultHeir, account]);
  useEffect(() => { if (vault) loadVaultCreationMeta(); }, [vault, loadVaultCreationMeta]);

  // ---- balances & timer
  const refreshBalances = useCallback(async () => {
    if (!provider || !account) return;
    try {
      const token = new ethers.Contract(WLD_ADDRESS, ERC20_ABI, provider);
      const [sym, dec, userBal, vaultBal] = await Promise.all([
        token.symbol(), token.decimals(),
        token.balanceOf(account), vault ? token.balanceOf(vault) : Promise.resolve(0n)
      ]);
      setWldSymbol(sym);
      // ethers v6 는 uint8 반환값을 bigint 로 준다. 상태는 number 로 선언돼 있으므로
      // 그대로 넣으면 아래 parseAmount 의 `"0".repeat(wldDecimals)` 가
      // "Cannot convert a BigInt value to a number" 로 터져 입금이 전부 실패한다.
      setWldDecimals(Number(dec));
      setWalletWld(userBal); setVaultWld(vaultBal);
    } catch (e: unknown) {
      // 주기적으로 호출되므로 조용히 실패시킨다. 단, unhandled rejection 으로
      // 개발자 콘솔을 오염시키거나 모바일 웹뷰에서 경고를 남기지는 않는다.
      console.warn("refreshBalances failed:", errorText(e));
    }
  }, [provider, account, vault]);
  useEffect(() => { void refreshBalances(); }, [refreshBalances]);
  useEffect(() => {
    if (!provider || !account) return;
    const id = setInterval(() => { void refreshBalances(); }, 30000);
    const onVis = () => { if (document.visibilityState === 'visible') void refreshBalances(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [provider, account, refreshBalances]);

  const refreshTimer = useCallback(async () => {
    if (!vaultCtr) return;
    try {
      const rem: bigint = await vaultCtr.timeRemaining();
      // 상속 상태를 한 번에 읽어 단계로 정리한다. 이 RPC 묶음은 UI 의 모든
      // 분기를 결정하므로 일부가 실패하면 안 된다.
      const [
        ownerActive,
        expired,
        pending,
        challenging,
        finalizable,
        claimedAt,
        cancelled,
        challengeEnd,
      ] = await Promise.all([
        vaultCtr.ownerStillActive(),
        vaultCtr.isExpired(),
        vaultCtr.claimPending(),
        vaultCtr.challengeRunning(),
        vaultCtr.claimableNow(),
        vaultCtr.claimedAt(),
        vaultCtr.inheritanceCancelled(),
        vaultCtr.challengeEndsAt(),
      ]);
      const phase: VaultPhase = cancelled
        ? "cancelled"
        : claimedAt > 0n
          ? "settled"
          : finalizable
            ? "claimable"
            : challenging
              ? "challenging"
              : pending
                ? "challenging"
                : expired
                  ? "expired"
                  : ownerActive
                    ? "active"
                    : "expired";
      setVaultPhase(phase);
      setChallengeEndsAt(Number(challengeEnd));
      try {
        const cp: bigint = await vaultCtr.CHALLENGE_PERIOD();
        setChallengeDays(Math.round(Number(cp) / 86400));
      } catch {
        setChallengeDays(7);
      }
      setTimeRemaining(Number(rem));
      setStale(true);
    } catch (e: unknown) {
      // 이 함수가 15초마다 도는 폴이다. 즉 사용자가 체인을 잃었을 때 가장 먼저, 가장
      // 자주 잡히는 지점이다. 예전에는 여기서 console.warn 만 남기고 조용히 넘어갔다.
      // 그러면 화면은 갱신되지 않은 숫자를 정답처럼 보여주고, 사용자는 그걸 "내 갱신이
      // 반영되지 않았다" 또는 "내 돈이 사라졌다" 고 읽는다. 연결이 끊겼다는 사실을
      // 말하는 유일한 기회인데, 말할 수 있는 곳이 아니었다.
      setStale(false);
      console.warn("refreshTimer failed:", errorText(e));
    }
  }, [vaultCtr]);
  useEffect(() => { if (vaultCtr) void refreshTimer(); }, [vaultCtr, refreshTimer]);
  useEffect(() => {
    if (!vaultCtr) return;
    const id = setInterval(() => { refreshTimer(); }, 15000);
    const onVis = () => { if (document.visibilityState === 'visible') refreshTimer(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [vaultCtr, refreshTimer]);

  // ---- create vault
  const createVault = async () => {
    if (!factory) { setStatus("Connect first"); return; }
    if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
    // Prevent double-create: factory enforces 1-per-owner and will revert with ALREADY_HAS_VAULT
    if (isMyVault) { setStatus("You already have a vault. Use it or release after expiry."); pushToast('info', 'Vault already exists'); return; }
    const resolved = heirResolved || await resolveHeirInput(heir);
    if (!resolved?.address) { setStatus("Enter a valid heir username or address"); return; }
    // 0x0 은 컨트랙트에서 InvalidAddress 로 거절된다.
    // 경고만 띄우고 버튼을 활성화해 두면 반드시 실패하는 트랜잭션이 만들어진다.
    if (resolved.address === ethers.ZeroAddress) {
      setStatus("Heir cannot be the zero address");
      pushToast('error', 'Heir cannot be the zero address');
      return;
    }
    const days = periodNum;
    if (!periodValid) { setStatus("Period must be between 1 and 365 days."); return; }
    const seconds = BigInt(days) * 24n * 60n * 60n;
    try {
      const sent = await sendWorldChainTx([
        {
          address: FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: "createVault",
          args: [resolved.address, seconds.toString()],
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
        check: async () => {
          const vchk = await factory.vaultOf(account);
          return vchk && vchk !== ethers.ZeroAddress;
        },
      });
      setStatus("Vault created");
      const v = await factory.vaultOf(account);
      setVault(v);
      if (NOTIFY_BACKEND_ENABLED && v && v !== ethers.ZeroAddress) {
        try {
          await registerWatcher(v, account, resolved.address, true);
        } catch {
          // Notification watcher registration is optional.
          void 0;
        }
      }
      refreshBalances(); refreshTimer();
    } catch (e: unknown) {
      const raw = errorText(e);
      let friendly = raw;
      if (/ALREADY_HAS_VAULT/i.test(raw)) friendly = 'You already have a vault (factory is one-per-owner).';
      else if (/HeartbeatOutOfRange/i.test(raw)) friendly = 'Period must be 1–365 days.';
      else if (/InvalidAddress/i.test(raw)) friendly = 'Invalid heir address.';
      else if (/insufficient funds/i.test(raw)) friendly = 'Insufficient gas on World Chain (ETH needed for fees).';
      setStatus("Create error: " + friendly);
      pushToast('error', friendly);
    }
  };

  // ---- 주인이 상속인에게 보낼 링크/문구
  //
  // 월드앱 알림은 이 미니앱을 설치하지 않은 지갑에 도달하지 못한다. 그래서
  // 상속인이 알게 되는 유일한 확실한 경로는 주인이 직접 보내는 링크다.
  // 앱이 설치되어 있든 없든 이 링크는 통한다.
  const heirLink = vault ? `${window.location.origin}/?vault=${vault}` : "";
  const heirMessage = vault && vaultHeir
    ? [
        `You are named as the heir of a WLD vault.`,
        ``,
        `Open this link in World App to see it: ${heirLink}`,
        ``,
        `What it means: if the person who named you stops renewing it, the countdown ends and nothing`,
        `moves on its own. You would file a claim, they would then have 7 days to renew and stop it,`,
        `and only after those 7 days could you withdraw. If you have not been contacted before that`,
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
        "Join me on a WLD inheritance vault in World App.",
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
    try {
      const p = (signer?.provider as ethers.AbstractProvider | null) ?? provider;
      if (!p) return;
      const sig = ethers.id("VaultCreated(address,address,address,uint256)");
      const heirTopic = ethers.zeroPadValue(ethers.getAddress(account), 32);
      const logs = await safeGetLogs(p, {
        address: FACTORY_ADDRESS,
        topics: [sig, null, heirTopic],
        toBlock: "latest",
      });
      const iface = new ethers.Interface(FACTORY_ABI);
      const vaults: string[] = [];
      for (const lg of logs) {
        try {
          const parsed = iface.parseLog({ topics: lg.topics, data: lg.data });
          const v = String(parsed?.args?.[2] || "");
          if (v && !vaults.includes(v)) vaults.push(v);
        } catch {
          // Skip malformed logs.
          void 0;
        }
      }
      setHeirFoundVaults(vaults);
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
        pushToast('info', 'No vaults found where you are heir.');
      }
    } catch (e: unknown) {
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
   * 금고가 없는데 상속 신청权的 존재를 알아야 하기 때문이다. 그래서 결과가 있으면
   * 맨 위로 올린다.
   *
   * 반대로 아무것도 없는 사람에게는 질문할 이유가 없다. 화면에 "No vault names you as
   * heir" 가 남으면 "내가 뭘 놓치고 있나" 하는 불안을 만들고, 정작 해야 할 일
   * (금고 만들기)을 화면 아래로 민다.
   *
   * 스캔 중에는 짧은 줄로 자리 잡고, 결과를 받았는데 아무것도 없으면 완전히 감춘다.
   */
  const notifyHeirWorthShowing = findingHeirVaults || heirFoundVaults.length > 0 || !heirScanAttempted;

  const heirStatusCard = gate2(
    <Card>
      <CardHeader><CardTitle>Are you named as someone&apos;s heir?</CardTitle></CardHeader>
      <CardContent className="grid gap-2">
        <div className="text-xs text-gray-600">
          This app checks the chain for you as soon as you open it. Scanning reads the
          factory&apos;s history, so it takes a moment.
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
                Nothing is owed to you until the countdown runs out and you file — see the Inherit tab.
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
            <div className="text-sm font-medium">No vault names you as heir.</div>
          )
        ) : null}
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={findHeirVaults} disabled={findingHeirVaults}>
            {findingHeirVaults ? "Searching..." : "Check again"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  // ---- deposit WLD
  const deposit = async () => {
    if (!vault) return;
    if (!amountStr) { setStatus("Enter amount"); return; }
    if (!validDecimalInput(amountStr)) { setStatus("Enter a valid decimal amount"); return; }
    const amt = parseAmount(amountStr);
    if (amt <= 0n) { setStatus("Enter amount greater than 0"); return; }
    if (amt > walletWld) { setStatus("Amount exceeds wallet balance"); return; }
    try {
      if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
      // 순서가 의미를 갖는다: approve 가 먼저여야 deposit 의 transferFrom 이
      // 토큰을 꺼낼 수 있다. 월드앱은 승인 직후 자동으로 철회하므로 남은
      // allowance 가 없다는 오류가 나면 이 두 건의 순서를 확인한다.
      const sent = await sendWorldChainTx([
        {
          address: WLD_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [FACTORY_ADDRESS, amt.toString()],
        },
        {
          address: FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: "deposit",
          args: [amt.toString()],
        },
      ]);
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
        check: async () => {
          const token = new ethers.Contract(WLD_ADDRESS, ERC20_ABI, provider);
          const vb: bigint = await token.balanceOf(vault);
          return vb > prev;
        },
      });
      setStatus("Deposit complete");
      setAmountStr("");
      refreshBalances();
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
      const sent = await sendWorldChainTx([{  address: FACTORY_ADDRESS, abi: FACTORY_ABI, functionName: "pingMyVault", args: []  }]);
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
  const changePeriod = async () => {
    if (!vaultCtr) return;
    if (!periodValid) { setStatus('Period must be between 1 and 365 days.'); return; }
    const seconds = BigInt(periodNum) * 24n * 60n * 60n;
    try {
      if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
      const sent = await sendWorldChainTx([{  address: FACTORY_ADDRESS, abi: FACTORY_ABI, functionName: "changeMyPeriod", args: [seconds.toString()]  }]);
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
        check: async () => {
          const hb: bigint = await vaultCtr.heartbeatInterval();
          return Number(hb) === Number(seconds);
        },
      });
      setStatus("Period updated");
      // 액션이 체인 상태를 바꿨으므로 다시 읽는다. 이게 없으면 사용자가 자기 행동을 한 뒤에도
      // 화면이 이전 값("Last ping", "Heartbeat", "Expires") 을 보여준다.
      void refreshVaultDetails();
      setPeriodTouched(false);
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
      const sent = await sendWorldChainTx([{  address: FACTORY_ADDRESS, abi: FACTORY_ABI, functionName: "cancelMyInheritance", args: []  }]);
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
    try {
      if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
      const sent = await sendWorldChainTx([{  address: FACTORY_ADDRESS, abi: FACTORY_ABI, functionName: "updateMyHeir", args: [resolved.address]  }]);
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
      const sent = await sendWorldChainTx([{  address: FACTORY_ADDRESS, abi: FACTORY_ABI, functionName: "fileClaimFor", args: [vault]  }]);
      if (!sent.ok) {
        setStatus(sent.error);
        if (sent.userFacing) pushToast("error", sent.error);
        return;
      }
      setStatus("Request filed. The owner has 7 days to renew before you can withdraw.");
      // 액션이 체인 상태를 바꿨으므로 다시 읽는다. 이게 없으면 사용자가 자기 행동을 한 뒤에도
      // 화면이 이전 값("Last ping", "Heartbeat", "Expires") 을 보여준다.
      void refreshVaultDetails();
      const prov = getRwProvider();
      const txh = sent.tx.hash;
      await waitForTxOrEvent(prov, {
        txHash: txh,
        check: async () => await vaultCtr.claimPending(),
      });
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
      const sent = await sendWorldChainTx([{  address: FACTORY_ADDRESS, abi: FACTORY_ABI, functionName: "finalizeClaimFor", args: [vault]  }]);
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
        check: async () => {
          const token = new ethers.Contract(WLD_ADDRESS, ERC20_ABI, provider);
          const vb: bigint = await token.balanceOf(vault);
          // claim 은 금고를 0 으로 만든다. 잔액이 아직 로드되지 않은 경우
          // (prev === 0) `vb < prev` 는 절대 참이 될 수 없어 60초 폴링 후
          // 타임아웃으로 사용자에게 실패를 보고하게 된다. 0 도달 여부로 판정한다.
          return vb === 0n || vb < prev;
        },
      });
      setStatus("Claim complete");
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
    if (amt > vaultWld) { setStatus("Amount exceeds vault balance"); return; }
    try {
      if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
      const sent = await sendWorldChainTx([{  address: FACTORY_ADDRESS, abi: FACTORY_ABI, functionName: "withdrawFromMyVault", args: [withdrawTo, amt.toString()]  }]);
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
        check: async () => {
          const token = new ethers.Contract(WLD_ADDRESS, ERC20_ABI, provider);
          const vb: bigint = await token.balanceOf(vault);
          // 인출 전 잔액을 모르는 상태(prev === 0)라면 비교 기준이 없다.
          // 이 경우 레시트 확인만으로 성공을 확정한다 (아래 waitForTxOrEvent 참조).
          if (prev === 0n) return true;
          return vb < prev;
        },
      });
      setStatus("Withdraw complete");
      // 액션이 체인 상태를 바꿨으므로 다시 읽는다. 이게 없으면 사용자가 자기 행동을 한 뒤에도
      // 화면이 이전 값("Last ping", "Heartbeat", "Expires") 을 보여준다.
      void refreshVaultDetails();
      setWithdrawAmountStr("");
      refreshBalances();
    } catch (e: unknown) {
      setStatus("Withdraw error: " + errorText(e));
      pushToast('error', errorText(e));
    }
  };

  const setWithdrawMax = () => setWithdrawAmountStr(fmtUnits(vaultWld, wldDecimals));
  const setWithdrawToMe = () => {
    if (account) setWithdrawTo(account);
    else if (vaultOwner) setWithdrawTo(vaultOwner);
  };

  const releaseSlot = async () => {
    if (!factory) return;
    setReleasing(true);
    let ok = false;
    try {
      if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
      const sent = await sendWorldChainTx([{  address: FACTORY_ADDRESS, abi: FACTORY_ABI, functionName: "releaseMyVault", args: []  }]);
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
        check: async () => {
          const v = await factory.vaultOf(account);
          return !v || v === ethers.ZeroAddress;
        },
      });
      setStatus("Released. You can create a new vault.");
      // 액션이 체인 상태를 바꿨으므로 다시 읽는다. 이게 없으면 사용자가 자기 행동을 한 뒤에도
      // 화면이 이전 값("Last ping", "Heartbeat", "Expires") 을 보여준다.
      void refreshVaultDetails();
      setVault("");
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
      const sent = await sendWorldChainTx([{  address: FACTORY_ADDRESS, abi: FACTORY_ABI, functionName: "sweepSettledVaultFor", args: [account]  }]);
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
        check: async () => {
          const token = new ethers.Contract(WLD_ADDRESS, ERC20_ABI, provider);
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
  return (
    <div className="app-shell bg-gradient-to-b from-slate-50 to-slate-100">
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
      <header className="sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-white/70 border-b border-slate-200">
        <div className="container-narrow flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded bg-brand-600" />
            <div className="text-sm font-semibold tracking-tight">WLD Inheritance</div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="hidden sm:inline">World Chain</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5">{badge(`Chain: ${CHAIN_ID}`, 'gray')}</span>
          </div>
        </div>
      </header>
      {/* 하단 탭 바가 fixed 이므로, 마지막 카드가 그 아래로 깔리지 않도록
          콘텐츠 쪽에 바 높이 + 여백만큼의 하단 패딩을 준다. */}
      <div className="container-narrow px-4 py-4 md:py-6 tab-pb grid gap-4">
        {/* 헤더. 로그인 상태와 탭마다 반복되므로 카드 한 장을 쓰지 않고 한 줄로 줄인다.
            카드 4개(헤더/타이머/입금/고객센터)를 한 화면에 넣으려면 이게 전부 필요했다. */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            {account ? (
              <>
                <div className="text-sm font-semibold truncate">
                  {username ? `@${username}` : short(account)}
                </div>
                <div className="text-xs text-gray-500">
                  Connected{inheritanceCancelled ? " · inheritance cancelled" : ""}
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-semibold">WLD Inheritance</div>
                <div className="text-xs text-gray-500">Connect to get started</div>
              </>
            )}
          </div>
          {/* 서버 검증 여부를 숨기지 않는다. 서명이 서버에서 확인되지 않은
              세션으로는 자금을 다루는 행동을 하지 않도록 배지를 남긴다. */}
          {account && (!REQUIRE_VERIFY || verified) ? (
            <span className="text-xs text-gray-500 shrink-0">
              {serverVerified ? "World App" : "Not verified"}
            </span>
          ) : (
            <Button
              variant="primary"
              onClick={continueWorldApp2}
              disabled={ctaLoading}
              className="shrink-0"
            >
              {ctaLoading ? (<><span className="spinner mr-2"></span>Connecting...</>) : "Connect"}
            </Button>
          )}
        </div>

        {/* 연결이 끊기면 화면이 멈춘다. 예전에는 여기에 아무 표시가 없어서 사용자가
            "내 갱신이 반영되지 않았다", 혹은 더 나쁘게 "내 돈이 사라졌다" 고 읽었다.
            온체인 상태는 그대로인데 화면만 멈춘 것임을 분명히 해야 한다. */}
        {!stale && account && (
          <div
            className="text-xs text-yellow-800 bg-yellow-50 border border-yellow-200 rounded py-2 px-3"
            role="status"
            aria-live="polite"
          >
            Not connected to World Chain right now, so the numbers below may be out of date.
            Your funds are unaffected on-chain. Pull to retry, or reopen the app.
          </div>
        )}

        {/* 8개 트랜잭션 플로우 전부의 결과/오류 채널.
            스크린 리더 사용자에게 읽히도록 live region 이 필요하다. */}
        {status && (
          <div className="text-xs text-gray-600" role="status" aria-live="polite" aria-atomic="true">
            {status}
          </div>
        )}

        {/* ===== Send 탭: 자금 흐름 ===== */}
        {tab === "money" && vault && gate2(
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>Vault & Send</CardTitle>
                <div className="flex items-center gap-2">
                  {account && vaultOwner && account.toLowerCase() === vaultOwner.toLowerCase() && badge("Owner", "blue")}
                  {account && vaultHeir && account.toLowerCase() === vaultHeir.toLowerCase() && badge("Heir", "purple")}
                  {(() => {
                    if (vaultHeir && vaultOwner && vaultHeir.toLowerCase() === vaultOwner.toLowerCase()) return badge("Inheritance cancelled", "yellow");
                    if (canClaim) return badge("Claimable", "green");
                    if (timerUrgency === "timer-critical") return badge("Renew urgently", "yellow");
                    if (timerUrgency === "timer-urgent") return badge("Renew soon", "yellow");
                    return badge("Active", "gray");
                  })()}
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="text-sm grid gap-1">
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
                  <div><b>{vaultHeir ? short(vaultHeir) : '-'}</b></div>
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
                <div>Heartbeat: <b>{vaultHeartbeat ? Math.floor(vaultHeartbeat / 86400) : 0} days</b></div>
                <div>Last ping: <b>{vaultLastPing ? new Date(vaultLastPing * 1000).toLocaleString() : "-"}</b></div>
                <div>
                  Token (WLD):
                  {WLD_ADDRESS ? (
                    <>
                      <button className="ml-1 underline text-blue-700 break-all" onClick={() => copyText(WLD_ADDRESS, "wld")}>{short(WLD_ADDRESS)}</button>
                      {copied === "wld" && <span className="ml-2 text-green-700">Copied</span>}
                    </>
                  ) : <b className="break-all">-</b>}
                  {WLD_ADDRESS && <a className="ml-2 text-blue-600 underline" href={`${EXPLORER}/address/${WLD_ADDRESS}`} target="_blank" rel="noreferrer">View</a>}
                </div>
                {/* 블록 번호는 탐색기에 "View" 링크로만提供. 숫자를 그대로 노출하면
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
              </div>
              <div className="text-sm">Wallet: {fmtUnits(walletWld)} {wldSymbol}</div>
              <div className="text-sm">Vault: {fmtUnits(vaultWld)} {wldSymbol}</div>
              {account && vaultOwner && account.toLowerCase() === vaultOwner.toLowerCase() && (
                <>
                  <div className="field-row">
                    <label className="field-row-label" htmlFor="deposit-amount">Amount to deposit ({wldSymbol})</label>
                    <div className="field-row-controls">
                      <Input id="deposit-amount" inputMode="decimal" placeholder="0.0"
                        value={amountStr} onChange={e => setAmountStr(e.target.value)} />
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap items-center">
                    <div className="text-xs text-gray-600">Available: {fmtUnits(walletWld)} {wldSymbol}</div>
                    <Button variant="ghost" onClick={() => setPct(25)}>25%</Button>
                    <Button variant="ghost" onClick={() => setPct(50)}>50%</Button>
                    <Button variant="ghost" onClick={() => setPct(75)}>75%</Button>
                    <Button variant="ghost" onClick={setMax}>Max</Button>
                    <Button
                      variant="primary"
                      onClick={deposit}
                      disabled={!miniInstalled || !account || isSettledClaim}
                    >
                      Deposit
                    </Button>
                    <Button onClick={refreshBalances}>Refresh balance</Button>
                  </div>
                </>
              )}
              {/* 정산된 금고에서 입금을 막는다. 계약을 막을 수는 없다 — 누군가 주소로
                  직접 보낼 수 있으므로 sweep 이 여전히 필요하다 — 하지만 앱이 직접
                  권하는 일은 하지 않는다. 잔액이 남으면 "비어 있다" 는 표시가 거짓이 되고
                  사용자는 해제 수단까지 찾아내야 한다. */}
              {isSettledClaim && (
                <div className="text-xs text-gray-600">
                  This vault is closed, so deposits are turned off here — create a new vault
                  first. If you already sent WLD to this vault address, you can still sweep it
                  back to you from the Inherit tab.
                </div>
              )}
              <div className="text-xs text-gray-500">
                * This vault accepts only WLD on World Chain (480). Do not send ETH or other tokens. Gas fees are generally covered by World App; ETH is usually not required.
              </div>

              {account && vaultOwner && account.toLowerCase() === vaultOwner.toLowerCase() && (
                <>
                <div className="space-y-2 border-t pt-3">
                  <div className="text-xs text-gray-500">
                    Emergency withdraw (before the countdown ends)
                  </div>
                  <div className="field-row">
                    <label className="field-row-label" htmlFor="withdraw-to">Send withdrawn WLD to</label>
                    <div className="field-row-controls">
                      <Input id="withdraw-to" placeholder="0x..." value={withdrawTo} onChange={e => setWithdrawTo(e.target.value)} />
                      <Button onClick={setWithdrawToMe}>My address</Button>
                    </div>
                  </div>
                  {withdrawTo && !ethers.isAddress(withdrawTo) && (
                    <div className="text-xs text-red-600">Invalid recipient address.</div>
                  )}
                  <div className="field-row">
                    <label className="field-row-label" htmlFor="withdraw-amount">Amount to withdraw</label>
                    <div className="field-row-controls">
                      <Input id="withdraw-amount" inputMode="decimal" placeholder="0.0"
                        value={withdrawAmountStr} onChange={e => setWithdrawAmountStr(e.target.value)} />
                      <Button onClick={setWithdrawMax}>All</Button>
                      <Button onClick={ownerWithdraw} disabled={isExpiredOrLater}>Withdraw to myself</Button>
                    </div>
                  </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* ===== Inherit 탭: 상속 파이프라인을 그대로 보여준다 ===== */}
        {tab === "inherit" && vault && gate2(
          <Card>
            <CardHeader><CardTitle>Inheritance Status</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              <div className="text-sm text-gray-700">
                {/* 이 문장을 피상속인과 상속인에게 다르게 말한다. 예전에는 항상
                    피상속인 목소리("your heir", "You can renew") 로 적혀 있었는데,
                    상속인이 이 탭을 열면 자기 상속 절차가 자기 아닌 사람에게
                    달라고 ajax 되는 것처럼 읽혔다. */}
                {isMyVault ? (
                  <>
                    Funds move only after the countdown runs out <b>and</b> your heir files a
                    claim, and then waits {challengeDays} more days. You can renew at any point to
                    withdraw that claim, including after those {challengeDays} days — until they
                    actually take it.
                  </>
                ) : (
                  <>
                    Funds move only after the countdown runs out <b>and</b> you file a claim,
                    and then wait {challengeDays} more days. The owner can renew at any point to
                    withdraw your claim, including after those {challengeDays} days — until you
                    actually take the balance.
                  </>
                )}
              </div>

              {/* 파이프라인을 단계로 보여준다. 어느 단계에 있는지가 한눈에 들어가야
                  "내 돈이 언제 이동하는가"를 머릿속에서 계산할 필요가 없어진다. */}
              <ol className="pipeline">
                {[
                  { k: "Counting down", done: vaultPhase === "active" },
                  { k: "Countdown ended", done: awaitingClaim || challengeRunning || canClaim || isSettledClaim },
                  { k: "Heir files a claim", done: challengeRunning || canClaim || isSettledClaim },
                  { k: `${challengeDays}-day review window`, done: canClaim || isSettledClaim },
                  { k: "Heir withdraws", done: isSettledClaim },
                ].map((s, i) => (
                  <li key={i} className={s.done ? "pipeline-done" : ""}>
                    <span className="pipeline-dot" aria-hidden="true" />
                    {s.k}
                    {s.done && <span className="sr-only"> (completed)</span>}
                  </li>
                ))}
              </ol>

              {challengeRunning && (
                <div className="text-sm">
                  {/* "Your heir has filed a claim ... renew to keep the funds" 를
                      상속인에게 그대로 보여주면 자기 상속 신청이 남의 것으로 읽히고
                      "당신이 갱신하라" 는 지시처럼 보인다. 상속인에게는 자기 절차의
                      다음 단계와 남은 시간을 알려야 한다. */}
                  {/* 이 문장은 같은 카드의 첫 문단("You can renew at any point to
                      withdraw that claim, including after those 7 days — until they
                      actually take it") 과 정반대였다. 계약상 소유자의 거부는 무제한이다.
                      `ownerMayStillAct()` 은 `claimedAt != 0` 일 때만 막는다 — 즉
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
                      like, right up until they actually take the balance.
                    </>
                  ) : (
                    <>
                      You filed a claim. The owner can withdraw it until{" "}
                      <b>{challengeEndsAt ? new Date(challengeEndsAt * 1000).toLocaleString() : "—"}</b>
                      , and can renew again after that. Each time they do, the wait starts over.
                      You can withdraw the balance whenever you are able to — but no date is
                      guaranteed to you.
                    </>
                  )}
                  {account && vaultOwner && account.toLowerCase() === vaultOwner.toLowerCase() && (
                    <div className="mt-2">
                      <Button variant="primary" onClick={extendTime} disabled={!miniInstalled || !account}>
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
                      The countdown has ended, so the balance is now available to you. File a
                      claim to start the {challengeDays}-day review window.
                    </div>
                    <Button variant="primary" onClick={fileClaim} disabled={!miniInstalled}>
                      File claim
                    </Button>
                  </div>
                )}

              {canClaim && account && vaultHeir &&
                account.toLowerCase() === vaultHeir.toLowerCase() && (
                  <div className="grid gap-2">
                    <div className="text-sm">
                      The review window has passed, so you can withdraw. Renewing would still cancel their claim until they do.
                    </div>
                    <Button variant="primary" onClick={claim} disabled={!miniInstalled || vaultWld === 0n}>
                      Withdraw {fmtUnits(vaultWld)} {wldSymbol}
                    </Button>
                  </div>
                )}

              {/* 정산 이후 늦게 들어온 잔액 회수.
                  이게 없으면 돈이 금고에 갇힌 채 화면에는 "비어 있다" 고 표시된다.
                  계약에 회수 함수가 붙어 있는데 앱에서 부를 수 없으면 의미가 없다. */}
              {isSettledClaim && isMyVault && vaultWld > 0n && (
                <div className="field-row" style={{ width: "100%" }}>
                  <label className="field-row-label" htmlFor="settled-sweep">
                    Leftover balance in the closed vault
                  </label>
                  <div className="field-row-controls">
                    <Button
                      variant="primary"
                      onClick={sweepSettled}
                      disabled={!miniInstalled || !account || sweeping}
                    >
                      {sweeping
                        ? "Sweeping…"
                        : `Sweep ${fmtUnits(vaultWld, wldDecimals)} WLD to me`}
                    </Button>
                  </div>
                </div>
              )}

              {isSettledClaim && (
                <div className="text-sm text-gray-600">
                  {vaultWld > 0n ? (
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
                  Inheritance was cancelled, so no one inherits this vault. The balance is
                  yours and you can withdraw it whenever you want.
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ===== Vault 탭: 타이머와 갱신 ===== */}
        {tab === "vault" && vault && gate2(
          <Card>
            <CardHeader><CardTitle>Vault & Controls</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {/* 이 앱의 존재 이유가 "타이머가 다 되지 않았는가" 다. 그래서 카드의 맨 위에
                  크고 눈에 띄게 두고, 남은 시간에 따라 색을 바꾼다. */}
              <div className={`timer-block ${timerUrgency}`}>
                {canClaim || isSettledClaim ? (
                  <>
                    <div className="text-xs font-semibold uppercase">
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
                        : "The heir can withdraw the vault balance."}
                    </div>
                  </>
                ) : challengeRunning ? (
                  <>
                    <div className="text-xs font-semibold uppercase text-gray-600">
                      Claim filed — you can still stop it
                    </div>
                    <div className="timer-value">{fmt(challengeRemaining)}</div>
                    <div className="text-xs text-gray-600">
                      left in the review window. Renewing withdraws the claim.
                    </div>
                  </>
                ) : awaitingClaim ? (
                  <>
                    <div className="text-xs font-semibold uppercase text-gray-600">
                      Countdown ended
                    </div>
                    <div className="timer-value">Waiting for a claim</div>
                    <div className="text-xs text-gray-600">
                      {/* 여기서도 주어가 갈린다. "Your heir can now file a claim" 을
                          상속인에게 보여주면 남이 대신 신청해야 한다는 뜻으로 읽힌다. */}
                      {isMyVault
                        ? `Your heir can now file a claim. You would then have ${challengeDays} days to renew.`
                        : `You can now file a claim. The owner would then have ${challengeDays} days to renew.`}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-xs font-semibold uppercase text-gray-600">
                      {timerUrgency === "timer-urgent" || timerUrgency === "timer-critical"
                        ? "Renew soon"
                        : "Time left to renew"}
                    </div>
                    <div className="timer-value">{fmt(timeRemaining)}</div>
                    <div className="text-xs text-gray-600">
                      Expires {expiryLocal} <span className="text-gray-400">({deviceTimeZone})</span>
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <span>{notifyEscalate ? "⚠ " : ""}{notifyHealth.text}</span>
                    {notifyHealth.level !== "ok" && notifyPermission !== "granted" && (
                      <Button size="sm" variant="ghost" onClick={requestNotifyPermission}
                        disabled={!miniInstalled || notifyBusy}>
                        {notifyBusy ? "Working…" : "Turn on"}
                      </Button>
                    )}
                    {notifyHealth.level !== "ok" && isMyVault && notifyPermission === "granted" && (
                      <Button size="sm" variant="ghost" onClick={registerHeirAlert}
                        disabled={!miniInstalled || watchBusy}>
                        {watchBusy ? "Working…" : "Watch this vault"}
                      </Button>
                    )}
                  </div>
                </div>
              )}
              {account && vaultOwner && account.toLowerCase() === vaultOwner.toLowerCase() && (
                <>
                  <div className="text-sm text-gray-700">
                    {challengeRunning
                      ? `Your heir filed a claim. Renew before ${challengeEndsAt ? new Date(challengeEndsAt * 1000).toLocaleString() : "—"} to withdraw it.`
                      : canClaim
                        ? "The review window has passed, so the heir can take the balance. You can still renew to withdraw the claim, until they actually do."
                        : awaitingClaim
                          ? "The countdown has ended. Your heir can now file a claim, and you can keep renewing to cancel it until they actually take the balance."
                          : `Reset before the countdown ends. If you stop, your heir can claim the balance after a ${challengeDays}-day review window.`}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {/* canClaim 로 비활성화하지 않는다. 계약은 상속인이 실제로 수령하기
                        전까지 갱신을 허용하는데, 여기가 옛 규칙("7일이 지나면 못 되돌린다")을
                        그대로 구현하고 있었다. 계약만 고치고 UI 를 안 고치면 화면이
                        블록체인과 모순된다. */}
                    <Button variant="primary" onClick={extendTime} disabled={!miniInstalled || !account || isSettledClaim}>
                      {challengeRunning || canClaim ? "Renew and withdraw claim" : "Reset timer"}
                    </Button>
                  </div>
                </>
              )}
              <div className="flex gap-2 flex-wrap">
                {account && vaultOwner && account.toLowerCase() === vaultOwner.toLowerCase() && (
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
                        <Button onClick={changePeriod} disabled={!miniInstalled || !account || !periodValid}>
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
                    <Button onClick={updateHeir} disabled={!miniInstalled || !account || !newHeirResolved?.address}>Update heir</Button>
                    {/* cancelInheritance 는 컨트랙트에서 만기 후 Expired 로 거부한다.
                        형제 버튼인 withdraw 처럼 만료 이후에는 항상 실패하므로
                        클릭을 사용자에게 노출하지 않는다. */}
                    <Button
                      variant="ghost"
                      onClick={cancelInheritance}
                      disabled={!miniInstalled || !account || isExpiredOrLater}
                    >
                      Cancel (set heir to me)
                    </Button>
                    {supportsRelease && vaultWld === 0n && isExpiredOrLater && (
                      <div className="flex items-center gap-2">
                        <Button onClick={() => setShowReleaseConfirm(true)} disabled={!miniInstalled || !account}>Release slot</Button>
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

        {/* ===== Inherit 탭: 상속 설정과 상속 진행 상태 =====

            "내가 아직 금고를 만들지 않았다"를 묻는 조건이지, "지금 보고 있는 금고가
            내 것이 아니다" 가 아니다. 두 개를 섞으면 상속인 링크를 열어 남의 금고를
            보는 순간 이 온보딩이 튀어나온다 — 자기 금고가 이미 있는데 "Create a vault"
            를 권하고, Owner 화법("your heir can claim the balance", "you can keep
            renewing to stop them") 으로 상속인에게 말한다. 링크가 처음 동작하게 만든
            변경이 만든 부작용이다. */}
        {tab === "inherit" && !ownVault && gate2(
          <Card>
            <CardHeader><CardTitle>How this works</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {/*
                순서와 제약을 먼저 말한다.

                폼만 있으면 "이거 만들고 나서 뭐?" 가 안 보인다. 실제로
                "금고를 먼저 만들고 입금한다는 점도 뚜렷하지 않고 금고를 하나만
                만들 수 있는 건지, 취소하면 다시 못 만드는 건지도 모르겠네" 라는
                지적을 받았다. 전부 컨트랙트에 구현되어 있는 규칙인데 화면에
                없었던 것이 문제였다.

                3단계를 위에 두고, 제약은 폼 아래가 아니라 폼 위에서 말하는 편이
                낫다 — 잘못 판단하고 만드는 것이 되돌리기 번거로우니까.
              */}
              <ol className="steps">
                <li>
                  <b>Create a vault</b>
                  <span>Name your heir and how often you want to renew. No WLD moves at this step.</span>
                </li>
                <li>
                  <b>Send WLD to it</b>
                  <span>After you create it, the Send tab appears and you deposit WLD there.</span>
                </li>
                <li>
                  <b>Renew before the countdown ends</b>
                  <span>Miss it and your heir can claim the balance. They wait 7 days, and you can keep renewing to stop them right up until they actually take it.</span>
                </li>
              </ol>

              <div className="text-xs text-gray-600 space-y-1">
                <div>
                  One vault per wallet. The contract refuses a second one, so there is nothing to
                  keep track of.
                </div>
                <div>
                  Changed your mind? Before the countdown ends you can switch to a different
                  heir, or cancel entirely — then the WLD is yours to withdraw whenever you
                  like.
                </div>
                <div className="text-gray-500">
                  A vault cannot be deleted. To start a new one, the old vault has to be
                  finished and empty — then the slot releases.
                </div>
              </div>
              {/* 이 문장은 사실 주장이라 컨트랙트에서 검증했다. 금고의 WLD 가 나가는
                  경로는 finalizeClaim 하나뿐이고 그건 상속인이 직접 누를 때만 실행된다.
                  갱신(ping) 은 자금을 옮기지 않는다 — 신청을 취소하고 카운트다운만
                  되돌린다. 그래서 "자동으로 옮겨지지 않는다" 가 정확하다. */}
              <div className="text-sm text-gray-700 border-l-2 border-blue-200 pl-3">
                The countdown ending <b>moves nothing on its own.</b> Your WLD stays in the vault
                until your heir files a claim, waits 7 days, and withdraws it.
              </div>
              </CardContent>
              </Card>
              )}

              {tab === "inherit" && !isMyVault && gate2(
                <Card>
                  <CardHeader><CardTitle>Create My Vault</CardTitle></CardHeader>
                  <CardContent className="grid gap-3">
              <div className="text-sm">Wallet: {fmtUnits(walletWld)} {wldSymbol}</div>
              <div className="field-row">
                <label className="field-row-label" htmlFor="heir-input">
                  Heir — who receives the funds if you stop renewing
                </label>
                <div className="field-row-controls">
                  <Input id="heir-input" placeholder="@username or 0x..." value={heir} onChange={e => onHeirInput(e.target.value)} />
                  <Button
                    size="sm"
                    onClick={pickHeirFromContacts}
                    disabled={shareBusy}
                    title="Open your World App contacts and choose an heir"
                  >
                    {shareBusy ? "…" : "From contacts"}
                  </Button>
                </div>
                {/* 버튼 라벨만으로는 무엇을 여는지 알기 어렵다. 라벨을 길게 하면
                    390px 에서 입력창과 fighting 하므로, 짧게 두고 여기에 쓴다. */}
                <div className="text-xs text-gray-600">
                  Type a World App username or an address, or use "From contacts" to pick one from
                  your World App contacts.
                </div>
              </div>
              {heir && (
                resolvingHeir ? (
                  <div className="text-xs text-gray-600">Resolving…</div>
                ) : heirResolved?.address ? (
                  <div className="text-xs text-gray-600">
                    Resolved: {heirResolved.username ? <b>@{heirResolved.username}</b> : 'Address'} → <b>{short(heirResolved.address)}</b>
                    <button className="ml-2 underline" onClick={() => copyText(heirResolved!.address!, 'heir')}>Copy</button>
                  </div>
                ) : (
                  <div className="text-xs text-red-600">No match found. Enter a valid @username or WorldChain wallet address.</div>
                )
              )}
              {heirResolved?.address && isHeirSuspicious() && (
                <div className="text-xs text-yellow-700">Warning: Heir equals owner or zero address — this disables inheritance.</div>
              )}
              <div className="field-row">
                <label className="field-row-label" htmlFor="period-input">
                  Renewal period — how often you must reset the timer (1–365 days)
                </label>
                <div className="field-row-controls">
                  <Input
                    id="period-input"
                    type="text"
                    inputMode="numeric"
                    className="w-28"
                    value={periodInput}
                    placeholder="30"
                    onChange={e => onPeriodChange(e.target.value)}
                  />
                  <span className="text-xs text-gray-500">days</span>
                </div>
              </div>
              <div className="text-xs text-red-600">
                {!periodValid && periodInput !== '' ? "Period must be between 1 and 365 days." : ""}
              </div>
              {/* 알림을 **금고를 만들 때** 먼저 알린다.
                  알림 안내를 Vault 탭에만 두면 안 된다 — Vault 탭은 금고가 있어야
                  보이는데(`needsVault`), 금고가 없으면 그 탭 자체가 없다. 처음 쓰는
                  사람은 Inherit 탭(기본 탭)에서 금고를 만들 텐데, 알림을 그때 알려주지
                  않으면 존재를 모른 채 지나가고 Help 탭을 열어볼 일도 없다.

                  또 알림은 **잔액이 0 이면 아무것도 보내지 않는다**(백엔드가 그렇게
                  되어 있다). 그러므로 "알려줄게요" 라고 해놓고 실제로는 입금 이후에야
                  통보가 시작되는데, 그 사실까지 말하는 편이 정직하다. */}
              {NOTIFY_BACKEND_ENABLED && !vault && notifyHealth.level !== "checking" && (
                <div
                  className={
                    // 여기서는 `notifyNeedsAttention` 을 쓰면 안 된다. 그 판정은
                    // "잔액이 있는 금고" 를 전제하는데, 지금은 금고가 없으므로 항상
                    // false 다. 결과적으로 "켜라"고 말하면서 **초록(정상) styling** 이
                    // 붙었다. 색은 "알림이 켜져 있는가" 로만 정한다.
                    notifyHealth.level === "off" || notifyHealth.level === "broken"
                      ? "text-xs text-yellow-800 bg-yellow-50 border border-yellow-200 rounded py-2 px-3"
                      : "text-xs text-green-800 bg-green-100 border border-green-200 rounded py-2 px-3"
                  }
                  role={notifyPermission === "granted" ? "status" : "alert"}
                  aria-live="polite"
                >
                  <div className="font-medium">Turn on notifications first</div>
                  <div className="mb-2">
                    {notifyHealth.level === "off" || notifyHealth.level === "broken"
                      ? "Without them, if you stop renewing nobody is told — not you, not your heir."
                      : "You and your heir will be told before the countdown ends and at each claim step."}
                  </div>
                  <div className="mb-2">
                    Notices start once the vault holds WLD.
                  </div>
                  {notifyPermission !== "granted" && (
                    <Button size="sm" variant={notifyNeedsAttention ? "primary" : "outline"}
                      onClick={requestNotifyPermission} disabled={!miniInstalled || notifyBusy}>
                      {notifyBusy ? "Working…" : "Turn on notifications"}
                    </Button>
                  )}
                </div>
              )}

              {/* 주 액션. 알림 안내 블록 **밖** 이다.
                  알림 안내를 옮기면서 이 버튼이 조건 블록 안으로 딸려 들어간 적이 있다.
                  그러면 VITE_NOTIFY_BACKEND_URL 이 빠진 빌드에서 "Create vault" 가
                  화면에서 사라지고, 아무도 금고를 만들 수 없게 된다 — 부가 기능이
                  주 액션을 삼킨 구조. 알림은 없어도 금고 만들기는 가능해야 한다. */}
              <Button variant="primary" onClick={createVault} disabled={!miniInstalled || !account || isMyVault || !periodValid || !heirResolved?.address}>Create vault</Button>
              {isMyVault && (
                <div className="text-xs text-gray-600">You already have a vault. Update settings below or deposit WLD.</div>
              )}
              {vault && (
                <div className="text-xs text-gray-600 break-all">
                  {/* "Your vault" 는 **내 소유** 일 때만 사실이다. 상속인이 `?vault=` 링크로
                      남의 금고를 보고 있으면 이 라벨은 소유권을 주장하는 셈이 되고, 같은
                      화면에 "Withdraw 15.0 WLD" 까지 있으니 훨씬 나쁘다. 상속인에게는
                      그것이 누구의 금고인지로 말해야 한다. */}
                  {isMyVault ? "Your vault:" : "Vault you were named heir of:"}
                  <button className="ml-1 underline text-blue-700" onClick={() => copyText(vault, "vault")}>
                    {short(vault)}
                  </button>
                  {copied === "vault" && <span className="ml-2 text-green-700">Copied</span>}
                </div>
              )}
            </CardContent>
          </Card>
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
        {tab === "inherit" && isMyVault && vault && vaultHeir && gate2(
          <Card>
            <CardHeader><CardTitle>Tell your heir</CardTitle></CardHeader>
            <CardContent className="grid gap-2">
              <div className="text-xs text-gray-600">
                A notification only reaches a wallet that has already opened World App. Your heir
                may never open it, so do not rely on one — tell them yourself.
              </div>
              {/* 상속은 "피상속인이 갱신을 멈춘다" 는 사실 위에 성립한다. 갱신은 살아있다는
                  신호이지 실패가 아니다 — 그래서 주인은 상속인이 실제로 받기 전까지 언제든
                  갱신할 수 있고, 상속인은 그 신호가 끊기길 기다린다. 시간표를 약속하지
                  않지만, 주인이 멈추면 반드시 진행된다는 사실이 보장된다. */}
              <div className="text-xs text-gray-600">
                Renewing is how you stay reachable, so you can renew at any time — the heir waits
                for you to stop. Once they file a claim they cannot withdraw for 7 days no matter
                what you do; after that you can still renew and cancel until they actually
                take it. If you keep renewing they keep waiting, and no date is promised.
              </div>
              {heirUsername ? (
                <>
                  <div className="text-sm font-medium">Send in World Chat</div>
                  <div className="text-xs text-gray-600">
                    Reaches @{heirUsername} inside World App, whether or not they have ever opened
                    this app. Tapping the message opens this vault.
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button variant="primary" onClick={tellHeirInChat} disabled={shareBusy}>
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
                        ? `You are the heir of ${heirFoundVaults.length} vault${heirFoundVaults.length > 1 ? "s" : ""}. Open the Inherit tab to see them.`
                        : "No vault on World Chain currently names you as heir."
                      : "This app checks the chain for you as soon as you open it."}
                </div>
                <div>
                  <Button size="sm" onClick={findHeirVaults} disabled={findingHeirVaults}>
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
              This mini app is fully non-custodial. Your keys and assets stay in your World App wallet. We never receive or control private keys.
            </div>
            <ul className="list-disc pl-5 space-y-1 text-xs text-gray-600">
              <li>Transactions are requested via World App and must be explicitly approved in World App.</li>
              <li>Deposits move WLD from your wallet to your personal vault contract; only you or your heir (after expiry) can move funds.</li>
              <li>Your address is provided by World App via a secure bridge; signatures and transactions happen only in World App.</li>
              <li>We do not store any personal data about you, your heir, or your vault.</li>
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
                window has passed. Nothing is sent while the vault holds no WLD.
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
              <div className="flex gap-2 flex-wrap">
                <Button onClick={requestNotifyPermission} disabled={!miniInstalled || notifyBusy}>
                  {notifyBusy ? "Working..." : "Enable notifications"}
                </Button>
                <Button onClick={refreshNotifyPermission} disabled={!miniInstalled || notifyBusy}>
                  Refresh permission
                </Button>
                {account && (
                  <Button onClick={sendNotifyTestToMe} disabled={!miniInstalled || !NOTIFY_BACKEND_ENABLED || watchBusy}>
                    Send test to me
                  </Button>
                )}
                {account && vaultOwner && account.toLowerCase() === vaultOwner.toLowerCase() && vault && vaultHeir && (
                  <Button
                    variant="primary"
                    onClick={registerHeirAlert}
                    disabled={!miniInstalled || !NOTIFY_BACKEND_ENABLED || watchBusy}
                  >
                    Register vault alerts
                  </Button>
                )}
                {vault && (
                  <Button onClick={refreshNotifyWatchState} disabled={!NOTIFY_BACKEND_ENABLED || watchBusy}>
                    Refresh watcher
                  </Button>
                )}
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
          {tab === "money" && "Your vault is not set up yet. Create it in the Inherit tab first."}
          {tab === "vault" && "Loading your vault..."}
        </div>
      )}

      {/* ===== 하단 탭 바 =====
          가이드라인이 권장하는 "Bottom tab navigation and anchored buttons" 형태다.
          fixed 이지만 safe-area 를 고려해 화면 가장자리와 겹치지 않게 들어 올린다.
          내용이 없는 탭은 아예 보이지 않는다(visibleTabs). */}
      <nav className="tab-bar" aria-label="Sections" hidden={!account}>
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            className={`tab-item ${tab === t.key ? "tab-item-active" : ""}`}
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
          >
            {t.label}
          </button>
        ))}
      </nav>

      </div>
      <div className="toast-container" role="status" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>
        ))}
      </div>
      {showReleaseConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div
            className="bg-white rounded-md shadow-lg max-w-sm w-full p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="release-modal-title"
          >
            <div id="release-modal-title" className="text-lg font-semibold mb-2">Release vault slot?</div>
            <div className="text-sm text-gray-700 mb-3">
              You can release only after expiry and when the vault WLD balance is 0. Releasing keeps the vault contract on-chain and clears only the factory's one-per-owner mapping. Continue?
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-700 mb-3">
              <input type="checkbox" checked={releaseAcknowledge} onChange={e => setReleaseAcknowledge(e.target.checked)} />
              <span>I understand the conditions and want to proceed.</span>
            </label>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setShowReleaseConfirm(false)} disabled={releasing}>Cancel</Button>
              <Button variant="primary" onClick={releaseSlot} disabled={!miniInstalled || releasing || !releaseAcknowledge}>Confirm</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
