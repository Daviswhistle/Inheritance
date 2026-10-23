import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { installTestHost } from './bridge.mjs';
import { createExecutor } from './executor.mjs';
const require = createRequire(new URL('../../app/package.json', import.meta.url));
const { Wallet, verifyMessage } = require('ethers');
const { MiniKit } = await import(require.resolve('@worldcoin/minikit-js'));
const owner = new Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const heir = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const origin = 'http://localhost:5179';
const provider = {
  _getConnection: () => ({ url: 'http://127.0.0.1:8545' }),
  send: async method => method === 'eth_chainId' ? '0x1e0' : 'anvil/v1.0',
};
const executor = createExecutor({ provider, accounts: { owner, heir } });

for (const platform of ['ios', 'android']) {
  test(`real installed MiniKit SDK round trip through ${platform} bridge`, async () => {
    const priorWindow = globalThis.window;
    const priorFetch = globalThis.fetch;
    const calls = [];
    const win = { location: { href: `${origin}/?vault=test`, host: 'localhost:5179' }, fetch: priorFetch };
    globalThis.window = win;
    const host = installTestHost({ window: win, platform, walletAddress: owner.address,
      usernames: { [owner.address]: 'test_owner', [heir.address]: 'test_heir' },
      lookup: async hash => ({ status: 'success', transaction_hash: hash }),
      execute: async envelope => {
        calls.push(envelope);
        if (envelope.command === 'send-transaction') return { status: 'success', version: 2, userOpHash: `0x${'ab'.repeat(32)}`, from: owner.address };
        return executor.execute(envelope, { role: 'owner', origin });
      },
    });
    globalThis.fetch = win.fetch;
    try {
      assert.equal(MiniKit.install('app_test_host').success, true);
      const auth = await MiniKit.walletAuth({ nonce: 'nonce12345', statement: 'Sign in to Inheritance' });
      assert.equal(auth.executedWith, 'minikit');
      assert.equal(verifyMessage(auth.data.message, auth.data.signature), owner.address);
      assert.match(auth.data.message, /Nonce: nonce12345/);
      assert.equal(calls[0].payload.siweMessage.includes('{address}'), true);
      const user = await MiniKit.getUserByUsername('test_heir');
      assert.equal(user.walletAddress, heir.address);
      const profile = await MiniKit.getUserByAddress(owner.address);
      assert.equal(profile.username, 'test_owner');
      assert.equal((await MiniKit.getPermissions()).data.permissions.notifications, false);
      await MiniKit.requestPermission({ permission: 'notifications' });
      assert.equal((await MiniKit.getPermissions()).data.permissions.notifications, true);
      assert.equal((await MiniKit.shareContacts({})).data.contacts[0].walletAddress, heir.address);
      assert.equal((await MiniKit.chat({ message: 'test only', to: [heir.address] })).data.testHostDelivery, 'recorded-only');
      host.rejectNext('wallet-auth');
      await assert.rejects(MiniKit.walletAuth({ nonce: 'nonce12345' }), error => error.code === 'user_rejected');
      assert.equal(calls.length, 1, 'Rejected auth never reaches signer');
      host.setApproval('manual');
      const transactionPromise = MiniKit.sendTransaction({ chainId: 480, transactions: [{ to: heir.address, data: '0x1234', value: '0x0' }] });
      assert.equal(host.pending.length, 1);
      assert.equal(calls.length, 1, 'Manual approval holds execution');
      host.approve(host.pending[0].id);
      const transaction = await transactionPromise;
      assert.equal(transaction.executedWith, 'minikit');
      assert.equal(transaction.data.userOpHash, `0x${'ab'.repeat(32)}`);
      assert.equal(calls[1].payload.chainId, 480);
      assert.equal(calls[1].payload.transactions[0].data, '0x1234');
      const resolution = await fetch(`https://developer.world.org/api/v2/minikit/userop/${transaction.data.userOpHash}`);
      assert.equal((await resolution.json()).status, 'success');
      host.setApproval('auto');
      host.failNext('send-transaction');
      await assert.rejects(MiniKit.sendTransaction({ chainId: 480, transactions: [{ to: heir.address, data: '0x1234', value: '0x0' }] }), error => error.code === 'generic_error');
      assert.equal(calls.length, 2, 'Injected failure never reaches chain executor');
      host.delayNext(20, 'get-permissions');
      const delayed = MiniKit.getPermissions();
      assert.equal(host.history.at(-1).state, 'delayed');
      await delayed;
      assert.equal(host.history.at(-1).state, 'success');
    } finally {
      host.dispose();
      globalThis.window = priorWindow;
      globalThis.fetch = priorFetch;
    }
  });
}

for (const platform of ['android', 'ios']) test(`native ${platform} bridge is retained and callback delivers real SDK responses`, async () => {
  const previous = globalThis.window;
  const win = { location: { href: origin, host: 'localhost:5179' } };
  const postMessage = payload => win.__INHERITANCE_TEST_HOST_RECEIVE__(payload);
  const native = platform === 'android'
    ? { getPlatform: () => 'android', postMessage }
    : { messageHandlers: { minikit: { postMessage } } };
  if (platform === 'android') win.Android = native;
  else {
    win.__INHERITANCE_TEST_NATIVE_HOST__ = { platform: 'ios' };
    win.webkit = native;
  }
  globalThis.window = win;
  const host = installTestHost({ window: win, execute: () => { throw new Error('Unexpected executor call'); } });
  try {
    assert.equal(host.native, true);
    assert.equal(host.platform, platform);
    assert.equal(platform === 'android' ? win.Android : win.webkit, native);
    assert.equal(MiniKit.install('app_test_host').success, true);
    assert.equal((await MiniKit.getPermissions()).executedWith, 'minikit');
  } finally { host.dispose(); globalThis.window = previous; }
});

test('signer rejects a remote RPC and mismatched SIWE origin', async () => {
  const remote = createExecutor({ provider: { ...provider, _getConnection: () => ({ url: 'https://worldchain-mainnet.example/' }) }, accounts: { owner } });
  await assert.rejects(remote.execute({ command: 'wallet-auth' }, { origin }), /loopback RPC/);
  await assert.rejects(remote.setAutomine(false), /loopback RPC/);
  await assert.rejects(remote.mine(), /loopback RPC/);
  await assert.rejects(executor.execute({ command: 'wallet-auth', payload: { siweMessage: 'https://other.example wants you to sign in' } }, { origin }), /origin/);
});

test('user-operation lookup preserves the app confirmation AbortSignal', async () => {
  const win = { location: { href: origin }, fetch: globalThis.fetch };
  let lookupSignal;
  const host = installTestHost({ window: win, execute: async () => ({}),
    lookup: (_hash, { signal }) => { lookupSignal = signal; return new Promise(() => {}); },
  });
  try {
    const controller = new AbortController();
    const waiting = win.fetch(`https://developer.world.org/api/v2/minikit/userop/0x${'cd'.repeat(32)}`, { signal: controller.signal });
    await Promise.resolve();
    assert.equal(lookupSignal, controller.signal);
    controller.abort();
    await assert.rejects(waiting, error => error.name === 'AbortError');
  } finally { host.dispose(); }
});
