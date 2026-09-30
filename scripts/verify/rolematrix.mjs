// 역할 × 단계 × 탭 행렬 — 소유자 화법이 비소유자에게 새는지 본다.
//
// 왜 이게 있나
// -------------
// 이 앱의 가장 반복되는 버그는 **"소유자에게는 맞는 문장이 상속인/타인에게 그대로
// 보인다"** 는 것이었다. 한 번은 "The heir can withdraw…" 가 상속인 자신의 화면에,
// 한 번은 "You can now file a claim" 이 아무도 아닌 타인에게, 이번엔 "At stake …
// your heir receives" 와 "Renew urgently" 가 3단계 × 2역할 × 2탭 = 24건.
//
// 각각 독립적으로 발견되고 고쳐졌지만, 구조적 원인은 같다: 주어를 따지지 않는다.
// 개별 문장을 고치는 것으로는 끝이 없다 — **행렬로 확인해야** 다음 사람이 같은
// 자리를 다시 망가뜨리지 않는다.
//
// 무엇을 보나
// ----------
// 금고 하나를 세 단계(active / expired / claimable)로 놓고, 소유자·상속인·타인
// 세 지갑이 네 탭을 모두 본다. 소유자가 아닌 두 역할을 대상으로 **소유자 전용
// 표현**이 하나라도 나오면 실패로 본다.
//
//   "your heir …"            상속인/타인에게 소유자의 상속인을 말하면 안 된다
//   "Renew urgently/soon"    갱신 권한이 없는 지갑에게 갱신을 재촉하면 안 된다
//   "you must renew"         ditto
//   "your claim"             타인에게 자기 청산을 말하면 안 된다
//   "Deposit … to start"     입금이 막힌/권한 없는 자리에서 입금을 지시하면 안 된다
//
// 실행: FACTORY=0x... node scripts/verify/rolematrix.mjs
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
const PORT = Number(process.env.PORT || 7715);
const APP = `http://127.0.0.1:${PORT}/`;

if (!F) {
  console.error("  FACTORY 환경변수가 없습니다.");
  process.exit(1);
}

const cast = (args) => {
  const r = spawnSync("cast", args, { encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
};

// 여기서 쓰는 세 지갑은 다른 단계가 건드리지 않는다. 전용이 많아야 행렬이 안정적이다.
const owner = ACCOUNTS.a5;
const heir = ACCOUNTS.a6;
const stranger = ACCOUNTS.a7;
const TABS = ["vault", "send", "inherit", "help"];

/**
 * 소유자가 아닌 지갑에게 나오면 안 되는 표현.
 *
 * **"이 자리가 누구의 것인지" 를 단정하는 문장**만 금지한다. "your heir" 라는 문자열
 * 자체를 금지하면 안 된다 — Help 탭의 설명("We do not store any personal data about
 * you, your heir, or your vault") 과 금고 생성 온보딩("Miss it and your heir can claim
 * the balance") 은 문맥상 맞아떨어진다. 거기서 "your heir" 는 **금고를 만들 사람에게
 * 하는 말**이기 때문이다. 문제는 상속인/타인 화면에서 **남의 금고**를 자기 금고처럼
 * 말하는 데 있다.
 *
 * 그래서 넓은 패턴이 아니라 아래처럼 각각이 명제인 것만 금지한다.
 */
const OWNER_ONLY = [
  { re: /your heir receives/i, why: "상속인/타인에게 남의 상속인이 받는다고 말한다" },
  { re: /Your heir (has )?filed a claim/i, why: "상속인/타인에게 자기 소유자의 청산이라 말한다" },
  { re: /Your heir can now file a claim/i, why: "ditto" },
  { re: /If you stop, your heir can claim/i, why: "ditto" },
  { re: /you can keep renewing to cancel it/i, why: "청산 취소 권한이 없는 지갑에게 권한을 준다" },
  { re: /\bRenew (urgently|soon)\b/i, why: "갱신 권한이 없는 지갑에게 갱신을 재촉한다" },
  { re: /you must renew/i, why: "ditto" },
];

/**
 * **상속인에게는 맞지만 타인에게는 안 되는** 표현.
 *
 * 상속인은 실제로 신청하고 수령할 수 있다. 그래서 위 목록(소유자 전용)으로 상속인을
 * 검사하면 "당신이 신청할 수 있습니다" 를 잡아버린다 — 그건 맞는 말이다. 타인에게만
 * 금지한다.
 */
const HEIR_ONLY = [
  { re: /You can now file a claim/i, why: "청산 권한이 없는 타인에게 신청하라고 한다" },
  { re: /You filed a claim/i, why: "타인에게 자기 청산을 말한다" },
  { re: /You can withdraw the vault balance/i, why: "인출 권한이 없는 타인에게 인출할 수 있다고 말한다" },
];

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
      /* 아직 */
    }
  }
}
check("dev 서버 기동", up, up ? APP : "실패");
if (!up) process.exit(1);

const mk = (pk, url) => launch({ pk, url });
const connect = async (page) => {
  await page.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>x.innerText.trim()==="Connect");if(e)e.click();return 1;})()`);
  await sleep(5500);
};
const goto = (page, tab) =>
  page.ev(
    `return (()=>{const e=[...document.querySelectorAll(".tab-item")].filter(x=>x.offsetParent!==null).find(x=>x.innerText.trim().toLowerCase().startsWith("${tab}"));if(e)e.click();return 1;})()`,
  );
/** 읽히는 탭만 실제로 순회한다 (금고가 없으면 일부 탭이 숨겨진다). */
const visibleTabs = (page) =>
  page.ev(`return [...document.querySelectorAll(".tab-item")].filter(x=>x.offsetParent!==null).map(x=>x.innerText.trim().toLowerCase());`);

async function sweep(phase, label) {
  log(`\n[${label}]`);
  for (const [who, acct] of [
    ["상속인", heir],
    ["타인", stranger],
  ]) {
    const page = await mk(acct.pk, `${APP}?vault=${process.env.VAULT}`);
    await connect(page);
    const tabs = await visibleTabs(page);
    // 상속인에게는 맞는 말이어도 **타인에게만** 금지한다.
    const extra = who === "타인" ? HEIR_ONLY : [];
    for (const tab of TABS) {
      if (!tabs.some((t) => t.startsWith(tab))) continue;
      await goto(page, tab);
      await sleep(1300);
      const text = await page.ev("return document.body.innerText;");
      const bad = [...OWNER_ONLY, ...extra]
        .filter((o) => o.re.test(text))
        .map((o) => `${o.re} (${o.why})`);
      check(`${who} / ${tab} 탭에 소유자 전용 표현이 없다`, bad.length === 0,
        bad.length ? bad.join(" | ") : "");
    }
    await page.close();
  }
  // 소유자에게는 실제로 그 문장이 보여야 한다 — 검사가 비어 있지 않은지 확인한다.
  const p = await mk(owner.pk, APP);
  await connect(p);
  const tabs = await visibleTabs(p);
  let sawOwnerVoice = 0;
  for (const tab of TABS) {
    if (!tabs.some((t) => t.startsWith(tab))) continue;
    await goto(p, tab);
    await sleep(1200);
    const text = await p.ev("return document.body.innerText;");
    if (OWNER_ONLY.some((o) => o.re.test(text))) sawOwnerVoice++;
  }
  check(`(대조) 소유자에게는 소유자 표현이 보인다 — 검사가 빈 껍데기가 아니다`, sawOwnerVoice > 0,
    `${sawOwnerVoice}개 탭`);
  await p.close();
}

const send = (to, sig, args, from) =>
  cast(["send", to, sig, ...args, "--from", from.a, "--private-key", from.pk, "--rpc-url", RPC, "--gas-limit", "2000000"]);

// 1) 전용 금고 하나를 만든다 (남아 있으면 정리)
let v = cast(["call", F, "vaultOf(address)(address)", owner.a, "--rpc-url", RPC]).out;
if (v !== "0x" + "0".repeat(40)) {
  const bal = cast(["call", WLD, "balanceOf(address)(uint256)", v, "--rpc-url", RPC]).out.split(/\s+/)[0];
  if (BigInt(bal) > 0n) send(F, "rescueFromMyVault(address,uint256,address)", [WLD, bal, owner.a], owner);
  send(F, "releaseMyVault()", [], owner);
  await sleep(600);
}
const created = send(F, "createVault(address,uint256)", [heir.a, "259200"], owner);
if (!created.ok) {
  console.error("  금고 생성 실패: " + (created.err || created.out).slice(0, 180));
  process.exit(1);
}
const VAULT = cast(["call", F, "vaultOf(address)(address)", owner.a, "--rpc-url", RPC]).out;
process.env.VAULT = VAULT;
log(`  행렬용 금고 ${VAULT} · 소유자 ${owner.a} · 상속인 ${heir.a} · 타인 ${stranger.a}`);

// 잔액이 있어야 "At stake" 가 숫자를 말한다
send(WLD, "approve(address,uint256)", [F, "100000000000000000000"], owner);
send(F, "deposit(uint256)", ["5000000000000000000"], owner);
await sleep(800);
const bal = cast(["call", WLD, "balanceOf(address)(uint256)", VAULT, "--rpc-url", RPC]).out.split(/\s+/)[0];
check("금고에 WLD 가 있다", BigInt(bal) > 0n, bal);

await sweep("active", "1단계 — 카운트다운 도는 중 (기한 남음)");

// 2) 만료
const cd = Number(cast(["call", VAULT, "heartbeatInterval()(uint256)", "--rpc-url", RPC]).out.split(/\s+/)[0]);
const lp = Number(cast(["call", VAULT, "lastPing()(uint256)", "--rpc-url", RPC]).out.split(/\s+/)[0]);
cast(["rpc", "evm_setNextBlockTimestamp", String(lp + cd + 1000), "--rpc-url", RPC]);
cast(["rpc", "evm_mine", "--rpc-url", RPC]);
await sleep(600);
await sweep("expired", "2단계 — 기한 경과, 청산 신청 전");

// 3) 상속인이 신청 → 이의제기 기간
cast(["send", VAULT, "fileClaim()", "--from", heir.a, "--private-key", heir.pk, "--rpc-url", RPC, "--gas-limit", "300000"]);
await sleep(600);
const challenge = cast(["call", VAULT, "challengeEndsAt()(uint256)", "--rpc-url", RPC]).out.split(/\s+/)[0];
cast(["rpc", "evm_setNextBlockTimestamp", String(Number(challenge) + 1000), "--rpc-url", RPC]);
cast(["rpc", "evm_mine", "--rpc-url", RPC]);
await sleep(600);
await sweep("claimable", "3단계 — 이의제기 기간 경과, 수령 가능");

// 정리 — 다음 실행을 위해 슬롯을 비운다
cast(["send", VAULT, "finalizeClaim()", "--from", heir.a, "--private-key", heir.pk, "--rpc-url", RPC, "--gas-limit", "300000"]);
await sleep(600);
const bal2 = cast(["call", WLD, "balanceOf(address)(uint256)", VAULT, "--rpc-url", RPC]).out.split(/\s+/)[0];
if (BigInt(bal2) > 0n) send(F, "rescueFromMyVault(address,uint256,address)", [WLD, bal2, owner.a], owner);
send(F, "releaseMyVault()", [], owner);

log(`\n  통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
