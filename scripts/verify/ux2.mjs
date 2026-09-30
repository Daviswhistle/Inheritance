// UI/UX audit at 390x844 across every account state.
// Checks the things that only show up when you actually render: horizontal overflow,
// content hidden behind the tab bar, tap targets under 28px, unlabelled controls,
// text under 10px, empty tabs, and the disconnected banner.
import { setTimeout as sleep } from "node:timers/promises";
import { spawnSync } from "node:child_process";
import { launch, ACCOUNTS, RPC, APP } from "./drv.mjs";

const FACTORY = process.env.FACTORY;
if (!FACTORY) { console.error("FACTORY 환경변수 필요"); process.exit(2); }
const WLD = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

const cast = (a) => (spawnSync("cast", a, { encoding: "utf8" }).stdout || "").trim();
const num = (s) => BigInt(String(s).trim().split(/\s+/)[0] || "0");
async function vaultOf(a) {
  const o = cast(["call", FACTORY, "vaultOf(address)(address)", a, "--rpc-url", RPC]);
  return o.startsWith("0x") ? o : "0x" + "0".repeat(40);
}
async function wld(a) {
  const o = cast(["call", WLD, "balanceOf(address)(uint256)", a, "--rpc-url", RPC]);
  return /^\d/.test(o) ? num(o) : 0n;
}
async function now() { return num(cast(["block", "latest", "--field", "timestamp", "--rpc-url", RPC])); }
async function setTime(s) {
  cast(["rpc", "evm_setNextBlockTimestamp", String(Number(s)), "--rpc-url", RPC]);
  cast(["rpc", "evm_mine", "--rpc-url", RPC]);
  await sleep(250);
}
async function tx(c, sig, args, a) {
  cast(["send", c, sig, ...args, "--from", a.a, "--private-key", a.pk, "--rpc-url", RPC, "--gas-limit", "3000000"]);
  await sleep(400);
}

let pass = 0, fail = 0;
const bad = [];
function check(name, ok, detail) {
  ok ? pass++ : fail++;
  if (!ok) bad.push(`${name}${detail ? "  — " + detail : ""}`);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

const A = ACCOUNTS;
const E = (n) => (BigInt(n) * 10n ** 18n).toString();

// The audit itself, run in-page. Returns every violation it finds.
const AUDIT = `
  const vw = window.innerWidth, vh = window.innerHeight;
  const out = { overflow: null, occluded: [], small: [], unlabelled: [], tiny: [], banner: false, bottomPad: 0 };
  const de = document.documentElement;
  if (de.scrollWidth > vw + 1) out.overflow = { scrollWidth: de.scrollWidth, vw };

  // Tab bar items ARE the bottom bar. Flagging them as "occluded by the tab bar" is
  // nonsense, so exclude anything inside it.
  const bar = document.querySelector(".tab-bar, .tabbar, nav.fixed, [class*=tab-bar]");
  const inBar = (el) => bar && (bar === el || bar.contains(el));
  const barTop = bar ? bar.getBoundingClientRect().top : vh;

  // "Occluded" must mean unreachable, not merely below the fold: the page scrolls, so
  // the honest test is whether scrolling to the very bottom leaves the last piece of
  // content clear of the bar. Measure the gap after a real scroll to the end.
  window.scrollTo(0, de.scrollHeight);
  await new Promise((r) => setTimeout(r, 350));
  const last = [...document.querySelectorAll("button, a, input, .card")]
    .filter((el) => !inBar(el) && el.getBoundingClientRect().height > 0)
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .sort((x, y) => y.r.bottom - x.r.bottom)[0];
  out.bottomPad = last ? Math.round(barTop - last.r.bottom) : null;
  if (last && last.r.bottom > barTop + 2)
    out.occluded.push((last.el.innerText || last.el.tagName).trim().slice(0, 40));
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 250));

  for (const el of document.querySelectorAll("button, a, input, [role=button]")) {
    if (inBar(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if ((el.tagName === "BUTTON" || el.getAttribute("role") === "button") && (r.height < 28 || r.width < 28))
      out.small.push({ t: (el.innerText || el.getAttribute("aria-label") || "?").trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) });
    if (el.tagName === "BUTTON") {
      const label = (el.innerText || "").trim() || el.getAttribute("aria-label") || el.getAttribute("title") || "";
      if (!label) out.unlabelled.push(String(el.className).slice(0, 40));
    }
    const fs = parseFloat(cs.fontSize);
    if (fs && fs < 10 && (el.innerText || "").trim()) out.tiny.push({ t: (el.innerText || "").trim().slice(0, 30), fs });
  }
  out.banner = /Not connected to World Chain/.test(document.body.innerText);
  return out;
`;


async function audit(name, acct, url = APP) {
  console.log(`\n[${name}]`);
  const b = await launch({ pk: acct.pk, url });
  await sleep(2800);
  await b.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>x.innerText.trim()==="Connect");if(e)e.click();return 1;})()`);
  await sleep(4500);
  const tabs = await b.ev(`return [...document.querySelectorAll(".tab-item")].filter(x=>x.offsetParent!==null).map(x=>x.innerText.trim());`);
  let issues = 0;
  for (const t of tabs) {
    await b.ev(`return (()=>{const e=[...document.querySelectorAll(".tab-item")].find(x=>x.innerText.trim().toLowerCase().includes(${JSON.stringify(t.toLowerCase())}));if(e)e.click();return 1;})()`);
    await sleep(1100);
    const r = await b.ev(`return (async()=>{ ${AUDIT} })()`);
    const msgs = [];
    if (r.overflow) msgs.push(`가로 넘침 ${r.overflow.scrollWidth}>${r.overflow.vw}`);
    if (r.occluded.length) msgs.push(`맨 아래에서도 탭바에 가림: ${r.occluded.slice(0, 2).join(", ")}`);
    if (r.bottomPad !== null && r.bottomPad < 8) msgs.push(`탭바 여백 ${r.bottomPad}px (최소 8 권장)`);
    if (r.small.length) msgs.push(`터치영역 작음 ${r.small.length}개: ${JSON.stringify(r.small.slice(0, 2))}`);
    if (r.unlabelled.length) msgs.push(`이름 없는 버튼 ${r.unlabelled.length}개`);
    if (r.tiny.length) msgs.push(`10px 미만 글자 ${r.tiny.length}개: ${JSON.stringify(r.tiny.slice(0, 2))}`);
    const body = await b.ev("return document.body.innerText;");
    if (body.trim().split("\n").filter((l) => l.trim()).length < 3) msgs.push("탭이 사실상 비어 있음");
    check(`${name} / ${t} 탭`, msgs.length === 0, msgs.join(" | ") || "이상 없음");
    issues += msgs.length;
    await b.shot(`${name}-${t}`.toLowerCase().replace(/[^a-z0-9-]/g, ""));
  }
  check(`${name}: 배너가 뜨지 않아야 한다(연결 정상)`, !(await b.ev(`return (async()=>{ ${AUDIT} })()`)).banner, "연결 배너 없음");
  await b.close();
  return issues;
}

// ── 상태 준비 ───────────────────────────────────────────────────
const owner = A.a4, heir = A.a5;
await tx(FACTORY, "createVault(address,uint256)", [heir.a, "86400"], owner);
const v = await vaultOf(owner.a);
await tx(WLD, "approve(address,uint256)", [FACTORY, E(5)], owner);
await tx(FACTORY, "deposit(uint256)", [E(5)], owner);

// 소유자: 활성 상태
await audit("owner-active", owner);
// 소유자: 만료 후 (아직 신청 없음)
await setTime((await now()) + 86401n * 2n);
await audit("owner-expired", owner);
// 소유자: 상속인이 신청한 상태
await tx(FACTORY, "fileClaimFor(address)", [v], heir);
await audit("owner-claimed", owner);
// 상속인: 이의제기 기간 중
await audit("heir-challenge", heir, `${APP}?vault=${v}`);
// 이의제기 기간 경과
await setTime((await now()) + 86401n * 8n);
await audit("heir-claimable", heir, `${APP}?vault=${v}`);
// 정산 + 잔액 회수 가능 상태
await tx(FACTORY, "finalizeClaimFor(address)", [v], heir);
await tx(WLD, "approve(address,uint256)", [v, E(2)], owner);
await tx(WLD, "transfer(address,uint256)", [v, E(2)], owner);
await audit("owner-settled-residue", owner);
// 금고 없는 사람
await audit("no-vault", A.a8);

console.log("\n════ 결과 ════");
if (bad.length) bad.forEach((x) => console.log("  FAIL  " + x));
console.log(`\n  통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
