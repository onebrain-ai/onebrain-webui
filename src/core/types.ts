// Wire types — mirror the daemon's JSON API exactly (crates/onebrain-cli/src/server/api.rs).
// Keep these in lock-step with the Rust DTOs; a drift here is a silent runtime bug.

/** `GET /api/config` — parsed onebrain.yml. Only a subset of keys is guaranteed;
 *  the daemon serializes whatever `VaultConfig` holds, so treat extras as opaque. */
export interface OnebrainConfig {
  qmd_collection?: string;
  folders?: Record<string, string>;
  checkpoint?: { messages?: number; minutes?: number };
  // Forward-compatible: the daemon may add keys (update_channel, recap, …).
  [key: string]: unknown;
}

/** One node in `GET /api/vault/tree`. `path` is vault-relative, slash-separated. */
export interface VaultNode {
  path: string;
  name: string;
  kind: "file" | "dir";
}

/** `GET /api/vault/tree` response body. */
export interface VaultTree {
  root: string;
  entries: VaultNode[];
}

/** `GET /api/vault/file?path=` response body. `rev` = file mtime in ns (stringified). */
export interface VaultFile {
  path: string;
  content: string;
  rev: string;
}

/** The daemon's error envelope: `{ "error": "<curated message>" }` + an HTTP status. */
export class DaemonError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DaemonError";
  }
}

/** `POST`/`PUT /api/vault/file` success body (mirrors Rust `WriteResponse`). */
export interface WriteResult {
  path: string;
  rev: string;
}

/** `DELETE /api/vault/{file,folder}` success body (mirrors `TrashResponse`). */
export interface TrashResult {
  path: string;
  trashed_to: string;
}

/** `POST /api/vault/move` success body (mirrors `MoveResult`). */
export interface MoveResult {
  from: string;
  to: string;
}

/** `POST /api/vault/folder` success body (mirrors `FolderResult`). */
export interface FolderResult {
  path: string;
}

/** A 409 from `PUT /api/vault/file`: the on-disk `rev` moved under us. Carries
 *  the server's current rev so the UI can offer reload / overwrite. */
export class ConflictError extends DaemonError {
  constructor(
    message: string,
    public readonly rev: string | null,
  ) {
    super(409, message);
    this.name = "ConflictError";
  }
}
