// Retained CLI name; KO copy is allowed only in the Korean dictionary and
// its exact built strings. English copy and untranslated source stay English.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "../app/node_modules/typescript/lib/typescript.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const localePath = path.join(root, "app/src/locale.ts");
const hangul = /[가-힣㄰-㆏]/;
const otherCjk = /[\u4E00-\u9FFF\u3040-\u30FF]/;
const allowedKorean = new Set();
const findings = [];
const files = (dir, extensions) => existsSync(dir) ? readdirSync(dir).flatMap(name => {
  if (["node_modules", "test", "dist", ".wrangler"].includes(name)) return [];
  const entry = path.join(dir, name);
  return statSync(entry).isDirectory() ? files(entry, extensions) : extensions.test(name) ? [entry] : [];
}) : [];
function inKoreanDictionary(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isVariableDeclaration(parent) && parent.name.getText() === "ko") return true;
  }
  return false;
}
function scan(file, bundle = false) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const visit = node => {
    const literal = ts.isStringLiteralLike(node) || ts.isJsxText(node)
      || node.kind === ts.SyntaxKind.TemplateHead || node.kind === ts.SyntaxKind.TemplateMiddle
      || node.kind === ts.SyntaxKind.TemplateTail;
    if (literal && (hangul.test(node.text) || otherCjk.test(node.text))) {
      const dictionary = file === localePath && inKoreanDictionary(node) && !otherCjk.test(node.text);
      if (dictionary) allowedKorean.add(node.text);
      else if (!bundle || !allowedKorean.has(node.text)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        findings.push(`${path.relative(root, file)}:${line}: unregistered localized copy`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
scan(localePath);
for (const file of files(path.join(root, "app/src"), /\.(tsx?|jsx?)$/)) {
  if (file !== localePath) scan(file);
}
let bundleCount = 0;
for (const file of files(path.join(root, "app/dist/assets"), /\.js$/)) { scan(file, true); bundleCount++; }
if (findings.length) {
  console.error([...new Set(findings)].join("\n"));
  process.exit(1);
}
if (!allowedKorean.size) throw new Error("The Korean dictionary has no registered copy");
console.log(`PASS registered Korean dictionary (${allowedKorean.size} strings), English source and ${bundleCount} built bundles`);
