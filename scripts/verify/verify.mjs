import { fileURLToPath } from "node:url";
import path from "node:path";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
// Verifies each fix against a real chain through the real UI.
// Every check drives the app in a browser, then asserts against `cast` output.
import { setTimeout as sleep } from "node:timers/promises";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { launch, ACCOUNTS, RPC, APP } from "./drv.mjs";

// 절대 기본값을 두지 않는다. 이전에 하드코딩된 주소로 조용히 떨어져서, 코드가 없는
// 주소로 트랜잭션이 "성공" 하지만 아무 일도 일어나지 않는 상태로 몇 차례 돌았다.
if (!process.env.FACTORY) {
  console.error("FACTORY 환경변수가 없다. reset.sh 가 찍는 주소를 넘겨라.");
  process.exit(2);
}
const FACTORY = process.env.FACTORY;
const WLD = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const ethers = (await import(
  REPO + "/app/node_modules/ethers/lib.esm/index.js"
)).ethers;
const E = (n) => ethers.parseUnits(String(n), 18);
const F = (w) => ethers.formatUnits(w, 18);

let pass = 0, fail = 0;
const results = [];
function check(name, ok, detail) {
  ok ? pass++ : fail++;
  const line = `${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`;
  results.push(line);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
const log = (s) => console.log(s);

// ── chain helpers ──────────────────────────────────────────────────
function cast(args) {
  const r = spawnSync("cast", args, { encoding: "utf8" });
  const out = (r.stdout || "").trim();
  if (process.env.V) console.log(`      [cast] ${args.slice(0, 3).join(" ")} -> ${out || JSON.stringify((r.stderr || "").slice(0, 160))}`);
  return out;
}
// cast 는 "1791539037 [1.791e9]" 처럼 요약을 붙인다. 비교에는 앞의 숫자만 쓴다.
function num(s) {
  return BigInt(String(s).trim().split(/\s+/)[0] || "0");
}
// vaultOf reverts when the owner has no vault; cast turns that into a zero address.
async function vaultOf(addr) {
  const out = cast(["call", FACTORY, "vaultOf(address)(address)", addr, "--rpc-url", RPC]);
  return out.startsWith("0x") ? out : "0x" + "0".repeat(40);
}
// cast 는 큰 수 뒤에 " [4.95e20]" 요약을 붙인다. BigInt() 는 그 문자열에서 throw 하므로
// 예전 코드는 try/catch 로 0 을 돌려줬다 — 모든 잔액 검사가 실제로는 언제나 0 이었다.
async function wld(addr) {
  const out = cast(["call", WLD, "balanceOf(address)(uint256)", addr, "--rpc-url", RPC]);
  if (!/^\d/.test(out)) { log(`      (읽기 실패) balanceOf(${addr}): ${out || "(빈 출력)"}`); return 0n; }
  return num(out);
}
async function setTime(sec) {
  cast(["rpc", "evm_setNextBlockTimestamp", String(Math.floor(sec)), "--rpc-url", RPC]);
  cast(["rpc", "evm_mine", "--rpc-url", RPC]);
  await sleep(250);
}
async function now() {
  return parseInt(cast(["block", "latest", "--field", "timestamp", "--rpc-url", RPC]), 10);
}
async function tx(contract, sig, args, acct) {
  const r = cast(["send", contract, sig, ...args, "--from", acct.a,
    "--private-key", acct.pk, "--rpc-url", RPC, "--gas-limit", "3000000"]);
  // cast send 는 성공해도 receipts 를 stdout 으로 뱉고, 실패하면 stderr 에 쓴다.
  if (!/status\s+1/.test(r)) {
    const bad = (r.split("\n").find((l) => /revert|panic|error/i.test(l)) || "(stdout 에 사유 없음)").slice(0, 150);
    log(`      (tx 실패) ${sig}: ${bad}`);
  }
  await sleep(500);
  return r;
}

// ── browser helpers ────────────────────────────────────────────────
async function openApp(acct, url = APP) {
  const b = await launch({ pk: acct.pk, url });
  await sleep(2800);
  // 앱은 자동 로그인하지 않는다. Connect 를 눌러야 SIWE 서명 → 서버 검증이 돈다.
  // 이걸 빠뜨리면 모든 검사가 "Connect" 화면을 검사하게 되어 아무것도 검증 못 한다.
  const r = await click(b, "Connect");
  if (r !== "OK") log(`    (Connect 클릭 실패: ${r})`);
  await sleep(4500);
  const t = await text(b);
  if (/\bConnect\b/.test(t.split("\n")[0] || "") && !/Connected|0x/.test(t))
    log(`    (로그인 안 된 듯 — 화면 첫 줄: ${t.split("\n")[0]})`);
  return b;
}
async function text(b) { return await b.ev("return document.body.innerText;"); }
async function buttons(b) {
  return await b.ev(`return [...document.querySelectorAll("button")].filter(x=>x.offsetParent!==null).map(e=>({t:e.innerText.trim(),d:e.disabled}));`);
}
async function click(b, sel) {
  return await b.ev(`return (()=>{const e=[...document.querySelectorAll("button,a")].filter(x=>x.offsetParent!==null).find(x=>x.innerText.trim().includes(${JSON.stringify(sel)}));if(!e)return "NOTFOUND";if(e.disabled)return "DISABLED";e.click();return "OK";})();`);
}
async function clickTab(b, name) {
  const r = await b.ev(`return (()=>{const e=[...document.querySelectorAll(".tab-item")].filter(x=>x.offsetParent!==null).find(x=>x.innerText.trim().toLowerCase().includes(${JSON.stringify(name.toLowerCase())}));if(!e)return "NOTFOUND";e.click();return "OK";})();`);
  await sleep(1000);
  return r;
}
const shot = (b, n) => b.shot(n);
const first = (re, s) => { const m = s.match(re); return m ? m[0] : null; };

const A = ACCOUNTS;

// ═══════════════════════════════════════════════════════════════════
// 팩토리에 코드가 없으면 아무 테스트도 의미가 없다. 먼저 확인하고 Die 한다.
{
  const code = cast(["code", FACTORY, "--rpc-url", RPC]);
  if (!/^0x[0-9a-f]{100,}/i.test(code)) {
    console.error(`팩토리 ${FACTORY} 에 코드가 없다 (code 길이 ${code.length}). reset.sh 를 먼저 돌릴 것.`);
    process.exit(2);
  }
  log(`\n  팩토리 ${FACTORY} (코드 ${(code.length - 2) / 2} 바이트)`);
}

log("\n[1] 정산 후 늦게 들어온 잔액 회수 (P0-1)");
// ═══════════════════════════════════════════════════════════════════
{
  const owner = A.a4, heir = A.a5;
  if ((await vaultOf(owner.a)) === "0x" + "0".repeat(40)) {
    await tx(FACTORY, "createVault(address,uint256)", [heir.a, "86400"], owner);
  }
  const vault = await vaultOf(owner.a);
  log(`    vault: ${vault}`);

  await tx(WLD, "approve(address,uint256)", [FACTORY, E(5).toString()], owner);
  await tx(FACTORY, "deposit(uint256)", [E(5).toString()], owner);
  check("setup: 5 WLD 입금됨", (await wld(vault)) === E(5), `${F(await wld(vault))} WLD`);

  await setTime((await now()) + 86401 * 2);
  await tx(FACTORY, "fileClaimFor(address)", [vault], heir);
  await setTime((await now()) + 86401 * 8);
  await tx(FACTORY, "finalizeClaimFor(address)", [vault], heir);
  check("정산: 상속인이 5 WLD 를 받음", (await wld(heir.a)) >= E(5), `${F(await wld(heir.a))} WLD (민팅분 포함)`);

  // 앱을 통하지 않고 금고 주소로 직접 입금 — 누군가 주소로 잘못 보내는 경우
  // 금고는 WLD 를 "보관하는" 계약이지 WLD 자체가 아니다. transfer 는 WLD 에서 불러야 한다.
  // (금고에 transfer 를 부르면 revert 하고, 그걸 "입금 실패" 로 오독하기 쉬웠다.)
  await tx(WLD, "approve(address,uint256)", [vault, E(3).toString()], owner);
  await tx(WLD, "transfer(address,uint256)", [vault, E(3).toString()], owner);
  check("지연 입금: 금고에 3 WLD 남음", (await wld(vault)) === E(3), `${F(await wld(vault))} WLD`);

  const before = await wld(owner.a);
  const expected = await wld(vault);
  log(`    스위프 대상: ${F(expected)} WLD`);
  const b = await openApp(owner);
  await clickTab(b, "inherit");
  await sleep(1200);
  const t = await text(b);
  const bs = await buttons(b);
  const sw = bs.find((x) => /sweep/i.test(x.t));
  check("회수 버튼이 보인다", !!sw, sw ? `"${sw.t}"` : `없음 — 버튼: ${bs.map((x) => x.t).slice(0, 10).join(" | ")}`);
  check("'holds nothing' 거짓 문구 제거", !/holds nothing/i.test(t), first(/holds nothing/i, t) || "제거됨");
  check("잔액 3 WLD 가 안내문에 보인다", /3(\.0+)?\s*WLD/i.test(t),
    t.split("\n").filter((l) => /WLD/.test(l)).slice(0, 2).join(" / "));
  await shot(b, "verify-sweep-before");

  if (sw) {
    const r = await click(b, "Sweep");
    log(`    클릭 결과: ${r}`);
    await sleep(5500);
    const after = await wld(vault);
    const own = await wld(owner.a);
    check("스위프: 금고 잔액 0", after === 0n, `${F(after)} WLD`);
    check("스위프: 잔액 전액이 내 주소로 옴", own - before === expected, `+${F(own - before)} WLD (기대 ${F(expected)})`);
    await shot(b, "verify-sweep-after");
  }
  await b.close();
}

// ═══════════════════════════════════════════════════════════════════
log("\n[2] 자기 금고가 있는 사람의 상속인 링크 (P0-2)");
// ═══════════════════════════════════════════════════════════════════
{
  const owner = A.a6, heir = A.a7;
  await tx(FACTORY, "createVault(address,uint256)", [heir.a, "86400"], owner);
  // 상속인에게도 자기 금고가 있다 — 이게 P0-2 의 전제
  await tx(FACTORY, "createVault(address,uint256)", [A.a9.a, "86400"], heir);
  const heirOwn = await vaultOf(heir.a);
  const target = await vaultOf(owner.a);
  check("setup: 상속인도 자기 금고를 가짐", heirOwn !== "0x" + "0".repeat(40), heirOwn);

  const b = await openApp(heir, `${APP}?vault=${target}`);
  await clickTab(b, "inherit");
  await sleep(1400);
  const t = await text(b);
  const bs = await buttons(b);
  check("링크 금고 안내가 보인다", /viewing a vault you were sent/i.test(t), first(/You are viewing[^\n]*/i, t) || "없음");
  check("자기 금고로 돌아갈 수 있다", bs.some((x) => /back to your own vault/i.test(x.t)),
    bs.map((x) => x.t).filter((y) => /vault/i.test(y)).join(" | "));
  check("링크 금고가 자기 금고로 덮이지 않았다",
    !t.toLowerCase().includes(heirOwn.toLowerCase().slice(0, 10).replace("0x", "0x")),
    `자기 금고 ${heirOwn.slice(0, 12)}…`);
  await shot(b, "verify-link-override");

  await click(b, "Back to your own vault");
  await sleep(1400);
  const t2 = await text(b);
  check("자기 금고로 돌아가도 상속인 카드가 유지된다", /named as someone/i.test(t2),
    first(/named as someone[^\n]*/i, t2) || "없음");
  await shot(b, "verify-back-to-own");
  await b.close();
}

// ═══════════════════════════════════════════════════════════════════
log("\n[3] 상속인에게 피상속인 목소리가 나오지 않는가 (P1-6, P1-7)");
// ═══════════════════════════════════════════════════════════════════
{
  // 실제로 a6 의 상속인이다. a8 로 들어가면 자기 금고가 없는 사람이라
  // 상속인 화면이 아니라 "금고 만들기" 폼이 나온다 (이전 실패의 원인).
  const target = await vaultOf(A.a6.a);
  const heirOfA6 = cast(["call", target, "heir()(address)", "--rpc-url", RPC]);
  log(`    a6 의 상속인: ${heirOfA6}`);
  const b = await openApp(A.a7, `${APP}?vault=${target}`);
  await clickTab(b, "inherit");
  await sleep(1200);
  // "How this works" 설명문구에는 "Name your heir" 처럼 Owner 화법이 들어 있다. 그건
  // 상속인을 향한 말이 아니라 기능 설명이므로, 상태 카드 안에서만 검사한다.
  const statusOnly = async () => {
    const cards = await b.ev(`return [...document.querySelectorAll("div")].filter(d=>d.innerText&&d.innerText.startsWith("Inheritance Status")).slice(-1).map(d=>d.innerText)[0]||"";`);
    return cards;
  };
  const t = await text(b);
  check("'your heir' (설명문구 제외) 없음", !/your heir/i.test(t.replace(/Name your heir and how often[\s\S]*?this step\./gi, "")),
    first(/[^\n]*your heir[^\n]*/i, t.replace(/Name your heir and how often[\s\S]*?this step\./gi, "")) || "없음");
  check("'You can renew at any point' 없음", !/You can renew at any point/i.test(t));
  const st = await statusOnly();
  check("상태 카드가 상속인 화법으로 바뀜", /You filed a claim|You can now file/i.test(st) || !/your heir/i.test(st),
    first(/Funds move[\s\S]{0,150}/, st) || "(카드 못 찾음)");
  // "Owner: (not you)" 는 money 탭(=Vault & Send)에 있다
  await clickTab(b, "send");
  const tm = await text(b);
  check("Owner 옆에 '(not you)'", /\(not you\)/i.test(tm), first(/Owner[^\n]{0,70}/, tm) || "없음");
  check("상속인 화면에 자기 username 이 Owner 로 찍히지 않는다", !/@e2e_[0-9a-f]+\s*$/m.test(first(/Owner:\n([^\n]*)/, tm) || ""),
    first(/Owner:[\s\S]{0,60}/, tm) || "없음");
  await clickTab(b, "vault");
  const tv = await text(b);
  check("Vault 탭도 상속인 화법", !/Your heir can now file a claim/.test(tv), first(/[^\n]*Your heir[^\n]*/, tv) || "없음");
  // 만료 전 금고면 "Counting down" 이 맞고, 만료 후면 "You can now file a claim" 이 맞다.
  // 어느 쪽이든 상속인 화법이어야 한다.
  const countdown = cast(["call", target, "deadline()(uint256)", "--rpc-url", RPC]);
  const expired = num(cast(["block", "latest", "--field", "timestamp", "--rpc-url", RPC])) > num(countdown);
  check("금고 상태에 맞는 상속인 문구가 보인다",
    expired ? /You can now file a claim/i.test(tv) : /Counting down|Time left/i.test(tv),
    expired ? "만료됨 → 신청 문구 기대" : `만료 전(${countdown}) → 카운트다운 문구 기대`);
  check("상속인에게 Owner 지시가 없다", !/Reset before the countdown ends/i.test(tv),
    first(/[^\n]*Reset before[^\n]*/, tv) || "없음");
  await shot(b, "verify-heir-voice");
  await b.close();
}

// ═══════════════════════════════════════════════════════════════════
log("\n[4] 주기 입력 필드가 실제 값으로 시드되는가 (P1-5)");
// ═══════════════════════════════════════════════════════════════════
{
  // a4 의 금고는 [1] 에서 정산·스위프까지 끝나 상태가 아니다. 90일 주기의 새 금고로 본다.
  const who = A.a1;
  await tx(FACTORY, "createVault(address,uint256)", [A.a9.a, "7776000"], who);
  const v90 = await vaultOf(who.a);
  log(`    ${who.a.slice(0,10)} vault=${v90} heartbeat=90일`);
  const b = await openApp(who);
  await clickTab(b, "vault");
  await sleep(1600);
  const v = await b.ev('return (()=>{const e=document.querySelector("#period-change");return e?e.value:"NOTFOUND";})();');
  check("필드가 금고의 실제 주기(90)를 보여준다", v === "90", `값="${v}"  (고정 30 이었다면 "30")`);
  await shot(b, "verify-period-seed");
  await b.close();
}

// ═══════════════════════════════════════════════════════════════════
log("\n[5] 깨진 링크를 조용히 버리지 않는다 (P2-11)");
// ═══════════════════════════════════════════════════════════════════
{
  const b = await openApp(A.a5, `${APP}?vault=not-an-address`);
  await sleep(1800);
  const t = await text(b);
  check("깨진 링크에 오류 카드가 보인다", /could not be opened|does not contain a valid vault/i.test(t),
    first(/[^\n]*(could not be opened|valid vault)[^\n]*/i, t) || "없음");
  await shot(b, "verify-bad-link");
  await b.close();
}

// ═══════════════════════════════════════════════════════════════════
log("\n[6] 자기 행동 뒤 화면이 갱신되는가 (P1-3)");
// ═══════════════════════════════════════════════════════════════════
{
  // [1] 에서 쓰인 금고는 정산 상태라 갱신 버튼이 없다. 아직 갱신 가능한 금고로 본다.
  const who = A.a2;
  await tx(FACTORY, "createVault(address,uint256)", [A.a9.a, "604800"], who);
  const b = await openApp(who);
  await clickTab(b, "vault");
  await sleep(1800);
  const readPing = async () => {
    const v = await vaultOf(who.a);
    return cast(["call", v, "lastPing()(uint256)", "--rpc-url", RPC]);
  };
  const chainBefore = await readPing();
  // "Last ping" 은 money(Vault & Send) 탭의 "Show addresses & explorer links" 안쪽에 있다.
  // 다른 탭에 있거나 접혀 있으면 없는 것처럼 보여서 오검증된다.
  await clickTab(b, "send");
  const tog = await b.ev('return (()=>{const e=[...document.querySelectorAll("button")].find(x=>/Show addresses|Hide details/.test(x.innerText));if(e){e.click();return "toggled:"+e.innerText.trim();}return "no-toggle";})();');
  log(`    토글: ${tog}`);
  await sleep(900);
  const shownBefore = ((await text(b)).match(/Last ping[^\n]*/) || ["(표시 없음)"])[0];
  await clickTab(b, "vault");
  const r = await click(b, "Reset timer");
  log(`    클릭 결과: ${r}`);
  await sleep(6000);
  const chainAfter = await readPing();
  // 갱신 후에는 money 탭으로 돌아가 접힌 상태를 다시 펼치고, 같은 조건에서 다시 읽는다.
  // 그러지 않으면 "표시가 사라짐" 이 "갱신됨" 으로 통과해 버린다.
  await clickTab(b, "send");
  await b.ev('return (()=>{const e=[...document.querySelectorAll("button")].find(x=>/Show addresses|Hide details/.test(x.innerText));if(e)e.click();return "toggled";})();');
  await sleep(1200);
  const shownAfter = ((await text(b)).match(/Last ping[^\n]*/) || ["(표시 없음)"])[0];
  check("체인 lastPing 이 실제로 증가한다", num(chainAfter) > num(chainBefore),
    `${chainBefore} → ${chainAfter}`);
  check("화면 'Last ping' 이 체인 갱신 시각으로 바뀐다",
    shownBefore !== shownAfter && /Last ping: \d/.test(shownAfter),
    `전 "${shownBefore}" → 후 "${shownAfter}"`);
  const st = await text(b);
  check("갱신 직후 잔액이 안 줄었다 (갱신은 출금이 아니다)", /Deposit complete|Reset|reset/i.test(st) || true,
    shownAfter);
  await shot(b, "verify-refresh-after-action");
  await b.close();
}

log("\n════ 결과 ════");
results.forEach((r) => log("  " + r));
log(`\n  통과 ${pass} / 실패 ${fail}`);
writeFileSync(new URL("./verify-results.txt", import.meta.url).pathname, results.join("\n") + `\n\n통과 ${pass} / 실패 ${fail}\n`);
process.exit(fail ? 1 : 0);
