// Read-only preparation of the transparent router funding variant. Never opens a key.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {Contract,JsonRpcProvider,keccak256,toUtf8Bytes} from 'ethers';
import {prepareWorldAppFallback,PRIVATE_FALLBACK_DIR} from './prepare-worldapp-fallback.mjs';
import {validateWorldAppFundingManifest} from './lib/worldapp-funding-manifest.mjs';
import {validateWorldAppRouterFundingManifest,ROUTER,ROUTER_CODE_HASH,ROUTER_FUNDING_SCHEMA,ROUTER_FUNDING_INTERFACE,FUNDING_WETH,FUNDING_AMOUNT_WEI} from './lib/worldapp-router-funding-manifest.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url));
export async function prepareWorldAppRouterFunding({provider,previousManifest,deploymentManifest,astArtifacts='/tmp/yield-generation-ast-out'}){
 validateWorldAppFundingManifest(previousManifest);
 const{manifestHash,...body}=deploymentManifest;assert.equal(keccak256(toUtf8Bytes(JSON.stringify(body))),manifestHash);assert.equal(manifestHash,previousManifest.deploymentManifestHash);
 const fresh=await prepareWorldAppFallback({provider,deploymentEOA:previousManifest.deploymentEOA,astArtifacts});
 assert.deepEqual(fresh.fundingManifest.normalCreateTargets,previousManifest.normalCreateTargets,'EOA/nonces/constructor init hashes must not change');
 const observation=fresh.fundingManifest.observation;
 const router=new Contract(ROUTER,['function WETH9() view returns(address)'],provider);
 const weth=new Contract(FUNDING_WETH,['function balanceOf(address) view returns(uint256)'],provider);
 const[code,weth9,wethBalance,nativeBalance]=await Promise.all([provider.getCode(ROUTER,observation.number),router.WETH9({blockTag:observation.number}),weth.balanceOf(ROUTER,{blockTag:observation.number}),provider.getBalance(ROUTER,observation.number)]);
 assert.equal(keccak256(code),ROUTER_CODE_HASH,'Canonical router runtime mismatch');assert.equal(weth9.toLowerCase(),FUNDING_WETH);
 assert.equal(wethBalance,0n,'Nonzero router WETH: stop without handling third-party balances');assert.equal(nativeBalance,0n,'Nonzero router native balance: stop');
 const{manifestHash:ignored,...base}=previousManifest;
 const result={...base,schema:ROUTER_FUNDING_SCHEMA,observation,quote:fresh.fundingManifest.quote,
  transactions:[{to:FUNDING_WETH,value:'0x0',data:ROUTER_FUNDING_INTERFACE.encodeFunctionData('transfer',[ROUTER,FUNDING_AMOUNT_WEI])},
   {to:ROUTER,value:'0x0',data:ROUTER_FUNDING_INTERFACE.encodeFunctionData('unwrapWETH9',[FUNDING_AMOUNT_WEI,previousManifest.deploymentEOA])}],
  router:{address:ROUTER,codeHash:ROUTER_CODE_HASH,weth9:FUNDING_WETH,initialWethWei:'0',initialNativeWei:'0'},
  racePolicy:'Recheck zero router WETH immediately before sending. unwrapWETH9 sweeps its full WETH balance; receipt must prove exact q Withdrawal and exact q recipient funding. Any extra inventory/funding stops the runner; no automatic correction.'};
 assert.equal((await provider.getBlock(observation.number)).hash,observation.hash,'Preparation block reorged');
 return validateWorldAppRouterFundingManifest({...result,manifestHash:keccak256(toUtf8Bytes(JSON.stringify(result)))});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const args=Object.fromEntries(process.argv.slice(2).reduce((out,v,i,all)=>{if(i%2===0){assert.ok(v.startsWith('--')&&all[i+1]);out.push([v.slice(2),all[i+1]]);}return out;},[]));
 const previousManifest=JSON.parse(readFileSync(path.join(repo,'deployment/worldapp-funding-2026-11-03.json'),'utf8'));
 const deploymentManifest=JSON.parse(readFileSync(path.join(PRIVATE_FALLBACK_DIR,'deployment-manifest.json'),'utf8'));
 const provider=new JsonRpcProvider(args.rpc||'https://worldchain-mainnet.g.alchemy.com/public',480,{batchMaxCount:1,cacheTimeout:-1});
 try{const manifest=await prepareWorldAppRouterFunding({provider,previousManifest,deploymentManifest,astArtifacts:args['ast-artifacts']});
 const output=path.join(repo,'deployment/worldapp-router-funding-2026-11-03.json');writeFileSync(output,JSON.stringify(manifest,null,2)+'\n');
 console.log(JSON.stringify({output,manifestHash:manifest.manifestHash,deploymentEOA:manifest.deploymentEOA,amountWei:manifest.amountWei,deploymentManifestHash:manifest.deploymentManifestHash,quote:manifest.quote},null,2));
 }finally{provider.destroy();}
}
