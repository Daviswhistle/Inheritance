// Evidence capture on an explicitly selected, authorized physical Android phone.
// No login, transaction, notification, app-data reset or device setting changes.
// UIAutomator can omit a rendered cold WebView: XML is NOT a visual pass/fail gate.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const adb = process.env.ADB_BIN || 'adb';
const serial = process.env.ANDROID_SERIAL;
const output = process.env.ANDROID_COLD_OUT;
assert.ok(serial && output, 'Set ANDROID_SERIAL and ANDROID_COLD_OUT (private directory outside this repository).');
const out = resolve(output);
const repo = resolve(new URL('../..', import.meta.url).pathname);
assert.ok(relative(repo, out).startsWith('../'), 'Phone screenshots/XML must stay outside the public repository.');
mkdirSync(out, { recursive: true });
const run = (...args) => execFileSync(adb, ['-s', serial, ...args], { timeout: 30000 });
const text = (...args) => run(...args).toString().trim();
const pid = () => {
  try { return text('shell', 'pidof', 'com.worldcoin'); }
  catch (error) { if (error.status === 1) return ''; throw error; }
};
const evidence = { startedAt: new Date().toISOString(), result: 'REQUIRES_VISUAL_REVIEW', cases: [] };
for (const [name, path] of [['app', '/'], ['static-control', '/terms.html']]) {
  const beforePid = pid();
  text('shell', 'am', 'force-stop', 'com.worldcoin');
  assert.equal(pid(), '', 'World App must actually stop before this capture.');
  const start = performance.now();
  const url = `https://world.org/mini-app?app_id=app_28c40a2a42b7f6c95789c2d5231b1314&path=${encodeURIComponent(path)}`;
  // adb joins arguments into a remote shell command: keep & inside remote quotes.
  const launch = text('shell', `am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d '${url}'`);
  const record = { name, beforePid, afterPid: pid(), launch, captures: [], xml: null };
  for (const seconds of [5, 15, 30]) {
    await sleep(Math.max(0, seconds * 1000 - (performance.now() - start)));
    const file = `${name}-${seconds}s.png`;
    writeFileSync(resolve(out, file), run('exec-out', 'screencap', '-p'));
    record.captures.push({ file, elapsedMs: Math.round(performance.now() - start) });
  }
  // Collect only after the visual timeline. Never pull a stale dump on failure.
  const remote = '/sdcard/inheritance-cold-ui.xml';
  text('shell', 'rm', '-f', remote);
  try {
    const dump = text('shell', 'uiautomator', 'dump', remote);
    assert.match(dump, /dumped to/);
    writeFileSync(resolve(out, `${name}.xml`), run('exec-out', 'cat', remote));
    record.xml = 'captured; absence of web content is inconclusive';
  } catch { record.xml = 'unavailable; no previous XML reused'; }
  finally { text('shell', 'rm', '-f', remote); }
  evidence.cases.push(record);
  writeFileSync(resolve(out, 'capture.json'), JSON.stringify(evidence, null, 2));
  console.log(`${name}: screenshots captured; inspect pixels and action response before classifying.`);
}
console.log('Capture complete. This tool does not automatically declare the app passed or failed.');
