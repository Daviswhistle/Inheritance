const ADDRESS = /^0x[\da-f]{40}$/i;
export const RESYNC_BATCH = 200;
// Distant deadlines need fewer writes; alarms still wake at the exact warning,
// expiry and challenge boundaries, and app updates request an immediate check.
export const OBSERVATION_INTERVAL_MS = 4 * 60 * 60_000;
const MIN_DELAY_MS = 5_000;

export async function ensureSchedulingSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS watcher_schedule (
    vault_address TEXT PRIMARY KEY, next_check_at INTEGER NOT NULL,
    initialized INTEGER NOT NULL DEFAULT 0, last_attempt_at INTEGER,
    last_success_at INTEGER, last_error TEXT, error_since_at INTEGER
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS execution_candidates (
    vault_address TEXT PRIMARY KEY, observation_token TEXT NOT NULL,
    observed_at INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL DEFAULT 0
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS execution_pending_observation (
    scope TEXT NOT NULL, tx_hash TEXT NOT NULL, first_seen_at INTEGER NOT NULL,
    PRIMARY KEY(scope,tx_hash)
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS watcher_schedule_due ON watcher_schedule(next_check_at)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS execution_candidates_due ON execution_candidates(next_attempt_at,observed_at)").run();
}

function observationIsComplete(snapshot) {
  // Morpho receipt existence stays reliable even when its cash valuation fails.
  // A basic vault needs a successful balance read before zero means empty.
  return (snapshot.vaultBalanceKnown === true || typeof snapshot.hasVaultAssets === "boolean")
    && ![snapshot.isExpired, snapshot.claimPending, snapshot.claimableNow, snapshot.cancelled,
      snapshot.timeRemaining, snapshot.heartbeatInterval].some(value => value == null)
    && !(snapshot.claimPending === true && snapshot.challengeEndsAt == null);
}

export function nextObservationAt(snapshot, now = Date.now()) {
  const sooner = [];
  let delay = OBSERVATION_INTERVAL_MS;
  // Once settlement is finalized, only an undelivered completion notice remains.
  // Its retry cooldown is one day; keep one-minute checks only while finality is pending.
  if (snapshot.claimedAt > 0n) delay = snapshot.settled === true ? 24 * 60 * 60_000 : 60_000;
  else if (!observationIsComplete(snapshot)) delay = 60_000;
  else if (snapshot.claimableNow === true || snapshot.isExpired === true && snapshot.claimPending !== true) delay = 5 * 60_000;
  else if (snapshot.claimPending === true && snapshot.challengeEndsAt !== null) {
    sooner.push(Number(snapshot.challengeEndsAt) * 1000 + 2_000);
  } else if (snapshot.timeRemaining !== null && snapshot.heartbeatInterval !== null) {
    const remaining = Number(snapshot.timeRemaining) * 1000;
    const warning = Number(snapshot.heartbeatInterval) * 1000 / 20;
    if (remaining > warning) sooner.push(now + remaining - warning + 1_000);
    sooner.push(now + remaining + 2_000);
  }
  return Math.max(now + MIN_DELAY_MS, Math.min(now + delay, ...sooner.filter(Number.isFinite)));
}

export async function recordObservation(env, snapshot, now = Date.now()) {
  if (!env.WATCHER_TASKS) return;
  const complete = observationIsComplete(snapshot);
  await env.DB.prepare(`INSERT INTO watcher_schedule
    (vault_address,next_check_at,last_attempt_at,last_success_at,last_error,error_since_at)
    VALUES (?,?,?,?,?,?) ON CONFLICT(vault_address) DO UPDATE SET
    next_check_at=excluded.next_check_at,last_attempt_at=excluded.last_attempt_at,
    last_success_at=COALESCE(excluded.last_success_at,watcher_schedule.last_success_at),
    last_error=excluded.last_error,error_since_at=CASE WHEN excluded.last_error IS NULL THEN NULL
      ELSE COALESCE(watcher_schedule.error_since_at,excluded.error_since_at) END`)
    .bind(snapshot.vaultAddress.toLowerCase(), nextObservationAt(snapshot, now), now,
      complete ? now : null, complete ? null : "incomplete_chain_read", complete ? null : now).run();
  const sources = [env.FACTORY_ADDRESS, env.YIELD_FACTORY_ADDRESS, env.USDC_YIELD_FACTORY_ADDRESS,
    ...(env.LEGACY_YIELD_FACTORY_ADDRESSES || "").split(","),
    ...(env.LEGACY_USDC_YIELD_FACTORY_ADDRESSES || "").split(",")]
    .filter(Boolean).map(value => value.trim().toLowerCase());
  const supported = sources.includes(snapshot.factoryAddress?.toLowerCase());
  if (supported && snapshot.claimableNow === true && snapshot.claimedAt === 0n && snapshot.cancelled !== true &&
      snapshot.heirAddress !== snapshot.ownerAddress && !/^0x0{40}$/i.test(snapshot.heirAddress)) {
    const generation = `${snapshot.factoryAddress}:${snapshot.heirAddress}:${snapshot.challengeEndsAt}`;
    await env.DB.prepare(`INSERT INTO execution_candidates(vault_address,observation_token,observed_at)
      VALUES (?,?,?) ON CONFLICT(vault_address) DO UPDATE SET
      observed_at=CASE WHEN execution_candidates.observation_token=excluded.observation_token
        THEN execution_candidates.observed_at ELSE excluded.observed_at END,
      next_attempt_at=CASE WHEN execution_candidates.observation_token=excluded.observation_token
        THEN execution_candidates.next_attempt_at ELSE 0 END,
      observation_token=excluded.observation_token`)
      .bind(snapshot.vaultAddress.toLowerCase(), generation, now).run();
  } else if (!supported || snapshot.claimableNow === false || snapshot.claimedAt > 0n || snapshot.cancelled === true) {
    await env.DB.prepare("DELETE FROM execution_candidates WHERE vault_address=?")
      .bind(snapshot.vaultAddress.toLowerCase()).run();
  }
}

export async function requestWatcherSchedule(env, address) {
  if (!env.WATCHER_TASKS) return;
  return env.WATCHER_TASKS.get(env.WATCHER_TASKS.idFromName(address.toLowerCase())).ensureScheduled(address, true);
}

export async function synchronizeWatcherTasks(env) {
  if (!env.WATCHER_TASKS) return { enabled: false, reason: "unconfigured", scheduled: 0 };
  await ensureSchedulingSchema(env.DB);
  const rows = await env.DB.prepare(`SELECT w.vault_address FROM watchers w
    LEFT JOIN watcher_schedule s ON s.vault_address=w.vault_address
    WHERE w.active=1 AND (s.vault_address IS NULL OR s.initialized=0 OR s.next_check_at<?)
    ORDER BY COALESCE(s.next_check_at,0),w.vault_address LIMIT ?`)
    .bind(Date.now() - 120_000, RESYNC_BATCH).all();
  let scheduled = 0, failed = 0;
  const values = rows.results || [];
  for (let start = 0; start < values.length; start += 4) {
    const results = await Promise.allSettled(values.slice(start, start + 4).map(row =>
      env.WATCHER_TASKS.get(env.WATCHER_TASKS.idFromName(row.vault_address)).ensureScheduled(row.vault_address, false)));
    for (const result of results) result.status === "fulfilled" ? scheduled++ : failed++;
  }
  return { enabled: true, scheduled, failed, reason: failed ? "partial" : "ready" };
}

export async function ensureScheduledWatcher(env, storage, address, immediate = false) {
  if (!ADDRESS.test(address) || /^0x0{40}$/i.test(address)) throw new Error("Invalid monitoring target");
  const vault = address.toLowerCase();
  const current = await storage.get("vault");
  if (current && current !== vault) throw new Error("Monitoring target cannot change");
  if (!current) await storage.put("vault", vault);
  const existing = await storage.getAlarm();
  // Spread first-time migration reads over one minute, without moving an existing
  // earlier alarm later. Manual actions explicitly request a prompt fresh check.
  const jitter = parseInt(vault.slice(-6), 16) % 60_000;
  const wanted = Date.now() + (immediate ? MIN_DELAY_MS : jitter + MIN_DELAY_MS);
  const next = existing === null || immediate ? Math.min(existing ?? wanted, wanted) : existing;
  if (existing === null || next !== existing) await storage.setAlarm(next);
  await env.DB.prepare(`INSERT INTO watcher_schedule(vault_address,next_check_at,initialized)
    VALUES (?,?,1) ON CONFLICT(vault_address) DO UPDATE SET
    next_check_at=excluded.next_check_at,initialized=1`).bind(vault, next).run();
  return { scheduled: true };
}

// Batches only read RPCs. Each alarm gets its own client and fresh chain state.
// Signing/recovery remain on the executor's separate, unchanged provider.
export function createObservationRPC(env) {
  let pending = [], timer, sequence = 0;
  const send = async () => {
    timer = undefined;
    const calls = pending.splice(0, 20);
    if (pending.length) timer = setTimeout(send, 0);
    try {
      const response = await fetch((env.RPC_URL || "https://worldchain-mainnet.g.alchemy.com/public").trim(), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(calls.map(item => item.body)), signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body)) throw new Error("Monitoring RPC is unavailable");
      const answers = new Map(body.map(item => [item.id, item]));
      if (answers.size !== body.length) throw new Error("Monitoring RPC response is invalid");
      for (const call of calls) {
        const result = answers.get(call.body.id);
        if (!result || result.error || result.result === undefined) call.reject(new Error("Monitoring chain read failed"));
        else call.resolve(result.result);
      }
    } catch { for (const call of calls) call.reject(new Error("Monitoring RPC is unavailable")); }
  };
  return (method, params) => new Promise((resolve, reject) => {
    if (!['eth_call', 'eth_chainId', 'eth_getBlockByNumber'].includes(method)) {
      reject(new Error("Monitoring RPC is read-only")); return;
    }
    pending.push({ body: { jsonrpc: "2.0", id: ++sequence, method, params }, resolve, reject });
    if (timer === undefined) timer = setTimeout(send, 0);
  });
}

export async function recordObservationFailure(db, address, now = Date.now()) {
  await db.prepare(`UPDATE watcher_schedule SET last_error='chain_read_failed',
    error_since_at=COALESCE(error_since_at,?),last_attempt_at=? WHERE vault_address=?`)
    .bind(now, now, address).run();
}

// Derived first-seen timestamps never influence signing, reservations or recovery.
// They bound the observed pending duration; older jobs with no observation remain unknown.
export async function recordPendingObservation(db, scope, now = Date.now()) {
  await db.prepare(`INSERT OR IGNORE INTO execution_pending_observation(scope,tx_hash,first_seen_at)
    SELECT scope,tx_hash,? FROM finalizer_jobs WHERE scope=? AND state='pending' AND tx_hash IS NOT NULL`)
    .bind(now, scope).run();
  await db.prepare(`DELETE FROM execution_pending_observation WHERE scope=? AND NOT EXISTS
    (SELECT 1 FROM finalizer_jobs j WHERE j.scope=execution_pending_observation.scope
      AND j.tx_hash=execution_pending_observation.tx_hash AND j.state='pending')`).bind(scope).run();
}

export async function readQueueHealth(db, scope) {
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('watcher_schedule','execution_candidates','execution_pending_observation')").all();
  if ((tables.results || []).length !== 3) return { initialized: false };
  const now = Date.now();
  const count = await db.prepare(`SELECT COUNT(*) AS active,
    SUM(CASE WHEN s.vault_address IS NULL OR s.initialized=0 OR s.next_check_at<=? THEN 1 ELSE 0 END) AS due,
    MIN(CASE WHEN s.vault_address IS NULL OR s.initialized=0 THEN CAST(strftime('%s',w.created_at) AS INTEGER)*1000
      WHEN s.next_check_at<=? THEN s.next_check_at END) AS oldest_due,
    SUM(CASE WHEN s.last_error IS NOT NULL THEN 1 ELSE 0 END) AS failed,
    MIN(s.error_since_at) AS oldest_error, MAX(s.last_success_at) AS latest FROM watchers w
    LEFT JOIN watcher_schedule s ON w.vault_address=s.vault_address WHERE w.active=1`).bind(now, now).first();
  const candidates = await db.prepare("SELECT COUNT(*) AS n FROM execution_candidates c JOIN watchers w ON w.vault_address=c.vault_address WHERE w.active=1").first();
  let pending = null;
  if (scope) pending = await db.prepare(`SELECT COUNT(*) AS n,MIN(p.first_seen_at) AS oldest,
    SUM(CASE WHEN p.first_seen_at IS NULL THEN 1 ELSE 0 END) AS unknown FROM finalizer_jobs j
    LEFT JOIN execution_pending_observation p ON p.scope=j.scope AND p.tx_hash=j.tx_hash
    WHERE j.scope=? AND j.state='pending'`).bind(scope).first();
  const lastAt = count?.latest ? new Date(Number(count.latest)).toISOString() : null;
  const reason = Number(count?.active || 0) === 0 ? "idle" : Number(count?.failed || 0) > 0 ? "partial" : "ready";
  return { initialized: true, activeWatchers: Number(count?.active || 0), dueChecks: Number(count?.due || 0),
    oldestCheckAgeMs: count?.oldest_due == null ? null : Math.max(0, now - Number(count.oldest_due)),
    failedChecks: Number(count?.failed || 0),
    oldestObservationErrorAgeMs: count?.oldest_error == null ? null : Math.max(0, now - Number(count.oldest_error)),
    eligibleJobs: Number(candidates?.n || 0), pendingTransactions: pending ? Number(pending.n) : null,
    oldestPendingAgeMs: pending?.oldest == null || Number(pending?.unknown) > 0 ? null : Math.max(0, now - Number(pending.oldest)),
    pendingAgeBasis: "observed_since; not transaction submission time",
    discoveryLastCycleAt: lastAt, discoveryLastCycleReason: reason,
    monitoringLastCycleAt: lastAt, monitoringLastCycleReason: reason };
}
