// Task add/edit modal — a richer DS modal than the single-field promptModal:
// description + due date + priority, plus a note picker when adding. Promise-based
// like ui/Modal so call sites read `const draft = await openTaskModal({...})`.

import { signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { Priority } from "../tasks-store";
import { trapFocus } from "../../ui/Modal";
import "../../ui/modal.css";
import "./task-modal.css";

export interface TaskDraft {
  text: string;
  due: string | null;
  priority: Priority;
  /** Target note (add mode only — fixed when editing an existing task). */
  file?: string;
}

interface TaskModalConfig {
  title: string;
  okLabel: string;
  draft: TaskDraft;
  /** Non-null → show a note picker (add mode); the value is the selectable paths. */
  files: string[] | null;
  resolve: (d: TaskDraft | null) => void;
}

const active = signal<TaskModalConfig | null>(null);

/** Open the task modal. Pass `files` to enable the note picker (add mode). */
export function openTaskModal(opts: {
  title: string;
  okLabel?: string;
  draft: TaskDraft;
  files?: string[];
}): Promise<TaskDraft | null> {
  return new Promise((resolve) => {
    active.value = {
      title: opts.title,
      okLabel: opts.okLabel ?? "Save",
      draft: opts.draft,
      files: opts.files ?? null,
      resolve,
    };
  });
}

/** Mount once at the shell root (next to ModalHost). */
export function TaskModalHost() {
  const text = useSignal("");
  const due = useSignal("");
  const priority = useSignal<Priority>("none");
  const file = useSignal("");
  const firstRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  const m = active.value;

  useEffect(() => {
    if (!m) return;
    prevFocus.current = document.activeElement as HTMLElement | null; // restore on close
    text.value = m.draft.text;
    due.value = m.draft.due ?? "";
    priority.value = m.draft.priority;
    file.value = m.draft.file ?? m.files?.[0] ?? "";
    requestAnimationFrame(() => firstRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        active.value = null;
        m.resolve(null);
      } else if (e.key === "Tab") {
        trapFocus(e, dialogRef.current);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prevFocus.current?.focus();
    };
  }, [m]);

  if (!m) return null;

  const close = (d: TaskDraft | null) => {
    const resolve = m.resolve;
    active.value = null;
    resolve(d);
  };
  const onOk = () => {
    const t = text.value.trim();
    if (!t) {
      firstRef.current?.focus();
      return; // description is required
    }
    if (m.files && !file.value.trim()) return; // a note is required when adding
    close({
      text: t,
      due: due.value.trim() || null,
      priority: priority.value,
      file: m.files ? file.value.trim() : undefined,
    });
  };

  return (
    <div class="ob-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(null); }}>
      <div class="ob-modal" role="dialog" aria-modal="true" data-testid="task-modal" ref={dialogRef}>
        <div class="ob-modal-title">{m.title}</div>

        <label class="tm-field">
          <span>Task</span>
          <input
            ref={firstRef}
            class="ob-modal-input"
            type="text"
            value={text.value}
            placeholder="what needs doing (use #tags inline)"
            onInput={(e) => (text.value = (e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === "Enter") onOk(); }}
          />
        </label>

        <div class="tm-row">
          <label class="tm-field">
            <span>Due</span>
            <input
              class="ob-modal-input"
              type="date"
              value={due.value}
              onInput={(e) => (due.value = (e.target as HTMLInputElement).value)}
            />
          </label>
          <label class="tm-field">
            <span>Priority</span>
            <select
              class="ob-modal-input"
              value={priority.value}
              onChange={(e) => (priority.value = (e.target as HTMLSelectElement).value as Priority)}
            >
              <option value="none">None</option>
              <option value="high">🔺 High</option>
              <option value="medium">⏫ Medium</option>
              <option value="low">🔽 Low</option>
            </select>
          </label>
        </div>

        {m.files && (
          <label class="tm-field">
            <span>Note</span>
            <input
              class="ob-modal-input"
              list="tm-notes"
              value={file.value}
              placeholder="pick a project / knowledge note"
              onInput={(e) => (file.value = (e.target as HTMLInputElement).value)}
            />
            <datalist id="tm-notes">
              {m.files.map((p) => (
                <option value={p} />
              ))}
            </datalist>
          </label>
        )}

        <div class="ob-modal-actions">
          <button type="button" class="ob-modal-btn" onClick={() => close(null)}>Cancel</button>
          <button type="button" class="ob-modal-btn primary" data-testid="task-modal-ok" onClick={onOk}>
            {m.okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
