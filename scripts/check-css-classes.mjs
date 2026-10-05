/**
 * CSS 클래스 정합성 검사.
 *
 * 이 앱은 Tailwind 를 쓰지 않는다. 필요한 이름만 index.css 에 손으로 정의하고
 * className 에 그 이름을 쓴다. 정의가 없는 이름을 쓰면 빌드도 타입체크도 린트도
 * 통과하고, 화면에서는 그저 아무 일도 일어나지 않는다.
 *
 * 실제로 세 번이나 물렸다. .bg-black/50 이 없어서 모달 배경이 안 생겼고,
 * .font-medium 이 없어서 제목이 굵어지지 않았고, .border-l-2 / pl-2 를 새로
 * 쓰려 했는데 역시 정의가 없었다. "적어 보니까 안 먹는다" 가 아니라
 * 아무도 모르게 넘어간다.
 *
 * 그래서 여기서 막는다. JSX 에 쓰인 모든 className 을 index.css 와 대조해
 * 정의가 없는 이름을 전부 보고한다. 상태 변형(state.foo)과 동적 조합은
 * 문자열로 이어붙여 만들어지므로 검사 대상에서 제외한다.
 *
 * 실행: node scripts/check-css-classes.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..", "app");
const cssPath = join(appRoot, "src", "index.css");

// Follow actual source imports; an unused stylesheet must not satisfy this check.
const cssFiles = new Set([cssPath]);
const seenImports = new Set();
const followStyles = (file) => {
  if (seenImports.has(file)) return;
  seenImports.add(file);
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/(?:import|export)\s+(?:[^;\n]*?\s+from\s+)?["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue;
    const target = specifier.startsWith("@/") ? join(appRoot, "src", specifier.slice(2)) : resolve(dirname(file), specifier);
    const candidates = [target, `${target}.tsx`, `${target}.ts`, join(target, "index.tsx"), join(target, "index.ts")];
    const imported = candidates.find(candidate => { try { return statSync(candidate).isFile(); } catch { return false; } });
    if (!imported) continue;
    if (extname(imported) === ".css") cssFiles.add(imported);
    else if ([".ts", ".tsx"].includes(extname(imported))) followStyles(imported);
  }
};
followStyles(join(appRoot, "src", "main.tsx"));
const css = [...cssFiles].map(file => readFileSync(file, "utf8")).join("\n");

/**
 * CSS 에 정의된 클래스 이름.
 *
 * 이스케이프를 반드시 풀어야 한다. 이 파일에는 `.bg-black\/50` 처럼
 * 슬래시를 이스케이프한 이름이 실제로 쓰이고, `.py-0\.5` 처럼 점을
 * 이스케이프한 이름도 있다. 이스케이프를 그대로 두고 비교하면 있는 이름을
 * 없는 것으로 오인하고, 그 오인에 따라 존재하지 않던 버그를 "고친다" 고
 * 중복 정의를 만들어 버린다. 실제로 그랬다.
 *
 * 숫자·하이픈·슬래시를 포함한 일반 클래스도 있으므로 인용부호로 시작하는
 * 경우는 애초에 건너뛴다.
 */
const defined = new Set();
for (const m of css.matchAll(/\.((?:[A-Za-z0-9_-]|\\.)+)/g)) {
  defined.add(m[1].replace(/\\(.)/g, "$1"));
}

/**
 * 자기 검사.
 *
 * 이스케이프가 섞인 이름들이 여기서 잘못 판정되지 않는지 확인한다. 이
 * 스크립트가 "정의 없음"을 틀리면, 그 오류를 믿고 CSS 를 고치는 쪽이 더
 * 위험하다 — 존재하는 정의를 중복으로 추가하거나, 화면에서 먹지 않는 클래스를
 * "고쳤" 고 보고하기 때문이다.
 */
const SELF_TEST = [
  ["bg-black/50", "이름에 슬래시가 있고 CSS 에서 이스케이프되어 있다"],
  ["py-0.5", "이름에 점이 있고 CSS 에서 이스케이프되어 있다"],
  ["md:py-6", "이름에 콜론이 있다"],
  ["sm:inline", "이름에 콜론이 있다"],
  ["supports-[backdrop-filter]:bg-white/70", "임의 변형이 포함된다"],
];
const selfTestFails = SELF_TEST.filter(([n]) => !defined.has(n));
if (selfTestFails.length) {
  console.log("\n  NG  검사기 자체가 이스케이프된 이름을 못 읽습니다:");
  for (const [n, why] of selfTestFails) console.log(`    .${n}  — ${why}`);
  console.log("    이 상태에서는 아래 결과를 믿으면 안 됩니다.\n");
  process.exit(2);
}

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "test") continue;
      walk(p);
      continue;
    }
    if ([".tsx", ".ts"].includes(extname(name))) files.push(p);
  }
};
walk(join(appRoot, "src"));

/** 상태 변형(state.foo)·동적 조합 등 정적 검사 대상이 아닌 이름을 걸�� 낸다. */
const isDynamic = (name) =>
  name.includes(".") || // state.foo, clsMap[color] 결과
  name.includes("[") || // arbitrary variant
  name.includes("$") ||
  name === "container-narrow" ||
  name === "tab-pb";

/**
 * 템플릿 리터럴에서 `${...}` 를 표식()으로 바꾼다.
 *
 * `tab-item ${cond ? "tab-item-active" : ""}` 를 그냥 공백으로 쪼개면
 * `?`, `:`, `""}` 같은 조각이 클래스 이름으로 나온다. 중괄호 중첩도 있으므로
 * 단순 정규식으로는 부족하다.
 *
 * 표식을 남기는 이유: `toast-${t.type}` 는 `toast-` + 동적 이지만
 * `tab-item ${...}` 의 `tab-item` 은 완성된 정적 이름이다. 지우면 후자까지
 * 놓쳐버린다. 표식이 붙은 토큰만 조각으로 보고 건너뛴다.
 */
const INTERP = "";
const markInterpolations = (s) => {
  let out = "";
  let depth = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "$" && s[i + 1] === "{") {
      depth = 1;
      out += INTERP;
      i += 1;
      continue;
    }
    if (depth > 0) {
      if (s[i] === "{") depth += 1;
      else if (s[i] === "}") depth -= 1;
      continue;
    }
    out += s[i];
  }
  return out;
};

const usage = new Map(); // 이름 → [{ file, line }]
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const raw = markInterpolations(m[1] ?? m[2] ?? "");
      for (const c of raw.split(/\s+/)) {
        if (!c || c === INTERP) continue;
        if (c.includes(INTERP)) continue; // `toast-${t.type}` 같은 조각
        if (isDynamic(c)) continue;
        if (!usage.has(c)) usage.set(c, []);
        usage.get(c).push({ file: relative(appRoot, file), line: i + 1 });
      }
    }
  });
}

const missing = [...usage.entries()]
  .filter(([name]) => !defined.has(name))
  .sort((a, b) => a[0].localeCompare(b[0]));

console.log("\n  === CSS 클래스 정합성 ===");
console.log(`  stylesheets: ${[...cssFiles].map(file => relative(appRoot, file)).join(", ")}`);
console.log(`  검사한 이름: ${usage.size}개`);

if (!missing.length) {
  console.log("\n  OK  JSX 의 모든 className 이 앱에서 가져온 CSS 에 정의되어 있습니다.");
  process.exit(0);
}

console.log(`\n  NG  정의가 없는 클래스 ${missing.length}개 — 화면에서 조용히 무시됩니다:\n`);
for (const [name, where] of missing) {
  const spots = where
    .slice(0, 3)
    .map((w) => `${w.file}:${w.line}`)
    .join(", ");
  const more = where.length > 3 ? ` (+${where.length - 3}곳)` : "";
  console.log(`    .${name}`);
  console.log(`      ${spots}${more}`);
}
console.log("");
process.exit(1);
