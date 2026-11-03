// Runner recovery tests use a public Anvil development key on chain31337 only.
// Production keystore is never read and production-chain signatures are impossible.
import assert from "node:assert/strict";
import { readFileSync,mkdtempSync,rmSync,existsSync,statSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { JsonRpcProvider,Wallet,Transaction,toQuantity,Interface,solidityPacked,keccak256,toUtf8Bytes } from "ethers";
import { runWorldAppFallback,privateJournal } from "./run-worldapp-fallback.mjs";
import { prepareWorldAppRouterFunding } from "./prepare-worldapp-router-funding.mjs";
import { prepareWorldAppFallback } from "./prepare-worldapp-fallback.mjs";
import { verifyYieldGeneration } from "./verify/yield-generation.mjs";
import { verifyExactFundingCallData } from "./lib/worldapp-funding-proof.mjs";
const fixture=JSON.parse(readFileSync(new URL("../deployment/worldapp-router-funding-2026-11-03.json",import.meta.url)));
const directory=mkdtempSync(tmpdir()+"fallback-runner-test-");
const socket=createServer();await new Promise(r=>socket.listen(0,"127.0.0.1",r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const anvil=spawn(process.env.ANVIL_BINARY||"anvil",["--port",String(port),"--chain-id","31337","--fork-url",process.env.WORLDAPP_TEST_FORK_RPC||"https://worldchain-mainnet.g.alchemy.com/public","--fork-block-number",String(fixture.observation.number),"--gas-price",fixture.quote.gasPriceWei,"--silent"],{stdio:"ignore"});
let spawnError;anvil.on("error",e=>spawnError=e);const provider=new JsonRpcProvider(`http://127.0.0.1:${port}`,31337,{batchMaxCount:1,cacheTimeout:-1});
try{
 for(let i=0;;i++){if(spawnError)throw spawnError;try{await provider.send("eth_chainId",[]);break;}catch(e){if(i>100)throw e;await sleep(100);}}
 const originalSend=provider.send.bind(provider);provider.send=(method,params)=>method==="eth_gasPrice"?Promise.resolve(toQuantity(BigInt(fixture.quote.gasPriceWei))):originalSend(method,params);
 // These are read-only chain480 verification rules over a disposable World Chain
 // state fork. Actual signer and transaction chain IDs remain31337 throughout.
 const verificationProvider=new Proxy(provider,{get(target,key){if(key==="getNetwork")return async()=>({chainId:480n});const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;}});
 const signer=new Wallet(keccak256(toUtf8Bytes("Inheritance public test-only chain31337 fallback key")));
 await provider.send("anvil_setBalance",[signer.address,"0x0"]);await provider.send("anvil_setNonce",[signer.address,"0x0"]);
 const astArtifacts=process.env.AST_ARTIFACTS||"/tmp/yield-generation-ast-out";
 const prepared=await prepareWorldAppFallback({provider:verificationProvider,deploymentEOA:signer.address,astArtifacts});
 const {deploymentManifest}=prepared;
 const fundingManifest=await prepareWorldAppRouterFunding({provider:verificationProvider,previousManifest:prepared.fundingManifest,deploymentManifest,astArtifacts});
 const moduleABI=new Interface(["function executeUserOp(address,uint256,bytes,uint8)","function executeUserOpWithErrorString(address,uint256,bytes,uint8)"]);const multiABI=new Interface(["function multiSend(bytes)"]);
 const pack=tx=>solidityPacked(["uint8","address","uint256","uint256","bytes"],[0,tx.to,BigInt(tx.value),(tx.data.length-2)/2,tx.data]);
 const packed=fundingManifest.transactions.map(pack).map((x,i)=>i?x.slice(2):x).join("");
 const callData=moduleABI.encodeFunctionData("executeUserOp",["0x9641d764fc13c8B624c04430C7356C1C7C8102e2",0,multiABI.encodeFunctionData("multiSend",[packed]),1]);
 assert.equal(verifyExactFundingCallData(callData,fundingManifest),true);
 for(const wrapper of ["0x9641d764fc13c8B624c04430C7356C1C7C8102e2","0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526"]){
  for(const fn of ["executeUserOp","executeUserOpWithErrorString"]){
   const valid=moduleABI.encodeFunctionData(fn,[wrapper,0,multiABI.encodeFunctionData("multiSend",[packed]),1]);assert.equal(verifyExactFundingCallData(valid,fundingManifest),true);
   const delegatePacked="0x01"+packed.slice(4);const bad=moduleABI.encodeFunctionData(fn,[wrapper,0,multiABI.encodeFunctionData("multiSend",[delegatePacked]),1]);assert.throws(()=>verifyExactFundingCallData(bad,fundingManifest),/Only CALL/);
  }
 }
 const legacyPacked=prepared.fundingManifest.transactions.map(pack).map((x,i)=>i?x.slice(2):x).join("");
 const legacyCall=moduleABI.encodeFunctionData("executeUserOp",["0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526",0,multiABI.encodeFunctionData("multiSend",[legacyPacked]),1]);
 assert.equal(verifyExactFundingCallData(legacyCall,prepared.fundingManifest),true);
 assert.throws(()=>verifyExactFundingCallData(legacyCall,fundingManifest));assert.throws(()=>verifyExactFundingCallData(callData,prepared.fundingManifest));
 const malicious=structuredClone(fundingManifest);malicious.transactions[1].value="0x1";
 assert.throws(()=>verifyExactFundingCallData(callData,malicious));
 let loads=0;
 const options={provider,fundingManifest,deploymentManifest,privateDirectory:directory,astArtifacts,
  testOnly:{chainId:31337,skipFundingProof:true,skipFinality:true,allowMissingL1Receipt:true,loadSigner:async()=>{loads++;return signer;},verifyGeneration:args=>verifyYieldGeneration({...args,provider:verificationProvider})}};
 assert.equal((await runWorldAppFallback(options)).status,"awaiting_fixed_funding");assert.equal(loads,0);
 await provider.send("anvil_setBalance",[signer.address,toQuantity(40000000000000n)]);
 assert.equal((await runWorldAppFallback(options)).status,"dry_run_ready");assert.equal(loads,0);assert.equal(existsSync(privateJournal(directory).filename),false);
 await assert.rejects(runWorldAppFallback({...options,broadcast:true}),/Explicit funding manifest approval required/);assert.equal(loads,0);
 await provider.send("anvil_setBalance",[signer.address,toQuantity(40000000000001n)]);
 await assert.rejects(runWorldAppFallback(options),/Unexpected funding/);await provider.send("anvil_setBalance",[signer.address,toQuantity(40000000000000n)]);
 const beforePrice=provider.send;provider.send=(method,params)=>method==="eth_gasPrice"?Promise.resolve(toQuantity(1000000000n)):beforePrice(method,params);
 await assert.rejects(runWorldAppFallback(options),/Fresh all-in gas/);assert.equal(loads,0);provider.send=beforePrice;
 const approvals={broadcast:true,approvedManifestHash:fundingManifest.manifestHash,approvedDeploymentManifestHash:deploymentManifest.manifestHash,approvedMaxSpendWei:"40000000000000"};
 const originalBroadcast=provider.broadcastTransaction.bind(provider),attempts=[];
 provider.broadcastTransaction=async raw=>{const state=privateJournal(directory).load();assert.ok(state);assert.equal(state.entries[0].rawTransaction,raw,"Signed bytes must be durable before submission");assert.equal(Transaction.from(raw).chainId,31337n);attempts.push(raw);throw new Error("Injected unknown submission before network acceptance");};
 const first=await runWorldAppFallback({...options,...approvals});assert.equal(first.status,"submission_unknown_retry_same_bytes_only");assert.equal(loads,1);
 provider.broadcastTransaction=async raw=>{attempts.push(raw);return originalBroadcast(raw);};
 const retried=await runWorldAppFallback({...options,...approvals});assert.equal(retried.status,"submitted");assert.equal(attempts[0],attempts[1]);assert.equal(loads,1,"Recovery must not sign a replacement");
 const originalCount=provider.getTransactionCount.bind(provider);provider.getTransactionCount=(address,tag)=>tag==="pending"?Promise.resolve(2):originalCount(address,tag);
 await assert.rejects(runWorldAppFallback({...options,...approvals}),/Untracked pending nonce/);assert.equal(loads,1,"Untracked pending tx must never trigger a replacement signature");provider.getTransactionCount=originalCount;
 let result;
 for(let i=0;i<12;i++){result=await runWorldAppFallback({...options,...approvals});if(result.status==="complete")break;assert.ok(["submitted","pending_finality"].includes(result.status),JSON.stringify(result));await sleep(50);}
 assert.equal(result.status,"complete");assert.equal(loads,4,"Exactly four intended signatures on chain31337");
 assert.equal(statSync(privateJournal(directory).filename).mode&0o777,0o600);
 const state=privateJournal(directory).load();assert.deepEqual(state.entries.map(x=>x.nonce),[0,1,2,3]);assert.ok(state.entries.every(x=>x.status==="confirmed"));
 for(const entry of state.entries)assert.equal(Transaction.from(entry.rawTransaction).chainId,31337n);
 const damaged=structuredClone(state);damaged.entries[0].hash="0x"+"00".repeat(32);privateJournal(directory).save(damaged);
 await assert.rejects(runWorldAppFallback(options),/Journal transaction hash/);assert.equal(loads,4);privateJournal(directory).save(state);
 console.log(JSON.stringify({status:"PASS",testChainId:31337,signatures:loads,nonces:state.entries.map(x=>x.nonce),spentWei:result.spentWei,returnedWETHWei:result.returnedWETHWei,nativeDustWei:result.nativeDustWei,note:"Test-only public development key; local Anvil omits OP L1/operator charges; production quote remains oracle-derived"}));
 console.log("PASS dry-run no key access, approvals/dust/fee-cap/untracked-pending guards, exact funding decoder, journal-before-submit, same-byte unknown recovery, two CREATE generation proofs, fixed WETH return, corrupt journal refusal");
}finally{provider.destroy();anvil.kill("SIGTERM");rmSync(directory,{recursive:true,force:true});}
