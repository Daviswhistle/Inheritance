// Public router-funding intent: two explicit zero-value contract calls.
import { Interface, getAddress, getCreateAddress, keccak256, toBeHex, toUtf8Bytes } from "ethers";
import { WALLET } from "./worldapp-deployment-manifest.mjs";
export const ROUTER_FUNDING_SCHEMA = "inheritance.worldapp-router-funding.v2";
export const ROUTER = "0x091AD9e2e6e5eD44c1c66dB50e49A601F9f36cF6";
export const ROUTER_CODE_HASH = "0x8ae42530d55520d11a2d614228b01a9e9f9e85f5625606b6fa8e9e253d35c56d";
export const FUNDING_AMOUNT_WEI = 40000000000000n;
export const FUNDING_WETH = "0x4200000000000000000000000000000000000006";
export const ROUTER_FUNDING_INTERFACE = new Interface(["function transfer(address,uint256) returns(bool)","function unwrapWETH9(uint256,address)"]);
const eq = (a,b,label) => { if (String(a).toLowerCase() !== String(b).toLowerCase()) throw new Error(`Funding manifest ${label} mismatch`); };
export function validateWorldAppRouterFundingManifest(manifest, pinnedHash) {
  const { manifestHash, ...body } = manifest;
  eq(keccak256(toUtf8Bytes(JSON.stringify(body))), manifestHash, "digest");
  if (pinnedHash) eq(manifestHash, pinnedHash, "pinned digest");
  eq(manifest.schema,ROUTER_FUNDING_SCHEMA,"schema");eq(manifest.chainId,480,"chain");
  eq(manifest.wallet,WALLET,"wallet");eq(manifest.feeRecipient,WALLET,"fee recipient");eq(manifest.weth,FUNDING_WETH,"WETH");
  eq(manifest.amountWei,FUNDING_AMOUNT_WEI,"fixed amount");
  const recipient=getAddress(manifest.deploymentEOA);
  if (recipient.toLowerCase()===WALLET || recipient===getAddress(FUNDING_WETH) || /^0x0{40}$/i.test(recipient)) throw new Error("Invalid fixed deployment EOA");
  eq(manifest.recipientExpected.nonce,0,"recipient nonce");eq(manifest.recipientExpected.code,"0x","recipient code");eq(manifest.recipientExpected.balanceWei,"0","recipient balance");
  if (manifest.transactions?.length!==2) throw new Error("Exactly two funding transactions required");
  const [transfer,unwrap]=manifest.transactions;
  eq(transfer.to,FUNDING_WETH,"token transfer target");eq(transfer.value,"0x0","token transfer value");
  eq(transfer.data,ROUTER_FUNDING_INTERFACE.encodeFunctionData("transfer",[ROUTER,FUNDING_AMOUNT_WEI]),"token transfer calldata");
  eq(unwrap.to,ROUTER,"unwrap router");eq(unwrap.value,"0x0","unwrap value");
  eq(unwrap.data,ROUTER_FUNDING_INTERFACE.encodeFunctionData("unwrapWETH9",[FUNDING_AMOUNT_WEI,recipient]),"router unwrap calldata");
  eq(manifest.router.address,ROUTER,"canonical router");eq(manifest.router.codeHash,ROUTER_CODE_HASH,"router code");
  eq(manifest.router.weth9,FUNDING_WETH,"router WETH9");eq(manifest.router.initialWethWei,"0","initial router WETH");eq(manifest.router.initialNativeWei,"0","initial router native");
  if (manifest.normalCreateTargets?.length!==2) throw new Error("Two normal CREATE targets required");
  for (const [nonce,row] of manifest.normalCreateTargets.entries()) {
    eq(row.nonce,nonce,"CREATE nonce");eq(row.kind,nonce===0?"wld":"usdc","CREATE kind");
    eq(row.predictedAddress,getCreateAddress({from:recipient,nonce}),"CREATE address");
  }
  const hashPattern=/^0x[0-9a-f]{64}$/i;
  for (const row of manifest.normalCreateTargets) if (!hashPattern.test(row.initCodeHash)) throw new Error("Invalid CREATE init code hash");
  if (!hashPattern.test(manifest.deploymentManifestHash)) throw new Error("Invalid deployment manifest hash");
  for (const name of ["InheritanceVaultMorpho","InheritanceVaultMorphoFactory","InheritanceVaultMorphoDeployer","InheritanceVaultUSDC","InheritanceVaultUSDCFactory","InheritanceVaultUSDCDeployer"]) {
    for(const field of ["sha256","creationCodeHash","runtimeTemplateHash"]) if(!hashPattern.test(manifest.artifactDigests?.[name]?.[field])) throw new Error("Invalid reviewed artifact digest");
  }
  if(!manifest.sourceDigests || Object.keys(manifest.sourceDigests).length===0) throw new Error("Source digests required");
  for(const [source,entry]of Object.entries(manifest.sourceDigests)) {
    if(!source.startsWith("contracts/") || source.includes("..") || !hashPattern.test(entry.sha256) || !hashPattern.test(entry.keccak256)) throw new Error("Invalid reviewed source digest");
  }
  const quote=manifest.quote;
  const reserve=BigInt(quote.reserveIncludingReturnWei),estimated=BigInt(quote.estimatedIncludingReturnWei);
  if(quote.coversFunding!==true || reserve<=0n || estimated<=0n || reserve<estimated || reserve>FUNDING_AMOUNT_WEI || BigInt(quote.gasPriceWei)<=0n
    || BigInt(quote.fundingAmountWei)!==FUNDING_AMOUNT_WEI || BigInt(quote.headroomWei)!==FUNDING_AMOUNT_WEI-reserve) throw new Error("Invalid funding quote or insufficient deployment/return reserve");
  return manifest;
}
