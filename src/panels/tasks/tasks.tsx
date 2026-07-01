// Tasks · Calendar panel — a live month grid + the open-task list, both reading
// the shared task store (real vault tasks). Click a row to flip its checkbox in
// the source note; click a calendar day to filter to that day; per-row edit /
// delete, and an add button (modal + note picker). All edits write back to the
// source note via the shared store ops.

import type { PanelDef, PanelContext } from "../contract";
import {
  tasks,
  tasksLoaded,
  tasksError,
  taskNotice,
  recentlyToggled,
  selectedDate,
  taskKey,
  todayLocal,
  taskDescription,
  taskPriority,
  dueCount,
  doneCount,
  openCount,
  toggleTask,
  editTask,
  deleteTask,
  addTask,
} from "../tasks-store";
import { allFiles, previewPath } from "../bus";
import { confirmModal } from "../../ui/Modal";
import { openTaskModal } from "./task-modal";
import { Icon } from "../../ui/Icon";
import "./tasks.css";

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** Cap rows rendered in the narrow panel (the full counts live in the footer). */
const MAX_ROWS = 60;

/** Notes a task may be added to (real notes, not logs/archive/agent system files). */
function noteChoices(): string[] {
  return allFiles().filter(
    (p) => p.toLowerCase().endsWith(".md") && !/^(06-archive|07-logs|05-agent)\//i.test(p),
  );
}

function Tasks({ ctx }: { ctx: PanelContext }) {
  const all = tasks.value;
  const loaded = tasksLoaded.value;
  const keep = recentlyToggled.value;
  const sel = selectedDate.value;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based
  const todayD = now.getDate();
  const todayStr = todayLocal();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const iso = (d: number) => `${monthPrefix}-${String(d).padStart(2, "0")}`;
  const hasTask = new Set(
    all.filter((t) => !t.done && t.due && t.due.startsWith(monthPrefix)).map((t) => Number(t.due!.slice(8, 10))),
  );

  // The list: a selected calendar day filters to that day; otherwise open tasks
  // plus any toggled this session (kept visible so a done task can be un-checked).
  const visible = all
    .filter((t) => (sel ? t.due === sel : !t.done || keep.has(taskKey(t))))
    /* v8 ignore start -- ?? "" for undefined due dates: v8 double-counts ternary sub-branches in the sort comparator */
    .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "")); /* v8 ignore stop */
  const shown = visible.slice(0, MAX_ROWS);

  const onAdd = async () => {
    const choices = noteChoices();
    const draft = {
      text: "",
      due: sel ?? todayStr,
      priority: "none" as const,
      // Only pre-fill the open note if it's a valid target — a task added to an
      // excluded folder (logs/archive/agent) is scanned out and would vanish.
      file: choices.includes(previewPath.value) ? previewPath.value : "",
    };
    const res = await openTaskModal({ title: "New task", okLabel: "Add", draft, files: choices });
    if (res && res.file) await addTask(ctx.daemon, res.file, res);
  };

  const onEdit = async (t: (typeof all)[number]) => {
    const res = await openTaskModal({
      title: "Edit task",
      draft: { text: taskDescription(t.text), due: t.due, priority: taskPriority(t.text) },
    });
    if (res) await editTask(ctx.daemon, t, res);
  };

  const onDelete = async (t: (typeof all)[number]) => {
    const ok = await confirmModal({
      title: "Delete task?",
      message: taskDescription(t.text),
      okLabel: "Delete",
      danger: true,
    });
    if (ok) await deleteTask(ctx.daemon, t);
  };

  return (
    <>
      <div class="w-head">
        <span class="pill">
          <span class="dot" />
          Tasks · Due
        </span>
        <span class="task-head-r">
          <span class="w-meta">{`${MONTHS[month]} ${year}`}</span>
          <button type="button" class="task-add" title="New task" aria-label="New task" onClick={onAdd}>
            <Icon name="plus" />
          </button>
        </span>
      </div>

      <div class="cal">
        {DOW.map((d) => (
          <div class="cd">{d}</div>
        ))}
        {Array.from({ length: firstDow }, () => (
          <div class="day empty" />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const d = i + 1;
          const dIso = iso(d);
          const cls = `day${d === todayD ? " today" : ""}${hasTask.has(d) ? " has" : ""}${sel === dIso ? " sel" : ""}`;
          return (
            <div
              class={cls}
              role="button"
              tabIndex={0}
              aria-pressed={sel === dIso}
              aria-label={`${MONTHS[month]} ${d}, ${year}${d === todayD ? ", today" : ""}${hasTask.has(d) ? ", has tasks" : ""}`}
              onClick={() => (selectedDate.value = sel === dIso ? null : dIso)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectedDate.value = sel === dIso ? null : dIso;
                }
              }}
            >
              {d}
            </div>
          );
        })}
      </div>

      {sel && (
        <div class="task-filter">
          <span>Showing {sel}</span>
          <button type="button" onClick={() => (selectedDate.value = null)}>clear</button>
        </div>
      )}

      {taskNotice.value && <div class="task-notice">{taskNotice.value}</div>}

      <div class="task-list">
        {!loaded ? (
          <div class="empty-state">
            <div class="es-d">Loading tasks…</div>
          </div>
        ) : tasksError.value ? (
          <div class="empty-state">
            <div class="es-d">⚠ {tasksError.value}</div>
          </div>
        ) : visible.length === 0 ? (
          <div class="empty-state">
            <svg viewBox="0 0 24 24">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            <div class="es-t">{sel ? "Nothing due" : "All clear"}</div>
            <div class="es-d">
              {sel ? "No tasks due on this day." : "No open tasks. Add one with the + above, or in a note."}
            </div>
          </div>
        ) : (
          <>
            {shown.map((t) => {
              const overdue = !t.done && !!t.due && t.due < todayStr;
              return (
                <div class={`task-row${t.done ? " done" : ""}`}>
                  <span class="task-box" onClick={() => void toggleTask(ctx.daemon, t)}>
                    <svg viewBox="0 0 24 24" fill="none" stroke-width="3">
                      <path d="M5 12l4 4L19 7" />
                    </svg>
                  </span>
                  <span class="task-main" onClick={() => void toggleTask(ctx.daemon, t)}>
                    <span class="tt">{t.text}</span>
                    <span
                      class={`td${overdue ? " overdue" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        ctx.openFile(t.file);
                      }}
                    >
                      📅 {t.due} · {t.file.split("/").pop()}
                    </span>
                  </span>
                  <span class="task-acts">
                    <button type="button" title="Edit task" aria-label="Edit task" onClick={() => void onEdit(t)}>
                      <Icon name="edit" />
                    </button>
                    <button type="button" title="Delete task" aria-label="Delete task" onClick={() => void onDelete(t)}>
                      <Icon name="trash" />
                    </button>
                  </span>
                </div>
              );
            })}
            <div class="task-foot">
              <span><b>{openCount.value}</b> open</span>
              <span><b>{dueCount.value}</b> due</span>
              <span><b>{doneCount.value}</b> done</span>
            </div>
            {visible.length > MAX_ROWS && <div class="task-more">+{visible.length - MAX_ROWS} more</div>}
          </>
        )}
      </div>
    </>
  );
}

export const tasksPanel: PanelDef = {
  type: "tasks",
  name: "Tasks · Calendar",
  width: 312,
  seed: false, // not seeded on first load; opened on demand
  Component: Tasks,
};
