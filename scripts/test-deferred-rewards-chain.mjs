// Disposable Anvil validation using the exact frontend quote/receipt helpers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { ContractFactory, JsonRpcProvider, Contract } from "ethers";
import { createServer as createVite } from "../app/node_modules/vite/dist/node/index.js";
const socket = createServer(); await new Promise(r => socket.listen(0, "127.0.0.1", r));
const port = socket.address().port; await new Promise(r => socket.close(r));
const processAnvil = spawn(process.env.ANVIL_BINARY || "anvil", ["--port", String(port), "--chain-id", "480", "--silent"], { stdio: "ignore" });
let spawnError; processAnvil.on("error", error => { spawnError = error; });
const provider = new JsonRpcProvider(`http://127.0.0.1:${port}`, 480, { batchMaxCount: 1, cacheTimeout: -1 });
let vite;
try {
  for (let i = 0; ; i++) {
    if (spawnError) throw spawnError;
    try { await provider.send("eth_chainId", []); break; } catch (error) { if (i > 50) throw error; await sleep(100); }
  }
  const owner = await provider.getSigner(0), heir = await provider.getSigner(1), fee = await provider.getSigner(2);
  const ownerAddress = await owner.getAddress(), heirAddress = await heir.getAddress();
  const artifact = name => JSON.parse(readFileSync(`out/${name}.sol/${name}.json`, "utf8"));
  const deploy = async (name, args) => { const a = artifact(name); const c = await new ContractFactory(a.abi, a.bytecode.object, owner).deploy(...args); await c.waitForDeployment(); return c; };
  const wld = await deploy("MockERC20", ["WLD", "WLD"]), usdc = await deploy("MockERC20", ["USDC", "USDC"]);
  const strategy = await deploy("MockERC4626", [await wld.getAddress()]);
  const wldVault = await deploy("InheritanceVaultMorpho", [ownerAddress, heirAddress, await wld.getAddress(), 86400, ownerAddress, await strategy.getAddress(), await fee.getAddress(), 1000]);
  const distributor = "0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae";
  await provider.send("anvil_setCode", [distributor, artifact("MockMerklDistributor").deployedBytecode.object]);
  await (await wld.mint(ownerAddress, 1000n)).wait(); await (await wld.approve(await strategy.getAddress(), 1000n)).wait();
  await (await strategy.deposit(1000n, await wldVault.getAddress())).wait();
  await (await wld.mint(await wldVault.getAddress(), 100n)).wait();
  await provider.send("anvil_setCode", [distributor, "0x60006000fd"]);
  vite = await createVite({ root: process.cwd() + "/app", configFile: false, logLevel: "error", optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } });
  const ui = await vite.ssrLoadModule("/src/yield.ts");
  const quoted = await ui.readExitPosition({ position: () => wldVault.position(), principalPosition: () => wldVault.principalPosition() });
  assert.equal(quoted.rewardsUnknown, true); assert.equal(quoted.quote.net, 1000n);
  await (await wldVault.ownerWithdrawAllWLD(ownerAddress, ui.minimumOutput(quoted.quote.net))).wait();
  assert.equal(await strategy.balanceOf(await wldVault.getAddress()), 0n);
  assert.equal(await wld.balanceOf(await wldVault.getAddress()), 100n, "Unknown idle WLD must remain visibly recoverable");
  const usdcStrategy = await deploy("MockERC4626", [await usdc.getAddress()]);
  const vault = await deploy("InheritanceVaultUSDC", [ownerAddress, heirAddress, await usdc.getAddress(), await wld.getAddress(), 86400, ownerAddress, await usdcStrategy.getAddress(), await fee.getAddress(), 1000]);
  await (await usdc.mint(await vault.getAddress(), 500n)).wait(); await (await wld.mint(await vault.getAddress(), 50n)).wait();
  await provider.send("evm_increaseTime", [86401]); await provider.send("evm_mine", []);
  await (await vault.connect(heir).fileClaim()).wait();
  await provider.send("evm_increaseTime", [7 * 86400 + 1]); await provider.send("evm_mine", []);
  await (await vault.connect(heir).finalizeClaim()).wait();
  assert.equal(await usdc.balanceOf(heirAddress), 500n); assert.equal(await ui.readRewardsDeferred(vault), true);
  await (await wld.mint(await vault.getAddress(), 25n)).wait();
  await provider.send("anvil_setCode", [distributor, artifact("MockMerklDistributor").deployedBytecode.object]);
  assert.equal(await vault.unprocessedRewards(), 0n);
  const result = await (await vault.processRewards(0)).wait();
  assert.equal(ui.verifiesDeferredSettlement(result.logs, await vault.getAddress(), heirAddress), true);
  assert.equal(await vault.rewardsDeferred({ blockTag: result.blockNumber }), false);
  assert.equal(await wld.balanceOf(await vault.getAddress(), { blockTag: result.blockNumber }), 0n);
  assert.equal(await wld.balanceOf(heirAddress), 75n, "Deferred epoch gifts all follow fixed heir");
  console.log("PASS actual-chain retained WLD principal exit and zero-canonical deferred gift reconciliation via frontend helpers");
} finally { if (vite) await vite.close(); provider.destroy(); processAnvil.kill("SIGTERM"); }
