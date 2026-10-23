// Current UI captures from real SDK/local contracts, for make-store-images.mjs.
// Only fixture usernames and mock strategy yield are changed; product DOM is not.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const out = process.env.STORE_RAW_DIR || '/tmp/inheritance-store';
mkdirSync(out, { recursive: true });
const socket = createServer();
await new Promise(done => socket.listen(0, '127.0.0.1', done));
const port = socket.address().port;
await new Promise(done => socket.close(done));
const origin = `http://localhost:${port}`;
const host = spawn(process.execPath, [new URL('../test-host/start.mjs', import.meta.url).pathname, `--port=${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', browser;
host.stdout.on('data', data => output += data); host.stderr.on('data', data => output += data);
const evidence = { capturedAt: new Date().toISOString(), fixture: 'Disposable local chain; illustrative balances; mock +10% strategy exchange rate; fixture usernames alex/sam', screenshots: [], errors: [] };
async function until(fn, label, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (host.exitCode !== null) throw Error(output);
    if (await fn()) return;
    await sleep(100);
  }
  throw Error('Timed out: ' + label);
}
try {
  await until(async () => { try { return (await fetch(origin + '/__host/config')).ok; } catch { return false; } }, 'host');
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}), args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await context.addInitScript(() => localStorage.setItem('inheritance:locale', 'en'));
  const page = await context.newPage();
  page.on('pageerror', error => evidence.errors.push(error.message));
  await page.route('**/__host/bootstrap.mjs', async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace('"test_owner"', '"alex"').replace('"test_heir"', '"sam"');
    await route.fulfill({ response, body });
  });
  const ready = async () => {
    await page.locator('.tab-item').nth(3).waitFor();
    await page.locator('#inheritance-test-controls').evaluate(e => e.style.display = 'none');
  };
  const capture = async (name, atTop = true) => {
    if (atTop) await page.evaluate(() => scrollTo(0, 0));
    await page.evaluate(() => document.fonts.ready);
    await sleep(100);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const path = `${out}/unified-store-${name}.png`;
    await page.screenshot({ path }); evidence.screenshots.push(path);
  };
  await page.goto(origin + '/?approval=auto'); await ready();
  await capture('welcome');
  await page.locator('.tab-item').nth(2).tap();
  await page.getByRole('button', { name: 'Continue with World App', exact: true }).tap();
  await page.locator('#heir-input').fill('@sam');
  await page.locator('#plan-wld').fill('10'); await page.locator('#plan-usdc').fill('100');
  await until(() => page.getByRole('button', { name: 'Review plan', exact: true }).isEnabled(), 'valid plan');
  await capture('create');
  await page.getByRole('button', { name: 'Review plan', exact: true }).tap();
  await page.locator('#yield-consent').check();
  await page.getByRole('button', { name: 'Confirm and deposit', exact: true }).tap();
  await page.locator('.invite-disclosure').waitFor({ timeout: 60000 });
  await page.locator('.tab-item').nth(0).tap(); await capture('overview');
  assert.equal((await fetch(origin + '/__host/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'yield' }) })).status, 200);
  await page.reload(); await ready(); await page.locator('.tab-item').nth(1).tap();
  await page.getByRole('button', { name: 'USDC', exact: true }).tap();
  await page.locator('.income-collect').waitFor();
  assert.equal(await page.locator('.income-collect').textContent(), 'Collect 9.0 USDC');
  assert.deepEqual(await page.locator('.income-card .yield-values dd').allTextContents(), ['10.0 USDC', '1.0 USDC', '9.0 USDC']);
  await page.locator('.income-card').evaluate(e => e.scrollIntoView({ block: 'start' }));
  await capture('income', false);
  assert.deepEqual(evidence.errors, []);
  writeFileSync(out + '/evidence.json', JSON.stringify(evidence, null, 2));
  console.log('PASS four current UI captures: ' + out);
} finally {
  await browser?.close(); host.kill('SIGTERM');
  await new Promise(done => { if (host.exitCode !== null) return done(); const timeout = setTimeout(() => { host.kill('SIGKILL'); done(); }, 5000); host.once('exit', () => { clearTimeout(timeout); done(); }); });
}
