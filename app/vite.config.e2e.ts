import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";
import { verifySiweMessage } from "@worldcoin/minikit-js/siwe";
import { issueNonce, verifyNonce } from "./functions/_lib/siwe";

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
  const SECRET = "e2e-only-secret-not-a-real-credential";
  return {
    name: "e2e-local-auth",
    configureServer(server) {
      server.middlewares.use("/api/auth/nonce", async (_req, res) => {
        const n = await issueNonce(SECRET);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ status: "success", nonce: n.value, expiresAt: n.expiresAt }));
      });
      server.middlewares.use("/api/auth/verify", async (req, res) => {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        res.setHeader("content-type", "application/json");
        let body: { payload?: { message?: string; signature?: string }; nonce?: string };
        try {
          body = JSON.parse(raw);
        } catch {
          res.statusCode = 400;
          res.end(JSON.stringify({ status: "error", message: "bad body" }));
          return;
        }
        const { message, signature } = body.payload || {};
        if (!message || !signature || !body.payload?.address || !body.nonce) {
          res.statusCode = 400;
          res.end(JSON.stringify({ status: "error", message: "missing message/signature/address/nonce" }));
          return;
        }
        if (!(await verifyNonce(SECRET, body.nonce))) {
          res.statusCode = 401;
          res.end(JSON.stringify({ status: "error", message: "bad nonce" }));
          return;
        }
        try {
          const v = await verifySiweMessage({ message, signature, address: body.payload.address }, body.nonce);
          const d = v as { isValid?: boolean; siweMessageData?: { address?: string; domain?: string } };
          res.end(
            JSON.stringify({
              status: "success",
              isValid: Boolean(d.isValid),
              address: d.siweMessageData?.address,
              domain: d.siweMessageData?.domain,
            }),
          );
        } catch (e) {
          res.statusCode = 401;
          res.end(JSON.stringify({ status: "error", message: (e as Error).message }));
        }
      });
    },
  };
}

// E2E 전용 설정. MiniKit 브릿지를 로컬 스텁으로 대체해 World App 없이도
// 앱의 실제 코드 경로(트랜잭션 전송, 온체인 확인 대기, 에러 표시)를 실행한다.
// 프로덕션 빌드에는 절대 사용하지 않는다 (`pnpm build` 는 vite.config.ts 를 쓴다).
export default defineConfig({
  plugins: [react(), tsconfigPaths({ projects: ["./tsconfig.app.json"] }), localAuth()],
  resolve: {
    alias: [
      // 서브패스를 먼저 둔다. Vite 의 문자열 alias 는 prefix 매칭이라
      // 순서를 뒤집으면 `/commands` 가 스텁 파일 뒤에 붙는다.
      {
        find: /^@worldcoin\/minikit-js\/commands$/,
        replacement: path.resolve(__dirname, "./src/test/minikit-stub.ts"),
      },
      {
        find: /^@worldcoin\/minikit-js$/,
        replacement: path.resolve(__dirname, "./src/test/minikit-stub.ts"),
      },
      { find: /^@\//, replacement: path.resolve(__dirname, "./src") + "/" },
    ],
  },
  server: { host: true, port: 5173, allowedHosts: [] },
});
