// Checks the notification surface across the unified-plan overview, selected-vault
// Inherit details, and the new-plan form.
import { setTimeout as sleep } from "node:timers/promises";
import { launch, ACCOUNTS, APP } from "./drv.mjs";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const FACTORY = process.env.FACTORY;
if (!FACTORY) { console.error("FACTORY 필요 — run.sh 가 설정한다"); process.exit(2); }
const WLD = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const cast = (a) => (spawnSync("cast", a, { encoding: "utf8" }).stdout || "").trim();

/**
 * `cast send` 를 실행하고 성공했는지 알려준다. **stderr 도 함께 본다.**
 *
 * `cast` 은 revert 면 에러를 **stderr** 에 쓰고 stdout 은 비운다(성공이면 `0x`).
 * stdout 만 잡는 함수는 실패를 "빈 문자열" 로 돌려주고, 실패인지 성공인지 구분할
 * 방법이 없다. 예전 `cast` 그대로 쓴 정리 코드가 **조용히 실패**해서 슬롯이 남아
 * 있었고, 뒤따르는 검사가 "금고가 없는데 문장이 없다" 는 전혀 다른 증상으로 보였다.
 * 원인과 증상이 다른 곳 — 디버깅 시간이 그 대가다.
 */
const castSend = (a) => {
  const r = spawnSync("cast", a, { encoding: "utf8" });
  const both = `${r.stdout || ""} ${r.stderr || ""}`;
  return { out: (r.stdout || "").trim(), err: (r.stderr || "").trim(), ok: !/revert|error|panic|Error/i.test(both) };
};
const A = ACCOUNTS;

// Keep notification reads and writes inside this browser fixture. In particular,
// registration must never add an Anvil vault to the production watcher list.
const LOCAL_NOTIFY_FIXTURE = `
  const networkFetch = window.fetch.bind(window);
  window.__NOTIFY_REQUESTS__ = [];
  window.__NOTIFY_WATCHERS__ = {};
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.origin);
    if (url.pathname === "/api/automation/health") return Response.json({ automation: {
      enabled: true, supported: true, funded: true, halted: false, reason: "ready" } });
    if (url.pathname === "/api/notifications") return Response.json({ status: "success", watchers: [], nextCursor: null });
    if (url.pathname === "/api/notifications/status") {
      const vault = (url.searchParams.get("vaultAddress") || "").toLowerCase();
      return Response.json({ status: "success", watcher: window.__NOTIFY_WATCHERS__[vault] ? { active: true } : null });
    }
    if (url.pathname === "/api/notifications/register" || url.pathname === "/api/notifications/unregister") {
      const body = typeof init?.body === "string" ? init.body : "{}";
      const data = JSON.parse(body);
      window.__NOTIFY_REQUESTS__.push({ path: url.pathname, body });
      const vault = (data.vaultAddress || "").toLowerCase();
      if (url.pathname.endsWith("/register")) window.__NOTIFY_WATCHERS__[vault] = true;
      else delete window.__NOTIFY_WATCHERS__[vault];
      return Response.json({ status: "success", watcher: { active: url.pathname.endsWith("/register") } });
    }
    if (url.pathname === "/api/notifications/test") return Response.json({ status: "success", result: { sent: false } });
    return networkFetch(input, init);
  };
`;

async function waitUntil(read, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await read()) return true;
    await sleep(200);
  }
  return false;
}

async function setInput(page, id, value) {
  return page.ev(`return (() => {
    const input = document.getElementById(${JSON.stringify(id)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })();`);
}

let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };
const log = (s) => console.log(s);

// Fund an active own plan so the wallet-permission overview row is warranted.
//
// **앞 단계가 남긴 금고를 그대로 쓰면 안 된다.** run.sh 는 체인을 한 번만 만들고
// 8단계를 순서대로 돌린다. 그 중 UX 감사(ux2.mjs) 단계는 anvil 시간을 **앞으로
// 보낸다. 이 fixture 는 a4 의 기존 vault 와 잔액을 정리한 뒤 새 활성 plan 을 만든다.
//
// 다른 단계들이 이미 쓰고 있는 방법(잔액 회수 → 슬롯 해제)으로 정리한 뒤 새로 만든다.
const RPC = "http://127.0.0.1:8546";
const ZERO = "0x0000000000000000000000000000000000000000";
const castUint = (a) => {
  const s = cast(a);
  const m = s.match(/^\s*(\d+)/);
  return m ? BigInt(m[1]) : 0n;
};
const sendOk = (a) => castSend(a);

function emptySlot(addr) {
  // `cast call` 은 32바이트 반환값이라 "0x" + 64 hex(=66자) 다. 40자 정규식에 그대로
  // 넣으면 **항상 실패**하고, "금고 없음" 이라 여기고 정리 없이 넘어간다. 첫 구현이
  // 그랬고, 그래서 앞 단계가 남긴 정산 금고가 그대로였다.
  const raw = cast(["call", FACTORY, `vaultOf(address)(address)`, addr, "--rpc-url", RPC]);
  const hex = raw.replace(/^0x/, "").padStart(64, "0");
  const a = /^0x[0-9a-fA-F]{40}$/.test(raw) ? `0x${raw.slice(-40)}`
    : /^0x[0-9a-fA-F]{64}$/.test(raw) ? `0x${hex.slice(24)}`
    : ZERO;
  console.log(`  정리 대상: vaultOf=${a}`);
  if (a === ZERO) return;
  const bal = castUint(["call", WLD, "balanceOf(address)(uint256)", a, "--rpc-url", RPC]);
  if (bal > 0n) {
    // **정산된 금고의 WLD 는 `rescueFromMyVault` 가 아니라 `sweepSettledVaultFor` 다.**
    // `ownerRescueUnknownERC20` 은 이름 그대로 **모르는 토큰** 회수용이고 WLD 를 받지
    // 않는다. 앞 단계(ux2)가 정산 후 잔액 2 WLD 를 남겨 두고, 여기서 엉뚱한 함수를
    // 불러 revert → 슬롯이 안 빠짐 → "금고가 없는데 문장이 없다" 라는 전혀 다른
    // 증상으로 나타났다. 앱의 "Sweep … to me" 버튼이 부르는 것이 이 함수다.
    const isSettled = cast(["call", a, "isSettled()(bool)", "--rpc-url", RPC]) === "true";
    const r = isSettled
      ? castSend(["send", FACTORY, "sweepSettledVaultFor(address)", addr,
          "--from", addr, "--private-key", A.a4.pk, "--rpc-url", RPC])
      : castSend(["send", FACTORY, "rescueFromMyVault(address,uint256,address)", WLD, bal.toString(), addr,
          "--from", addr, "--private-key", A.a4.pk, "--rpc-url", RPC]);
    if (!r.ok) console.log(`  (WLD 회수 실패: ${r.err.slice(0, 110)})`);
    else console.log(`  정산 후 잔액 회수: ${isSettled ? "sweepSettledVaultFor" : "rescueFromMyVault"} (${bal} WLD wei)`);
  }
  const eth = castUint(["call", a, "balance()(uint256)", "--rpc-url", RPC]);
  if (eth > 0n) {
    const r = castSend(["send", a, "sweepEth(address)", addr, "--from", addr, "--private-key", A.a4.pk, "--rpc-url", RPC]);
    if (!r.ok) console.log(`  (ETH 회수 실패: ${r.err.slice(0, 110)})`);
  }
  const rel = castSend(["send", FACTORY, "releaseMyVault()", "--from", addr, "--private-key", A.a4.pk, "--rpc-url", RPC]);
  if (!rel.ok) console.log(`  (슬롯 해제 실패: ${rel.err.slice(0, 110)})`);
  const after = cast(["call", FACTORY, `vaultOf(address)(address)`, addr, "--rpc-url", RPC]);
  console.log(`  정리 후 vaultOf = ${after || "(빈 응답)"}`);
}

emptySlot(A.a4.a);
cast(["send", FACTORY, "createVault(address,uint256)", A.a9.a, "604800", "--from", A.a4.a, "--private-key", A.a4.pk, "--rpc-url", RPC]);
const vault = cast(["call", FACTORY, `vaultOf(address)(address)`, A.a4.a, "--rpc-url", "http://127.0.0.1:8546"]);
cast(["send", WLD, "approve(address,uint256)", FACTORY, "5000000000000000000", "--from", A.a4.a, "--private-key", A.a4.pk, "--rpc-url", "http://127.0.0.1:8546"]);
cast(["send", FACTORY, "deposit(uint256)", "5000000000000000000", "--from", A.a4.a, "--private-key", A.a4.pk, "--rpc-url", "http://127.0.0.1:8546"]);
const bal = cast(["call", WLD, "balanceOf(address)(uint256)", vault, "--rpc-url", "http://127.0.0.1:8546"]);
log(`    setup: vault=${vault.slice(0, 12)}… 잔액=${bal.split(" ")[0]}`);

const b = await launch({ pk: A.a4.pk, url: APP, preload: LOCAL_NOTIFY_FIXTURE });
await sleep(2800);
await b.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>/^(Connect|Continue with World App)$/.test(x.innerText.trim()));if(e)e.click();return 1;})()`);
await sleep(5000);

const clickTab = async (n) => {
  await b.ev(`return (()=>{const e=[...document.querySelectorAll(".tab-item")].filter(x=>x.offsetParent!==null).find(x=>x.innerText.trim().toLowerCase().includes(${JSON.stringify(n.toLowerCase())}));if(e)e.click();return 1;})()`);
  await sleep(1100);
};

log("\n[1] funded own-plan overview shows wallet permission and its actions");
await clickTab("home");
await b.waitFor(".plan-overview-reminders");
const overview = await b.ev("return document.querySelector('.plan-overview-card')?.innerText || ''; ");
const reminder = await b.ev(`return (() => {
  const row = document.querySelector('.plan-overview-reminders');
  if (!row) return null;
  const r = row.getBoundingClientRect();
  const assets = document.querySelector('.plan-overview-assets')?.getBoundingClientRect();
  const next = document.querySelector('.home-checkin-date')?.getBoundingClientRect();
  return {
    text: row.innerText || '', visible: r.width > 0 && r.height > 0,
    lines: (row.innerText || '').split("\\n").filter(line => line.trim()).length,
    height: Math.round(r.height), primaryHeight: Math.round((assets?.height || 0) + (next?.height || 0)),
    hasHeading: !!row.querySelector('h1,h2,h3'),
    buttons: [...row.querySelectorAll('button,a')].map(el => ({ text: el.textContent.trim(), disabled: !!el.disabled }))
  };
})();`);
check("funded owner sees the own-plan overview and next check-in", /Your inheritance plan/i.test(overview)
  && /Next check-in/i.test(overview),
  overview.split("\n").filter(line => /inheritance plan|Next check-in/i.test(line)).join(" / ") || "overview missing");
check("overview states this wallet's notification permission", !!reminder && reminder.visible
  && /Notifications are off|Notifications are on for this wallet/i.test(reminder.text),
  reminder ? reminder.text.slice(0, 140) : "plan reminder row missing");
check("wallet permission is not presented as vault monitoring or delivery", !!reminder
  && !/reminders are enabled|delivery enabled|monitoring enabled|(?:all|every) (?:of your )?(?:active )?vaults?.{0,35}(?:monitor|watch|reminder|notify)|(?:monitor|watch|reminder|notify).{0,35}(?:all|every) (?:of your )?(?:active )?vaults?/i.test(reminder.text),
  reminder?.text.slice(0, 140) || "plan reminder row missing");
check("overview reminder controls are present", !!reminder
  && reminder.buttons.some(button => button.text === "Enable reminders" && !button.disabled)
  && reminder.buttons.some(button => button.text === "Reminder settings"),
  reminder?.buttons.map(button => `${button.text}${button.disabled ? "(disabled)" : ""}`).join(" | ") || "no controls");
check("reminder row stays visually subordinate to the plan overview", !!reminder
  && reminder.lines <= 4 && reminder.height < reminder.primaryHeight && !reminder.hasHeading,
  reminder ? `${reminder.lines} lines; ${reminder.height}px vs primary ${reminder.primaryHeight}px` : "row missing");

await b.ev("const details = document.querySelector('.plan-overview-reminders details'); if (details && !details.open) details.querySelector('summary').click(); return true;");
const reminderSettings = await b.ev(`return (() => {
  const row = document.querySelector('.plan-overview-reminders');
  const control = [...(row?.querySelectorAll('button,a') || [])].find(el => el.innerText.trim() === 'Reminder settings');
  if (!control || control.disabled) return false;
  control.click(); return true;
})();`);
await sleep(900);
const helpTab = await b.ev("return document.querySelector('.tab-item-active')?.innerText.trim() || ''; ");
check("Reminder settings opens Help", reminderSettings && /Help/i.test(helpTab), helpTab || "Help tab not selected");

log("\n[2] overview permissions do not leak backend state or delivery claims");
await clickTab("home");
const rowText = await b.ev("return document.querySelector('.plan-overview-reminders')?.innerText || ''; ");
const leaked = ["unknown", "not_registered", "not registered", "enabled", "disabled"].filter(
  word => new RegExp(`(^|\\n)\\s*${word}\\s*($|\\n)`, "i").test(rowText));
check("backend state values are not exposed", leaked.length === 0, leaked.length ? leaked.join(", ") : "none");

log("\n[3] selected-vault reminder detail stays with Inherit");
await clickTab("plan");
await b.waitFor(".automation-note");
const detail = await b.ev(`return (() => {
  const notice = document.querySelector('.automation-note');
  const selected = [...document.querySelectorAll('[role=alert],[role=status]')]
    .find(el => /Notifications are off|Notifications are on for this wallet/i.test(el.innerText || ''));
  const monitor = [...(notice?.querySelectorAll('button') || [])].find(button => button.innerText.trim() === 'Enable vault monitoring');
  return { notice: notice?.innerText || '', selected: selected?.innerText || '', monitor: !!monitor && !monitor.disabled };
})();`);
check("selected-vault notification detail remains in Inherit", !!detail && /Notifications are off/i.test(detail.selected)
  && /Enable monitoring so this vault/i.test(detail.notice),
  detail ? `${detail.selected.slice(0, 80)} / ${detail.notice.split("\n")[0]}` : "selected-vault details missing");
check("selected-vault monitoring action remains available separately", !!detail?.monitor,
  detail?.monitor ? "Enable vault monitoring" : "monitor action missing/disabled");
const monitorClick = await b.ev(`return (() => {
  const button = [...(document.querySelector('.automation-note')?.querySelectorAll('button') || [])]
    .find(el => el.innerText.trim() === 'Enable vault monitoring');
  if (!button || button.disabled) return false;
  button.click(); return true;
})();`);
const monitoringReady = await waitUntil(() => b.ev("return /Automatic transfer is enabled/i.test(document.querySelector('.automation-note')?.innerText || '');"));
const watchRequests = await b.ev("return window.__NOTIFY_REQUESTS__ || []; ");
check("selected-vault action registers only its selected vault", monitorClick && monitoringReady
  && watchRequests.some(call => call.path === "/api/notifications/register" && /vaultAddress/.test(call.body)),
  watchRequests.map(call => call.path).join(" | ") || "no local watcher request");

log("\n[4] no funded plan means no funded-plan permission row");
await b.close();
const c = await launch({ pk: A.a9.pk, url: APP, preload: LOCAL_NOTIFY_FIXTURE });
await sleep(2800);
await c.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>/^(Connect|Continue with World App)$/.test(x.innerText.trim()));if(e)e.click();return 1;})()`);
await sleep(5000);
await sleep(1000);
await c.ev("const section = document.querySelector('.plan-reminder-details'); if (section && !section.open) section.querySelector('summary').click(); return true;");
const emptyPlan = await c.ev(`return (() => ({
  overviewReminder: !!document.querySelector('.plan-overview-reminders'),
  note: document.querySelector('.plan-notification-note')?.innerText || ''
}))();`);
check("금고가 없으면 funded-plan 권한 행이 없다", !emptyPlan.overviewReminder,
  emptyPlan.overviewReminder ? "overview row present" : "none");
check("입력 화면에는 선택적 알림 설명을 반복하지 않는다", emptyPlan.note === "",
  emptyPlan.note || "설정 후 안내");
await c.close();

log("\n[5] 새 사용자가 양의 입금액으로 unified plan 을 만들 수 있는가");
// Period validation alone does not enable a unified plan: one asset amount must also be positive.
{
  const c3 = await launch({ pk: A.a11.pk, url: APP, preload: LOCAL_NOTIFY_FIXTURE });
  await sleep(2800);
  await c3.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>/^(Connect|Continue with World App)$/.test(x.innerText.trim()));if(e)e.click();return 1;})()`);
  // `sleep(5000)` 은 추측이고 여기서는 관측이 필요하다. 지갑 연결이 끝나기 전에
  // 폼이 mounts 되지 않으면 그 다음 줄 `s.call(null, …)` 이 예외를 던져, 이 단계가
  // "실패" 가 아니라 스크립트 크래시로 죽는다 — 어느 검사가 왜 죽었는지 로그에 안 남는다.
  check("금고 생성 폼이 나타난다", await c3.waitFor("#period-input"), `#period-input 대기 ${12000}ms`);
  const period = await c3.ev(`return (document.getElementById("period-input")||{}).value;`);
  check("금고가 없어도 주기 필드가 채워져 있다", !!period && period.length > 0, `값="${period}"`);
  check("상속인 입력창이 나타난다", await c3.waitFor("#heir-input"), "#heir-input");
  await c3.waitFor("#plan-wld");
  const heirSet = await setInput(c3, "heir-input", A.a9.a);
  const amountSet = await setInput(c3, "plan-wld", "0.01");
  await waitUntil(() => c3.ev(`return [...document.querySelectorAll("button")]
    .some(button => button.innerText.trim() === "Review plan" && !button.disabled);`));
  const amount = await c3.ev("return document.getElementById('plan-wld')?.value || ''; ");
  const btn = await c3.ev(`return (()=>{
    const e=[...document.querySelectorAll("button")].find(x=>x.innerText.trim()==="Review plan");
    return e ? (e.disabled ? "disabled" : "enabled") : "missing";
  })();`);
  check("새 plan 입력은 지정한 상속인과 양의 WLD 금액을 보존한다", heirSet && amountSet && amount === "0.01",
    `heir=${heirSet}, WLD=${amount}`);
  check("상속인과 양의 입금액을 넣으면 현재 생성 CTA 가 열린다", btn === "enabled", `버튼 ${btn}`);
  await c3.close();
}

log("\n[6] funded unified-plan 생성이 자동 등록되고 canonical 관리 화면으로 간다");
{
  const c2 = await launch({ pk: A.a10.pk, url: APP, preload: LOCAL_NOTIFY_FIXTURE });
  await sleep(2800);
  await c2.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>/^(Connect|Continue with World App)$/.test(x.innerText.trim()));if(e)e.click();return 1;})()`);
  check("생성 폼과 amount control 이 나타난다",
    await c2.waitFor("#heir-input") && await c2.waitFor("#plan-wld"), "#heir-input + #plan-wld");
  const setHeir = await setInput(c2, "heir-input", A.a9.a);
  const setAmount = await setInput(c2, "plan-wld", "0.01");
  const requestedAmount = await c2.ev("return document.getElementById('plan-wld')?.value || ''; ");
  await waitUntil(() => c2.ev(`return [...document.querySelectorAll("button")]
    .some(button => button.innerText.trim() === "Review plan" && !button.disabled);`));
  const clicked = await c2.ev(`return (()=>{
    const e=[...document.querySelectorAll("button")].find(x=>x.innerText.trim()==="Review plan");
    if(!e) return "NO BUTTON";
    if(e.disabled) return "DISABLED";
    e.click(); return "clicked";
  })()`);
  await waitUntil(() => c2.ev("return !!document.querySelector('.plan-final-review')"));
  await c2.ev("const button = [...document.querySelectorAll('button')].find(item => item.innerText.trim() === 'Confirm and deposit'); if (!button || button.disabled) throw new Error('Final deposit approval unavailable'); button.click(); return true;");
  log(`    상속인 입력 ${setHeir} / amount 입력 ${setAmount} / 생성 CTA ${clicked}`);
  const creationObserved = await waitUntil(() => c2.ev(`return (window.__NOTIFY_REQUESTS__ || []).some(call => call.path === '/api/notifications/register')
    && !document.getElementById('heir-input')
    && document.querySelector('.page-intro h1')?.textContent === 'Today, and for their tomorrow.'
    && !!document.querySelector('.plan-overview-card');`), 30000);
  const registrationObserved = await c2.ev("return (window.__NOTIFY_REQUESTS__ || []).some(call => call.path === '/api/notifications/register');");
  const managed = await c2.ev("return !document.getElementById('heir-input') && document.querySelector('.page-intro h1')?.textContent === 'Today, and for their tomorrow.' && !!document.querySelector('.plan-overview-card');");
  const calls = await c2.ev("return (window.__NOTIFY_REQUESTS__ || []);");
  const regCalls = Array.isArray(calls) ? calls.filter((x) => x.path === "/api/notifications/register") : [];
  const canonicalVault = cast(["call", FACTORY, "vaultOf(address)(address)", A.a10.a, "--rpc-url", RPC]);
  const registeredBody = regCalls[0]?.body ? JSON.parse(regCalls[0].body) : {};
  const depositedAmount = canonicalVault.toLowerCase() === ZERO.toLowerCase() ? 0n
    : castUint(["call", WLD, "balanceOf(address)(uint256)", canonicalVault, "--rpc-url", RPC]);
  if (!creationObserved) log("    Creation diagnostic: " + JSON.stringify(await c2.ev("return {text: document.body.innerText, calldata: window.__E2E_MINIKIT__?.lastCalldata(), bridgeError: window.__E2E_MINIKIT__?.lastError()};")));
  check("금고 생성 시 등록을 자동으로 호출한다", regCalls.length > 0,
    creationObserved && registrationObserved ? `${regCalls.length}회: ${regCalls[0]?.path}` : "호출 없음");
  check("생성 요청은 정확히 0.01 WLD 를 사용한다", setAmount && requestedAmount === "0.01" && depositedAmount === 10000000000000000n,
    `requested=${requestedAmount} WLD; canonical deposited=${depositedAmount} wei`);
  check("등록 본문이 생성된 canonical vault 와 owner/heir 를 가리킨다",
    canonicalVault.toLowerCase() !== ZERO.toLowerCase()
      && registeredBody.vaultAddress?.toLowerCase() === canonicalVault.toLowerCase()
      && registeredBody.ownerAddress?.toLowerCase() === A.a10.a.toLowerCase()
      && registeredBody.heirAddress?.toLowerCase() === A.a9.a.toLowerCase(),
    JSON.stringify(registeredBody));
  const createdUi = await c2.ev("return {form: Boolean(document.getElementById('heir-input')), heading: document.querySelector('.page-intro h1')?.textContent};");
  check("금고 생성 직후 새로고침 없이 관리 화면으로 바뀐다",
    creationObserved && managed && !createdUi.form && createdUi.heading === "Today, and for their tomorrow.", JSON.stringify(createdUi));
  await c2.close();
}

log("\n[7] 새 계획 안내는 funded plan 이 생기기 전에 올바른 위치와 의미를 갖는가");
// 새 사용자는 권한 결정 없이 플랜을 만든다. 알림은 자산을 넣은 뒤 홈에서 설정한다.
{
  const fresh = await launch({ pk: A.a11.pk, url: APP, preload: LOCAL_NOTIFY_FIXTURE });
  await sleep(2800);
  await fresh.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>/^(Connect|Continue with World App)$/.test(x.innerText.trim()));if(e)e.click();return 1;})()`);
  await sleep(5000);
  const tabs = await fresh.ev(`return [...document.querySelectorAll(".tab-item")].filter(x=>x.offsetParent!==null).map(x=>x.innerText.trim());`);
  check("금고가 없으면 Vault 탭이 보이지 않는다", !tabs.includes("Home"),
    `탭: ${tabs.join(" | ")}`);
  check("초기 입력 화면에는 선택적 알림이나 권한 경고가 없다",
    await fresh.ev("return !document.querySelector('.plan-notification-note') && !document.querySelector('.plan-reminder-details');"));
  const heirSet = await setInput(fresh, "heir-input", A.a9.a);
  const amountSet = await setInput(fresh, "plan-wld", "0.01");
  await waitUntil(() => fresh.ev(`return [...document.querySelectorAll('button')]
    .some(button => button.innerText.trim() === 'Review plan' && !button.disabled);`));
  const enabledCta = await fresh.ev(`return [...document.querySelectorAll('button')]
    .some(button => button.innerText.trim() === 'Review plan' && !button.disabled);`);
  check("초기 사용자의 실제 생성 CTA 에 양의 test amount 와 heir 로 도달한다", heirSet && amountSet && enabledCta,
    `heir=${heirSet}, amount=${amountSet}, enabled=${enabledCta}`);
  await fresh.ev("const button=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Review plan');button.click();return true;");
  await waitUntil(()=>fresh.ev("return !!document.querySelector('.plan-final-review');"));
  await fresh.ev("const button=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Confirm and deposit');if(!button||button.disabled)throw Error('Review unavailable');button.click();return true;");
  await waitUntil(()=>fresh.ev("return !!document.querySelector('.plan-overview-reminders');"),30000);
  const reminder=fresh.ev("return document.querySelector('.plan-overview-reminders').getAttribute('role');");
  check("설정 후 홈에서 알림 상태를 경고 없이 안내한다",await reminder==='status');
  check("설정 후 선택적으로 알림을 켤 수 있다",await fresh.ev("return [...document.querySelectorAll('.plan-overview-reminders button')].some(x=>x.textContent.trim()==='Enable reminders'&&!x.disabled);"));
  check("세부 알림 설정은 기본적으로 접혀 있다",await fresh.ev("return !document.querySelector('.plan-overview-reminders details').open;"));
  await fresh.ev("document.querySelector('.plan-overview-reminders details').open=true;return true;");
  check("상속인에게도 별도 알림 권한이 필요하다고 안내한다",await fresh.ev("return /Your heir needs their own notification permission/.test(document.querySelector('.plan-overview-reminders').innerText);"));
  await fresh.shot("notify-first-run");
  await fresh.close();
}

log("\n[8] 상속인 카드는 결과가 있을 때만 첫 화면에 나온다");
// 앞선 커밋에서 상속인 카드를 맨 위로 올렸다. 그건 "상속인이 이 앱을 여는 이유니까"
// 였는데 — 스캔 결과가 있을 때만 성립하는 이야기다. 결과가 없으면 "No vault names you
// as heir" 카드가 그대로 남고, 아무것도 안 한 사람에게 "당신이 상속인일 수 있습니다" 를
// 말한 뒤 "아니오" 라고 답하는 셈이다. 정작 할 일(금고 만들기)은 화면 아래로 밀린다.
{
  // This case asserts a completed empty search, not an unavailable production API.
  // Actual RPC failures and retry are covered by heir-discovery.mjs.
  const plain = await launch({ pk: A.a11.pk, url: APP, preload: `${LOCAL_NOTIFY_FIXTURE}
    const realFetch = window.fetch.bind(window);
    window.__emptyIndexReads = 0;
    window.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
      if (url.origin === 'https://world-inheritance-notify.rkddkwl725.workers.dev'
        && url.pathname === '/api/notifications' && (!init?.method || init.method === 'GET')) {
        window.__emptyIndexReads++;
        return Promise.resolve(Response.json({status:'success',watchers:[],nextCursor:null}));
      }
      return realFetch(input, init);
    };
  ` });
  await sleep(2800);
  await plain.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>/^(Connect|Continue with World App)$/.test(x.innerText.trim()));if(e)e.click();return 1;})()`);
  await sleep(6500);
  const t = await plain.ev("return document.body.innerText;");
  const completeEmpty = await plain.ev("return window.__emptyIndexReads > 0;");
  check("스캔 결과가 없으면 첫 화면에 상속인 카드가 없다",
    completeEmpty && !/incomplete|Are you named as someone/i.test(t),
    completeEmpty ? (/Are you named as someone/i.test(t) ? "나오고 있다" : "완료된 빈 조회 — 카드 없음") : "인덱스 조회 없음");
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
  await heir.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>/^(Connect|Continue with World App)$/.test(x.innerText.trim()));if(e)e.click();return 1;})()`);
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

log("\n[10] Enable reminders updates the overview to the confirmed wallet permission");

// A fresh browser profile starts with notifications off. The action must update the
// wallet permission status without implying that a vault was registered or delivery succeeded.
const perm = await launch({ pk: A.a4.pk, url: APP, preload: LOCAL_NOTIFY_FIXTURE });
await sleep(2800);
await perm.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>/^(Connect|Continue with World App)$/.test(x.innerText.trim()));if(e)e.click();return 1;})()`);
await sleep(6000);
await perm.ev(`return (()=>{const e=[...document.querySelectorAll(".tab-item")].filter(x=>x.offsetParent!==null).find(x=>x.innerText.trim()==="Home");if(e)e.click();return 1;})()`);
await sleep(1500);
const before = await perm.ev("return document.querySelector('.plan-overview-reminders')?.innerText || ''; ");
check("누르기 전 overview 는 지갑 권한이 꺼졌다고 표시한다", /Notifications are off/i.test(before)
  && !/Notifications are on for this wallet/i.test(before), before || "overview permission row missing");

const clicked = await perm.ev(`return (()=>{
  const btn=[...(document.querySelector('.plan-overview-reminders')?.querySelectorAll('button') || [])]
    .find(x=>x.innerText.trim()==='Enable reminders' && !x.disabled);
  if(!btn) return false; btn.click(); return true;
})()`);
check("Enable reminders 를 누를 수 있다", clicked === true, clicked ? "clicked" : "button missing/disabled");
const changed = await waitUntil(() => perm.ev("return /Notifications are on for this wallet/i.test(document.querySelector('.plan-overview-reminders')?.innerText || '');"));
const after = await perm.ev("return document.querySelector('.plan-overview-reminders')?.innerText || ''; ");
check("권한 응답 뒤 overview 가 지갑 권한을 on 으로 갱신한다", changed
  && /Notifications are on for this wallet/i.test(after) && !/Notifications are off/i.test(after), after || "permission row missing");
check("권한 on 을 감시 등록이나 delivery 성공으로 과장하지 않는다",
  !/reminders are enabled|delivery enabled|monitoring enabled|Automatic transfer is enabled/i.test(after),
  after || "permission row missing");
await perm.shot("notify-permission-roundtrip");
await perm.close();


log(`\n  통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
