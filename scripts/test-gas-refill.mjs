import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  Contract, ContractFactory, HDNodeWallet, Interface, JsonRpcProvider, Transaction,
  parseEther, toBeHex,
} from "ethers";
import { readGasRefillHealth, runGasRefillCycleWithTestConfig } from "../gas-refill/src/refill.mjs";
import worker from "../gas-refill/src/worker.mjs";
import { gasRefillTestStorage as storage } from "./lib/gas-refill-test-storage.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const mnemonic = "test test test test test test test test test test test junk";
const deadline = setTimeout(() => {
  console.error("Gas refill integration exceeded its 120-second deadline.");
  if (proxy) proxy.close();
  if (anvil && anvil.exitCode === null) anvil.kill("SIGTERM");
  process.exit(1);
}, 120_000);
deadline.unref();
let anvil;
let proxy;
let provider;
let owner;
let botSigner;
let keeperAddress;
let treasuryAddress;
let bot;
let treasury;
let usdc;
let weth;
let factory;
let router;
let badRouter;
let pool;
let rpcUrl;
let sqrtPrice;
let spotTick;
let clock = Date.now();
let assertions = 0;
const behavior = {
  sends: [], chainId: null, gasPrice: null, rpcErrorMethod: null,
  failObserve: false, finalityHash: null, hideReceiptReads: 0, hideTxReads: 0,
  droppedResponse: false, l1Fee: 0n, zeroLiquidity: false,
  intercept: null,
  operatorRPCError: false, unsupportedOperator: false,
};

const check = async (name, callback) => { await callback(); assertions++; console.log("PASS " + name); };
const hex = (value) => toBeHex(BigInt(value));
const artifact = (name) => JSON.parse(readFileSync(root + "/out/MockGasRefill.sol/" + name + ".json", "utf8"));
const testConfig = (url, extra = {}) => ({
  chainId: 480,
  rpcUrl: url,
  now: () => clock,
  identities: {
    usdc: usdc.target,
    weth: weth.target,
    factory: factory.target,
    router: router.target,
    pool: pool.target,
    treasury: treasuryAddress,
    beneficiary: keeperAddress,
    bot: bot.address,
    ...extra.identities,
  },
  hooks: extra.hooks || {},
});

async function unusedPort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  }).catch((error) => {
    throw new Error("local TCP binding unavailable (" + String(error.code || "network error") + ")");
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function upstream(method, params = []) {
  const result = await fetch(upstreamUrl, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return result.json();
}

let upstreamUrl;

async function waitReceipt(hash) {
  const until = Date.now() + 8_000;
  while (Date.now() < until) {
    const receipt = (await upstream("eth_getTransactionReceipt", [hash])).result;
    if (receipt) {
      const block = (await upstream("eth_getBlockByNumber", [receipt.blockNumber, false])).result;
      if (block?.hash === receipt.blockHash) return receipt;
    }
    await delay(20);
  }
  throw new Error("Anvil did not index a canonical receipt");
}

async function deploy(name, signer, args = []) {
  const art = artifact(name);
  const contract = await new ContractFactory(art.abi, art.bytecode.object, signer).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function prepare(store = storage(), configExtra = {}) {
  await provider.send("anvil_setBalance", [bot.address, hex(parseEther("0.00001"))]);
  await (await usdc.connect(botSigner).approve(router.target, 0n, { gasPrice: 1_000_000n })).wait();
  await usdc.burn(bot.address, await usdc.balanceOf(bot.address));
  await usdc.connect(treasury).approve(bot.address, 10_000_000n);
  await router.setInputRate(3_000_000_000n);
  await pool.setTicks(sqrtPrice, spotTick, spotTick, 0);
  await provider.send("anvil_setBalance", [keeperAddress, "0x0"]);
  await provider.send("anvil_setBalance", [bot.address, hex(parseEther("0.00001"))]);
  clock = Date.now();
  const env = { DB: store.DB, GAS_REFILL_ENABLED: "true", GAS_REFILL_PRIVATE_KEY: bot.privateKey };
  return { ...store, env, cfg: testConfig(rpcUrl, configExtra) };
}

async function cycle(f, extra = {}) {
  return runGasRefillCycleWithTestConfig(f.env, { ...f.cfg, ...extra,
    identities: { ...f.cfg.identities, ...extra.identities } });
}

async function runUntil(f, predicate, max = 16) {
  let result;
  for (let i = 0; i < max; i++) {
    result = await cycle(f);
    if (predicate(result, f.native)) return result;
    if (["blocked", "awaiting_budget", "insufficient_bot_gas", "gas_budget_exhausted", "wrong_chain",
      "wrong_protocol", "wrong_pool", "twap_unavailable", "price_gap", "fee_cap", "simulation_failed"].includes(result.reason)) return result;
  }
  assert.fail("cycle did not reach the expected state: " + JSON.stringify(result));
}

function setupFixture(journal) {
  // Exercise the actual fixed-identity local CLI entirely in memory and on local Anvil.
  // Every replacement is checked; a production RPC or private operator file is never used.
  let source = readFileSync(new URL("./setup-gas-refill.mjs", import.meta.url), "utf8");
  const replace = (before, after) => {
    assert.equal(source.split(before).length, 2, "setup fixture source identity drift");
    source = source.replace(before, after);
  };
  replace('import { chmodSync, closeSync, existsSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";',
    'const { chmodSync, closeSync, existsSync, openSync, readFileSync, renameSync, statSync, writeFileSync } = fixtureFS;');
  replace('import { spawnSync } from "node:child_process";', 'const { spawnSync } = await import("node:child_process");');
  replace('import { fileURLToPath } from "node:url";', 'const { fileURLToPath } = await import("node:url");');
  replace('import.meta.url', JSON.stringify(new URL("./setup-gas-refill.mjs", import.meta.url).href));
  replace('import { resolve } from "node:path";', 'const resolve = (path) => "/fixture/" + path;');
  replace('import { setTimeout as delay } from "node:timers/promises";',
    'const { setTimeout: delay } = await import("node:timers/promises");');
  replace('import { isExecutionRevert } from "../gas-refill/src/rpc-errors.mjs";',
    'const { isExecutionRevert } = await import(' + JSON.stringify(new URL("../gas-refill/src/rpc-errors.mjs", import.meta.url).href) + ');');
  const ethersImport = source.match(/^import \{([^\n]+)\} from "ethers";$/m)?.[0];
  assert.ok(ethersImport);
  replace(ethersImport, ethersImport.replace("import ", "const ").replace(' from "ethers";',
    " = await import(" + JSON.stringify(import.meta.resolve("ethers")) + ");"));
  replace('RPC = "https://worldchain-mainnet.g.alchemy.com/public"', "RPC = " + JSON.stringify(rpcUrl));
  for (const [original, local] of [
    ["0x93bC44B8296977Feb479F95855D9b9E051C17dA2", treasuryAddress],
    ["0x8C31Bbc49C371d431f884aB18Ba5aA25B0D9170b", keeperAddress],
    ["0x79A02482A880bCE3F13e09Da970dC34db4CD24d1", usdc.target],
    ["0x20A85A9e929C69A440938eb650d70619b7562eD5", bot.address],
  ]) replace(original, local);
  assert.ok(!source.includes("https://worldchain-mainnet"));
  const ownerWallet = HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/3");
  const files = new Map([
    ["/fixture/.env.gas-refill", "GAS_REFILL_PRIVATE_KEY=" + bot.privateKey + "\n"],
    ["/fixture/.env.deploy", "PRIVATE_KEY=" + ownerWallet.privateKey + "\n"],
    ["/fixture/.env.gas-refill-activation.json", JSON.stringify(journal)],
  ]);
  const fixtureFS = {
    chmodSync() {}, existsSync: (path) => files.has(path), readFileSync: (path) => files.get(path),
    statSync: () => ({ mode: 0o100600 }), writeFileSync: (path, value) => files.set(path, value),
    renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); },
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  return {
    journal: () => JSON.parse(files.get("/fixture/.env.gas-refill-activation.json")),
    async run() {
      const fakeProcess = { argv: ["node", "setup.mjs", "--activate", "--broadcast"], exitCode: 0,
        env: { INHERITANCE_SETUP_LOCK: "/fixture/.env.gas-refill-activation.json.lock" } };
      await new AsyncFunction("fixtureFS", "process", source)(fixtureFS, fakeProcess);
      return fakeProcess.exitCode;
    },
  };
}

function processSetupFixture() {
  const directory = mkdtempSync(tmpdir() + "/inheritance-setup-test-");
  const children = new Set();
  let source = readFileSync(new URL("./setup-gas-refill.mjs", import.meta.url), "utf8");
  const replace = (before, after) => {
    assert.equal(source.split(before).length, 2, "local CLI fixture identity drift");
    source = source.replace(before, after);
  };
  replace('from "ethers";', 'from ' + JSON.stringify(import.meta.resolve("ethers")) + ';');
  replace('from "../gas-refill/src/rpc-errors.mjs";',
    'from ' + JSON.stringify(new URL("../gas-refill/src/rpc-errors.mjs", import.meta.url).href) + ';');
  replace('RPC = "https://worldchain-mainnet.g.alchemy.com/public"', "RPC = " + JSON.stringify(rpcUrl));
  for (const [original, local] of [
    ["0x93bC44B8296977Feb479F95855D9b9E051C17dA2", treasuryAddress],
    ["0x8C31Bbc49C371d431f884aB18Ba5aA25B0D9170b", keeperAddress],
    ["0x79A02482A880bCE3F13e09Da970dC34db4CD24d1", usdc.target],
    ["0x20A85A9e929C69A440938eb650d70619b7562eD5", bot.address],
  ]) replace(original, local);
  assert.ok(rpcUrl.startsWith("http://127.0.0.1:"));
  assert.ok(!source.includes("https://worldchain-mainnet"));
  const ownerWallet = HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/3");
  writeFileSync(directory + "/setup.mjs", source, { mode: 0o600 });
  writeFileSync(directory + "/.env.gas-refill", "GAS_REFILL_PRIVATE_KEY=" + bot.privateKey + "\n", { mode: 0o600 });
  writeFileSync(directory + "/.env.deploy", "PRIVATE_KEY=" + ownerWallet.privateKey + "\n", { mode: 0o600 });
  return {
    directory,
    cleanup() {
      for (const child of children) {
        try { process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ }
      }
      rmSync(directory, { recursive: true, force: true });
    },
    run() {
      const childEnv = { ...process.env };
      delete childEnv.INHERITANCE_SETUP_LOCK;
      const child = spawn(process.execPath, [directory + "/setup.mjs", "--activate", "--broadcast"], {
        cwd: directory, env: childEnv, detached: true, stdio: ["ignore", "pipe", "pipe"],
      });
      children.add(child);
      let output = "";
      child.stdout.on("data", (data) => { output += data; });
      child.stderr.on("data", (data) => { output += data; });
      return new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (exitCode) => { children.delete(child); resolve({ exitCode, output }); });
      });
    },
  };
}

try {
  const port = await unusedPort();
  upstreamUrl = "http://127.0.0.1:" + port;
  anvil = spawn("anvil", ["--port", String(port), "--chain-id", "480", "--accounts", "12",
    "--mnemonic", mnemonic, "--silent", "--block-time", "1", "--mixed-mining", "--base-fee", "0",
    "--gas-price", "1000000"], { stdio: "ignore" });
  for (let i = 0; ; i++) {
    try { await upstream("eth_chainId"); break; }
    catch {
      if (i > 100 || anvil.exitCode !== null) throw new Error("local Anvil did not start");
      await delay(50);
    }
  }
  provider = new JsonRpcProvider(upstreamUrl, 480, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 });
  provider.pollingInterval = 100;
  owner = await provider.getSigner(0);
  treasury = await provider.getSigner(3);
  treasuryAddress = await treasury.getAddress();
  botSigner = HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/1").connect(provider);
  bot = botSigner;
  keeperAddress = await (await provider.getSigner(2)).getAddress();

  proxy = createServer(async (request, response) => {
    try {
      let raw = "";
      for await (const part of request) raw += part;
      const call = JSON.parse(raw);
      const intercepted = behavior.intercept ? await behavior.intercept(call) : null;
      if (intercepted) {
        response.end(JSON.stringify({ ...intercepted, id: call.id }));
        return;
      }
      if (behavior.rpcErrorMethod === call.method) {
        response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, error: { code: -32000, message: "Local RPC outage" } }));
        return;
      }
      if (call.method === "eth_chainId" && behavior.chainId) {
        response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: behavior.chainId }));
        return;
      }
      if (call.method === "eth_gasPrice") {
        response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: behavior.gasPrice || hex(1_000_000n) }));
        return;
      }
      if (call.method === "eth_call" && call.params[0].to?.toLowerCase() === "0x420000000000000000000000000000000000000f") {
        const oracle = new Interface(["function getL1Fee(bytes) view returns(uint256)", "function getOperatorFee(uint256) view returns(uint256)"]);
        const name = call.params[0].data.startsWith(oracle.getFunction("getL1Fee").selector) ? "getL1Fee" : "getOperatorFee";
        if (name === "getOperatorFee" && (behavior.operatorRPCError || behavior.unsupportedOperator)) {
          response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, error: behavior.operatorRPCError
            ? { code: -32000, message: "Local operator oracle RPC outage" }
            : { code: 3, message: "execution reverted", data: "0x" } }));
          return;
        }
        response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id,
          result: oracle.encodeFunctionResult(name, [name === "getL1Fee" ? behavior.l1Fee : 0n]) }));
        return;
      }
      if (behavior.zeroLiquidity && call.method === "eth_call" &&
          call.params[0].to?.toLowerCase() === pool.target.toLowerCase() &&
          call.params[0].data.startsWith(new Interface(["function liquidity() view returns(uint128)"]).getFunction("liquidity").selector)) {
        response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id,
          result: new Interface(["function liquidity() view returns(uint128)"]).encodeFunctionResult("liquidity", [0n]) }));
        return;
      }
      if (call.method === "eth_getBlockByNumber" && call.params[0] === "finalized") {
        // Explicit fixture finality; production uses the chain's real finalized tag.
        call.params[0] = behavior.finalityHash || "latest";
      }
      if (call.method === "eth_getTransactionReceipt" && behavior.hideReceiptReads > 0) {
        behavior.hideReceiptReads--;
        response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: null }));
        return;
      }
      if (call.method === "eth_getTransactionByHash" && behavior.hideTxReads > 0) {
        behavior.hideTxReads--;
        response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result: null }));
        return;
      }
      if (behavior.failObserve && call.method === "eth_call" &&
          call.params[0].to?.toLowerCase() === pool.target.toLowerCase() &&
          call.params[0].data.startsWith(new Interface(["function observe(uint32[])"]).getFunction("observe").selector)) {
        response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, error: { code: -32000, message: "observe unavailable" } }));
        return;
      }
      if (call.method === "eth_sendRawTransaction") {
        const tx = Transaction.from(call.params[0]);
        behavior.sends.push({ raw: call.params[0], hash: tx.hash, from: tx.from, to: tx.to,
          data: tx.data, value: tx.value, chainId: tx.chainId, nonce: tx.nonce });
      }
      let output = await (await fetch(upstreamUrl, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(call),
      })).json();
      if (call.method === "eth_sendRawTransaction" && output.result) {
        await waitReceipt(output.result);
        if (behavior.droppedResponse) {
          behavior.droppedResponse = false;
          response.destroy();
          return;
        }
      }
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(output));
    } catch {
      response.statusCode = 500;
      response.end("{}");
    }
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  rpcUrl = "http://127.0.0.1:" + proxy.address().port;

  weth = await deploy("MockGasRefillWETH", owner);
  usdc = await deploy("MockGasRefillERC20", owner, ["USD Coin", "USDC", 6]);
  factory = await deploy("MockGasRefillFactory", owner);
  router = await deploy("MockGasRefillRouter", owner, [factory.target, weth.target]);
  const rawPrice = 3e-9;
  spotTick = Math.floor(Math.log(rawPrice) / Math.log(1.0001));
  // Keep the fixture safely inside this tick, above floating-point boundary error.
  sqrtPrice = BigInt(Math.floor(Math.sqrt(1.0001 ** (spotTick + 0.5)) * 2 ** 96));
  pool = await deploy("MockGasRefillPool", owner, [factory.target, weth.target, usdc.target, sqrtPrice, spotTick]);
  await factory.setPool(usdc.target, weth.target, 500, pool.target);
  badRouter = await deploy("MockGasRefillRouter", owner, [await owner.getAddress(), weth.target]);
  await provider.send("anvil_setBalance", [weth.target, hex(parseEther("10"))]);
  await usdc.mint(treasuryAddress, 10_000_000n);
  await usdc.connect(treasury).approve(bot.address, 10_000_000n);

  const empty = storage();
  const disabled = await runGasRefillCycleWithTestConfig({ DB: empty.DB }, testConfig(rpcUrl));
  await check("missing enable flag or dedicated key keeps the service disabled", () => {
    assert.deepEqual(disabled, { enabled: false, reason: "disabled" });
    assert.equal(empty.native.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'gas_refill_%'").get(), undefined);
  });
  const healthResponse = await worker.fetch(new Request("http://worker/api/health"), { DB: empty.DB });
  const healthBody = await healthResponse.json();
  const postResponse = await worker.fetch(new Request("http://worker/api/gas-refill/health", { method: "POST" }), {});
  await check("HTTP health is read-only and non-GET routes cannot mutate", () => {
    assert.equal(healthBody.status, "ok");
    assert.equal(healthBody.gasRefill.status, "disabled");
    assert.equal(postResponse.status, 404);
    assert.equal(empty.native.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'gas_refill_%'").get(), undefined);
  });
  const invalidHealth = await readGasRefillHealth({ GAS_REFILL_ENABLED: "true", GAS_REFILL_PRIVATE_KEY: "invalid",
    DB: { prepare() { assert.fail("invalid key must not query storage"); } } });
  await check("malformed signing secrets are configuration failures in health", () => {
    assert.deepEqual(invalidHealth, { enabled: false, status: "invalid_configuration", reason: "invalid_configuration" });
  });

  behavior.chainId = "0x1";
  const wrongChain = await cycle(await prepare());
  behavior.chainId = null;
  await check("wrong chain fails closed before a transaction", () => {
    assert.equal(wrongChain.reason, "wrong_chain");
    assert.equal(behavior.sends.length, 0);
  });

  let f = await prepare();
  const wrongRouter = await runGasRefillCycleWithTestConfig(f.env,
    testConfig(rpcUrl, { identities: { router: badRouter.target } }));
  await check("router factory and WETH identities are checked", () => {
    assert.equal(wrongRouter.reason, "wrong_protocol");
    assert.equal(behavior.sends.length, 0);
  });

  f = await prepare();
  await provider.send("anvil_setCode", [bot.address, "0x00"]);
  const codedBot = await cycle(f);
  await provider.send("anvil_setCode", [bot.address, "0x"]);
  await check("refill and payout identities must be ordinary EOAs", () => {
    assert.equal(codedBot.reason, "wrong_protocol");
    assert.equal(behavior.sends.length, 0);
  });

  f = await prepare();
  const wrongSource = await cycle(f, { identities: { treasury: await (await provider.getSigner(4)).getAddress() } });
  await check("a different unfunded USDC source is never pulled", () => {
    assert.equal(wrongSource.reason, "awaiting_budget");
    assert.equal(behavior.sends.length, 0);
  });

  f = await prepare();
  await provider.send("anvil_setBalance", [keeperAddress, hex(parseEther("0.00003"))]);
  const healthy = await cycle(f);
  await check("healthy keeper balance performs no pull, approval or swap", () => {
    assert.equal(healthy.reason, "healthy");
    assert.equal(behavior.sends.length, 0);
  });

  f = await prepare();
  await provider.send("anvil_setBalance", [bot.address, hex(parseEther("0.000003"))]);
  const noBotGas = await cycle(f);
  await check("bot below the hard minimum cannot start", () => {
    assert.equal(noBotGas.reason, "insufficient_bot_gas");
    assert.equal(behavior.sends.length, 0);
  });

  f = await prepare();
  await usdc.connect(treasury).approve(bot.address, 0n);
  const noBudget = await cycle(f);
  await check("missing finite treasury allowance returns awaiting_budget", () => {
    assert.equal(noBudget.reason, "awaiting_budget");
    assert.equal(behavior.sends.length, 0);
  });

  f = await prepare();
  behavior.failObserve = true;
  const noTwap = await cycle(f);
  behavior.failObserve = false;
  await check("an unavailable 1800-second TWAP prevents all mutations", () => {
    assert.equal(noTwap.reason, "twap_unavailable");
    assert.equal(behavior.sends.length, 0);
  });

  f = await prepare();
  await pool.setTicks(sqrtPrice, spotTick, spotTick + 101, 0);
  const badGap = await cycle(f);
  await pool.setTicks(sqrtPrice, spotTick, spotTick, 1799);
  await check("spot to TWAP gap above 100 ticks fails closed", () => {
    assert.equal(badGap.reason, "price_gap");
    assert.equal(behavior.sends.length, 0);
  });

  f = await prepare();
  assert.ok(spotTick < 0, "test pool must exercise negative tick division");
  await pool.setTicks(sqrtPrice, spotTick, spotTick, 1799);
  const floorQuoteResult = await cycle(f);
  assert.equal(floorQuoteResult.reason, "refill_started", JSON.stringify(floorQuoteResult));
  const floorRoundedQuote = f.native.prepare("SELECT amount_in_max FROM gas_refill_jobs").get().amount_in_max;
  f = await prepare();
  await pool.setTicks(sqrtPrice, spotTick, spotTick, 0);
  await cycle(f);
  const exactTickQuote = f.native.prepare("SELECT amount_in_max FROM gas_refill_jobs").get().amount_in_max;
  await check("negative non-integral TWAP tick rounds toward negative infinity", () => {
    assert.equal(floorRoundedQuote, exactTickQuote);
  });

  f = await prepare();
  const expensiveTick = Math.floor(Math.log(1e-8) / Math.log(1.0001));
  const expensiveSqrt = BigInt(Math.floor(Math.sqrt(1.0001 ** (expensiveTick + 0.5)) * 2 ** 96));
  await pool.setTicks(expensiveSqrt, expensiveTick, expensiveTick, 0);
  const quoteOverCapStart = behavior.sends.length;
  const quoteOverCap = await cycle(f);
  await check("integer TWAP quote above one USDC cannot start a refill", () => {
    assert.equal(quoteOverCap.reason, "quote_exceeds_budget");
    assert.equal(behavior.sends.length, quoteOverCapStart);
  });

  f = await prepare();
  const gasCapStart = behavior.sends.length;
  behavior.gasPrice = "0x989680000000000000";
  const gasCapped = await cycle(f);
  behavior.gasPrice = null;
  await check("gas price above 0.01 gwei cannot be signed", () => {
    assert.equal(gasCapped.reason, "fee_cap");
    assert.equal(behavior.sends.length, gasCapStart);
  });

  f = await prepare();
  // Canonical TickMath(-196257): ceil(sqrt(1.0001^-196257) * 2^96).
  // A zeroForOne boundary crossing stores this price with slot0.tick = -196258.
  const boundarySqrt = 4_339_363_644_587_371_378_270_009n;
  await pool.setTicks(boundarySqrt, -196258, -196258, 0);
  const boundaryPull = await cycle(f);
  await check("normal zeroForOne tick-boundary slot0 state allows a bounded refill", () => {
    assert.equal(boundaryPull.reason, "refill_started");
    assert.equal(boundaryPull.phase, "pull");
    assert.ok(BigInt(f.native.prepare("SELECT amount_in_max FROM gas_refill_jobs").get().amount_in_max) <= 1_000_000n);
  });
  const boundaryPayout = await runUntil(f, (result) => result.reason === "payout_complete");
  await check("a valid tick-boundary price also survives the pre-swap oracle refresh", () => {
    assert.equal(boundaryPayout.reason, "payout_complete");
    assert.equal(f.native.prepare("SELECT state FROM gas_refill_jobs").get().state, "completed");
  });
  f = await prepare();
  await pool.setTicks(boundarySqrt + 1n, -196258, -196258, 0);
  const invalidBoundaryStart = behavior.sends.length;
  const invalidBoundary = await cycle(f);
  await check("one wei beyond the declared tick interval still rejects the inconsistent price before pulling", () => {
    assert.equal(invalidBoundary.reason, "quote_unavailable");
    assert.equal(behavior.sends.length, invalidBoundaryStart);
  });

  f = await prepare();
  const startSend = behavior.sends.length;
  const results = await Promise.all([cycle(f), cycle(f)]);
  await check("concurrent cron invocations share one lease and one pull transaction", () => {
    assert.equal(behavior.sends.length - startSend, 1);
    assert.ok(results.some((result) => result.reason === "locked"));
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_transactions").get().n, 1);
  });

  f = await prepare();
  behavior.rpcErrorMethod = "eth_estimateGas";
  const estimateFailure = await cycle(f);
  behavior.rpcErrorMethod = null;
  await check("provider estimate errors without revert data retain the active job for retry", () => {
    assert.equal(estimateFailure.reason, "rpc_unavailable");
    assert.equal(f.native.prepare("SELECT state FROM gas_refill_jobs").get().state, "active");
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_transactions").get().n, 0);
    assert.ok(BigInt(f.native.prepare("SELECT gas_reserved FROM gas_refill_jobs").get().gas_reserved) > 0n);
  });
  const estimateRecovered = await runUntil(f, (result) => result.reason === "payout_complete");
  await check("automatic refill resumes the same job after gas-estimate RPC service recovers", () => {
    assert.equal(estimateRecovered.reason, "payout_complete");
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_jobs").get().n, 1);
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_transactions WHERE phase='pull'").get().n, 1);
  });

  f = await prepare();
  let budgetGasReads = 0;
  behavior.intercept = async (call) => call.method === "eth_gasPrice" && ++budgetGasReads === 2
    ? { jsonrpc: "2.0", result: hex(10_000_001n) } : null;
  assert.equal((await cycle(f)).reason, "fee_cap");
  behavior.intercept = null;
  const remainingTreasury = await usdc.balanceOf(treasuryAddress);
  await (await usdc.burn(treasuryAddress, remainingTreasury)).wait();
  const missingTreasury = await cycle(f);
  await (await usdc.mint(treasuryAddress, remainingTreasury)).wait();
  await check("temporary treasury shortfall after allocation waits without signing or dropping reservations", () => {
    assert.equal(missingTreasury.reason, "awaiting_budget");
    assert.equal(f.native.prepare("SELECT state FROM gas_refill_jobs").get().state, "active");
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_transactions").get().n, 0);
    assert.ok(BigInt(f.native.prepare("SELECT input_reserved FROM gas_refill_jobs").get().input_reserved) > 0n);
  });
  await (await usdc.connect(treasury).approve(bot.address, 0n)).wait();
  const missingApproval = await cycle(f);
  await check("temporary finite allowance shortfall after allocation also waits", () => {
    assert.equal(missingApproval.reason, "awaiting_budget");
    assert.equal(f.native.prepare("SELECT state FROM gas_refill_jobs").get().state, "active");
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_transactions").get().n, 0);
  });
  await (await usdc.connect(treasury).approve(bot.address, 10_000_000n)).wait();
  const budgetRecovered = await runUntil(f, (result) => result.reason === "payout_complete");
  await check("restored treasury funds and allowance resume the original job once", () => {
    assert.equal(budgetRecovered.reason, "payout_complete");
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_jobs").get().n, 1);
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_transactions WHERE phase='pull'").get().n, 1);
  });

  f = await prepare();
  let racedFunds = 0n;
  const pullSelector = new Interface(["function transferFrom(address,address,uint256) returns(bool)"]).getFunction("transferFrom").selector;
  behavior.intercept = async (call) => {
    if (racedFunds === 0n && call.method === "eth_call" && call.params[0].to?.toLowerCase() === usdc.target.toLowerCase() &&
        call.params[0].data.startsWith(pullSelector)) {
      racedFunds = await usdc.balanceOf(treasuryAddress);
      await (await usdc.burn(treasuryAddress, racedFunds)).wait();
    }
    return null;
  };
  const racedBudget = await cycle(f);
  behavior.intercept = null;
  await check("treasury funds changing between the budget check and simulation still wait safely", () => {
    assert.ok(racedFunds > 0n);
    assert.equal(racedBudget.reason, "awaiting_budget");
    assert.equal(f.native.prepare("SELECT state FROM gas_refill_jobs").get().state, "active");
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_transactions").get().n, 0);
  });
  await (await usdc.mint(treasuryAddress, racedFunds)).wait();
  const raceRecovered = await runUntil(f, (result) => result.reason === "payout_complete");
  await check("a budget race recovers automatically without duplicating its job or pull", () => {
    assert.equal(raceRecovered.reason, "payout_complete");
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_jobs").get().n, 1);
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_transactions WHERE phase='pull'").get().n, 1);
  });

  f = await prepare();
  const operatorErrorStart = behavior.sends.length;
  behavior.operatorRPCError = true;
  const operatorError = await cycle(f);
  behavior.operatorRPCError = false;
  await check("operator oracle RPC failure is not interpreted as an unsupported zero-fee method", () => {
    assert.equal(operatorError.reason, "quote_unavailable");
    assert.equal(behavior.sends.length, operatorErrorStart);
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_jobs").get().n, 0);
  });
  const operatorRecovered = await runUntil(f, (result) => result.reason === "payout_complete");
  await check("oracle RPC recovery permits a normally bounded refill", () => {
    assert.equal(operatorRecovered.reason, "payout_complete");
    assert.equal(f.native.prepare("SELECT state FROM gas_refill_jobs").get().state, "completed");
  });
  f = await prepare();
  behavior.unsupportedOperator = true;
  const unsupportedOperator = await runUntil(f, (result) => result.reason === "payout_complete");
  behavior.unsupportedOperator = false;
  await check("explicit empty-data EVM revert preserves compatibility with an absent optional operator-fee method", () => {
    assert.equal(unsupportedOperator.reason, "payout_complete");
    assert.equal(f.native.prepare("SELECT state FROM gas_refill_jobs").get().state, "completed");
  });

  // One complete real local transaction path: finite pull, exact approval, router multicall, revoke, fixed payout.
  f = await prepare();
  behavior.droppedResponse = true;
  const droppedStart = behavior.sends.length;
  const first = await cycle(f);
  assert.equal(first.reason, "refill_started");
  const pullRow = f.native.prepare("SELECT * FROM gas_refill_transactions WHERE phase='pull'").get();
  const firstHash = pullRow.tx_hash;
  await check("dropped broadcast acknowledgement is recovered from the persisted signed transaction", () => {
    assert.ok(pullRow.tx_raw);
    assert.equal(Transaction.from(pullRow.tx_raw).hash, firstHash);
    assert.equal(behavior.sends[droppedStart].hash, firstHash);
  });
  behavior.rpcErrorMethod = "eth_getTransactionReceipt";
  const outage = await cycle(f);
  behavior.rpcErrorMethod = null;
  await check("receipt RPC outage retains the pending reservation without a second nonce", () => {
    assert.equal(outage.reason, "pending");
    assert.equal(behavior.sends.length, droppedStart + 1);
    assert.equal(f.native.prepare("SELECT status FROM gas_refill_transactions WHERE phase='pull'").get().status, "staged");
    assert.equal(f.native.prepare("SELECT input_reserved FROM gas_refill_jobs").get().input_reserved,
      f.native.prepare("SELECT amount_in_max FROM gas_refill_jobs").get().amount_in_max);
  });
  const hiddenStart = behavior.sends.length;
  behavior.hideReceiptReads = 1;
  const hiddenReceipt = await cycle(f);
  await check("delayed receipt indexing is reconciled by transaction hash without rebroadcast", () => {
    assert.equal(hiddenReceipt.reason, "pending");
    assert.equal(behavior.sends.length, hiddenStart);
  });
  await cycle(f); // Confirm pull and advance to approval.
  await cycle(f); // Submit approval.
  await cycle(f); // Confirm approval and advance to swap.
  await cycle(f); // Submit exact-output swap.
  await cycle(f); // Confirm swap and advance to allowance revoke.
  await cycle(f); // Submit allowance revoke.
  await cycle(f); // Confirm revoke and advance to payout.
  await cycle(f); // Submit beneficiary payout.
  const completed = await runUntil(f, (result) => result.reason === "payout_complete" || result.reason === "beneficiary_refilled");
  const job = f.native.prepare("SELECT * FROM gas_refill_jobs").get();
  const txRows = f.native.prepare("SELECT * FROM gas_refill_transactions ORDER BY created_at,nonce").all();
  const counts = Object.fromEntries(f.native.prepare("SELECT phase,COUNT(*) AS n FROM gas_refill_transactions GROUP BY phase").all()
    .map((row) => [row.phase, row.n]));
  const transferred = behavior.sends.filter((tx) => tx.from?.toLowerCase() === bot.address.toLowerCase()).slice(-5);
  await check("actual bounded USDC pull, exact-output swap, allowance revoke and beneficiary payout complete", async () => {
    assert.equal(completed.reason, "payout_complete");
    assert.deepEqual(counts, { approve: 1, payout: 1, pull: 1, revoke: 1, swap: 1 });
    assert.equal(txRows.length, 5);
    assert.ok(txRows.every((row) => row.status === "confirmed"));
    assert.equal(job.state, "completed");
    assert.ok(BigInt(job.amount_in_max) <= 1_000_000n);
    assert.ok(BigInt(job.input_actual) > 0n && BigInt(job.input_actual) < BigInt(job.amount_in_max));
    assert.equal(await usdc.allowance(bot.address, router.target), 0n);
    assert.equal(await usdc.balanceOf(bot.address), BigInt(job.amount_in_max) - BigInt(job.input_actual));
    assert.equal(await usdc.allowance(treasuryAddress, bot.address), 10_000_000n - BigInt(job.pull_amount));
    assert.equal(await provider.getBalance(keeperAddress), parseEther("0.0001"));
    assert.ok(await provider.getBalance(bot.address) >= parseEther("0.00001"));
    const payout = txRows.find((row) => row.phase === "payout");
    const payoutTx = Transaction.from(payout.tx_raw);
    assert.equal(payoutTx.to.toLowerCase(), keeperAddress.toLowerCase());
    assert.equal(payoutTx.value, BigInt(job.payout_actual));
    assert.ok(transferred.every((tx) => tx.chainId === 480n));
    assert.equal(job.input_reserved, "0");
  });
  await check("rolling ledgers count actual gas and actual swap input exactly once", () => {
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_ledger WHERE kind='gas'").get().n, 5);
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_ledger WHERE kind='input'").get().n, 1);
    assert.equal(f.native.prepare("SELECT amount FROM gas_refill_ledger WHERE kind='input'").get().amount, job.input_actual);
  });
  await cycle(f);
  await check("a completed receipt cannot double-credit or double-charge a later cycle", () => {
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_ledger WHERE kind='gas'").get().n, 5);
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_ledger WHERE kind='input'").get().n, 1);
  });

  const inputScope = f.native.prepare("SELECT scope FROM gas_refill_jobs").get().scope;
  f.native.prepare("INSERT INTO gas_refill_ledger(scope,kind,ref,amount,occurred_at) VALUES(?,'input','prior-spend','800000',?)")
    .run(inputScope, clock);
  await provider.send("anvil_setBalance", [keeperAddress, "0x0"]);
  const inputCapStart = behavior.sends.length;
  const inputCapped = await cycle(f);
  await check("actual settled USDC plus the next reservation cannot exceed the rolling one-USDC budget", () => {
    assert.equal(inputCapped.reason, "awaiting_budget");
    assert.equal(behavior.sends.length, inputCapStart);
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_jobs").get().n, 1);
  });

  // Confirmed receipts are not advanced until finality; if the receipt block is reorged, replay the same raw tx.
  f = await prepare();
  const snapshot = await provider.send("evm_snapshot", []);
  const reorgStart = behavior.sends.length;
  await cycle(f); // Stage and mine pull.
  behavior.finalityHash = "0x0";
  const waitingFinality = await cycle(f);
  const beforeReorg = f.native.prepare("SELECT * FROM gas_refill_transactions WHERE phase='pull'").get();
  await provider.send("evm_revert", [snapshot]);
  behavior.finalityHash = null;
  const replay = await cycle(f);
  await check("non-final receipt is held, and a detectable reorg retries the same hash, nonce and bytes", () => {
    assert.equal(waitingFinality.reason, "awaiting_finality");
    assert.equal(beforeReorg.status, "mined");
    assert.equal(replay.reason, "pending");
    const replaySends = behavior.sends.slice(reorgStart);
    assert.equal(replaySends.length, 2);
    assert.equal(replaySends[0].hash, replaySends[1].hash);
    assert.equal(replaySends[0].raw, replaySends[1].raw);
    assert.equal(replaySends[0].nonce, replaySends[1].nonce);
  });

  f = await prepare();
  const duringFinalitySnapshot = await provider.send("evm_snapshot", []);
  const duringFinalityStart = behavior.sends.length;
  await cycle(f);
  const orphanPull = f.native.prepare("SELECT * FROM gas_refill_transactions WHERE phase='pull'").get();
  let reorgOnFinality = false;
  behavior.intercept = async (call) => {
    if (!reorgOnFinality && call.method === "eth_getBlockByNumber" && call.params[0] === "finalized") {
      reorgOnFinality = true;
      await provider.send("evm_revert", [duringFinalitySnapshot]);
      await provider.send("evm_mine", []);
      await provider.send("evm_mine", []);
      return upstream("eth_getBlockByNumber", ["latest", false]);
    }
    return null;
  };
  const invalidatedReceipt = await cycle(f);
  behavior.intercept = null;
  await check("reorg during finality lookup cannot confirm an orphaned treasury pull", async () => {
    assert.ok(reorgOnFinality);
    assert.equal(invalidatedReceipt.reason, "pending");
    assert.equal(f.native.prepare("SELECT status FROM gas_refill_transactions WHERE phase='pull'").get().status, "orphaned");
    assert.equal(f.native.prepare("SELECT phase FROM gas_refill_jobs").get().phase, "pull");
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_ledger").get().n, 0);
    assert.equal(await usdc.balanceOf(bot.address), 0n);
  });
  await runUntil(f, (result) => result.reason === "payout_complete");
  await check("orphaned pull resumes the original signature and settles input only once", () => {
    const pulls = behavior.sends.slice(duringFinalityStart).filter((sent) => sent.hash === orphanPull.tx_hash);
    assert.equal(pulls.length, 2);
    assert.ok(pulls.every((sent) => sent.raw === orphanPull.tx_raw));
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_transactions WHERE phase='pull'").get().n, 1);
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_ledger WHERE kind='input'").get().n, 1);
  });

  // An old runner cannot release a new owner's staged payout after its lease expires.
  f = await prepare();
  await runUntil(f, (_result, db) => db.prepare("SELECT phase FROM gas_refill_jobs").get()?.phase === "payout");
  await provider.send("anvil_setBalance", [keeperAddress, hex(parseEther("0.0001"))]);
  let releaseBalance, balanceCaptured;
  const balanceGate = new Promise((resolve) => { releaseBalance = resolve; });
  const capturedBalance = new Promise((resolve) => { balanceCaptured = resolve; });
  let heldBalance = false;
  behavior.intercept = async (call) => {
    if (!heldBalance && call.method === "eth_getBalance" && call.params[0].toLowerCase() === keeperAddress.toLowerCase()) {
      heldBalance = true;
      const response = await upstream(call.method, call.params);
      balanceCaptured();
      await balanceGate;
      return response;
    }
    return null;
  };
  const oldPayoutCycle = cycle(f);
  await capturedBalance;
  clock += 121_000;
  await provider.send("anvil_setBalance", [keeperAddress, "0x0"]);
  await cycle(f, { hooks: { afterStage: async () => { throw new Error("fixture restart after newer payout stage"); } } });
  const newerPayout = f.native.prepare("SELECT * FROM gas_refill_transactions WHERE phase='payout'").get();
  releaseBalance();
  const stalePayout = await oldPayoutCycle;
  behavior.intercept = null;
  await check("expired runner cannot finalize or release a newer staged payout", () => {
    assert.equal(stalePayout.reason, "locked");
    assert.equal(newerPayout.status, "staged");
    const active = f.native.prepare("SELECT * FROM gas_refill_jobs").get();
    assert.equal(active.state, "active");
    assert.equal(active.phase, "payout");
    assert.ok(BigInt(active.input_reserved) > 0n);
    assert.ok(BigInt(active.gas_reserved) > 0n);
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_ledger WHERE kind='input'").get().n, 0);
  });
  await runUntil(f, (result) => result.reason === "payout_complete");
  await check("new lease owner recovers the retained payout without a new job or signature", () => {
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_jobs").get().n, 1);
    assert.equal(f.native.prepare("SELECT tx_hash FROM gas_refill_transactions WHERE phase='payout'").get().tx_hash, newerPayout.tx_hash);
    assert.equal(f.native.prepare("SELECT state FROM gas_refill_jobs").get().state, "completed");
  });

  f = await prepare();
  await runUntil(f, (_result, db) => db.prepare("SELECT phase FROM gas_refill_jobs").get()?.phase === "swap");
  let releaseSimulation, simulationCaptured;
  const simulationGate = new Promise((resolve) => { releaseSimulation = resolve; });
  const capturedSimulation = new Promise((resolve) => { simulationCaptured = resolve; });
  let heldSimulation = false;
  const multicallSelector = new Interface(["function multicall(uint256,bytes[]) payable returns(bytes[])"]).getFunction("multicall").selector;
  behavior.intercept = async (call) => {
    if (!heldSimulation && call.method === "eth_call" && call.params[0].to?.toLowerCase() === router.target.toLowerCase() &&
        call.params[0].data.startsWith(multicallSelector)) {
      heldSimulation = true;
      simulationCaptured();
      await simulationGate;
      return { jsonrpc: "2.0", error: { code: 3, message: "execution reverted", data: "0x" } };
    }
    return null;
  };
  const oldSwapCycle = cycle(f);
  await capturedSimulation;
  clock += 121_000;
  await cycle(f, { hooks: { afterStage: async () => { throw new Error("fixture restart after newer swap stage"); } } });
  const newerSwap = f.native.prepare("SELECT * FROM gas_refill_transactions WHERE phase='swap'").get();
  releaseSimulation();
  const staleSwap = await oldSwapCycle;
  behavior.intercept = null;
  await check("stale simulation failure cannot cancel a newer owner's persisted swap", () => {
    assert.equal(staleSwap.reason, "locked");
    assert.equal(f.native.prepare("SELECT phase FROM gas_refill_jobs").get().phase, "swap");
    assert.equal(newerSwap.status, "staged");
    assert.ok(BigInt(f.native.prepare("SELECT gas_reserved FROM gas_refill_jobs").get().gas_reserved) > 0n);
  });
  await runUntil(f, (result) => result.reason === "payout_complete");
  await check("new owner's swap survives the stale cancellation and settles once", () => {
    assert.equal(f.native.prepare("SELECT tx_hash FROM gas_refill_transactions WHERE phase='swap'").get().tx_hash, newerSwap.tx_hash);
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_ledger WHERE kind='input'").get().n, 1);
    assert.equal(f.native.prepare("SELECT state FROM gas_refill_jobs").get().state, "completed");
  });

  // Stage before broadcast, advance beyond a rolling day, and recover the same persisted pull.
  f = await prepare();
  const stagedStart = behavior.sends.length;
  const faultConfig = { hooks: { afterStage: async () => { throw new Error("fixture crash after durable stage"); } } };
  const interrupted = await cycle(f, faultConfig);
  const staged = f.native.prepare("SELECT * FROM gas_refill_transactions WHERE phase='pull'").get();
  const reservationBefore = f.native.prepare("SELECT input_reserved,gas_reserved FROM gas_refill_jobs").get();
  clock += 24 * 60 * 60 * 1000 + 1;
  const resumed = await cycle(f);
  await check("pre-broadcast crash preserves raw bytes and pending input/gas reservations across day rollover", () => {
    assert.equal(interrupted.reason, "rpc_unavailable");
    assert.equal(staged.status, "staged");
    assert.ok(staged.tx_raw);
    assert.equal(reservationBefore.input_reserved, f.native.prepare("SELECT amount_in_max FROM gas_refill_jobs").get().amount_in_max);
    assert.ok(BigInt(reservationBefore.gas_reserved) <= parseEther("0.00001"));
    assert.equal(resumed.reason, "pending");
    assert.equal(behavior.sends.length, stagedStart + 1);
    assert.equal(behavior.sends.at(-1).raw, staged.tx_raw);
    assert.ok(clock - staged.created_at > 24 * 60 * 60 * 1000);
    assert.ok(BigInt(reservationBefore.gas_reserved) > 0n);
    assert.equal(f.native.prepare("SELECT gas_reserved FROM gas_refill_jobs").get().gas_reserved, reservationBefore.gas_reserved);
  });

  // Tampered D1 signed state is not broadcast or repaired with a replacement.
  f = await prepare();
  const malformedFault = { hooks: { afterStage: async () => { throw new Error("fixture crash after durable stage"); } } };
  await cycle(f, malformedFault);
  f.native.prepare("UPDATE gas_refill_transactions SET tx_raw='0xdead'").run();
  behavior.hideReceiptReads = 1;
  behavior.hideTxReads = 1;
  const malformedStart = behavior.sends.length;
  const malformed = await cycle(f);
  await check("malformed signed state fails closed without rebroadcast or replacement", () => {
    assert.equal(malformed.reason, "recovery_invalid");
    assert.equal(behavior.sends.length, malformedStart);
    assert.equal(f.native.prepare("SELECT state FROM gas_refill_jobs").get().state, "blocked");
    assert.ok(BigInt(f.native.prepare("SELECT gas_reserved FROM gas_refill_jobs").get().gas_reserved) > 0n);
  });

  // If the beneficiary is topped up after swap but before payout, keep the acquired ETH in the bot.
  f = await prepare();
  await cycle(f);
  for (let i = 0; i < 16; i++) {
    const phase = f.native.prepare("SELECT phase FROM gas_refill_jobs").get()?.phase;
    if (phase === "payout") break;
    await cycle(f);
  }
  assert.equal(f.native.prepare("SELECT phase FROM gas_refill_jobs").get().phase, "payout");
  const payoutCount = f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_transactions WHERE phase='payout'").get().n;
  await provider.send("anvil_setBalance", [keeperAddress, hex(parseEther("0.0001"))]);
  const skipped = await cycle(f);
  await check("manual beneficiary refill before payout skips the ETH send", async () => {
    assert.equal(skipped.reason, "beneficiary_refilled");
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_transactions WHERE phase='payout'").get().n, payoutCount);
    assert.equal(f.native.prepare("SELECT state FROM gas_refill_jobs").get().state, "completed");
    assert.equal(await provider.getBalance(keeperAddress), parseEther("0.0001"));
  });
  await provider.send("anvil_setBalance", [keeperAddress, "0x0"]);
  await usdc.connect(treasury).approve(bot.address, 0n);
  const retainedUsdc = await usdc.balanceOf(bot.address);
  const nativeReuseStart = behavior.sends.length;
  await runUntil(f, (result) => result.reason === "payout_complete");
  await check("retained ETH pays the keeper even with exhausted treasury USDC allowance", async () => {
    const nativeJob = f.native.prepare("SELECT * FROM gas_refill_jobs ORDER BY rowid DESC LIMIT 1").get();
    assert.equal(nativeJob.amount_in_max, "0");
    assert.equal(nativeJob.output_eth, "0");
    assert.equal(nativeJob.state, "completed");
    assert.equal(behavior.sends.length - nativeReuseStart, 1);
    assert.equal(await usdc.balanceOf(bot.address), retainedUsdc);
    assert.equal(await provider.getBalance(keeperAddress), parseEther("0.0001"));
    assert.ok(await provider.getBalance(bot.address) >= parseEther("0.00001"));
  });

  f = await prepare();
  await runUntil(f, (_result, db) => db.prepare("SELECT phase FROM gas_refill_jobs").get()?.phase === "swap");
  const preSwapMax = f.native.prepare("SELECT amount_in_max FROM gas_refill_jobs").get().amount_in_max;
  await pool.setTicks(sqrtPrice, spotTick, spotTick - 101, 0);
  const priceGuardStart = behavior.sends.length;
  const staleGuard = await cycle(f);
  await check("price guards are repeated before signing a previously allocated swap", () => {
    assert.equal(staleGuard.reason, "price_gap");
    assert.equal(behavior.sends.length, priceGuardStart);
    assert.equal(f.native.prepare("SELECT state FROM gas_refill_jobs").get().state, "active");
  });
  await pool.setTicks(sqrtPrice, spotTick, spotTick - 20, 0);
  await cycle(f);
  const tightened = f.native.prepare("SELECT * FROM gas_refill_jobs").get();
  await runUntil(f, (result) => result.reason === "payout_complete");
  await check("a lower fresh TWAP tightens the signed input limit while retaining the original budget reservation", () => {
    assert.ok(BigInt(tightened.amount_in_max) < BigInt(preSwapMax));
    assert.equal(tightened.input_reserved, preSwapMax);
    assert.ok(BigInt(tightened.pull_amount) > BigInt(tightened.amount_in_max));
    assert.equal(f.native.prepare("SELECT state FROM gas_refill_jobs").get().state, "completed");
  });

  f = await prepare();
  await cycle(f);
  await cycle(f);
  behavior.gasPrice = hex(10_000_000n);
  const moreExpensive = await runUntil(f, (result) => result.reason === "payout_complete");
  behavior.gasPrice = null;
  await check("allowed gas price increases remain bounded and do not permanently block an active job", () => {
    assert.equal(moreExpensive.reason, "payout_complete");
    const priceJob = f.native.prepare("SELECT * FROM gas_refill_jobs").get();
    assert.equal(priceJob.state, "completed");
    assert.ok(BigInt(priceJob.gas_spent) <= parseEther("0.00001"));
  });

  f = await prepare();
  await provider.send("anvil_setBalance", [keeperAddress, hex(parseEther("0.000019"))]);
  await runUntil(f, (_result, db) => db.prepare("SELECT phase FROM gas_refill_jobs").get()?.phase === "payout");
  await provider.send("anvil_setBalance", [keeperAddress, "0x0"]);
  const partialPayout = await runUntil(f, (result) => result.reason === "payout_complete");
  await check("keeper spending during finality still allows a fee-funded partial payout", async () => {
    assert.equal(partialPayout.reason, "payout_complete");
    const fundedBalance = await provider.getBalance(keeperAddress);
    assert.ok(fundedBalance > parseEther("0.00007") && fundedBalance < parseEther("0.0001"));
    assert.ok(await provider.getBalance(bot.address) >= parseEther("0.00001"));
    assert.equal(f.native.prepare("SELECT state FROM gas_refill_jobs").get().state, "completed");
  });

  f = await prepare();
  behavior.l1Fee = 1000n;
  await cycle(f, { hooks: { afterStage: async () => { throw new Error("fee-change staged crash"); } } });
  const feeRow = f.native.prepare("SELECT * FROM gas_refill_transactions").get();
  const feeChangeStart = behavior.sends.length;
  behavior.l1Fee = parseEther("0.00002");
  const excessiveExtraFee = await cycle(f);
  await check("recovery cannot expand a fee reservation beyond the remaining daily budget", () => {
    assert.equal(excessiveExtraFee.reason, "gas_budget_exhausted");
    assert.equal(behavior.sends.length, feeChangeStart);
    assert.equal(f.native.prepare("SELECT state FROM gas_refill_jobs").get().state, "active");
    assert.equal(f.native.prepare("SELECT reserved_wei FROM gas_refill_transactions").get().reserved_wei, feeRow.reserved_wei);
  });
  behavior.l1Fee = 1001n;
  const repriced = await cycle(f);
  const newFeeRow = f.native.prepare("SELECT * FROM gas_refill_transactions").get();
  await check("a one-wei L1 fee rise updates only the reservation and broadcasts the identical signature", () => {
    assert.equal(repriced.reason, "pending");
    assert.equal(BigInt(newFeeRow.reserved_wei), BigInt(feeRow.reserved_wei) + 1n);
    assert.equal(newFeeRow.tx_raw, feeRow.tx_raw);
    assert.equal(newFeeRow.tx_hash, feeRow.tx_hash);
    assert.equal(newFeeRow.nonce, feeRow.nonce);
    assert.equal(behavior.sends.length, feeChangeStart + 1);
    assert.equal(behavior.sends.at(-1).raw, feeRow.tx_raw);
  });
  behavior.l1Fee = 0n;

  f = await prepare();
  await runUntil(f, (_result, db) => db.prepare("SELECT phase FROM gas_refill_jobs").get()?.phase === "swap");
  await weth.mint(router.target, 1n);
  const dustSwap = await runUntil(f, (result) => result.reason === "payout_complete");
  await check("one wei of donated router WETH cannot prevent the fixed swap and payout", async () => {
    assert.equal(dustSwap.reason, "payout_complete");
    assert.equal(await weth.balanceOf(router.target), 0n);
    assert.equal(await provider.getBalance(keeperAddress), parseEther("0.0001"));
    assert.equal(await usdc.allowance(bot.address, router.target), 0n);
  });

  f = await prepare();
  behavior.zeroLiquidity = true;
  const noLiquidityStart = behavior.sends.length;
  const noLiquidity = await cycle(f);
  behavior.zeroLiquidity = false;
  await check("new exchanges require active pool liquidity before any treasury pull", () => {
    assert.equal(noLiquidity.reason, "wrong_pool");
    assert.equal(behavior.sends.length, noLiquidityStart);
  });
  await runUntil(f, (_result, db) => db.prepare("SELECT phase FROM gas_refill_jobs").get()?.phase === "payout");
  behavior.zeroLiquidity = true;
  const independentPayout = await runUntil(f, (result) => result.reason === "payout_complete");
  behavior.zeroLiquidity = false;
  await check("acquired ETH payout and receipt recovery continue even when pool liquidity becomes zero", async () => {
    assert.equal(independentPayout.reason, "payout_complete");
    assert.equal(await provider.getBalance(keeperAddress), parseEther("0.0001"));
    assert.equal(f.native.prepare("SELECT state FROM gas_refill_jobs").get().state, "completed");
  });

  f = await prepare();
  await provider.send("anvil_setBalance", [keeperAddress, hex(parseEther("0.00003"))]);
  assert.equal((await cycle(f)).reason, "healthy");
  const rolloverScope = "480:" + bot.address.toLowerCase();
  f.native.prepare("INSERT INTO gas_refill_ledger(scope,kind,ref,amount,occurred_at) VALUES(?,'gas','earlier-jobs',?,?)")
    .run(rolloverScope, "8000000000000", clock);
  await provider.send("anvil_setBalance", [keeperAddress, "0x0"]);
  await runUntil(f, (_result, db) => db.prepare("SELECT phase FROM gas_refill_jobs").get()?.phase === "swap");
  assert.equal(f.native.prepare("SELECT gas_reserved FROM gas_refill_jobs").get().gas_reserved, "2000000000000");
  behavior.l1Fee = 2_000_000_000_000n;
  const beforeGasRollover = await cycle(f);
  clock += 24 * 60 * 60 * 1000 + 1;
  const afterGasRollover = await cycle(f);
  behavior.l1Fee = 0n;
  await check("an active job resumes after earlier rolling-day gas expenditure expires", () => {
    assert.equal(beforeGasRollover.reason, "gas_budget_exhausted");
    assert.equal(afterGasRollover.reason, "refill_started");
    assert.equal(f.native.prepare("SELECT gas_reserved FROM gas_refill_jobs").get().gas_reserved, "10000000000000");
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_transactions WHERE phase='pull'").get().n, 1);
  });

  // A crash can leave a short-deadline swap staged until the following five-minute cron.
  f = await prepare();
  const expirySnapshot = await provider.send("evm_snapshot", []);
  await cycle(f);
  for (let i = 0; i < 8; i++) {
    if (f.native.prepare("SELECT phase FROM gas_refill_jobs").get()?.phase === "swap") break;
    await cycle(f);
  }
  assert.equal(f.native.prepare("SELECT phase FROM gas_refill_jobs").get().phase, "swap");
  await cycle(f, { hooks: { afterStage: async () => { throw new Error("fixture crash before swap broadcast"); } } });
  const expiredSwap = f.native.prepare("SELECT * FROM gas_refill_transactions WHERE phase='swap'").get();
  assert.equal(expiredSwap.status, "staged");
  const beforeExpiredRecovery = behavior.sends.length;
  clock = (expiredSwap.deadline + 1) * 1000;
  await provider.send("evm_setNextBlockTimestamp", [expiredSwap.deadline + 1]);
  await provider.send("evm_mine", []);
  await cycle(f);
  await runUntil(f, (_result, db) => db.prepare("SELECT state FROM gas_refill_jobs").get().state === "completed");
  await check("expired staged swap consumes the same nonce once, revokes approval and releases its reservation", async () => {
    const recovered = f.native.prepare("SELECT * FROM gas_refill_transactions WHERE phase='swap'").get();
    const ended = f.native.prepare("SELECT * FROM gas_refill_jobs").get();
    assert.equal(recovered.status, "reverted");
    assert.equal(recovered.tx_hash, expiredSwap.tx_hash);
    assert.equal(behavior.sends[beforeExpiredRecovery].raw, expiredSwap.tx_raw);
    assert.equal(ended.state, "completed");
    assert.equal(ended.input_reserved, "0");
    assert.equal(ended.gas_reserved, "0");
    assert.equal(ended.input_actual, "0");
    assert.equal(await usdc.allowance(bot.address, router.target), 0n);
    assert.equal(await usdc.balanceOf(bot.address), BigInt(ended.pull_amount));
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_transactions WHERE phase='pull'").get().n, 1);
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_transactions WHERE phase='payout'").get().n, 0);
  });
  await provider.send("evm_revert", [expirySnapshot]);

  // A simulated slippage failure cancels safely, revokes approval, and retains pulled USDC.
  f = await prepare();
  await router.setInputRate(3_020_000_000n);
  let slippage;
  for (let i = 0; i < 8; i++) {
    slippage = await cycle(f);
    if (slippage.phase === "cancel_revoke") break;
  }
  const pullSends = behavior.sends.filter((tx) => tx.to?.toLowerCase() === usdc.target.toLowerCase() &&
    tx.data.startsWith(new Interface(["function transferFrom(address,address,uint256)"]).getFunction("transferFrom").selector));
  const beforeRetry = pullSends.length;
  const retained = BigInt(await usdc.balanceOf(bot.address));
  await runUntil(f, (_result, db) => db.prepare("SELECT state FROM gas_refill_jobs").get().state === "completed");
  await check("simulated slippage cancels and revokes without repeating that job's treasury pull", async () => {
    assert.equal(slippage.reason, "pending");
    assert.ok(retained > 0n);
    assert.equal(behavior.sends.filter((tx) => tx.to?.toLowerCase() === usdc.target.toLowerCase() &&
      tx.data.startsWith(new Interface(["function transferFrom(address,address,uint256)"]).getFunction("transferFrom").selector)).length, beforeRetry);
    assert.equal(f.native.prepare("SELECT state FROM gas_refill_jobs").get().state, "completed");
    assert.equal(await usdc.allowance(bot.address, router.target), 0n);
    assert.equal(f.native.prepare("SELECT input_reserved FROM gas_refill_jobs").get().input_reserved, "0");
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_transactions WHERE phase='swap'").get().n, 0);
  });

  // No pull is needed when previously allocated USDC covers the finite input maximum.
  f = await prepare();
  await usdc.mint(bot.address, 1_000_000n);
  const noPullStart = behavior.sends.length;
  await runUntil(f, (result) => result.reason === "payout_complete");
  const noPullRows = f.native.prepare("SELECT phase FROM gas_refill_transactions ORDER BY nonce").all().map((row) => row.phase);
  await check("allocated bot USDC is reused without another treasury pull", () => {
    assert.deepEqual(noPullRows, ["approve", "swap", "revoke", "payout"]);
    assert.equal(behavior.sends.slice(noPullStart).filter((tx) => tx.to?.toLowerCase() === usdc.target.toLowerCase() &&
      tx.data.startsWith(new Interface(["function transferFrom(address,address,uint256)"]).getFunction("transferFrom").selector)).length, 0);
  });

  // Rolling budget is strict at 24 hours and completed input is based on pool settlement, not the quote maximum.
  f = await prepare();
  clock = Date.now();
  const budgetStartTime = clock;
  await runUntil(f, (result) => result.reason === "payout_complete");
  await provider.send("anvil_setBalance", [keeperAddress, "0x0"]);
  f.native.prepare("DELETE FROM gas_refill_ledger WHERE kind='gas'").run();
  const budgetScope = f.native.prepare("SELECT scope FROM gas_refill_jobs").get().scope;
  f.native.prepare("INSERT INTO gas_refill_ledger(scope,kind,ref,amount,occurred_at) VALUES(?,'gas','boundary',?,?)")
    .run(budgetScope, "9999999999999", budgetStartTime);
  clock = budgetStartTime + 24 * 60 * 60 * 1000 - 1;
  const beforeBoundary = await cycle(f);
  const recentLedger = f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_ledger WHERE occurred_at>? AND kind='gas'")
    .get(clock - 24 * 60 * 60 * 1000).n;
  clock = budgetStartTime + 24 * 60 * 60 * 1000;
  const afterBoundary = await cycle(f, { hooks: { afterStage: async () => { throw new Error("boundary staged"); } } });
  await check("rolling gas spend still blocks at 24h minus 1ms and expires exactly at the boundary", () => {
    assert.equal(beforeBoundary.reason, "gas_budget_exhausted");
    assert.ok(recentLedger > 0);
    assert.equal(afterBoundary.reason, "rpc_unavailable");
    assert.equal(f.native.prepare("SELECT COUNT(*) AS n FROM gas_refill_jobs WHERE state='active'").get().n, 1);
    assert.equal(f.native.prepare("SELECT input_reserved FROM gas_refill_jobs WHERE state='active'").get().input_reserved,
      f.native.prepare("SELECT amount_in_max FROM gas_refill_jobs WHERE state='active'").get().amount_in_max);
  });

  await prepare();
  const setupOwner = HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/3");
  const setupNonce = await provider.getTransactionCount(treasuryAddress, "latest");
  const setupRaw = await setupOwner.signTransaction({ to: usdc.target,
    data: new Interface(["function approve(address,uint256) returns(bool)"]).encodeFunctionData("approve", [bot.address, 10_000_000n]),
    value: 0n, chainId: 480, type: 0, nonce: setupNonce, gasPrice: 1_000_000n, gasLimit: 80_000n });
  const pausedSetup = setupFixture({ version: 1, chainId: 480, treasury: treasuryAddress, bot: bot.address,
    steps: [{ kind: "approve", value: "0", nonce: setupNonce, raw: setupRaw,
      hash: Transaction.from(setupRaw).hash, confirmed: false }], completed: false });
  const setupStart = behavior.sends.length;
  behavior.l1Fee = parseEther("0.00002");
  const setupWaiting = await pausedSetup.run();
  behavior.l1Fee = 0n;
  await check("activation resume waits without broadcasting when current L1 fees exceed its bounded setup reserve", () => {
    assert.equal(setupWaiting, 1);
    assert.equal(behavior.sends.length, setupStart);
    assert.equal(pausedSetup.journal().steps[0].raw, setupRaw);
    assert.equal(pausedSetup.journal().completed, false);
  });
  behavior.operatorRPCError = true;
  const setupOracleFailure = await pausedSetup.run();
  behavior.operatorRPCError = false;
  await check("activation resume also waits when the operator fee oracle has an ambiguous RPC error", () => {
    assert.equal(setupOracleFailure, 1);
    assert.equal(behavior.sends.length, setupStart);
    assert.equal(pausedSetup.journal().steps[0].raw, setupRaw);
    assert.equal(pausedSetup.journal().completed, false);
  });
  const setupRecovered = await pausedSetup.run();
  await check("activation resumes the same setup signature once fees return within budget", async () => {
    assert.equal(setupRecovered, 0);
    assert.equal(behavior.sends.length, setupStart + 1);
    assert.equal(behavior.sends.at(-1).raw, setupRaw);
    assert.equal(pausedSetup.journal().completed, true);
    assert.equal(await usdc.allowance(treasuryAddress, bot.address), 10_000_000n);
  });

  // Real OS processes share one private journal and one kernel lock, not the in-memory CLI adapter.
  await prepare();
  await (await usdc.connect(treasury).approve(bot.address, 0n)).wait();
  await provider.send("anvil_setBalance", [bot.address, "0x0"]);
  const cliFixture = processSetupFixture();
  let releaseSetupNonce, setupNonceCaptured;
  const setupNonceGate = new Promise((resolve) => { releaseSetupNonce = resolve; });
  const capturedSetupNonce = new Promise((resolve) => { setupNonceCaptured = resolve; });
  let heldSetupNonce = false;
  behavior.intercept = async (call) => {
    if (!heldSetupNonce && call.method === "eth_getTransactionCount" && call.params[0].toLowerCase() === treasuryAddress.toLowerCase()) {
      heldSetupNonce = true;
      setupNonceCaptured();
      await setupNonceGate;
    }
    return null;
  };
  const concurrentSetupStart = behavior.sends.length;
  const commandA = cliFixture.run();
  try {
    const ready = await Promise.race([capturedSetupNonce.then(() => true), commandA.then(() => false)]);
    assert.equal(ready, true, "first local setup process must hold its lock before nonce reads");
    const commandB = await cliFixture.run();
    await check("a real concurrent setup process exits before spending or replacing the journal", () => {
      assert.equal(commandB.exitCode, 1);
      assert.match(commandB.output, /Activation is already running/);
      assert.equal(behavior.sends.length, concurrentSetupStart);
    });
    releaseSetupNonce();
    const resultA = await commandA;
    behavior.intercept = null;
    await check("the kernel lock owner performs exactly one bounded approval and bootstrap", async () => {
      assert.equal(resultA.exitCode, 0, resultA.output);
      assert.equal(await provider.getBalance(bot.address), parseEther("0.00001"));
      assert.equal(behavior.sends.slice(concurrentSetupStart).filter((sent) => sent.to?.toLowerCase() === bot.address.toLowerCase()).length, 1);
      assert.equal(JSON.parse(readFileSync(cliFixture.directory + "/.env.gas-refill-activation.json", "utf8")).completed, true);
    });
    const setupSentOnce = behavior.sends.length;
    const repeatedSetup = await cliFixture.run();
    await check("a later real setup command reuses completed records and releases the lock without new funding", async () => {
      assert.equal(repeatedSetup.exitCode, 0, repeatedSetup.output);
      assert.equal(behavior.sends.length, setupSentOnce);
      assert.equal(await provider.getBalance(bot.address), parseEther("0.00001"));
    });
  } finally {
    releaseSetupNonce();
    behavior.intercept = null;
    await commandA.catch(() => {});
    cliFixture.cleanup();
  }

  const healthEnv = { ...f.env };
  const publicHealth = await readGasRefillHealth(healthEnv);
  await check("public health contains status only and never returns raw signatures or secrets", () => {
    const serialized = JSON.stringify(publicHealth);
    assert.ok(!serialized.includes(bot.privateKey));
    assert.ok(!serialized.includes(rpcUrl));
    assert.ok(!serialized.includes("tx_raw"));
    assert.ok(!serialized.includes("tx_hash"));
  });

  console.log("PASS total assertions: " + assertions);
} finally {
  clearTimeout(deadline);
  if (proxy) await new Promise((resolve) => proxy.close(resolve));
  if (provider) await provider.destroy();
  if (anvil && anvil.exitCode === null) {
    anvil.kill("SIGTERM");
    await new Promise((resolve) => anvil.once("exit", resolve));
  }
}
