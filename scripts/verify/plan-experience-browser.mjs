import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir=process.env.VERIFY_TMP || '/tmp/inheritance-plan-experience-browser';
mkdirSync(dir,{recursive:true});
let passed=0;const pass=(label)=>{passed++;console.log('PASS '+label);};
process.env.VERIFY_TMP=dir;
const require=createRequire(root+'/app/package.json');
const {Contract,ContractFactory,JsonRpcProvider,parseUnits}=require('ethers');
const {launch,ACCOUNTS,HELPERS}=await import(root+'/scripts/verify/drv.mjs');
const evidence={suite:'complete-plan-experience',localOnly:true,snapshots:[],findings:{}};
let anvil,provider,vite; const pages=[];
async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function until(fn,label,ms=25000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(150);}throw Error('Timed out: '+label);}
function artifact(name,file=name){return JSON.parse(readFileSync(`${root}/out/${file}.sol/${name}.json`,'utf8'));}
async function deploy(name,args,signer,file=name){const a=artifact(name,file);const c=await new ContractFactory(a.abi,a.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;}
async function click(p,label){await until(()=>p.ev(`const b=[...document.querySelectorAll('button')].find(x=>x.offsetParent!==null&&!x.disabled&&x.textContent.trim()===${JSON.stringify(label)});if(!b)return false;b.click();return true;`),'click '+label);}
async function tab(p,label){assert.equal(await p.ev(`return __q.tab(${JSON.stringify(label)})`),'ok');await sleep(200);}
async function snap(p,label){await p.ev('window.scrollTo(0,0);return true');await sleep(300);const data=await p.ev(`return {text:document.body.innerText,headings:[...document.querySelectorAll('h1,h2,h3')].map(x=>x.textContent),buttons:[...document.querySelectorAll('button')].filter(x=>x.offsetParent!==null).map(x=>({text:x.textContent.trim(),disabled:x.disabled,y:Math.round(x.getBoundingClientRect().top)})),inputs:[...document.querySelectorAll('input')].filter(x=>x.offsetParent!==null).map(x=>({id:x.id,placeholder:x.placeholder})),height:document.documentElement.scrollHeight,width:document.documentElement.scrollWidth};`);data.label=label;data.shot=await p.shot(label);evidence.snapshots.push(data);console.log('CAPTURE '+label+' '+data.height+'px '+data.headings.join(' / '));return data;}
try{
 const port=await freePort();const rpc=`http://127.0.0.1:${port}`;
 anvil=spawn('anvil',['--host','127.0.0.1','--port',String(port),'--chain-id','480','--silent'],{stdio:'ignore'});
 await until(async()=>{try{return (await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]})})).ok;}catch{return false;}},'Anvil');
 provider=new JsonRpcProvider(rpc,480,{cacheTimeout:-1,batchMaxCount:1});
 const owner=await provider.getSigner(0),heir=await provider.getSigner(1);
 const wld=await deploy('MockGasRefillERC20',['Worldcoin','WLD',18],owner,'MockGasRefill');
 const usdc=await deploy('MockGasRefillERC20',['USD Coin','USDC',6],owner,'MockGasRefill');
 const plain=await deploy('InheritanceVaultWLDFactoryOnePerOwner',[wld.target],owner);
 const wldStrategy=await deploy('MockERC4626',[wld.target],owner);
 const usdcStrategy=await deploy('MockRe7USDC',[usdc.target],owner);
 const wf=await deploy('InheritanceVaultMorphoFactory',[wld.target,wldStrategy.target,ACCOUNTS.a2.a,1000],owner);
 const uf=await deploy('InheritanceVaultUSDCFactory',[usdc.target,usdcStrategy.target,wld.target,ACCOUNTS.a2.a,1000],owner);
 await provider.send('anvil_setCode',['0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae',artifact('MockMerklDistributor').deployedBytecode.object]);
 await (await wld.mint(ACCOUNTS.a0.a,parseUnits('100',18))).wait();
 await (await usdc.mint(ACCOUNTS.a0.a,parseUnits('100',6))).wait();
 for(const [f,token,amount,decimals] of [[wf,wld,'10',18],[uf,usdc,'20',6]]){
  await(await f.createVault(ACCOUNTS.a1.a,30*86400)).wait();
  await(await token.approve(f.target,parseUnits(amount,decimals))).wait();
  await(await f.depositWithMinShares(parseUnits(amount,decimals),1)).wait();
 }
 const wa=await wf.vaultOf(ACCOUNTS.a0.a),ua=await uf.vaultOf(ACCOUNTS.a0.a);
 const wc=new Contract(wa,artifact('InheritanceVaultMorpho').abi,owner);
 const uc=new Contract(ua,artifact('InheritanceVaultUSDC').abi,owner);
 const initialSnapshot=await provider.send('evm_snapshot',[]);
 const factories=[plain.target,wf.target,uf.target];
 for(const k of Object.keys(process.env))if(k.startsWith('VITE_'))delete process.env[k];
 Object.assign(process.env,{VITE_FACTORY_ADDRESS:plain.target,VITE_FACTORY_DEPLOY_BLOCK:'1',VITE_WLD_ADDRESS:wld.target,VITE_RPC:rpc,VITE_LEGACY_FACTORY_ADDRESS:'',VITE_LEGACY_FACTORY_DEPLOY_BLOCK:'',VITE_NOTIFY_BACKEND_URL:'https://unified-notify.example',VITE_REQUIRE_VERIFY:'false',VITE_FACTORY_RELEASE_SUPPORTED:'true',VITE_YIELD_FACTORY_ADDRESS:wf.target,VITE_YIELD_FACTORY_DEPLOY_BLOCK:'1',VITE_MORPHO_VAULT_ADDRESS:wldStrategy.target,VITE_USDC_ADDRESS:usdc.target,VITE_USDC_YIELD_FACTORY_ADDRESS:uf.target,VITE_USDC_YIELD_FACTORY_DEPLOY_BLOCK:'1',VITE_USDC_MORPHO_VAULT_ADDRESS:usdcStrategy.target});
 const {createServer:createVite}=await import(root+'/app/node_modules/vite/dist/node/index.js');
 const webPort=await freePort();vite=await createVite({root:root+'/app',configFile:root+'/app/vite.config.e2e.ts',envDir:false,logLevel:'error',server:{host:'127.0.0.1',port:webPort,strictPort:true}});await vite.listen();
 const url=vite.resolvedUrls.local[0];
 const src=readFileSync(root+'/scripts/verify/unified-plan-browser.mjs','utf8');
 const fixture=src.slice(src.indexOf('function localPublicFixtures()'),src.indexOf('\n  const exampleNames'));
 const preload=`window.__E2E_RPC__=${JSON.stringify(rpc)};window.__E2E_STRATEGIES__=${JSON.stringify([wldStrategy.target,usdcStrategy.target])};window.__MONITOR_FACTORIES__=${JSON.stringify(factories)};window.__E2E_WLD__=${JSON.stringify(wld.target)};window.__E2E_EXTERNAL_FETCHES__=[];window.__E2E_USERNAMES__=${JSON.stringify({[ACCOUNTS.a0.a.toLowerCase()]:'amy',[ACCOUNTS.a1.a.toLowerCase()]:'alex',[ACCOUNTS.a3.a.toLowerCase()]:'ben'})};(${fixture})();window.__MONITOR_REGISTERED__=${JSON.stringify({[wa.toLowerCase()]:true,[ua.toLowerCase()]:true})};(function(){${HELPERS}})();`;
 async function open(pk,link='',ko=false){const p=await launch({pk,url:url+link,preload:preload+(ko?`localStorage.setItem('inheritance:locale','ko');`:'')});pages.push(p);await p.ev(HELPERS);if(await p.ev(`return document.body.innerText.includes('Continue with World App')`))await click(p,'Continue with World App');await until(()=>p.ev(`return document.querySelectorAll('.tab-item').length>0`),'sign-in');await sleep(1800);return p;}
 const op=await open(ACCOUNTS.a0.pk);await tab(op,'Plan');await until(()=>op.ev(`return !!document.getElementById('period-change')`),'owner settings');const ownerInitial=await snap(op,'owner-plan-initial');
 assert.ok(!ownerInitial.headings.includes('Set up your plan'));pass('owner settings do not duplicate first-time setup');
 const hp=await open(ACCOUNTS.a1.pk);await until(()=>hp.ev(`return document.querySelectorAll('.inheritance-asset').length===2`),'grouped heir discovery');const discovered=await snap(hp,'heir-entry-no-link');
 assert.equal(await hp.ev(`return document.querySelectorAll('.heir-plan-card').length`),1);
 assert.ok(!discovered.headings.includes('Set up your plan'));assert.ok(discovered.text.includes('From @amy'));pass('two currencies grouped under the actual owner, no owner input form');
 for(const symbol of ['WLD','USDC']){
  await click(hp,'View '+symbol);await until(()=>hp.ev(`return __q.tabs().includes('Assets')`),'discovered asset navigation');await tab(hp,'Assets');
  await until(()=>hp.ev(`return [...document.querySelectorAll('h2,h3')].some(x=>x.textContent===${JSON.stringify(symbol+' balance')})`),'selected '+symbol+' balance');
  assert.equal(await hp.ev(`return !!document.getElementById('deposit-amount')`),false);await tab(hp,'Plan');
 }
 assert.equal((await hp.ev('return window.__E2E_MINIKIT__.txLog()')).length,0);pass('a discovered heir opens each currency and its asset details without a link or wallet request');
 await provider.send('evm_increaseTime',[10*86400]);await provider.send('evm_mine',[]);
 const pingBefore=await wc.lastPing();
 await op.ev(`return __q.setInput('period-change','7')`);await click(op,'Change period');
 assert.equal(await wc.heartbeatInterval(),30n*86400n);assert.equal(await uc.heartbeatInterval(),30n*86400n);pass('settings review sends no transaction');
 await click(op,'Confirm changes');
 await until(async()=>await wc.heartbeatInterval()===7n*86400n && await uc.heartbeatInterval()===7n*86400n,'both shortened periods');
 await until(()=>op.ev(`return document.body.innerText.includes('Plan settings confirmed for all listed assets.')`),'settings confirmation');
 assert.equal(await wc.isExpired(),false);assert.equal(await uc.isExpired(),false);assert.ok(await wc.lastPing()>pingBefore);assert.equal(await wc.lastPing(),await uc.lastPing());
 const periodCalls=await op.ev('return window.__E2E_MINIKIT__.lastCalldata()');assert.equal(periodCalls.length,4);pass('one approval changes both periods and checks in atomically');
 await snap(op,'owner-period-shortened');
 await tab(op,'Home');await click(op,'Check in');await until(()=>op.ev(`return document.body.innerText.includes('Checked in to all 2 active vaults.')`),'immediate check-in');pass('Home can check in immediately after editing, without reload');
 await tab(op,'Plan');await until(()=>op.ev(`return !!document.getElementById('new-heir-input')`),'heir input');await op.ev(`return __q.setInput('new-heir-input',${JSON.stringify(ACCOUNTS.a3.a)})`);await click(op,'Update heir');
 assert.equal(await wc.heir(),ACCOUNTS.a1.a);await click(op,'Confirm changes');await until(async()=>await wc.heir()===ACCOUNTS.a3.a && await uc.heir()===ACCOUNTS.a3.a,'both heirs updated');await until(()=>op.ev(`return !!document.getElementById('new-heir-input') && document.getElementById('new-heir-input').value===''`),'settings final UI');
 assert.equal((await op.ev('return window.__E2E_MINIKIT__.lastCalldata()')).length,2);pass('heir changes across WLD and USDC in one approval');await snap(op,'owner-heir-updated-both');
 // Race: a second device changes a setting after review. The review must refresh without submitting.
 await op.ev(`return __q.setInput('period-change','14')`);await click(op,'Change period');await until(()=>op.ev(`return !!document.getElementById('settings-review-title')`),'race review ready');await (await uf.changeMyPeriod(8*86400)).wait();
 const beforeRace=await op.ev('return window.__E2E_MINIKIT__.lastCalldata()');await click(op,'Confirm changes');await until(()=>op.ev(`return document.body.innerText.includes('Your plan changed since review.')`),'settings freshness rejection');assert.deepEqual(await op.ev('return window.__E2E_MINIKIT__.lastCalldata()'),beforeRace);pass('a changed cross-asset review cannot authorize stale settings');
 await click(op,'Confirm changes');await until(async()=>await wc.heartbeatInterval()===14n*86400n && await uc.heartbeatInterval()===14n*86400n,'refreshed review');
 await until(()=>op.ev(`return !!document.getElementById('new-heir-input')`),'review completion');
 // Storage failure must precede wallet handoff, and a response loss must recover the original request.
 await op.ev(`return __q.setInput('period-change','21')`);await click(op,'Change period');await until(()=>op.ev(`return !!document.getElementById('settings-review-title')`),'recovery settings review');
 const beforeStorage=await op.ev('return window.__E2E_MINIKIT__.lastCalldata()');
 await op.ev(`window.__SETTINGS_SET__=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('inheritance:settings-request:'))throw Error('E2E storage unavailable');return window.__SETTINGS_SET__.call(this,k,v)};return true`);
 await click(op,'Confirm changes');await until(()=>op.ev(`return document.body.innerText.includes('E2E storage unavailable')`),'storage rejection');
 assert.deepEqual(await op.ev('return window.__E2E_MINIKIT__.lastCalldata()'),beforeStorage);assert.equal(await wc.heartbeatInterval(),14n*86400n);assert.equal(await uc.heartbeatInterval(),14n*86400n);pass('settings recovery storage failure sends no wallet request');
 await op.ev(`Storage.prototype.setItem=window.__SETTINGS_SET__;const fixture=await import('/src/test/minikit-stub.ts');window.__SETTINGS_SEND__=fixture.MiniKit.sendTransaction;window.__SETTINGS_REQUESTS__=0;fixture.MiniKit.sendTransaction=async request=>{window.__SETTINGS_REQUESTS__++;await window.__SETTINGS_SEND__(request);return {executedWith:'minikit',data:{status:'fail',error:'E2E response lost'}}};return true`);
 await click(op,'Confirm changes');await until(async()=>await wc.heartbeatInterval()===21n*86400n && await uc.heartbeatInterval()===21n*86400n,'response-lost update execution');
 await until(()=>op.ev(`return [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Check pending changes'&&!b.disabled)`),'durable settings recovery action');
 assert.equal(await op.ev(`return JSON.parse(sessionStorage.getItem('inheritance:settings-request:'+${JSON.stringify(ACCOUNTS.a0.a.toLowerCase())})).txHash===undefined`),true);
 await click(op,'Check pending changes');await until(()=>op.ev(`return !!document.getElementById('period-change')`),'receipt-based settings recovery');assert.equal(await op.ev('return window.__SETTINGS_REQUESTS__'),1);pass('a lost settings response recovers the canonical multi-asset receipt without a second send');
 await op.ev(`const fixture=await import('/src/test/minikit-stub.ts');fixture.MiniKit.sendTransaction=window.__SETTINGS_SEND__;return true`);
 // Rejected wallet handoff must remain editable.
 await op.ev(`return __q.setInput('period-change','14')`);await click(op,'Change period');await until(()=>op.ev(`return !!document.getElementById('settings-review-title')`),'rejection review');
 await op.ev(`const fixture=await import('/src/test/minikit-stub.ts');fixture.MiniKit.sendTransaction=async()=>({executedWith:'minikit',data:{status:'fail',error_code:'user_rejected',error:'E2E user rejection'}});return true`);
 await click(op,'Confirm changes');await until(()=>op.ev(`return !!document.getElementById('settings-review-title') && [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Confirm changes'&&!b.disabled)`),'editable rejected settings');
 assert.equal(await op.ev(`return sessionStorage.getItem('inheritance:settings-request:'+${JSON.stringify(ACCOUNTS.a0.a.toLowerCase())})`),null);pass('wallet rejection clears only the proven-unsent request');
 await op.ev(`const fixture=await import('/src/test/minikit-stub.ts');fixture.MiniKit.sendTransaction=window.__SETTINGS_SEND__;return true`);await click(op,'Confirm changes');await until(async()=>await wc.heartbeatInterval()===14n*86400n && await uc.heartbeatInterval()===14n*86400n,'post-rejection settings confirm');
 // Restore isolated fixtures to the first heir for the receiving scenarios.
 await (await wf.updateMyHeir(ACCOUNTS.a1.a)).wait();await(await uf.updateMyHeir(ACCOUNTS.a1.a)).wait();
 const linked=await open(ACCOUNTS.a1.pk,`?vault=${ua}`);await until(()=>linked.ev(`return document.querySelectorAll('.inheritance-asset').length===2`),'linked whole-plan');await snap(linked,'heir-linked-active');pass('a single asset link opens all assets left to the same heir');
 await linked.ev(`const s=document.querySelector('.locale-picker select');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(s,'ko');s.dispatchEvent(new Event('change',{bubbles:true}));return true`);const korean=await snap(linked,'heir-linked-active-ko');
 assert.ok(korean.text.includes('상속 수령 절차'));assert.ok(!korean.text.includes('Inheritance Status'));assert.ok(!korean.text.includes('Set up your plan'));pass('Korean heir path uses translated status and next steps');
 await linked.ev(`const s=document.querySelector('.locale-picker select');const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(s,'en');s.dispatchEvent(new Event('change',{bubbles:true}));return true`);
 await provider.send('evm_increaseTime',[15*86400]);await provider.send('evm_mine',[]);await linked.send('Page.reload');await sleep(2200);await linked.ev(HELPERS);await click(linked,'File claim');
 await until(async()=>await wc.claimFiledAt()>0n && await uc.claimFiledAt()>0n,'combined claim');await until(()=>linked.ev(`return document.querySelectorAll('.state-waiting').length===2`),'review window UI');assert.equal((await linked.ev('return window.__E2E_MINIKIT__.lastCalldata()')).length,2);await until(()=>linked.ev(`return document.body.innerText.includes('Claim confirmed for the listed assets.')`),'canonical claim events');pass('one wallet approval files both claims and verifies both factory events');await snap(linked,'heir-claim-wait');
 assert.equal(await linked.ev(`return [...document.querySelectorAll('button')].some(b=>b.offsetParent!==null&&b.textContent.trim()==='Complete inheritance')`),false);pass('no premature transfer action during the seven-day review');
 await provider.send('evm_increaseTime',[7*86400+10]);await provider.send('evm_mine',[]);await (await usdcStrategy.setLiquidity(0)).wait();
 await linked.send('Page.reload');await sleep(2200);await linked.ev(HELPERS);await click(linked,'Complete inheritance');await until(async()=>await wc.claimedAt()>0n && await uc.claimedAt()>0n,'combined inheritance');await until(()=>linked.ev(`return document.querySelectorAll('.receipt-link').length===2`),'both verified receipt UI');
 assert.equal((await linked.ev('return window.__E2E_MINIKIT__.lastCalldata()')).length,2);pass('one approval completes both assets and verifies both payouts');
 assert.equal(await wld.balanceOf(ACCOUNTS.a1.a),parseUnits('10',18));assert.equal(await usdc.balanceOf(ACCOUNTS.a1.a),0n);assert.equal(await usdcStrategy.balanceOf(ACCOUNTS.a1.a),parseUnits('20',18));
 const paid=await snap(linked,'heir-completed-cash-and-shares');assert.match(paid.text,/10(?:\.0)? WLD/);assert.ok(paid.text.includes('invested shares received'));pass('cash receipt and liquidity-limited invested shares remain distinct');
 const reopened=await open(ACCOUNTS.a1.pk);await until(()=>reopened.ev(`return document.querySelectorAll('.receipt-link').length===2`),'reopen history');await snap(reopened,'heir-reopen-after-completion');pass('verified completed receipts are rediscovered after a fresh browser sign-in');
 await linked.ev(`window.__SETTINGS_GET__=Storage.prototype.getItem;Storage.prototype.getItem=function(k){if(k.startsWith('inheritance:settings-request:'))throw Error('E2E settings storage unavailable');return window.__SETTINGS_GET__.call(this,k)};return true`);
 await (await usdcStrategy.setLiquidity(parseUnits('20',6))).wait();await click(linked,'Redeem available shares to USDC');await until(async()=>await usdc.balanceOf(ACCOUNTS.a1.a)===parseUnits('20',6),'USDC redemption');
 pass('settings recovery storage failure does not block wallet-share redemption');
 await linked.ev('Storage.prototype.getItem=window.__SETTINGS_GET__;return true');
 await until(()=>linked.ev(`return document.body.innerText.includes('Available receipt shares redeemed to USDC.') && !document.body.innerText.includes('Invested assets in your wallet · USDC')`),'redeemed UI convergence');await snap(linked,'heir-usdc-redeemed');pass('liquid shares redeem without another service fee and UI converges');
 await linked.send('Emulation.setDeviceMetricsOverride',{width:320,height:760,deviceScaleFactor:1,mobile:true});const narrow=await snap(linked,'heir-320');assert.ok(narrow.width<=320);pass('receipt and asset grouping fit a 320px screen');
 evidence.findings={periodCalls,combinedCashAndShares:true,paidReceipt:paid.text};
 evidence.externalRequests=[];evidence.runtimeErrors=[];
 async function closeCheckedPages(){for(const p of pages.splice(0)){evidence.externalRequests.push(...await p.ev('return window.__E2E_EXTERNAL_FETCHES__||[]'));evidence.runtimeErrors.push(...await p.ev('return window.__E2E_ERRS__||[]'));await p.close();}}
 await closeCheckedPages();assert.equal(await provider.send('evm_revert',[initialSnapshot]),true);
 const recoverySnapshot=await provider.send('evm_snapshot',[]);
 // Shared controls must follow the whole owned plan, including when the selected asset has paid out.
 await provider.send('evm_increaseTime',[31*86400]);await provider.send('evm_mine',[]);
 await(await wf.connect(heir).fileClaimFor(wa)).wait();await provider.send('evm_increaseTime',[7*86400+1]);await provider.send('evm_mine',[]);await(await wf.connect(heir).finalizeClaimFor(wa)).wait();
 const partial=await open(ACCOUNTS.a0.pk,`?vault=${wa}`);await tab(partial,'Plan');await until(()=>partial.ev(`return !!document.getElementById('period-change')`),'shared editor after WLD payout');
 assert.ok(await wc.claimedAt()>0n);assert.equal(await uc.claimedAt(),0n);assert.ok((await snap(partial,'owner-wld-paid-usdc-remains')).text.includes('WLD inheritance has completed'));pass('a completed selected WLD does not hide settings for the remaining USDC');
 await tab(partial,'Home');await click(partial,'Check in');await until(()=>partial.ev(`return document.body.innerText.includes('Checked in to all 1 active vaults.')`),'remaining USDC renewed');
 await tab(partial,'Plan');await partial.ev(`return __q.setInput('period-change','14')`);await click(partial,'Change period');await click(partial,'Confirm changes');await until(()=>partial.ev(`return document.body.innerText.includes('Plan settings confirmed for all listed assets.')`),'remaining shared edit confirmed');
 assert.equal(await wc.heartbeatInterval(),30n*86400n);assert.equal(await uc.heartbeatInterval(),14n*86400n);assert.equal((await partial.ev('return window.__E2E_MINIKIT__.lastCalldata()')).length,2);pass('remaining USDC can be renewed and edited without changing completed WLD');
 await until(()=>partial.ev(`return document.getElementById('period-change')?.value==='14'`),'remaining USDC interval displayed');
 await closeCheckedPages();assert.equal(await provider.send('evm_revert',[recoverySnapshot]),true);
 // A historical basic slot must not prevent proof of an already successful settings receipt.
 const basicCreated=await(await plain.createVault(ACCOUNTS.a1.a,30*86400)).wait();const ba=await plain.vaultOf(ACCOUNTS.a0.a);
 const recovery=await open(ACCOUNTS.a0.pk);await tab(recovery,'Plan');await until(()=>recovery.ev(`return !!document.getElementById('period-change')`),'basic and yield settings');
 await recovery.ev(`return __q.setInput('period-change','14')`);await click(recovery,'Change period');
 await recovery.ev(`const fixture=await import('/src/test/minikit-stub.ts');window.__RECOVERY_SEND__=fixture.MiniKit.sendTransaction;fixture.MiniKit.sendTransaction=async request=>{await window.__RECOVERY_SEND__(request);return {executedWith:'minikit',data:{status:'fail',error:'E2E response lost'}}};return true`);
 await recovery.ev(`const e=await import('/node_modules/.vite/deps/ethers.js');window.__BLOCK_NUMBER__=e.JsonRpcProvider.prototype.getBlockNumber;e.JsonRpcProvider.prototype.getBlockNumber=async function(){if(!window.__STALE_HEAD__){window.__STALE_HEAD__=true;return ${basicCreated.blockNumber-1}}return window.__BLOCK_NUMBER__.call(this)};return true`);
 await click(recovery,'Confirm changes');await until(async()=>await wc.heartbeatInterval()===14n*86400n && await uc.heartbeatInterval()===14n*86400n,'three targets submitted');
 await until(()=>recovery.ev(`return !!sessionStorage.getItem('inheritance:settings-request:'+${JSON.stringify(ACCOUNTS.a0.a.toLowerCase())}) && [...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Check pending changes'&&!b.disabled)`),'saved three-target request');
 const original=await recovery.ev(`return JSON.parse(sessionStorage.getItem('inheritance:settings-request:'+${JSON.stringify(ACCOUNTS.a0.a.toLowerCase())}))`);assert.equal(original.targets.length,3);assert.ok(original.targets.some(t=>t.vault===ba));
 await recovery.ev(`const e=await import('/node_modules/.vite/deps/ethers.js');e.JsonRpcProvider.prototype.getBlockNumber=window.__BLOCK_NUMBER__;return true`);
 assert.ok(original.beforeBlock>=basicCreated.blockNumber);pass('settings registration proof records a fresh boundary even if the provider cached a pre-creation head');
 await provider.send('evm_increaseTime',[15*86400]);await provider.send('evm_mine',[]);await(await plain.releaseMyVault()).wait();
 await recovery.send('Page.reload');await sleep(2200);await recovery.ev(HELPERS);await tab(recovery,'Plan');await click(recovery,'Check pending changes');
 await until(()=>recovery.ev(`return sessionStorage.getItem('inheritance:settings-request:'+${JSON.stringify(ACCOUNTS.a0.a.toLowerCase())})===null && document.body.innerText.includes('Plan settings confirmed for all listed assets.')`),'historical basic receipt recovery');
 assert.equal((await recovery.ev('return window.__E2E_MINIKIT__.txLog()')).length,0);pass('a released basic slot recovers its original successful settings receipt without resending');
 await tab(recovery,'Home');await click(recovery,'Check in');await until(()=>recovery.ev(`return document.body.innerText.includes('Checked in to all 2 active vaults.')`),'check-in after historical recovery');assert.equal(await wc.isExpired(),false);assert.equal(await uc.isExpired(),false);assert.equal((await recovery.ev('return window.__E2E_MINIKIT__.lastCalldata()')).length,2);pass('historical settings recovery unblocks check-in for the two remaining assets');
 // Recovery must remain reachable after another device removes every current slot.
 await tab(recovery,'Plan');await recovery.ev(`return __q.setInput('period-change','21')`);await click(recovery,'Change period');
 await recovery.ev(`const fixture=await import('/src/test/minikit-stub.ts');const send=fixture.MiniKit.sendTransaction;fixture.MiniKit.sendTransaction=async request=>{await send(request);return {executedWith:'minikit',data:{status:'fail',error:'E2E response lost'}}};return true`);await click(recovery,'Confirm changes');
 await until(async()=>await wc.heartbeatInterval()===21n*86400n && await uc.heartbeatInterval()===21n*86400n,'second lost response');
 await(await wf.withdrawAllFromMyVault(ACCOUNTS.a0.a,0)).wait();await(await uf.withdrawAllFromMyVault(ACCOUNTS.a0.a,0)).wait();await provider.send('evm_increaseTime',[22*86400]);await provider.send('evm_mine',[]);await(await wf.releaseMyVault()).wait();await(await uf.releaseMyVault()).wait();
 await recovery.send('Page.reload');await sleep(2200);await recovery.ev(HELPERS);await tab(recovery,'Plan');await click(recovery,'Check pending changes');
 await until(()=>recovery.ev(`return sessionStorage.getItem('inheritance:settings-request:'+${JSON.stringify(ACCOUNTS.a0.a.toLowerCase())})===null`),'recovery without any current slot');assert.equal((await recovery.ev('return window.__E2E_MINIKIT__.txLog()')).length,0);pass('settings recovery remains reachable after every current slot is released');
 // The Home editor belongs to the signed-in owner even after viewing someone else's shared link.
 await(await wf.createVault(ACCOUNTS.a1.a,30*86400)).wait();const ownReplacement=await wf.vaultOf(ACCOUNTS.a0.a);
 const otherFactory=wf.connect(await provider.getSigner(3));await(await otherFactory.createVault(ACCOUNTS.a0.a,30*86400)).wait();const otherVault=await wf.vaultOf(ACCOUNTS.a3.a);
 const mixed=await open(ACCOUNTS.a0.pk,`?vault=${otherVault}`);await until(()=>mixed.ev(`return document.querySelectorAll('.inheritance-asset').length>0`),'other owner heir view');await tab(mixed,'Home');await click(mixed,'Update your plan');await until(()=>mixed.ev(`return !!document.getElementById('period-change')`),'personal shared editor from Home');
 await mixed.ev(`return __q.setInput('period-change','14')`);await click(mixed,'Change period');await until(()=>mixed.ev(`return !!document.getElementById('settings-review-title')`),'personal target review');
 await click(mixed,'Confirm changes');await until(()=>mixed.ev(`return document.body.innerText.includes('Plan settings confirmed for all listed assets.')`),'personal edit');
 assert.equal(await new Contract(ownReplacement,artifact('InheritanceVaultMorpho').abi,owner).heartbeatInterval(),14n*86400n);assert.equal(await new Contract(otherVault,artifact('InheritanceVaultMorpho').abi,owner).heartbeatInterval(),30n*86400n);pass('Home update plan selects the owner plan after viewing another person as heir');
 for(const p of pages){evidence.externalRequests.push(...await p.ev('return window.__E2E_EXTERNAL_FETCHES__||[]'));evidence.runtimeErrors.push(...await p.ev('return window.__E2E_ERRS__||[]'));}
 assert.equal(evidence.externalRequests.length,0);
 assert.equal(evidence.runtimeErrors.length,0);pass('no browser runtime errors or remote calls');evidence.passed=passed;evidence.result='PASS';
}catch(e){for(let i=0;i<pages.length;i++)try{await snap(pages[i],'failure-'+i)}catch{};evidence.error=e.stack;console.error(e.stack);process.exitCode=1;}
finally{writeFileSync(dir+'/evidence.json',JSON.stringify(evidence,null,2));for(const p of pages)await p.close();await vite?.close();provider?.destroy();anvil?.kill('SIGTERM');}
