// Real MiniKit SDK, real IndexedDB in two windows, disposable local chain only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { Contract, JsonRpcProvider, Interface, id } = createRequire(new URL('../../app/package.json', import.meta.url))('ethers');
const out = process.env.MONEY_SAFETY_OUT || '/tmp/inheritance-money-safety';
mkdirSync(out, { recursive: true });
const socket = createServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r));
const port = socket.address().port; await new Promise(r => socket.close(r));
const origin = `http://localhost:${port}`;
const host = spawn(process.execPath, [new URL('../test-host/start.mjs', import.meta.url).pathname, '--skip-build', `--port=${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
let log = '', browser, provider;
host.stdout.on('data', d => log += d); host.stderr.on('data', d => log += d);
const evidence = { environment: 'Real MiniKit SDK, Chromium and IndexedDB, private Anvil with mock tokens; no external funds', checks: [] };
async function until(fn, label) { for (let i = 0; i < 600; i++) { if (await fn()) return; await sleep(100); } throw Error('Timeout: ' + label); }
function pass(name, details = {}) { evidence.checks.push({ name, ...details }); console.log('PASS', name); }
try {
  await until(async () => { if (host.exitCode !== null) throw Error(log); try { return (await fetch(origin + '/__host/config')).ok; } catch { return false; } }, 'host');
  const c = await (await fetch(origin + '/__host/config')).json();
  const fixture = JSON.parse(readFileSync(log.match(/Fixture: (.+)/)[1], 'utf8'));
  provider = new JsonRpcProvider(fixture.rpc, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  const signer = await provider.getSigner(0);
  const routes = {};
  for (const [symbol, factory, asset, strategy, unit] of [['USDC', c.usdcFactory, c.usdc, c.usdcStrategy, 10n ** 6n], ['WLD', c.wldFactory, c.wld, c.wldStrategy, 10n ** 18n]]) {
    const f = new Contract(factory, ['function createVault(address,uint256) returns(address)', 'function vaultOf(address) view returns(address)', 'function depositWithMinShares(uint256,uint256)', 'function withdrawFromMyVault(address,uint256)'], signer);
    const token = new Contract(asset, ['function approve(address,uint256)', 'function balanceOf(address) view returns(uint256)'], signer);
    const s = new Contract(strategy, ['function fee() view returns(uint256)', 'function setFee(uint256)', 'function balanceOf(address) view returns(uint256)'], signer);
    await (await f.createVault(c.heir, 30 * 86400)).wait(); await (await token.approve(factory, 10n * unit)).wait();
    const initial = await (await f.depositWithMinShares(10n * unit, 1n)).wait();
    routes[symbol] = { f, token, strategy: s, factory, asset, unit, vault: await f.vaultOf(c.owner), initial: initial.hash };
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => localStorage.setItem('inheritance:locale', 'en'));
  const page = await context.newPage();
  await page.goto(origin + '/?approval=auto&residence=KR');

  // Use the shipped modules and actual browser database, not an in-memory CAS mock.
  const second = await context.newPage(); await second.goto(origin + '/?approval=auto&residence=KR');
  const base = { version: 1, requestId: '11111111-1111-4111-8111-111111111111', chainId: 480, account: '0x' + '1'.repeat(40), factory: c.usdcFactory, vault: routes.USDC.vault, asset: c.usdc, symbol: 'USDC', decimals: 6, recipient: c.heir, mode: 'morpho', kind: 'partial', amount: '1000000', minNetAssets: '0', beforeBlock: 0 };
  async function attempt(tab, request, module) {
    return tab.evaluate(async ({ request, module }) => {
      const m = await import(`/src/${module}.ts`);
      const withdrawal = module === 'withdrawal';
      const read = withdrawal ? m.readOwnerWithdrawal : m.readAdditionalDeposit;
      const save = withdrawal ? m.saveOwnerWithdrawal : m.saveAdditionalDeposit;
      const clear = withdrawal ? m.clearOwnerWithdrawal : m.clearAdditionalDeposit;
      const submit = withdrawal ? m.submitOwnerWithdrawal : m.submitAdditionalDeposit;
      let sends = 0, error = '';
      try { await submit(request, { read: () => read(request.account), save, clear, send: async () => { sends++; return { ok: true, tx: {} }; }, confirm: async () => { throw Error('response lost'); } }); }
      catch (e) { error = e.message; }
      return { sends, error, saved: await read(request.account) };
    }, { request, module });
  }
  for (const module of ['withdrawal', 'additional-deposit']) {
    const results = await Promise.all([attempt(page, base, module), attempt(second, { ...base, requestId: '22222222-2222-4222-8222-222222222222', amount: '2000000' }, module)]);
    assert.equal(results.reduce((n, r) => n + r.sends, 0), 1);
    assert.ok(results.every(r => r.saved));
    const independent = await attempt(second, { ...base, account: '0x' + '2'.repeat(40) }, module);
    assert.equal(independent.sends, 1);
    pass(`${module}: two windows permit exactly one same-account send; another account remains independent`);
  }
  const stale = await page.evaluate(async base => {
    const m = await import('/src/withdrawal.ts');
    const old = await m.readOwnerWithdrawal(base.account);
    await m.clearOwnerWithdrawal(old);
    const next = { ...base, requestId: '33333333-3333-4333-8333-333333333333' };
    await m.saveOwnerWithdrawal(next, null);
    const results = await Promise.allSettled([m.clearOwnerWithdrawal(old), m.saveOwnerWithdrawal({ ...old, txHash: '0x' + 'a'.repeat(64), hashType: 'transaction' }, old)]);
    return { rejected: results.every(r => r.status === 'rejected'), saved: await m.readOwnerWithdrawal(base.account) };
  }, base);
  assert.equal(stale.rejected, true); assert.equal(stale.saved.requestId, '33333333-3333-4333-8333-333333333333');
  pass('late confirmation/update cannot clear or replace a newer withdrawal');

  const lock = await page.evaluate(async () => {
    const { withWalletActionLock } = await import('/src/wallet-action-lock.ts');
    let release, started = false, queued = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const held = withWalletActionLock('test-scope', async () => { started = true; await gate; });
    while (!started) await new Promise(resolve => setTimeout(resolve, 1));
    let rejected = false;
    try { await withWalletActionLock('TEST-SCOPE', async () => { queued++; }); } catch { rejected = true; }
    release(); await held; await new Promise(resolve => setTimeout(resolve, 20));
    return { rejected, queued, fallback: await withWalletActionLock('test-scope', async () => 'CAS remains required', null) };
  });
  assert.deepEqual(lock, { rejected: true, queued: 0, fallback: 'CAS remains required' });
  pass('concurrent wallet actions reject immediately without queued automatic approvals');
  await second.close();

  let sends = 0, dropNext = false, lostHash = '', feeReads = 0;
  const feeSelector = id('fee()').slice(0, 10);
  page.on('request', request => {
    if (!request.url().endsWith('/__host/rpc')) return;
    let payload; try { payload = request.postDataJSON(); } catch { return; }
    for (const rpc of Array.isArray(payload) ? payload : [payload]) if (rpc?.method === 'eth_call' && rpc.params?.[0]?.data === feeSelector && rpc.params[0].to?.toLowerCase() === c.usdcStrategy.toLowerCase()) feeReads++;
  });
  await page.route('**/__host/command', async route => {
    const body = route.request().postDataJSON(), response = await route.fetch();
    if (body.envelope?.command === 'send-transaction') {
      sends++;
      if (dropNext) {
        dropNext = false;
        const result = await response.json();
        lostHash = (await (await fetch(origin + '/__host/userop/' + result.userOpHash)).json()).transaction_hash;
        delete result.userOpHash; await route.fulfill({ response, json: result }); return;
      }
    }
    await route.fulfill({ response });
  });
  async function signIn(role = 'owner') {
    await page.goto(origin + `/?account=${role}&approval=auto&residence=KR`);
    await until(async () => await page.getByRole('button', { name: 'Agree and sign in', exact: true }).count() > 0 || await page.locator('.account-row').count() > 0, 'sign-in entry');
    if (await page.getByRole('button', { name: 'Agree and sign in', exact: true }).count()) await page.getByRole('button', { name: 'Agree and sign in', exact: true }).click();
    await page.locator('.account-row').waitFor();
    await page.locator('#inheritance-test-controls').evaluate(e => e.style.display = 'none');
  }
  async function asset(symbol) {
    await page.locator('.tab-item').nth(1).click();
    const select = page.getByRole('button', { name: symbol, exact: true }); if (await select.count()) await select.click();
    await page.locator('.principal-controls').waitFor();
  }
  async function amountInput(symbol, amount = '1') {
    await asset(symbol);
    if (!await page.locator('#withdraw-amount').isVisible()) await page.locator('.principal-controls > summary').click();
    if (!await page.locator('#withdraw-to').isVisible()) await page.locator('.withdraw-destination-details > summary').click();
    await page.locator('#withdraw-to').fill(c.heir); await page.locator('#withdraw-amount').fill(amount);
    await until(() => page.locator('.principal-submit').isEnabled(), symbol + ' withdrawal enabled');
  }
  await signIn(); await asset('USDC');
  await page.locator('.deposit-controls > summary').click(); await page.locator('#deposit-amount').fill('1');
  const feeReadsBefore = feeReads;
  await page.locator('.deposit-primary').click();
  const review = page.locator('.money-review');
  assert.match(await review.innerText(), /10%/);
  assert.equal(await page.locator('#additional-deposit-consent').isChecked(), false);
  assert.equal(await review.locator('.btn-primary').isDisabled(), true);
  await routes.USDC.strategy.setFee(200_000_000_000_000_000n).then(tx => tx.wait());
  await page.locator('#additional-deposit-consent').check(); await review.locator('.btn-primary').click();
  await until(async () => (await review.innerText()).includes('20%'), 'changed fee review');
  assert.equal(sends, 0); assert.equal(await page.locator('#additional-deposit-consent').isChecked(), false);
  assert.equal(await review.locator('.btn-primary').isDisabled(), true);
  assert.equal(await page.evaluate(async owner => (await import('/src/additional-deposit.ts')).readAdditionalDeposit(owner), c.owner), null);
  await page.screenshot({ path: out + '/fee-changed-review-390.png' });
  await page.locator('#additional-deposit-consent').check(); await review.locator('.btn-primary').click();
  await until(() => page.locator('#deposit-amount').inputValue().then(v => v === ''), 'reviewed deposit complete');
  assert.equal(sends, 1); assert.ok(feeReads - feeReadsBefore >= 3);
  pass('10%→20% fee change requires a new explicit review and consent before exactly one deposit', { feeReads: feeReads - feeReadsBefore, sends });

  const income = await fetch(origin + '/__host/control', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'yield'})});
  assert.equal(income.ok, true);
  const payoutEvents = new Interface(['event PerformanceFeePaid(address indexed recipient,uint256 assets,uint256 shares)', 'event OwnerWithdrawnWLD(address indexed to,uint256 amount)', 'event OwnerWithdrawnAsset(address indexed to,uint256 amount)']);
  function amounts(receipt, route) {
    const events = receipt.logs.filter(log => log.address.toLowerCase() === route.vault.toLowerCase()).flatMap(log => {try {const event=payoutEvents.parseLog(log);return event ? [event] : [];} catch{return [];}});
    return {fee:events.filter(event=>event.name==='PerformanceFeePaid').reduce((n,event)=>n+event.args.assets,0n),net:events.find(event=>event.name.startsWith('OwnerWithdrawn')).args.amount};
  }
  await page.reload(); await page.locator('.account-row').waitFor();
  for (const symbol of ['USDC', 'WLD']) {
    const route = routes[symbol]; await amountInput(symbol);
    const receiver = await route.token.balanceOf(c.heir), beforeSends = sends;
    lostHash = ''; dropNext = true;
    await page.locator('.principal-submit').click(); await review.locator('.btn-primary').click();
    await until(() => Promise.resolve(Boolean(lostHash)), 'missing identifier ' + symbol);
    await page.locator('#withdrawal-recovery-title').waitFor();
    await until(async () => await route.token.balanceOf(c.heir) === receiver + route.unit, symbol + ' paid once');
    const originalHash = lostHash;
    const partialPayout = amounts(await provider.getTransactionReceipt(originalHash), route);
    assert.ok(partialPayout.fee > 0n); assert.equal(partialPayout.net + partialPayout.fee, route.unit);
    assert.equal(await page.locator('.principal-submit').isDisabled(), true);
    await page.reload(); await page.locator('#withdrawal-recovery-title').waitFor();
    await page.locator('#inheritance-test-controls').evaluate(e => e.style.display = 'none');
    await asset(symbol);
    assert.equal(await page.locator('.principal-submit').isDisabled(), true);
    const recovery = page.locator('section[aria-labelledby="withdrawal-recovery-title"]');
    assert.match(await recovery.innerText(), new RegExp(c.heir, 'i'));
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 }); await recovery.scrollIntoViewIfNeeded();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false); await page.screenshot({ path: `${out}/withdrawal-${symbol}-${width}.png` });
    }
    // Another transaction, and a genuinely reverted receipt, cannot unlock the original request.
    for (const candidate of [route.initial]) {
      await page.locator('#withdrawal-recovery-id').fill(candidate); await recovery.getByRole('button', { name: 'Check withdrawal result' }).click();
      await until(() => recovery.getByRole('button').isEnabled(), 'unrelated receipt rejected');
      assert.equal(await page.locator('#withdrawal-recovery-title').count(), 1);
    }
    const failed = await signer.sendTransaction({ to: route.factory, data: route.f.interface.encodeFunctionData('withdrawFromMyVault', [c.heir, 10n ** 40n]), gasLimit: 1_000_000 });
    try { await failed.wait(); } catch { /* Expected local revert. */ }
    await page.locator('#withdrawal-recovery-id').fill(failed.hash); await recovery.getByRole('button', { name: 'Check withdrawal result' }).click();
    await until(() => recovery.getByRole('button').isEnabled(), 'unrelated failed receipt rejected');
    assert.equal(await page.locator('#withdrawal-recovery-title').count(), 1);
    if (symbol === 'USDC') {
      await signIn('heir'); assert.equal(await page.locator('#withdrawal-recovery-title').count(), 0);
      await signIn('owner'); await page.locator('#withdrawal-recovery-title').waitFor(); await asset(symbol);
      pass('account switch hides another wallet’s request and restores it only for its owner');
    }
    await page.locator('#withdrawal-recovery-id').fill(originalHash); await recovery.getByRole('button', { name: 'Check withdrawal result' }).click();
    await until(async () => await page.locator('#withdrawal-recovery-title').count() === 0, 'original withdrawal receipt');
    assert.equal(sends - beforeSends, 1); assert.equal(await route.token.balanceOf(c.heir), receiver + route.unit);
    pass(`${symbol}: lost identifier survives reload, blocks a second withdrawal, rejects unrelated/failed IDs, and recovers exactly once`, { sends: sends - beforeSends, recipientIncrease: route.unit.toString(), net: partialPayout.net.toString(), fee: partialPayout.fee.toString(), originalHash });
  }
  // A definite native rejection is safe to retry and never leaves an unresolved request.
  await amountInput('USDC'); const prior = await routes.USDC.token.balanceOf(c.heir), priorSends = sends;
  await page.evaluate(() => window.__INHERITANCE_TEST_HOST__.rejectNext('send-transaction'));
  await page.locator('.principal-submit').click(); await review.locator('.btn-primary').click();
  await until(() => page.locator('.principal-submit').isEnabled(), 'rejected withdrawal unlocked');
  assert.equal(await page.locator('#withdrawal-recovery-title').count(), 0);
  assert.equal(await routes.USDC.token.balanceOf(c.heir), prior); assert.equal(sends, priorSends);
  pass('definite native rejection clears only its own request and makes no payout');

  // The All intent uses the same recovery journal and its original minimum.
  for (const symbol of ['USDC','WLD']) {
    const route = routes[symbol];
    await amountInput(symbol);
    await page.locator('.principal-controls').getByRole('button', {name:'All',exact:true}).click();
    const fullBefore = await route.token.balanceOf(c.heir), fullSends = sends;
    lostHash = ''; dropNext = true;
    await page.locator('.principal-submit').click(); await review.locator('.btn-primary').click();
    await until(() => Promise.resolve(Boolean(lostHash)), 'full withdrawal missing ID');
    await page.locator('#withdrawal-recovery-title').waitFor();
    const fullRecord = await page.evaluate(async owner => (await import('/src/withdrawal.ts')).readOwnerWithdrawal(owner), c.owner);
    assert.equal(fullRecord.kind, 'all'); assert.ok(BigInt(fullRecord.minNetAssets) > 0n);
    const fullPayout = amounts(await provider.getTransactionReceipt(lostHash), route);
    assert.ok(fullPayout.fee > 0n); assert.ok(fullPayout.net >= BigInt(fullRecord.minNetAssets));
    await page.reload(); await page.locator('#withdrawal-recovery-title').waitFor();
    await page.locator('#withdrawal-recovery-id').fill(lostHash);
    await page.getByRole('button', {name:'Check withdrawal result',exact:true}).click();
    await until(async () => await page.locator('#withdrawal-recovery-title').count() === 0, 'full original receipt');
    assert.equal(sends - fullSends, 1); assert.equal(await route.strategy.balanceOf(route.vault), 0n);
    assert.equal(await route.token.balanceOf(c.heir) - fullBefore, fullPayout.net + fullPayout.fee);
    pass(`${symbol}: All withdrawal with real gains and a positive fee preserves its minimum and recovers without resending`, {net:fullPayout.net.toString(),fee:fullPayout.fee.toString(),minimum:fullRecord.minNetAssets,originalHash:lostHash});
  }
  const afterWithdrawals = sends;

  // Both deployed legacy journal forms remain recoverable after the CAS upgrade.
  for (const known of [false, true]) {
    const route = routes.USDC;
    const request = { version: 1, chainId: 480, account: c.owner, factory: route.factory, vault: route.vault, asset: route.asset, symbol: 'USDC', decimals: 6, amount: '10000000', mode: 'morpho', beforeBlock: 0, ...(known ? { txHash: route.initial, hashType: 'transaction' } : {}) };
    await page.evaluate(async request => { const {writePlanJournal} = await import('/src/plan-storage.ts'); await writePlanJournal('inheritance:additional-deposit:' + request.account.toLowerCase(), JSON.stringify(request)); }, request);
    await page.reload(); await page.locator('#deposit-recovery-title').waitFor();
    const recovery = page.locator('section[aria-labelledby="deposit-recovery-title"]');
    if (!known) await recovery.locator('input').fill(route.initial);
    await recovery.getByRole('button', { name: 'Check previous deposit' }).click();
    await until(async () => await page.locator('#deposit-recovery-title').count() === 0, 'legacy recovery ' + known);
  }
  assert.equal(sends, afterWithdrawals);
  pass('deployed no-requestId additional-deposit journals recover with known or manually supplied original IDs');
  writeFileSync(out + '/evidence.json', JSON.stringify(evidence, null, 2));
} finally {
  writeFileSync(out + '/host.log', log);
  await browser?.close(); provider?.destroy(); host.kill('SIGINT');
  await new Promise(resolve => { if (host.exitCode !== null) return resolve(); const t = setTimeout(() => { host.kill('SIGKILL'); resolve(); }, 5000); host.once('exit', () => { clearTimeout(t); resolve(); }); });
}
