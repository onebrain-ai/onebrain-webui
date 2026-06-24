// Task store — real vault tasks from `GET /api/vault/tasks` (the daemon scans
// every dated `- [ ] … 📅 YYYY-MM-DD` line). The Tasks panel's calendar + list
// and every Status panel's "due" count read this shared signal, and toggling a
// task writes the flipped checkbox straight back to its source note.

import { signal, computed } from "@preact/signals";
import { ConflictError } from "../core/types";
import type { DaemonClient, VaultTask } from "../core/daemon";

export type { VaultTask };

/** All dated tasks in the vault (loaded once at shell boot). */
export const tasks = signal<VaultTask[]>([]);
export const tasksLoaded = signal<boolean>(false);
export const tasksError = signal<string | null>(null);
/** A transient notice (e.g. a save conflict) shown above the list, not blocking it. */
export const taskNotice = signal<string | null>(null);
/** Keys of tasks toggled this session — kept visible even once `done` so the user
 *  can immediately un-check a mis-click (the list otherwise hides done tasks). */
export const recentlyToggled = signal<Set<string>>(new Set());

export const taskKey = (t: VaultTask) => `${t.file}:${t.line}`;

/** Calendar filter: when set (`YYYY-MM-DD`), the list shows only that day's tasks.
 *  Null = no day filter (show all open). */
export const selectedDate = signal<string | null>(null);

/** Obsidian-Tasks priority levels we edit (CLAUDE.md set). "none" = no marker. */
export type Priority = "high" | "medium" | "low" | "none";
const PRIO_EMOJI: Record<Exclude<Priority, "none">, string> = { high: "🔺", medium: "⏫", low: "🔽" };
const PRIO_ALL = "🔺⏫🔼🔽⏬"; // strip any of these (incl. the two we don't author) when rebuilding

/** The description a user edits: the task body with the date + priority markers
 *  removed (tags stay — they're part of the text). */
export function taskDescription(text: string): string {
  return text
    .replace(DUE_MARK, "")
    .replace(new RegExp(`[${PRIO_ALL}]`, "gu"), "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The priority encoded in a task's text, if any. */
export function taskPriority(text: string): Priority {
  if (text.includes("🔺")) return "high";
  if (text.includes("⏫")) return "medium";
  if (text.includes("🔽")) return "low";
  return "none";
}

/** Rebuild a full task line from its parts (Obsidian order: text · priority · date). */
function buildTaskLine(indent: string, checkbox: string, desc: string, priority: Priority, due: string | null): string {
  const prio = priority !== "none" ? ` ${PRIO_EMOJI[priority]}` : "";
  const date = due ? ` 📅 ${due}` : "";
  return `${indent}- [${checkbox}] ${taskDescription(desc)}${prio}${date}`;
}

/** Local-time `YYYY-MM-DD` (NOT UTC — the user's "today" must match their clock,
 *  or tasks flip overdue at the wrong hour in a non-UTC zone). */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Undone tasks whose due date is today or earlier (the "due" headline number). */
export const dueCount = computed(() => {
  const t = todayLocal();
  return tasks.value.filter((x) => !x.done && x.due && x.due <= t).length;
});
/** All undone tasks (the Tasks footer "open"). */
export const openCount = computed(() => tasks.value.filter((x) => !x.done).length);
/** Completed tasks. */
export const doneCount = computed(() => tasks.value.filter((x) => x.done).length);

/** Load (or refresh) the vault's tasks. Called once at shell boot. */
export async function loadTasks(daemon: DaemonClient): Promise<void> {
  try {
    tasks.value = await daemon.tasks();
    tasksError.value = null;
    recentlyToggled.value = new Set(); // fresh truth — drop the keep-visible set
  } catch (e) {
    tasksError.value = e instanceof Error ? e.message : "could not load tasks";
  } finally {
    tasksLoaded.value = true;
  }
}

const FLIP = /^(\s*-\s+\[)(.)(\])/; // captures the checkbox char to swap
const TASK_LINE = /^\s*-\s+\[(.)\]\s+(.+?)\s*$/;
const DUE_MARK = /📅\s*\d{4}-\d{2}-\d{2}/;
const inflight = new Set<string>();

function setLocalDone(file: string, line: number, done: boolean): void {
  tasks.value = tasks.value.map((t) => (t.file === file && t.line === line ? { ...t, done } : t));
}

/** Does `line` still hold the SAME task the user clicked? Compares the line's
 *  text (date marker stripped, the way the scanner produced `task.text`) so a
 *  line that DRIFTED to a different task is rejected instead of corrupted. */
function lineIsTask(line: string, task: VaultTask): boolean {
  const m = line.match(TASK_LINE);
  if (!m) return false;
  return m[2].replace(DUE_MARK, "").trim() === task.text;
}

/** Flip a task's checkbox in its source note (real write-back). Optimistic: the
 *  UI updates immediately, then the note is re-read + saved; on any drift (line
 *  no longer the same task, stale rev) it reverts and reloads to resync. */
export async function toggleTask(daemon: DaemonClient, task: VaultTask): Promise<void> {
  const k = taskKey(task);
  if (inflight.has(k)) return;
  inflight.add(k);
  recentlyToggled.value = new Set(recentlyToggled.value).add(k); // keep it visible
  taskNotice.value = null;
  const next = !task.done;
  setLocalDone(task.file, task.line, next);
  try {
    const f = await daemon.file(task.file);
    // Preserve the file's line ending so a CRLF note isn't silently LF-flattened.
    const nl = f.content.includes("\r\n") ? "\r\n" : "\n";
    const lines = f.content.split(nl);
    const line = lines[task.line - 1];
    // Reject (don't write) unless the target line is STILL this exact task — a
    // bare "is some checkbox" check could flip a different, drifted task.
    if (line === undefined || !lineIsTask(line, task)) {
      throw new Error("drift");
    }
    lines[task.line - 1] = line.replace(FLIP, `$1${next ? "x" : " "}$3`);
    await daemon.saveFile(task.file, lines.join(nl), f.rev);
  } catch (e) {
    setLocalDone(task.file, task.line, task.done); // revert the optimistic flip
    if (e instanceof ConflictError) {
      taskNotice.value = "note changed on disk — reloaded, try again";
    } else {
      taskNotice.value = "couldn't update the note — reloaded";
    }
    await loadTasks(daemon); // resync (line numbers / rev drifted)
  } finally {
    inflight.delete(k);
  }
}

const FULL_TASK_LINE = /^(\s*)-\s+\[(.)\]\s+(.+?)\s*$/; // indent, checkbox, body

/** Read the note → verify the target line is STILL this task → transform (or
 *  remove) the line → save → reload. Returns true on success. Shared by
 *  edit/delete; mirrors `toggleTask`'s drift + conflict handling. */
async function mutateLine(
  daemon: DaemonClient,
  task: VaultTask,
  transform: ((line: string) => string | null) | null,
): Promise<boolean> {
  const k = taskKey(task);
  if (inflight.has(k)) return false;
  inflight.add(k);
  taskNotice.value = null;
  try {
    const f = await daemon.file(task.file);
    const nl = f.content.includes("\r\n") ? "\r\n" : "\n";
    const lines = f.content.split(nl);
    const line = lines[task.line - 1];
    if (line === undefined || !lineIsTask(line, task)) throw new Error("drift");
    if (transform === null) {
      lines.splice(task.line - 1, 1); // delete
    } else {
      const next = transform(line);
      if (next === null) throw new Error("drift");
      lines[task.line - 1] = next;
    }
    await daemon.saveFile(task.file, lines.join(nl), f.rev);
    await loadTasks(daemon); // line numbers shift on delete; text/due changed on edit
    return true;
  } catch (e) {
    taskNotice.value =
      e instanceof ConflictError ? "note changed on disk — reloaded" : "couldn't update the note — reloaded";
    await loadTasks(daemon);
    return false;
  } finally {
    inflight.delete(k);
  }
}

/** Edit a task's description / due date / priority in its source note. */
export function editTask(
  daemon: DaemonClient,
  task: VaultTask,
  next: { text: string; due: string | null; priority: Priority },
): Promise<boolean> {
  return mutateLine(daemon, task, (line) => {
    const m = line.match(FULL_TASK_LINE);
    return m ? buildTaskLine(m[1], m[2], next.text, next.priority, next.due) : null;
  });
}

/** Delete a task line from its source note. */
export function deleteTask(daemon: DaemonClient, task: VaultTask): Promise<boolean> {
  return mutateLine(daemon, task, null);
}

/** Append a new dated task line to the end of a note, then refresh. */
export async function addTask(
  daemon: DaemonClient,
  file: string,
  next: { text: string; due: string | null; priority: Priority },
): Promise<boolean> {
  taskNotice.value = null;
  try {
    const f = await daemon.file(file);
    const nl = f.content.includes("\r\n") ? "\r\n" : "\n";
    const sep = f.content === "" || f.content.endsWith(nl) ? "" : nl;
    const line = buildTaskLine("", " ", next.text, next.priority, next.due);
    await daemon.saveFile(file, f.content + sep + line + nl, f.rev);
    await loadTasks(daemon);
    return true;
  } catch (e) {
    taskNotice.value = e instanceof ConflictError ? "note changed on disk — try again" : "couldn't add the task";
    return false;
  }
}
