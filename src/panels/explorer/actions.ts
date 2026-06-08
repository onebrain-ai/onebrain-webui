import type { DaemonClient } from "../../core/daemon";
import { initVault } from "../bus";

export async function newNote(daemon: DaemonClient, path: string, open: (p: string) => void): Promise<void> {
  await daemon.createFile(path, "");
  await initVault(daemon); // refresh tree
  open(path);
}

export async function newFolder(daemon: DaemonClient, path: string): Promise<void> {
  await daemon.createFolder(path);
  await initVault(daemon);
}

export async function renameEntry(daemon: DaemonClient, from: string, to: string): Promise<void> {
  await daemon.moveFile(from, to);
  await initVault(daemon);
}

/** Delete to `.trash/` — ALWAYS gated by `confirm()` (vault boundary rule). */
export async function deleteEntry(
  daemon: DaemonClient,
  path: string,
  isDir: boolean,
  confirm: (p: string) => Promise<boolean>,
): Promise<void> {
  if (!(await confirm(path))) return;
  if (isDir) await daemon.deleteFolder(path);
  else await daemon.deleteFile(path);
  await initVault(daemon);
}
