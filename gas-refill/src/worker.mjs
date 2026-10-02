import { readGasRefillHealth, runGasRefillCycle } from "./refill.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

export default {
  async scheduled(_event, env, context) {
    context.waitUntil(runGasRefillCycle(env).then((result) => {
      console.log(JSON.stringify({ service: "gas-refill", enabled: result.enabled, reason: result.reason,
        phase: result.phase || null }));
    }).catch(() => {
      console.log(JSON.stringify({ service: "gas-refill", enabled: true, reason: "internal_error" }));
    }));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET") return json({ error: "not_found" }, 404);
    if (url.pathname === "/api/health") {
      return json({ status: "ok", version: "gas-refill-usdc-1", gasRefill: await readGasRefillHealth(env) });
    }
    if (url.pathname === "/api/gas-refill/health") {
      return json(await readGasRefillHealth(env));
    }
    return json({ error: "not_found" }, 404);
  },
};
