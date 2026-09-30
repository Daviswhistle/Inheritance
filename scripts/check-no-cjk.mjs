// English-only guard.
//
// `supported_languages: ["en"]` — the store listing declares one language. Any Hangul
// that reaches the screen is a hard constraint violation, and it is invisible in review
// because the codebase is commented in Korean: a string that *looks* like a comment but
// is actually a JSX literal reads fine to a Korean-reading reviewer.
//
// It happened for real: the copy shown when a notification fails to deliver — the most
// important failure path in this app, since notifications are the reason the vault
// matters at all — was written in Korean.
//
// This scans the source for Hangul inside string/template literals, and separately
// checks the built bundle, which catches anything that only becomes user-visible after
// minification. Comments are excluded, so the Korean comments can stay.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const APP_SRC = path.join(REPO, "app", "src");

const HANGUL = /[가-힣㄰-㆏]/;

/**
 * 주석을 지워 한글 검사가 문자열 안만 보게 한다.
 *
 * 완전한 렉서를 쓰지 않는다 — 정규식 리터럴 안의 따옴표를 문자열 시작으로 오인해
 * 그 뒤 전부 어긋나는 일이 실제로 있었다(그래서 검사기가 소스 내 한국어 주석을
 * "위반" 으로 보고했다). 목표는 하나다: **문자열·템플릿 리터럴 안의 한글**을 찾기.
 *
 *   - 줄 전체가 `//` 또는 `*` 로 시작하면 통째로 건너뛴다
 *   - 블록 주석 안은 건너뛴다
 *   - 코드가 있는 줄의 뒤쪽 슬래시쌍은, 그 앞에 따옴표가 없을 때만 주석으로 본다
 *
 * 이 정직한 근사치로 실제 위반(문자열 안의 한글)을 놓치지 않는다.
 */
function stripComments(src) {
  const out = [];
  let inBlock = false;
  let inJsx = false;
  for (const line of src.split("\n")) {
    const t = line.trim();
    // JSX 주석 `{/* … */}` 은 여러 줄에 걸칠 수 있고, 뒷줄이 `*` 로 시작하지 않는다.
    if (inJsx) {
      out.push("");
      if (t.includes("*/}")) inJsx = false;
      continue;
    }
    if (inBlock) {
      out.push("");
      if (t.includes("*/")) inBlock = false;
      continue;
    }
    if (line.includes("{/*") && !line.includes("*/}")) {
      inJsx = true;
      out.push("");
      continue;
    }
    // 한 줄짜리 JSX 주석
    if (t.startsWith("{/*") && t.endsWith("*/}")) {
      out.push("");
      continue;
    }
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) {
      if (t.startsWith("/*") && !t.includes("*/")) inBlock = true;
      out.push("");
      continue;
    }
    // 뒤쪽 인라인 주석: 따옴표가 하나도 없을 때만 주식으로 본다.
    const q = line.indexOf("//");
    const hasQuoteBefore = q > 0 && /["'`]/.test(line.slice(0, q));
    out.push(q > 0 && !hasQuoteBefore ? line.slice(0, q) : line);
  }
  return out.join("\n");
}

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "test" || e === ".wrangler") continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(e)) acc.push(p);
  }
  return acc;
}

const findings = [];
for (const file of walk(APP_SRC)) {
  const raw = readFileSync(file, "utf8");
  const src = stripComments(raw);
  src.split("\n").forEach((line, i) => {
    if (!HANGUL.test(line)) return;
    // Still inside a string? Compare with the raw line: if the raw line's Hangul is
    // entirely within a comment, stripComments already removed it.
    findings.push({ file: path.relative(REPO, file), line: i + 1, text: line.trim().slice(0, 100) });
  });
}

// The built bundle is the last word: minification can inline a string that the source
// scan reads differently, and this is what users actually run.
const dist = path.join(REPO, "app", "dist");
let bundleChecked = false;
try {
  for (const e of readdirSync(path.join(dist, "assets"))) {
    if (!e.endsWith(".js")) continue;
    const js = readFileSync(path.join(dist, "assets", e), "utf8");
    const m = js.match(HANGUL);
    if (m) {
      const at = js.indexOf(m[0]);
      findings.push({ file: `app/dist/assets/${e}`, line: 0, text: "… " + js.slice(Math.max(0, at - 60), at + 40).replace(/\s+/g, " ") + " …" });
    }
    bundleChecked = true;
  }
} catch {
  // dist 가 없으면 (개발 중) 소스 검사만 한다.
}

if (findings.length) {
  console.log("\n  === 영어 전용 위반: 화면에 한국어가 있습니다 ===\n");
  const seen = new Set();
  for (const f of findings) {
    const k = `${f.file}:${f.line}:${f.text}`;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`  ${f.file}:${f.line}`);
    console.log(`      ${f.text}\n`);
  }
  console.log(`  supported_languages 는 ["en"] 입니다. 주석은 한국어여도 괜찮고,`);
  console.log(`  사용자에게 보이는 문자열만 영어여야 합니다.\n`);
  console.log(`  번들 검사: ${bundleChecked ? "수행" : "dist 없음 (소스만 검사)"}\n`);
  process.exit(1);
}

console.log(`  OK  화면에 한국어 없음${bundleChecked ? " (소스 + 빌드 번들)" : " (소스만 — dist 없음)"}`);
