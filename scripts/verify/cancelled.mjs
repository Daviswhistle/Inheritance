// 취소(cancel)된 금고 — 앱이 잘못 말하기 쉬운 상태.
//
// 왜 이 시나리오가 있나
// -------------------
// 상속 취소는 **갱신 기한 전**에 하는 행동이라서, 취소한 뒤에도 카운트다운이 계속
// 돈다. 그 상태를 앱이 어떻게 다루느냐가 전부 문제였다:
//
//   * `vaultPhase` 가 만료와 무관하게 `"cancelled"` 였다. 그래서 카운트다운이 **도는 중**
//     인 취소 금고가 만료된 것처럼 취급됐다 → 입금이 막히고, 기간변경·상속인변경이
//     비활성화됐고, 잔액 0 이면 슬롯 해제 버튼까지 떴다. 계약은 셋 다 허용하거나
//     (취소는 되돌릴 수 있다) / 거절하거나 (해제는 아직 안 된다) 어느 한쪽인데,
//     UI 는 셋 다 잘못된 방향이었다.
//   * 카운트다운 카드가 "Time left to renew / 0d 0h 0m 0s / 어제 날짜" 로 떨어졌다.
//     "갱신하라" 고 말하면서 갱신 버튼은 없고, 실제로 갱신하면 슬롯 해제만 한 주기
//     막힌다(forge: test_CancelledVaultControlMatrixAfterExpiry).
//   * 5단계 상속 파이프라인이 그대로 보였다. 취소된 금고에서 "상속인이 신청한다"는
//     일어나지 않는다.
//   * "At stake … this is what your heir receives if you stop renewing" — 상속인이 없다
//     (heir == owner). 명제 자체가 성립하지 않는다.
//
// 계약 쪽 동작은 forge 테스트가 고정한다(126개). 여기서는 **화면이 그 계약과
// 일치하는지** 본다.
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

if (!F) {
  console.error("  FACTORY 환경변수가 없습니다. scripts/verify/reset.sh 로 체인을 만드세요.");
  process.exit(1);
}

const cast = (args) => {
  const r = spawnSync("cast", args, { encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
};
/** cast 출력에 붙는 ` [5e18]` 같은 사람용 접미사를 벗겨 BigInt 로 읽을 수 있게 한다. */
const castUint = (args) => {
  const { out } = cast(args);
  return BigInt(out.split(/\s+/)[0]);
};

// dev 서버를 직접 띄운다. 이미 떠 있으면 재사용한다.
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

const owner = ACCOUNTS.a4;
const heir = ACCOUNTS.a9;

// ── 1) 취소 + 만료된 금고 (슬롯 해제가 열려야 하는 상태) ───────────────────
const cancelVault = cast([
  "send",
  F,
  "createVault(address,uint256)",
  heir.a,
  "604800",
  "--from",
  owner.a,
  "--private-key",
  owner.pk,
  "--rpc-url",
  RPC,
  "--gas-limit",
  "1500000",
]);
if (!cancelVault.ok) {
  console.error("  금고 생성 실패: " + (cancelVault.err || cancelVault.out).slice(0, 200));
  process.exit(1);
}
const vCancel = cast(["call", F, "vaultOf(address)", owner.a, "--rpc-url", RPC]).out;
log(`  취소할 금고 ${vCancel}`);

cast(["send", vCancel, "ping()", "--from", owner.a, "--private-key", owner.pk, "--rpc-url", RPC, "--gas-limit", "300000"]);

// 상속 취소. 계약상 갱신 기한 **전** 에만 가능하다.
const cancelled = cast([
  "send",
  vCancel,
  "cancelInheritance()",
  "--from",
  owner.a,
  "--private-key",
  owner.pk,
  "--rpc-url",
  RPC,
  "--gas-limit",
  "300000",
]);
check("상속 취소가 성공한다", cancelled.ok, cancelled.ok ? "성공" : (cancelled.err || "").slice(0, 120));

// 기한 경과.
const cd = cast(["call", vCancel, "heartbeatInterval()", "--rpc-url", RPC]).out.split(/\s+/)[0];
await sleep(500);
cast(["rpc", "evm_setNextBlockTimestamp", String(Number(cd) + 1000), "--rpc-url", RPC]);
cast(["rpc", "evm_mine", "--rpc-url", RPC]);
await sleep(500);

const isSettled = castUint(["call", vCancel, "isSettled()", "--rpc-url", RPC]);
const isCancelled = castUint(["call", vCancel, "inheritanceCancelled()", "--rpc-url", RPC]);
check("체인: 취소 + 만료 + settled", isCancelled === 1n && isSettled === 1n, `cancelled=${isCancelled} settled=${isSettled}`);

// ── 2) 화면이 그 상태를 어떻게 말하는가 ─────────────────────────────────────
const b = await launch({ pk: owner.pk, url: APP });
await sleep(3000);
await b.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>x.innerText.trim()==="Connect");if(e)e.click();return 1;})()`);
await sleep(6500);
await b.ev(
  `return (()=>{const e=[...document.querySelectorAll(".tab-item")].filter(x=>x.offsetParent!==null).find(x=>x.innerText.trim().toLowerCase().includes("vault"));if(e)e.click();return 1;})()`,
);
await sleep(1800);

const vaultText = await b.ev("return document.body.innerText;");

log("\n[A] 카운트다운 카드");
check("'갱신하라' 고 말하지 않는다", !/time left to renew|renew soon/i.test(vaultText),
  (vaultText.match(/[^\n]*(?:time left to renew|renew soon)[^\n]*/i) || ["—"])[0].slice(0, 100));
check("0d 0h 0m 0s 카운트다운을 보여주지 않는다", !/\b0d 0h 0m 0s\b/.test(vaultText),
  /\b0d 0h 0m 0s\b/.test(vaultText) ? "0 카운트다운이 보인다" : "없음");
check("취소 사실을 머리말로 말한다", /inheritance cancelled/i.test(vaultText),
  (vaultText.match(/[^\n]*inheritance cancelled[^\n]*/i) || ["—"])[0].slice(0, 90));
check("'아무도 상속받지 않는다' 고 말한다", /nobody will inherit/i.test(vaultText),
  (vaultText.match(/[^\n]*nobody will inherit[^\n]*/i) || ["—"])[0].slice(0, 90));

log("\n[B] 갱신 버튼");
const renewButtons = await b.ev(
  `return [...document.querySelectorAll("button")].filter(x=>/reset timer|renew and withdraw/i.test(x.innerText)).map(x=>({t:x.innerText,disabled:x.disabled}));`,
);
check("취소+만료 후에는 갱신 버튼이 없다", renewButtons.length === 0,
  renewButtons.length ? JSON.stringify(renewButtons) : "없음");

log("\n[C] 소유자 조작");
const controls = await b.ev(
  `return [...document.querySelectorAll("button")].map(x=>({t:x.innerText.trim(),disabled:x.disabled}));`,
);
const byLabel = (re) => controls.find((c) => re.test(c.t));
const period = byLabel(/change period/i);
check("Change period 가 비활성이다 (계약도 Expired 로 거절)", period ? period.disabled === true : true,
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

log("\n[F] 파이프라인");
check("상속 파이프라인 5단계를 보여주지 않는다", !/heir files a claim/i.test(vaultText),
  /heir files a claim/i.test(vaultText) ? "상속 절차가 보인다" : "없음");
check("취소 상태에 맞는 짧은 목록을 보여준다", /no one can claim this vault/i.test(vaultText),
  (vaultText.match(/[^\n]*no one can claim[^\n]*/i) || ["—"])[0].slice(0, 90));

await b.shot("cancelled-vault");

// ── 3) 실제로 해제해서 두 번째 금고를 만들 수 있는가 ─────────────────────────
log("\n[G] 슬롯 해제 후 두 번째 금고");
if (rel) {
  await b.ev(`return (()=>{
    const btn=[...document.querySelectorAll("button")].find(x=>/release slot/i.test(x.innerText));
    if(!btn) return false; btn.click(); return true;
  })()`);
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
  const after = cast(["call", F, "vaultOf(address)", owner.a, "--rpc-url", RPC]).out;
  check("슬롯이 비었다 (vaultOf = 0)", after.endsWith("0".repeat(40)), after.slice(0, 66));
} else {
  check("슬롯 해제 경로를 확인할 수 없다", false, "Release slot 이 없음");
}

await b.close();

log(`\n  통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
