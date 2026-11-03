// Isolated read-only verifier regressions. Mutations occur only on disposable Anvil.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { ContractFactory, JsonRpcProvider } from "ethers";
import { verifyYieldGeneration } from "./verify/yield-generation.mjs";
const socket = createServer(); await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const anvil = spawn(process.env.ANVIL_BINARY || "anvil", ["--port", String(port), "--chain-id", "480", "--silent"], { stdio: "ignore" });
let spawnError; anvil.on("error", error => { spawnError = error; });
const provider = new JsonRpcProvider(`http://127.0.0.1:${port}`, 480, { batchMaxCount: 1, cacheTimeout: -1 });
try {
  for (let attempt = 0; ; attempt++) {
    if (spawnError) throw spawnError;
    try { await provider.send("eth_chainId", []); break; }
    catch (error) { if (attempt > 50) throw error; await sleep(100); }
  }
  const owner = await provider.getSigner(0), fee = await provider.getSigner(2);
  const artifact = name => JSON.parse(readFileSync(`out/${name}.sol/${name}.json`, "utf8"));
  const deploy = async (name, args) => {
    const a = artifact(name);
    const contract = await new ContractFactory(a.abi, a.bytecode.object, owner).deploy(...args);
    await contract.waitForDeployment(); return contract;
  };
  const wld = await deploy("MockERC20", ["WLD", "WLD"]);
  const usdc = await deploy("MockERC20", ["USDC", "USDC"]);
  const astOut = process.env.AST_ARTIFACTS;
  assert.ok(astOut, "Set AST_ARTIFACTS to isolated forge --ast artifact directory");
  for (const [kind, asset] of [["wld", wld], ["usdc", usdc]]) {
    const strategy = await deploy("MockERC4626", [await asset.getAddress()]);
    const childName = kind === "wld" ? "InheritanceVaultMorpho" : "InheritanceVaultUSDC";
    const args = kind === "wld" ? [await asset.getAddress(), await strategy.getAddress(), await fee.getAddress(), 1000]
      : [await asset.getAddress(), await strategy.getAddress(), await wld.getAddress(), await fee.getAddress(), 1000];
    const factory = await deploy(childName + "Factory", args);
    const config = { provider, factoryAddress: await factory.getAddress(), kind, asset: await asset.getAddress(),
      strategy: await strategy.getAddress(), feeRecipient: await fee.getAddress(), performanceFeeBps: 1000,
      rewardToken: await wld.getAddress(), artifacts: astOut, reviewedArtifacts: "out" };
    const verified = await verifyYieldGeneration(config);
    // Change one real stored child-code byte: runtime shape alone cannot prove this.
    const chunk = await provider.getCode(verified.firstCodePart);
    const corrupt = chunk.slice(0, -2) + (chunk.endsWith("ff") ? "fe" : "ff");
    await provider.send("anvil_setCode", [verified.firstCodePart, corrupt]);
    await assert.rejects(verifyYieldGeneration(config), /First STOP-prefixed creation-code chunk mismatch/);
    await provider.send("anvil_setCode", [verified.firstCodePart, chunk]);
    // Swap private chunk pointers in the helper immutable: comparing a masked
    // runtime or merely checking the two addresses exist would miss this mutation.
    const helperName = childName + "Deployer";
    const a = JSON.parse(readFileSync(`${astOut}/${helperName}.sol/${helperName}.json`, "utf8"));
    const definition = a.ast.nodes.find(node => node.nodeType === "ContractDefinition" && node.name === helperName);
    const id = definition.nodes.find(node => node.nodeType === "VariableDeclaration" && node.name === "firstCodePart").id;
    const originalHelper = await provider.getCode(verified.helperAddress);
    let tampered = originalHelper;
    for (const { start, length } of a.deployedBytecode.immutableReferences[String(id)]) {
      const at = 2 + start * 2;
      tampered = tampered.slice(0, at) + verified.secondCodePart.slice(2).toLowerCase().padStart(length * 2, "0") + tampered.slice(at + length * 2);
    }
    await provider.send("anvil_setCode", [verified.helperAddress, tampered]);
    await assert.rejects(verifyYieldGeneration(config), /Deployer runtime\/config\/chunk immutable mismatch/);
    await provider.send("anvil_setCode", [verified.helperAddress, originalHelper]);
    const lengthId = definition.nodes.find(node => node.nodeType === "VariableDeclaration" && node.name === "creationCodeLength").id;
    let wrongLength = originalHelper;
    for (const { start, length } of a.deployedBytecode.immutableReferences[String(lengthId)]) {
      const at = 2 + start * 2;
      const encoded = (BigInt(verified.creationCodeLength) + 1n).toString(16).padStart(length * 2, "0");
      wrongLength = wrongLength.slice(0, at) + encoded + wrongLength.slice(at + length * 2);
    }
    await provider.send("anvil_setCode", [verified.helperAddress, wrongLength]);
    await assert.rejects(verifyYieldGeneration(config), /Deployer runtime\/config\/chunk immutable mismatch/);
    await provider.send("anvil_setCode", [verified.helperAddress, originalHelper]);
    await assert.rejects(verifyYieldGeneration({ ...config, performanceFeeBps: 999 }), /Factory runtime\/config immutable mismatch/);
    await verifyYieldGeneration(config);
    console.log(`PASS ${kind}: exact reviewed generation, corrupt chunk rejected, private pointer/length immutables rejected, wrong fee config rejected`);
  }
} finally { provider.destroy(); anvil.kill("SIGTERM"); }
