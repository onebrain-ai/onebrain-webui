// Per-panel header controls — the accent-override swatch popover (.w-acc / .acc-pop)
// and the two-click close button (.w-close), built imperatively per widget and
// appended to its .w-head. Ported from the prototype (setupPanelControls / makeSwatch
// / buildPanelPop / applyPanelAccent / setPanelAccent 1958-1982, 2029-2059). A panel's
// inline --section-accent re-keys its whole frame (pill, brackets, glow) via widget.css.

import { ACCENT_HEX, ACCENT_KEYS, accentName } from "../../core/accent";
import { panelAccent, setStoredPanelAccent } from "../../core/panel-accent";
import { getPanel } from "../../panels";
import { toast } from "./boot/store";
import type { WidgetRecord } from "./layout";

export interface PanelControlDeps {
  /** remove the panel (engine-owned: clears focus/drag, splices widgets, drops the shadow). */
  closePanel: (rec: WidgetRecord) => void;
  /** persist the desk after an accent change. */
  onChange: () => void;
}

// only one accent popover is open across all panels at a time
let openPop: HTMLElement | null = null;

// one document-level listener closes the open popover on an outside click
let autoCloseAttached = false;
function ensureAutoClose(): void {
  if (autoCloseAttached || typeof document === "undefined") return;
  autoCloseAttached = true;
  document.addEventListener("click", () => {
    if (openPop) {
      openPop.classList.remove("open");
      openPop = null;
    }
  });
}

/** If `rec` owns the currently-open accent popover, close + forget it — call this
 *  when the panel is removed, before its pop element detaches (matches the
 *  prototype's `if(openPop && rec.accPop===openPop) openPop=null` in closeWidget). */
export function releasePanelPop(rec: WidgetRecord): void {
  if (openPop && openPop === rec.accPop) {
    openPop.classList.remove("open");
    openPop = null;
  }
}

/** Write (or clear) the panel's inline --section-accent so its whole frame re-keys. */
export function applyPanelAccent(rec: WidgetRecord): void {
  if (rec.accent && ACCENT_HEX[rec.accent]) rec.el.style.setProperty("--section-accent", ACCENT_HEX[rec.accent]);
  else rec.el.style.removeProperty("--section-accent"); // inherit the global root accent
}

function makeSwatch(key: string, selected: boolean, onPick: (k: string | null) => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "acc-sw" + (key === "" ? " global" : "") + (selected ? " on" : "");
  if (key) {
    b.style.background = ACCENT_HEX[key];
    b.style.color = ACCENT_HEX[key];
    b.title = key;
  } else {
    b.title = "Use global accent";
    b.style.setProperty("--section-accent", ACCENT_HEX[accentName.peek()] ?? ACCENT_HEX.cyan);
  }
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onPick(key || null);
  });
  return b;
}

function setPanelAccent(rec: WidgetRecord, key: string | null, deps: PanelControlDeps): void {
  rec.accent = key || null;
  setStoredPanelAccent(rec.key, rec.accent);
  applyPanelAccent(rec);
  buildPanelPop(rec, deps);
  deps.onChange();
}

function buildPanelPop(rec: WidgetRecord, deps: PanelControlDeps): void {
  const pop = rec.accPop;
  if (!pop) return;
  pop.innerHTML = "";
  const lab = document.createElement("span");
  lab.className = "acc-lab";
  lab.textContent = "Panel accent";
  pop.appendChild(lab);
  pop.appendChild(makeSwatch("", !rec.accent, (k) => setPanelAccent(rec, k, deps))); // "use global"
  for (const k of ACCENT_KEYS) pop.appendChild(makeSwatch(k, rec.accent === k, (kk) => setPanelAccent(rec, kk, deps)));
}

/** Restore the panel's saved accent and attach the header accent + close controls. */
export function setupPanelControls(rec: WidgetRecord, deps: PanelControlDeps): void {
  ensureAutoClose();
  rec.accent = panelAccent(rec.key);
  applyPanelAccent(rec);
  const head = rec.el.querySelector(".w-head");
  if (!head) return;

  const accBtn = document.createElement("button");
  accBtn.type = "button";
  accBtn.className = "w-acc";
  accBtn.setAttribute("aria-label", "Panel accent");
  accBtn.innerHTML = '<span class="w-acc-dot"></span>';
  const pop = document.createElement("div");
  pop.className = "acc-pop";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "w-close";
  close.setAttribute("aria-label", "Close panel");
  close.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  head.append(accBtn, close, pop);
  rec.accPop = pop;
  buildPanelPop(rec, deps);

  accBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = !pop.classList.contains("open");
    if (openPop && openPop !== pop) openPop.classList.remove("open");
    buildPanelPop(rec, deps); // refresh the "use global" swatch to the current global accent
    pop.classList.toggle("open", willOpen);
    openPop = willOpen ? pop : null;
  });
  pop.addEventListener("click", (e) => e.stopPropagation());

  let confirmTimer: ReturnType<typeof setTimeout> | null = null;
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    if (close.classList.contains("confirm")) {
      if (confirmTimer) clearTimeout(confirmTimer);
      deps.closePanel(rec);
      return;
    }
    close.classList.add("confirm"); // a confirming second click prevents accidental loss
    close.title = "Click again to close";
    toast(`Close <b>${getPanel(rec.type)?.name ?? rec.type}</b>? Click ✕ again`);
    confirmTimer = setTimeout(() => {
      close.classList.remove("confirm");
      close.title = "Close panel";
    }, 2400);
  });
}
