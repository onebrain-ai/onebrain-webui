// Task store — one shared model so the Tasks panel's list + footers and every
// Status panel's "due" count stay in sync (toggling a task anywhere updates them
// all). Ported from the prototype (TASKS 2381–2387, taskDone / openTasks /
// refreshStats 2390–2400).

import { signal, computed } from "@preact/signals";

export interface Task {
  title: string;
  due: string;
}

export const TASKS: Task[] = [
  { title: "Consolidate inbox backlog", due: "2026-06-02" },
  { title: "Draft weekly review", due: "2026-06-05" },
  { title: "Research spatial UI patterns", due: "2026-06-08" },
  { title: 'Distill "Harness OS" notes', due: "2026-06-12" },
  { title: "Capture command-center concept", due: "2026-06-01" },
];

/** titles done at boot (the prototype seeds the last one complete). */
const DONE_INIT = new Set(["Capture command-center concept"]);

/** title → done. A signal so the Tasks list + Status due-count react together. */
export const taskDone = signal<Record<string, boolean>>(
  Object.fromEntries(TASKS.map((t) => [t.title, DONE_INIT.has(t.title)])),
);

/** count of open (undone) tasks — Status "due" + the Tasks footer read this. */
export const dueCount = computed(() => TASKS.filter((t) => !taskDone.value[t.title]).length);
/** count of done tasks — the Tasks footer reads this. */
export const doneCount = computed(() => TASKS.length - dueCount.value);

/** Toggle a task's done state (clicking a row anywhere updates every panel). */
export function toggleTask(title: string): void {
  taskDone.value = { ...taskDone.value, [title]: !taskDone.value[title] };
}
