// Genuine Anvil funds and browser interactions; only the World App bridge is a
// fixture. The basic vault, yield accounting and receipt redemptions are real.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { AbiCoder, Contract, ContractFactory, JsonRpcProvider, parseEther, keccak256 } from "ethers";
import { createServer as createVite } from "../../app/node_modules/vite/dist/node/index.js";
import { launch, ACCOUNTS, HELPERS } from "./drv.mjs";

async function freePort() {
  const socket = createServer();
  await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}
async function until(work, label = "yield UI") {
  const until = Date.now() + 35_000;
  while (Date.now() < until) { if (await work()) return; await sleep(150); }
  throw new Error(label + " did not reach the expected state");
}
const rpc = `http://127.0.0.1:${await freePort()}`;
const anvil = spawn("anvil", ["--port", new URL(rpc).port, "--chain-id", "480", "--silent"], { stdio: "ignore" });
let provider, vite, page, passed = 0;
const pass = label => { passed++; console.log("  PASS  " + label); };
const storeCapture = process.env.YIELD_STORE_IMAGES === "1";
// Fail selected reads, while all contract state and transactions remain real.
function installRpcFaults() {
  window.__E2E_RPC_FAULTS__ = [];
  window.__E2E_RPC_FAULT_MATCHES__ = 0;
  window.__E2E_REWARDS__ = {};
  window.__E2E_REWARDS_DOWN__ = false;
  window.__E2E_RATES_DOWN__ = false;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const rateStrategy = url.match(/^https:\/\/api\.merkl\.xyz\/v4\/opportunities\?chainId=480&identifier=(0x[a-fA-F0-9]{40})$/)?.[1];
    if (rateStrategy) {
      const now = Math.floor(Date.now() / 1000);
      return new Response(JSON.stringify([{ chainId: 480, type: "MORPHOVAULT", identifier: rateStrategy, status: "LIVE",
        latestCampaignEnd: String(now + 86400), nativeAprRecord: { timestamp: String(now - 10), value: 0.0013 },
        aprRecord: { timestamp: String(now - 10), cumulated: 1.7 },
        rewardsRecord: { breakdowns: [{ token: { address: window.__E2E_RATE_TOKEN__, chainId: 480, decimals: 18 } }] } }]),
      { status: window.__E2E_RATES_DOWN__ ? 503 : 200, headers: { "Content-Type": "application/json" } });
    }
    const rewardsVault = url.match(/^https:\/\/api\.merkl\.xyz\/v4\/users\/(0x[a-f0-9]{40})\/rewards\?chainId=480$/)?.[1];
    if (rewardsVault) return new Response(JSON.stringify(window.__E2E_REWARDS__[rewardsVault] ?? []), {
      status: window.__E2E_REWARDS_DOWN__ ? 503 : 200, headers: { "Content-Type": "application/json" },
    });
    let payload;
    try { payload = JSON.parse(typeof init?.body === "string" ? init.body : new TextDecoder().decode(init?.body)); } catch { /* Non-RPC request. */ }
    const calls = (Array.isArray(payload) ? payload : [payload]).filter(Boolean);
    const failed = calls.filter(call => call.method === "eth_call" && window.__E2E_RPC_FAULTS__.some(fault =>
      call.params?.[0]?.to?.toLowerCase() === fault.to && call.params?.[0]?.data?.toLowerCase().startsWith(fault.data)));
    const response = await original(input, init);
    if (!failed.length) return response;
    window.__E2E_RPC_FAULT_MATCHES__ += failed.length;
    const replace = result => failed.some(call => call.id === result.id)
      ? { jsonrpc: "2.0", id: result.id, error: { code: 3, message: "Local fixture read failure", data: "0x" } } : result;
    const data = await response.json();
    return new Response(JSON.stringify(Array.isArray(data) ? data.map(replace) : replace(data)),
      { status: 200, headers: { "Content-Type": "application/json" } });
  };
}
const preload = `(${installRpcFaults.toString()})();` + (storeCapture ? `window.__E2E_USERNAMES__ = ${JSON.stringify({
  [ACCOUNTS.a0.a.toLowerCase()]: "davis", [ACCOUNTS.a1.a.toLowerCase()]: "alex",
})};` : "");
async function fault(contract, data) {
  const to = (await contract.getAddress()).toLowerCase();
  await page.ev(`window.__E2E_RPC_FAULTS__ = ${JSON.stringify([{ to, data: data.toLowerCase() }])}; return true;`);
}
async function clearFaults() { await page.ev("window.__E2E_RPC_FAULTS__ = []; return true;"); }
async function clickReady(label) {
  const quoted = JSON.stringify(label);
  await until(() => page.ev(`return __q.btns().some(b => b.t === ${quoted} && !b.d)`), label);
  const result = await page.ev(`return __q.click(${quoted})`);
  assert.match(result, /^clicked/);
  return result;
}
async function captureStore(name) {
  if (!storeCapture) return;
  const shot = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(`/tmp/wld-verify/shots/yield-store-${name}.png`, Buffer.from(shot.data, "base64"));
}
try {
  await until(async () => { try { return (await fetch(rpc, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) })).ok; } catch { return false; } });
  provider = new JsonRpcProvider(rpc, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
  const owner = await provider.getSigner(0);
  async function deploy(name, args) {
    const art = JSON.parse(readFileSync(`out/${name}.sol/${name}.json`, "utf8"));
    const contract = await new ContractFactory(art.abi, art.bytecode.object, owner).deploy(...args);
    await contract.waitForDeployment(); return contract;
  }
  const token = await deploy("MockERC20", ["Worldcoin", "WLD"]);
  const plain = await deploy("InheritanceVaultWLDFactoryOnePerOwner", [await token.getAddress()]);
  const morpho = await deploy("MockERC4626", [await token.getAddress()]);
  const distributorAddress = "0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae";
  const distributorArtifact = JSON.parse(readFileSync("out/MockMerklDistributor.sol/MockMerklDistributor.json", "utf8"));
  await provider.send("anvil_setCode", [distributorAddress, distributorArtifact.deployedBytecode.object]);
  const distributor = new Contract(distributorAddress, distributorArtifact.abi, owner);
  await (await token.mint(distributorAddress, parseEther("100"))).wait();
  const yieldFactory = await deploy("InheritanceVaultMorphoFactory", [await token.getAddress(), await morpho.getAddress(), ACCOUNTS.a2.a, 1000]);
  await (await plain.createVault(ACCOUNTS.a1.a, 30 * 86400)).wait();
  const plainVault = await plain.vaultOf(ACCOUNTS.a0.a);
  await (await token.mint(plainVault, parseEther("50"))).wait();
  await (await token.mint(ACCOUNTS.a0.a, parseEther("100"))).wait();
  Object.assign(process.env, { VITE_FACTORY_ADDRESS: await plain.getAddress(), VITE_FACTORY_DEPLOY_BLOCK: "1",
    VITE_WLD_ADDRESS: await token.getAddress(), VITE_RPC: rpc, VITE_LEGACY_FACTORY_ADDRESS: "",
    VITE_NOTIFY_BACKEND_URL: "", VITE_REQUIRE_VERIFY: "false", VITE_FACTORY_RELEASE_SUPPORTED: "true",
    VITE_YIELD_FACTORY_ADDRESS: await yieldFactory.getAddress(), VITE_YIELD_FACTORY_DEPLOY_BLOCK: "1",
    VITE_MORPHO_VAULT_ADDRESS: await morpho.getAddress() });
  vite = await createVite({ root: process.cwd() + "/app", configFile: process.cwd() + "/app/vite.config.e2e.ts", logLevel: "error", server: { host: "127.0.0.1", port: await freePort() } });
  await vite.listen();
  const url = vite.resolvedUrls.local[0];
  page = await launch({ pk: ACCOUNTS.a0.pk, url, preload: preload + `window.__E2E_RATE_TOKEN__ = ${JSON.stringify(await token.getAddress())};` }); await page.ev(HELPERS);
  await captureStore("welcome");
  await fault(yieldFactory, yieldFactory.interface.getFunction("vaultOf").selector);
  await clickReady("Continue with World App");
  await until(() => page.ev("return __q.tabs().includes('Vault')"));
  await page.ev("return __q.tab('Vault')");
  await until(() => page.ev("return __q.btns().some(b => b.t === 'Reset timer' && !b.d) && /time left to renew/i.test(document.body.innerText) && !/Expires -/.test(document.body.innerText) && !/^0d 0h 0m 0s$/.test(document.querySelector('.timer-value')?.textContent.trim())"));
  assert.ok(await page.ev("return window.__E2E_RPC_FAULT_MATCHES__") > 0);
  assert.equal(await token.balanceOf(plainVault), parseEther("50"));
  pass("A failed optional yield registry keeps funded basic-vault renewal and withdrawal accessible");
  await clearFaults();
  await clickReady("Retry vault lookup");
  await until(() => page.ev("return !/Some vault registries could not be refreshed/.test(document.body.innerText)"));
  await captureStore("countdown");
  await page.ev("return __q.tab('Inherit')");
  await until(() => page.ev("return document.querySelector('input[value=yield]') && !document.querySelector('input[value=yield]').disabled"));
  await page.ev("document.querySelector('input[value=yield]').click(); return true");
  await until(() => page.ev("return /General WLD rewards APR/.test(document.body.innerText) && /1.70%/.test(document.body.innerText)"));
  assert.match(await page.ev("return document.body.innerText"), /<0.01%/);
  assert.match(await page.ev("return document.body.innerText"), /verified-human boost is excluded/);
  assert.doesNotMatch(await page.ev("return document.body.innerText"), /9.19%|7.55%/);
  await page.ev("document.querySelector('.yield-rate-summary').scrollIntoView({block:'center'}); return true;");
  await page.shot("morpho-rates-choice");
  pass("Creation separates lending and general rewards from the excluded verified-human boost");
  await page.ev("window.__E2E_RATES_DOWN__ = true; document.querySelector('input[value=plain]').click(); return true");
  await until(() => page.ev("return !document.querySelector('.yield-rate-summary')"));
  await page.ev("document.querySelector('input[value=yield]').click(); return true");
  await until(() => page.ev("return /Current rates are unavailable/.test(document.body.innerText)"));
  assert.doesNotMatch(await page.ev("return document.querySelector('.yield-rate-summary').innerText"), /1.70%/);
  pass("A rate API failure removes the old quote without disabling fee consent or creation");
  await page.ev(`return __q.setInput('heir-input', '${ACCOUNTS.a1.a}')`);
  await until(() => page.ev("return /Resolved:/.test(document.body.innerText)"));
  assert.equal(await page.ev("return __q.btns().find(b => b.t === 'Create vault').d"), true);
  assert.equal(await yieldFactory.vaultOf(ACCOUNTS.a0.a), "0x0000000000000000000000000000000000000000");
  pass("Yield creation requires explicit fee, lending-risk and receipt-inheritance consent");
  assert.equal(await token.balanceOf(plainVault), parseEther("50"));
  assert.doesNotMatch(await page.ev("return document.body.innerText"), /You already have a vault\. Update settings below or deposit WLD\./);
  pass("Choosing yield does not move or convert an existing basic vault");
  await page.ev("document.getElementById('yield-consent').click(); return true");
  await until(() => page.ev("return __q.btns().some(b => b.t === 'Create vault' && !b.d)"));
  if (storeCapture) {
    // The existing basic-vault status precedes the form. Show the actual heir
    // fields instead of capturing that unrelated status card.
    await page.ev("document.getElementById('heir-input').closest('.field-row').scrollIntoView({block:'start'}); window.scrollBy(0,-105); return true;");
    await sleep(150);
    await captureStore("create");
    await page.ev("window.scrollTo(0,0); return true;");
  }
  await clickReady("Create vault");
  await until(async () => await yieldFactory.vaultOf(ACCOUNTS.a0.a) !== "0x0000000000000000000000000000000000000000", "yield creation");
  const vault = await yieldFactory.vaultOf(ACCOUNTS.a0.a);
  const yieldVault = new Contract(vault, JSON.parse(readFileSync("out/InheritanceVaultMorpho.sol/InheritanceVaultMorpho.json", "utf8")).abi, provider);
  const withoutPosition = target => preload + `window.__E2E_RPC_FAULTS__ = ${JSON.stringify([{ to: target.toLowerCase(), data: yieldVault.interface.getFunction("position").selector.toLowerCase() }])};`;
  async function publishReward(cumulative, claimed, pending = 0n, target = vault) {
    const abi = AbiCoder.defaultAbiCoder();
    const sibling = keccak256(new TextEncoder().encode("unrelated reward leaf"));
    const leaf = keccak256(abi.encode(["address", "address", "uint256"], [target, await token.getAddress(), cumulative]));
    const pair = [leaf, sibling].sort();
    await (await distributor.setRoot(keccak256(abi.encode(["bytes32", "bytes32"], pair)))).wait();
    const data = [{ chain: { id: 480 }, rewards: [{ token: { address: await token.getAddress(), decimals: 18 },
      amount: cumulative.toString(), claimed: claimed.toString(), pending: pending.toString(), proofs: [sibling] }] }];
    await page.ev(`window.__E2E_REWARDS__[${JSON.stringify(target.toLowerCase())}] = ${JSON.stringify(data)}; return true;`);
    return sibling;
  }
  async function externalReward(target, cumulative) {
    const child = new Contract(target, yieldVault.interface, provider);
    const sibling = await publishReward(cumulative, await child.totalRewardsClaimed(), 0n, target);
    await (await distributor.setOperator(ACCOUNTS.a0.a, true)).wait();
    await (await distributor.claim([target], [await token.getAddress()], [cumulative], [[sibling]])).wait();
  }
  await until(() => page.ev("return /Morpho yield position/.test(document.body.innerText)"));
  assert.equal(await token.balanceOf(ACCOUNTS.a0.a), parseEther("100"));
  assert.equal(await token.balanceOf(plainVault), parseEther("50"));
  pass("A separate yield vault can be created while the basic vault stays accessible");
  await page.ev("return __q.tab('Send')");
  await page.waitFor("#deposit-amount");
  await page.ev("window.__E2E_REWARDS_DOWN__ = true; return true;");
  await clickReady("Refresh rewards");
  await until(() => page.ev("return /Rewards are temporarily unavailable/.test(document.body.innerText)"));
  await page.ev("return __q.setInput('deposit-amount', '100')");
  await clickReady("Deposit");
  await until(async () => await morpho.balanceOf(vault) === parseEther("100"), "real yield deposit");
  await until(() => page.ev("return /Deposit complete/.test(document.body.innerText)"));
  const sent = await page.ev("return window.__E2E_MINIKIT__.lastCalldata()");
  assert.equal(sent[1].to.toLowerCase(), (await yieldFactory.getAddress()).toLowerCase());
  assert.equal(await token.balanceOf(plainVault), parseEther("50"));
  pass("Deposit uses the selected yield factory with a minimum-share quote and real receipt custody");
  pass("An unavailable rewards API does not block principal deposits or vault valuation");
  const choices = () => page.ev("return [...document.querySelectorAll('button')].filter(b => /^(WLD vault|Morpho yield vault) ·/.test(b.textContent.trim())).map(b => b.textContent.trim())");
  assert.equal((await choices()).length, 2);
  await fault(yieldFactory, yieldFactory.interface.getFunction("vaultOf").selector);
  await page.ev("[...document.querySelectorAll('button')].find(b => /^WLD vault ·/.test(b.textContent.trim())).click(); return true;");
  await until(() => page.ev("return /Some vault registries could not be refreshed/.test(document.body.innerText)"));
  assert.equal((await choices()).length, 2);
  assert.equal(await morpho.balanceOf(vault), parseEther("100"));
  pass("A failed registry preserves the previously verified funded yield vault and its selector");
  await clearFaults();
  await until(() => page.ev("return !/Some vault registries could not be refreshed/.test(document.body.innerText)"), "automatic registry recovery");
  assert.equal((await choices()).length, 2);
  await page.ev("[...document.querySelectorAll('button')].find(b => /^Morpho yield vault ·/.test(b.textContent.trim())).click(); return true;");
  await until(() => page.ev("return /Morpho yield position/.test(document.body.innerText) && !!document.getElementById('deposit-amount')"));
  pass("Registry polling restores verified access after RPC recovery without signing in again");
  await page.ev("window.__E2E_REWARDS_DOWN__ = false; return true;");
  await clickReady("Refresh rewards");
  await (await morpho.setRate(parseEther("1.1"))).wait();
  await (await token.mint(await morpho.getAddress(), parseEther("10"))).wait();
  await clickReady("Refresh balance");
  await until(() => page.ev("return /109.0 WLD/.test(document.body.innerText) && /1.0 WLD/.test(document.body.innerText)"));
  pass("The UI separates net value, the gain fee and available cash liquidity");
  await page.ev("return __q.tab('Vault')");
  assert.equal(await page.ev("return [...document.querySelectorAll('b')].find(b => b.parentElement.textContent.trim().startsWith('At stake in this vault:'))?.textContent.trim()"), "109.0 WLD");
  pass("The Vault tab quotes the heir's after-fee 109 WLD instead of the gross 110 WLD");
  await page.ev("return __q.tab('Send')");
  const walletRead = morpho.interface.encodeFunctionData("balanceOf", [ACCOUNTS.a0.a]);
  await fault(morpho, walletRead);
  let rejected = await page.ev("return window.__E2E_RPC_FAULT_MATCHES__");
  await (await morpho.setRate(parseEther("1.11"))).wait();
  await (await token.mint(await morpho.getAddress(), parseEther("1"))).wait();
  await clickReady("Refresh balance");
  await until(() => page.ev(`return window.__E2E_RPC_FAULT_MATCHES__ > ${rejected} && /109.9 WLD/.test(document.body.innerText)`));
  assert.equal(await page.ev("return [...document.querySelectorAll('.stat')].some(el => el.innerText.toLowerCase().includes('estimated value') && /111.0 WLD/.test(el.innerText))"), true);
  pass("A wallet receipt read failure does not prevent a fresh, coherent vault valuation");
  await clearFaults();
  await fault(yieldVault, yieldVault.interface.getFunction("position").selector);
  rejected = await page.ev("return window.__E2E_RPC_FAULT_MATCHES__");
  await clickReady("Refresh balance");
  await until(() => page.ev(`return window.__E2E_RPC_FAULT_MATCHES__ > ${rejected}`));
  assert.equal(await page.ev("return [...document.querySelectorAll('.stat')].some(el => el.innerText.toLowerCase().includes('estimated value') && /111.0 WLD/.test(el.innerText))"), true);
  pass("A failed vault position read preserves its last coherent balance instead of replacing it with idle cash");
  await clearFaults();
  await (await morpho.setRate(parseEther("1.1"))).wait();
  await clickReady("Refresh balance");
  await until(() => page.ev("return /109.0 WLD/.test(document.body.innerText) && /1.0 WLD/.test(document.body.innerText)"));
  await page.shot("morpho-yield-position");
  await captureStore("position");
  await clickReady("All");
  await clickReady("Withdraw to myself");
  await until(async () => await token.balanceOf(ACCOUNTS.a0.a) === parseEther("109"), "cash withdrawal");
  await until(() => page.ev("return /Withdraw complete/.test(document.body.innerText)"));
  assert.equal(await token.balanceOf(ACCOUNTS.a2.a), parseEther("1"));
  assert.equal(await morpho.balanceOf(vault), 0n);
  pass("Full cash withdrawal pays 109 of 110 WLD and leaves no receipt dust");

  const ping = await yieldVault.lastPing();
  await publishReward(parseEther("10"), 0n, parseEther("3"));
  await clickReady("Refresh rewards");
  await until(() => page.ev("return /Ready to claim/.test(document.body.innerText) && /Awaiting reward publication/.test(document.body.innerText) && __q.btns().some(b => b.t === 'Claim and reinvest WLD rewards' && !b.d)"));
  assert.match(await page.ev("return document.body.innerText"), /verified-human boost is not automatic/);
  await clickReady("Claim and reinvest WLD rewards");
  await until(async () => await yieldVault.totalRewardsClaimed() === parseEther("10"));
  await until(() => page.ev("return /WLD rewards claimed and reinvested/.test(document.body.innerText)"));
  assert.equal(await yieldVault.costBasis(), 0n);
  assert.equal(await yieldVault.lastPing(), ping);
  assert.ok(await morpho.balanceOf(vault) > 0n);
  const rewardTx = await page.ev("return window.__E2E_MINIKIT__.lastCalldata()");
  assert.equal(rewardTx[0].to.toLowerCase(), (await yieldFactory.getAddress()).toLowerCase());
  assert.equal(yieldFactory.interface.parseTransaction({ data: rewardTx[0].data }).args[0].toLowerCase(), vault.toLowerCase());
  pass("A valid WLD reward proof compounds actual funds without inventing capital, changing the timer or routing to the caller");
  await publishReward(parseEther("10"), parseEther("10"), parseEther("3"));
  await clickReady("Refresh rewards");
  await until(() => page.ev("return !__q.btns().some(b => b.t === 'Claim and reinvest WLD rewards')"));
  pass("Already claimed and unpublished rewards cannot trigger another payout");
  const ownerBeforeRewardExit = await token.balanceOf(ACCOUNTS.a0.a);
  await clickReady("All"); await clickReady("Withdraw to myself");
  await until(async () => await morpho.balanceOf(vault) === 0n);
  await until(() => page.ev("return /Withdraw complete/.test(document.body.innerText)"));
  assert.ok(await token.balanceOf(ACCOUNTS.a0.a) - ownerBeforeRewardExit >= parseEther("9") - 2n);
  const operatorAfterRewards = await token.balanceOf(ACCOUNTS.a2.a);
  assert.ok(operatorAfterRewards >= parseEther("2") - 2n && operatorAfterRewards <= parseEther("2"));
  pass("The exit charges ten percent of realized campaign income and preserves receipt rounding bounds");

  await page.ev("return __q.setInput('deposit-amount', '100')"); await clickReady("Deposit");
  await until(async () => await morpho.balanceOf(vault) > 0n);
  await until(() => page.ev("return /Deposit complete/.test(document.body.innerText)"));
  await (await morpho.setLiquidity(0)).wait();
  await page.close(); page = null;
  page = await launch({ pk: ACCOUNTS.a0.pk, url: url + "?vault=" + vault, preload: withoutPosition(vault) }); await page.ev(HELPERS);
  await clickReady("Continue with World App");
  await until(() => page.ev("return __q.tabs().includes('Send')"));
  await page.ev("return __q.tab('Send')");
  await until(() => page.ev("return window.__E2E_RPC_FAULT_MATCHES__ > 0 && /Value and cash liquidity are unavailable/.test(document.body.innerText)"));
  await until(() => page.ev("return __q.btns().some(b => b.t === 'Move all receipt shares to my wallet' && !b.d)"));
  assert.ok(await yieldVault.hasAssets());
  pass("A first-load position failure still reads actual custody and enables the owner's receipt exit");
  await clickReady("Move all receipt shares to my wallet");
  await until(async () => await morpho.balanceOf(vault) === 0n);
  await until(() => page.ev("return __q.btns().some(b => b.t === 'Redeem available shares to WLD' && !b.d)"));
  assert.ok(await morpho.balanceOf(ACCOUNTS.a0.a) > 0n);
  pass("The owner can exit in receipt shares without Morpho cash liquidity");
  await clickReady("Redeem available shares to WLD");
  await until(() => page.ev("return /Cash liquidity is currently unavailable/.test(document.body.innerText)"));
  assert.ok(await morpho.balanceOf(ACCOUNTS.a0.a) > 0n);
  pass("A failed cash redemption explains liquidity and keeps wallet-held shares intact");
  await (await morpho.setLiquidity((1n << 256n) - 1n)).wait();
  await clickReady("Redeem available shares to WLD");
  await until(async () => await morpho.balanceOf(ACCOUNTS.a0.a) === 0n);
  await until(() => page.ev("return /Available receipt shares redeemed/.test(document.body.innerText)"));
  assert.equal(await token.balanceOf(ACCOUNTS.a2.a), operatorAfterRewards);
  pass("Wallet receipt redemption adds no second service fee");

  const beforeIdleRecovery = await token.balanceOf(ACCOUNTS.a0.a);
  await (await token.mint(vault, parseEther("5"))).wait();
  await clickReady("Refresh balance");
  await until(() => page.ev("return /Idle WLD[\\s\\S]{0,20}5.0 WLD/.test(document.body.innerText)"));
  await clickReady("All");
  assert.equal(await page.ev("return document.getElementById('withdraw-amount').value"), "5.0");
  await clickReady("Withdraw to myself");
  await until(async () => await token.balanceOf(vault) === 0n);
  await until(() => page.ev("return /Withdraw complete/.test(document.body.innerText)"));
  assert.equal(await token.balanceOf(ACCOUNTS.a0.a), beforeIdleRecovery + parseEther("5"));
  assert.equal(await token.balanceOf(ACCOUNTS.a2.a), operatorAfterRewards);
  pass("Verified idle WLD can be selected with All and withdrawn without a position quote or principal fee");

  await page.ev("return __q.setInput('deposit-amount', '100')"); await clickReady("Deposit");
  await until(async () => await morpho.balanceOf(vault) > 0n);
  await until(() => page.ev("return /Deposit complete/.test(document.body.innerText)"));
  await (await morpho.setRate(parseEther("1.21"))).wait();
  await (await token.mint(await morpho.getAddress(), parseEther("10"))).wait();
  await (await morpho.setLiquidity(0)).wait();
  await provider.send("evm_increaseTime", [30 * 86400 + 1]); await provider.send("evm_mine", []);
  await page.close(); page = null;
  page = await launch({ pk: ACCOUNTS.a1.pk, url: url + "?vault=" + vault, preload }); await page.ev(HELPERS);
  await clickReady("Continue with World App");
  await until(() => page.ev("return __q.btns().some(b => b.t === 'File claim' && !b.d)"));
  await clickReady("File claim");
  await until(() => page.ev("return /Claim confirmed/.test(document.body.innerText)"));
  await provider.send("evm_increaseTime", [7 * 86400]); await provider.send("evm_mine", []);
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__E2E_RPC_FAULTS__ = ${JSON.stringify([{ to: vault.toLowerCase(), data: yieldVault.interface.getFunction("position").selector.toLowerCase() }])};` });
  await page.send("Page.reload", {}); await sleep(1500); await page.ev(HELPERS);
  await until(() => page.ev("return __q.btns().some(b => b.t === 'Complete inheritance' && !b.d)"));
  assert.ok(await page.ev("return window.__E2E_RPC_FAULT_MATCHES__") > 0);
  assert.equal(await yieldVault.hasAssets(), true);
  assert.equal(await yieldVault.claimableNow(), true);
  pass("A first-load position failure cannot block the verified heir's eligible inheritance");
  await clickReady("Complete inheritance");
  await until(async () => await morpho.balanceOf(ACCOUNTS.a1.a) > 0n);
  await until(() => page.ev("return __q.btns().some(b => b.t === 'Redeem available shares to WLD' && !b.d)"));
  assert.equal(await morpho.balanceOf(vault), 0n);
  assert.equal(await token.balanceOf(plainVault), parseEther("50"));
  pass("After seven days the heir receives illiquid shares through the verified factory");
  await until(() => page.ev("return /Your inheritance completed/.test(document.body.innerText)"));
  assert.doesNotMatch(await page.ev("return document.body.innerText"), /You are neither the owner nor the heir/);
  assert.match(await page.ev("return document.body.innerText"), /You are the heir of 1 vault\./);
  pass("Completed inheritance recognizes its recipient without granting owner controls");
  for (const width of [320, 390, 960]) {
    await page.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 });
    await sleep(100);
    assert.equal(await page.ev("return document.documentElement.scrollWidth <= innerWidth"), true);
    pass("Yield inheritance and wallet receipts fit the " + width + "px viewport");
  }
  await page.shot("morpho-inherited-shares");
  await (await morpho.setLiquidity((1n << 256n) - 1n)).wait();
  assert.match(await clickReady("Redeem available shares to WLD"), /^clicked/);
  await until(async () => await morpho.balanceOf(ACCOUNTS.a1.a) === 0n);
  assert.ok(await token.balanceOf(ACCOUNTS.a1.a) > parseEther("107"));
  pass("An heir without an owned vault can redeem inherited receipts when liquidity returns");
  await (await yieldFactory.releaseMyVault()).wait();
  await (await yieldFactory.createVault(ACCOUNTS.a1.a, 30 * 86400)).wait();
  const newVault = await yieldFactory.vaultOf(ACCOUNTS.a0.a);
  await page.send("Page.reload", {}); await sleep(1500); await page.ev(HELPERS);
  await until(() => page.ev("return /WLD campaign rewards/.test(document.body.innerText) && /Your inheritance completed/.test(document.body.innerText)"));
  await publishReward(parseEther("20"), parseEther("10"));
  await clickReady("Refresh rewards");
  const heirBeforeLateReward = await token.balanceOf(ACCOUNTS.a1.a);
  await clickReady("Claim remaining inheritance rewards");
  await until(async () => await yieldVault.totalRewardsClaimed() === parseEther("20"));
  await until(() => page.ev("return /Remaining rewards paid to the fixed inheritance recipient/.test(document.body.innerText)"));
  assert.ok(await token.balanceOf(ACCOUNTS.a1.a) - heirBeforeLateReward >= parseEther("9") - 2n);
  assert.equal(await token.balanceOf(newVault), 0n);
  assert.equal(await morpho.balanceOf(newVault), 0n);
  assert.equal(await yieldVault.inheritanceRecipient(), ACCOUNTS.a1.a);
  assert.equal(await page.ev("return __q.btns().some(b => b.t === 'Reset timer' || b.t === 'Withdraw to myself')"), false);
  pass("A released vault link claims delayed income for its fixed heir without touching the owner's new vault");
  await provider.send("evm_increaseTime", [30 * 86400 + 1]); await provider.send("evm_mine", []);
  await (await yieldFactory.releaseMyVault()).wait();
  await (await yieldFactory.createVault(ACCOUNTS.a2.a, 30 * 86400)).wait();
  const currentVault = await yieldFactory.vaultOf(ACCOUNTS.a0.a);
  await page.close(); page = null;
  page = await launch({ pk: ACCOUNTS.a1.pk, url: url + "?vault=" + newVault, preload }); await page.ev(HELPERS);
  await publishReward(parseEther("10"), 0n, 0n, newVault);
  await clickReady("Continue with World App");
  await until(() => page.ev("return /This archived vault/.test(document.body.innerText)"));
  await clickReady("Refresh rewards");
  await clickReady("Claim and reinvest WLD rewards");
  await until(async () => await morpho.balanceOf(newVault) > 0n);
  await until(() => page.ev("return /WLD rewards claimed and reinvested/.test(document.body.innerText)"));
  await clickReady("File claim");
  await until(() => page.ev("return /Claim confirmed/.test(document.body.innerText)"));
  pass("Rewards published after an empty vault was released can still enter its original inheritance review");
  await page.close(); page = null;
  page = await launch({ pk: ACCOUNTS.a0.pk, url: url + "?vault=" + newVault, preload }); await page.ev(HELPERS);
  await clickReady("Continue with World App");
  await until(() => page.ev("return /This is your archived vault/.test(document.body.innerText)"));
  assert.doesNotMatch(await page.ev("return document.body.innerText"), /You are neither|You are neither of them/);
  for (const tab of ["Send", "Vault", "Inherit"]) {
    await page.ev(`return __q.tab(${JSON.stringify(tab)})`);
    assert.equal(await page.ev("return !!document.querySelector('#deposit-amount, #withdraw-amount, #period-change, #new-heir-input')"), false);
    assert.equal(await page.ev("return __q.btns().some(b => /^(Reset timer|Renew and withdraw|Sweep .* to me)/.test(b.t))"), false);
  }
  assert.equal(await yieldFactory.vaultOf(ACCOUNTS.a0.a), currentVault);
  assert.equal(await morpho.balanceOf(currentVault), 0n);
  assert.equal(await page.ev("return __q.btns().some(b => b.t === 'Recover archived assets to me' && !b.d)"), true);
  pass("An archived owner sees recovery scoped to the old vault without controls that could target the current vault");
  await page.close(); page = null;
  page = await launch({ pk: ACCOUNTS.a1.pk, url: url + "?vault=" + newVault, preload }); await page.ev(HELPERS);
  await clickReady("Continue with World App");
  await until(() => page.ev("return /This archived vault/.test(document.body.innerText)"));
  await provider.send("evm_increaseTime", [7 * 86400]); await provider.send("evm_mine", []);
  await page.send("Page.reload", {}); await sleep(1500); await page.ev(HELPERS);
  const beforeArchivedPayout = await token.balanceOf(ACCOUNTS.a1.a);
  await clickReady("Complete inheritance");
  await until(async () => await morpho.balanceOf(newVault) === 0n);
  await until(() => page.ev("return /Claim complete/.test(document.body.innerText)"));
  assert.ok(await token.balanceOf(ACCOUNTS.a1.a) - beforeArchivedPayout >= parseEther("9") - 2n);
  assert.equal(await token.balanceOf(currentVault), 0n);
  assert.equal(await morpho.balanceOf(currentVault), 0n);
  pass("An archived unsettled vault completes its fixed-heir inheritance without routing to the owner's current vault");
  await (await yieldFactory.cancelMyInheritance()).wait();
  await provider.send("evm_increaseTime", [30 * 86400 + 1]); await provider.send("evm_mine", []);
  await (await yieldFactory.releaseMyVault()).wait();
  await (await yieldFactory.createVault(ACCOUNTS.a2.a, 30 * 86400)).wait();
  const latestVault = await yieldFactory.vaultOf(ACCOUNTS.a0.a);
  const latestChild = new Contract(latestVault, yieldVault.interface, provider);
  const latestPing = await latestChild.lastPing();
  await page.close(); page = null;
  page = await launch({ pk: ACCOUNTS.a0.pk, url: url + "?vault=" + currentVault, preload: withoutPosition(currentVault) }); await page.ev(HELPERS);
  await publishReward(parseEther("10"), 0n, 0n, currentVault);
  await clickReady("Continue with World App");
  await until(() => page.ev("return /This is your archived vault/.test(document.body.innerText)"));
  await clickReady("Refresh rewards");
  await clickReady("Claim and reinvest WLD rewards");
  await until(async () => await morpho.balanceOf(currentVault) > 0n);
  await until(() => page.ev("return /WLD rewards claimed and reinvested/.test(document.body.innerText)"));
  const beforeOwnerReceipts = await morpho.balanceOf(ACCOUNTS.a0.a);
  await (await morpho.setLiquidity(0)).wait();
  await clickReady("Recover archived assets to me");
  await until(async () => await morpho.balanceOf(currentVault) === 0n);
  await until(() => page.ev("return /Archived assets settled/.test(document.body.innerText)"));
  assert.ok(await morpho.balanceOf(ACCOUNTS.a0.a) > beforeOwnerReceipts);
  assert.equal(await yieldFactory.vaultOf(ACCOUNTS.a0.a), latestVault);
  assert.equal(await latestChild.lastPing(), latestPing);
  assert.equal(await morpho.balanceOf(latestVault), 0n);
  assert.equal(await token.balanceOf(latestVault), 0n);
  assert.doesNotMatch(await page.ev("return document.body.innerText"), /You are neither/);
  pass("A cancelled released vault recovers its late rewards to the owner without cash liquidity or changes to the current vault");
  assert.ok(await page.ev("return window.__E2E_RPC_FAULT_MATCHES__") > 0);
  pass("Archived owner recovery remains available when the first position quote fails");

  await page.close(); page = null;
  page = await launch({ pk: ACCOUNTS.a1.pk, url: url + "?vault=" + newVault, preload }); await page.ev(HELPERS);
  await clickReady("Continue with World App");
  const lateHeirBefore = await token.balanceOf(ACCOUNTS.a1.a);
  await externalReward(newVault, parseEther("20"));
  await page.ev("window.__E2E_REWARDS_DOWN__ = true; return true;");
  await clickReady("Refresh rewards");
  await until(() => page.ev("return /Rewards are temporarily unavailable/.test(document.body.innerText)"));
  await clickReady("Receive remaining WLD rewards");
  await until(async () => await token.balanceOf(newVault) === 0n);
  await until(() => page.ev("return /Received rewards paid to the fixed inheritance recipient/.test(document.body.innerText)"));
  assert.equal(await token.balanceOf(ACCOUNTS.a1.a) - lateHeirBefore, parseEther("9"));
  pass("A released heir processes already delivered rewards even when the rewards API is unavailable");

  await externalReward(newVault, parseEther("30"));
  await (await token.mint(newVault, parseEther("5"))).wait();
  const recoveryOwnerBefore = await token.balanceOf(ACCOUNTS.a0.a);
  const recoveryHeirBefore = await token.balanceOf(ACCOUNTS.a1.a);
  await page.close(); page = null;
  page = await launch({ pk: ACCOUNTS.a0.pk, url: url + "?vault=" + newVault, preload }); await page.ev(HELPERS);
  await clickReady("Continue with World App");
  await clickReady("Recover archived assets to me");
  await until(async () => await token.balanceOf(newVault) === 0n);
  await until(() => page.ev("return /Archived assets settled/.test(document.body.innerText)"));
  assert.equal(await token.balanceOf(ACCOUNTS.a0.a) - recoveryOwnerBefore, parseEther("5"));
  assert.equal(await token.balanceOf(ACCOUNTS.a1.a) - recoveryHeirBefore, parseEther("9"));
  assert.equal(await yieldFactory.vaultOf(ACCOUNTS.a0.a), latestVault);
  pass("Archived recovery sends external campaign rewards to the fixed heir and only the gift to the owner");

  await page.close(); page = null;
  page = await launch({ pk: ACCOUNTS.a0.pk, url: url + "?vault=" + latestVault, preload: withoutPosition(latestVault) }); await page.ev(HELPERS);
  await clickReady("Continue with World App");
  await externalReward(latestVault, parseEther("10"));
  await page.ev("window.__E2E_REWARDS_DOWN__ = true; return true;");
  await clickReady("Refresh rewards");
  await clickReady("Reinvest received WLD rewards");
  await until(async () => await morpho.balanceOf(latestVault) > 0n);
  await until(() => page.ev("return /Received WLD rewards reinvested/.test(document.body.innerText)"));
  assert.equal(await latestChild.costBasis(), 0n);
  assert.equal(await latestChild.lastPing(), latestPing);
  pass("Received-reward reinvestment needs no API proof, adds no principal and never renews the timer");
  await clickReady("Move all receipt shares to my wallet");
  await until(async () => await morpho.balanceOf(latestVault) === 0n);
  await provider.send("evm_increaseTime", [30 * 86400 + 1]); await provider.send("evm_mine", []);
  await page.send("Page.reload", {}); await sleep(1500); await page.ev(HELPERS);
  await page.ev("return __q.tab('Vault')");
  await clickReady("Release slot");
  await page.ev("[...document.querySelectorAll('label')].find(l => l.textContent.includes('I understand the conditions')).querySelector('input').click(); return true;");
  await clickReady("Confirm");
  await until(async () => await yieldFactory.vaultOf(ACCOUNTS.a0.a) === "0x0000000000000000000000000000000000000000");
  assert.ok(await page.ev("return window.__E2E_RPC_FAULT_MATCHES__") > 0);
  pass("An empty expired yield vault releases its slot with verified raw holdings despite an initial position failure");
  assert.deepEqual(await page.ev("return __q.errs()"), []);
  pass("No runtime errors or unhandled rejections in the yield inheritance flow");
  console.log(`\n  ${passed} yield browser checks passed; transactions used local Anvil.`);
} catch (error) {
  if (page) {
    console.error(await page.ev("return {buttons:__q.btns(),errors:__q.errs(),bridgeError:window.__E2E_MINIKIT__?.lastError(),status:document.body.innerText.slice(-2600)}"));
    await page.shot("morpho-failure");
  }
  throw error;
} finally {
  await page?.close(); await vite?.close(); provider?.destroy(); anvil.kill("SIGTERM");
}
