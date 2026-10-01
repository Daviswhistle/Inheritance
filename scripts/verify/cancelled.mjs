// 취소(cancel)된 금고 — 앱이 잘못 말하기 쉬운 상태.
//
// 왜 이 시나리오가 있나
// -------------------
// 상속 취소는 **갱신 기한 전**에 하는 행동이라서, 취소한 뒤에도 카운트다운이 계속
// 돈다. 그 상태를 앱이 어떻게 다루느냐가 전부 문제였다:
//
//   * `vaultPhase` 가 만료와 무관하게 취소 여부를 먼저 보고 `"cancelled"` 였다. 그래서
//     카운트다운이 **도는 중**인 취소 금고가 만료된 것처럼 취급됐다 → 입금이 막히고,
//     기간변경·상속인변경이 비활성화됐고, 잔액 0 이면 슬롯 해제 버튼까지 떴다.
//     계약은 셋 다 허용하거나 거절하거나인데 UI 가 셋 다 잘못된 방향이었다.
//   * 카운트다운 카드가 "Time left to renew / 0d 0h 0m 0s / 어제 날짜" 로 떨어졌다.
//     "갱신하라" 고 말하면서 갱신 버튼은 없고, 실제로 갱신하면 슬롯 해제만 한 주기 막힌다.
//   * 5단계 상속 파이프라인이 그대로 보였다. 취소된 금고에서 "상속인이 신청한다" 는
//     일어나지 않는다.
//   * "At stake … your heir receives" — 상속인이 없다(heir == owner).
//   * 슬롯을 해제하면 `vaultOwner` 가 남아 `isMyVault` 이 계속 true 였다 → 성공 안내
//     아래에 생성 폼이 아예 없었다(새로고침해야 고쳐짐).
//   * 취소+만료에 돈이 남으면 "withdraw it" 라고 말하면서 출금 버튼은 비활성이었고
//     sweep 도 없었다. 그 상태에서 자금을 꺼낼 수 있는 앱 안 길이 없었다.
//
// 계약 쪽 동작은 forge 테스트가 고정한다(126개). 여기서는 **화면이 그 계약과
// 일치하는지** 본다.
//
// 이 시나리오는 **자기 정리형**이다: 다른 단계가 같은 체인에서 쓰던 계정에 금고가
// 남아 있을 수 있으므로 시작할 때 정리하고, 끝나면 슬롯을 다시 해제한다. 그래야
// run.sh 에서 다른 단계 뒤에 붙여도 서로를 깨우지 않는다.
//
// 실행: FACTORY=0x... node scripts/verify/cancelled.mjs
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { spawnSync, spawn } from "node:child_process";
import { launch, ACCOUNTS } from "./drv.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");

let pass = 0,
  fail = 0;
const check = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const log = (s) => console.log(s);

const F = process.env.FACTORY;
const WLD = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const RPC = "http://127.0.0.1:8546";
const PORT = Number(process.env.PORT || 7713);
const APP = `http://127.0.0.1:${PORT}/`;
// a2's earlier renewal fixture can be expired and still hold WLD. Clean its actual
// phase before reuse; CLI completion alone does not establish transaction success.
const owner = ACCOUNTS.a2;
const heir = ACCOUNTS.a3;

if (!F) {
  console.error("  FACTORY 환경변수가 없습니다. scripts/verify/reset.sh 로 체인을 만드세요.");
  process.exit(1);
}

const cast = (args) => {
  const r = spawnSync("cast", args[0] === "send" ? [...args, "--json"] : args, { encoding: "utf8" });
  const out = (r.stdout || "").trim();
  let ok = r.status === 0;
  if (ok && args[0] === "send") {
    try { ok = BigInt(JSON.parse(out).status) === 1n; } catch { ok = false; }
  }
  return { ok, out, err: (r.stderr || "").trim() || (!ok ? out : "") };
};
/** cast 출력에 붙는 ` [5e18]` 같은 사람용 접미사를 벗겨 BigInt 로 읽는다. */
const castUint = (args) => {
  const { out, ok } = cast(args);
  if (!ok || !out) throw new Error(`cast 실패: ${args.join(" ")}\n${out}`);
  /* cast 는 반환 타입을 모르면 32바이트 원시값을 준다. `vaultOf(address)` 처럼 반환
     타입을 빼면 **주소가 아니라 64자 hex** 가 나오고, 그걸 주소로 쓰면 이후 호출이 전부
     "invalid string length" 로 죽는다 — 조용히 잘못된 상태로 진행하다가 엉뚱한 곳에서
     실패한다. 실제로 이 시나리오가 그렇게 죽었다. */
  const raw = out.split(/\s+/)[0];
  if (raw === "true") return 1n;
  if (raw === "false") return 0n;
  /* cast 는 값이 작으면 십진으로, 크면 0x+64 hex 로 준다(반환 타입을 명시했어도
     그렇다). 관대하게 받아 넘기고, 주소가 필요한 자리에서 형식을 따로 확인한다. */
  if (/^\d+$/.test(raw)) return BigInt(raw);
  if (/^0x[0-9a-fA-F]{40}$/.test(raw)) return BigInt(raw);
  if (/^0x[0-9a-fA-F]{64}$/.test(raw)) return BigInt(raw);
  throw new Error(`cast 출력이 주소/값 형식이 아니다: ${raw}  (${args.join(" ")})`);
};
const vaultOf = (addr) => cast(["call", F, "vaultOf(address)(address)", addr, "--rpc-url", RPC]).out;
const ZERO = "0x" + "0".repeat(40);
const send = (to, sig, args = []) =>
  cast(["send", to, sig, ...args, "--from", owner.a, "--private-key", owner.pk, "--rpc-url", RPC, "--gas-limit", "2000000"]);

/**
 * 슬롯을 비운다 (공통 로직).
 *
 * `rescueFromMyVault` 는 **팩토리** 라우팅 함수다 — 호출 대상은 팩토리이고(월드앱은
 * 허용된 주소만 부를 수 있어서 모든 소유자 조작이 팩토리를 거친다) 금액 회수는
 * `vaultOf[msg.sender]` 를 따라간다. 금고에 직접 부르면 조용히 실패한다. 실제로 이
 * 시나리오가 그래서 두 번 죽었다.
 *
 * Fixture cleanup is mandatory. A failed receipt must not be mistaken for a
 * successful cleanup, creation or cancellation and then tested as another state.
 */
function emptySlot() {
  const v = vaultOf(owner.a);
  // 주소 형식이 아니면(0 주소 등) "금고 없음" 으로 본다.
  if (!/^0x[0-9a-fA-F]{40}$/.test(v) || v === ZERO) return null;
  /* 금고 컨트랙트에 `balanceOf()` 가 없다 — WLD 는 별도 ERC20 이다. 금고가 가진 WLD 는
     토큰 쪽에서 그 주소를 조회해야 한다. (금고 컨트랙트에 직접 부르면 cast 가 실패하고
     이 시나리오는 거기서 죽었다.) */
  const bal = castUint(["call", WLD, "balanceOf(address)(uint256)", v, "--rpc-url", RPC]);
  if (bal > 0n) {
    const claimed = castUint(["call", v, "claimedAt()(uint256)", "--rpc-url", RPC]);
    let r;
    if (claimed > 0n) {
      r = send(F, "sweepSettledVaultFor(address)", [owner.a]);
    } else {
      const active = castUint(["call", v, "ownerStillActive()(bool)", "--rpc-url", RPC]);
      const cancelled = castUint(["call", v, "inheritanceCancelled()(bool)", "--rpc-url", RPC]);
      if (!active && !cancelled) {
        const renewed = send(F, "pingMyVault()");
        if (!renewed.ok) throw new Error("Fixture renewal failed: " + renewed.err.slice(0, 200));
      }
      r = send(F, "withdrawFromMyVault(address,uint256)", [owner.a, bal.toString()]);
    }
    if (!r.ok) throw new Error("Fixture WLD recovery failed: " + r.err.slice(0, 200));
  }
  // 강제 입금된 ETH 도 있을 수 있다 — 이것이 남아 있으면 해제가 막힌다.
  const eth = cast(["balance", v, "--rpc-url", RPC]).out.split(/\s+/)[0];
  if (eth && BigInt(eth) > 0n) {
    const r = send(v, "sweepEth(address)", [owner.a]);
    if (!r.ok) throw new Error("Fixture ETH recovery failed: " + r.err.slice(0, 200));
  }
  if (!castUint(["call", v, "isSettled()(bool)", "--rpc-url", RPC])) {
    const ping = castUint(["call", v, "lastPing()(uint256)", "--rpc-url", RPC]);
    const interval = castUint(["call", v, "heartbeatInterval()(uint256)", "--rpc-url", RPC]);
    if (!cast(["rpc", "evm_setNextBlockTimestamp", (ping + interval + 1n).toString(), "--rpc-url", RPC]).ok ||
        !cast(["rpc", "evm_mine", "--rpc-url", RPC]).ok) throw new Error("Fixture expiry failed");
  }
  const rel = send(F, "releaseMyVault()");
  if (!rel.ok || vaultOf(owner.a) !== ZERO) throw new Error("Fixture release failed: " + rel.err.slice(0, 200));
  return v;
}

/** 다른 단계가 남긴 금고를 정리한다. */
async function cleanSlot() {
  const v = emptySlot();
  if (!v) return;
  log(`  기존 금고 정리: ${v}`);
  await sleep(600);
  log(`  정리 후 vaultOf = ${vaultOf(owner.a)}`);
}

/** 마지막에 슬롯을 다시 비운다 — 다음 실행을 위해. */
function releaseIfPossible() {
  emptySlot();
}

let up = false;
try {
  up = (await fetch(APP)).ok;
} catch {
  up = false;
}
if (!up) {
  spawn("node", ["node_modules/vite/bin/vite.js", "--config", "vite.config.e2e.ts", "--port", String(PORT), "--strictPort"], {
    cwd: REPO + "/app",
    env: { ...process.env, VITE_RPC: RPC, VITE_FACTORY_ADDRESS: F, VITE_WLD_ADDRESS: WLD, VITE_FACTORY_DEPLOY_BLOCK: "1" },
    stdio: "ignore",
    detached: true,
  });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      if ((await fetch(APP)).ok) {
        up = true;
        break;
      }
    } catch {
      /* 아직 안 뜸 */
    }
  }
}
check("dev 서버 기동", up, up ? APP : "기동 실패");
if (!up) process.exit(1);

await cleanSlot();

// ── 1) 취소 + 만료된 금고 (슬롯 해제가 열려야 하는 상태) ───────────────────
const created = send(F, "createVault(address,uint256)", [heir.a, "604800"]);
if (!created.ok) {
  console.error("  금고 생성 실패: " + (created.err || created.out).slice(0, 200));
  process.exit(1);
}
const vCancel = vaultOf(owner.a);
log(`  취소할 금고 ${vCancel}`);

const cancelled = send(vCancel, "cancelInheritance()");
check("상속 취소가 성공한다", cancelled.ok, cancelled.ok ? "성공" : (cancelled.err || "").slice(0, 120));

/* 기한 경과. 절대값이 아니라 **`lastPing + heartbeatInterval`** 로 가야 한다.
   `heartbeatInterval` 만 보고 `setNextBlockTimestamp(주기 + 1000)` 을 하면 1970년
   시각이 되어(anvil 이 거부) 만료가 일어나지 않고, 화면은 당연히 "기한 남음" 을
   표시한다 — 이 시나리오가 처음에 9개 실패한 원인이었다. 앱이 아니라 하네스가 틀렸다. */
const cd = Number(cast(["call", vCancel, "heartbeatInterval()(uint256)", "--rpc-url", RPC]).out.split(/\s+/)[0]);
const lastPing = Number(cast(["call", vCancel, "lastPing()(uint256)", "--rpc-url", RPC]).out.split(/\s+/)[0]);
const target = lastPing + cd + 1000;
log(`  lastPing=${lastPing} + heartbeat=${cd} → 다음 블록 ${target}`);
const adv = cast(["rpc", "evm_setNextBlockTimestamp", String(target), "--rpc-url", RPC]);
if (!adv.ok) log(`  (시간 이동 실패: ${adv.err.slice(0, 120)})`);
cast(["rpc", "evm_mine", "--rpc-url", RPC]);
await sleep(500);
const expiredOnChain = castUint(["call", vCancel, "isExpired()(bool)", "--rpc-url", RPC]);
check("기한이 실제로 경과했다", expiredOnChain === 1n, `isExpired=${expiredOnChain} (목표 ${target})`);
const isSettled = castUint(["call", vCancel, "isSettled()(bool)", "--rpc-url", RPC]);
const isCancelled = castUint(["call", vCancel, "inheritanceCancelled()(bool)", "--rpc-url", RPC]);
check("체인: 취소 + 만료 + settled", isCancelled === 1n && isSettled === 1n, `cancelled=${isCancelled} settled=${isSettled}`);

// ── 2) 화면이 그 상태를 어떻게 말하는가 ─────────────────────────────────────
const b = await launch({ pk: owner.pk, url: APP });
await sleep(3000);
await b.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>/^(Connect|Continue with World App)$/.test(x.innerText.trim()));if(e)e.click();return 1;})()`);
await sleep(6500);
const goto = (tab) =>
  b.ev(
    `return (()=>{const e=[...document.querySelectorAll(".tab-item")].filter(x=>x.offsetParent!==null).find(x=>x.innerText.trim().toLowerCase().includes("${tab}"));if(e)e.click();return 1;})()`,
  );
await goto("vault");
await sleep(1800);
const vaultText = await b.ev("return document.body.innerText;");
/** 파이프라인 단계는 한 줄짜리 항목이라, 문장 속 "your heir files a claim" 과 겹치지
 *  않도록 줄 전체가 그 단계와 같을 때만 센다. */
const hasStep = (t, step) => t.split("\n").some((l) => l.trim() === step);

log("\n[A] 카운트다운 카드");
check("'갱신하라' 고 말하지 않는다", !/time left to renew|renew soon/i.test(vaultText),
  (vaultText.match(/[^\n]*(?:time left to renew|renew soon)[^\n]*/i) || ["—"])[0].slice(0, 100));
check("0d 0h 0m 0s 카운트다운을 보여주지 않는다", !/\b0d 0h 0m 0s\b/.test(vaultText),
  /\b0d 0h 0m 0s\b/.test(vaultText) ? "0 카운트다운이 보인다" : "없음");
check("취소 사실을 머리말로 말한다", /inheritance cancelled/i.test(vaultText),
  (vaultText.match(/[^\n]*inheritance cancelled[^\n]*/i) || ["—"])[0].slice(0, 90));
check("'아무도 상속받지 않는다' 고 말한다", /nobody will inherit/i.test(vaultText),
  (vaultText.match(/[^\n]*nobody will inherit[^\n]*/i) || ["—"])[0].slice(0, 90));
check("Vault 탭에 상속 파이프라인이 없다", !hasStep(vaultText, "Heir files a claim"),
  hasStep(vaultText, "Heir files a claim") ? "상속 절차가 보인다" : "없음");

log("\n[B] 갱신 버튼");
const renewButtons = await b.ev(
  `return [...document.querySelectorAll("button")].filter(x=>/reset timer|renew and withdraw/i.test(x.innerText)).map(x=>({t:x.innerText,disabled:x.disabled}));`,
);
check("취소+만료 후에는 갱신 버튼이 없다", renewButtons.length === 0,
  renewButtons.length ? JSON.stringify(renewButtons) : "없음");

log("\n[C] 소유자 조작 — 계약이 Expired 로 거절하는 것들은 막혀야 한다");
const controls = await b.ev(
  `return [...document.querySelectorAll("button")].map(x=>({t:x.innerText.trim(),disabled:x.disabled}));`,
);
const byLabel = (re) => controls.find((c) => re.test(c.t));
const period = byLabel(/change period/i);
check("Change period 가 비활성이다", period ? period.disabled === true : true,
  period ? `${period.t} disabled=${period.disabled}` : "버튼 없음");
const heirBtn = byLabel(/update heir/i);
check("Update heir 가 비활성이다", heirBtn ? heirBtn.disabled === true : true,
  heirBtn ? `${heirBtn.t} disabled=${heirBtn.disabled}` : "버튼 없음");
const dep = byLabel(/^deposit$/i);
check("Deposit 이 비활성이다 (마감 이후)", dep ? dep.disabled === true : true,
  dep ? `${dep.t} disabled=${dep.disabled}` : "버튼 없음");


log("\n[D] 슬롯 해제 — 취소 금고에서 열려야 한다");
const rel = byLabel(/release slot/i);
check("Release slot 이 보인다", Boolean(rel), rel ? rel.t : "버튼 없음");

log("\n[E] 금액 안내");
check("상속인이 받는다고 말하지 않는다 (상속인이 없다)", !/what your heir receives/i.test(vaultText),
  /what your heir receives/i.test(vaultText) ? "상속인이 있다고 말한다" : "없음");
check("'내 것이며 해제할 수 있다' 고 안내한다", /release your slot|is yours/i.test(vaultText),
  (vaultText.match(/[^\n]*(?:is yours|release your slot)[^\n]*/i) || ["—"])[0].slice(0, 100));
log("\n[F] Send 탭 — 입금 차단 사유와 유일한 출구(긴급 출금)");
/* 입금 폼과 "Emergency withdraw" 는 **Send 탭** 에 있다. Vault 탭에서 검사하면 버튼이
   없는 것이 아니라 다른 탭에 있는 것이므로 실패로 잘못 읽는다(실제로 그랬다). */
await goto("send");
await sleep(1500);
const sendText = await b.ev("return document.body.innerText;");
const sendControls = await b.ev(
  `return [...document.querySelectorAll("button")].map(x=>({t:x.innerText.trim(),disabled:x.disabled}));`,
);
const sendByLabel = (re) => sendControls.find((c) => re.test(c.t));
const depS = sendByLabel(/^deposit$/i);
check("입금 버튼이 비활성이다", depS ? depS.disabled === true : true,
  depS ? `${depS.t} disabled=${depS.disabled}` : "버튼 없음");
check("입금이 왜 꺼졌는지 말해준다", /deposits are turned off/i.test(sendText),
  (sendText.match(/[^\n]*deposits are turned off[^\n]*/i) || ["—"])[0].slice(0, 110));
/* 취소 금고에서 계약은 만료 후에도 출금을 허용한다(`ownerMayWithdraw` 는
   `inheritanceCancelled` 이면 통과시킨다). 그것이 잔액을 꺼내는 **유일한** 길이다 —
   잔액이 남으면 슬롯 해제도 막힌다. 예전에는 출력 버튼이 비활성이었고 sweep 도
   없어서, 앱 안에서 자금을 꺼낼 방법이 없었다. */
const wdS = sendByLabel(/^withdraw/i);
check("출금 버튼이 있고 활성이다 — 취소 금고에서 유일한 출구다", Boolean(wdS) && wdS.disabled === false,
  wdS ? `${wdS.t} disabled=${wdS.disabled}` : "버튼 없음");
check("출금 설명이 취소 금고에 맞게 바뀐다", /inheritance was cancelled/i.test(sendText),
  (sendText.match(/[^\n]*withdraw[^\n]*/i) || ["—"])[0].slice(0, 110));
await b.shot("cancelled-send");

log("\n[G] Inherit 탭 — 파이프라인과 되돌리기 안내");
await goto("inherit");
await sleep(1500);
const inheritText = await b.ev("return document.body.innerText;");
check("상속 파이프라인 5단계를 보여주지 않는다", !hasStep(inheritText, "Heir files a claim"),
  hasStep(inheritText, "Heir files a claim") ? "상속 절차가 보인다" : "없음");
check("취소 상태에 맞는 짧은 목록을 보여준다", /no one can claim this vault/i.test(inheritText),
  (inheritText.match(/[^\n]*no one can claim[^\n]*/i) || ["—"])[0].slice(0, 90));
check("되돌릴 수 있는 기한 정보를 준다", /can still undo this|cancellation can no longer be undone/i.test(inheritText),
  (inheritText.match(/[^\n]*(?:undo this|no longer be undone)[^\n]*/i) || ["—"])[0].slice(0, 100));
await b.shot("cancelled-inherit");

// ── 3) 해제해서 두 번째 금고를 만들 수 있는가 ───────────────────────────────
log("\n[H] 슬롯 해제 후 두 번째 금고");
await goto("vault");
await sleep(1200);
const relNow = await b.ev(
  `return !([...document.querySelectorAll("button")].find(x=>/release slot/i.test(x.innerText))||{}).disabled;`,
);
check("해제 버튼이 눌릴 수 있다", relNow === true, relNow ? "활성" : "비활성/없음");
await b.ev(`return (()=>{const btn=[...document.querySelectorAll("button")].find(x=>/release slot/i.test(x.innerText));if(!btn)return false;btn.click();return true;})()`);
await sleep(900);
const acked = await b.ev(
  `return (()=>{const c=document.querySelector('input[type=checkbox]');if(!c)return false;c.click();return true;})()`,
);
check("확인 체크박스를 누를 수 있다", acked === true, acked === true ? "눌렀다" : "체크박스 없음");
const confirm = await b.ev(
  `return (()=>{const btn=[...document.querySelectorAll("button")].find(x=>x.innerText.trim()==="Confirm");if(!btn||btn.disabled)return false;btn.click();return true;})()`,
);
check("Confirm 이 눌린다", confirm === true, confirm === true ? "눌렀다" : "비활성/없음");
await sleep(6000);
const after = vaultOf(owner.a);
check("슬롯이 비었다 (vaultOf = 0)", after === ZERO, after);

/* 새로고침 없이 금고 생성 폼이 보여야 한다. 예전에는 `releaseSlot` 이 `vault` 만
   비우고 `vaultOwner` 를 남겨서 `isMyVault` 이 계속 true 였다. 폼은 `!isMyVault` 로
   게이트돼 있어 **성공 안내 아래에 아무것도 없는 화면** 이 남았고, 새로고침해야
   고쳐졌다. 이 경로가 취소 금고 작업의 존재 이유 그 자체이므로 회귀로 고정한다. */
const formAfter = await b.ev(`return (()=>({
  heir: !!document.querySelector("#heir-input"),
  period: !!document.querySelector("#period-input"),
  create: !!([...document.querySelectorAll("button")].find(x=>/create vault/i.test(x.innerText))),
  stillMyVault: /You already have a vault/i.test(document.body.innerText),
}))();`);
check("새로고침 없이 금고 생성 폼이 보인다", formAfter.heir && formAfter.period && formAfter.create,
  JSON.stringify(formAfter));
check("'이미 금고가 있습니다' 가 남아 있지 않다", formAfter.stillMyVault === false,
  formAfter.stillMyVault ? "남아 있다" : "없음");
await b.shot("cancelled-released-no-reload");

if (formAfter.heir && formAfter.create) {
  await b.ev(`return (()=>{
    const setV=(id,v)=>{const e=document.querySelector(id);if(!e)return;
      const d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value");
      d.set.call(e,v); e.dispatchEvent(new Event("input",{bubbles:true}));};
    setV("#heir-input","${heir.a}");
    return 1;
  })()`);
  await sleep(4500);
  const canCreate = await b.ev(
    `return !([...document.querySelectorAll("button")].find(x=>/create vault/i.test(x.innerText))||{}).disabled;`,
  );
  check("상속인을 넣으면 Create 가 활성화된다", canCreate === true, canCreate ? "활성" : "비활성");
  await b.ev(`return (()=>{const btn=[...document.querySelectorAll("button")].find(x=>/create vault/i.test(x.innerText));if(!btn||btn.disabled)return false;btn.click();return true;})()`);
  await sleep(9000);
  const v2 = vaultOf(owner.a);
  check("두 번째 금고가 만들어졌다", v2 !== ZERO, v2);
}

await b.close();
await releaseIfPossible();

log(`\n  통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
