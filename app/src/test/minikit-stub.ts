/**
 * MiniKit 스텁 — E2E 테스트 전용.
 *
 * World App 안에서만 동작하는 MiniKit 브릿지를 로컬 체인(anvil 등)에서는
 * 그대로 쓸 수 없으므로, 이 모듈로 대체해 앱의 실제 코드 경로를 실행한다.
 * 이 파일은 테스트 번들에만 포함되고 프로덕션 빌드에는 들어가지 않는다.
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

export const VerificationLevel = { Orb: "ORB", Device: "DEVICE" } as const;
export const Permission = { Notifications: "notifications" } as const;

const state = {
  installed: true,
  address: "" as string,
  permissionGranted: false,
  /** 강제로 실패시킬 다음 트랜잭션 (QA 용) */
  failNextTx: false,
  /** 트랜잭션 승인 대기 여뎌 */
  autoApprove: true,
  txLog: [] as string[],
};

export function __setState(patch: Partial<typeof state>) {
  Object.assign(state, patch);
  if (patch.address) state.address = patch.address;
}

async function getSigner() {
  const { ethers } = await import("ethers");
  const cfg = window.__E2E_SIGNER__;
  if (!cfg) throw new Error("E2E: window.__E2E_SIGNER__ 가 설정되지 않음");
  if (cfg.privateKey) {
    return new ethers.Wallet(cfg.privateKey, await rpcProvider());
  }
  // MetaMask 등 주입 지갑
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


export const MiniKit = {
  install(_appId?: string) {
    return { success: state.installed };
  },
  isInstalled() {
    return state.installed;
  },
  async getUserByAddress(addr: string) {
    return { username: `e2e_${addr.slice(2, 8).toLowerCase()}` };
  },
  async getUserByUsername(handle: string) {
    // @alice 형태를 주소로 변환해 흉내낸다
    const { ethers } = await import("ethers");
    const h = ethers.keccak256(ethers.toUtf8Bytes(handle));
    const addr = ethers.getAddress("0x" + h.slice(26));
    return { username: handle, walletAddress: addr };
  },
  commandsAsync: {
    async walletAuth(_opts: { nonce: string }) {
      const signer = await getSigner();
      const addr = await signer.getAddress();
      state.address = addr;
      return { finalPayload: { status: "success", address: addr } };
    },
    async verify(_opts: unknown) {
      return { finalPayload: { status: "success", address: state.address } };
    },
    async getPermissions() {
      return {
        finalPayload: {
          status: "success",
          permissions: { notifications: state.permissionGranted },
        },
      };
    },
    async requestPermission(_o: unknown) {
      state.permissionGranted = true;
      return { finalPayload: { status: "success" } };
    },
    async sendTransaction({
      transaction,
    }: {
      transaction: { address: string; abi: string[]; functionName: string; args: unknown[] }[];
    }) {
      // 입금은 approve + deposit 두 건을 한 번에 보낸다. 일부러 첫 건만 처리하면
      // 실제 월드앱과 스텁의 동작이 갈라져 E2E 가 통과하는데 기기에서 실패한다.
      for (const call of transaction) state.txLog.push(call.functionName);
      if (state.failNextTx) {
        state.failNextTx = false;
        return { finalPayload: { status: "fail", error: "E2E forced failure" } };
      }
      try {
        const { ethers } = await import("ethers");
        const provider = await rpcProvider();
        const signer = await getSigner();
        const w = signer.connect(provider);
        let last: unknown = null;
        for (const call of transaction) {
          const contract = new ethers.Contract(call.address, call.abi, w);
          const tx = await contract[call.functionName](...(call.args as never[]));
          last = await tx.wait();
        }
        const rcpt = last as { hash: string } | null;
        return { finalPayload: { status: "success", transaction_hash: rcpt?.hash } };
      } catch (e) {
        // 컨트랙트 revert 를 그대로 전파해 앱의 에러 표시 경로를 검증한다
        return { finalPayload: { status: "fail", error: (e as Error).message } };
      }
    },
  },
};

export default { MiniKit, VerificationLevel, Permission };
