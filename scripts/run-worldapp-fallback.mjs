// Guarded EOA deployment/remainder-return runner. DRY RUN IS THE DEFAULT.
// Production signing requires --broadcast true --approved-manifest-hash HASH
// --approved-deployment-manifest-hash HASH --approved-max-spend-wei 40000000000000
// --funding-tx-hash HASH --user-op-hash HASH. No key creation or account fallback.
// Signed bytes are journaled privately BEFORE submission; recovery never replaces them.
import assert from "node:assert/strict";
import { readFileSync,writeFileSync,mkdirSync,chmodSync,existsSync,renameSync,openSync,closeSync,fsyncSync,unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath,pathToFileURL } from "node:url";
import { Contract,ContractFactory,Interface,JsonRpcProvider,Transaction,Wallet,getCreateAddress,keccak256,toUtf8Bytes,toBeHex } from "ethers";
import { validateWorldAppFundingManifest,FUNDING_AMOUNT_WEI,FUNDING_WETH } from "./lib/worldapp-funding-manifest.mjs";
import { WALLET } from "./lib/worldapp-deployment-manifest.mjs";
import { verifyFundingReceipt } from "./lib/worldapp-funding-proof.mjs";
import { verifyYieldGeneration } from "./verify/yield-generation.mjs";
import { PRIVATE_FALLBACK_DIR } from "./prepare-worldapp-fallback.mjs";
const ROOT=fileURLToPath(new URL("../",import.meta.url));
const refundABI=new Interface(["function deposit() payable","function transfer(address,uint256) returns(bool)","event Transfer(address indexed from,address indexed to,uint256 value)"]);
const lower=x=>String(x).toLowerCase();
const same=(a,b,label)=>assert.equal(lower(a),lower(b),label);
const bodyHash=value=>{const{manifestHash,...body}=value;return keccak256(toUtf8Bytes(JSON.stringify(body)));};
export function privateJournal(directory) {
 const filename=path.join(directory,"runner-state.json");
 return {filename,load:()=>existsSync(filename)?JSON.parse(readFileSync(filename,"utf8")):null,
  save(state){mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);const tmp=filename+".tmp";
   writeFileSync(tmp,JSON.stringify(state,null,2)+"\n",{mode:0o600});chmodSync(tmp,0o600);
   const file=openSync(tmp,"r");try{fsyncSync(file);}finally{closeSync(file);}renameSync(tmp,filename);
   const dir=openSync(directory,"r");try{fsyncSync(dir);}finally{closeSync(dir);}
  }};
}
async function validateIntent(funding,deployment,artifacts,repo) {
 validateWorldAppFundingManifest(funding);same(bodyHash(deployment),deployment.manifestHash,"Deployment manifest digest");
 same(funding.deploymentManifestHash,deployment.manifestHash,"Pinned deployment manifest");
 assert.equal(deployment.chainId,480);same(deployment.deploymentEOA,funding.deploymentEOA,"Pinned EOA");same(deployment.wallet,WALLET,"Source wallet");same(deployment.feeRecipient,WALLET,"Fee recipient");
 assert.equal(deployment.factories.length,2);
 for(const [nonce,row]of deployment.factories.entries()){
  assert.equal(row.nonce,nonce);same(row.predictedAddress,getCreateAddress({from:funding.deploymentEOA,nonce}),"CREATE address");
  const kind=nonce===0?"wld":"usdc",child=nonce===0?"InheritanceVaultMorpho":"InheritanceVaultUSDC";assert.equal(row.kind,kind);assert.equal(row.factoryName,child+"Factory");
  for(const name of [child,child+"Factory",child+"Deployer"]){
   const a=JSON.parse(readFileSync(path.join(artifacts,`${name}.sol`,`${name}.json`),"utf8"));
   same(keccak256(a.bytecode.object),funding.artifactDigests[name].creationCodeHash,"Reviewed creation code");
   same(keccak256(a.deployedBytecode.object),funding.artifactDigests[name].runtimeTemplateHash,"Reviewed runtime template");
   const m=typeof a.metadata==="string"?JSON.parse(a.metadata):a.metadata;
   assert.ok(m.compiler.version.startsWith("0.8.38+"));assert.equal(m.settings.viaIR,true);assert.equal(m.settings.optimizer.runs,200);assert.equal(m.settings.optimizer.enabled,true);assert.equal(m.settings.evmVersion,"cancun");
   for(const [source,entry]of Object.entries(m.sources)){same(keccak256(readFileSync(path.resolve(repo,source))),entry.keccak256,"Source/artifact");same(entry.keccak256,funding.sourceDigests[source]?.keccak256,"Pinned source");}
  }
  const config=row.config;const wld="0x2cfc85d8e48f8eab294be644d9e25c3030863003";
  same(config.asset,nonce===0?wld:"0x79a02482a880bce3f13e09da970dc34db4cd24d1","Canonical asset");
  same(config.strategy,nonce===0?"0x348831b46876d3df2db98bdec5e3b4083329ab9f":"0xb1e80387ebe53ff75a89736097d34dc8d9e9045b","Canonical strategy");
  same(config.feeRecipient,WALLET,"Fixed fee recipient");assert.equal(config.performanceFeeBps,1000);
  if(nonce===1)same(config.rewardToken,wld,"Canonical reward");
  const a=JSON.parse(readFileSync(path.join(artifacts,`${row.factoryName}.sol`,`${row.factoryName}.json`),"utf8"));
  const args=nonce===0?[config.asset,config.strategy,WALLET,1000]:[config.asset,config.strategy,config.rewardToken,WALLET,1000];
  const expected=await new ContractFactory(a.abi,a.bytecode.object).getDeployTransaction(...args);
  same(expected.data,row.transaction.data,"Exact constructor init code");same(keccak256(expected.data),funding.normalCreateTargets[nonce].initCodeHash,"Pinned init code hash");same(row.initCodeHash,funding.normalCreateTargets[nonce].initCodeHash,"Deployment init hash");
  same(row.transaction.from,funding.deploymentEOA,"Pinned CREATE sender");assert.equal(row.transaction.to,null);assert.equal(BigInt(row.transaction.value),0n);
 }
}
async function quoteEnvelope(provider,request,nonce,chainId,gasLimit=null) {
 const gasPrice=BigInt(await provider.send("eth_gasPrice",[]));assert.ok(gasPrice>0n);
 const limit=gasLimit===null?(await provider.estimateGas(request)*120n+99n)/100n:BigInt(gasLimit);
 const {from,...unsigned}=request;const tx=Transaction.from({...unsigned,chainId,nonce,type:0,gasPrice,gasLimit:limit,value:BigInt(request.value||0)});
 const oracle=new Contract("0x420000000000000000000000000000000000000F",["function getL1FeeUpperBound(uint256) view returns(uint256)","function getOperatorFee(uint256) view returns(uint256)"],provider);
 const [l1,operator]=await Promise.all([oracle.getL1FeeUpperBound((tx.unsignedSerialized.length-2)/2),oracle.getOperatorFee(limit)]);
 return {request:{...unsigned,chainId,nonce,type:0,gasPrice:gasPrice.toString(),gasLimit:limit.toString(),value:BigInt(request.value||0).toString()},reserveWei:(limit*gasPrice+l1+operator).toString(),l1UpperBoundWei:l1.toString(),operatorReserveWei:operator.toString()};
}
function validateSignedEntry(entry,state,deployment) {
 const tx=Transaction.from(entry.rawTransaction);assert.ok(tx.isSigned());same(tx.hash,entry.hash,"Journal transaction hash");same(tx.from,state.deploymentEOA,"Journal signer");assert.equal(tx.chainId,BigInt(state.chainId));assert.equal(tx.nonce,entry.nonce);assert.equal(tx.type,0);
 assert.equal(tx.gasLimit,BigInt(entry.gasLimit));assert.equal(tx.gasPrice,BigInt(entry.gasPrice));
 if(entry.nonce<2){assert.equal(tx.to,null);same(tx.data,deployment.factories[entry.nonce].transaction.data,"Journal CREATE init code");assert.equal(tx.value,0n);}
 else if(entry.nonce===2){same(tx.to,FUNDING_WETH,"Refund WETH deposit target");same(tx.data,refundABI.encodeFunctionData("deposit"),"Refund deposit");assert.equal(tx.value,BigInt(state.returnAmountWei));}
 else{assert.equal(entry.nonce,3);same(tx.to,FUNDING_WETH,"Refund transfer target");same(tx.data,refundABI.encodeFunctionData("transfer",[WALLET,BigInt(state.returnAmountWei)]),"Exact WETH remainder recipient");assert.equal(tx.value,0n);}
 return tx;
}
async function readReceiptCost(provider,hash,testOnly) {
 const raw=await provider.send("eth_getTransactionReceipt",[hash]);if(!raw)return null;
 assert.ok(raw.gasUsed&&raw.effectiveGasPrice,"Missing execution fee evidence");
 if(raw.l1Fee==null&&!testOnly?.allowMissingL1Receipt)throw new Error("Missing OP L1 fee evidence; stop without signing another transaction");
 let operator=raw.operatorFee==null?null:BigInt(raw.operatorFee);
 if(operator===null){const oracle=new Contract("0x420000000000000000000000000000000000000F",["function getOperatorFee(uint256) view returns(uint256)"],provider);operator=await oracle.getOperatorFee(BigInt(raw.gasUsed),{blockTag:Number(BigInt(raw.blockNumber))});}
 return {raw,cost:BigInt(raw.gasUsed)*BigInt(raw.effectiveGasPrice)+BigInt(raw.l1Fee||0)+operator};
}
export async function runWorldAppFallback({provider,fundingManifest,deploymentManifest,broadcast=false,approvedManifestHash,approvedDeploymentManifestHash,approvedMaxSpendWei,
 fundingTxHash,userOpHash,privateDirectory=PRIVATE_FALLBACK_DIR,artifacts=path.join(ROOT,"out"),astArtifacts="/tmp/yield-generation-ast-out",repo=ROOT,testOnly=null}) {
 await validateIntent(fundingManifest,deploymentManifest,artifacts,repo);
 const chainId=Number((await provider.getNetwork()).chainId);
 if(testOnly){assert.equal(chainId,31337,"Test overrides are forbidden on production chain");assert.equal(testOnly.chainId,31337);}else assert.equal(chainId,480);
 const eoa=fundingManifest.deploymentEOA,store=privateJournal(privateDirectory);
 let state=store.load();
 if(state){same(state.fundingManifestHash,fundingManifest.manifestHash,"Journal funding manifest");same(state.deploymentManifestHash,deploymentManifest.manifestHash,"Journal deployment manifest");same(state.deploymentEOA,eoa,"Journal EOA");assert.equal(state.chainId,chainId);assert.equal(state.approvedMaxSpendWei,FUNDING_AMOUNT_WEI.toString());}
 const [balance,nonce,code]=await Promise.all([provider.getBalance(eoa),provider.getTransactionCount(eoa,"pending"),provider.getCode(eoa)]);
 assert.equal(code,"0x","Deployment account is no longer an EOA");
 if(!state&&balance===0n&&nonce===0)return {status:"awaiting_fixed_funding",broadcast:false,deploymentEOA:eoa,fundingAmountWei:FUNDING_AMOUNT_WEI.toString()};
 if(!state){assert.equal(balance,FUNDING_AMOUNT_WEI,"Unexpected funding or unsolicited dust; stop");assert.equal(nonce,0,"Unexpected nonce; never select another account");}
 if(broadcast){same(approvedManifestHash,fundingManifest.manifestHash,"Explicit funding manifest approval required");same(approvedDeploymentManifestHash,deploymentManifest.manifestHash,"Explicit deployment manifest approval required");assert.equal(String(approvedMaxSpendWei),FUNDING_AMOUNT_WEI.toString(),"Explicit fixed budget approval required");}
 const proof=testOnly?.skipFundingProof?{testOnly:true}:await verifyFundingReceipt({provider,manifest:fundingManifest,fundingTxHash,userOpHash});
 if(!testOnly?.skipFinality&&proof.blockNumber){const finalized=await provider.getBlock("finalized");if(!finalized||finalized.number<proof.blockNumber)return{status:"funding_pending_finality",broadcast:false};}
 if(!state)state={schema:"inheritance.worldapp-fallback-journal.v1",chainId,deploymentEOA:eoa,fundingManifestHash:fundingManifest.manifestHash,deploymentManifestHash:deploymentManifest.manifestHash,approvedMaxSpendWei:FUNDING_AMOUNT_WEI.toString(),fundingProof:proof,entries:[],returnAmountWei:null};
 let lock;
 if(broadcast){mkdirSync(privateDirectory,{recursive:true,mode:0o700});chmodSync(privateDirectory,0o700);lock=path.join(privateDirectory,"runner.lock");closeSync(openSync(lock,"wx",0o600));

 }
 const persist=()=>{if(broadcast)store.save(state);};
 const spent=()=>state.entries.reduce((sum,entry)=>sum+BigInt(entry.actualFeeWei||0),0n);
 const refundRequest=(step,amount=FUNDING_AMOUNT_WEI)=>step===2?{from:eoa,to:FUNDING_WETH,value:toBeHex(amount),data:refundABI.encodeFunctionData("deposit")}
  :{from:eoa,to:FUNDING_WETH,value:"0x0",data:refundABI.encodeFunctionData("transfer",[WALLET,amount])};
 try{
  if(broadcast){
  // Another process may have completed work during the funding RPC proof. Reload
  // and validate the journal only after exclusive ownership, before any signature.
  const latest=store.load();if(latest){same(latest.fundingManifestHash,fundingManifest.manifestHash,"Locked journal funding manifest");same(latest.deploymentManifestHash,deploymentManifest.manifestHash,"Locked journal deployment manifest");same(latest.deploymentEOA,eoa,"Locked journal EOA");assert.equal(latest.chainId,chainId);assert.equal(latest.approvedMaxSpendWei,FUNDING_AMOUNT_WEI.toString());state=latest;}
  }
  for(let step=0;step<4;step++){
   let entry=state.entries.find(item=>item.nonce===step);
   if(entry){
    validateSignedEntry(entry,state,deploymentManifest);
    const evidence=await readReceiptCost(provider,entry.hash,testOnly);
    if(evidence){
     const receipt=await provider.getTransactionReceipt(entry.hash);assert.equal(evidence.raw.status,"0x1","Pinned transaction reverted; no replacement or further spend");
     const block=await provider.getBlock(receipt.blockNumber);same(block.hash,receipt.blockHash,"Receipt was reorged");entry.actualFeeWei=evidence.cost.toString();entry.blockNumber=receipt.blockNumber;entry.blockHash=receipt.blockHash;entry.status="mined";persist();assert.ok(spent()<=FUNDING_AMOUNT_WEI,"Actual fees exceeded fixed budget");
     if(step<2)await (testOnly?.verifyGeneration||verifyYieldGeneration)({provider,...deploymentManifest.factories[step].config,factoryAddress:deploymentManifest.factories[step].predictedAddress,artifacts:astArtifacts,reviewedArtifacts:artifacts,blockTag:receipt.blockNumber});
     if(step===2){const w=new Contract(FUNDING_WETH,["function balanceOf(address) view returns(uint256)"],provider);assert.equal(await w.balanceOf(eoa,{blockTag:receipt.blockNumber}),BigInt(state.returnAmountWei));}
     if(step===3){const matching=receipt.logs.filter(log=>lower(log.address)===FUNDING_WETH).flatMap(log=>{try{const parsed=refundABI.parseLog(log);return parsed?.name==="Transfer"&&lower(parsed.args.from)===lower(eoa)&&lower(parsed.args.to)===WALLET&&parsed.args.value===BigInt(state.returnAmountWei)?[parsed]:[];}catch{return[];}});assert.equal(matching.length,1,"Remainder WETH transfer to Safe not proven");}
     if(!testOnly?.skipFinality){const finalized=await provider.getBlock("finalized");if(!finalized||finalized.number<receipt.blockNumber)return{status:"pending_finality",nonce:step,hash:entry.hash};}
     entry.status="confirmed";persist();continue;
    }
    assert.ok(entry.status!=="confirmed","Confirmed receipt disappeared; manual reorg review required");
   }
   // Every future step is priced again before a new signature/submission.
   const future=[];
   for(let i=step;i<4;i++){
    const existing=state.entries.find(item=>item.nonce===i);
    if(existing){const tx=validateSignedEntry(existing,state,deploymentManifest);const oracle=new Contract("0x420000000000000000000000000000000000000F",["function getL1FeeUpperBound(uint256) view returns(uint256)","function getOperatorFee(uint256) view returns(uint256)"],provider);const[l1,op]=await Promise.all([oracle.getL1FeeUpperBound((tx.unsignedSerialized.length-2)/2),oracle.getOperatorFee(tx.gasLimit)]);future.push({request:null,reserveWei:(tx.gasLimit*tx.gasPrice+l1+op).toString()});}
    else future.push(await quoteEnvelope(provider,i<2?deploymentManifest.factories[i].transaction:refundRequest(i),i,chainId,i>=2?120000n:null));
   }
   const reserve=future.reduce((sum,item)=>sum+BigInt(item.reserveWei),0n);
   assert.ok(spent()+reserve<=FUNDING_AMOUNT_WEI,"Fresh all-in gas/L1/operator/return reserve exceeds approved fixed budget");
   const currentBalance=await provider.getBalance(eoa);
   const wrapped=state.entries.some(item=>item.nonce===2&&item.status==="confirmed")?BigInt(state.returnAmountWei):0n;
   assert.equal(currentBalance+spent()+wrapped,FUNDING_AMOUNT_WEI,"Unexpected funds or balance drift; stop rather than spend extra ETH");
   if(!broadcast)return{status:"dry_run_ready",broadcast:false,nextNonce:step,deploymentEOA:eoa,spentWei:spent().toString(),freshRemainingReserveWei:reserve.toString(),totalBudgetWei:FUNDING_AMOUNT_WEI.toString()};
   const liveNonce=await provider.getTransactionCount(eoa,"latest");assert.equal(liveNonce,step,"Nonce consumed without the pinned receipt; no automatic replacement");
   const pendingNonce=await provider.getTransactionCount(eoa,"pending");
   if(!entry)assert.equal(pendingNonce,step,"Untracked pending nonce; refusing a new signature");
   else{assert.ok(pendingNonce===step||pendingNonce===step+1,"Unexpected pending nonce progression");if(pendingNonce===step+1)assert.ok(await provider.getTransaction(entry.hash),"Pending nonce is not the pinned transaction; stop");}
   if(!entry){
    const next=future[0];let request=next.request;
    if(step===2){state.returnAmountWei=(currentBalance-reserve).toString();assert.ok(BigInt(state.returnAmountWei)>0n,"No safely returnable remainder");request={...request,value:state.returnAmountWei};}
    if(step===3){const w=new Contract(FUNDING_WETH,["function balanceOf(address) view returns(uint256)"],provider);assert.equal(await w.balanceOf(eoa),BigInt(state.returnAmountWei),"Unexpected WETH balance");request={...request,data:refundABI.encodeFunctionData("transfer",[WALLET,BigInt(state.returnAmountWei)])};}
    let signer;
    if(testOnly?.loadSigner)signer=await testOnly.loadSigner();else{signer=await Wallet.fromEncryptedJson(readFileSync(path.join(privateDirectory,"deployment-keystore.json"),"utf8"),readFileSync(path.join(privateDirectory,"deployment-keystore.password"),"utf8"));}
    same(signer.address,eoa,"Keystore must match pinned EOA");
    const rawTransaction=await signer.signTransaction({...request,gasPrice:BigInt(request.gasPrice),gasLimit:BigInt(request.gasLimit),value:BigInt(request.value)});
    const signed=Transaction.from(rawTransaction);entry={nonce:step,hash:signed.hash,rawTransaction,gasLimit:signed.gasLimit.toString(),gasPrice:signed.gasPrice.toString(),reservedWei:next.reserveWei,status:"prepared"};state.entries.push(entry);
    validateSignedEntry(entry,state,deploymentManifest);persist(); // MUST precede the first network write.
   }
   try{await provider.broadcastTransaction(entry.rawTransaction);entry.status="submitted";persist();}
   catch{return{status:"submission_unknown_retry_same_bytes_only",nonce:step,hash:entry.hash};}
   // A subsequent invocation proves the receipt before signing any later nonce.
   return{status:"submitted",nonce:step,hash:entry.hash};
  }
  const w=new Contract(FUNDING_WETH,["function balanceOf(address) view returns(uint256)"],provider);assert.equal(await w.balanceOf(eoa),0n);
  assert.equal(await provider.getTransactionCount(eoa,"latest"),4,"Unexpected final nonce");assert.equal(await provider.getTransactionCount(eoa,"pending"),4,"Unexpected pending transaction");
  const dust=await provider.getBalance(eoa);assert.equal(spent()+BigInt(state.returnAmountWei)+dust,FUNDING_AMOUNT_WEI,"Final fixed funding reconciliation");
  return{status:"complete",spentWei:spent().toString(),returnedWETHWei:state.returnAmountWei,nativeDustWei:dust.toString(),hashes:state.entries.map(item=>item.hash)};
 }finally{if(lock)unlinkSync(lock);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=Object.fromEntries(process.argv.slice(2).reduce((out,value,i,all)=>{if(i%2===0){assert.ok(value.startsWith("--")&&all[i+1]);out.push([value.slice(2),all[i+1]]);}return out;},[]));
 const fundingManifest=JSON.parse(readFileSync(path.join(ROOT,"deployment/worldapp-funding-2026-11-03.json"),"utf8"));
 const deploymentManifest=JSON.parse(readFileSync(path.join(PRIVATE_FALLBACK_DIR,"deployment-manifest.json"),"utf8"));
 const provider=new JsonRpcProvider(args.rpc||"https://worldchain-mainnet.g.alchemy.com/public",480,{batchMaxCount:1,cacheTimeout:-1});
 try{console.log(JSON.stringify(await runWorldAppFallback({provider,fundingManifest,deploymentManifest,broadcast:args.broadcast==="true",approvedManifestHash:args["approved-manifest-hash"],approvedDeploymentManifestHash:args["approved-deployment-manifest-hash"],approvedMaxSpendWei:args["approved-max-spend-wei"],fundingTxHash:args["funding-tx-hash"],userOpHash:args["user-op-hash"],astArtifacts:args["ast-artifacts"]}),null,2));}
 catch(error){console.error(JSON.stringify({status:"blocked",message:error.code==="ERR_ASSERTION"?String(error.message).split("\n")[0].slice(0,180):String(error.shortMessage||"Guarded runner stopped; inspect the private local journal without exposing signed bytes").slice(0,180)}));process.exitCode=1;}finally{provider.destroy();}
}
