// Dry-run by default. Explicit --broadcast deploys only the reviewed, fixed
// World Chain/Re7 USDC factory. Durable signed state prevents a retry from
// creating a second factory after a lost acknowledgement. Never logs keys/raw tx.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, Transaction, keccak256, getCreateAddress, formatEther, parseEther } from "ethers";

const ASSET = "0x79a02482a880bce3f13e09da970dc34db4cd24d1";
const REWARD = "0x2cFc85d8E48F8EAB294be644d9E25C3030863003";
const STRATEGY = "0xb1e80387ebe53ff75a89736097d34dc8d9e9045b";
const DISTRIBUTOR = "0x3Ef3D8bA38EBe18DB133cEc108f4D14CE00Dd9Ae";
const OPERATOR = "0x93bC44B8296977Feb479F95855D9b9E051C17dA2";
const FEE_BPS = 1000;
const GAS_LIMIT = 6_500_000n;
const MAX_TOTAL_COST = parseEther("0.000015");
const STATE = ".env.usdc-deployment.json"; // gitignored, owner-readable only
const broadcast = process.argv.includes("--broadcast");
const provider = new JsonRpcProvider("https://worldchain-mainnet.g.alchemy.com/public", 480, {
  staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1,
});
const artifact = JSON.parse(readFileSync("out/InheritanceVaultUSDCFactory.sol/InheritanceVaultUSDCFactory.json", "utf8"));
const helperArtifact = JSON.parse(readFileSync("out/InheritanceVaultUSDCDeployer.sol/InheritanceVaultUSDCDeployer.json", "utf8"));
const equalAddress = (a, b) => a.toLowerCase() === b.toLowerCase();
const deployment = await new ContractFactory(artifact.abi, artifact.bytecode.object)
  .getDeployTransaction(ASSET, STRATEGY, REWARD, OPERATOR, FEE_BPS);
function persist(state) {
  writeFileSync(STATE + ".tmp", JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  renameSync(STATE + ".tmp", STATE);
}
function normalizedRuntime(code, compiled = artifact) {
  let hex = code.slice(2).toLowerCase();
  for (const refs of Object.values(compiled.deployedBytecode.immutableReferences)) {
    for (const { start, length } of refs) hex = hex.slice(0, start * 2) + "0".repeat(length * 2) + hex.slice((start + length) * 2);
  }
  return "0x" + hex;
}
async function verify(address) {
  const code = await provider.getCode(address);
  assert.equal(normalizedRuntime(code), normalizedRuntime(artifact.deployedBytecode.object), "Runtime must match the compiled artifact");
  const factory = new Contract(address, artifact.abi, provider);
  const values = await Promise.all([factory.asset(), factory.strategy(), factory.rewardToken(), factory.feeRecipient(), factory.performanceFeeBps()]);
  assert.ok(equalAddress(values[0], ASSET) && equalAddress(values[1], STRATEGY) && equalAddress(values[2], REWARD) && equalAddress(values[3], OPERATOR));
  assert.equal(values[4], BigInt(FEE_BPS));
  const helperAddress = getCreateAddress({ from: address, nonce: 1 });
  const helperCode = await provider.getCode(helperAddress);
  assert.equal(normalizedRuntime(helperCode, helperArtifact), normalizedRuntime(helperArtifact.deployedBytecode.object, helperArtifact));
  const helper = new Contract(helperAddress, helperArtifact.abi, provider);
  const config = await Promise.all([helper.factory(), helper.asset(), helper.strategy(), helper.rewardToken(), helper.feeRecipient(), helper.performanceFeeBps()]);
  assert.ok(equalAddress(config[0], address) && equalAddress(config[1], ASSET) && equalAddress(config[2], STRATEGY) && equalAddress(config[3], REWARD) && equalAddress(config[4], OPERATOR));
  assert.equal(config[5], BigInt(FEE_BPS));
  const probeOwner = "0x2222222222222222222222222222222222222222";
  const created = await factory.createVault.staticCall("0x3333333333333333333333333333333333333333", 86400, { from: probeOwner });
  assert.match(created, /^0x[0-9a-fA-F]{40}$/);
  await assert.rejects(factory.createVault.staticCall("0x0000000000000000000000000000000000000000", 86400, { from: probeOwner }), error => {
    try { return factory.interface.parseError(error.data)?.name === "InvalidAddress"; } catch { return false; }
  });
  return { runtimeBytes: (code.length - 2) / 2, runtimeHash: keccak256(code), createSimulation: "passed",
    helperAddress, helperRuntimeBytes: (helperCode.length - 2) / 2, helperRuntimeHash: keccak256(helperCode) };
}
try {
  for (const compiled of [artifact, helperArtifact]) {
    assert.ok((compiled.deployedBytecode.object.length - 2) / 2 <= 24_576 && (compiled.bytecode.object.length - 2) / 2 <= 49_152);
  }
  assert.equal(BigInt(await provider.send("eth_chainId", [])), 480n);
  assert.notEqual(await provider.getCode(DISTRIBUTOR), "0x", "The canonical rewards distributor must exist on World Chain");
  const distributor = new Contract(DISTRIBUTOR, ["function getMerkleRoot() view returns(bytes32)"], provider);
  assert.notEqual(await distributor.getMerkleRoot(), "0x" + "00".repeat(32), "The canonical reward root must be initialized");
  const strategy = new Contract(STRATEGY, ["function asset() view returns(address)", "function decimals() view returns(uint8)", "function maxDeposit(address) view returns(uint256)"], provider);
  assert.ok(equalAddress(await strategy.asset(), ASSET), "The pinned strategy must hold USDC");
  const asset = new Contract(ASSET, ["function decimals() view returns(uint8)"], provider);
  const reward = new Contract(REWARD, ["function decimals() view returns(uint8)"], provider);
  assert.equal(await asset.decimals(), 6n, "USDC must use six decimals");
  assert.equal(await reward.decimals(), 18n, "WLD rewards must use eighteen decimals");
  assert.equal(await strategy.decimals(), 18n, "Pinned receipt shares must use eighteen decimals");
  assert.ok(await strategy.maxDeposit(OPERATOR) > 0n, "The pinned strategy must accept deposits");
  let state;
  if (existsSync(STATE)) {
    state = JSON.parse(readFileSync(STATE, "utf8"));
    const tx = Transaction.from(state.rawTransaction);
    assert.ok(tx.isSigned() && tx.chainId === 480n && equalAddress(tx.from, OPERATOR));
    assert.equal(tx.data, deployment.data);
    assert.equal(tx.to, null);
    assert.equal(tx.value, 0n);
    assert.equal(tx.gasLimit, GAS_LIMIT);
    assert.equal(tx.hash, state.hash);
    assert.equal(getCreateAddress({ from: tx.from, nonce: tx.nonce }), state.address);
    assert.ok(tx.type === 0 && tx.gasPrice > 0n && tx.gasLimit * tx.gasPrice <= MAX_TOTAL_COST);
  } else {
    const key = readFileSync(".env.deploy", "utf8").split("\n").find(line => line.startsWith("PRIVATE_KEY="))?.slice(12).trim();
    assert.match(key || "", /^(0x)?[0-9a-fA-F]{64}$/, "Deployment key must be present");
    const wallet = new Wallet(key.startsWith("0x") ? key : "0x" + key);
    assert.ok(equalAddress(wallet.address, OPERATOR), "Use the existing operator deployment wallet");
    const [balance, nonce, fee, estimate] = await Promise.all([
      provider.getBalance(OPERATOR), provider.getTransactionCount(OPERATOR, "pending"), provider.getFeeData(),
      provider.estimateGas({ ...deployment, from: OPERATOR }),
    ]);
    assert.ok(estimate > 4_000_000n && estimate < GAS_LIMIT, "Unexpected deployment gas estimate");
    assert.ok(fee.gasPrice > 0n && GAS_LIMIT * fee.gasPrice < MAX_TOTAL_COST);
    const rawTransaction = await wallet.signTransaction({ ...deployment, chainId: 480, nonce, gasLimit: GAS_LIMIT, type: 0, gasPrice: fee.gasPrice, value: 0n });
    const oracle = new Contract("0x420000000000000000000000000000000000000F", ["function getL1Fee(bytes) view returns(uint256)"], provider);
    const l1Fee = await oracle.getL1Fee(rawTransaction);
    const reserved = GAS_LIMIT * fee.gasPrice + l1Fee * 2n;
    assert.ok(reserved <= MAX_TOTAL_COST && balance > reserved, "Deployment must fit its total-cost limit and existing balance");
    const simulated = await provider.call({ ...deployment, from: OPERATOR, gasLimit: GAS_LIMIT });
    assert.equal(normalizedRuntime(simulated), normalizedRuntime(artifact.deployedBytecode.object));
    state = { hash: keccak256(rawTransaction), address: getCreateAddress({ from: OPERATOR, nonce }), rawTransaction,
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), nonce,
      feeRecipient: OPERATOR, performanceFeeBps: FEE_BPS, strategy: STRATEGY,
      asset: ASSET, rewardToken: REWARD, estimatedGas: estimate.toString(), reservedETH: formatEther(reserved), l1EstimateETH: formatEther(l1Fee) };
    if (broadcast) persist(state); // before the first network write
  }
  const summary = { address: state.address, hash: state.hash, feeRecipient: OPERATOR, performanceFeeBps: FEE_BPS,
    asset: ASSET, rewardToken: REWARD, strategy: STRATEGY, estimatedGas: state.estimatedGas, maximumReservedETH: state.reservedETH, broadcast };
  console.log(JSON.stringify(summary, null, 2));
  if (!broadcast) {
    console.log("Dry-run complete: no transaction broadcast or funds moved.");
  } else {
    let receipt = await provider.getTransactionReceipt(state.hash);
    if (!receipt) {
      const tx = Transaction.from(state.rawTransaction);
      const oracle = new Contract("0x420000000000000000000000000000000000000F", ["function getL1Fee(bytes) view returns(uint256)"], provider);
      const [currentL1, currentBalance] = await Promise.all([oracle.getL1Fee(state.rawTransaction), provider.getBalance(OPERATOR)]);
      const reserve = tx.gasLimit * tx.gasPrice + currentL1 * 2n;
      assert.ok(reserve <= MAX_TOTAL_COST && currentBalance > reserve, "Current broadcast/recovery must still fit the cost cap");
      // A lost response is ambiguous. Poll the same hash and retry only these
      // identical signed bytes; never obtain a new nonce or re-sign automatically.
      try { await provider.broadcastTransaction(state.rawTransaction); } catch { /* poll durable hash below */ }
      receipt = await provider.waitForTransaction(state.hash, 2, 120_000);
    }
    assert.ok(receipt, "No receipt yet; rerun --broadcast to resume this same transaction");
    assert.equal(receipt.status, 1, "Deployment reverted; retain state for inspection");
    assert.ok(equalAddress(receipt.contractAddress, state.address));
    const verified = await verify(state.address);
    const rawReceipt = await provider.send("eth_getTransactionReceipt", [state.hash]);
    assert.ok(rawReceipt.l1Fee !== undefined, "Actual OP data fee must be known");
    const totalFee = receipt.gasUsed * receipt.gasPrice + BigInt(rawReceipt.l1Fee);
    assert.ok(totalFee <= MAX_TOTAL_COST);
    state.receipt = { blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), totalFeeETH: formatEther(totalFee), ...verified };
    persist(state);
    console.log(JSON.stringify({ ...summary, receipt: state.receipt }, null, 2));
  }
} catch (error) {
  console.error("USDC deployment failed: " + (error.code || error.message || "unknown error"));
  process.exitCode = 1;
} finally { provider.destroy(); }
