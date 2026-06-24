// Tasks · Calendar panel — a live month grid + the open-task list, both reading
// the shared task store (real vault tasks from GET /api/vault/tasks). Clicking a
// row flips its checkbox in the source note; clicking the date opens that note.

import type { PanelDef, PanelContext } from "../contract";
import {
  tasks,
  tasksLoaded,
  tasksError,
  taskNotice,
  recentlyToggled,
  taskKey,
  todayLocal,
  dueCount,
  doneCount,
  openCount,
  toggleTask,
} from "../tasks-store";
import "./tasks.css";

const DOW = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** Cap rows rendered in the narrow panel (the full counts live in the footer). */
const MAX_ROWS = 60;

function Tasks({ ctx }: { ctx: PanelContext }) {
  const all = tasks.value;
  const loaded = tasksLoaded.value;
  const keep = recentlyToggled.value;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based
  const todayD = now.getDate();
  const todayStr = todayLocal();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const hasTask = new Set(
    all.filter((t) => !t.done && t.due && t.due.startsWith(monthPrefix)).map((t) => Number(t.due!.slice(8, 10))),
  );

  // Open tasks, plus any toggled this session (kept visible so a done task can be
  // un-checked from here instead of vanishing on the optimistic flip).
  const visible = all
    .filter((t) => !t.done || keep.has(taskKey(t)))
    .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
  const shown = visible.slice(0, MAX_ROWS);

  return (
    <>
      <div class="w-head">
        <span class="pill">
          <span class="dot" />
          Tasks · Due
        </span>
        <span class="w-meta">{`${MONTHS[month]} ${year}`}</span>
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
          return <div class={`day${d === todayD ? " today" : ""}${hasTask.has(d) ? " has" : ""}`}>{d}</div>;
        })}
      </div>

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
            <div class="es-t">All clear</div>
            <div class="es-d">No open tasks. Add `- [ ] task 📅 YYYY-MM-DD` in a note and it shows up here.</div>
          </div>
        ) : (
          <>
            {shown.map((t) => {
              const overdue = !t.done && !!t.due && t.due < todayStr;
              return (
                <div class={`task-row${t.done ? " done" : ""}`} onClick={() => void toggleTask(ctx.daemon, t)}>
                  <span class="task-box">
                    <svg viewBox="0 0 24 24" fill="none" stroke-width="3">
                      <path d="M5 12l4 4L19 7" />
                    </svg>
                  </span>
                  <span class="task-main">
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
  placement: { t: 2.55, y: 0.35, r: 6.7, s: 0.005 },
  seed: false, // not in the SEED arc; spawn via add-panel / ⌘K
  Component: Tasks,
};
