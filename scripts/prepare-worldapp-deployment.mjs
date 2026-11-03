// Read-only deterministic deployment manifest. No keys, signing or broadcasting.
// node scripts/prepare-worldapp-deployment.mjs [--rpc URL] [--out FILE] [--ast-artifacts DIR]
// API: prepareWorldAppDeployment({provider, artifacts, astArtifacts, repo}) -> public manifest.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ContractFactory, Interface, JsonRpcProvider, getCreate2Address, keccak256, toUtf8Bytes, toQuantity } from "ethers";
import { validateWorldAppDeploymentManifest } from "./lib/worldapp-deployment-manifest.mjs";
import { verifyYieldGeneration } from "./verify/yield-generation.mjs";
export const SCHEMA = "inheritance.worldapp-deployment.v1";
export const DEPLOYMENT_WALLET = "0xe819320ed3d03f9912b06a48cc5e7f06060cc67a";
export const CREATE_CALL = "0x9b35Af71d77eaf8d7e40252370304687390A1A52";
export const CREATE_CALL_CODE_HASH = "0x2b3060c55fcb8275653e99ad511a71f67ba76934ed66a7d74d6e68b52afff889";
export const CREATE_CALL_ABI = ["function performCreate2(uint256 value,bytes deploymentData,bytes32 salt) returns(address)", "event ContractCreation(address indexed newContract)"];
const DEFAULT_REPO = fileURLToPath(new URL("../", import.meta.url));
const hash = bytes => "0x" + createHash("sha256").update(bytes).digest("hex");
const recipes = [
  { kind: "wld", childName: "InheritanceVaultMorpho", asset: "0x2cFc85d8E48F8EAB294be644d9E25C3030863003", strategy: "0x348831b46876d3dF2Db98BdEc5E3B4083329Ab9f" },
  { kind: "usdc", childName: "InheritanceVaultUSDC", asset: "0x79a02482a880bce3f13e09da970dc34db4cd24d1", rewardToken: "0x2cFc85d8E48F8EAB294be644d9E25C3030863003", strategy: "0xb1e80387ebe53ff75a89736097d34dc8d9e9045b" },
];
export async function prepareWorldAppDeployment({ provider, repo = DEFAULT_REPO,
  artifacts = path.join(repo, "out"), astArtifacts = "/tmp/yield-generation-ast-out" }) {
  assert.equal((await provider.getNetwork()).chainId, 480n, "Expected World Chain chain 480");
  const block = await provider.getBlock("latest");
  assert.ok(block?.hash, "Coherent block is required");
  const blockTag = toQuantity(block.number);
  const [helperCode, walletCode, balance] = await Promise.all([
    provider.getCode(CREATE_CALL, block.number), provider.getCode(DEPLOYMENT_WALLET, block.number), provider.getBalance(DEPLOYMENT_WALLET, block.number),
  ]);
  assert.equal(keccak256(helperCode), CREATE_CALL_CODE_HASH, "Canonical Safe 1.4.1 CreateCall code hash mismatch");
  assert.notEqual(walletCode, "0x", "World App wallet must be a deployed contract wallet");
  const artifactDigests = {}, sourceDigests = {}, deployments = [];
  const load = name => {
    const bytes = readFileSync(path.join(artifacts, `${name}.sol`, `${name}.json`));
    const artifact = JSON.parse(bytes);
    const metadata = typeof artifact.metadata === "string" ? JSON.parse(artifact.metadata) : artifact.metadata;
    assert.ok(metadata.compiler.version.startsWith("0.8.38+"), "Reviewed compiler must be solc 0.8.38");
    assert.equal(metadata.settings.viaIR, true); assert.equal(metadata.settings.evmVersion, "cancun");
    assert.equal(metadata.settings.optimizer.enabled, true); assert.equal(metadata.settings.optimizer.runs, 200);
    artifactDigests[name] = { sha256: hash(bytes), creationCodeHash: keccak256(artifact.bytecode.object), runtimeTemplateHash: keccak256(artifact.deployedBytecode.object) };
    for (const [source, expected] of Object.entries(metadata.sources)) {
      const content = readFileSync(path.resolve(repo, source));
      assert.equal(keccak256(content), expected.keccak256, `Source/artifact mismatch: ${source}`);
      sourceDigests[source] = { sha256: hash(content), keccak256: expected.keccak256 };
    }
    return artifact;
  };
  for (const recipe of recipes) {
    const factoryName = recipe.childName + "Factory";
    const artifact = load(factoryName); load(recipe.childName + "Deployer"); load(recipe.childName);
    const config = { kind: recipe.kind, asset: recipe.asset, strategy: recipe.strategy, feeRecipient: DEPLOYMENT_WALLET, performanceFeeBps: 1000 };
    if (recipe.rewardToken) config.rewardToken = recipe.rewardToken;
    const args = recipe.kind === "wld"
      ? [config.asset, config.strategy, config.feeRecipient, config.performanceFeeBps]
      : [config.asset, config.strategy, config.rewardToken, config.feeRecipient, config.performanceFeeBps];
    const { data: initCode } = await new ContractFactory(artifact.abi, artifact.bytecode.object).getDeployTransaction(...args);
    const initCodeHash = keccak256(initCode);
    // Ordered JSON tuple is the complete, versioned salt preimage. Configuration
    // is also committed by initCodeHash; no block, gas quote or timestamp enters it.
    const saltPreimage = JSON.stringify([SCHEMA, 480, DEPLOYMENT_WALLET, DEPLOYMENT_WALLET, factoryName, initCodeHash]);
    const salt = keccak256(toUtf8Bytes(saltPreimage));
    const predictedAddress = getCreate2Address(CREATE_CALL, salt, initCodeHash);
    const data = new Interface(CREATE_CALL_ABI).encodeFunctionData("performCreate2", [0, initCode, salt]);
    const transaction = { from: DEPLOYMENT_WALLET, to: CREATE_CALL, value: "0x0", data };
    const existingCode = await provider.getCode(predictedAddress, block.number);
    const row = { kind: recipe.kind, factoryName, config, saltPreimage, salt, predictedAddress, initCodeHash,
      initCodeBytes: (initCode.length - 2) / 2, transaction, status: "ready", estimateGas: null, paddedGasLimit: null };
    if (existingCode !== "0x") {
      row.verification = await verifyYieldGeneration({ provider, ...config, factoryAddress: predictedAddress,
        artifacts: astArtifacts, reviewedArtifacts: artifacts, blockTag: block.number });
      row.status = "already_deployed_verified";
    } else {
      const gas = BigInt(await provider.send("eth_estimateGas", [transaction, blockTag]));
      row.estimateGas = gas.toString(); row.paddedGasLimit = ((gas * 120n + 99n) / 100n).toString();
      const result = await provider.send("eth_call", [{ ...transaction, gas: toQuantity(BigInt(row.paddedGasLimit)) }, blockTag]);
      const [simulatedAddress] = new Interface(CREATE_CALL_ABI).decodeFunctionResult("performCreate2", result);
      assert.equal(simulatedAddress.toLowerCase(), predictedAddress.toLowerCase(), "CREATE2 simulation address mismatch");
    }
    deployments.push(row);
  }
  // Refuse a reorged observation rather than mixing proofs from two chain states.
  assert.equal((await provider.getBlock(block.number)).hash, block.hash, "Observed block changed during preparation");
  const manifest = { schema: SCHEMA, chainId: 480, wallet: DEPLOYMENT_WALLET, feeRecipient: DEPLOYMENT_WALLET,
    callOperation: "CALL", observation: { number: block.number, hash: block.hash, timestamp: block.timestamp },
    createCall: { address: CREATE_CALL, codeHash: CREATE_CALL_CODE_HASH, release: "Safe 1.4.1" },
    walletCodeHash: keccak256(walletCode), walletBalanceWei: balance.toString(), compiler: { version: "0.8.38", viaIR: true, optimizerRuns: 200, evmVersion: "cancun" },
    artifactDigests, sourceDigests, deployments };
  return validateWorldAppDeploymentManifest({ ...manifest, manifestHash: keccak256(toUtf8Bytes(JSON.stringify(manifest))) });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (index % 2 === 0) { assert.ok(value.startsWith("--") && all[index + 1], "Expected --name value pairs"); pairs.push([value.slice(2), all[index + 1]]); } return pairs;
  }, []));
  const provider = new JsonRpcProvider(args.rpc || "https://worldchain-mainnet.g.alchemy.com/public", 480, { batchMaxCount: 1, cacheTimeout: -1 });
  try {
    const manifest = await prepareWorldAppDeployment({ provider, astArtifacts: args["ast-artifacts"] });
    const output = path.resolve(args.out || path.join(DEFAULT_REPO, "../evidence/worldapp-deployment-nov03/manifest.json"));
    mkdirSync(path.dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n");
    console.log(JSON.stringify({ output, manifestHash: manifest.manifestHash, observation: manifest.observation,
      deployments: manifest.deployments.map(({ kind, predictedAddress, status, estimateGas }) => ({ kind, predictedAddress, status, estimateGas })) }, null, 2));
  } finally { provider.destroy(); }
}
