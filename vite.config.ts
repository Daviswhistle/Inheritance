import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";

export default defineConfig({
  plugins: [react(), tsconfigPaths({ projects: ["./tsconfig.app.json"] })],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") }
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts: [
      "b35a3ed04770.ngrok-free.app"
    ],
    cors: {
      origin: "*" // 개발 중엔 전체 허용 (배포 시엔 꼭 필요한 도메인만 남기세요)
    }
  }
});
