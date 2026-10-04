import { DurableObject } from "cloudflare:workers";
import {
  ALERT_REPEAT_MS,
  DELIVERY_RETRY_MS,
  PUBLIC_SERVICE_URL,
  fetchServiceSample,
  formatAlertMessage,
  isAllowedServiceHealthUrl,
} from "./operations.mjs";

const BOT_API = "https://api.telegram.org/bot";
const BOT_METHOD = "/sendMessage";
const singletonName = "inheritance-operations-watchdog";

const DEFAULT_STATE = Object.freeze({
  lastSampleAt: null,
  lastSampleStatus: "not-sampled",
  lastIssueCount: 0,
  queueStatus: "not-yet-available",
  consecutiveBadSamples: 0,
  consecutiveHealthySamples: 0,
  incidentActive: false,
  incidentId: null,
  lastAlertSentAt: null,
  repeatSequence: 0,
  lastDeliveryStatus: "never",
  lastDeliveryAt: null,
});

const configuredTelegramToken = (value) => typeof value === "string" && value === value.trim() &&
  /^\d+:[A-Za-z0-9_-]+$/.test(value);
const configuredTelegramChat = (value) => typeof value === "string" && value === value.trim() &&
  (/^-?\d{1,22}$/.test(value) || /^@[A-Za-z0-9_]{5,32}$/.test(value));
const sinkCredentials = (env) => ({
  token: configuredTelegramToken(env.OPS_ALERT_TELEGRAM_TOKEN) ? env.OPS_ALERT_TELEGRAM_TOKEN : null,
  chatId: configuredTelegramChat(env.OPS_ALERT_TELEGRAM_CHAT_ID) ? env.OPS_ALERT_TELEGRAM_CHAT_ID : null,
});
const hasConfiguredSink = (env) => {
  const credentials = sinkCredentials(env);
  return credentials.token !== null && credentials.chatId !== null;
};

function nowIso(now) { return new Date(now).toISOString(); }

function cloneDefault() { return { ...DEFAULT_STATE }; }

function parseState(raw) {
  if (!raw) return cloneDefault();
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("watchdog_state_invalid");
  return { ...cloneDefault(), ...parsed };
}

export class OperationsWatchdog extends DurableObject {
  constructor(ctx, env, dependencies = {}) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.fetchImpl = dependencies.fetch || globalThis.fetch;
    this.now = dependencies.now || Date.now;
    this.tail = Promise.resolve();
    this.ready = Promise.resolve().then(() => {
      this.sql("CREATE TABLE IF NOT EXISTS operations_watchdog_state (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL)");
      this.sql("CREATE TABLE IF NOT EXISTS operations_watchdog_outbox (event_id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, attempted_at INTEGER, next_attempt_at INTEGER NOT NULL DEFAULT 0, sent_at INTEGER, status TEXT NOT NULL DEFAULT 'pending', message TEXT NOT NULL)");
      this.sql("CREATE INDEX IF NOT EXISTS operations_watchdog_outbox_pending ON operations_watchdog_outbox(status, next_attempt_at, created_at)");
      if (!this.sql("SELECT value FROM operations_watchdog_state WHERE id = 1").length) {
        this.saveState(cloneDefault());
      }
    });
  }

  sql(statement, ...bindings) {
    return this.ctx.storage.sql.exec(statement, ...bindings).toArray();
  }

  readState() {
    const [row] = this.sql("SELECT value FROM operations_watchdog_state WHERE id = 1");
    return parseState(row?.value);
  }

  saveState(state) {
    this.sql("INSERT INTO operations_watchdog_state(id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value", JSON.stringify(state));
  }

  exclusive(work) {
    const previous = this.tail;
    let release;
    this.tail = new Promise((resolve) => { release = resolve; });
    return (async () => {
      await previous;
      try { return await work(); }
      finally { release(); }
    })();
  }

  async publicStatus() {
    await this.ready;
    try {
      const state = this.readState();
      const sinkConfigured = hasConfiguredSink(this.env);
      return {
        lastSampleAt: state.lastSampleAt,
        lastSampleStatus: state.lastSampleStatus,
        sinkConfigured,
        lastDeliveryStatus: sinkConfigured ? state.lastDeliveryStatus : "not_configured",
      };
    } catch {
      return {
        lastSampleAt: null,
        lastSampleStatus: "unavailable",
        sinkConfigured: hasConfiguredSink(this.env),
        lastDeliveryStatus: "unavailable",
      };
    }
  }

  async check() {
    return this.exclusive(async () => {
      await this.ready;
      const sampledAt = this.now();
      const sample = await fetchServiceSample(this.env, this.fetchImpl, sampledAt);
      const state = this.readState();
      state.lastSampleAt = nowIso(sampledAt);
      state.lastSampleStatus = sample.status;
      state.lastIssueCount = sample.issueCount;
      state.queueStatus = sample.queueStatus;

      if (sample.status === "unhealthy") {
        state.consecutiveBadSamples = Math.min(2, state.consecutiveBadSamples + 1);
        state.consecutiveHealthySamples = 0;
        if (!state.incidentActive && state.consecutiveBadSamples >= 2) {
          state.incidentActive = true;
          state.incidentId = `incident:${sampledAt}`;
          state.lastAlertSentAt = null;
          state.repeatSequence = 0;
          this.enqueue(state.incidentId, state.incidentId, "alert", sampledAt, formatAlertMessage("alert", sample));
        }
        if (state.incidentActive && state.lastAlertSentAt !== null &&
            sampledAt - state.lastAlertSentAt >= ALERT_REPEAT_MS &&
            !this.hasPendingRepeat(state.incidentId)) {
          state.repeatSequence++;
          const eventId = `repeat:${state.incidentId}:${state.repeatSequence}`;
          this.enqueue(eventId, state.incidentId, "repeat", sampledAt, formatAlertMessage("repeat", sample));
        }
      } else {
        state.consecutiveHealthySamples = Math.min(2, state.consecutiveHealthySamples + 1);
        state.consecutiveBadSamples = 0;
        if (state.incidentActive && state.consecutiveHealthySamples >= 2) {
          const recoveryId = `recovery:${state.incidentId}`;
          this.enqueue(recoveryId, state.incidentId, "recovery", sampledAt, formatAlertMessage("recovery", sample));
          state.incidentActive = false;
          state.incidentId = null;
          state.lastAlertSentAt = null;
          state.repeatSequence = 0;
        }
      }

      this.saveState(state);
      this.sql("DELETE FROM operations_watchdog_outbox WHERE status = 'sent' AND sent_at < ?", sampledAt - 90 * 24 * 60 * 60_000);
      await this.deliverOne(state, sampledAt);
      return {
        sampledAt: state.lastSampleAt,
        status: state.lastSampleStatus,
        issueCount: state.lastIssueCount,
        queueStatus: state.queueStatus,
        deliveryStatus: state.lastDeliveryStatus,
      };
    });
  }

  enqueue(eventId, incidentId, kind, createdAt, message) {
    this.sql("INSERT OR IGNORE INTO operations_watchdog_outbox(event_id, incident_id, kind, created_at, next_attempt_at, status, message) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      eventId, incidentId, kind, createdAt, createdAt, message);
  }

  hasPendingRepeat(incidentId) {
    return this.sql("SELECT event_id FROM operations_watchdog_outbox WHERE incident_id = ? AND kind = 'repeat' AND status = 'pending' LIMIT 1", incidentId).length > 0;
  }

  async deliverOne(state, now) {
    const { token, chatId } = sinkCredentials(this.env);
    if (!token || !chatId) {
      state.lastDeliveryStatus = "not_configured";
      this.saveState(state);
      return;
    }
    const [event] = this.sql("SELECT event_id, incident_id, kind, attempts, message FROM operations_watchdog_outbox WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY created_at LIMIT 1", now);
    if (!event) return;

    const attemptAt = now;
    this.sql("UPDATE operations_watchdog_outbox SET attempts = attempts + 1, attempted_at = ?, next_attempt_at = ? WHERE event_id = ? AND status = 'pending'",
      attemptAt, attemptAt + DELIVERY_RETRY_MS, event.event_id);
    state.lastDeliveryStatus = "attempting";
    this.saveState(state);

    let accepted = false;
    try {
      const response = await this.fetchImpl(`${BOT_API}${token}${BOT_METHOD}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: event.message, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
      let body = null;
      try {
        const text = await response.text();
        if (text.length <= 16 * 1024) body = JSON.parse(text);
      } catch { body = null; }
      accepted = response.ok === true && body?.ok === true;
    } catch {
      accepted = false;
    }

    if (accepted) {
      this.sql("UPDATE operations_watchdog_outbox SET status = 'sent', sent_at = ? WHERE event_id = ? AND status = 'pending'", this.now(), event.event_id);
      state.lastDeliveryStatus = "sent";
      state.lastDeliveryAt = nowIso(this.now());
      if ((event.kind === "alert" || event.kind === "repeat") &&
          state.incidentActive && state.incidentId === event.incident_id) {
        state.lastAlertSentAt = this.now();
      }
    } else {
      state.lastDeliveryStatus = "failed";
    }
    this.saveState(state);
  }
}

function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const worker = {
  async scheduled(_controller, env, context) {
    if (env.OPS_MONITOR_ENABLED !== "true" || !env.OPS_MONITOR) return;
    try {
      const id = env.OPS_MONITOR.idFromName(singletonName);
      context.waitUntil(env.OPS_MONITOR.get(id).check());
    } catch {
      // Scheduled failures intentionally omit exception text and credentials.
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/api/health") {
      return jsonResponse(404, { status: "not_found" });
    }
    const sinkConfigured = hasConfiguredSink(env);
    let status = {
      lastSampleAt: null,
      lastSampleStatus: "not-sampled",
      sinkConfigured,
      lastDeliveryStatus: sinkConfigured ? "never" : "not_configured",
    };
    if (env.OPS_MONITOR) {
      try {
        const id = env.OPS_MONITOR.idFromName(singletonName);
        status = await env.OPS_MONITOR.get(id).publicStatus();
      } catch { /* public health never returns DO exceptions */ }
    }
    const enabled = env.OPS_MONITOR_ENABLED === "true" &&
      isAllowedServiceHealthUrl(env.SERVICE_HEALTH_URL) && Boolean(env.OPS_MONITOR);
    return jsonResponse(200, {
      status: "ok",
      monitor: {
        enabled,
        serviceUrl: PUBLIC_SERVICE_URL,
        ...status,
      },
    });
  },
};

export default worker;
