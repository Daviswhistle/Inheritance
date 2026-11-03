// Isolated local-chain worst-case gas regression. No live RPC, signer or configuration.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { Contract, ContractFactory, JsonRpcProvider } from "ethers";
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
  const owner = await provider.getSigner(0), heir = await provider.getSigner(1), fee = await provider.getSigner(2);
  const ownerAddress = await owner.getAddress(), heirAddress = await heir.getAddress();
  const artifact = name => JSON.parse(readFileSync(`out/${name}.sol/${name}.json`, "utf8"));
  const deploy = async (name, args) => {
    const a = artifact(name);
    const contract = await new ContractFactory(a.abi, a.bytecode.object, owner).deploy(...args);
    await contract.waitForDeployment(); return contract;
  };
  const wld = await deploy("MockERC20", ["WLD", "WLD"]);
  const usdc = await deploy("MockERC20", ["USDC", "USDC"]);
  const vaults = [];
  for (const [name, asset] of [["InheritanceVaultMorpho", wld], ["InheritanceVaultUSDC", usdc]]) {
    const strategy = await deploy("MockERC4626", [await asset.getAddress()]);
    const factoryName = name + "Factory";
    const args = name === "InheritanceVaultMorpho"
      ? [await wld.getAddress(), await strategy.getAddress(), await fee.getAddress(), 1000]
      : [await usdc.getAddress(), await strategy.getAddress(), await wld.getAddress(), await fee.getAddress(), 1000];
    const factory = await deploy(factoryName, args);
    await (await factory.createVault(heirAddress, 86400)).wait();
    const vault = new Contract(await factory.vaultOf(ownerAddress), artifact(name).abi, owner);
    const principal = 1000n, idle = 100n;
    await (await asset.mint(ownerAddress, principal)).wait();
    await (await asset.approve(await factory.getAddress(), principal)).wait();
    await (await factory.depositWithMinShares(principal, principal)).wait();
    assert.equal(await vault.accountedShares(), principal, "Principal must be tracked, not donated receipts");
    await (await wld.mint(await vault.getAddress(), idle)).wait();
    await (await strategy.setGasFailure(true, true)).wait();
    vaults.push({ name, factory, vault, strategy, principal, idle });
  }
  // The canonical distributor consumes every gas unit forwarded by the bounded getter.
  await provider.send("anvil_setCode", ["0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae", "0x5b600056"]);
  await provider.send("evm_increaseTime", [86401]); await provider.send("evm_mine", []);
  for (const { factory, vault } of vaults) await (await factory.connect(heir).fileClaimFor(await vault.getAddress())).wait();
  await provider.send("evm_increaseTime", [7 * 86400 + 1]); await provider.send("evm_mine", []);
  for (const { name, factory, vault, strategy, principal, idle } of vaults) {
    const estimate = await factory.executeInheritance.estimateGas(await vault.getAddress());
    const padded = (estimate * 120n + 99n) / 100n;
    assert.ok(padded <= 900000n, `${name}: padded estimate ${padded} exceeds deployed cap`);
    const snapshot = await provider.send("evm_snapshot", []);
    const paddedReceipt = await (await factory.executeInheritance(await vault.getAddress(), { gasLimit: padded })).wait();
    assert.equal(paddedReceipt.status, 1);
    assert.equal(await provider.send("evm_revert", [snapshot]), true);
    const receipt = await (await factory.executeInheritance(await vault.getAddress(), { gasLimit: 900000n })).wait();
    assert.equal(receipt.status, 1);
    assert.equal(await strategy.balanceOf(heirAddress), principal);
    assert.equal(await strategy.balanceOf(await vault.getAddress()), 0n);
    assert.equal(await wld.balanceOf(await vault.getAddress()), idle);
    assert.equal(await vault.rewardsDeferred(), true);
    assert.equal((await vault.inheritanceRecipient()).toLowerCase(), heirAddress.toLowerCase());
    assert.equal(await vault.accountedShares(), 0n);
    assert.equal(await vault.costBasis(), 0n);
    console.log(JSON.stringify({ name, entrypoint: "factory.executeInheritance(vault)", estimateGas: estimate.toString(), padded20PercentGasLimit: padded.toString(), finalizerCap: 900000, receiptGasUsed: receipt.gasUsed.toString(), paddedReceiptGasUsed: paddedReceipt.gasUsed.toString(), fixedHeirShares: principal.toString(), heldUnknownWLD: idle.toString(), rewardsDeferred: true }));
  }
  console.log("PASS simultaneous reward getter, strategy redeem and receipt valuation gas exhaustion within deployed finalizer cap");
} finally { provider.destroy(); anvil.kill("SIGTERM"); }
