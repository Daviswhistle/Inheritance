// Real vaults remain discoverable when individual RPC reads or event chunks fail.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer as http } from "node:http";
import { createServer as net } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { ContractFactory, JsonRpcProvider } from "ethers";
import { createServer as createVite } from "../../app/node_modules/vite/dist/node/index.js";
import { launch, ACCOUNTS, HELPERS } from "./drv.mjs";

async function freePort() {
  const server = net();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function until(work) {
  const end = Date.now() + 30000;
  while (Date.now() < end) { if (await work()) return; await sleep(200); }
  throw new Error("Discovery did not reach its expected state");
}
const rpc = `http://127.0.0.1:${await freePort()}`;
const anvil = spawn("anvil", ["--port", new URL(rpc).port, "--chain-id", "480",
  "--block-time", "1", "--mixed-mining", "--silent"], { stdio: "ignore" });
let provider, proxy, vite, page, failLogs = false, failures = 0, logFailures = 0, passed = 0;
const eventFilters = [];
const failingVaults = new Set();
const pass = name => { passed++; console.log("  PASS  " + name); };
try {
  await until(async () => { try { return (await fetch(rpc, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) })).ok; } catch { return false; } });
  provider = new JsonRpcProvider(rpc, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  const owner = await provider.getSigner(0);
  async function deploy(name, args) {
    const artifact = JSON.parse(readFileSync(`out/${name}.sol/${name}.json`, "utf8"));
    const contract = await new ContractFactory(artifact.abi, artifact.bytecode.object, owner).deploy(...args);
    await contract.waitForDeployment(); return contract;
  }
  const token = await deploy("MockERC20", ["Worldcoin", "WLD"]);
  const factory = await deploy("InheritanceVaultWLDFactoryOnePerOwner", [await token.getAddress()]);
  const legacy = await deploy("InheritanceVaultWLDFactoryOnePerOwner", [await token.getAddress()]);
  const vaults = [];
  for (const index of [0, 2]) {
    const signer = await provider.getSigner(index);
    const source = index === 0 ? factory : legacy;
    await (await source.connect(signer).createVault(ACCOUNTS.a1.a, 30 * 86400)).wait();
    vaults.push(await source.vaultOf(await signer.getAddress()));
  }
  const foreign = await deploy("InheritanceVaultWLDFactoryOnePerOwner", [await token.getAddress()]);
  await (await foreign.createVault(ACCOUNTS.a1.a, 30 * 86400)).wait();
  const foreignVault = await foreign.vaultOf(ACCOUNTS.a0.a);
  failingVaults.add(vaults[1].toLowerCase());
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
        if (call.method === "eth_getLogs") eventFilters.push(call.params[0]);
        const identityFailure = call.method === "eth_call" && call.params[0].data === "0x91f2ebb8"
          && failingVaults.has(call.params[0].to.toLowerCase());
        const logFailure = failLogs && call.method === "eth_getLogs";
        if (identityFailure || logFailure) {
          if (identityFailure) failures++; else logFailures++;
          return { jsonrpc: "2.0", id: call.id, error: { code: -32000, message: "temporary discovery RPC failure" } };
        }
        return (await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(call) })).json();
      }));
      response.end(JSON.stringify(Array.isArray(body) ? result : result[0]));
    } catch { response.statusCode = 500; response.end("{}"); }
  });
  await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const notify = "https://discovery-test.example";
  const watchers = [vaults[0], foreignVault].map(vaultAddress => ({ vaultAddress, heirAddress: ACCOUNTS.a1.a }));
  const preload = `localStorage.setItem("inheritance:locale", "en"); const realFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
      if (url.origin === ${JSON.stringify(notify)}) return Response.json(url.pathname === '/api/notifications'
        ? {status:'success',watchers:${JSON.stringify(watchers)},nextCursor:null}
        : {status:'success',watcher:null,automation:{enabled:false,reason:'disabled'}});
      return realFetch(input, init);
    };`;
  Object.assign(process.env, {
    VITE_FACTORY_ADDRESS: await factory.getAddress(), VITE_WLD_ADDRESS: await token.getAddress(),
    VITE_RPC: `http://127.0.0.1:${proxy.address().port}`, VITE_FACTORY_DEPLOY_BLOCK: "1",
    VITE_LEGACY_FACTORY_ADDRESS: await legacy.getAddress(), VITE_LEGACY_FACTORY_DEPLOY_BLOCK: "1",
    VITE_NOTIFY_BACKEND_URL: notify, VITE_REQUIRE_VERIFY: "false",
  });
  vite = await createVite({ root: process.cwd() + "/app", configFile: process.cwd() + "/app/vite.config.e2e.ts", logLevel: "error", server: { host: "127.0.0.1", port: await freePort() } });
  await vite.listen();
  page = await launch({ pk: ACCOUNTS.a1.pk, url: vite.resolvedUrls.local[0], preload }); await page.ev(HELPERS);
  await page.ev("return __q.click('Agree and sign in')");
  await until(() => failures > 0);
  await page.ev("return __q.tab('Plan')");
  const count = () => page.ev("return document.querySelectorAll('.heir-plans [data-vault]').length");
  const incomplete = () => page.ev("return !!document.querySelector('.heir-plans .plan-inline-error')");
  const settled = () => page.ev("return [...document.querySelectorAll('.heir-plans button')].some(b => b.textContent === 'Refresh' && !b.disabled)");
  const refresh = async () => {
    await until(settled);
    await page.ev("[...document.querySelectorAll('.heir-plans button')].find(b => b.textContent === 'Refresh').click()");
    await sleep(150);
  };
  await until(async () => await settled() && await count() === 1 && await incomplete());
  pass("Partial discovery keeps a verified vault and exposes the failed candidate read");
  failingVaults.add(vaults[0].toLowerCase());
  await refresh();
  await until(async () => await settled() && await count() === 0 && await incomplete());
  assert.doesNotMatch(await page.ev("return document.body.innerText"), /No vaults found in this check/);
  pass("An unavailable check is never reported as a successful empty search");
  failingVaults.clear();
  await refresh();
  await until(async () => await settled() && await count() === 2 && !await incomplete());
  pass("Retry recovers primary indexed and legacy event-only vaults without signing in again");
  const addresses = [await factory.getAddress(), await legacy.getAddress()].map(x => x.toLowerCase()).sort();
  assert.ok(eventFilters.length > 0);
  assert.ok(eventFilters.every(filter => Array.isArray(filter.address)
    && JSON.stringify(filter.address.map(x => x.toLowerCase()).sort()) === JSON.stringify(addresses)));
  pass("Discovery combines primary and legacy factories into one event scan");
  const visibleVaults = await page.ev("return [...document.querySelectorAll('.heir-plans [data-vault]')].map(e => e.dataset.vault.toLowerCase()).sort()");
  assert.deepEqual(visibleVaults, vaults.map(v => v.toLowerCase()).sort());
  pass("A confirmed foreign factory is excluded without a false incomplete warning");
  failLogs = true;
  await refresh();
  await until(async () => logFailures > 0 && await settled() && await count() === 2 && await incomplete());
  pass("Failed recent-event chunks remain explicit while verified remembered vaults stay visible");
  failLogs = false;
  await refresh();
  await until(async () => await settled() && await count() === 2 && !await incomplete());
  pass("Restored event reads clear the incomplete warning on retry");
  await page.close();
  eventFilters.length = 0;
  page = await launch({ pk: ACCOUNTS.a0.pk, url: vite.resolvedUrls.local[0], preload });
  await page.ev(HELPERS);
  assert.match(await page.ev("return __q.click('Agree and sign in')"), /clicked/);
  await until(() => page.ev("return document.body.innerText.includes('Your plan') && !!document.querySelector('.account-row')"));
  await page.ev("return __q.tab('Assets')");
  await until(() => page.ev("return !!document.querySelector('.money-metadata')"));
  assert.ok(eventFilters.every(filter => !filter.topics[1]));
  pass("Signing in and viewing assets do not start owner creation-date scans");
  failLogs = true;
  const beforeFailures = logFailures;
  await page.ev("document.querySelector('.money-metadata').open = true");
  await until(() => logFailures > beforeFailures);
  await sleep(500);
  assert.doesNotMatch(await page.ev("return document.body.innerText"), /Meta error:/);
  assert.equal(await page.ev("return !!document.querySelector('.money-metadata a[href*=\"/block/\"]')"), false);
  pass("Optional creation-date read failure does not overwrite the global action status");
  failLogs = false;
  await page.ev("document.querySelector('.money-metadata').open = false");
  await sleep(100);
  await page.ev("document.querySelector('.money-metadata').open = true");
  await until(() => page.ev("return !!document.querySelector('.money-metadata a[href*=\"/block/\"]')"));
  pass("Reopening account details retries and restores the verified creation date");
  console.log(`\n  Passed ${passed} / failed 0`);
} catch (error) { console.error("Browser state:", await page?.ev("return document.body.innerText")); console.error("Event filters:", eventFilters); throw error; } finally { await page?.close(); await vite?.close(); await new Promise(resolve => proxy ? proxy.close(resolve) : resolve()); provider?.destroy(); anvil.kill("SIGTERM"); }
