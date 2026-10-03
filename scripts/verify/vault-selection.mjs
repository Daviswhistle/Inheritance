// Real local transactions across two factory generations, including delayed reads
// and an expired server session. The bridge is a stub; vault state is genuine Anvil.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { Contract, ContractFactory, JsonRpcProvider, parseEther } from "ethers";
import { createServer as createVite } from "../../app/node_modules/vite/dist/node/index.js";
import { launch, ACCOUNTS, HELPERS } from "./drv.mjs";

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function until(work) {
  const end = Date.now() + 30000;
  while (Date.now() < end) { if (await work()) return; await sleep(200); }
  throw new Error("Vault selection did not recover in time");
}
const rpc = `http://127.0.0.1:${await freePort()}`;
const anvil = spawn("anvil", ["--port", new URL(rpc).port, "--chain-id", "480",
  "--block-time", "1", "--mixed-mining", "--silent"], { stdio: "ignore" });
let provider, vite, page, passed = 0;
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
  await (await factory.createVault(ACCOUNTS.a1.a, 30 * 86400)).wait();
  await (await legacy.createVault(ACCOUNTS.a2.a, 90 * 86400)).wait();
  await (await token.mint(ACCOUNTS.a0.a, parseEther("100"))).wait();
  const currentVault = await factory.vaultOf(ACCOUNTS.a0.a);
  const legacyVault = await legacy.vaultOf(ACCOUNTS.a0.a);
  const notify = "https://selection-notify.example";
  const preload = `
    const networkFetch = window.fetch.bind(window);
    window.__holdWatcher = false; window.__heldWatchers = [];
    window.__holdRegistration = true; window.__heldRegistrations = [];
    window.__watchers = { ${JSON.stringify(legacyVault.toLowerCase())}: true };
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
      if (url.origin !== ${JSON.stringify(notify)}) return networkFetch(input, init);
      if (url.pathname === '/api/automation/health') return Response.json({ automation: {
        enabled: true, supported: true, funded: true, halted: false, reason: 'ready' } });
      if (url.pathname === '/api/notifications') return Response.json({ status: 'success', watchers: [] });
      if (url.pathname === '/api/notifications/status') {
        const vault = url.searchParams.get('vaultAddress').toLowerCase();
        const response = () => Response.json({ status: 'success', watcher: window.__watchers[vault] ? {active:true} : null });
        if (window.__holdWatcher && vault === ${JSON.stringify(legacyVault.toLowerCase())})
          return new Promise(resolve => window.__heldWatchers.push(() => resolve(response())));
        return response();
      }
      if (url.pathname === '/api/notifications/register') {
        const vault = JSON.parse(init.body).vaultAddress.toLowerCase();
        const response = () => { window.__watchers[vault] = true; return Response.json({ status: 'success', watcher: {active:true} }); };
        if (window.__holdRegistration && vault === ${JSON.stringify(currentVault.toLowerCase())})
          return new Promise((resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {once:true});
            window.__heldRegistrations.push(() => resolve(response()));
          });
        return response();
      }
      throw new Error('Unexpected local notification route: ' + url.pathname);
    };
  `;
  Object.assign(process.env, {
    VITE_FACTORY_ADDRESS: await factory.getAddress(), VITE_WLD_ADDRESS: await token.getAddress(),
    VITE_RPC: rpc, VITE_FACTORY_DEPLOY_BLOCK: "1", VITE_LEGACY_FACTORY_ADDRESS: await legacy.getAddress(),
    VITE_LEGACY_FACTORY_DEPLOY_BLOCK: "1", VITE_FACTORY_RELEASE_SUPPORTED: "true",
    VITE_NOTIFY_BACKEND_URL: notify, VITE_REQUIRE_VERIFY: "false",
  });
  vite = await createVite({ root: process.cwd() + "/app", configFile: process.cwd() + "/app/vite.config.e2e.ts", logLevel: "error", server: { host: "127.0.0.1", port: await freePort() } });
  await vite.listen();
  const url = vite.resolvedUrls.local[0] + "?vault=" + legacyVault;
  page = await launch({ pk: ACCOUNTS.a0.pk, url, preload }); await page.ev(HELPERS);
  await page.ev("return __q.click('Continue with World App')");
  await until(() => page.ev("return __q.btns().some(b => b.t === 'Back to your own vault')"));
  await page.ev("return __q.tab('Assets')");
  await page.waitFor('.money-metadata');
  await page.ev("return __q.reveal('.money-metadata')");
  await page.ev("return __q.click('Show addresses & explorer links')");
  await until(() => page.ev("return document.getElementById('deposit-amount') && /90 days/.test(document.body.innerText) && /100.0 WLD/.test(document.body.innerText)"));
  pass("The linked legacy owner's vault is verified before depositing");
  await page.ev("return __q.tab('Help')");
  await page.ev("return __q.click('Enable notifications')");
  await until(() => page.ev("return /Reminders are enabled for you/.test(document.body.innerText)"));
  await page.ev("window.__holdWatcher = true; return __q.click('Refresh status')");
  await until(() => page.ev("return window.__heldWatchers.length > 0"));
  await page.ev("return __q.tab('Plan')");
  await until(() => page.ev("return __q.btns().some(b => b.t === 'Back to your own vault')"));
  const switched = await page.ev(`const original = window.fetch.bind(window); window.__heldReads = []; window.__holdNew = true; window.__seenReads = [];
    window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : input.url;
      if (url === ${JSON.stringify(rpc)} && init?.body) { const body = JSON.parse(typeof init.body === 'string' ? init.body : new TextDecoder().decode(init.body)); const calls = Array.isArray(body) ? body : [body];
        window.__seenReads.push(...calls.map(c => ({ method: c.method, to: c.params?.[0]?.to, data: c.params?.[0]?.data })));
        if (window.__holdNew && calls.some(c => c.method === 'eth_call' && c.params[0].to?.toLowerCase() === ${JSON.stringify(currentVault.toLowerCase())} && c.params[0].data === '0xc45a0155'))
          await new Promise(resolve => window.__heldReads.push(resolve)); }
      return original(input, init); };
    return __q.click('Back to your own vault');`);
  assert.match(switched, /clicked/);
  await page.ev("return __q.tab('Assets')");
  await until(() => page.ev("return window.__heldReads.length > 0"));
  assert.equal(await page.ev("return __q.btns().some(b => b.t === 'Deposit' && !b.d)"), false);
  pass("Switching vaults blocks deposit while canonical identity is unresolved");
  assert.equal(await page.ev("return window.__E2E_MINIKIT__.lastCalldata().length"), 0);
  assert.equal(await token.balanceOf(legacyVault), 0n); assert.equal(await token.balanceOf(currentVault), 0n);
  pass("Delayed reads cannot send a transaction or move funds into the previous vault");
  await page.ev("window.__holdNew = false; window.__heldReads.forEach(resolve => resolve()); return true");
  await until(() => page.ev("return !!document.getElementById('deposit-amount')"));
  await page.ev("return __q.setInput('deposit-amount', '1')");
  await until(() => page.ev("return __q.btns().some(b => b.t === 'Deposit' && !b.d)"));
  await page.ev("return __q.click('Deposit')");
  await until(() => page.ev("return window.__E2E_MINIKIT__.lastCalldata().length === 2"));
  assert.equal((await page.ev("return window.__E2E_MINIKIT__.lastCalldata()[1].to")).toLowerCase(), (await factory.getAddress()).toLowerCase());
  pass("Verified deposit routes to the selected current factory");
  await until(async () => await token.balanceOf(currentVault) === parseEther("1"));
  assert.equal(await token.balanceOf(legacyVault), 0n);
  pass("Only the selected vault receives the actual WLD deposit");
  await until(() => page.ev("return window.__heldRegistrations.length === 1"));
  await page.ev("return __q.tab('Plan')");
  await until(() => page.ev("return __q.btns().some(b => b.t === 'Enable vault monitoring' && !b.d)"));
  pass("A new vault awaiting its automatic registration does not inherit the prior vault's monitoring status");
  await page.ev("window.__holdWatcher = false; window.__heldWatchers.forEach(resolve => resolve()); return true");
  await sleep(500);
  assert.equal(await page.ev("return /Automatic transfer is enabled/.test(document.body.innerText)"), false);
  assert.equal(await page.ev("return __q.btns().some(b => b.t === 'Enable vault monitoring' && !b.d)"), true);
  pass("A delayed registered response cannot hide monitoring setup for the selected vault");
  await page.ev("window.__holdRegistration = false; return true;");
  await page.ev("return __q.click('Enable vault monitoring')");
  await until(() => page.ev("return /Automatic transfer is enabled/.test(document.body.innerText)"));
  pass("Monitoring becomes enabled only after the selected vault's registration succeeds");
  await page.ev("window.__heldRegistrations.forEach(resolve => resolve()); return true;");
  await page.close(); page = null;

  await (await token.mint(legacyVault, parseEther("3"))).wait();
  await provider.send("evm_increaseTime", [90 * 86400 + 1]); await provider.send("evm_mine", []);
  page = await launch({ pk: ACCOUNTS.a2.pk, url, preload }); await page.ev(HELPERS);
  await page.ev("return __q.click('Continue with World App')");
  await until(() => page.ev("return __q.btns().some(b => b.t === 'File claim' && !b.d)"));
  pass("The named heir can claim the older shared vault after expiry");
  await page.ev("const auth = await import('/src/auth.ts'); auth.clearSession(); return (await auth.notificationFetch('/session-expiry-check')).status");
  await until(() => page.ev("return /Continue with World App/.test(document.body.innerText)"));
  pass("An expired session returns to wallet sign-in");
  await page.ev("return __q.click('Continue with World App')");
  await until(() => page.ev("return __q.btns().some(b => b.t === 'File claim' && !b.d)"));
  pass("Reauthentication restores the selected shared vault and heir controls");
  await page.ev("return __q.click('File claim')");
  await until(() => page.ev("return window.__E2E_MINIKIT__.lastCalldata().length === 1"));
  assert.equal((await page.ev("return window.__E2E_MINIKIT__.lastCalldata()[0].to")).toLowerCase(), (await legacy.getAddress()).toLowerCase());
  pass("The restored claim routes through its original legacy factory");
  const vault = new Contract(legacyVault, ["function claimFiledAt() view returns(uint256)"], provider);
  await until(async () => await vault.claimFiledAt() > 0n);
  pass("The reconnected heir files a genuine on-chain claim");
  console.log(`\n  Passed ${passed} / failed 0`);
} catch (error) {
  if (page) {
    console.log("Failure UI:", (await page.ev("return document.body.innerText")).slice(0, 2200));
    console.log("Recent RPC reads:", await page.ev("return window.__seenReads?.slice(-24)"));
    console.log("Browser errors:", page.logs.slice(-8));
  }
  throw error;
} finally {
  await page?.close(); await vite?.close(); provider?.destroy(); anvil.kill("SIGTERM");
}
