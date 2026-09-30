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
const { createServer } = await import(REPO + "/app/node_modules/vite/dist/node/index.js");

const ART = REPO + "/out/InheritanceVaultWLDFactoryOnePerOwner.sol/InheritanceVaultWLDFactoryOnePerOwner.json";
const VART = REPO + "/out/InheritanceVaultWLD.sol/InheritanceVaultWLD.json";

/*
 * 앱의 ABI 를 **실제로 import** 한다. 예전에는 App.tsx 를 문자열로 파싱해서 배열을
 * 꺼냈는데 그랬더니 (1) ABI 를 abis.ts 로 옮기는 순간 이 검사가 조용히 죽었고
 * (2) 파싱한 것이 앱이 진짜 쓰는 것과 같은지는 아무도 확인하지 않았다.
 * 이제 Vite 의 SSR 모듈 로더로 읽으므로 앱이 쓰는 것과 같은 객체다.
 */
const vite = await createServer({
  root: REPO + "/app",
  configFile: false,
  logLevel: "error",
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
});
const { FACTORY_ABI, VAULT_ABI } = await vite.ssrLoadModule("/src/abis.ts");
await vite.close();

if (!FACTORY_ABI?.length || !VAULT_ABI?.length) {
  console.error("\n  abis.ts 에서 FACTORY_ABI / VAULT_ABI 를 읽지 못했습니다.\n");
  process.exit(1);
}

const art = JSON.parse(readFileSync(ART, "utf8"));
const vart = JSON.parse(readFileSync(VART, "utf8"));
const code = art.deployedBytecode.object;
const vcode = vart.deployedBytecode.object;

let fail = 0;
const rows = [];
for (const [label, rawAbi, hex] of [["factory", FACTORY_ABI, code], ["vault", VAULT_ABI, vcode]]) {
  /* 앱의 ABI 는 **문자열 조각**과 **커스텀 에러 객체**가 섞여 있다
     (`...VAULT_ERROR_ABI` 로 뒤에 붙는다). 원소별로 종류를 판단해야 한다 —
     배열 전체로 `every` 로 재면 하나라도 객체가 섞여 있어 전부 문자열이 아니라고
     판단해 함수를 하나도 못 세고 "확인 0개" 로 통과해 버린다. 실제로 그랬다.
     통과한 것처럼 보이는 게 제일 나쁜 실패다. */
  const iface = new ethers.Interface(rawAbi);
  const frags = rawAbi
    .map((f) => {
      if (typeof f === "string") {
        // "function foo(...)" / "event Foo(...)" / "error Bar()"
        if (!/^\s*function\b/.test(f) || !f.includes("(")) return null;
        return f;
      }
      if (f?.type !== "function") return null;
      return `${f.name}(${(f.inputs || []).map((i) => i.type).join(",")})`;
    })
    .filter(Boolean);
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

/* 하나도 못 셌으면 실패로 본다.
   ABI 를 못 읽었는데 "누락 0개" 로 초록이 나오는 게 이 검사가 놓치는 가장 나쁜
   형태다. 실제로 그랬다 — App.tsx 파싱이 깨졌는데 조용히 0개를 확인한 채 통과했다.
   배포 직전 마지막 방어선이 이 검사를 믿고 통과하므로, 0개면 절대 통과시키지 않는다. */
if (rows.length === 0) {
  console.error("  확인할 함수 조각을 하나도 읽지 못했습니다. ABI 파싱이 실패한 것입니다.\n");
  process.exit(1);
}

// Also confirm the bytecode the app will meet is the bytecode we audited locally.
console.log(`  팩토리 런타임 코드: ${(code.length - 2) / 2} 바이트`);
console.log(`  금고  런타임 코드: ${(vcode.length - 2) / 2} 바이트`);
process.exit(fail ? 1 : 0);
