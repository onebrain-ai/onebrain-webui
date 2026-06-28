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

/** One chat turn request. `sessionId` resumes a prior claude conversation
 *  (omit/null to start fresh); `model` optionally overrides the agent model. */
export interface ChatRequest {
  message: string;
  sessionId?: string | null;
  model?: string;
}

/** A streamed event from `POST /api/chat`. `session` arrives first (carries the
 *  id to resume next turn), `delta` carries each assistant text block, `done`
 *  ends the turn, `error` reports a failure. */
export type ChatEvent =
  | { type: "session"; sessionId: string }
  | { type: "delta"; text: string }
  | { type: "done"; result: string; sessionId: string | null; isError: boolean }
  | { type: "error"; message: string };

/** A scheduled task scanned from a vault note (`- [ ] text 📅 YYYY-MM-DD`). */
export interface VaultTask {
  /** Vault-relative path of the note the task lives in. */
  file: string;
  /** 1-based line number within that note. */
  line: number;
  /** Task text (the `📅 date` marker stripped; other markers kept). */
  text: string;
  done: boolean;
  /** Due date `YYYY-MM-DD` (always present — only dated tasks are returned). */
  due: string | null;
}

/** One qmd-backed search result (`GET /api/vault/search`). */
export interface SearchHit {
  /** Vault-relative path, openable via `file()` / Preview. */
  path: string;
  /** qmd relevance score, roughly 0..1 (higher = better). */
  score: number;
  /** Note title (qmd's — usually the H1 or filename). */
  title: string;
  /** Short one-line excerpt around the match (may be empty). */
  snippet: string;
}

/** Which qmd search the daemon runs. `lex` = BM25 keyword (no LLM, fast enough
 *  to run as-you-type); `hybrid` = keyword + semantic vector (one query
 *  embedding ≈1-2s, local rerank). */
export type SearchMode = "lex" | "hybrid";

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
  /** `POST /api/chat` — stream a OneBrain agent turn (SSE). Calls `onEvent` for
   *  each event; resolves when the stream ends. Pass `signal` to cancel. */
  chat(req: ChatRequest, onEvent: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void>;
  /** `GET /api/vault/tasks` — every dated Obsidian-Tasks line in the vault. */
  tasks(): Promise<VaultTask[]>;
  /** `GET /api/vault/search?q=&mode=` — qmd-backed vault search. Pass `signal`
   *  to cancel a stale in-flight query (the panel aborts the previous request
   *  on each keystroke). */
  search(q: string, mode: SearchMode, signal?: AbortSignal): Promise<SearchHit[]>;
  /** `GET /api/vault/raw?path=` — a file's raw bytes (images, PDFs) for preview. */
  fileBlob(path: string): Promise<Blob>;
  /** Authenticated `/api/vault/raw` URL (token in the query) for direct use in an
   *  `<img src>` — which can't send the auth header. */
  rawUrl(path: string): string;
  /** `POST /api/vault/upload?path=` — write raw bytes to the vault (chat attachment). */
  uploadFile(path: string, data: ArrayBuffer): Promise<{ path: string }>;
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

  rawUrl(path: string): string {
    const tok = this.token ? `&token=${encodeURIComponent(this.token)}` : "";
    return `${this.baseUrl}/api/vault/raw?path=${encodeURIComponent(path)}${tok}`;
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

  tasks(): Promise<VaultTask[]> {
    return this.getJson<{ tasks: VaultTask[] }>("/api/vault/tasks").then((r) => r.tasks);
  }

  async search(q: string, mode: SearchMode, signal?: AbortSignal): Promise<SearchHit[]> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.token) headers["X-OneBrain-Token"] = this.token;
    const url = `${this.baseUrl}/api/vault/search?q=${encodeURIComponent(q)}&mode=${mode}`;
    let res: Response;
    try {
      res = await fetch(url, { headers, signal });
    } catch (cause) {
      // A caller-triggered abort (stale query superseded) throws an AbortError —
      // let it propagate untouched so the panel can ignore it; anything else is a
      // real network failure.
      if (signal?.aborted) throw cause;
      throw new DaemonError(0, `cannot reach the daemon (${String(cause)})`);
    }
    if (!res.ok) throw new DaemonError(res.status, await readError(res));
    const body = (await res.json()) as { hits: SearchHit[] };
    return body.hits;
  }

  async chat(req: ChatRequest, onEvent: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    if (this.token) headers["X-OneBrain-Token"] = this.token;
    const body = JSON.stringify({
      message: req.message,
      session_id: req.sessionId ?? null,
      model: req.model,
    });

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, { method: "POST", headers, body, signal });
    } catch (cause) {
      throw new DaemonError(0, `cannot reach the daemon (${String(cause)})`);
    }
    if (!res.ok) throw new DaemonError(res.status, await readError(res));
    if (!res.body) throw new DaemonError(0, "the daemon returned no chat stream");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line.
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const ev = parseSseFrame(frame);
        if (ev) onEvent(ev);
      }
    }
  }

  async fileBlob(path: string): Promise<Blob> {
    const headers: Record<string, string> = {};
    if (this.token) headers["X-OneBrain-Token"] = this.token;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/vault/raw?path=${encodeURIComponent(path)}`, { headers });
    } catch (cause) {
      throw new DaemonError(0, `cannot reach the daemon (${String(cause)})`);
    }
    if (!res.ok) throw new DaemonError(res.status, await readError(res));
    return res.blob();
  }

  async uploadFile(path: string, data: ArrayBuffer): Promise<{ path: string }> {
    const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
    if (this.token) headers["X-OneBrain-Token"] = this.token;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/vault/upload?path=${encodeURIComponent(path)}`, {
        method: "POST",
        headers,
        body: data,
      });
    } catch (cause) {
      throw new DaemonError(0, `cannot reach the daemon (${String(cause)})`);
    }
    if (!res.ok) throw new DaemonError(res.status, await readError(res));
    return (await res.json()) as { path: string };
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

/** Parse one SSE frame (`event: <name>\ndata: <json>`) into a typed ChatEvent,
 *  or null when the frame is a comment/keep-alive/unrecognised.
 *  Exported for unit tests. */
export function parseSseFrame(frame: string): ChatEvent | null {
  let event = "message";
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  let p: { session_id?: string; text?: string; result?: string; is_error?: boolean; message?: string };
  try {
    p = JSON.parse(data);
  } catch {
    return null;
  }
  switch (event) {
    case "session":
      return p.session_id ? { type: "session", sessionId: p.session_id } : null;
    case "delta":
      return { type: "delta", text: p.text ?? "" };
    case "done":
      return { type: "done", result: p.result ?? "", sessionId: p.session_id ?? null, isError: !!p.is_error };
    case "error":
      return { type: "error", message: p.message ?? "agent error" };
    default:
      return null;
  }
}
