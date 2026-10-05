// Local-only operator setup. Read-only by default; keys/raw signatures stay in ignored 0600 journals.
import { chmodSync, closeSync, existsSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, ContractFactory, Interface, JsonRpcProvider, Transaction, Wallet, formatEther, getCreateAddress, keccak256, parseEther } from "ethers";
import { IDENTITIES, FUNDING_ABI } from "../gas-refill/src/funding.mjs";
import { isExecutionRevert } from "../gas-refill/src/rpc-errors.mjs";

const args = new Set(process.argv.slice(2));
const ACTIVE = args.has("--activate") && args.has("--broadcast");
for(const arg of args) if(!["--check","--prepare","--activate","--broadcast"].includes(arg))throw new Error("Unknown option");
if(args.has("--activate") !== args.has("--broadcast"))throw new Error("Use both --activate and --broadcast");
const STATE=resolve(".env.gas-funding-activation.json"), LOCK=STATE+".lock", KEY=resolve(".env.gas-refill");
const BOOTSTRAP=parseEther("0.00001"), MAX_SETUP_COST=parseEther("0.000025"), MAX_PRICE=10_000_000n;
const GAS_MAX={deploy:3_500_000n,approve:100_000n,revoke:100_000n,fund:25_200n};
const TOKENS=[IDENTITIES.usdc,IDENTITIES.wld,IDENTITIES.usdcStrategy,IDENTITIES.wldStrategy];
const TOKEN=new Interface(["function allowance(address,address) view returns(uint256)","function approve(address,uint256) returns(bool)","event Approval(address indexed owner,address indexed spender,uint256 value)"]);
const eq=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
function privateRead(path){if((statSync(path).mode&0o077)!==0)throw new Error("Private operator files require0600");return readFileSync(path,"utf8");}
function keyIn(text,name){
 const line=text.split("\n").find(line=>line.trim().startsWith(name+"="));
 const value=line?.trim().slice(name.length+1).trim().replace(/^['"]|['"]$/g,"");
 if(!/^(0x)?[0-9a-fA-F]{64}$/.test(value||""))throw new Error("Local operator key missing or invalid");
 return value.startsWith("0x")?value:"0x"+value;
}
function persist(state){const tmp=STATE+".tmp";writeFileSync(tmp,JSON.stringify(state,null,2)+"\n",{mode:0o600});chmodSync(tmp,0o600);renameSync(tmp,STATE);}
async function extra(oracle,tx,blockTag="latest"){
 const l1=BigInt(await oracle.getL1Fee(tx.unsignedSerialized,{blockTag}));let op=0n;
 try{op=BigInt(await oracle.getOperatorFee(tx.gasLimit,{blockTag}));}catch(error){if(!isExecutionRevert(error))throw error;}
 return l1+op;
}
if(ACTIVE&&process.env.INHERITANCE_FUNDING_SETUP_LOCK!==LOCK){
 closeSync(openSync(LOCK,"a",0o600));chmodSync(LOCK,0o600);
 const run=spawnSync("flock",["--nonblock","--conflict-exit-code","73",LOCK,process.execPath,...process.execArgv,fileURLToPath(import.meta.url),...process.argv.slice(2)],{env:{...process.env,INHERITANCE_FUNDING_SETUP_LOCK:LOCK},stdio:"inherit"});
 if(run.error)throw new Error("flock unavailable; no setup transaction sent");process.exit(run.status??1);
}
let provider;
try {
 if(args.has("--prepare")){
  if(ACTIVE||args.has("--check"))throw new Error("Prepare is a separate step");
  if(!existsSync(KEY)){const w=Wallet.createRandom();writeFileSync(KEY,"GAS_REFILL_PRIVATE_KEY="+w.privateKey+"\nGAS_REFILL_BOT_ADDRESS="+w.address+"\n",{mode:0o600,flag:"wx"});}
  const bot=new Wallet(keyIn(privateRead(KEY),"GAS_REFILL_PRIVATE_KEY"));console.log(JSON.stringify({bot:bot.address,localKeyPrepared:true,matchesConfiguredBot:eq(bot.address,IDENTITIES.bot)}));
 }else{
  const owner=new Wallet(keyIn(privateRead(resolve(".env.deploy")),"PRIVATE_KEY"));
  const bot=new Wallet(keyIn(privateRead(KEY),"GAS_REFILL_PRIVATE_KEY"));
  if(!eq(owner.address,IDENTITIES.treasury)||!eq(bot.address,IDENTITIES.bot))throw new Error("Local key identity differs from pinned operator");
  provider=new JsonRpcProvider(IDENTITIES.rpcUrl,480,{staticNetwork:true,cacheTimeout:-1,batchMaxCount:1});provider.pollingInterval=1000;
  if(BigInt(await provider.send("eth_chainId",[]))!==480n)throw new Error("Wrong chain");
  const artifact=JSON.parse(readFileSync("out/OperatorGasFunding.sol/OperatorGasFunding.json","utf8"));
  const deploy=await new ContractFactory(artifact.abi,artifact.bytecode.object).getDeployTransaction(IDENTITIES.treasury,IDENTITIES.bot,IDENTITIES.keeper,10_000_000n);
  const oracle=new Contract("0x420000000000000000000000000000000000000F",["function getL1Fee(bytes) view returns(uint256)","function getOperatorFee(uint256) view returns(uint256)"],provider);
  let state=existsSync(STATE)?JSON.parse(privateRead(STATE)):null;
  if(state&&state.version!==2)throw new Error("Wrong private setup journal version");
  const [latest,pending,priceRaw,balance]=await Promise.all([provider.getTransactionCount(owner.address,"latest"),provider.getTransactionCount(owner.address,"pending"),provider.send("eth_gasPrice",[]),provider.getBalance(owner.address)]);
  const price=BigInt(priceRaw);if(price<=0n||price>MAX_PRICE)throw new Error("Setup gas price is outside limit");
  if(!state){
   if(latest!==pending)throw new Error("Operator has pending transaction; wait before preparing setup");
   state={version:2,address:getCreateAddress({from:owner.address,nonce:latest}),deployNonce:latest,steps:[],spent:"0",valueSent:"0"};
  }
  const controller=state.address;
  const expectedCodeHash=keccak256(await provider.call({data:deploy.data,from:owner.address,gasLimit:GAS_MAX.deploy,gasPrice:0n}));
  if(!eq(getCreateAddress({from:owner.address,nonce:state.deployNonce}),controller))throw new Error("Invalid deployment identity in private journal");
  const requests=[];
  if((await provider.getCode(controller))==="0x") requests.push({kind:"deploy",to:null,data:deploy.data,value:0n});
  else{
   const guard=new Contract(controller,FUNDING_ABI,provider);
   if(!eq(await guard.treasury(),owner.address)||!eq(await guard.bot(),bot.address)||!eq(await guard.keeper(),IDENTITIES.keeper))throw new Error("Guard identities mismatch");
   if(keccak256(await provider.getCode(controller))!==expectedCodeHash)throw new Error("Guard runtime differs from compiled immutable deployment");
  }
  for(const address of TOKENS){
   const t=new Contract(address,TOKEN,provider);
   if(await t.allowance(owner.address,bot.address)>0n)requests.push({kind:"revoke",to:address,data:TOKEN.encodeFunctionData("approve",[bot.address,0n]),value:0n});
   if(await t.allowance(owner.address,controller)!==2n**256n-1n)requests.push({kind:"approve",to:address,data:TOKEN.encodeFunctionData("approve",[controller,2n**256n-1n]),value:0n});
  }
  const botBalance=await provider.getBalance(bot.address);
  if(botBalance<BOOTSTRAP&&BigInt(state.valueSent)===0n)requests.push({kind:"fund",to:bot.address,data:"0x",value:BOOTSTRAP-botBalance});
  let reserve=0n;
  for(const request of requests){
   const gasLimit=(await provider.estimateGas({...request,from:owner.address})*120n+99n)/100n;
   if(gasLimit>GAS_MAX[request.kind])throw new Error("Setup gas estimate exceeds bounded transaction limit");
   const estimate=Transaction.from({to:request.to,data:request.data,value:request.value,chainId:480,type:0,nonce:latest,gasPrice:price,gasLimit});
   reserve+=gasLimit*price+(await extra(oracle,estimate))*2n+request.value;
  }
  console.log(JSON.stringify({readOnly:!ACTIVE,controller,treasury:owner.address,bot:bot.address,keeper:IDENTITIES.keeper,dailyBudgetUSDC:"10",lifetimeLimit:false,allowanceRecipient:"immutable gas-purpose contract",treasuryETH:formatEther(balance),remainingSetupReserveETH:formatEther(reserve),fitsTreasury:balance>=reserve,steps:requests.map(s=>s.kind)}));
  if(BigInt(state.spent)+BigInt(state.valueSent)+reserve>MAX_SETUP_COST)throw new Error("Combined setup exceeds fixed native cost limit");
  if(!ACTIVE)process.exit(0);
  if(balance<reserve)throw new Error("Treasury ETH cannot fund prepared setup; no new transaction sent");
  if(!existsSync(STATE))persist(state);
  // Stage this bounded nonce sequence on canonical receipts, then require L1
  // finality for the whole setup before activation. Waiting after each approval
  // would multiply the same chain-finality delay six times.
  const verifyIncludedPrefix=async()=>{
   for(const [index,step] of state.steps.entries()){
    const signed=Transaction.from(step.raw);
    if(!signed.isSigned()||signed.hash!==step.hash||!eq(signed.from,owner.address)||signed.chainId!==480n||signed.nonce!==state.deployNonce+index)
     throw new Error("Setup signature sequence changed; retain exact journal");
    if(!step.included&&!step.confirmed)continue;
    const receipt=await provider.getTransactionReceipt(step.hash);
    if(!receipt||receipt.status!==1||receipt.blockNumber!==step.blockNumber||
     (step.blockHash&&receipt.blockHash!==step.blockHash)||
     (await provider.getBlock(receipt.blockNumber))?.hash!==receipt.blockHash)
     throw new Error("Previously included setup changed; inspect retained exact signatures before continuing");
   }
  };
  await verifyIncludedPrefix();
  // Resume staged signatures before interpreting updated balances/allowances.
  let cursor=0;
  for(let iteration=0;iteration<requests.length+state.steps.length+2;iteration++){
   let step=state.steps.find(s=>!s.included&&!s.confirmed);
   if(!step){
    const request=requests[cursor++];if(!request)break;
    if(request.kind==="deploy"&&(await provider.getCode(controller))!=="0x")continue;
    if(request.kind==="approve"||request.kind==="revoke"){
     const allowance=await new Contract(request.to,TOKEN,provider).allowance(owner.address,request.kind==="approve"?controller:bot.address);
     if(allowance===(request.kind==="approve"?2n**256n-1n:0n))continue;
    }
    if(request.kind==="fund"&&BigInt(state.valueSent)>0n)continue;
    const next=state.deployNonce+state.steps.length;
    const gasPrice=BigInt(await provider.send("eth_gasPrice",[]));if(gasPrice<=0n||gasPrice>MAX_PRICE)throw new Error("Setup gas price limit");
    const gasLimit=(await provider.estimateGas({...request,from:owner.address})*120n+99n)/100n;if(gasLimit>GAS_MAX[request.kind])throw new Error("Gas limit");
    await verifyIncludedPrefix();
    const [latestNonce,pendingNonce]=await Promise.all([provider.getTransactionCount(owner.address,"latest"),provider.getTransactionCount(owner.address,"pending")]);
    if(latestNonce!==next||pendingNonce!==next)throw new Error("Setup nonce sequence changed; no new signature was created");
    const raw=await owner.signTransaction({to:request.to,data:request.data,value:request.value,chainId:480,type:0,nonce:next,gasPrice,gasLimit});
    step={kind:request.kind,to:request.to,value:request.value.toString(),raw,hash:keccak256(raw),confirmed:false};state.steps.push(step);persist(state);
   }
   const signed=Transaction.from(step.raw);
   const isToken=TOKENS.some(address=>eq(address,signed.to));
   const expected=step.kind==="deploy"?deploy.data:step.kind==="approve"?TOKEN.encodeFunctionData("approve",[controller,2n**256n-1n]):step.kind==="revoke"?TOKEN.encodeFunctionData("approve",[bot.address,0n]):"0x";
   if(!signed.isSigned()||!eq(signed.from,owner.address)||signed.chainId!==480n||signed.type!==0||signed.hash!==step.hash||signed.data!==expected||signed.gasPrice<=0n||signed.gasPrice>MAX_PRICE||signed.gasLimit>GAS_MAX[step.kind]||signed.gasLimit<=0n||signed.value!==BigInt(step.value)||
    (step.kind==="deploy"&&(signed.to!==null||signed.nonce!==state.deployNonce||signed.value!==0n))||
    (["approve","revoke"].includes(step.kind)&&(!isToken||signed.value!==0n))||
    (step.kind==="fund"&&(!eq(signed.to,bot.address)||signed.value<=0n||signed.value>BOOTSTRAP))||!Object.hasOwn(GAS_MAX,step.kind))throw new Error("Private setup journal transaction invalid");
   const feeReserve=signed.gasLimit*signed.gasPrice+(await extra(oracle,signed))*2n;
   if(BigInt(state.spent)+BigInt(state.valueSent)+feeReserve+signed.value>MAX_SETUP_COST)throw new Error("Recovery exceeds setup cost limit");
   let receipt=await provider.getTransactionReceipt(step.hash);
   if(!receipt){
    await verifyIncludedPrefix();
    const latestNonce=await provider.getTransactionCount(owner.address,"latest");
    if(latestNonce!==signed.nonce)throw new Error("Setup nonce changed before exact broadcast; retain journal");
    if(await provider.getBalance(owner.address,"pending")<feeReserve+signed.value)throw new Error("Insufficient ETH for exact signed recovery");
    try{await provider.broadcastTransaction(step.raw);}catch{/* same hash only */}
    receipt=await provider.waitForTransaction(step.hash,1,50000);
   }
   if(!receipt)throw new Error("Setup awaits receipt; rerun same command and journal");
   if(receipt.status!==1)throw new Error("Setup reverted; keep private journal for inspection");
   const canonical=await provider.getBlock(receipt.blockNumber);
   if(canonical?.hash!==receipt.blockHash)throw new Error("Canonical setup block changed; retain exact journal");
   const rawReceipt=await provider.send("eth_getTransactionReceipt",[step.hash]);
   let cost=receipt.gasUsed*receipt.gasPrice;
   cost+=rawReceipt.l1Fee!==undefined?BigInt(rawReceipt.l1Fee):BigInt(await oracle.getL1Fee(signed.unsignedSerialized,{blockTag:receipt.blockNumber}));
   if(rawReceipt.operatorFee!=null)cost+=BigInt(rawReceipt.operatorFee);
   else if(BigInt(rawReceipt.operatorFeeScalar||0)!==0n||BigInt(rawReceipt.operatorFeeConstant||0)!==0n)
    cost+=BigInt(await oracle.getOperatorFee(receipt.gasUsed,{blockTag:receipt.blockNumber}));
   if(step.kind==="deploy"){
    if(!eq(receipt.contractAddress,controller))throw new Error("Unexpected deployment address");
    state.codeHash=keccak256(await provider.getCode(controller));
    if(state.codeHash!==expectedCodeHash)throw new Error("Deployed runtime differs from immutable simulation");
   }else if(["approve","revoke"].includes(step.kind)){
    const desired=step.kind==="approve"?2n**256n-1n:0n;const spender=step.kind==="approve"?controller:bot.address;
    const proof=receipt.logs.filter(log=>eq(log.address,step.to)).some(log=>{try{const event=TOKEN.parseLog(log);return event?.name==="Approval"&&eq(event.args.owner,owner.address)&&eq(event.args.spender,spender)&&event.args.value===desired;}catch{return false;}});
    if(!proof)throw new Error("Setup approval receipt mismatch");
   }
   if((await provider.getBlock(receipt.blockNumber))?.hash!==receipt.blockHash)throw new Error("Canonical setup block changed");
   state.spent=(BigInt(state.spent)+cost).toString();state.valueSent=(BigInt(state.valueSent)+signed.value).toString();step.included=true;step.blockNumber=receipt.blockNumber;step.blockHash=receipt.blockHash;persist(state);

  }
  const finalized=await provider.getBlock("finalized");
  for(const step of state.steps){
   const receipt=await provider.getTransactionReceipt(step.hash);
   if(!receipt||receipt.status!==1||(await provider.getBlock(receipt.blockNumber))?.hash!==receipt.blockHash||
    receipt.blockNumber!==step.blockNumber||(step.blockHash&&receipt.blockHash!==step.blockHash))
    throw new Error("Setup receipt changed before activation; retain exact journal");
   if(!finalized||finalized.number<receipt.blockNumber)throw new Error("Setup awaits canonical finality; resume same journal later");
  }
  for(const step of state.steps)step.confirmed=true;
  persist(state);
  const guard=new Contract(controller,FUNDING_ABI,provider);
  if(!eq(await guard.treasury(),owner.address)||!eq(await guard.bot(),bot.address)||!eq(await guard.keeper(),IDENTITIES.keeper))throw new Error("Final guard identity mismatch");
  for(const token of TOKENS){const t=new Contract(token,TOKEN,provider);if(await t.allowance(owner.address,bot.address)!==0n||await t.allowance(owner.address,controller)!==2n**256n-1n)throw new Error("Final allowance mismatch");}
  console.log(JSON.stringify({activated:true,controller,codeHash:state.codeHash,setupFeeETH:formatEther(BigInt(state.spent)),bootstrapETH:formatEther(BigInt(state.valueSent)),botHasTreasuryAllowance:false}));
 }
}catch(error){console.error(error.message.includes("transaction=")?"Operator setup RPC failed; no new signature will replace journaled transactions":error.message);process.exitCode=1;}finally{provider?.destroy();}
