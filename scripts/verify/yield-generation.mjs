// Read-only verifier for the remediated immutable yield generation.
// CLI: node scripts/verify/yield-generation.mjs --rpc URL --kind wld|usdc --factory ADDRESS
//   --asset ADDRESS --strategy ADDRESS --fee-recipient ADDRESS --fee-bps 1000
//   [--reward-token ADDRESS (USDC)] --artifacts AST_OUT --reviewed-artifacts out
// AST_OUT must be built with forge build --ast into isolated --out/--cache-path.
// The AST artifacts' creation/runtime bytecode must exactly match reviewed artifacts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Contract, JsonRpcProvider, getAddress, getCreateAddress, keccak256, toBeHex, zeroPadValue } from "ethers";

const readArtifact = (directory, name) => JSON.parse(readFileSync(path.join(directory, `${name}.sol`, `${name}.json`), "utf8"));
const equalAddress = (actual, expected, label) => assert.equal(getAddress(actual), getAddress(expected), label);

function immutableNames(artifact, contractName) {
  assert.ok(artifact.ast, `Missing compiler AST for ${contractName}; rebuild isolated artifacts with --ast`);
  const contract = artifact.ast.nodes.find(node => node.nodeType === "ContractDefinition" && node.name === contractName);
  assert.ok(contract, `Missing contract AST: ${contractName}`);
  return new Map(contract.nodes.filter(node => node.nodeType === "VariableDeclaration" && node.mutability === "immutable")
    .map(node => [String(node.id), node.name]));
}

// Populate every immutable from independently expected values; never mask private
// helper/chunk pointers or lengths. All remaining runtime bytes must match exactly.
export function expectedRuntime(artifact, contractName, values) {
  const names = immutableNames(artifact, contractName);
  let expected = artifact.deployedBytecode.object.toLowerCase();
  const found = new Set();
  for (const [id, references] of Object.entries(artifact.deployedBytecode.immutableReferences || {})) {
    const name = names.get(id);
    assert.ok(name && Object.hasOwn(values, name), `Unverified immutable ${contractName}:${name || id}`);
    found.add(name);
    const value = typeof values[name] === "string" && values[name].startsWith("0x")
      ? zeroPadValue(values[name], 32).slice(2).toLowerCase() : toBeHex(BigInt(values[name]), 32).slice(2);
    for (const { start, length } of references) {
      assert.equal(length, 32, `Unexpected immutable width: ${name}`);
      const at = 2 + start * 2;
      expected = expected.slice(0, at) + value + expected.slice(at + length * 2);
    }
  }
  for (const name of Object.keys(values)) assert.ok(found.has(name), `Expected immutable omitted: ${contractName}:${name}`);
  return expected;
}

export async function verifyYieldGeneration({ provider, factoryAddress, kind, asset, strategy, feeRecipient,
  performanceFeeBps, rewardToken, artifacts, reviewedArtifacts, blockTag }) {
  assert.ok(kind === "wld" || kind === "usdc", "kind must be wld or usdc");
  assert.ok(reviewedArtifacts, "Reviewed artifact directory is required");
  const childName = kind === "wld" ? "InheritanceVaultMorpho" : "InheritanceVaultUSDC";
  const factoryName = childName + "Factory", deployerName = childName + "Deployer";
  const loaded = Object.fromEntries([childName, factoryName, deployerName].map(name => {
    const compiled = readArtifact(artifacts, name), reviewed = readArtifact(reviewedArtifacts, name);
    for (const key of ["bytecode", "deployedBytecode"]) {
      assert.equal(compiled[key].object.toLowerCase(), reviewed[key].object.toLowerCase(), `Reviewed ${name} ${key} mismatch`);
    }
    return [name, compiled];
  }));
  assert.equal((await provider.getNetwork()).chainId, 480n, "Expected World Chain chainId 480");
  factoryAddress = getAddress(factoryAddress);
  const observedBlock = blockTag ?? await provider.getBlockNumber();
  const helperAddress = getCreateAddress({ from: factoryAddress, nonce: 1 });
  const firstCodePart = getCreateAddress({ from: helperAddress, nonce: 1 });
  const secondCodePart = getCreateAddress({ from: helperAddress, nonce: 2 });
  const childCode = loaded[childName].bytecode.object.toLowerCase();
  const creationCodeLength = (childCode.length - 2) / 2;
  const firstCodeLength = Math.ceil(creationCodeLength / 2);
  assert.ok(creationCodeLength > 0 && creationCodeLength <= 49150, "Child creation-code size");
  const config = { [kind === "wld" ? "WLD" : "asset"]: asset, strategy, feeRecipient, performanceFeeBps: BigInt(performanceFeeBps) };
  if (kind === "usdc") config.rewardToken = rewardToken;
  const factoryValues = { ...config, vaultDeployer: helperAddress };
  const helperValues = { ...config, factory: factoryAddress, firstCodePart, secondCodePart, creationCodeLength, firstCodeLength };
  const factoryExpected = expectedRuntime(loaded[factoryName], factoryName, factoryValues);
  const helperExpected = expectedRuntime(loaded[deployerName], deployerName, helperValues);
  const [factoryCode, helperCode, firstCode, secondCode] = await Promise.all(
    [factoryAddress, helperAddress, firstCodePart, secondCodePart].map(address => provider.getCode(address, observedBlock)));
  assert.equal(factoryCode.toLowerCase(), factoryExpected, "Factory runtime/config immutable mismatch");
  assert.equal(helperCode.toLowerCase(), helperExpected, "Deployer runtime/config/chunk immutable mismatch");
  assert.equal(firstCode.toLowerCase(), "0x00" + childCode.slice(2, 2 + firstCodeLength * 2), "First STOP-prefixed creation-code chunk mismatch");
  assert.equal(secondCode.toLowerCase(), "0x00" + childCode.slice(2 + firstCodeLength * 2), "Second STOP-prefixed creation-code chunk mismatch");
  assert.equal("0x" + firstCode.slice(4) + secondCode.slice(4), childCode, "Reconstructed child creation code mismatch");
  // Also verify the public ABI returns the expected configuration at the same block.
  for (const [address, name, values] of [[factoryAddress, factoryName, config], [helperAddress, deployerName, { ...config, factory: factoryAddress }]]) {
    const contract = new Contract(address, loaded[name].abi, provider);
    for (const [key, expected] of Object.entries(values)) {
      const actual = await contract[key]({ blockTag: observedBlock });
      if (key === "performanceFeeBps") assert.equal(actual, expected, `${name}.${key}`);
      else equalAddress(actual, expected, `${name}.${key}`);
    }
  }
  return { kind, blockNumber: observedBlock, factoryAddress, helperAddress, firstCodePart, secondCodePart,
    creationCodeLength, firstCodeLength, factoryRuntimeHash: keccak256(factoryCode), helperRuntimeHash: keccak256(helperCode),
    reconstructedCreationCodeHash: keccak256(childCode) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (index % 2 === 0) { assert.ok(value.startsWith("--") && all[index + 1], "Expected --name value pairs"); pairs.push([value.slice(2), all[index + 1]]); }
    return pairs;
  }, []));
  for (const required of ["rpc", "kind", "factory", "asset", "strategy", "fee-recipient", "fee-bps", "artifacts", "reviewed-artifacts"]) {
    assert.ok(args[required], `Missing --${required}`);
  }
  const provider = new JsonRpcProvider(args.rpc);
  try {
    console.log(JSON.stringify(await verifyYieldGeneration({ provider, factoryAddress: args.factory, kind: args.kind,
      asset: args.asset, strategy: args.strategy, feeRecipient: args["fee-recipient"], performanceFeeBps: args["fee-bps"],
      rewardToken: args["reward-token"], artifacts: args.artifacts, reviewedArtifacts: args["reviewed-artifacts"] }), null, 2));
  } finally { provider.destroy(); }
}
