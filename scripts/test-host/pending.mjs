// Real disposable Anvil receipts: no production RPC, wallets or funds.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(new URL('../../app/package.json', import.meta.url));
const { Contract, JsonRpcProvider } = require('ethers');
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const origin = `http://localhost:${port}`;
const host = spawn(process.execPath, [new URL('./start.mjs', import.meta.url).pathname, `--port=${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', provider;
host.stdout.on('data', data => output = (output + data).slice(-16000));
host.stderr.on('data', data => output = (output + data).slice(-16000));
async function post(path, body, expected = 200, headers = {}) {
  const response = await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, expected, await response.clone().text());
  return response.json();
}
const control = body => post('/__host/control', body);
const lookup = async id => (await fetch(`${origin}/__host/userop/${id}`, { signal: AbortSignal.timeout(5000) })).json();
try {
  const deadline = Date.now() + 90000;
  let config;
  while (Date.now() < deadline) {
    if (host.exitCode !== null) throw new Error(`Host stopped: ${output}`);
    try {
      const response = await fetch(origin + '/__host/config', { signal: AbortSignal.timeout(1000) });
      if (response.ok) { config = await response.json(); break; }
    } catch { /* Startup only. */ }
    await sleep(150);
  }
  assert.ok(config?.testOnly, `Host not ready: ${output}`);
  provider = new JsonRpcProvider(origin + '/__host/rpc', undefined, { cacheTimeout: -1, batchMaxCount: 1 });
  const token = new Contract(config.wld, ['function approve(address,uint256)', 'function transfer(address,uint256)', 'function allowance(address,address) view returns(uint256)'], provider);
  const send = transactions => post('/__host/command', { role: 'owner', envelope: { command: 'send-transaction', version: 2, payload: { chainId: 480, transactions } } });
  const approval = value => ({ to: config.wld, data: token.interface.encodeFunctionData('approve', [config.heir, value]), value: '0x0' });
  // Default behavior remains receipt-complete for existing browser/native tests.
  const immediate = await send([approval(1n)]);
  assert.equal((await lookup(immediate.userOpHash)).status, 'success');
  assert.equal(await token.allowance(config.owner, config.heir), 1n);
  console.log('PASS default submission returns a canonical, mined receipt');

  assert.equal((await control({ action: 'mining', enabled: false })).automine, false);
  await post('/__host/control', { action: 'mining', enabled: 'false' }, 400);
  await post('/__host/control', { action: 'yield' }, 400); // never deadlock the mutation queue
  const pending = await send([approval(2n)]);
  assert.match(pending.userOpHash, /^0x[\da-f]{64}$/);
  assert.deepEqual(await lookup(pending.userOpHash), { status: 'pending' });
  assert.equal(await token.allowance(config.owner, config.heir), 1n);
  await sleep(100);
  assert.deepEqual(await lookup(pending.userOpHash), { status: 'pending' }, 'pending is stable until an explicit mine');
  await control({ action: 'mine' });
  const mined = await lookup(pending.userOpHash);
  assert.equal(mined.status, 'success');
  assert.notEqual(mined.transaction_hash, pending.userOpHash);
  assert.equal((await provider.getTransactionReceipt(mined.transaction_hash)).status, 1);
  assert.equal(await token.allowance(config.owner, config.heir), 2n);
  assert.deepEqual(await lookup(pending.userOpHash), mined, 'repeated lookups do not resubmit');
  console.log('PASS operation ID precedes mining; pending becomes canonical success exactly once');

  const failed = await send([approval(3n), { to: config.wld, data: token.interface.encodeFunctionData('transfer', [config.heir, 10n ** 40n]), value: '0x0' }]);
  assert.deepEqual(await lookup(failed.userOpHash), { status: 'pending' });
  await control({ action: 'mine' });
  const reverted = await lookup(failed.userOpHash);
  assert.equal(reverted.status, 'failed');
  assert.equal((await provider.getTransactionReceipt(reverted.transaction_hash)).status, 0);
  assert.equal(await token.allowance(config.owner, config.heir), 2n, 'a final-call revert rolls back the entire batch');
  console.log('PASS pending becomes failed only from a real reverted receipt; batch is atomic');

  await post('/__host/control', { action: 'mining', enabled: true }, 403, { Origin: 'https://unrelated.example' });
  assert.equal((await control({ action: 'mining', enabled: true })).automine, true);
  const restored = await send([approval(4n)]);
  assert.equal((await lookup(restored.userOpHash)).status, 'success');
  assert.equal(await token.allowance(config.owner, config.heir), 4n);
  console.log('PASS same-origin controls and restored automining preserve safe default behavior');
} finally {
  provider?.destroy();
  host.kill('SIGINT');
  await new Promise(resolve => {
    if (host.exitCode !== null) return resolve();
    const timeout = setTimeout(() => { host.kill('SIGKILL'); resolve(); }, 5000);
    host.once('exit', () => { clearTimeout(timeout); resolve(); });
  });
}
