// Render and exercise the real app through the real SDK on the disposable host.
// Chromium viewports are layout evidence, not native-device certification.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {setTimeout as sleep} from 'node:timers/promises';
import {launch, HELPERS, OUT} from './drv.mjs';
const socket=createServer();
await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
const port=socket.address().port;
await new Promise(resolve=>socket.close(resolve));
const origin=`http://localhost:${port}`;
const {Contract,JsonRpcProvider}=createRequire(new URL('../../app/package.json',import.meta.url))('ethers');
let provider;
const server=spawn(process.execPath,[new URL('../test-host/start.mjs',import.meta.url).pathname,`--port=${port}`],{stdio:['ignore','pipe','pipe']});
let output='';server.stdout.on('data',d=>output+=d);server.stderr.on('data',d=>output+=d);
const axeSource=process.env.AXE_CORE_PATH ? readFileSync(process.env.AXE_CORE_PATH,'utf8') : '';
const pages=[],evidence={environment:'Chromium mobile viewport; real MiniKit SDK; local test assets',layouts:[],screenshots:[],accessibility:[]};
async function until(fn,label,ms=45000){const end=Date.now()+ms;while(Date.now()<end){if(server.exitCode!==null)throw Error(output);if(await fn())return;await sleep(100);}throw Error(`Timed out: ${label}`);}
async function tab(page,index){await page.ev(`document.querySelectorAll('.tab-item')[${index}].click();`);await sleep(60);}
async function locale(page,value){await tab(page,3);await page.ev(`const s=document.querySelector('.locale-picker select');s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}));`);await sleep(60);}
async function click(page,label){await until(()=>page.ev(`__q.revealButton(${JSON.stringify(label)});return __q.btns().some(b=>b.t===${JSON.stringify(label)}&&!b.d)`),label);assert.match(await page.ev(`return __q.click(${JSON.stringify(label)})`),/^clicked/);}
async function shot(page,label,top=true){if(top)await page.ev('window.scrollTo(0,0)');await sleep(80);const result=await page.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});const path=`${OUT}/${label}.png`;writeFileSync(path,Buffer.from(result.data,'base64'));evidence.screenshots.push(path);}
async function help(page,label){
 assert.equal(await page.ev("return document.querySelectorAll('.help-topic-list > details').length"),8);
 await page.ev("document.querySelectorAll('.help-topic').forEach(x=>x.open=true)");await layout(page,label,390);
 assert.ok(await page.ev("return !!document.querySelector('a[href=\"/yield-terms.html\"]')&&!!document.querySelector('.transfer-guide')"));
 await page.ev("document.querySelectorAll('.help-topic').forEach(x=>x.open=false)");
}
async function layout(page,label,width){
 const data=await page.ev(`const nav=document.querySelector('.tab-bar').getBoundingClientRect();const fixed=document.querySelector('.entry-action,.plan-primary-actions');const b=fixed?.querySelector('.btn');const r=b?.getBoundingClientRect();const hit=r&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,headings:document.querySelectorAll('main h1').length,tabs:[...document.querySelectorAll('.tab-item')].map(x=>x.getBoundingClientRect().height),cta:!r||(r.top>=0&&r.bottom<=nav.top&&(b===hit||b.contains(hit))),focused:document.activeElement===document.querySelector('main h1')};`);
 evidence.layouts.push({label,...data});assert.ok(data.width<=width,JSON.stringify({label,...data}));assert.equal(data.headings,1,label);assert.ok(data.tabs.every(h=>h>=44),label);assert.ok(data.cta,label+' covered primary action');
 const smallTargets=await page.ev("return [...document.querySelectorAll('main button,main summary,main select,main input:not([type=checkbox]),main a:not(p a)')].filter(e=>e.checkVisibility()).map(e=>{const r=e.getBoundingClientRect();return {label:e.textContent.trim().slice(0,70)||e.id,width:r.width,height:r.height}}).filter(r=>r.width<44||r.height<44)");
 assert.deepEqual(smallTargets,[],label+' touch targets');
 if(axeSource && width===390){
  const violations=await page.ev("const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));");
  evidence.accessibility.push({label,violations});assert.deepEqual(violations,[],label+' accessibility');
 }
 return data;
}
try{
 await until(async()=>{try{return(await fetch(origin+'/__host/config')).ok;}catch{return false;}},'host',90000);
 const config=await(await fetch(origin+'/__host/config')).json();
 const page=await launch({url:origin+'/?approval=auto',preload:"localStorage.setItem('inheritance:locale','en');"});pages.push(page);await page.ev(HELPERS);
 assert.ok(await page.waitFor('#inheritance-test-controls'));
 await until(()=>page.ev("return document.querySelectorAll('.tab-item').length===4"),'app navigation ready');
 await page.ev("document.getElementById('inheritance-test-controls').style.display='none';");
 if(axeSource)await page.send('Runtime.evaluate',{expression:axeSource});
 for(const lang of ['en','ko']){
  await locale(page,lang);
  for(const [width,height]of [[320,640],[390,844],[1280,900]]){
   await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
   for(let i=0;i<4;i++){
    await tab(page,i);const data=await layout(page,`guest-${lang}-${width}-${i}`,width);assert.ok(data.focused,'tab moves reading focus');
    if(width===390)await shot(page,`ui-guest-${lang}-${i}`);
    if(width===390&&i===3)await help(page,`help-expanded-guest-${lang}`);
    if(i===0||i===2){await page.ev("document.querySelector('.entry-rules').open=true;window.scrollTo(0,document.documentElement.scrollHeight);");await sleep(60);
     assert.ok(await page.ev("return document.querySelector('.entry-rules').getBoundingClientRect().bottom<=document.querySelector('.entry-action').getBoundingClientRect().top-24"),'expanded guide clears anchored action');
     await page.ev("document.querySelector('.entry-rules').open=false;window.scrollTo(0,0)");}
   }
  }
 }
 assert.equal(await page.ev("return window.__INHERITANCE_TEST_HOST__.history.filter(x=>['wallet-auth','send-transaction','sign-message','sign-typed-data'].includes(x.command)).length"),0,'browsing never requests wallet approval');
 console.log('PASS localized guest navigation, one heading, 44px tabs, action hit testing and scroll clearance across 24 layouts');
 await locale(page,'en');await tab(page,2);
 await page.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await click(page,'Agree and sign in');assert.ok(await page.waitFor('#heir-input',30000));
 await page.ev(`await __q.setInput('heir-input',${JSON.stringify(config.heir)});await __q.setInput('plan-wld','10');await __q.setInput('plan-usdc','12.345678');`);
 for(const lang of ['en','ko']){
  await locale(page,lang);await tab(page,2);assert.ok(await page.waitFor('#heir-input'));
  for(const[width,height]of [[320,640],[390,844]]){
   await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
   await layout(page,`setup-${lang}-${width}`,width);await shot(page,`ui-setup-${lang}-${width}`);
  }
  await click(page,lang==='en'?'Review plan':'플랜 검토');
  assert.ok(await page.waitFor('#plan-review-title'));assert.equal(await page.ev("return document.getElementById('yield-consent').checked"),false);assert.equal(await page.ev("return document.querySelector('.plan-submit').disabled"),true);
  assert.deepEqual(await page.ev("return [...document.querySelectorAll('.plan-review-amount')].map(x=>x.textContent.trim())"),['10 WLD','12.345678 USDC']);
  assert.equal(await page.ev("return document.querySelector('.plan-review-address').textContent"),config.heir);
  for(const[width,height]of [[320,640],[390,844]]){
   await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
   await layout(page,`review-${lang}-${width}`,width);await shot(page,`ui-review-${lang}-${width}`);
   await page.ev("document.querySelector('.yield-consent').scrollIntoView({block:'center'});");await sleep(60);
   assert.ok(await page.ev("const r=document.querySelector('.yield-consent').getBoundingClientRect();return r.top>=0&&r.bottom<document.querySelector('.plan-primary-actions').getBoundingClientRect().top"),'consent can be read clear of action');
   await shot(page,`ui-review-top-${lang}-${width}`);
  }
  assert.equal(await page.ev("return window.__INHERITANCE_TEST_HOST__.history.filter(x=>x.command==='send-transaction').length"),0,'review sends no transaction');
  if(lang==='en')await click(page,'Edit plan');
 }
 await page.ev("document.getElementById('yield-consent').click();");await click(page,'거래 승인 화면 열기');
 await until(()=>page.ev("return !!document.querySelector('.invite-disclosure')"),'created plan',60000);
 console.log('PASS real localized setup, exact six-decimal review, unchecked consent, safe editing and approved creation');
 await page.send('Browser.grantPermissions',{origin,permissions:['clipboardReadWrite','clipboardSanitizedWrite']});
 await page.send('Page.bringToFront');
 await click(page,'링크 복사');
 await until(()=>page.ev("return !!document.querySelector('.toast-success')"),'copy feedback');
 assert.equal(await page.ev("return document.querySelector('.toast-success').textContent"),'링크를 복사했습니다.');
 assert.ok((await page.ev('return await navigator.clipboard.readText()')).includes('vault='),'copy supplies an actual recipient link');
 for(const width of [320,390]){
  await page.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
  await page.ev('window.scrollTo(0,0)');
  assert.ok(await page.ev("const t=document.querySelector('.toast').getBoundingClientRect(),h=document.querySelector('.app-header').getBoundingClientRect();return t.top>=h.bottom&&t.left>=24&&t.right<=innerWidth-24&&Math.abs(t.x+t.width/2-innerWidth/2)<1&&getComputedStyle(document.querySelector('.toast-container')).pointerEvents==='none'"),'feedback is centered below header and does not intercept taps');
  await layout(page,`copy-feedback-ko-${width}`,width);await shot(page,`ui-copy-feedback-ko-${width}`);
 }
 await page.ev("document.querySelector('.invite-disclosure').open=false");
 console.log('PASS copied recipient link and nonblocking feedback below the header at 320px and 390px');
 for(const lang of ['en','ko']){
  await locale(page,lang);
  for(const[width,height]of [[320,640],[390,844]]){
   await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
   for(let i=0;i<4;i++){
    await tab(page,i);await sleep(100);await layout(page,`owner-${lang}-${width}-${i}`,width);if(width===390)await shot(page,`ui-owner-${lang}-${i}`);
    if(i===1){assert.ok(await page.ev("return document.querySelector('.asset-money-card').getBoundingClientRect().top<document.querySelector('.income-card').getBoundingClientRect().top"),'balance precedes income');}
    if(width===390&&i===3)await help(page,`help-expanded-owner-${lang}`);
    if(width===390&&(i===1||i===2)){
     await page.ev("document.querySelectorAll('main details').forEach(x=>x.open=true)");
     await layout(page,`owner-expanded-${lang}-${i}`,width);
     await page.ev("document.querySelectorAll('main details').forEach(x=>x.open=false)");
    }
    if(width===390&&i===1){
     const requests=await page.ev("return window.__INHERITANCE_TEST_HOST__.history.filter(x=>x.command==='send-transaction').length");
     await page.ev("__q.reveal('#withdraw-to');await __q.setInput('withdraw-to','0x0000000000000000000000000000000000000000');await __q.setInput('withdraw-amount','1');");
     assert.equal(await page.ev("return document.getElementById('withdraw-to').getAttribute('aria-invalid')"),'true');
     assert.equal(await page.ev("return document.querySelector('.principal-submit').disabled"),true);
     await page.ev(`await __q.setInput('withdraw-to',${JSON.stringify(config.owner)});`);
     for(const amount of ['0','-1','1000','0.0000000000000000001']){
      await page.ev(`await __q.setInput('withdraw-amount',${JSON.stringify(amount)});`);
      assert.equal(await page.ev("return document.querySelector('.principal-submit').disabled"),true,'invalid withdrawal '+amount);
     }
     await page.ev("await __q.setInput('withdraw-amount','1');document.querySelector('.principal-controls').scrollIntoView({block:'start'});");
     assert.equal(await page.ev("return document.querySelector('.principal-submit').disabled"),false);
     await layout(page,`withdraw-${lang}`,390);await shot(page,`ui-withdraw-${lang}`,false);
     assert.equal(await page.ev("return window.__INHERITANCE_TEST_HOST__.history.filter(x=>x.command==='send-transaction').length"),requests);
     await page.ev("await __q.setInput('withdraw-amount','');document.querySelector('.principal-controls').open=false;");
    }
   }
  }
 }
 await tab(page,1);await click(page,'USDC');
 await until(()=>page.ev("return document.querySelector('.asset-money-card .card-title').textContent.includes('USDC')"),'USDC withdrawal');
 provider=new JsonRpcProvider(origin+'/__host/rpc',undefined,{cacheTimeout:-1,batchMaxCount:1});
 const token=new Contract(config.usdc,['function balanceOf(address) view returns(uint256)'],provider);
 const before=await token.balanceOf(config.owner);
 await page.ev(`__q.reveal('#withdraw-to');await __q.setInput('withdraw-to',${JSON.stringify(config.owner)});await __q.setInput('withdraw-amount','1.0000001');`);
 assert.equal(await page.ev("return document.querySelector('.principal-submit').disabled"),true,'USDC precision guard');
 await page.ev("await __q.setInput('withdraw-amount','1');");await click(page,'내 지갑으로 출금');
 await until(async()=>await token.balanceOf(config.owner)===before+1_000000n,'verified USDC principal withdrawal');
 await until(()=>page.ev("return document.body.innerText.includes('출금을 완료했습니다')"),'localized withdrawal receipt');
 console.log('PASS invalid and zero addresses, precision, zero and excess amounts cannot submit; valid USDC withdrawal pays exactly one token');
 await tab(page,0);await click(page,'지금 확인하기');
 await until(()=>page.ev("return document.body.innerText.includes('2개') && document.body.innerText.includes('확인')"),'combined check-in');
 const factory=new Contract(config.wldFactory,['function vaultOf(address) view returns(address)'],provider);
 const vault=await factory.vaultOf(config.owner);
 const heir=await launch({url:origin+`/?account=heir&approval=auto&vault=${vault}`,preload:"localStorage.setItem('inheritance:locale','en');"});pages.push(heir);await heir.ev(HELPERS);
 assert.ok(await heir.waitFor('#inheritance-test-controls'));await heir.ev("document.getElementById('inheritance-test-controls').style.display='none';");
 if(axeSource)await heir.send('Runtime.evaluate',{expression:axeSource});
 await click(heir,'Agree and sign in');await until(()=>heir.ev("return document.querySelectorAll('.inheritance-asset').length===2"),'heir receives both assets');
 await heir.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 for(const lang of ['en','ko']){
  await locale(heir,lang);await tab(heir,2);
  assert.equal(await heir.ev("return document.querySelectorAll('.heir-shared-next').length"),1,'identical deadlines share one explanation');
  assert.equal(await heir.ev("return document.querySelectorAll('.inheritance-asset .inheritance-next').length"),0);
  await layout(heir,`heir-active-${lang}`,390);await shot(heir,`ui-heir-${lang}`);
 }
 console.log('PASS recipient sees both assets with one shared next step after an atomic owner check-in');
 const timeResponse=await fetch(origin+'/__host/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'time',days:31})});assert.equal(timeResponse.status,200);
 const claim=await heir.ev(`const {sendWorldChainTx}=await import('/src/minikit.ts');return await sendWorldChainTx([{address:${JSON.stringify(config.wldFactory)},abi:['function fileClaimFor(address)'],functionName:'fileClaimFor',args:[${JSON.stringify(vault)}]}]);`);
 assert.equal(claim.ok,true);
 const wldVault=new Contract(vault,['function claimFiledAt() view returns(uint256)'],provider);
 await until(async()=>await wldVault.claimFiledAt()>0n,'single-asset claim confirmed');
 const priorNavigation=await heir.ev('return performance.timeOrigin');await heir.send('Page.reload');
 await until(()=>heir.ev(`return performance.timeOrigin>${priorNavigation}&&!!document.querySelector('.state-waiting')&&!!document.querySelector('.state-expired')`).catch(()=>false),'mixed recipient states after reload');
 await heir.ev("document.getElementById('inheritance-test-controls').style.display='none';");
 if(axeSource)await heir.send('Runtime.evaluate',{expression:axeSource});
 assert.equal(await heir.ev("return document.querySelectorAll('.heir-shared-next').length"),0);
 assert.equal(await heir.ev("return document.querySelectorAll('.inheritance-asset .inheritance-next').length"),2);
 assert.equal(await heir.ev("const text=document.querySelector('.heir-next-action p').textContent;return text.includes('USDC')&&!text.includes('WLD')"),true,'claim action identifies only its eligible asset');
 await layout(heir,'heir-mixed',390);await shot(heir,'ui-heir-mixed');
 console.log('PASS mixed waiting and eligible assets retain individual deadlines; the action identifies only USDC');
 // Empty an actual local plan, then reach its close action through the owner UI.
 const empty=await page.ev(`const {sendWorldChainTx}=await import('/src/minikit.ts');return await sendWorldChainTx([
  {address:${JSON.stringify(config.usdcFactory)},abi:['function pingMyVault()'],functionName:'pingMyVault',args:[]},
  {address:${JSON.stringify(config.usdcFactory)},abi:['function withdrawAllFromMyVault(address,uint256)'],functionName:'withdrawAllFromMyVault',args:[${JSON.stringify(config.owner)},'0']}
 ]);`);assert.equal(empty.ok,true);
 const usdcFactory=new Contract(config.usdcFactory,['function vaultOf(address) view returns(address)'],provider);
 const usdcVault=new Contract(await usdcFactory.vaultOf(config.owner),['function hasAssets() view returns(bool)'],provider);
 await until(async()=>!await usdcVault.hasAssets(),'empty USDC plan');
 assert.equal((await fetch(origin+'/__host/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'time',days:31})})).status,200);
 const ownerNavigation=await page.ev('return performance.timeOrigin');await page.send('Page.reload');
 await until(()=>page.ev(`return performance.timeOrigin>${ownerNavigation}&&!!document.querySelector('.tab-item')`).catch(()=>false),'owner reload');
 await page.ev(HELPERS);await page.ev("document.getElementById('inheritance-test-controls').style.display='none';");
 if(axeSource)await page.send('Runtime.evaluate',{expression:axeSource});
 for(const lang of ['en','ko']){
  await locale(page,lang);await tab(page,1);await click(page,'USDC');await tab(page,2);
  const opener=lang==='en'?'Close this empty plan':'비어 있는 플랜 종료';
  for(const [width,height]of [[320,360],[390,844]]){
   await page.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
   await click(page,opener);assert.ok(await page.waitFor('.release-dialog[open]'));
   assert.equal(await page.ev("return document.activeElement.id"),'release-modal-title');
   assert.ok(await page.ev("return document.getElementById('release-modal-title').textContent.includes('USDC')"),'close identifies the selected asset');
   assert.equal(await page.ev("return document.querySelector('.release-ack').checked"),false);
   assert.equal(await page.ev("return document.querySelector('.release-actions .btn-primary').disabled"),true);
   assert.ok(await page.ev("const d=document.querySelector('.release-dialog'),r=d.getBoundingClientRect();return d.matches(':modal')&&r.top>=0&&r.bottom<=innerHeight&&d.scrollWidth===d.clientWidth"),'dialog fits viewport and makes background inert');
   // Programmatic focus must not escape to background navigation.
   await page.ev("document.querySelector('.tab-item').focus()");
   assert.ok(await page.ev("return document.querySelector('.release-dialog').contains(document.activeElement)"));
   await page.ev("document.querySelector('.release-ack').click();document.querySelector('.release-actions .btn-primary').focus()");
   await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
   await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
   assert.ok(await page.ev("return document.querySelector('.release-dialog').contains(document.activeElement)"),'Tab stays in dialog');
   await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
   await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
   assert.equal(await page.ev("return document.activeElement===document.querySelector('.release-actions .btn-primary')"),true,'Shift+Tab wraps to last action');
   await page.ev("document.querySelector('.release-actions').scrollIntoView({block:'end'})");
   assert.ok(await page.ev("return [...document.querySelectorAll('.release-actions button')].every(b=>{const r=b.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return r.top>=0&&r.bottom<=innerHeight&&r.height>=44&&(hit===b||b.contains(hit));})"),'both actions remain reachable');
   await page.ev("await Promise.allSettled(document.getAnimations().map(animation=>animation.finished))");
   await layout(page,`close-plan-${lang}-${width}`,width);await shot(page,`ui-close-${lang}-${width}`,false);
   await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
   await until(()=>page.ev("return !document.querySelector('.release-dialog')"),'Escape closes');
   assert.equal(await page.ev('return document.activeElement.textContent.trim()'),opener,'Escape restores opener focus');
   await click(page,opener);await click(page,lang==='en'?'Cancel':'취소');
   assert.equal(await page.ev('return document.activeElement.textContent.trim()'),opener,'Cancel restores opener focus');
  }
 }
 console.log('PASS close-plan consent, native modality, keyboard containment, Escape/Cancel focus return and reachable actions at 320×360');
 await click(page,'비어 있는 플랜 종료');
 await page.ev("window.__INHERITANCE_TEST_HOST__.rejectNext('send-transaction');document.querySelector('.release-ack').click()");
 await click(page,'USDC 플랜 닫기');
 await until(()=>page.ev("return !!document.querySelector('.release-message')&&!document.querySelector('.release-actions .btn-primary').disabled"),'rejection shown inside modal');
 assert.notEqual(await usdcFactory.vaultOf(config.owner),'0x0000000000000000000000000000000000000000','rejection preserves plan');
 await layout(page,'close-plan-rejected-ko',390);await shot(page,'ui-close-rejected-ko',false);
 await click(page,'USDC 플랜 닫기');
 await until(()=>page.ev("return !document.querySelector('.release-dialog')"),'approved close completes');
 assert.equal(await usdcFactory.vaultOf(config.owner),'0x0000000000000000000000000000000000000000','approved close releases empty plan');
 assert.equal(await page.ev("return document.activeElement===document.querySelector('main h1')"),true,'completed close moves focus to the current page');
 console.log('PASS rejected close keeps plan and shows its message inside dialog; explicit retry releases it on-chain and restores reading focus');
 assert.deepEqual(page.logs.filter(x=>x.startsWith('[EXC]')),[]);
 mkdirSync(OUT,{recursive:true});writeFileSync(`${OUT}/product-ui-evidence.json`,JSON.stringify(evidence,null,2));
 console.log(`PASS ${evidence.layouts.length} layouts; screenshots and evidence in ${OUT}`);
}finally{
 provider?.destroy();
 for(const page of pages)await page.close();server.kill('SIGTERM');await new Promise(resolve=>{if(server.exitCode!==null)return resolve();const timeout=setTimeout(()=>{server.kill('SIGKILL');resolve();},5000);server.once('exit',()=>{clearTimeout(timeout);resolve();});});
}
