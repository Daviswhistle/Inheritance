// Browser-safe validation of the public, hash-pinned deployment intent.
import { AbiCoder, Interface, getCreate2Address, keccak256, toUtf8Bytes } from "ethers";
export const SCHEMA = "inheritance.worldapp-deployment.v1";
export const WALLET = "0xe819320ed3d03f9912b06a48cc5e7f06060cc67a";
export const HELPER = "0x9b35af71d77eaf8d7e40252370304687390a1a52";
export const HELPER_HASH = "0x2b3060c55fcb8275653e99ad511a71f67ba76934ed66a7d74d6e68b52afff889";
const iface = new Interface(["function performCreate2(uint256,bytes,bytes32) returns(address)"]);
const eq = (actual, expected, label) => { if (String(actual).toLowerCase() !== String(expected).toLowerCase()) throw new Error(`Deployment manifest ${label} mismatch`); };
export function validateWorldAppDeploymentManifest(manifest, expectedManifestHash) {
  const { manifestHash, ...body } = manifest;
  const computed = keccak256(toUtf8Bytes(JSON.stringify(body)));
  eq(manifestHash, computed, "digest");
  if (expectedManifestHash) eq(manifestHash, expectedManifestHash, "pinned digest");
  eq(manifest.schema, SCHEMA, "schema"); eq(manifest.chainId, 480, "chain");
  eq(manifest.wallet, WALLET, "wallet"); eq(manifest.feeRecipient, WALLET, "fee recipient"); eq(manifest.callOperation, "CALL", "operation");
  eq(manifest.createCall.address, HELPER, "helper"); eq(manifest.createCall.codeHash, HELPER_HASH, "helper code hash");
  if (manifest.deployments?.length !== 2) throw new Error("Expected exactly two yield deployments");
  const kinds = new Set();
  for (const row of manifest.deployments) {
    if (!["wld", "usdc"].includes(row.kind) || kinds.has(row.kind)) throw new Error("Invalid deployment kinds");
    kinds.add(row.kind);
    const usdc = row.kind === "usdc";
    const factoryName = usdc ? "InheritanceVaultUSDCFactory" : "InheritanceVaultMorphoFactory";
    eq(row.factoryName, factoryName, "factory");
    const tx = row.transaction;
    eq(tx.from, WALLET, "transaction sender"); eq(tx.to, HELPER, "transaction target"); eq(BigInt(tx.value), 0n, "value");
    const [value, initCode, salt] = iface.decodeFunctionData("performCreate2", tx.data);
    eq(value, 0n, "create value"); eq(salt, row.salt, "salt"); eq(keccak256(initCode), row.initCodeHash, "init code");
    eq(iface.encodeFunctionData("performCreate2", [value, initCode, salt]), tx.data, "canonical calldata");
    const preimage = JSON.stringify([SCHEMA, 480, WALLET, WALLET, factoryName, row.initCodeHash]);
    eq(row.saltPreimage, preimage, "salt preimage"); eq(keccak256(toUtf8Bytes(preimage)), salt, "derived salt");
    eq(getCreate2Address(HELPER, salt, row.initCodeHash), row.predictedAddress, "CREATE2 address");
    const argCount = usdc ? 5 : 4;
    const constructorBytes = argCount * 64;
    const base = initCode.slice(0, -constructorBytes);
    eq(keccak256(base), manifest.artifactDigests[factoryName].creationCodeHash, "reviewed creation code");
    const decoded = AbiCoder.defaultAbiCoder().decode([...Array(argCount - 1).fill("address"), "uint256"], "0x" + initCode.slice(-constructorBytes));
    const asset = usdc ? "0x79a02482a880bce3f13e09da970dc34db4cd24d1" : "0x2cfc85d8e48f8eab294be644d9e25c3030863003";
    const strategy = usdc ? "0xb1e80387ebe53ff75a89736097d34dc8d9e9045b" : "0x348831b46876d3df2db98bdec5e3b4083329ab9f";
    eq(decoded[0], asset, "constructor asset"); eq(decoded[1], strategy, "constructor strategy");
    if (usdc) eq(decoded[2], "0x2cfc85d8e48f8eab294be644d9e25c3030863003", "constructor reward");
    eq(decoded[argCount - 2], WALLET, "constructor fee recipient"); eq(decoded[argCount - 1], 1000n, "constructor fee bps");
    eq(row.config.asset, asset, "config asset"); eq(row.config.strategy, strategy, "config strategy");
    eq(row.config.feeRecipient, WALLET, "config fee recipient"); eq(row.config.performanceFeeBps, 1000, "config fee bps");
  }
  return manifest;
}
