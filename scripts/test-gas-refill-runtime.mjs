import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../gas-refill/src/worker.mjs';
let executions=0, reads=0;
const env={GAS_REFILL_EXECUTOR:{getByName(name){assert.equal(name,'operator-funding-v1');return {
  async runCycle(){executions++;return {enabled:true,reason:'pending'};},
  async readHealth(){reads++;return {enabled:true,reason:'ready'};},
};}}};
for(const [path,method] of [['/run','GET'],['/api/health','POST'],['/internal/runCycle','POST'],['/__scheduled','GET']]) {
  assert.equal((await worker.fetch(new Request('https://example.test'+path,{method}),env)).status,404);
}
const health=await (await worker.fetch(new Request('https://example.test/api/health'),env)).json();
assert.equal(health.version,'gas-funding-atomic-2');assert.equal(health.gasRefill.executionRuntime,'durable_object');
assert.equal(reads,1);assert.equal(executions,0);
console.log('PASS public requests can read health but cannot trigger financial execution');
const waits=[];await worker.scheduled({},env,{waitUntil:p=>waits.push(p)});await Promise.all(waits);
assert.equal(executions,1);assert.equal(waits.length,1);
console.log('PASS Cron delegates one financial cycle to the dedicated executor');
const missing=await (await worker.fetch(new Request('https://example.test/api/health'),{})).json();
assert.equal(missing.gasRefill.enabled,false);assert.equal(missing.gasRefill.reason,'missing_executor');
await worker.scheduled({}, {}, {waitUntil(){throw new Error('unbound executor must not execute');}});
console.log('PASS missing executor fails closed without local signing fallback');
const failed={GAS_REFILL_EXECUTOR:{getByName(){return {async readHealth(){throw new Error('unavailable');}};}}};
assert.equal((await (await worker.fetch(new Request('https://example.test/api/health'),failed)).json()).gasRefill.reason,'executor_unavailable');
console.log('PASS failed executor health remains unavailable rather than fabricated ready');
// Exercise the real executor methods and finance module with disabled local
// configuration. Only Cloudflare's base class is adapted for the Node runtime.
let source=readFileSync(new URL('../gas-refill/src/runtime.mjs',import.meta.url),'utf8');
source=source.replace('import { DurableObject } from "cloudflare:workers";', 'class DurableObject { constructor(ctx, env) { this.ctx=ctx; this.env=env; } }');
for(const file of ['funding.mjs','worker.mjs'])source=source.replace('"./'+file+'"',JSON.stringify(new URL('../gas-refill/src/'+file,import.meta.url).href));
const module=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const executor=new module.GasRefillExecutor({}, {GAS_REFILL_ENABLED:'false'});
assert.equal((await executor.runCycle()).reason,'disabled');assert.equal((await executor.readHealth()).reason,'disabled');
const config=readFileSync(new URL('../gas-refill/wrangler.toml',import.meta.url),'utf8');
assert.match(config,/main = "src\/runtime.mjs"/);assert.match(config,/new_sqlite_classes = \["GasRefillExecutor"\]/);
console.log('PASS real executor uses the financial module and declared SQLite deployment binding');
console.log('5 passed, 0 failed');
