// Real MiniKit SDK with a disposable bridge and chain; never production funds.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdirSync,writeFileSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out=process.env.LOGIN_UX_OUT || '/tmp/inheritance-login-session';mkdirSync(out,{recursive:true});
const socket=createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const origin=`http://localhost:${port}`;
const host=spawn(process.execPath,[new URL('../test-host/start.mjs',import.meta.url).pathname,`--port=${port}`],{stdio:['ignore','pipe','pipe']});let log='';host.stdout.on('data',d=>log+=d);host.stderr.on('data',d=>log+=d);
let browser;const checks=[];const pass=x=>{checks.push(x);console.log('PASS '+x)};
async function until(fn,label){for(let i=0;i<450;i++){if(host.exitCode!==null)throw Error(log);if(await fn())return;await sleep(100)}throw Error('Timeout: '+label)}
try{
 await until(async()=>{try{return(await fetch(origin+'/__host/config')).ok}catch{return false}},'host');
 const isWebkit=process.env.LOGIN_BROWSER==='webkit';
 browser=await (isWebkit?webkit:chromium).launch({...(!isWebkit?{executablePath:process.env.CHROME_BIN || undefined}:{}),headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await page.addInitScript(()=>localStorage.setItem('inheritance:locale','ko'));
 const path=isWebkit?'/?platform=ios&approval=auto':'/?approval=auto';
 await page.goto(origin+path);
 await page.waitForFunction(()=>!!window.__INHERITANCE_TEST_HOST__);
 const login=()=>page.getByRole('button',{name:'동의하고 로그인',exact:true}).click();
 const signout=()=>page.locator('.account-row').getByRole('button',{name:'로그아웃',exact:true}).click();
 const signedIn=()=>page.locator('.account-row').waitFor();
 const shot=async name=>{await page.locator('#inheritance-test-controls').evaluate(e=>e.style.display='none');await page.screenshot({path:`${out}/${name}.png`,fullPage:true})};
 await page.evaluate(()=>window.__INHERITANCE_TEST_HOST__.rejectNext('wallet-auth'));
 await login();await until(()=>page.getByRole('button',{name:'동의하고 로그인',exact:true}).isEnabled(),'cancelled login');
 await login();await signedIn();pass('Native wallet rejection permits a successful retry');
 await page.evaluate(()=>localStorage.setItem('inheritance:test-recovery-record','keep'));
 for(const width of [320,390]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const button=page.locator('.account-row button');assert.ok(await button.evaluate(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44}));await shot('account-'+width)}
 await signout();await page.getByRole('button',{name:'동의하고 로그인',exact:true}).waitFor();
 assert.equal(await page.locator('.account-row').count(),0);
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('wld-session')),null);
 assert.equal(await page.evaluate(()=>localStorage.getItem('inheritance:test-recovery-record')),'keep');
 assert.equal(await page.evaluate(()=>window.__INHERITANCE_TEST_HOST__.history.filter(x=>x.command==='wallet-auth').length),0);
 pass('Sign out clears account/session, preserves recovery storage and does not automatically sign back in');
 await page.reload();await page.getByRole('button',{name:'동의하고 로그인',exact:true}).waitFor();await login();await signedIn();
 await page.locator('.tab-item').nth(3).click();assert.match(await page.locator('main').innerText(),/맡긴 자산과 상속 설정은 그대로 유지됩니다/);
 const heading=page.getByRole('heading',{name:'계정',exact:true});assert.ok(await heading.evaluate(e=>e.getBoundingClientRect().left-e.parentElement.parentElement.getBoundingClientRect().left>=16));await shot('account-help');
 await page.locator('main').getByRole('button',{name:'로그아웃',exact:true}).click();await page.getByRole('button',{name:'동의하고 로그인',exact:true}).waitFor();pass('Help explains sign-out effects and its action returns to sign-in');
 // Suppress RPC responses to ensure identity establishment is independent of balances.
 await page.route('**/__host/rpc',route=>route.abort());await login();await signedIn();pass('A failed balance RPC does not prevent successful authentication');
 await page.unroute('**/__host/rpc');await signout();await page.getByRole('button',{name:'동의하고 로그인',exact:true}).waitFor();
 await page.evaluate(()=>window.__INHERITANCE_TEST_HOST__.setApproval('manual'));
 await login();await until(()=>page.evaluate(()=>window.__INHERITANCE_TEST_HOST__.pending.some(x=>x.command==='wallet-auth')),'pending native auth');
 await page.evaluate(()=>{for(const d of document.querySelector('#inheritance-test-controls')?.shadowRoot?.querySelectorAll('dialog')??[])d.close()});
 await page.getByRole('button',{name:'새로고침하고 다시 시도',exact:true}).waitFor({timeout:70000});
 assert.equal(await page.locator('.account-row').count(),0);await shot('login-timeout');
 // Even a real signed response after timeout must not re-establish the account.
 await page.evaluate(()=>{const h=window.__INHERITANCE_TEST_HOST__;h.approve(h.pending.find(x=>x.command==='wallet-auth').id)});
 await sleep(700);assert.equal(await page.locator('.account-row').count(),0);assert.equal(await page.evaluate(()=>sessionStorage.getItem('wld-session')),null);
 assert.equal(await page.evaluate(()=>window.__INHERITANCE_TEST_HOST__.history.filter(x=>x.command==='wallet-auth').length),1);
 pass('Unanswered native auth reaches a recoverable screen; a late signed response cannot log in');
 await page.evaluate(()=>{for(const d of document.querySelector('#inheritance-test-controls')?.shadowRoot?.querySelectorAll('dialog')??[])d.close()});
 await page.getByRole('button',{name:'새로고침하고 다시 시도',exact:true}).click();await page.getByRole('button',{name:'동의하고 로그인',exact:true}).waitFor();await login();await signedIn();
 assert.equal(await page.evaluate(()=>window.__INHERITANCE_TEST_HOST__.history.filter(x=>x.command==='send-transaction').length),0);
 pass('Reload resets native listeners and allows fresh authentication without any transaction');
 writeFileSync(out+'/evidence.json',JSON.stringify({checks,browser:isWebkit?'webkit':'chromium',realFundsUsed:false},null,2));
}finally{await browser?.close();host.kill('SIGTERM');writeFileSync(out+'/host.log',log)}
