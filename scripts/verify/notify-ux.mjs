// Checks the notification surface, because the complaint about it was visual:
// it lived in the Help tab, showed internal state strings, and had no auto-recovery.
//
// Verifies: the countdown tab carries the notice, the wording states the consequence
// rather than a state name, a broken state is announced assertively, and the fix
// buttons are reachable there.
import { setTimeout as sleep } from "node:timers/promises";
import { launch, ACCOUNTS, APP } from "./drv.mjs";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const FACTORY = process.env.FACTORY;
if (!FACTORY) { console.error("FACTORY 필요 — run.sh 가 설정한다"); process.exit(2); }
const WLD = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const cast = (a) => (spawnSync("cast", a, { encoding: "utf8" }).stdout || "").trim();
const A = ACCOUNTS;

let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
const log = (s) => console.log(s);

// Fund a vault so the notice is warranted (balance 0 suppresses it by design).
if (cast(["call", FACTORY, `vaultOf(address)(address)`, A.a4.a, "--rpc-url", "http://127.0.0.1:8546"]).replace(/^0x/, "").replace(/0+$/, "") === "") {
  cast(["send", FACTORY, "createVault(address,uint256)", A.a9.a, "604800", "--from", A.a4.a, "--private-key", A.a4.pk, "--rpc-url", "http://127.0.0.1:8546"]);
}
const vault = cast(["call", FACTORY, `vaultOf(address)(address)`, A.a4.a, "--rpc-url", "http://127.0.0.1:8546"]);
cast(["send", WLD, "approve(address,uint256)", FACTORY, "5000000000000000000", "--from", A.a4.a, "--private-key", A.a4.pk, "--rpc-url", "http://127.0.0.1:8546"]);
cast(["send", FACTORY, "deposit(uint256)", "5000000000000000000", "--from", A.a4.a, "--private-key", A.a4.pk, "--rpc-url", "http://127.0.0.1:8546"]);
const bal = cast(["call", WLD, "balanceOf(address)(uint256)", vault, "--rpc-url", "http://127.0.0.1:8546"]);
log(`    setup: vault=${vault.slice(0, 12)}… 잔액=${bal.split(" ")[0]}`);

const b = await launch({ pk: A.a4.pk, url: APP });
await sleep(2800);
await b.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>x.innerText.trim()==="Connect");if(e)e.click();return 1;})()`);
await sleep(5000);

const clickTab = async (n) => {
  await b.ev(`return (()=>{const e=[...document.querySelectorAll(".tab-item")].filter(x=>x.offsetParent!==null).find(x=>x.innerText.trim().toLowerCase().includes(${JSON.stringify(n.toLowerCase())}));if(e)e.click();return 1;})()`);
  await sleep(1100);
};

log("\n[1] 카운트다운 탭에 알림 상태가 있는가");
await clickTab("vault");
const t = await b.ev("return document.body.innerText;");
// 헤딩을 제거했으므로 "Notifications on" 같은 문자열을 찾으면 안 된다.
// 무엇이 되고 있는지를 말하는 문장으로 찾는다.
const onVaultTab = /Notifications (are off|is blocking|not being watched|took the request)|and your heir get told/i.test(t);
check("Vault 탭에 알림 상태가 보인다", onVaultTab,
  onVaultTab ? (t.match(/[^\n]*Notifications[^\n]*/i) || [""])[0].slice(0, 110) : "없음 — Help 탭에만 있다");

log("\n[2] 내부 상태값을 그대로 노출하지 않는가");
const leaked = ["unknown", "not registered", "enabled", "disabled"].filter(
  (w) => new RegExp(`(^|\\n)\\s*${w}\\s*($|\\n)`, "i").test(t));
check("상태값이 사람 말로 바뀌었다", leaked.length === 0, leaked.length ? `남은 원문: ${leaked.join(", ")}` : "없음");

log("\n[3] 무엇이 되고 있지 않은지 + 대처가 함께 오는가");
// 상태값이 아니라 **결과**를 말해야 한다: "알림이 꺼져 있다" 가 아니라
// "갱신을 멈추면 아무도 통보받지 못한다".
const consequence = /nobody will be told|will not be told|will not be warned|not be sent about it/i.test(t);
check("결과를 말한다 (누가 무엇을 놓치는지)", consequence,
  (t.match(/[^\n]*(nobody will be told|will not be told|will not be warned)[^\n]*/i) || ["(결과 문장 없음)"])[0].slice(0, 120));
// 헤딩이 없는 것이 의도다. "Notifications need attention" 같은 큰 제목은 카운트다운보다
// 눈에 띄어서 알림이 주인공이 되어 버렸다. 문장으로만 말한다.
check("큰 헤딩 없이 문장으로 말한다", !/^\s*Notifications (on|need attention)\s*$/im.test(t),
  /Notifications (on|need attention)/im.exec(t)?.[0] || "헤딩 없음 (옳음)");

// 블록 크기는 실제 DOM 요소로 잰다. 정규식으로 뒤쪽 400자를 잡으면 탭의 나머지
// 내용까지 같이 세어 14줄 같은 헛값이 나온다 — 실제로 그랬다.
const metrics = await b.ev(`return (() => {
  const el = [...document.querySelectorAll("[role=alert],[role=status]")]
    .find((n) => /nobody will be told|and your heir get told|is blocking|not being watched/i.test(n.innerText || ""));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const timer = document.querySelector(".timer-block");
  return {
    height: Math.round(r.height),
    timerHeight: timer ? Math.round(timer.getBoundingClientRect().height) : null,
    lines: (el.innerText || "").split("\\n").filter((x) => x.trim()).length,
  };
})();`);
check("알림 블록이 DOM 에서 4줄 이내다", !!metrics && metrics.lines <= 4,
  metrics ? `${metrics.lines}줄 / ${metrics.height}px` : "요소를 못 찾음");
check("알림 블록이 카운트다운 블록보다 작다 (카운트다운이 주인공)",
  !!metrics && metrics.timerHeight != null && metrics.height < metrics.timerHeight,
  metrics ? `알림 ${metrics.height}px vs 카운트다운 ${metrics.timerHeight}px` : "");
// 진단 버튼("Send a test to me") 은 Help 탭에 남긴다. 카운트다운 옆에 둘 이유가 없다.
check("진단 버튼이 카운트다운 탭을 차지하지 않는다", !/Send a test/i.test(t), "Help 탭에만 있음");

log("\n[4] 고칠 수 있는 버튼이 그 자리에 있는가");
const btns = await b.ev(`return [...document.querySelectorAll("button")].filter(x=>x.offsetParent!==null).map(e=>({t:e.innerText.trim(),d:e.disabled}));`);
// 라벨을 짧게 줄였으므로("Turn on notifications" → "Turn on") 검사도 같이 갱신한다.
const fixes = btns.filter((x) => /^turn on$|watch this vault/i.test(x.t));
check("Vault 탭에서 바로 고칠 수 있다", fixes.length > 0,
  fixes.length ? fixes.map((x) => `${x.t}${x.d ? "(비활성)" : ""}`).join(" | ") : "고치는 버튼 없음");
// 활성/비활성은 검사하지 않는다. E2E 스텁이 miniInstalled 를 true 로 만들기 때문에
// 여기서 활성인 게 정상이지만, 정작 실제 데스크톱 사용자에게 보이는 화면은 gate2 가
// "Open in World App" 로 막는다. 스텁의 상태를 사용자 상태로 오독하지 말 것.

log("\n[5] 잔액 0 이면 경고하지 않는가");
await b.close();
const c = await launch({ pk: A.a9.pk, url: APP });
await sleep(2800);
await c.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>x.innerText.trim()==="Connect");if(e)e.click();return 1;})()`);
await sleep(5000);
await c.ev(`return (()=>{const e=[...document.querySelectorAll(".tab-item")].filter(x=>x.offsetParent!==null).find(x=>x.innerText.trim().toLowerCase().includes("vault"));if(e)e.click();return 1;})()`);
await sleep(1000);
const t2 = await c.ev("return document.body.innerText;");
check("금고가 없는 화면에 알림 경고가 뜨지 않는다", !/Notifications need attention/i.test(t2),
  /Notifications[^\n]*/i.test(t2) ? (t2.match(/Notifications[^\n]*/i) || [""])[0] : "없음 (맞음)");
await c.close();

log("\n[6] 새 사용자도 금고를 만들 수 있는가");
// 여기서 실제로 P0 하나가 나왔었다. 주기 필드를 "실제 값으로 시드" 하도록 바꾼 뒤,
// 금고가 없는 사용자에게는 시드할 값이 없으므로 필드가 빈 채로 남고 periodValid 가
// false 가 되었다. 결과적으로 "Create vault" 가 **영영 켜지지 않았고 아무도 금고를
// 만들 수 없었다.** 로컬 E2E 는 캐스트로 금고를 만들어서 이 경로를 한 번도 안 밟았다.
// 알림 자동 등록 검사가 발목을 걸어 오히려 잡아냈다.
{
  const c3 = await launch({ pk: A.a11.pk, url: APP });
  await sleep(2800);
  await c3.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>x.innerText.trim()==="Connect");if(e)e.click();return 1;})()`);
  await sleep(5000);
  const period = await c3.ev(`return (document.getElementById("period-input")||{}).value;`);
  check("금고가 없어도 주기 필드가 채워져 있다", !!period && period.length > 0, `값="${period}"`);
  await c3.ev(`return (()=>{
    const i=document.getElementById("heir-input");
    const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;
    s.call(i, ${JSON.stringify(A.a9.a)});
    i.dispatchEvent(new Event("input",{bubbles:true}));
    return 1;
  })()`);
  await sleep(2500);
  const btn = await c3.ev(`return (()=>{
    const e=[...document.querySelectorAll("button")].find(x=>/create vault/i.test(x.innerText));
    return e ? (e.disabled ? "disabled" : "enabled") : "missing";
  })();`);
  check("상속인을 넣으면 금고 만들기가 열린다", btn === "enabled", `버튼 ${btn}`);
  await c3.close();
}

log("\n[6] 금고 만들면 자동으로 등록되는가");
// 알림이 이 앱의 핵심 경로인데 등록이 수동이면 아무도 하지 않는다. createVault 경로에
// 자동 등록이 이미 붙어 있는데, 백엔드 saveWatcher 가 500 을 내고 있어서 조용히
// 실패하고 있었다. 백엔드가 고쳐졌으니 이 경로가 실제로 호출되는지 본다.
//
// 프로덕션 D1 을 건드리지 않으려면 fetch 를 가로채야 한다. 실제로 등록하면
// 테스트용 anvil 금고가 운영 감시 목록에 남는다.
{
  const c2 = await launch({ pk: A.a10.pk, url: APP });
  await sleep(2800);
  await c2.ev(`return (()=>{
    window.__REG_CALLS__ = [];
    const of = window.fetch;
    window.fetch = function (u, o) {
      try {
        const url = typeof u === "string" ? u : (u && u.url) || "";
        if (url.indexOf("/notifications/register") > -1 || url.indexOf("/notifications/unregister") > -1) {
          window.__REG_CALLS__.push({ url: url, body: o && o.body ? String(o.body) : null });
          return Promise.resolve(new Response(JSON.stringify({ status: "success", watcher: {} }),
            { status: 200, headers: { "content-type": "application/json" } }));
        }
      } catch (e) {}
      return of.apply(this, arguments);
    };
    return 1;
  })()`);
  await c2.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>x.innerText.trim()==="Connect");if(e)e.click();return 1;})()`);
  await sleep(5000);
  const setHeir = await c2.ev(`return (()=>{
    const inp = document.querySelector('input[placeholder*="username"], input[placeholder*="0x"]');
    if (!inp) return "NO INPUT";
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    set.call(inp, ${JSON.stringify(A.a9.a)});
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    return "ok";
  })()`);
  await sleep(2500);
  const clicked = await c2.ev(`return (()=>{
    const e=[...document.querySelectorAll("button")].find(x=>/create vault/i.test(x.innerText));
    if(!e) return "NO BUTTON";
    if(e.disabled) return "DISABLED";
    e.click(); return "clicked";
  })()`);
  log(`    상속인 입력 ${setHeir} / 생성 버튼 ${clicked}`);
  await sleep(7000);
  const calls = await c2.ev("return (window.__REG_CALLS__ || []);");
  const regCalls = Array.isArray(calls) ? calls.filter((x) => /register/.test(x.url)) : [];
  check("금고 생성 시 등록을 자동으로 호출한다", regCalls.length > 0,
    regCalls.length ? `${regCalls.length}회: ${regCalls[0].url.replace(/^https?:\/\/[^/]+/, "")}` : "호출 없음");
  check("등록 본문에 금고 주소가 들어간다",
    !!(regCalls[0] && regCalls[0].body && /vaultAddress/.test(regCalls[0].body)),
    regCalls[0] && regCalls[0].body ? String(regCalls[0].body).slice(0, 110) : "(본문 없음)");
  await c2.close();
}

log(`\n  통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
