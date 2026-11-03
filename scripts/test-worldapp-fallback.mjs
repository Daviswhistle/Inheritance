// Fixed funding + normal CREATE proof on a disposable read-only mainnet fork.
// All sender impersonation, balance changes and transactions are LOCAL ONLY.
import assert from "node:assert/strict";
import { readFileSync,mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { Contract,Interface,JsonRpcProvider,keccak256,solidityPacked,toQuantity,toUtf8Bytes } from "ethers";
import { ensureFallbackAccount,prepareWorldAppFallback } from "./prepare-worldapp-fallback.mjs";
import { validateWorldAppFundingManifest,FUNDING_AMOUNT_WEI,FUNDING_WETH } from "./lib/worldapp-funding-manifest.mjs";
import { verifyYieldGeneration } from "./verify/yield-generation.mjs";
const fixture=JSON.parse(readFileSync(new URL("../deployment/worldapp-funding-2026-11-03.json",import.meta.url)));
validateWorldAppFundingManifest(fixture,fixture.manifestHash);
const rehash=m=>{const{manifestHash,...body}=m;return{...body,manifestHash:keccak256(toUtf8Bytes(JSON.stringify(body)))}};
for(const mutate of [m=>m.transactions[1].to="0x"+"11".repeat(20),m=>m.normalCreateTargets[1].nonce=0,m=>m.quote.reserveIncludingReturnWei="-1",m=>m.quote.headroomWei="1",m=>m.normalCreateTargets[0].initCodeHash="bad",m=>m.sourceDigests={}]){
 const bad=structuredClone(fixture);mutate(bad);assert.throws(()=>validateWorldAppFundingManifest(rehash(bad)));
}
const temp=mkdtempSync(tmpdir()+"fallback-key-pin-");
try{
 const publicPath=temp+"/pinned.json";writeFileSync(publicPath,JSON.stringify(fixture));
 const privateDir=temp+"/private";mkdirSync(privateDir);
 await assert.rejects(ensureFallbackAccount({initialize:true,directory:privateDir,pinnedManifestPath:publicPath}),/Pinned funding account keystore is missing/);
 assert.equal(existsSync(privateDir+"/deployment-keystore.json"),false);
}catch(error){throw error;}finally{rmSync(temp,{recursive:true,force:true});}
const socket=createServer();await new Promise(r=>socket.listen(0,"127.0.0.1",r));const port=socket.address().port;await new Promise(r=>socket.close(r));
const child=spawn(process.env.ANVIL_BINARY||"anvil",["--port",String(port),"--chain-id","480","--fork-url",process.env.WORLDAPP_TEST_FORK_RPC||"https://worldchain-mainnet.g.alchemy.com/public","--fork-block-number",String(fixture.observation.number),"--gas-price",fixture.quote.gasPriceWei,"--silent"],{stdio:"ignore"});
let spawnError;child.on("error",e=>spawnError=e);const provider=new JsonRpcProvider(`http://127.0.0.1:${port}`,480,{batchMaxCount:1,cacheTimeout:-1});
try{
 for(let n=0;;n++){if(spawnError)throw spawnError;try{await provider.send("eth_chainId",[]);break;}catch(e){if(n>100)throw e;await sleep(100);}}
 // Vanilla Anvil adds a default priority tip unlike the OP public RPC. Pin
 // the quote gas price to the reviewed public snapshot; actual local EOA txs
 // below explicitly use this same gasPrice, with the fork base fee unchanged.
 const originalSend=provider.send.bind(provider);provider.send=(method,params)=>method==="eth_gasPrice"?Promise.resolve(toQuantity(BigInt(fixture.quote.gasPriceWei))):originalSend(method,params);
 const receiptFor=async hash=>{for(let attempt=0;attempt<100;attempt++){const receipt=await provider.getTransactionReceipt(hash);if(receipt)return receipt;await sleep(100);}throw new Error("Local receipt timeout");};
 const ast=process.env.AST_ARTIFACTS||"/tmp/yield-generation-ast-out";
 const {deploymentManifest,fundingManifest}=await prepareWorldAppFallback({provider,deploymentEOA:fixture.deploymentEOA,astArtifacts:ast});
 validateWorldAppFundingManifest(fundingManifest);
 assert.deepEqual(fundingManifest.normalCreateTargets,fixture.normalCreateTargets);
 const safe=new Contract(fixture.wallet,["function getModulesPaginated(address,uint256) view returns(address[],address)","function execTransactionFromModule(address,uint256,bytes,uint8) returns(bool)"],provider);
 const [modules]=await safe.getModulesPaginated("0x0000000000000000000000000000000000000001",10);assert.ok(modules.length);
 const module=modules[0];const multi="0x9641d764fc13c8B624c04430C7356C1C7C8102e2";
 assert.equal(keccak256(await provider.getCode(multi)),"0xecd5bd14a08c5d2122379900b2f272bdf107a7e92423c10dd5fe3254386c9939");
 const weth=new Contract(FUNDING_WETH,["function balanceOf(address) view returns(uint256)","function deposit() payable","function transfer(address,uint256) returns(bool)"],provider);
 const before=await weth.balanceOf(fixture.wallet);assert.equal(await provider.getBalance(fixture.wallet),0n);assert.equal(await provider.getBalance(fixture.deploymentEOA),0n);
 const packed=fundingManifest.transactions.map(tx=>solidityPacked(["uint8","address","uint256","uint256","bytes"],[0,tx.to,BigInt(tx.value),(tx.data.length-2)/2,tx.data])).map((x,i)=>i?x.slice(2):x).join("");
 const mi=new Interface(["function multiSend(bytes)"]);
 const data=safe.interface.encodeFunctionData("execTransactionFromModule",[multi,0,mi.encodeFunctionData("multiSend",[packed]),1]);
 await provider.send("anvil_setBalance",[module,"0xde0b6b3a7640000"]);await provider.send("anvil_impersonateAccount",[module]);
 // A rejected final native transfer must roll back the earlier unwrap. Safe's
 // module entrypoint can report failure while the outer transaction status is 1.
 const fundingSnapshot=await provider.send("evm_snapshot",[]);
 await provider.send("anvil_setCode",[fixture.deploymentEOA,"0x60006000fd"]);
 const failedHash=await provider.send("eth_sendTransaction",[{from:module,to:fixture.wallet,data,gas:"0xf4240"}]);
 await receiptFor(failedHash);
 assert.equal(await provider.getBalance(fixture.deploymentEOA),0n);
 assert.equal(await weth.balanceOf(fixture.wallet),before);
 assert.equal(await provider.getBalance(fixture.wallet),0n);
 assert.equal(await provider.send("evm_revert",[fundingSnapshot]),true);
 const fundHash=await provider.send("eth_sendTransaction",[{from:module,to:fixture.wallet,data,gas:"0xf4240"}]);const fundReceipt=await receiptFor(fundHash);assert.equal(fundReceipt.status,1);
 assert.equal(await provider.getBalance(fixture.deploymentEOA),FUNDING_AMOUNT_WEI);assert.equal(await provider.getBalance(fixture.wallet),0n);assert.equal(await weth.balanceOf(fixture.wallet),before-FUNDING_AMOUNT_WEI);
 await assert.rejects(prepareWorldAppFallback({provider,deploymentEOA:fixture.deploymentEOA,astArtifacts:ast}),/already funded/);
 await provider.send("anvil_impersonateAccount",[fixture.deploymentEOA]);
 for(const row of deploymentManifest.factories){
  assert.equal(await provider.getTransactionCount(fixture.deploymentEOA),row.nonce);
  const hash=await provider.send("eth_sendTransaction",[{...row.transaction,nonce:toQuantity(row.nonce),gas:toQuantity(BigInt(row.quote.gasLimit)),gasPrice:toQuantity(BigInt(row.quote.gasPriceWei))}]);const receipt=await receiptFor(hash);assert.equal(receipt.status,1);assert.equal(receipt.contractAddress.toLowerCase(),row.predictedAddress.toLowerCase());
  await verifyYieldGeneration({provider,...row.config,factoryAddress:row.predictedAddress,artifacts:ast,reviewedArtifacts:"out"});
  console.log(JSON.stringify({kind:row.kind,nonce:row.nonce,predictedAddress:row.predictedAddress,actualGasUsed:receipt.gasUsed.toString(),verified:true}));
 }
 const native=await provider.getBalance(fixture.deploymentEOA),returnReserve=BigInt(deploymentManifest.quote.returnReserveWei);assert.ok(native>returnReserve);
 const returned=native-returnReserve;
 const gasPrice=toQuantity(BigInt(fixture.quote.gasPriceWei));
 const depositHash=await provider.send("eth_sendTransaction",[{from:fixture.deploymentEOA,to:FUNDING_WETH,value:toQuantity(returned),data:weth.interface.encodeFunctionData("deposit"),nonce:"0x2",gas:"0x1d4c0",gasPrice}]);const depositReceipt=await receiptFor(depositHash);assert.equal(depositReceipt.status,1);assert.ok(depositReceipt.gasUsed<120000n);
 const transferHash=await provider.send("eth_sendTransaction",[{from:fixture.deploymentEOA,to:FUNDING_WETH,value:"0x0",data:weth.interface.encodeFunctionData("transfer",[fixture.wallet,returned]),nonce:"0x3",gas:"0x1d4c0",gasPrice}]);const transferReceipt=await receiptFor(transferHash);assert.equal(transferReceipt.status,1);assert.ok(transferReceipt.gasUsed<120000n);
 assert.equal(await weth.balanceOf(fixture.deploymentEOA),0n);assert.equal(await weth.balanceOf(fixture.wallet),before-FUNDING_AMOUNT_WEI+returned);
 console.log(JSON.stringify({fundingBatchGasUsed:fundReceipt.gasUsed.toString(),fundedWei:FUNDING_AMOUNT_WEI.toString(),returnedWETHWei:returned.toString(),returnDepositGas:depositReceipt.gasUsed.toString(),returnTransferGas:transferReceipt.gasUsed.toString(),remainingNativeDustWei:(await provider.getBalance(fixture.deploymentEOA)).toString(),note:"Disposable local fork proves control flow; vanilla Anvil does not charge OP L1/operator fees, so real costs remain oracle-quoted. No private key used or real signature created"}));
 console.log("PASS fixed funding manifest/nonce/hash/quote negatives, missing pinned-key replacement refusal, actual Safe ordered WETH unwrap/native funding, normal CREATE0/1 exact generation, WETH remainder return");
}finally{provider.destroy();child.kill("SIGTERM");}
