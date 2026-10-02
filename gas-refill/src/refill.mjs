import {
  Contract, FetchRequest, Interface, JsonRpcProvider, Transaction, Wallet,
  getAddress, keccak256, parseEther, parseUnits,
} from "ethers";
import { isExecutionRevert } from "./rpc-errors.mjs";

const PRODUCTION = Object.freeze({
  chainId: 480,
  rpcUrl: "https://worldchain-mainnet.g.alchemy.com/public",
  usdc: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
  weth: "0x4200000000000000000000000000000000000006",
  factory: "0x7a5028BDa40e7B173C278C5342087826455ea25a",
  router: "0x091AD9e2e6e5eD44c1c66dB50e49A601F9f36cF6",
  pool: "0x5f835420502A7702de50Cd0E78D8aA3608b2137e",
  treasury: "0x93bC44B8296977Feb479F95855D9b9E051C17dA2",
  beneficiary: "0x8C31Bbc49C371d431f884aB18Ba5aA25B0D9170b",
  bot: "0x20A85A9e929C69A440938eb650d70619b7562eD5",
});

const ORACLE_ADDRESS = "0x420000000000000000000000000000000000000F";
const RPC_TIMEOUT_MS = 8_000;
const LEASE_MS = 120_000;
const TWAP_WINDOW = 1_800;
const MAX_TICK_GAP = 100;
const MAX_DEADLINE_SECONDS = 300;
const MAX_SLIPPAGE_BPS = 50n;
const BPS = 10_000n;
const Q192 = 1n << 192n;
const GAS_PRICE_CAP = parseUnits("0.01", "gwei");
const DAILY_GAS_CAP = parseEther("0.00001");
const INPUT_CAP = 1_000_000n;
const KEEPER_LOW = parseEther("0.00002");
const KEEPER_TARGET = parseEther("0.0001");
const BOT_MIN = parseEther("0.000004");
const BOT_TARGET = parseEther("0.00001");
const MAX_PAYOUT = parseEther("0.0001");
const ROLLING_MS = 24 * 60 * 60 * 1000;

const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transferFrom(address,address,uint256) returns (bool)",
  "function approve(address,uint256) returns (bool)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "event Approval(address indexed owner,address indexed spender,uint256 value)",
];
const WETH_ABI = ["function decimals() view returns (uint8)"];
const FACTORY_ABI = ["function getPool(address,address,uint24) view returns (address)"];
const POOL_ABI = [
  "function factory() view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint8,bool)",
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives,uint160[] secondsPerLiquidityCumulativeX128s)",
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
];
const ROUTER_ABI = [
  "function factory() view returns (address)",
  "function WETH9() view returns (address)",
  "function exactOutputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountOut,uint256 amountInMaximum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountIn)",
  "function unwrapWETH9(uint256 amountMinimum,address recipient) payable",
  "function multicall(uint256 deadline,bytes[] data) payable returns (bytes[] results)",
];
const ORACLE_ABI = [
  "function getL1Fee(bytes) view returns (uint256)",
  "function getOperatorFee(uint256) view returns (uint256)",
];
const TOKEN_INTERFACE = new Interface(TOKEN_ABI);
const ROUTER_INTERFACE = new Interface(ROUTER_ABI);
const POOL_INTERFACE = new Interface(POOL_ABI);
const PHASE_GAS_LIMITS = Object.freeze({
  pull: 90_000n,
  clear_approval: 100_000n,
  approve: 100_000n,
  swap: 700_000n,
  revoke: 100_000n,
  cancel_revoke: 100_000n,
  payout: 30_000n,
});
const PENDING_TX_STATES = ["staged", "broadcast", "mined", "orphaned"];
const PUBLIC_REASONS = new Set([
  "disabled", "not_configured", "invalid_configuration", "locked", "healthy", "refill_started",
  "pending", "awaiting_finality", "finality_unavailable", "awaiting_budget", "insufficient_bot_gas",
  "wrong_chain", "wrong_protocol", "wrong_token", "wrong_pool", "twap_unavailable", "price_gap",
  "quote_unavailable", "quote_exceeds_budget", "gas_budget_exhausted", "rpc_unavailable",
  "storage_unavailable", "simulation_failed", "transaction_reverted", "receipt_mismatch",
  "fee_cap", "gas_cap", "gas_budget_overrun", "nonce_conflict", "recovery_invalid",
  "expired_transaction", "beneficiary_refilled", "payout_complete", "swap_cancelled", "blocked", "internal_error",
]);

const sql = {
  locks: `CREATE TABLE IF NOT EXISTS gas_refill_locks (
    scope TEXT PRIMARY KEY, lease_token TEXT NOT NULL, lease_until INTEGER NOT NULL,
    last_cycle_at TEXT, last_cycle_reason TEXT)`,
  jobs: `CREATE TABLE IF NOT EXISTS gas_refill_jobs (
    job_id TEXT PRIMARY KEY, scope TEXT NOT NULL, state TEXT NOT NULL, phase TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, amount_in_max TEXT NOT NULL,
    input_reserved TEXT NOT NULL, input_actual TEXT NOT NULL DEFAULT '0', pull_amount TEXT NOT NULL DEFAULT '0',
    payout_eth TEXT NOT NULL, payout_actual TEXT NOT NULL DEFAULT '0', output_eth TEXT NOT NULL,
    output_actual TEXT NOT NULL DEFAULT '0', gas_reserved TEXT NOT NULL, gas_spent TEXT NOT NULL DEFAULT '0',
    keeper_address TEXT NOT NULL, keeper_balance_start TEXT NOT NULL, bot_balance_start TEXT NOT NULL,
    last_error TEXT)`,
  transactions: `CREATE TABLE IF NOT EXISTS gas_refill_transactions (
    job_id TEXT NOT NULL, phase TEXT NOT NULL, tx_hash TEXT NOT NULL UNIQUE, tx_raw TEXT NOT NULL,
    nonce INTEGER NOT NULL, tx_amount TEXT NOT NULL, deadline INTEGER NOT NULL DEFAULT 0,
    gas_limit TEXT NOT NULL, gas_price TEXT NOT NULL, reserved_wei TEXT NOT NULL,
    status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    receipt_block_number TEXT, receipt_block_hash TEXT, receipt_status INTEGER, spent_wei TEXT,
    PRIMARY KEY(job_id,phase))`,
  ledger: `CREATE TABLE IF NOT EXISTS gas_refill_ledger (
    scope TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, amount TEXT NOT NULL,
    occurred_at INTEGER NOT NULL, PRIMARY KEY(scope,kind,ref))`,
};

const stop = (reason) => { throw new Error(reason); };
const lower = (value) => String(value).toLowerCase();
const addressEq = (a, b) => lower(a) === lower(b);
const safeReason = (reason) => PUBLIC_REASONS.has(reason) ? reason : "internal_error";
const changed = (result) => Number(result?.meta?.changes || 0) === 1;
const ceilDiv = (a, b) => (a + b - 1n) / b;
const quoteRaw = (value, sqrtPriceX96, token0Out) => token0Out
  ? ceilDiv(value * sqrtPriceX96 * sqrtPriceX96, Q192)
  : ceilDiv(value * Q192, sqrtPriceX96 * sqrtPriceX96);

function config(env, testConfig = null) {
  if (env.GAS_REFILL_ENABLED !== "true" || !env.GAS_REFILL_PRIVATE_KEY) {
    return { enabled: false, reason: "disabled" };
  }
  if (!env.DB) return { enabled: false, reason: "not_configured" };
  try {
    const { chainId: _chainId, rpcUrl: _rpcUrl, ...addresses } = PRODUCTION;
    const fixed = testConfig ? { ...addresses, ...testConfig.identities } : addresses;
    const chainId = testConfig?.chainId ?? PRODUCTION.chainId;
    const rpcUrl = testConfig?.rpcUrl ?? PRODUCTION.rpcUrl;
    const wallet = new Wallet(env.GAS_REFILL_PRIVATE_KEY);
    const rpc = new URL(rpcUrl);
    if (!Number.isSafeInteger(chainId) || chainId <= 0 ||
        (rpc.protocol !== "https:" && !(testConfig && rpc.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(rpc.hostname)))) {
      return { enabled: false, reason: "invalid_configuration" };
    }
    const normalized = Object.fromEntries(Object.entries(fixed).map(([name, address]) => [name, getAddress(address)]));
    if (!addressEq(wallet.address, normalized.bot) || addressEq(wallet.address, normalized.treasury) ||
        addressEq(wallet.address, normalized.beneficiary)) {
      return { enabled: false, reason: "invalid_configuration" };
    }
    const request = new FetchRequest(rpc.href);
    request.timeout = RPC_TIMEOUT_MS;
    const provider = new JsonRpcProvider(request, chainId,
      { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 });
    return { enabled: true, ...normalized, chainId, wallet, provider, db: env.DB,
      now: testConfig?.now || Date.now, scope: chainId + ":" + wallet.address.toLowerCase(),
      testing: Boolean(testConfig), hooks: testConfig?.hooks || {} };
  } catch {
    return { enabled: false, reason: "invalid_configuration" };
  }
}

async function ensureSchema(db) {
  for (const statement of Object.values(sql)) await db.prepare(statement).run();
}

async function acquireLease(db, cfg, leaseToken) {
  const now = cfg.now();
  const result = await db.prepare(
    "INSERT INTO gas_refill_locks(scope,lease_token,lease_until,last_cycle_reason) VALUES(?,?,?,'running') " +
    "ON CONFLICT(scope) DO UPDATE SET lease_token=excluded.lease_token,lease_until=excluded.lease_until,last_cycle_reason='running' " +
    "WHERE gas_refill_locks.lease_until<=?"
  ).bind(cfg.scope, leaseToken, now + LEASE_MS, now).run();
  return changed(result);
}

async function renewLease(db, cfg, token) {
  const now = cfg.now();
  const result = await db.prepare(
    "UPDATE gas_refill_locks SET lease_until=? WHERE scope=? AND lease_token=? AND lease_until>?"
  ).bind(now + LEASE_MS, cfg.scope, token, now).run();
  if (!changed(result)) stop("locked");
}

const LEASE_GUARD = "EXISTS(SELECT 1 FROM gas_refill_locks WHERE scope=? AND lease_token=? AND lease_until>?)";
const NO_PENDING_GUARD = "NOT EXISTS(SELECT 1 FROM gas_refill_transactions WHERE job_id=? AND status IN ('staged','broadcast','mined','orphaned'))";

function leasedUpdate(db, cfg, token, statement, values) {
  return db.prepare(statement + " AND " + LEASE_GUARD)
    .bind(...values, cfg.scope, token, cfg.now());
}

async function finishCycle(db, cfg, token, reason) {
  try {
    await db.prepare(
      "UPDATE gas_refill_locks SET lease_until=0,last_cycle_at=?,last_cycle_reason=? WHERE scope=? AND lease_token=?"
    ).bind(new Date(cfg.now()).toISOString(), safeReason(reason), cfg.scope, token).run();
  } catch { /* The next invocation can acquire the expiring lease. */ }
}

async function validateNetwork(cfg) {
  const network = Number(BigInt(await cfg.provider.send("eth_chainId", [])));
  if (network !== cfg.chainId) stop("wrong_chain");
  const [decimals, wethDecimals, routerFactory, routerWeth, poolFactory,
    token0, token1, fee, factoryPool, botCode, beneficiaryCode] = await Promise.all([
    new Contract(cfg.usdc, TOKEN_ABI, cfg.provider).decimals(),
    new Contract(cfg.weth, WETH_ABI, cfg.provider).decimals(),
    new Contract(cfg.router, ROUTER_ABI, cfg.provider).factory(),
    new Contract(cfg.router, ROUTER_ABI, cfg.provider).WETH9(),
    new Contract(cfg.pool, POOL_ABI, cfg.provider).factory(),
    new Contract(cfg.pool, POOL_ABI, cfg.provider).token0(),
    new Contract(cfg.pool, POOL_ABI, cfg.provider).token1(),
    new Contract(cfg.pool, POOL_ABI, cfg.provider).fee(),
    new Contract(cfg.factory, FACTORY_ABI, cfg.provider).getPool(cfg.usdc, cfg.weth, 500),
    cfg.provider.getCode(cfg.wallet.address),
    cfg.provider.getCode(cfg.beneficiary),
  ]);
  if (botCode !== "0x" || beneficiaryCode !== "0x") stop("wrong_protocol");
  if (BigInt(decimals) !== 6n || BigInt(wethDecimals) !== 18n) stop("wrong_token");
  if (!addressEq(routerFactory, cfg.factory) || !addressEq(routerWeth, cfg.weth)) stop("wrong_protocol");
  if (!addressEq(poolFactory, cfg.factory) || Number(fee) !== 500 ||
      !addressEq(factoryPool, cfg.pool)) stop("wrong_pool");
  const expected = [cfg.usdc, cfg.weth].map((a) => BigInt(a.toLowerCase())).sort((a, b) => a < b ? -1 : 1);
  if (BigInt(token0.toLowerCase()) !== expected[0] || BigInt(token1.toLowerCase()) !== expected[1]) stop("wrong_pool");
  return { token0: getAddress(token0), token1: getAddress(token1) };
}

async function quote(cfg, pair, outputEth) {
  const pool = new Contract(cfg.pool, POOL_ABI, cfg.provider);
  if (BigInt(await pool.liquidity()) <= 0n) stop("wrong_pool");
  let observed;
  try { observed = await pool.observe([TWAP_WINDOW, 0]); }
  catch { stop("twap_unavailable"); }
  if (!observed?.tickCumulatives || observed.tickCumulatives.length !== 2) stop("twap_unavailable");
  const seconds = BigInt(TWAP_WINDOW);
  const delta = BigInt(observed.tickCumulatives[1]) - BigInt(observed.tickCumulatives[0]);
  let twap = delta / seconds;
  if (delta < 0n && delta % seconds !== 0n) twap -= 1n;
  const [spotSqrtRaw, spotTickRaw] = await pool.slot0();
  const spotTick = Number(spotTickRaw);
  const gap = BigInt(spotTick) - twap;
  if (gap > BigInt(MAX_TICK_GAP) || gap < -BigInt(MAX_TICK_GAP)) stop("price_gap");
  if (spotTick >= 887272 || spotTick < -887272) stop("quote_unavailable");
  const spotSqrt = BigInt(spotSqrtRaw);
  const twapSqrt = sqrtRatioAtTick(Number(twap));
  // zeroForOne crossing can leave sqrtPrice exactly at tick + 1 with tick decremented.
  if (spotSqrt < sqrtRatioAtTick(spotTick) || spotSqrt > sqrtRatioAtTick(spotTick + 1) ||
      twapSqrt <= 0n) stop("quote_unavailable");
  // WETH is token0 on World Chain. Keep the generic ordering check for explicit test fixtures.
  const outputIsToken0 = addressEq(cfg.weth, pair.token0);
  const spotInput = quoteRaw(outputEth, spotSqrt, outputIsToken0);
  const twapInput = quoteRaw(outputEth, twapSqrt, outputIsToken0);
  // The maximum is anchored to TWAP, including the 0.05% pool fee; spot cannot widen it.
  const inputMax = ceilDiv(twapInput * (BPS + MAX_SLIPPAGE_BPS) * 1_000_000n,
    BPS * (1_000_000n - 500n));
  if (spotInput > inputMax) stop("price_gap");
  if (inputMax <= 0n || inputMax > INPUT_CAP) stop("quote_exceeds_budget");
  return { amountInMax: inputMax, twapTick: Number(twap), spotTick: Number(spotTick) };
}

// Uniswap V3 TickMath.getSqrtRatioAtTick with canonical Q128 constants and round-up to Q96.
function sqrtRatioAtTick(tick) {
  const abs = Math.abs(tick);
  if (!Number.isInteger(tick) || abs > 887272) stop("quote_unavailable");
  const constants = [
    0xfffcb933bd6fad37aa2d162d1a594001n, 0xfff97272373d413259a46990580e213an,
    0xfff2e50f5f656932ef12357cf3c7fdccn, 0xffe5caca7e10e4e61c3624eaa0941cd0n,
    0xffcb9843d60f6159c9db58835c926644n, 0xff973b41fa98c081472e6896dfb254c0n,
    0xff2ea16466c96a3843ec78b326b52861n, 0xfe5dee046a99a2a811c461f1969c3053n,
    0xfcbe86c7900a88aedcffc83b479aa3a4n, 0xf987a7253ac413176f2b074cf7815e54n,
    0xf3392b0822b70005940c7a398e4b70f3n, 0xe7159475a2c29b7443b29c7fa6e889d9n,
    0xd097f3bdfd2022b8845ad8f792aa5825n, 0xa9f746462d870fdf8a65dc1f90e061e5n,
    0x70d869a156d2a1b890bb3df62baf32f7n, 0x31be135f97d08fd981231505542fcfa6n,
    0x9aa508b5b7a84e1c677de54f3e99bc9n, 0x5d6af8dedb81196699c329225ee604n,
    0x2216e584f5fa1ea926041bedfe98n, 0x48a170391f7dc42444e8fa2n,
  ];
  let ratio = (abs & 1) ? constants[0] : (1n << 128n);
  for (let i = 1; i < constants.length; i++) if (abs & (1 << i)) ratio = (ratio * constants[i]) >> 128n;
  if (tick > 0) ratio = ((1n << 256n) - 1n) / ratio;
  const remainder = ratio & ((1n << 32n) - 1n);
  return (ratio >> 32n) + (remainder === 0n ? 0n : 1n);
}

async function readBalances(cfg) {
  const [keeper, bot, botUsdc] = await Promise.all([
    cfg.provider.getBalance(cfg.beneficiary),
    cfg.provider.getBalance(cfg.wallet.address),
    new Contract(cfg.usdc, TOKEN_ABI, cfg.provider).balanceOf(cfg.wallet.address),
  ]);
  return { keeper: BigInt(keeper), bot: BigInt(bot), botUsdc: BigInt(botUsdc) };
}

async function rollingAmount(db, scope, kind, since) {
  const spent = await db.prepare(
    "SELECT COALESCE(SUM(CAST(amount AS INTEGER)),0) AS total FROM gas_refill_ledger WHERE scope=? AND kind=? AND occurred_at>?"
  ).bind(scope, kind, since).first();
  const reserved = await db.prepare(
    "SELECT COALESCE(SUM(CAST(" + (kind === "input" ? "input_reserved" : "gas_reserved") +
      " AS INTEGER)),0) AS total FROM gas_refill_jobs WHERE scope=? AND state IN ('active','blocked')"
  ).bind(scope).first();
  return BigInt(spent?.total || 0) + BigInt(reserved?.total || 0);
}

async function activeJob(db, scope) {
  return db.prepare("SELECT * FROM gas_refill_jobs WHERE scope=? AND state IN ('active','blocked') ORDER BY created_at LIMIT 1")
    .bind(scope).first();
}

async function refreshGasReservation(db, cfg, token, job) {
  await renewLease(db, cfg, token);
  const result = await db.prepare(
    "UPDATE gas_refill_jobs SET gas_reserved=MAX(CAST(gas_reserved AS INTEGER),MIN(CAST(? AS INTEGER),CAST(gas_spent AS INTEGER)+MAX(0,? - " +
    "(SELECT COALESCE(SUM(CAST(amount AS INTEGER)),0) FROM gas_refill_ledger WHERE scope=? AND kind='gas' AND occurred_at>?) - " +
    "(SELECT COALESCE(SUM(MAX(0,CAST(gas_reserved AS INTEGER)-CAST(gas_spent AS INTEGER))),0) FROM gas_refill_jobs WHERE scope=? AND job_id<>? AND state IN ('active','blocked'))))),updated_at=? " +
    "WHERE job_id=? AND state='active' AND EXISTS(SELECT 1 FROM gas_refill_locks WHERE scope=? AND lease_token=? AND lease_until>?)"
  ).bind(DAILY_GAS_CAP.toString(), DAILY_GAS_CAP.toString(), cfg.scope, cfg.now() - ROLLING_MS,
    cfg.scope, job.job_id, cfg.now(), job.job_id, cfg.scope, token, cfg.now()).run();
  if (!changed(result)) stop("locked");
  return db.prepare("SELECT * FROM gas_refill_jobs WHERE job_id=?").bind(job.job_id).first();
}

async function pendingTransaction(db, jobId) {
  const marks = PENDING_TX_STATES.map(() => "?").join(",");
  return db.prepare("SELECT * FROM gas_refill_transactions WHERE job_id=? AND status IN (" + marks + ") ORDER BY created_at LIMIT 1")
    .bind(jobId, ...PENDING_TX_STATES).first();
}

function phaseData(cfg, job, phase, amount, deadline) {
  if (phase === "pull") return { to: cfg.usdc, data: TOKEN_INTERFACE.encodeFunctionData("transferFrom", [cfg.treasury, cfg.wallet.address, BigInt(job.pull_amount)]), value: 0n };
  if (["clear_approval", "revoke", "cancel_revoke"].includes(phase)) {
    return { to: cfg.usdc, data: TOKEN_INTERFACE.encodeFunctionData("approve", [cfg.router, 0n]), value: 0n };
  }
  if (phase === "approve") return { to: cfg.usdc, data: TOKEN_INTERFACE.encodeFunctionData("approve", [cfg.router, BigInt(job.amount_in_max)]), value: 0n };
  if (phase === "swap") {
    const exact = ROUTER_INTERFACE.encodeFunctionData("exactOutputSingle", [{
      tokenIn: cfg.usdc, tokenOut: cfg.weth, fee: 500, recipient: cfg.router,
      amountOut: BigInt(job.output_eth), amountInMaximum: BigInt(job.amount_in_max), sqrtPriceLimitX96: 0,
    }]);
    const unwrap = ROUTER_INTERFACE.encodeFunctionData("unwrapWETH9", [BigInt(job.output_eth), cfg.wallet.address]);
    return { to: cfg.router, data: ROUTER_INTERFACE.encodeFunctionData("multicall", [deadline, [exact, unwrap]]), value: 0n };
  }
  if (phase === "payout") return { to: cfg.beneficiary, data: "0x", value: amount };
  stop("recovery_invalid");
}

function validateRaw(cfg, job, row) {
  try {
    if (!row?.tx_raw || !row.tx_hash) stop("recovery_invalid");
    const amountInMax = BigInt(job.amount_in_max);
    const pullAmount = BigInt(job.pull_amount);
    const payout = BigInt(job.payout_eth);
    const output = BigInt(job.output_eth);
    const nativeOnly = amountInMax === 0n && output === 0n && pullAmount === 0n;
    if (!addressEq(job.keeper_address, cfg.beneficiary) || !Object.hasOwn(PHASE_GAS_LIMITS, job.phase) ||
        row.phase !== job.phase || amountInMax < 0n || amountInMax > INPUT_CAP ||
        (amountInMax === 0n || output === 0n) && !(nativeOnly && row.phase === "payout") ||
        BigInt(job.input_reserved) < 0n || BigInt(job.input_reserved) > INPUT_CAP ||
        pullAmount < 0n || pullAmount > INPUT_CAP || payout <= 0n || payout > MAX_PAYOUT ||
        output < 0n || output > MAX_PAYOUT + BOT_TARGET + DAILY_GAS_CAP ||
        BigInt(job.gas_reserved) < 0n || BigInt(job.gas_reserved) > DAILY_GAS_CAP ||
        BigInt(job.gas_spent) < 0n || BigInt(job.gas_spent) > DAILY_GAS_CAP) stop("recovery_invalid");
    const tx = Transaction.from(row.tx_raw);
    if (!tx.isSigned() || !tx.from || !addressEq(tx.from, cfg.wallet.address) ||
        tx.chainId !== BigInt(cfg.chainId) || tx.type !== 0 || Number(tx.nonce) !== Number(row.nonce) ||
        !Number.isSafeInteger(Number(tx.nonce)) || Number(tx.nonce) < 0 || tx.to == null || tx.gasLimit <= 0n ||
        tx.gasLimit > (PHASE_GAS_LIMITS[row.phase] || 0n) ||
        tx.gasPrice == null || tx.gasPrice <= 0n || tx.gasPrice > GAS_PRICE_CAP ||
        tx.hash !== row.tx_hash || keccak256(row.tx_raw) !== row.tx_hash) stop("recovery_invalid");
    const deadline = Number(row.deadline || 0);
    const data = phaseData(cfg, job, row.phase, BigInt(row.tx_amount), deadline);
    if (!addressEq(tx.to, data.to) || tx.data !== data.data || tx.value !== data.value ||
        BigInt(row.tx_amount) < 0n || BigInt(row.reserved_wei) < tx.gasLimit * tx.gasPrice ||
        BigInt(row.reserved_wei) > DAILY_GAS_CAP || Number(tx.gasLimit) !== Number(BigInt(row.gas_limit)) ||
        tx.gasPrice !== BigInt(row.gas_price)) stop("recovery_invalid");
    if (row.phase === "swap" && (deadline <= 0 || deadline > Math.floor(Number(row.created_at) / 1000) + MAX_DEADLINE_SECONDS)) {
      stop("recovery_invalid");
    }
    if (BigInt(job.gas_reserved) < BigInt(job.gas_spent) + BigInt(row.reserved_wei)) stop("recovery_invalid");
    if (row.phase === "swap" && deadline <= Math.floor(Number(row.created_at) / 1000) ||
        row.phase === "payout" && BigInt(row.tx_amount) > MAX_PAYOUT ||
        row.phase === "pull" && BigInt(row.tx_amount) !== BigInt(job.pull_amount) ||
        row.phase === "approve" && BigInt(row.tx_amount) !== BigInt(job.amount_in_max) ||
        ["clear_approval", "revoke", "cancel_revoke"].includes(row.phase) && BigInt(row.tx_amount) !== 0n ||
        row.phase === "swap" && BigInt(row.tx_amount) !== BigInt(job.output_eth)) stop("recovery_invalid");
    return tx;
  } catch (error) {
    if (PUBLIC_REASONS.has(error.message)) throw error;
    stop("recovery_invalid");
  }
}

function verifyReceiptLogs(cfg, job, row, receipt) {
  if (row.phase === "pull") {
    const events = receipt.logs.filter((log) => addressEq(log.address, cfg.usdc)).map((log) => {
      try { return TOKEN_INTERFACE.parseLog(log); } catch { return null; }
    }).filter(Boolean);
    return events.some((event) => event.name === "Transfer" && addressEq(event.args.from, cfg.treasury) &&
      addressEq(event.args.to, cfg.wallet.address) && event.args.value === BigInt(job.pull_amount));
  }
  if (["clear_approval", "approve", "revoke", "cancel_revoke"].includes(row.phase)) {
    const expected = row.phase === "approve" ? BigInt(job.amount_in_max) : 0n;
    const events = receipt.logs.filter((log) => addressEq(log.address, cfg.usdc)).map((log) => {
      try { return TOKEN_INTERFACE.parseLog(log); } catch { return null; }
    }).filter(Boolean);
    return events.some((event) => event.name === "Approval" && addressEq(event.args.owner, cfg.wallet.address) &&
      addressEq(event.args.spender, cfg.router) && event.args.value === expected);
  }
  if (row.phase === "swap") {
    const events = receipt.logs.filter((log) => addressEq(log.address, cfg.pool)).map((log) => {
      try { return POOL_INTERFACE.parseLog(log); } catch { return null; }
    }).filter(Boolean);
    const swap = events.find((event) => event.name === "Swap");
    if (!swap) return false;
    const usdcDelta = addressEq(cfg.usdc, cfgPairToken0(cfg)) ? BigInt(swap.args.amount0) : BigInt(swap.args.amount1);
    const wethDelta = addressEq(cfg.weth, cfgPairToken0(cfg)) ? BigInt(swap.args.amount0) : BigInt(swap.args.amount1);
    const input = usdcDelta > 0n ? usdcDelta : 0n;
    const output = wethDelta < 0n ? -wethDelta : 0n;
    return addressEq(swap.args.sender, cfg.router) && addressEq(swap.args.recipient, cfg.router) &&
      input > 0n && input <= BigInt(job.amount_in_max) && output === BigInt(job.output_eth);
  }
  return row.phase === "payout";
}

// token0 is stored from validated production identity; the same function supports injected test pools.
function cfgPairToken0(cfg) { return cfg.token0; }

async function txExtraFee(cfg, raw) {
  if (cfg.chainId !== 480) return 0n;
  const tx = typeof raw === "string" ? Transaction.from(raw) : raw;
  const oracle = new Contract(ORACLE_ADDRESS, ORACLE_ABI, cfg.provider);
  const l1 = await oracle.getL1Fee(tx.unsignedSerialized);
  let operator = 0n;
  try { operator = await oracle.getOperatorFee(tx.gasLimit); }
  catch (error) { if (!isExecutionRevert(error)) stop("quote_unavailable"); }
  return BigInt(l1) + BigInt(operator);
}

async function plannedGasReserve(cfg, job, pullAmount, routerAllowance, gasPrice, now) {
  const phases = job.phase === "payout" ? ["payout"] : [
    ...(pullAmount > 0n ? ["pull"] : []),
    ...(routerAllowance > 0n ? ["clear_approval"] : []),
    "approve", "swap", "revoke", "payout",
  ];
  let total = 0n;
  for (const phase of phases) {
    const amount = phase === "pull" ? pullAmount
      : phase === "approve" ? BigInt(job.amount_in_max)
        : phase === "swap" ? BigInt(job.output_eth)
          : phase === "payout" ? BigInt(job.payout_eth) : 0n;
    const deadline = phase === "swap" ? Math.floor(now / 1000) + MAX_DEADLINE_SECONDS : 0;
    const request = phaseData(cfg, job, phase, amount, deadline);
    const limit = PHASE_GAS_LIMITS[phase];
    const unsigned = Transaction.from({ ...request, chainId: cfg.chainId, type: 0,
      nonce: 0, gasLimit: limit, gasPrice });
    total += limit * gasPrice + await txExtraFee(cfg, unsigned);
  }
  return total;
}

async function receiptGasCost(cfg, row, receipt) {
  if (receipt.effectiveGasPrice == null) stop("receipt_mismatch");
  let total = BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice);
  if (cfg.chainId !== 480) return total;
  const oracle = new Contract(ORACLE_ADDRESS, ORACLE_ABI, cfg.provider);
  if (receipt.l1Fee != null) total += BigInt(receipt.l1Fee);
  else total += BigInt(await oracle.getL1Fee(Transaction.from(row.tx_raw).unsignedSerialized,
    { blockTag: receipt.blockNumber }));
  if (receipt.operatorFee != null) total += BigInt(receipt.operatorFee);
  else if (BigInt(receipt.operatorFeeScalar || 0) !== 0n || BigInt(receipt.operatorFeeConstant || 0) !== 0n) {
    total += BigInt(await oracle.getOperatorFee(BigInt(receipt.gasUsed), { blockTag: receipt.blockNumber }));
  }
  return total;
}

async function markBlocked(db, cfg, token, job, reason, options = {}) {
  await renewLease(db, cfg, token);
  const result = await leasedUpdate(db, cfg, token,
    "UPDATE gas_refill_jobs SET state='blocked',gas_reserved=CASE WHEN ?=1 AND " + NO_PENDING_GUARD +
    " THEN '0' ELSE gas_reserved END,updated_at=?,last_error=? WHERE job_id=? AND state='active' AND phase=?",
    [options.releaseGas ? 1 : 0, job.job_id, cfg.now(), safeReason(reason), job.job_id, job.phase]).run();
  if (!changed(result)) stop("locked");
  return { reason: safeReason(reason), phase: job.phase };
}

async function recordConfirmed(db, cfg, token, job, row, receipt, cost) {
  await renewLease(db, cfg, token);
  const nextPhase = row.phase === "pull" ? "approve"
    : row.phase === "clear_approval" ? "approve"
      : row.phase === "approve" ? "swap"
        : row.phase === "swap" ? "revoke"
          : row.phase === "revoke" ? "payout"
            : row.phase === "cancel_revoke" || row.phase === "payout" ? "done" : null;
  const status = BigInt(receipt.status);
  const proof = status === 1n && verifyReceiptLogs(cfg, job, row, receipt);
  const overrun = cost > BigInt(row.reserved_wei) || BigInt(job.gas_spent) + cost > DAILY_GAS_CAP;
  const failure = status !== 1n ? "transaction_reverted"
    : !proof ? "receipt_mismatch" : overrun ? "gas_budget_overrun"
      : !nextPhase ? "recovery_invalid" : null;
  const updates = [
    leasedUpdate(db, cfg, token,
      "UPDATE gas_refill_transactions SET status=?,receipt_block_number=?,receipt_block_hash=?,receipt_status=?,spent_wei=?,updated_at=? WHERE tx_hash=? AND status IN ('staged','broadcast','mined','orphaned')",
      [status === 1n ? "confirmed" : "reverted", String(receipt.blockNumber), receipt.blockHash,
        status === 1n ? 1 : 0, cost.toString(), cfg.now(), row.tx_hash]),
    db.prepare("INSERT INTO gas_refill_ledger(scope,kind,ref,amount,occurred_at) SELECT ?,'gas',?,?,? WHERE " + LEASE_GUARD +
      " ON CONFLICT(scope,kind,ref) DO UPDATE SET amount=MAX(CAST(gas_refill_ledger.amount AS INTEGER),CAST(excluded.amount AS INTEGER)),occurred_at=MAX(gas_refill_ledger.occurred_at,excluded.occurred_at)")
      .bind(cfg.scope, row.tx_hash, cost.toString(), cfg.now(), cfg.scope, token, cfg.now()),
  ];
  if (failure) {
    if (row.phase === "swap" && status === 0n && !overrun) {
      // Consume the persisted nonce once, revoke approval, and retain the pulled USDC for reuse.
      updates.push(leasedUpdate(db, cfg, token,
        "UPDATE gas_refill_jobs SET phase='cancel_revoke',gas_spent=CAST(gas_spent AS INTEGER)+CAST(? AS INTEGER),updated_at=?,last_error='transaction_reverted' WHERE job_id=? AND state='active' AND phase='swap'",
        [cost.toString(), cfg.now(), job.job_id]));
      await db.batch(updates);
      return { reason: "pending", phase: "cancel_revoke" };
    }
    updates.push(leasedUpdate(db, cfg, token,
      "UPDATE gas_refill_jobs SET state='blocked',gas_reserved='0',gas_spent=CAST(gas_spent AS INTEGER)+CAST(? AS INTEGER),updated_at=?,last_error=? WHERE job_id=? AND state='active' AND phase=?",
      [cost.toString(), cfg.now(), failure, job.job_id, row.phase]));
    await db.batch(updates);
    return { reason: failure, phase: row.phase };
  }
  if (row.phase === "swap") {
    const swap = receipt.logs.filter((log) => addressEq(log.address, cfg.pool)).map((log) => {
      try { return POOL_INTERFACE.parseLog(log); } catch { return null; }
    }).find((event) => event?.name === "Swap");
    const inputDelta = addressEq(cfg.usdc, cfg.token0) ? BigInt(swap.args.amount0) : BigInt(swap.args.amount1);
    const actualInput = inputDelta > 0n ? inputDelta : 0n;
    updates.push(leasedUpdate(db, cfg, token,
      "UPDATE gas_refill_jobs SET input_actual=?,output_actual=?,updated_at=? WHERE job_id=? AND phase='swap' AND state='active'",
      [actualInput.toString(), job.output_eth, cfg.now(), job.job_id]));
  }
  if (row.phase === "payout") updates.push(leasedUpdate(db, cfg, token,
    "UPDATE gas_refill_jobs SET payout_actual=?,updated_at=? WHERE job_id=? AND phase='payout' AND state='active'",
    [row.tx_amount, cfg.now(), job.job_id]));
  updates.push(leasedUpdate(db, cfg, token,
    "UPDATE gas_refill_jobs SET phase=?,gas_spent=CAST(gas_spent AS INTEGER)+CAST(? AS INTEGER),updated_at=?,last_error=NULL WHERE job_id=? AND state='active' AND phase=?",
    [nextPhase, cost.toString(), cfg.now(), job.job_id, row.phase]));
  if (row.phase === "cancel_revoke") updates.push(leasedUpdate(db, cfg, token,
    "UPDATE gas_refill_jobs SET last_error='swap_cancelled' WHERE job_id=? AND state='active' AND phase='done'",
    [job.job_id]));
  await db.batch(updates);
  return { reason: "pending", phase: nextPhase };
}

async function finalizeJob(db, cfg, token, job, reason) {
  await renewLease(db, cfg, token);
  const actual = BigInt(job.input_actual || 0);
  const jobGuard = "EXISTS(SELECT 1 FROM gas_refill_jobs WHERE job_id=? AND state='active' AND phase=?) AND " +
    NO_PENDING_GUARD + " AND " + LEASE_GUARD;
  const guardValues = [job.job_id, job.phase, job.job_id, cfg.scope, token, cfg.now()];
  const statements = [];
  if (actual > 0n) statements.push(db.prepare(
    "INSERT INTO gas_refill_ledger(scope,kind,ref,amount,occurred_at) SELECT ?,'input',?,?,? WHERE " + jobGuard +
    " ON CONFLICT(scope,kind,ref) DO UPDATE SET amount=MAX(CAST(gas_refill_ledger.amount AS INTEGER),CAST(excluded.amount AS INTEGER)),occurred_at=MAX(gas_refill_ledger.occurred_at,excluded.occurred_at)"
  ).bind(cfg.scope, job.job_id, actual.toString(), cfg.now(), ...guardValues));
  statements.push(db.prepare(
    "UPDATE gas_refill_jobs SET state='completed',phase='done',input_reserved='0',gas_reserved='0',updated_at=?,last_error=? WHERE job_id=? AND " + jobGuard
  ).bind(cfg.now(), safeReason(reason), job.job_id, ...guardValues));
  const results = await db.batch(statements);
  if (!changed(results.at(-1))) stop("locked");
  return { reason: safeReason(reason), phase: "done" };
}

async function reconcilePending(db, cfg, token, job, row) {
  let tx;
  try { tx = validateRaw(cfg, job, row); }
  catch { return markBlocked(db, cfg, token, job, "recovery_invalid"); }
  let receipt;
  try { receipt = await cfg.provider.send("eth_getTransactionReceipt", [row.tx_hash]); }
  catch { return { reason: "pending", phase: row.phase }; }
  if (receipt) {
    if (receipt.transactionHash !== row.tx_hash || !/^0x[\da-f]{64}$/i.test(receipt.blockHash || "")) {
      return { reason: "receipt_mismatch", phase: row.phase };
    }
    let block;
    try { block = await cfg.provider.send("eth_getBlockByNumber", [receipt.blockNumber, false]); }
    catch { return { reason: "pending", phase: row.phase }; }
    if (block?.hash !== receipt.blockHash || BigInt(block?.number || 0) !== BigInt(receipt.blockNumber)) {
      await renewLease(db, cfg, token);
      await leasedUpdate(db, cfg, token,
        "UPDATE gas_refill_transactions SET status='orphaned',updated_at=? WHERE tx_hash=? AND status!='confirmed'",
        [cfg.now(), row.tx_hash]).run();
      receipt = null;
    } else {
      let finalized;
      try { finalized = await cfg.provider.send("eth_getBlockByNumber", ["finalized", false]); }
      catch { return { reason: "finality_unavailable", phase: row.phase }; }
      if (!finalized) return { reason: "finality_unavailable", phase: row.phase };
      if (BigInt(finalized.number) < BigInt(receipt.blockNumber)) {
        await renewLease(db, cfg, token);
        await leasedUpdate(db, cfg, token,
          "UPDATE gas_refill_transactions SET status='mined',receipt_block_number=?,receipt_block_hash=?,receipt_status=?,updated_at=? WHERE tx_hash=? AND status IN ('staged','broadcast','mined')",
          [String(receipt.blockNumber), receipt.blockHash, Number(receipt.status), cfg.now(), row.tx_hash]).run();
        return { reason: "awaiting_finality", phase: row.phase };
      }
      let cost;
      try { cost = await receiptGasCost(cfg, row, receipt); }
      catch { return { reason: "pending", phase: row.phase }; }
      // A reorg may have happened while fetching finality or historical fee data.
      let canonical;
      try { canonical = await cfg.provider.send("eth_getBlockByNumber", [receipt.blockNumber, false]); }
      catch { return { reason: "pending", phase: row.phase }; }
      if (canonical?.hash !== receipt.blockHash || BigInt(canonical?.number || 0) !== BigInt(receipt.blockNumber)) {
        await renewLease(db, cfg, token);
        await leasedUpdate(db, cfg, token,
          "UPDATE gas_refill_transactions SET status='orphaned',updated_at=? WHERE tx_hash=? AND status!='confirmed'",
          [cfg.now(), row.tx_hash]).run();
        return { reason: "pending", phase: row.phase };
      }
      return recordConfirmed(db, cfg, token, job, row, receipt, cost);
    }
  }
  let known;
  try { known = await cfg.provider.send("eth_getTransactionByHash", [row.tx_hash]); }
  catch { return { reason: "pending", phase: row.phase }; }
  if (known) {
    let knownCanonical = true;
    if (known.blockHash && known.blockNumber != null) {
      try {
        const knownBlock = await cfg.provider.send("eth_getBlockByNumber", [known.blockNumber, false]);
        if (knownBlock && knownBlock.hash !== known.blockHash) knownCanonical = false;
      } catch { return { reason: "pending", phase: row.phase }; }
    }
    if (knownCanonical) {
      if (row.status !== "broadcast") {
        await renewLease(db, cfg, token);
        await leasedUpdate(db, cfg, token,
          "UPDATE gas_refill_transactions SET status='broadcast',updated_at=? WHERE tx_hash=? AND status IN ('staged','orphaned')",
          [cfg.now(), row.tx_hash]).run();
      }
      return { reason: "pending", phase: row.phase };
    }
    await renewLease(db, cfg, token);
    await leasedUpdate(db, cfg, token,
      "UPDATE gas_refill_transactions SET status='orphaned',updated_at=? WHERE tx_hash=? AND status!='confirmed'",
      [cfg.now(), row.tx_hash]).run();
  }
  try {
    const [latest, pending] = await Promise.all([
      cfg.provider.getTransactionCount(cfg.wallet.address, "latest"),
      cfg.provider.getTransactionCount(cfg.wallet.address, "pending"),
    ]);
    if (Number(latest) > Number(row.nonce) || Number(pending) > Number(row.nonce)) {
      return { reason: "pending", phase: row.phase };
    }
    // An expired swap is broadcast unchanged: its canonical revert releases this nonce safely.
    // Likewise, a staged payout is honoured even if the keeper was funded after signing.
    const extra = await txExtraFee(cfg, row.tx_raw);
    const required = tx.gasLimit * tx.gasPrice + extra;
    const reservation = required > BigInt(row.reserved_wei) ? required : BigInt(row.reserved_wei);
    if (reservation > DAILY_GAS_CAP || BigInt(job.gas_spent) + reservation > BigInt(job.gas_reserved)) {
      return { reason: "gas_budget_exhausted", phase: row.phase };
    }
    if (await cfg.provider.getBalance(cfg.wallet.address, "pending") <
        required + tx.value + (row.phase === "payout" ? BOT_TARGET : 0n)) {
      return { reason: "insufficient_bot_gas", phase: row.phase };
    }
    await renewLease(db, cfg, token);
    if (reservation > BigInt(row.reserved_wei)) {
      const updated = await db.prepare("UPDATE gas_refill_transactions SET reserved_wei=?,updated_at=? WHERE tx_hash=? AND status IN ('staged','broadcast','mined','orphaned') " +
        "AND EXISTS(SELECT 1 FROM gas_refill_locks WHERE scope=? AND lease_token=? AND lease_until>?)")
        .bind(reservation.toString(), cfg.now(), row.tx_hash, cfg.scope, token, cfg.now()).run();
      if (!changed(updated)) return { reason: "locked", phase: row.phase };
    }
  } catch (error) {
    if (error.message === "recovery_invalid") return markBlocked(db, cfg, token, job, "recovery_invalid");
    if (PUBLIC_REASONS.has(error.message)) return { reason: error.message, phase: row.phase };
    return { reason: "pending", phase: row.phase };
  }
  // Re-broadcast only this persisted signature. A changed transaction is never signed as a replacement.
  try {
    const hash = await cfg.provider.send("eth_sendRawTransaction", [row.tx_raw]);
    if (!addressEq(hash, row.tx_hash)) return markBlocked(db, cfg, token, job, "recovery_invalid");
  } catch { /* A dropped acknowledgement is recovered through this same row and signature. */ }
  await renewLease(db, cfg, token);
  await leasedUpdate(db, cfg, token,
    "UPDATE gas_refill_transactions SET status='broadcast',updated_at=? WHERE tx_hash=? AND status IN ('staged','orphaned')",
    [cfg.now(), row.tx_hash]).run();
  return { reason: "pending", phase: row.phase };
}

async function simulateAndEstimate(cfg, job, phase, amount, deadline) {
  const request = phaseData(cfg, job, phase, amount, deadline);
  try { await cfg.provider.call({ ...request, from: cfg.wallet.address }); }
  catch (error) {
    if (isExecutionRevert(error)) stop("simulation_failed");
    stop("rpc_unavailable");
  }
  let estimate;
  try { estimate = BigInt(await cfg.provider.estimateGas({ ...request, from: cfg.wallet.address })); }
  catch (error) {
    if (isExecutionRevert(error)) stop("simulation_failed");
    stop("rpc_unavailable");
  }
  const limit = ceilDiv(estimate * 120n, 100n);
  if (limit <= 0n || limit > PHASE_GAS_LIMITS[phase]) stop("gas_cap");
  return { request, gasLimit: limit };
}

async function hasPullBudget(cfg, amount) {
  const tokenContract = new Contract(cfg.usdc, TOKEN_ABI, cfg.provider);
  const [available, allowance] = await Promise.all([
    tokenContract.balanceOf(cfg.treasury), tokenContract.allowance(cfg.treasury, cfg.wallet.address),
  ]);
  return BigInt(available) >= amount && BigInt(allowance) >= amount;
}

async function stageAndBroadcast(db, cfg, token, job, phase, amount) {
  const now = cfg.now();
  const deadline = phase === "swap" ? Math.floor(now / 1000) + MAX_DEADLINE_SECONDS : 0;
  let prepared;
  try { prepared = await simulateAndEstimate(cfg, job, phase, amount, deadline); }
  catch (error) {
    if (phase === "pull" && error.message === "simulation_failed") {
      // Funds can change between the precheck and simulation; a proven shortfall still waits.
      try { if (!await hasPullBudget(cfg, amount)) return { reason: "awaiting_budget", phase }; }
      catch { return { reason: "rpc_unavailable", phase }; }
    }
    if (phase === "swap" && error.message === "simulation_failed") {
      await renewLease(db, cfg, token);
      const cancelled = await leasedUpdate(db, cfg, token,
        "UPDATE gas_refill_jobs SET phase='cancel_revoke',updated_at=?,last_error='simulation_failed' WHERE job_id=? AND state='active' AND phase='swap' AND " + NO_PENDING_GUARD,
        [cfg.now(), job.job_id, job.job_id]).run();
      if (!changed(cancelled)) stop("locked");
      return { reason: "pending", phase: "cancel_revoke" };
    }
    if (["simulation_failed", "gas_cap"].includes(error.message)) {
      return markBlocked(db, cfg, token, job, error.message, { releaseGas: true });
    }
    if (PUBLIC_REASONS.has(error.message)) return { reason: error.message, phase };
    return { reason: "rpc_unavailable", phase };
  }
  let gasPrice;
  try { gasPrice = BigInt(await cfg.provider.send("eth_gasPrice", [])); }
  catch { return { reason: "rpc_unavailable", phase }; }
  if (gasPrice <= 0n || gasPrice > GAS_PRICE_CAP) return { reason: "fee_cap", phase };
  const [latest, pending] = await Promise.all([
    cfg.provider.getTransactionCount(cfg.wallet.address, "latest"),
    cfg.provider.getTransactionCount(cfg.wallet.address, "pending"),
  ]);
  if (Number(latest) !== Number(pending)) return { reason: "nonce_conflict", phase };
  const unsigned = { to: prepared.request.to, data: prepared.request.data, value: prepared.request.value,
    chainId: cfg.chainId, type: 0, nonce: Number(pending), gasLimit: prepared.gasLimit, gasPrice };
  const unsignedRaw = await cfg.wallet.signTransaction(unsigned);
  let extra;
  try { extra = await txExtraFee(cfg, unsignedRaw); }
  catch { return { reason: "quote_unavailable", phase }; }
  const reserve = prepared.gasLimit * gasPrice + extra;
  if (reserve <= 0n || reserve > DAILY_GAS_CAP || BigInt(job.gas_spent) + reserve > BigInt(job.gas_reserved)) {
    return { reason: "gas_budget_exhausted", phase };
  }
  const balanceRequired = reserve + prepared.request.value + (phase === "payout" ? BOT_TARGET : 0n);
  if (await cfg.provider.getBalance(cfg.wallet.address, "pending") < balanceRequired) return { reason: "insufficient_bot_gas", phase };
  const raw = unsignedRaw;
  const hash = keccak256(raw);
  const txAmount = amount.toString();
  const row = { job_id: job.job_id, phase, tx_hash: hash, tx_raw: raw, nonce: Number(pending), tx_amount: txAmount,
    deadline, gas_limit: prepared.gasLimit.toString(), gas_price: gasPrice.toString(), reserved_wei: reserve.toString(),
    status: "staged", created_at: now, updated_at: now };
  try {
    validateRaw(cfg, job, row);
    await renewLease(db, cfg, token);
    const staged = await db.batch([
      db.prepare("INSERT INTO gas_refill_transactions(job_id,phase,tx_hash,tx_raw,nonce,tx_amount,deadline,gas_limit,gas_price,reserved_wei,status,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? " +
        "WHERE EXISTS(SELECT 1 FROM gas_refill_jobs WHERE job_id=? AND state='active' AND phase=?) AND " + LEASE_GUARD)
        .bind(job.job_id, phase, hash, raw, Number(pending), txAmount, deadline, prepared.gasLimit.toString(), gasPrice.toString(), reserve.toString(), "staged", now, now,
          job.job_id, phase, cfg.scope, token, cfg.now()),
      db.prepare("UPDATE gas_refill_jobs SET updated_at=? WHERE job_id=? AND state='active' AND phase=? AND EXISTS(SELECT 1 FROM gas_refill_locks WHERE scope=? AND lease_token=? AND lease_until>?)")
        .bind(now, job.job_id, phase, cfg.scope, token, now),
    ]);
    if (!changed(staged[0]) || !changed(staged[1])) return { reason: "locked", phase };
  } catch (error) {
    if (error.message === "recovery_invalid") return markBlocked(db, cfg, token, job, "recovery_invalid", { releaseGas: true });
    if (PUBLIC_REASONS.has(error.message)) return { reason: error.message, phase };
    return { reason: "storage_unavailable", phase };
  }
  if (cfg.testing && cfg.hooks.afterStage) await cfg.hooks.afterStage({ ...row }, db);
  await renewLease(db, cfg, token);
  try {
    const sentHash = await cfg.provider.send("eth_sendRawTransaction", [raw]);
    if (!addressEq(sentHash, hash)) return markBlocked(db, cfg, token, job, "recovery_invalid");
    await renewLease(db, cfg, token);
    await leasedUpdate(db, cfg, token,
      "UPDATE gas_refill_transactions SET status='broadcast',updated_at=? WHERE tx_hash=? AND status='staged'",
      [cfg.now(), hash]).run();
  } catch { /* The signed row is durable; the next invocation queries before reusing it. */ }
  return { reason: "refill_started", phase };
}

async function createJob(db, cfg, token, pair, balances) {
  const payout = KEEPER_TARGET - balances.keeper;
  if (payout <= 0n || payout > MAX_PAYOUT) stop("quote_unavailable");
  if (balances.bot < BOT_MIN) stop("insufficient_bot_gas");
  const now = cfg.now();
  let gasPrice;
  try { gasPrice = BigInt(await cfg.provider.send("eth_gasPrice", [])); }
  catch { stop("rpc_unavailable"); }
  if (gasPrice <= 0n || gasPrice > GAS_PRICE_CAP) stop("fee_cap");
  const nativePlan = { phase: "payout", payout_eth: payout.toString() };
  let payoutGas;
  try { payoutGas = await plannedGasReserve(cfg, nativePlan, 0n, 0n, gasPrice, now); }
  catch { stop("quote_unavailable"); }
  if (payoutGas <= 0n || payoutGas > DAILY_GAS_CAP) stop("gas_budget_exhausted");
  const nativeOnly = balances.bot >= payout + BOT_TARGET + payoutGas;
  const outputEth = nativeOnly ? 0n : payout + BOT_TARGET + DAILY_GAS_CAP - balances.bot;
  const amountInMax = nativeOnly ? 0n : (await quote(cfg, pair, outputEth)).amountInMax;
  const pullAmount = amountInMax > balances.botUsdc ? amountInMax - balances.botUsdc : 0n;
  if (pullAmount > 0n) {
    const [treasuryBalance, allowance] = await Promise.all([
      new Contract(cfg.usdc, TOKEN_ABI, cfg.provider).balanceOf(cfg.treasury),
      new Contract(cfg.usdc, TOKEN_ABI, cfg.provider).allowance(cfg.treasury, cfg.wallet.address),
    ]);
    if (BigInt(treasuryBalance) < pullAmount || BigInt(allowance) < pullAmount) stop("awaiting_budget");
  }
  const routerAllowance = BigInt(await new Contract(cfg.usdc, TOKEN_ABI, cfg.provider)
    .allowance(cfg.wallet.address, cfg.router));
  const phase = nativeOnly ? "payout" : pullAmount > 0n ? "pull" : routerAllowance > 0n ? "clear_approval" : "approve";
  const planned = { scope: cfg.scope, phase, amount_in_max: amountInMax.toString(), pull_amount: pullAmount.toString(),
    payout_eth: payout.toString(), output_eth: outputEth.toString() };
  let gasPlan;
  try { gasPlan = await plannedGasReserve(cfg, planned, pullAmount, routerAllowance, gasPrice, now); }
  catch { stop("quote_unavailable"); }
  if (gasPlan <= 0n || gasPlan > DAILY_GAS_CAP) stop("gas_budget_exhausted");
  const [gasReserved, inputReserved] = await Promise.all([
    rollingAmount(db, cfg.scope, "gas", now - ROLLING_MS),
    rollingAmount(db, cfg.scope, "input", now - ROLLING_MS),
  ]);
  if (gasReserved + gasPlan > DAILY_GAS_CAP) stop("gas_budget_exhausted");
  if (inputReserved + amountInMax > INPUT_CAP) stop("awaiting_budget");
  const id = crypto.randomUUID();
  const job = { job_id: id, scope: cfg.scope, state: "active", phase, created_at: now, updated_at: now,
    amount_in_max: amountInMax.toString(), input_reserved: amountInMax.toString(), input_actual: "0",
    pull_amount: pullAmount.toString(), payout_eth: payout.toString(), payout_actual: "0",
    output_eth: outputEth.toString(), output_actual: "0", gas_reserved: (DAILY_GAS_CAP - gasReserved).toString(), gas_spent: "0",
    keeper_address: cfg.beneficiary, keeper_balance_start: balances.keeper.toString(), bot_balance_start: balances.bot.toString(),
    last_error: null };
  await renewLease(db, cfg, token);
  const inserted = await db.prepare(
    "INSERT INTO gas_refill_jobs(job_id,scope,state,phase,created_at,updated_at,amount_in_max,input_reserved,input_actual,pull_amount,payout_eth,payout_actual,output_eth,output_actual,gas_reserved,gas_spent,keeper_address,keeper_balance_start,bot_balance_start) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? " +
    "WHERE EXISTS(SELECT 1 FROM gas_refill_locks WHERE scope=? AND lease_token=? AND lease_until>?)"
  ).bind(id, cfg.scope, "active", phase, now, now, job.amount_in_max, job.input_reserved, "0", job.pull_amount,
    job.payout_eth, "0", job.output_eth, "0", job.gas_reserved, "0", cfg.beneficiary,
    job.keeper_balance_start, job.bot_balance_start, cfg.scope, token, cfg.now()).run();
  if (!changed(inserted)) stop("locked");
  return job;
}

async function processJob(db, cfg, token, pair, job) {
  if (job.state === "blocked") return { reason: safeReason(job.last_error || "blocked"), phase: job.phase };
  const pending = await pendingTransaction(db, job.job_id);
  if (pending) return reconcilePending(db, cfg, token, job, pending);

  let keeperBalance;
  try { keeperBalance = BigInt(await cfg.provider.getBalance(cfg.beneficiary)); }
  catch { return { reason: "rpc_unavailable", phase: job.phase }; }
  if (keeperBalance >= KEEPER_TARGET) {
    if (job.phase === "swap") {
      await renewLease(db, cfg, token);
      const cancelled = await leasedUpdate(db, cfg, token,
        "UPDATE gas_refill_jobs SET phase='cancel_revoke',updated_at=?,last_error='beneficiary_refilled' WHERE job_id=? AND state='active' AND phase='swap' AND " + NO_PENDING_GUARD,
        [cfg.now(), job.job_id, job.job_id]).run();
      if (!changed(cancelled)) stop("locked");
      job = { ...job, phase: "cancel_revoke" };
    } else if (["pull", "clear_approval", "approve"].includes(job.phase)) {
      return finalizeJob(db, cfg, token, job, "beneficiary_refilled");
    } else if (job.phase === "payout") {
      return finalizeJob(db, cfg, token, job, "beneficiary_refilled");
    }
  }
  if (job.phase === "done") return finalizeJob(db, cfg, token, job,
    BigInt(job.payout_actual || 0) > 0n ? "payout_complete"
      : job.last_error === "swap_cancelled" ? "swap_cancelled" : "beneficiary_refilled");
  if (job.phase === "payout") {
    const [currentKeeper, currentBot] = await Promise.all([
      cfg.provider.getBalance(cfg.beneficiary), cfg.provider.getBalance(cfg.wallet.address),
    ]);
    const missing = KEEPER_TARGET > BigInt(currentKeeper) ? KEEPER_TARGET - BigInt(currentKeeper) : 0n;
    let gasPrice, payoutReserve;
    try {
      gasPrice = BigInt(await cfg.provider.send("eth_gasPrice", []));
      if (gasPrice <= 0n || gasPrice > GAS_PRICE_CAP) return { reason: "fee_cap", phase: job.phase };
      payoutReserve = await plannedGasReserve(cfg, { ...job, phase: "payout" }, 0n, 0n, gasPrice, cfg.now());
    } catch { return { reason: "quote_unavailable", phase: job.phase }; }
    const retained = BOT_TARGET + payoutReserve;
    const available = BigInt(currentBot) > retained ? BigInt(currentBot) - retained : 0n;
    const amount = [missing, MAX_PAYOUT, available].reduce((smallest, value) => value < smallest ? value : smallest, MAX_PAYOUT);
    if (amount <= 0n) return { reason: "insufficient_bot_gas", phase: job.phase };
    return stageAndBroadcast(db, cfg, token, job, "payout", amount);
  }
  if (job.phase === "pull") {
    try {
      if (!await hasPullBudget(cfg, BigInt(job.pull_amount))) return { reason: "awaiting_budget", phase: job.phase };
    } catch { return { reason: "rpc_unavailable", phase: job.phase }; }
    return stageAndBroadcast(db, cfg, token, job, "pull", BigInt(job.pull_amount));
  }
  if (job.phase === "clear_approval" || job.phase === "approve" || job.phase === "revoke" || job.phase === "cancel_revoke") {
    return stageAndBroadcast(db, cfg, token, job, job.phase,
      job.phase === "approve" ? BigInt(job.amount_in_max) : 0n);
  }
  if (job.phase === "swap") {
    let fresh;
    try { fresh = await quote(cfg, pair, BigInt(job.output_eth)); }
    catch (error) { return { reason: safeReason(error.message), phase: job.phase }; }
    if (fresh.amountInMax < BigInt(job.amount_in_max)) {
      await renewLease(db, cfg, token);
      const tightened = await leasedUpdate(db, cfg, token,
        "UPDATE gas_refill_jobs SET amount_in_max=?,updated_at=? WHERE job_id=? AND state='active' AND phase='swap' AND " + NO_PENDING_GUARD,
        [fresh.amountInMax.toString(), cfg.now(), job.job_id, job.job_id]).run();
      if (!changed(tightened)) stop("locked");
      job = { ...job, amount_in_max: fresh.amountInMax.toString() };
    }
    return stageAndBroadcast(db, cfg, token, job, "swap", BigInt(job.output_eth));
  }
  return markBlocked(db, cfg, token, job, "recovery_invalid", { releaseGas: true });
}

async function runCycle(env, testConfig = null) {
  const cfg = config(env, testConfig);
  if (!cfg.enabled) return { enabled: false, reason: cfg.reason };
  let token = null;
  let reason = "internal_error";
  try {
    await ensureSchema(cfg.db);
    token = crypto.randomUUID();
    if (!await acquireLease(cfg.db, cfg, token)) return { enabled: true, reason: "locked" };
    const pair = await validateNetwork(cfg);
    cfg.token0 = pair.token0;
    let job = await activeJob(cfg.db, cfg.scope);
    if (job?.state === "blocked") {
      reason = safeReason(job.last_error || "blocked");
      return { enabled: true, reason, phase: job.phase };
    }
    if (job) {
      job = await refreshGasReservation(cfg.db, cfg, token, job);
      const result = await processJob(cfg.db, cfg, token, pair, job);
      reason = result.reason;
      return { enabled: true, ...result };
    }
    const balances = await readBalances(cfg);
    if (balances.keeper >= KEEPER_LOW) {
      reason = "healthy";
      return { enabled: true, reason };
    }
    job = await createJob(cfg.db, cfg, token, pair, balances);
    const result = await processJob(cfg.db, cfg, token, pair, job);
    reason = result.reason;
    return { enabled: true, ...result };
  } catch (error) {
    reason = safeReason(error?.message || "internal_error");
    if (reason === "internal_error") {
      const code = String(error?.code || "");
      const message = String(error?.message || "");
      if (code.startsWith("D1") || code.startsWith("SQLITE") || /database|sqlite|d1/i.test(message)) reason = "storage_unavailable";
      else if (error?.code === "CALL_EXCEPTION") reason = "quote_unavailable";
      else reason = "rpc_unavailable";
    }
    return { enabled: true, reason };
  } finally {
    if (token) await finishCycle(cfg.db, cfg, token, reason);
    cfg.provider.destroy();
  }
}

export function runGasRefillCycle(env) {
  return runCycle(env);
}

// Explicit test-only identity and RPC injection. The production Worker never accepts this argument.
export function runGasRefillCycleWithTestConfig(env, testConfig) {
  return runCycle(env, testConfig);
}

export async function readGasRefillHealth(env) {
  const disabled = env.GAS_REFILL_ENABLED !== "true" || !env.GAS_REFILL_PRIVATE_KEY;
  if (disabled) return { enabled: false, status: "disabled", reason: "disabled" };
  let signer;
  try {
    signer = new Wallet(env.GAS_REFILL_PRIVATE_KEY);
    if (!addressEq(signer.address, PRODUCTION.bot)) stop("invalid_configuration");
  } catch { return { enabled: false, status: "invalid_configuration", reason: "invalid_configuration" }; }
  if (!env.DB) return { enabled: false, status: "not_configured", reason: "not_configured" };
  const scope = "480:" + signer.address.toLowerCase();
  try {
    const lock = await env.DB.prepare("SELECT last_cycle_at,last_cycle_reason FROM gas_refill_locks WHERE scope=?")
      .bind(scope).first();
    if (!lock) return { enabled: true, status: "not_running", reason: "not_running" };
    const job = await env.DB.prepare("SELECT state,phase,last_error,updated_at FROM gas_refill_jobs WHERE scope=? ORDER BY created_at DESC LIMIT 1")
      .bind(scope).first();
    const cycleReason = PUBLIC_REASONS.has(lock.last_cycle_reason) ? lock.last_cycle_reason : "not_running";
    return {
      enabled: true,
      status: job?.state === "active" ? "pending" : job?.state === "blocked" ? "blocked" : cycleReason,
      reason: job?.state === "blocked" ? safeReason(job.last_error || "blocked") : cycleReason,
      phase: job?.state === "active" || job?.state === "blocked" ? job.phase : null,
      lastCycleAt: lock.last_cycle_at || null,
      updatedAt: job?.updated_at ? new Date(Number(job.updated_at)).toISOString() : null,
    };
  } catch {
    return { enabled: true, status: "not_running", reason: "not_running" };
  }
}
