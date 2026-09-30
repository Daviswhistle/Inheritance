// revert 문장화 검증.
//
// 왜 이게 있나
// ------------
// 이 앱은 revert 를 사용자에게 **문장으로** 보여줘야 한다. 셀렉터(0x203d82d8)만
// 보여주면 아무것도 할 수 없고, ethers 의 원본 메시지를 그대로 흘리면 390px 화면을
// 넘겨 앱 전체가 옆으로 밀린다.
//
// 실제로 그랬다. FACTORY_ABI / VAULT_ABI 에 커스텀 에러 항목이 없어서 ethers 가
// 디코딩하지 못했고, 화면에 아래가 그대로 나갔다:
//
//   execution reverted (unknown custom error) (action="estimateGas",
//   data="0x203d82d8", reason=null, transaction={ "data": "0x06c84352…" },
//   invocation=null, revert=null, code=CALL_EXCEPTION, version=6.15.0)
//
// 그 상태에서 `tsc` 와 `vite build` 는 초록이었다. 이 테스트는 **실제 인코딩된 revert
// 데이터**를 이 함수에 넣어 무엇이 나오는지 확인한다. 세 가지를 실제로 확인한다:
//   1. 컨트랙트의 커스텀 에러 이름이 ABI 로 해독되는가
//   2. 그 이름이 사람이 읽을 문장으로 바뀌는가
//   3. ethers 원본 문구에 노이즈가 남지 않는가
//
// 실행: node scripts/test-error-text.mjs
import path from "node:path";
import { createServer } from "../app/node_modules/vite/dist/node/index.js";
import { ethers } from "../app/node_modules/ethers/lib.esm/index.js";

const REPO = new URL("..", import.meta.url).pathname;
// Vite 의 SSR 모듈 로더로 TS 를 그대로 읽는다. 번들러를 새로 깔지 않아도 되고, 앱이
// 실제로 쓰는 해석 규칙(확장자 없는 상대 import 등) 그대로 검증된다.
const vite = await createServer({
  root: path.join(REPO, "app"),
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
});
let pass = 0;
const fails = [];

const check = (name, got, want) => {
  if (got === want) {
    pass++;
    return;
  }
  fails.push({ name, got, want });
};

const { errorText, __testing } = await vite.ssrLoadModule("/src/errors.ts");
const { REVERT_IFACE } = __testing;

// --- 1) 계약의 커스텀 에러가 실제로 해독되는가 -------------------------------
// 이게 실패하면 아래 문장화 검사는 전부 "알 수 없는 셀렉터" 로 끝난다.
const ERRORS = [
  "Expired",
  "NotExpiredYet",
  "NotOwner",
  "NotHeir",
  "HeartbeatOutOfRange",
  "InvalidAddress",
  "AlreadyHasVault",
  "NoVault",
  "NotAContract",
  "VaultNotEmpty",
  "NotSettled",
  "AlreadyFiled",
  "AlreadyClaimed",
  "ChallengeStillRunning",
  "NothingToTransfer",
  "WldOnly",
  "Reentrancy",
  "TokenTransferFailed",
  "TokenCallFailed",
  "EthNotAccepted",
  "EthTransferFailed",
];
// 인자를 받는 에러는 값을 하나 넣어야 인코딩된다.
const ARGS = { TokenCallFailed: ["0xdeadbeef"] };
const encode = (name) => REVERT_IFACE.encodeErrorResult(name, ARGS[name] ?? []);
let abiMissing = 0;
for (const name of ERRORS) {
  let parsed;
  try {
    parsed = REVERT_IFACE.parseError(encode(name));
  } catch {
    // 가장 흔한 원인은 ABI 에 커스텀 에러 항목이 없는 것이다(원래 버그). 크래시 대신
    // 무엇이 없는지 그대로 보고한다.
    abiMissing++;
    fails.push({ name: `ABI 에 ${name} 없음`, got: "encodeErrorResult 실패", want: name });
    continue;
  }
  check(`ABI 에 ${name} 있음`, parsed?.name, name);
}
if (abiMissing) {
  // 여기서 끝낸다. 아래 절은 전부 encode() 에 의존하므로 계속 돌리면 같은 원인으로
  // 다시 예외가 나고 진짜 원인이 가려진다.
  console.log(
    `\n  abis.ts 에 커스텀 에러 ${abiMissing}종이 없습니다.\n` +
      "  scripts/gen-abi-errors.mjs 의 생성물을 ...VAULT_ERROR_ABI / ...FACTORY_ERROR_ABI 로\n" +
      "  넣어야 revert 를 이름으로 해독할 수 있습니다.\n",
  );
  process.exit(1);
}

// --- 2) 인자까지 인코딩된 revert 도 해독되는가 ---------------------------------
{
  const data = encode("TokenCallFailed");
  const parsed = REVERT_IFACE.parseError(data);
  check("인자가 있는 에러 해독", parsed?.name, "TokenCallFailed");
  check("인자 값 보존", parsed?.args[0], "0xdeadbeef");
}

// --- 3) ethers 가 만드는 실제 오류 형태에서 문장이 나온다 ----------------------
// ethers v6 는 revert 를 estimateGas 단계에서 던질 때 아래 모양의 객체를 만든다.
const ethersShaped = (data) => ({
  code: "CALL_EXCEPTION",
  shortMessage: `execution reverted (unknown custom error) (action="estimateGas", data="${data}", reason=null, transaction={ "data": "0x06c84352000000000000000000000000", "from": "0x70997070C51812dc3A010C7d01b50e0d17dc79C8", "to": "0x9A676e0BB1f1B0DE9e4a0dEb6A0e4bD8b1Cf8C21" }, invocation=null, revert=null, version=6.15.0)`,
  message: `execution reverted (unknown custom error) (action="estimateGas", data="${data}", reason=null, transaction={ "data": "0x06c84352000000000000000000000000" }, invocation=null, revert=null, code=CALL_EXCEPTION, version=6.15.0)`,
});

const sentences = {
  Expired: "The countdown has already ended, so this cannot be changed now.",
  NotOwner: "Only the vault owner can do this.",
  NotHeir: "Only the named heir can do this.",
  HeartbeatOutOfRange: "The renewal period must be between 1 and 365 days.",
  InvalidAddress: "That address is not valid.",
  AlreadyHasVault: "This wallet already has a vault. Release the slot first to make a new one.",
  VaultNotEmpty: "The vault still holds WLD. Withdraw or sweep it before releasing the slot.",
  NotExpiredYet: "The countdown is still running, so there is nothing to claim yet.",
};
for (const [name, sentence] of Object.entries(sentences)) {
  const got = errorText(ethersShaped(encode(name)));
  check(`${name} → 문장`, got, sentence);
  if (/action=|transaction=|version=|0x[0-9a-fA-F]{8}/.test(got)) {
    fails.push({ name: `${name} → 노이즈 제거`, got, want: "노이즈 없는 문장" });
  } else {
    pass++;
  }
}

// --- 3b) ethers 가 message 에는 selector, info.data 에는 전체 데이터를 주는 형태 ---
// estimateGas 단계에서 던져질 때 실제 이 모양이다. 메시지만 보고 셀렉터를 찾지 못하는
// 경우에도 info.data 로 이름을 되살릴 수 있어야 한다.
{
  const data = encode("Expired");
  const got = errorText({
    code: "CALL_EXCEPTION",
    shortMessage: `execution reverted (unknown custom error) (action="estimateGas", data="0x203d82d8", version=6.15.0)`,
    info: { data, error: { code: -32000, message: "execution reverted" } },
  });
  check("message+info 혼합 형태", got, sentences.Expired);
}

// --- 4) 정보가 error.info.data 에만 들어 있어도 해독된다 ----------------------
// estimateGas 가 아니라 send 단계에서 실패하면 `data` 가 info 아래로 내려가 있다.
{
  const data = encode("VaultNotEmpty");
  const got = errorText({
    code: "CALL_EXCEPTION",
    reason: "missing revert data in call exception",
    info: { data, error: { code: -32000, message: "execution reverted" }, transaction: {} },
  });
  check("info.data 로도 해독", got, sentences.VaultNotEmpty);
}

// --- 5) 결과 문자열이 화면을 넘지 않는다 --------------------------------------
// .toast 는 390px 뷰포트에서 넘침 차단을 min(420px, 100vw-24px) 로 걸어 놓았다.
// 그래도 문장이 지나치게 길면 줄바꿈만 많아지고 읽기 어렵다. 상한을 둔다.
{
  const data = REVERT_IFACE.encodeErrorResult("TokenCallFailed", ["0x" + "ab".repeat(2000)]);
  const got = errorText(ethersShaped(data));
  check("긴 데이터도 문장만", got.startsWith("The WLD contract call failed."), true);
  check("문장 길이 160 이하", got.length <= 160, true);
}

// --- 6) 디코딩 불가능한 revert 도 사람이 읽을 수 있는 문장 --------------------
{
  const got = errorText(ethersShaped("0xdeadbeef"));
  check("알 수 없는 셀렉터도 문장", /^The contract rejected this/.test(got), true);
}
{
  // 노드가 revert 없이 그냥 실패
  const got = errorText(new Error("could not coalesce error"));
  check("coalesce 오류", /developer console/.test(got), true);
}

// --- 7) 제네릭 문자열(재vert 아님)은 그대로 통과 ------------------------------
{
  const got = errorText(new Error("insufficient funds for gas * price + value"));
  check("문자열 오류는 그대로", got, "insufficient funds for gas * price + value");
}

await vite.close();

if (fails.length) {
  console.log(`\n  실패 ${fails.length}건 / 통과 ${pass}\n`);
  for (const f of fails) {
    console.log(`  ✗ ${f.name}`);
    console.log(`      기대: ${String(f.want).slice(0, 110)}`);
    console.log(`      실제: ${String(f.got).slice(0, 110)}\n`);
  }
  process.exit(1);
}
console.log(`  통과 ${pass} / 실패 0  (revert 문장화)`);
