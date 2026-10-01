import { ethers } from "ethers";
import type { InterfaceAbi } from "ethers";
import { CHAIN_ID } from "@/config";
import { humanizeRevertText } from "./errors";

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
  /**
   * ABI 는 문자열 조각만으로 안 된다. revert 를 이름으로 해독하려면 **커스텀 에러
   * 항목**이 ABI 에 들어 있어야 하는데(ethers 의 Interface 가 그래야 decodeError 를
   * 한다), 그건 객체 형태다. 예전 타입은 `string[]` 라서 커스텀 에러를 넣을 수 없고,
   * 그래서 이 앱은 revert 를 4바이트 셀렉터로만 보여주고 있었다.
   */
  abi: InterfaceAbi;
  functionName: string;
  args?: unknown[];
};

export type TxSubmission = {
  /** World App 은 user operation hash, 웹 폴백은 트랜잭션 해시. */
  hash?: string;
  hashType: "transaction" | "user-operation";
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
      // MiniKit 2.x 는 실패를 throw 하지 않고 status 로 알린다. 그리고 revert 사유를
      // data.error / data.reason 에 담아 준다.
      //
      // 예전 코드는 그것을 버리고 "The transaction did not go through" 라는 고정 문구만
      // 냈다. 그래서 "개인은 기한 중이라 더 이상 갱신할 수 없습니다" 와 "잘못된 주소입니다"
      // 가 화면에서 똑같이 보였다. 사용자는 gas 를 쓰고 아무 변화도 없는 이유를 알 수
      // 없었다.
      const data = result.data as {
        userOpHash?: string;
        status?: string;
        transaction_hash?: string;
        error?: string;
        reason?: string;
      } | undefined;
      if (!data || data.status !== "success") {
        /* 여기서 사람이 읽을 문장으로 바꾼다 — MiniKit 이 돌려준 문자열은 ethers 의
           원본 메시지라 셀렉터·트랜잭션 덤프·서명된 페이로드를 전부 포함한다.
           호출부는 `catch` 를 통해 `errorText` 를 부르지만 이 함수는 throw 하지 않으므로
           그 방어 코드가 revert 실패에서 실행되지 않는다. 배선 지점은 여기 하나뿐이어야
           한다 — 11개 호출부에 각각 붙이면 하나씩 빠진다(그리고 그렇게 빠졌었다). */
        const reason = (data?.error || data?.reason || "").toString().trim();
        return {
          ok: false,
          error: reason ? humanizeRevertText(reason) : "The transaction did not go through",
          userFacing: true,
        };
      }
    return { ok: true, tx: { hash: data.transaction_hash ?? data.userOpHash, hashType: data.transaction_hash ? "transaction" : "user-operation", executedWith: result.executedWith } };
  } catch (e) {
    const msg = unwrap(e);
    if (isUserRejection(msg)) {
      return { ok: false, error: "You cancelled the transaction", userFacing: false };
    }
    return { ok: false, error: humanizeRevertText(msg), userFacing: true };
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
    return { ok: false, error: humanizeRevertText(msg), userFacing: true };
  }
}

/** 알림 권한 조회/요청. 실패해도 앱 전체를 막지 않으므로 오류를 던지지 않는다. */
/**
 * 알림 권한을 **안정된 형태**로 돌려준다.
 *
 * MiniKit 2.x 는 결과를 감싼다:
 *
 *   { executedWith: "minikit", data: { permissions: { notifications: boolean }, timestamp } }
 *
 * 예전 코드는 `getPermissions()` 의 반환값에서 곧바로 `.permissions` 를 읽었다. 그런데
 * 2.x 의 최상위에는 `executedWith` 와 `data` 만 있고 `permissions` 는 `data` 안에
 * 있다. 그래서 그 값은 항상 `undefined` 였고, 앱은 **영영 "알림이 꺼져 있다"** 고
 * 알려렸다 — 켜도 마찬가지였다. 권한을 켜도 화면이 안 바뀌는 이유.
 *
 * 감싸인 형태와 벗겨진 형태를 모두 받아 정규화한다. 브리지 버전이 payload 를 직접
 * 주는 경우에도 동작해야 하기 때문이다.
 */
export async function getNotifyPermission(): Promise<{ notifications: boolean } | null> {
  try {
    const { MiniKit } = await loadMiniKitModule();
    const res = (await MiniKit.getPermissions()) as
      | { data?: { permissions?: { notifications?: unknown } }; permissions?: { notifications?: unknown } }
      | null
      | undefined;
    const perms = res?.data?.permissions ?? res?.permissions;
    if (!perms || typeof perms.notifications !== "boolean") return null;
    return { notifications: perms.notifications };
  } catch {
    return null;
  }
}

/**
 * 알림 권한을 요청한다.
 *
 * **throw 를 삼키지 않는다.** 예전에는 `catch { return null }` 였는데, 그러면
 * 호출부의 `catch` 가 죽어서 **브리지 자체가 실패했을 때** 사용자에게
 * "World App 이 알림을 허용하지 않습니다" 라고 했다 — 앱 안에서 난 오류를 World App
 * 탓으로 진단한 것이다. 옛 World App 에서 실제로 그렇다(브리지 명령이 없거나 형태가
 * 다름). 원인을 지우면 "앱이 권한 상태를 읽지 못했습니다" 라고 말할 수 없다.
 */
export async function requestNotifyPermission(): Promise<unknown> {
  const { Permission } = await import("@worldcoin/minikit-js/commands");
  const { MiniKit } = await loadMiniKitModule();
  return await MiniKit.requestPermission({ permission: Permission.Notifications });
}

/* ===== 상속인에게 알리기 =====
 *
 * 월드앱 알림(send-notification) 은 월드앱을 쓴 지갑에만 닿는다. 실제로 이
 * 앱의 수신 테스트는 "User not found" 로 끝났다 — 그 지갑은 월드앱을 한 번도
 * 열지 않았기 때문이다. 상속인이 이 앱을 깔았다는 전제 없이 전달하려면
 * 월드앱 안에 이미 있는 경로를 써야 한다.
 *
 * World Chat 은 월드앱 유저네임을 받는 쪽에 닿는다. 이 미니앱을 깔지 않았어도
 * 월드챗에서 메시지를 받고, 누르면 미니앱이 열린다.
 */

export type ShareTarget = { delivered: boolean; reason?: string };

/**
 * 월드챗으로 알린다.
 *
 * 월드앱 유저는 받을 수 있고, 이 미니앱을 깔지 않았어도 받는다 — 대상은 지갑이
 * 아니라 월드챗 대화이기 때문이다. `to` 에 유저네임을 주면 상속인이 직접 고르지
 * 않아도 되고, 비워두면 월드앱이 선택 화면을 띄운다.
 */
export async function sendWorldChat(message: string, to: string[] = []): Promise<ShareTarget> {
  try {
    const { MiniKit } = await loadMiniKitModule();
    const res = (await MiniKit.chat({ message, to })) as {
      executedWith?: string;
      data?: { status?: string; count?: number };
    };
    if (res?.executedWith === "fallback") {
      return { delivered: false, reason: "not in World App" };
    }
    if (res?.data?.status === "fail") {
      return { delivered: false, reason: "send_failed" };
    }
    return { delivered: true };
  } catch (e) {
    // 2.x 는 실패를 status 로 알리고 throw 하지 않지만, 월드앱 바깥에서는
    // 명령 자체가 없는 예외로 나올 수 있다. 사용자에게는 복사 안내로 이어진다.
    return { delivered: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 월드앱 연락처 선택기를 연다.
 *
 * 연락처를 고르면 지갑 주소가 함께 온다. 즉 이건 "알리기"뿐 아니라
 * 상속인 지갑 주소를 틀리지 않게 고르는 통로이기도 하다 — 사람이 주소
 * 12자리를 옮겨 적는 것보다 훨씬 안전하다.
 */
export async function pickWorldContacts(
  inviteMessage: string,
): Promise<Array<{ username: string; walletAddress: string }>> {
  try {
    const { MiniKit } = await loadMiniKitModule();
    const res = (await MiniKit.shareContacts({
      isMultiSelectEnabled: false,
      inviteMessage,
    })) as {
      executedWith?: string;
      data?: { contacts?: Array<{ username: string; walletAddress: string }> };
    };
    if (res?.executedWith === "fallback") return [];
    return res?.data?.contacts ?? [];
  } catch {
    return [];
  }
}

/** MiniKit 모듈 자체를 동적으로 불러온다. install / 유저네임 조회처럼
 *  명령이 아닌 API 를 쓸 때 쓴다. */
export const loadMiniKit = () => import("@worldcoin/minikit-js");

/** MiniKit 2.x 의 타입/열거형은 루트가 아니라 `./commands` 에서 나온다. */
export const loadMiniKitCommands = () => import("@worldcoin/minikit-js/commands");
