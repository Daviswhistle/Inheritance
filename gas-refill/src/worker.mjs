const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});
const executor = env => env.GAS_REFILL_EXECUTOR?.getByName("operator-funding-v1");
async function health(env) {
  try {
    const worker = executor(env);
    if(!worker)return { enabled:false, reason:"missing_executor", executionRuntime:"unavailable" };
    return { ...await worker.readHealth(), executionRuntime:"durable_object" };
  }catch{return { enabled:false, reason:"executor_unavailable", executionRuntime:"unavailable" };}
}

export default {
  async scheduled(_event, env, context) {
    const worker=executor(env);
    if(!worker){console.log(JSON.stringify({ service:"gas-refill", enabled:false, reason:"missing_executor" }));return;}
    context.waitUntil(worker.runCycle().then((result) => {
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
      return json({ status: "ok", version: "gas-funding-atomic-2", gasRefill: await health(env) });
    }
    if (url.pathname === "/api/gas-refill/health") {
      return json(await health(env));
    }
    return json({ error: "not_found" }, 404);
  },
};
