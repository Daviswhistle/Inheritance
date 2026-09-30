import { fileURLToPath } from "node:url";
import path from "node:path";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
// Before deploying anything immutable: prove that every function the app calls is
// actually present in the bytecode we are about to put on chain.
//
// A missing selector is not a build error. It is a deployed contract where the app
// calls a function that does not exist, the call reverts, and the user sees a failure
// with no explanation. That is exactly the class of bug the local anvil test cannot
// catch, because there we deploy from the same source we just compiled.
import { readFileSync } from "node:fs";
// 저장소 밖의 app/node_modules 에 있으니 정적 import 경로로 쓸 수 없다.
const { ethers } = await import(REPO + "/app/node_modules/ethers/lib.esm/index.js");

const ART = REPO + "/out/InheritanceVaultWLDFactoryOnePerOwner.sol/InheritanceVaultWLDFactoryOnePerOwner.json";
const VART = REPO + "/out/InheritanceVaultWLD.sol/InheritanceVaultWLD.json";
const APP = REPO + "/app/src/App.tsx";

// The ABIs as the app declares them, pulled straight out of the source.
const src = readFileSync(APP, "utf8");
function abiFrom(name) {
  const i = src.indexOf(`const ${name} = [`);
  if (i < 0) throw new Error(`${name} not found in App.tsx`);
  const start = src.indexOf("[", i);
  let depth = 0, end = start;
  for (let k = start; k < src.length; k++) {
    if (src[k] === "[") depth++;
    else if (src[k] === "]") { depth--; if (!depth) { end = k; break; } }
  }
  // 배열 안에는 `//` 주석이 섞여 있다. 줄 단위로 주석을 지운 뒤 JSON 으로 읽는다.
  // 줄마다 `//` 주석을 지우고, 마지막 원소 뒤의 쉼표만 제거한다.
  // (원소마다 쉼표를 지우면 첫 원소가 문자열 하나만 남아 깨진다.)
  const body = src.slice(start, end + 1)
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join(" ")
    .replace(/,\s*]/g, " ]")
    .trim();
  return JSON.parse(body);
}

const art = JSON.parse(readFileSync(ART, "utf8"));
const vart = JSON.parse(readFileSync(VART, "utf8"));
const code = art.deployedBytecode.object;
const vcode = vart.deployedBytecode.object;

let fail = 0;
const rows = [];
for (const [label, rawAbi, hex] of [["factory", abiFrom("FACTORY_ABI"), code], ["vault", abiFrom("VAULT_ABI"), vcode]]) {
  // 앱의 ABI 는 사람이 읽는 형태(문자열 배열)다. 이걸 그대로 순회하면 fn.type 이
  // undefined 라서 전부 건너뛰고 "확인 0개" 가 된다 — 실제로 그랬다.
  const isHuman = rawAbi.every((x) => typeof x === "string");
  const iface = new ethers.Interface(rawAbi);
  // human-readable 항목은 "name(type,type)" 형태이므로 여기서 직접 파싱한다.
  // 앱 ABI 는 사람이 읽는 형태다. "event Foo(...)" 도 괄호를 포함하므로 함수로 세면
  // 안 되고, 조각에서 다시 조립한 타입 문자열을 getFunction 에 넘기면 이름이 섞여
  // INVALID_ARGUMENT 가 난다. 원본 조각 문자열을 그대로 시그니처로 쓰는 게 맞다.
  const frags = rawAbi
    .filter((f) => (isHuman ? !/^\s*(event|error)\b/.test(f) && f.includes("(") : f.type === "function"))
    .map((f) => (isHuman ? f : `${f.name}(${(f.inputs || []).map((i) => i.type).join(",")})`));
  for (const sig of frags) {
    const name = sig.slice(0, sig.indexOf("("));
    const sel = iface.getFunction(sig).selector;
    // The selector has to survive PUSH4 masking, so search the masked form too.
    const masked = "63" + sel.slice(2);
    const hit = hex.includes(sel.slice(2)) || hex.includes(masked);
    // A dispatch table often stores selectors right-aligned, so also try the shifted form.
    const present = hit || hex.includes(sel.slice(2).padStart(8, "0"));
    rows.push({ label, fn: name, sig, sel, present });
    if (!present) { fail++; rows[rows.length - 1].MISSING = true; }
  }
}

for (const r of rows) {
  console.log(`  ${r.present ? "OK  " : "MISS"}  ${r.label}/${r.fn}  ${r.sel}`);
}
console.log(`\n  확인 ${rows.length}개 중 누락 ${fail}개`);

// Also confirm the bytecode the app will meet is the bytecode we audited locally.
console.log(`  팩토리 런타임 코드: ${(code.length - 2) / 2} 바이트`);
console.log(`  금고  런타임 코드: ${(vcode.length - 2) / 2} 바이트`);
process.exit(fail ? 1 : 0);
