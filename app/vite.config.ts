import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";

export default defineConfig({
  plugins: [react(), tsconfigPaths({ projects: ["./tsconfig.app.json"] })],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/") && /\/(ethers|@noble|@adraffy|aes-js)\//.test(id)) return "chain";
          if (id.includes("/node_modules/") && /\/(react|react-dom|scheduler)\//.test(id)) return "react";
        }
      }
    }
  },
  server: {
    host: true,
    port: 5173,
    // World App 개발용 터널 호스트는 필요할 때 여기에 추가한다.
    // (개인 ngrok 서브도메인은 특정 기기에 종속되므로 기본값으로 두지 않는다)
    allowedHosts: [],
    cors: {
      origin: "*" // 개발 중엔 전체 허용 (배포 시엔 꼭 필요한 도메인만 남기세요)
    }
  }
});
