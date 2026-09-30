import { ethers } from "ethers";
import { FACTORY_ABI, VAULT_ABI } from "./abis";

/*
 * revert 를 사람이 읽을 문장으로 바꾸는 로직.
 *
 * 왜 이 파일이 분리돼 있나: 이건 **테스트되어야 하는** 로직이다. 예전에 App.tsx 안에
 * 인라인돼 있었고, 그러니까 (1) 그대로 둔 채 eslint/타입체크를 통과했고 (2) 실제 revert
 * 메시지를 이 함수에 넣어 무엇이 나오는지 확인한 적이 없었다. 확인하니 사용자에게
 * `execution reverted (unknown custom error) (action="estimateGas", data="0x203d82d8",
 * transaction={…}, version=6.15.0)` 이 그대로 나가고 있었다 — 390px 화면을 넘겨 앱
 * 전체를 옆으로 밀기도 했다.
 *
 * 원인이 두 겹이었다:
 *   1. FACTORY_ABI / VAULT_ABI 에 **커스텀 에러 항목이 없어서** ethers 가 revert 를
 *      이름으로 디코딩하지 못했다. (`abi-errors.ts` 가 이걸 채운다.)
 *   2. 그래도 실패하는 경우를 위해 revert `data` 를 직접 Interface 로 해독한다.
 *
 * 테스트: node scripts/test-error-text.mjs
 */

const readErrorValue = (error: unknown, key: "reason" | "shortMessage" | "message"): string | undefined => {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : undefined;
};

/**
 * 커스텀 에러 이름 → 사용자에게 보여줄 문장.
 *
 * **이름**으로 매핑한다, 셀렉터가 아니라. 예전에 셀렉터(`0x203d82d8`)를 하드코딩했는데
 * 계약이 바뀌면 조용히 틀어지고, ethers 도 이름 대신 셀렉터를 던지면 아무것도 못 찾는다.
 * 이제 ABI 에 에러 항목을 넣었으므로(`abi-errors.ts`) ethers 가 이름을 되살려 준다.
 *
 * 문장의 기준은 "무엇을 하면 되는가" 다. 사용자는 `Expired` 라는 이름을 이해하지
 * 못하지만 "카운트다운이 이미 끝나서 지금은 바꿀 수 없다" 는 이해한다.
 */
const REVERT_HINTS: Record<string, string> = {
  Expired: "The countdown has already ended, so this cannot be changed now.",
  NotExpiredYet: "The countdown is still running, so there is nothing to claim yet.",
  HeartbeatOutOfRange: "The renewal period must be between 1 and 365 days.",
  InvalidAddress: "That address is not valid.",
  NotOwner: "Only the vault owner can do this.",
  NotHeir: "Only the named heir can do this.",
  AlreadyHasVault: "This wallet already has a vault. Release the slot first to make a new one.",
  NoVault: "This wallet has no vault yet.",
  NotAContract: "That address is not a vault contract.",
  VaultNotEmpty: "The vault still holds WLD. Withdraw or sweep it before releasing the slot.",
  NotSettled: "The inheritance has not finished yet.",
  AlreadyFiled: "A claim is already in the review window.",
  AlreadyClaimed: "The balance has already been withdrawn.",
  ChallengeStillRunning: "The review window is still running.",
  NothingToTransfer: "There is nothing to transfer.",
  WldOnly: "This vault only accepts WLD.",
  Reentrancy: "Another action is still in progress. Wait a moment and try again.",
  TokenTransferFailed: "The WLD transfer failed.",
  TokenCallFailed: "The WLD contract call failed.",
  EthNotAccepted: "This vault does not accept ETH.",
  EthTransferFailed: "The ETH transfer failed.",
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
 * 덩어리를 잘라내고, 에러 이름이 있으면 문장으로 바꾼다.
 */
const humanizeRevert = (raw: string): string => {
  /* 셀렉터와 에러 이름을 **먼저** 잡아 둔다.
     순서가 반대였고 그게 버그였다: 아래의 정리 정규식이
     `(action="estimateGas", data="0x203d82d8", …)` 를 끝까지 지우면서 `data=` 안의
     셀렉터까지 함께 없앴다. 그러면 "unknown custom error" 인데 식별할 단서가 사라져
     모든 revert 가 같은 문장("The contract rejected this.")으로 떨어졌다. revert 의
     원인을 구분할 수 없으므로 사용자는 무엇이 잘못됐는지 알 수 없다.
     (scripts/test-error-text.mjs 가 이 순서 때문에 처음 실패했다.) */
  const named = raw.match(/(?:custom error|reverted:)\s*([A-Z][A-Za-z0-9_]*)/)?.[1];
  if (named) {
    if (REVERT_HINTS[named]) return REVERT_HINTS[named];
    return `The contract rejected this (${named}). Nothing was changed.`;
  }
  // revert 데이터에서 직접 이름을 되살릴 수 있으면 그게 가장 정확하다.
  const selData = raw.match(/data="(0x[0-9a-fA-F]+)"/)?.[1] ?? raw.match(/\b(0x[0-9a-fA-F]{8})\b/)?.[1];
  if (selData) {
    try {
      const name = REVERT_IFACE.parseError(selData)?.name;
      if (name) return REVERT_HINTS[name] ?? `The contract rejected this (${name}). Nothing was changed.`;
    } catch {
      // 알 수 없는 셀렉터 — 아래에서 문장으로 처리한다.
    }
  }

  // 이제 노이즈를 걷어낸다. `transaction={ … }` 같은 객체 덩어리, 그리고 후행 괄호 목록.
  let s = raw
    .replace(/\b\w+=\{\s*"[\s\S]*?\}\s*,?/g, "")
    .replace(/\s*,\s*/g, ", ")
    .trim();
  s = s.replace(/\s*\(?(?:action|reason|invocation|revert|code|version|transaction|data)=[\s\S]*$/i, "").trim();
  s = s.replace(/,?\s*\)*$/, "").trim();
  s = s.replace(/^execution reverted\s*\(?\s*unknown custom error\s*\)?:?\s*$/i, "").trim();
  if (!s || /unknown custom error/i.test(s)) {
    if (selData) return `The contract rejected this (${selData.slice(0, 10)}). Nothing was changed.`;
    return "The contract rejected this. Nothing was changed.";
  }
  return s;
};

/**
 * revert 데이터에서 커스텀 에러 이름을 직접 해독한다.
 *
 * ethers 가 디코딩에 실패한 경우(노드가 revert 를 `data` 로만 돌려주는 경우 등)가
 * 있다. 그러면 메시지에 셀렉터만 남는다. 두 ABI 로 만든 Interface 로 한 번 더 시도해
 * 이름을 되살린다 — 그래야 `REVERT_HINTS` 를 거칠 수 있다.
 *
 * 팩토리 ABI 와 금고 ABI 를 합쳐 쓴다. World App 은 허용된 주소만 부를 수 있어서 모든
 * 조작이 팩토리를 거치지만, revert 는 실제로 실패한 컨트랙트(금고)에서 올라온다.
 */
const REVERT_IFACE = new ethers.Interface([...FACTORY_ABI, ...VAULT_ABI]);

const decodeRevertName = (error: unknown): string | undefined => {
  let node: Record<string, unknown> | null = null;
  for (let e: unknown = error; e && typeof e === "object" && node === null; ) {
    const rec = e as Record<string, unknown>;
    const data = [rec.data, (rec.info as Record<string, unknown> | undefined)?.data].find(
      (v) => typeof v === "string" && v.length >= 10,
    );
    if (data) node = rec;
    e = rec.cause ?? rec.error;
  }
  if (!node) return undefined;
  const data = String(node.data ?? (node.info as Record<string, unknown>)?.data ?? "");
  try {
    return REVERT_IFACE.parseError(data)?.name;
  } catch {
    return undefined;
  }
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
export const errorText = (error: unknown, depth = 0): string => {
  // 1순위: 직접 해독한 커스텀 에러 이름. 문장으로 바로 바꾼다.
  const name = decodeRevertName(error);
  if (name) return REVERT_HINTS[name] ?? `The contract rejected this (${name}). Nothing was changed.`;

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

/** 이 함수 자체를 테스트에서 검증한다. */
export const __testing = { REVERT_HINTS, humanizeRevert, decodeRevertName, REVERT_IFACE };
