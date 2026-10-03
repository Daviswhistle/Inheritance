// A single failed identity read must recover without another sign-in or reload.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer as http } from "node:http";
import { createServer as net } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { Contract, ContractFactory, JsonRpcProvider } from "ethers";
import { createServer as createVite } from "../../app/node_modules/vite/dist/node/index.js";
import { launch, ACCOUNTS, HELPERS } from "./drv.mjs";

async function freePort() {
  const server = net();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function until(work, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await work()) return; await sleep(200); }
  throw new Error("Browser condition did not recover in time");
}
const rpc = `http://127.0.0.1:${await freePort()}`;
// World Chain keeps producing blocks even when this user sends no transactions.
// Without interval blocks, ethers can stall until timeout after observing a cached head
// just before the receipt, while Anvil's block subscriber starts at the new head.
const anvil = spawn("anvil", ["--port", new URL(rpc).port, "--chain-id", "480",
  "--block-time", "1", "--mixed-mining", "--silent"], { stdio: "ignore" });
let provider, proxy, vite, page, failNextOwner = false, failures = 0, passed = 0;
const pass = name => { passed++; console.log("  PASS  " + name); };
try {
  await until(async () => { try { return (await fetch(rpc, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) })).ok; } catch { return false; } });
  provider = new JsonRpcProvider(rpc, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  const owner = await provider.getSigner(0);
  async function deploy(name, args) {
    const artifact = JSON.parse(readFileSync(`out/${name}.sol/${name}.json`, "utf8"));
    const contract = await new ContractFactory(artifact.abi, artifact.bytecode.object, owner).deploy(...args);
    await contract.waitForDeployment();
    return contract;
  }
  const token = await deploy("MockERC20", ["Worldcoin", "WLD"]);
  const factory = await deploy("InheritanceVaultWLDFactoryOnePerOwner", [await token.getAddress()]);
  await (await factory.createVault(ACCOUNTS.a1.a, 30 * 86400)).wait();
  const vault = new Contract(await factory.vaultOf(ACCOUNTS.a0.a), ["function lastPing() view returns(uint256)"], provider);
  proxy = http(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "*");
    response.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    response.setHeader("Content-Type", "application/json");
    if (request.method === "OPTIONS") { response.end(); return; }
    try {
      let raw = ""; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw);
      const result = await Promise.all((Array.isArray(body) ? body : [body]).map(async call => {
        if (failNextOwner && call.method === "eth_call" && call.params[0].data === "0x8da5cb5b") {
          failNextOwner = false; failures++;
          return { jsonrpc: "2.0", id: call.id, error: { code: -32000, message: "temporary read failure" } };
        }
        return (await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(call) })).json();
      }));
      response.end(JSON.stringify(Array.isArray(body) ? result : result[0]));
    } catch { response.statusCode = 500; response.end("{}"); }
  });
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  Object.assign(process.env, {
    VITE_FACTORY_ADDRESS: await factory.getAddress(), VITE_WLD_ADDRESS: await token.getAddress(),
    VITE_RPC: `http://127.0.0.1:${proxy.address().port}`, VITE_FACTORY_DEPLOY_BLOCK: "1",
    VITE_LEGACY_FACTORY_ADDRESS: "", VITE_FACTORY_RELEASE_SUPPORTED: "true",
    VITE_NOTIFY_BACKEND_URL: "", VITE_REQUIRE_VERIFY: "false",
  });
  vite = await createVite({ root: process.cwd() + "/app", configFile: process.cwd() + "/app/vite.config.e2e.ts", logLevel: "error", server: { host: "127.0.0.1", port: await freePort() } });
  await vite.listen();
  page = await launch({ pk: ACCOUNTS.a0.pk, url: vite.resolvedUrls.local[0] });
  await page.ev(HELPERS);
  await page.ev("return __q.click('Continue with World App')");
  await until(() => page.ev("return __q.tabs().includes('Plan')"));
  await page.ev("return __q.tab('Plan')");
  await until(() => page.ev("return !!document.getElementById('period-change')"));
  pass("Owner controls appear after canonical identity verification");
  failNextOwner = true;
  await page.ev("return __q.setInput('period-change', '31')");
  await until(() => page.ev("return !document.getElementById('period-change')"), 5000);
  assert.equal(failures, 1);
  pass("A failed owner read hides role-dependent controls");
  await until(() => page.ev("return !!document.getElementById('period-change')"));
  assert.equal(await page.ev("return document.getElementById('period-change').value"), "31");
  pass("Fresh identity polling restores controls and preserves the user's edit");
  const before = await vault.lastPing();
  assert.match(await page.ev("return __q.click('Reset timer')"), /clicked/);
  await until(async () => await vault.lastPing() > before);
  pass("Recovered controls renew the actual on-chain timer");
  await until(() => page.ev("return /Timer reset/.test(document.body.innerText)"));
  pass("Receipt-confirmed success is shown after recovery");
  console.log(`\n  Passed ${passed} / failed 0`);
} catch (error) {
  if (page) {
    console.log("Failure UI:", (await page.ev("return document.body.innerText")).slice(0, 2400));
    console.log("Browser errors:", page.logs.slice(-12));
  }
  throw error;
} finally {
  await page?.close(); await vite?.close();
  if (proxy) await new Promise(resolve => proxy.close(resolve));
  provider?.destroy(); anvil.kill("SIGTERM");
}
