import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";

// E2E 전용 설정. MiniKit 브릿지를 로컬 스텁으로 대체해 World App 없이도
// 앱의 실제 코드 경로(트랜잭션 전송, 온체인 확인 대기, 에러 표시)를 실행한다.
// 프로덕션 빌드에는 절대 사용하지 않는다 (`pnpm build` 는 vite.config.ts 를 쓴다).
export default defineConfig({
  plugins: [react(), tsconfigPaths({ projects: ["./tsconfig.app.json"] })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@worldcoin/minikit-js": path.resolve(__dirname, "./src/test/minikit-stub.ts"),
    },
  },
  server: { host: true, port: 5173, allowedHosts: [] },
});
