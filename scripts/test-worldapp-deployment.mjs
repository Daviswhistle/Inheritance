// Mainnet read-only fork; all deployments/impersonation/balance edits are LOCAL ONLY.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { JsonRpcProvider, keccak256, toQuantity } from "ethers";
import { prepareWorldAppDeployment, DEPLOYMENT_WALLET, CREATE_CALL, CREATE_CALL_CODE_HASH } from "./prepare-worldapp-deployment.mjs";
import { validateWorldAppDeploymentManifest } from "./lib/worldapp-deployment-manifest.mjs";
import { verifyYieldGeneration } from "./verify/yield-generation.mjs";
const baseline = JSON.parse(readFileSync(new URL("../../evidence/worldapp-deployment-nov03/manifest.json", import.meta.url)));
const socket = createServer(); await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const anvil = spawn(process.env.ANVIL_BINARY || "anvil", ["--port", String(port), "--chain-id", "480", "--fork-url",
  process.env.WORLDAPP_TEST_FORK_RPC || "https://worldchain-mainnet.g.alchemy.com/public", "--fork-block-number", String(baseline.observation.number), "--silent"], { stdio: "ignore" });
let spawnError; anvil.on("error", error => { spawnError = error; });
const provider = new JsonRpcProvider(`http://127.0.0.1:${port}`, 480, { batchMaxCount: 1, cacheTimeout: -1 });
try {
  for (let attempt = 0; ; attempt++) {
    if (spawnError) throw spawnError;
    try { await provider.send("eth_chainId", []); break; } catch (error) { if (attempt > 100) throw error; await sleep(100); }
  }
  const astArtifacts = process.env.AST_ARTIFACTS || "/tmp/yield-generation-ast-out";
  assert.equal(keccak256(await provider.getCode(CREATE_CALL)), CREATE_CALL_CODE_HASH);
  assert.notEqual(await provider.getCode(DEPLOYMENT_WALLET), "0x", "Fork must retain actual World App Safe code");
  // Funding and sender impersonation are limited to the disposable localhost fork.
  await provider.send("anvil_setBalance", [DEPLOYMENT_WALLET, "0x4563918244f40000"]);
  await provider.send("anvil_impersonateAccount", [DEPLOYMENT_WALLET]);
  const manifest = await prepareWorldAppDeployment({ provider, astArtifacts });
  validateWorldAppDeploymentManifest(manifest, manifest.manifestHash);
  const tampered = structuredClone(manifest); tampered.wallet = "0x" + "11".repeat(20);
  assert.throws(() => validateWorldAppDeploymentManifest(tampered, manifest.manifestHash), /digest/);
  for (const row of manifest.deployments) {
    assert.equal(row.status, "ready");
    const hash = await provider.send("eth_sendTransaction", [{ ...row.transaction, gas: toQuantity(BigInt(row.paddedGasLimit)) }]);
    const receipt = await provider.waitForTransaction(hash);
    assert.equal(receipt.status, 1);
    const verification = await verifyYieldGeneration({ provider, ...row.config, factoryAddress: row.predictedAddress,
      artifacts: astArtifacts, reviewedArtifacts: "out" });
    console.log(JSON.stringify({ kind: row.kind, from: DEPLOYMENT_WALLET, to: CREATE_CALL, predictedAddress: row.predictedAddress,
      gasEstimate: row.estimateGas, actualGasUsed: receipt.gasUsed.toString(), feeRecipient: row.config.feeRecipient,
      creationCodeHash: verification.reconstructedCreationCodeHash, verified: true }));
  }
  const repeated = await prepareWorldAppDeployment({ provider, astArtifacts });
  assert.ok(repeated.deployments.every(row => row.status === "already_deployed_verified"));
  assert.deepEqual(repeated.deployments.map(row => row.predictedAddress), manifest.deployments.map(row => row.predictedAddress));
  const proof = repeated.deployments[0].verification;
  const chunk = await provider.getCode(proof.firstCodePart);
  await provider.send("anvil_setCode", [proof.firstCodePart, chunk.slice(0, -2) + (chunk.endsWith("ff") ? "fe" : "ff")]);
  await assert.rejects(prepareWorldAppDeployment({ provider, astArtifacts }), /creation-code chunk mismatch/);
  console.log("PASS local fork: actual Safe sender CALL to canonical helper, both exact factories/config/chunks; deterministic rerun fully verifies existing deployments; corrupt existing generation rejected");
} finally { provider.destroy(); anvil.kill("SIGTERM"); }
