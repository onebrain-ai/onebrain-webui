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

import { DaemonError, ConflictError } from "./types";
import type { OnebrainConfig, VaultFile, VaultTree, WriteResult, TrashResult, MoveResult, FolderResult } from "./types";

export interface DaemonClient {
  /** `GET /api/config` — parsed onebrain.yml. */
  config(): Promise<OnebrainConfig>;
  /** `GET /api/vault/tree` — flat, sorted folder/file listing. */
  tree(): Promise<VaultTree>;
  /** `GET /api/vault/file?path=` — one note's content + revision tag. */
  file(path: string): Promise<VaultFile>;
  /** `POST /api/vault/file` — create a note (409 if it exists). */
  createFile(path: string, content: string): Promise<WriteResult>;
  /** `PUT /api/vault/file` with `If-Match: <rev>` — overwrite; 409 on stale rev. */
  saveFile(path: string, content: string, expectedRev: string): Promise<WriteResult>;
  /** `DELETE /api/vault/file` — move the note to `.trash/`. */
  deleteFile(path: string): Promise<TrashResult>;
  /** `POST /api/vault/move` — rename/move (+ wikilink rewrite, server-side). */
  moveFile(from: string, to: string): Promise<MoveResult>;
  /** `POST /api/vault/folder` — create a folder (409 if it exists). */
  createFolder(path: string): Promise<FolderResult>;
  /** `DELETE /api/vault/folder` — move the folder to `.trash/`. */
  deleteFolder(path: string): Promise<TrashResult>;
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

  createFile(path: string, content: string): Promise<WriteResult> {
    return this.send("POST", `/api/vault/file?path=${encodeURIComponent(path)}`, content, {
      "Content-Type": "text/plain; charset=utf-8",
    });
  }

  saveFile(path: string, content: string, expectedRev: string): Promise<WriteResult> {
    return this.send("PUT", `/api/vault/file?path=${encodeURIComponent(path)}`, content, {
      "Content-Type": "text/plain; charset=utf-8",
      "If-Match": expectedRev,
    });
  }

  deleteFile(path: string): Promise<TrashResult> {
    return this.send("DELETE", `/api/vault/file?path=${encodeURIComponent(path)}`);
  }

  moveFile(from: string, to: string): Promise<MoveResult> {
    return this.send("POST", "/api/vault/move", JSON.stringify({ from, to }), {
      "Content-Type": "application/json",
    });
  }

  createFolder(path: string): Promise<FolderResult> {
    return this.send("POST", `/api/vault/folder?path=${encodeURIComponent(path)}`);
  }

  deleteFolder(path: string): Promise<TrashResult> {
    return this.send("DELETE", `/api/vault/folder?path=${encodeURIComponent(path)}`);
  }

  /** Non-GET request with the auth token; maps 409 → ConflictError (carrying the
   *  body's current `rev`), other non-2xx → DaemonError. */
  private async send<T>(
    method: string,
    path: string,
    body?: string,
    extra?: Record<string, string>,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", ...extra };
    if (this.token) headers["X-OneBrain-Token"] = this.token;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { method, headers, body });
    } catch (cause) {
      throw new DaemonError(0, `cannot reach the daemon (${String(cause)})`);
    }
    if (!res.ok) {
      if (res.status === 409) {
        const c = await readConflict(res);
        throw new ConflictError(c.message, c.rev);
      }
      throw new DaemonError(res.status, await readError(res));
    }
    return (await res.json()) as T;
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

/** Pull `{ error, rev }` out of a 409 body. `rev` is the server's current rev. */
async function readConflict(res: Response): Promise<{ message: string; rev: string | null }> {
  try {
    const b = (await res.json()) as { error?: unknown; rev?: unknown };
    return {
      message: typeof b.error === "string" ? b.error : "conflict",
      rev: typeof b.rev === "string" ? b.rev : null,
    };
  } catch {
    return { message: "conflict", rev: null };
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
