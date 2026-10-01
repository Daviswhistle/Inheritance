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
  ContractFactory, HDNodeWallet, Interface, JsonRpcProvider, Transaction, formatEther, parseEther,
} from "ethers";
import { readFinalizerHealth, runFinalizerCycle } from "../backend/src/finalizer.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const artifact = (file, name = file) =>
  JSON.parse(readFileSync(root + "/out/" + file + ".sol/" + name + ".json", "utf8"));
const tokenArtifact = artifact("MockERC20");
const factoryArtifact = artifact("InheritanceVaultWLDFactoryOnePerOwner");
const legacyArtifact = artifact("InheritanceAutomation.t", "LegacyAutomationFactory");
const factoryInterface = new Interface(factoryArtifact.abi);
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
  rpcErrorMethod: null, finalizedBlock: null };
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
      if (call.method === behavior.rpcErrorMethod) {
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
    const recovered = await runFinalizerCycle(f.env);
    behavior.finalizedBlock = null;
    const finalized = await runFinalizerCycle(f.env);
    check("real Anvil rollback before finality replays the same hash without a second reservation", () => {
      assert.equal(recovered.reason, "awaiting_finality", JSON.stringify(recovered));
      assert.equal(recovered.submitted, 1);
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
    const recovered = await runFinalizerCycle(f.env);
    check("real Anvil rollback of a confirmed claim restores execution with bounded conservative fees", () => {
      assert.equal(recovered.checked, 3, JSON.stringify(recovered));
      assert.equal(recovered.finalized, 1);
      assert.equal(recovered.submitted, 1);
      assert.ok(behavior.requests - requests <= 47); // Leaves three OP fee oracle calls.
      console.log("  confirmed reorg scan3/batch1 RPC requests: " + (behavior.requests - requests));
      const sends = behavior.sends.slice(start);
      assert.equal(sends.length, 2);
      assert.equal(sends[0].raw, sends[1].raw);
      assert.equal(new Set(sends.map((send) => send.nonce)).size, 1);
      assert.equal(f.store.faults.reservations, 2);
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
  console.log("\n" + assertions + " focused finalizer checks passed; all transactions used local Anvil.");
  console.log("Factory deployment gas (local estimate): " + deploymentGas.toString());
} finally {
  provider?.destroy();
  if (proxy) await new Promise((resolve) => proxy.close(resolve));
  anvil.kill("SIGTERM");
}
