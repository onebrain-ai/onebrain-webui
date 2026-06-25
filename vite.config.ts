import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// The daemon (`onebrain serve` / `onebrain daemon`) the WebUI talks to in dev.
// Override with `ONEBRAIN_DAEMON=http://host:port npm run dev` to point at a
// remote / non-default daemon. Default matches `serve.rs` DEFAULT_PORT (6789).
const DAEMON = process.env.ONEBRAIN_DAEMON ?? "http://127.0.0.1:6789";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    // Proxy the daemon JSON API in dev so the SPA can call `/api/*` same-origin
    // (no CORS). The auth token is NOT injected here — the browser sends it as a
    // header (see `core/token.ts`), so the proxy just forwards transparently.
    proxy: {
      "/api": {
        target: DAEMON,
        changeOrigin: true,
      },
    },
  },
  build: {
    // The daemon serves this dist as an SPA (`serve --dir dist`); long-cache the
    // hashed assets, the entry HTML stays no-cache (daemon-side).
    target: "es2022",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
