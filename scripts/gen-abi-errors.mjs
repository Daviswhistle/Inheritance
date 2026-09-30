// 커스텀 에러 ABI 생성기.
//
// 왜 이게 필요한가
// --------------
// `App.tsx` 의 FACTORY_ABI / VAULT_ABI 에는 함수 항목만 있고 **커스텀 에러 항목이 하나도
// 없었다.** 그래서 ethers 는 revert 를 디코딩하지 못하고 `error.message` — 즉
// `execution reverted (unknown custom error) (action="estimateGas", data="0x203d82d8",
// reason=null, transaction={...}, version=6.15.0)` — 를 그대로 사용자에게 보여줬다.
// 사람이 할 수 있는 말이 한 글자도 없는 문자열이었고, 그래서 화면이 가로로 넘쳤다.
//
// 셀렉터(0x203d82d8 등)를 사람이 하드코딩하는 방법도 써 봤지만 계약이 바뀌면 조용히
// 틀어진다. 아티팩트에서 뽑아내는 게 유일하게 오래 사는 방법이다.
//
// 생성: forge build && node scripts/gen-abi-errors.mjs
// 검증: node scripts/gen-abi-errors.mjs --check      (CI 가 이걸 돌린다)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const OUT = path.join(REPO, "app", "src", "abi-errors.ts");

const SOURCES = [
  { file: "out/InheritanceVaultWLD.sol/InheritanceVaultWLD.json", which: "vault" },
  {
    file: "out/InheritanceVaultWLDFactoryOnePerOwner.sol/InheritanceVaultWLDFactoryOnePerOwner.json",
    which: "factory",
  },
];

const missing = SOURCES.filter((s) => !existsSync(path.join(REPO, s.file)));
if (missing.length) {
  console.error(
    "\n  forge build 를 먼저 실행하세요. 없음:\n" + missing.map((m) => "    " + m.file).join("\n") + "\n",
  );
  process.exit(1);
}

const sigOf = (e) => `${e.name}(${(e.inputs || []).map((i) => i.type).join(",")})`;

const vault = [];
const factoryOnly = [];
const sources = [];
const seen = new Set();

for (const { file, which } of SOURCES) {
  const abi = JSON.parse(readFileSync(path.join(REPO, file), "utf8")).abi;
  const errs = abi.filter((e) => e.type === "error");
  if (!errs.length) {
    console.error(`  ${file} 에 커스텀 에러가 없습니다.`);
    process.exit(1);
  }
  for (const e of errs) {
    const sig = sigOf(e);
    if (seen.has(sig)) continue; // 두 계약에 같은 시그니처면 한 번만
    seen.add(sig);
    (which === "vault" ? vault : factoryOnly).push(e);
    sources.push(`  ${JSON.stringify(e.name)}: ${JSON.stringify(which)},`);
  }
}

const render = (list) =>
  list
    .map((e) => {
      const inputs = (e.inputs || [])
        .map((i) => `    { name: ${JSON.stringify(i.name)}, type: ${JSON.stringify(i.type)} },`)
        .join("\n");
      return `  {\n    type: "error",\n    name: ${JSON.stringify(e.name)},\n${
        inputs ? `    inputs: [\n${inputs}\n    ],\n` : ""
      }  },`;
    })
    .join("\n");

const src = `// 자동 생성 파일입니다. 직접 고치지 마세요 — scripts/gen-abi-errors.mjs 가 씁니다.
//
// 컨트랙트의 커스텀 에러 ABI. App.tsx 의 FACTORY_ABI / VAULT_ABI 에 붙이면 ethers 가
// revert 를 이름으로 디코딩합니다(Expired, VaultNotEmpty, NotHeir …). 이것이 없으면
// 4바이트 셀렉터만 보여주고 사용자는 무엇을 해야 하는지 알 수 없습니다.
//
// 생성: forge build && node scripts/gen-abi-errors.mjs
// 검증: node scripts/gen-abi-errors.mjs --check

/** InheritanceVaultWLD 의 커스텀 에러 ${vault.length}종. */
export const VAULT_ERROR_ABI = [
${render(vault)}
];

/** InheritanceVaultWLDFactoryOnePerOwner 만에 있는 커스텀 에러 ${factoryOnly.length}종. */
export const FACTORY_ERROR_ABI = [
${render(factoryOnly)}
];

/**
 * 커스텀 에러 이름 → 어느 계약의 것인지.
 *
 * InvalidAddress / NotOwner / NotHeir / TokenCallFailed / TokenTransferFailed 는 두
 * 계약에 모두 있다. 화면 문장은 이름만으로 정하므로 어느 계약에서 났는지는 알 필요가
 * 없고, 이 표는 사람이 문장을 고를 때 참조용이다.
 */
export const ERROR_SOURCE_BY_NAME: Record<string, "vault" | "factory"> = {
${sources.join("\n")}
};
`;

if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== src) {
    console.error(
      "\n  app/src/abi-errors.ts 가 계약과 어긋납니다.\n" +
        "  forge build && node scripts/gen-abi-errors.mjs 로 다시 생성하세요.\n",
    );
    process.exit(1);
  }
  console.log(`  OK  커스텀 에러 ABI ${vault.length + factoryOnly.length}종이 계약과 일치합니다.`);
} else {
  writeFileSync(OUT, src);
  console.log(
    `  생성: app/src/abi-errors.ts (vault ${vault.length}종 + factory 전용 ${factoryOnly.length}종)`,
  );
}
