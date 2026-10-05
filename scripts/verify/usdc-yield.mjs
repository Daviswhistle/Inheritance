// Real USDC six-decimal/receipt eighteen-decimal contracts and funds on Anvil.
// World App authentication/approval and public campaign responses are fixtures.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { AbiCoder, Contract, ContractFactory, JsonRpcProvider, parseEther, keccak256 } from "ethers";
import { createServer as createVite } from "../../app/node_modules/vite/dist/node/index.js";
import { launch, ACCOUNTS, HELPERS } from "./drv.mjs";

async function port() {
  const socket = createServer(); await new Promise(resolve => socket.listen(0, "127.0.0.1", resolve));
  const value = socket.address().port; await new Promise(resolve => socket.close(resolve)); return value;
}
async function until(work, label = "USDC UI") {
  const limit = Date.now() + 35_000;
  while (Date.now() < limit) { if (await work()) return; await sleep(150); }
  throw new Error(label + " did not reach the expected state");
}
function publicFixtures() {
  window.__E2E_REWARDS__ = {}; window.__E2E_REWARDS_DOWN__ = false; window.__E2E_RATES_DOWN__ = false;
  window.__E2E_USDC_REGISTERED__ = {};
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    if (url.startsWith("https://usdc-notify.example/")) {
      const parsed = new URL(url);
      if (parsed.pathname === "/api/notifications/register") {
        const vault = JSON.parse(init.body).vaultAddress.toLowerCase();
        await new Promise(resolve => setTimeout(resolve, 3000));
        window.__E2E_USDC_REGISTERED__[vault] = true;
        return Response.json({ status: "success", watcher: { active: true } });
      }
      if (parsed.pathname === "/api/notifications/status") return Response.json({ status: "success",
        watcher: window.__E2E_USDC_REGISTERED__[parsed.searchParams.get("vaultAddress").toLowerCase()] ? { active: true } : null });
      if (parsed.pathname === "/api/notifications") return Response.json({ status: "success", watchers: [], nextCursor: null });
      if (parsed.pathname === "/api/automation/health") return Response.json({ automation: { enabled: true,
        supported: true, funded: true, halted: false, reason: "ready", factoryAddresses: window.__E2E_FACTORIES__ } });
      throw new Error("Unexpected local USDC notification route");
    }
    const strategy = url.match(/^https:\/\/api\.merkl\.xyz\/v4\/opportunities\?chainId=480&identifier=(0x[a-fA-F0-9]{40})$/)?.[1];
    if (strategy) {
      const usdc = strategy.toLowerCase() === window.__E2E_USDC_STRATEGY__.toLowerCase(), now = Math.floor(Date.now() / 1000);
      return new Response(JSON.stringify([{ chainId: 480, type: "MORPHOVAULT", identifier: strategy, status: "LIVE",
        latestCampaignEnd: String(now + 86400), nativeAprRecord: { timestamp: String(now - 10), value: usdc ? 1.79 : 0.0013 },
        aprRecord: { timestamp: String(now - 10), cumulated: usdc ? 5.68 : 1.7 },
        rewardsRecord: { breakdowns: [{ token: { address: window.__E2E_WLD__, chainId: 480, decimals: 18 } }] } }]),
      { status: window.__E2E_RATES_DOWN__ ? 503 : 200, headers: { "Content-Type": "application/json" } });
    }
    const vault = url.match(/^https:\/\/api\.merkl\.xyz\/v4\/users\/(0x[a-f0-9]{40})\/rewards\?chainId=480$/)?.[1];
    if (vault) return new Response(JSON.stringify(window.__E2E_REWARDS__[vault] ?? []), {
      status: window.__E2E_REWARDS_DOWN__ ? 503 : 200, headers: { "Content-Type": "application/json" },
    });
    return original(input, init);
  };
}
const rpc = `http://127.0.0.1:${await port()}`;
const anvil = spawn("anvil", ["--port", new URL(rpc).port, "--chain-id", "480", "--silent", "--block-time", "1", "--mixed-mining"], { stdio: "ignore" });
let provider, vite, page, passed = 0;
const pass = label => { passed++; console.log("PASS " + label); };
async function click(label) {
  await page.ev(`return __q.revealButton(${JSON.stringify(label)})`);
  await until(() => page.ev(`return __q.btns().some(b => b.t === ${JSON.stringify(label)} && !b.d)`), label);
  assert.match(await page.ev(`return __q.click(${JSON.stringify(label)})`), /^clicked/);
}
async function enableAtomicBatch() {
  await page.ev(`
    if (window.__ATOMIC_BRIDGE_INSTALLED__) return true;
    const fixture = await import('/src/test/minikit-stub.ts');
    const original = fixture.MiniKit.sendTransaction.bind(fixture.MiniKit);
    fixture.MiniKit.sendTransaction = async request => {
      if (request.transactions.length < 2) return original(request);
      fixture.__setState({ lastCalldata: request.transactions.map(tx => ({ to: tx.to, data: tx.data || '0x' })) });
      const result = await fixture.__sendAtomicBatch(request.transactions);
      fixture.__setState({ lastError: result.data.status === 'success' ? null : result.data.error });
      return result;
    };
    window.__ATOMIC_BRIDGE_INSTALLED__ = true;
    return true;
  `);
}
async function setPlanAmount(symbol, amount) {
  const id = `plan-${symbol.toLowerCase()}`;
  assert.equal(await page.ev(`return !!document.getElementById(${JSON.stringify(id)})`), true);
  await page.ev(`return __q.setInput(${JSON.stringify(id)}, ${JSON.stringify(amount)})`);
}
async function clickPlanSubmit() {
  await click("Review plan");
  return click("Confirm and deposit");
}
async function selectVault(labelPrefix) {
  const result = await page.ev(`
    const prefix = ${JSON.stringify(labelPrefix)};
    const symbol = prefix.startsWith('USDC') ? 'USDC' : 'WLD';
    const assetButton = [...document.querySelectorAll('.asset-switcher button')].find(item => item.textContent.trim().endsWith(symbol));
    if (!assetButton) return 'missing asset ' + prefix;
    assetButton.click();
    await new Promise(requestAnimationFrame);
    const history = document.querySelector('.asset-history');
    if (!history) return 'selected ' + symbol;
    if (!history.open) history.querySelector('summary').click();
    const current = prefix.includes('Morpho');
    const button = [...history.querySelectorAll('button')].find(item => item.textContent.trim().startsWith(current ? 'Current ' : 'Earlier '));
    if (!button) return 'missing account ' + prefix;
    button.click();
    return 'selected ' + button.textContent.trim();
  `);
  assert.match(result, /^selected /, `could not select ${labelPrefix} in Send`);
  return result;
}
try {
  await until(async () => { try { return (await fetch(rpc, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) })).ok; } catch { return false; } });
  provider = new JsonRpcProvider(rpc, undefined, { batchMaxCount: 1, cacheTimeout: -1 });
  const owner = await provider.getSigner(0);
  const artifact = (name, file = name) => JSON.parse(readFileSync(`out/${file}.sol/${name}.json`, "utf8"));
  const deploy = async (name, args, file = name) => {
    const a = artifact(name, file), c = await new ContractFactory(a.abi, a.bytecode.object, owner).deploy(...args);
    await c.waitForDeployment(); return c;
  };
  const wld = await deploy("MockERC20", ["Worldcoin", "WLD"]), usdc = await deploy("MockUSDC", [], "MockRe7USDC");
  const plain = await deploy("InheritanceVaultWLDFactoryOnePerOwner", [await wld.getAddress()]);
  const wldStrategy = await deploy("MockERC4626", [await wld.getAddress()]);
  const usdcStrategy = await deploy("MockRe7USDC", [await usdc.getAddress()]);
  const wldFactory = await deploy("InheritanceVaultMorphoFactory", [await wld.getAddress(), await wldStrategy.getAddress(), ACCOUNTS.a2.a, 1000]);
  const usdcFactory = await deploy("InheritanceVaultUSDCFactory", [await usdc.getAddress(), await usdcStrategy.getAddress(), await wld.getAddress(), ACCOUNTS.a2.a, 1000]);
  const distributorAddress = "0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae", distributorArt = artifact("MockMerklDistributor");
  await provider.send("anvil_setCode", [distributorAddress, distributorArt.deployedBytecode.object]);
  const distributor = new Contract(distributorAddress, distributorArt.abi, owner);
  await (await wld.mint(distributorAddress, parseEther("100"))).wait();
  await (await plain.createVault(ACCOUNTS.a3.a, 90 * 86400)).wait();
  const batchWallet = await deploy("MockWorldAppWallet", []);
  const plainVault = await plain.vaultOf(ACCOUNTS.a0.a); await (await wld.mint(plainVault, parseEther("10"))).wait();
  await (await wldFactory.createVault(ACCOUNTS.a1.a, 30 * 86400)).wait();
  const wldVault = await wldFactory.vaultOf(ACCOUNTS.a0.a);
  await (await wld.mint(ACCOUNTS.a0.a, parseEther("120"))).wait();
  await (await wld.approve(await wldFactory.getAddress(), parseEther("20"))).wait();
  await (await wldFactory.depositWithMinShares(parseEther("20"), parseEther("20"))).wait();
  await (await usdc.mint(ACCOUNTS.a0.a, 200_123456n)).wait();
  const plainVaultContract = new Contract(plainVault, artifact("InheritanceVaultWLD").abi, provider);
  const existingWldVault = new Contract(wldVault, artifact("InheritanceVaultMorpho").abi, provider);
  const originalPlainBalance = await wld.balanceOf(plainVault);
  const originalPlainHeir = await plainVaultContract.heir();
  const originalPlainInterval = await plainVaultContract.heartbeatInterval();
  const existingWldHeir = await existingWldVault.heir();
  const existingWldInterval = await existingWldVault.heartbeatInterval();
  const existingWldShares = await wldStrategy.balanceOf(wldVault);
  assert.equal(originalPlainHeir, ACCOUNTS.a3.a);
  assert.equal(originalPlainInterval, 90n * 86400n);
  assert.equal(originalPlainBalance, parseEther("10"));
  assert.equal(existingWldHeir, ACCOUNTS.a1.a);
  assert.equal(existingWldInterval, 30n * 86400n);
  assert.equal(existingWldShares, parseEther("20"));
  for (const key of Object.keys(process.env)) if (key.startsWith("VITE_")) delete process.env[key];
  Object.assign(process.env, { VITE_FACTORY_ADDRESS: await plain.getAddress(), VITE_FACTORY_DEPLOY_BLOCK: "1",
    VITE_WLD_ADDRESS: await wld.getAddress(), VITE_RPC: rpc, VITE_LEGACY_FACTORY_ADDRESS: "",
    VITE_NOTIFY_BACKEND_URL: "https://usdc-notify.example", VITE_REQUIRE_VERIFY: "false", VITE_FACTORY_RELEASE_SUPPORTED: "true",
    VITE_YIELD_FACTORY_ADDRESS: await wldFactory.getAddress(), VITE_YIELD_FACTORY_DEPLOY_BLOCK: "1", VITE_MORPHO_VAULT_ADDRESS: await wldStrategy.getAddress(),
    VITE_USDC_ADDRESS: await usdc.getAddress(), VITE_USDC_YIELD_FACTORY_ADDRESS: await usdcFactory.getAddress(),
    VITE_USDC_YIELD_FACTORY_DEPLOY_BLOCK: "1", VITE_USDC_MORPHO_VAULT_ADDRESS: await usdcStrategy.getAddress() });
  vite = await createVite({ root: process.cwd() + "/app", configFile: process.cwd() + "/app/vite.config.e2e.ts", envDir: false,
    logLevel: "error", server: { host: "127.0.0.1", port: await port(), strictPort: true } });
  await vite.listen(); const url = vite.resolvedUrls.local[0];
  const preload = `window.__E2E_RPC__=${JSON.stringify(rpc)}; window.__E2E_BATCH_WALLET__=${JSON.stringify(await batchWallet.getAddress())}; (${publicFixtures.toString()})();window.__E2E_WLD__=${JSON.stringify(await wld.getAddress())};window.__E2E_USDC_STRATEGY__=${JSON.stringify(await usdcStrategy.getAddress())};window.__E2E_FACTORIES__=${JSON.stringify([await plain.getAddress(),await wldFactory.getAddress(),await usdcFactory.getAddress()])};window.__E2E_USERNAMES__=${JSON.stringify({[ACCOUNTS.a0.a.toLowerCase()]:"davis",[ACCOUNTS.a1.a.toLowerCase()]:"alex"})};`;
  const open = async (account, vault = "") => {
    await page?.close(); page = await launch({ pk: account.pk, url: url + (vault ? "?vault=" + vault : ""), preload });
    await page.ev(HELPERS); await enableAtomicBatch(); await click("Continue with World App");
  };
  await open(ACCOUNTS.a0);
  await until(() => page.ev("return __q.tabs().includes('Plan')")); await page.ev("return __q.tab('Plan')");
  await until(() => page.ev("return !!(document.getElementById('yield-consent') && document.querySelector('.plan-assets'))"));
  const planRows = JSON.parse(await page.ev(`
    const wld = document.getElementById('plan-wld');
    const usdc = document.getElementById('plan-usdc-amount') || document.getElementById('plan-usdc');
    return JSON.stringify({ wldRow: wld?.closest('.plan-asset-row')?.innerText || '',
      usdcRow: usdc?.closest('.plan-asset-row')?.innerText || '', radios: [...document.querySelectorAll('.plan-setup-card input[type="radio"]')].length,
      obsoleteAssetMode: document.querySelector('input[value="yield"], input[value="plain"]') !== null });
  `));
  assert.match(planRows.wldRow, /WLD[\s\S]*Yield/);
  assert.match(planRows.usdcRow, /USDC[\s\S]*Yield/);
  assert.equal(planRows.radios, 0);
  assert.equal(planRows.obsoleteAssetMode, false);
  await until(() => page.ev("return /Available: 200\.123456 USDC/.test(document.body.innerText)"));
  assert.equal(await page.ev("return document.getElementById('yield-consent').checked"), false);
  assert.equal(await page.ev("return document.querySelector('.plan-submit').disabled"), true);
  pass("Unified inheritance entry exposes separate WLD and six-decimal USDC amounts on their configured Morpho routes");
  await page.shot("usdc-create");
  await page.ev(`return __q.setInput('heir-input', '${ACCOUNTS.a1.a}')`);
  await page.ev("return __q.setInput('period-input', '30')");
  await setPlanAmount("USDC", "1");
  await until(() => page.ev("return document.querySelector('.resolved-heir') !== null"));
  await until(() => page.ev("return /Available: 200\.123456 USDC/.test(document.body.innerText)"));
  assert.equal(await page.ev("return document.querySelector('.plan-submit').disabled"), true);
  assert.equal(await usdcFactory.vaultOf(ACCOUNTS.a0.a), "0x0000000000000000000000000000000000000000");
  assert.equal(await plainVaultContract.heir(), originalPlainHeir);
  assert.equal(await plainVaultContract.heartbeatInterval(), originalPlainInterval);
  assert.equal(await existingWldVault.heir(), existingWldHeir);
  assert.equal(await existingWldVault.heartbeatInterval(), existingWldInterval);
  assert.equal(await wldStrategy.balanceOf(wldVault), existingWldShares);
  pass("A six-decimal USDC plan amount is editable while consent is required and existing WLD positions remain intact");
  await page.ev("document.getElementById('yield-consent').click(); return true;");
  await until(() => page.ev("return !document.querySelector('.plan-submit').disabled"));
  assert.equal(await page.ev("return window.__E2E_MINIKIT__.lastCalldata().length"), 0);
  await clickPlanSubmit();
  await until(() => page.ev("return document.querySelector('.plan-alignment-review') !== null"), "shared WLD settings review");
  assert.match(await page.ev("return document.querySelector('.plan-alignment-review').innerText"), /WLD[\s\S]*Confirm and align settings/);
  assert.equal(await plainVaultContract.heir(), originalPlainHeir);
  assert.equal(await plainVaultContract.heartbeatInterval(), originalPlainInterval);
  assert.equal(await wld.balanceOf(plainVault), originalPlainBalance);
  assert.equal(await existingWldVault.heir(), existingWldHeir);
  assert.equal(await existingWldVault.heartbeatInterval(), existingWldInterval);
  assert.equal(await wldStrategy.balanceOf(wldVault), existingWldShares);
  assert.equal(await usdcFactory.vaultOf(ACCOUNTS.a0.a), "0x0000000000000000000000000000000000000000");
  assert.equal(await page.ev("return window.__E2E_MINIKIT__.lastCalldata().length"), 0);
  pass("Existing basic and Morpho WLD settings and balances stay unchanged until explicit shared-settings review confirmation");
  await click("Confirm and align settings");
  await until(async () => await usdcFactory.vaultOf(ACCOUNTS.a0.a) !== "0x0000000000000000000000000000000000000000");
  const vault = await usdcFactory.vaultOf(ACCOUNTS.a0.a), child = new Contract(vault, artifact("InheritanceVaultUSDC").abi, provider);
  await until(async () => await child.costBasis() === 1_000000n);
  await until(() => page.ev("return /Your inheritance plan is ready/.test(document.body.innerText)"));
  assert.equal(await plain.vaultOf(ACCOUNTS.a0.a), plainVault); assert.equal(await wldFactory.vaultOf(ACCOUNTS.a0.a), wldVault);
  assert.equal(await plainVaultContract.heir(), ACCOUNTS.a1.a);
  assert.equal(await plainVaultContract.heartbeatInterval(), 30n * 86400n);
  assert.equal(await wld.balanceOf(plainVault), originalPlainBalance);
  assert.equal(await existingWldVault.heir(), existingWldHeir);
  assert.equal(await existingWldVault.heartbeatInterval(), existingWldInterval);
  assert.equal(await wldStrategy.balanceOf(wldVault), existingWldShares);
  assert.equal(await usdc.balanceOf(ACCOUNTS.a0.a), 199_123456n);
  const plannedDeposit = await page.ev("return window.__E2E_MINIKIT__.lastCalldata()");
  assert.equal(plannedDeposit[0].to.toLowerCase(), (await usdc.getAddress()).toLowerCase());
  assert.equal(plannedDeposit[1].to.toLowerCase(), (await usdcFactory.getAddress()).toLowerCase());
  assert.equal(usdcFactory.interface.parseTransaction({ data: plannedDeposit[1].data }).args[0], 1_000000n);
  pass("After explicit review the USDC vault receives the entered amount while both existing WLD positions and balances remain intact");
  await page.ev("return __q.tab('Assets')"); await page.waitFor("#deposit-amount");
  await page.ev("return __q.reveal('.yield-rate-summary')");
  await until(() => page.ev("return /Available: 199.123456 USDC/.test(document.body.innerText)"));
  await until(() => page.ev("return /1.79%/.test(document.body.innerText) && /5.68%/.test(document.body.innerText)"));
  await until(() => page.ev("__q.reveal('.yield-rate-summary'); return /Loss recovery is not charged/.test(document.body.innerText) && /USDC gains and losses are accounted in USDC/.test(document.body.innerText)"), "complete USDC position and fee disclosure");
  const usdcFeeCopy = await page.ev("return document.body.innerText");
  assert.match(usdcFeeCopy, /Loss recovery is not charged/);
  assert.match(usdcFeeCopy, /USDC gains and losses are accounted in USDC, without cross-currency offsets/);
  await until(() => page.ev(`return window.__E2E_USDC_REGISTERED__[${JSON.stringify(vault.toLowerCase())}] === true`));
  await sleep(800);
  assert.match(await page.ev("return document.body.innerText"), /Available: 199.123456 USDC/);
  await click("Max");
  assert.equal(await page.ev("return document.getElementById('deposit-amount').value"), "199.123456");
  await page.ev("return __q.tab('Plan')");
  await until(() => page.ev("return /^(29|30)d/.test(document.querySelector('.timer-value')?.textContent.trim() ?? '')"));
  await sleep(500);
  assert.match(await page.ev("return document.querySelector('.timer-value').textContent.trim()"), /^(29|30)d/);
  assert.equal(await child.heartbeatInterval(), 30n * 86400n);
  await page.ev("return __q.tab('Assets')");
  pass("A delayed creation-monitoring response cannot overwrite USDC balance, Max or countdown with the prior WLD vault");
  const beforeInvalidAmount = JSON.stringify(await page.ev("return window.__E2E_MINIKIT__.lastCalldata()"));
  await page.ev("return __q.setInput('deposit-amount', '100.1234567')");
  assert.equal(await page.ev("return __q.btns().some(button => button.t === 'Deposit' && button.d)"), true);
  assert.match(await page.ev("return document.body.innerText"), /Enter a valid USDC amount with up to 6 decimal places/);
  assert.equal(JSON.stringify(await page.ev("return window.__E2E_MINIKIT__.lastCalldata()")), beforeInvalidAmount);
  assert.equal(await usdcStrategy.balanceOf(vault), 1_000000n * 10n ** 12n);
  pass("More than six USDC decimal places are rejected instead of being silently rounded");
  await page.ev("return __q.setInput('deposit-amount', '99.123456')"); await click("Deposit");
  await until(async () => await child.costBasis() === 100_123456n); await until(() => page.ev("return /Deposit complete/.test(document.body.innerText)"));
  const calldata = await page.ev("return window.__E2E_MINIKIT__.lastCalldata()");
  assert.equal(calldata[0].to.toLowerCase(), (await usdc.getAddress()).toLowerCase());
  assert.equal(calldata[1].to.toLowerCase(), (await usdcFactory.getAddress()).toLowerCase());
  assert.equal(await usdcStrategy.balanceOf(vault), 100_123456n * 10n ** 12n);
  pass("USDC approval and deposit use the correct token/factory and 6-to-18 receipt units");
  await selectVault("WLD · Basic vault"); await until(() => page.ev("return /Amount to deposit \\(WLD\\)/.test(document.body.innerText) && /Available: 100.0 WLD/.test(document.body.innerText)"));
  await selectVault("USDC · Morpho yield"); await until(() => page.ev("return /Amount to deposit \\(USDC\\)/.test(document.body.innerText) && /Available: 100.0 USDC/.test(document.body.innerText)"));
  pass("Switching vaults never reuses WLD precision, balance or transaction routing for USDC");
  const publish = async (cumulative, claimed = 0n) => {
    const abi = AbiCoder.defaultAbiCoder(), sibling = keccak256(new TextEncoder().encode("USDC local reward fixture"));
    const leaf = keccak256(abi.encode(["address", "address", "uint256"], [vault, await wld.getAddress(), cumulative]));
    await (await distributor.setRoot(keccak256(abi.encode(["bytes32", "bytes32"], [leaf, sibling].sort())))).wait();
    const data = [{ chain: { id: 480 }, rewards: [{ token: { address: await wld.getAddress(), decimals: 18 }, amount: cumulative.toString(), claimed: claimed.toString(), pending: "0", proofs: [sibling] }] }];
    await page.ev(`window.__E2E_REWARDS__[${JSON.stringify(vault.toLowerCase())}]=${JSON.stringify(data)};return true;`); return sibling;
  };
  const externalReward = async cumulative => {
    const proof = await publish(cumulative, await child.totalRewardsClaimed()); await (await distributor.setOperator(ACCOUNTS.a0.a, true)).wait();
    await (await distributor.claim([vault], [await wld.getAddress()], [cumulative], [[proof]])).wait();
  };
  const originalPing = await child.lastPing(), originalShares = await usdcStrategy.balanceOf(vault);
  await publish(parseEther("10")); await click("Refresh rewards"); await click("Claim WLD rewards to vault");
  await until(async () => await child.totalRewardsClaimed() === parseEther("10"));
  await until(() => page.ev("return /WLD rewards claimed and held/.test(document.body.innerText)"));
  assert.equal(await wld.balanceOf(vault), parseEther("10")); assert.equal(await usdcStrategy.balanceOf(vault), originalShares);
  assert.equal(await child.costBasis(), 100_123456n); assert.equal(await child.lastPing(), originalPing);
  assert.equal(await wld.balanceOf(ACCOUNTS.a2.a), 0n);
  pass("Claimed WLD is held without USDC conversion, premature fees, principal inflation or timer renewal");
  await (await wld.mint(vault, parseEther("5"))).wait(); await click("Refresh rewards"); await page.shot("usdc-rewards-held");
  const wldOwnerBefore = await wld.balanceOf(ACCOUNTS.a0.a); await click("Withdraw held WLD to my wallet");
  await until(async () => await wld.balanceOf(vault) === 0n);
  assert.equal(await wld.balanceOf(ACCOUNTS.a0.a) - wldOwnerBefore, parseEther("14"));
  assert.equal(await wld.balanceOf(ACCOUNTS.a2.a), parseEther("1")); assert.equal(await usdcStrategy.balanceOf(vault), originalShares);
  pass("WLD withdrawal charges 10% only on canonical rewards, excludes gifts and preserves USDC shares");
  await (await usdcStrategy.setRate(1_100000n)).wait(); await (await usdc.mint(await usdcStrategy.getAddress(), 100_000000n)).wait();
  await click("Refresh balance"); await until(() => page.ev("return /109.134567 USDC/.test(document.body.innerText)"));
  const fee = (await child.position()).fee; assert.ok(fee > 0n); await page.shot("usdc-position");
  const storeScreen = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync("/tmp/wld-verify/shots/usdc-store-position.png", Buffer.from(storeScreen.data, "base64"));
  await click("Move all receipt shares to my wallet"); await until(async () => await usdcStrategy.balanceOf(vault) === 0n);
  const chargedShares = await usdcStrategy.balanceOf(ACCOUNTS.a2.a); assert.ok(chargedShares > 0n);
  await click("Redeem available shares to USDC"); await until(async () => await usdcStrategy.balanceOf(ACCOUNTS.a0.a) === 0n);
  assert.equal(await usdcStrategy.balanceOf(ACCOUNTS.a2.a), chargedShares);
  assert.equal(await usdc.balanceOf(ACCOUNTS.a2.a), 0n); assert.equal(await wld.balanceOf(ACCOUNTS.a2.a), parseEther("1"));
  pass("USDC receipt exit charges its gain fee in shares and later wallet redemption charges no second fee");
  await (await usdcStrategy.setRate(1_000000n)).wait();
  await page.ev("return __q.setInput('deposit-amount', '20')"); await click("Deposit");
  await until(async () => await child.costBasis() === 20_000000n); await externalReward(parseEther("20"));
  await (await usdcStrategy.setLiquidity(0)).wait(); await provider.send("evm_increaseTime", [30 * 86400 + 1]); await provider.send("evm_mine", []);
  await open(ACCOUNTS.a1, vault); await until(() => page.ev("return __q.tabs().includes('Plan')")); await page.ev("return __q.tab('Plan')");
  await click("File claim"); await until(async () => await child.claimFiledAt() > 0n);
  await provider.send("evm_increaseTime", [7 * 86400 + 1]); await provider.send("evm_mine", []);
  await open(ACCOUNTS.a1, vault); await until(() => page.ev("return __q.tabs().includes('Plan')")); await page.ev("return __q.tab('Plan')");
  await page.ev("window.__E2E_REWARDS_DOWN__=true;return true;"); await click("Refresh rewards");
  await click("Complete inheritance"); await until(async () => await child.claimedAt() > 0n);
  assert.equal(await usdcStrategy.balanceOf(ACCOUNTS.a1.a), parseEther("20"));
  assert.equal(await wld.balanceOf(ACCOUNTS.a1.a), parseEther("9")); assert.equal(await child.inheritanceRecipient(), ACCOUNTS.a1.a);
  assert.equal(await child.hasAssets(), false); await page.shot("usdc-inheritance");
  pass("Illiquid USDC inheritance transfers receipt shares and WLD rewards to the same fixed heir despite reward API failure");
  await (await usdcStrategy.setLiquidity(2n ** 256n - 1n)).wait(); await click("Redeem available shares to USDC");
  await until(async () => await usdcStrategy.balanceOf(ACCOUNTS.a1.a) === 0n);
  assert.equal(await usdc.balanceOf(ACCOUNTS.a1.a), 20_000000n);
  assert.equal(await wld.balanceOf(ACCOUNTS.a1.a), parseEther("9")); assert.equal(await usdcStrategy.balanceOf(ACCOUNTS.a2.a), chargedShares);
  pass("The heir redeems eighteen-decimal receipt shares to six-decimal USDC without a second service fee");
  await (await usdcFactory.releaseMyVault()).wait(); await (await usdcFactory.createVault(ACCOUNTS.a3.a, 30 * 86400)).wait();
  const replacement = await usdcFactory.vaultOf(ACCOUNTS.a0.a), replacementChild = new Contract(replacement, artifact("InheritanceVaultUSDC").abi, provider);
  const replacementPing = await replacementChild.lastPing(); await publish(parseEther("30"), parseEther("20"));
  await page.ev("window.__E2E_REWARDS_DOWN__=false;return true;"); await click("Refresh rewards"); await click("Claim remaining inheritance rewards");
  await until(async () => await wld.balanceOf(ACCOUNTS.a1.a) === parseEther("18"));
  assert.equal(await wld.balanceOf(replacement), 0n); assert.equal(await replacementChild.lastPing(), replacementPing);
  pass("Late WLD rewards of a released USDC vault still pay its original fixed heir and leave the replacement untouched");
  await externalReward(parseEther("40")); await (await wld.mint(vault, parseEther("5"))).wait();
  const recoveryOwner = await wld.balanceOf(ACCOUNTS.a0.a); await open(ACCOUNTS.a0, vault);
  await click("Recover archived assets to me"); await until(async () => await wld.balanceOf(vault) === 0n);
  assert.equal(await wld.balanceOf(ACCOUNTS.a0.a) - recoveryOwner, parseEther("5"));
  assert.equal(await wld.balanceOf(ACCOUNTS.a1.a), parseEther("27")); assert.equal(await usdcFactory.vaultOf(ACCOUNTS.a0.a), replacement);
  assert.equal(await replacementChild.lastPing(), replacementPing);
  pass("Archived owner recovery separates WLD gifts from canonical heir rewards and cannot alter the current USDC vault");
  assert.deepEqual(await page.ev("return __q.errs()"), []); pass("No runtime errors or unhandled rejections in the USDC flow");
  console.log(`${passed} USDC browser checks passed; all transactions used local Anvil.`);
} catch (error) {
  if (page) { console.error(await page.ev("return {buttons:__q.btns(),errors:__q.errs(),bridgeError:window.__E2E_MINIKIT__?.lastError(),text:document.body.innerText.slice(-3000)}")); await page.shot("usdc-failure"); }
  throw error;
} finally { await page?.close(); await vite?.close(); provider?.destroy(); anvil.kill("SIGTERM"); }
