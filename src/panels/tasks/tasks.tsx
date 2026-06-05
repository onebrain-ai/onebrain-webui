// Tasks · Calendar panel — a month grid + the due-task list, both reading the
// shared task store so toggling a task here updates every Status panel's "due"
// count too. Ported from the prototype (template 1235–1239, renderTaskList /
// fillTasks 2464–2491).

import type { PanelDef } from "../contract";
import { TASKS, taskDone, dueCount, doneCount, toggleTask } from "../tasks-store";
import "./tasks.css";

// June 2026 calendar: Jun 1 = Monday (firstDow=1), 30 days, today = the 2nd,
// dot-marked days carry a task (matches the prototype's fillTasks constants).
const FIRST_DOW = 1;
const CAL_DAYS = 30;
const TODAY = 2;
const HAS_TASK = new Set([1, 2, 5, 8, 12]);
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

function Tasks() {
  const done = taskDone.value;
  const open = dueCount.value;
  return (
    <>
      <div class="w-head">
        <span class="pill">
          <span class="dot" />
          Tasks · Due
        </span>
        <span class="w-meta">JUN 2026</span>
      </div>
      <div class="cal">
        {DOW.map((d) => (
          <div class="cd">{d}</div>
        ))}
        {Array.from({ length: FIRST_DOW }, () => (
          <div class="day empty" />
        ))}
        {Array.from({ length: CAL_DAYS }, (_, i) => {
          const d = i + 1;
          return <div class={`day${d === TODAY ? " today" : ""}${HAS_TASK.has(d) ? " has" : ""}`}>{d}</div>;
        })}
      </div>
      <div class="task-list">
        {open === 0 ? (
          <div class="empty-state">
            <svg viewBox="0 0 24 24">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            <div class="es-t">All clear</div>
            <div class="es-d">No tasks due. Tasks added inside a project note surface here by date.</div>
          </div>
        ) : (
          <>
            {TASKS.map((t) => (
              <div class={`task-row${done[t.title] ? " done" : ""}`} onClick={() => toggleTask(t.title)}>
                <span class="task-box">
                  <svg viewBox="0 0 24 24" fill="none" stroke-width="3">
                    <path d="M5 12l4 4L19 7" />
                  </svg>
                </span>
                <span>
                  <span class="tt">{t.title}</span>
                  <span class="td">📅 {t.due}</span>
                </span>
              </div>
            ))}
            <div class="task-foot">
              <span>
                <b class="tf-open">{open}</b> open
              </span>
              <span>
                <b class="tf-done">{doneCount.value}</b> done
              </span>
            </div>
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
  placement: { t: 2.55, y: 0.35, r: 6.7, s: 0.005 },
  seed: false, // not in the SEED arc; spawn via add-panel / ⌘K
  Component: Tasks,
};
