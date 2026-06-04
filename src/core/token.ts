// Per-session auth token resolution.
//
// The daemon requires the token on every `/api/*` call (header). Where the token
// comes from depends on how the WebUI is being served:
//
// 1. **Served by the daemon** (production: `onebrain serve --dir dist`) — the
//    daemon injects `window.__ONEBRAIN_TOKEN__` into the served index.html.
// 2. **`vite dev`** (development) — the placeholder in index.html is never
//    replaced, so we read the token from the `?token=` URL query (the same value
//    `serve` prints, Jupyter-style) and persist it to sessionStorage so it
//    survives in-app navigations and reloads without re-pasting.
//
// Resolution order: injected global → `?token=` query → sessionStorage.

const PLACEHOLDER = "__ONEBRAIN_TOKEN__";
const STORAGE_KEY = "onebrain.token";

declare global {
  interface Window {
    __ONEBRAIN_TOKEN__?: string;
  }
}

/** Resolve the session token, or `null` if none is available (the UI then shows
 *  a "no token" notice instead of firing doomed 401s). */
export function resolveToken(): string | null {
  // 1. Daemon-injected global (the placeholder means it was NOT injected).
  const injected = window.__ONEBRAIN_TOKEN__;
  if (injected && injected !== PLACEHOLDER) {
    persist(injected);
    return injected;
  }

  // 2. `?token=` from the URL (dev path). Strip it from the visible URL after
  //    capture so the secret doesn't linger in the address bar / history.
  const fromQuery = new URLSearchParams(window.location.search).get("token");
  if (fromQuery) {
    persist(fromQuery);
    stripTokenFromUrl();
    return fromQuery;
  }

  // 3. Previously-captured token (dev, after a reload with no query).
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function persist(token: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // sessionStorage can throw in private-mode / sandboxed contexts — non-fatal.
  }
}

function stripTokenFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("token");
    window.history.replaceState({}, "", url.toString());
  } catch {
    // Best-effort cosmetic cleanup; ignore if the History API is unavailable.
  }
}
