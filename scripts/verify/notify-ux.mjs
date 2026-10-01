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
/* 헤딩을 제거했으므로 "Notifications on" 같은 문자열을 찾으면 안 된다. 무엇이 되고
   있는지를 말하는 문장으로 찾는다.

   문구를 특정 문구에 묶지 않는다 — 묶으면 문구가 바뀔 때마다 검사가 "위반" 으로
   알리지만 실제로는 개선인 경우도 있다. 예전 알림 권한 읽기 버그를 고치면서
   `unknown` → 실제 값(denied/off) 이 되면서 문구가 달라졌고, 이 정규식이 그걸
   "사라졌다" 고 읽었다. 상태 종류(꺼짐 / 막힘 / 미등록 / 미전달)만 확인한다. */
const STATES = [
  /Notifications are off/i,
  /World App is blocking notifications/i,
  /not being watched/i,
  /took the request/i,
  /and your heir get told/i,
];
const onVaultTab = STATES.some((r) => r.test(t));
check("Vault 탭에 알림 상태가 보인다", onVaultTab,
  onVaultTab ? (t.match(/[^\n]*(?:Notifications|nobody will be told)[^\n]*/i) || [""])[0].slice(0, 110)
             : "없음 — Help 탭에만 있다");

/* 아직 아무에게도 묻지 않은 지갑에게 "누가 알림을 막았다" 고 말하면 근거가 없다.
   MiniKit 2.x 는 "아직 요청 안 함" 과 "요청하고 거절당함" 을 구분해 주지 않는다
   (둘 다 notifications: false). 그래서 앱은 우리가 직접 물어봤는지를 따로 기억하고,
   물어보기 전에는 중립적인 문구를 쓴다. 여기서는 그 구분이 실제로 지켜지는지 본다. */
check("요청하지 않은 상태에서 '누가 막았다' 고 말하지 않는다",
  !/World App is blocking notifications/i.test(t),
  /World App is blocking notifications/i.test(t) ? "아직 묻지 않았는데 막혔다고 말한다" : "중립적 문구");

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
  // `sleep(5000)` 은 추측이고 여기서는 관측이 필요하다. 지갑 연결이 끝나기 전에
  // 폼이 mounts 되지 않으면 그 다음 줄 `s.call(null, …)` 이 예외를 던져, 이 단계가
  // "실패" 가 아니라 스크립트 크래시로 죽는다 — 어느 검사가 왜 죽었는지 로그에 안 남는다.
  check("금고 생성 폼이 나타난다", await c3.waitFor("#period-input"), `#period-input 대기 ${12000}ms`);
  const period = await c3.ev(`return (document.getElementById("period-input")||{}).value;`);
  check("금고가 없어도 주기 필드가 채워져 있다", !!period && period.length > 0, `값="${period}"`);
  check("상속인 입력창이 나타난다", await c3.waitFor("#heir-input"), "#heir-input");
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

log("\n[7] 처음 쓰는 사람이 금고를 만들기 전에 알림을 알게 되는가");
// 알림 안내를 Vault 탭에만 두면 안 된다. Vault 탭은 `needsVault` 이라 **금고가 없으면
// 보이지 않는다.** 처음 쓰는 사람은 기본 탭(Inherit)에서 금고를 만들 텐데, 알림을
// 그때 알려주지 않으면 존재를 모른 채 지나간다. 이 검사는 바로 그 경우를 본다.
{
  const fresh = await launch({ pk: A.a11.pk, url: APP });
  await sleep(2800);
  await fresh.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>x.innerText.trim()==="Connect");if(e)e.click();return 1;})()`);
  await sleep(5000);
  const tabs = await fresh.ev(`return [...document.querySelectorAll(".tab-item")].filter(x=>x.offsetParent!==null).map(x=>x.innerText.trim());`);
  check("금고가 없으면 Vault 탭이 보이지 않는다", !tabs.some((t) => /vault/i.test(t)),
    `탭: ${tabs.join(" | ")}`);
  check("그래도 알림 안내가 보인다 (보이는 탭 어딘가)",
    /Turn on notifications/i.test(await fresh.ev("return document.body.innerText;")),
    (await fresh.ev("return document.body.innerText;")).match(/[^\n]*Turn on notifications[^\n]*/i)?.[0] || "없음");
  // "Create vault" 바로 위에 있는가. 기하(좌표)로 재면 컨테이너 높이 따라 조상 찾기가
  // 뒤틀린다 — 앞선 두 판이 그랬다. **두 요소의 공통 조상 카드를 찾는 것**이 곧
  // "같은 카드" 다. 기하 없이 직접 답을 얻고, 순서만 좌표로 본다.
  const placement = await fresh.ev(`return (() => {
    const btn = [...document.querySelectorAll("button")].find((x) => /create vault/i.test(x.innerText));
    const leaf = [...document.querySelectorAll("div,span,p")].find(
      (d) => d.children.length === 0 && /^Turn on notifications/.test((d.innerText || "").trim()));
    if (!btn || !leaf) return { err: "missing", btn: !!btn, leaf: !!leaf };
    const chain = [];
    for (let n = leaf; n; n = n.parentElement) chain.push(n);
    const card = chain.find((n) => n.contains(btn));
    if (!card) return { err: "no common card" };
    const b = btn.getBoundingClientRect();
    // 카드 안에서 leaf 를 담는 가장 작은 박스를 찾는다.
    let box = null;
    for (const k of card.children) {
      if (!k.contains(leaf)) continue;
      const r = k.getBoundingClientRect();
      if (r.height > 0 && (!box || r.height < box.height)) box = r;
    }
    if (!box) return { err: "no note box" };
    return { sameCard: true, before: box.bottom <= b.top + 2, gap: Math.round(b.top - box.bottom) };
  })();`);
  check("금고 만들기 버튼과 같은 카드 안이다", !!placement && placement.sameCard === true,
    placement ? (placement.err || "같은 카드") : "측정 실패");
  check("버튼보다 **위에** 있다 (액션 전에 읽혀야 한다)", !!placement && placement.before === true,
    placement && placement.gap !== undefined ? `버튼 위 ${placement.gap}px` : "측정 실패");
  // "켜라" 고 말하면서 정상(초록) styling 이 붙으면 모순이다.
  const tone = await fresh.ev(`return (() => {
    const el = [...document.querySelectorAll("div")].find(
      (d) => /^Turn on notifications/.test((d.innerText || "").trim()) && d.className.indexOf("rounded") >= 0);
    if (!el) return "missing";
    return /bg-green-100/.test(el.className) ? "ok-tone" : /bg-yellow-50/.test(el.className) ? "warn-tone" : "plain";
  })();`);
  check("'켜라'고 말할 때는 경고 톤이다", tone === "warn-tone", `톤 ${tone}`);
  check("알림이 잔액 0 일 때는 간다고 말하지 않는다",
    /Notices start once the vault holds WLD/i.test(await fresh.ev("return document.body.innerText;")),
    (await fresh.ev("return document.body.innerText;")).match(/[^\n]*Notices start[^\n]*/i)?.[0] || "없음");
  await fresh.shot("notify-first-run");
  await fresh.close();
}

log("\n[8] 상속인 카드는 결과가 있을 때만 첫 화면에 나온다");
// 앞선 커밋에서 상속인 카드를 맨 위로 올렸다. 그건 "상속인이 이 앱을 여는 이유니까"
// 였는데 — 스캔 결과가 있을 때만 성립하는 이야기다. 결과가 없으면 "No vault names you
// as heir" 카드가 그대로 남고, 아무것도 안 한 사람에게 "당신이 상속인일 수 있습니다" 를
// 말한 뒤 "아니오" 라고 답하는 셈이다. 정작 할 일(금고 만들기)은 화면 아래로 밀린다.
{
  const plain = await launch({ pk: A.a11.pk, url: APP });
  await sleep(2800);
  await plain.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>x.innerText.trim()==="Connect");if(e)e.click();return 1;})()`);
  await sleep(6500);
  const t = await plain.ev("return document.body.innerText;");
  check("스캔 결과가 없으면 첫 화면에 상속인 카드가 없다",
    !/Are you named as someone/i.test(t), /Are you named as someone/i.test(t) ? "나오고 있다" : "없음");
  check("\'아니오\' 라는 답도 화면에 남지 않는다", !/No vault names you as heir/i.test(t),
    /No vault names you as heir/i.test(t) ? "남아 있다" : "없음");
  // 수동 재확인은 Help 탭에 남겨 둔다 — 통째로 버리면 안 된다.
  await plain.ev(`return (()=>{const e=[...document.querySelectorAll(".tab-item")].find(x=>/help/i.test(x.innerText));if(e)e.click();return 1;})()`);
  await sleep(1200);
  const th = await plain.ev("return document.body.innerText;");
  check("Help 탭에서 다시 확인할 수 있다", /Named as an heir/i.test(th) && /Check again/i.test(th),
    /Named as an heir/i.test(th) ? "카드 있음" : "없음");
  await plain.close();
}

log("\n[9] 진짜 상속인에게는 여전히 첫 화면에 보여야 한다");
// 위 조건을 걸면 "결과가 있으면 보여라" 만 남는다. 그것이 실제로 성립하는지 확인한다 —
// 이 카드가 없으면 상속인은 자기 신청권을 발견하지 못한다.
{
  // 소유자를 직접 고르는 건 신뢰할 수 없다 — 앞 단계([6])가 이미 a10 에 금고를
  // 만들어 놔서 createVault 가 AlreadyHasVault 로 revert 하고, 지정한 상속인은
  // 아무것도 아닌 계정이었다(실제로 그랬다). 체인에서 실제 상속인을 **읽어** 쓴다.
  const ownerAddr = A.a10.a;
  const v = cast(["call", FACTORY, `vaultOf(address)(address)`, ownerAddr, "--rpc-url", "http://127.0.0.1:8546"]);
  if (v === "0x" + "0".repeat(40)) { console.log("    a10 에 금고가 없다 — [9] 건너뜀"); }
  const realHeir = cast(["call", v, "heir()(address)", "--rpc-url", "http://127.0.0.1:8546"]);
  const heirAcct = Object.values(A).find((x) => x.a.toLowerCase() === realHeir.toLowerCase());
  log(`    금고 ${v.slice(0, 12)}… 실제 상속인 ${realHeir}`);
  if (!heirAcct) { console.log("    상속인 키를 찾을 수 없다 — [9] 건너뜀"); }
  const heir = heirAcct ? await launch({ pk: heirAcct.pk, url: APP }) : null;
  if (heir) {
  await sleep(2800);
  await heir.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>x.innerText.trim()==="Connect");if(e)e.click();return 1;})()`);
  await sleep(9000);
  const th = await heir.ev("return document.body.innerText;");
  check("상속인에게는 상속인 카드가 보인다", /Are you named as someone/i.test(th),
    (th.match(/[^\n]*You are the heir of[^\n]*/i) || ["(없음)"])[0].slice(0, 80));
  // 개수는 정확히 1 이 아닐 수 있다 — 이 파일 앞부분이 a4/a9 금고도 만들어 둔다.
  // 중요한 건 "몇 개인지" 를 말하는지 여부다.
  check("몇 개인지 알려준다", /You are the heir of \d+ vault/i.test(th),
    (th.match(/You are the heir of[^\n]*/i) || ["(없음)"])[0]);
  await heir.shot("notify-real-heir");
  }
  if (heir) await heir.close();
}

log("\n[10] 'Turn on notifications' 를 누르면 화면이 실제로 바뀌는가");

/* 이 검사가 없으면 알림 UX 의 핵심 버그를 못 잡는다.
   실제로 있었던 일: MiniKit 2.x 는 권한을 {executedWith, data:{permissions}} 로
   감싸서 돌려주는데 앱은 최상위 permissions 를 읽었다. 거기엔 없으므로 값이 항상
   undefined 였고 앱은 영영 "꺼짐" 이라고 말했다. 그런데 그 상태에서도 "Turn on
   notifications" 를 누르면 **성공 토스트가 떴다** — 사용자는 켠 줄 알고 화면은
   "꺼짐" 그대로였다. 하네스는 그 버튼을 한 번도 누른 적이 없었다.
   그래서 (1) 누르기 전 상태를 기억하고 (2) 누르고 (3) 상태가 실제로 바뀌었는지 본다. */
/* 금고가 있는 계정이어야 한다. 금고가 없으면 Vault 탭의 알림 줄이 아예 렌더링되지
   않으므로(잔액 0 기준) 전제 조건이 없는 검사가 되어 통과가 아무 의미가 없어진다.
   a4 는 이 파일 맨 앞에서 금고를 만든 계정이다. 이 단계 앞의 [5] 에서 `b`(=a4)를
   이미 닫아 놨으므로 여기서 새로 띄운다. */
const perm = await launch({ pk: A.a4.pk, url: APP });
await sleep(2800);
await perm.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>x.innerText.trim()==="Connect");if(e)e.click();return 1;})()`);
await sleep(6000);
await perm.ev(`return (()=>{const e=[...document.querySelectorAll(".tab-item")].filter(x=>x.offsetParent!==null).find(x=>x.innerText.trim().toLowerCase().includes("vault"));if(e)e.click();return 1;})()`);
await sleep(1500);
const before = await perm.ev("return document.body.innerText;");
const wasBlocked = /World App is blocking notifications/i.test(before);
const wasOff = /Notifications are off/i.test(before);
check("누르기 전에는 알림이 꺼짐/막힘 으로 보인다", wasOff || wasBlocked,
    wasBlocked ? "이미 막힘" : wasOff ? "꺼짐" : "표시 없음");

/* 라벨이 두 곳에 있다 — Vault 탭의 조용한 고침 버튼은 "Turn on", 금고 생성 카드와
   Help 탭은 "Turn on notifications". 어느 쪽이든 고쳐야 하는 동작이 같으므로 둘 다
   찾는다. */
const clicked = await perm.ev(`return (()=>{
  const btn=[...document.querySelectorAll("button")].find(x=>/^turn on( notifications)?$/i.test(x.innerText.trim()) && !x.disabled);
  if(!btn) return false; btn.click(); return true;
})()`);
check("알림 켜기 버튼을 누를 수 있다", clicked === true, clicked === true ? "눌렀다" : "버튼 없음/비활성");

await sleep(3500);
const after = await perm.ev("return document.body.innerText;");
  const stillBroken = /World App is blocking notifications/i.test(after);
  check("누른 뒤 화면이 '꺼짐/막힘' 에서 벗어나야 한다", !(stillBroken || /Notifications are off/i.test(after)),
    stillBroken ? "여전히 막힘이라고 표시" : /Notifications are off/i.test(after) ? "여전히 꺼짐이라고 표시" : "바뀜");

  /* 성공 토스트를 띄웠다면 그것이 거짓말이 아니어야 한다. 예전에는 호출이 예외 없이
     끝났다는 사실만으로 "enabled" 를 말했는데, MiniKit 2.x 는 거절도 throw 하지 않고
     결과로 돌려줄 수 있다. */
const claimed = /Notifications are on for this wallet/i.test(after);
const truthy = !/Notifications are off/i.test(after) && !/World App is blocking/i.test(after);
check("'켜짐' 토스트는 실제 상태와 일치한다", !claimed || truthy,
    claimed ? (truthy ? "켜짐=true, 화면도 켜짐" : "켜짐이라 했지만 화면은 꺼짐 — 거짓말") : "켜짐 토스트 없음");
await perm.shot("notify-permission-roundtrip");
await perm.close();


log(`\n  통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
