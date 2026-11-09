import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "../app/node_modules/typescript/lib/typescript.js";

// Load the actual pure helper without importing the module's RPC dependencies.
const source = readFileSync(new URL("../app/src/inheritance.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("inheritance.ts", source, ts.ScriptTarget.Latest, true);
const helper = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "isEmptyCancelledPosition");
assert.ok(helper);
const js = ts.transpileModule(helper.getText(ast), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { isEmptyCancelledPosition } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const owner = "0xAa", heir = "0xBb";
const row = (name, recipient, hasAssets, lastPing = 100n) => ({ name, heir: recipient, hasAssets, lastPing, periodSeconds: 86400n, claimedAt: 0n });
const active = [row("new WLD", heir, true), row("new USDC", heir, true)];
const historical = [row("old WLD", owner.toLowerCase(), false, 0n), row("old USDC", owner, false, 0n)];

// Execute the actual App-derived expressions rather than a duplicate UI filter.
const app = readFileSync(new URL("../app/src/App.tsx", import.meta.url), "utf8");
const declaration = name => {
  const match = app.match(new RegExp(`const ${name} = ([^;]+);`));
  assert.ok(match, name);
  return match[1];
};
const select = new Function("unsettledOwnedPlans", "account", "isEmptyCancelledPosition", `return ${declaration("managedSettingsPlans")}`);
const common = new Function("managedSettingsPlans", `return ${declaration("commonManagedSettings")}`);
const selected = select([...historical, ...active], owner, isEmptyCancelledPosition);
assert.deepEqual(selected.map(p => p.name), ["new WLD", "new USDC"]);
assert.equal(common(selected), true);
assert.equal(selected.some(p => 86401n >= p.lastPing + p.periodSeconds), false, "expired old empty vault must not disable current settings");
assert.match(declaration("ownerSettingsPeriod"), /managedSettingsPlans\[0\]/);
assert.match(app, /disabled=\{ownedPlanLoading \|\| ownedPlanIncomplete \|\| managedSettingsPlans\.some/);
assert.match(app, /heirLabel=\{commonManagedSettings \? managedSettingsPlans\[0\]/);
assert.match(app, /ownerInheritancePositions\(provider, account\)\)\.filter\(p => p\.claimedAt === 0n && !isEmptyCancelledPosition\(p, account\)\)/);
assert.match(app, /if \(kind === "exit"\) return readExitTargets\(provider, account\)/, "exit/recovery keeps its independent target selection");

const targetSelection = app.match(/const rows = (\(await ownerInheritancePositions\(provider, account\)\)\.filter\([^;]+);/);
assert.ok(targetSelection);
const readActionRows = new Function("ownerInheritancePositions", "provider", "account", "isEmptyCancelledPosition",
  `return (async () => ${targetSelection[1]})()`);
const freshRows = await readActionRows(async () => [...historical, ...active], {}, owner, isEmptyCancelledPosition);
assert.deepEqual(freshRows.map(p => p.name), selected.map(p => p.name), "fresh transaction selection matches UI scope");
await assert.rejects(readActionRows(async () => { throw new Error("balance read failed"); }, {}, owner, isEmptyCancelledPosition), /balance read failed/, "read failures must block review, not masquerade as empty positions");

for (const position of [row("active empty", heir, false), row("cancelled funded", owner, true), row("unknown", owner, null), row("missing", owner, undefined)]) {
  assert.equal(isEmptyCancelledPosition(position, owner), false, position.name);
  assert.equal(select([position], owner, isEmptyCancelledPosition).length, 1, position.name);
}
assert.equal(common(select([active[0], { ...active[1], periodSeconds: 172800n }], owner, isEmptyCancelledPosition)), false, "real active-setting conflict remains visible");
assert.equal(common(select(historical, owner, isEmptyCancelledPosition)), false, "empty managed set must not imply shared settings");
console.log("PASS managed settings: historical empty cancellations excluded; active/retained/unknown positions and real conflicts preserved; UI and fresh action targets share helper; exit untouched");
