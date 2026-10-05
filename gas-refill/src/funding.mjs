import { Contract, FetchRequest, Interface, JsonRpcProvider, Transaction, Wallet, getAddress, keccak256 } from "ethers";
import { isExecutionRevert } from "./rpc-errors.mjs";
import { FUNDING_DEPLOYMENT } from "./deployment.mjs";

export const IDENTITIES = Object.freeze({ chainId: 480, rpcUrl: "https://worldchain-mainnet.g.alchemy.com/public",
  treasury: "0x93bC44B8296977Feb479F95855D9b9E051C17dA2", keeper: "0x8C31Bbc49C371d431f884aB18Ba5aA25B0D9170b",
  bot: "0x20A85A9e929C69A440938eb650d70619b7562eD5",
  usdc: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1", wld: "0x2cFc85d8E48F8EAB294be644d9E25C3030863003",
  usdcStrategy: "0xb1E80387EbE53Ff75a89736097D34dC8D9E9045B", wldStrategy: "0x348831b46876d3dF2Db98BdEc5E3B4083329Ab9f" });
export const FUNDING_ABI = [
  "function treasury() view returns(address)", "function keeper() view returns(address)", "function bot() view returns(address)",
  "function quote(uint8) view returns(uint256 inputMax,uint256 costUSDC,uint256 keeperETH,uint256 botETH)",
  "function needed() view returns(uint256 keeperETH,uint256 botETH)", "function remainingBudget() view returns(uint256)",
  "function paused() view returns(bool)", "function refill(uint8 route,bool receiptSource,uint256 deadline) returns(uint256 input)",
  "event Funded(uint8 indexed route,bool receiptSource,uint256 input,uint256 costUSDC,uint256 keeperETH,uint256 botETH)",
];
const TOKEN_ABI = ["function balanceOf(address) view returns(uint256)", "function allowance(address,address) view returns(uint256)",
  "function previewWithdraw(uint256) view returns(uint256)", "function convertToAssets(uint256) view returns(uint256)"];
const ORACLE = "0x420000000000000000000000000000000000000F";
const ORACLE_ABI = ["function getL1Fee(bytes) view returns(uint256)", "function getOperatorFee(uint256) view returns(uint256)"];
const INTERFACE = new Interface(FUNDING_ABI);
const GAS_LIMIT_MAX = 1_500_000n;
const GAS_PRICE_MAX = 50_000_000n;
const LEASE_MS = 120_000;
const MAX_OUTPUT = 1_100_000_000_000_000n;
const PUBLIC = new Set(["disabled", "not_configured", "invalid_configuration", "locked", "healthy", "paused",
  "wrong_chain", "wrong_contract", "legacy_job_pending", "deployment_transition_pending", "awaiting_fees", "allowance_missing", "quote_unavailable", "budget_exhausted", "uneconomic",
  "insufficient_bot_gas", "fee_cap", "gas_cap", "pending", "awaiting_finality", "finality_unavailable",
  "funded", "transaction_reverted", "recovery_invalid", "nonce_conflict", "nonce_consumed", "receipt_mismatch",
  "rpc_unavailable", "storage_unavailable", "simulation_failed", "not_running"]);
const reasonOf = (v) => PUBLIC.has(v) ? v : "rpc_unavailable";
const fail = (v) => { throw new Error(v); };
const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const changed = (r) => Number(r?.meta?.changes || 0) === 1;
const schemas = [
  `CREATE TABLE IF NOT EXISTS gas_funding_locks(scope TEXT PRIMARY KEY,lease_token TEXT NOT NULL,lease_until INTEGER NOT NULL,last_cycle_at TEXT,last_cycle_reason TEXT)`,
  `CREATE TABLE IF NOT EXISTS gas_funding_jobs(job_id TEXT PRIMARY KEY,scope TEXT NOT NULL,state TEXT NOT NULL,route INTEGER NOT NULL,receipt_source INTEGER NOT NULL,tx_hash TEXT NOT NULL UNIQUE,tx_raw TEXT NOT NULL,nonce INTEGER NOT NULL,deadline INTEGER NOT NULL,gas_limit TEXT NOT NULL,gas_price TEXT NOT NULL,reserved_wei TEXT NOT NULL,output_wei TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,receipt_block_number TEXT,receipt_block_hash TEXT,gas_spent TEXT,cost_usdc TEXT,last_error TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS gas_funding_one_pending ON gas_funding_jobs(scope) WHERE state IN ('pending','blocked')`,
];

function config(env, testing) {
  if (env.GAS_REFILL_ENABLED !== "true") return { enabled: false, reason: "disabled" };
  if (!env.GAS_REFILL_PRIVATE_KEY || !env.DB) return { enabled: false, reason: "not_configured" };
  try {
    const identity = testing ? { ...IDENTITIES, ...testing.identities } : IDENTITIES;
    const deployment = testing?.deployment || FUNDING_DEPLOYMENT;
    if (!deployment.address || !deployment.codeHash) return { enabled: false, reason: "not_configured" };
    const address = getAddress(deployment.address), wallet = new Wallet(env.GAS_REFILL_PRIVATE_KEY);
    if (!eq(wallet.address, identity.bot) || eq(wallet.address, identity.treasury) || eq(wallet.address, identity.keeper)) fail("invalid_configuration");
    const rpc = new URL(identity.rpcUrl);
    if (rpc.protocol !== "https:" && !(testing && rpc.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(rpc.hostname))) fail("invalid_configuration");
    const request = new FetchRequest(rpc.href);
    request.timeout = 8000;
    const provider = new JsonRpcProvider(request, identity.chainId, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 });
    return { enabled: true, ...identity, address, codeHash: deployment.codeHash, wallet, provider, db: env.DB,
      contract: new Contract(address, FUNDING_ABI, provider), now: testing?.now || Date.now,
      hooks: testing?.hooks || {}, scope: identity.chainId + ":" + wallet.address.toLowerCase() };
  } catch { return { enabled: false, reason: "invalid_configuration" }; }
}

const GUARD = "EXISTS(SELECT 1 FROM gas_funding_locks WHERE scope=? AND lease_token=? AND lease_until>?)";
function update(cfg, token, sql, values) { return cfg.db.prepare(sql + " AND " + GUARD).bind(...values, cfg.scope, token, cfg.now()); }
async function renew(cfg, token) {
  const r = await cfg.db.prepare("UPDATE gas_funding_locks SET lease_until=? WHERE scope=? AND lease_token=? AND lease_until>?")
    .bind(cfg.now() + LEASE_MS, cfg.scope, token, cfg.now()).run();
  if (!changed(r)) fail("locked");
}
async function extraFee(cfg, tx) {
  if (cfg.chainId !== 480) return 0n;
  const oracle = new Contract(ORACLE, ORACLE_ABI, cfg.provider);
  const l1 = BigInt(await oracle.getL1Fee(tx.unsignedSerialized));
  let operator = 0n;
  try { operator = BigInt(await oracle.getOperatorFee(tx.gasLimit)); }
  catch (error) { if (!isExecutionRevert(error)) throw error; }
  return l1 + operator;
}
async function validateContract(cfg) {
  // The pinned runtime hash includes all constructor identities. Dynamic EOA
  // checks also execute inside refill; redundant reads waste Worker subrequests.
  const [chain, code] = await Promise.all([
    cfg.provider.send("eth_chainId", []), cfg.provider.getCode(cfg.address),
  ]);
  if (Number(BigInt(chain)) !== cfg.chainId) fail("wrong_chain");
  if (code === "0x" || keccak256(code) !== cfg.codeHash) fail("wrong_contract");
}

function rawTransaction(cfg, row) {
  try {
    const tx = Transaction.from(row.tx_raw);
    if (!tx.isSigned() || !eq(tx.from, cfg.bot) || !eq(tx.to, cfg.address) || tx.chainId !== BigInt(cfg.chainId)
      || tx.type !== 0 || tx.value !== 0n || tx.hash !== row.tx_hash || keccak256(row.tx_raw) !== row.tx_hash
      || tx.nonce !== Number(row.nonce) || !Number.isSafeInteger(tx.nonce) || tx.nonce < 0
      || tx.gasLimit <= 0n || tx.gasLimit > GAS_LIMIT_MAX || tx.gasLimit !== BigInt(row.gas_limit)
      || tx.gasPrice <= 0n || tx.gasPrice > GAS_PRICE_MAX || tx.gasPrice !== BigInt(row.gas_price)
      || Number(row.route) < 0 || Number(row.route) > 2 || ![0, 1].includes(Number(row.receipt_source))
      || BigInt(row.output_wei) <= 0n || BigInt(row.output_wei) > MAX_OUTPUT
      || Number(row.deadline) <= Math.floor(Number(row.created_at) / 1000)
      || Number(row.deadline) > Math.floor(Number(row.created_at) / 1000) + 300
      || tx.data !== INTERFACE.encodeFunctionData("refill", [Number(row.route), Number(row.receipt_source) === 1, row.deadline])
      || BigInt(row.reserved_wei) < tx.gasLimit * tx.gasPrice) fail("recovery_invalid");
    return tx;
  } catch { fail("recovery_invalid"); }
}

async function blockJob(cfg, token, row, reason) {
  await renew(cfg, token);
  await update(cfg, token, "UPDATE gas_funding_jobs SET state='blocked',last_error=?,updated_at=? WHERE job_id=? AND state='pending'",
    [reason, cfg.now(), row.job_id]).run();
  return { reason };
}

async function reconcile(cfg, token, row) {
  let tx;
  try { tx = rawTransaction(cfg, row); } catch { return blockJob(cfg, token, row, "recovery_invalid"); }
  let receipt;
  try { receipt = await cfg.provider.send("eth_getTransactionReceipt", [row.tx_hash]); }
  catch { return { reason: "pending" }; }
  if (receipt) {
    if (!eq(receipt.transactionHash, row.tx_hash) || !eq(receipt.to, cfg.address) || !eq(receipt.from, cfg.bot)
      || !/^0x[\da-f]{64}$/i.test(receipt.blockHash || "")) return { reason: "receipt_mismatch" };
    const canonical = await cfg.provider.send("eth_getBlockByNumber", [receipt.blockNumber, false]);
    if (canonical?.hash === receipt.blockHash) {
      const finalized = await cfg.provider.send("eth_getBlockByNumber", ["finalized", false]);
      if (!finalized) return { reason: "finality_unavailable" };
      if (BigInt(finalized.number) < BigInt(receipt.blockNumber)) return { reason: "awaiting_finality" };
      const status = BigInt(receipt.status);
      if (![0n, 1n].includes(status) || receipt.effectiveGasPrice == null || BigInt(receipt.gasUsed) > tx.gasLimit)
        return blockJob(cfg, token, row, "receipt_mismatch");
      const events = receipt.logs.filter(log => eq(log.address, cfg.address)).map(log => {
        try { return INTERFACE.parseLog(log); } catch { return null; }
      }).filter(event => event?.name === "Funded");
      const event = events.length === 1 ? events[0] : null;
      if (status === 1n && (!event || Number(event.args.route) !== Number(row.route)
        || event.args.receiptSource !== (Number(row.receipt_source) === 1)
        || event.args.input <= 0n || event.args.costUSDC <= 0n || event.args.keeperETH + event.args.botETH <= 0n
        || event.args.keeperETH + event.args.botETH > MAX_OUTPUT)) return blockJob(cfg, token, row, "receipt_mismatch");
      let gasCost = BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice);
      // Account for actual OP execution charges. Optional extensions absent = no charge.
      if (cfg.chainId === 480) {
        const oracle = new Contract(ORACLE, ORACLE_ABI, cfg.provider);
        gasCost += receipt.l1Fee != null ? BigInt(receipt.l1Fee)
          : BigInt(await oracle.getL1Fee(tx.unsignedSerialized, { blockTag: receipt.blockNumber }));
        if (receipt.operatorFee != null) gasCost += BigInt(receipt.operatorFee);
        else if (BigInt(receipt.operatorFeeScalar || 0) !== 0n || BigInt(receipt.operatorFeeConstant || 0) !== 0n)
          gasCost += BigInt(await oracle.getOperatorFee(BigInt(receipt.gasUsed), { blockTag: receipt.blockNumber }));
      }
      // Check again after finality/fee lookups; never complete an orphaned receipt.
      const latestCanonical = await cfg.provider.send("eth_getBlockByNumber", [receipt.blockNumber, false]);
      if (latestCanonical?.hash !== receipt.blockHash) return { reason: "pending" };
      await renew(cfg, token);
      const r = await update(cfg, token, "UPDATE gas_funding_jobs SET state=?,receipt_block_number=?,receipt_block_hash=?,gas_spent=?,cost_usdc=?,last_error=?,updated_at=? WHERE job_id=? AND state='pending'",
        [status === 1n ? "completed" : "failed", String(receipt.blockNumber), receipt.blockHash, gasCost.toString(),
          event?.args.costUSDC.toString() || "0", status === 1n ? "funded" : "transaction_reverted", cfg.now(), row.job_id]).run();
      if (!changed(r)) fail("locked");
      return { reason: status === 1n ? "funded" : "transaction_reverted" };
    }
  }
  // Unknown receipt/network errors never authorize a new signature or nonce.
  const known = await cfg.provider.send("eth_getTransactionByHash", [row.tx_hash]);
  if (known) {
    if (!known.blockHash || !known.blockNumber) return { reason: "pending" };
    const block = await cfg.provider.send("eth_getBlockByNumber", [known.blockNumber, false]);
    if (block?.hash === known.blockHash) return { reason: "pending" };
  }
  const [latest, pending, balance] = await Promise.all([cfg.provider.getTransactionCount(cfg.bot, "latest"),
    cfg.provider.getTransactionCount(cfg.bot, "pending"), cfg.provider.getBalance(cfg.bot, "pending")]);
  if (latest > tx.nonce || pending > tx.nonce) {
    // A user may have spent from their own bot wallet. Once finality proves this
    // nonce consumed, stop retrying it without pretending its outcome is known.
    const finalizedNonce = await cfg.provider.getTransactionCount(cfg.bot, "finalized");
    if (finalizedNonce <= tx.nonce) return { reason: "nonce_conflict" };
    await renew(cfg, token);
    const r = await update(cfg, token, "UPDATE gas_funding_jobs SET state='failed',last_error='nonce_consumed',updated_at=? WHERE job_id=? AND state='pending'",
      [cfg.now(), row.job_id]).run();
    if (!changed(r)) fail("locked");
    return { reason: "nonce_consumed" };
  }
  const required = tx.gasLimit * tx.gasPrice + await extraFee(cfg, tx);
  if (balance < required) return { reason: "insufficient_bot_gas" };
  await renew(cfg, token);
  // Even expired calls are rebroadcast unchanged: the canonical revert consumes the
  // already-persisted nonce, allowing a fresh quote on the next cycle.
  try {
    const hash = await cfg.provider.send("eth_sendRawTransaction", [row.tx_raw]);
    if (!eq(hash, row.tx_hash)) return blockJob(cfg, token, row, "recovery_invalid");
  } catch { /* Recover exact hash after a dropped acknowledgement. */ }
  return { reason: "pending" };
}

async function plan(cfg) {
  if (await cfg.contract.paused()) fail("paused");
  const needed = await cfg.contract.needed();
  if (needed[0] + needed[1] === 0n) fail("healthy");
  const [priceRaw, budget, nonceLatest, noncePending, botETH] = await Promise.all([
    cfg.provider.send("eth_gasPrice", []), cfg.contract.remainingBudget(), cfg.provider.getTransactionCount(cfg.bot, "latest"),
    cfg.provider.getTransactionCount(cfg.bot, "pending"), cfg.provider.getBalance(cfg.bot, "pending"),
  ]);
  const gasPrice = BigInt(priceRaw);
  if (gasPrice <= 0n || gasPrice > GAS_PRICE_MAX) fail("fee_cap");
  if (nonceLatest !== noncePending) fail("nonce_conflict");
  const assets = [cfg.usdc, cfg.wld, cfg.usdcStrategy, cfg.wldStrategy];
  const sources = await Promise.all(assets.map(async address => {
    const token = new Contract(address, TOKEN_ABI, cfg.provider);
    const [balance, allowance] = await Promise.all([token.balanceOf(cfg.treasury), token.allowance(cfg.treasury, cfg.address)]);
    return { token, balance, allowance };
  }));
  let best = null, hadFunds = false, hadBalance = false, hadBudget = false, hadQuote = false, hadNeed = false, reason = "awaiting_fees";
  for (let route = 0; route < 3; route++) {
    let quote;
    try { quote = await cfg.contract.quote(route); } catch { continue; }
    hadQuote = true;
    if (quote.inputMax === 0n || quote.keeperETH + quote.botETH > MAX_OUTPUT) continue;
    hadNeed = true;
    if (quote.costUSDC > budget) continue;
    hadBudget = true;
    for (const receiptSource of [false, true]) {
      const source = sources[(route === 0 ? 0 : 1) + (receiptSource ? 2 : 0)];
      let amount;
      try { amount = receiptSource ? await source.token.previewWithdraw(quote.inputMax) : quote.inputMax; }
      catch { continue; }
      if (source.balance < amount) continue;
      hadBalance = true;
      if (source.allowance < amount) continue;
      hadFunds = true;
      const deadline = Math.floor(cfg.now() / 1000) + 240;
      const data = INTERFACE.encodeFunctionData("refill", [route, receiptSource, deadline]);
      const request = { from: cfg.bot, to: cfg.address, value: 0n, data };
      let gasLimit, actual;
      try {
        // A zero-priced estimate avoids requiring the entire safety ceiling in
        // the payer's wallet. The executable simulation below uses the real
        // price and padded estimate, after checking all native fee reserves.
        const estimate = await cfg.provider.estimateGas({ ...request, gasPrice: 0n, gasLimit: GAS_LIMIT_MAX });
        gasLimit = (estimate * 120n + 99n) / 100n;
      } catch (error) {
        reason = "simulation_failed";
        await cfg.hooks.onCandidateError?.({ route, receiptSource, message: error.shortMessage || error.message });
        continue;
      }
      if (gasLimit > GAS_LIMIT_MAX) { reason = "gas_cap"; continue; }
      const unsigned = Transaction.from({ to: cfg.address, data, value: 0n,
        chainId: cfg.chainId, type: 0, nonce: nonceLatest, gasLimit, gasPrice });
      const reserve = gasLimit * gasPrice + await extraFee(cfg, unsigned);
      if (botETH < reserve) { reason = "insufficient_bot_gas"; continue; }
      try {
        actual = await cfg.contract.refill.staticCall(route, receiptSource, deadline, { from: cfg.bot, gasPrice, gasLimit });
      } catch (error) {
        reason = "simulation_failed";
        await cfg.hooks.onCandidateError?.({ route, receiptSource, message: error.shortMessage || error.message });
        continue;
      }
      const output = quote.keeperETH + quote.botETH;
      // One batch must buy at least 100x the transaction's conservative gas reserve.
      if (reserve * 100n > output) { reason = "uneconomic"; continue; }
      // Compare actual simulated token input in USDC units plus total tx cost.
      const inputUSDC = (quote.costUSDC * actual + quote.inputMax - 1n) / quote.inputMax;
      const gasUSDC = (quote.costUSDC * reserve + output - 1n) / output;
      const cost = inputUSDC + gasUSDC;
      if (!best || cost < best.cost) best = { request: unsigned, route, receiptSource, deadline, reserve, output, cost };
      // Receipt redemption adds work for the same underlying route. Use it only
      // when liquid operator fees cannot execute this path.
      break;
    }
  }
  if (!best) fail(!hadQuote ? "quote_unavailable" : !hadNeed ? "healthy" : !hadBudget ? "budget_exhausted"
    : !hadFunds ? hadBalance ? "allowance_missing" : "awaiting_fees" : reason);
  return best;
}

async function runCycle(env, testing) {
  const cfg = config(env, testing);
  if (!cfg.enabled) return { enabled: false, reason: cfg.reason };
  let token, reason = "rpc_unavailable";
  try {
    for (const schema of schemas) await cfg.db.prepare(schema).run();
    token = crypto.randomUUID();
    const now = cfg.now();
    const lease = await cfg.db.prepare("INSERT INTO gas_funding_locks(scope,lease_token,lease_until,last_cycle_reason) VALUES(?,?,?,'running') ON CONFLICT(scope) DO UPDATE SET lease_token=excluded.lease_token,lease_until=excluded.lease_until,last_cycle_reason='running' WHERE gas_funding_locks.lease_until<=?")
      .bind(cfg.scope, token, now + LEASE_MS, now).run();
    if (!changed(lease)) return { enabled: true, reason: "locked" };
    await validateContract(cfg);
    const oldTable = await cfg.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gas_refill_jobs'").first();
    if (oldTable && await cfg.db.prepare("SELECT job_id FROM gas_refill_jobs WHERE state IN ('active','blocked') LIMIT 1").first()) fail("legacy_job_pending");
    // Older contract-scoped journals must be resolved by their original release
    // before upgrading. Never make a second signature while one remains unknown.
    if (await cfg.db.prepare("SELECT job_id FROM gas_funding_jobs WHERE scope<>? AND state IN ('pending','blocked') LIMIT 1").bind(cfg.scope).first()) fail("deployment_transition_pending");
    let job = await cfg.db.prepare("SELECT * FROM gas_funding_jobs WHERE scope=? AND state IN ('pending','blocked') LIMIT 1").bind(cfg.scope).first();
    // Controller rotation shares the signer's nonce lease. Keep the previous
    // controller's journal intact so restoring its configuration can recover it.
    if (job) {
      try { if (!eq(Transaction.from(job.tx_raw).to, cfg.address)) fail("deployment_transition_pending"); }
      catch (error) { if (error.message === "deployment_transition_pending") throw error; }
    }
    if (job?.state === "blocked") fail(reasonOf(job.last_error));
    if (!job) {
      const selected = await plan(cfg);
      await renew(cfg, token);
      const raw = await cfg.wallet.signTransaction(selected.request);
      const tx = Transaction.from(raw), jobId = crypto.randomUUID();
      const inserted = await cfg.db.prepare("INSERT INTO gas_funding_jobs(job_id,scope,state,route,receipt_source,tx_hash,tx_raw,nonce,deadline,gas_limit,gas_price,reserved_wei,output_wei,created_at,updated_at) SELECT ?,?,'pending',?,?,?,?,?,?,?,?,?,?,?,? WHERE " + GUARD)
        .bind(jobId, cfg.scope, selected.route, selected.receiptSource ? 1 : 0, tx.hash, raw, tx.nonce, selected.deadline,
          tx.gasLimit.toString(), tx.gasPrice.toString(), selected.reserve.toString(), selected.output.toString(), cfg.now(), cfg.now(), cfg.scope, token, cfg.now()).run();
      if (!changed(inserted)) fail("locked");
      await cfg.hooks.afterStage?.({ jobId, hash: tx.hash });
      // Keep planning and recovery in separate invocations, below Worker request
      // limits. The one-minute cron leaves three minutes in the signed deadline.
      reason = "pending";
      return { enabled: true, reason };
    }
    const result = await reconcile(cfg, token, job);
    reason = result.reason;
    return { enabled: true, ...result };
  } catch (error) {
    await cfg.hooks.onCycleError?.(error.shortMessage || error.message);
    reason = reasonOf(error?.message);
    if (/^(D1|SQLITE)/i.test(String(error?.code || "")) || /\bdatabase\b|\bsqlite\b|\bD1_ERROR\b/i.test(String(error?.message || ""))) reason = "storage_unavailable";
    return { enabled: true, reason };
  } finally {
    if (token) {
      try {
        await cfg.db.prepare("UPDATE gas_funding_locks SET lease_until=0,last_cycle_at=?,last_cycle_reason=? WHERE scope=? AND lease_token=?")
          .bind(new Date(cfg.now()).toISOString(), reason, cfg.scope, token).run();
      } catch { /* Expiring lease permits durable recovery. */ }
    }
    cfg.provider.destroy();
  }
}

export function runGasRefillCycle(env) { return runCycle(env); }
export function runGasRefillCycleWithTestConfig(env, testConfig) { return runCycle(env, testConfig); }
export async function readGasRefillHealth(env) {
  const cfg = config(env);
  if (!cfg.enabled) return { enabled: false, status: cfg.reason, reason: cfg.reason };
  try {
    const lock = await cfg.db.prepare("SELECT last_cycle_at,last_cycle_reason FROM gas_funding_locks WHERE scope=?").bind(cfg.scope).first();
    return { enabled: true, status: reasonOf(lock?.last_cycle_reason || "not_running"),
      reason: reasonOf(lock?.last_cycle_reason || "not_running"), lastCycleAt: lock?.last_cycle_at || null,
      contract: cfg.address, fundingAssets: ["WLD", "USDC"], atomic: true };
  } catch { return { enabled: true, status: "not_running", reason: "not_running" }; }
  finally { cfg.provider.destroy(); }
}
