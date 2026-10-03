import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { onRequestGet as getNonce } from "./functions/api/auth/nonce";
import { onRequestPost as verifyLogin } from "./functions/api/auth/verify";
import { preflight, type Env } from "./functions/_lib/siwe";

// The local fixture has one factory. Never inherit the production legacy address
// from app/.env; a dual-factory test must configure its own local address explicitly.
process.env.VITE_LEGACY_FACTORY_ADDRESS ??= "";
process.env.VITE_LEGACY_FACTORY_DEPLOY_BLOCK ??= "";
process.env.VITE_YIELD_FACTORY_ADDRESS ??= "";
process.env.VITE_MORPHO_VAULT_ADDRESS ??= "";
process.env.VITE_YIELD_FACTORY_DEPLOY_BLOCK ??= "";

/**
 * E2E 용 Pages Functions 대체.
 *
 * 로그인이 서버 nonce + 서버 서명 검증을 거치게 되었으므로, 로컬 E2E 에서도
 * 그 경로를 그대로 태워야 한다. `/api/auth/*` 를 미끼로 대체(fetch 를 가로채면
 * 서버 검증을 검증하지 못한다) 여기서는 Pages Functions 가 쓰는 **같은 모듈**
 * (`functions/_lib/siwe.ts`)로 실제 서명 검증까지 수행한다.
 *
 * 그래서 이 스텁은 "로그인이 된 것처럼 보이게 하는 것"이 아니라, 서명이 실제로
 * 틀리면 여기서 거부된다.
 */
function localAuth(): Plugin {
  // A test-only in-memory D1 adapter. The real Pages handlers issue and consume
  // nonces and return the same signed session contract as production.
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(path.resolve(__dirname, "../backend/migrations/0003_auth.sql"), "utf8"));
  const DB: NonNullable<Env["DB"]> = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async run() { return db.prepare(sql).run(...args); },
            async first<T>() { return (db.prepare(sql).get(...args) as T | undefined) ?? null; },
          };
        },
      };
    },
  };
  return {
    name: "e2e-local-auth",
    configureServer(server) {
      for (const [endpoint, method, handler] of [
        ["/api/auth/nonce", "GET", getNonce],
        ["/api/auth/verify", "POST", verifyLogin],
      ] as const) {
        server.middlewares.use(endpoint, async (req, res) => {
          try {
            const frontendOrigin = `http://${req.headers.host}`;
            const env: Env = { DB, SIWE_SECRET: "e2e-only-secret-not-a-real-credential", FRONTEND_ORIGIN: frontendOrigin };
            const headers = new Headers();
            if (typeof req.headers.origin === "string") headers.set("Origin", req.headers.origin);
            let raw = "";
            for await (const chunk of req) raw += chunk;
            const request = new Request(frontendOrigin + endpoint, {
              method: req.method, headers, ...(req.method === "POST" ? { body: raw } : {}),
            });
            const response = req.method === "OPTIONS" ? preflight(request.headers.get("Origin"), env)
              : req.method === method ? await handler({ request, env }) : new Response(null, { status: 405 });
            res.statusCode = response.status;
            response.headers.forEach((value, key) => res.setHeader(key, value));
            res.end(await response.text());
          } catch {
            res.statusCode = 500;
            res.end(JSON.stringify({ status: "error", message: "Local auth failed" }));
          }
        });
      }
      server.httpServer?.once("close", () => db.close());
    },
  };
}

// E2E 전용 설정. MiniKit 브릿지를 로컬 스텁으로 대체해 World App 없이도
// 앱의 실제 코드 경로(트랜잭션 전송, 온체인 확인 대기, 에러 표시)를 실행한다.
// 프로덕션 빌드에는 절대 사용하지 않는다 (`pnpm build` 는 vite.config.ts 를 쓴다).
export default defineConfig({
  plugins: [react(), tsconfigPaths({ projects: ["./tsconfig.app.json"] }), localAuth()],
  optimizeDeps: { include: ["@worldcoin/minikit-js/commands"] },
  resolve: {
    alias: [
      // Keep /commands on the installed SDK so error identity and pre-handoff
      // availability checks exercise real SDK behavior. Only the native bridge
      // entry point uses the local signer fixture.
      {
        find: /^@worldcoin\/minikit-js$/,
        replacement: path.resolve(__dirname, "./src/test/minikit-stub.ts"),
      },
      { find: /^@\//, replacement: path.resolve(__dirname, "./src") + "/" },
    ],
  },
  server: { host: true, port: 5173, allowedHosts: [] },
});
