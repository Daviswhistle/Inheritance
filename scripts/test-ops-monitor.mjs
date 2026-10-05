#!/usr/bin/env node
import assert from "node:assert/strict";
import { register } from "node:module";
import { DatabaseSync } from "node:sqlite";
import {
  SERVICE_HEALTH_URL,
  evaluateServiceSample,
  fetchServiceSample,
  isAllowedServiceHealthUrl,
} from "../backend/src/operations.mjs";

register(`data:text/javascript,export async function resolve(specifier, context, nextResolve) { if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject {}', shortCircuit: true }; return nextResolve(specifier, context); }`, import.meta.url);
const { OperationsWatchdog, default: worker } = await import("../backend/src/watchdog.mjs");

class SqliteStorage {
  constructor(database = new DatabaseSync(":memory:")) {
    this.database = database;
    this.database.exec("CREATE TABLE IF NOT EXISTS test_alarm (id INTEGER PRIMARY KEY CHECK (id = 1), time INTEGER NOT NULL)");
    this.sql = {
      exec: (query, ...bindings) => {
        const statement = this.database.prepare(query);
        if (statement.columns().length) {
          const rows = statement.all(...bindings);
          return { toArray: () => rows };
        }
        statement.run(...bindings);
        return { toArray: () => [] };
      },
    };
  }
  async getAlarm() { return this.database.prepare("SELECT time FROM test_alarm WHERE id = 1").get()?.time ?? null; }
  async setAlarm(time) { this.database.prepare("INSERT INTO test_alarm(id, time) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET time = excluded.time").run(time); }
  async deleteAlarm() { this.database.prepare("DELETE FROM test_alarm").run(); }
}

const passed = [];
async function check(name, work) {
  await work();
  passed.push(name);
  process.stdout.write(`PASS ${name}\n`);
}

function automation(reason = "rpc_error", now = Date.now()) {
  return {
    enabled: true,
    supported: true,
    funded: true,
    halted: false,
    reason,
    lastCycleAt: new Date(now).toISOString(),
    cycleFresh: true,
  };
}

function healthPayload(status = "success", reason = "ready", now = Date.now(), queue = undefined) {
  const value = { status, automation: automation(reason, now) };
  if (queue !== undefined) value.automation.queue = queue;
  return value;
}

function newHarness({ database, now = Date.parse("2026-10-05T00:00:00.000Z"), secret = true, telegram = () => new Response('{"ok":true}', { status: 200 }), service = () => Response.json(healthPayload("success", "rpc_error", now)), serviceUrl = SERVICE_HEALTH_URL } = {}) {
  const storage = new SqliteStorage(database);
  const state = { storage };
  const sends = [];
  const serviceCalls = [];
  const fetch = async (url, options) => {
    if (url === SERVICE_HEALTH_URL) {
      serviceCalls.push({ url, options });
      return service();
    }
    sends.push({ url, options });
    return telegram();
  };
  const env = {
    OPS_MONITOR_ENABLED: "true",
    SERVICE_HEALTH_URL: serviceUrl,
    ...(secret ? { OPS_ALERT_TELEGRAM_TOKEN: "123456:TestToken_neverOutput", OPS_ALERT_TELEGRAM_CHAT_ID: "-1000123456789" } : {}),
  };
  const watchdog = new OperationsWatchdog(state, env, { fetch, now: () => now });
  return { watchdog, env, state, storage, sends, serviceCalls, setNow(value) { now = value; } };
}

await check("fixed service URL rejects credentials, queries, fragments and alternate targets", async () => {
  assert.equal(isAllowedServiceHealthUrl(SERVICE_HEALTH_URL), true);
  assert.equal(isAllowedServiceHealthUrl("https://user:pass@world-inheritance-notify.rkddkwl725.workers.dev/api/automation/health"), false);
  assert.equal(isAllowedServiceHealthUrl(`${SERVICE_HEALTH_URL}?url=https://attacker.invalid`), false);
  assert.equal(isAllowedServiceHealthUrl(`${SERVICE_HEALTH_URL}#fragment`), false);
  assert.equal(isAllowedServiceHealthUrl("https://attacker.invalid/api/automation/health"), false);
});

await check("missing queue metrics remain not-yet-available and do not become zero or queue incidents", async () => {
  const evaluated = evaluateServiceSample({ status: "success", automation: automation("ready", 10_000) }, 10_000);
  assert.equal(evaluated.status, "healthy");
  assert.equal(evaluated.queueStatus, "not-yet-available");
  assert.equal(evaluated.counts.activeWatchers, null);
  assert.equal(evaluated.counts.pendingTransactions, null);
  assert.deepEqual(evaluated.issues, []);
});

await check("pending age and due-check lag alert only when queue fields are present", async () => {
  const now = 1_800_000_000_000;
  const evaluated = evaluateServiceSample({ status: "success", automation: {
    ...automation("ready", now),
    queue: {
      activeWatchers: 3,
      failedChecks: 1,
      oldestObservationErrorAgeMs: 16 * 60_000,
      dueChecks: 1,
      oldestCheckAgeMs: 16 * 60_000,
      eligibleJobs: 2,
      pendingTransactions: 1,
      oldestPendingAgeMs: 31 * 60_000,
      discoveryLastCycleAt: null,
      discoveryLastCycleReason: null,
      monitoringLastCycleAt: null,
      monitoringLastCycleReason: null,
    },
  } }, now);
  assert.equal(evaluated.queueStatus, "available");
  assert.ok(evaluated.issues.includes("pending_transaction_stale"));
  assert.ok(evaluated.issues.includes("queue_check_lag"));
  assert.ok(evaluated.issues.includes("monitoring_read_failure"));
});

await check("two bad samples persist one incident before send; restart and concurrent checks dedupe", async () => {
  let now = Date.parse("2026-10-05T00:00:00.000Z");
  const harness = newHarness({ now });
  await harness.watchdog.check();
  assert.equal(harness.sends.length, 0);
  now += 5 * 60_000;
  harness.setNow(now);
  const concurrent = await Promise.all([harness.watchdog.check(), harness.watchdog.check()]);
  assert.equal(harness.sends.length, 1);
  assert.ok(concurrent.every((item) => item.deliveryStatus === "sent"));
  assert.equal(harness.serviceCalls.length, 2);
  assert.ok(harness.serviceCalls.every((call) => call.url === SERVICE_HEALTH_URL && call.options.redirect === "manual"));
  assert.equal(new URL(harness.sends[0].url).hostname, "api.telegram.org");
  assert.match(new URL(harness.sends[0].url).pathname, /^\/bot\d+:[A-Za-z0-9_-]+\/sendMessage$/);
  assert.match(harness.sends[0].options.body, /Service: https:\/\/inheritance\.pages\.dev/);
  assert.match(harness.sends[0].options.body, /Due checks: not-yet-available/);
  const alertPayload = JSON.parse(harness.sends[0].options.body);
  assert.equal(alertPayload.chat_id, "-1000123456789");
  const alertText = alertPayload.text;
  assert.doesNotMatch(alertText, /txHash|rpc|TestToken|neverOutput/i);

  now += 5 * 60_000;
  harness.setNow(now);
  const restarted = new OperationsWatchdog(harness.state, harness.env, {
    fetch: async (url) => url === SERVICE_HEALTH_URL ? Response.json(healthPayload("success", "rpc_error", now)) : new Response('{"ok":true}'),
    now: () => now,
  });
  await restarted.check();
  assert.equal(harness.sends.length, 1);
  const pending = harness.storage.database.prepare("SELECT status, attempts FROM operations_watchdog_outbox WHERE kind='alert'").get();
  assert.equal(pending.status, "sent");
  assert.equal(pending.attempts, 1);
});

await check("failed Telegram send is durable, safe, and retried after the retry interval", async () => {
  let now = Date.parse("2026-10-05T02:00:00.000Z");
  let telegramAttempts = 0;
  const harness = newHarness({ now, telegram: () => {
    telegramAttempts++;
    return telegramAttempts === 1 ? new Response('{"ok":false}', { status: 200 }) : new Response('{"ok":true}', { status: 200 });
  } });
  await harness.watchdog.check();
  now += 5 * 60_000;
  harness.setNow(now);
  await harness.watchdog.check();
  assert.equal(telegramAttempts, 1);
  assert.equal((await harness.watchdog.publicStatus()).lastDeliveryStatus, "failed");
  const failedRow = harness.storage.database.prepare("SELECT attempts, status FROM operations_watchdog_outbox WHERE kind='alert'").get();
  assert.equal(failedRow.attempts, 1);
  assert.equal(failedRow.status, "pending");

  now += 5 * 60_000;
  harness.setNow(now);
  const restarted = new OperationsWatchdog(harness.state, harness.env, {
    fetch: async (url) => {
      if (url === SERVICE_HEALTH_URL) return Response.json(healthPayload("success", "rpc_error", now));
      telegramAttempts++;
      return new Response('{"ok":true}', { status: 200 });
    },
    now: () => now,
  });
  assert.equal((await restarted.publicStatus()).lastDeliveryStatus, "failed");
  await restarted.check();
  assert.equal(telegramAttempts, 2);
  assert.equal((await restarted.publicStatus()).lastDeliveryStatus, "sent");
  const sentRow = harness.storage.database.prepare("SELECT attempts, status FROM operations_watchdog_outbox WHERE kind='alert'").get();
  assert.equal(sentRow.attempts, 2);
  assert.equal(sentRow.status, "sent");
});

await check("recovery requires two healthy samples and is sent once", async () => {
  let now = Date.parse("2026-10-05T04:00:00.000Z");
  let mode = "bad";
  const harness = newHarness({ now, service: () => Response.json(healthPayload("success", mode === "bad" ? "rpc_error" : "ready", now)) });
  await harness.watchdog.check();
  now += 5 * 60_000;
  harness.setNow(now);
  await harness.watchdog.check();
  assert.equal(harness.sends.length, 1);
  mode = "healthy";
  now += 5 * 60_000;
  harness.setNow(now);
  await harness.watchdog.check();
  assert.equal(harness.sends.length, 1);
  now += 5 * 60_000;
  harness.setNow(now);
  await harness.watchdog.check();
  assert.equal(harness.sends.length, 2);
  assert.match(harness.sends[1].options.body, /status: RECOVERED/);
  now += 5 * 60_000;
  harness.setNow(now);
  await harness.watchdog.check();
  assert.equal(harness.sends.length, 2);
  assert.equal(harness.storage.database.prepare("SELECT COUNT(*) AS count FROM operations_watchdog_outbox WHERE kind='recovery' AND status='sent'").get().count, 1);
});

await check("repeat alerts wait at least an hour after the accepted alert", async () => {
  let now = Date.parse("2026-10-05T06:00:00.000Z");
  const harness = newHarness({ now });
  await harness.watchdog.check();
  now += 5 * 60_000;
  harness.setNow(now);
  await harness.watchdog.check();
  now += 55 * 60_000;
  harness.setNow(now);
  await harness.watchdog.check();
  assert.equal(harness.sends.length, 1);
  now += 5 * 60_000;
  harness.setNow(now);
  await harness.watchdog.check();
  assert.equal(harness.sends.length, 2);
  assert.equal(harness.storage.database.prepare("SELECT COUNT(*) AS count FROM operations_watchdog_outbox WHERE kind='repeat' AND status='sent'").get().count, 1);
});

await check("missing alert secrets are visible as not-configured and never claim delivery", async () => {
  let now = Date.parse("2026-10-05T08:00:00.000Z");
  const harness = newHarness({ now, secret: false });
  await harness.watchdog.check();
  now += 5 * 60_000;
  harness.setNow(now);
  await harness.watchdog.check();
  const status = await harness.watchdog.publicStatus();
  assert.equal(status.sinkConfigured, false);
  assert.equal(status.lastDeliveryStatus, "not_configured");
  assert.equal(harness.sends.length, 0);
  assert.equal(harness.storage.database.prepare("SELECT status FROM operations_watchdog_outbox WHERE kind='alert'").get().status, "pending");
});

await check("wrong service URL is never fetched; health is read-only and schedule calls runScheduled without arguments", async () => {
  let now = Date.parse("2026-10-05T10:00:00.000Z");
  const harness = newHarness({ now, serviceUrl: "https://attacker.invalid/api/automation/health" });
  await harness.watchdog.check();
  assert.equal(harness.serviceCalls.length, 0);

  let checkCalls = 0;
  let checkArguments;
  const namespace = {
    idFromName(name) { assert.equal(name, "inheritance-operations-watchdog"); return name; },
    get() { return {
      async publicStatus() { return { lastSampleAt: null, lastSampleStatus: "not-sampled", sinkConfigured: false, lastDeliveryStatus: "not_configured" }; },
      async runScheduled(...args) { checkCalls++; checkArguments = args; },
    }; },
  };
  const publicResponse = await worker.fetch(new Request("https://monitor.invalid/api/health"), {
    OPS_MONITOR_ENABLED: "true", SERVICE_HEALTH_URL, OPS_MONITOR: namespace,
  });
  const publicHealth = await publicResponse.json();
  assert.equal(publicHealth.monitor.enabled, true);
  assert.equal(publicHealth.monitor.sinkConfigured, false);
  assert.equal(JSON.stringify(publicHealth).includes("TestToken_neverOutput"), false);
  assert.equal((await worker.fetch(new Request("https://monitor.invalid/api/check"), { OPS_MONITOR: namespace })).status, 404);
  assert.equal(checkCalls, 0);
  let scheduled;
  await worker.scheduled({}, { OPS_MONITOR_ENABLED: "true", OPS_MONITOR: namespace }, { waitUntil(promise) { scheduled = promise; } });
  await scheduled;
  assert.equal(checkCalls, 1);
  assert.deepEqual(checkArguments, []);
});

await check("internal bootstrap persists one prompt alarm and leaves an existing alarm unchanged", async () => {
  const now = Date.parse("2026-10-05T12:00:00.000Z");
  const harness = newHarness({ now });
  assert.equal((await harness.watchdog.publicStatus()).nextCheckAt, null);
  assert.equal(await harness.storage.getAlarm(), null);
  const started = await harness.watchdog.initialize();
  assert.equal(started.nextCheckAt, new Date(now + 5_000).toISOString());
  harness.setNow(now + 2_000);
  assert.deepEqual(await harness.watchdog.initialize(), started);
  assert.equal(harness.serviceCalls.length, 0);
  assert.equal(harness.sends.length, 0);
});

await check("alarm sampling survives an actor restart and rearms the next five-minute check", async () => {
  let now = Date.parse("2026-10-05T13:00:00.000Z");
  const database = new DatabaseSync(":memory:");
  const first = newHarness({ database, now, service: () => Response.json(healthPayload("success", "ready", now)) });
  await first.watchdog.initialize();
  now += 5_000;
  first.setNow(now);
  // Cloudflare consumes the due alarm before invoking its handler.
  await first.storage.deleteAlarm();
  await first.watchdog.alarm();
  assert.equal(first.serviceCalls.length, 1);
  assert.equal(await first.storage.getAlarm(), now + 5 * 60_000);
  const restarted = newHarness({ database, now, service: () => Response.json(healthPayload("success", "ready", now)) });
  assert.equal((await restarted.watchdog.publicStatus()).lastSampleAt, new Date(now).toISOString());
  assert.equal(await restarted.storage.getAlarm(), now + 5 * 60_000);
  now += 5 * 60_000;
  restarted.setNow(now);
  await restarted.storage.deleteAlarm();
  await restarted.watchdog.alarm();
  assert.equal(restarted.serviceCalls.length, 1);
  assert.equal(restarted.watchdog.readState().consecutiveHealthySamples, 2);
  assert.equal(await restarted.storage.getAlarm(), now + 5 * 60_000);
});

await check("Cron, duplicate alarm delivery and restart do not count the same bad sample twice", async () => {
  let now = Date.parse("2026-10-05T14:00:00.000Z");
  const harness = newHarness({ now });
  await harness.watchdog.initialize();
  await harness.storage.deleteAlarm();
  await Promise.all([harness.watchdog.alarm(), harness.watchdog.runScheduled(), harness.watchdog.alarm()]);
  assert.equal(harness.serviceCalls.length, 1);
  assert.equal(harness.watchdog.readState().consecutiveBadSamples, 1);
  assert.equal(harness.sends.length, 0);
  now += 5 * 60_000;
  harness.setNow(now);
  await harness.storage.deleteAlarm();
  await Promise.all([harness.watchdog.runScheduled(), harness.watchdog.alarm()]);
  assert.equal(harness.serviceCalls.length, 2);
  assert.equal(harness.watchdog.readState().consecutiveBadSamples, 2);
  assert.equal(harness.sends.length, 1);
  const restarted = newHarness({ database: harness.storage.database, now });
  await restarted.watchdog.runScheduled();
  assert.equal(restarted.serviceCalls.length, 0);
  assert.equal(restarted.sends.length, 0);
});

await check("Cron preserves an earlier alarm and cached samples retain their original cadence", async () => {
  const now = Date.parse("2026-10-05T15:00:00.000Z");
  const harness = newHarness({ now });
  await harness.watchdog.runScheduled();
  assert.equal(await harness.storage.getAlarm(), now + 5 * 60_000);
  harness.setNow(now + 4 * 60_000);
  await harness.watchdog.runScheduled();
  assert.equal(harness.serviceCalls.length, 1);
  assert.equal(await harness.storage.getAlarm(), now + 5 * 60_000);
  await harness.storage.deleteAlarm();
  await harness.watchdog.runScheduled();
  assert.equal(await harness.storage.getAlarm(), now + 5 * 60_000);
});

await check("SQL failure leaves a persistent retry and disabled or invalid configurations stop alarms", async () => {
  const now = Date.parse("2026-10-05T16:00:00.000Z");
  const harness = newHarness({ now });
  await harness.watchdog.ready;
  harness.storage.database.exec("DROP TABLE operations_watchdog_state");
  await assert.rejects(harness.watchdog.alarm(), /operations_watchdog_state/);
  assert.equal(await harness.storage.getAlarm(), now + 5 * 60_000);
  assert.equal(harness.serviceCalls.length, 0);
  harness.env.OPS_MONITOR_ENABLED = "false";
  assert.deepEqual(await harness.watchdog.runScheduled(), { status: "disabled" });
  assert.equal(await harness.storage.getAlarm(), null);
  harness.env.OPS_MONITOR_ENABLED = "true";
  harness.env.SERVICE_HEALTH_URL = "https://attacker.invalid/api/automation/health";
  await harness.storage.setAlarm(now + 5_000);
  assert.deepEqual(await harness.watchdog.initialize(), { enabled: false, nextCheckAt: null });
  assert.equal(await harness.storage.getAlarm(), null);
  assert.equal(harness.serviceCalls.length, 0);
  assert.equal(harness.sends.length, 0);
});

await check("platform global fetch keeps its required receiver for health reads and Telegram delivery", async () => {
  const originalFetch = globalThis.fetch;
  let now = Date.parse("2026-10-05T17:00:00.000Z");
  let healthReads = 0;
  let telegramSends = 0;
  globalThis.fetch = function (url) {
    assert.equal(this, globalThis, "workerd requires the global receiver for native fetch");
    if (url === SERVICE_HEALTH_URL) {
      healthReads++;
      return Promise.resolve(Response.json(healthPayload("success", "rpc_error", now)));
    }
    assert.equal(new URL(url).hostname, "api.telegram.org");
    telegramSends++;
    return Promise.resolve(Response.json({ ok: true }));
  };
  try {
    const harness = newHarness({ now });
    const watchdog = new OperationsWatchdog(harness.state, harness.env, { now: () => now });
    const helperSample = await fetchServiceSample(harness.env, undefined, now);
    assert.deepEqual(helperSample.issues, ["automation_unavailable"]);
    await watchdog.runScheduled();
    now += 5 * 60_000;
    await watchdog.runScheduled();
    assert.equal(healthReads, 3);
    assert.equal(telegramSends, 1);
    assert.equal((await watchdog.publicStatus()).lastDeliveryStatus, "sent");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await check("fresh running cycles stay checking; overdue or unfunded running cycles and redirects remain unhealthy", async () => {
  const now = Date.parse("2026-10-05T18:00:00.000Z");
  const current = healthPayload("success", "running", now);
  assert.equal(evaluateServiceSample(current, now).status, "checking");
  current.automation.lastCycleAt = new Date(now - 7 * 60_000).toISOString();
  assert.ok(evaluateServiceSample(current, now).issues.includes("executor_stale"));
  current.automation.lastCycleAt = new Date(now).toISOString();
  current.automation.funded = false;
  assert.ok(evaluateServiceSample(current, now).issues.includes("insufficient_gas"));
  let calls = 0;
  const redirected = await fetchServiceSample({ SERVICE_HEALTH_URL }, async (url, options) => {
    assert.equal(url, SERVICE_HEALTH_URL);
    assert.equal(options.redirect, "manual");
    calls++;
    return new Response(null, { status: 302, headers: { Location: "https://attacker.invalid" } });
  }, now);
  assert.deepEqual(redirected.issues, ["service_unavailable"]);
  assert.equal(calls, 1);
});

await check("running caps cannot recover an incident; pending reservations and unlimited budgets retain their meaning", async () => {
  let now = Date.parse("2026-10-05T19:00:00.000Z");
  let mode = "daily";
  const reserve = "90071992547409931234567890";
  const snapshot = () => ({
    ...automation("running", now),
    executionGasPriceWei: mode === "fees" ? "10000001" : "1500000",
    maxFeeWei: "10000000", dailyBudgetLimited: true,
    requiredReserveWei: reserve, dailyRemainingWei: mode === "daily" ? "1" : reserve,
    pendingTxHash: null,
  });
  const harness = newHarness({ now, service: () => Response.json({ status: "success", automation: snapshot() }) });
  await harness.watchdog.runScheduled();
  now += 5 * 60_000; harness.setNow(now);
  await harness.watchdog.runScheduled();
  assert.equal(harness.sends.length, 1);
  assert.match(harness.sends[0].options.body, /Daily gas budget exhausted/);
  mode = "fees";
  for (let i = 0; i < 2; i++) {
    now += 5 * 60_000; harness.setNow(now);
    await harness.watchdog.runScheduled();
  }
  assert.equal(harness.watchdog.readState().incidentActive, true);
  assert.equal(harness.watchdog.readState().consecutiveHealthySamples, 0);
  assert.equal(harness.storage.database.prepare("SELECT COUNT(*) AS n FROM operations_watchdog_outbox WHERE kind='recovery'").get().n, 0);
  mode = "healthy";
  const pending = { ...snapshot(), pendingTxHash: "0x" + "ab".repeat(32), dailyRemainingWei: "0",
    dailyReservedWei: reserve, dailyCapWei: reserve };
  assert.equal(evaluateServiceSample({ status: "success", automation: pending }, now).status, "checking");
  pending.dailyCapWei = "1";
  assert.ok(evaluateServiceSample({ status: "success", automation: pending }, now).issues.includes("daily_cap"));
  pending.executionGasPriceWei = "10000001";
  assert.ok(evaluateServiceSample({ status: "success", automation: pending }, now).issues.includes("fee_cap"));
  const unlimited = { ...snapshot(), dailyBudgetLimited: false, dailyRemainingWei: "0", dailyReservedWei: reserve, dailyCapWei: "1" };
  assert.equal(evaluateServiceSample({ status: "success", automation: unlimited }, now).status, "checking");
  const service = harness.watchdog.fetchImpl;
  harness.watchdog.fetchImpl = (url, options) => url === SERVICE_HEALTH_URL
    ? Promise.resolve(Response.json(healthPayload("success", "ready", now))) : service(url, options);
  for (let i = 0; i < 2; i++) {
    now += 5 * 60_000; harness.setNow(now);
    await harness.watchdog.runScheduled();
  }
  assert.equal(harness.sends.length, 2);
  assert.match(harness.sends[1].options.body, /RECOVERED/);
});

await check("active signer failures remain visible during running; a vault simulation failure stays diagnostic", async () => {
  let now = Date.parse("2026-10-05T20:00:00.000Z");
  let failure = "gas_cap";
  const snapshot = () => ({ ...automation("running", now), recentFailure: failure,
    executionGasPriceWei: "1500000", maxFeeWei: "10000000", dailyBudgetLimited: false });
  const harness = newHarness({ now, service: () => Response.json({ status: "success", automation: snapshot() }) });
  for (let i = 0; i < 4; i++) {
    harness.setNow(now);
    await harness.watchdog.runScheduled();
    now += 5 * 60_000;
  }
  assert.equal(harness.watchdog.readState().incidentActive, true);
  assert.equal(harness.sends.length, 1);
  assert.match(harness.sends[0].options.body, /Execution needs more gas/);
  assert.doesNotMatch(harness.sends[0].options.body, /Network fee exceeds/);
  assert.equal(harness.storage.database.prepare("SELECT COUNT(*) AS n FROM operations_watchdog_outbox WHERE kind='recovery'").get().n, 0);
  for (const code of ["fee_cap", "daily_cap", "insufficient_gas", "rpc_error", "wrong_chain", "gas_funding_unverified"]) {
    failure = code;
    assert.equal(evaluateServiceSample({ status: "success", automation: snapshot() }, now).status, "unhealthy", code);
  }
  failure = "simulation_failed";
  assert.equal(evaluateServiceSample({ status: "success", automation: snapshot() }, now).status, "checking");
  for (let i = 0; i < 2; i++) {
    harness.setNow(now);
    await harness.watchdog.runScheduled();
    now += 5 * 60_000;
  }
  assert.equal(harness.sends.length, 1);
  assert.equal(harness.watchdog.readState().incidentActive, true);
  const service = harness.watchdog.fetchImpl;
  harness.watchdog.fetchImpl = (url, options) => url === SERVICE_HEALTH_URL
    ? Promise.resolve(Response.json(healthPayload("success", "ready", now))) : service(url, options);
  for (let i = 0; i < 2; i++) {
    harness.setNow(now);
    await harness.watchdog.runScheduled();
    now += 5 * 60_000;
  }
  assert.equal(harness.sends.length, 2);
  assert.match(harness.sends[1].options.body, /RECOVERED/);
});

process.stdout.write(`\n${passed.length} monitor checks passed\n`);
