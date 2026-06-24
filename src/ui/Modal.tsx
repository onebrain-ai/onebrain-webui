// DS-styled modal dialogs (operator-console look) replacing the native
// window.prompt / window.confirm. Promise-based imperative API so call sites read
// like the native ones: `const v = await promptModal({...})`.

import { signal, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import "./modal.css";

interface ModalConfig {
  kind: "prompt" | "confirm";
  title: string;
  message?: string;
  placeholder?: string;
  value?: string;
  okLabel?: string;
  danger?: boolean;
  resolve: (v: string | boolean | null) => void;
}

const activeModal = signal<ModalConfig | null>(null);

/** Ask for a line of text. Resolves the entered value (trimmed) or null on cancel. */
export function promptModal(opts: {
  title: string;
  placeholder?: string;
  value?: string;
  okLabel?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    activeModal.value = { kind: "prompt", ...opts, resolve: (v) => resolve(v as string | null) };
  });
}

/** Ask yes/no. Resolves true (confirmed) or false (cancelled). */
export function confirmModal(opts: {
  title: string;
  message?: string;
  okLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    activeModal.value = { kind: "confirm", ...opts, resolve: (v) => resolve(v as boolean) };
  });
}

/** Keep Tab focus inside the dialog so it can't wander to the inert page behind
 *  the aria-modal backdrop (WCAG 2.1.2 / 2.4.3). */
function trapFocus(e: KeyboardEvent, container: HTMLElement | null): void {
  if (!container) return;
  const items = container.querySelectorAll<HTMLElement>('button, input, [href], [tabindex]:not([tabindex="-1"])');
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Render the active modal. Mount once at the shell root. */
export function ModalHost() {
  const val = useSignal("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  const m = activeModal.value;

  useEffect(() => {
    if (!m) return;
    // Remember the trigger so focus can return to it when the dialog closes.
    prevFocus.current = document.activeElement as HTMLElement | null;
    if (m.kind === "prompt") val.value = m.value ?? "";
    // Move focus INTO the dialog — the input for a prompt, the primary action for
    // a confirm (so a keyboard/AT user isn't left on the obscured trigger).
    requestAnimationFrame(() => {
      if (m.kind === "prompt") {
        inputRef.current?.focus();
        inputRef.current?.select();
      } else {
        okRef.current?.focus();
      }
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        activeModal.value = null;
        m.resolve(m.kind === "prompt" ? null : false);
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

  const close = (result: string | boolean | null) => {
    const resolve = m.resolve;
    activeModal.value = null;
    resolve(result);
  };
  const onOk = () => close(m.kind === "prompt" ? val.value.trim() : true);
  const onCancel = () => close(m.kind === "prompt" ? null : false);

  return (
    <div class="ob-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div class="ob-modal" role="dialog" aria-modal="true" data-testid="ob-modal" ref={dialogRef}>
        <div class="ob-modal-title">{m.title}</div>
        {m.message && <div class="ob-modal-msg">{m.message}</div>}
        {m.kind === "prompt" && (
          <input
            ref={inputRef}
            class="ob-modal-input"
            type="text"
            value={val.value}
            placeholder={m.placeholder}
            autocomplete="off"
            spellcheck={false}
            onInput={(e) => (val.value = (e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === "Enter") onOk(); }}
          />
        )}
        <div class="ob-modal-actions">
          <button type="button" class="ob-modal-btn" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            ref={okRef}
            class={m.danger ? "ob-modal-btn danger" : "ob-modal-btn primary"}
            data-testid="ob-modal-ok"
            onClick={onOk}
          >
            {m.okLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
