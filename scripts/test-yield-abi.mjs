import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Interface } from "ethers";
import { createServer } from "../app/node_modules/vite/dist/node/index.js";

const vite = await createServer({
  root: process.cwd() + "/app", configFile: false, logLevel: "error",
  optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true },
});
let checks = 0;
try {
  // Coverage instruments unoptimized code. Check deployment sizes on the pinned
  // optimized artifacts instead of asserting them on coverage test contracts.
  for (const name of ["InheritanceVaultMorphoFactory", "InheritanceVaultMorphoDeployer", "InheritanceVaultMorpho"]) {
    const compiled = JSON.parse(readFileSync(`out/${name}.sol/${name}.json`, "utf8"));
    assert.ok((compiled.deployedBytecode.object.length - 2) / 2 <= 24_576, `${name} exceeds EIP-170`);
    assert.ok((compiled.bytecode.object.length - 2) / 2 <= 49_152, `${name} exceeds EIP-3860`);
  }
  const abi = await vite.ssrLoadModule("/src/yield.ts");
  for (const [name, exported] of [["InheritanceVaultMorphoFactory", "YIELD_FACTORY_ABI"], ["InheritanceVaultMorpho", "YIELD_VAULT_ABI"], ["MockERC4626", "MORPHO_ABI"]]) {
    const artifact = JSON.parse(readFileSync(`out/${name}.sol/${name}.json`, "utf8"));
    const deployed = new Interface(artifact.abi);
    new Interface(abi[exported]).forEachFunction(fragment => {
      const actual = deployed.getFunction(fragment.format("sighash"));
      assert.ok(actual, `${name} does not implement ${fragment.format("sighash")}`);
      assert.equal(actual.selector, fragment.selector);
      assert.deepEqual(actual.outputs.map(p => p.type), fragment.outputs.map(p => p.type));
      checks++;
    });
  }
  assert.equal(abi.minimumOutput(10000n), 9950n);
  assert.equal(abi.minimumOutput(1n), 1n);
  assert.throws(() => abi.minimumOutput(0n));
  assert.equal(abi.formatYieldAmount(108n * 10n ** 18n), "108.0");
  assert.equal(abi.formatYieldAmount(1234567890123456789n), "1.234567");
  assert.equal(abi.formatYieldAmount(1n), "<0.000001");
  console.log(`${checks} yield ABI functions match compiled contracts; minimum-output bounds passed.`);
} finally { await vite.close(); }
