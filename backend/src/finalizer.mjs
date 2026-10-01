import {
  Contract, FetchRequest, Interface, JsonRpcProvider, Transaction, Wallet,
  ZeroAddress, getAddress, isError, keccak256, parseEther, parseUnits,
} from "ethers";

// This signer has no custody rights. It only calls executeInheritance(vault) with value=0.
const FACTORY_ABI = [
  "function WLD() view returns (address)",
  "function vaultOf(address) view returns (address)",
  "function executeInheritance(address)",
  "error NotOurVault()",
];
const VAULT_ABI = [
  "function factory() view returns (address)",
  "function WLD() view returns (address)",
  "function owner() view returns (address)",
  "function heir() view returns (address)",
  "function claimedAt() view returns (uint256)",
  "function claimFiledAt() view returns (uint256)",
  "function claimableNow() view returns (bool)",
  "event InheritanceFinalized(address indexed recipient,uint256 wldAmount,uint256 claimedAt)",
];
const FACTORY_INTERFACE = new Interface(FACTORY_ABI);
const VAULT_INTERFACE = new Interface(VAULT_ABI);
const ORACLE_ADDRESS = "0x420000000000000000000000000000000000000F";
const ORACLE_ABI = [
  "function getL1Fee(bytes) view returns (uint256)",
  "function getOperatorFee(uint256) view returns (uint256)",
];
const LEASE_MS = 120_000;
const COOLDOWN_MS = 15 * 60_000;
const CYCLE_FRESH_MS = 6 * 60_000;
let cachedWallet;
const sql = {
  locks: "CREATE TABLE IF NOT EXISTS finalizer_locks (scope TEXT PRIMARY KEY, lease_token TEXT NOT NULL, lease_until INTEGER NOT NULL, halted INTEGER NOT NULL DEFAULT 0, cursor_address TEXT NOT NULL DEFAULT '', last_error TEXT, last_cycle_at TEXT, last_cycle_reason TEXT)",
  jobs: "CREATE TABLE IF NOT EXISTS finalizer_jobs (chain_id INTEGER NOT NULL, scope TEXT NOT NULL, vault_address TEXT NOT NULL, claim_filed_at TEXT NOT NULL, recipient_address TEXT NOT NULL, lease_token TEXT NOT NULL, lease_until INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'ready', tx_hash TEXT, budget_day TEXT, reserved_wei TEXT, last_error TEXT, tx_raw TEXT, PRIMARY KEY (chain_id, vault_address, claim_filed_at))",
  budget: "CREATE TABLE IF NOT EXISTS finalizer_budget (scope TEXT NOT NULL, day TEXT NOT NULL, spent_wei INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (scope, day))",
};
const fail = (code) => { throw new Error(code); };
const changed = (result) => Number(result.meta?.changes || 0) === 1;
const dayNow = () => new Date().toISOString().slice(0, 10);
const addrEq = (a, b) => a.toLowerCase() === b.toLowerCase();

function settings(env) {
  if (env.FINALIZER_ENABLED !== "true") return { enabled: false, reason: "disabled" };
  const missing = ["DB", "RPC_URL", "FACTORY_ADDRESS", "WLD_ADDRESS", "FINALIZER_PRIVATE_KEY"]
    .filter((key) => !env[key]);
  if (missing.length) return { enabled: false, reason: "not_configured", missing };
  try {
    const chainId = Number(env.FINALIZER_CHAIN_ID || 480);
    const maxGas = BigInt(env.FINALIZER_MAX_GAS || 250_000);
    const maxFee = parseUnits(env.FINALIZER_MAX_FEE_GWEI || "1", "gwei");
    const dailyCap = parseEther(env.FINALIZER_DAILY_GAS_CAP_ETH || "0.001");
    const extraReserve = parseEther(env.FINALIZER_EXTRA_FEE_RESERVE_ETH || "0.00001");
    const batchSize = Number(env.FINALIZER_BATCH_SIZE || 5);
    const scanLimit = Number(env.FINALIZER_SCAN_LIMIT || 3);
    const rpc = new URL(env.RPC_URL);
    if (!Number.isSafeInteger(chainId) || chainId <= 0 || maxGas <= 0n || maxGas > 1_000_000n ||
        maxFee <= 0n || maxFee > parseUnits("100", "gwei") || dailyCap <= 0n ||
        dailyCap > parseEther("1") || extraReserve < 0n || extraReserve > dailyCap ||
        (chainId === 480 && extraReserve === 0n) ||
        !Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5 ||
        !Number.isInteger(scanLimit) || scanLimit < 1 || scanLimit > 20 ||
        (rpc.protocol !== "https:" && !(rpc.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(rpc.hostname)))) {
      return { enabled: false, reason: "invalid_configuration" };
    }
    if (cachedWallet?.privateKey !== env.FINALIZER_PRIVATE_KEY) cachedWallet = new Wallet(env.FINALIZER_PRIVATE_KEY);
    const wallet = cachedWallet;
    const factoryAddress = getAddress(env.FACTORY_ADDRESS);
    const wldAddress = getAddress(env.WLD_ADDRESS);
    const request = new FetchRequest(rpc.href);
    request.timeout = 8_000;
    // Validate eth_chainId explicitly each cycle. staticNetwork avoids a second RPC
    // for every view call, which matters under Workers' external subrequest limit.
    const provider = new JsonRpcProvider(request, chainId, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 });
    const scope = chainId + ":" + wallet.address.toLowerCase();
    return { enabled: true, chainId, maxGas, maxFee, dailyCap, extraReserve, batchSize, scanLimit,
      provider, wallet, factoryAddress, wldAddress, scope };
  } catch {
    // Do not expose provider errors, key material or credential-bearing RPC URLs.
    return { enabled: false, reason: "invalid_configuration" };
  }
}

async function validateNetwork(cfg) {
  if (Number(BigInt(await cfg.provider.send("eth_chainId", []))) !== cfg.chainId) fail("wrong_chain");
  const factory = new Contract(cfg.factoryAddress, FACTORY_ABI, cfg.provider);
  if (!addrEq(await factory.WLD(), cfg.wldAddress)) fail("wrong_token");
  try {
    await factory.executeInheritance.staticCall(ZeroAddress);
    fail("unsupported_factory");
  } catch (error) {
    let name;
    try { name = FACTORY_INTERFACE.parseError(error.data || "0x")?.name; } catch { /* absent ABI */ }
    if (!isError(error, "CALL_EXCEPTION") || name !== "NotOurVault") fail("unsupported_factory");
  }
  return factory;
}

async function ensureSchema(db) {
  for (const statement of Object.values(sql)) await db.prepare(statement).run();
  for (const [table, additions] of [
    ["finalizer_locks", ["last_cycle_at", "last_cycle_reason"]],
    ["finalizer_jobs", ["tx_raw"]],
  ]) {
    const columns = await db.prepare("PRAGMA table_info(" + table + ")").all();
    for (const name of additions) {
      if ((columns.results || []).some((column) => column.name === name)) continue;
      try { await db.prepare("ALTER TABLE " + table + " ADD COLUMN " + name + " TEXT").run(); }
      catch (error) {
        // Concurrent schema upgrades are safe only if the column now exists.
        const current = await db.prepare("PRAGMA table_info(" + table + ")").all();
        if (!(current.results || []).some((column) => column.name === name)) throw error;
      }
    }
  }
}

async function lock(db, cfg, token) {
  const now = Date.now();
  const result = await db.prepare(
    "INSERT INTO finalizer_locks (scope,lease_token,lease_until,last_cycle_reason) VALUES (?,?,?,'running') ON CONFLICT(scope) DO UPDATE SET lease_token=excluded.lease_token,lease_until=excluded.lease_until,last_cycle_reason='running' WHERE finalizer_locks.lease_until<=? AND finalizer_locks.halted=0"
  ).bind(cfg.scope, token, now + LEASE_MS, now).run();
  return changed(result);
}

async function renewLock(db, cfg, token) {
  const now = Date.now();
  const result = await db.prepare(
    "UPDATE finalizer_locks SET lease_until=? WHERE scope=? AND lease_token=? AND lease_until>? AND halted=0"
  ).bind(now + LEASE_MS, cfg.scope, token, now).run();
  if (!changed(result)) fail("lease_lost");
}

async function halt(db, scope, reason) {
  await db.prepare("UPDATE finalizer_locks SET halted=1,last_error=? WHERE scope=?")
    .bind(reason, scope).run();
}

async function claimJob(db, cfg, token, snapshot) {
  const now = Date.now();
  const result = await db.prepare(
    "INSERT INTO finalizer_jobs (chain_id,scope,vault_address,claim_filed_at,recipient_address,lease_token,lease_until) VALUES (?,?,?,?,?,?,?) ON CONFLICT(chain_id,vault_address,claim_filed_at) DO UPDATE SET scope=excluded.scope,lease_token=excluded.lease_token,lease_until=excluded.lease_until,recipient_address=excluded.recipient_address,state='ready',tx_hash=NULL,tx_raw=NULL,budget_day=NULL,reserved_wei=NULL WHERE finalizer_jobs.lease_until<=? AND finalizer_jobs.next_attempt_at<=? AND finalizer_jobs.state NOT IN ('pending','confirmed')"
  ).bind(cfg.chainId, cfg.scope, snapshot.address, snapshot.filedAt.toString(), snapshot.heir, token,
    now + LEASE_MS, now, now).run();
  return changed(result);
}

async function failJob(db, cfg, token, snapshot, reason) {
  await db.prepare(
    "UPDATE finalizer_jobs SET state='failed',lease_until=0,next_attempt_at=?,last_error=? WHERE scope=? AND vault_address=? AND claim_filed_at=? AND lease_token=? AND state!='pending'"
  ).bind(Date.now() + COOLDOWN_MS, reason, cfg.scope, snapshot.address,
    snapshot.filedAt.toString(), token).run();
}

async function snapshotVault(cfg, factory, address) {
  const vault = new Contract(address, VAULT_ABI, cfg.provider);
  const [originFactory, token, owner, heir, claimedAt, filedAt, claimable] = await Promise.all([
    vault.factory(), vault.WLD(), vault.owner(), vault.heir(),
    vault.claimedAt(), vault.claimFiledAt(), vault.claimableNow(),
  ]);
  if (!addrEq(originFactory, cfg.factoryAddress) || !addrEq(token, cfg.wldAddress) ||
      !addrEq(await factory.vaultOf(owner), address)) fail("foreign_vault");
  if (claimedAt !== 0n || filedAt === 0n || !claimable || heir === ZeroAddress) return null;
  const wld = new Contract(cfg.wldAddress, ["function balanceOf(address) view returns (uint256)"], cfg.provider);
  if (await wld.balanceOf(address) === 0n) return null;
  return { address, filedAt, heir };
}

async function extraFee(cfg, tx) {
  if (cfg.chainId !== 480) return 0n; // Local Anvil test chains have no OP data fee.
  const oracle = new Contract(ORACLE_ADDRESS, ORACLE_ABI, cfg.provider);
  // OP L1 fees are outside maxFeePerGas. Reserve a configured allowance and fail closed
  // if its current estimate is larger. The receipt can still exceed the quote at inclusion.
  const l1 = await oracle.getL1Fee(Transaction.from(tx).unsignedSerialized);
  let operator = 0n;
  try { operator = await oracle.getOperatorFee(tx.gasLimit); }
  catch (error) { if (!isError(error, "CALL_EXCEPTION")) fail("fee_unavailable"); }
  return l1 + operator;
}

async function receiptCost(cfg, receipt) {
  if (cfg.chainId === 480 && receipt.l1Fee == null) fail("fee_unverified");
  let cost = BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice) + BigInt(receipt.l1Fee ?? 0);
  if (receipt.operatorFee != null) return cost + BigInt(receipt.operatorFee);
  if (BigInt(receipt.operatorFeeScalar || 0) !== 0n || BigInt(receipt.operatorFeeConstant || 0) !== 0n) {
    // Use the chain's fee formula, at the receipt's block, rather than duplicating a
    // formula that can change with OP upgrades.
    const oracle = new Contract(ORACLE_ADDRESS, ORACLE_ABI, cfg.provider);
    cost += await oracle.getOperatorFee(BigInt(receipt.gasUsed), { blockTag: receipt.blockNumber });
  }
  return cost;
}

function storedTransaction(cfg, job) {
  if (!job.tx_raw) fail("recovery_unavailable");
  let tx;
  try {
    tx = Transaction.from(job.tx_raw);
    if (!tx.isSigned() || tx.chainId !== BigInt(cfg.chainId) || Number(job.chain_id) !== cfg.chainId ||
        job.scope !== cfg.scope || !addrEq(tx.from, cfg.wallet.address) ||
        !addrEq(tx.to, cfg.factoryAddress) || tx.value !== 0n || tx.type !== 0 ||
        tx.data !== FACTORY_INTERFACE.encodeFunctionData("executeInheritance", [job.vault_address]) ||
        keccak256(job.tx_raw) !== job.tx_hash || tx.hash !== job.tx_hash ||
        tx.gasLimit <= 0n || tx.gasPrice <= 0n ||
        tx.gasLimit * tx.gasPrice > BigInt(job.reserved_wei)) fail("recovery_invalid");
  } catch { fail("recovery_invalid"); }
  if (tx.gasLimit > cfg.maxGas) fail("gas_cap");
  if (tx.gasPrice > cfg.maxFee) fail("fee_cap");
  if (BigInt(job.reserved_wei) > cfg.dailyCap) fail("daily_cap");
  return tx;
}

async function recoveryFailure(db, cfg, error) {
  const reason = ["recovery_unavailable", "recovery_invalid", "recovery_ineligible", "nonce_conflict",
    "gas_cap", "fee_cap", "daily_cap", "extra_fee_cap", "insufficient_gas", "lease_lost"]
    .includes(error.message) ? error.message : "rpc_error";
  if (["recovery_unavailable", "recovery_invalid", "recovery_ineligible", "nonce_conflict"].includes(reason)) {
    await halt(db, cfg.scope, reason);
  }
  return { reason, submitted: 0 };
}

async function canonicalReceipt(cfg, job, receipt) {
  if (receipt.transactionHash !== job.tx_hash || !/^0x[\da-f]{64}$/i.test(receipt.blockHash || "")) {
    fail("receipt_mismatch");
  }
  const block = await cfg.provider.send("eth_getBlockByNumber", [receipt.blockNumber, false]);
  return block != null && block.hash === receipt.blockHash &&
    BigInt(block.number) === BigInt(receipt.blockNumber);
}

async function recoverPending(db, cfg, factory, token, job, orphaned = false) {
  try {
    // A known mempool/mined transaction needs no second broadcast. Legacy rows
    // without raw data can still reconcile if their original transaction exists.
    if (!orphaned && await cfg.provider.send("eth_getTransactionByHash", [job.tx_hash])) {
      return { reason: "pending", submitted: 0 };
    }
    const tx = storedTransaction(cfg, job);
    const snapshot = await snapshotVault(cfg, factory, getAddress(job.vault_address));
    if (!snapshot || snapshot.filedAt.toString() !== job.claim_filed_at ||
        !addrEq(snapshot.heir, job.recipient_address)) fail("recovery_ineligible");
    await cfg.provider.call({ to: tx.to, from: tx.from, data: tx.data, value: 0n,
      gasLimit: tx.gasLimit, gasPrice: tx.gasPrice });
    if (tx.gasLimit * tx.gasPrice + cfg.extraReserve > BigInt(job.reserved_wei) ||
        await extraFee(cfg, tx) > cfg.extraReserve) fail("extra_fee_cap");
    if (await cfg.provider.getBalance(cfg.wallet.address, "pending") < BigInt(job.reserved_wei)) {
      fail("insufficient_gas");
    }
    if (await cfg.provider.getTransactionCount(cfg.wallet.address, "latest") > tx.nonce) fail("nonce_conflict");
    await renewLock(db, cfg, token);
    // Reuse the exact signature, nonce, gas price, calldata and hash. Its existing
    // reservation is retained; recovery never signs a replacement or charges it twice.
    try { await cfg.provider.send("eth_sendRawTransaction", [job.tx_raw]); }
    catch { return { reason: "pending", submitted: 1 }; }
    const result = await reconcile(db, cfg, job, factory, token, false);
    return { ...result, submitted: 1 };
  } catch (error) { return recoveryFailure(db, cfg, error); }
}

async function reconcile(db, cfg, job, factory, token, recover = false) {
  const receipt = await cfg.provider.send("eth_getTransactionReceipt", [job.tx_hash]);
  if (!receipt) return recover ? recoverPending(db, cfg, factory, token, job)
    : { reason: "pending", submitted: 0 };
  // Never refund a reservation or mark a job confirmed on an unsafe L2 receipt.
  // finalized is the RPC's consensus finality boundary, not a timer or latest head.
  const finalized = await cfg.provider.send("eth_getBlockByNumber", ["finalized", false]);
  let canonical;
  try { canonical = await canonicalReceipt(cfg, job, receipt); }
  catch (error) {
    if (error.message !== "receipt_mismatch") throw error;
    await halt(db, cfg.scope, "receipt_mismatch");
    return { reason: "receipt_mismatch", submitted: 0 };
  }
  if (!canonical) return recover ? recoverPending(db, cfg, factory, token, job, true)
    : { reason: "pending", submitted: 0 };
  if (!finalized) return { reason: "finality_unavailable", submitted: 0 };
  if (BigInt(finalized.number) < BigInt(receipt.blockNumber)) {
    return { reason: "awaiting_finality", submitted: 0 };
  }
  let cost;
  try { cost = await receiptCost(cfg, receipt); }
  catch {
    await halt(db, cfg.scope, "fee_unverified");
    return { reason: "fee_unverified", submitted: 0 };
  }
  const reserved = BigInt(job.reserved_wei);
  const succeeded = BigInt(receipt.status) === 1n;
  let proof = false;
  if (succeeded) {
    proof = receipt.logs.some((log) => {
      if (!addrEq(log.address, job.vault_address)) return false;
      try {
        const event = VAULT_INTERFACE.parseLog(log);
        return event?.name === "InheritanceFinalized" &&
          addrEq(event.args.recipient, job.recipient_address) && event.args.wldAmount > 0n;
      } catch { return false; }
    });
  }
  const reason = cost > reserved ? "fee_overrun" : succeeded && !proof ? "receipt_mismatch" : null;
  // D1 batch is transactional: a crash cannot refund a reservation twice while the
  // job still appears pending. Budget deltas are applied only to that pending job.
  const statements = [
    db.prepare("UPDATE finalizer_budget SET spent_wei=MAX(0,spent_wei+CAST(? AS INTEGER)) WHERE scope=? AND day=? AND EXISTS (SELECT 1 FROM finalizer_jobs WHERE scope=? AND vault_address=? AND claim_filed_at=? AND state='pending')")
      .bind((cost - reserved).toString(), cfg.scope, job.budget_day, cfg.scope, job.vault_address, job.claim_filed_at),
    db.prepare("UPDATE finalizer_jobs SET state=?,lease_until=0,next_attempt_at=?,last_error=? WHERE scope=? AND vault_address=? AND claim_filed_at=? AND state='pending'")
      .bind(succeeded ? "confirmed" : "failed", Date.now() + COOLDOWN_MS,
        reason || (succeeded ? null : "transaction_reverted"), cfg.scope, job.vault_address, job.claim_filed_at),
  ];
  if (reason) statements.push(db.prepare("UPDATE finalizer_locks SET halted=1,last_error=? WHERE scope=?")
    .bind(reason, cfg.scope));
  await db.batch(statements);
  return { reason: reason || (succeeded ? "finalized" : "reverted"), submitted: 0 };
}

async function recoverConfirmed(db, cfg, factory, token, job, snapshot) {
  try {
    const receipt = await cfg.provider.send("eth_getTransactionReceipt", [job.tx_hash]);
    if (receipt && await canonicalReceipt(cfg, job, receipt)) {
      // A canonical payout and an eligible vault snapshot disagree; never guess.
      await halt(db, cfg.scope, "receipt_mismatch");
      return { reason: "receipt_mismatch", submitted: 0 };
    }
    storedTransaction(cfg, job);
    if (!addrEq(snapshot.heir, job.recipient_address)) fail("recovery_ineligible");
    await renewLock(db, cfg, token);
    const day = dayNow(), reserved = BigInt(job.reserved_wei);
    await db.prepare("INSERT INTO finalizer_budget (scope,day,spent_wei) VALUES (?,?,0) ON CONFLICT(scope,day) DO NOTHING")
      .bind(cfg.scope, day).run();
    // Keep the previously accounted fee conservatively and reserve this same raw
    // transaction again. The state transition and new reservation are atomic.
    const result = await db.batch([
      db.prepare("UPDATE finalizer_budget SET spent_wei=spent_wei+CAST(? AS INTEGER) WHERE scope=? AND day=? AND spent_wei<=CAST(? AS INTEGER) AND EXISTS (SELECT 1 FROM finalizer_jobs WHERE scope=? AND vault_address=? AND claim_filed_at=? AND state='confirmed')")
        .bind(reserved.toString(), cfg.scope, day, (cfg.dailyCap - reserved).toString(),
          cfg.scope, job.vault_address, job.claim_filed_at),
      db.prepare("UPDATE finalizer_jobs SET state='pending',budget_day=?,last_error='reorged' WHERE scope=? AND vault_address=? AND claim_filed_at=? AND state='confirmed' AND changes()=1")
        .bind(day, cfg.scope, job.vault_address, job.claim_filed_at),
    ]);
    if (!changed(result[1])) return { reason: "daily_cap", submitted: 0 };
    return recoverPending(db, cfg, factory, token, { ...job, state: "pending", budget_day: day }, true);
  } catch (error) { return recoveryFailure(db, cfg, error); }
}

async function submit(db, cfg, token, snapshot) {
  const request = {
    to: cfg.factoryAddress,
    data: FACTORY_INTERFACE.encodeFunctionData("executeInheritance", [snapshot.address]),
    value: 0n,
    from: cfg.wallet.address,
  };
  try { await cfg.provider.call(request); } catch { fail("simulation_failed"); }
  const estimate = await cfg.provider.estimateGas(request);
  const gasLimit = (estimate * 120n + 99n) / 100n;
  if (gasLimit > cfg.maxGas) fail("gas_cap");
  const gasPrice = BigInt(await cfg.provider.send("eth_gasPrice", []));
  if (gasPrice <= 0n || gasPrice > cfg.maxFee) fail("fee_cap");
  const nonce = await cfg.provider.getTransactionCount(cfg.wallet.address, "pending");
  const tx = { to: request.to, data: request.data, value: 0n, chainId: cfg.chainId,
    type: 0, nonce, gasLimit, gasPrice };
  if (await extraFee(cfg, tx) > cfg.extraReserve) fail("extra_fee_cap");
  const reserved = gasLimit * gasPrice + cfg.extraReserve;
  if (await cfg.provider.getBalance(cfg.wallet.address, "pending") < reserved) fail("insufficient_gas");
  // Renew after the slow RPC steps and before the durable reservation/broadcast.
  await renewLock(db, cfg, token);
  const day = dayNow();
  if (reserved > cfg.dailyCap) fail("daily_cap");
  const raw = await cfg.wallet.signTransaction(tx);
  const hash = keccak256(raw);
  // The fee reservation and exact signed transaction commit together. A failed
  // D1 write leaves neither, and an interrupted acknowledgement leaves both.
  // The budget update requires this ready job; changes() couples the following
  // stage to its successful reservation within D1's atomic batch.
  const staged = await db.batch([
    db.prepare("INSERT INTO finalizer_budget (scope,day,spent_wei) VALUES (?,?,0) ON CONFLICT(scope,day) DO NOTHING")
      .bind(cfg.scope, day),
    db.prepare("UPDATE finalizer_budget SET spent_wei=spent_wei+CAST(? AS INTEGER) WHERE scope=? AND day=? AND spent_wei<=CAST(? AS INTEGER) AND EXISTS (SELECT 1 FROM finalizer_jobs WHERE scope=? AND vault_address=? AND claim_filed_at=? AND lease_token=? AND state='ready') AND EXISTS (SELECT 1 FROM finalizer_locks WHERE scope=? AND lease_token=? AND lease_until>? AND halted=0)")
      .bind(reserved.toString(), cfg.scope, day, (cfg.dailyCap - reserved).toString(), cfg.scope,
        snapshot.address, snapshot.filedAt.toString(), token, cfg.scope, token, Date.now()),
    db.prepare("UPDATE finalizer_jobs SET state='pending',tx_hash=?,tx_raw=?,budget_day=?,reserved_wei=?,lease_until=0,last_error=NULL WHERE scope=? AND vault_address=? AND claim_filed_at=? AND lease_token=? AND state='ready' AND changes()=1")
      .bind(hash, raw, day, reserved.toString(), cfg.scope, snapshot.address,
        snapshot.filedAt.toString(), token),
  ]);
  if (!changed(staged[1])) {
    await renewLock(db, cfg, token);
    fail("daily_cap");
  }
  if (!changed(staged[2])) fail("job_changed");
  await renewLock(db, cfg, token);
  try { await cfg.provider.broadcastTransaction(raw); }
  catch {
    // The node may have accepted the raw transaction before its response failed.
    // Retain the fee reservation and pending hash; do not guess that nothing happened.
    return "pending";
  }
  return (await reconcile(db, cfg, { tx_hash: hash, tx_raw: raw, chain_id: cfg.chainId, scope: cfg.scope,
    reserved_wei: reserved.toString(),
    budget_day: day, vault_address: snapshot.address, recipient_address: snapshot.heir,
    claim_filed_at: snapshot.filedAt.toString() }, null, token)).reason;
}

/** Cron-only entrypoint. Public HTTP handlers must never call this on a user's request. */
export async function runFinalizerCycle(env) {
  const cfg = settings(env);
  if (!cfg.enabled) return cfg;
  const summary = { enabled: true, checked: 0, finalized: 0, submitted: 0, skipped: 0, reason: "idle" };
  const token = crypto.randomUUID();
  let acquired = false, cursor = null;
  try {
    await ensureSchema(env.DB);
    acquired = await lock(env.DB, cfg, token);
    if (!acquired) return { ...summary, reason: "locked_or_halted" };
    const factory = await validateNetwork(cfg);
    const pending = await env.DB.prepare("SELECT * FROM finalizer_jobs WHERE scope=? AND state='pending' LIMIT 1")
      .bind(cfg.scope).first();
    if (pending) {
      const result = await reconcile(env.DB, cfg, pending, factory, token, true);
      summary.reason = result.reason;
      summary.submitted = result.submitted;
      if (result.reason === "finalized") summary.finalized++;
      // Recovery/finality polling uses its own bounded cycle; scanning another
      // batch here could exceed Workers Free's 50 external requests.
      return summary;
    }
    const lockRow = await env.DB.prepare("SELECT cursor_address FROM finalizer_locks WHERE scope=?")
      .bind(cfg.scope).first();
    let rows = await env.DB.prepare(
      "SELECT vault_address FROM watchers WHERE active=1 AND vault_address>? ORDER BY vault_address LIMIT ?"
    ).bind(lockRow.cursor_address, cfg.scanLimit).all();
    if (!(rows.results || []).length && lockRow.cursor_address) {
      rows = await env.DB.prepare("SELECT vault_address FROM watchers WHERE active=1 ORDER BY vault_address LIMIT ?")
        .bind(cfg.scanLimit).all();
    }
    for (const row of rows.results || []) {
      if (summary.submitted >= cfg.batchSize) break;
      cursor = row.vault_address;
      summary.checked++;
      await renewLock(env.DB, cfg, token);
      let snapshot;
      try { snapshot = await snapshotVault(cfg, factory, getAddress(row.vault_address)); }
      catch (error) {
        summary.skipped++;
        if (error.message === "foreign_vault" ||
            ["CALL_EXCEPTION", "BAD_DATA", "INVALID_ARGUMENT"].some((code) => isError(error, code))) continue;
        summary.reason = "rpc_error";
        break;
      }
      if (!snapshot) { summary.skipped++; continue; }
      const previous = await env.DB.prepare("SELECT * FROM finalizer_jobs WHERE chain_id=? AND vault_address=? AND claim_filed_at=? AND state='confirmed'")
        .bind(cfg.chainId, snapshot.address, snapshot.filedAt.toString()).first();
      if (previous) {
        // Also recheck older confirmed rows when chain state says this exact claim
        // is eligible again. This covers reorgs across a prior deployment/finality boundary.
        const result = await recoverConfirmed(env.DB, cfg, factory, token, previous, snapshot);
        summary.reason = result.reason;
        summary.submitted = result.submitted;
        if (result.reason === "finalized") summary.finalized++;
        return summary;
      }
      if (!(await claimJob(env.DB, cfg, token, snapshot))) { summary.skipped++; continue; }
      try {
        const result = await submit(env.DB, cfg, token, snapshot);
        summary.submitted++;
        if (result === "finalized") { summary.finalized++; summary.reason = "finalized"; }
        else { summary.reason = result; break; }
      } catch (error) {
        const reason = ["simulation_failed", "gas_cap", "fee_cap", "extra_fee_cap",
          "insufficient_gas", "daily_cap", "lease_lost", "job_changed"].includes(error.message)
          ? error.message : "rpc_error";
        await failJob(env.DB, cfg, token, snapshot, reason);
        summary.reason = reason;
        // Caps, lost leases and unavailable RPC apply to the whole signer, not one vault.
        break;
      }
    }
    return summary;
  } catch (error) {
    summary.reason = ["wrong_chain", "wrong_token", "unsupported_factory", "lease_lost"]
      .includes(error.message) ? error.message : acquired ? "rpc_error" : "unavailable";
    return summary;
  } finally {
    if (acquired) {
      await env.DB.prepare(
        "UPDATE finalizer_locks SET lease_until=0,cursor_address=COALESCE(?,cursor_address),last_cycle_at=?,last_cycle_reason=? WHERE scope=? AND lease_token=?"
      ).bind(cursor, new Date().toISOString(), summary.reason, cfg.scope, token).run();
    }
    cfg.provider.destroy();
  }
}

/** Read-only operational status. Never returns the private key or RPC credentials. */
export async function readFinalizerHealth(env) {
  const cfg = settings(env);
  if (!cfg.enabled) return cfg;
  const result = { enabled: true, chainId: cfg.chainId, factoryAddress: cfg.factoryAddress,
    signerAddress: cfg.wallet.address, maxGas: cfg.maxGas.toString(),
    maxFeeWei: cfg.maxFee.toString(), dailyCapWei: cfg.dailyCap.toString(),
    extraFeeReserveWei: cfg.extraReserve.toString(), batchSize: cfg.batchSize, scanLimit: cfg.scanLimit };
  try {
    await validateNetwork(cfg);
    result.supported = true;
    result.balanceWei = (await cfg.provider.getBalance(cfg.wallet.address)).toString();
    const gasPrice = BigInt(await cfg.provider.send("eth_gasPrice", []));
    const requiredReserve = cfg.maxGas * gasPrice + cfg.extraReserve;
    result.executionGasPriceWei = gasPrice.toString();
    result.requiredReserveWei = requiredReserve.toString();
    result.funded = BigInt(result.balanceWei) >= requiredReserve;
    const columns = await env.DB.prepare("PRAGMA table_info(finalizer_locks)").all();
    if (!(columns.results || []).length) {
      return { ...result, lastCycleAt: null, lastCycleReason: null, reason: "not_running" };
    }
    const hasHistory = ["last_cycle_at", "last_cycle_reason"]
      .every((name) => columns.results.some((column) => column.name === name));
    const row = await env.DB.prepare(hasHistory
      ? "SELECT halted,last_error,last_cycle_at,last_cycle_reason FROM finalizer_locks WHERE scope=?"
      : "SELECT halted,last_error FROM finalizer_locks WHERE scope=?")
      .bind(cfg.scope).first();
    result.halted = Number(row?.halted || 0) !== 0;
    result.lastError = row?.last_error || null;
    result.lastCycleAt = row?.last_cycle_at || null;
    result.lastCycleReason = row?.last_cycle_reason || null;
    if (!hasHistory || !result.lastCycleAt || !result.lastCycleReason) {
      return { ...result, reason: result.halted ? "halted" : "not_running" };
    }
    const budget = await env.DB.prepare("SELECT CAST(spent_wei AS TEXT) AS spent_wei FROM finalizer_budget WHERE scope=? AND day=?")
      .bind(cfg.scope, dayNow()).first();
    result.dailyReservedWei = budget?.spent_wei || "0";
    const remainingBudget = cfg.dailyCap - BigInt(result.dailyReservedWei);
    result.dailyRemainingWei = (remainingBudget > 0n ? remainingBudget : 0n).toString();
    const pending = await env.DB.prepare("SELECT tx_hash FROM finalizer_jobs WHERE scope=? AND state='pending' LIMIT 1")
      .bind(cfg.scope).first();
    result.pendingTxHash = pending?.tx_hash || null;
    // A progressing pending transaction retains its pre-approved reservation.
    if (pending) result.funded = BigInt(result.balanceWei) > cfg.extraReserve;
    const recentFailure = await env.DB.prepare("SELECT last_error FROM finalizer_jobs WHERE scope=? AND state='failed' AND next_attempt_at>? ORDER BY CASE WHEN last_error='simulation_failed' THEN 1 ELSE 0 END,next_attempt_at DESC LIMIT 1")
      .bind(cfg.scope, Date.now()).first();
    result.recentFailure = recentFailure?.last_error || null;
    const at = Date.parse(result.lastCycleAt);
    const now = Date.now();
    const cycleIssue = ["idle", "finalized", "pending", "awaiting_finality"].includes(result.lastCycleReason)
      ? null : result.lastCycleReason;
    result.cycleFresh = Number.isFinite(at) && at <= now + 60_000 && now - at <= CYCLE_FRESH_MS;
    if (result.halted) result.reason = "halted";
    else if (!Number.isFinite(at) || at > now + 60_000) result.reason = "not_running";
    else if (!result.cycleFresh) result.reason = "stale";
    // A staged hash can be blocked before broadcast. Its completed recovery
    // outcome (or a cycle still being checked) takes precedence over its row state.
    else if (cycleIssue) result.reason = cycleIssue;
    else if (pending) result.reason = "pending";
    else if (gasPrice <= 0n || gasPrice > cfg.maxFee) result.reason = "fee_cap";
    // Readiness conservatively covers the maximum allowed gas at today's price,
    // plus the separate OP fee reserve. Execution still quotes each actual claim.
    else if (remainingBudget < requiredReserve) result.reason = "daily_cap";
    else if (!result.funded) result.reason = "insufficient_gas";
    // A cancelled individual claim can remain in backoff after another cycle succeeds.
    // Keep it diagnostic; signer-wide failures still take precedence during backoff.
    else result.reason = result.recentFailure === "simulation_failed" ? "ready" : result.recentFailure || "ready";
  } catch (error) {
    result.reason = ["wrong_chain", "wrong_token", "unsupported_factory"].includes(error.message)
      ? error.message : "unavailable";
    result.supported ??= false;
  } finally { cfg.provider.destroy(); }
  return result;
}
