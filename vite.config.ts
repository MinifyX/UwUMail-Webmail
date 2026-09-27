/// <reference types="vitest/config" />
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build, defineConfig, loadEnv, type Plugin } from "vite";

const alias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };

/**
 * The service worker for Web Push (src/sw/sw.ts), built on its own as one classic script at
 * `dist/sw.js`: served as `/mail/sw.js` it covers all of `/mail/` without any extra header, and
 * as a single file it shares no chunks with the page, which a classic service worker could not
 * load. Only in `pnpm build`; the dev server has none.
 */
function serviceWorker(): Plugin {
  let outDir = "dist";
  return {
    name: "uwumail-service-worker",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    async closeBundle() {
      await build({
        configFile: false,
        logLevel: "warn",
        publicDir: false,
        resolve: { alias },
        build: {
          outDir,
          emptyOutDir: false,
          target: "es2022",
          sourcemap: false,
          lib: {
            entry: fileURLToPath(new URL("./src/sw/sw.ts", import.meta.url)),
            formats: ["iife"],
            name: "uwumailServiceWorker",
            fileName: () => "sw.js",
          },
        },
      });
    },
  };
}

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
    plugins: [react(), tailwindcss(), serviceWorker()],
    resolve: { alias },
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
