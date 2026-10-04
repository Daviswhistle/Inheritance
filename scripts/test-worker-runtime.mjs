// Real scheduled/HTTP Worker handlers with SQLite and a controlled internal RPC.
// The financial engine is separately exercised against genuine Anvil by test-finalizer.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker from "../backend/src/worker.mjs";

const db = new DatabaseSync(":memory:");
const DB = { prepare(sql) {
  let args = [];
  return {
    bind(...values) { args = values; return this; },
    async run() { return db.prepare(sql).run(...args); },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async first() { return db.prepare(sql).get(...args) ?? null; },
  };
} };
let calls = 0, healthCalls = 0, release, failRPC = false, syncCalls = 0, failSync = false;
const namespace = {
  idFromName(name) { assert.equal(name, "executor"); return "fixture-executor-id"; },
  get(id) {
    assert.equal(id, "fixture-executor-id");
    return { async readHealth(...args) {
      assert.equal(args.length, 0);
      healthCalls++;
      return { enabled: true, reason: "ready", supported: true, cycleFresh: true };
    }, async runCycle(...args) {
      assert.equal(args.length, 0, "Caller cannot choose a wallet, vault or transaction");
      calls++;
      if (failRPC) throw new Error("Fixture runtime unavailable");
      if (release !== null) await new Promise((resolve) => { release = resolve; });
      return { enabled: true, checked: 0, finalized: 0, submitted: 0, reason: "idle" };
    }, async synchronize(...args) {
      assert.equal(args.length, 0); syncCalls++;
      if (failSync) throw new Error("Fixture scheduling unavailable");
      return { enabled: true, reason: "ready", scheduled: 0, failed: 0 };
    } };
  },
};
const env = { DB, FINALIZER_ENABLED: "true", FINALIZER_EXECUTOR: namespace };
const realFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("Worker boundary must not send a financial RPC"); };
let checks = 0;
const check = (name, callback) => { callback(); checks++; console.log("PASS " + name); };
async function schedule(overrides = {}, minute = 0) {
  const pending = [];
  await worker.scheduled({ scheduledTime: minute * 60_000 }, { ...env, ...overrides }, {
    waitUntil(promise) { pending.push(promise); },
  });
  assert.equal(pending.length, 1);
  return { completion: pending[0] };
}

try {
  release = undefined;
  const scheduled = await schedule();
  let settled = false;
  scheduled.completion.then(() => { settled = true; });
  for (let i = 0; i < 10 && typeof release !== "function"; i++) await Promise.resolve();
  check("scheduled execution enters the singleton internal RPC and remains awaited", () => {
    assert.equal(calls, 1);
    assert.equal(settled, false);
    assert.equal(typeof release, "function");
  });
  release();
  await scheduled.completion;
  release = null;

  const monitoring = await schedule({}, 1);
  await monitoring.completion;
  check("monitoring ticks never enter the payout executor", () => assert.equal(calls, 1));

  const disabled = await schedule({ FINALIZER_ENABLED: "false", FINALIZER_EXECUTOR: undefined });
  await disabled.completion;
  check("disabled automation does not require or call an executor", () => assert.equal(calls, 1));

  const missing = await schedule({ FINALIZER_EXECUTOR: undefined });
  await assert.rejects(missing.completion, /runtime is not configured/);
  check("a missing runtime fails closed without a Worker execution fallback", () => assert.equal(calls, 1));

  failRPC = true;
  const unavailable = await schedule();
  await assert.rejects(unavailable.completion, /Fixture runtime unavailable/);
  failRPC = false;
  const retry = await schedule();
  await retry.completion;
  check("a later scheduled tick can retry after internal RPC failure", () => assert.equal(calls, 3));

  const scheduledEnv = { WATCHER_TASKS: {} };
  const currentCalls = calls;
  for (const minute of [0, 1, 2]) await (await schedule(scheduledEnv, minute)).completion;
  check("alarm monitoring coordinates and executes on every minute without legacy alternating scans", () => {
    assert.equal(calls, currentCalls + 3); assert.equal(syncCalls, 3);
  });
  failSync = true;
  const partial = await schedule(scheduledEnv, 3);
  await assert.rejects(partial.completion, /A scheduled service task is unavailable/);
  check("a coordinator failure still allows the financial executor to run", () => assert.equal(calls, currentCalls + 4));
  failSync = false; failRPC = true;
  const partialExecution = await schedule(scheduledEnv, 4);
  await assert.rejects(partialExecution.completion, /A scheduled service task is unavailable/);
  check("a financial executor failure still allows monitoring synchronization", () => assert.equal(syncCalls, 5));
  failRPC = false;

  const beforeHTTP = calls;
  for (const method of ["GET", "POST"]) {
    const response = await worker.fetch(new Request("https://fixture.invalid/api/automation/run", { method }), env);
    assert.equal(response.status, 404);
  }
  const status = await worker.fetch(new Request("https://fixture.invalid/api/automation/health"), {
    ...env, FINALIZER_ENABLED: "false",
  });
  const health = (await status.json()).automation;
  check("public requests cannot invoke payouts and report the execution runtime", () => {
    assert.equal(calls, beforeHTTP);
    assert.equal(health.executionRuntime, "durable_object");
    assert.equal(health.reason, "disabled");
    assert.equal(healthCalls, 0);
  });

  const changesBeforeRead = db.prepare("SELECT total_changes() AS n").get().n;
  const liveStatus = await worker.fetch(new Request("https://fixture.invalid/api/automation/health"), env);
  const liveHealth = (await liveStatus.json()).automation;
  check("enabled public health delegates only the read RPC and preserves its result", () => {
    assert.equal(liveHealth.reason, "ready");
    assert.equal(liveHealth.supported, true);
    assert.equal(liveHealth.cycleFresh, true);
    assert.equal(liveHealth.executionRuntime, "durable_object");
    assert.equal(healthCalls, 1);
    assert.equal(calls, beforeHTTP);
    assert.equal(db.prepare("SELECT total_changes() AS n").get().n, changesBeforeRead);
  });

  const unconfigured = await worker.fetch(new Request("https://fixture.invalid/api/automation/health"), {
    ...env, FINALIZER_EXECUTOR: undefined,
    RPC_URL: "https://fixture.invalid/rpc", FACTORY_ADDRESS: "0x" + "11".repeat(20),
    WLD_ADDRESS: "0x" + "22".repeat(20), FINALIZER_PRIVATE_KEY: "0x" + "00".repeat(31) + "01",
  });
  const unconfiguredHealth = (await unconfigured.json()).automation;
  check("health cannot advertise readiness without the scheduled execution binding", () => {
    assert.equal(unconfiguredHealth.executionRuntime, "unconfigured");
    assert.equal(unconfiguredHealth.reason, "not_running");
    assert.equal(calls, beforeHTTP);
    assert.equal(healthCalls, 1);
  });
  console.log(`PASS ${checks} scheduled runtime checks`);
} finally {
  globalThis.fetch = realFetch;
  db.close();
}
