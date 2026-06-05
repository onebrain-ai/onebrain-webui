// ⌘K command palette — operator quick-access over panels · skills · workspaces ·
// actions. Substring-ranked, arrow-navigable, Enter to run. Wires the static
// #cmdk DOM imperatively (the command list is rebuilt from the live registry /
// widgets / saved views each time it opens). Ported from the prototype
// (cmdk 2994–3069, CSS 899–938).

import { clearKeys, type Rig } from "../camera/rig";
import type { FocusActions } from "../camera/focus";
import type { Views } from "../camera/views";
import type { Expose } from "../camera/expose";
import type { WidgetRecord } from "../layout";
import { allPanels, getPanel } from "../../../panels";
import { ALL_SKILLS } from "../../../panels/skills/skills";
import { runSkill } from "../../../panels/activity";
import { bootGone } from "../boot/store";
import { toggleFullscreen } from "./fullscreen";
import "./cmdk.css";

type IconKey = "panel" | "skill" | "view" | "act";
interface Cmd {
  g: string;
  t: string;
  s: string;
  ic: IconKey;
  hint?: string;
  run: () => void;
}

export interface CmdKDeps {
  rig: Rig;
  widgets: WidgetRecord[];
  focus: FocusActions;
  views: Views;
  expose: Expose;
  addPanel: (type: string) => void;
  openSettings: () => void;
  toggleHelp: () => void;
  resetLayout: () => void;
}

export interface CmdK {
  open(): void;
  close(): void;
  dispose(): void;
}

const ICON: Record<IconKey, string> = {
  panel: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18"/></svg>',
  skill: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>',
  view: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  act: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
};

const esc = (s: string) => s.replace(/[<>&]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[m] ?? m);

const typingInField = () => {
  const a = document.activeElement as HTMLElement | null;
  return !!a?.matches?.("input,textarea,[contenteditable]");
};

export function createCmdK(deps: CmdKDeps): CmdK {
  const el = document.getElementById("cmdk");
  const input = document.getElementById("cmdk-input") as HTMLInputElement | null;
  const listEl = document.getElementById("cmdk-list");
  if (!el || !input || !listEl) return { open() {}, close() {}, dispose() {} };

  let all: Cmd[] = [];
  let view: Cmd[] = [];
  let sel = 0;

  function commands(): Cmd[] {
    const c: Cmd[] = [];
    for (const def of allPanels()) {
      c.push({ g: "Add panel", t: "Add " + def.name, s: def.type + " panel", ic: "panel", run: () => deps.addPanel(def.type) });
    }
    // focus an open panel — enumerate live widgets, number duplicate types
    const total: Record<string, number> = {};
    const seen: Record<string, number> = {};
    deps.widgets.forEach((r) => (total[r.type] = (total[r.type] || 0) + 1));
    deps.widgets.forEach((r) => {
      const base = getPanel(r.type)?.name || r.type || "Panel";
      let label = base;
      if (total[r.type] > 1) {
        seen[r.type] = (seen[r.type] || 0) + 1;
        label = `${base} ${seen[r.type]}`;
      }
      c.push({
        g: "Focus panel",
        t: "Focus " + label,
        s: "fly in & focus",
        ic: "panel",
        run: () => {
          if (deps.rig.exposeActive) deps.expose.exposeAll(); // collapse first
          deps.focus.focusWidget(r);
        },
      });
    });
    for (const { i, name } of deps.views.list()) {
      c.push({ g: "Workspace", t: name, s: "saved view", hint: String(i + 1), ic: "view", run: () => deps.views.recallView(i) });
    }
    c.push({ g: "Workspace", t: "Show all panels", s: "Exposé overview", hint: "0", ic: "view", run: () => { if (!deps.rig.exposeActive) deps.expose.exposeAll(); } });
    for (const [n, d] of ALL_SKILLS) {
      c.push({ g: "Run skill", t: "/" + n, s: d, ic: "skill", run: () => runSkill(n) });
    }
    c.push({ g: "Action", t: "Settings", s: "accent · display · frame rate", ic: "act", run: deps.openSettings });
    c.push({ g: "Action", t: "Toggle fullscreen", s: "enter / exit fullscreen", hint: "F", ic: "act", run: toggleFullscreen });
    c.push({ g: "Action", t: "Toggle shortcuts", s: "show the help sheet", hint: "H", ic: "act", run: deps.toggleHelp });
    c.push({ g: "Action", t: "Reset workspace", s: "restore the default panels", ic: "act", run: deps.resetLayout });
    return c;
  }

  function render(q: string): void {
    const term = q.trim().toLowerCase();
    view = !term
      ? all.slice()
      : all
          .map((c) => {
            const i = (c.t + " " + c.s + " " + c.g).toLowerCase().indexOf(term);
            return i < 0 ? null : { c, score: i };
          })
          .filter((x): x is { c: Cmd; score: number } => x !== null)
          .sort((a, b) => a.score - b.score)
          .map((x) => x.c);
    sel = 0;
    if (!view.length) {
      listEl!.innerHTML = `<div class="cmdk-empty">No matches for "${esc(q)}"</div>`;
      return;
    }
    let html = "";
    let lastG: string | null = null;
    view.forEach((c, i) => {
      if (c.g !== lastG) {
        html += `<div class="cmdk-grp">${esc(c.g)}</div>`;
        lastG = c.g;
      }
      html +=
        `<div class="cmdk-item${i === sel ? " sel" : ""}" data-i="${i}"><span class="cmdk-ic">${ICON[c.ic]}</span>` +
        `<span class="cmdk-txt"><span class="cmdk-t">${esc(c.t)}</span><span class="cmdk-s">${esc(c.s)}</span></span>` +
        (c.hint ? `<span class="cmdk-hint">${esc(c.hint)}</span>` : "") +
        `</div>`;
    });
    listEl!.innerHTML = html;
    listEl!.querySelectorAll<HTMLElement>(".cmdk-item").forEach((item) => {
      item.addEventListener("mousemove", () => select(Number(item.dataset.i)));
      item.addEventListener("click", () => exec(Number(item.dataset.i)));
    });
  }

  function select(i: number): void {
    sel = i;
    listEl!.querySelectorAll<HTMLElement>(".cmdk-item").forEach((item) => item.classList.toggle("sel", Number(item.dataset.i) === i));
  }
  function move(d: number): void {
    if (!view.length) return;
    sel = (sel + d + view.length) % view.length;
    select(sel);
    listEl!.querySelector(".cmdk-item.sel")?.scrollIntoView({ block: "nearest" });
  }
  function exec(i: number): void {
    const c = view[i];
    if (!c) return;
    close();
    requestAnimationFrame(() => {
      try {
        c.run();
      } catch {
        /* a command's action should never break the palette */
      }
    });
  }

  const grab = () => {
    try {
      window.focus();
      (document.getElementById("look") as HTMLElement | null)?.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  };

  function open(): void {
    if (el!.classList.contains("open")) return;
    clearKeys(deps.rig); // drop held movement keys while the palette owns input
    all = commands();
    el!.classList.add("open");
    input!.value = "";
    render("");
    input!.focus();
  }
  function close(): void {
    el!.classList.remove("open");
    grab();
  }

  const onInput = () => render(input.value);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      move(1);
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      move(-1);
      e.preventDefault();
    } else if (e.key === "Enter") {
      exec(sel);
      e.preventDefault();
    } else if (e.key === "Escape") {
      close();
      e.preventDefault();
    }
  };
  const onScrim = (e: MouseEvent) => {
    if (e.target === el) close();
  };
  const onGlobal = (e: KeyboardEvent) => {
    if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      el!.classList.contains("open") ? close() : open();
      return;
    }
    if (e.key === "/" && !el!.classList.contains("open") && !typingInField() && bootGone.value) {
      e.preventDefault();
      open();
    }
  };
  const tbSearch = document.getElementById("tb-search");
  const onTb = (e: MouseEvent) => {
    e.stopPropagation();
    open();
  };

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKey);
  el.addEventListener("click", onScrim);
  tbSearch?.addEventListener("click", onTb);
  addEventListener("keydown", onGlobal, true);

  return {
    open,
    close,
    dispose() {
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKey);
      el.removeEventListener("click", onScrim);
      tbSearch?.removeEventListener("click", onTb);
      removeEventListener("keydown", onGlobal, true);
    },
  };
}
