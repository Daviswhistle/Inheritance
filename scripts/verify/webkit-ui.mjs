// Linux WebKit + the real MiniKit SDK's iOS transport + disposable local contracts.
// This exercises a second browser engine; it does not certify iPhone/World App UI.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const { webkit, devices } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const { Contract, JsonRpcProvider } = createRequire(new URL('../../app/package.json', import.meta.url))('ethers');
const out = process.env.WEBKIT_VERIFY_OUT || '/tmp/inheritance-webkit-ui';
mkdirSync(out, { recursive: true });
const socket = createServer();
await new Promise(done => socket.listen(0, '127.0.0.1', done));
const port = socket.address().port;
await new Promise(done => socket.close(done));
const origin = `http://localhost:${port}`;
const host = spawn(process.execPath, [new URL('../test-host/start.mjs', import.meta.url).pathname, `--port=${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', browser, provider;
host.stdout.on('data', data => output += data);
host.stderr.on('data', data => output += data);
const evidence = { environment: 'Linux WebKit, emulated mobile viewport, real MiniKit iOS transport, local assets; not an iPhone', checks: [], layouts: [], errors: [] };
async function until(fn, label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (host.exitCode !== null) throw Error(output);
    if (await fn()) return;
    await sleep(100);
  }
  throw Error(`Timed out: ${label}`);
}
function pass(message) { evidence.checks.push(message); console.log('PASS ' + message); }
async function tab(page, index) { await page.locator('.tab-item').nth(index).tap(); }
async function language(page, lang) { await tab(page, 3); await page.locator('.locale-picker select').selectOption(lang); }
async function tap(page, name) { await page.getByRole('button', { name, exact: true }).tap(); }
async function layout(page, label, width) {
  await page.waitForFunction(() => document.querySelector('main h1'));
  const data = await page.evaluate(() => {
    const action = document.querySelector('.entry-action,.plan-primary-actions');
    const button = action?.querySelector('button'), r = button?.getBoundingClientRect();
    const hit = r && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const small = [...document.querySelectorAll('main button,main summary,main select,main input:not([type=checkbox]),main a:not(p a)')]
      .filter(e => e.checkVisibility()).map(e => ({ label: e.textContent.trim().slice(0, 60) || e.id, width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height }))
      .filter(r => r.width < 44 || r.height < 44);
    return { width: document.documentElement.scrollWidth, headings: document.querySelectorAll('main h1').length, small,
      actionVisible: !r || r.top >= 0 && r.bottom <= document.querySelector('.tab-bar').getBoundingClientRect().top && (hit === button || button.contains(hit)) };
  });
  evidence.layouts.push({ label, ...data });
  assert.ok(data.width <= width, label + ' horizontal overflow');
  assert.equal(data.headings, 1, label + ' heading');
  assert.deepEqual(data.small, [], label + ' touch targets');
  assert.ok(data.actionVisible, label + ' primary action');
}
async function open(url) {
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    // A history excursion to about:blank has an opaque origin in WebKit.
    if (location.protocol === 'http:' && !localStorage.getItem('inheritance:locale')) localStorage.setItem('inheritance:locale', 'en');
  });
  const page = await context.newPage();
  page.on('pageerror', error => evidence.errors.push(error.message));
  await page.goto(url);
  await page.locator('.tab-item').nth(3).waitFor();
  await page.locator('#inheritance-test-controls').evaluate(e => e.style.display = 'none');
  assert.equal(await page.evaluate(() => window.__INHERITANCE_TEST_HOST__.platform), 'ios');
  return page;
}
try {
  await until(async () => { try { return (await fetch(origin + '/__host/config')).ok; } catch { return false; } }, 'host startup', 90000);
  const config = await (await fetch(origin + '/__host/config')).json();
  browser = await webkit.launch({ headless: true });
  evidence.browser = browser.version();
  provider = new JsonRpcProvider(origin + '/__host/rpc', undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  const page = await open(origin + '/?platform=ios&approval=auto');
  for (const lang of ['en', 'ko']) {
    await language(page, lang);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (let i = 0; i < 4; i++) { await tab(page, i); await layout(page, `guest-${lang}-${width}-${i}`, width); }
    }
  }
  assert.equal(await page.evaluate(() => window.__INHERITANCE_TEST_HOST__.history.filter(x => ['wallet-auth', 'send-transaction'].includes(x.command)).length), 0);
  pass('Both languages and all four guest tabs reflow at 320/390px without requesting a wallet');
  // Simulate a keyboard-reduced visual viewport while retaining the layout
  // viewport, then deliver a separate layout scroll as WKWebView can do after
  // rotation. This is an event/geometry regression, not native-keyboard proof.
  const editingContext = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });
  await editingContext.addInitScript(() => {
    localStorage.setItem('inheritance:locale', 'en');
    const viewport = new EventTarget();
    Object.assign(viewport, { height: 844, width: 390, offsetTop: 0, offsetLeft: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { value: viewport });
  });
  const editingPage = await editingContext.newPage();
  try {
    await editingPage.goto(origin + '/?platform=ios&approval=auto');
    await tab(editingPage, 2); await tap(editingPage, 'Continue with World App');
    await editingPage.locator('#heir-input').fill(config.heir);
    for (const [width, height, visible] of [[390, 844, 350], [844, 390, 70]]) {
      await editingPage.setViewportSize({ width, height });
      await editingPage.evaluate(({ width, visible }) => {
        Object.assign(visualViewport, { width, height: visible });
        visualViewport.dispatchEvent(new Event('resize'));
        document.getElementById('heir-input').focus();
      }, { width, visible });
      await editingPage.waitForFunction(() => {
        const r = document.getElementById('heir-input').getBoundingClientRect();
        return r.top >= 0 && r.bottom <= visualViewport.height;
      });
    }
    await editingPage.evaluate(() => scrollBy(0, -35));
    await editingPage.waitForFunction(() => {
      const r = document.getElementById('heir-input').getBoundingClientRect();
      return r.top >= 0 && r.bottom <= visualViewport.height;
    });
    const settledScroll = await editingPage.evaluate(() => scrollY);
    await sleep(300);
    assert.equal(await editingPage.evaluate(() => scrollY), settledScroll, 'corrective layout scroll must settle instead of oscillating');
    assert.equal(await editingPage.locator('#heir-input').inputValue(), config.heir);
    assert.equal(await editingPage.locator('.plan-primary-actions').isVisible(), false);
    // A native host can resize the layout viewport too. Keep the keyboard open
    // throughout portrait -> landscape -> portrait and foreground restoration.
    for (const [width, height] of [[390, 362], [844, 70], [390, 362]]) {
      await editingPage.setViewportSize({ width, height });
      await editingPage.evaluate(({ width, height }) => {
        Object.assign(visualViewport, { width, height });
        visualViewport.dispatchEvent(new Event('resize'));
      }, { width, height });
      await editingPage.waitForFunction(() => {
        const input = document.getElementById('heir-input');
        const r = input.getBoundingClientRect();
        return document.activeElement === input
          && document.documentElement.hasAttribute('data-plan-keyboard')
          && r.top >= 0 && r.bottom <= visualViewport.height;
      });
      assert.equal(await editingPage.locator('.plan-primary-actions').isVisible(), false);
      assert.equal(await editingPage.locator('.tab-bar').isVisible(), false);
    }
    await editingPage.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await sleep(300);
    assert.equal(await editingPage.evaluate(() => document.documentElement.hasAttribute('data-plan-keyboard')), true,
      'foreground portrait retains its unoccluded baseline while the keyboard remains open');
    assert.equal(await editingPage.locator('.plan-primary-actions').isVisible(), false);
    assert.equal(await editingPage.locator('.tab-bar').isVisible(), false);
    assert.equal(await editingPage.locator('#heir-input').inputValue(), config.heir);
    await editingPage.locator('#heir-input').blur();
    await editingPage.waitForFunction(() => !document.documentElement.hasAttribute('data-plan-keyboard'));
  } finally { await editingContext.close(); }
  pass('Keyboard clearance settles after layout scrolling and preserves hidden actions across resized portrait/landscape/foreground transitions');
  await tab(page, 2); await tap(page, 'World App으로 계속하기');
  await page.locator('#heir-input').fill(config.heir);
  await page.locator('#plan-wld').fill('10');
  await page.locator('#plan-usdc').fill('12.345678');
  await layout(page, 'setup-ko', 390);
  await page.locator('#plan-usdc').focus();
  await page.setViewportSize({ width: 844, height: 390 });
  await layout(page, 'setup-landscape-ko', 844);
  assert.equal(await page.locator('#plan-usdc').inputValue(), '12.345678');
  assert.equal(await page.locator('#heir-input').inputValue(), config.heir);
  await page.setViewportSize({ width: 390, height: 844 });
  await layout(page, 'setup-portrait-return-ko', 390);
  pass('Portrait/landscape viewport changes preserve the focused form and exact decimal input');
  await tap(page, '플랜 검토');
  await page.locator('#plan-review-title').waitFor();
  assert.equal(await page.locator('#yield-consent').isChecked(), false);
  assert.equal(await page.locator('.plan-submit').isDisabled(), true);
  assert.deepEqual(await page.locator('.plan-review-amount').allTextContents(), ['10 WLD', '12.345678 USDC']);
  assert.equal(await page.locator('.plan-review-address').textContent(), config.heir);
  await page.locator('#yield-consent').check();
  // Reading the required documents must not replace the app and lose the draft.
  for (const document of ['terms', 'privacy']) {
    const link = page.locator(`.plan-legal-copy a[href="/${document}.html"]`);
    await link.tap();
    await page.locator('.plan-legal-dialog[open]').waitFor();
    const frame = page.frameLocator('.plan-legal-dialog iframe');
    await frame.locator('h1').waitFor();
    assert.ok(await page.locator('.plan-legal-dialog iframe').getAttribute('title'));
    await tap(page, '닫기');
    await page.locator('.plan-legal-dialog').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('href')), `/${document}.html`);
    assert.equal(page.url(), origin + '/?platform=ios&approval=auto');
    assert.ok(await page.locator('#yield-consent').isChecked());
  }
  await page.locator('.plan-legal-copy a[href="/terms.html"]').tap();
  await page.frameLocator('.plan-legal-dialog iframe').getByRole('link', { name: 'Back to Inheritance', exact: true }).tap();
  await page.locator('.plan-legal-dialog').waitFor({ state: 'detached' });
  await page.locator('.plan-legal-copy a[href="/privacy.html"]').tap();
  await page.frameLocator('.plan-legal-dialog iframe').locator('a').first().focus();
  await page.keyboard.press('Escape');
  await page.locator('.plan-legal-dialog').waitFor({ state: 'detached' });
  assert.deepEqual(await page.locator('.plan-review-amount').allTextContents(), ['10 WLD', '12.345678 USDC']);
  assert.equal(await page.locator('.plan-review-address').textContent(), config.heir);
  assert.ok(await page.locator('#yield-consent').isChecked());
  pass('Terms/privacy close, document return link and Escape preserve the review, exact amounts and consent; focus returns to the opener');
  await layout(page, 'review-ko', 390);
  await page.screenshot({ path: out + '/review-ko.png' });
  await tap(page, '승인하고 예치');
  await page.locator('.invite-disclosure').waitFor({ timeout: 60000 });
  const wf = new Contract(config.wldFactory, ['function vaultOf(address) view returns(address)'], provider);
  const uf = new Contract(config.usdcFactory, ['function vaultOf(address) view returns(address)'], provider);
  const wldVault = await wf.vaultOf(config.owner), usdcVault = await uf.vaultOf(config.owner);
  for (const [address, amount] of [[wldVault, 10n ** 19n], [usdcVault, 12_345678n]]) {
    assert.equal(await new Contract(address, ['function costBasis() view returns(uint256)'], provider).costBasis(), amount);
  }
  assert.equal(await page.evaluate(() => window.__INHERITANCE_TEST_HOST__.history.filter(x => x.command === 'send-transaction').length), 1);
  pass('Actual iOS SDK login and one approved atomic WLD/USDC setup preserve exact amounts and require consent');
  // Hold real RPC responses during a fresh read. An empty in-memory overview is
  // not evidence that this funded owner has no active inheritance plan.
  let releasePositions;
  const positionGate = new Promise(resolve => { releasePositions = resolve; });
  const positionSelector = new Contract(wldVault, ['function position()'], provider).interface.getFunction('position').selector;
  let heldPositions = 0;
  const delayPositions = async route => {
    const body = route.request().postDataJSON();
    const requests = Array.isArray(body) ? body : [body];
    if (requests.some(request => request?.method === 'eth_call'
      && [wldVault.toLowerCase(), usdcVault.toLowerCase()].includes(request.params?.[0]?.to?.toLowerCase())
      && (request.params[0].data || request.params[0].input || '').startsWith(positionSelector))) {
      heldPositions++;
      await positionGate;
    }
    await route.continue();
  };
  await page.route('**/__host/rpc', delayPositions);
  try {
    await page.reload();
    await tab(page, 0);
    await until(() => heldPositions > 0, 'delayed owned-position RPC');
    const overview = page.locator('.plan-overview-card');
    await overview.getByRole('status').filter({ hasText: '플랜 확인 중…' }).waitFor();
    assert.equal((await overview.innerText()).includes('활성 상속 플랜이 없습니다'), false);
    assert.deepEqual(await overview.locator('.plan-overview-asset strong').allTextContents(), ['업데이트 중…', '업데이트 중…']);
  } finally {
    releasePositions();
    await page.unrouteAll({ behavior: 'wait' });
  }
  await page.locator('.plan-common-settings strong').first().waitFor();
  assert.equal((await page.locator('.plan-common-settings strong').first().getAttribute('title')).toLowerCase(), config.heir.toLowerCase());
  assert.deepEqual(await page.locator('.plan-overview-asset strong').allTextContents(), ['10.0', '12.345678']);
  pass('A funded owner sees checking status while position RPC is delayed, then the real heir and balances; no false empty-plan state');
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (let i = 0; i < 4; i++) {
      await tab(page, i);
      await page.locator('main details').evaluateAll(nodes => nodes.forEach(n => n.open = true));
      await layout(page, `owner-expanded-ko-${width}-${i}`, width);
      await page.locator('main details').evaluateAll(nodes => nodes.forEach(n => n.open = false));
    }
  }
  await tab(page, 0); await tap(page, '지금 확인하기');
  await page.waitForFunction(() => [...document.querySelectorAll('[role=status]')].some(e => e.textContent.includes('2개') && e.textContent.includes('확인')));
  pass('Expanded owner details retain touch targets and a combined check-in confirms both assets');
  // Real browser network outage, with local-chain state observed independently.
  const vaults = [wldVault, usdcVault].map(address => new Contract(address,
    ['function lastPing() view returns(uint256)', 'function costBasis() view returns(uint256)'], provider));
  const snapshot = () => Promise.all(vaults.map(async vault => [String(await vault.lastPing()), String(await vault.costBasis())]));
  const beforeRejectedSetup = await snapshot();
  await page.setViewportSize({ width: 320, height: 640 });
  await tab(page, 2); await tap(page, '내 플랜에 자산 추가');
  await page.locator('#plan-usdc').fill('1.000001');
  await tap(page, '플랜 검토');
  await page.locator('#yield-consent').check();
  await page.evaluate(() => window.__INHERITANCE_TEST_HOST__.rejectNext('send-transaction'));
  await tap(page, '승인하고 예치');
  await page.waitForFunction(() => document.activeElement?.id === 'plan-resume-title');
  const resumeButton = page.getByRole('button', { name: '남은 설정 이어하기', exact: true });
  const resumeBox = await resumeButton.boundingBox();
  const tabBox = await page.locator('.tab-bar').boundingBox();
  assert.ok(resumeBox && tabBox && resumeBox.y >= 0 && resumeBox.y + resumeBox.height <= tabBox.y);
  assert.deepEqual(await snapshot(), beforeRejectedSetup);
  await page.screenshot({ path: out + '/rejected-setup-recovery-ko-320.png' });
  // Once shown, a background refresh must not pull the reader back down.
  await page.getByRole('button', { name: '남은 설정 수정', exact: true }).focus();
  const refreshingRecovery = page.waitForResponse(response => response.url().endsWith('/__host/rpc'));
  await page.evaluate(() => { scrollTo(0, 0); document.dispatchEvent(new Event('visibilitychange')); });
  await refreshingRecovery;
  await sleep(300);
  assert.equal(await page.evaluate(() => scrollY), 0);
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), '남은 설정 수정');
  await tab(page, 3); await tab(page, 2);
  await page.waitForFunction(() => document.activeElement?.id === 'plan-resume-title');
  await tap(page, '남은 설정 수정');
  await page.locator('#plan-usdc').waitFor();
  assert.equal(await page.locator('#plan-usdc').inputValue(), '1.000001');
  await page.setViewportSize({ width: 390, height: 844 });
  pass('Rejected added funds focus the visible recovery action at 320px; refresh preserves reader focus/scroll and editing retains the exact amount');
  const beforeOutage = await snapshot();
  const commandCount = () => page.evaluate(() => window.__INHERITANCE_TEST_HOST__.history.filter(x => x.command === 'send-transaction').length);
  const beforeCommands = await commandCount();
  await tab(page, 1);
  await page.context().setOffline(true);
  // This only requests the app's normal visibility-triggered read. Network failure
  // is supplied by WebKit itself; this event is not evidence of OS backgrounding.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.getByRole('status').filter({ hasText: '현재 World Chain에 연결되지 않아' }).waitFor({ timeout: 45000 });
  assert.deepEqual(await snapshot(), beforeOutage);
  assert.equal(await commandCount(), beforeCommands);
  await page.screenshot({ path: out + '/offline-ko.png' });
  await page.context().setOffline(false);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.getByRole('status').filter({ hasText: '현재 World Chain에 연결되지 않아' }).waitFor({ state: 'hidden', timeout: 45000 });
  await tab(page, 0);
  await page.getByRole('button', { name: '지금 확인하기', exact: true }).waitFor();
  await until(() => page.getByRole('button', { name: '지금 확인하기', exact: true }).isEnabled(), 'recovered owner reads');
  pass('A real WebKit network outage reports stale data and reconnect recovers without changing either vault or submitting transactions');
  // Cancellation and browser process/navigation boundaries while approval waits.
  await page.locator('#inheritance-test-controls').evaluate(e => e.style.display = '');
  await page.evaluate(() => window.__INHERITANCE_TEST_HOST__.setApproval('manual'));
  const beforePending = await snapshot();
  await tap(page, '지금 확인하기');
  await page.waitForFunction(() => window.__INHERITANCE_TEST_HOST__.pending.some(x => x.command === 'send-transaction'));
  assert.equal(await page.getByRole('button', { name: '지금 확인하기', exact: true }).isDisabled(), true);
  // Use the visible test-host rejection control, including its dialog dismissal.
  // Direct controller.reject alone intentionally leaves the operator panel open.
  await page.locator('#inheritance-test-controls').getByRole('button', { name: 'Reject', exact: true }).tap();
  await until(() => page.getByRole('button', { name: '지금 확인하기', exact: true }).isEnabled(), 'cancel re-enables check-in');
  assert.deepEqual(await snapshot(), beforePending);
  await tap(page, '지금 확인하기');
  await page.waitForFunction(() => window.__INHERITANCE_TEST_HOST__.pending.some(x => x.command === 'send-transaction'));
  await page.reload();
  await page.locator('.tab-item').nth(3).waitFor();
  await page.locator('#inheritance-test-controls').evaluate(e => e.style.display = 'none');
  await tab(page, 0);
  await until(() => page.getByRole('button', { name: '지금 확인하기', exact: true }).isEnabled(), 'reload recovers owner');
  assert.equal(await commandCount(), 0, 'reload must not replay an unapproved command');
  assert.deepEqual(await snapshot(), beforePending);
  await page.goto('about:blank');
  await page.goBack();
  await page.locator('.tab-item').nth(3).waitFor();
  await page.locator('#inheritance-test-controls').evaluate(e => e.style.display = 'none');
  assert.equal(await page.locator('.app-shell').getAttribute('lang'), 'ko');
  await tab(page, 0);
  await until(() => page.getByRole('button', { name: '지금 확인하기', exact: true }).isEnabled(), 'history return recovers owner');
  assert.equal(await commandCount(), 0);
  assert.deepEqual(await snapshot(), beforePending);
  await tap(page, '지금 확인하기');
  await page.waitForFunction(() => [...document.querySelectorAll('[role=status]')].some(e => e.textContent.includes('2개') && e.textContent.includes('확인')));
  assert.equal(await commandCount(), 1, 'only explicit retry submits');
  pass('Approval rejection, reload during pending approval and browser Back preserve both vaults; only an explicit retry submits once');
  const heir = await open(origin + `/?platform=ios&approval=auto&account=heir&vault=${wldVault}`);
  await tap(heir, 'Continue with World App');
  await heir.locator('.inheritance-asset').nth(1).waitFor();
  await layout(heir, 'heir-active-en', 390);
  assert.equal(await heir.locator('.heir-shared-next').count(), 1);
  await heir.screenshot({ path: out + '/heir-en.png' });
  pass('Recipient login resolves both asset plans and shares their common next step');
  // Commit the transaction, then interrupt the response before the real SDK can
  // save its operation ID. Recovery must prove the receipt rather than deposit twice.
  await tap(heir, 'Create my own plan');
  await heir.locator('#heir-input').fill(config.owner);
  await heir.locator('#plan-wld').fill('4');
  await heir.locator('#plan-usdc').fill('5.000001');
  await tap(heir, 'Review plan');
  await heir.locator('#yield-consent').check();
  let committed = false, releaseResponse;
  let submittedCommands = 0;
  await heir.route('**/__host/command', async route => {
    const command = route.request().postDataJSON()?.envelope?.command;
    if (command !== 'send-transaction') return route.continue();
    submittedCommands++;
    const response = await route.fetch();
    assert.equal((await response.json()).status, 'success');
    committed = true;
    await new Promise(resolve => releaseResponse = resolve);
    await route.fulfill({ response }).catch(() => {}); // old page is gone
  });
  await tap(heir, 'Confirm and deposit');
  await until(async () => committed, 'deposit mined before callback');
  const recoveryKey = 'inheritance:pending-plan:' + config.heir.toLowerCase();
  const journal = await heir.evaluate(async key => (await import('/src/plan-storage.ts')).readPlanJournal(key, JSON.parse), recoveryKey);
  assert.ok(journal.setupRequest && !journal.setupRequest.txHash, 'receipt ID has not reached the app');
  assert.ok(journal.assets.every(asset => asset.depositState === 'submitting'));
  const recoveredVaults = await Promise.all([wf.vaultOf(config.heir), uf.vaultOf(config.heir)]);
  const amounts = () => Promise.all(recoveredVaults.map(address => new Contract(address,
    ['function costBasis() view returns(uint256)'], provider).costBasis()));
  assert.deepEqual(await amounts(), [4n * 10n ** 18n, 5_000001n]);
  await heir.reload();
  releaseResponse();
  await heir.unroute('**/__host/command');
  await heir.locator('#inheritance-test-controls').evaluate(e => e.style.display = 'none');
  await heir.locator('.plan-resume').waitFor();
  assert.equal(await heir.evaluate(() => window.__INHERITANCE_TEST_HOST__.history.filter(x => x.command === 'send-transaction').length), 0);
  await heir.screenshot({ path: out + '/interrupted-deposit-recovery.png' });
  await heir.locator('.plan-resume .btn-primary').tap();
  await until(() => heir.evaluate(async key => !(await (await import('/src/plan-storage.ts')).readPlanJournal(key, raw => raw)), recoveryKey), 'historical receipt recovery');
  assert.deepEqual(await amounts(), [4n * 10n ** 18n, 5_000001n]);
  assert.equal(submittedCommands, 1);
  assert.equal(await heir.evaluate(() => window.__INHERITANCE_TEST_HOST__.history.filter(x => x.command === 'send-transaction').length), 0);
  pass('Reload after an approved deposit but before its SDK callback recovers both exact deposits from the receipt without a second transaction');
  // Reach the real empty-plan dialog without modifying React state or contract storage.
  const exit = await page.evaluate(async ({ factory, owner }) => {
    const { sendWorldChainTx } = await import('/src/minikit.ts');
    return sendWorldChainTx([{ address: factory, abi: ['function withdrawAllFromMyVault(address,uint256)'], functionName: 'withdrawAllFromMyVault', args: [owner, '0'] }]);
  }, { factory: config.usdcFactory, owner: config.owner });
  assert.equal(exit.ok, true);
  const child = new Contract(usdcVault, ['function hasAssets() view returns(bool)'], provider);
  await until(async () => !await child.hasAssets(), 'empty plan');
  assert.equal((await fetch(origin + '/__host/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'time', days: 31 }) })).status, 200);
  await page.reload(); await page.locator('.tab-item').nth(3).waitFor();
  assert.equal(await page.locator('.app-shell').getAttribute('lang'), 'ko', 'chosen language survives reload');
  await page.locator('#inheritance-test-controls').evaluate(e => e.style.display = 'none');
  await tab(page, 1); await tap(page, 'USDC'); await tab(page, 2);
  await page.setViewportSize({ width: 320, height: 360 });
  const closeSummary = page.locator('summary').filter({ hasText: '비어 있는 플랜 종료' });
  await closeSummary.tap(); await tap(page, '비어 있는 플랜 종료');
  assert.equal(await page.locator('.release-ack').isChecked(), false);
  assert.equal(await page.locator('.release-actions .btn-primary').isDisabled(), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'release-modal-title');
  await page.locator('.tab-item').first().focus();
  assert.ok(await page.evaluate(() => document.querySelector('.release-dialog').contains(document.activeElement)));
  await page.locator('.release-ack').check();
  await page.locator('.release-actions .btn-primary').focus();
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  assert.ok(await page.evaluate(() => document.activeElement.matches('.release-actions .btn-primary')));
  await page.screenshot({ path: out + '/close-ko-320.png' });
  await tap(page, '취소');
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '비어 있는 플랜 종료');
  await tap(page, '비어 있는 플랜 종료'); await page.keyboard.press('Escape');
  assert.equal(await page.locator('.release-dialog').count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '비어 있는 플랜 종료');
  pass('WebKit native dialog contains focus, scrolls on a short viewport and restores the opener on Cancel/Escape');
  assert.deepEqual(evidence.errors, []);
  writeFileSync(out + '/evidence.json', JSON.stringify(evidence, null, 2));
  console.log(`PASS ${evidence.layouts.length} WebKit layouts; evidence in ${out}`);
} catch (error) {
  evidence.failure = String(error);
  writeFileSync(out + '/failure.json', JSON.stringify(evidence, null, 2));
  for (const [index, page] of (browser?.contexts().flatMap(context => context.pages()) || []).entries()) {
    await page.screenshot({ path: `${out}/failure-${index}.png` }).catch(() => {});
    const details = await page.evaluate(() => ({ scrollY, innerHeight, innerWidth,
      viewport: { offsetTop: visualViewport?.offsetTop, height: visualViewport?.height, scale: visualViewport?.scale },
      elements: [...document.querySelectorAll('html,body,.app-shell,main,button[aria-describedby="home-checkin-help"]')].map(e => {
        const r = e.getBoundingClientRect(), c = getComputedStyle(e);
        return { tag: e.tagName, class: e.className, rect: r.toJSON(), pointerEvents: c.pointerEvents, overflow: c.overflow,
          atCenter: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.outerHTML.slice(0, 300) };
      }) }));
    writeFileSync(`${out}/failure-${index}.json`, JSON.stringify(details, null, 2));
  }
  throw error;
} finally {
  await browser?.close(); provider?.destroy(); host.kill('SIGTERM');
  await new Promise(done => { if (host.exitCode !== null) return done(); const timeout = setTimeout(() => { host.kill('SIGKILL'); done(); }, 5000); host.once('exit', () => { clearTimeout(timeout); done(); }); });
}
