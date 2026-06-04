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
