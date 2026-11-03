// Offline key initialization only when explicitly requested; all preparation RPCs
// are read-only. No signing, broadcast, funding or automatic fallback exists here.
// node scripts/prepare-worldapp-fallback.mjs --initialize-keystore true
import assert from "node:assert/strict";
import { randomBytes,createHash } from "node:crypto";
import { existsSync,readFileSync,writeFileSync,mkdirSync,chmodSync,openSync,closeSync,unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath,pathToFileURL } from "node:url";
import { Wallet,Contract,ContractFactory,Transaction,JsonRpcProvider,getAddress,getCreateAddress,keccak256,toUtf8Bytes,toQuantity,toBeHex } from "ethers";
import { WALLET } from "./lib/worldapp-deployment-manifest.mjs";
import { FUNDING_SCHEMA,FUNDING_AMOUNT_WEI,FUNDING_WETH,WETH_INTERFACE,validateWorldAppFundingManifest } from "./lib/worldapp-funding-manifest.mjs";
import { verifyYieldGeneration } from "./verify/yield-generation.mjs";
const repo=fileURLToPath(new URL("../",import.meta.url));
export const PRIVATE_FALLBACK_DIR=path.resolve(repo,"../evidence/worldapp-deployment-nov03/fallback");
const sha=bytes=>"0x"+createHash("sha256").update(bytes).digest("hex");
const digest=body=>({...body,manifestHash:keccak256(toUtf8Bytes(JSON.stringify(body)))});
export async function ensureFallbackAccount({ initialize=false, directory=PRIVATE_FALLBACK_DIR, pinnedManifestPath=path.join(repo,"deployment/worldapp-funding-2026-11-03.json") }={}) {
  const pinnedAddress=existsSync(pinnedManifestPath)?getAddress(JSON.parse(readFileSync(pinnedManifestPath,"utf8")).deploymentEOA):null;
  mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
  const keyFile=path.join(directory,"deployment-keystore.json"),passwordFile=path.join(directory,"deployment-keystore.password");
  if (existsSync(keyFile)||existsSync(passwordFile)) {
    assert.ok(existsSync(keyFile)&&existsSync(passwordFile),"Partial keystore state: stop; never silently replace an account");
    chmodSync(keyFile,0o600);chmodSync(passwordFile,0o600);
    const wallet=await Wallet.fromEncryptedJson(readFileSync(keyFile,"utf8"),readFileSync(passwordFile,"utf8"));
    if(pinnedAddress)assert.equal(wallet.address,pinnedAddress,"Keystore differs from pinned funding recipient; stop");
    return {address:wallet.address,signabilityVerifiedBy:"encrypted keystore decrypted and derived address matched; no signature created"};
  }
  assert.equal(pinnedAddress,null,"Pinned funding account keystore is missing; never generate a replacement");
  assert.equal(initialize,true,"No fallback account exists; explicit --initialize-keystore true required");
  const lock=path.join(directory,".creation.lock");const fd=openSync(lock,"wx",0o600);
  try {
    assert.ok(!existsSync(keyFile)&&!existsSync(passwordFile),"Account already exists");
    const wallet=Wallet.createRandom(),password=randomBytes(32).toString("hex");
    const encrypted=await wallet.encrypt(password);
    writeFileSync(passwordFile,password,{mode:0o600,flag:"wx"});
    writeFileSync(keyFile,encrypted,{mode:0o600,flag:"wx"});
    const verified=await Wallet.fromEncryptedJson(encrypted,password);
    assert.equal(verified.address,wallet.address);
    return {address:wallet.address,signabilityVerifiedBy:"encrypted keystore decrypted and derived address matched; no signature created"};
  } finally {closeSync(fd);unlinkSync(lock);}
}
export async function prepareWorldAppFallback({provider,deploymentEOA,artifacts=path.join(repo,"out"),astArtifacts="/tmp/yield-generation-ast-out"}) {
  deploymentEOA=getAddress(deploymentEOA);assert.equal((await provider.getNetwork()).chainId,480n);
  const block=await provider.getBlock("latest"),tag=toQuantity(block.number),at={blockTag:block.number};
  const [code,balance,nonce,gasPriceHex,walletCode,wethCode]=await Promise.all([provider.getCode(deploymentEOA,block.number),provider.getBalance(deploymentEOA,block.number),provider.getTransactionCount(deploymentEOA,block.number),provider.send("eth_gasPrice",[]),provider.getCode(WALLET,block.number),provider.getCode(FUNDING_WETH,block.number)]);
  assert.equal(code,"0x","Fallback account must remain an EOA");assert.equal(nonce,0,"Unexpected account nonce; do not auto-replace or auto-fallback");assert.equal(balance,0n,"Recipient already funded: do not create a second funding intent");assert.notEqual(walletCode,"0x");assert.notEqual(wethCode,"0x");
  const gasPrice=BigInt(gasPriceHex);
  const oracle=new Contract("0x420000000000000000000000000000000000000F",["function getL1Fee(bytes) view returns(uint256)","function getL1FeeUpperBound(uint256) view returns(uint256)","function getOperatorFee(uint256) view returns(uint256)","function isJovian() view returns(bool)","function isIsthmus() view returns(bool)"],provider);
  const attrs=new Contract("0x4200000000000000000000000000000000000015",["function operatorFeeScalar() view returns(uint32)","function operatorFeeConstant() view returns(uint64)"],provider);
  const [isJovian,isIsthmus,scalar,constant]=await Promise.all([oracle.isJovian(at),oracle.isIsthmus(at),attrs.operatorFeeScalar(at),attrs.operatorFeeConstant(at)]);
  const quote=async (transaction,nonce,conservativeGas=null)=>{
    const estimate=conservativeGas===null?BigInt(await provider.send("eth_estimateGas",[{...transaction,from:deploymentEOA},tag])):BigInt(conservativeGas);const limit=(estimate*120n+99n)/100n;
    const {from:ignoredFrom,...unsigned}=transaction;
    const tx=Transaction.from({...unsigned,chainId:480,nonce,type:0,gasPrice,gasLimit:limit,value:BigInt(transaction.value||0)});
    const [l1,l1Upper,operator,operatorReserve]=await Promise.all([oracle.getL1Fee(tx.unsignedSerialized,at),oracle.getL1FeeUpperBound((tx.unsignedSerialized.length-2)/2,at),oracle.getOperatorFee(estimate,at),oracle.getOperatorFee(limit,at)]);
    const calculated=isIsthmus?(isJovian?estimate*scalar*100n:estimate*scalar/1000000n)+constant:0n;assert.equal(operator,calculated);
    return {estimatedGas:estimate.toString(),gasLimit:limit.toString(),gasPriceWei:gasPrice.toString(),executionFeeWei:(estimate*gasPrice).toString(),l1FeeWei:l1.toString(),l1UpperBoundWei:l1Upper.toString(),operatorFeeWei:operator.toString(),estimatedTotalWei:(estimate*gasPrice+l1+operator).toString(),reserveWei:(limit*gasPrice+l1Upper+operatorReserve).toString()};
  };
  const artifactDigests={},sourceDigests={},factories=[];
  const load=name=>{const bytes=readFileSync(path.join(artifacts,`${name}.sol`,`${name}.json`));const a=JSON.parse(bytes);const m=typeof a.metadata==="string"?JSON.parse(a.metadata):a.metadata;assert.ok(m.compiler.version.startsWith("0.8.38+"));assert.equal(m.settings.viaIR,true);assert.equal(m.settings.optimizer.enabled,true);assert.equal(m.settings.optimizer.runs,200);assert.equal(m.settings.evmVersion,"cancun");artifactDigests[name]={sha256:sha(bytes),creationCodeHash:keccak256(a.bytecode.object),runtimeTemplateHash:keccak256(a.deployedBytecode.object)};for(const [source,entry]of Object.entries(m.sources)){const content=readFileSync(path.resolve(repo,source));assert.equal(keccak256(content),entry.keccak256,`Source mismatch: ${source}`);sourceDigests[source]={sha256:sha(content),keccak256:entry.keccak256};}return a;};
  const wld="0x2cFc85d8E48F8EAB294be644d9E25C3030863003";
  for (const [index,recipe] of [
    {kind:"wld",child:"InheritanceVaultMorpho",asset:wld,strategy:"0x348831b46876d3dF2Db98BdEc5E3B4083329Ab9f"},
    {kind:"usdc",child:"InheritanceVaultUSDC",asset:"0x79a02482a880bce3f13e09da970dc34db4cd24d1",strategy:"0xb1e80387ebe53ff75a89736097d34dc8d9e9045b",rewardToken:wld},
  ].entries()) {
    const factoryName=recipe.child+"Factory",a=load(factoryName);load(recipe.child);load(recipe.child+"Deployer");
    const config={kind:recipe.kind,asset:recipe.asset,strategy:recipe.strategy,feeRecipient:WALLET,performanceFeeBps:1000};if(recipe.rewardToken)config.rewardToken=recipe.rewardToken;
    const args=recipe.kind==="wld"?[config.asset,config.strategy,WALLET,1000]:[config.asset,config.strategy,config.rewardToken,WALLET,1000];
    const deployment=await new ContractFactory(a.abi,a.bytecode.object).getDeployTransaction(...args);
    const predictedAddress=getCreateAddress({from:deploymentEOA,nonce:index});
    const existing=await provider.getCode(predictedAddress,block.number);
    if(existing!=="0x")await verifyYieldGeneration({provider,...config,factoryAddress:predictedAddress,artifacts:astArtifacts,reviewedArtifacts:artifacts,blockTag:block.number});
    assert.equal(existing,"0x","Predicted normal CREATE address unexpectedly occupied; stop");
    const transaction={from:deploymentEOA,to:null,value:"0x0",data:deployment.data};
    factories.push({kind:recipe.kind,factoryName,nonce:index,predictedAddress,initCodeHash:keccak256(deployment.data),config,transaction,quote:await quote(transaction,index)});
  }
  // Reserve two ordinary EOA transactions for returning the remainder as WETH,
  // visible in World App. Each uses a conservative 100k gas estimate +20% margin;
  // value/amount q in unsigned fee inputs bounds serialized size of any remainder.
  const refundABI=new (await import("ethers")).Interface(["function deposit() payable","function transfer(address,uint256) returns(bool)"]);
  const remainderReturn={asset:"WETH",to:WALLET,steps:[
    {nonce:2,functionName:"deposit",quote:await quote({to:FUNDING_WETH,value:toBeHex(FUNDING_AMOUNT_WEI),data:refundABI.encodeFunctionData("deposit")},2,100000)},
    {nonce:3,functionName:"transfer",quote:await quote({to:FUNDING_WETH,value:"0x0",data:refundABI.encodeFunctionData("transfer",[WALLET,FUNDING_AMOUNT_WEI])},3,100000)},
  ],note:"Future return amount excludes all remaining transaction fee reserves; no signing or return is performed here"};
  const returnReserve=remainderReturn.steps.reduce((n,x)=>n+BigInt(x.quote.reserveWei),0n);
  const returnEstimated=remainderReturn.steps.reduce((n,x)=>n+BigInt(x.quote.estimatedTotalWei),0n);
  const reserve=factories.reduce((n,x)=>n+BigInt(x.quote.reserveWei),returnReserve);
  const estimated=factories.reduce((n,x)=>n+BigInt(x.quote.estimatedTotalWei),returnEstimated);
  const summary={gasPriceWei:gasPrice.toString(),estimatedIncludingReturnWei:estimated.toString(),reserveIncludingReturnWei:reserve.toString(),returnReserveWei:returnReserve.toString(),fundingAmountWei:FUNDING_AMOUNT_WEI.toString(),headroomWei:(FUNDING_AMOUNT_WEI-reserve).toString(),coversFunding:reserve<=FUNDING_AMOUNT_WEI,operatorFee:{isIsthmus,isJovian,scalar:scalar.toString(),constantWei:constant.toString(),formula:isJovian?"gas * scalar * 100 + constant":"floor(gas * scalar / 1000000) + constant"},caveat:"Read-only snapshot; gas and L1/operator fees may change. 20% execution gas margin plus L1 upper bound; WETH deposit+transfer remainder return each reserves 120000 gas. No transaction signed or broadcast."};
  const observation={number:block.number,hash:block.hash,timestamp:block.timestamp};
  const deploymentManifest=digest({schema:"inheritance.worldapp-eoa-deployment.v1",chainId:480,wallet:WALLET,feeRecipient:WALLET,deploymentEOA,initialNonce:0,observation,artifactDigests,sourceDigests,factories,remainderReturn,quote:summary});
  const fundingManifest=digest({schema:FUNDING_SCHEMA,chainId:480,wallet:WALLET,feeRecipient:WALLET,deploymentEOA,amountWei:FUNDING_AMOUNT_WEI.toString(),weth:FUNDING_WETH,
    transactions:[{to:FUNDING_WETH,data:WETH_INTERFACE.encodeFunctionData("withdraw",[FUNDING_AMOUNT_WEI]),value:"0x0"},{to:deploymentEOA,data:"0x",value:toBeHex(FUNDING_AMOUNT_WEI)}],
    recipientExpected:{nonce:0,code:"0x",balanceWei:"0"},observation,codeHashes:{wallet:keccak256(walletCode),weth:keccak256(wethCode)},artifactDigests,sourceDigests,
    normalCreateTargets:factories.map(({kind,nonce,predictedAddress,initCodeHash})=>({kind,nonce,predictedAddress,initCodeHash})),deploymentManifestHash:deploymentManifest.manifestHash,quote:summary});
  assert.equal((await provider.getBlock(block.number)).hash,block.hash,"Observation reorged");
  return {deploymentManifest,fundingManifest};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=Object.fromEntries(process.argv.slice(2).reduce((out,value,i,all)=>{if(i%2===0){assert.ok(value.startsWith("--")&&all[i+1]);out.push([value.slice(2),all[i+1]]);}return out;},[]));
  const account=await ensureFallbackAccount({initialize:args["initialize-keystore"]==="true"});
  const provider=new JsonRpcProvider(args.rpc||"https://worldchain-mainnet.g.alchemy.com/public",480,{batchMaxCount:1,cacheTimeout:-1});
  try{
    const result=await prepareWorldAppFallback({provider,deploymentEOA:account.address,astArtifacts:args["ast-artifacts"]});
    for(const [name,manifest]of Object.entries(result))writeFileSync(path.join(PRIVATE_FALLBACK_DIR,name==="fundingManifest"?"funding-manifest.json":"deployment-manifest.json"),JSON.stringify(manifest,null,2)+"\n",{mode:0o600});
    validateWorldAppFundingManifest(result.fundingManifest);
    const publicPath=path.join(repo,"deployment/worldapp-funding-2026-11-03.json");mkdirSync(path.dirname(publicPath),{recursive:true});writeFileSync(publicPath,JSON.stringify(result.fundingManifest,null,2)+"\n");
    console.log(JSON.stringify({deploymentEOA:account.address,signabilityVerifiedBy:account.signabilityVerifiedBy,publicManifest:publicPath,manifestHash:result.fundingManifest.manifestHash,normalCreateTargets:result.fundingManifest.normalCreateTargets,quote:result.fundingManifest.quote},null,2));
  }finally{provider.destroy();}
}
