#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Interface, JsonRpcProvider, getAddress, isAddress } from "ethers";

const CHAIN_ID = 480;
const MAX_BLOCK_RANGE = 3_000_000;
const MAX_LOG_REQUESTS = 2_500;
const DEFAULT_LOG_PAGE_SIZE = 90;
const MAX_LOG_PAGE_SIZE = 2_000;
const MAX_VAULTS = 100;
const MAX_OPERATOR_TXS = 100;
const ZERO = "0x0000000000000000000000000000000000000000";

const FEE_INTERFACE = new Interface([
  "event PerformanceFeePaid(address indexed recipient,uint256 assets,uint256 shares)",
  "event RewardFeePaid(address indexed recipient,uint256 amount)",
]);
const TOKEN_INTERFACE = new Interface(["function decimals() view returns (uint8)"]);
const FACTORY_INTERFACE = new Interface([
  "function WLD() view returns (address)",
  "function asset() view returns (address)",
  "function rewardToken() view returns (address)",
  "function strategy() view returns (address)",
  "function feeRecipient() view returns (address)",
  "function knownVaults(address) view returns (bool)",
]);
const VAULT_INTERFACE = new Interface([
  "function factory() view returns (address)",
  "function WLD() view returns (address)",
  "function asset() view returns (address)",
  "function rewardToken() view returns (address)",
  "function strategy() view returns (address)",
  "function feeRecipient() view returns (address)",
]);
const STRATEGY_INTERFACE = new Interface([
  "function asset() view returns (address)",
  "function decimals() view returns (uint8)",
  "function convertToAssets(uint256) view returns (uint256)",
]);
const ORACLE_INTERFACE = new Interface(["function getOperatorFee(uint256) view returns (uint256)"]);
const ORACLE_ADDRESS = "0x420000000000000000000000000000000000000F";

export class OpsReportError extends Error {
  constructor(code) {
    super(code);
    this.name = "OpsReportError";
    this.code = code;
  }
}

function fail(code) { throw new OpsReportError(code); }
function lower(value) { return String(value).toLowerCase(); }
function sameAddress(a, b) { return lower(a) === lower(b); }
function safeAddress(value) {
  if (typeof value !== "string" || !isAddress(value)) fail("invalid_configuration");
  const address = getAddress(value);
  if (sameAddress(address, ZERO)) fail("invalid_configuration");
  return address;
}
function bigint(value, code = "invalid_chain_value") {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) fail(code);
    return parsed;
  } catch { fail(code); }
}
function safeBlock(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail("invalid_block_range");
  return value;
}
function rawAmount(value, decimals) {
  const raw = bigint(value).toString();
  const human = formatAmount(BigInt(raw), decimals);
  return { raw, amount: human };
}
function formatAmount(raw, decimals) {
  const scale = 10n ** BigInt(decimals);
  const whole = raw / scale;
  const fractional = (raw % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fractional ? `${whole}.${fractional}` : whole.toString();
}
function parseDecimal18(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return BigInt(whole) * 10n ** 18n + BigInt((fraction + "0".repeat(18)).slice(0, 18));
}
function formatUsd18(value) { return formatAmount(value < 0n ? -value : value, 18).replace(/^/, value < 0n ? "-" : ""); }
function hashValid(value) { return typeof value === "string" && /^0x[\da-fA-F]{64}$/.test(value); }
function rpcQuantity(value) {
  if (typeof value === "string" && /^0x[\da-fA-F]+$/.test(value)) return BigInt(value);
  return bigint(value);
}
function dateMillis(value) {
  if (typeof value !== "string") return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

function validateInputs({ config, fromBlock, toBlock, operatorTxHashes = [] }) {
  if (!config || typeof config !== "object" || config.chainId !== CHAIN_ID) fail("chain_must_be_480");
  const from = safeBlock(fromBlock);
  const to = safeBlock(toBlock);
  if (from > to || to - from + 1 > MAX_BLOCK_RANGE) fail("invalid_block_range");
  if (!Array.isArray(config.trustedFactories) || config.trustedFactories.length === 0 ||
      config.trustedFactories.length > 50 || !Array.isArray(config.vaults) ||
      config.vaults.length > MAX_VAULTS) fail("invalid_configuration");
  const logPageSize = config.logPageSize ?? DEFAULT_LOG_PAGE_SIZE;
  if (!Number.isSafeInteger(logPageSize) || logPageSize < 1 || logPageSize > MAX_LOG_PAGE_SIZE) fail("invalid_configuration");
  if (Math.ceil((to - from + 1) / logPageSize) * config.vaults.length > MAX_LOG_REQUESTS) {
    fail("log_query_budget_exceeded");
  }
  if (!Array.isArray(operatorTxHashes) || operatorTxHashes.length > MAX_OPERATOR_TXS ||
      operatorTxHashes.some((hash) => !hashValid(hash))) fail("invalid_operator_tx_hash");

  const wldToken = safeAddress(config.wldToken);
  const usdcToken = safeAddress(config.usdcToken);
  if (sameAddress(wldToken, usdcToken)) fail("currency_mismatch");
  const factories = new Map();
  for (const source of config.trustedFactories) {
    if (!source || !["wld", "usdc"].includes(source.kind)) fail("invalid_configuration");
    const address = safeAddress(source.address);
    if (factories.has(lower(address))) fail("invalid_configuration");
    factories.set(lower(address), { address, kind: source.kind });
  }
  const seenVaults = new Set();
  const vaults = config.vaults.map((entry) => {
    if (!entry || typeof entry !== "object") fail("invalid_configuration");
    const address = safeAddress(entry.address);
    if (seenVaults.has(lower(address))) fail("invalid_configuration");
    seenVaults.add(lower(address));
    const expectedFactory = entry.factory == null ? null : safeAddress(entry.factory);
    const kind = entry.kind == null ? null : entry.kind;
    if (kind !== null && !["wld", "usdc"].includes(kind)) fail("invalid_configuration");
    return { address, expectedFactory, kind };
  });
  if (config.operatorAddresses != null && !Array.isArray(config.operatorAddresses)) fail("invalid_configuration");
  const operators = new Set();
  for (const address of config.operatorAddresses || []) operators.add(lower(safeAddress(address)));

  return {
    config,
    fromBlock: from,
    toBlock: to,
    logPageSize,
    operatorTxHashes: [...new Set(operatorTxHashes.map(lower))],
    duplicateOperatorTxHashes: operatorTxHashes.length - new Set(operatorTxHashes.map(lower)).size,
    wldToken,
    usdcToken,
    factories,
    vaults,
    operators,
  };
}

async function codeExists(provider, address, block, code) {
  try {
    const value = await provider.getCode(address, block);
    if (!value || value === "0x") fail(code);
  } catch (error) {
    if (error instanceof OpsReportError) throw error;
    fail(code);
  }
}

async function call(provider, iface, address, method, args, block) {
  try {
    const data = iface.encodeFunctionData(method, args);
    const encoded = await provider.call({ to: address, data, blockTag: block });
    const result = iface.decodeFunctionResult(method, encoded);
    return result.length === 1 ? result[0] : result;
  } catch {
    fail("contract_read_failed");
  }
}

async function decimalsAt(provider, token, block, expected, code) {
  await codeExists(provider, token, block, code);
  const decimals = Number(await call(provider, TOKEN_INTERFACE, token, "decimals", [], block));
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36 ||
      expected !== null && decimals !== expected) fail(code);
  return decimals;
}

async function validateVault(provider, input, index, normalized, finalizedBlock) {
  const { address, expectedFactory, kind: expectedKind } = input;
  await codeExists(provider, address, finalizedBlock, "unknown_fee_source");
  const factoryAddress = getAddress(await call(provider, VAULT_INTERFACE, address, "factory", [], finalizedBlock));
  const trusted = normalized.factories.get(lower(factoryAddress));
  if (!trusted || expectedFactory && !sameAddress(factoryAddress, expectedFactory)) fail("unknown_fee_source");
  const kind = trusted.kind;
  if (expectedKind && expectedKind !== kind) fail("currency_mismatch");
  await codeExists(provider, factoryAddress, finalizedBlock, "unknown_fee_source");
  const registered = await call(provider, FACTORY_INTERFACE, factoryAddress, "knownVaults", [address], finalizedBlock);
  if (registered !== true) fail("unknown_fee_source");

  const factoryFeeRecipient = getAddress(await call(provider, FACTORY_INTERFACE, factoryAddress, "feeRecipient", [], finalizedBlock));
  const factoryStrategy = getAddress(await call(provider, FACTORY_INTERFACE, factoryAddress, "strategy", [], finalizedBlock));
  const vaultFeeRecipient = getAddress(await call(provider, VAULT_INTERFACE, address, "feeRecipient", [], finalizedBlock));
  const vaultStrategy = getAddress(await call(provider, VAULT_INTERFACE, address, "strategy", [], finalizedBlock));
  if (sameAddress(factoryFeeRecipient, ZERO) || !sameAddress(factoryFeeRecipient, vaultFeeRecipient) ||
      !sameAddress(factoryStrategy, vaultStrategy)) fail("unknown_fee_recipient");

  let asset;
  let rewardToken = null;
  let cashDecimals;
  if (kind === "wld") {
    const factoryWld = getAddress(await call(provider, FACTORY_INTERFACE, factoryAddress, "WLD", [], finalizedBlock));
    const vaultWld = getAddress(await call(provider, VAULT_INTERFACE, address, "WLD", [], finalizedBlock));
    if (!sameAddress(factoryWld, normalized.wldToken) || !sameAddress(vaultWld, normalized.wldToken)) fail("currency_mismatch");
    asset = normalized.wldToken;
    rewardToken = normalized.wldToken;
    cashDecimals = await decimalsAt(provider, asset, finalizedBlock, 18, "currency_mismatch");
  } else {
    const factoryAsset = getAddress(await call(provider, FACTORY_INTERFACE, factoryAddress, "asset", [], finalizedBlock));
    const factoryReward = getAddress(await call(provider, FACTORY_INTERFACE, factoryAddress, "rewardToken", [], finalizedBlock));
    const vaultAsset = getAddress(await call(provider, VAULT_INTERFACE, address, "asset", [], finalizedBlock));
    const vaultReward = getAddress(await call(provider, VAULT_INTERFACE, address, "rewardToken", [], finalizedBlock));
    if (!sameAddress(factoryAsset, normalized.usdcToken) || !sameAddress(vaultAsset, normalized.usdcToken) ||
        !sameAddress(factoryReward, normalized.wldToken) || !sameAddress(vaultReward, normalized.wldToken)) fail("currency_mismatch");
    asset = normalized.usdcToken;
    rewardToken = normalized.wldToken;
    cashDecimals = await decimalsAt(provider, asset, finalizedBlock, 6, "currency_mismatch");
    await decimalsAt(provider, rewardToken, finalizedBlock, 18, "currency_mismatch");
  }

  await codeExists(provider, factoryStrategy, finalizedBlock, "strategy_unavailable");
  const strategyAsset = getAddress(await call(provider, STRATEGY_INTERFACE, factoryStrategy, "asset", [], finalizedBlock));
  if (!sameAddress(strategyAsset, asset)) fail("currency_mismatch");
  const shareDecimals = Number(await call(provider, STRATEGY_INTERFACE, factoryStrategy, "decimals", [], finalizedBlock));
  if (!Number.isInteger(shareDecimals) || shareDecimals < 0 || shareDecimals > 36) fail("strategy_unavailable");
  return {
    id: `vault-${index + 1}`,
    configuredIndex: index,
    address,
    factory: factoryAddress,
    feeRecipient: factoryFeeRecipient,
    strategy: factoryStrategy,
    kind,
    asset,
    rewardToken,
    cashDecimals,
    shareDecimals,
  };
}

function eventIdentity(log) {
  const index = log.index ?? log.logIndex;
  if (!Number.isSafeInteger(index) || index < 0 || !hashValid(log.transactionHash) || !hashValid(log.blockHash)) {
    fail("invalid_fee_log");
  }
  return `${lower(log.transactionHash)}:${index}`;
}

async function canonicalLog(provider, log, finalizedBlock, blockCache) {
  if (log.removed === true || !Number.isSafeInteger(log.blockNumber) || log.blockNumber < 0 ||
      log.blockNumber > finalizedBlock || !hashValid(log.blockHash)) return false;
  if (!blockCache.has(log.blockNumber)) {
    try { blockCache.set(log.blockNumber, await provider.getBlock(log.blockNumber)); }
    catch { blockCache.set(log.blockNumber, null); }
  }
  const block = blockCache.get(log.blockNumber);
  return Boolean(block && sameAddress(block.hash, log.blockHash));
}

function addError(report, code, sourceIndex = null, blockNumber = null) {
  report.errorCount++;
  if (report.errors.length < 200) {
    report.errors.push({ code, ...(sourceIndex === null ? {} : { source: `vault-${sourceIndex + 1}` }),
      ...(blockNumber === null ? {} : { blockNumber }) });
  }
}

function emptyFeeTotals() {
  return {
    WLD: { performanceRaw: 0n, rewardRaw: 0n },
    USDC: { performanceRaw: 0n, rewardRaw: 0n },
  };
}

function addBig(target, key, amount) { target[key] = (target[key] || 0n) + amount; }

function recordFeeEvent(report, log, vault, feeTotals, shares, sourceIndex) {
  const event = FEE_INTERFACE.parseLog(log);
  if (!event || !sameAddress(log.address, vault.address)) {
    addError(report, "unknown_fee_source", sourceIndex, log.blockNumber);
    return;
  }
  const recipient = getAddress(event.args.recipient);
  if (!sameAddress(recipient, vault.feeRecipient)) {
    addError(report, "unknown_fee_recipient", sourceIndex, log.blockNumber);
    return;
  }
  if (event.name === "RewardFeePaid" && vault.kind !== "usdc") {
    addError(report, "currency_mismatch", sourceIndex, log.blockNumber);
    return;
  }
  const currency = event.name === "RewardFeePaid" ? "WLD" : vault.kind === "wld" ? "WLD" : "USDC";
  if (event.name === "RewardFeePaid") {
    addBig(feeTotals[currency], "rewardRaw", bigint(event.args.amount));
  } else {
    addBig(feeTotals[currency], "performanceRaw", bigint(event.args.assets));
    const shareRaw = bigint(event.args.shares);
    const key = lower(vault.strategy);
    if (!shares.has(key)) shares.set(key, {
      strategy: vault.strategy,
      asset: vault.asset,
      kind: vault.kind,
      decimals: vault.shareDecimals,
      raw: 0n,
    });
    addBig(shares.get(key), "raw", shareRaw);
  }
  report.feeEventCount++;
}

async function readFeeLogs(provider, vaults, fromBlock, toBlock, finalizedBlock, report, pageSize) {
  const totals = emptyFeeTotals();
  const shares = new Map();
  const seen = new Map();
  const blockCache = new Map();
  const feeTopics = [
    FEE_INTERFACE.getEvent("PerformanceFeePaid").topicHash,
    FEE_INTERFACE.getEvent("RewardFeePaid").topicHash,
  ];
  for (const vault of vaults) {
    const sourceIndex = vault.configuredIndex;
    for (let start = fromBlock; start <= toBlock; start += pageSize) {
      const end = Math.min(toBlock, start + pageSize - 1);
      let logs;
      try {
        logs = await provider.getLogs({ address: vault.address, fromBlock: start, toBlock: end, topics: [feeTopics] });
      } catch {
        addError(report, "fee_log_query_failed", sourceIndex);
        continue;
      }
      for (const log of logs) {
        try {
          if (!Number.isSafeInteger(log.blockNumber) || log.blockNumber < start || log.blockNumber > end) {
            fail("fee_log_outside_requested_page");
          }
          const identity = eventIdentity(log);
          if (seen.has(identity)) {
            if (sameAddress(seen.get(identity), log.blockHash)) report.duplicateLogsSkipped++;
            else addError(report, "reorg_detected", sourceIndex, log.blockNumber);
            continue;
          }
          seen.set(identity, log.blockHash);
          if (!await canonicalLog(provider, log, finalizedBlock, blockCache)) {
            addError(report, "noncanonical_or_unfinalized_log", sourceIndex, log.blockNumber);
            continue;
          }
          recordFeeEvent(report, log, vault, totals, shares, sourceIndex);
        } catch (error) {
          addError(report, error instanceof OpsReportError ? error.code : "invalid_fee_log", sourceIndex,
            Number.isSafeInteger(log.blockNumber) ? log.blockNumber : null);
        }
      }
    }
  }
  return { totals, shares };
}

function decimalOutput(raw, decimals) {
  return { raw: raw.toString(), amount: formatAmount(raw, decimals), decimals };
}

function buildFeeOutput(totals, shares) {
  const cashFees = {};
  for (const currency of ["WLD", "USDC"]) {
    const decimals = currency === "WLD" ? 18 : 6;
    const performance = totals[currency].performanceRaw;
    const reward = totals[currency].rewardRaw;
    cashFees[currency] = {
      performanceAssetFee: decimalOutput(performance, decimals),
      rewardFee: decimalOutput(reward, decimals),
      totalCashFee: decimalOutput(performance + reward, decimals),
    };
  }
  const receiptShareFees = [...shares.values()].map((entry) => ({
    strategy: entry.strategy,
    underlyingAsset: entry.asset,
    strategyKind: entry.kind,
    ...decimalOutput(entry.raw, entry.decimals),
    valuation: "not-cash; receipt shares reported separately",
  }));
  return { cashFees, receiptShareFees };
}

async function collectOperatorExpenses(provider, normalized, finalizedBlock, report) {
  const hashes = normalized.operatorTxHashes;
  const expenses = [];
  let gasWei = 0n;
  let l1Wei = 0n;
  let operatorWei = 0n;
  let gasKnownCount = 0;
  let l1KnownCount = 0;
  let operatorKnownCount = 0;
  let complete = true;
  const canonicalBlocks = new Map();
  for (let index = 0; index < hashes.length; index++) {
    const hash = hashes[index];
    try {
      const receiptRequest = typeof provider.send === "function"
        ? provider.send("eth_getTransactionReceipt", [hash])
        : provider.getTransactionReceipt(hash);
      const [transaction, rawReceipt] = await Promise.all([
        provider.getTransaction(hash),
        receiptRequest,
      ]);
      if (!transaction || !rawReceipt) {
        addError(report, "operator_receipt_unavailable");
        complete = false;
        expenses.push({ reference: `operator-tx-${index + 1}`, status: "unknown", complete: false });
        continue;
      }
      const receiptHash = rawReceipt.transactionHash ?? rawReceipt.hash;
      if (!hashValid(transaction.hash) || !hashValid(receiptHash) ||
          !sameAddress(transaction.hash, hash) || !sameAddress(receiptHash, hash)) {
        addError(report, "operator_receipt_mismatch");
        complete = false;
        expenses.push({ reference: `operator-tx-${index + 1}`, status: "unknown", complete: false });
        continue;
      }
      const receipt = {
        ...rawReceipt,
        hash: receiptHash,
        blockNumber: Number(rpcQuantity(rawReceipt.blockNumber)),
        status: rawReceipt.status == null ? null : Number(rpcQuantity(rawReceipt.status)),
        gasUsed: rawReceipt.gasUsed == null ? null : rpcQuantity(rawReceipt.gasUsed),
        effectiveGasPrice: rawReceipt.effectiveGasPrice == null
          ? rawReceipt.gasPrice == null ? null : rpcQuantity(rawReceipt.gasPrice)
          : rpcQuantity(rawReceipt.effectiveGasPrice),
        l1Fee: rawReceipt.l1Fee == null ? null : rpcQuantity(rawReceipt.l1Fee),
        operatorFee: rawReceipt.operatorFee == null ? null : rpcQuantity(rawReceipt.operatorFee),
        operatorFeeScalar: rawReceipt.operatorFeeScalar == null ? null : rpcQuantity(rawReceipt.operatorFeeScalar),
        operatorFeeConstant: rawReceipt.operatorFeeConstant == null ? null : rpcQuantity(rawReceipt.operatorFeeConstant),
      };
      if (!normalized.operators.has(lower(transaction.from))) {
        addError(report, "unknown_operator_source");
        complete = false;
        expenses.push({ reference: `operator-tx-${index + 1}`, status: "unknown", complete: false });
        continue;
      }
      if (transaction.chainId != null && bigint(transaction.chainId).toString() !== String(CHAIN_ID)) {
        addError(report, "chain_must_be_480");
        complete = false;
        expenses.push({ reference: `operator-tx-${index + 1}`, status: "unknown", complete: false });
        continue;
      }
      if (!Number.isSafeInteger(receipt.blockNumber) || receipt.blockNumber < normalized.fromBlock ||
          receipt.blockNumber > normalized.toBlock || receipt.blockNumber > finalizedBlock) {
        addError(report, "operator_receipt_outside_finalized_coverage");
        complete = false;
        expenses.push({ reference: `operator-tx-${index + 1}`, status: "unknown", complete: false });
        continue;
      }
      if (!canonicalBlocks.has(receipt.blockNumber)) {
        try { canonicalBlocks.set(receipt.blockNumber, await provider.getBlock(receipt.blockNumber)); }
        catch { canonicalBlocks.set(receipt.blockNumber, null); }
      }
      const canonical = canonicalBlocks.get(receipt.blockNumber);
      if (!canonical || !hashValid(receipt.blockHash) || !sameAddress(canonical.hash, receipt.blockHash)) {
        addError(report, "reorg_detected", null, receipt.blockNumber);
        complete = false;
        expenses.push({ reference: `operator-tx-${index + 1}`, status: "unknown", complete: false });
        continue;
      }
      if (receipt.status !== 0 && receipt.status !== 1 && receipt.status !== 0n && receipt.status !== 1n) {
        addError(report, "operator_receipt_status_unknown");
        complete = false;
        expenses.push({ reference: `operator-tx-${index + 1}`, status: "unknown", complete: false });
        continue;
      }
      if (receipt.gasUsed == null || receipt.effectiveGasPrice == null) {
        addError(report, "operator_gas_cost_unavailable");
        complete = false;
        expenses.push({ reference: `operator-tx-${index + 1}`, status: receipt.status === 0 || receipt.status === 0n ? "reverted" : "success", complete: false });
        continue;
      }
      const transactionGasWei = receipt.gasUsed * receipt.effectiveGasPrice;
      gasWei += transactionGasWei;
      gasKnownCount++;

      let transactionL1Wei = null;
      if (receipt.l1Fee != null) transactionL1Wei = bigint(receipt.l1Fee);
      else {
        addError(report, "l1_fee_unavailable");
        complete = false;
      }

      let transactionOperatorWei = null;
      if (receipt.operatorFee != null) transactionOperatorWei = bigint(receipt.operatorFee);
      else if (receipt.operatorFeeScalar != null && receipt.operatorFeeConstant != null) {
        const scalar = bigint(receipt.operatorFeeScalar);
        const constant = bigint(receipt.operatorFeeConstant);
        if (scalar === 0n && constant === 0n) transactionOperatorWei = 0n;
        else {
          try {
            const encoded = await provider.call({
              to: ORACLE_ADDRESS,
              data: ORACLE_INTERFACE.encodeFunctionData("getOperatorFee", [receipt.gasUsed]),
              blockTag: receipt.blockNumber,
            });
            transactionOperatorWei = BigInt(ORACLE_INTERFACE.decodeFunctionResult("getOperatorFee", encoded)[0]);
          } catch {
            addError(report, "operator_fee_unavailable");
            complete = false;
          }
        }
      } else {
        addError(report, "operator_fee_unavailable");
        complete = false;
      }
      if (transactionL1Wei !== null) { l1Wei += transactionL1Wei; l1KnownCount++; }
      if (transactionOperatorWei !== null) { operatorWei += transactionOperatorWei; operatorKnownCount++; }
      const itemComplete = transactionL1Wei !== null && transactionOperatorWei !== null;
      if (!itemComplete) complete = false;
      expenses.push({
        reference: `operator-tx-${index + 1}`,
        status: receipt.status === 0 || receipt.status === 0n ? "reverted" : "success",
        blockNumber: receipt.blockNumber,
        gasCostWei: transactionGasWei.toString(),
        l1FeeWei: transactionL1Wei?.toString() ?? null,
        operatorFeeWei: transactionOperatorWei?.toString() ?? null,
        totalCostWei: itemComplete ? (transactionGasWei + transactionL1Wei + transactionOperatorWei).toString() : null,
        complete: itemComplete,
      });
    } catch (error) {
      addError(report, error instanceof OpsReportError ? error.code : "operator_receipt_unavailable");
      complete = false;
      expenses.push({ reference: `operator-tx-${index + 1}`, status: "unknown", complete: false });
    }
  }
  const completeForReceipts = complete && normalized.operatorTxHashes.length === expenses.length;
  const exhaustiveReceiptSet = normalized.config.operatorTransactionSetComplete === true;
  const allOperatingExpensesKnown = completeForReceipts && exhaustiveReceiptSet;
  const submittedReceiptsTotalWei = completeForReceipts && (hashes.length > 0 || exhaustiveReceiptSet)
    ? (gasWei + l1Wei + operatorWei).toString() : null;
  return {
    receiptScope: "explicit operator transaction hashes only",
    operatorTransactions: expenses,
    duplicateHashesSkipped: normalized.duplicateOperatorTxHashes,
    knownGasWei: hashes.length > 0 && gasKnownCount === hashes.length ? gasWei.toString() : null,
    knownL1FeeWei: hashes.length > 0 && l1KnownCount === hashes.length ? l1Wei.toString() : null,
    knownOperatorFeeWei: hashes.length > 0 && operatorKnownCount === hashes.length ? operatorWei.toString() : null,
    submittedReceiptsTotalWei,
    totalWei: allOperatingExpensesKnown ? submittedReceiptsTotalWei : null,
    receiptFeesComplete: completeForReceipts,
    operatorTransactionSetComplete: normalized.config.operatorTransactionSetComplete === true,
    allOperatingExpensesKnown,
  };
}

function validMonth(value) {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

async function calculateNetEstimate(provider, normalized, finalizedBlock, feeResult, expenses, report) {
  const config = normalized.config;
  const fx = config.fxMarksUsdPerToken;
  const markAtMs = dateMillis(config.fxMarkAt);
  const marks = fx && typeof fx === "object" ? {
    WLD: parseDecimal18(fx.WLD),
    USDC: parseDecimal18(fx.USDC),
    ETH: parseDecimal18(fx.ETH),
  } : { WLD: null, USDC: null, ETH: null };
  const missing = [];
  for (const currency of ["WLD", "USDC", "ETH"]) if (marks[currency] === null || marks[currency] === 0n) missing.push(`fx_${currency.toLowerCase()}`);
  if (markAtMs === null) missing.push("fx_mark_timestamp");
  if (typeof config.monthlyServerCostUsd !== "string" || parseDecimal18(config.monthlyServerCostUsd) === null) missing.push("monthly_server_cost");
  if (!validMonth(config.serverCostMonth)) missing.push("server_cost_month");
  if (!expenses.operatorTransactionSetComplete) missing.push("operator_transaction_coverage");
  if (!expenses.receiptFeesComplete) missing.push("complete_operator_receipt_fees");
  if (report.errorCount > 0) missing.push("complete_chain_evidence");

  const feeShares = [];
  if (Object.values(marks).every((value) => value !== null && value > 0n)) {
    for (const share of feeResult.shares.values()) {
      try {
        const raw = await call(provider, STRATEGY_INTERFACE, share.strategy, "convertToAssets", [share.raw], normalized.toBlock);
        feeShares.push({
          strategy: share.strategy,
          asset: share.asset,
          raw: bigint(raw).toString(),
          decimals: share.kind === "wld" ? 18 : 6,
        });
      } catch {
        addError(report, "share_fee_mark_unavailable");
        missing.push("receipt_share_mark");
      }
    }
  }

  const fromBlock = await provider.getBlock(normalized.fromBlock).catch(() => null);
  const toBlock = await provider.getBlock(normalized.toBlock).catch(() => null);
  const monthStart = validMonth(config.serverCostMonth) ? Date.parse(`${config.serverCostMonth}-01T00:00:00.000Z`) : null;
  const nextMonth = validMonth(config.serverCostMonth)
    ? new Date(Date.UTC(Number(config.serverCostMonth.slice(0, 4)), Number(config.serverCostMonth.slice(5, 7)), 1)).getTime()
    : null;
  const monthCovered = Boolean(fromBlock && toBlock && monthStart !== null && nextMonth !== null &&
    fromBlock.timestamp * 1000 <= monthStart && toBlock.timestamp * 1000 >= nextMonth);
  if (validMonth(config.serverCostMonth) && !monthCovered) missing.push("complete_server_cost_month_coverage");

  const cashUsd = { WLD: null, USDC: null };
  for (const currency of ["WLD", "USDC"]) {
    const raw = feeResult.totals[currency].performanceRaw + feeResult.totals[currency].rewardRaw;
    const decimals = currency === "WLD" ? 18 : 6;
    if (marks[currency] !== null) cashUsd[currency] = raw * marks[currency] / (10n ** BigInt(decimals));
  }
  let shareUsd = feeResult.shares.size === 0 ? 0n : null;
  if (feeShares.length === feeResult.shares.size) {
    shareUsd = 0n;
    for (const share of feeShares) {
      const currency = sameAddress(share.asset, normalized.wldToken) ? "WLD" : "USDC";
      shareUsd += BigInt(share.raw) * marks[currency] / (10n ** BigInt(share.decimals));
    }
  }
  const cashFeeIncomeUsd = cashUsd.WLD === null || cashUsd.USDC === null ? null : cashUsd.WLD + cashUsd.USDC;
  const expenseUsd = expenses.totalWei === null || marks.ETH === null
    ? null : BigInt(expenses.totalWei) * marks.ETH / 10n ** 18n;
  const serverUsd = typeof config.monthlyServerCostUsd === "string" ? parseDecimal18(config.monthlyServerCostUsd) : null;
  if (expenses.totalWei === null || expenseUsd === null) missing.push("known_expense_total");
  if (feeResult.shares.size && feeShares.length !== feeResult.shares.size) missing.push("receipt_share_mark");
  const uniqueMissing = [...new Set(missing)];
  if (cashFeeIncomeUsd === null) uniqueMissing.push("fee_income_fx");
  if (shareUsd === null) uniqueMissing.push("receipt_share_mark");
  const finalMissing = [...new Set(uniqueMissing)];
  const available = finalMissing.length === 0;
  const net = available ? cashFeeIncomeUsd + shareUsd - expenseUsd - serverUsd : null;
  report.estimatedShareFeeValues = feeShares.map((entry) => ({
    strategy: entry.strategy,
    underlyingAsset: entry.asset,
    amount: formatAmount(BigInt(entry.raw), entry.decimals),
    decimals: entry.decimals,
    valuation: "estimated at report end block; not cash",
  }));
  return {
    status: available ? "available_estimate" : "unavailable",
    currency: "USD",
    amount: net === null ? null : formatUsd18(net),
    scope: available ? `estimate for explicit block range; includes server cost for ${config.serverCostMonth}` : null,
    fxMarkAt: markAtMs === null ? null : new Date(markAtMs).toISOString(),
    serverCostMonth: validMonth(config.serverCostMonth) ? config.serverCostMonth : null,
    fxMarksUsdPerToken: Object.fromEntries(["WLD", "USDC", "ETH"].map((currency) => [
      currency, marks[currency] === null ? null : formatUsd18(marks[currency]),
    ])),
    cashFeeIncomeUsd: cashFeeIncomeUsd === null ? null : formatUsd18(cashFeeIncomeUsd),
    receiptShareFeeMarkUsd: shareUsd === null ? null : formatUsd18(shareUsd),
    explicitOperatorReceiptCostUsd: expenseUsd === null ? null : formatUsd18(expenseUsd),
    monthlyServerCostUsd: serverUsd === null ? null : formatUsd18(serverUsd),
    missing: finalMissing,
  };
}

export async function buildOpsReport({ config, fromBlock, toBlock, operatorTxHashes = [], provider }) {
  const normalized = validateInputs({ config, fromBlock, toBlock, operatorTxHashes });
  if (!provider) fail("provider_required");
  const report = {
    schemaVersion: 1,
    chainId: CHAIN_ID,
    status: "incomplete",
    coverage: {
      fromBlock: normalized.fromBlock,
      toBlock: normalized.toBlock,
      logPageSize: normalized.logPageSize,
      finalizedBlock: null,
      fromBlockTimestamp: null,
      toBlockTimestamp: null,
      scope: "explicit block range only; not lifetime completeness",
      complete: false,
      monthComplete: false,
    },
    configuredVaultCount: normalized.vaults.length,
    validatedVaults: [],
    feeIncomeBasis: "vault PerformanceFeePaid and RewardFeePaid events only; principal transfers excluded",
    feeEventCount: 0,
    duplicateLogsSkipped: 0,
    errors: [],
    errorCount: 0,
    fees: null,
    expenses: null,
    netPnlEstimate: null,
  };

  let observedChainId;
  try { observedChainId = BigInt(await provider.send("eth_chainId", [])); }
  catch { addError(report, "chain_unavailable"); return finalizeReport(report); }
  if (observedChainId !== BigInt(CHAIN_ID)) {
    addError(report, "chain_must_be_480");
    return finalizeReport(report);
  }
  let finalBlock;
  try { finalBlock = await provider.getBlock("finalized"); }
  catch { finalBlock = null; }
  if (!finalBlock || !Number.isSafeInteger(finalBlock.number)) {
    addError(report, "finality_unavailable");
    return finalizeReport(report);
  }
  report.coverage.finalizedBlock = finalBlock.number;
  if (normalized.toBlock > finalBlock.number) {
    addError(report, "range_not_finalized");
    return finalizeReport(report);
  }

  if (normalized.vaults.length === 0) addError(report, "fee_vault_coverage_not_configured");
  const vaults = [];
  for (let index = 0; index < normalized.vaults.length; index++) {
    try {
      const vault = await validateVault(provider, normalized.vaults[index], index, normalized, finalBlock.number);
      vaults.push(vault);
      report.validatedVaults.push({
        id: vault.id,
        address: vault.address,
        factory: vault.factory,
        strategy: vault.strategy,
        feeRecipient: vault.feeRecipient,
        kind: vault.kind,
      });
    } catch (error) {
      addError(report, error instanceof OpsReportError ? error.code : "vault_validation_failed", index);
    }
  }

  const feeResult = await readFeeLogs(provider, vaults, normalized.fromBlock, normalized.toBlock, finalBlock.number, report, normalized.logPageSize);
  report.fees = normalized.vaults.length ? buildFeeOutput(feeResult.totals, feeResult.shares) : null;
  report.expenses = await collectOperatorExpenses(provider, normalized, finalBlock.number, report);
  report.netPnlEstimate = await calculateNetEstimate(provider, normalized, finalBlock.number, feeResult, report.expenses, report);

  try {
    const from = await provider.getBlock(normalized.fromBlock);
    const to = await provider.getBlock(normalized.toBlock);
    report.coverage.fromBlockTimestamp = Number.isSafeInteger(from?.timestamp) ? from.timestamp : null;
    report.coverage.toBlockTimestamp = Number.isSafeInteger(to?.timestamp) ? to.timestamp : null;
    const serverMonth = config.serverCostMonth;
    if (validMonth(serverMonth) && report.coverage.fromBlockTimestamp !== null && report.coverage.toBlockTimestamp !== null) {
      const start = Date.parse(`${serverMonth}-01T00:00:00.000Z`) / 1000;
      const end = Date.UTC(Number(serverMonth.slice(0, 4)), Number(serverMonth.slice(5, 7)), 1) / 1000;
      report.coverage.monthComplete = report.coverage.fromBlockTimestamp <= start && report.coverage.toBlockTimestamp >= end;
    }
  } catch {
    addError(report, "coverage_timestamp_unavailable");
  }
  return finalizeReport(report);
}

function finalizeReport(report) {
  if (report.errorCount > 0 && report.netPnlEstimate?.status === "available_estimate") {
    report.netPnlEstimate.status = "unavailable";
    report.netPnlEstimate.amount = null;
    report.netPnlEstimate.scope = null;
    report.netPnlEstimate.missing = [...new Set([...(report.netPnlEstimate.missing || []), "complete_chain_evidence"])]
      .sort();
  }
  report.coverage.complete = report.errorCount === 0 && report.validatedVaults.length === report.configuredVaultCount;
  report.status = report.coverage.complete ? "complete" : "incomplete";
  return report;
}

export function renderHtmlReport(report) {
  const json = JSON.stringify(report, null, 2);
  const escape = (text) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Inheritance operations report</title><style>
body{font:16px/1.5 system-ui,sans-serif;max-width:980px;margin:2rem auto;padding:0 1rem;color:#18212b;background:#f7f9fb}h1{font-size:1.7rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#fff;border:1px solid #d8e0e8;border-radius:8px;padding:1rem}.status{font-weight:700}
</style></head><body><h1>Inheritance realized fees and expenses</h1>
<p class="status">Collection status: ${escape(report.status)}</p>
<p>Coverage: blocks ${escape(report.coverage.fromBlock)}–${escape(report.coverage.toBlock)}; finalized through ${escape(report.coverage.finalizedBlock ?? "unavailable")}.</p>
<p>Amounts are exact token units unless explicitly labeled as a USD estimate. Receipt shares remain separate from cash fees.</p>
<pre>${escape(json)}</pre></body></html>`;
}

function parseArgs(argv) {
  const args = { operatorTxHashes: [] };
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!["--config", "--from-block", "--to-block", "--operator-tx", "--tx", "--html", "--json"].includes(key)) {
      fail("invalid_cli_arguments");
    }
    const value = argv[++index];
    if (!value || value.startsWith("--")) fail("invalid_cli_arguments");
    switch (key) {
      case "--operator-tx":
      case "--tx": args.operatorTxHashes.push(value); break;
      case "--config":
      case "--from-block":
      case "--to-block":
      case "--html":
      case "--json": args[key.slice(2).replaceAll("-", "")] = value; break;
      default: fail("invalid_cli_arguments");
    }
  }
  if (!args.config || args.fromblock == null || args.toblock == null) fail("invalid_cli_arguments");
  const fromBlock = Number(args.fromblock);
  const toBlock = Number(args.toblock);
  if (!Number.isSafeInteger(fromBlock) || !Number.isSafeInteger(toBlock)) fail("invalid_cli_arguments");
  return { ...args, fromBlock, toBlock };
}

async function main() {
  let provider;
  try {
    const args = parseArgs(process.argv.slice(2));
    const configText = await readFile(resolve(args.config), "utf8");
    const config = JSON.parse(configText);
    const rpcUrl = process.env.OPS_REPORT_RPC_URL || process.env.RPC_URL;
    if (typeof rpcUrl !== "string" || !rpcUrl.trim()) fail("rpc_url_not_configured");
    provider = new JsonRpcProvider(rpcUrl, CHAIN_ID, { staticNetwork: true, batchMaxCount: 1 });
    const report = await buildOpsReport({
      config,
      fromBlock: args.fromBlock,
      toBlock: args.toBlock,
      operatorTxHashes: args.operatorTxHashes,
      provider,
    });
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (args.json) await writeFile(resolve(args.json), json, "utf8");
    if (args.html) await writeFile(resolve(args.html), renderHtmlReport(report), "utf8");
    if (!args.json) process.stdout.write(json);
    if (report.status !== "complete") process.exitCode = 2;
  } catch (error) {
    const code = error instanceof OpsReportError ? error.code : "report_failed";
    process.stderr.write(`ops-report: ${code}\n`);
    process.exitCode = 1;
  } finally {
    try { provider?.destroy(); } catch { /* omit provider error details */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
