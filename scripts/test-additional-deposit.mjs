import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from '../app/node_modules/typescript/lib/typescript.js';
const require = createRequire(new URL('../app/package.json', import.meta.url));
const ethersPath = pathToFileURL(require.resolve('ethers')).href;
const { ethers } = require('ethers');
function compile(file, imports = {}) {
 let js = ts.transpileModule(readFileSync(new URL('../app/src/'+file, import.meta.url),'utf8'), { compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 for(const [from,to] of Object.entries({ethers:ethersPath,...imports})) js=js.replaceAll(`from "${from}"`,`from ${JSON.stringify(to)}`);
 return 'data:text/javascript;base64,'+Buffer.from(js).toString('base64');
}
const storage=compile('plan-storage.ts'), transactions=compile('transactions.ts');
const { ConfirmedTransactionFailure }=await import(transactions);
const {submitAdditionalDeposit,parseAdditionalDeposit,verifyAdditionalDeposit,confirmAdditionalDeposit}=await import(compile('additional-deposit.ts',{'./plan-storage':storage,'./transactions':transactions}));
const a=n=>'0x'+n.repeat(40), h=n=>'0x'+n.repeat(64);
const request={version:1,chainId:480,account:a('1'),factory:a('2'),vault:a('3'),asset:a('4'),symbol:'USDC',decimals:6,amount:'1000000',mode:'morpho',beforeBlock:10};
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS',name);}
const iface=new ethers.Interface(['event Transfer(address indexed from,address indexed to,uint256 value)','event Deposited(uint256 assets,uint256 shares)']);
const log=(name,args,address)=>({address,...iface.encodeEventLog(iface.getEvent(name),args)});
const receipt={status:1,hash:h('a'),blockNumber:11,confirmations:async()=>1,logs:[log('Transfer',[request.account,request.vault,1000000n],request.asset),log('Deposited',[1000000n,999n],request.vault)]};
function fixture(){let journal=null,sends=0;return {get saved(){return journal},get sends(){return sends},ports:{read:async()=>journal,save:async(r,previous)=>{assert.deepEqual(journal,previous);journal=structuredClone(r)},clear:async r=>{assert.deepEqual(journal,r);journal=null},send:async()=>{assert.ok(journal);sends++;return {ok:true,tx:{hash:h('a'),hashType:'transaction'}}},confirm:async()=>{}}};}
await test('receipt timeout survives reload and blocks a second send',async()=>{const f=fixture();f.ports.confirm=async()=>{throw Error('timeout')};await assert.rejects(submitAdditionalDeposit(request,f.ports));assert.equal(f.saved.txHash,h('a'));const reloaded=JSON.parse(JSON.stringify(f.saved));assert.ok(parseAdditionalDeposit(JSON.stringify(reloaded),request.account));await assert.rejects(submitAdditionalDeposit(request,f.ports));assert.equal(f.sends,1);});
await test('ambiguous submission and missing identifiers remain locked',async()=>{for(const response of [{ok:false,error:'interrupted',definitelyNotSubmitted:false},{ok:true,tx:{hashType:'user-operation'}},{ok:true,tx:{hash:'',hashType:'user-operation'}}]){const f=fixture();f.ports.send=async()=>response;f.ports.confirm=async r=>{assert.equal(r.txHash,undefined);throw Error('unknown')};await assert.rejects(submitAdditionalDeposit(request,f.ports));assert.ok(f.saved);await assert.rejects(submitAdditionalDeposit(request,f.ports));}});
await test('storage failure prevents opening the wallet',async()=>{const f=fixture();f.ports.save=async()=>{throw Error('unavailable')};await assert.rejects(submitAdditionalDeposit(request,f.ports));assert.equal(f.sends,0);});
await test('structured rejection and exact terminal revert permit a fresh attempt',async()=>{const f=fixture();f.ports.send=async()=>({ok:false,error:'rejected',definitelyNotSubmitted:true});await assert.rejects(submitAdditionalDeposit(request,f.ports));assert.equal(f.saved,null);f.ports.send=async()=>({ok:true,tx:{hash:h('a'),hashType:'transaction'}});f.ports.confirm=async()=>{throw new ConfirmedTransactionFailure('TRANSACTION_REVERTED',h('a'),'reverted')};await assert.rejects(submitAdditionalDeposit(request,f.ports));assert.equal(f.saved,null);f.ports.confirm=async()=>{};await submitAdditionalDeposit(request,f.ports);assert.equal(f.saved,null);});
await test('another transaction failure never clears the pending request',async()=>{const f=fixture();f.ports.confirm=async()=>{throw new ConfirmedTransactionFailure('TRANSACTION_REVERTED',h('b'),'other')};await assert.rejects(submitAdditionalDeposit(request,f.ports));assert.ok(f.saved);});
await test('receipt is exact and scoped, not a changed balance or another transfer',async()=>{assert.ok(verifyAdditionalDeposit(receipt,request));for(const patch of [{account:a('5')},{vault:a('5')},{asset:a('5')},{amount:'2'},{beforeBlock:11}])assert.equal(verifyAdditionalDeposit(receipt,{...request,...patch}),false);assert.equal(verifyAdditionalDeposit({...receipt,logs:receipt.logs.slice(0,1)},request),false);assert.equal(parseAdditionalDeposit(JSON.stringify(request),a('5')),null);assert.equal(parseAdditionalDeposit(JSON.stringify({...request,chainId:1}),request.account),null);});
await test('reopened pending request confirms its original receipt without sending',async()=>{const f=fixture();f.ports.confirm=async()=>{throw Error('offline')};await assert.rejects(submitAdditionalDeposit(request,f.ports));await confirmAdditionalDeposit({getNetwork:async()=>({chainId:480n}),getTransactionReceipt:async()=>receipt},f.saved,{timeoutMs:100,intervalMs:1});assert.equal(f.sends,1);await assert.rejects(confirmAdditionalDeposit({getNetwork:async()=>({chainId:1n})},f.saved));});
console.log(`${passed} additional-deposit lifecycle checks passed; no network or real funds`);
