// Integration test for the Worker's D1 writes.
//
// Why this exists: `scripts/test-notify-alerts.mjs` covers decideAlerts / shouldSend /
// markAlert / readDelivery — all pure functions. It never touched the database, so it
// stayed green while `saveWatcher` passed 12 of 13 bind parameters and D1 rejected every
// single write. The result was a notification backend that had never successfully stored
// a single vault, and a register endpoint that returned 500 to every user.
//
// The bug class is "SQL placeholder count vs bind argument count", so this drives the
// real code against a real SQLite with a D1-shaped shim. Anything that changes the shape
// of those statements fails here instead of in production.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// 주석에 ", " 나 ".run(" 같은 문자열이 들어 있으면 인자 개수를 세는 파서가
// 오독한다 — 실제로 내가 쓴 설명 주석이 "bind 14개" 로 집계됐다. 그래서 분석 전에
// 줄 주석을 지운다. (문자열 리터럴 안의 // 는 이 파일에 없다.)
// 줄 주석을 지워야 파서가 오독하지 않는다. 다만 이 파일에는
// "world-inheritance-notify/1.0 (+https://inheritance.pages.dev)" 처럼 문자열 안에
// `//` 가 있는 곳이 있어서 단순 치환은 문자열을 망가뜨린다. 그래서 따옴표 상태를
// 추적하며 스캔한다. (파일 내용만 바꿔 쓰는 것이므로 원본은 건드리지 않는다.)
function stripLineComments(src) {
  let out = "", inStr = null, inTpl = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], nx = src[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") { out += nx ?? ""; i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (inTpl) { out += c; if (c === "`") inTpl = false; continue; }
    if (c === '"' || c === "'") { inStr = c; out += c; continue; }
    if (c === "`") { inTpl = true; out += c; continue; }
    if (c === "/" && nx === "/") { while (i < src.length && src[i] !== "\n") i++; out += "\n"; continue; }
    // 블록 주석도 지운다. JSDoc 안에 ".run(x) 로 하나를 밀어 넣은" 같은 설명이
    // 남아 있으면 이 검사가 그걸 실제 코드로 오독한다 — 실제로 그랬다.
    if (c === "/" && nx === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 1;
      out += " ";
      continue;
    }
    out += c;
  }
  return out;
}
const workerSrcRaw = readFileSync(path.join(here, "../backend/src/worker.mjs"), "utf8");
const workerSrc = stripLineComments(workerSrcRaw);
const initSql = readFileSync(path.join(here, "../backend/migrations/0001_init.sql"), "utf8");
const alertsSql = readFileSync(path.join(here, "../backend/migrations/0002_alerts.sql"), "utf8");
let pass = 0, fail = 0;
function check(name, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
const log = (s) => console.log(s);

// ── A D1-shaped shim over SQLite ─────────────────────────────────
// D1's `.bind(...).run()` validates that the argument count equals the placeholder
// count and throws "Wrong number of parameter bindings" otherwise. node:sqlite does the
// same via its own binding, so the count check is done here explicitly — that check IS
// the thing under test, so it must not be delegated to something that silently pads.
const db = new DatabaseSync(":memory:");
db.exec(initSql);
db.exec(alertsSql);

function countPlaceholders(sql) {
  const noStr = sql.replace(/'(?:[^']|'')*'/g, "''");
  return (noStr.match(/\?/g) || []).length;
}

// 바인딩 배열은 문장마다 들고 있어야 한다. 셔버 변수로 두면 다음 .all() 이
// 직전 .bind() 의 인자를 재사용해서 "column index out of range" 가 난다 —
// 그건 셔버의 버그이지 Worker 의 버그가 아니다. (한 번 헷갈렸다.)
const env = {
  DB: {
    prepare(sql) {
      const n = countPlaceholders(sql);
      const self = {
        _n: n, _b: undefined, _args: [],
        bind(...args) { self._args = args; self._b = args.length; return self; },
        async run(...extra) {
          // D1 refuses a mismatch. Reproduce that refusal exactly — this check IS
          // the thing under test, so it must be ours, not SQLite's.
          if (self._b !== undefined && self._b !== n) {
            throw new Error(`D1_ERROR: Wrong number of parameter bindings for SQL query. (${self._b} given, ${n} needed)`);
          }
          if (extra.length) {
            throw new Error("D1_ERROR: run() 인자는 바인딩되지 않습니다 (bind 를 쓰세요).");
          }
          if (self._args.length !== n) {
            throw new Error(`D1_ERROR: Wrong number of parameter bindings for SQL query. (${self._args.length} given, ${n} needed)`);
          }
          db.prepare(sql).run(...self._args);
          return { success: true };
        },
        // D1 의 반환 모양을 그대로 흉내낸다: .all() 은 { results, success, meta } 이고
        // .first() 는 행 하나다. node:sqlite 의 배열을 그대로 넘기면 listWatchers 가
        // `result.results` 를 못 읽어 항상 빈 배열이 된다 — 셔버의 버그가 Worker 버그로
        // 보일 수 있으니 모양을 맞춰야 한다.
        async all() {
          const rows = self._args.length ? db.prepare(sql).all(...self._args) : db.prepare(sql).all();
          return { results: rows, success: true, meta: { rows_read: rows.length } };
        },
        async first() {
          return self._args.length ? (db.prepare(sql).get(...self._args) ?? null) : (db.prepare(sql).get() ?? null);
        },
      };
      return self;
    },
  },
};

// The Worker exports its DB-touching helpers for exactly this reason.
const mod = await import("../backend/src/worker.mjs");
const __test = mod.__test;
check("Worker 가 DB 헬퍼를 테스트에 노출한다", !!__test,
  __test ? Object.keys(__test).join(", ") : "__test 없음 — 이 테스트가 통할 수 없다");
if (!__test) { log("\n  통과 0 / 실패 1"); process.exit(1); }

// ── Test 1: the bind/run contract, statically ────────────────────
// The exact failure we hit: placeholders in the SQL, a shorter bind(), and the missing
// value smuggled in as a run() argument.
log("\n[1] saveWatcher 의 SQL ↔ 바인딩 개수");
{
  const m = workerSrc.match(/INSERT INTO watchers \(([\s\S]*?)\)\s*VALUES\s*\(([^)]*)\)/i);
  check("watchers INSERT 문을 찾았다", !!m, m ? "" : "패턴 변경됨");
  if (m) {
    const cols = m[1].split(",").map((c) => c.trim()).filter(Boolean);
    const placeholders = countPlaceholders(m[2]);
    check("열 개수 = 자리표시자 개수", cols.length === placeholders, `${cols.length} vs ${placeholders}`);

    const bindBody = workerSrc.match(/\.bind\(([\s\S]*?)\)\s*\n\s*\.run\(/);
    check("bind() 블록을 찾았다", !!bindBody, bindBody ? "" : "run() 호출 형태가 바뀜");
    if (bindBody) {
      const args = bindBody[1]
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      check("bind() 인자 개수 = 자리표시자 개수", args.length === placeholders,
        `bind ${args.length} vs 자리표시자 ${placeholders}`);
      check("alerts 가 바인딩에 포함된다", args.some((a) => a.includes("alerts")),
        args.filter((a) => a.includes("alerts")).join(",") || "alerts 바인딩 없음");
    }
  }
}

// ── Test 2: no stray run() arguments anywhere ────────────────────
log("\n[2] 바인딩되지 않은 run() 인자");
{
  const runs = [...workerSrc.matchAll(/\.run\(([^)]*)\)/g)].map((m) => m[1].trim());
  const strays = runs.filter((r) => r.length > 0);
  check("run() 에 넘겨진 인자가 없다", strays.length === 0, strays.join(" | ") || "이상 없음");
}

// ── Test 3: every statement's placeholders match its binds ───────
log("\n[3] 모든 쿼리의 자리표시자 ↔ 바인딩");
{
  // Collect prepare(...).bind(...) pairs by scanning, and check counts.
  // `prepare(` 뒤 백틱 SQL 이 끝나고 곧바로 .bind( 가 오는 경우만 한 문장으로 본다.
  // 느슨한 패턴은 여러 문장을 하나로 삼켜 엉뚱한 개수를 센다.
  const re = /prepare\(\s*`([^`]*)`\s*\)\s*\n\s*\.bind\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
  let m, checked = 0, bad = [];
  while ((m = re.exec(workerSrc))) {
    const [, sql, binds] = m;
    const n = countPlaceholders(sql);
    const args = binds.split(",").map((a) => a.trim()).filter(Boolean);
    checked++;
    if (n !== args.length) bad.push(`${n} vs ${args.length} (${sql.trim().split("\n")[1] || sql.trim().slice(0, 30)})`);
  }
  check("모든 쿼리의 자리표시자 수 = 바인딩 수", bad.length === 0,
    bad.length ? bad.join("; ") : `${checked}개 쿼리 확인`);
}

// ── Test 4: the schema the code inserts into actually has the columns ──
log("\n[4] 스키마와 코드의 열 일치");
{
  const m = workerSrc.match(/INSERT INTO watchers \(([\s\S]*?)\)\s*VALUES/i);
  if (m) {
    const codeCols = m[1].split(",").map((c) => c.trim().toLowerCase());
    const table = db.prepare("PRAGMA table_info(watchers)").all().map((r) => r.name.toLowerCase());
    const missing = codeCols.filter((c) => !table.includes(c));
    check("코드가 INSERT 하는 모든 열이 스키마에 있다", missing.length === 0,
      missing.length ? `스키마에 없음: ${missing.join(", ")}` : `${codeCols.length}개 열`);
  }
}

// ── Test 5: the real saveWatcher, against real SQLite ────────────
log("\n[5] 진짜 saveWatcher 저장 라운드트립");
{
  const base = {
    vaultAddress: "0xFea316C5aeeF8818763EeB61FDFEfa391B612d18",
    ownerAddress: "0x93bC44B8296977Feb479F95855D9b9E051C17dA2",
    heirAddress: "0x93bC44B8296977Feb479F95855D9b9E051C17dA2",
    active: true,
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
    lastCheckedAt: null,
    lastClaimable: false,
    lastVaultBalance: "0",
    notifiedHeirAddress: null,
    notifiedAt: null,
    lastError: null,
    alerts: {},
  };
  try {
    await __test.saveWatcher(env, base);
    const row = __test.rowToWatcher(db.prepare("SELECT * FROM watchers WHERE vault_address = ?").get(base.vaultAddress) || {});
    check("watcher 한 건이 실제로 저장된다", !!row.vaultAddress, row.vaultAddress || "(행 없음)");
    check("주소가 저장된다", !!row.vaultAddress && row.vaultAddress.length === 42, row.vaultAddress);
    check("alerts 가 보존된다", JSON.stringify(row.alerts) === "{}", JSON.stringify(row.alerts));

    // 다시 저장하면 갱신이어야 하고 행이 늘면 안 된다.
    await __test.saveWatcher(env, { ...base, heirAddress: "0x" + "11".repeat(20), lastVaultBalance: "5" });
    const all = await __test.listWatchers(env, true);
    check("재저장은 갱신 (행이 늘지 않음)", all.length === 1, `${all.length}행`);
    check("갱신된 값이 반영된다", all[0].heirAddress === "0x" + "11".repeat(20), all[0].heirAddress);
    check("알림 상태(alerts)도 보존된다", !!all[0].alerts, JSON.stringify(all[0].alerts));

    // null 값이 바인딩에서 깨지지 않아야 한다 (아직 알린 적 없는 watcher 의 정상 상태)
    check("null 필드가 저장된다", all[0].lastCheckedAt === null || all[0].lastCheckedAt === undefined,
      String(all[0].lastCheckedAt));
  } catch (e) {
    check("saveWatcher 가 예외 없이 저장한다", false, String(e.message).slice(0, 140));
  }
}

log(`\n  통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
