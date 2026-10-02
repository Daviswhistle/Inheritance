// Opt-in real-protocol verification. Transactions go only to the local Anvil fork.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Contract, JsonRpcProvider, Wallet, parseEther, toBeHex } from "ethers";
import { runGasRefillCycleWithTestConfig } from "../gas-refill/src/refill.mjs";
import { gasRefillTestStorage } from "./lib/gas-refill-test-storage.mjs";

const forkRpc = process.env.WORLDCHAIN_FORK_RPC;
if (!forkRpc) {
  console.log("SKIP real-protocol Worker fork: set WORLDCHAIN_FORK_RPC explicitly.");
  process.exit(0);
}
assert.equal(new URL(forkRpc).protocol, "https:");
const USDC = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1";
const POOL = "0x5f835420502A7702de50Cd0E78D8aA3608b2137e";
const ROUTER = "0x091AD9e2e6e5eD44c1c66dB50e49A601F9f36cF6";
const gasPrice = 1_500_000n;
// Public mnemonic accounts may already have EIP-7702 delegations on the forked chain.
const bot = Wallet.createRandom();
const treasury = Wallet.createRandom().address;
const beneficiary = Wallet.createRandom().address;

async function unusedPort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

const port = await unusedPort();
const localRpc = "http://127.0.0.1:" + port;
const anvil = spawn("anvil", ["--port", String(port), "--host", "127.0.0.1", "--chain-id", "480",
  "--fork-url", forkRpc, "--silent", "--base-fee", "0", "--gas-price", String(gasPrice)], { stdio: "ignore" });
let provider, proxy, store;
const guard = setTimeout(() => {
  console.error("Real-protocol fork exceeded its 120-second deadline.");
  anvil.kill("SIGTERM");
  process.exit(1);
}, 120_000);
guard.unref();

async function rpc(method, params = []) {
  const result = await (await fetch(localRpc, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })).json();
  if (result.error) throw new Error("Local fork RPC failed: " + method);
  return result.result;
}

try {
  for (let i = 0; ; i++) {
    try { await rpc("eth_chainId"); break; }
    catch {
      if (i > 100 || anvil.exitCode !== null) throw new Error("Local World Chain fork did not start");
      await delay(200);
    }
  }
  provider = new JsonRpcProvider(localRpc, 480, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 });
  for (const address of [bot.address, treasury, POOL]) {
    await rpc("anvil_setBalance", [address, toBeHex(parseEther(address === bot.address ? "0.00001" : "1"))]);
  }
  await rpc("anvil_setBalance", [beneficiary, "0x0"]);
  assert.equal(await provider.getCode(bot.address), "0x");
  assert.equal(await provider.getCode(beneficiary), "0x");
  await rpc("anvil_impersonateAccount", [POOL]);
  await rpc("anvil_impersonateAccount", [treasury]);
  const token = new Contract(USDC, [
    "function transfer(address,uint256) returns(bool)", "function approve(address,uint256) returns(bool)",
    "function allowance(address,address) view returns(uint256)",
  ], provider);
  // Allocate one USDC in the local fork; this does not move production pool funds.
  await (await token.connect(await provider.getSigner(POOL)).transfer(treasury, 1_000_000n, { gasPrice })).wait();
  await (await token.connect(await provider.getSigner(treasury)).approve(bot.address, 1_000_000n, { gasPrice })).wait();

  proxy = createServer(async (request, response) => {
    try {
      let body = "";
      for await (const part of request) body += part;
      const call = JSON.parse(body);
      // Accelerated fixture finality; production continues to use real finalized blocks.
      if (call.method === "eth_getBlockByNumber" && call.params[0] === "finalized") call.params[0] = "latest";
      const result = call.method === "eth_gasPrice"
        ? { jsonrpc: "2.0", id: call.id, result: toBeHex(gasPrice) }
        : await (await fetch(localRpc, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(call),
        })).json();
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(result));
    } catch { response.statusCode = 500; response.end("{}"); }
  });
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  store = gasRefillTestStorage();
  const env = { DB: store.DB, GAS_REFILL_ENABLED: "true", GAS_REFILL_PRIVATE_KEY: bot.privateKey };
  const cfg = { chainId: 480, rpcUrl: "http://127.0.0.1:" + proxy.address().port,
    identities: { bot: bot.address, treasury, beneficiary } };
  let result;
  for (let i = 0; i < 24; i++) {
    result = await runGasRefillCycleWithTestConfig(env, cfg);
    console.log(JSON.stringify({ iteration: i, reason: result.reason, phase: result.phase || null }));
    if (result.reason === "payout_complete") break;
    if (["rpc_unavailable", "twap_unavailable", "pending", "awaiting_finality"].includes(result.reason)) {
      await delay(500);
      continue;
    }
    assert.equal(result.reason, "refill_started", "Unexpected real-protocol state: " + result.reason);
  }
  assert.equal(result.reason, "payout_complete");
  assert.equal(await provider.getBalance(beneficiary), parseEther("0.0001"));
  assert.ok(await provider.getBalance(bot.address) >= parseEther("0.00001"));
  assert.equal(await token.allowance(bot.address, ROUTER), 0n);
  const job = store.native.prepare("SELECT * FROM gas_refill_jobs").get();
  assert.equal(job.state, "completed");
  assert.ok(BigInt(job.input_actual) > 0n && BigInt(job.input_actual) < 1_000_000n);
  assert.equal(store.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_transactions").get().n, 5);
  console.log(JSON.stringify({ status: "passed", protocol: "real World Chain fork", phases: 5,
    inputMicroUSDC: job.input_actual, payoutWei: job.payout_actual, gasLedgerWei: job.gas_spent,
    productionBroadcast: false }));
} finally {
  clearTimeout(guard);
  provider?.destroy();
  proxy?.close();
  store?.native.close();
  if (anvil.exitCode === null) {
    anvil.kill("SIGTERM");
    await new Promise(resolve => anvil.once("exit", resolve));
  }
}
