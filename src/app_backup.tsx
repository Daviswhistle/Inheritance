// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import detectEthereumProvider from "@metamask/detect-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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

const WORLD_APP_ID = import.meta.env.VITE_WORLD_APP_ID as string;
const REQUIRE_VERIFY = (import.meta.env.VITE_REQUIRE_VERIFY as string || "false").toLowerCase() === "true";
const WLD_ADDRESS = import.meta.env.VITE_WLD_ADDRESS as string;
const ACTION_ID = import.meta.env.VITE_WORLD_ACTION_ID || "inheritance_access";
const FACTORY_DEPLOY_BLOCK = parseInt((import.meta.env as any).VITE_FACTORY_DEPLOY_BLOCK || "0") || 0;

// ===== WLD 전용 팩토리/금고 ABI
const FACTORY_ABI = [
  "event VaultCreated(address indexed owner, address indexed heir, address vault, uint256 heartbeatInterval)",
  "function createVault(address heir, uint256 heartbeatInterval) external returns (address)",
  "function vaultOf(address owner) external view returns (address)",
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
  const [usdPerWld, setUsdPerWld] = useState<number | null>(null);
  const [amountStr, setAmountStr] = useState("");
  const [withdrawTo, setWithdrawTo] = useState<string>("");
  const [withdrawAmountStr, setWithdrawAmountStr] = useState<string>("");

  // ---- helpers
  const toUnits = (v: bigint) => Number(v) / 10 ** wldDecimals;
  const parseAmount = (s: string) => {
    const [i, d = ""] = s.split(".");
    const dd = (d + "0".repeat(wldDecimals)).slice(0, wldDecimals);
    return BigInt(i || "0") * (10n ** BigInt(wldDecimals)) + BigInt(dd || "0");
  };
  const fmt = (s: number) => {
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${d}일 ${h}시간 ${m}분 ${sec}초`;
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

  // ---- connect
  const connect = async () => {
    if (REQUIRE_VERIFY && !verified) {
      setStatus("먼저 사람 인증이 필요합니다.");
      return;
    }

    // 1) World App + MiniKit 경로 (권장)
    try {
      const appId = document
        .querySelector('meta[name="minikit:app-id"]')
        ?.getAttribute("content") || "";
      const { MiniKit } = (await import("@worldcoin/minikit-js")) as any;
      const install = MiniKit.install?.(appId);
      if (install?.success) {
        // World App에서는 표준 provider가 없으므로 wallet-auth로 주소 확보
        const nonce = Math.random().toString(36).slice(2);
        const { finalPayload } = await MiniKit.commandsAsync.walletAuth({ nonce });
        if (finalPayload?.status === "success") {
          const addr: string = finalPayload.address;
          // 읽기 전용 provider (월드체인 RPC)
          const p = new ethers.JsonRpcProvider(RPC_URL, 480);
          setProvider(p); setSigner(null); setAccount(addr);
          setStatus("Connected (World App): " + addr.slice(0, 6) + "..." + addr.slice(-4));
          return; // World App 경로 성공 시 여기서 종료
        }
      }
    } catch (_) { /* noop - 메타마스크 경로로 폴백 */ }

    // 2) 일반 브라우저/메타마스크 폴백
    let injected: any = await detectEthereumProvider({ mustBeMetaMask: false });
    const eth: any = (window as any).ethereum;
    if (!injected && eth?.providers?.length) {
      injected = eth.providers[0];
    } else if (!injected) {
      injected = eth;
    }
    if (!injected) { setStatus("지갑을 찾지 못했습니다. World App에서 열어주세요."); return; }

    try {
      await injected.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
    } catch (e: any) {
      if (e?.code === 4902) {
        await injected.request({ method: "wallet_addEthereumChain", params: [CHAIN_PARAMS] });
      } else { setStatus("네트워크 전환 실패: " + (e?.message || e)); return; }
    }

    await injected.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
    const p = new ethers.BrowserProvider(injected);
    await p.send("eth_requestAccounts", []);
    const s = await p.getSigner();
    const addr = await s.getAddress();
    setProvider(p); setSigner(s); setAccount(addr);
    setStatus("Connected: " + addr.slice(0, 6) + "..." + addr.slice(-4));

    injected.on?.("accountsChanged", (accounts: string[]) => { if (accounts?.length) setAccount(accounts[0]); });
    injected.on?.("chainChanged", () => window.location.reload());
  };

  const doVerify = async () => {
    try {
      const appId = document
        .querySelector('meta[name="minikit:app-id"]')
        ?.getAttribute("content") || "";
      if (!appId.startsWith("app_")) {
        setStatus("오류: app-id 메타태그가 비어있습니다(.env/배포 확인).");
        return;
      }

      const { MiniKit, VerificationLevel } = (await import("@worldcoin/minikit-js")) as any;

      // MiniKit 설치 시도 (World App 내 웹뷰에서만 성공)
      const install = MiniKit.install?.(appId);
      if (!install?.success) {
        const code = install?.errorCode || "unknown";
        const msg = install?.errorMessage || "MiniKit 설치 실패";
        setStatus(`bridge=off (${code}) | ${msg}`);
        return;
      }

      const installed = MiniKit?.isInstalled?.();
      setStatus(`bridge=${installed ? "on" : "off"} | appId=${appId}`);

      // 8초 무응답 감지 타이머
      const to = setTimeout(() => {
        setStatus(`응답이 없습니다. World App 최신버전/미니앱으로 열었는지 확인, 액션 '${ACTION_ID}' 식별자 점검.`);
      }, 8000);

      // 먼저 Device로 핸드셰이크 테스트
      const { finalPayload } = await MiniKit.commandsAsync.verify({
        action: ACTION_ID,
        verification_level: VerificationLevel.Device,
      });

      clearTimeout(to);

      if (finalPayload?.status === "success") {
        setVerified(true);
        localStorage.setItem("wld-verified", "1");
        setStatus("사람 인증(디바이스) 완료 ✅ 이제 Orb로 변경해도 됩니다.");
        // 인증 직후 자동 연결은 아래 useEffect에서 처리됩니다.
        // 필요하면 여기서 Orb로 재호출
        // await MiniKit.commandsAsync.verify({ action: ACTION_ID, verification_level: VerificationLevel.Orb });
      } else {
        setStatus("인증이 취소되었거나 실패했습니다.");
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

  // World App 자동 연결 함수
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

  // 검증 완료(또는 비필수 검증) 시 자동 연결 시도
  useEffect(() => {
    (async () => {
      if ((!REQUIRE_VERIFY || verified) && !account) {
        await autoConnectWorldApp();
      }
    })();
  }, [verified, account]);

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
    // 소유자 금고가 없으면, 내가 상속인인 금고를 이벤트 로그에서 검색
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
    } catch {}
  };
  useEffect(() => { if (vaultCtr) refreshVaultDetails(); }, [vaultCtr]);

  // 팩토리 이벤트 로그에서 금고 생성 블록/시간 조회
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
          } catch {}
        }
        return false;
      };

      // 1) owner로 필터
      if (vaultOwner) {
        const ownerTopic = ethers.zeroPadValue(ethers.getAddress(vaultOwner), 32);
        if (await tryQuery([sig, ownerTopic])) return;
      }
      // 2) heir로 필터
      if (vaultHeir) {
        const heirTopic = ethers.zeroPadValue(ethers.getAddress(vaultHeir), 32);
        if (await tryQuery([sig, null, heirTopic])) return;
      }
      // 3) 현재 계정으로 시도
      if (account) {
        const accTopic = ethers.zeroPadValue(ethers.getAddress(account), 32);
        if (await tryQuery([sig, accTopic])) return;
        if (await tryQuery([sig, null, accTopic])) return;
      }
    } catch (e: any) {
      // 메타 조회 실패는 치명적이지 않으므로 상태만 업데이트
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
    try {
      const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=worldcoin&vs_currencies=usd");
      const j = await r.json(); setUsdPerWld(j.worldcoin?.usd ?? null);
    } catch { }
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
    if (!factory || !heir) { setStatus("상속인 주소를 입력하세요"); return; }
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
          setStatus("트랜잭션 실패 혹은 취소됨");
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
    }
  };

  // ---- deposit WLD
  const deposit = async () => {
    if (!vault) return;
    if (!amountStr) { setStatus("금액을 입력하세요"); return; }
    const amt = parseAmount(amountStr);
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
        if (finalPayload?.status !== "success") { setStatus("입금이 취소되었거나 실패했습니다."); return; }
        setStatus("Depositing: " + finalPayload.transaction_id);
      }
      setStatus("Deposit complete");
      setAmountStr("");
      refreshBalances();
    } catch (e: any) {
      setStatus("Deposit error: " + (e?.message || e));
    }
  };
  const setMax = () => setAmountStr(String(toUnits(walletWld)));

  // ---- life signals (사용자 문구로)
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
        if (finalPayload?.status !== "success") { setStatus("연장이 취소/실패했습니다."); return; }
        setStatus("Extending timer: " + finalPayload.transaction_id);
      }
      setStatus("Timer extended (reset to full period)");
      refreshTimer();
    } catch (e: any) {
      setStatus("Extend error: " + (e?.message || e));
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
        if (finalPayload?.status !== "success") { setStatus("기간 변경 실패"); return; }
        setStatus("Updating period: " + finalPayload.transaction_id);
      }
      setStatus("Period updated");
      refreshTimer();
    } catch (e: any) {
      setStatus("Change period error: " + (e?.message || e));
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
        if (finalPayload?.status !== "success") { setStatus("취소 실패"); return; }
        setStatus("Cancelling: " + finalPayload.transaction_id);
      }
      setStatus("Inheritance cancelled (heir=owner)");
      refreshTimer();
    } catch (e: any) {
      setStatus("Cancel error: " + (e?.message || e));
    }
  };

  // ---- claim (만기 후)
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
        if (finalPayload?.status !== "success") { setStatus("청구 실패"); return; }
        setStatus("Claiming: " + finalPayload.transaction_id);
      }
      setStatus("Claim complete");
      refreshBalances(); refreshTimer();
    } catch (e: any) {
      setStatus("Claim error: " + (e?.message || e));
    }
  };

  // Owner withdraw WLD (만기 전)
  const ownerWithdraw = async () => {
    if (!vaultCtr) return;
    if (!withdrawTo) { setStatus("수령 주소를 입력하세요"); return; }
    if (!withdrawAmountStr) { setStatus("금액을 입력하세요"); return; }
    const amt = parseAmount(withdrawAmountStr);
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
        if (finalPayload?.status !== "success") { setStatus("회수가 취소/실패했습니다."); return; }
        setStatus("Withdrawing: " + finalPayload.transaction_id);
      }
      setStatus("Withdraw complete");
      setWithdrawAmountStr("");
      refreshBalances();
    } catch (e: any) {
      setStatus("Withdraw error: " + (e?.message || e));
    }
  };

  const setWithdrawMax = () => setWithdrawAmountStr(String(toUnits(vaultWld)));
  const setWithdrawToMe = () => {
    if (account) setWithdrawTo(account);
    else if (vaultOwner) setWithdrawTo(vaultOwner);
  };

  // ---- UI
  const gate = (node: JSX.Element) =>
    (REQUIRE_VERIFY && !verified)
      ? (
        <div className="p-4 border rounded bg-yellow-50 text-sm">
          World ID verification required. Tap the button below to continue.
          <div className="mt-2"><Button onClick={doVerify}>Verify with World App</Button></div>
        </div>
      )
      : node;

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-md mx-auto grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">WLD Inheritance Vault</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              <Button onClick={doVerify} disabled={!REQUIRE_VERIFY || verified}>
                {verified ? "Verified" : "Verify in World App"}
              </Button>
              <div className="text-xs text-gray-600">{status}</div>
            </div>
            <div className="text-xs text-gray-500">
              Send <b>{wldSymbol}</b> into your personal vault. If you don’t extend the timer before it expires,
              your designated heir can claim the entire balance automatically.
            </div>
          </CardContent>
        </Card>

        {gate(
          <Card>
            <CardHeader><CardTitle>Create My Vault</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
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
                {periodDays < 1 || periodDays > 365 ? "기간은 1~365일이어야 합니다." : ""}
              </div>
              <Button onClick={createVault} disabled={periodDays < 1 || periodDays > 365}>Create vault</Button>
              {vault && <div className="text-xs text-gray-600 break-all">Your vault: {vault}</div>}
              {!vault && <div className="text-xs text-gray-600">
                Don’t see your vault? If you’re an heir, we’ll try to locate it automatically. You can also re-scan from the timer card below.
              </div>}
            </CardContent>
          </Card>
        )}

        {vault && gate(
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
                  Vault: <b className="break-all">{vault || "-"}</b>
                  {vault && <a className="ml-2 text-blue-600 underline" href={`${EXPLORER}/address/${vault}`} target="_blank" rel="noreferrer">View</a>}
                </div>
                <div>
                  Owner: <b className="break-all">{vaultOwner || "-"}</b>
                  {vaultOwner && <a className="ml-2 text-blue-600 underline" href={`${EXPLORER}/address/${vaultOwner}`} target="_blank" rel="noreferrer">View</a>}
                </div>
                <div>
                  Heir: <b className="break-all">{vaultHeir || "-"}</b>
                  {vaultHeir && <a className="ml-2 text-blue-600 underline" href={`${EXPLORER}/address/${vaultHeir}`} target="_blank" rel="noreferrer">View</a>}
                </div>
                <div>Heartbeat: <b>{vaultHeartbeat ? Math.floor(vaultHeartbeat / 86400) : 0} days</b></div>
                <div>Last ping: <b>{vaultLastPing ? new Date(vaultLastPing * 1000).toLocaleString() : "-"}</b></div>
                <div>
                  Token (WLD): <b className="break-all">{WLD_ADDRESS}</b>
                  {WLD_ADDRESS && <a className="ml-2 text-blue-600 underline" href={`${EXPLORER}/address/${WLD_ADDRESS}`} target="_blank" rel="noreferrer">View</a>}
                </div>
                <div>
                  Created block: <b>{vaultCreatedBlock ?? "-"}</b>
                  {vaultCreatedBlock !== null && <a className="ml-2 text-blue-600 underline" href={`${EXPLORER}/block/${vaultCreatedBlock}`} target="_blank" rel="noreferrer">View</a>}
                </div>
                <div>Created at: <b>{vaultCreatedTime ? new Date(vaultCreatedTime * 1000).toLocaleString() : "-"}</b></div>
              </div>
              <div className="text-sm">
                Wallet: {toUnits(walletWld).toLocaleString()} {wldSymbol}
                {usdPerWld ? ` (~$${(toUnits(walletWld) * usdPerWld).toFixed(2)})` : ""}
              </div>
              <div className="text-sm">
                Vault: {toUnits(vaultWld).toLocaleString()} {wldSymbol}
                {usdPerWld ? ` (~$${(toUnits(vaultWld) * usdPerWld).toFixed(2)})` : ""}
              </div>
              {account && vaultOwner && account.toLowerCase() === vaultOwner.toLowerCase() && (
                <>
                  <div className="grid grid-cols-3 items-center gap-2">
                    <div>Deposit amount</div>
                    <Input className="col-span-2" inputMode="decimal" placeholder="0.0"
                      value={amountStr} onChange={e => setAmountStr(e.target.value)} />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={setMax}>Max</Button>
                    <Button onClick={deposit}>Deposit</Button>
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

        {vault && gate(
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
                    <Button onClick={extendTime}>Extend time</Button>
                    <div className="flex items-center gap-2">
                      <Input type="number" className="w-28" value={periodDays}
                        onChange={e => setPeriodDays(parseInt(e.target.value || "0"))} />
                      <Button onClick={changePeriod} disabled={periodDays < 1 || periodDays > 365}>Change period</Button>
                    </div>
                    <Button onClick={cancelInheritance}>Cancel (set heir to me)</Button>
                  </>
                )}
                {account && vaultHeir && account.toLowerCase() === vaultHeir.toLowerCase() && (
                  <Button onClick={claim} disabled={!canClaim}>Claim (heir)</Button>
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
    </div>
  );
}
