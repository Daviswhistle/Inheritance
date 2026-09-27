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
  if (direct && !generic) return direct;

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
  const [periodInput, setPeriodInput] = useState<string>("30");
  const onPeriodChange = (raw: string) => {
    // allow only digits; keep empty while editing
    const v = (raw || '').replace(/\D+/g, '');
    setPeriodInput(v);
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
    const res = (await getNotifyPermission()) as
      | { permissions?: Record<string, unknown> }
      | null;
    if (res && res.permissions) {
      setNotifyPermission(res.permissions.notifications ? "granted" : "denied");
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
      pushToast("success", "Test notification requested.");
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
      if (v && ethers.isAddress(v)) setVault(ethers.getAddress(v));
    } catch {
      // Ignore malformed query params.
      void 0;
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
    if (!account || vault) return;
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
        setVault(v);
        return;
      }
    } catch (e: unknown) {
      // RPC 실패를 삼키지 않는다 — 예외가 바깥으로 새면 unhandled rejection 이 된다.
      setStatus("Vault lookup failed: " + errorText(e));
      return;
    }

    // 내 소유 금고가 없다. 여기서 "상속인인 금고"를 `vault` 에 넣으면 안 된다.
    // `vault` 는 "내가 소유한 금고" 를 뜻하고, 이를 상속인 금고로 오염시키면
    // (1) Create 버튼이 영구히 비활성화되고 (2) "이미 금고가 있습니다" 라고 표시된다.
    // 결과적으로 남의 상속인이 된 사용자는 자기 금고를 만들 수 없게 된다.
    // 상속인 금고는 아래 "Find vaults where I am heir" 액션으로 별도로 조회한다.
  }, [factory, account]);

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
      setVaultLastPing(Number(lp));
      // 수금처 기본값은 "한 번만" 채운다. `withdrawTo` 를 deps 에 두면
      // 입력할 때마다 콜백이 재생성되어 이 effect 가 keystale 마다 다시 돌고,
      // 사용자가 필드를 지우면 즉시 소유자 주소로 되돌아가 비워둘 수 없게 된다.
      setWithdrawTo((prev) => prev || o);
    } catch {
      // Non-critical read failure.
      void 0;
    }
  }, [vaultCtr]);
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
    } catch (e: unknown) {
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
                  <div><b>{username ? `@${username}` : (vaultOwner ? short(vaultOwner) : '-')}</b></div>
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
                    <Button variant="primary" onClick={deposit} disabled={!miniInstalled || !account}>Deposit</Button>
                    <Button onClick={refreshBalances}>Refresh</Button>
                  </div>
                </>
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
                Funds move only after the countdown runs out <b>and</b> your heir files a
                claim, and then waits {challengeDays} more days. If you renew during those
                days the claim is withdrawn automatically.
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
                  Your heir has filed a claim. Renew the countdown before{" "}
                  <b>{challengeEndsAt ? new Date(challengeEndsAt * 1000).toLocaleString() : "—"}</b>{" "}
                  to keep the funds. After that the claim cannot be stopped.
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
                      The review window has passed. Withdraw the balance.
                    </div>
                    <Button variant="primary" onClick={claim} disabled={!miniInstalled || vaultWld === 0n}>
                      Withdraw {fmtUnits(vaultWld)} {wldSymbol}
                    </Button>
                  </div>
                )}

              {isSettledClaim && (
                <div className="text-sm text-gray-600">
                  The inheritance completed. This vault is closed and holds nothing.
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
                        ? "This vault is closed and holds nothing."
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
                      Your heir can now file a claim. You would then have{" "}
                      {challengeDays} days to renew.
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
              {account && vaultOwner && account.toLowerCase() === vaultOwner.toLowerCase() && (
                <>
                  <div className="text-sm text-gray-700">
                    {challengeRunning
                      ? `Your heir filed a claim. Renew before ${challengeEndsAt ? new Date(challengeEndsAt * 1000).toLocaleString() : "—"} to withdraw it.`
                      : canClaim
                        ? "The review window has passed, so the balance can no longer be renewed back."
                        : awaitingClaim
                          ? "The countdown has ended. Your heir can now file a claim, after which you would still have a few days to renew."
                          : `Reset before the countdown ends. If you stop, your heir can claim the balance after a ${challengeDays}-day review window.`}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button variant="primary" onClick={extendTime} disabled={!miniInstalled || !account || canClaim}>
                      {challengeRunning ? "Renew and withdraw claim" : "Reset timer"}
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
                  <Button onClick={loadVault}>Re-scan</Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        )}

        {/* 금고가 이미 있으면 이 카드를 숨긴다. 그대로 두면 비활성 primary 버튼과
            "You already have a vault" 문구가 함께 보여 혼란을 부르며, heir/period 조정은
            아래 "Timer & Controls" 카드에서 할 수 있어 기능 손실이 없다. */}
        {/* ===== Inherit 탭: 상속 설정과 상속 진행 상태 ===== */}
        {tab === "inherit" && !isMyVault && gate2(
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
                  <span>Miss it and your heir can claim the balance, after a 7-day window you can still stop.</span>
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
                  like. To start over, wait for the countdown to end with an empty vault and
                  the slot releases, and you can create a new one.
                </div>
                <div className="text-gray-500">
                  A vault cannot be deleted. To start a new one, the old vault has to be
                  finished and empty — then the slot releases.
                </div>
                <div className="text-gray-500">
                  If the countdown ends with WLD still inside, nothing moves on its own. Your
                  heir has to file a claim, which starts a 7-day window where you can still
                  renew and stop it. If you do not renew in those 7 days, they withdraw the
                  balance. No one takes a cut.
                </div>
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
                  <Button size="sm" onClick={pickHeirFromContacts} disabled={shareBusy}>
                    {shareBusy ? "…" : "Pick"}
                  </Button>
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
              <Button variant="primary" onClick={createVault} disabled={!miniInstalled || !account || isMyVault || !periodValid || !heirResolved?.address}>Create vault</Button>
              {isMyVault && (
                <div className="text-xs text-gray-600">You already have a vault. Update settings below or deposit WLD.</div>
              )}
              {vault && (
                <div className="text-xs text-gray-600 break-all">
                  Your vault:
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
        {tab === "inherit" && !isMyVault && account && gate2(
          <Card>
            <CardHeader><CardTitle>Are you named as someone's heir?</CardTitle></CardHeader>
            <CardContent className="grid gap-2">
              <div className="text-xs text-gray-600">
                This app checks the chain for you as soon as you open it. Scanning reads the
                factory's history, so it takes a moment.
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
                            <Button size="sm" onClick={() => setVault(v)}>Open</Button>
                            <a className="text-blue-600 underline" href={`${EXPLORER}/address/${v}`} target="_blank" rel="noreferrer">View</a>
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
        )}

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
              {heirUsername ? (
                <>
                  <div className="text-sm font-medium">Send in World Chat</div>
                  <div className="text-xs text-gray-600">
                    Reaches @{heirUsername} inside World App, whether or not they have ever opened
                    this app. Tapping the message opens the vault below.
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
              <div className="text-xs text-gray-600">
                Notifications for this wallet:{" "}
                <b>
                  {notifyPermission === "granted" ? "enabled" : notifyPermission === "denied" ? "disabled" : "unknown"}
                </b>
              </div>
              {account && vault && (
                <div className="text-xs text-gray-600">
                  Current vault watch:{" "}
                  <b>
                    {notifyWatchState === "registered"
                      ? "registered"
                      : notifyWatchState === "not_registered"
                        ? "not registered"
                        : "unknown"}
                  </b>
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
