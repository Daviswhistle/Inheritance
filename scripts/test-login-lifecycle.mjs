import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from '../app/node_modules/typescript/lib/typescript.js';
const source = await readFile(new URL('../app/src/auth.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const storage = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) }; };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(r => setTimeout(r, 0));
const address = '0x' + '1'.repeat(40);
const signed = { ok: true, address, message: 'test', signature: 'test' };
const nonce = 'a'.repeat(64);
globalThis.location = { origin: 'https://example.test' };
const verified = () => {
  const iat = Math.floor(Date.now()/1000), exp = iat + 3600;
  return new Response(JSON.stringify({ isValid: true, address, token: `v1.${Buffer.from(JSON.stringify({ sub: address, aud: location.origin, iat, exp })).toString('base64url')}.${'a'.repeat(64)}`, expiresAt: exp*1000 }));
};
let serial = 0;
async function fresh() {
  globalThis.sessionStorage = storage(); globalThis.localStorage = storage();
  return import('data:text/javascript;base64,' + Buffer.from(js + `\n// ${serial++}`).toString('base64'));
}
function mockFetch(verify = async () => verified()) {
  let verifies = 0;
  globalThis.fetch = async url => url === '/api/auth/nonce' ? new Response(JSON.stringify({ nonce })) : (verifies++, verify());
  return () => verifies;
}
{
  const auth = await fresh(), response = deferred(); let nativeCalls = 0;
  globalThis.fetch = () => response.promise;
  const result = await auth.signInWithWorldApp(async () => { nativeCalls++; return signed; }, { timeoutMs: 20 });
  assert.equal(result.requiresReload, true);
  response.resolve(new Response(JSON.stringify({ nonce }))); await tick();
  assert.equal(nativeCalls, 0); assert.equal(auth.readSessionAddress(), null);
}
{
  const auth = await fresh(), native = deferred(); const verifies = mockFetch(); let calls = 0;
  const first = auth.signInWithWorldApp(() => { calls++; return native.promise; }, { timeoutMs: 20 });
  await tick();
  assert.equal((await auth.signInWithWorldApp(() => { calls++; return Promise.resolve(signed); })).ok, false);
  const result = await first;
  assert.equal(result.requiresReload, true);
  native.resolve(signed); await tick();
  assert.equal(verifies(), 0); assert.equal(auth.readSessionAddress(), null); assert.equal(calls, 1);
  assert.equal((await auth.signInWithWorldApp(async () => signed)).requiresReload, true);
}
{
  const auth = await fresh(), response = deferred(), started = deferred();
  mockFetch(() => { started.resolve(); return response.promise; });
  const login = auth.signInWithWorldApp(async () => signed, { timeoutMs: 20 });
  await started.promise;
  assert.equal((await login).requiresReload, true);
  response.resolve(verified()); await tick();
  assert.equal(auth.readSessionAddress(), null);
}
for (const stage of ['signature', 'verify']) {
  const auth = await fresh(), delayed = deferred(), started = deferred();
  mockFetch(stage === 'verify' ? () => { started.resolve(); return delayed.promise; } : undefined);
  const login = auth.signInWithWorldApp(() => { if (stage === 'signature') { started.resolve(); return delayed.promise; } return Promise.resolve(signed); });
  await started.promise;
  auth.clearSession();
  assert.equal((await login).ok, false);
  delayed.resolve(stage === 'signature' ? signed : verified()); await tick();
  assert.equal(auth.readSessionAddress(), null, `logout invalidates pending ${stage}`);
}
{
  const auth = await fresh(); mockFetch();
  assert.equal((await auth.signInWithWorldApp(async () => signed)).ok, true);
  assert.equal(auth.readSessionAddress(), address);
  auth.clearSession(); assert.equal(auth.readSessionAddress(), null);
}
console.log('Login lifecycle: timeout, duplicate guard, late signature/verification, logout, and success passed');
