import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ReactElement } from "react";

// ===== World Chain
const FACTORY_ADDRESS = import.meta.env.VITE_FACTORY_ADDRESS as string;
const RPC_URL = (import.meta.env.VITE_RPC as string) || "https://worldchain-mainnet.g.alchemy.com/public";
const CHAIN_ID_HEX = "0x1E0"; // 480
const CHAIN_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: "World Chain",
  rpcUrls: [RPC_URL],
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  blockExplorerUrls: ["https://worldscan.org"],
} as const;
const EXPLORER = CHAIN_PARAMS.blockExplorerUrls?.[0] || "https://worldscan.org";

// const WORLD_APP_ID = import.meta.env.VITE_WORLD_APP_ID as string;
const REQUIRE_VERIFY = (import.meta.env.VITE_REQUIRE_VERIFY as string || "false").toLowerCase() === "true";
const WLD_ADDRESS = import.meta.env.VITE_WLD_ADDRESS as string;
const ACTION_ID = import.meta.env.VITE_WORLD_ACTION_ID || "inheritance_access";
// Block range guard: prefer explicit deploy block; otherwise fall back safely later
const FACTORY_DEPLOY_BLOCK_RAW = (import.meta.env as any).VITE_FACTORY_DEPLOY_BLOCK || "";
const FACTORY_DEPLOY_BLOCK: number | "latest" =
  FACTORY_DEPLOY_BLOCK_RAW ? parseInt(FACTORY_DEPLOY_BLOCK_RAW, 10) : "latest";

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
  const [heirSeq, setHeirSeq] = useState<number>(0);
  // Period (days) — use string input to avoid forced 0 when user clears field
  const [periodDays, setPeriodDays] = useState<number>(30);
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
    setPeriodDays(n);
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
  const [newHeirSeq, setNewHeirSeq] = useState<number>(0);
  const [copied, setCopied] = useState<null | "vault" | "owner" | "heir" | "wld">(null);
  const [supportsRelease, setSupportsRelease] = useState<boolean>((import.meta.env as any).VITE_FACTORY_RELEASE_SUPPORTED === "true");
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
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = (type: ToastType, msg: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1e6);
    setToasts((t) => [...t, { id, type, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  };
  
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
    // If deploy block is known, use it directly
    if (typeof FACTORY_DEPLOY_BLOCK === "number") {
      return await p.getLogs({ ...base, fromBlock: FACTORY_DEPLOY_BLOCK });
    }
    // Otherwise, try a short window from the head to avoid L2 gateway limits
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
  const getRwProvider = (): ethers.AbstractProvider | null => {
    return (provider as unknown as ethers.AbstractProvider) || null;
  };
  const waitForTxOrEvent = async (
    prov: ethers.AbstractProvider,
    opts: { txHash?: string; confirmations?: number; timeoutMs?: number; intervalMs?: number; check?: () => Promise<boolean> }
  ) => {
    const { txHash, confirmations = 1, timeoutMs = 60_000, intervalMs = 1500, check } = opts || {};
    const deadline = Date.now() + timeoutMs;
    if (txHash && /^0x([A-Fa-f0-9]{64})$/.test(txHash)) {
      const rcpt = await prov.waitForTransaction(txHash, confirmations);
      if (!rcpt || rcpt.status !== 1) throw new Error("Transaction reverted or missing receipt");
      return true;
    }
    if (check) {
      while (Date.now() < deadline) {
        try { if (await check()) return true; } catch {}
        await new Promise((r) => setTimeout(r, intervalMs));
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
  const isHeirSuspicious = () => {
    const c = heirResolved?.address && ethers.isAddress(heirResolved.address)
      ? ethers.getAddress(heirResolved.address)
      : (ethers.isAddress(heir) ? ethers.getAddress(heir) : "");
    if (!c) return false;
    return c === ethers.ZeroAddress || (account && c === ethers.getAddress(account));
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

  // Unified CTA (manual trigger) — requires World App
  // NOTE: Review requirement: login must use walletAuth, not verify.
  // We therefore authenticate first, then (optionally) verify after login.
  const continueWorldApp = async () => {
    try {
      const appId = document
        .querySelector('meta[name="minikit:app-id"]')
        ?.getAttribute("content") || "";
      const { MiniKit, VerificationLevel } = (await import("@worldcoin/minikit-js")) as any;
      const install = MiniKit.install?.(appId);
      const bridgeOn = (install?.success === true) || (MiniKit?.isInstalled?.() === true);
      if (!bridgeOn) {
        const code = install?.errorCode || 'bridge_off';
        const msg = install?.errorMessage || 'MiniKit bridge unavailable';
        setStatus(`Bridge off (${code}). Open inside World App and update to latest. ${msg}`);
        return;
      }

      // 1) Connect wallet if not yet connected (Wallet Auth is the login path)
      if (!account) {
        const nonce = Math.random().toString(36).slice(2);
        const { finalPayload } = await MiniKit.commandsAsync.walletAuth({ nonce });
        if (finalPayload?.status === "success") {
          const addr: string = finalPayload.address;
          const NETWORK = { chainId: 480, name: "world-chain" } as const;
          const p = new ethers.JsonRpcProvider(RPC_URL, NETWORK);
          setProvider(p); setSigner(null); setAccount(addr);
          try { localStorage.setItem('wld-account', ethers.getAddress(addr)); } catch {}
          // World App 환경 가정: username 조회 불필요
          setStatus("Connected (World App): " + addr.slice(0, 6) + "..." + addr.slice(-4));
        } else {
          setStatus("Connection cancelled or failed.");
          return;
        }
      }

      // 2) Optionally verify after login
      if (REQUIRE_VERIFY && !verified) {
        const { finalPayload } = await MiniKit.commandsAsync.verify({
          action: ACTION_ID,
          verification_level: VerificationLevel.Device,
        });
        if (finalPayload?.status !== "success") {
          setStatus("Verification cancelled or failed.");
          return;
        }
        setVerified(true);
        localStorage.setItem("wld-verified", "1");
        setStatus("Verification complete.");
      }
    } catch (e: any) {
      setStatus("Continue error: " + (e?.message || e));
    }
  };

  // New unified handler used by UI and auto-start
  const continueWorldApp2 = async () => {
    setCtaLoading(true);
    try {
      const appId = document
        .querySelector('meta[name="minikit:app-id"]')
        ?.getAttribute("content") || "";
      const { MiniKit, VerificationLevel } = (await import("@worldcoin/minikit-js")) as any;
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
        const nonce = Math.random().toString(36).slice(2);
        const { finalPayload } = await MiniKit.commandsAsync.walletAuth({ nonce });
        if (finalPayload?.status === 'success') {
          const addr: string = finalPayload.address;
          const NETWORK = { chainId: 480, name: "world-chain" } as const;
          const p = new ethers.JsonRpcProvider(RPC_URL, NETWORK);
          setProvider(p); setSigner(null); setAccount(addr);
          try { localStorage.setItem('wld-account', ethers.getAddress(addr)); } catch {}
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
        localStorage.setItem('wld-verified', '1');
        setStatus('Verification complete.');
      }
    } catch (e: any) {
      const msg = String(e?.message || e);
      setStatus('Continue error: ' + msg);
      pushToast('error', msg);
    } finally {
      setCtaLoading(false);
    }
  };

  // ---- connect (Wallet Auth only, never gate on verify)
  const connect = async () => {
    try {
      const appId = document
        .querySelector('meta[name="minikit:app-id"]')
        ?.getAttribute("content") || "";
      const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
      const install = MiniKit.install?.(appId);
      const bridgeOn = (install?.success === true) || (MiniKit?.isInstalled?.() === true);
      if (!bridgeOn) {
        const code = install?.errorCode || "bridge_off";
        const msg = install?.errorMessage || "MiniKit bridge unavailable";
        setStatus(`Bridge off (${code}). Open inside World App and update to latest. ${msg}`);
        pushToast('error', 'Open this mini app inside World App ▸ update to latest.');
        return;
      }
      const nonce = Math.random().toString(36).slice(2);
      const { finalPayload } = await MiniKit.commandsAsync.walletAuth({ nonce });
      if (finalPayload?.status === "success") {
        const addr: string = finalPayload.address;
        const NETWORK = { chainId: 480, name: "world-chain" } as const;
        const p = new ethers.JsonRpcProvider(RPC_URL, NETWORK);
        setProvider(p); setSigner(null); setAccount(addr);
        try { localStorage.setItem('wld-account', ethers.getAddress(addr)); } catch {}
        setStatus("Connected (World App): " + addr.slice(0, 6) + "..." + addr.slice(-4));
      } else {
        setStatus("Connection cancelled or failed");
      }
    } catch (e: any) {
      setStatus("Connect error: " + (e?.message || e) + ". Open this app inside World App and ensure you’re on the latest version.");
      pushToast('error', 'Open inside World App ▸ update to latest.');
    }
  };

  const doVerify = async () => {
    try {
      const appId = document
        .querySelector('meta[name="minikit:app-id"]')
        ?.getAttribute("content") || "";
      if (!appId.startsWith("app_")) {
        setStatus("Error: missing MiniKit app-id meta tag (.env/deploy)");
        return;
      }

      const { MiniKit, VerificationLevel } = (await import("@worldcoin/minikit-js")) as any;

      // Try MiniKit install (works only inside World App webview)
      const install = MiniKit.install?.(appId);
      const bridgeOn = (install?.success === true) || (MiniKit?.isInstalled?.() === true);
      if (!bridgeOn) {
        const code = install?.errorCode || "unknown";
        const msg = install?.errorMessage || "MiniKit bridge install failed";
        setStatus(`bridge=off (${code}) | ${msg}`);
        return;
      }
      setStatus(`bridge=on | appId=${appId}`);

      // 8s no-response guard
      const to = setTimeout(() => {
        setStatus(`No response. Check World App version, open as miniapp, and action id '${ACTION_ID}'.`);
      }, 8000);

      // First, Device-level verification handshake
      const { finalPayload } = await MiniKit.commandsAsync.verify({
        action: ACTION_ID,
        verification_level: VerificationLevel.Device,
      });

      clearTimeout(to);

      if (finalPayload?.status === "success") {
        setVerified(true);
        localStorage.setItem("wld-verified", "1");
        setStatus("Verification complete. You may proceed.");
        // ?몄쬆 吏곹썑 ?먮룞 ?곌껐? ?꾨옒 useEffect?먯꽌 泥섎━?⑸땲
        // ?꾩슂?섎㈃ ?ш린Orb濡ы샇異?        // await MiniKit.commandsAsync.verify({ action: ACTION_ID, verification_level: VerificationLevel.Orb });
      } else {
        setStatus("Verification cancelled or failed.");
      }
    } catch (e: any) {
      setStatus("Verification error: " + (e?.message || e));
    }
  };


  useEffect(() => {
    if (REQUIRE_VERIFY && localStorage.getItem("wld-verified") === "1") {
      setVerified(true);
    }
  }, []);

  // World App ?먮룞 ?곌껐 ?⑥닔
  const autoConnectWorldApp = async () => {
    try {
      const appId = document
        .querySelector('meta[name="minikit:app-id"]')
        ?.getAttribute("content") || "";
      const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
      const install = MiniKit.install?.(appId);
      if (!(install?.success === true || (MiniKit as any)?.isInstalled?.() === true)) return false;
      const nonce = Math.random().toString(36).slice(2);
      const { finalPayload } = await MiniKit.commandsAsync.walletAuth({ nonce });
      if (finalPayload?.status === "success") {
        const addr: string = finalPayload.address;
        const NETWORK = { chainId: 480, name: "world-chain" } as const;
        const p = new ethers.JsonRpcProvider(RPC_URL, NETWORK);
        setProvider(p); setSigner(null); setAccount(addr);
        try { localStorage.setItem('wld-account', ethers.getAddress(addr)); } catch {}
        setStatus("Connected (World App): " + addr.slice(0, 6) + "..." + addr.slice(-4));
        return true;
      }
    } catch { }
    return false;
  };

  // In-World App: on mount, initialize MiniKit bridge, WalletAuth first, then (optionally) Verify(Device)
  useEffect(() => {
    (async () => {
      try {
        const appId = document
          .querySelector('meta[name="minikit:app-id"]')
          ?.getAttribute("content") || "";
        const { MiniKit, VerificationLevel } = (await import("@worldcoin/minikit-js")) as any;
        // Ensure the MiniKit bridge is initialized before checking installation state.
        // Some hosts report isInstalled=false until install(appId) is called.
        const install = MiniKit.install?.(appId);
        const bridgeOn = (install?.success === true) || (MiniKit?.isInstalled?.() === true);
        if (!bridgeOn) {
          setStatus("Open in World App (MiniKit bridge unavailable)");
          setMiniInstalled(false);
          return;
        }
        setMiniInstalled(true);
        // 1) Wallet Auth — login must use walletAuth (docs)
        if (!account) {
          const nonce = Math.random().toString(36).slice(2);
          const { finalPayload } = await MiniKit.commandsAsync.walletAuth({ nonce });
          if (finalPayload?.status === 'success') {
            const addr: string = finalPayload.address;
            const NETWORK = { chainId: 480, name: "world-chain" } as const;
            const p = new ethers.JsonRpcProvider(RPC_URL, NETWORK);
            setProvider(p); setSigner(null); setAccount(addr);
            try { localStorage.setItem('wld-account', ethers.getAddress(addr)); } catch {}
            setStatus('Connected (World App): ' + addr.slice(0, 6) + '...' + addr.slice(-4));
            try {
              const u = await MiniKit.getUserByAddress?.(addr);
              if (u?.username) setUsername(u.username);
            } catch {}
          } else {
            setStatus('Connection cancelled or failed.');
            return;
          }
        }
        // 2) Verify(Device) — only after login and only if required
        if (REQUIRE_VERIFY && !verified) {
          const { finalPayload } = await MiniKit.commandsAsync.verify({
            action: ACTION_ID,
            verification_level: VerificationLevel.Device,
          });
          if (finalPayload?.status !== 'success') { setStatus('Verification cancelled or failed.'); return; }
          setVerified(true);
          localStorage.setItem('wld-verified', '1');
        }
      } catch (e: any) {
        setStatus('Auto connect error: ' + String(e?.message || e));
      }
    })();
  }, []);

  // Restore saved session (keeps user logged in across visits)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('wld-account') || '';
      if (saved && ethers.isAddress(saved)) {
        const addr = ethers.getAddress(saved);
        const NETWORK = { chainId: 480, name: 'world-chain' } as const;
        const p = new ethers.JsonRpcProvider(RPC_URL, NETWORK);
        setProvider(p); setSigner(null); setAccount(addr);
        setStatus((s) => s || 'Session restored');
      }
    } catch {}
  }, []);

  // Optional: fetch username for restored sessions when available
  useEffect(() => {
    (async () => {
      if (!account) return;
      try {
        const { MiniKit } = (await import('@worldcoin/minikit-js')) as any;
        const u = await MiniKit.getUserByAddress?.(account);
        if (u?.username) setUsername(u.username);
      } catch {}
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

  const loadVault = async () => {
    if (!factory || !account) return;
    const v = await factory.vaultOf(account);
    if (v && v !== ethers.ZeroAddress) {
      setVault(v);
      return;
    }
    // If owner vault not found, try to find vault where I'm heir via event logs
    try {
      const p: any = signer ? (signer as any).provider : provider;
      if (!p) return;
      setStatus("Searching inheritance for me (heir)...");
      const sig = ethers.id("VaultCreated(address,address,address,uint256)");
      const heirTopic = ethers.zeroPadValue(ethers.getAddress(account), 32);
      const logs = await safeGetLogs((p as ethers.AbstractProvider), {
        address: FACTORY_ADDRESS,
        topics: [sig, null, heirTopic],
        toBlock: "latest",
      });
      if (logs.length) {
        const iface = new ethers.Interface(FACTORY_ABI);
        const last = logs[logs.length - 1];
        const parsed: any = iface.parseLog({ topics: last.topics, data: last.data });
        const vaddr = parsed.args?.vault as string;
        if (vaddr && vaddr !== ethers.ZeroAddress) {
          setVault(vaddr);
          setStatus("Found inheritance vault for me: " + vaddr);
        } else {
          setStatus("No inheritance found for me.");
        }
      } else {
        setStatus("No inheritance found for me.");
      }
    } catch (e: any) {
      setStatus("Search error: " + (e?.message || e));
    }
  };

  // Username/address resolution helpers — accept @username or 0x… in inputs
  const getUsernameFor = async (addr: string) => {
    try {
      const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
      // Preflight simulation against RPC to surface readable errors
      try {
        const p = getRwProvider();
        if (p && account) {
          const iface = new ethers.Interface(FACTORY_ABI);
          const data = iface.encodeFunctionData('createVault', [resolved.address, seconds]);
          await (p as ethers.AbstractProvider).call({ to: FACTORY_ADDRESS, data, from: account });
        }
      } catch (simErr: any) {
        const raw = String(simErr?.reason || simErr?.shortMessage || simErr?.message || simErr);
        let friendly = raw;
        if (/ALREADY_HAS_VAULT/i.test(raw)) friendly = 'You already have a vault (factory is one-per-owner).';
        else if (/HeartbeatOutOfRange/i.test(raw)) friendly = 'Period must be 1–365 days.';
        else if (/InvalidAddress/i.test(raw)) friendly = 'Invalid heir address.';
        setStatus('Simulation: ' + friendly);
        pushToast('error', friendly);
        return;
      }
      const u = await MiniKit.getUserByAddress?.(addr);
      return u?.username as string | undefined;
    } catch { return undefined; }
  };
  const resolveHeirInput = async (input: string) => {
    const trimmed = (input || "").trim();
    if (!trimmed) return null;
    if (ethers.isAddress(trimmed)) {
      const uname = await getUsernameFor(ethers.getAddress(trimmed));
      return { username: uname, address: ethers.getAddress(trimmed) } as const;
    }
    try {
      const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
      const u = await MiniKit.getUserByUsername?.(trimmed.startsWith("@") ? trimmed.slice(1) : trimmed);
      if (u?.walletAddress && ethers.isAddress(u.walletAddress)) {
        return { username: u.username, address: ethers.getAddress(u.walletAddress) } as const;
      }
    } catch {}
    return null;
  };

  // Debounced input handlers to resolve username/address safely
  const onHeirInput = async (v: string) => {
    setHeir(v);
    const mySeq = Date.now();
    setHeirSeq(mySeq);
    if (!v) { setHeirResolved(null); return; }
    setResolvingHeir(true);
    try {
      const r = await resolveHeirInput(v);
      // Only apply latest result
      setHeirResolved((prev) => (heirSeq <= mySeq ? r : prev));
    } finally {
      // Clear resolving only if up-to-date
      if (heirSeq <= mySeq) setResolvingHeir(false);
    }
  };

  const onNewHeirInput = async (v: string) => {
    setNewHeir(v);
    const mySeq = Date.now();
    setNewHeirSeq(mySeq);
    if (!v) { setNewHeirResolved(null); return; }
    setResolvingNewHeir(true);
    try {
      const r = await resolveHeirInput(v);
      setNewHeirResolved((prev) => (newHeirSeq <= mySeq ? r : prev));
    } finally {
      if (newHeirSeq <= mySeq) setResolvingNewHeir(false);
    }
  };

  useEffect(() => { if (factory && account) loadVault(); }, [factory, account]);

  // Optional capability probe for releaseMyVault (if env not set but contract supports)
  useEffect(() => {
    (async () => {
      if (!factory || supportsRelease) return;
      try {
        const i = new ethers.Interface(["function releaseMyVault() returns (bool)"]);
        const data = i.encodeFunctionData("releaseMyVault", []);
        const p: any = signer ? (signer as any).provider : provider;
        if (!p) return;
        await (p as ethers.AbstractProvider).call({ to: FACTORY_ADDRESS, data });
        setSupportsRelease(true);
      } catch (e: any) {
        const msg = String(e?.reason || e?.shortMessage || e?.message || "");
        if (msg.includes("NO_VAULT") || msg.includes("NOT_OWNER") || msg.includes("NON_EMPTY")) {
          setSupportsRelease(true);
        }
      }
    })();
  }, [factory, supportsRelease]);

  const refreshVaultDetails = async () => {
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
      if (!withdrawTo) setWithdrawTo(o);
    } catch { }
  };
  useEffect(() => { if (vaultCtr) refreshVaultDetails(); }, [vaultCtr]);

  // ?⑺넗由대깽濡쒓렇?먯꽌 湲덇퀬 ?앹꽦 釉붾줉/?쒓컙 議고쉶
  const loadVaultCreationMeta = async () => {
    if (!vault || !(signer || provider)) return;
    try {
      const p: any = signer ? (signer as any).provider : provider;
      const sig = ethers.id("VaultCreated(address,address,address,uint256)");
      const iface = new ethers.Interface(FACTORY_ABI);
      const tryQuery = async (topics: (string | null | string[])[]) => {
        const logs = await safeGetLogs((p as ethers.AbstractProvider), {
          address: FACTORY_ADDRESS,
          topics,
          toBlock: "latest",
        });
        for (const lg of logs) {
          try {
            const parsed: any = iface.parseLog({ topics: lg.topics, data: lg.data });
            if (parsed?.args?.vault && String(parsed.args.vault).toLowerCase() === vault.toLowerCase()) {
              setVaultCreatedBlock(lg.blockNumber);
              const blk = await (p as ethers.AbstractProvider).getBlock(lg.blockNumber);
              setVaultCreatedTime(Number(blk?.timestamp || 0));
              return true;
            }
          } catch { }
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
    } catch (e: any) {
      // Meta query failure is non-critical
      setStatus((s) => s || ("Meta error: " + (e?.message || e)));
    }
  };
  useEffect(() => { if (vault) loadVaultCreationMeta(); }, [vault, vaultOwner, vaultHeir, provider, signer]);

  // ---- balances & timer
  const refreshBalances = async () => {
    if (!provider || !account) return;
    const token = new ethers.Contract(WLD_ADDRESS, ERC20_ABI, provider);
    const [sym, dec, userBal, vaultBal] = await Promise.all([
      token.symbol(), token.decimals(),
      token.balanceOf(account), vault ? token.balanceOf(vault) : Promise.resolve(0n)
    ]);
    setWldSymbol(sym); setWldDecimals(dec);
    setWalletWld(userBal); setVaultWld(vaultBal);
  };
  useEffect(() => { refreshBalances(); }, [provider, account, vault]);
  useEffect(() => {
    if (!provider || !account) return;
    const id = setInterval(() => { refreshBalances(); }, 30000);
    const onVis = () => { if (document.visibilityState === 'visible') refreshBalances(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [provider, account, vault]);

  const refreshTimer = async () => {
    if (!vaultCtr) return;
    const rem: bigint = await vaultCtr.timeRemaining();
    const cc: boolean = await vaultCtr.canClaim();
    setTimeRemaining(Number(rem));
    setCanClaim(cc);
  };
  useEffect(() => { if (vaultCtr) refreshTimer(); }, [vaultCtr]);
  useEffect(() => {
    if (!vaultCtr) return;
    const id = setInterval(() => { refreshTimer(); }, 15000);
    const onVis = () => { if (document.visibilityState === 'visible') refreshTimer(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [vaultCtr]);

  // ---- create vault
  const createVault = async () => {
    if (!factory) { setStatus("Connect first"); return; }
    if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
    // Prevent double-create: factory enforces 1-per-owner and will revert with ALREADY_HAS_VAULT
    if (vault) { setStatus("You already have a vault. Use it or release after expiry."); pushToast('info', 'Vault already exists'); return; }
    const resolved = heirResolved || await resolveHeirInput(heir);
    if (!resolved?.address) { setStatus("Enter a valid heir username or address"); return; }
    const days = periodNum;
    if (!periodValid) { setStatus("Period must be between 1 and 365 days."); return; }
    const seconds = BigInt(days) * 24n * 60n * 60n;
    try {
      const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
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
      if (prov) {
        const txh = (finalPayload as any).transaction_hash || (finalPayload as any).transactionId || (finalPayload as any).transaction_id;
        await waitForTxOrEvent(prov, {
          txHash: txh,
          check: async () => {
            const vchk = await factory.vaultOf(account);
            return vchk && vchk !== ethers.ZeroAddress;
          },
        });
      }
      setStatus("Vault created ✅");
      const v = await factory.vaultOf(account);
      setVault(v);
      refreshBalances(); refreshTimer();
    } catch (e: any) {
      const raw = String(e?.reason || e?.shortMessage || e?.message || e);
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
      const p: any = signer ? (signer as any).provider : provider;
      if (!p) return;
      const sig = ethers.id("VaultCreated(address,address,address,uint256)");
      const heirTopic = ethers.zeroPadValue(ethers.getAddress(account), 32);
      const logs = await safeGetLogs((p as ethers.AbstractProvider), {
        address: FACTORY_ADDRESS,
        topics: [sig, null, heirTopic],
        toBlock: "latest",
      });
      const iface = new ethers.Interface(FACTORY_ABI);
      const vaults: string[] = [];
      for (const lg of logs) {
        try {
          const parsed: any = iface.parseLog({ topics: lg.topics, data: lg.data });
          const v = String(parsed?.args?.vault || "");
          if (v && !vaults.includes(v)) vaults.push(v);
        } catch {}
      }
      setHeirFoundVaults(vaults);
      if (vaults.length === 1) {
        setVault(vaults[0]);
        pushToast('success', 'Detected a vault where you are heir.');
      }
      if (vaults.length === 0) pushToast('info', 'No vaults found where you are heir.');
    } catch (e: any) {
      pushToast('error', 'Heir scan error: ' + String(e?.message || e));
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
      const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
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
      if (prov) {
        const txh = (finalPayload as any).transaction_hash || (finalPayload as any).transactionId || (finalPayload as any).transaction_id;
        await waitForTxOrEvent(prov, {
          txHash: txh,
          check: async () => {
            const token = new ethers.Contract(WLD_ADDRESS, ERC20_ABI, provider as any);
            const vb: bigint = await token.balanceOf(vault);
            return vb > prev;
          },
        });
      }
      setStatus("Deposit complete ✅");
      setAmountStr("");
      refreshBalances();
    } catch (e: any) {
      setStatus("Deposit error: " + (e?.message || e));
      pushToast('error', String(e?.message || e));
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
      const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: vault, abi: VAULT_ABI, functionName: "ping", args: [] }],
        formatPayload: true,
      });
      if (finalPayload?.status !== "success") { setStatus("Reset cancelled or failed"); return; }
      setStatus("Pending… awaiting confirmation");
      const prevLp = vaultLastPing;
      const prov = getRwProvider();
      if (prov) {
        const txh = (finalPayload as any).transaction_hash || (finalPayload as any).transactionId || (finalPayload as any).transaction_id;
        await waitForTxOrEvent(prov, {
          txHash: txh,
          check: async () => {
            const lp: bigint = await (vaultCtr as any).lastPing();
            return Number(lp) > (prevLp || 0);
          },
        });
      }
      setStatus("Timer reset (full period restored) ✅");
      refreshTimer();
    } catch (e: any) {
      setStatus("Reset error: " + (e?.message || e));
      pushToast('error', String(e?.message || e));
    }
  };
  const changePeriod = async () => {
    if (!vaultCtr) return;
    if (!periodValid) { setStatus('Period must be between 1 and 365 days.'); return; }
    const seconds = BigInt(periodNum) * 24n * 60n * 60n;
    try {
      if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
      const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: vault, abi: VAULT_ABI, functionName: "updateHeartbeat", args: [seconds.toString()] }],
        formatPayload: true,
      });
      if (finalPayload?.status !== "success") { setStatus("Change period failed"); return; }
      setStatus("Pending… awaiting confirmation");
      const prov = getRwProvider();
      if (prov) {
        const txh = (finalPayload as any).transaction_hash || (finalPayload as any).transactionId || (finalPayload as any).transaction_id;
        await waitForTxOrEvent(prov, {
          txHash: txh,
          check: async () => {
            const hb: bigint = await (vaultCtr as any).heartbeatInterval();
            return Number(hb) === Number(seconds);
          },
        });
      }
      setStatus("Period updated ✅");
      refreshTimer();
    } catch (e: any) {
      setStatus("Change period error: " + (e?.message || e));
      pushToast('error', String(e?.message || e));
    }
  };
  const cancelInheritance = async () => {
    if (!vaultCtr) return;
    try {
      if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
      const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: vault, abi: VAULT_ABI, functionName: "cancelInheritance", args: [] }],
        formatPayload: true,
      });
      if (finalPayload?.status !== "success") { setStatus("Cancel failed"); return; }
      setStatus("Pending… awaiting confirmation");
      const prov = getRwProvider();
      if (prov) {
        const txh = (finalPayload as any).transaction_hash || (finalPayload as any).transactionId || (finalPayload as any).transaction_id;
        await waitForTxOrEvent(prov, {
          txHash: txh,
          check: async () => {
            const h = await (vaultCtr as any).heir();
            return h && h.toLowerCase() === vaultOwner.toLowerCase();
          },
        });
      }
      setStatus("Inheritance cancelled (heir=owner) ✅");
      refreshTimer();
    } catch (e: any) {
      setStatus("Cancel error: " + (e?.message || e));
      pushToast('error', String(e?.message || e));

    }
  };

  const updateHeir = async () => {
    if (!vaultCtr) return;
    const resolved = newHeirResolved || await resolveHeirInput(newHeir);
    if (!resolved?.address) { setStatus("Enter a valid heir username or address"); return; }
    try {
      if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
      const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: vault, abi: VAULT_ABI, functionName: "updateHeir", args: [resolved.address] }],
        formatPayload: true,
      });
      if (finalPayload?.status !== "success") { setStatus("Update heir failed"); return; }
      setStatus("Pending… awaiting confirmation");
      const prov = getRwProvider();
      if (prov) {
        const txh = (finalPayload as any).transaction_hash || (finalPayload as any).transactionId || (finalPayload as any).transaction_id;
        const target = resolved.address;
        await waitForTxOrEvent(prov, {
          txHash: txh,
          check: async () => {
            const h = await (vaultCtr as any).heir();
            return h && h.toLowerCase() === target.toLowerCase();
          },
        });
      }
      setStatus("Heir updated ✅");
      setNewHeir("");
      setNewHeirResolved(null);
      refreshVaultDetails();
    } catch (e: any) {
      setStatus("Update heir error: " + (e?.message || e));
      pushToast('error', String(e?.message || e));
    }
  };

  // ---- claim (after expiry)
  const claim = async () => {
    if (!vaultCtr) return;
    try {
      if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); return; }
      const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: vault, abi: VAULT_ABI, functionName: "claim", args: [] }],
        formatPayload: true,
      });
      if (finalPayload?.status !== "success") { setStatus("Claim failed"); return; }
      setStatus("Pending… awaiting confirmation");
      const prev = vaultWld;
      const prov = getRwProvider();
      if (prov) {
        const txh = (finalPayload as any).transaction_hash || (finalPayload as any).transactionId || (finalPayload as any).transaction_id;
        await waitForTxOrEvent(prov, {
          txHash: txh,
          check: async () => {
            const token = new ethers.Contract(WLD_ADDRESS, ERC20_ABI, provider as any);
            const vb: bigint = await token.balanceOf(vault);
            return vb < prev;
          },
        });
      }
      setStatus("Claim complete ✅");
      refreshBalances(); refreshTimer();
    } catch (e: any) {
      setStatus("Claim error: " + (e?.message || e));
      pushToast('error', String(e?.message || e));
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
      const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: vault, abi: VAULT_ABI, functionName: "ownerWithdrawWLD", args: [amt.toString(), withdrawTo] }],
        formatPayload: true,
      });
      if (finalPayload?.status !== "success") { setStatus("Withdraw cancelled or failed"); return; }
      setStatus("Pending… awaiting confirmation");
      const prev = vaultWld;
      const prov = getRwProvider();
      if (prov) {
        const txh = (finalPayload as any).transaction_hash || (finalPayload as any).transactionId || (finalPayload as any).transaction_id;
        await waitForTxOrEvent(prov, {
          txHash: txh,
          check: async () => {
            const token = new ethers.Contract(WLD_ADDRESS, ERC20_ABI, provider as any);
            const vb: bigint = await token.balanceOf(vault);
            return vb < prev;
          },
        });
      }
      setStatus("Withdraw complete ✅");
      setWithdrawAmountStr("");
      refreshBalances();
    } catch (e: any) {
      setStatus("Withdraw error: " + (e?.message || e));
      pushToast('error', String(e?.message || e));
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
    try {
      if (!miniInstalled) { setStatus("Open in World App to continue"); pushToast('error', 'Open in World App'); setReleasing(false); return; }
      const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
      const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
        transaction: [{ address: FACTORY_ADDRESS, abi: [...FACTORY_ABI, "function releaseMyVault() returns (bool)"], functionName: "releaseMyVault", args: [] }],
        formatPayload: true,
      });
      if (finalPayload?.status !== "success") { setStatus("Release cancelled or failed"); setReleasing(false); return; }
      setStatus("Pending… awaiting confirmation");
      const prov = getRwProvider();
      if (prov) {
        const txh = (finalPayload as any).transaction_hash || (finalPayload as any).transactionId || (finalPayload as any).transaction_id;
        await waitForTxOrEvent(prov, {
          txHash: txh,
          check: async () => {
            const v = await (factory as any).vaultOf(account);
            return !v || v === ethers.ZeroAddress;
          },
        });
      }
      setStatus("Released. You can create a new vault. ✅");
      setVault("");
      await loadVault();
    } catch (e: any) {
      setStatus("Release error: " + (e?.message || e));
      pushToast('error', String(e?.message || e));
    } finally {
      setReleasing(false);
      setShowReleaseConfirm(false);
      setReleaseAcknowledge(false);
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
  const gate = (node: ReactElement) => node;
  return (
    <div className="app-shell bg-gradient-to-b from-slate-50 to-slate-100">
      <header className="sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-white/70 border-b border-slate-200">
        <div className="container-narrow flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded bg-brand-600" />
            <div className="text-sm font-semibold tracking-tight">WLD Inheritance</div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="hidden sm:inline">World Chain</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5">{badge('Chain: 480', 'gray')}</span>
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
              <div className="text-xs text-gray-600">{status}</div>
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
                  <button className="underline" onClick={() => setShowAdvanced(v => !v)}>
                    {showAdvanced ? 'Hide details' : 'Show addresses & explorer links'}
                  </button>
                </div>
                {showAdvanced && (
                  <div className="grid gap-1 text-xs">
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
                    <Button variant="ghost" onClick={cancelInheritance} disabled={!miniInstalled || !account}>Cancel (set heir to me)</Button>
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
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.msg}</div>
        ))}
      </div>
      {showReleaseConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-md shadow-lg max-w-sm w-full p-4">
            <div className="text-lg font-semibold mb-2">Release vault slot?</div>
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
