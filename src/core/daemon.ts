// DaemonClient — the one data interface the whole WebUI talks to (spec §6.1).
//
// Transport-agnostic by design (decision D3): the base URL may be the local
// daemon (`/api` same-origin via the dev proxy, or the daemon-served dist) or a
// remote self-host. Panels depend only on this interface, never on fetch/URL/
// token details — so swapping local↔remote, or mock↔live, is a boot-time concern.
//
// This file ships the live `HttpDaemonClient`. A `MockDaemonClient` (the
// prototype's in-memory fixtures) implements the same interface for offline
// demo/command-center work; it lands when the command-center port does.

import { DaemonError } from "./types";
import type { OnebrainConfig, VaultFile, VaultTree } from "./types";

export interface DaemonClient {
  /** `GET /api/config` — parsed onebrain.yml. */
  config(): Promise<OnebrainConfig>;
  /** `GET /api/vault/tree` — flat, sorted folder/file listing. */
  tree(): Promise<VaultTree>;
  /** `GET /api/vault/file?path=` — one note's content + revision tag. */
  file(path: string): Promise<VaultFile>;
}

/** Live client over the daemon's HTTP JSON API. */
export class HttpDaemonClient implements DaemonClient {
  /**
   * @param token  per-session auth token (required on every `/api/*` call).
   * @param baseUrl base for the API. Default `""` → same-origin `/api/...`,
   *                which the Vite dev proxy and the daemon-served dist both
   *                resolve correctly. A remote self-host passes its origin.
   */
  constructor(
    private readonly token: string | null,
    private readonly baseUrl: string = "",
  ) {}

  config(): Promise<OnebrainConfig> {
    return this.getJson<OnebrainConfig>("/api/config");
  }

  tree(): Promise<VaultTree> {
    return this.getJson<VaultTree>("/api/vault/tree");
  }

  file(path: string): Promise<VaultFile> {
    return this.getJson<VaultFile>(`/api/vault/file?path=${encodeURIComponent(path)}`);
  }

  /** GET `path`, attach the auth token, parse JSON, and turn a non-2xx into a
   *  typed `DaemonError` carrying the daemon's curated `{ error }` message. */
  private async getJson<T>(path: string): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.token) headers["X-OneBrain-Token"] = this.token;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { headers });
    } catch (cause) {
      // Network-level failure (daemon down, DNS, CORS) — distinct from an HTTP
      // error status. Surface it as a 0-status DaemonError the UI can show.
      throw new DaemonError(0, `cannot reach the daemon (${String(cause)})`);
    }

    if (!res.ok) {
      throw new DaemonError(res.status, await readError(res));
    }
    return (await res.json()) as T;
  }
}

/** Pull the daemon's curated `{ error }` message out of a failed response,
 *  falling back to the status text when the body isn't the expected shape. */
async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Body wasn't JSON (e.g. a 401 from the auth middleware is empty) — fall
    // through to a status-based message.
  }
  return res.statusText || `HTTP ${res.status}`;
}
