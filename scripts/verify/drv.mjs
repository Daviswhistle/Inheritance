// Reusable CDP driver for the WLD inheritance mini app QA pass.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 스크린샷과 브라우저 프로필을 저장소 안에 흩뿌리지 않게 /tmp 아래 전용 디렉터리를 쓴다.
const RUNDIR = process.env.VERIFY_TMP || "/tmp/wld-verify";

export const ACCOUNTS = {
  a0: { a: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", pk: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" },
  a1: { a: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", pk: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" },
  a2: { a: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", pk: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" },
  a3: { a: "0x90F79bf6EB2c4f870365E785982E1f101E93b906", pk: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" },
  a4: { a: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", pk: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" },
  a5: { a: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc", pk: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" },
  a6: { a: "0x976EA74026E726554dB657fA54763abd0C3a0aa9", pk: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e" },
  a7: { a: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955", pk: "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356" },
  a8: { a: "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f", pk: "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97" },
  a9: { a: "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720", pk: "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6" },
  // 전용 계정. notify 단계가 "금고가 없는 사용자" 를 가정한 채 금고 생성 경로를
  // 타는데, 앞 단계(e2e/ux/stale)가 같은 체인에서 a5·a6 에 금고를 만들어 두면
  // "Create vault" 가 비활성이라 검사가 조용히 실패했다. 전용 계정을 둔다.
  a10: { a: "0xBcd4042DE499D14e55001CcbB24a551F3b954096", pk: "0xf214f2b2cd398c806f84e317254e0f0b801d0643303237d97a22a48e01628897" },
  a11: { a: "0x71bE63f3384f5fb98995898A86B02Fb2426c5788", pk: "0x701b615bbdfb9de65240bc28bd21bbc0d996645a3dd57e7b12bc2bdf6f192c82" },
};
ACCOUNTS.a3.a = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

export const RPC = "http://127.0.0.1:8546";
export const APP = process.env.APP_URL || "http://127.0.0.1:7700/";
export const FACTORY = "0x51a1ceb83b83f1985a81c295d1ff28afef186e02";
export const WLD = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
export const OUT = path.join(RUNDIR, "shots");
mkdirSync(OUT, { recursive: true });

let portCursor = 9100 + Math.floor(Math.random() * 400);

export async function launch({ pk, url, profile, preload = "" } = {}) {
  const PORT = portCursor++;
  const PROFILE = profile || path.join(RUNDIR, `prof-${PORT}`);
  rmSync(PROFILE, { recursive: true, force: true });
  const chrome = spawn("google-chrome", [
    "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run",
    "--hide-scrollbars", "--window-size=390,844", "about:blank",
  ], { stdio: "ignore" });

  let wsUrl = null;
  for (let i = 0; i < 100; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = l.find((t) => t.type === "page");
      if (p?.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; }
    } catch {}
    await sleep(200);
  }
  if (!wsUrl) { chrome.kill(); throw new Error("no devtools"); }
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

  let id = 1; const pend = new Map();
  const logs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) {
      const p = pend.get(m.id); pend.delete(m.id);
      m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      return;
    }
    if (m.method === "Runtime.consoleAPICalled") {
      const txt = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      if (!/\[vite\]|DevTools|Download the React/.test(txt)) logs.push(`[${m.params.type}] ${txt}`);
    }
    if (m.method === "Runtime.exceptionThrown") {
      logs.push(`[EXC] ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`);
    }
  };
  const send = (m, p = {}) => new Promise((res, rej) => {
    const k = id++; pend.set(k, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: k, method: m, params: p }));
    setTimeout(() => { if (pend.has(k)) { pend.delete(k); rej(new Error("timeout " + m)); } }, 120000);
  });
  const ev = async (code) => {
    const r = await send("Runtime.evaluate", { expression: `(async()=>{${code}})()`, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  const shot = async (name) => {
    const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    const p = `${OUT}/${name}.png`;
    writeFileSync(p, Buffer.from(s.data, "base64"));
    return p;
  };

  await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  // IIFE 로 감싼다. 주입 스크립트가 한 문서에 두 번 실행되면 최상위 `const oe` 가
  // 재선언되어 SyntaxError 가 난다. 그게 `__E2E_SIGNER__` 설정 **이후**에 터지면 앱은
  // 엉뚱한 계정 세션으로 로그인한 것처럼 보이고, 하네스 결과가 조용히 틀어진다 —
  // 실제로 그랬다. 여러 번 실행돼도 무해하게 만든다.
  const src = `(() => {
    if (window.__E2E_INJECTED__) { window.__E2E_SIGNER__ = ${JSON.stringify({ privateKey: pk })}; return; }
    window.__E2E_INJECTED__ = true;
    window.__E2E_SIGNER__ = ${JSON.stringify({ privateKey: pk })};
    window.__E2E_ERRS__ = [];
    const oe = console.error.bind(console);
    console.error = (...a) => { window.__E2E_ERRS__.push("console.error: " + a.map(x => (x && x.stack) || String(x)).join(" ")); oe(...a); };
    addEventListener("error", e => window.__E2E_ERRS__.push("error: " + ((e.error && e.error.stack) || e.message)));
    addEventListener("unhandledrejection", e => window.__E2E_ERRS__.push("rejection: " + ((e.reason && e.reason.stack) || String(e.reason))));
    ${preload}
  })();`;
  await send("Page.addScriptToEvaluateOnNewDocument", { source: src });
  await send("Page.navigate", { url: url || APP });
  await sleep(2500);

  const page = {
    /**
     * 요소를 **나타날 때까지** 기다린다 (기본 12초).
     *
     * 왜 필요했나: 하네스들이 `sleep(5000)` 후 곧바로 DOM 을 만졌다. 그 5초가 모자라면
     * 다음 줄의 `s.call(el, …)` 이 `null` 에 호출되어 예외로 튀어나오고, 그 예외는
     * **검사 실패가 아니라 스크립트 크래시** 로 보인다 — 어느 검사가 왜 죽었는지
     * 로그에 안 남는다. 실제로 notify-ux.mjs 가 [6] 에서 이 형태로 죽었다.
     * 단독 실행은 여유가 있어 통과하고 8단계 전체 실행에서만 재현됐다.
     *
     * `sleep(ms)` 는 "이만큼 기다리면 되겠지" 라는 **추측**이고, 이 함수는
     * "나타날 때까지 기다린다" 는 **관측**이다. 하네스에는 후자가 필요하다.
     */
    waitFor: async (sel, ms = 12000) => {
      const t0 = Date.now();
      for (;;) {
        const ok = await send("Runtime.evaluate", {
          expression: `!!document.querySelector(${JSON.stringify(sel)})`,
          returnByValue: true,
        }).then((r) => r.result?.value === true).catch(() => false);
        if (ok) return true;
        if (Date.now() - t0 > ms) return false;
        await new Promise((r) => setTimeout(r, 200));
      }
    },
    send, ev, shot, logs, chrome, ws, profile: PROFILE,
    close: async () => { try { ws.close(); } catch {} chrome.kill(); },
  };
  return page;
}

// ---- page-side helpers (injected as strings)
export const HELPERS = `
  window.__q = {
    btns: () => [...document.querySelectorAll('button')].filter(b=>b.offsetParent!==null).map(b=>({t:b.textContent.trim().slice(0,46), d:b.disabled})),
    tabs: () => [...document.querySelectorAll('.tab-item')].map(b=>b.textContent.trim()),
    tab: (name) => { const b=[...document.querySelectorAll('.tab-item')].find(x=>x.textContent.trim()===name); if(!b) return 'NO TAB '+name; b.click(); return 'ok'; },
    click: (label) => { const b=[...document.querySelectorAll('button')].filter(x=>x.offsetParent!==null).find(x=>x.textContent.trim()===label); if(!b) return 'NO BUTTON: '+label; if(b.disabled) return 'DISABLED: '+label; b.click(); return 'clicked '+label; },
    setInput: (id, val) => { const el=document.getElementById(id); if(!el) return 'NO INPUT '+id;
      const proto = el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;
      const s=Object.getOwnPropertyDescriptor(proto,'value').set; s.call(el, val);
      el.dispatchEvent(new Event('input',{bubbles:true})); return 'set '+id+'='+val; },
    text: () => document.body.innerText,
    errs: () => window.__E2E_ERRS__ || [],
    mkfail: (v) => { window.__mkfail = v; },
  };
  return 1;
`;
