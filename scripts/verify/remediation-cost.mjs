// Public RPC only. No wallet/key/signing/broadcast API. Oracle takes unsigned transaction bytes.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const repo=fileURLToPath(new URL('../../',import.meta.url));
const output=resolve(process.env.COST_EVIDENCE_DIR || '/tmp/inheritance-remediation-cost');
mkdirSync(output,{recursive:true});
const require=createRequire(repo+'/package.json');
const {JsonRpcProvider,ContractFactory,Contract,Transaction,formatEther,keccak256}=require('ethers');
const rpc='https://worldchain-mainnet.g.alchemy.com/public';
const p=new JsonRpcProvider(rpc,480,{staticNetwork:true,batchMaxCount:1,cacheTimeout:-1});
const owner='0x93bC44B8296977Feb479F95855D9b9E051C17dA2';
const wld='0x2cFc85d8E48F8EAB294be644d9E25C3030863003';
const usdc='0x79a02482a880bce3f13e09da970dc34db4cd24d1';
const artifact=n=>JSON.parse(readFileSync(`${repo}/out/${n}.sol/${n}.json`));
const [chain,block,gasPrice,balance,nonce]=await Promise.all([p.send('eth_chainId',[]),p.getBlock('latest'),p.send('eth_gasPrice',[]),p.getBalance(owner),p.getTransactionCount(owner,'pending')]);
if(BigInt(chain)!==480n)throw Error('Wrong chain');
const oracle=new Contract('0x420000000000000000000000000000000000000F',['function getL1Fee(bytes) view returns(uint256)','function getL1FeeUpperBound(uint256) view returns(uint256)','function getOperatorFee(uint256) view returns(uint256)','function isIsthmus() view returns(bool)','function isJovian() view returns(bool)'],p);
const attrs=new Contract('0x4200000000000000000000000000000000000015',['function operatorFeeScalar() view returns(uint32)','function operatorFeeConstant() view returns(uint64)'],p);
const isIsthmus=await oracle.isIsthmus();
let isJovian;try{isJovian=await oracle.isJovian();}catch{isJovian=false;}
const [operatorScalar,operatorConstant]=await Promise.all([attrs.operatorFeeScalar(),attrs.operatorFeeConstant()]);
const rows=[];
for(const [name,args] of [
 ['InheritanceVaultWLDFactoryOnePerOwner',[wld]],
 ['InheritanceVaultMorphoFactory',[wld,'0x348831b46876d3dF2Db98BdEc5E3B4083329Ab9f',owner,1000]],
 ['InheritanceVaultUSDCFactory',[usdc,'0xb1e80387ebe53ff75a89736097d34dc8d9e9045b',wld,owner,1000]],
]){
 const a=artifact(name);
 const metadata=typeof a.metadata==='string'?JSON.parse(a.metadata):a.metadata;
 if(!metadata.compiler.version.startsWith('0.8.38+') || metadata.settings.viaIR!==true || metadata.settings.optimizer.runs!==200 || !metadata.settings.optimizer.enabled || metadata.settings.evmVersion!=='cancun') throw Error('Build reviewed optimized artifacts with forge build first.');
 const dep=await new ContractFactory(a.abi,a.bytecode.object).getDeployTransaction(...args);
 const base={name,initcodeBytes:(dep.data.length-2)/2,runtimeBytes:(a.deployedBytecode.object.length-2)/2,initcodeHash:keccak256(dep.data)};
 try{
  const gas=await p.estimateGas({...dep,from:owner});
  const gasLimit=gas*120n/100n;
  const tx=Transaction.from({type:0,chainId:480,nonce,gasLimit,gasPrice:BigInt(gasPrice),data:dep.data,value:0});
  const [l1,l1Upper,opFee,opReserve]=await Promise.all([oracle.getL1Fee(tx.unsignedSerialized),oracle.getL1FeeUpperBound((tx.unsignedSerialized.length-2)/2),oracle.getOperatorFee(gas),oracle.getOperatorFee(gasLimit)]);
  const calculated=isIsthmus ? (isJovian ? gas*operatorScalar*100n : gas*operatorScalar/1000000n)+operatorConstant : 0n;
  if(calculated!==opFee)throw Error('Operator fee formula mismatch');
  rows.push({...base,estimatedGas:gas.toString(),gasLimit20PercentMargin:gasLimit.toString(),executionFeeETH:formatEther(gas*BigInt(gasPrice)),l1FeeETH:formatEther(l1),l1FeeUpperBoundETH:formatEther(l1Upper),operatorFeeETH:formatEther(opFee),estimatedTotalETH:formatEther(gas*BigInt(gasPrice)+l1+opFee),reserveWith20PercentGasMarginAndL1UpperBoundETH:formatEther(gasLimit*BigInt(gasPrice)+l1Upper+opReserve)});
 }catch(e){rows.push({...base,error:e.shortMessage||e.message});}
}
const result={observedAt:new Date().toISOString(),rpc,chainId:Number(BigInt(chain)),blockNumber:block.number,blockGasLimit:block.gasLimit.toString(),gasPriceWei:BigInt(gasPrice).toString(),operatorBalanceETH:formatEther(balance),operatorPendingNonce:nonce,operatorFee:{isIsthmus,isJovian,scalar:operatorScalar.toString(),constantWei:operatorConstant.toString(),formula:isJovian?'gasUsed * scalar * 100 + constantWei':'floor(gasUsed * scalar / 1000000) + constantWei',source:'https://specs.optimism.io/protocol/'+(isJovian?'jovian':'isthmus')+'/exec-engine.html'},feeCaveat:'L1 oracle takes unsigned RLP transaction; gas-price and oracle snapshot can change. Gas estimate includes internal deployer/chunk creates. No transaction signed or broadcast. Only Morpho and USDC redeployment required; WLD basic shown as optional.',requiredDeploymentNames:['InheritanceVaultMorphoFactory','InheritanceVaultUSDCFactory'],rows};
const required=rows.filter(x=>result.requiredDeploymentNames.includes(x.name));
const sumField=field=>required.reduce((acc,x)=>acc+require('ethers').parseEther(x[field]),0n);
if(required.every(x=>!x.error)) {
 const total=sumField('estimatedTotalETH'),reserve=sumField('reserveWith20PercentGasMarginAndL1UpperBoundETH');
 result.requiredTotals={estimatedTotalETH:formatEther(total),reserveWith20PercentGasMarginAndL1UpperBoundETH:formatEther(reserve),shortfallAtEstimateETH:formatEther(total>balance?total-balance:0n),shortfallAtReserveETH:formatEther(reserve>balance?reserve-balance:0n)};
}
result.deploymentStructure='Two required external factory-creation transactions. Each constructor creates one immutable deployer, which creates two inert STOP-prefixed creation-code data chunks: four created contracts per transaction, eight in total. No user vault or funds migration occurs.';
result.artifactCompilerSettings={};
for(const name of ['InheritanceVaultMorpho','InheritanceVaultUSDC']) {
 const a=artifact(name);const m=typeof a.metadata==='string'?JSON.parse(a.metadata):a.metadata;
 result.artifactCompilerSettings[name]={compiler:m.compiler,settings:Object.fromEntries(Object.entries(m.settings).filter(([k])=>['optimizer','viaIR','evmVersion'].includes(k))),runtimeBytes:(a.deployedBytecode.object.length-2)/2};
}
writeFileSync(resolve(output,'deployment-cost-readonly.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(result,null,2));
p.destroy();
if(required.some(x=>x.error)) process.exitCode=1;
