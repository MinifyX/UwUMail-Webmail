/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

/**
 * The webmail is served from the UwUMail server under `/mail`, so every asset
 * link has to carry that prefix. `pnpm dev` talks to a real server set in
 * `.env.local` (see `.env.example`); without one, and in `--mode demo`, the app
 * falls back to its sample data and needs no server at all.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const server = env.UWUMAIL_DEV_SERVER;
  // Test servers usually carry a self-signed certificate.
  const proxy = server
    ? {
        target: server,
        changeOrigin: false,
        secure: env.UWUMAIL_DEV_SERVER_INSECURE !== "1",
      }
    : undefined;

  return {
    base: "/mail/",
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      port: 1440,
      strictPort: true,
      proxy: proxy
        ? {
            "/api": proxy,
            // The WebSocket for push goes through too (RFC 8887).
            "/jmap": { ...proxy, ws: true },
            "/.well-known/jmap": proxy,
            // The server's colours and logo, see lib/brand.
            "/branding": proxy,
          }
        : undefined,
    },
    build: {
      target: "es2022",
      sourcemap: false,
      // The server's policy allows fonts only from 'self', so a small font subset
      // inlined as a data: URL would be blocked; keep every font a file.
      assetsInlineLimit: (file) => (file.endsWith(".woff2") ? false : undefined),
    },
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
