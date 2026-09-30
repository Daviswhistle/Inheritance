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
/** 참/거짓 단언용. 이 파일의 `check` 는 문자열을 정확히 비교하는 헬퍼라서
 *  불리언에 쓰면 통과/실패가 뒤집혀 보인다. */
const ok = (name, cond, detail) => {
  if (cond) {
    pass++;
    return;
  }
  fails.push({ name, got: detail ?? "거짓", want: "참" });
};

const { errorText, humanizeRevertText, __testing } = await vite.ssrLoadModule("/src/errors.ts");
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

// --- 6b) 실제로 관측된 MiniKit 문자열 — 서명된 페이로드까지 포함 -------------
/* 서브에이전트가 브라우저에서 그대로 캡처한 문자열이다. MiniKit 2.x 는
   `sendTransaction` 결과를 문자열로 돌려주는데, 그 문자열 안에 ethers 원본이
   그대로 들어 있고 `payload={ … "params": ["0x02f8…"] }` 로 **서명된 트랜잭션
   페이로드**까지 따라온다. 이게 토스트로 가면 390px 화면을 넘어 앱 전체가 옆으로
   밀렸다(실측 scrollWidth 594 / clientWidth 390). */
{
  const observed =
    'execution reverted (unknown custom error) (action="estimateGas", data="0x203d82d8", reason=null, ' +
    'transaction={ "data": "0x06c8435200" + "278d00", "from": "0x7099", "to": "0x9A67" }, ' +
    'invocation=null, revert=null, code=CALL_EXCEPTION, version=6.15.0)';
  const got = humanizeRevertText(observed);
  check("관측된 MiniKit 문자열 → 문장", got, sentences.Expired);
}

/* 더 나쁜 형태: 이중 탭으로 펜_payload 가 실려 들어온 경우. 서명된 트랜잭션이
   사용자에게 그대로 노출된다. */
{
  const observed =
    'execution reverted (unknown custom error) (action="sendTransaction", data="0x203d82d8", ' +
    'payload={ "id": 10, "jsonrpc": "2.0", "method": "eth_sendRawTransaction", ' +
    '"params": [ "0x02f890827a69f0c9d0d8a0b4b0b0e4a3d9c8e2f1a0b7c6d5e4f3a2b1c0d9e8f7" ] }, ' +
    'revert=null, code=CALL_EXCEPTION, version=6.15.0)';
  const got = humanizeRevertText(observed);
  check("페이로드 포함 문자열 → 문장", got, sentences.Expired);
  ok("서명된 트랜잭션이 노출되지 않는다", !/0x02f890|eth_sendRawTransaction|payload=/.test(got), got);
}

/* --- 6c) 배선 검사 — 단위가 아니라 배선을 검증한다 ---------------------------
   이 테스트가 46/46 으로 초록이면서도 사용자에게 원본 메시지가 나갔던 이유가 이것이다.
   `errorText()` 를 직접 부르면 통과하는데, 실제로는 `sendWorldChainTx` 가 throw 하지
   않아서 그 함수가 revert 실패에서 한 번도 실행되지 않았다. 배선 자체를 단언한다. */
{
  const { readFileSync } = await import("node:fs");
  const mk = readFileSync(REPO + "/app/src/minikit.ts", "utf8");
  // (a) MiniKit 래퍼는 사람이 읽을 문장으로 바꾸는 함수를 불러야 한다.
  ok("minikit.ts 가 문장화를 불러온다", /import\s*\{[^}]*humanizeRevertText/.test(mk), "import 없음");
  // (b) MiniKit 이 돌려주는 값에서 파생된 오류는 반드시 그 함수를 거쳐야 한다.
  //     `{ ok: false, error: <변수> }` 형태가 남아 있으면 그건 원본 통과로, 버그다.
  const rawPass = [...mk.matchAll(/\{\s*ok:\s*false,\s*error:\s*([A-Za-z_$][\w$]*)\s*[,}]/g)].filter(
    (m) => m[1] !== "humanizeRevertText",
  );
  ok("원본 문자열을 그대로 넘기는 분기가 없다", rawPass.length === 0,
    rawPass.length ? rawPass.map((m) => m[0]).join(" | ") : "없음");
  /* (c) 문장화는 **래퍼 안에서** 일어난다 — 한 곳이어야 한다. 11개 호출부에 각각
     붙이면 하나씩 빠진다(그리고 그렇게 빠졌었다). 그래서 호출부는 이미 정리된
     `sent.error` 를 그대로 쓰는 것이 맞고, 여기선 그 설계가 유지되는지 본다. */
  const used = (mk.match(/humanizeRevertText\(/g) || []).length; // import 는 괄호가 없어 세어지지 않는다
  ok("문장화 지점이 셋(결과 / 트랜잭션 catch / 로그인 catch) 모두에 있다", used >= 3, `${used}곳`);
  // 한 곳이라도 새 실패 분기가 생기면 사람 문장을 우회할 수 있으니, 오류 반환부에
  // 문자열 리터럴이 아닌 변수가 그대로 들어가는 형태가 남아 있는지도 본다.
  const app = readFileSync(REPO + "/app/src/App.tsx", "utf8");
  ok("App.tsx 가 MiniKit 결과를 raw 로 다시 꺼내지 않는다", !/result\.data\?\.error|result\.data\.error/.test(app),
    "raw 접근 발견");
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
