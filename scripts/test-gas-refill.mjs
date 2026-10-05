// All signatures and transactions use disposable wallets on local Anvil only.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, Transaction, keccak256, parseEther, toBeHex } from "ethers";
import { IDENTITIES, FUNDING_ABI, runGasRefillCycleWithTestConfig } from "../gas-refill/src/funding.mjs";
import worker from "../gas-refill/src/worker.mjs";
import { gasRefillTestStorage } from "./lib/gas-refill-test-storage.mjs";

const fork = process.env.GAS_FUNDING_REAL_FORK === "true";
const forkRpc = process.env.WORLDCHAIN_FORK_RPC;
const forkBlock = Number(process.env.WORLDCHAIN_FORK_BLOCK || 35_837_437);
if (fork && !forkRpc) { console.log("SKIP: explicitly set WORLDCHAIN_FORK_RPC for real protocol fork."); process.exit(0); }
if (fork) { assert.equal(new URL(forkRpc).protocol, "https:"); assert.ok(Number.isSafeInteger(forkBlock) && forkBlock > 0); }
const root = new URL("../", import.meta.url);
const artifact = (file,name) => JSON.parse(readFileSync(new URL("out/" + file + "/" + name + ".json",root)));
const server = createNetServer();
await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const url = "http://127.0.0.1:" + port;
const anvil = spawn("anvil",["--port",String(port),"--host","127.0.0.1","--chain-id","480","--base-fee","0","--gas-price","1500000","--silent",...(fork ? ["--fork-url",forkRpc,"--fork-block-number",String(forkBlock)] : [])],{stdio:"ignore"});
const guard = setTimeout(() => { console.error("Gas funding integration timed out"); anvil.kill("SIGTERM"); process.exit(1); },180000);
guard.unref();
let provider,proxy;
const stores=[];
const treasury=Wallet.createRandom(),bot=Wallet.createRandom(),keeper=Wallet.createRandom().address;
const behavior={sends:[],dropAck:false,hideReceipt:false,rpcError:null,finality:false,reorgOnFinality:false,reorgNext:false,operatorFee:0n,setupReorgSnapshot:null,setupDeploySent:false};
let checks=0, funding, testCfg, env;
async function rpc(method,params=[]) {
 const result=await (await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})})).json();
 if(result.error)throw new Error("Local RPC failed: "+method+" "+JSON.stringify(result.error));
 return result.result;
}
async function deploy(file,name,args=[]) {
 const a=artifact(file,name);
 const c=await new ContractFactory(a.abi,a.bytecode.object,treasury.connect(provider)).deploy(...args,{gasPrice:1500000n});
 await c.waitForDeployment(); return c;
}
async function shadow(file,name,address,args=[]) {
 const c=await deploy(file,name,args); await rpc("anvil_setCode",[address,await provider.getCode(c.target)]);
 return new Contract(address,artifact(file,name).abi,treasury.connect(provider));
}
async function tx(call) { await (await call).wait(); }
async function check(name,fn){ await fn(); checks++; console.log("PASS "+name); }
function freshEnv(){const store=gasRefillTestStorage();stores.push(store);return {...env,DB:store.DB,_store:store};}
async function run(e=env,c=testCfg){return runGasRefillCycleWithTestConfig(e,c);}
async function finish(e=env,c=testCfg){let r;for(let i=0;i<5;i++){r=await run(e,c);if(r.reason==="funded")return r;assert.equal(r.reason,"pending",JSON.stringify(r));await delay(50);}throw new Error("Funding did not finish "+JSON.stringify(r));}
try {
 for(let i=0;;i++){try{await rpc("eth_chainId");break;}catch{if(i>100||anvil.exitCode!==null)throw new Error("Anvil unavailable");await delay(100);}}
 provider=new JsonRpcProvider(url,480,{staticNetwork:true,cacheTimeout:-1,batchMaxCount:1});provider.pollingInterval=10;
 await rpc("anvil_setBalance",[treasury.address,toBeHex(parseEther("100"))]);
 await rpc("anvil_setBalance",[bot.address,toBeHex(parseEther("0.00002"))]);
 await rpc("anvil_setBalance",[keeper,"0x0"]);
 let usdc,wld;
 if(fork){
  usdc=new Contract(IDENTITIES.usdc,["function transfer(address,uint256) returns(bool)","function approve(address,uint256) returns(bool)","function balanceOf(address) view returns(uint256)","function allowance(address,address) view returns(uint256)"],treasury.connect(provider));
  wld=new Contract(IDENTITIES.wld,usdc.interface,treasury.connect(provider));
  for(const [token,holder,amount] of [[usdc,"0x5f835420502A7702de50Cd0E78D8aA3608b2137e",50_000_000n],[wld,"0x02371da6173CF95623Da4189E68912233cc7107C",50n*10n**18n]]){
   await rpc("anvil_setBalance",[holder,toBeHex(parseEther("1"))]);await rpc("anvil_impersonateAccount",[holder]);
   await tx(token.connect(await provider.getSigner(holder)).transfer(treasury.address,amount,{gasPrice:1500000n}));
  }
 }else{
  usdc=await shadow("MockGasRefill.sol","MockGasRefillERC20",IDENTITIES.usdc,["USDC","USDC",6]);
  wld=await shadow("MockGasRefill.sol","MockGasRefillERC20",IDENTITIES.wld,["WLD","WLD",18]);
  const weth=await shadow("MockGasRefill.sol","MockGasRefillWETH","0x4200000000000000000000000000000000000006");
  const routerAddress="0x091AD9e2e6e5eD44c1c66dB50e49A601F9f36cF6";
  await shadow("OperatorGasFunding.t.sol","FundingRouterMock",routerAddress);
  await tx(weth.mint(routerAddress,parseEther("100")));await rpc("anvil_setBalance",[weth.target,toBeHex(parseEther("100"))]);
  const pools=[["0x5f835420502A7702de50Cd0E78D8aA3608b2137e",-197000],["0x02371da6173CF95623Da4189E68912233cc7107C",-281850],["0x494D68e3cAb640fa50F4c1B3E2499698D1a173A0",-84450]];
  for(const [address,tick]of pools){ const pool=await shadow("MockGasRefill.sol","MockGasRefillPool",address,["0x7a5028BDa40e7B173C278C5342087826455ea25a",IDENTITIES.wld,IDENTITIES.usdc,2n**96n,tick]); await tx(pool.setTicks(2n**96n,tick,tick,0)); }
  for(const [strategy,token]of [[IDENTITIES.usdcStrategy,IDENTITIES.usdc],[IDENTITIES.wldStrategy,IDENTITIES.wld]]){
   const s=await shadow("MockERC4626.sol","MockERC4626",strategy,[token]);await tx(s.setRate(parseEther("1")));await tx(s.setLiquidity(2n**256n-1n));
  }
  await tx(usdc.mint(treasury.address,50_000_000n));await tx(wld.mint(treasury.address,50n*10n**18n));
 }
 funding=await deploy("OperatorGasFunding.sol","OperatorGasFunding",[treasury.address,bot.address,keeper,10_000_000n]);
 for(const token of [usdc,wld])await tx(token.approve(funding.target,2n**256n-1n,{gasPrice:1500000n}));
 proxy=createServer(async(request,response)=>{
  try{let body="";for await(const part of request)body+=part;const call=JSON.parse(body);
   if(call.method===behavior.rpcError){response.statusCode=503;response.end("{}");return;}
   if(call.method==="eth_sendRawTransaction")behavior.sends.push(keccak256(call.params[0]));
   if(call.method==="eth_sendRawTransaction"&&behavior.setupReorgSnapshot&&Transaction.from(call.params[0]).to===null)behavior.setupDeploySent=true;
   let result;
   if(!fork&&call.method==="eth_call"&&String(call.params[0].to).toLowerCase()==="0x420000000000000000000000000000000000000f"){
    const operatorSelector=new Contract("0x420000000000000000000000000000000000000F",["function getOperatorFee(uint256) view returns(uint256)"],provider).interface.getFunction("getOperatorFee").selector;
    result=toBeHex(call.params[0].data.startsWith(operatorSelector)?behavior.operatorFee:0n,32);
   }
   else if(call.method==="eth_gasPrice")result="0x16e360";
   else if(call.method==="eth_getTransactionCount"&&call.params[1]==="finalized")result=await rpc(call.method,[call.params[0],behavior.finality?"0x0":"latest"]);
   else if(call.method==="eth_getTransactionReceipt"&&behavior.hideReceipt)result=null;
   else if(call.method==="eth_getBlockByNumber"&&call.params[0]==="finalized"){
    result=await rpc("eth_getBlockByNumber",[behavior.finality?"0x0":"latest",false]);
    if(behavior.reorgOnFinality)behavior.reorgNext=true;
   }else{
    result=await rpc(call.method,call.params);
    if(call.method==="eth_getBlockByNumber"&&behavior.reorgNext){result={...result,hash:"0x"+"a".repeat(64)};behavior.reorgNext=false;}
   }
   if(call.method==="eth_getTransactionReceipt"&&result&&behavior.operatorFee>0n){result.operatorFeeScalar="0x0";result.operatorFeeConstant=toBeHex(behavior.operatorFee);}
   if(call.method==="eth_estimateGas"&&call.params[0].to&&behavior.setupDeploySent&&behavior.setupReorgSnapshot){
    await rpc("evm_revert",[behavior.setupReorgSnapshot]);behavior.setupReorgSnapshot=null;behavior.setupDeploySent=false;
   }
   if(call.method==="eth_sendRawTransaction"&&behavior.dropAck){behavior.dropAck=false;response.destroy();return;}
   response.setHeader("Content-Type","application/json");response.end(JSON.stringify({jsonrpc:"2.0",id:call.id,result}));
  }catch{response.statusCode=500;response.end("{}");}
 });
 await new Promise(resolve=>proxy.listen(0,"127.0.0.1",resolve));
 testCfg={identities:{...IDENTITIES,rpcUrl:"http://127.0.0.1:"+proxy.address().port,treasury:treasury.address,keeper,bot:bot.address},deployment:{address:funding.target,codeHash:keccak256(await provider.getCode(funding.target))}};
 if(fork){const chainTime=(await provider.getBlock("latest")).timestamp*1000,started=Date.now();testCfg.now=()=>chainTime+Date.now()-started;}
 const store=gasRefillTestStorage();stores.push(store);env={DB:store.DB,GAS_REFILL_ENABLED:"true",GAS_REFILL_PRIVATE_KEY:bot.privateKey,_store:store};
 await check("disabled service and mutating HTTP endpoints never send",async()=>{assert.equal((await run({...env,GAS_REFILL_ENABLED:"false"})).reason,"disabled");const r=await worker.fetch(new Request("https://fixture/api/health",{method:"POST"}),env);assert.equal(r.status,404);assert.equal(behavior.sends.length,0);});
 await check("runtime identity/code hash mismatch rejects before signing",async()=>{assert.equal((await run(freshEnv(),{...testCfg,deployment:{...testCfg.deployment,codeHash:"0x"+"f".repeat(64)}})).reason,"wrong_contract");assert.equal(behavior.sends.length,0);});
 if(!fork) await check("a wallet below the maximum gas ceiling can fund an affordable padded estimate",async()=>{
  await rpc("anvil_setBalance",[bot.address,toBeHex(parseEther("0.000001"))]);
  const boundary=freshEnv();
  assert.equal((await run(boundary)).reason,"pending");
  const job=boundary._store.native.prepare("SELECT tx_raw,reserved_wei FROM gas_funding_jobs WHERE state='pending'").get();
  const signed=Transaction.from(job.tx_raw);
  assert.ok(signed.gasLimit<1_500_000n);
  assert.ok(BigInt(job.reserved_wei)<=parseEther("0.000001"));
  assert.ok(1_500_000n*signed.gasPrice>parseEther("0.000001"));
  await rpc("anvil_setBalance",[bot.address,"0x3e8"]);
  const empty=freshEnv();
  assert.equal((await run(empty)).reason,"insufficient_bot_gas");
  assert.equal(empty._store.native.prepare("SELECT COUNT(*) AS n FROM gas_funding_jobs").get().n,0);
  await rpc("anvil_setBalance",[bot.address,toBeHex(parseEther("0.00002"))]);
 });
 await check("signature persisted before broadcast, crash safely resumes same hash",async()=>{
  const crash={...testCfg,hooks:{afterStage:()=>{throw new Error("simulated crash");}}};
  assert.equal((await run(env,crash)).reason,"rpc_unavailable");assert.equal(behavior.sends.length,0);
  const row=store.native.prepare("SELECT * FROM gas_funding_jobs").get();assert.equal(row.state,"pending");assert.equal(Transaction.from(row.tx_raw).hash,row.tx_hash);
  behavior.dropAck=true;await run();behavior.hideReceipt=true;
  assert.equal((await run()).reason,"pending");assert.equal(store.native.prepare("SELECT COUNT(*) AS n FROM gas_funding_jobs").get().n,1);behavior.hideReceipt=false;
  behavior.finality=true;assert.equal((await run()).reason,"awaiting_finality");behavior.finality=false;
  behavior.reorgOnFinality=true;assert.equal((await run()).reason,"pending");assert.equal(store.native.prepare("SELECT state FROM gas_funding_jobs").get().state,"pending");behavior.reorgOnFinality=false;
  await finish();assert.ok(behavior.sends.every(hash=>hash===row.tx_hash));assert.equal(store.native.prepare("SELECT state FROM gas_funding_jobs").get().state,"completed");
 });
 await check("one atomic transaction funds keeper and bot without EOA allowance",async()=>{
  assert.equal(await provider.getBalance(keeper),parseEther("0.001"));assert.ok(await provider.getBalance(bot.address)>=parseEther("0.000049"));
  assert.equal(await usdc.allowance(treasury.address,bot.address),0n);assert.equal(await wld.allowance(treasury.address,bot.address),0n);
  assert.equal(await usdc.allowance(funding.target,"0x091AD9e2e6e5eD44c1c66dB50e49A601F9f36cF6"),0n);
 });
 await check("healthy balances avoid another swap",async()=>{const before=behavior.sends.length;assert.equal((await run()).reason,"healthy");assert.equal(behavior.sends.length,before);});
 await check("WLD fees fund gas when treasury USDC absent",async()=>{
  await tx(usdc.transfer(Wallet.createRandom().address,await usdc.balanceOf(treasury.address),{gasPrice:1500000n}));await rpc("anvil_setBalance",[keeper,"0x0"]);
  await finish();const row=store.native.prepare("SELECT * FROM gas_funding_jobs ORDER BY created_at DESC LIMIT 1").get();assert.ok([1,2].includes(row.route));assert.equal(await provider.getBalance(keeper),parseEther("0.001"));
 });
 await check("tampered persisted raw transaction blocks without another signature",async()=>{
  await rpc("anvil_setBalance",[keeper,"0x0"]);const e=freshEnv();await run(e,{...testCfg,hooks:{afterStage:()=>{throw new Error("crash");}}});
  e._store.native.prepare("UPDATE gas_funding_jobs SET route=9").run();const count=behavior.sends.length;assert.equal((await run(e)).reason,"recovery_invalid");assert.equal(behavior.sends.length,count);
 });
 await check("controller rotation shares the signer lease and preserves exact old deployment recovery",async()=>{
  // This fixture exercises several real refills in one window. Raise only its
  // owner-controlled budget so nonce tests retain an executable candidate.
  await tx(funding.setDailyBudget(20_000_000n,{gasPrice:1500000n}));
  const next=await deploy("OperatorGasFunding.sol","OperatorGasFunding",[treasury.address,bot.address,keeper,10_000_000n]);
  const rotated={...testCfg,deployment:{address:next.target,codeHash:keccak256(await provider.getCode(next.target))}};
  const e=freshEnv();let overlap;
  assert.equal((await run(e,{...testCfg,hooks:{afterStage:async()=>{overlap=await run(e,rotated);}}})).reason,"pending");
  assert.equal(overlap.reason,"locked");
  const original=e._store.native.prepare("SELECT * FROM gas_funding_jobs").get(),sends=behavior.sends.length;
  assert.equal(original.scope,"480:"+bot.address.toLowerCase());
  assert.equal((await run(e,rotated)).reason,"deployment_transition_pending");
  assert.equal(behavior.sends.length,sends);assert.equal(e._store.native.prepare("SELECT COUNT(*) AS n FROM gas_funding_jobs").get().n,1);
  assert.equal(e._store.native.prepare("SELECT tx_raw,state FROM gas_funding_jobs").get().tx_raw,original.tx_raw);
  assert.equal(e._store.native.prepare("SELECT state FROM gas_funding_jobs").get().state,"pending");
  // The pre-upgrade address-scoped record cannot be ignored by the new release.
  e._store.native.prepare("UPDATE gas_funding_jobs SET scope=?").run("480:"+funding.target.toLowerCase());
  assert.equal((await run(e)).reason,"deployment_transition_pending");assert.equal(behavior.sends.length,sends);
  e._store.native.prepare("UPDATE gas_funding_jobs SET scope=?").run(original.scope);
  await finish(e);
  const recovered=e._store.native.prepare("SELECT * FROM gas_funding_jobs").get();
  assert.equal(recovered.state,"completed");assert.equal(recovered.tx_hash,original.tx_hash);
  assert.ok(behavior.sends.slice(sends).every(hash=>hash===original.tx_hash));
  assert.equal((await run(e,rotated)).reason,"healthy");
 });
 await check("a finalized nonce used by the wallet owner retires ambiguous work without reporting funding",async()=>{
  await rpc("anvil_setBalance",[keeper,"0x0"]);
  const e=freshEnv();assert.equal((await run(e)).reason,"pending");
  const row=e._store.native.prepare("SELECT * FROM gas_funding_jobs").get();
  await tx(bot.connect(provider).sendTransaction({to:Wallet.createRandom().address,value:0n,nonce:Number(row.nonce),gasLimit:21000n,gasPrice:1500000n}));
  assert.equal((await run(e)).reason,"nonce_consumed");const retired=e._store.native.prepare("SELECT * FROM gas_funding_jobs").get();assert.equal(retired.state,"failed");assert.equal(retired.gas_spent,null);assert.equal(retired.cost_usdc,null);
 });
 await check("lease fencing prevents overlap and ambiguous RPC does not stage",async()=>{
  const e=freshEnv();behavior.rpcError="eth_getTransactionCount";assert.equal((await run(e)).reason,"rpc_unavailable");behavior.rpcError=null;assert.equal(e._store.native.prepare("SELECT COUNT(*) AS n FROM gas_funding_jobs").get().n,0);
  const scope="480:"+bot.address.toLowerCase();e._store.native.prepare("UPDATE gas_funding_locks SET lease_token='another-worker',lease_until=? WHERE scope=?").run(Date.now()+120000,scope);assert.equal((await run(e)).reason,"locked");
 });
 if(!fork)await check("local setup survives finality interruption, revokes EOA allowance, and reruns without duplicate funding",async()=>{
  const temp=mkdtempSync(join(tmpdir(),"inheritance-gas-setup-"));
  try{
   symlinkSync(fileURLToPath(new URL("out",root)),join(temp,"out"),"dir");
   writeFileSync(join(temp,".env.deploy"),"PRIVATE_KEY="+treasury.privateKey+"\n",{mode:0o600});
   writeFileSync(join(temp,".env.gas-refill"),"GAS_REFILL_PRIVATE_KEY="+bot.privateKey+"\n",{mode:0o600});
   const loader=join(temp,"fixture-loader.mjs");
   const identities={...IDENTITIES,rpcUrl:testCfg.identities.rpcUrl,treasury:treasury.address,bot:bot.address,keeper};
   const replacement="export const IDENTITIES="+JSON.stringify(identities)+";export const FUNDING_ABI="+JSON.stringify(FUNDING_ABI)+";";
   writeFileSync(loader,"export async function load(url,context,nextLoad){if(url.endsWith('/gas-refill/src/funding.mjs'))return {format:'module',shortCircuit:true,source:"+JSON.stringify(replacement)+"};return nextLoad(url,context);}");
   const execute=async options=>{
    const child=spawn(process.execPath,["--experimental-loader",loader,fileURLToPath(new URL("scripts/setup-gas-refill.mjs",root)),...options],{cwd:temp,stdio:["ignore","pipe","pipe"]});let output="";
    child.stdout.on("data",chunk=>{output+=chunk;});child.stderr.on("data",chunk=>{output+=chunk;});
    const code=await new Promise(resolve=>child.on("exit",resolve));return {code,output};
   };
   behavior.operatorFee=100_000_000_000n;
   await tx(usdc.approve(bot.address,1n,{gasPrice:1500000n}));await rpc("anvil_setBalance",[bot.address,"0x0"]);
   const dry=await execute(["--check"]);assert.equal(dry.code,0,dry.output);assert.equal(await usdc.allowance(treasury.address,bot.address),1n);
   const originalNonce=await provider.getTransactionCount(treasury.address);
   behavior.setupReorgSnapshot=await rpc("evm_snapshot",[]);
   const reorg=await execute(["--activate","--broadcast"]);assert.equal(reorg.code,1);assert.match(reorg.output,/Previously included setup changed/);
   const orphaned=JSON.parse(readFileSync(join(temp,".env.gas-funding-activation.json"),"utf8"));
   assert.equal(orphaned.steps.length,1,"a reorg must stop before another signature uses the deployment nonce");
   assert.equal(Transaction.from(orphaned.steps[0].raw).nonce,originalNonce);
   assert.equal(await provider.getTransactionCount(treasury.address),originalNonce);
   // Only the disposable fixture is reset. Production retains the exact journal
   // for operator reconciliation instead of replacing an orphaned signature.
   rmSync(join(temp,".env.gas-funding-activation.json"));
   behavior.finality=true;const first=await execute(["--activate","--broadcast"]);assert.equal(first.code,1);assert.match(first.output,/canonical finality/);
   const staged=JSON.parse(readFileSync(join(temp,".env.gas-funding-activation.json"),"utf8"));
   assert.ok(staged.steps.length>=6 && staged.steps.every(step=>step.included && !step.confirmed),"setup must stage every canonical approval but cannot claim activation before finality");
   const stagedNonce=await provider.getTransactionCount(treasury.address);
   const stillPending=await execute(["--activate","--broadcast"]);assert.equal(stillPending.code,1);assert.match(stillPending.output,/canonical finality/);
   assert.equal(await provider.getTransactionCount(treasury.address),stagedNonce,"finality polling must never send duplicate funding or approvals");
   behavior.reorgOnFinality=true;
   const changedReceipt=await execute(["--activate","--broadcast"]);assert.equal(changedReceipt.code,1);assert.match(changedReceipt.output,/receipt changed before activation/);
   assert.equal(await provider.getTransactionCount(treasury.address),stagedNonce);
   assert.ok(JSON.parse(readFileSync(join(temp,".env.gas-funding-activation.json"),"utf8")).steps.every(step=>!step.confirmed));
   behavior.reorgOnFinality=false;
   behavior.finality=false;const resumed=await execute(["--activate","--broadcast"]);assert.equal(resumed.code,0,resumed.output);assert.match(resumed.output,/"activated":true/);
   assert.equal(await usdc.allowance(treasury.address,bot.address),0n);assert.equal(await provider.getBalance(bot.address),parseEther("0.00001"));
   const journal=JSON.parse(readFileSync(join(temp,".env.gas-funding-activation.json"),"utf8"));assert.ok(journal.steps.every(step=>step.confirmed));const nonce=await provider.getTransactionCount(treasury.address);
   assert.equal(nonce,stagedNonce,"finalizing the setup must not consume any new nonce");
   let l2Only=0n;
   for(const step of journal.steps){const receipt=await rpc("eth_getTransactionReceipt",[step.hash]);l2Only+=BigInt(receipt.gasUsed)*BigInt(receipt.effectiveGasPrice);}
   assert.equal(BigInt(journal.spent),l2Only+BigInt(journal.steps.length)*behavior.operatorFee,"operatorFeeConstant must be included in every settled setup receipt");
   const repeated=await execute(["--activate","--broadcast"]);assert.equal(repeated.code,0,repeated.output);assert.equal(await provider.getTransactionCount(treasury.address),nonce);
  }finally{behavior.finality=false;behavior.reorgOnFinality=false;behavior.reorgNext=false;behavior.operatorFee=0n;behavior.setupReorgSnapshot=null;behavior.setupDeploySent=false;rmSync(temp,{recursive:true,force:true});}
 });
 console.log(JSON.stringify({status:"passed",checks,protocol:fork?"real World Chain fork":"local Anvil protocol fixtures",forkBlock:fork?forkBlock:null,transactionsPerFunding:1,productionBroadcast:false}));
} finally {
 clearTimeout(guard);provider?.destroy();proxy?.close();for(const s of stores)s.native.close();anvil.kill("SIGTERM");
}
