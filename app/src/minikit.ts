import { ethers } from "ethers";
import { CHAIN_ID } from "@/config";

/**
 * MiniKit 2.x 로 보내는 트랜잭션의 한 건.
 *
 * 2.x 는 abi/functionName/args 를 받지 않는다. calldata 를 직접 인코딩해
 * `transactions: [{ to, data, value }]` 형태로 넘겨야 하고, 응답도
 * `{ executedWith, data }` 로 바뀌며 `transaction_hash` 대신 `userOpHash` 를 준다.
 * 그 세 가지를 9개 콜 사이트에 반복하면 일부만 빠뜨리게 되므로 한 곳에 모은다.
 */
export type ContractCall = {
  address: string;
  abi: string[];
  functionName: string;
  args?: unknown[];
};

export type TxSubmission = {
  /** World App 은 user operation hash, 웹 폴백은 트랜잭션 해시. */
  hash?: string;
  /** 폴백 실행 경로. 월드앱 안이면 항상 "minikit". */
  executedWith: string;
};

export type TxFailure = {
  ok: false;
  error: string;
  /** 사용자에게 보여줄 수 있는 메시지인지 여부. */
  userFacing: boolean;
};

export type TxResult = { ok: true; tx: TxSubmission } | TxFailure;

const loadMiniKitModule = () => import("@worldcoin/minikit-js");

/** ethers 의 중첩된 cause 를 끝까지 펼쳐 사람이 읽을 문장을 만든다. */
function unwrap(err: unknown): string {
  const seen = new Set<string>();
  let cur: unknown = err;
  const parts: string[] = [];
  while (cur && typeof cur === "object" && !seen.has(String(cur))) {
    seen.add(String(cur));
    const e = cur as { shortMessage?: string; message?: string; reason?: string; info?: { error?: { message?: string } } };
    const msg = e.shortMessage || e.message || e.reason || e.info?.error?.message;
    if (msg) parts.push(msg);
    cur = (cur as { cause?: unknown }).cause;
  }
  const uniq = [...new Set(parts)];
  return uniq.length ? uniq[uniq.length - 1] : "Unknown error";
}

/** 사용자가 취소한 건 실패가 아니라 선택이므로 구분해 message를 남기지 않는다. */
function isUserRejection(msg: string): boolean {
  return /user_rejected|rejected|denied|cancell?ed|declined/i.test(msg);
}

/**
 * World Chain 으로 컨트랙트 호출을 보낸다.
 *
 * 호출은 순서대로 실행된다. 입금은 approve → deposit 두 건이므로 반드시 이
 * 순서를 지켜야 한다 — 먼저 꺼내낼 승인이 없으면 transferFrom 이 revert 된다.
 */
export async function sendWorldChainTx(calls: ContractCall[]): Promise<TxResult> {
  if (!calls.length) return { ok: false, error: "Nothing to send", userFacing: true };
  try {
    const { MiniKit } = await loadMiniKitModule();
    const transactions = calls.map((c) => ({
      to: c.address,
      data: new ethers.Interface(c.abi).encodeFunctionData(
        c.functionName,
        (c.args ?? []) as never[],
      ),
      value: "0x0",
    }));

    const result = await MiniKit.sendTransaction({
      chainId: CHAIN_ID,
      transactions,
    });

    // 2.x 는 { executedWith, data } 를 돌려준다.
    if (result.executedWith === "fallback") {
      return { ok: false, error: "This browser cannot send transactions", userFacing: true };
    }
    const data = result.data as { userOpHash?: string; status?: string; transaction_hash?: string } | undefined;
    if (!data || data.status !== "success") {
      return { ok: false, error: "The transaction did not go through", userFacing: true };
    }
    return { ok: true, tx: { hash: data.userOpHash ?? data.transaction_hash, executedWith: result.executedWith } };
  } catch (e) {
    const msg = unwrap(e);
    if (isUserRejection(msg)) {
      return { ok: false, error: "You cancelled the transaction", userFacing: false };
    }
    return { ok: false, error: msg, userFacing: true };
  }
}

/**
 * 월드앱에 로그인을 요청하고, 서버가 발급한 nonce 로 서명받는다.
 *
 * nonce 는 서버에서 받아야 한다. 클라이언트가 직접 만들면 재사용 공격이 가능하고,
 * 심사 규칙도 서버 발급을 요구한다.
 */
export async function walletAuth(nonce: string): Promise<
  { ok: true; address: string; message: string; signature: string } | TxFailure
> {
  try {
    const { MiniKit } = await loadMiniKitModule();
    const result = await MiniKit.walletAuth({ nonce, statement: "Sign in to Inheritance" });
    if (result.executedWith === "fallback") {
      return { ok: false, error: "Please sign in from World App", userFacing: true };
    }
    const d = result.data as { address?: string; message?: string; signature?: string };
    if (!d?.address || !d.message || !d.signature) {
      return { ok: false, error: "The sign-in response was incomplete", userFacing: true };
    }
    return { ok: true, address: d.address, message: d.message, signature: d.signature };
  } catch (e) {
    const msg = unwrap(e);
    if (isUserRejection(msg)) {
      return { ok: false, error: "You cancelled sign-in", userFacing: false };
    }
    return { ok: false, error: msg, userFacing: true };
  }
}

/** 알림 권한 조회/요청. 실패해도 앱 전체를 막지 않으므로 오류를 던지지 않는다. */
export async function getNotifyPermission(): Promise<unknown> {
  try {
    const { MiniKit } = await loadMiniKitModule();
    return await MiniKit.getPermissions();
  } catch {
    return null;
  }
}

export async function requestNotifyPermission(): Promise<unknown> {
  try {
    const { Permission } = await import("@worldcoin/minikit-js/commands");
    const { MiniKit } = await loadMiniKitModule();
    return await MiniKit.requestPermission({ permission: Permission.Notifications });
  } catch {
    return null;
  }
}

/** MiniKit 모듈 자체를 동적으로 불러온다. install / 유저네임 조회처럼
 *  명령이 아닌 API 를 쓸 때 쓴다. */
export const loadMiniKit = () => import("@worldcoin/minikit-js");

/** MiniKit 2.x 의 타입/열거형은 루트가 아니라 `./commands` 에서 나온다. */
export const loadMiniKitCommands = () => import("@worldcoin/minikit-js/commands");
