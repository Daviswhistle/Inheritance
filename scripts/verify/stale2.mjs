import { fileURLToPath } from "node:url";
import path from "node:path";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
// The realistic connectivity failure: the user is signed in, then the chain becomes
// unreachable. The screen must say so instead of showing numbers that look final.
import { setTimeout as sleep } from "node:timers/promises";
import { spawnSync, spawn } from "node:child_process";
import { launch, ACCOUNTS, APP } from "./drv.mjs";

let pass = 0, fail = 0;
function check(name, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
const log = (s) => console.log(s);

const PORT = 7712;
const DEAD = "http://127.0.0.1:8599";
const F = process.env.FACTORY;
const WLD = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

// Dev server starts pointed at the GOOD chain so login works…
spawn("npx", ["vite", "--config", "vite.config.e2e.ts", "--port", String(PORT), "--strictPort"], {
  cwd: REPO + "/app",
  env: { ...process.env, VITE_RPC: "http://127.0.0.1:8546", VITE_FACTORY_ADDRESS: F, VITE_WLD_ADDRESS: WLD, VITE_FACTORY_DEPLOY_BLOCK: "1" },
  stdio: "ignore",
});
let up = false;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) { up = true; break; } } catch {}
}
check("dev 서버 기동", up);
if (!up) process.exit(1);

const b = await launch({ pk: ACCOUNTS.a4.pk, url: `http://127.0.0.1:${PORT}/` });
await sleep(3000);
await b.ev(`(()=>{const e=[...document.querySelectorAll("button")].find(x=>/^(Connect|Continue with World App)$/.test(x.innerText.trim()));if(e)e.click();return 1;})()`);
await sleep(5000);
let t = await b.ev("return document.body.innerText;");
check("로그인 성공", /Connected|@e2e_/.test(t), (t.match(/@e2e_[0-9a-f]+/) || ["(없음)"])[0]);
check("정상 상태에서 배너가 없다", !/Not connected to World Chain/i.test(t));

// …then the chain dies.
log("  anvil 을 죽인다");
spawnSync("pkill", ["-f", "anvil --port 8546"]);
for (let i = 0; i < 10; i++) {
  await sleep(6000);
  const now = await b.ev("return document.body.innerText;");
  log(`    +${(i+1)*6}s: ${/Not connected/i.test(now) ? "배너 보임" : "배너 없음"}`);
  if (/Not connected/i.test(now)) break;
}

t = await b.ev("return document.body.innerText;");
const shown = /Not connected to World Chain/i.test(t);
check("체인 사후 장애 시 배너가 뜬다", shown, shown ? "" : "배너 없음");
check("배너가 금전 오해를 막는 문구를 담는다", /funds are unaffected|out of date/i.test(t),
  (t.match(/Not connected[\s\S]{0,180}/i) || ["(없음)"])[0].replace(/\s+/g, " ").slice(0, 150));
check("오류 화면으로 죽지 않는다", !/Something went wrong/.test(t));
await b.shot("stale-after-login");

// Chain comes back — the banner must clear on its own.
log("  anvil 을 되살린다");
spawn("anvil", ["--port", "8546", "--silent"], { stdio: "ignore" });
let cleared = false;
for (let i = 0; i < 8; i++) {
  await sleep(4000);
  const now = await b.ev("return document.body.innerText;");
  if (!/Not connected/i.test(now)) { cleared = true; log(`    +${(i+1)*4}s: 배너 사라짐`); break; }
}
if (!cleared) log("    (32초 지나도 배너 유지)");
t = await b.ev("return document.body.innerText;");
check("복구 후 배너가 사라진다", !/Not connected to World Chain/i.test(t));

await b.close();
spawnSync("pkill", ["-f", `vite.*${PORT}`]);
console.log(`\n  통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
