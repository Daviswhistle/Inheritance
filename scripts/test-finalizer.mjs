// Local-only integration: an ephemeral Anvil, a genuine SQLite/D1 shim and an HTTP
// proxy that can hide receipts, delay finality or interrupt a broadcast response.
// Anvil's finalized head is mapped to latest by default for immediate fixtures;
// reorg tests pin it behind the receipt. No mainnet RPC or transaction.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  AbiCoder, Contract, ContractFactory, HDNodeWallet, Interface, JsonRpcProvider, Transaction, formatEther, parseEther, parseUnits, keccak256,
  ZeroAddress,
} from "ethers";
import { readFinalizerHealth, runFinalizerCycle } from "../backend/src/finalizer.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const deploymentWorkflow = readFileSync(root + "/.github/workflows/deploy.yml", "utf8");
const yieldDeploymentGas = deploymentWorkflow.match(/YIELD_EXECUTION_GAS=(\d+)/)[1];
const usdcDeploymentGas = deploymentWorkflow.match(/USDC_EXECUTION_GAS=(\d+)/)[1];
const artifact = (file, name = file) =>
  JSON.parse(readFileSync(root + "/out/" + file + ".sol/" + name + ".json", "utf8"));
const tokenArtifact = artifact("MockERC20");
const factoryArtifact = artifact("InheritanceVaultWLDFactoryOnePerOwner");
const usdcArtifact = artifact("MockUSDCYield", "MockUSDC");
const usdcFactoryArtifact = artifact("MockUSDCYield", "MockUSDCYieldFactory");
const usdcVaultArtifact = artifact("MockUSDCYield", "MockUSDCYieldVault");
const legacyArtifact = artifact("InheritanceAutomation.t", "LegacyAutomationFactory");
const factoryInterface = new Interface(factoryArtifact.abi);
const usdcVaultInterface = new Interface(usdcVaultArtifact.abi);
const selector = factoryInterface.getFunction("executeInheritance").selector;
const mnemonic = "test test test test test test test test test test test junk"; // Anvil's public fixture.
const keeper = HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/2");
let assertions = 0;
const check = (name, callback) => { callback(); assertions++; console.log("PASS " + name); };

async function unusedPort() {
  const socket = createNetServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}
const port = await unusedPort();
const upstream = "http://127.0.0.1:" + port;
const anvil = spawn("anvil", ["--port", String(port), "--chain-id", "31337",
  "--accounts", "20", "--mnemonic", mnemonic, "--silent"], { stdio: "ignore" });
let proxy;
let provider;
let deploymentGas;
const behavior = { sends: [], requests: 0, hiddenReceipts: false, droppedResponse: false,
  chainId: null, oracleQuote: null, receiptExtra: null, renewedBeforeSimulation: null,
  rpcErrorMethod: null, historicalReadErrorSelector: null, finalizedBlock: null, requestLimit: null };
try {
  for (let i = 0; ; i++) {
    try {
      await fetch(upstream, { method: "POST", body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [],
      }) });
      break;
    } catch {
      if (i > 100 || anvil.exitCode !== null) throw new Error("local Anvil did not start");
      await delay(50);
    }
  }
  proxy = createServer(async (request, response) => {
    try {
      let raw = "";
      for await (const part of request) raw += part;
      const call = JSON.parse(raw);
      behavior.requests++;
      const historicalReadError = behavior.historicalReadErrorSelector && call.method === "eth_call" &&
        call.params[1] !== "latest" && call.params[0].data?.startsWith(behavior.historicalReadErrorSelector);
      if (historicalReadError || call.method === behavior.rpcErrorMethod || behavior.requestLimit != null && behavior.requests > behavior.requestLimit) {
        response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id,
          error: { code: -32000, message: "Local fixture RPC unavailable" } }));
        return;
      }
      if (call.method === "eth_chainId" && behavior.chainId) {
        response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: behavior.chainId }));
        return;
      }
      if (call.method === "eth_getBlockByNumber" && call.params[0] === "finalized") {
        call.params[0] = behavior.finalizedBlock ?? "latest";
        raw = JSON.stringify(call);
      }
      if (call.method === "eth_call" &&
          call.params[0].to?.toLowerCase() === "0x420000000000000000000000000000000000000f" &&
          behavior.oracleQuote != null) {
        response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id,
          result: "0x" + BigInt(behavior.oracleQuote).toString(16).padStart(64, "0") }));
        return;
      }
      if (call.method === "eth_call" &&
          call.params[0].data?.startsWith(selector) &&
          behavior.renewedBeforeSimulation &&
          !call.params[0].data.endsWith("0".repeat(40))) {
        const renew = behavior.renewedBeforeSimulation;
        behavior.renewedBeforeSimulation = null;
        await renew();
      }
      if (call.method === "eth_sendRawTransaction") {
        const tx = Transaction.from(call.params[0]);
        behavior.sends.push({ to: tx.to, data: tx.data, value: tx.value, chainId: tx.chainId,
          nonce: tx.nonce, hash: tx.hash, raw: call.params[0] });
      }
      let output = await (await fetch(upstream, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: raw,
      })).json();
      if (call.method === "eth_sendRawTransaction" && output.result) {
        // The default fixture models synchronous local automining. Anvil may
        // acknowledge a hash before its receipt is indexed on a slower runner.
        // Wait on the actual upstream chain, without inventing a receipt or
        // adding client RPCs. Explicit receipt hiding still tests pending jobs.
        await waitForCanonicalReceipt(output.result);
      }
      if (call.method === "eth_sendRawTransaction" && behavior.droppedResponse) {
        behavior.droppedResponse = false;
        response.destroy(); // The node accepted it; the caller receives no acknowledgement.
        return;
      }
      if (call.method === "eth_getTransactionReceipt" && behavior.hiddenReceipts) output.result = null;
      if (call.method === "eth_getTransactionReceipt" && output.result && behavior.receiptExtra != null) {
        output.result.l1Fee = "0x" + BigInt(behavior.receiptExtra).toString(16);
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(output));
    } catch { response.statusCode = 500; response.end("{}"); }
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const rpcUrl = "http://127.0.0.1:" + proxy.address().port;
  provider = new JsonRpcProvider(upstream, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  const owner = await provider.getSigner(0);
  const heir = await provider.getSigner(1);
  const keeperAddress = keeper.address;
  const heirAddress = await heir.getAddress();

  function storage() {
    const native = new DatabaseSync(":memory:");
    native.exec("CREATE TABLE watchers (vault_address TEXT PRIMARY KEY, active INTEGER NOT NULL)");
    const faults = { expireLeaseAfterStage: false, failStageWrite: false,
      dropStageAcknowledgement: false, loseLeaseBeforeStage: false, reservations: 0 };
    const DB = {
      prepare(sql) {
        const statement = native.prepare(sql);
        let args = [];
        const self = {
          bind(...values) { args = values; return self; },
          _run() {
            if (faults.failStageWrite && sql.startsWith("UPDATE finalizer_jobs SET state='pending',tx_hash=")) {
              faults.failStageWrite = false;
              throw new Error("Local fixture D1 stage write failed");
            }
            const result = statement.run(...args);
            if (result.changes === 1 && sql.startsWith("UPDATE finalizer_budget SET spent_wei=spent_wei+")) {
              faults.reservations++;
            }
            if (faults.expireLeaseAfterStage && sql.startsWith("UPDATE finalizer_jobs SET state='pending',tx_hash=")) {
              faults.expireLeaseAfterStage = false;
              native.prepare("UPDATE finalizer_locks SET lease_until=0").run();
            }
            return { success: true, meta: { changes: Number(result.changes) } };
          },
          async run() { return self._run(); },
          async first() { return statement.get(...args) || null; },
          async all() { return { results: statement.all(...args), success: true }; },
        };
        return self;
      },
      async batch(statements) {
        if (faults.loseLeaseBeforeStage && statements.length === 3) {
          faults.loseLeaseBeforeStage = false;
          native.prepare("UPDATE finalizer_locks SET lease_token='another-cycle'").run();
        }
        const reservations = faults.reservations;
        native.exec("BEGIN");
        let results;
        try { results = statements.map((statement) => statement._run()); native.exec("COMMIT"); }
        catch (error) { native.exec("ROLLBACK"); faults.reservations = reservations; throw error; }
        if (faults.dropStageAcknowledgement && statements.length === 3 &&
            native.prepare("SELECT 1 FROM finalizer_jobs WHERE state='pending' AND tx_raw IS NOT NULL").get()) {
          faults.dropStageAcknowledgement = false;
          throw new Error("Local fixture D1 committed but acknowledgement was lost");
        }
        return results;
      },
    };
    return { DB, native, faults };
  }
  async function deploy(art, signer, args) {
    const contract = await new ContractFactory(art.abi, art.bytecode.object, signer).deploy(...args);
    await contract.waitForDeployment();
    if (art === factoryArtifact && deploymentGas == null) {
      deploymentGas = (await contract.deploymentTransaction().wait()).gasUsed;
    }
    return contract;
  }
  async function fixture(count = 1, ready = true) {
    const token = await deploy(tokenArtifact, owner, ["Worldcoin", "WLD"]);
    const factory = await deploy(factoryArtifact, owner, [await token.getAddress()]);
    const store = storage();
    const vaults = [];
    const owners = [];
    for (let i = 0; i < count; i++) {
      const signer = await provider.getSigner(i + 3);
      owners.push(signer);
      await (await factory.connect(signer).createVault(heirAddress, 86400)).wait();
      const vault = await factory.vaultOf(await signer.getAddress());
      vaults.push(vault);
      await (await token.mint(vault, parseEther("100"))).wait();
      store.native.prepare("INSERT INTO watchers VALUES (?,1)").run(vault);
    }
    if (ready) {
      await provider.send("evm_increaseTime", [86400]); await provider.send("evm_mine", []);
      for (const vault of vaults) await (await factory.connect(heir).fileClaimFor(vault)).wait();
      await provider.send("evm_increaseTime", [7 * 86400]); await provider.send("evm_mine", []);
    }
    const env = { DB: store.DB, FINALIZER_ENABLED: "true", RPC_URL: rpcUrl,
      FACTORY_ADDRESS: await factory.getAddress(), WLD_ADDRESS: await token.getAddress(),
      FINALIZER_PRIVATE_KEY: keeper.privateKey, FINALIZER_CHAIN_ID: "31337",
      FINALIZER_MAX_FEE_GWEI: "10", FINALIZER_DAILY_GAS_CAP_ETH: "0.1",
      FINALIZER_EXTRA_FEE_RESERVE_ETH: "0" };
    return { token, factory, vaults, owners, env, store };
  }

  async function stageWithoutBroadcast(f) {
    const start = behavior.sends.length;
    f.store.faults.expireLeaseAfterStage = true;
    const result = await runFinalizerCycle(f.env);
    assert.equal(result.reason, "lease_lost", JSON.stringify(result));
    assert.equal(behavior.sends.length, start);
    const job = f.store.native.prepare("SELECT * FROM finalizer_jobs WHERE state='pending'").get();
    assert.ok(job?.tx_raw);
    assert.equal(Transaction.from(job.tx_raw).hash, job.tx_hash);
    return job;
  }

  async function mineCanonicalReplay(hash) {
    await provider.send("evm_mine", []);
    return waitForCanonicalReceipt(hash);
  }

  async function waitForCanonicalReceipt(hash) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const receipt = await provider.send("eth_getTransactionReceipt", [hash]);
      if (receipt) {
        const block = await provider.send("eth_getBlockByNumber", [receipt.blockNumber, false]);
        if (block?.hash === receipt.blockHash) return receipt;
      }
      await delay(25);
    }
    throw new Error("Local automining did not produce a canonical receipt");
  }

  async function yieldFixture({ cash = true, ready = true, mixed = false } = {}) {
    const f = await fixture(mixed ? 1 : 0, false);
    await provider.send("anvil_setCode", ["0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae", artifact("MockMerklDistributor").deployedBytecode.object]);
    const morpho = await deploy(artifact("MockERC4626"), owner, [f.env.WLD_ADDRESS]);
    const yieldFactory = await deploy(artifact("InheritanceVaultMorphoFactory"), owner,
      [f.env.WLD_ADDRESS, await morpho.getAddress(), await owner.getAddress(), 1000]);
    const signer = await provider.getSigner(3);
    const signerAddress = await signer.getAddress();
    await (await yieldFactory.connect(signer).createVault(heirAddress, 86400)).wait();
    const vault = await yieldFactory.vaultOf(signerAddress);
    await (await f.token.mint(signerAddress, parseEther("100"))).wait();
    await (await f.token.connect(signer).approve(await yieldFactory.getAddress(), parseEther("100"))).wait();
    await (await yieldFactory.connect(signer).depositWithMinShares(parseEther("100"), parseEther("100"))).wait();
    await (await morpho.setRate(parseEther("1.1"))).wait();
    await (await f.token.mint(await morpho.getAddress(), parseEther("10"))).wait();
    if (!cash) await (await morpho.setLiquidity(0)).wait();
    f.store.native.prepare("INSERT INTO watchers VALUES (?,1)").run(vault);
    if (ready) {
      await provider.send("evm_increaseTime", [86400]); await provider.send("evm_mine", []);
      for (const base of f.vaults) await (await f.factory.connect(heir).fileClaimFor(base)).wait();
      await (await yieldFactory.connect(heir).fileClaimFor(vault)).wait();
      await provider.send("evm_increaseTime", [7 * 86400]); await provider.send("evm_mine", []);
    }
    Object.assign(f.env, { YIELD_FACTORY_ADDRESS: await yieldFactory.getAddress(),
      MORPHO_VAULT_ADDRESS: await morpho.getAddress(), FINALIZER_MAX_GAS: yieldDeploymentGas, FINALIZER_BATCH_SIZE: "1" });
    return { ...f, morpho, yieldFactory, yieldVault: vault, vaults: mixed ? [...f.vaults, vault] : [vault] };
  }

  async function usdcFixture({ settlement = 0, ready = true, known = true,
    factoryAsset = null, factoryReward = null, factoryStrategy = null } = {}) {
    const f = await fixture(0, false);
    const wldMorpho = await deploy(artifact("MockERC4626"), owner, [f.env.WLD_ADDRESS]);
    const wldYieldFactory = await deploy(artifact("InheritanceVaultMorphoFactory"), owner,
      [f.env.WLD_ADDRESS, await wldMorpho.getAddress(), await owner.getAddress(), 1000]);
    const usdc = await deploy(usdcArtifact, owner, []);
    const morpho = await deploy(artifact("MockERC4626"), owner, [await usdc.getAddress()]);
    const strategy = factoryStrategy || await morpho.getAddress();
    const usdcYieldFactory = await deploy(usdcFactoryArtifact, owner, [
      factoryAsset || await usdc.getAddress(), strategy, factoryReward || f.env.WLD_ADDRESS,
      await owner.getAddress(), 1000,
    ]);
    const signer = await provider.getSigner(3);
    await (await usdcYieldFactory.connect(signer).createVault(heirAddress)).wait();
    const vaultAddress = await usdcYieldFactory.vaultOf(await signer.getAddress());
    const vault = new Contract(vaultAddress, usdcVaultArtifact.abi, owner);
    const cashAmount = 100_000_000n;
    if (settlement === 0) await (await usdc.mint(vaultAddress, cashAmount)).wait();
    if (settlement === 1) await (await morpho.mint(vaultAddress, parseEther("100"))).wait();
    if (settlement === 2) await (await f.token.mint(vaultAddress, parseEther("10"))).wait();
    await (await vault.setTestState(ready, true, settlement)).wait();
    if (!known) await (await usdcYieldFactory.setKnownVault(vaultAddress, false)).wait();
    f.store.native.prepare("INSERT INTO watchers VALUES (?,1)").run(vaultAddress);
    Object.assign(f.env, {
      YIELD_FACTORY_ADDRESS: await wldYieldFactory.getAddress(),
      MORPHO_VAULT_ADDRESS: await wldMorpho.getAddress(),
      USDC_YIELD_FACTORY_ADDRESS: await usdcYieldFactory.getAddress(),
      USDC_MORPHO_VAULT_ADDRESS: await morpho.getAddress(),
      USDC_ADDRESS: await usdc.getAddress(), FINALIZER_MAX_GAS: usdcDeploymentGas,
      FINALIZER_BATCH_SIZE: "5", FINALIZER_SCAN_LIMIT: "20",
    });
    return { ...f, usdc, morpho, wldMorpho, wldYieldFactory, usdcYieldFactory, usdcVault: vaultAddress, vault,
      cashAmount, settlement, vaults: [vaultAddress] };
  }

  async function productionUSDCFixture(mode) {
    const f = await fixture(0, false);
    const distributorAddress = "0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae";
    const distributorArtifact = artifact("MockMerklDistributor");
    await provider.send("anvil_setCode", [distributorAddress, distributorArtifact.deployedBytecode.object]);
    const wldMorpho = await deploy(artifact("MockERC4626"), owner, [f.env.WLD_ADDRESS]);
    const wldYieldFactory = await deploy(artifact("InheritanceVaultMorphoFactory"), owner,
      [f.env.WLD_ADDRESS, await wldMorpho.getAddress(), await owner.getAddress(), 1000]);
    const usdc = await deploy(artifact("MockRe7USDC", "MockUSDC"), owner, []);
    const morpho = await deploy(artifact("MockRe7USDC"), owner, [await usdc.getAddress()]);
    const feeRecipient = await owner.getAddress();
    const usdcYieldFactory = await deploy(artifact("InheritanceVaultUSDCFactory"), owner,
      [await usdc.getAddress(), await morpho.getAddress(), f.env.WLD_ADDRESS, feeRecipient, 1000]);
    const signer = await provider.getSigner(3), signerAddress = await signer.getAddress();
    await (await usdcYieldFactory.connect(signer).createVault(heirAddress, 86400)).wait();
    const vaultAddress = await usdcYieldFactory.vaultOf(signerAddress);
    const vault = new Contract(vaultAddress, artifact("InheritanceVaultUSDC").abi, owner);
    if (mode !== "reward-only") {
      await (await usdc.mint(signerAddress, 100_000000n)).wait();
      await (await usdc.connect(signer).approve(await usdcYieldFactory.getAddress(), 100_000000n)).wait();
      await (await usdcYieldFactory.connect(signer).depositWithMinShares(100_000000n, parseEther("100"))).wait();
      await (await morpho.setRate(mode === "total-loss" ? 0n : 1_100000n)).wait();
      await (await usdc.mint(await morpho.getAddress(), 10_000000n)).wait();
    }
    if (mode !== "total-loss") {
      const distributor = new Contract(distributorAddress, distributorArtifact.abi, owner);
      const reward = parseEther("10");
      const leaf = keccak256(AbiCoder.defaultAbiCoder().encode(["address", "address", "uint256"],
        [vaultAddress, f.env.WLD_ADDRESS, reward]));
      const sibling = keccak256(new TextEncoder().encode("production USDC keeper reward fixture"));
      const root = keccak256(AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [leaf, sibling].sort()));
      await (await distributor.setRoot(root)).wait();
      await (await f.token.mint(distributorAddress, reward)).wait();
      await (await usdcYieldFactory.claimRewardsFor(vaultAddress, reward, [sibling], 0)).wait();
    }
    if (mode === "shares") await (await morpho.setLiquidity(0)).wait();
    if (mode === "exhausted-strategy") await (await morpho.setGasFailure(true, true)).wait();
    await provider.send("evm_increaseTime", [86400]); await provider.send("evm_mine", []);
    await (await usdcYieldFactory.connect(heir).fileClaimFor(vaultAddress)).wait();
    await provider.send("evm_increaseTime", [7 * 86400]); await provider.send("evm_mine", []);
    f.store.native.prepare("INSERT INTO watchers VALUES (?,1)").run(vaultAddress);
    Object.assign(f.env, { YIELD_FACTORY_ADDRESS: await wldYieldFactory.getAddress(), MORPHO_VAULT_ADDRESS: await wldMorpho.getAddress(),
      USDC_YIELD_FACTORY_ADDRESS: await usdcYieldFactory.getAddress(), USDC_MORPHO_VAULT_ADDRESS: await morpho.getAddress(),
      USDC_ADDRESS: await usdc.getAddress(), FINALIZER_MAX_GAS: usdcDeploymentGas,
      FINALIZER_SCAN_LIMIT: "20", FINALIZER_BATCH_SIZE: "5" });
    return { ...f, usdc, morpho, vault, vaultAddress, feeRecipient };
  }

  check("default configuration cannot send", () => {
    assert.equal(behavior.sends.length, 0);
  });
  assert.deepEqual(await runFinalizerCycle({}), { enabled: false, reason: "disabled" });
  assertions++;

  {
    const f = await fixture(1, false);
    f.env.FINALIZER_EXTRA_FEE_RESERVE_ETH = "0.000001";
    const extra = parseEther(f.env.FINALIZER_EXTRA_FEE_RESERVE_ETH);
    await provider.send("anvil_setBalance", [keeperAddress, "0x" + (extra + 1n).toString(16)]);
    await runFinalizerCycle(f.env);
    const low = await readFinalizerHealth(f.env);
    await provider.send("anvil_setBalance", [keeperAddress, "0x" + parseEther("10000").toString(16)]);
    const funded = await readFinalizerHealth(f.env);
    check("idle readiness requires execution gas in addition to the extra reserve", () => {
      assert.equal(low.lastCycleReason, "idle");
      assert.equal(low.reason, "insufficient_gas");
      assert.equal(low.funded, false);
      assert.ok(BigInt(low.requiredReserveWei) > extra + 1n);
      assert.equal(funded.reason, "ready");
      assert.equal(funded.funded, true);
    });
  }

  {
    const f = await fixture(1, false);
    f.env.FINALIZER_EXTRA_FEE_RESERVE_ETH = "0.000001";
    const extra = parseEther(f.env.FINALIZER_EXTRA_FEE_RESERVE_ETH);
    f.env.FINALIZER_DAILY_GAS_CAP_ETH = formatEther(extra + 1n);
    await runFinalizerCycle(f.env);
    const capped = await readFinalizerHealth(f.env);
    f.env.FINALIZER_DAILY_GAS_CAP_ETH = "0.1";
    const restored = await readFinalizerHealth(f.env);
    check("idle readiness includes execution gas in its remaining daily budget", () => {
      assert.equal(capped.lastCycleReason, "idle");
      assert.equal(capped.reason, "daily_cap");
      assert.equal(capped.funded, true);
      assert.ok(BigInt(capped.requiredReserveWei) > BigInt(capped.dailyRemainingWei));
      assert.equal(restored.reason, "ready");
    });
  }

  {
    const f = await fixture(0, false);
    const before = f.store.native.prepare("SELECT total_changes() AS n").get().n;
    const cold = await readFinalizerHealth(f.env);
    check("health without completed cron evidence is not_running and creates no schema", () => {
      assert.equal(cold.reason, "not_running", JSON.stringify(cold));
      assert.equal(cold.lastCycleAt, null);
      assert.equal(f.store.native.prepare("SELECT total_changes() AS n").get().n, before);
      assert.equal(f.store.native.prepare("SELECT name FROM sqlite_master WHERE name='finalizer_locks'").get(), undefined);
    });
    await runFinalizerCycle(f.env);
    const healthy = await readFinalizerHealth(f.env);
    check("completed idle cycle supplies timestamp and outcome evidence", () => {
      assert.equal(healthy.reason, "ready", JSON.stringify(healthy));
      assert.equal(healthy.lastCycleReason, "idle");
      assert.ok(Date.now() - Date.parse(healthy.lastCycleAt) < 60_000);
    });
    f.store.native.prepare("UPDATE finalizer_locks SET last_cycle_at=NULL,last_cycle_reason='running'").run();
    const interruptedFirst = await readFinalizerHealth(f.env);
    check("an interrupted first cron remains not_running even after it acquired its lock", () => {
      assert.equal(interruptedFirst.reason, "not_running", JSON.stringify(interruptedFirst));
      assert.equal(interruptedFirst.lastCycleReason, "running");
    });
    await runFinalizerCycle(f.env);
    // Models a cron that is repeatedly killed after taking its lock: starts are
    // recent, but no invocation has completed since the previous recorded cycle.
    f.store.native.prepare("UPDATE finalizer_locks SET last_cycle_at=?,last_cycle_reason='running',lease_until=?")
      .run(new Date(Date.now() - 7 * 60_000).toISOString(), Date.now() + 120_000);
    const stale = await readFinalizerHealth(f.env);
    check("recent lock start cannot hide missing completed cycles older than six minutes", () => {
      assert.equal(stale.reason, "stale", JSON.stringify(stale));
      assert.equal(stale.cycleFresh, false);
    });
  }

  {
    const f = await fixture(0, false);
    f.env.FINALIZER_EXTRA_FEE_RESERVE_ETH = "0.000001";
    f.env.FINALIZER_DAILY_GAS_CAP_ETH = "0.001";
    await runFinalizerCycle(f.env);
    const scope = "31337:" + keeperAddress.toLowerCase();
    const cap = parseEther(f.env.FINALIZER_DAILY_GAS_CAP_ETH);
    const extra = parseEther(f.env.FINALIZER_EXTRA_FEE_RESERVE_ETH);
    const today = new Date().toISOString().slice(0, 10);
    f.store.native.prepare("INSERT INTO finalizer_budget(scope,day,spent_wei) VALUES(?,?,?)")
      .run(scope, today, Number(cap - extra + 1n));
    const capped = await readFinalizerHealth(f.env);
    check("idle health exposes a daily budget too small for mandatory fee reserve", () => {
      assert.equal(capped.reason, "daily_cap", JSON.stringify(capped));
      assert.equal(capped.lastCycleReason, "idle");
      assert.equal(capped.recentFailure, null);
      assert.equal(capped.dailyRemainingWei, (extra - 1n).toString());
    });
    f.store.native.prepare("UPDATE finalizer_budget SET spent_wei=?").run(Number(cap - extra));
    const exactReserve = await readFinalizerHealth(f.env);
    check("exactly the extra reserve still cannot fund positive transaction gas", () => {
      assert.equal(exactReserve.reason, "daily_cap", JSON.stringify(exactReserve));
    });
    // Preserve the previous day's ledger while modeling the next UTC budget day.
    f.store.native.prepare("UPDATE finalizer_budget SET day=?")
      .run(new Date(Date.now() - 86400_000).toISOString().slice(0, 10));
    const renewed = await readFinalizerHealth(f.env);
    check("previous UTC day spending does not block the next day's service", () => {
      assert.equal(renewed.reason, "ready", JSON.stringify(renewed));
      assert.equal(renewed.dailyReservedWei, "0");
      assert.equal(renewed.dailyRemainingWei, cap.toString());
    });
  }

  {
    const f = await fixture(0, false);
    f.store.native.exec("CREATE TABLE finalizer_locks (scope TEXT PRIMARY KEY, lease_token TEXT NOT NULL, lease_until INTEGER NOT NULL, halted INTEGER NOT NULL DEFAULT 0, cursor_address TEXT NOT NULL DEFAULT '', last_error TEXT)");
    const scope = "31337:" + keeperAddress.toLowerCase();
    f.store.native.prepare("INSERT INTO finalizer_locks (scope,lease_token,lease_until) VALUES (?,?,0)")
      .run(scope, "legacy_fixture");
    const before = f.store.native.prepare("SELECT total_changes() AS n").get().n;
    assert.equal((await readFinalizerHealth(f.env)).reason, "not_running");
    assert.equal(f.store.native.prepare("SELECT total_changes() AS n").get().n, before);
    assert.equal(f.store.native.prepare("PRAGMA table_info(finalizer_locks)").all().length, 6);
    const cycles = await Promise.all([runFinalizerCycle(f.env), runFinalizerCycle(f.env)]);
    const row = f.store.native.prepare("SELECT * FROM finalizer_locks").get();
    check("overlapping cycles safely extend an old lock schema without replacing its row", () => {
      assert.ok(cycles.some((cycle) => cycle.reason === "idle"), JSON.stringify(cycles));
      assert.equal(row.scope, scope);
      assert.ok(row.last_cycle_at);
      assert.equal(row.last_cycle_reason, "idle");
      assert.equal(f.store.native.prepare("SELECT COUNT(*) AS n FROM finalizer_locks").get().n, 1);
      assert.equal(f.store.native.prepare("PRAGMA table_info(finalizer_locks)").all().length, 8);
    });
  }

  {
    const f = await fixture(0, false);
    behavior.rpcErrorMethod = "eth_call";
    const failed = await runFinalizerCycle(f.env);
    behavior.rpcErrorMethod = null;
    const health = await readFinalizerHealth(f.env);
    check("RPC failure before network validation still records a failed completed cycle", () => {
      assert.equal(failed.reason, "rpc_error", JSON.stringify(failed));
      assert.equal(health.reason, "rpc_error", JSON.stringify(health));
      assert.equal(health.lastCycleReason, "rpc_error");
      assert.ok(health.lastCycleAt);
    });
    await runFinalizerCycle(f.env);
    assert.equal((await readFinalizerHealth(f.env)).reason, "ready");
  }

  {
    const f = await fixture();
    const start = behavior.sends.length;
    const beforeRequests = behavior.requests;
    const result = await runFinalizerCycle(f.env);
    check("keeper executes and only stored heir receives full WLD", () => {
      assert.equal(result.finalized, 1, JSON.stringify(result));
      assert.equal(result.submitted, 1);
      assert.equal(behavior.sends.length - start, 1);
    });
    check("single eligible cycle fits 50 external RPC requests", () => {
      assert.ok(behavior.requests - beforeRequests <= 50, String(behavior.requests - beforeRequests));
      console.log("  RPC requests: " + (behavior.requests - beforeRequests));
    });
    assert.equal(await f.token.balanceOf(heirAddress), parseEther("100"));
    assert.equal(await f.token.balanceOf(keeperAddress), 0n);
    const tx = behavior.sends.at(-1);
    check("signed request has fixed factory, function, chain and zero ETH value", () => {
      assert.equal(tx.to.toLowerCase(), f.env.FACTORY_ADDRESS.toLowerCase());
      assert.equal(tx.value, 0n);
      assert.equal(tx.chainId, 31337n);
      assert.ok(tx.data.startsWith(selector));
      assert.equal(factoryInterface.decodeFunctionData("executeInheritance", tx.data)[0], f.vaults[0]);
    });
    const second = await runFinalizerCycle(f.env);
    check("settled claim is idempotent and budget accounts real receipt", () => {
      assert.equal(second.submitted, 0);
      assert.equal(behavior.sends.length - start, 1);
      assert.equal(f.store.native.prepare("SELECT state FROM finalizer_jobs").get().state, "confirmed");
      const budget = f.store.native.prepare("SELECT spent_wei FROM finalizer_budget").get();
      assert.ok(budget.spent_wei > 0);
    });
    const health = await readFinalizerHealth(f.env);
    check("health exposes readiness but no signer secret or RPC URL", () => {
      assert.equal(health.reason, "ready");
      assert.equal(health.signerAddress, keeperAddress);
      assert.ok(!JSON.stringify(health).includes(keeper.privateKey));
      assert.ok(!JSON.stringify(health).includes(rpcUrl));
    });
  }

  {
    const f = await fixture(3);
    const start = behavior.sends.length;
    const results = await Promise.all([runFinalizerCycle(f.env), runFinalizerCycle(f.env)]);
    check("overlapping cron invocations serialize signer nonce and claims", () => {
      assert.equal(results.reduce((n, result) => n + result.finalized, 0), 3, JSON.stringify(results));
      assert.ok(results.some((result) => result.reason === "locked_or_halted"));
      const sent = behavior.sends.slice(start);
      assert.equal(sent.length, 3);
      assert.equal(new Set(sent.map((tx) => tx.nonce)).size, 3);
    });
  }

  {
    const f = await fixture();
    const alternate = HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/16");
    const start = behavior.sends.length;
    const results = await Promise.all([runFinalizerCycle(f.env),
      runFinalizerCycle({ ...f.env, FINALIZER_PRIVATE_KEY: alternate.privateKey })]);
    check("per-vault claim lease also prevents overlap while signer key rotates", () => {
      assert.equal(results.reduce((n, result) => n + result.finalized, 0), 1, JSON.stringify(results));
      assert.equal(behavior.sends.length - start, 1);
    });
  }

  {
    const f = await fixture(3, false);
    const last = [...f.vaults].sort().at(-1);
    await provider.send("evm_increaseTime", [86400]); await provider.send("evm_mine", []);
    await (await f.factory.connect(heir).fileClaimFor(last)).wait();
    await provider.send("evm_increaseTime", [7 * 86400]); await provider.send("evm_mine", []);
    const start = behavior.requests;
    const result = await runFinalizerCycle({ ...f.env, FINALIZER_BATCH_SIZE: "1" });
    check("production scan3/batch1 bound fits 50 RPCs even with two skipped vaults", () => {
      assert.equal(result.checked, 3, JSON.stringify(result));
      assert.equal(result.finalized, 1);
      assert.ok(behavior.requests - start <= 48); // Leaves two extra OP fee oracle calls.
      console.log("  scan3/batch1 RPC requests: " + (behavior.requests - start));
    });
  }

  {
    const f = await fixture(4);
    f.env.FINALIZER_BATCH_SIZE = "2";
    const start = behavior.sends.length;
    const result = await runFinalizerCycle(f.env);
    check("cycle has a hard transaction batch bound", () => {
      assert.equal(result.submitted, 2, JSON.stringify(result));
      assert.equal(behavior.sends.length - start, 2);
    });
    assert.equal((await runFinalizerCycle(f.env)).finalized, 2);
    assertions++;
  }

  {
    const f = await fixture(2);
    f.env.FINALIZER_BATCH_SIZE = "1";
    const first = await runFinalizerCycle(f.env);
    assert.equal(first.finalized, 1, JSON.stringify(first));
    const spent = BigInt(f.store.native.prepare("SELECT CAST(spent_wei AS TEXT) AS spent FROM finalizer_budget").get().spent);
    const remaining = (await Promise.all(f.vaults.map(async (vault) =>
      [vault, await f.token.balanceOf(vault)]))).find(([, balance]) => balance > 0n)[0];
    const estimate = await provider.estimateGas({ to: f.env.FACTORY_ADDRESS,
      from: keeperAddress, value: 0n,
      data: factoryInterface.encodeFunctionData("executeInheritance", [remaining]) });
    const nextReserve = ((estimate * 120n + 99n) / 100n) * BigInt(await provider.send("eth_gasPrice", []));
    f.env.FINALIZER_DAILY_GAS_CAP_ETH = formatEther(spent + nextReserve - 1n);
    const start = behavior.sends.length;
    const result = await runFinalizerCycle(f.env);
    check("daily budget includes previously finalized vaults before reserving another", () => {
      assert.equal(result.reason, "daily_cap", JSON.stringify(result));
      assert.equal(behavior.sends.length, start);
    });
  }

  for (const [name, value, reason] of [
    ["FINALIZER_MAX_GAS", "50000", "gas_cap"],
    ["FINALIZER_MAX_FEE_GWEI", "0.000000001", "fee_cap"],
    ["FINALIZER_DAILY_GAS_CAP_ETH", "0.000000000000000001", "daily_cap"],
  ]) {
    const f = await fixture();
    const original = f.env[name];
    f.env[name] = value;
    const start = behavior.sends.length;
    const result = await runFinalizerCycle(f.env);
    check(reason + " rejects before any broadcast and cools down failure", () => {
      assert.equal(result.reason, reason, JSON.stringify(result));
      assert.equal(behavior.sends.length, start);
      const row = f.store.native.prepare("SELECT state,next_attempt_at FROM finalizer_jobs").get();
      assert.equal(row.state, "failed");
      assert.ok(row.next_attempt_at > Date.now());
    });
    await runFinalizerCycle(f.env);
    assert.equal(behavior.sends.length, start);
    const unhealthy = await readFinalizerHealth(f.env);
    check(reason + " remains visible in health during failure cooldown, even after an idle cycle", () => {
      assert.equal(f.store.native.prepare("SELECT last_cycle_reason FROM finalizer_locks").get().last_cycle_reason, "idle");
      assert.equal(unhealthy.reason, reason, JSON.stringify(unhealthy));
      assert.equal(unhealthy.recentFailure, reason);
    });
    // Failed claims can be retried after cooldown; the old failed state must be re-armed.
    f.store.native.prepare("UPDATE finalizer_jobs SET next_attempt_at=0").run();
    if (original === undefined) delete f.env[name];
    else f.env[name] = original;
    const retried = await runFinalizerCycle(f.env);
    assert.equal(retried.finalized, 1, JSON.stringify(retried));
    assertions++;
  }

  {
    const f = await fixture();
    const start = behavior.sends.length;
    await provider.send("anvil_setBalance", [keeperAddress, "0x0"]);
    const result = await runFinalizerCycle(f.env);
    check("unfunded keeper cannot submit and health reports missing gas", () => {
      assert.equal(result.reason, "insufficient_gas", JSON.stringify(result));
      assert.equal(behavior.sends.length, start);
    });
    assert.equal((await readFinalizerHealth(f.env)).reason, "insufficient_gas");
    await provider.send("anvil_setBalance", [keeperAddress, "0x" + parseEther("10000").toString(16)]);
  }

  {
    const f = await fixture(2);
    const start = behavior.sends.length;
    behavior.hiddenReceipts = true;
    const first = await runFinalizerCycle(f.env);
    const again = await runFinalizerCycle(f.env);
    check("unconfirmed hash blocks further broadcasts without losing its reservation", () => {
      assert.equal(first.reason, "pending", JSON.stringify(first));
      assert.equal(again.reason, "pending", JSON.stringify(again));
      assert.equal(behavior.sends.length - start, 1);
      assert.equal(f.store.native.prepare("SELECT state FROM finalizer_jobs").get().state, "pending");
      assert.ok(f.store.native.prepare("SELECT spent_wei FROM finalizer_budget").get().spent_wei > 0);
    });
    const originalCap = f.env.FINALIZER_DAILY_GAS_CAP_ETH;
    f.env.FINALIZER_DAILY_GAS_CAP_ETH = formatEther(BigInt(f.store.native.prepare("SELECT spent_wei FROM finalizer_budget").get().spent_wei));
    const waiting = await readFinalizerHealth(f.env);
    check("a progressing pending transfer retains its existing reservation when new budget is exhausted", () => {
      assert.equal(waiting.reason, "pending", JSON.stringify(waiting));
      assert.equal(waiting.dailyRemainingWei, "0");
    });
    f.env.FINALIZER_DAILY_GAS_CAP_ETH = originalCap;
    behavior.hiddenReceipts = false;
    const recovered = await runFinalizerCycle(f.env);
    assert.equal(recovered.finalized, 1, JSON.stringify(recovered));
    assert.equal((await runFinalizerCycle(f.env)).finalized, 1);
    assert.equal(behavior.sends.length - start, 2);
    assertions++;
  }

  {
    const f = await fixture();
    const start = behavior.sends.length;
    behavior.droppedResponse = true;
    const first = await runFinalizerCycle(f.env);
    const recovered = await runFinalizerCycle(f.env);
    check("accepted broadcast with lost HTTP response is recovered, never resent", () => {
      assert.equal(first.reason, "pending", JSON.stringify(first));
      assert.equal(recovered.finalized, 1, JSON.stringify(recovered));
      assert.equal(behavior.sends.length - start, 1);
    });
  }

  {
    const f = await fixture();
    const start = behavior.sends.length;
    const estimate = await provider.estimateGas({ from: keeper.address, to: await f.factory.getAddress(),
      data: factoryInterface.encodeFunctionData("executeInheritance", [f.vaults[0]]), value: 0n });
    const reserve = ((estimate * 120n + 99n) / 100n) * BigInt(await provider.send("eth_gasPrice", []));
    f.env.FINALIZER_DAILY_GAS_CAP_ETH = formatEther(reserve * 3n / 2n);
    f.store.faults.failStageWrite = true;
    const failed = await runFinalizerCycle(f.env);
    check("failed atomic stage leaves no fee reservation or signed transaction", () => {
      assert.equal(failed.reason, "rpc_error", JSON.stringify(failed));
      assert.equal(behavior.sends.length, start);
      assert.equal(f.store.native.prepare("SELECT COALESCE(SUM(spent_wei),0) AS spent FROM finalizer_budget").get().spent, 0);
      const job = f.store.native.prepare("SELECT * FROM finalizer_jobs").get();
      assert.equal(job.state, "failed"); assert.equal(job.tx_raw, null); assert.equal(job.reserved_wei, null);
    });
    f.store.native.prepare("UPDATE finalizer_jobs SET next_attempt_at=0").run();
    const recovered = await runFinalizerCycle(f.env);
    check("retry after failed staging pays out within a one-transaction daily budget", () => {
      assert.equal(recovered.finalized, 1, JSON.stringify(recovered));
      assert.equal(behavior.sends.length - start, 1);
      assert.equal(f.store.faults.reservations, 1);
    });
  }

  {
    const f = await fixture();
    const start = behavior.sends.length;
    f.store.faults.dropStageAcknowledgement = true;
    await runFinalizerCycle(f.env);
    const job = f.store.native.prepare("SELECT * FROM finalizer_jobs WHERE state='pending'").get();
    check("lost D1 acknowledgement retains both the reservation and recoverable raw transaction", () => {
      assert.equal(behavior.sends.length, start);
      assert.ok(job?.tx_raw);
      assert.equal(Transaction.from(job.tx_raw).hash, job.tx_hash);
      assert.equal(f.store.native.prepare("SELECT spent_wei FROM finalizer_budget").get().spent_wei, Number(job.reserved_wei));
    });
    const recovered = await runFinalizerCycle(f.env);
    check("committed-but-unacknowledged staging recovers once without reserving twice", () => {
      assert.equal(recovered.finalized, 1, JSON.stringify(recovered));
      assert.equal(behavior.sends.length - start, 1);
      assert.equal(behavior.sends[start].hash, job.tx_hash);
      assert.equal(f.store.faults.reservations, 1);
    });
  }

  {
    const f = await fixture();
    const start = behavior.sends.length;
    f.store.faults.loseLeaseBeforeStage = true;
    const failed = await runFinalizerCycle(f.env);
    check("a lost signer lease cannot reserve fees or stage a second pending nonce", () => {
      assert.equal(failed.reason, "lease_lost", JSON.stringify(failed));
      assert.equal(behavior.sends.length, start);
      assert.equal(f.store.native.prepare("SELECT COALESCE(SUM(spent_wei),0) AS spent FROM finalizer_budget").get().spent, 0);
      assert.equal(f.store.native.prepare("SELECT COUNT(*) AS n FROM finalizer_jobs WHERE state='pending'").get().n, 0);
    });
  }

  {
    const f = await fixture();
    const job = await stageWithoutBroadcast(f);
    const start = behavior.sends.length, requests = behavior.requests;
    const results = await Promise.all([runFinalizerCycle(f.env), runFinalizerCycle(f.env)]);
    check("pre-broadcast lease loss recovers the identical raw transaction under the signer lock", () => {
      assert.equal(results.reduce((n, cycle) => n + cycle.finalized, 0), 1, JSON.stringify(results));
      assert.ok(results.some((cycle) => cycle.reason === "locked_or_halted"));
      const sends = behavior.sends.slice(start);
      assert.equal(sends.length, 1);
      assert.equal(sends[0].raw, job.tx_raw);
      assert.equal(sends[0].hash, job.tx_hash);
      assert.equal(sends[0].nonce, Transaction.from(job.tx_raw).nonce);
      assert.equal(f.store.faults.reservations, 1);
      assert.equal(f.store.native.prepare("SELECT state FROM finalizer_jobs").get().state, "confirmed");
      assert.ok(behavior.requests - requests <= 50);
    });
    assert.equal(await f.token.balanceOf(heirAddress), parseEther("100"));
    assert.equal(await f.token.balanceOf(keeperAddress), 0n);
    assert.equal((await runFinalizerCycle(f.env)).submitted, 0);
  }

  {
    const f = await fixture();
    const job = await stageWithoutBroadcast(f);
    const start = behavior.sends.length;
    f.env.FINALIZER_MAX_GAS = "50000";
    const blocked = await runFinalizerCycle(f.env);
    const health = await readFinalizerHealth(f.env);
    check("a staged but unbroadcast gas-capped transfer exposes its actual recovery failure", () => {
      assert.equal(blocked.reason, "gas_cap", JSON.stringify(blocked));
      assert.equal(health.reason, "gas_cap", JSON.stringify(health));
      assert.equal(health.pendingTxHash, job.tx_hash);
      assert.equal(behavior.sends.length, start);
    });
    f.store.native.prepare("UPDATE finalizer_locks SET last_cycle_reason='running'").run();
    const retrying = await readFinalizerHealth(f.env);
    check("pending row alone cannot claim readiness while a new recovery check is running", () => {
      assert.equal(retrying.reason, "running", JSON.stringify(retrying));
    });
    delete f.env.FINALIZER_MAX_GAS;
    const recovered = await runFinalizerCycle(f.env);
    const ready = await readFinalizerHealth(f.env);
    check("restoring the cap recovers the exact staged transfer and service readiness", () => {
      assert.equal(recovered.finalized, 1, JSON.stringify(recovered));
      assert.equal(ready.reason, "ready", JSON.stringify(ready));
      assert.equal(behavior.sends.length - start, 1);
      assert.equal(behavior.sends[start].hash, job.tx_hash);
    });
  }

  for (const field of ["chain", "from", "to", "value", "calldata", "hash"]) {
    const f = await fixture();
    const job = await stageWithoutBroadcast(f);
    const original = Transaction.from(job.tx_raw);
    const tx = { type: original.type, chainId: original.chainId, nonce: original.nonce,
      to: original.to, data: original.data, value: original.value,
      gasLimit: original.gasLimit, gasPrice: original.gasPrice };
    let signer = keeper;
    if (field === "chain") tx.chainId++;
    if (field === "from") signer = HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/16");
    if (field === "to") tx.to = keeperAddress;
    if (field === "value") tx.value = 1n;
    if (field === "calldata") tx.data = factoryInterface.encodeFunctionData("executeInheritance", [keeperAddress]);
    const raw = await signer.signTransaction(tx);
    const hash = field === "hash" ? "0x" + "ab".repeat(32) : Transaction.from(raw).hash;
    f.store.native.prepare("UPDATE finalizer_jobs SET tx_raw=?,tx_hash=?").run(raw, hash);
    const reserved = f.store.native.prepare("SELECT spent_wei FROM finalizer_budget").get().spent_wei;
    const start = behavior.sends.length;
    const result = await runFinalizerCycle(f.env);
    const health = await readFinalizerHealth(f.env);
    check("recovery rejects a stored signed transaction with invalid " + field, () => {
      assert.equal(result.reason, "recovery_invalid", JSON.stringify(result));
      assert.equal(health.reason, "halted", JSON.stringify(health));
      assert.equal(health.lastError, "recovery_invalid");
      assert.equal(behavior.sends.length, start);
      assert.equal(f.store.native.prepare("SELECT spent_wei FROM finalizer_budget").get().spent_wei, reserved);
      assert.equal(f.store.faults.reservations, 1);
    });
  }

  {
    const f = await fixture();
    const job = await stageWithoutBroadcast(f);
    f.store.native.exec("ALTER TABLE finalizer_jobs DROP COLUMN tx_raw");
    const beforeColumns = f.store.native.prepare("PRAGMA table_info(finalizer_jobs)").all().length;
    const start = behavior.sends.length;
    const result = await runFinalizerCycle(f.env);
    const migrated = f.store.native.prepare("SELECT * FROM finalizer_jobs").get();
    check("old pending rows migrate without inventing a signature or refunding their budget", () => {
      assert.equal(result.reason, "recovery_unavailable", JSON.stringify(result));
      assert.equal(migrated.tx_raw, null);
      assert.equal(migrated.tx_hash, job.tx_hash);
      assert.equal(migrated.reserved_wei, job.reserved_wei);
      assert.equal(migrated.state, "pending");
      assert.equal(f.store.native.prepare("PRAGMA table_info(finalizer_jobs)").all().length, beforeColumns + 1);
      assert.equal(f.store.native.prepare("SELECT halted FROM finalizer_locks").get().halted, 1);
      assert.equal(f.store.faults.reservations, 1);
      assert.equal(behavior.sends.length, start);
    });
  }

  {
    const f = await usdcFixture({ ready: false });
    const sendStart = behavior.sends.length;
    const partial = { ...f.env, USDC_MORPHO_VAULT_ADDRESS: undefined };
    const result = await runFinalizerCycle(partial);
    check("partial USDC factory configuration fails closed before RPC or signing", () => {
      assert.equal(result.reason, "invalid_configuration");
      assert.equal(behavior.sends.length, sendStart);
    });
    for (const [label, overrides] of [
      ["zero asset", { USDC_ADDRESS: ZeroAddress }],
      ["WLD alias", { USDC_ADDRESS: f.env.WLD_ADDRESS }],
      ["conflicting source", { USDC_YIELD_FACTORY_ADDRESS: f.env.YIELD_FACTORY_ADDRESS }],
    ]) {
      const invalid = await runFinalizerCycle({ ...f.env, ...overrides });
      check(`${label} USDC configuration fails closed`, () => {
        assert.equal(invalid.reason, "invalid_configuration", JSON.stringify(invalid));
        assert.equal(behavior.sends.length, sendStart);
      });
    }
  }

  for (const [label, factoryChange] of [
    ["asset", { factoryAsset: keeperAddress }],
    ["reward token", { factoryReward: keeperAddress }],
    ["strategy", { factoryStrategy: keeperAddress }],
  ]) {
    const f = await usdcFixture({ ready: false, ...factoryChange });
    const start = behavior.sends.length;
    const result = await runFinalizerCycle(f.env);
    check(`USDC network validation rejects the wrong factory ${label}`, () => {
      assert.equal(result.reason, "wrong_token", JSON.stringify(result));
      assert.equal(behavior.sends.length, start);
    });
  }
  {
    const f = await usdcFixture({ ready: true, known: false });
    const sendStart = behavior.sends.length;
    const result = await runFinalizerCycle(f.env);
    check("USDC child self-report cannot bypass source-factory membership", () => {
      assert.equal(result.reason, "idle", JSON.stringify(result));
      assert.equal(result.checked, 1);
      assert.equal(result.skipped, 1);
      assert.equal(behavior.sends.length, sendStart);
    });
  }

  for (const [label, settlement] of [["cash", 0], ["receipt shares", 1], ["WLD reward only", 2], ["total loss", 3]]) {
    const f = await usdcFixture({ settlement });
    const requestStart = behavior.requests;
    const sendStart = behavior.sends.length;
    behavior.requestLimit = requestStart + 50;
    let result;
    try { result = await runFinalizerCycle(f.env); }
    finally { behavior.requestLimit = null; }
    const cycleRequests = behavior.requests - requestStart;
    const sent = behavior.sends.at(-1);
    const receipt = await provider.getTransactionReceipt(sent.hash);
    const event = receipt.logs.filter((log) => log.address.toLowerCase() === f.usdcVault.toLowerCase())
      .map((log) => { try { return usdcVaultInterface.parseLog(log); } catch { return null; } })
      .find(Boolean);
    const childClaimedAt = await f.vault.claimedAt();
    const decimals = await f.usdc.decimals();
    const health = await readFinalizerHealth(f.env);
    check(`USDC ${label} settlement uses authenticated factory, fixed heir and matching claimedAt within 50 RPCs`, () => {
      assert.equal(result.reason, "finalized", JSON.stringify(result));
      assert.equal(result.finalized, 1);
      assert.equal(result.submitted, 1);
      assert.equal(behavior.sends.length - sendStart, 1);
      assert.ok(cycleRequests <= 50, String(cycleRequests));
      assert.equal(sent.to.toLowerCase(), f.env.USDC_YIELD_FACTORY_ADDRESS.toLowerCase());
      assert.equal(sent.value, 0n);
      assert.equal(factoryInterface.decodeFunctionData("executeInheritance", sent.data)[0], f.usdcVault);
      assert.equal(decimals, 6n);
      assert.ok(event);
      assert.equal(event.args.recipient.toLowerCase(), heirAddress.toLowerCase());
      assert.ok(event.args.claimedAt > 0n);
      assert.equal(event.args.claimedAt, childClaimedAt);
      if (settlement === 1) {
        assert.equal(event.name, "InheritanceSharesFinalized");
        assert.ok(event.args.shares > 0n);
      } else {
        assert.equal(event.name, "InheritanceFinalized");
        assert.equal(event.args.assetAmount, settlement === 0 ? f.cashAmount : 0n);
      }
      assert.equal(f.store.native.prepare("SELECT state FROM finalizer_jobs").get().state, "confirmed");
      assert.equal(health.supported, true);
      assert.equal(health.supportsUSDC, true);
      assert.equal(health.factoryAddresses.length, 3);
      assert.ok(health.factoryAddresses.includes(f.env.USDC_YIELD_FACTORY_ADDRESS));
      assert.equal(health.scanLimit, 1);
      assert.equal(health.batchSize, 1);
      console.log("  USDC " + label + " RPC requests: " + cycleRequests);
    });
    if (settlement === 0) assert.equal(await f.usdc.balanceOf(heirAddress), f.cashAmount);
    if (settlement === 1) assert.equal(await f.morpho.balanceOf(heirAddress), parseEther("100"));
    if (settlement === 2) assert.equal(await f.token.balanceOf(heirAddress), parseEther("10"));
  }

  for (const getter of ["factory", "claimedAt"]) {
    const f = await usdcFixture({ settlement: 2 });
    const sendStart = behavior.sends.length;
    behavior.historicalReadErrorSelector = usdcVaultInterface.getFunction(getter).selector;
    let first, retry;
    try {
      first = await runFinalizerCycle(f.env);
      retry = await runFinalizerCycle(f.env);
    } finally { behavior.historicalReadErrorSelector = null; }
    const staged = f.store.native.prepare("SELECT * FROM finalizer_jobs").get();
    const reserved = f.store.native.prepare("SELECT spent_wei FROM finalizer_budget").get().spent_wei;
    check(`unavailable historical USDC ${getter} proof keeps the paid job pending without halting or rebroadcast`, () => {
      assert.equal(first.reason, "rpc_error", JSON.stringify(first));
      assert.equal(retry.reason, "rpc_error", JSON.stringify(retry));
      assert.equal(staged.state, "pending");
      assert.equal(staged.last_error, null);
      assert.equal(BigInt(reserved), BigInt(staged.reserved_wei));
      assert.equal(f.store.native.prepare("SELECT halted FROM finalizer_locks").get().halted, 0);
      assert.equal(behavior.sends.length - sendStart, 1);
      assert.equal(f.store.faults.reservations, 1);
    });
    assert.equal(await f.token.balanceOf(heirAddress), parseEther("10"));
    const recovered = await runFinalizerCycle(f.env);
    const confirmed = f.store.native.prepare("SELECT * FROM finalizer_jobs").get();
    check(`recovered historical USDC ${getter} proof confirms the same payout and settles its reservation once`, () => {
      assert.equal(recovered.reason, "finalized", JSON.stringify(recovered));
      assert.equal(recovered.finalized, 1);
      assert.equal(confirmed.state, "confirmed");
      assert.equal(confirmed.last_error, null);
      assert.equal(confirmed.tx_hash, staged.tx_hash);
      assert.equal(f.store.native.prepare("SELECT halted FROM finalizer_locks").get().halted, 0);
      assert.equal(behavior.sends.length - sendStart, 1);
      assert.equal(f.store.faults.reservations, 1);
      assert.ok(BigInt(f.store.native.prepare("SELECT spent_wei FROM finalizer_budget").get().spent_wei) < BigInt(reserved));
    });
    assert.equal(await f.token.balanceOf(heirAddress), parseEther("10"));
  }

  for (const mode of ["cash", "shares", "reward-only", "total-loss", "exhausted-strategy"]) {
    const f = await productionUSDCFixture(mode);
    // The cash and gas-exhaustion cases also exercise World Chain signing and
    // OP fee RPCs. Oracle prices and receipt metadata remain local fixtures.
    const worldChainIdentity = mode === "cash" || mode === "exhausted-strategy";
    if (worldChainIdentity) {
      await provider.send("anvil_setChainId", [480]);
      behavior.oracleQuote = 0n; behavior.receiptExtra = 0n;
      Object.assign(f.env, { FINALIZER_CHAIN_ID: "480", FINALIZER_EXTRA_FEE_RESERVE_ETH: "0.000001" });
    }
    const start = behavior.requests, sends = behavior.sends.length;
    behavior.requestLimit = start + 50;
    let result;
    try { result = await runFinalizerCycle(f.env); } finally {
      behavior.requestLimit = null;
      if (worldChainIdentity) {
        await provider.send("anvil_setChainId", [31337]);
        behavior.oracleQuote = null; behavior.receiptExtra = null;
      }
    }
    const cycleRequests = behavior.requests - start;
    check(`production USDC ${mode} inheritance confirms within 50 RPCs and the deployed gas cap`, () => {
      assert.equal(result.reason, "finalized", JSON.stringify(result));
      assert.equal(result.finalized, 1);
      assert.equal(behavior.sends.length - sends, 1);
      assert.ok(cycleRequests <= 50, String(cycleRequests));
      assert.equal(behavior.sends.at(-1).to.toLowerCase(), f.env.USDC_YIELD_FACTORY_ADDRESS.toLowerCase());
      assert.equal(f.store.native.prepare("SELECT state FROM finalizer_jobs").get().state, "confirmed");
    });
    assert.ok(await f.vault.claimedAt() > 0n);
    assert.equal(await f.vault.inheritanceRecipient(), heirAddress);
    assert.equal(await f.vault.hasAssets(), false);
    assert.equal(await f.token.balanceOf(heirAddress), mode === "total-loss" ? 0n : parseEther("9"));
    assert.equal(await f.token.balanceOf(f.feeRecipient), mode === "total-loss" ? 0n : parseEther("1"));
    if (mode === "cash") {
      assert.equal(await f.usdc.balanceOf(heirAddress), 109_000000n);
      assert.equal(await f.usdc.balanceOf(f.feeRecipient), 1_000000n);
    } else if (mode === "shares") {
      assert.ok(await f.morpho.balanceOf(heirAddress) > parseEther("99"));
      assert.ok(await f.morpho.balanceOf(f.feeRecipient) > 0n);
      assert.equal(await f.usdc.balanceOf(heirAddress), 0n);
    } else if (mode === "exhausted-strategy") {
      assert.equal(await f.morpho.balanceOf(heirAddress), parseEther("100"));
      assert.equal(await f.morpho.balanceOf(f.feeRecipient), 0n);
    }
    const receipt = await provider.getTransactionReceipt(behavior.sends.at(-1).hash);
    assert.ok(receipt.gasUsed <= BigInt(usdcDeploymentGas));
    console.log(`  production USDC ${mode}: ${cycleRequests} RPCs, ${receipt.gasUsed} gas${worldChainIdentity ? " (chain480, OP fee fixtures)" : ""}`);
  }

  {
    const f = await fixture();
    await stageWithoutBroadcast(f);
    await (await f.factory.connect(f.owners[0]).pingMyVault()).wait();
    const start = behavior.sends.length;
    const result = await runFinalizerCycle(f.env);
    check("recovery rechecks the filed claim and cannot execute after owner renewal", () => {
      assert.equal(result.reason, "recovery_ineligible", JSON.stringify(result));
      assert.equal(behavior.sends.length, start);
      assert.equal(f.store.faults.reservations, 1);
    });
    assert.equal(await f.token.balanceOf(f.vaults[0]), parseEther("100"));
  }

  {
    const f = await fixture();
    const tip = await provider.send("eth_getBlockByNumber", ["latest", false]);
    const rollback = await provider.send("evm_snapshot", []);
    behavior.finalizedBlock = tip.number;
    const start = behavior.sends.length;
    const first = await runFinalizerCycle(f.env);
    const staged = f.store.native.prepare("SELECT * FROM finalizer_jobs").get();
    const reserved = f.store.native.prepare("SELECT spent_wei FROM finalizer_budget").get().spent_wei;
    const poll = await runFinalizerCycle(f.env);
    check("an unfinalized canonical receipt keeps the job pending and its full reservation", () => {
      assert.equal(first.reason, "awaiting_finality", JSON.stringify(first));
      assert.equal(poll.reason, "awaiting_finality", JSON.stringify(poll));
      assert.equal(staged.state, "pending");
      assert.equal(BigInt(reserved), BigInt(staged.reserved_wei));
      assert.equal(f.store.native.prepare("SELECT spent_wei FROM finalizer_budget").get().spent_wei, reserved);
      assert.equal(behavior.sends.length - start, 1);
    });
    assert.equal(await provider.send("evm_revert", [rollback]), true);
    assert.equal(await provider.send("eth_getTransactionReceipt", [staged.tx_hash]), null);
    assert.equal(await f.token.balanceOf(f.vaults[0]), parseEther("100"));
    behavior.hiddenReceipts = true;
    let recovered;
    try { recovered = await runFinalizerCycle(f.env); }
    finally { behavior.hiddenReceipts = false; }
    await mineCanonicalReplay(staged.tx_hash);
    const awaiting = await runFinalizerCycle(f.env);
    behavior.finalizedBlock = null;
    const finalized = await runFinalizerCycle(f.env);
    check("real Anvil rollback before finality replays the same hash without a second reservation", () => {
      assert.equal(recovered.reason, "pending", JSON.stringify(recovered));
      assert.equal(recovered.submitted, 1);
      assert.equal(awaiting.reason, "awaiting_finality", JSON.stringify(awaiting));
      assert.equal(awaiting.submitted, 0);
      assert.equal(awaiting.finalized, 0);
      assert.equal(finalized.finalized, 1, JSON.stringify(finalized));
      const sends = behavior.sends.slice(start);
      assert.equal(sends.length, 2);
      assert.equal(sends[0].raw, sends[1].raw);
      assert.equal(new Set(sends.map((send) => send.hash)).size, 1);
      assert.equal(f.store.faults.reservations, 1);
    });
    assert.equal(await f.token.balanceOf(heirAddress), parseEther("100"));
    assert.equal(await f.token.balanceOf(f.vaults[0]), 0n);
  }

  {
    const f = await fixture(3, false);
    const last = [...f.vaults].sort().at(-1);
    await provider.send("evm_increaseTime", [86400]); await provider.send("evm_mine", []);
    await (await f.factory.connect(heir).fileClaimFor(last)).wait();
    await provider.send("evm_increaseTime", [7 * 86400]); await provider.send("evm_mine", []);
    f.env.FINALIZER_BATCH_SIZE = "1";
    const rollback = await provider.send("evm_snapshot", []);
    const start = behavior.sends.length;
    assert.equal((await runFinalizerCycle(f.env)).finalized, 1);
    const job = f.store.native.prepare("SELECT * FROM finalizer_jobs").get();
    const spent = f.store.native.prepare("SELECT spent_wei FROM finalizer_budget").get().spent_wei;
    assert.equal(job.state, "confirmed");
    assert.equal(await provider.send("evm_revert", [rollback]), true);
    assert.equal(await provider.send("eth_getTransactionReceipt", [job.tx_hash]), null);
    assert.equal(await f.token.balanceOf(last), parseEther("100"));
    const cap = f.env.FINALIZER_DAILY_GAS_CAP_ETH;
    f.env.FINALIZER_DAILY_GAS_CAP_ETH = formatEther(BigInt(spent) + BigInt(job.reserved_wei) - 1n);
    const blocked = await runFinalizerCycle(f.env);
    check("reorg recovery keeps old fees accounted and obeys the daily cap before re-reserving", () => {
      assert.equal(blocked.reason, "daily_cap", JSON.stringify(blocked));
      assert.equal(f.store.native.prepare("SELECT state FROM finalizer_jobs").get().state, "confirmed");
      assert.equal(f.store.native.prepare("SELECT spent_wei FROM finalizer_budget").get().spent_wei, spent);
      assert.equal(behavior.sends.length - start, 1);
      assert.equal(f.store.faults.reservations, 1);
    });
    f.env.FINALIZER_DAILY_GAS_CAP_ETH = cap;
    const requests = behavior.requests;
    // Anvil can acknowledge a replay before its new receipt is visible. Force
    // that boundary instead of assuming same-cycle finality depends on timing.
    behavior.hiddenReceipts = true;
    let recovered;
    try { recovered = await runFinalizerCycle(f.env); }
    finally { behavior.hiddenReceipts = false; }
    check("confirmed-claim reorg recovery stages the same replay with bounded conservative fees", () => {
      assert.equal(recovered.checked, 3, JSON.stringify(recovered));
      assert.equal(recovered.reason, "pending", JSON.stringify(recovered));
      assert.equal(recovered.finalized, 0);
      assert.equal(recovered.submitted, 1);
      assert.ok(behavior.requests - requests <= 47); // Leaves three OP fee oracle calls.
      console.log("  confirmed reorg scan3/batch1 RPC requests: " + (behavior.requests - requests));
      const sends = behavior.sends.slice(start);
      assert.equal(sends.length, 2);
      assert.equal(sends[0].raw, sends[1].raw);
      assert.equal(new Set(sends.map((send) => send.nonce)).size, 1);
      assert.equal(f.store.faults.reservations, 2);
      assert.ok(f.store.native.prepare("SELECT spent_wei FROM finalizer_budget").get().spent_wei >= 2 * spent);
      assert.equal(f.store.native.prepare("SELECT state FROM finalizer_jobs").get().state, "pending");
    });
    await mineCanonicalReplay(job.tx_hash);
    const pollStart = behavior.requests;
    const finalized = await runFinalizerCycle(f.env);
    check("the next bounded cycle confirms a replay once its canonical receipt is visible", () => {
      assert.equal(finalized.reason, "finalized", JSON.stringify(finalized));
      assert.equal(finalized.finalized, 1);
      assert.equal(finalized.submitted, 0);
      assert.ok(behavior.requests - pollStart <= 47);
      assert.equal(behavior.sends.length - start, 2);
      assert.equal(f.store.faults.reservations, 2);
      assert.equal(f.store.native.prepare("SELECT state FROM finalizer_jobs").get().state, "confirmed");
      assert.ok(f.store.native.prepare("SELECT spent_wei FROM finalizer_budget").get().spent_wei >= 2 * spent);
    });
    assert.equal(await f.token.balanceOf(heirAddress), parseEther("100"));
    assert.equal(await f.token.balanceOf(last), 0n);
    assert.equal((await runFinalizerCycle(f.env)).submitted, 0);
  }

  {
    const f = await fixture();
    behavior.renewedBeforeSimulation = async () =>
      (await f.factory.connect(f.owners[0]).pingMyVault()).wait();
    const start = behavior.sends.length;
    const result = await runFinalizerCycle(f.env);
    check("owner renewal between snapshot and simulation prevents transaction", () => {
      assert.equal(result.reason, "simulation_failed", JSON.stringify(result));
      assert.equal(behavior.sends.length, start);
    });
    assert.equal(await f.token.balanceOf(f.vaults[0]), parseEther("100"));
  }

  {
    const f = await fixture(2);
    const cancelledVault = [...f.vaults].sort()[0];
    const cancelledOwner = f.owners[f.vaults.indexOf(cancelledVault)];
    behavior.renewedBeforeSimulation = async () =>
      (await f.factory.connect(cancelledOwner).pingMyVault()).wait();
    const start = behavior.sends.length;
    const failed = await runFinalizerCycle(f.env);
    const failureHealth = await readFinalizerHealth(f.env);
    const recovered = await runFinalizerCycle(f.env);
    const healthy = await readFinalizerHealth(f.env);
    const idle = await runFinalizerCycle(f.env);
    const idleHealth = await readFinalizerHealth(f.env);
    check("a recovered service keeps cancelled-claim history without blocking other vaults", () => {
      assert.equal(failed.reason, "simulation_failed", JSON.stringify(failed));
      assert.equal(failureHealth.reason, "simulation_failed");
      assert.equal(recovered.finalized, 1, JSON.stringify(recovered));
      assert.equal(healthy.lastCycleReason, "finalized");
      assert.equal(healthy.recentFailure, "simulation_failed");
      assert.equal(healthy.reason, "ready");
      assert.equal(idle.reason, "idle", JSON.stringify(idle));
      assert.equal(idleHealth.reason, "ready");
      assert.equal(behavior.sends.length - start, 1);
    });
    assert.equal(await f.token.balanceOf(cancelledVault), parseEther("100"));
    assert.equal(await f.token.balanceOf(heirAddress), parseEther("100"));
  }

  {
    const f = await fixture(2);
    f.env.FINALIZER_MAX_GAS = "1";
    const [cappedVault, cancelledVault] = [...f.vaults].sort();
    const capped = await runFinalizerCycle(f.env);
    const cancelledOwner = f.owners[f.vaults.indexOf(cancelledVault)];
    behavior.renewedBeforeSimulation = async () =>
      (await f.factory.connect(cancelledOwner).pingMyVault()).wait();
    const cancelled = await runFinalizerCycle(f.env);
    const idle = await runFinalizerCycle(f.env);
    const health = await readFinalizerHealth(f.env);
    check("a later cancelled claim cannot hide an earlier signer-wide gas cap", () => {
      assert.equal(capped.reason, "gas_cap", JSON.stringify(capped));
      assert.equal(cancelled.reason, "simulation_failed", JSON.stringify(cancelled));
      assert.equal(idle.reason, "idle", JSON.stringify(idle));
      assert.equal(health.lastCycleReason, "idle");
      assert.equal(health.recentFailure, "gas_cap");
      assert.equal(health.reason, "gas_cap");
    });
    assert.equal(await f.token.balanceOf(cappedVault), parseEther("100"));
    assert.equal(await f.token.balanceOf(cancelledVault), parseEther("100"));
    assert.equal(await f.token.balanceOf(heirAddress), 0n);
  }

  {
    const f = await fixture(1, false);
    const start = behavior.sends.length;
    const result = await runFinalizerCycle(f.env);
    check("unfiled or immature vault is skipped", () => {
      assert.equal(result.submitted, 0);
      assert.equal(behavior.sends.length, start);
    });
    const foreign = await deploy(factoryArtifact, owner, [f.env.WLD_ADDRESS]);
    await (await foreign.createVault(heirAddress, 86400)).wait();
    const foreignVault = await foreign.vaultOf(await owner.getAddress());
    f.store.native.prepare("INSERT INTO watchers VALUES (?,1)").run(foreignVault);
    assert.equal((await runFinalizerCycle(f.env)).submitted, 0);
    assertions++;
  }

  {
    const f = await fixture();
    const start = behavior.sends.length;
    let result = await runFinalizerCycle({ ...f.env, FINALIZER_CHAIN_ID: "480",
      FINALIZER_EXTRA_FEE_RESERVE_ETH: "0.00001" });
    check("chain identity mismatch fails closed", () => {
      assert.equal(result.reason, "wrong_chain");
      assert.equal(behavior.sends.length, start);
    });
    result = await runFinalizerCycle({ ...f.env, WLD_ADDRESS: keeperAddress });
    assert.equal(result.reason, "wrong_token");
    const legacy = await deploy(legacyArtifact, owner, [f.env.WLD_ADDRESS]);
    result = await runFinalizerCycle({ ...f.env, FACTORY_ADDRESS: await legacy.getAddress() });
    check("legacy immutable factory without executeInheritance is never submitted to", () => {
      assert.equal(result.reason, "unsupported_factory", JSON.stringify(result));
      assert.equal(behavior.sends.length, start);
    });
  }

  {
    const f = await fixture();
    behavior.chainId = "0x1e0";
    behavior.oracleQuote = parseEther("0.001");
    const start = behavior.sends.length;
    const result = await runFinalizerCycle({ ...f.env, FINALIZER_CHAIN_ID: "480",
      FINALIZER_EXTRA_FEE_RESERVE_ETH: "0.00001" });
    check("OP data/operator fee quote must fit separate reserve before signing", () => {
      assert.equal(result.reason, "extra_fee_cap", JSON.stringify(result));
      assert.equal(behavior.sends.length, start);
    });
    assert.equal((await readFinalizerHealth({ ...f.env, FINALIZER_CHAIN_ID: "480",
      FINALIZER_EXTRA_FEE_RESERVE_ETH: "0.00001" })).reason, "extra_fee_cap");
    behavior.chainId = null; behavior.oracleQuote = null;
  }

  {
    const f = await fixture();
    behavior.hiddenReceipts = true;
    const staged = await runFinalizerCycle(f.env);
    assert.equal(staged.reason, "pending", JSON.stringify(staged));
    behavior.hiddenReceipts = false;
    const oldScope = "31337:" + keeperAddress.toLowerCase();
    const scope = "480:" + keeperAddress.toLowerCase();
    // The transaction was mined on local Anvil. Re-scope only its pending fixture
    // so reconciliation exercises World Chain's fee metadata requirement; no
    // chain480 transaction is signed or broadcast by this test.
    f.store.native.prepare("UPDATE finalizer_locks SET scope=? WHERE scope=?").run(scope, oldScope);
    f.store.native.prepare("UPDATE finalizer_budget SET scope=? WHERE scope=?").run(scope, oldScope);
    f.store.native.prepare("UPDATE finalizer_jobs SET scope=?,chain_id=480 WHERE scope=?").run(scope, oldScope);
    const reserved = f.store.native.prepare("SELECT spent_wei FROM finalizer_budget").get().spent_wei;
    const sends = behavior.sends.length;
    behavior.chainId = "0x1e0";
    const env = { ...f.env, FINALIZER_CHAIN_ID: "480", FINALIZER_EXTRA_FEE_RESERVE_ETH: "0.00001" };
    const reconciled = await runFinalizerCycle(env); // Anvil receipts omit l1Fee.
    const health = await readFinalizerHealth(env);
    const next = await runFinalizerCycle(env);
    check("chain480 missing l1Fee halts without assuming zero or refunding reservation", () => {
      assert.equal(reconciled.reason, "fee_unverified", JSON.stringify(reconciled));
      assert.equal(health.reason, "halted", JSON.stringify(health));
      assert.equal(health.lastError, "fee_unverified");
      assert.equal(health.lastCycleReason, "fee_unverified");
      assert.equal(next.reason, "locked_or_halted");
      assert.equal(f.store.native.prepare("SELECT state FROM finalizer_jobs").get().state, "pending");
      assert.equal(f.store.native.prepare("SELECT spent_wei FROM finalizer_budget").get().spent_wei, reserved);
      assert.equal(behavior.sends.length, sends);
    });
    behavior.chainId = null;
  }

  {
    const f = await fixture();
    behavior.receiptExtra = parseEther("0.002");
    const start = behavior.sends.length;
    const result = await runFinalizerCycle(f.env);
    const next = await runFinalizerCycle(f.env);
    check("actual fee overrun is counted and halts all future automation", () => {
      assert.equal(result.reason, "fee_overrun", JSON.stringify(result));
      assert.equal(next.reason, "locked_or_halted");
      assert.equal(behavior.sends.length - start, 1);
      const budget = f.store.native.prepare("SELECT spent_wei FROM finalizer_budget").get();
      assert.ok(budget.spent_wei >= Number(parseEther("0.002")));
    });
    assert.equal((await readFinalizerHealth(f.env)).reason, "halted");
    behavior.receiptExtra = null;
  }
  for (const cash of [true, false]) {
    const f = await yieldFixture({ cash });
    const result = await runFinalizerCycle(f.env);
    check(cash ? "yield cash payout routes to the separate factory and pays only the fixed heir and gain fee"
      : "illiquid share-only inheritance is eligible and its nonzero receipt event proves the payout", () => {
      assert.equal(result.reason, "finalized", JSON.stringify(result));
      assert.equal(f.store.native.prepare("SELECT state FROM finalizer_jobs").get().state, "confirmed");
      assert.equal(Transaction.from(behavior.sends.at(-1).raw).to.toLowerCase(), f.env.YIELD_FACTORY_ADDRESS.toLowerCase());
    });
    assert.equal(await f.token.balanceOf(keeperAddress), 0n);
    if (cash) assert.equal(await f.token.balanceOf(heirAddress), parseEther("109"));
    else assert.ok(await f.morpho.balanceOf(heirAddress) > parseEther("98"));
    const health = await readFinalizerHealth(f.env);
    check("yield health exposes the supported factory and bounds richer scans", () => {
      assert.equal(health.supported, true);
      assert.equal(health.halted, false);
      assert.equal(health.scanLimit, 2);
      assert.ok(health.factoryAddresses.includes(f.env.YIELD_FACTORY_ADDRESS));
    });
  }
  {
    const f = await yieldFixture({ cash: false });
    const job = await stageWithoutBroadcast(f);
    const restored = await runFinalizerCycle(f.env);
    check("crash recovery accepts and rebroadcasts the exact signed yield-factory request", () => {
      assert.equal(restored.reason, "finalized", JSON.stringify(restored));
      assert.equal(behavior.sends.at(-1).raw, job.tx_raw);
      assert.equal(f.store.native.prepare("SELECT state FROM finalizer_jobs").get().state, "confirmed");
    });
  }
  for (const [limit, value] of [
    ["FINALIZER_MAX_GAS", "1"],
    ["FINALIZER_MAX_FEE_GWEI", "0.000000001"],
    ["FINALIZER_DAILY_GAS_CAP_ETH", "0.000000000001"],
  ]) {
    const f = await yieldFixture({ cash: false });
    behavior.hiddenReceipts = true;
    const pending = await runFinalizerCycle(f.env);
    behavior.hiddenReceipts = false;
    assert.equal(pending.reason, "pending", JSON.stringify(pending));
    const sends = behavior.sends.length;
    f.env[limit] = value;
    const settled = await runFinalizerCycle(f.env);
    check("mined share inheritance remains provable after lowering " + limit, () => {
      assert.equal(settled.reason, "finalized", JSON.stringify(settled));
      assert.equal(f.store.native.prepare("SELECT state,last_error FROM finalizer_jobs").get().state, "confirmed");
      assert.equal(f.store.native.prepare("SELECT halted FROM finalizer_locks").get().halted, 0);
      assert.equal(behavior.sends.length, sends);
    });
  }
  {
    const f = await yieldFixture();
    await (await f.morpho.setRate(0)).wait();
    const result = await runFinalizerCycle(f.env);
    check("a complete yield loss settles at zero without halting other inheritances", () => {
      assert.equal(result.reason, "finalized", JSON.stringify(result));
      assert.equal(f.store.native.prepare("SELECT state FROM finalizer_jobs").get().state, "confirmed");
      assert.equal(f.store.native.prepare("SELECT halted FROM finalizer_locks").get().halted, 0);
    });
    assert.equal(await f.morpho.balanceOf(f.yieldVault), 0n);
    assert.equal(await f.token.balanceOf(heirAddress), 0n);
    assert.equal((await runFinalizerCycle(f.env)).reason, "idle");
  }
  {
    const f = await yieldFixture({ mixed: true });
    const at = behavior.requests;
    const first = await runFinalizerCycle(f.env);
    check("mixed plain/yield signing cycle remains inside the 50-RPC request bound", () => {
      assert.equal(first.reason, "finalized", JSON.stringify(first));
      assert.ok(behavior.requests - at <= 50, String(behavior.requests - at));
    });
    const second = await runFinalizerCycle(f.env);
    check("the shared signer and budget continue across both supported factories", () => {
      assert.equal(second.reason, "finalized", JSON.stringify(second));
      assert.equal(f.store.native.prepare("SELECT COUNT(*) AS n FROM finalizer_jobs WHERE state='confirmed'").get().n, 2);
    });
  }
  {
    const f = await yieldFixture({ ready: false });
    await runFinalizerCycle(f.env);
    const { __test: workerTest } = await import("../backend/src/worker.mjs");
    const snapshot = await workerTest.getVaultSnapshot(f.env, f.yieldVault);
    check("notification monitoring sees receipt-only assets and verifies the configured strategy", () => {
      assert.equal(snapshot.hasVaultAssets, true);
      assert.equal(snapshot.vaultBalance, parseEther("110"));
    });
    await assert.rejects(() => workerTest.getVaultSnapshot({ ...f.env, MORPHO_VAULT_ADDRESS: f.env.WLD_ADDRESS }, f.yieldVault), /configured Morpho strategy/);
    await (await f.morpho.setBrokenQuote(true)).wait();
    const broken = await workerTest.getVaultSnapshot(f.env, f.yieldVault);
    check("a missing WLD valuation does not hide protected shares from monitoring", () => {
      assert.equal(broken.vaultBalance, 0n); assert.equal(broken.hasVaultAssets, true);
    });
  }
  {
    const f = await yieldFixture({ ready: false });
    const signer = await provider.getSigner(3);
    const signerAddress = await signer.getAddress();
    await (await f.yieldFactory.connect(signer).withdrawAllFromMyVault(signerAddress, parseEther("108"))).wait();
    await provider.send("evm_increaseTime", [86400]); await provider.send("evm_mine", []);
    await (await f.yieldFactory.connect(signer).releaseMyVault()).wait();
    await (await f.yieldFactory.connect(signer).createVault(heirAddress, 86400)).wait();
    const next = await f.yieldFactory.vaultOf(signerAddress);
    const vault = new Contract(f.yieldVault, artifact("InheritanceVaultMorpho").abi, provider);
    const distributionAddress = await vault.MERKL_DISTRIBUTOR();
    const merkl = artifact("MockMerklDistributor");
    await provider.send("anvil_setCode", [distributionAddress, merkl.deployedBytecode.object]);
    const distribution = new Contract(distributionAddress, merkl.abi, owner);
    await (await f.token.mint(distributionAddress, parseEther("10"))).wait();
    const coder = AbiCoder.defaultAbiCoder();
    const sibling = keccak256(new TextEncoder().encode("late archived reward fixture"));
    const leaf = keccak256(coder.encode(["address", "address", "uint256"], [f.yieldVault, f.env.WLD_ADDRESS, parseEther("10")]));
    await (await distribution.setRoot(keccak256(coder.encode(["bytes32", "bytes32"], [leaf, sibling].sort())))).wait();
    await (await f.yieldFactory.claimRewardsFor(f.yieldVault, parseEther("10"), [sibling], 0)).wait();
    const { __test: workerTest } = await import("../backend/src/worker.mjs");
    const snapshot = await workerTest.getVaultSnapshot(f.env, f.yieldVault);
    check("monitoring authenticates released yield vaults through their immutable factory registry", () => {
      assert.equal(snapshot.hasVaultAssets, true);
    });
    await (await f.yieldFactory.connect(heir).fileClaimFor(f.yieldVault)).wait();
    await provider.send("evm_increaseTime", [7 * 86400]); await provider.send("evm_mine", []);
    const result = await runFinalizerCycle(f.env);
    check("the keeper finalizes delayed reward inheritance without touching the owner's replacement vault", () => {
      assert.equal(result.reason, "finalized", JSON.stringify(result));
    });
    assert.ok(await f.token.balanceOf(heirAddress) >= parseEther("9") - 2n);
    assert.equal(await f.token.balanceOf(next), 0n);
    assert.equal(await f.morpho.balanceOf(next), 0n);
    assert.equal(await vault.inheritanceRecipient(), heirAddress);
  }
  {
    const f = await yieldFixture({ ready: false });
    const otherOwner = await provider.getSigner(4);
    const otherAddress = await otherOwner.getAddress();
    await (await f.yieldFactory.connect(otherOwner).createVault(heirAddress, 86400)).wait();
    const otherVault = await f.yieldFactory.vaultOf(otherAddress);
    await (await f.token.mint(otherAddress, parseEther("100"))).wait();
    await (await f.token.connect(otherOwner).approve(f.env.YIELD_FACTORY_ADDRESS, parseEther("100"))).wait();
    await (await f.yieldFactory.connect(otherOwner).depositWithMinShares(parseEther("100"), 1)).wait();
    f.store.native.prepare("INSERT INTO watchers VALUES (?,1)").run(otherVault);
    const ordered = [f.yieldVault, otherVault].sort();
    await provider.send("evm_increaseTime", [86400]); await provider.send("evm_mine", []);
    await (await f.yieldFactory.connect(heir).fileClaimFor(ordered[1])).wait();
    await provider.send("evm_increaseTime", [7 * 86400]); await provider.send("evm_mine", []);
    // Local Anvil changes chain identity only for this final case. Its OP fee
    // oracle/receipt metadata are fixtures, so this verifies RPC request count,
    // not real World Chain fee levels or protocol bytecode.
    await provider.send("anvil_setChainId", [480]);
    behavior.oracleQuote = 0n; behavior.receiptExtra = 0n;
    f.env.FINALIZER_CHAIN_ID = "480";
    f.env.FINALIZER_EXTRA_FEE_RESERVE_ETH = "0.000001";
    const before = behavior.requests;
    const result = await runFinalizerCycle(f.env);
    check("two yield snapshots plus chain480 signing and OP fee calls fit the 50-RPC limit", () => {
      assert.equal(result.checked, 2, JSON.stringify(result));
      assert.equal(result.reason, "finalized", JSON.stringify(result));
      assert.ok(behavior.requests - before <= 50, String(behavior.requests - before));
    });
    await provider.send("anvil_setChainId", [31337]);
    behavior.oracleQuote = null; behavior.receiptExtra = null;
  }
  {
    const f = await yieldFixture();
    const other = await provider.getSigner(4), otherAddress = await other.getAddress();
    await (await f.yieldFactory.connect(other).createVault(heirAddress, 86400)).wait();
    const otherVault = await f.yieldFactory.vaultOf(otherAddress);
    await (await f.token.mint(otherAddress, parseEther("100"))).wait();
    await (await f.token.connect(other).approve(f.env.YIELD_FACTORY_ADDRESS, parseEther("100"))).wait();
    await (await f.yieldFactory.connect(other).depositWithMinShares(parseEther("100"), 1)).wait();
    f.store.native.prepare("INSERT INTO watchers VALUES (?,1)").run(otherVault);
    await provider.send("evm_increaseTime", [86400]); await provider.send("evm_mine", []);
    await (await f.yieldFactory.connect(heir).fileClaimFor(otherVault)).wait();
    await provider.send("evm_increaseTime", [7 * 86400]); await provider.send("evm_mine", []);
    await provider.send("anvil_setChainId", [480]);
    behavior.oracleQuote = 0n; behavior.receiptExtra = 0n;
    Object.assign(f.env, { FINALIZER_CHAIN_ID: "480", FINALIZER_EXTRA_FEE_RESERVE_ETH: "0.000001", FINALIZER_BATCH_SIZE: "5" });
    for (let cycle = 0; cycle < 2; cycle++) {
      const start = behavior.requests;
      behavior.requestLimit = start + 50;
      const result = await runFinalizerCycle(f.env);
      behavior.requestLimit = null;
      check("eligible yield queue cycle " + (cycle + 1) + " respects 50 requests even with requested batch5", () => {
        assert.equal(result.reason, "finalized", JSON.stringify(result));
        assert.equal(result.finalized, 1);
        assert.equal(result.submitted, 1);
        assert.ok(behavior.requests - start <= 50, String(behavior.requests - start));
        assert.equal(f.store.native.prepare("SELECT count(*) AS n FROM finalizer_jobs WHERE state='pending'").get().n, 0);
      });
    }
    assert.equal(f.store.native.prepare("SELECT count(*) AS n FROM finalizer_jobs WHERE state='confirmed'").get().n, 2);
    assert.equal((await readFinalizerHealth(f.env)).batchSize, 1);
    await provider.send("anvil_setChainId", [31337]);
    behavior.oracleQuote = null; behavior.receiptExtra = null;
  }
  {
    const f = await yieldFixture({ ready: false });
    const signer = await provider.getSigner(3);
    const signerAddress = await signer.getAddress();
    await (await f.morpho.setRate(parseEther("0.8"))).wait();
    await (await f.yieldFactory.connect(signer).withdrawAllFromMyVault(signerAddress, parseEther("80"))).wait();
    await (await f.token.mint(signerAddress, parseEther("100"))).wait();
    await (await f.token.connect(signer).approve(f.env.YIELD_FACTORY_ADDRESS, parseEther("100"))).wait();
    await (await f.yieldFactory.connect(signer).depositWithMinShares(parseEther("100"), 1)).wait();
    const distributorAddress = "0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae";
    const distributor = new Contract(distributorAddress, artifact("MockMerklDistributor").abi, owner);
    await (await f.token.mint(distributorAddress, parseEther("30"))).wait();
    await (await distributor.setOperator(await owner.getAddress(), true)).wait();
    const coder = AbiCoder.defaultAbiCoder();
    const sibling = keccak256(new TextEncoder().encode("external reward gas ceiling fixture"));
    const leaf = keccak256(coder.encode(["address", "address", "uint256"], [f.yieldVault, f.env.WLD_ADDRESS, parseEther("30")]));
    await (await distributor.setRoot(keccak256(coder.encode(["bytes32", "bytes32"], [leaf, sibling].sort())))).wait();
    await (await distributor.claim([f.yieldVault], [f.env.WLD_ADDRESS], [parseEther("30")], [[sibling]])).wait();
    await (await f.token.mint(f.yieldVault, parseEther("5"))).wait();
    await provider.send("evm_increaseTime", [86400]); await provider.send("evm_mine", []);
    await (await f.yieldFactory.connect(heir).fileClaimFor(f.yieldVault)).wait();
    await provider.send("evm_increaseTime", [7 * 86400]); await provider.send("evm_mine", []);
    await (await f.morpho.setGasFailure(true, true)).wait();
    const result = await runFinalizerCycle(f.env);
    check("the deployed gas limit settles exhausted redeem and valuation calls with its 20 percent padding", () => {
      assert.equal(result.reason, "finalized", JSON.stringify(result));
      const job = f.store.native.prepare("SELECT * FROM finalizer_jobs WHERE state='confirmed'").get();
      const signed = Transaction.from(job.tx_raw);
      assert.ok(signed.gasLimit > 750000n && signed.gasLimit <= BigInt(yieldDeploymentGas));
      const production = readFileSync(root + "/backend/wrangler.toml", "utf8");
      const value = name => production.match(new RegExp('^' + name + ' = "([^"\\n]+)"', 'm'))[1];
      const worstReserve = BigInt(yieldDeploymentGas) * parseUnits(value("FINALIZER_MAX_FEE_GWEI"), "gwei")
        + parseEther(value("FINALIZER_EXTRA_FEE_RESERVE_ETH"));
      assert.ok(worstReserve <= parseEther(value("FINALIZER_DAILY_GAS_CAP_ETH")));
    });
    assert.equal(await f.morpho.balanceOf(heirAddress), parseEther("125"));
    assert.equal(await f.token.balanceOf(heirAddress), parseEther("34"));
    assert.equal(await f.token.balanceOf(await owner.getAddress()), parseEther("1"));
    assert.equal(await f.morpho.balanceOf(f.yieldVault), 0n);
    assert.equal(await f.morpho.balanceOf(keeperAddress), 0n);
  }
  check("USDC execution headroom preserves the production daily ETH spending cap", () => {
    const production = readFileSync(root + "/backend/wrangler.toml", "utf8");
    const value = name => production.match(new RegExp('^' + name + ' = "([^"\\n]+)"', 'm'))[1];
    const worstReserve = BigInt(usdcDeploymentGas) * parseUnits(value("FINALIZER_MAX_FEE_GWEI"), "gwei")
      + parseEther(value("FINALIZER_EXTRA_FEE_RESERVE_ETH"));
    assert.ok(worstReserve <= parseEther(value("FINALIZER_DAILY_GAS_CAP_ETH")));
  });
  console.log("\n" + assertions + " focused finalizer checks passed; all transactions used local Anvil.");
  console.log("Factory deployment gas (local estimate): " + deploymentGas.toString());
} finally {
  provider?.destroy();
  if (proxy) await new Promise((resolve) => proxy.close(resolve));
  anvil.kill("SIGTERM");
}
