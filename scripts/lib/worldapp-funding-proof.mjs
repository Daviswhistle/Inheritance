// Verify funding provenance from canonical receipt + exact UserOperation payload.
// Never equate the bundler's transaction.from with the user's Safe wallet.
import assert from "node:assert/strict";
import { Contract,Interface,keccak256 } from "ethers";
import { WALLET } from "./worldapp-deployment-manifest.mjs";
import { FUNDING_WETH,FUNDING_AMOUNT_WEI } from "./worldapp-funding-manifest.mjs";
export const ENTRYPOINT="0x0000000071727de22e5e9d8baf0edac6f37da032";
export const MULTISEND="0x9641d764fc13c8b624c04430c7356c1c7c8102e2";
export const PACKED_USER_OPERATION="(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)";
export const ENTRYPOINT_INTERFACE=new Interface([
 `function handleOps(${PACKED_USER_OPERATION}[] ops,address beneficiary)`,
 `function handleAggregatedOps((${PACKED_USER_OPERATION}[] userOps,address aggregator,bytes signature)[] groups,address beneficiary)`,
 `function getUserOpHash(${PACKED_USER_OPERATION} userOp) view returns(bytes32)`,
 "event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)",
]);
const moduleABI=new Interface(["function executeUserOp(address to,uint256 value,bytes data,uint8 operation)","function executeUserOpWithErrorString(address to,uint256 value,bytes data,uint8 operation)"]);
const multiABI=new Interface(["function multiSend(bytes transactions)"]);
const wethABI=new Interface(["event Withdrawal(address indexed src,uint256 wad)"]);
const eq=(a,b,label)=>assert.equal(String(a).toLowerCase(),String(b).toLowerCase(),label);
export function verifyExactFundingCallData(callData,manifest) {
 const call=moduleABI.parseTransaction({data:callData});assert.ok(call,"Unknown Safe4337 selector");
 const [to,value,data,operation]=call.args;eq(to,MULTISEND,"Safe4337 target");assert.equal(value,0n);assert.equal(operation,1n);
 eq(moduleABI.encodeFunctionData(call.name,call.args),callData,"Noncanonical Safe4337 calldata");
 const decoded=multiABI.decodeFunctionData("multiSend",data);eq(multiABI.encodeFunctionData("multiSend",decoded),data,"Noncanonical multisend calldata");
 const packed=decoded[0].slice(2);let offset=0;
 for(const expected of manifest.transactions){
  assert.ok(packed.length-offset>=170,"Truncated multisend header");
  const op=BigInt("0x"+packed.slice(offset,offset+2));offset+=2;assert.equal(op,0n,"Only CALL funding operations");
  const address="0x"+packed.slice(offset,offset+40);offset+=40;
  const amount=BigInt("0x"+packed.slice(offset,offset+64));offset+=64;
  const length=BigInt("0x"+packed.slice(offset,offset+64));offset+=64;
  assert.ok(length<=BigInt((packed.length-offset)/2),"Truncated multisend data");
  const input="0x"+packed.slice(offset,offset+Number(length)*2);offset+=Number(length)*2;
  eq(address,expected.to,"Funding target");assert.equal(amount,BigInt(expected.value));eq(input,expected.data,"Funding calldata");
 }
 assert.equal(offset,packed.length,"Unexpected extra funding operations");return true;
}
export async function verifyFundingReceipt({provider,manifest,fundingTxHash,userOpHash}) {
 assert.match(fundingTxHash||"",/^0x[0-9a-f]{64}$/i,"Canonical funding transaction hash required");
 assert.match(userOpHash||"",/^0x[0-9a-f]{64}$/i,"User operation hash required");
 const [receipt,transaction]=await Promise.all([provider.getTransactionReceipt(fundingTxHash),provider.getTransaction(fundingTxHash)]);
 assert.ok(receipt&&transaction,"Funding transaction must be mined");assert.equal(receipt.status,1,"Funding reverted");
 const block=await provider.getBlock(receipt.blockNumber);eq(block.hash,receipt.blockHash,"Funding receipt reorged");
 const events=receipt.logs.filter(log=>log.address.toLowerCase()===ENTRYPOINT).flatMap(log=>{try{const e=ENTRYPOINT_INTERFACE.parseLog(log);return e?.name==="UserOperationEvent"?[e]:[];}catch{return[];}});
 const matching=events.filter(e=>e.args.userOpHash.toLowerCase()===userOpHash.toLowerCase()&&e.args.sender.toLowerCase()===WALLET);
 assert.equal(matching.length,1,"Unique canonical Safe user operation event required");assert.equal(matching[0].args.success,true,"Funding user operation failed");
 const call=ENTRYPOINT_INTERFACE.parseTransaction({data:transaction.data});assert.ok(call,"Unsupported entrypoint wrapper calldata");
 const ops=call.name==="handleOps"?Array.from(call.args[0]):call.name==="handleAggregatedOps"?Array.from(call.args[0]).flatMap(group=>Array.from(group.userOps)):[];
 const ep=new Contract(ENTRYPOINT,ENTRYPOINT_INTERFACE,provider);const selected=[];
 for(const op of ops.filter(op=>op.sender.toLowerCase()===WALLET)){
  const hash=await ep.getUserOpHash(op,{blockTag:receipt.blockNumber});if(hash.toLowerCase()===userOpHash.toLowerCase())selected.push(op);
 }
 assert.equal(selected.length,1,"Canonical getUserOpHash must bind exactly one submitted operation");
 verifyExactFundingCallData(selected[0].callData,manifest);
 const withdrawals=receipt.logs.filter(log=>log.address.toLowerCase()===FUNDING_WETH).flatMap(log=>{try{const e=wethABI.parseLog(log);return e?.name==="Withdrawal"&&e.args.src.toLowerCase()===WALLET&&e.args.wad===FUNDING_AMOUNT_WEI?[e]:[];}catch{return[];}});
 assert.equal(withdrawals.length,1,"Exact Safe WETH withdrawal required");
 const [before,after,nonce,walletCode,wethCode,multiCode]=await Promise.all([provider.getBalance(manifest.deploymentEOA,receipt.blockNumber-1),provider.getBalance(manifest.deploymentEOA,receipt.blockNumber),provider.getTransactionCount(manifest.deploymentEOA,receipt.blockNumber),provider.getCode(WALLET,receipt.blockNumber),provider.getCode(FUNDING_WETH,receipt.blockNumber),provider.getCode(MULTISEND,receipt.blockNumber)]);
 assert.equal(before,0n,"Recipient was already funded");assert.equal(after,FUNDING_AMOUNT_WEI,"Recipient did not receive exact fixed funding");assert.equal(nonce,0,"Recipient spent during funding block");
 eq(keccak256(multiCode),"0xecd5bd14a08c5d2122379900b2f272bdf107a7e92423c10dd5fe3254386c9939","Canonical MultiSend semantics changed");
 eq(keccak256(walletCode),manifest.codeHashes.wallet,"Funding Safe code changed");eq(keccak256(wethCode),manifest.codeHashes.weth,"Funding WETH code changed");
 return {fundingTxHash,userOpHash,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,wallet:WALLET,amountWei:FUNDING_AMOUNT_WEI.toString()};
}
