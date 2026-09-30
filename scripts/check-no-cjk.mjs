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
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const APP_SRC = path.join(REPO, "app", "src");

const HANGUL = /[가-힣㄰-㆏]/;
// 한자(중국어) · 히라가나·카타카나. 영어 전용 앱에 이것도 들어가지 않는다.
const HAN = /[\u4E00-\u9FFF\u3040-\u30FF]/;

const cjkLabel = (s) => {
  const kinds = [];
  if (HANGUL.test(s)) kinds.push("한글");
  if (HAN.test(s)) kinds.push("한자/가나");
  return kinds.join("·");
};

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

/* 한자·가나는 저장소 전체에서 금지한다 — 주석이어도.
   app/src 밖(테스트, 하네스, 컨트랙트)에서도 실제로 세 번 생겼다:
   `입금这一步가`, `시각적紧急도`, `이론上는`. 전부 주석 안의 오타였고 그 주석을 나중에
   읽는 사람이 그대로 혼선을 받는다. 여기서는 언어 관례(한국어 주석)는 허용하되
   한자/가나만 막는다. */
const HAN_SCAN_DIRS = ["scripts", "test", "contracts"];
const HAN_SCAN_EXT = /\.(ts|tsx|mjs|sol|sh|md|yml|yaml|json)$/;

const hanFindingsAll = [];
for (const dirName of HAN_SCAN_DIRS) {
  const dir = path.join(REPO, dirName);
  if (!existsSync(dir)) continue;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of readdirSync(cur)) {
      if (e === "node_modules" || e === ".wrangler" || e === "dist") continue;
      const p = path.join(cur, e);
      if (statSync(p).isDirectory()) {
        stack.push(p);
        continue;
      }
      if (!HAN_SCAN_EXT.test(e)) continue;
      // 이 파일 자신은 제외한다 — 위반 예시를 주석에 들고 있어야 하므로
      // 자기 자신만은 반드시 걸린다(그 예시도 화면에 나가는 문장이 아니다).
      if (p === fileURLToPath(import.meta.url)) continue;
      readFileSync(p, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (HAN.test(line)) hanFindingsAll.push({ file: path.relative(REPO, p), line: i + 1, text: line.trim().slice(0, 100) });
        });
    }
  }
}

const findings = [];
const hanFindings = [];
for (const file of walk(APP_SRC)) {
  const raw = readFileSync(file, "utf8");

  /* 한자·가나는 **주석 안이어도** 금지한다.
     이 코드베이스의 주석 관례는 한국어다(사용자는 한국어로 말하고, 주석은 그에 맞춰
     썼다). 그래서 한자가 나타나면 언제나 오타다 — 실제로 몇 개 있었다:
     "시각적紧急度", "상속 신청权의 존재", "이 函数에 넣어". 사용자에게는 안 보이지만
     나중에 그 주석을 읽는 사람이 같은 혼선을 그대로 받는다.
     한글은 주석에 허용하므로 이 검사는 한자/가나만 본다. */
  raw.split("\n").forEach((line, i) => {
    if (HAN.test(line)) hanFindings.push({ file: path.relative(REPO, file), line: i + 1, text: line.trim().slice(0, 100) });
  });

  const src = stripComments(raw);
  src.split("\n").forEach((line, i) => {
    if (!HANGUL.test(line) && !HAN.test(line)) return;
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
    const m = js.match(HANGUL) ?? js.match(HAN);
    if (m) {
      const at = js.indexOf(m[0]);
      findings.push({ file: `app/dist/assets/${e}`, line: 0, text: "… " + js.slice(Math.max(0, at - 60), at + 40).replace(/\s+/g, " ") + " …" });
    }
    bundleChecked = true;
  }
} catch {
  // dist 가 없으면 (개발 중) 소스 검사만 한다.
}

for (const f of hanFindingsAll) hanFindings.push(f);

if (hanFindings.length) {
  console.log("\n  === 한자/가나가 섞여 있습니다 (주석 포함) ===\n");
  for (const f of hanFindings) {
    console.log(`  ${f.file}:${f.line}`);
    console.log(`      ${f.text}\n`);
  }
  console.log("  이 저장소의 주석은 한국어로 씁니다. 한자가 남은 것은 오타입니다.\n");
}

if (findings.length || hanFindings.length) {
  console.log("\n  === 영어 전용 위반: 화면에 CJK 가 있습니다 ===\n");
  const seen = new Set();
  for (const f of findings) {
    const k = `${f.file}:${f.line}:${f.text}`;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`  ${f.file}:${f.line}`);
    console.log(`      ${f.text}\n`);
  }
  console.log(`  supported_languages 는 ["en"] 입니다. 주석은 한국어여도 괜찮고,`);
  console.log(`  사용자에게 보이는 문자열만 영어여야 합니다.`);
  console.log(`  한자·가나(중국어/일본어)는 주석에도 넣지 않습니다.\n`);
  console.log(`  번들 검사: ${bundleChecked ? "수행" : "dist 없음 (소스만 검사)"}\n`);
  process.exit(1);
}

console.log(`  OK  화면에 CJK 없음${bundleChecked ? " (소스 + 빌드 번들)" : " (소스만 — dist 없음)"}`);
