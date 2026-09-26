import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ReactElement } from "react";
import {
  ACTION_ID,
  CHAIN_ID,
  CHAIN_NAME,
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

// ===== WLD-only factory/vault ABI
const FACTORY_ABI = [
  "event VaultCreated(address indexed owner, address indexed heir, address vault, uint256 heartbeatInterval)",
  "function createVault(address heir, uint256 heartbeatInterval) external returns (address)",
  "function vaultOf(address owner) external view returns (address)",
  // Optional: supported in newer factory
  "function releaseMyVault() external returns (bool)",
];

const VAULT_ABI = [
  "function WLD() view returns (address)",
  "function heir() view returns (address)",
  "function owner() view returns (address)",
  "function heartbeatInterval() view returns (uint256)",
  "function lastPing() view returns (uint256)",
  "function canClaim() view returns (bool)",
  "function timeRemaining() view returns (uint256)",
  "function ping() external",
  "function updateHeir(address _newHeir) external",
  "function updateHeartbeat(uint256 _newInterval) external",
  "function cancelInheritance() external",
  "function claim() external",
  "function ownerWithdrawWLD(uint256 amount, address to) external",
];

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

type TxResultPayload = {
  transaction_hash?: string;
  transactionId?: string;
  transaction_id?: string;
};

const loadMiniKit = () => import("@worldcoin/minikit-js");

const readErrorValue = (error: unknown, key: "reason" | "shortMessage" | "message"): string | undefined => {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : undefined;
};

const errorText = (error: unknown): string => {
  return readErrorValue(error, "reason")
    ?? readErrorValue(error, "shortMessage")
    ?? readErrorValue(error, "message")
    ?? String(error);
};

const txHashFromPayload = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== "object") return undefined;
  const tx = payload as TxResultPayload;
  return tx.transaction_hash || tx.transactionId || tx.transaction_id;
};

export default function App() {
  // ---- state
  const [provider, setProvider] = useState<ethers.JsonRpcProvider | null>(null);
  // signer 경로는 비활성 (World App 내부에서만 실행)
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [account, setAccount] = useState<string>("");
  // Username (World App handle) — used for display; addresses are used on-chain
  const [username, setUsername] = useState<string>("");

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
  const [canClaim, setCanClaim] = useState<boolean>(false);

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

  // walletAuth nonce 는 SIWE 서명 메시지에 들어가므로 짧으면 안 된다.
  const randomNonce = () => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  };
  const getWalletAuthNonce = async () => randomNonce();
  
  // getLogs helper with safe fromBlock fallback for L2 gateways
  const safeGetLogs = async (
    p: ethers.AbstractProvider,
    params: { address?: string; topics?: (string | null | string[])[]; toBlock?: number | string }
  ) => {
    const base = {
      address: params.address,
      topics: params.topics,
      toBlock: params.toBlock ?? "latest",
    } as const;

    // 배포 블록이 알려져 있으면 그 지점부터 조회한다.
    // L2 게이트웨이는(fromBlock..latest) 구간이 크면 거절하므로, 실패 시에는
    // 배포 블록이 없는 것처럼 head 기준 짧은 창으로 좁혀 재시도한다.
    if (FACTORY_DEPLOY_BLOCK !== null) {
      try {
        return await p.getLogs({ ...base, fromBlock: FACTORY_DEPLOY_BLOCK });
      } catch {
        // 구간이 너무 넓었을 수 있다. 아래 폴백으로 이어간다.
      }
    }

    const head = await p.getBlockNumber();
    const span1 = 20_000;
    const from1 = head > span1 ? head - span1 : 0;
    try {
      return await p.getLogs({ ...base, fromBlock: from1 });
    } catch {
      const span2 = 5_000;
      const from2 = head > span2 ? head - span2 : 0;
      return await p.getLogs({ ...base, fromBlock: from2 });
    }
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
  const fmtUnits = (v: bigint, d = wldDecimals) => ethers.formatUnits(v, d);
  const parseAmount = (s: string) => {
    const [i, d = ""] = s.split(".");
    const dd = (d + "0".repeat(wldDecimals)).slice(0, wldDecimals);
    return BigInt(i || "0") * (10n ** BigInt(wldDecimals)) + BigInt(dd || "0");
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
  const expired = useMemo(() => {
    if (canClaim) return true;
    if (!expiryTs) return false;
    const nowSec = Math.floor(Date.now() / 1000);
    return nowSec >= expiryTs;
  }, [canClaim, expiryTs]);
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
      const { MiniKit, VerificationLevel } = await loadMiniKit();
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
        const nonce = await getWalletAuthNonce();
        const { finalPayload } = await MiniKit.commandsAsync.walletAuth({ nonce });
        if (finalPayload?.status === 'success') {
          const addr: string = finalPayload.address;
          const NETWORK = { chainId: CHAIN_ID, name: CHAIN_NAME.toLowerCase() } as const;
          const p = new ethers.JsonRpcProvider(RPC_URL, NETWORK);
          setProvider(p); setSigner(null); setAccount(addr);
          try {
            localStorage.setItem('wld-account', ethers.getAddress(addr));
          } catch {
            // Local storage may be unavailable in some embedded contexts.
            void 0;
          }
          setStatus('Connected (World App): ' + addr.slice(0, 6) + '...' + addr.slice(-4));
        } else {
          setStatus('Connection cancelled or failed.');
          pushToast('error', 'Connection cancelled or failed.');
          return;
        }
      }

      // After login, optionally request verification
      if (REQUIRE_VERIFY && !verified) {
        const { finalPayload } = await MiniKit.commandsAsync.verify({
          action: ACTION_ID,
          verification_level: VerificationLevel.Device,
        });
        if (finalPayload?.status !== 'success') {
          setStatus('Verification cancelled or failed.');
          pushToast('error', 'Verification cancelled or failed.');
          return;
        }
        setVerified(true);
        // localStorage 쓰기가 실패하면 검증이 성공했는데도 오류로 보고되어야 하므로,
        // 저장 실패는 삼킨다 (검증 결과 자체는 정상이다).
        try {
          localStorage.setItem('wld-verified', '1');
        } catch {
          void 0;
        }
        setStatus('Verification complete.');
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
    try {
      const { MiniKit } = await loadMiniKit();
      const { finalPayload } = await MiniKit.commandsAsync.getPermissions();
      if (finalPayload?.status === "success") {
        const perms = (finalPayload.permissions || {}) as Record<string, unknown>;
        setNotifyPermission(perms.notifications ? "granted" : "denied");
        return;
      }
      setNotifyPermission("denied");
    } catch {
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
      const { MiniKit, Permission } = await loadMiniKit();
      const { finalPayload } = await MiniKit.commandsAsync.requestPermission({
        permission: Permission.Notifications,
      });
      if (finalPayload?.status === "success") {
        pushToast("success", "Notifications enabled for this wallet.");
      } else {
        const description =
          finalPayload && typeof finalPayload === "object" && "description" in finalPayload
            ? String((finalPayload as { description?: unknown }).description || "")
            : "";
        pushToast("error", description || "Notification permission was not granted.");
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
    if (!silent) pushToast("success", "Heir claim alert is registered.");
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
      pushToast("error", "Only the owner can register heir alerts.");
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

  // Restore saved session (keeps user logged in across visits)
  // 로그인 게이트가 아니라 표시 상태 복원용이므로, 지갑 서명 없이 주소만 되살린다.
  useEffect(() => {
    try {
      const saved = localStorage.getItem('wld-account') || '';
      if (saved && ethers.isAddress(saved)) {
        const addr = ethers.getAddress(saved);
        const NETWORK = { chainId: CHAIN_ID, name: CHAIN_NAME.toLowerCase() } as const;
        const p = new ethers.JsonRpcProvider(RPC_URL, NETWORK);
        setProvider(p); setSigner(null); setAccount(addr);
        setStatus((s) => s || 'Session restored');
      }
    } catch {
      // Local storage may be unavailable in some embedded contexts.
      void 0;
    }
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
      setWldSymbol(sym); setWldDecimals(dec);
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
      const cc: boolean = await vaultCtr.canClaim();
      setTimeRemaining(Number(rem));
      setCanClaim(cc);
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
    if (vault) { setStatus("You already have a vault. Use it or release after expiry."); pushToast('info', 'Vault already exists'); return; }
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
      const { MiniKit } = await loadMiniKit();
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: FACTORY_ADDRESS,
          abi: FACTORY_ABI,
          functionName: "createVault",
          args: [resolved.address, seconds.toString()],
        }],
        formatPayload: true,
      });
      if (finalPayload?.status !== "success") {
        setStatus("Transaction cancelled or failed");
        pushToast('error', 'Transaction cancelled or failed');
        return;
      }
      setStatus("Pending… awaiting confirmation");
      const prov = getRwProvider();
      const txh = txHashFromPayload(finalPayload);
      await waitForTxOrEvent(prov, {
        txHash: txh,
        check: async () => {
          const vchk = await factory.vaultOf(account);
          return vchk && vchk !== ethers.ZeroAddress;
        },
      });
      setStatus("Vault created ✅");
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
      if (vaults.length === 1) {
        setVault(vaults[0]);
        pushToast('success', 'Detected a vault where you are heir.');
      }
      if (vaults.length === 0) pushToast('info', 'No vaults found where you are heir.');
    } catch (e: unknown) {
      pushToast('error', 'Heir scan error: ' + errorText(e));
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
      const { MiniKit } = await loadMiniKit();
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{
          address: WLD_ADDRESS,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [vault, amt.toString()],
        }],
        formatPayload: true,
      });
      if (finalPayload?.status !== "success") { setStatus("Deposit cancelled or failed"); return; }
      setStatus("Pending… awaiting confirmation");
      const prev = vaultWld;
      const prov = getRwProvider();
      const txh = txHashFromPayload(finalPayload);
      await waitForTxOrEvent(prov, {
        txHash: txh,
        check: async () => {
          const token = new ethers.Contract(WLD_ADDRESS, ERC20_ABI, provider);
          const vb: bigint = await token.balanceOf(vault);
          return vb > prev;
        },
      });
      setStatus("Deposit complete ✅");
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
      const { MiniKit } = await loadMiniKit();
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: vault, abi: VAULT_ABI, functionName: "ping", args: [] }],
        formatPayload: true,
      });
      if (finalPayload?.status !== "success") { setStatus("Reset cancelled or failed"); return; }
      setStatus("Pending… awaiting confirmation");
      const prevLp = vaultLastPing;
      const prov = getRwProvider();
      const txh = txHashFromPayload(finalPayload);
      await waitForTxOrEvent(prov, {
        txHash: txh,
        check: async () => {
          const lp: bigint = await vaultCtr.lastPing();
          return Number(lp) > (prevLp || 0);
        },
      });
      setStatus("Timer reset (full period restored) ✅");
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
      const { MiniKit } = await loadMiniKit();
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: vault, abi: VAULT_ABI, functionName: "updateHeartbeat", args: [seconds.toString()] }],
        formatPayload: true,
      });
      if (finalPayload?.status !== "success") { setStatus("Change period failed"); return; }
      setStatus("Pending… awaiting confirmation");
      const prov = getRwProvider();
      const txh = txHashFromPayload(finalPayload);
      await waitForTxOrEvent(prov, {
        txHash: txh,
        check: async () => {
          const hb: bigint = await vaultCtr.heartbeatInterval();
          return Number(hb) === Number(seconds);
        },
      });
      setStatus("Period updated ✅");
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
      const { MiniKit } = await loadMiniKit();
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: vault, abi: VAULT_ABI, functionName: "cancelInheritance", args: [] }],
        formatPayload: true,
      });
      if (finalPayload?.status !== "success") { setStatus("Cancel failed"); return; }
      setStatus("Pending… awaiting confirmation");
      const prov = getRwProvider();
      const txh = txHashFromPayload(finalPayload);
      await waitForTxOrEvent(prov, {
        txHash: txh,
        check: async () => {
          const h = await vaultCtr.heir();
          return h && h.toLowerCase() === vaultOwner.toLowerCase();
        },
      });
      setStatus("Inheritance cancelled (heir=owner) ✅");
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
      const { MiniKit } = await loadMiniKit();
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: vault, abi: VAULT_ABI, functionName: "updateHeir", args: [resolved.address] }],
        formatPayload: true,
      });
      if (finalPayload?.status !== "success") { setStatus("Update heir failed"); return; }
      setStatus("Pending… awaiting confirmation");
      const prov = getRwProvider();
      const txh = txHashFromPayload(finalPayload);
      const target = resolved.address;
      await waitForTxOrEvent(prov, {
        txHash: txh,
        check: async () => {
          const h = await vaultCtr.heir();
          return h && h.toLowerCase() === target.toLowerCase();
        },
      });
      setStatus("Heir updated ✅");
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

  // ---- claim (after expiry)
  const claim = async () => {
    if (!vaultCtr) return;
    try {
      if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
      const { MiniKit } = await loadMiniKit();
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: vault, abi: VAULT_ABI, functionName: "claim", args: [] }],
        formatPayload: true,
      });
      if (finalPayload?.status !== "success") { setStatus("Claim failed"); return; }
      setStatus("Pending… awaiting confirmation");
      const prev = vaultWld;
      const prov = getRwProvider();
      const txh = txHashFromPayload(finalPayload);
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
      setStatus("Claim complete ✅");
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
      const { MiniKit } = await loadMiniKit();
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: vault, abi: VAULT_ABI, functionName: "ownerWithdrawWLD", args: [amt.toString(), withdrawTo] }],
        formatPayload: true,
      });
      if (finalPayload?.status !== "success") { setStatus("Withdraw cancelled or failed"); return; }
      setStatus("Pending… awaiting confirmation");
      const prev = vaultWld;
      const prov = getRwProvider();
      const txh = txHashFromPayload(finalPayload);
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
      setStatus("Withdraw complete ✅");
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
      const { MiniKit } = await loadMiniKit();
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: FACTORY_ADDRESS, abi: FACTORY_ABI, functionName: "releaseMyVault", args: [] }],
        formatPayload: true,
      });
      if (finalPayload?.status !== "success") { setStatus("Release cancelled or failed"); return; }
      setStatus("Pending… awaiting confirmation");
      const prov = getRwProvider();
      const txh = txHashFromPayload(finalPayload);
      await waitForTxOrEvent(prov, {
        txHash: txh,
        check: async () => {
          const v = await factory.vaultOf(account);
          return !v || v === ethers.ZeroAddress;
        },
      });
      setStatus("Released. You can create a new vault. ✅");
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
      <div className="container-narrow px-4 py-4 md:py-6 safe-pb grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">WLD Inheritance Vault</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2 flex-wrap items-center">
              {/* World App 전용: 자동 진행. 필요 시 상태만 표시 */}
              {account && REQUIRE_VERIFY && !verified && (
                <Button
                  variant="primary"
                  onClick={continueWorldApp2}
                  disabled={ctaLoading}
                >
                  {ctaLoading ? (<><span className="spinner mr-2"></span>Verifying...</>) : "Verify in World App"}
                </Button>
              )}
              {account && (!REQUIRE_VERIFY || verified) && (
                <Button disabled size="md">{username ? `@${username}` : 'Connected'}</Button>
              )}
              {/* 이 줄이 8개 트랜잭션 플로우 전부의 결과/오류 채널이다.
                  스크린 리더 사용자에게 읽히도록 live region 이 필요하다. */}
              <div className="text-xs text-gray-600" role="status" aria-live="polite" aria-atomic="true">
                {status}
              </div>
            </div>

            <div className="text-xs text-gray-500">
              Send <b>{wldSymbol}</b> into your vault. If you do not extend the timer before it expires,
              your designated heir can claim the full balance.
            </div>
          </CardContent>
        </Card>

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

        <Card>
          <CardHeader><CardTitle>World App Notifications</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm text-gray-700">
            <div className="text-xs text-gray-600">
              Heir alerts are sent through World App notifications when a registered vault becomes claimable with a non-zero WLD balance.
            </div>
            <div className="text-xs text-gray-600">
              Backend: <b>{NOTIFY_BACKEND_ENABLED ? "connected" : "disabled (set VITE_NOTIFY_BACKEND_URL)"}</b>
            </div>
            <div className="text-xs text-gray-600">
              This wallet notifications:{" "}
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
                  Register heir alert
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

        {gate2(
          <Card>
            <CardHeader><CardTitle>Create My Vault</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              <div className="text-sm">Wallet: {fmtUnits(walletWld)} {wldSymbol}</div>
              <div className="grid grid-cols-3 items-center gap-2">
                <div>Heir (@username or 0x…)</div>
                <Input className="col-span-2" placeholder="@username or 0x..." value={heir} onChange={e => onHeirInput(e.target.value)} />
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
              <div className="grid grid-cols-3 items-center gap-2">
                <div>Period (days)</div>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="col-span-2"
                  value={periodInput}
                  placeholder="30"
                  onChange={e => onPeriodChange(e.target.value)}
                />
              </div>
              <div className="text-xs text-red-600">
                {!periodValid && periodInput !== '' ? "Period must be between 1 and 365 days." : ""}
              </div>
              <Button variant="primary" onClick={createVault} disabled={!miniInstalled || !account || !!vault || !periodValid || !heirResolved?.address}>Create vault</Button>
              {!!vault && (
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
              {!vault && <div className="text-xs text-gray-600">
                Cannot find your vault? If you are an heir, you can search for vaults where you are designated as the heir.
              </div>}
              {!vault && account && (
                <div className="flex items-center gap-2">
                  <Button onClick={findHeirVaults} disabled={findingHeirVaults}>{findingHeirVaults ? 'Searching...' : 'Find vaults where I am heir'}</Button>
                  {heirFoundVaults.length > 1 && <span className="text-xs text-gray-600">Found {heirFoundVaults.length} matches</span>}
                </div>
              )}
              {!vault && heirFoundVaults.length > 1 && (
                <div className="grid gap-2 text-xs">
                  {heirFoundVaults.map((v) => (
                    <div key={v} className="flex items-center justify-between gap-2">
                      <span className="break-all">{short(v)}</span>
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => setVault(v)}>Use</Button>
                        <a className="text-blue-600 underline" href={`${EXPLORER}/address/${v}`} target="_blank" rel="noreferrer">View</a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {vault && gate2(
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle>Vault Details & Deposit</CardTitle>
                <div className="flex items-center gap-2">
                  {account && vaultOwner && account.toLowerCase() === vaultOwner.toLowerCase() && badge("Owner", "blue")}
                  {account && vaultHeir && account.toLowerCase() === vaultHeir.toLowerCase() && badge("Heir", "purple")}
                  {(() => {
                    if (vaultHeir && vaultOwner && vaultHeir.toLowerCase() === vaultOwner.toLowerCase()) return badge("Cancelled", "yellow");
                    return canClaim ? badge("Claimable", "green") : badge("Active", "gray");
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
                <div>
                  Created block: <b>{vaultCreatedBlock ?? "-"}</b>
                  {vaultCreatedBlock !== null ? (
                    <a
                      className="ml-2 text-blue-600 underline"
                      href={`${EXPLORER}/block/${vaultCreatedBlock}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View
                    </a>
                  ) : null}
                </div>
                <div>
                  Created at: <b>{vaultCreatedTime ? new Date(vaultCreatedTime * 1000).toLocaleString() : "-"}</b>
                </div>
              </div>
              <div className="text-sm">Wallet: {fmtUnits(walletWld)} {wldSymbol}</div>
              <div className="text-sm">Vault: {fmtUnits(vaultWld)} {wldSymbol}</div>
              {account && vaultOwner && account.toLowerCase() === vaultOwner.toLowerCase() && (
                <>
                  <div className="grid grid-cols-3 items-center gap-2">
                    <div>Deposit amount</div>
                    <Input className="col-span-2" inputMode="decimal" pattern="^[0-9]*[.]?[0-9]*$" placeholder="0.0"
                      value={amountStr} onChange={e => setAmountStr(e.target.value)} />
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
            </CardContent>
          </Card>
        )}

        {vault && gate2(
          <Card>
            <CardHeader><CardTitle>Timer & Controls</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="text-sm">Time until inheritance: <b>{fmt(timeRemaining)}</b></div>
              <div className="text-sm">
                {expired ? (
                  <>Expired at (만료됨): <b>{expiryLocal}</b></>
                ) : (
                  <>Expires at (만료 예정일): <b>{expiryLocal}</b></>
                )}
                <span className="text-xs text-gray-500 ml-2">{deviceTimeZone}</span>
              </div>
              <div className="text-sm">Claimable now: {canClaim ? "Yes" : "No"}</div>
              <div className="text-xs text-gray-500">
                Tap <b>Reset timer</b> to fill the countdown back to your full period.
              </div>
              <div className="flex gap-2 flex-wrap">
                {account && vaultOwner && account.toLowerCase() === vaultOwner.toLowerCase() && (
                  <>
                    <Button variant="primary" onClick={extendTime} disabled={!miniInstalled || !account}>Reset timer</Button>
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        className="w-28"
                        value={periodInput}
                        placeholder="30"
                        onChange={e => onPeriodChange(e.target.value)}
                      />
                      <Button onClick={changePeriod} disabled={!miniInstalled || !account || !periodValid}>Change period</Button>
                    </div>
                    <div className="grid grid-cols-3 items-center gap-2">
                      <div>New heir</div>
                      <Input className="col-span-2" placeholder="@username or 0x..." value={newHeir} onChange={e => onNewHeirInput(e.target.value)} />
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
                        형제 버튼인 withdraw 처럼 canClaim 으로 게이트해야 항상 실패하는
                        클릭을 사용자에게 노출하지 않는다. */}
                    <Button
                      variant="ghost"
                      onClick={cancelInheritance}
                      disabled={!miniInstalled || !account || canClaim}
                    >
                      Cancel (set heir to me)
                    </Button>
                    {supportsRelease && vaultWld === 0n && canClaim && (
                      <div className="flex items-center gap-2">
                        <Button onClick={() => setShowReleaseConfirm(true)} disabled={!miniInstalled || !account}>Release slot</Button>
                        <span className="text-xs text-gray-500">* Available only after expiry and when vault balance is 0. The contract remains on-chain; only the factory mapping is cleared.</span>
                      </div>
                    )}
                  </>
                )}
                {account && vaultHeir && account.toLowerCase() === vaultHeir.toLowerCase() && (
                  <Button variant="primary" onClick={claim} disabled={!miniInstalled || !canClaim}>Claim (heir)</Button>
                )}
                {!account || (!vaultOwner && !vaultHeir) ? (
                  <Button onClick={loadVault}>Re-scan</Button>
                ) : null}
              </div>
              {account && vaultOwner && account.toLowerCase() === vaultOwner.toLowerCase() && (
                <div className="space-y-2 border-t pt-3">
                  <div className="text-xs text-gray-500">Owner emergency withdraw (before expiry)</div>
                  <div className="grid grid-cols-3 items-center gap-2">
                    <div>Withdraw to</div>
                    <Input className="col-span-2" placeholder="0x..." value={withdrawTo} onChange={e => setWithdrawTo(e.target.value)} />
                  </div>
                  {withdrawTo && !ethers.isAddress(withdrawTo) && (
                    <div className="text-xs text-red-600">Invalid recipient address.</div>
                  )}
                  <div className="flex gap-2">
                    <Button onClick={setWithdrawToMe}>To me</Button>
                  </div>
                  <div className="grid grid-cols-3 items-center gap-2">
                    <div>Amount</div>
                    <Input className="col-span-2" inputMode="decimal" pattern="^[0-9]*[.]?[0-9]*$" placeholder="0.0"
                      value={withdrawAmountStr} onChange={e => setWithdrawAmountStr(e.target.value)} />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={setWithdrawMax}>Max</Button>
                  </div>
                  <Button onClick={ownerWithdraw} disabled={canClaim}>Withdraw (owner)</Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
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
