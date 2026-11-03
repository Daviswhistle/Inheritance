// Public browser-safe fixed funding intent validator. No key handling.
import { Interface, getAddress, getCreateAddress, keccak256, toBeHex, toUtf8Bytes } from "ethers";
import { WALLET } from "./worldapp-deployment-manifest.mjs";
export const FUNDING_SCHEMA = "inheritance.worldapp-funding.v1";
export const FUNDING_AMOUNT_WEI = 40000000000000n;
export const FUNDING_WETH = "0x4200000000000000000000000000000000000006";
export const WETH_INTERFACE = new Interface(["function withdraw(uint256)"]);
const eq = (a,b,label) => { if (String(a).toLowerCase() !== String(b).toLowerCase()) throw new Error(`Funding manifest ${label} mismatch`); };
export function validateWorldAppFundingManifest(manifest, pinnedHash) {
  const { manifestHash, ...body } = manifest;
  eq(keccak256(toUtf8Bytes(JSON.stringify(body))), manifestHash, "digest");
  if (pinnedHash) eq(manifestHash, pinnedHash, "pinned digest");
  eq(manifest.schema,FUNDING_SCHEMA,"schema");eq(manifest.chainId,480,"chain");
  eq(manifest.wallet,WALLET,"wallet");eq(manifest.feeRecipient,WALLET,"fee recipient");eq(manifest.weth,FUNDING_WETH,"WETH");
  eq(manifest.amountWei,FUNDING_AMOUNT_WEI,"fixed amount");
  const recipient=getAddress(manifest.deploymentEOA);
  if (recipient.toLowerCase()===WALLET || recipient===getAddress(FUNDING_WETH) || /^0x0{40}$/i.test(recipient)) throw new Error("Invalid fixed deployment EOA");
  eq(manifest.recipientExpected.nonce,0,"recipient nonce");eq(manifest.recipientExpected.code,"0x","recipient code");eq(manifest.recipientExpected.balanceWei,"0","recipient balance");
  if (manifest.transactions?.length!==2) throw new Error("Exactly two funding transactions required");
  const [unwrap,transfer]=manifest.transactions;
  eq(unwrap.to,FUNDING_WETH,"unwrap target");eq(unwrap.value,"0x0","unwrap value");
  eq(unwrap.data,WETH_INTERFACE.encodeFunctionData("withdraw",[FUNDING_AMOUNT_WEI]),"unwrap calldata");
  eq(transfer.to,recipient,"native transfer target");eq(transfer.data,"0x","native transfer calldata");eq(transfer.value,toBeHex(FUNDING_AMOUNT_WEI),"native transfer value");
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
