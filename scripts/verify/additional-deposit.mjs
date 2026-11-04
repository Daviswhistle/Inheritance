// Real SDK, disposable chain and browser reload. Never uses production funds.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {Contract,JsonRpcProvider}=createRequire(new URL('../../app/package.json',import.meta.url))('ethers');
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const origin=`http://localhost:${port}`;
const host=spawn(process.execPath,[new URL('../test-host/start.mjs',import.meta.url).pathname,`--port=${port}`],{stdio:['ignore','pipe','pipe']});let log='';host.stdout.on('data',d=>log+=d);host.stderr.on('data',d=>log+=d);
let browser,provider;
async function until(fn,label){for(let i=0;i<400;i++){if(await fn())return;await sleep(100)}throw Error('Timeout '+label)}
try {
 await until(async()=>{if(host.exitCode!==null)throw Error(log);try{return(await fetch(origin+'/__host/config')).ok}catch{return false}},'host');
 const c=await(await fetch(origin+'/__host/config')).json();const fixture=JSON.parse(readFileSync(log.match(/Fixture: (.+)/)[1],'utf8'));
 provider=new JsonRpcProvider(fixture.rpc,undefined,{cacheTimeout:-1,batchMaxCount:1});const signer=await provider.getSigner(0);
 const f=new Contract(c.usdcFactory,['function createVault(address,uint256) returns(address)','function vaultOf(address) view returns(address)','function depositWithMinShares(uint256,uint256)'],signer);
 const token=new Contract(c.usdc,['function approve(address,uint256)','function balanceOf(address) view returns(uint256)'],signer);
 await(await f.createVault(c.heir,30*86400)).wait();await(await token.approve(c.usdcFactory,10_000_000n)).wait();const initialReceipt=await(await f.depositWithMinShares(10_000_000n,1n)).wait();
 const vault=await f.vaultOf(c.owner), held=new Contract(c.usdcStrategy,['function balanceOf(address) view returns(uint256)','function previewDeposit(uint256) view returns(uint256)'],provider);
 browser=await (process.env.DEPOSIT_BROWSER==='webkit'?webkit:chromium).launch({headless:true,...(process.env.DEPOSIT_BROWSER==='webkit'?{}:{executablePath:process.env.CHROME_BIN||undefined})});const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.addInitScript(()=>localStorage.setItem('inheritance:locale','en'));
 await page.goto(origin+'/?approval=auto&residence=KR'+(process.env.DEPOSIT_BROWSER==='webkit'?'&platform=ios':''));await page.getByRole('button',{name:'Agree and sign in',exact:true}).click();
 await page.locator('.account-row').waitFor();await page.locator('.tab-item').nth(1).click();
 const selectUsdc=page.getByRole('button',{name:'USDC',exact:true});if(await selectUsdc.count())await selectUsdc.click();
 const details=page.locator('.deposit-controls');await details.locator('summary').click();
 if(await page.locator('#plan-residence-country').count()){
  await page.locator('#plan-residence-country').selectOption('KR');await page.locator('#plan-residence-attestation').check();await page.getByRole('button',{name:'Confirm residence',exact:true}).click();
 }
 const amount=page.locator('#deposit-amount');await amount.fill('1');
 const expectedShares=await held.previewDeposit(1_000_000n);const before=await held.balanceOf(vault);let canonical='',sendCount=0;
 await page.route('**/__host/command',async route=>{
  const body=route.request().postDataJSON();const response=await route.fetch();
  if(body.envelope?.command==='send-transaction'){
   sendCount++;const result=await response.json();
   const lookup=await(await fetch(origin+'/__host/userop/'+result.userOpHash)).json();canonical=lookup.transaction_hash;
   // Wallet submitted successfully, but its response lost the operation ID.
   delete result.userOpHash;await route.fulfill({response,json:result});
  }else await route.fulfill({response});
 });
 await page.locator('.deposit-primary').click();await page.locator('#additional-deposit-consent').check();await page.locator('.money-review .btn-primary').click();
 await page.locator('#deposit-recovery-title').waitFor();await until(()=>Promise.resolve(Boolean(canonical)),'mined missing-ID request');
 await until(async()=>await held.balanceOf(vault)===before+expectedShares,'exact chain deposit');
 assert.equal(sendCount,1);
 await page.reload();await page.locator('#deposit-recovery-title').waitFor();
 await page.locator('.tab-item').nth(1).click();if(await selectUsdc.count())await selectUsdc.click();
 if(!await amount.isVisible())await details.locator('summary').click();
 await amount.fill('1');assert.equal(await page.locator('.deposit-primary').isDisabled(),true);
 const recovery=page.locator('section[aria-labelledby="deposit-recovery-title"]');
 const out=process.env.DEPOSIT_UX_OUT || '/tmp/inheritance-additional-deposit';mkdirSync(out,{recursive:true});
 await page.locator('#inheritance-test-controls').evaluate(e=>e.style.display='none');
 for(const width of [320,390]){await page.setViewportSize({width,height:844});await recovery.scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/pending-${width}.png`});}

 await recovery.locator('input').fill(initialReceipt.hash);await recovery.getByRole('button',{name:'Check previous deposit'}).click();
 await until(()=>recovery.getByRole('button').isEnabled(),'unknown ID check completed');
 assert.equal(await page.locator('#deposit-recovery-title').count(),1);assert.equal(await page.locator('.deposit-primary').isDisabled(),true);
 await recovery.locator('input').fill(canonical);await recovery.getByRole('button',{name:'Check previous deposit'}).click();
 await until(async()=>await page.locator('#deposit-recovery-title').count()===0,'original receipt recovered');
 assert.equal(sendCount,1);assert.equal(await held.balanceOf(vault),before+expectedShares);
 console.log('PASS real additional USDC deposit with lost wallet ID survives reload, blocks repeats, rejects an unrelated ID, and confirms only its exact receipt without another wallet request');
} finally {await browser?.close();provider?.destroy();host.kill('SIGINT');}
