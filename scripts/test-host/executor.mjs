/** Node-only signer executor for a disposable, loopback Anvil chain. */
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../app/package.json', import.meta.url));
const { Interface, keccak256, toUtf8Bytes, isAddress } = require('ethers');
const batch = new Interface(['function execute((address to,bytes data,uint256 value)[] calls)']);

export function createExecutor({ provider, accounts, batchWallet }) {
  const receipts = new Map();
  let queue = Promise.resolve();
  let sequence = 0;
  let automine = true;
  async function assertLocal() {
    const connection = provider._getConnection?.();
    if (!connection || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(connection.url).hostname)) throw new Error('Test signer requires a loopback RPC.');
    const client = await provider.send('web3_clientVersion', []);
    const chain = Number(await provider.send('eth_chainId', []));
    if (!/anvil/i.test(client) || ![480, 31337].includes(chain)) throw new Error('Test signer requires Anvil chain 480 or 31337.');
    return chain;
  }
  async function run(envelope, { role = 'owner', origin } = {}) {
    const signer = accounts[role];
    if (!signer || !['owner', 'heir'].includes(role)) throw new Error('Unknown test wallet role.');
    const chainId = await assertLocal();
    const address = await signer.getAddress();
    const { command, payload, version } = envelope;
    if (command === 'wallet-auth') {
      const unsigned = payload?.siweMessage;
      if (!origin || typeof unsigned !== 'string' || !unsigned.startsWith(`${origin} wants you to sign in with your Ethereum account:\n{address}\n`)) throw new Error('Wallet auth origin does not match the test app.');
      const uri = unsigned.match(/^URI: (.+)$/m)?.[1];
      if (!uri || new URL(uri).origin !== origin) throw new Error('Wallet auth URI does not match the test app.');
      const message = unsigned.replace('\n{address}\n', `\n${address}\n`);
      return { status: 'success', version, address, message, signature: await signer.signMessage(message) };
    }
    if (command !== 'send-transaction' || version !== 2) throw new Error('Unsupported executor command.');
    if (payload?.chainId !== chainId) throw new Error('Transaction chain does not match the local test chain.');
    if (!isAddress(batchWallet) || await provider.getCode(batchWallet) === '0x') throw new Error('Atomic test wallet is not deployed.');
    if (!Array.isArray(payload.transactions) || !payload.transactions.length || payload.transactions.length > 20) throw new Error('Invalid test transaction batch.');
    const calls = payload.transactions.map(tx => {
      if (!isAddress(tx.to) || typeof tx.data !== 'string' || !/^0x([0-9a-f]{2})*$/i.test(tx.data)) throw new Error('Invalid transaction calldata.');
      const value = BigInt(tx.value ?? '0');
      if (value < 0n) throw new Error('Negative transaction value.');
      return { to: tx.to, data: tx.data, value };
    });
    const nonce = await signer.getNonce('pending');
    const code = await provider.getCode(address);
    const expected = `0xef0100${batchWallet.slice(2)}`.toLowerCase();
    if (code !== '0x' && code.toLowerCase() !== expected) throw new Error('Unexpected test wallet delegation.');
    const authorization = code === '0x' ? await signer.authorize({ address: batchWallet, chainId, nonce: nonce + 1 }) : null;
    // A single outer transaction preserves World App batch rollback semantics.
    // Approve + deposit must never silently become independent transactions.
    const transaction = await signer.sendTransaction({
      to: address, nonce, data: batch.encodeFunctionData('execute', [calls]),
      gasLimit: 12_000_000n,
      ...(authorization ? { type: 4, authorizationList: [authorization] } : {}),
    });
    // The operation identifier exists before confirmation. With controlled
    // mining disabled, release the signing queue now so a test can mine/restart
    // its native client while this real transaction is still pending.
    const userOpHash = keccak256(toUtf8Bytes(`inheritance-test-host:${++sequence}:${transaction.hash}`));
    receipts.set(userOpHash.toLowerCase(), transaction.hash);
    if (automine) {
      try { await transaction.wait(); }
      catch (error) { if (error.receipt?.status !== 0) throw error; }
    }
    return { status: 'success', version: 2, userOpHash, from: address, timestamp: new Date().toISOString() };
  }
  return {
    execute(envelope, context) {
      // One signing queue also avoids duplicate nonce races across devices.
      const task = queue.then(() => run(envelope, context));
      queue = task.catch(() => {});
      return task;
    },
    async lookup(hash) {
      const transactionHash = receipts.get(String(hash).toLowerCase());
      if (!transactionHash) return { status: 'pending' };
      const receipt = await provider.getTransactionReceipt(transactionHash);
      if (!receipt) return { status: 'pending' };
      return { status: receipt.status === 0 ? 'failed' : 'success', transaction_hash: receipt.hash };
    },
    get automine() { return automine; },
    async setAutomine(enabled) {
      if (typeof enabled !== 'boolean') throw new Error('Mining enabled must be a boolean.');
      await assertLocal();
      await provider.send('evm_setAutomine', [enabled]);
      automine = enabled;
    },
    async mine() {
      await assertLocal();
      await provider.send('evm_mine', []);
    },
  };
}
