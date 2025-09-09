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
const FACTORY_DEPLOY_BLOCK = parseInt((import.meta.env as any).VITE_FACTORY_DEPLOY_BLOCK || "0") || 0;

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
  const [provider, setProvider] = useState<ethers.BrowserProvider | ethers.JsonRpcProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [account, setAccount] = useState<string>("");

  const [verified, setVerified] = useState<boolean>(!REQUIRE_VERIFY);
  const [status, setStatus] = useState<string>("");

  const [heir, setHeir] = useState<string>("");
  const [periodDays, setPeriodDays] = useState<number>(30);

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
  const [copied, setCopied] = useState<null | "vault" | "owner" | "heir" | "wld">(null);
  const [supportsRelease, setSupportsRelease] = useState<boolean>((import.meta.env as any).VITE_FACTORY_RELEASE_SUPPORTED === "true");
  const [showReleaseConfirm, setShowReleaseConfirm] = useState<boolean>(false);
  const [releasing, setReleasing] = useState<boolean>(false);
  const [releaseAcknowledge, setReleaseAcknowledge] = useState<boolean>(false);
  const [ctaLoading, setCtaLoading] = useState<boolean>(false);
  type ToastType = 'info' | 'success' | 'error';
  type Toast = { id: number; type: ToastType; msg: string };
  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = (type: ToastType, msg: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1e6);
    setToasts((t) => [...t, { id, type, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  };

  // ---- helpers
  // const toUnits = (v: bigint) => Number(v) / 10 ** wldDecimals;
  const fmtUnits = (v: bigint, d = wldDecimals) => ethers.formatUnits(v, d);
  const parseAmount = (s: string) => {
    const [i, d = ""] = s.split(".");
    const dd = (d + "0".repeat(wldDecimals)).slice(0, wldDecimals);
    return BigInt(i || "0") * (10n ** BigInt(wldDecimals)) + BigInt(dd || "0");
  };
  const gate2 = (node: ReactElement) => node;
  const fmt = (s: number) => {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${d}d ${h}h ${m}m ${sec}s`;
  };
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

  // Unified CTA: verify (if required) then connect within World App
  const continueWorldApp = async () => {
    try {
      const appId = document
        .querySelector('meta[name="minikit:app-id"]')
        ?.getAttribute("content") || "";
      const { MiniKit, VerificationLevel } = (await import("@worldcoin/minikit-js")) as any;
      const install = MiniKit.install?.(appId);
      if (!install?.success) {
        setStatus("World App?먯꽌 ?댁뼱二쇱꽭(MiniKit bridge unavailable)");
        return;
      }

      // 1) Verify if required and not yet verified
      if (REQUIRE_VERIFY && !verified) {
        const { finalPayload } = await MiniKit.commandsAsync.verify({
          action: ACTION_ID,
          verification_level: VerificationLevel.Device,
        });
        if (finalPayload?.status !== "success") {
          setStatus("?몄쬆痍⑥냼?섏뿀嫄곕굹 ?ㅽ뙣?덉뒿?덈떎.");
          return;
        }
        setVerified(true);
        localStorage.setItem("wld-verified", "1");
        setStatus("?몄쬆 ?꾨즺. 吏媛곌껐吏꾪뻾?⑸땲");
      }

      // 2) Connect wallet if not yet connected
      if (!account) {
        const nonce = Math.random().toString(36).slice(2);
        const { finalPayload } = await MiniKit.commandsAsync.walletAuth({ nonce });
        if (finalPayload?.status === "success") {
          const addr: string = finalPayload.address;
          const p = new ethers.JsonRpcProvider(RPC_URL, 480);
          setProvider(p); setSigner(null); setAccount(addr);
          setStatus("Connected (World App): " + addr.slice(0, 6) + "..." + addr.slice(-4));
        } else {
          setStatus("?곌껐痍⑥냼?섏뿀嫄곕굹 ?ㅽ뙣?덉뒿?덈떎.");
          return;
        }
      }
    } catch (e: any) {
      setStatus("吏꾪뻾 ?ㅻ쪟: " + (e?.message || e));
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
      if (!install?.success) {
        setStatus("Open in World App (MiniKit bridge unavailable)");
        pushToast('error', 'MiniKit bridge unavailable. Open in World App.');
        return;
      }

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
        setStatus('Verification complete. Connecting wallet...');
      }

      if (!account) {
        const nonce = Math.random().toString(36).slice(2);
        const { finalPayload } = await MiniKit.commandsAsync.walletAuth({ nonce });
        if (finalPayload?.status === 'success') {
          const addr: string = finalPayload.address;
          const p = new ethers.JsonRpcProvider(RPC_URL, 480);
          setProvider(p); setSigner(null); setAccount(addr);
          setStatus('Connected (World App): ' + addr.slice(0, 6) + '...' + addr.slice(-4));
        } else {
          setStatus('Connection cancelled or failed.');
          pushToast('error', 'Connection cancelled or failed.');
          return;
        }
      }
    } catch (e: any) {
      const msg = String(e?.message || e);
      setStatus('Continue error: ' + msg);
      pushToast('error', msg);
    } finally {
      setCtaLoading(false);
    }
  };

  // ---- connect
  const connect = async () => {
    if (REQUIRE_VERIFY && !verified) {
      setStatus("Please verify in World App first.");
      return;
    }
    try {
      const appId = document
        .querySelector('meta[name="minikit:app-id"]')
        ?.getAttribute("content") || "";
      const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
      const install = MiniKit.install?.(appId);
      if (!install?.success) {
        setStatus("Open in World App (MiniKit bridge unavailable)");
        return;
      }
      const nonce = Math.random().toString(36).slice(2);
      const { finalPayload } = await MiniKit.commandsAsync.walletAuth({ nonce });
      if (finalPayload?.status === "success") {
        const addr: string = finalPayload.address;
        const p = new ethers.JsonRpcProvider(RPC_URL, 480);
        setProvider(p); setSigner(null); setAccount(addr);
        setStatus("Connected (World App): " + addr.slice(0, 6) + "..." + addr.slice(-4));
      } else {
        setStatus("Connection cancelled or failed");
      }
    } catch (e: any) {
      setStatus("Connect error: " + (e?.message || e));
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
      if (!install?.success) {
        const code = install?.errorCode || "unknown";
        const msg = install?.errorMessage || "MiniKit bridge install failed";
        setStatus(`bridge=off (${code}) | ${msg}`);
        return;
      }

      const installed = MiniKit?.isInstalled?.();
      setStatus(`bridge=${installed ? "on" : "off"} | appId=${appId}`);

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
      if (!install?.success) return false;
      const nonce = Math.random().toString(36).slice(2);
      const { finalPayload } = await MiniKit.commandsAsync.walletAuth({ nonce });
      if (finalPayload?.status === "success") {
        const addr: string = finalPayload.address;
        const p = new ethers.JsonRpcProvider(RPC_URL, 480);
        setProvider(p); setSigner(null); setAccount(addr);
        setStatus("Connected (World App): " + addr.slice(0, 6) + "..." + addr.slice(-4));
        return true;
      }
    } catch { }
    return false;
  };

  // 寃利꾨즺(?먮뒗 鍮꾪븘寃利? ?먮룞 ?곌껐 ?쒕룄
  useEffect(() => {
    (async () => {
      await continueWorldApp2();
    })();
  }, []);

  // ---- contracts
  const factory = useMemo(() => {
    const rw = signer || provider;
    return rw ? new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, rw) : null;
  }, [signer, provider]);
  const vaultCtr = useMemo(() => {
    const rw = signer || provider;
    return rw && vault ? new ethers.Contract(vault, VAULT_ABI, rw) : null;
  }, [signer, provider, vault]);

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
      const logs = await (p as ethers.AbstractProvider).getLogs({
        address: FACTORY_ADDRESS,
        fromBlock: FACTORY_DEPLOY_BLOCK,
        toBlock: "latest",
        topics: [sig, null, heirTopic],
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
        const logs = await (p as ethers.AbstractProvider).getLogs({
          address: FACTORY_ADDRESS,
          fromBlock: FACTORY_DEPLOY_BLOCK,
          toBlock: "latest",
          topics,
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

  const refreshTimer = async () => {
    if (!vaultCtr) return;
    const rem: bigint = await vaultCtr.timeRemaining();
    const cc: boolean = await vaultCtr.canClaim();
    setTimeRemaining(Number(rem));
    setCanClaim(cc);
  };
  useEffect(() => { if (vaultCtr) refreshTimer(); }, [vaultCtr]);

  // ---- create vault
  const createVault = async () => {
    if (!factory || !heir) { setStatus("Enter heir address"); return; }
    const seconds = BigInt(periodDays) * 24n * 60n * 60n;
    try {
      if (signer) {
        const tx = await factory.createVault(heir, seconds);
        setStatus("Creating vault: " + tx.hash);
        await tx.wait();
      } else {
        const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{
            address: FACTORY_ADDRESS,
            abi: FACTORY_ABI,
            functionName: "createVault",
            args: [heir, seconds.toString()],
          }],
          formatPayload: true,
        });
        if (finalPayload?.status !== "success") {
          setStatus("Transaction failed or cancelled");
          return;
        }
        setStatus("Creating vault: " + finalPayload.transaction_id);
      }
      setStatus("Vault created");
      const v = await factory.vaultOf(account);
      setVault(v);
      refreshBalances(); refreshTimer();
    } catch (e: any) {
      setStatus("Create error: " + (e?.message || e));
      pushToast('error', String(e?.message || e));
    }
  };

  // ---- deposit WLD
  const deposit = async () => {
    if (!vault) return;
    if (!amountStr) { setStatus("Enter amount"); return; }
    const amt = parseAmount(amountStr);
    if (amt <= 0n) { setStatus("Enter amount greater than 0"); return; }
    if (amt > walletWld) { setStatus("Amount exceeds wallet balance"); return; }
    try {
      if (signer) {
        const token = new ethers.Contract(WLD_ADDRESS, ERC20_ABI, signer);
        const tx = await token.transfer(vault, amt);
        setStatus("Depositing: " + tx.hash);
        await tx.wait();
      } else {
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
        setStatus("Depositing: " + finalPayload.transaction_id);
      }
      setStatus("Deposit complete");
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
      if (signer) {
        const tx = await vaultCtr.ping();
        setStatus("Extending timer: " + tx.hash);
        await tx.wait();
      } else {
        const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: vault, abi: VAULT_ABI, functionName: "ping", args: [] }],
          formatPayload: true,
        });
        if (finalPayload?.status !== "success") { setStatus("Extend cancelled or failed"); return; }
        setStatus("Extending timer: " + finalPayload.transaction_id);
      }
      setStatus("Timer extended (reset to full period)");
      refreshTimer();
    } catch (e: any) {
      setStatus("Extend error: " + (e?.message || e));
      pushToast('error', String(e?.message || e));
    }
  };
  const changePeriod = async () => {
    if (!vaultCtr) return;
    const seconds = BigInt(periodDays) * 24n * 60n * 60n;
    try {
      if (signer) {
        const tx = await vaultCtr.updateHeartbeat(seconds);
        setStatus("Updating period: " + tx.hash);
        await tx.wait();
      } else {
        const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: vault, abi: VAULT_ABI, functionName: "updateHeartbeat", args: [seconds.toString()] }],
          formatPayload: true,
        });
        if (finalPayload?.status !== "success") { setStatus("Change period failed"); return; }
        setStatus("Updating period: " + finalPayload.transaction_id);
      }
      setStatus("Period updated");
      refreshTimer();
    } catch (e: any) {
      setStatus("Change period error: " + (e?.message || e));
      pushToast('error', String(e?.message || e));
    }
  };
  const cancelInheritance = async () => {
    if (!vaultCtr) return;
    try {
      if (signer) {
        const tx = await vaultCtr.cancelInheritance();
        setStatus("Cancelling: " + tx.hash);
        await tx.wait();
      } else {
        const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: vault, abi: VAULT_ABI, functionName: "cancelInheritance", args: [] }],
          formatPayload: true,
        });
        if (finalPayload?.status !== "success") { setStatus("Cancel failed"); return; }
        setStatus("Cancelling: " + finalPayload.transaction_id);
      }
      setStatus("Inheritance cancelled (heir=owner)");
      refreshTimer();
    } catch (e: any) {
      setStatus("Cancel error: " + (e?.message || e));
      pushToast('error', String(e?.message || e));

    }
  };

  // ---- claim (after expiry)
  const claim = async () => {
    if (!vaultCtr) return;
    try {
      if (signer) {
        const tx = await vaultCtr.claim();
        setStatus("Claiming: " + tx.hash);
        await tx.wait();
      } else {
        const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: vault, abi: VAULT_ABI, functionName: "claim", args: [] }],
          formatPayload: true,
        });
        if (finalPayload?.status !== "success") { setStatus("Claim failed"); return; }
        setStatus("Claiming: " + finalPayload.transaction_id);
      }
      setStatus("Claim complete");
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
    const amt = parseAmount(withdrawAmountStr);
    if (amt <= 0n) { setStatus("Enter amount greater than 0"); return; }
    if (amt > vaultWld) { setStatus("Amount exceeds vault balance"); return; }
    try {
      if (signer) {
        const tx = await vaultCtr.ownerWithdrawWLD(amt, withdrawTo);
        setStatus("Withdrawing: " + tx.hash);
        await tx.wait();
      } else {
        const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: vault, abi: VAULT_ABI, functionName: "ownerWithdrawWLD", args: [amt.toString(), withdrawTo] }],
          formatPayload: true,
        });
        if (finalPayload?.status !== "success") { setStatus("Withdraw cancelled or failed"); return; }
        setStatus("Withdrawing: " + finalPayload.transaction_id);

      }
      setStatus("Withdraw complete");
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
      if (signer) {
        const tx = await (factory as any).releaseMyVault();
        setStatus("Releasing: " + (tx?.hash || "tx"));
        await tx.wait?.();
      } else {
        const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
        const { finalPayload } = await MiniKit.commandsAsync.sendTransaction({
          transaction: [{ address: FACTORY_ADDRESS, abi: [...FACTORY_ABI, "function releaseMyVault() returns (bool)"], functionName: "releaseMyVault", args: [] }],
          formatPayload: true,
        });
        if (finalPayload?.status !== "success") { setStatus("Release cancelled or failed"); setReleasing(false); return; }

        setStatus("Releasing: " + finalPayload.transaction_id);
      }
      setStatus("Released. You can create a new vault.");
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
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
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
      <div className="container-narrow px-4 py-4 md:py-6 grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">WLD Inheritance Vault</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2 flex-wrap items-center">
              <Button
                variant="primary"
                onClick={continueWorldApp2}
                disabled={ctaLoading || (!!account && (!REQUIRE_VERIFY || verified))}
              >
                {ctaLoading ? (<><span className="spinner mr-2"></span>Continuing...</>) : ((!account) ? "Continue in World App" : ((REQUIRE_VERIFY && !verified) ? "Complete verification" : "Connected"))}
              </Button>
              <div className="text-xs text-gray-600">{status}</div>
            </div>

            <div className="text-xs text-gray-500">
              Send <b>{wldSymbol}</b> into your vault. If you do not extend the timer before it expires,
              your designated heir can claim the full balance.
            </div>
          </CardContent>
        </Card>

        {gate2(
          <Card>
            <CardHeader><CardTitle>Create My Vault</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              <div className="text-sm">Wallet: {fmtUnits(walletWld)} {wldSymbol}</div>
              <div className="grid grid-cols-3 items-center gap-2">
                <div>Heir address</div>
                <Input className="col-span-2" placeholder="0x..." value={heir} onChange={e => setHeir(e.target.value)} />
              </div>
              <div className="grid grid-cols-3 items-center gap-2">
                <div>Period (days)</div>
                <Input type="number" className="col-span-2" value={periodDays}
                  onChange={e => setPeriodDays(parseInt(e.target.value || "0"))} />
              </div>
              <div className="text-xs text-red-600">
                {periodDays < 1 || periodDays > 365 ? "Period must be between 1 and 365 days." : ""}
              </div>
              <Button variant="primary" onClick={createVault} disabled={periodDays < 1 || periodDays > 365 || !ethers.isAddress(heir)}>Create vault</Button>
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
                Cannot find your vault? If you are an heir, we will try to locate it automatically. You can also re-scan from the timer card below.
              </div>}
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
                <div>
                  Vault:
                  {vault ? (
                    <>
                      <button className="ml-1 underline text-blue-700 break-all" onClick={() => copyText(vault, "vault")}>{short(vault)}</button>
                      {copied === "vault" && <span className="ml-2 text-green-700">Copied</span>}
                    </>
                  ) : <b className="break-all">-</b>}
                  {vault && <a className="ml-2 text-blue-600 underline" href={`${EXPLORER}/address/${vault}`} target="_blank" rel="noreferrer">View</a>}
                </div>
                <div>
                  Owner:
                  {vaultOwner ? (
                    <>
                      <button className="ml-1 underline text-blue-700 break-all" onClick={() => copyText(vaultOwner, "owner")}>{short(vaultOwner)}</button>
                      {copied === "owner" && <span className="ml-2 text-green-700">Copied</span>}
                    </>
                  ) : <b className="break-all">-</b>}
                  {vaultOwner && <a className="ml-2 text-blue-600 underline" href={`${EXPLORER}/address/${vaultOwner}`} target="_blank" rel="noreferrer">View</a>}
                </div>
                <div>
                  Heir:
                  {vaultHeir ? (
                    <>
                      <button className="ml-1 underline text-blue-700 break-all" onClick={() => copyText(vaultHeir, "heir")}>{short(vaultHeir)}</button>
                      {copied === "heir" && <span className="ml-2 text-green-700">Copied</span>}
                    </>
                  ) : <b className="break-all">-</b>}
                  {vaultHeir && <a className="ml-2 text-blue-600 underline" href={`${EXPLORER}/address/${vaultHeir}`} target="_blank" rel="noreferrer">View</a>}
                </div>
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
                    <Input className="col-span-2" inputMode="decimal" placeholder="0.0"
                      value={amountStr} onChange={e => setAmountStr(e.target.value)} />
                  </div>
                  <div className="flex gap-2 flex-wrap items-center">
                    <div className="text-xs text-gray-600">Available: {fmtUnits(walletWld)} {wldSymbol}</div>
                    <Button variant="ghost" onClick={() => setPct(25)}>25%</Button>
                    <Button variant="ghost" onClick={() => setPct(50)}>50%</Button>
                    <Button variant="ghost" onClick={() => setPct(75)}>75%</Button>
                    <Button variant="ghost" onClick={setMax}>Max</Button>
                    <Button variant="primary" onClick={deposit}>Deposit</Button>
                    <Button onClick={refreshBalances}>Refresh</Button>
                  </div>
                </>
              )}
              <div className="text-xs text-gray-500">
                * This vault accepts only WLD. Do not send ETH or other tokens.
              </div>
            </CardContent>
          </Card>
        )}

        {vault && gate2(
          <Card>
            <CardHeader><CardTitle>Timer & Controls</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="text-sm">Time until inheritance: <b>{fmt(timeRemaining)}</b></div>
              <div className="text-sm">Claimable now: {canClaim ? "Yes" : "No"}</div>
              <div className="text-xs text-gray-500">
                Tap <b>Extend time</b> to reset the countdown back to your full period.
              </div>
              <div className="flex gap-2 flex-wrap">
                {account && vaultOwner && account.toLowerCase() === vaultOwner.toLowerCase() && (
                  <>
                    <Button variant="primary" onClick={extendTime}>Extend time</Button>
                    <div className="flex items-center gap-2">
                      <Input type="number" className="w-28" value={periodDays}
                        onChange={e => setPeriodDays(parseInt(e.target.value || "0"))} />
                      <Button onClick={changePeriod} disabled={periodDays < 1 || periodDays > 365}>Change period</Button>
                    </div>
                    <Button variant="ghost" onClick={cancelInheritance}>Cancel (set heir to me)</Button>
                    {supportsRelease && vaultWld === 0n && canClaim && (
                      <div className="flex items-center gap-2">
                        <Button onClick={() => setShowReleaseConfirm(true)}>Release slot</Button>
                        <span className="text-xs text-gray-500">* Available only after expiry and when vault balance is 0. The contract remains on-chain; only the factory mapping is cleared.</span>
                      </div>
                    )}
                  </>
                )}
                {account && vaultHeir && account.toLowerCase() === vaultHeir.toLowerCase() && (
                  <Button variant="primary" onClick={claim} disabled={!canClaim}>Claim (heir)</Button>
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
                  <div className="flex gap-2">
                    <Button onClick={setWithdrawToMe}>To me</Button>
                  </div>
                  <div className="grid grid-cols-3 items-center gap-2">
                    <div>Amount</div>
                    <Input className="col-span-2" inputMode="decimal" placeholder="0.0"
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
              <Button variant="primary" onClick={releaseSlot} disabled={releasing || !releaseAcknowledge}>Confirm</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
