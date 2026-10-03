/**
 * MiniKit 2.x 스텁 — E2E 테스트 전용.
 *
 * World App 안에서만 동작하는 MiniKit 브릿지를 로컬 체인(anvil 등)에서는
 * 그대로 쓸 수 없으므로, 이 모듈로 대체해 앱의 실제 코드 경로를 실행한다.
 * 이 파일은 테스트 번들에만 포함되고 프로덕션 빌드에는 들어가지 않는다.
 *
 * 반드시 2.x 형태를 흉내내야 한다. 1.x 형태(`commandsAsync` + `finalPayload` +
 * abi/functionName)로 스텁을 남겨두면, 앱이 1.x 를 쓰는지 2.x 를 쓰는지
 * 테스트가 구분하지 못해 "통과했는데 기기에서 실패하는" 상태가 된다. 실제로
 * 앱이 2.x calldata 를 넘기는데 스텁이 1.x 를 기대하면 통과할 수 없다 —
 * 그 반대(스텁만 1.x)를 유지하면 앱이 1.x 로 되돌아가도 테스트가 조용한다.
 *
 * 서명하는 지갑은 window.__E2E_SIGNER__ 로 주입되는 외부 signer 이며,
 * 실제로는 window.ethereum (provider) 또는 지갑 Private Key 로 서명한다.
 */

declare global {
  interface Window {
    __E2E_SIGNER__?: {
      address: string;
      privateKey?: string;
    };
    ethereum?: any;
  }
}

export const Permission = { Notifications: "notifications" } as const;

const state = {
  installed: true,
  address: "" as string,
  permissionGranted: false,
  /** 강제로 실패시킬 다음 트랜잭션 (QA 용) */
  failNextTx: false,
  txLog: [] as string[],
  /** 마지막으로 보낸 calldata — 인코딩이 실제로 일어났는지 확인용 */
  lastCalldata: [] as { to: string; data: string }[],
  /** 마지막 실패 사유 — 앱이 삼키기 전에 스텁이 남긴다 */
  lastError: null as string | null,
};

/** E2E 검증용: 2.x calldata 형식으로 나갔는지 확인한다.
 *  테스트는 페이지 컨텍스트에서 동적 import 로 모듈을 다시 가져오면 다른 인스턴스를
 *  얻게 되어 상태를 볼 수 없다. 그래서 window 에 직접 노출한다. */
export function __getLastCalldata() {
  return state.lastCalldata;
}
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__E2E_MINIKIT__ = {
    lastCalldata: () => state.lastCalldata,
    txLog: () => state.txLog,
      lastError: () => state.lastError,
  };
}

export function __setState(patch: Partial<typeof state>) {
  Object.assign(state, patch);
  if (patch.address) state.address = patch.address;
}

/** Exercise the installed MiniKit SDK's structured send-error class in browser fixtures. */
export async function __throwSendTransactionError(code: string): Promise<never> {
  const { SendTransactionError } = await import("@worldcoin/minikit-js/commands");
  throw new SendTransactionError(code);
}

/** Run the installed SDK's real pre-handoff availability check, without a native send. */
export async function __sendUnavailableTransaction(input: Parameters<typeof import("@worldcoin/minikit-js/commands").sendTransaction>[0]) {
  const commands = await import("@worldcoin/minikit-js/commands");
  const wasAvailable = commands.isCommandAvailable(commands.Command.SendTransaction);
  commands.setCommandAvailable(commands.Command.SendTransaction, false);
  try {
    return await commands.sendTransaction(input);
  } finally {
    commands.setCommandAvailable(commands.Command.SendTransaction, wasAvailable);
  }
}

async function getSigner() {
  const { ethers } = await import("ethers");
  const cfg = window.__E2E_SIGNER__;
  if (!cfg) throw new Error("E2E: window.__E2E_SIGNER__ 가 설정되지 않음");
  if (cfg.privateKey) {
    return new ethers.Wallet(cfg.privateKey, await rpcProvider());
  }
  const p = window.ethereum;
  if (!p) throw new Error("E2E: window.ethereum 없음");
  await p.request({ method: "eth_requestAccounts" });
  return new ethers.BrowserProvider(p).getSigner();
}

async function rpcProvider() {
  const url = (import.meta as any).env?.VITE_RPC as string | undefined;
  const { ethers } = await import("ethers");
  return new ethers.JsonRpcProvider(url);
}

/** E2E-only: emulate an atomic smart-account batch with real local receipts. */
export async function __sendAtomicBatch(transactions: { to: string; data?: string; value?: string }[]) {
  const { Wallet, JsonRpcProvider, Interface } = await import("ethers");
  const local = window as unknown as { __E2E_RPC__: string; __E2E_BATCH_WALLET__: string };
  const provider = new JsonRpcProvider(local.__E2E_RPC__, 480, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 });
  try {
    const signer = new Wallet(window.__E2E_SIGNER__!.privateKey!, provider);
    const nonce = await signer.getNonce("pending");
    const code = await provider.getCode(signer.address);
    const authorization = code === "0x" ? await signer.authorize({ address: local.__E2E_BATCH_WALLET__, chainId: 480, nonce: nonce + 1 }) : null;
    const abi = new Interface(["function execute((address to,bytes data,uint256 value)[] calls)"]);
    const calls = transactions.map(tx => ({ to: tx.to, data: tx.data || "0x", value: BigInt(tx.value || 0) }));
    const tx = await signer.sendTransaction({ to: signer.address, data: abi.encodeFunctionData("execute", [calls]), nonce,
      gasLimit: 12_000_000n, ...(authorization ? { type: 4, authorizationList: [authorization] } : {}) });
    const receipt = await tx.wait();
    return { executedWith: "minikit", data: { status: "success", transaction_hash: receipt!.hash, from: signer.address } };
  } catch (error: any) {
    return { executedWith: "minikit", data: { status: "fail", error: error.shortMessage || error.message } };
  } finally { provider.destroy(); }
}

/** 2.x 의 walletAuth 응답: { executedWith, data } */
const ok = (data: unknown) => ({ executedWith: "minikit" as const, data });
/** 2.x 는 실패를 throw 하지 않고 status 로 알린다. */
const fail = (data: unknown) => ({ executedWith: "minikit" as const, data });

export const MiniKit = {
  install(_appId?: string) {
    return { success: state.installed };
  },
  isInstalled() {
    return state.installed;
  },
  async getUserByAddress(addr: string) {
    // 스토어 스크린샷에서 `@e2e_3c44cd` 같은 테스트 계정이 보이면 리뷰어가 "테스트 빌드를
    // 찍었네" 하고 읽는다. 하네스는 `/@e2e_/` 로 로그인 성공을 판정하므로 접두사를 지우면
    // 그 검사가 깨진다. 그래서 기본값은 그대로 두고, **스크린샷 전용**으로 호출 측이 이름을
    // 심으면 그걸 쓴다 (drv.mjs 의 preload 경로).
    //
    // `__E2E_USERNAMES__` 은 **주소별 맵**이다. 한 이름만 받으면 모든 지갑이 같은 이름으로
    // 보여 주인과 상속인이 한 사람처럼 찍힌다(실제로 그렇게 찍혔다 — "Tell your heir" 가
    // "Reaches @davis" 라고 해서 자기 자신에게 보내라는 안내가 되었다). 상속 절차 앱에서
    // **서로 다른 두 사람** 이라는 게 핵심이라 맵으로 받아야 한다.
    const w = typeof window !== "undefined" ? (window as unknown as {
      __E2E_USERNAME__?: string;
      __E2E_USERNAMES__?: Record<string, string>;
    }) : {};
    const byAddr = w.__E2E_USERNAMES__?.[addr.toLowerCase()];
    if (byAddr) return { username: byAddr };
    return { username: w.__E2E_USERNAME__ || `e2e_${addr.slice(2, 8).toLowerCase()}` };
  },
  async getUserByUsername(handle: string) {
    const { ethers } = await import("ethers");
    const h = ethers.keccak256(ethers.toUtf8Bytes(handle));
    const addr = ethers.getAddress("0x" + h.slice(26));
    return { username: handle, walletAddress: addr };
  },

  /**
   * 2.x: nonce 는 서버가 발급한다. 여기서는 형식만 흉내낸다.
   *
   * 메시지는 EIP-4361 순서를 지켜야 한다. 실제로 `siwe` 라이브러리는
   * `Chain ID: ` 줄이 없으면 "Missing 'Chain ID: '" 로 거절했다. 또 첫 줄의
   * 도메인은 주소가 아니라 실제로 서빙되는 origin 이어야 한다 — 주소를 넣으면
   * 서버의 도메인 검증(§api/auth/verify.ts)을 통과하지 못한다.
   */
  async walletAuth({ nonce }: { nonce: string }) {
    const signer = await getSigner();
    const address = await signer.getAddress();
    const domain = location.origin;
    const message = [
      `${domain} wants you to sign in with your Ethereum account:`,
      address,
      "",
      "Sign in to Inheritance",
      "",
      `URI: ${domain}`,
      "Version: 1",
      "Chain ID: 480",
      `Nonce: ${nonce}`,
      `Issued At: ${new Date().toISOString()}`,
    ].join("\n");
    const signature = await signer.signMessage(message);
    state.address = address;
    return ok({ address, message, signature });
  },

  async getPermissions() {
    return ok({ permissions: { notifications: state.permissionGranted } });
  },

  async requestPermission() {
    state.permissionGranted = true;
    return ok({});
  },

  /**
   * 2.x: 인코딩된 calldata 를 받는다 (abi/functionName 없음).
   *
   * 여기서 calldata 를 디코딩해 다시 서명한다. 앱이 실제로 2.x 형식으로 보내는지
   * 스텁이 강제한다 — 1.x 로 되돌아가면 `iface.fragments` 매칭이 실패해
   * 트랜잭션이 revert 되고, E2E 가 그걸 잡아낸다.
   */
  async sendTransaction({
    transactions,
    chainId,
  }: {
    transactions: { to: string; data?: string; value?: string }[];
    chainId: number;
  }) {
    if (chainId !== 480 && chainId !== 31337) {
      throw new Error(`E2E: 예상 밖 체인 ${chainId}`);
    }
    state.lastCalldata = transactions.map((t) => ({ to: t.to, data: t.data || "0x" }));
    if (state.failNextTx) {
      state.failNextTx = false;
      return fail({ status: "fail", error: "E2E forced failure" });
    }
    try {
      const signer = await getSigner();
      const from = await signer.getAddress();
      let lastHash: string | undefined;
      // 2.x 는 트랜잭션들을 순서대로 보낸다. 입금은 approve → deposit 이므로
      // 이 순서가 깨지면 deposit 의 transferFrom 이 allowance 부족으로 revert 된다.
      // nonce 를 직접 붙잡아 올린다.
      //
      // ethers 의 JsonRpcSigner 는 signer 인스턴스 단위로 nonce 를 기억하는데,
      // 블록 하나에 approve → deposit 두 건을 연달아 보내면 같은 nonce 가 두 번
      // 쓰이고 두 번째가 "nonce too low" 로 떨어진다. 그래서 입금 이 단계가
      // 조용히 실패했는데 E2E 는 calldata 만 확인해서 통과로 보고했다.
      //
      // 월드앱의 실제 경로는 번들러가 nonce 를 처리하므로 이 문제가 없다 —
      // 여기는 스텁이 그 동작을 흉내 내야 하는 부분이다.
      let nonce = await signer.getNonce("pending");
      for (const t of transactions) {
        if (!t.data || t.data === "0x") {
          const r = await signer.sendTransaction({ to: t.to, value: 0n, nonce: nonce++ });
          lastHash = r.hash;
          continue;
        }
        const tx = await signer.sendTransaction({ to: t.to, data: t.data, value: 0n, nonce: nonce++ });
        const rcpt = await tx.wait();
        lastHash = rcpt?.hash ?? lastHash;
      }
      // 2.x 는 userOpHash 를 돌려준다. 웹 폴백에서는 tx hash 다.
      return ok({
        userOpHash: lastHash,
        // Local signer returns a mined transaction, not a World App user operation.
        transaction_hash: lastHash,
        status: "success" as const,
        version: 2,
        from,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      // 실패 사유를 남긴다. 예전엔 그냥 fail() 로 돌려주기만 했는데, 그러면
      // 앱이 "트랜잭션이 실패했습니다" 라는 일반 문구만 보여주고 왜 실패했는지는
      // 아무도 알 수 없었다. E2E 가 이 값을 읽는다.
      state.lastError = (e as Error)?.message || String(e);
      return fail({ status: "fail", error: state.lastError });
    }
  },
};

export default { MiniKit };
