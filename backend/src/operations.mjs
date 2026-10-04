export const SERVICE_HEALTH_URL =
  "https://world-inheritance-notify.rkddkwl725.workers.dev/api/automation/health";
export const PUBLIC_SERVICE_URL = "https://inheritance.pages.dev";

export const SAMPLE_INTERVAL_MS = 5 * 60_000;
export const ALERT_REPEAT_MS = 60 * 60_000;
export const DELIVERY_RETRY_MS = 5 * 60_000;
export const EXECUTOR_STALE_MS = 6 * 60_000;
export const PENDING_STALE_MS = 30 * 60_000;
export const QUEUE_LAG_MS = 15 * 60_000;

const QUEUE_FIELDS = [
  "activeWatchers",
  "dueChecks",
  "failedChecks",
  "oldestObservationErrorAgeMs",
  "oldestCheckAgeMs",
  "eligibleJobs",
  "pendingTransactions",
  "oldestPendingAgeMs",
  "discoveryLastCycleAt",
  "discoveryLastCycleReason",
  "monitoringLastCycleAt",
  "monitoringLastCycleReason",
];

const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;

export function isAllowedServiceHealthUrl(value) {
  if (typeof value !== "string" || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      !url.search && !url.hash && url.pathname === "/api/automation/health" &&
      url.href === SERVICE_HEALTH_URL;
  } catch {
    return false;
  }
}

function nonNegativeInteger(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

function queueMetrics(automation) {
  const raw = asObject(automation?.queue);
  const values = {};
  let available = 0;
  for (const field of QUEUE_FIELDS) {
    const value = raw?.[field];
    if (field.endsWith("At") || field.endsWith("Reason")) {
      values[field] = typeof value === "string" && value.length <= 160 ? value : null;
      if (raw && own(raw, field) && (value === null || values[field] !== null)) available++;
      continue;
    }
    values[field] = nonNegativeInteger(value);
    if (raw && own(raw, field) && (value === null || values[field] !== null)) available++;
  }
  return {
    values,
    status: available === 0 ? "not-yet-available" : available === QUEUE_FIELDS.length ? "available" : "partial",
  };
}

function own(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }

function issueForReason(reason) {
  switch (reason) {
    case "halted": return "halted";
    case "insufficient_gas": return "insufficient_gas";
    case "fee_cap":
    case "gas_cap": return "fee_cap";
    case "daily_cap": return "daily_cap";
    case "stale": return "executor_stale";
    case "ready":
    case "pending": return null;
    default: return "automation_unavailable";
  }
}

export function evaluateServiceSample(payload, nowMs = Date.now()) {
  const body = asObject(payload);
  const automation = asObject(body?.automation);
  const { values: counts, status: queueStatus } = queueMetrics(automation);
  const issues = new Set();
  if (!body || body.status !== "success" || !automation) {
    issues.add("service_unavailable");
  } else {
    if (automation.enabled !== true || automation.supported !== true || automation.funded !== true) {
      issues.add("automation_unavailable");
    }
    if (automation.halted === true) issues.add("halted");
    if (automation.funded === false) issues.add("insufficient_gas");
    const reasonIssue = issueForReason(typeof automation.reason === "string" ? automation.reason : "");
    if (reasonIssue) issues.add(reasonIssue);

    const lastCycleMs = typeof automation.lastCycleAt === "string" ? Date.parse(automation.lastCycleAt) : NaN;
    if (!Number.isFinite(lastCycleMs) || lastCycleMs > nowMs + 60_000 ||
        nowMs - lastCycleMs > EXECUTOR_STALE_MS || automation.cycleFresh === false) {
      issues.add("executor_stale");
    }

    if (counts.failedChecks !== null && counts.failedChecks > 0 &&
        counts.oldestObservationErrorAgeMs !== null && counts.oldestObservationErrorAgeMs > QUEUE_LAG_MS) {
      issues.add("monitoring_read_failure");
    }
    if (counts.pendingTransactions !== null && counts.pendingTransactions > 0 &&
        counts.oldestPendingAgeMs !== null && counts.oldestPendingAgeMs > PENDING_STALE_MS) {
      issues.add("pending_transaction_stale");
    }
    if (counts.dueChecks !== null && counts.dueChecks > 0 &&
        counts.oldestCheckAgeMs !== null && counts.oldestCheckAgeMs > QUEUE_LAG_MS) {
      issues.add("queue_check_lag");
    }
  }
  return {
    status: issues.size ? "unhealthy" : "healthy",
    issueCount: issues.size,
    issues: [...issues],
    counts,
    queueStatus,
  };
}

export function formatAlertMessage(kind, sample) {
  const label = kind === "recovery" ? "RECOVERED" : "ALERT";
  const metric = (name) => sample.counts[name] === null ? "not-yet-available" : String(sample.counts[name]);
  const labels = {
    service_unavailable: "Health endpoint unavailable",
    automation_unavailable: "Automation unavailable or unsupported",
    halted: "Financial execution halted; review required",
    insufficient_gas: "Keeper gas balance too low",
    fee_cap: "Network fee exceeds configured safety limit",
    daily_cap: "Daily gas budget exhausted",
    executor_stale: "Executor heartbeat overdue",
    pending_transaction_stale: "Pending transaction observed for over 30 minutes",
    queue_check_lag: "Scheduled checks overdue by over 15 minutes",
    monitoring_read_failure: "Chain observations failing for over 15 minutes",
  };
  const reasons = sample.issues.filter(issue => own(labels, issue)).map(issue => labels[issue]);
  return [
    `Inheritance service status: ${label}`,
    `Service: ${PUBLIC_SERVICE_URL}`,
    `Current issue count: ${sample.issueCount}`,
    ...(reasons.length ? [`Reason: ${reasons.join("; ")}`] : []),
    `Active watchers: ${metric("activeWatchers")}`,
    `Due checks: ${metric("dueChecks")}`,
    `Eligible jobs: ${metric("eligibleJobs")}`,
    `Pending transactions: ${metric("pendingTransactions")}`,
  ].join("\n");
}

export function parseServiceHealthText(text) {
  if (typeof text !== "string" || text.length > 64 * 1024) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export async function fetchServiceSample(env, fetchImpl = globalThis.fetch, nowMs = Date.now()) {
  if (!isAllowedServiceHealthUrl(env?.SERVICE_HEALTH_URL)) {
    return {
      status: "unhealthy", issueCount: 1, issues: ["service_unavailable"],
      counts: queueMetrics(null).values, queueStatus: "not-yet-available",
    };
  }
  try {
    const response = await fetchImpl(SERVICE_HEALTH_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("health_fetch_failed");
    const payload = parseServiceHealthText(await response.text());
    if (!payload) throw new Error("health_response_invalid");
    return evaluateServiceSample(payload, nowMs);
  } catch {
    return {
      status: "unhealthy", issueCount: 1, issues: ["service_unavailable"],
      counts: queueMetrics(null).values, queueStatus: "not-yet-available",
    };
  }
}
