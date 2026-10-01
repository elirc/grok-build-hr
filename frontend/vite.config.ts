import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WEB_PORT || 5174),
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET || "http://127.0.0.1:4001",
        changeOrigin: false,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: Number(process.env.WEB_PORT || 5174),
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET || "http://127.0.0.1:4001",
        changeOrigin: false,
      },
    },
  },
});
