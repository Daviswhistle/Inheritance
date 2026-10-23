import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { localAuth } from "./vite.config.e2e";

// Only the launcher creates this fresh fixture. Production build never imports this config.
const fixtureFile = process.env.INHERITANCE_HOST_FIXTURE;
if (!fixtureFile) throw new Error("Start with node scripts/test-host/start.mjs; a fresh local fixture is required.");
const fixture = JSON.parse(readFileSync(fixtureFile, "utf8"));
const rpcURL = new URL(fixture.rpc);
if (rpcURL.protocol !== "http:" || rpcURL.hostname !== "127.0.0.1") throw new Error("Test host only accepts loopback Anvil.");
const require = createRequire(import.meta.url);
const { JsonRpcProvider, Wallet, Contract } = require("ethers");
const provider = new JsonRpcProvider(fixture.rpc, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
const accounts = {
  owner: new Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", provider),
  heir: new Wallet("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", provider),
};
// Loaded at server startup, never bundled into the miniapp.
const executorPath = path.resolve(__dirname, "../scripts/test-host/executor.mjs");

function hostServer(): Plugin {
  return {
    name: "inheritance-test-host",
    transformIndexHtml(html) {
      // Vite adds an HMR timestamp after source edits; the native bridge must
      // still install before the real app on every subsequent page load.
      return html.replace(/src="\/src\/main\.tsx(?:\?[^"<>]*)?"/, 'src="/__host/bootstrap.mjs"').replace("<title>Inheritance</title>", "<title>Inheritance · TEST HOST</title>");
    },
    async configureServer(server) {
      const version = await provider.send("web3_clientVersion", []);
      if (!/^anvil/i.test(version) || Number(await provider.send("eth_chainId", [])) !== 480) throw new Error("Expected isolated Anvil chain 480.");
      const { createExecutor } = await import(executorPath);
      const executor = createExecutor({ provider, accounts, batchWallet: fixture.batchWallet });
      const watchers = new Map<string, { active: boolean }>();
      let mutation = Promise.resolve();
      const serial = <T,>(operation: () => Promise<T>) => {
        const result = mutation.then(operation);
        mutation = result.then(() => undefined, () => undefined);
        return result;
      };
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || "/", `http://${req.headers.host}`);
        if (!url.pathname.startsWith("/__host/")) return next();
        res.setHeader("Cache-Control", "no-store");
        const reply = (status: number, value: unknown) => {
          res.statusCode = status;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(value));
        };
        try {
          // Browsers on other origins cannot operate the local test chain.
          if (req.headers.origin && req.headers.origin !== url.origin) return reply(403, { error: "Same-origin test host requests only" });
          if (req.headers["sec-fetch-site"] === "cross-site") return reply(403, { error: "Cross-site test host request blocked" });
          if (["/__host/bootstrap.mjs", "/__host/bridge.mjs"].includes(url.pathname)) {
            res.setHeader("Content-Type", "text/javascript");
            res.end(readFileSync(path.resolve(__dirname, "../scripts/test-host", url.pathname.endsWith("bootstrap.mjs") ? "bootstrap.mjs" : "bridge.mjs"), "utf8"));
            return;
          }
          if (url.pathname === "/__host/config" && req.method === "GET") {
            return reply(200, { ...fixture, rpc: undefined, chainId: 480,
              timestamp: Number((await provider.getBlock("latest")).timestamp), testOnly: true });
          }
          if (url.pathname.startsWith("/__host/userop/") && req.method === "GET") {
            const receipt = await executor.lookup(url.pathname.slice("/__host/userop/".length));
            return reply(receipt ? 200 : 404, receipt || { error: "Unknown local operation" });
          }
          if (req.method !== "POST" && !url.pathname.startsWith("/__host/api/")) return reply(405, { error: "POST required" });
          let raw = "";
          for await (const chunk of req) {
            raw += chunk;
            if (raw.length > 1_000_000) return reply(413, { error: "Request too large" });
          }
          const body = raw ? JSON.parse(raw) : {};
          if (url.pathname === "/__host/command") {
            if (!["owner", "heir"].includes(body.role)) return reply(400, { error: "Unknown test account" });
            return reply(200, await serial(() => executor.execute(body.envelope, { role: body.role, origin: url.origin })));
          }
          if (url.pathname === "/__host/rpc") {
            const allowed = new Set(["eth_chainId", "eth_blockNumber", "eth_getBalance", "eth_call", "eth_getCode", "eth_getLogs", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getTransactionCount", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "net_version"]);
            const requests = Array.isArray(body) ? body : [body];
            if (requests.length > 100 || requests.some(item => !allowed.has(item.method))) return reply(403, { error: "Only app read methods are proxied" });
            const upstream = await fetch(fixture.rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
            return reply(upstream.status, await upstream.json());
          }
          if (url.pathname === "/__host/control") {
            return reply(200, await serial(async () => {
              if (body.action === "time") {
                if (![1, 7, 31, 91, 181].includes(body.days)) throw new Error("Unsupported time step");
                await provider.send("evm_increaseTime", [body.days * 86400]);
                await provider.send("evm_mine", []);
              } else if (body.action === "yield") {
                const signer = await provider.getSigner(0);
                for (const address of [fixture.wldStrategy, fixture.usdcStrategy]) {
                  const strategy = new Contract(address, ["function setRate(uint256)", "function rate() view returns(uint256)"], signer);
                  const rate = await strategy.rate();
                  await (await strategy.setRate(rate * 110n / 100n)).wait();
                }
              } else throw new Error("Unknown test control");
              return { ok: true, timestamp: Number((await provider.getBlock("latest")).timestamp) };
            }));
          }
          // Explicit notification simulation, with no remote registration or delivery.
          if (url.pathname === "/__host/api/notifications/register") {
            watchers.set(String(body.vaultAddress).toLowerCase(), { active: true });
            return reply(200, { status: "success", watcher: { active: true }, simulated: true });
          }
          if (url.pathname === "/__host/api/notifications/status") return reply(200, { status: "success", watcher: watchers.get((url.searchParams.get("vaultAddress") || "").toLowerCase()) || null, simulated: true });
          if (url.pathname === "/__host/api/notifications") return reply(200, { status: "success", watchers: [], nextCursor: null, simulated: true });
          if (url.pathname === "/__host/api/automation/health") return reply(200, { automation: { enabled: false, supported: false, funded: false, halted: false, reason: "test_host_no_keeper" }, simulated: true });
          return reply(404, { error: "Unknown test host route" });
        } catch (error) {
          return reply(400, { error: error instanceof Error ? error.message : "Local test command failed" });
        }
      });
      server.httpServer?.once("close", () => provider.destroy());
    },
  };
}

export default defineConfig(({ command }) => {
  if (command !== "serve") throw new Error("The test host is development-only and cannot be built for deployment.");
  return {
    envDir: false,
    plugins: [react(), tsconfigPaths({ projects: [path.resolve(__dirname, "tsconfig.app.json")] }), localAuth(), hostServer()],
    resolve: { alias: { "@": path.resolve(__dirname, "src") } },
    server: { host: "127.0.0.1", port: 7777, strictPort: true, allowedHosts: ["localhost"], cors: false },
  };
});
