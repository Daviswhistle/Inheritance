import { checkWatcher, getWatcherByVault } from "./worker.mjs";
import { createObservationRPC, ensureSchedulingSchema, recordObservationFailure } from "./scheduling.mjs";

/** Runs only read/notification work; cannot sign or broadcast transactions. */
export async function runScheduledWatcher(env, storage, caller = null) {
  const address = await storage.get("vault");
  if (!address) throw new Error("Monitoring target is missing");
  let retired = false;
  let next = Date.now() + 60_000;
  try {
    await ensureSchedulingSchema(env.DB);
    const watcher = await getWatcherByVault(env, address);
    if (!watcher?.active) {
      retired = true;
      await storage.deleteAlarm();
      await env.DB.prepare("DELETE FROM execution_candidates WHERE vault_address=?").bind(address).run();
      await env.DB.prepare("DELETE FROM watcher_schedule WHERE vault_address=?").bind(address).run();
      return { notified: false, reason: "inactive" };
    }
    const readRPC = createObservationRPC(env);
    const chain = Number(BigInt(await readRPC("eth_chainId", [])));
    if (chain !== Number(env.FINALIZER_CHAIN_ID || 480)) throw new Error("Monitoring chain is unavailable");
    const result = await checkWatcher({ ...env, OBSERVATION_RPC: readRPC }, watcher, caller);
    const fresh = await getWatcherByVault(env, address);
    if (!fresh?.active) {
      retired = true;
      await storage.deleteAlarm();
      await env.DB.prepare("DELETE FROM execution_candidates WHERE vault_address=?").bind(address).run();
      await env.DB.prepare("DELETE FROM watcher_schedule WHERE vault_address=?").bind(address).run();
      return result;
    }
    if (result.reason === "error") await recordObservationFailure(env.DB, address);
    if (!["error", "busy", "release_pending_finality"].includes(result.reason)) {
      const row = await env.DB.prepare("SELECT next_check_at FROM watcher_schedule WHERE vault_address=?").bind(address).first();
      if (row?.next_check_at) next = Math.max(Date.now() + 5_000, Number(row.next_check_at));
    }
    return result;
  } catch (error) {
    // Preserve real permission denial; the alarm retries an unavailable chain
    // without copying RPC URLs, payloads or credentials into durable logs.
    if (error?.status === 403) throw error;
    try { await recordObservationFailure(env.DB, address); } catch { /* D1 may also be unavailable. */ }
    return { notified: false, reason: "error" };
  } finally {
    if (!retired) {
      // Rearm durable storage first, so a D1 outage cannot exhaust finite platform
      // retries and orphan a still-active watcher. An inactive row retires on recovery.
      await storage.setAlarm(next);
      try {
        await env.DB.prepare(`UPDATE watcher_schedule SET next_check_at=?,initialized=1,
          last_attempt_at=? WHERE vault_address=?`).bind(next, Date.now(), address).run();
      } catch { /* Coordinator repairs aggregate metadata after D1 recovery. */ }
    }
  }
}
