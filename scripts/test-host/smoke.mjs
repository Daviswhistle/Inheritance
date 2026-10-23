// Real MiniKit SDK -> both host transports -> disposable Anvil -> app UI.
// Browser transport coverage is not a native Android/WKWebView device test.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { launch, HELPERS } from '../verify/drv.mjs';

const require = createRequire(new URL('../../app/package.json', import.meta.url));
const { Contract, JsonRpcProvider, parseEther } = require('ethers');
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const origin = `http://localhost:${port}`;
const server = spawn(process.execPath, [new URL('./start.mjs', import.meta.url).pathname, `--port=${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', data => { output += data; });
server.stderr.on('data', data => { output += data; });
const pages = [];
let provider;
let checks = 0;
const pass = message => { checks++; console.log(`PASS ${message}`); };
async function until(work, label, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (server.exitCode !== null) throw new Error(`Host exited: ${output}`);
    if (await work()) return;
    await sleep(150);
  }
  throw new Error(`Timed out: ${label}`);
}
const artifact = name => JSON.parse(readFileSync(new URL(`../../out/${name}.sol/${name}.json`, import.meta.url)));
async function click(page, label) {
  await until(() => page.ev(`__q.revealButton(${JSON.stringify(label)}); return __q.btns().some(b => b.t === ${JSON.stringify(label)} && !b.d)`), label);
  assert.match(await page.ev(`return __q.click(${JSON.stringify(label)})`), /^clicked/);
}
async function command(page, calls) {
  return page.ev(`const {sendWorldChainTx} = await import('/src/minikit.ts'); return await sendWorldChainTx(${JSON.stringify(calls)});`);
}
async function receipt(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.tx.executedWith, 'minikit');
  assert.equal(result.tx.hashType, 'user-operation');
  const mapped = await (await fetch(`${origin}/__host/userop/${result.tx.hash}`)).json();
  assert.notEqual(mapped.transaction_hash, result.tx.hash, 'operation hash must not masquerade as a transaction hash');
  return provider.getTransactionReceipt(mapped.transaction_hash);
}
async function control(body) {
  const result = await fetch(`${origin}/__host/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(result.status, 200, await result.clone().text());
  return result.json();
}
try {
  await until(async () => { try { return (await fetch(`${origin}/__host/config`)).ok; } catch { return false; } }, 'host startup', 90000);
  const config = await (await fetch(`${origin}/__host/config`)).json();
  assert.equal(config.testOnly, true);
  provider = new JsonRpcProvider(`${origin}/__host/rpc`, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  const factory = new Contract(config.wldFactory, artifact('InheritanceVaultMorphoFactory').abi, provider);
  const usdcFactory = new Contract(config.usdcFactory, artifact('InheritanceVaultUSDCFactory').abi, provider);
  const token = new Contract(config.wld, artifact('MockERC20').abi, provider);
  const open = async (platform, account = 'owner', extra = '', approval = 'auto') => {
    const page = await launch({ url: `${origin}/?platform=${platform}&account=${account}&approval=${approval}${extra}`,
      preload: `localStorage.setItem('inheritance:locale', 'en');` });
    pages.push(page);
    await page.ev(HELPERS);
    await until(() => page.ev('return !!window.__INHERITANCE_TEST_HOST__ && !!document.querySelector(".tab-item")'), `${platform} bootstrap`);
    assert.equal(await page.ev('return window.__INHERITANCE_TEST_HOST__.platform'), platform);
    // Verify Vite did not alias away the installed SDK.
    assert.equal(await page.ev(`const {MiniKit,getWorldAppProvider}=await (await import('/src/minikit.ts')).loadMiniKit(); return MiniKit.isInstalled() && typeof getWorldAppProvider === 'function' && typeof MiniKit.trigger === 'function';`), true);
    return page;
  };
  const owner = await open('android');
  await click(owner, 'Continue with World App');
  await until(() => owner.ev('return !!document.querySelector(".account-row")'), 'real SIWE login');
  pass('Android transport: installed SDK, signed login and real Pages nonce verification');
  assert.equal(await owner.ev(`
    const payload = window.__INHERITANCE_TEST_HOST__.history.find(row => row.command === 'wallet-auth').response;
    const nonce = payload.message.match(/^Nonce: (.+)$/m)[1];
    return (await fetch('/api/auth/verify', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload,nonce})})).status;
  `), 401);
  pass('Reusing a signed login fails the actual backend nonce check');

  await until(() => owner.ev('return !!document.getElementById("heir-input") || __q.btns().some(b => b.t === "Create plan" && !b.d)'), 'initial plan loading');
  if (!await owner.ev('return !!document.getElementById("heir-input")')) await click(owner, 'Create plan');
  await until(() => owner.ev('return !!document.getElementById("heir-input")'), 'plan form');
  await owner.ev(`await __q.setInput('heir-input', ${JSON.stringify(config.heir)}); await __q.setInput('period-input','30'); await __q.setInput('plan-wld','10'); await __q.setInput('plan-usdc','12.345678'); return true;`);
  await click(owner, 'Review plan');
  assert.equal(await owner.ev('return document.getElementById("yield-consent").checked'), false);
  assert.equal(await owner.ev('return document.querySelector(".plan-submit").disabled'), true);
  await owner.ev('document.getElementById("yield-consent").click(); return true;');
  await click(owner, 'Confirm and deposit');
  await until(() => owner.ev('return document.body.innerText.includes("Your inheritance plan is ready")'), 'both-asset plan confirmation', 60000);
  const wldVault = new Contract(await factory.vaultOf(config.owner), artifact('InheritanceVaultMorpho').abi, provider);
  const usdcVault = new Contract(await usdcFactory.vaultOf(config.owner), artifact('InheritanceVaultUSDC').abi, provider);
  assert.equal(await wldVault.costBasis(), parseEther('10'));
  assert.equal(await usdcVault.costBasis(), 12_345678n);
  assert.equal(await wldVault.heir(), config.heir);
  assert.equal(await usdcVault.heir(), config.heir);
  pass('Actual app review and consent create both WLD and six-decimal USDC plans; user-operation receipts resolve');
  await until(() => owner.ev('return !document.body.innerText.includes("Status unavailable") && !document.body.innerText.includes("Value unavailable")'), 'both-asset balances');

  const ping = [{ address: config.wldFactory, abi: ['function pingMyVault()'], functionName: 'pingMyVault' }];
  const before = await wldVault.lastPing();
  await owner.ev("window.__INHERITANCE_TEST_HOST__.rejectNext('send-transaction'); return true;");
  assert.equal((await command(owner, ping)).ok, false);
  assert.equal(await wldVault.lastPing(), before);
  pass('SDK rejection leaves chain state unchanged');
  await owner.ev("window.__INHERITANCE_TEST_HOST__.delayNext(700, 'send-transaction'); return true;");
  const started = Date.now();
  assert.equal((await receipt(await command(owner, ping))).status, 1);
  assert.ok(Date.now() - started >= 650);
  pass('Delayed native response reaches SDK and real chain confirmation');

  const balanceBefore = await token.balanceOf(config.owner);
  const allowanceBefore = await token.allowance(config.owner, config.wldFactory);
  const reverted = await command(owner, [
    { address: config.wld, abi: ['function approve(address,uint256)'], functionName: 'approve', args: [config.wldFactory, parseEther('1').toString()] },
    { address: config.wldFactory, abi: ['function depositWithMinShares(uint256,uint256)'], functionName: 'depositWithMinShares', args: [parseEther('1000').toString(), '0'] },
  ]);
  assert.equal((await receipt(reverted)).status, 0);
  assert.equal(await token.balanceOf(config.owner), balanceBefore);
  assert.equal(await token.allowance(config.owner, config.wldFactory), allowanceBefore);
  pass('Failing second call rolls back the entire batch, including token approval');

  const ios = await open('ios', 'owner', '', 'manual');
  await click(ios, 'Continue with World App');
  await until(() => ios.ev('return window.__INHERITANCE_TEST_HOST__.pending.some(row => row.command === "wallet-auth")'), 'manual sign-in approval');
  assert.equal(await ios.ev('return document.querySelector("#inheritance-test-controls").shadowRoot.querySelector("dialog").open'), true);
  await ios.shot('test-host-ios-approval');
  await ios.ev('document.querySelector("#inheritance-test-controls").shadowRoot.querySelector("#pending button").click(); return true;');
  await until(() => ios.ev('return !!document.querySelector(".account-row")'), 'iOS SIWE login');
  await ios.ev('window.__INHERITANCE_TEST_HOST__.setApproval("auto"); return true;');
  assert.equal((await receipt(await command(ios, ping))).status, 1);
  pass('iOS transport: visible manual approval, real SDK login and transaction path');

  const assetsBefore = await wldVault.totalAssets();
  const basisBefore = await wldVault.costBasis();
  await control({ action: 'yield' });
  assert.ok(await wldVault.totalAssets() > assetsBefore);
  assert.equal((await receipt(await command(ios, [{ address: config.wldFactory,
    abi: ['function withdrawIncomeFromMyVault(address,uint256)'], functionName: 'withdrawIncomeFromMyVault', args: [config.owner, '0'] }]))).status, 1);
  assert.equal(await wldVault.costBasis(), basisBefore);
  pass('Mock yield grows assets; SDK income withdrawal preserves principal accounting');

  await control({ action: 'time', days: 31 });
  const heir = await open('ios', 'heir', `&vault=${await wldVault.getAddress()}`);
  await click(heir, 'Continue with World App');
  await until(() => heir.ev('return !!document.querySelector(".account-row")'), 'heir login');
  const claim = [
    { address: config.wldFactory, abi: ['function fileClaimFor(address)'], functionName: 'fileClaimFor', args: [await wldVault.getAddress()] },
    { address: config.usdcFactory, abi: ['function fileClaimFor(address)'], functionName: 'fileClaimFor', args: [await usdcVault.getAddress()] },
  ];
  assert.equal((await receipt(await command(heir, claim))).status, 1);
  assert.ok(await wldVault.claimFiledAt() > 0n);
  assert.ok(await usdcVault.claimFiledAt() > 0n);
  await control({ action: 'time', days: 7 });
  assert.equal((await receipt(await command(heir, claim.map(call => ({ ...call, abi: ['function finalizeClaimFor(address)'], functionName: 'finalizeClaimFor' }))))).status, 1);
  assert.equal(await wldVault.isSettled(), true);
  assert.equal(await usdcVault.isSettled(), true);
  pass('Heir role, deadline travel, claims and seven-day settlement execute for both assets');

  const prohibited = await fetch(`${origin}/__host/rpc`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'anvil_reset', params: [] }) });
  assert.equal(prohibited.status, 403);
  const crossOrigin = await fetch(`${origin}/__host/control`, { method: 'POST', headers: { Origin: 'https://unrelated.example' }, body: JSON.stringify({ action: 'time', days: 31 }) });
  assert.equal(crossOrigin.status, 403);
  pass('Public RPC proxy rejects chain mutation; cross-origin controls are rejected');
  for (const page of pages) assert.deepEqual(page.logs.filter(line => line.startsWith('[EXC]')), []);
  console.log(`\n${checks} test-host integration checks passed. Native device execution remains separate.`);
} catch (error) {
  for (const page of pages) {
    console.error(await page.ev('return document.body.innerText').catch(() => 'Page unavailable'));
    console.error(page.logs.slice(-15));
  }
  console.error(output.slice(-5000));
  throw error;
} finally {
  await Promise.all(pages.map(page => page.close()));
  provider?.destroy();
  server.kill('SIGTERM');
  await Promise.race([new Promise(resolve => server.once('exit', resolve)), sleep(5000)]);
}
