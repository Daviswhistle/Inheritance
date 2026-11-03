import { sanitizeNativeDiagnostics } from '../operator-deploy/diagnostics';
import { Interface, keccak256 } from 'ethers';
import { MiniKit } from '@worldcoin/minikit-js';

import { validateWorldAppRouterFundingManifest, ROUTER, ROUTER_CODE_HASH } from '../lib/worldapp-router-funding-manifest.mjs';
import { isDefinitelyNotSubmittedResponse } from '../../app/src/transaction-safety';
import { SIGN_IN_STATEMENT } from '../../app/functions/_lib/siwe';
import { signInWithWorldApp, readSessionAddress, clearSession } from '../../app/src/auth';
declare const __MANIFEST__: any;
declare const __EXPECTED_MANIFEST_HASH__: string;
declare const __APP_ID__: string;
declare const __OPERATOR_BUILD__: string;
declare const __RPC_URL__: string;
const manifest = __MANIFEST__;
const wallet = '0xe819320ed3d03f9912b06a48cc5e7f06060cc67a';
const routerRead=new Interface(['function WETH9() view returns(address)','function balanceOf(address) view returns(uint256)']);
const same = (a: string,b: string) => a.toLowerCase()===b.toLowerCase();
function validate() { validateWorldAppRouterFundingManifest(manifest,__EXPECTED_MANIFEST_HASH__); }

type Attempt={id:string;kind:string;state:'pending'|'submitted'|'unknown'|'funds_found';userOpHash?:string;errorCode?:string;diagnostic?:Record<string,unknown>};
const key='inheritance:operator-fund:v1';
const diagnosticKey='inheritance:operator-fund:last-diagnostic:v1';
function showDiagnostic(value:unknown){const safe=sanitizeNativeDiagnostics(value);document.querySelector('#diagnostics')!.textContent=JSON.stringify(safe,null,2);(document.querySelector('#diagnostic-panel')as HTMLElement).hidden=Object.keys(safe).length===0;return safe;}
let attempts:Attempt[]=[],busy=false,installed=false;
const status=document.querySelector('#status')!;
const say=(s:string)=>status.textContent=s;
function readAttempts(){const raw=localStorage.getItem(key);const value=raw?JSON.parse(raw):[];if(!Array.isArray(value)||value.some(a=>a.kind!=='fund'||a.id!==`${manifest.manifestHash}:${a.kind}`||!['pending','submitted','unknown','funds_found'].includes(a.state)))throw Error('저장된 비용 전송 요청을 확인할 수 없습니다.');return value as Attempt[];}
function save(){localStorage.setItem(key,JSON.stringify(attempts));if(localStorage.getItem(key)!==JSON.stringify(attempts))throw Error('비용 전송 요청을 저장하지 못했습니다. 요청하지 않았습니다.');}
function session(){if(!installed||!MiniKit.isInstalled())throw Error('World App에서 여세요.');const a=readSessionAddress();if(!a||!same(a,wallet)){clearSession();throw Error('지정된 배포 지갑으로 다시 로그인하세요.');}}
const blocked=()=>attempts.length>0;
function render(){document.querySelectorAll<HTMLButtonElement>('[data-deploy]').forEach(b=>b.disabled=busy||!installed||!navigator.locks||blocked()||attempts.some(a=>a.kind===b.dataset.deploy));(document.querySelector('#auth')as HTMLButtonElement).disabled=busy||!installed;(document.querySelector('#refresh')as HTMLButtonElement).disabled=busy;}
async function rpc(method:string,params:any[]){const r=await fetch(__RPC_URL__,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});const j=await r.json();if(!r.ok||j.error)throw Error('체인 조회 실패. 배포를 다시 요청하지 마세요.');return j.result;}
async function recipientState(){
  if(await rpc('eth_chainId',[])!=='0x1e0')throw Error('World Chain이 아닙니다.');
  const [walletCode,wethCode,routerCode]=await Promise.all([rpc('eth_getCode',[wallet,'latest']),rpc('eth_getCode',[manifest.weth,'latest']),rpc('eth_getCode',[ROUTER,'latest'])]);
  if(keccak256(walletCode)!==manifest.codeHashes.wallet||keccak256(wethCode)!==manifest.codeHashes.weth||keccak256(routerCode)!==ROUTER_CODE_HASH)throw Error('지갑 또는 WETH·변환 계약이 검토한 코드와 다릅니다. 전송하지 않았습니다.');
  const [nonce,code,balance]=await Promise.all([rpc('eth_getTransactionCount',[manifest.deploymentEOA,'latest']),rpc('eth_getCode',[manifest.deploymentEOA,'latest']),rpc('eth_getBalance',[manifest.deploymentEOA,'latest'])]);
  return {nonce:BigInt(nonce),code,balance:BigInt(balance)};
}
async function preflight(){const state=await recipientState();const [wethResult,routerBalance]=await Promise.all([rpc('eth_call',[{to:ROUTER,data:routerRead.encodeFunctionData('WETH9')},'latest']),rpc('eth_call',[{to:manifest.weth,data:routerRead.encodeFunctionData('balanceOf',[ROUTER])},'latest'])]);if(!same(routerRead.decodeFunctionResult('WETH9',wethResult)[0],manifest.weth)||BigInt(routerBalance)!==0n)throw Error('변환 계약의 WETH 설정 또는 잔액이 검토 결과와 다릅니다. 전송하지 않았습니다.');if(state.nonce!==0n||state.code!=='0x'||state.balance!==0n){if(!attempts.length){attempts=[{id:`${manifest.manifestHash}:fund`,kind:'fund',state:'funds_found'}];save();}throw Error('임시 지갑에 잔액 또는 사용 기록이 있습니다. 재전송하지 마세요. 영수증 확인이 필요합니다.');}}
async function refresh(){if(busy)return;busy=true;render();try{attempts=readAttempts();const state=await recipientState();if(state.balance>0n||state.nonce!==0n||state.code!=='0x'){if(!attempts.length)attempts=[{id:`${manifest.manifestHash}:fund`,kind:'fund',state:'funds_found'}];else attempts[0].state='funds_found';save();say('임시 지갑에서 ETH 잔액을 확인했습니다. 재전송하지 않습니다. 전송 영수증과 계약 배포 결과는 별도 확인이 필요합니다.');document.querySelector<HTMLButtonElement>('[data-deploy]')!.disabled=true;}else say('임시 지갑의 현재 ETH 잔액은 0입니다. 이전 요청이 있으면 재전송하지 않습니다.');}catch(e){say((e as Error).message);}finally{busy=false;render();}}
function nativeCode(e:any){const c=e?.error_code??e?.code;return typeof c==='string'&&/^[a-z0-9_]{1,80}$/.test(c)?c:'unknown_native_error';}
async function deploy(kind:string){
 if(!navigator.locks){say('이 World App 환경은 중복 전송 방지 기능을 지원하지 않습니다. 전송하지 않았습니다.');return;}
 await navigator.locks.request('inheritance-operator-fund-v1',{mode:'exclusive',ifAvailable:true},async lock=>{if(!lock){say('다른 화면에서 전송 요청을 확인 중입니다. 재요청하지 않습니다.');return;}await deployLocked(kind);});
}
async function deployLocked(kind:string){if(busy)return;busy=true;render();let attempt:Attempt|undefined;try{validate();session();attempts=readAttempts();if(blocked()||attempts.some(a=>a.kind===kind))throw Error('이전 요청이 있어 재요청하지 않습니다. 전송 상태를 조회하세요.');await preflight();session();attempts=readAttempts();if(blocked()||attempts.some(a=>a.kind===kind))throw Error('다른 비용 전송 요청이 기록되었습니다. 재요청하지 않습니다.');attempt={id:`${manifest.manifestHash}:${kind}`,kind,state:'pending'};attempts.push(attempt);save();say('World App 승인 대기 중입니다. 결과가 불명확하면 재요청하지 마세요.');render();const activeAttempt=attempt;
const timer=setTimeout(()=>{
  // A slow approval is not a failed native command. Keep awaiting its result and
  // retain the exclusive lock; reloads remain blocked by this durable record.
  try{attempts=readAttempts();const recorded=attempts.find(a=>a.id===activeAttempt.id);if(recorded&&recorded.state!=='funds_found'){recorded.state='unknown';recorded.errorCode='native_timeout';save();}say('World App 응답을 기다리고 있습니다. 90초가 지나도 전송 실패로 처리하지 않습니다. 재요청하지 마세요.');}
  catch{say('전송 결과 확인이 필요합니다. 저장 상태를 확인하지 못했으므로 재요청하지 마세요.');}
},90000);
let response;
try{response=await MiniKit.sendTransaction({chainId:480,transactions:manifest.transactions.map((t:any)=>({to:t.to,data:t.data,value:t.value}))});}
finally{clearTimeout(timer);}
if(response.executedWith!=='minikit')throw Error('네이티브 응답을 확인할 수 없습니다.');const result=response.data;if(!same(result.from,wallet)||!/^0x[\da-f]{64}$/i.test(result.userOpHash))throw Error('전송 지갑 또는 요청 해시를 확인할 수 없습니다.');attempts=readAttempts();const recorded=attempts.find(a=>a.id===activeAttempt.id);if(!recorded)throw Error('원래 전송 요청 기록을 확인할 수 없습니다.');if(recorded.state!=='funds_found')recorded.state='submitted';recorded.userOpHash=result.userOpHash;delete recorded.errorCode;save();say(`요청 접수: ${result.userOpHash}\n전송 상태를 조회하세요. 영수증 확인 전에는 송금 완료가 아닙니다.`);}catch(e){const code=nativeCode(e);if(attempt){attempts=readAttempts();const current=attempts.find(a=>a.id===attempt!.id);if(current)attempt=current;else attempts.push(attempt);const diagnostic=showDiagnostic({code,details:(e as any)?.details,message:e instanceof Error?e.message:undefined});attempt.diagnostic=diagnostic;localStorage.setItem(diagnosticKey,JSON.stringify(diagnostic));if(isDefinitelyNotSubmittedResponse(code,Boolean((e as any)?.userOpHash||(e as any)?.transactionHash||(e as any)?.transactionId||(e as any)?.details?.userOpHash||(e as any)?.details?.transactionHash||(e as any)?.details?.transactionId))){attempts=attempts.filter(a=>a.id!==attempt!.id);save();say(`${code} · 미전송\n비용 확인을 취소했거나 요청이 허용되지 않았습니다. 원인을 확인한 후 직접 다시 요청할 수 있습니다.`);}else{attempt.state='unknown';attempt.errorCode=code;save();say(`결과 확인 필요: ${code}\n재요청은 차단되었습니다. 전송 상태를 조회하세요.`);}}else say(e instanceof Error?e.message:code);}finally{busy=false;render();}}
async function auth(){if(busy)return;busy=true;render();try{if(!installed)throw Error('World App에서 여세요.');clearSession();const result=await signInWithWorldApp(async nonce=>{try{const r=await MiniKit.walletAuth({nonce,statement:SIGN_IN_STATEMENT});if(r.executedWith!=='minikit')return{ok:false,error:'World App 네이티브 인증이 필요합니다.',userFacing:true};return{ok:true,address:r.data.address,message:r.data.message,signature:r.data.signature};}catch(e){clearSession();return{ok:false,error:nativeCode(e),userFacing:true};}});if(!result.ok){clearSession();throw Error(result.error);}session();say('지정된 지갑의 서버 서명 검증을 완료했습니다.');}catch(e){clearSession();say((e as Error).message);}finally{busy=false;render();}}
try{validate();attempts=readAttempts();const previousDiagnostic=localStorage.getItem(diagnosticKey);if(previousDiagnostic)showDiagnostic(JSON.parse(previousDiagnostic));MiniKit.install(__APP_ID__);installed=MiniKit.isInstalled();document.querySelector('#build-version')!.textContent=`빌드 ${__OPERATOR_BUILD__} · 명세 ${manifest.manifestHash.slice(0,14)}`;document.querySelector('#identity')!.textContent=`보낼 금액: 0.00004 ETH\n보내는 지갑 / 계약 수수료 수령 지갑\n${wallet}\n배포 전용 임시 지갑\n${manifest.deploymentEOA}\nWorld Chain (480)`;
const section=document.createElement('section');const h=document.createElement('h2');h.textContent='0.00004 ETH 보내기';section.append(h);const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='고정 전송 내용 확인';details.append(summary);const pre=document.createElement('pre');pre.textContent=JSON.stringify({manifestHash:manifest.manifestHash,transactions:manifest.transactions},null,2);details.append(pre);section.append(details);const button=document.createElement('button');button.dataset.deploy='fund';button.textContent='배포 비용 보내기';button.onclick=()=>void deploy('fund');section.append(button);document.querySelector('#rows')!.append(section);
document.querySelector('#auth')!.addEventListener('click',()=>void auth());document.querySelector('#refresh')!.addEventListener('click',()=>void refresh());say(!navigator.locks?'이 환경은 중복 전송 방지 기능을 지원하지 않습니다. 전송은 차단되었습니다.':installed?attempts.length?'이전 요청이 있습니다. 배포 상태를 먼저 조회하세요. '+attempts.map(a=>a.errorCode??'').filter(Boolean).join(', '):'먼저 지정된 지갑으로 로그인하세요.':'World App 연결을 확인하고 있습니다…');render();if(!installed){let checks=0;const readiness=setInterval(()=>{checks++;try{MiniKit.install(__APP_ID__);installed=MiniKit.isInstalled();}catch{}if(installed||checks>=40){clearInterval(readiness);say(installed?'먼저 지정된 지갑으로 로그인하세요.':'World App 연결을 확인하지 못했습니다. World App에서 다시 여세요.');render();}},250);}}catch(e){say((e as Error).message);document.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);}
