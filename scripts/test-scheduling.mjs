// Actual scheduling/Watcher HTTP logic and SQLite; controlled read-only RPC.
// Financial canonicality, nonces and recovery use the separate Anvil suite.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { AbiCoder, id } from "ethers";
import { ensureSchedulingSchema, ensureScheduledWatcher, synchronizeWatcherTasks,
  recordObservation, recordPendingObservation, nextObservationAt, readQueueHealth, createObservationRPC } from "../backend/src/scheduling.mjs";
import { runScheduledWatcher } from "../backend/src/watcher-task.mjs";

const db = new DatabaseSync(":memory:");
for (const name of ["0001_init", "0002_alerts", "0003_auth", "0004_scheduling"])
  db.exec(readFileSync(new URL(`../backend/migrations/${name}.sql`, import.meta.url), "utf8"));
const DB = { prepare(sql) {
  let args = [];
  return { bind(...values) { args = values; return this; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async first() { return db.prepare(sql).get(...args) ?? null; } };
} };
const address = n => "0x" + BigInt(n).toString(16).padStart(40, "0");
const factory = address(10), token = address(11), heir = address(12);
const namespaceObjects = new Map(), ownerVault = new Map();
const storages = new Map();
const storage = () => {
  const map = new Map(); let alarm = null;
  return { async get(key) { return map.get(key); }, async put(key, value) { map.set(key, value); },
    async getAlarm() { return alarm; }, async setAlarm(value) { alarm = value; },
    async deleteAlarm() { alarm = null; } };
};
const env = { DB, FACTORY_ADDRESS: factory, WLD_ADDRESS: token, FINALIZER_CHAIN_ID: "480",
  RPC_URL: "https://fixture.invalid/rpc", WATCHER_TASKS: {
    idFromName(name) { return name; }, get(name) {
      if (!storages.has(name)) storages.set(name, storage());
      if (!namespaceObjects.has(name)) namespaceObjects.set(name, { ensureScheduled(vault, immediate) {
        assert.equal(name, vault.toLowerCase());
        return ensureScheduledWatcher(env, storages.get(name), vault, immediate);
      } });
      return namespaceObjects.get(name);
    },
  } };
const insert = db.prepare(`INSERT INTO watchers(vault_address,owner_address,heir_address,active,created_at,updated_at)
  VALUES (?,?,?,1,?,?)`);
for (let n = 1; n <= 1000; n++) {
  const vault = address(10000 + n), owner = address(20000 + n);
  insert.run(vault, owner, heir, new Date().toISOString(), new Date().toISOString());
  ownerVault.set(owner, vault);
}
let checks = 0, fetches = 0, calls = 0, failing = false, eligible = false;
let balanceFailing = false, latestReleased = false, allowDelivery = false;
const deliveries = [];
const check = (name, fn) => { fn(); checks++; console.log("PASS " + name); };
const realFetch = globalThis.fetch;
const coder = AbiCoder.defaultAbiCoder();
const selector = signature => id(signature).slice(0, 10);
const values = {
  [selector("heir()")]: ["address", heir], [selector("factory()")]: ["address", factory],
  [selector("WLD()")]: ["address", token], [selector("claimedAt()")]: ["uint256", 0n],
  [selector("inheritanceCancelled()")]: ["bool", false],
  [selector("timeRemaining()")]: ["uint256", 30n * 86400n],
  [selector("heartbeatInterval()")]: ["uint256", 30n * 86400n],
};
globalThis.fetch = async (url, options) => {
  if (url !== env.RPC_URL) {
    assert.ok(allowDelivery, "Only the explicit local notification fixture is allowed");
    assert.equal(url, "https://developer.world.org/api/v2/minikit/send-notification");
    const body = JSON.parse(options.body);
    deliveries.push(body);
    return Response.json({ result: body.wallet_addresses.map(walletAddress => ({ walletAddress, sent: true })) });
  }
  assert.equal(url, env.RPC_URL, "Tests cannot send notifications or financial requests");
  fetches++;
  if (failing) return new Response("unavailable", { status: 503 });
  const queries = JSON.parse(options.body); assert.ok(Array.isArray(queries));
  const results = queries.map(q => {
    calls++;
    assert.ok(["eth_chainId", "eth_call"].includes(q.method));
    let result;
    if (q.method === "eth_chainId") result = "0x1e0";
    else {
      const { to, data } = q.params[0], sel = data.slice(0, 10);
      const n = BigInt(to) - 10000n;
      let pair = values[sel];
      if (sel === selector("owner()")) pair = ["address", address(20000n + n)];
      if (sel === selector("vaultOf(address)")) pair = ["address", latestReleased && q.params[1] !== "finalized"
        ? address(0) : ownerVault.get("0x" + data.slice(-40))];
      if (sel === selector("balanceOf(address)")) {
        if (balanceFailing) return { jsonrpc: "2.0", id: q.id, error: { code: -32000, message: "fixture balance unavailable" } };
        pair = ["uint256", 10n ** 18n];
      }
      if (sel === selector("isExpired()")) pair = ["bool", eligible];
      if (sel === selector("claimPending()")) pair = ["bool", eligible];
      if (sel === selector("claimableNow()")) pair = ["bool", eligible];
      if (sel === selector("challengeEndsAt()")) pair = ["uint256", eligible ? 123456n : 0n];
      assert.ok(pair && pair[1] !== undefined, "Known fixture selector " + sel);
      result = coder.encode([pair[0]], [pair[1]]);
    }
    return { jsonrpc: "2.0", id: q.id, result };
  });
  // Provider order is not a correctness assumption.
  return Response.json(results.reverse());
};

try {
  await ensureSchedulingSchema(DB);
  for (let i = 0; i < 5; i++) {
    const result = await synchronizeWatcherTasks(env);
    assert.equal(result.scheduled, 200); assert.equal(result.failed, 0);
  }
  const initialAlarms = await Promise.all([...storages.values()].map(value => value.getAlarm()));
  check("1,000 actual SQLite monitoring rows bootstrap in five ticks without a full queue RPC scan", () => {
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM watcher_schedule WHERE initialized=1").get().n, 1000);
    assert.equal(storages.size, 1000); assert.equal(fetches, 0);
    assert.ok(initialAlarms.every(value => Number.isFinite(value) && value > Date.now()));
  });
  const complete = await synchronizeWatcherTasks(env);
  check("a complete bootstrap does not keep calling every healthy monitoring actor", () => assert.equal(complete.scheduled, 0));
  const target = address(11000), store = storages.get(target);
  const firstAlarm = await store.getAlarm();
  await ensureScheduledWatcher(env, store, target, false);
  const preserved = await store.getAlarm();
  check("resynchronization preserves an earlier alarm", () => assert.equal(preserved, firstAlarm));
  await assert.rejects(ensureScheduledWatcher(env, store, address(10001)), /cannot change/);
  checks++;
  const initialFetch = fetches, initialCalls = calls;
  const quiet = await runScheduledWatcher(env, store);
  check("a real watcher check batches live reads and schedules distant funds at a four-hour maximum", () => {
    assert.equal(quiet.reason, "nothing_to_say");
    const row = db.prepare("SELECT * FROM watcher_schedule WHERE vault_address=?").get(target);
    assert.ok(row.next_check_at - row.last_success_at >= 14399_000);
    assert.ok(fetches - initialFetch < calls - initialCalls);
    assert.ok(fetches - initialFetch < 50);
  });
  const future = { claimedAt: 0n, isExpired: false, claimPending: false, claimableNow: false, cancelled: false,
    timeRemaining: 3601n, heartbeatInterval: 72000n, challengeEndsAt: null, vaultBalanceKnown: true };
  check("settlement polls for finality, then waits one day for completion notification retry", () => {
    assert.equal(nextObservationAt({ ...future, claimedAt: 1n }, 1_000_000), 1_060_000);
    assert.equal(nextObservationAt({ ...future, claimedAt: 1n, settled: true }, 1_000_000), 87_400_000);
  });
  check("owner reminder boundary uses the existing five-percent warning policy", () => {
    assert.equal(nextObservationAt(future, 1_000_000), 1_005_000);
    assert.equal(nextObservationAt({ ...future, timeRemaining: 1n }, 1_000_000), 1_005_000);
  });
  const originalRemaining = values[selector("timeRemaining()")];
  const originalInterval = values[selector("heartbeatInterval()")];
  values[selector("timeRemaining()")] = ["uint256", 3600n];
  values[selector("heartbeatInterval()")] = ["uint256", 72000n];
  balanceFailing = true;
  const unreadBalance = await runScheduledWatcher(env, store);
  check("a balance-only RPC failure cannot become a healthy empty observation or postpone the owner warning", () => {
    const row = db.prepare("SELECT * FROM watcher_schedule WHERE vault_address=?").get(target);
    assert.equal(unreadBalance.reason, "empty_or_no_owner");
    assert.equal(row.last_error, "incomplete_chain_read");
    assert.ok(row.next_check_at - row.last_attempt_at >= 59_000);
    assert.ok(row.next_check_at - row.last_attempt_at <= 60_000);
    assert.equal(deliveries.length, 0);
  });
  balanceFailing = false; allowDelivery = true;
  const recoveredBalance = await runScheduledWatcher({ ...env, WORLD_APP_ID: "app_local_fixture",
    WORLD_NOTIFY_API_KEY: "local-fixture-only" }, store);
  allowDelivery = false;
  check("recovered balance reads deliver the waiting owner warning and clear the observation error", () => {
    assert.deepEqual(recoveredBalance.sent, ["owner_expiring"]);
    assert.equal(deliveries.length, 1);
    assert.deepEqual(deliveries[0].wallet_addresses, [address(21000)]);
    assert.equal(db.prepare("SELECT last_error FROM watcher_schedule WHERE vault_address=?").get(target).last_error, null);
  });
  values[selector("timeRemaining()")] = originalRemaining;
  values[selector("heartbeatInterval()")] = originalInterval;
  await recordObservation(env, { ...future, vaultAddress: target, factoryAddress: factory,
    ownerAddress: address(21000), heirAddress: heir, vaultBalanceKnown: false, hasVaultAssets: true });
  check("known protected receipt existence remains observable when its cash valuation is unavailable", () => {
    assert.equal(db.prepare("SELECT last_error FROM watcher_schedule WHERE vault_address=?").get(target).last_error, null);
  });
  latestReleased = true;
  const originalNow = Date.now;
  let virtualNow = originalNow();
  Date.now = () => virtualNow;
  try {
    for (let tick = 0; tick < 3; tick++) {
      const waiting = await runScheduledWatcher(env, store);
      assert.equal(waiting.reason, "release_pending_finality");
      assert.equal(await store.getAlarm(), virtualNow + 60_000);
      virtualNow = await store.getAlarm();
    }
    check("three release-finality waiting cycles keep one-minute alarms rather than five-second polling", () => {
      assert.equal(db.prepare("SELECT active FROM watchers WHERE vault_address=?").get(target).active, 1);
    });
  } finally { Date.now = originalNow; latestReleased = false; }
  const releaseRemoved = await runScheduledWatcher(env, store);
  check("a removed unfinalized release resumes its retained active monitoring", () => {
    assert.equal(releaseRemoved.reason, "nothing_to_say");
    assert.equal(db.prepare("SELECT active FROM watchers WHERE vault_address=?").get(target).active, 1);
  });
  db.exec("CREATE TABLE IF NOT EXISTS finalizer_jobs(state TEXT,scope TEXT,tx_hash TEXT)");
  db.prepare("INSERT INTO finalizer_jobs VALUES ('pending','fixture-signer','0xabc')").run();
  eligible = true;
  await runScheduledWatcher(env, store);
  check("an eligible high-address vault is discovered while an unrelated payment is pending", () => {
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM execution_candidates").get().n, 1);
    assert.equal(db.prepare("SELECT vault_address FROM execution_candidates").get().vault_address, target);
  });
  const original = db.prepare("SELECT * FROM execution_candidates WHERE vault_address=?").get(target);
  db.prepare("UPDATE execution_candidates SET next_attempt_at=? WHERE vault_address=?").run(Date.now() + 900_000, target);
  await runScheduledWatcher(env, store);
  check("repeated observations preserve FIFO order and financial backoff for the same claim", () => {
    const row = db.prepare("SELECT * FROM execution_candidates WHERE vault_address=?").get(target);
    assert.equal(row.observed_at, original.observed_at);
    assert.ok(row.next_attempt_at > Date.now());
  });
  failing = true;
  const retry = await runScheduledWatcher(env, store);
  check("chain outage retains the existing eligible hint and rearms beyond automatic retry exhaustion", () => {
    assert.equal(retry.reason, "error");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM execution_candidates").get().n, 1);
  });
  assert.ok(await store.getAlarm() > Date.now());
  failing = false; eligible = false;
  await runScheduledWatcher(env, store);
  check("fresh check-in removes the derived candidate without touching the payment journal", () => {
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM execution_candidates").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM finalizer_jobs WHERE state='pending'").get().n, 1);
  });
  const snapshot = { ...future, vaultAddress: target, factoryAddress: factory, heirAddress: heir,
    ownerAddress: address(21000), claimableNow: true, challengeEndsAt: 999n };
  for (const field of ["timeRemaining", "heartbeatInterval"]) {
    const incomplete = { ...future, vaultAddress: target, factoryAddress: factory,
      heirAddress: heir, ownerAddress: address(21000), [field]: null };
    const now = Date.now();
    await recordObservation(env, incomplete, now);
    check(`missing ${field} keeps the next observation within one minute`, () => {
      const row = db.prepare("SELECT * FROM watcher_schedule WHERE vault_address=?").get(target);
      assert.equal(row.next_check_at, now + 60_000);
      assert.equal(row.last_error, "incomplete_chain_read");
    });
  }
  await recordObservation(env, snapshot);
  const previousGeneration = db.prepare("SELECT observation_token FROM execution_candidates").get().observation_token;
  await recordObservation(env, { ...snapshot, challengeEndsAt: 1000n });
  check("a newly filed claim changes its hint generation and reopens financial retry eligibility", () => {
    const row = db.prepare("SELECT * FROM execution_candidates").get();
    assert.notEqual(row.observation_token, previousGeneration); assert.equal(row.next_attempt_at, 0);
  });
  await recordObservation(env, { ...snapshot, factoryAddress: address(90) });
  check("manual-only and foreign factories cannot enqueue an automatic payout", () => assert.equal(db.prepare("SELECT COUNT(*) AS n FROM execution_candidates").get().n, 0));
  const readRPC = createObservationRPC(env);
  await assert.rejects(readRPC("eth_sendRawTransaction", ["0x00"]), /read-only/); checks++;
  await recordPendingObservation(DB, "fixture-signer", Date.now() - 31 * 60_000);
  await recordPendingObservation(DB, "fixture-signer");
  const pendingHealth = await readQueueHealth(DB, "fixture-signer");
  check("pending observation age survives repeated cycles and never treats missing staging time as zero", () => {
    assert.equal(pendingHealth.pendingTransactions, 1);
    assert.ok(pendingHealth.oldestPendingAgeMs >= 31 * 60_000);
  });
  db.prepare("DELETE FROM execution_pending_observation").run();
  assert.equal((await readQueueHealth(DB, "fixture-signer")).oldestPendingAgeMs, null);
  const failedEnv = { ...env, DB: { prepare() { throw new Error("fixture database outage"); } } };
  const outage = await runScheduledWatcher(failedEnv, store);
  check("even a database outage rearms the durable alarm before any database recovery", () => {
    assert.equal(outage.reason, "error");
  });
  assert.ok(await store.getAlarm() > Date.now());
  await recordObservation(env, { ...snapshot, claimableNow: null });
  db.prepare("UPDATE watcher_schedule SET error_since_at=? WHERE vault_address=?").run(Date.now() - 16 * 60_000, target);
  const failedHealth = await readQueueHealth(DB);
  check("repeated incomplete chain reads remain visible despite future retry alarms", () => {
    assert.equal(failedHealth.failedChecks, 1);
    assert.ok(failedHealth.oldestObservationErrorAgeMs >= 16 * 60_000);
  });
  const healthy = await readQueueHealth(DB);
  check("operational queue health returns aggregates without vault addresses", () => {
    assert.equal(healthy.activeWatchers, 1000); assert.equal(healthy.initialized, true);
    assert.ok(!JSON.stringify(healthy).includes(target));
  });

  // Execute the actual Durable Object class with its real scheduling/checking
  // functions. Only the cloud constructor and controlled RPC/SQLite are fixtures.
  const runtime = readFileSync(new URL("../backend/src/runtime.mjs", import.meta.url), "utf8");
  const actorSource = runtime.slice(runtime.indexOf("export class InheritanceWatcher"), runtime.indexOf("export default"))
    .replace("export class", "class");
  class DurableObjectFixture {
    constructor(ctx, values) { this.ctx = ctx; this.env = values; }
  }
  const InheritanceWatcher = new Function("DurableObject", "ensureScheduledWatcher", "runScheduledWatcher",
    `${actorSource}\nreturn InheritanceWatcher;`)(DurableObjectFixture, ensureScheduledWatcher, runScheduledWatcher);
  let releaseRead, readPaused;
  const heldRead = new Promise(resolve => { releaseRead = resolve; });
  const reading = new Promise(resolve => { readPaused = resolve; });
  const raceDB = { prepare(sql) {
    const statement = DB.prepare(sql);
    if (sql === "SELECT next_check_at FROM watcher_schedule WHERE vault_address=?") {
      const read = statement.first.bind(statement);
      statement.first = async () => {
        const row = await read();
        readPaused();
        await heldRead;
        return row;
      };
    }
    return statement;
  } };
  const actor = new InheritanceWatcher({ storage: store }, { ...env, DB: raceDB });
  await store.deleteAlarm();
  const checking = actor.alarm();
  await reading;
  const immediate = actor.ensureScheduled(target, true);
  releaseRead();
  await Promise.all([checking, immediate]);
  check("a concurrent immediate registration survives an older alarm's delayed schedule read", () => {
    const row = db.prepare("SELECT next_check_at FROM watcher_schedule WHERE vault_address=?").get(target);
    assert.ok(row.next_check_at <= Date.now() + 5_000);
    assert.ok(row.next_check_at > Date.now());
  });
  assert.equal(await store.getAlarm(), db.prepare("SELECT next_check_at FROM watcher_schedule WHERE vault_address=?").get(target).next_check_at);
  await actor.checkNow(target, address(21000));
  check("an authenticated prompt check completes on the same actor without nesting the scheduling lock", () => {
    assert.equal(db.prepare("SELECT active FROM watchers WHERE vault_address=?").get(target).active, 1);
  });
  db.prepare("UPDATE watchers SET active=0 WHERE vault_address=?").run(target);
  await runScheduledWatcher(env, store);
  assert.equal(await store.getAlarm(), null);
  check("inactive monitoring retires its alarm and derived hint", () => {
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM watcher_schedule WHERE vault_address=?").get(target).n, 0);
  });
  console.log(`${checks} scheduling checks passed; 1,000-row bootstrap verified; no external messages or transactions.`);
} finally { globalThis.fetch = realFetch; db.close(); }
