// View bookmarks 1–9 — save / recall a viewpoint + panel arrangement. Recalling
// glides the camera AND every panel to the saved layout (stepView). The drawer
// telescopes up out of the radar (#views-handle hover). Ported from the
// prototype (2126–2351). The drawer DOM is built imperatively (canvas thumbs +
// per-tile controls), like the prototype.

import { Vector3 } from "three";
import { effect } from "@preact/signals";
import { nearestAngle, clearKeys, settleDrag, type Rig } from "./rig";
import { accentHex, accentName } from "../../../core/accent";
import type { WidgetRecord } from "../layout";

const SLOTS = 9;
const VKEY = "ob-spatial-views";

interface Slot {
  name: string;
  cam: { x: number; y: number; z: number; yaw: number; pitch: number };
  panels: Record<string, { x: number; y: number; z: number }>;
}

export interface ViewsDeps {
  rig: Rig;
  widgets: WidgetRecord[];
  clearFocus: () => void;
  toast: (html: string) => void;
}

export interface Views {
  recallView(i: number): void;
  setActiveView(i: number | null): void;
  /** re-sync the drawer's active highlight (called when the drawer opens). */
  syncActive(): void;
  /** saved (non-empty) slots, for ⌘K's Workspace group. */
  list(): { i: number; name: string }[];
  dispose(): void;
}

export function createViews(deps: ViewsDeps): Views {
  const { rig, widgets } = deps;
  const viewsEl = document.getElementById("views");
  const viewList = document.getElementById("view-list");
  const handleEl = document.getElementById("views-handle");

  let slots: (Slot | null)[] = new Array(SLOTS).fill(null);

  function loadViews(): void {
    try {
      const d = JSON.parse(localStorage.getItem(VKEY) || "null");
      if (d && Array.isArray(d.slots)) {
        slots = new Array(SLOTS).fill(null);
        d.slots.slice(0, SLOTS).forEach((v: Slot | null, i: number) => {
          if (v) slots[i] = v;
        });
      }
      slots.forEach((v, i) => {
        if (v && /^View \d+$/.test((v.name || "").trim())) v.name = `View ${i + 1}`;
      });
    } catch {
      slots = new Array(SLOTS).fill(null);
    }
  }
  function persistViews(): void {
    try {
      localStorage.setItem(VKEY, JSON.stringify({ slots }));
    } catch {
      /* ignore */
    }
  }

  function setActiveView(i: number | null): void {
    rig.activeViewId = i;
    syncActive();
  }
  function syncActive(): void {
    viewList?.querySelectorAll<HTMLElement>(".view-tile").forEach((t) => {
      t.classList.toggle("active", Number(t.dataset.slot) === rig.activeViewId);
    });
  }

  function saveView(i: number): void {
    if (i < 0 || i >= SLOTS) return;
    const panels: Slot["panels"] = {};
    widgets.forEach((r) => {
      panels[r.key] = { x: +r.world.x.toFixed(3), y: +r.world.y.toFixed(3), z: +r.world.z.toFixed(3) };
    });
    const prev = slots[i];
    slots[i] = {
      name: prev?.name || `View ${i + 1}`,
      cam: {
        x: +rig.pos.x.toFixed(3),
        y: +rig.pos.y.toFixed(3),
        z: +rig.pos.z.toFixed(3),
        yaw: +rig.yaw.toFixed(4),
        pitch: +rig.pitch.toFixed(4),
      },
      panels,
    };
    persistViews();
    renderViews();
    setActiveView(i);
    deps.toast(`${prev ? "Overwrote" : "Saved"} · slot <b>${i + 1}</b> — press <b>${i + 1}</b> to return`);
  }

  function deleteView(i: number): void {
    slots[i] = null;
    if (rig.activeViewId === i) rig.activeViewId = null;
    persistViews();
    renderViews();
  }

  function recallView(i: number): void {
    const v = slots[i];
    if (!v) return;
    settleDrag(rig); // include any dragged panel in the recall tween
    rig.exposeReturn = null;
    deps.clearFocus();
    rig.focusReturn = null; // recall supersedes any focus-return snapshot
    clearKeys(rig);
    rig.viewTween = {
      fromPos: rig.pos.clone(),
      toPos: new Vector3(v.cam.x, v.cam.y, v.cam.z),
      fromYaw: rig.yaw,
      toYaw: nearestAngle(rig.yaw, v.cam.yaw),
      fromPitch: rig.pitch,
      toPitch: v.cam.pitch,
      fromPan: widgets.map((r) => r.world.clone()),
      toPan: widgets.map((r) =>
        v.panels[r.key] ? new Vector3(v.panels[r.key].x, v.panels[r.key].y, v.panels[r.key].z) : r.world.clone(),
      ),
      start: performance.now(),
      dur: 780,
    };
    setActiveView(i);
  }

  /** tiny top-down constellation of where the panels sit for this saved view. */
  function thumbFor(v: Slot): HTMLCanvasElement {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 88;
    cv.className = "v-thumb";
    const ctx = cv.getContext("2d")!;
    const C = 44;
    const R = 40;
    const acc = accentHex();
    ctx.strokeStyle = "rgba(255,255,255,.13)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(C, C, R, 0, 7);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.07)";
    ctx.beginPath();
    ctx.arc(C, C, R * 0.55, 0, 7);
    ctx.stroke();
    const sy = Math.sin(v.cam.yaw);
    const cy = Math.cos(v.cam.yaw);
    const MAX = 13;
    const k = (R - 5) / MAX;
    Object.values(v.panels).forEach((p) => {
      const dx = p.x - v.cam.x;
      const dz = p.z - v.cam.z;
      const fwd = dx * -sy + dz * -cy;
      const rgt = dx * cy + dz * -sy;
      const range = Math.hypot(dx, dz);
      const s = range > MAX ? MAX / range : 1;
      const bx = C + rgt * k * s;
      const by = C - fwd * k * s;
      ctx.fillStyle = acc;
      ctx.shadowColor = acc;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(bx, by, 3, 0, 7);
      ctx.fill();
      ctx.shadowBlur = 0;
    });
    ctx.fillStyle = acc;
    ctx.beginPath();
    ctx.moveTo(C, C - 5);
    ctx.lineTo(C - 4, C + 4);
    ctx.lineTo(C + 4, C + 4);
    ctx.closePath();
    ctx.fill();
    return cv;
  }

  const PLUS_SVG = '<svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg>';
  const OV_SVG =
    '<svg viewBox="0 0 24 24"><path d="M12 5v9m0 0l-3.2-3.2M12 14l3.2-3.2M5 17.5v.5a2 2 0 002 2h10a2 2 0 002-2v-.5"/></svg>';

  function startRename(name: HTMLElement, i: number): void {
    name.classList.add("editing");
    name.contentEditable = "true";
    name.focus();
    // select the whole name so typing replaces it (not appends at the cursor)
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      const rng = document.createRange();
      rng.selectNodeContents(name);
      sel.addRange(rng);
    }
    const finish = () => {
      name.onkeydown = null; // property assignment — no accumulated listeners
      name.contentEditable = "false";
      name.classList.remove("editing");
      const slot = slots[i];
      if (slot) {
        slot.name = (name.textContent || "").trim() || `View ${i + 1}`;
        persistViews();
        renderViews(); // refresh the tile title + name immediately
      }
    };
    name.addEventListener("blur", finish, { once: true });
    name.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        name.blur();
      } else if (e.key === "Escape") {
        name.textContent = slots[i]?.name ?? `View ${i + 1}`;
        name.blur();
      }
    };
  }

  function renderViews(): void {
    if (!viewList) return;
    // never rebuild mid-rename — the accent re-key effect (or any other caller)
    // would detach the live contentEditable tile and lose the half-typed name.
    // finish() flips contentEditable off before it calls renderViews, so the
    // normal rename→save path still rebuilds.
    if (viewList.querySelector('[contenteditable="true"]')) return;
    viewList.innerHTML = "";
    for (let i = 0; i < SLOTS; i++) {
      const v = slots[i];
      const num = i + 1;
      const tile = document.createElement("div");
      tile.dataset.slot = String(i);
      const idx = document.createElement("span");
      idx.className = "v-idx";
      idx.textContent = String(num);
      if (!v) {
        tile.className = "view-tile empty";
        tile.title = `Save current view to slot ${num}`;
        const plus = document.createElement("span");
        plus.className = "v-plus";
        plus.innerHTML = PLUS_SVG;
        tile.append(idx, plus);
        tile.addEventListener("click", () => {
          saveView(i);
          grab();
        });
      } else {
        tile.className = "view-tile" + (i === rig.activeViewId ? " active" : "");
        tile.title = v.name;
        const ov = document.createElement("button");
        ov.className = "v-ov";
        ov.setAttribute("aria-label", `Overwrite slot ${num}`);
        ov.innerHTML = OV_SVG;
        const del = document.createElement("button");
        del.className = "v-del";
        del.setAttribute("aria-label", `Clear slot ${num}`);
        del.innerHTML = "&times;";
        const name = document.createElement("span");
        name.className = "v-name";
        name.textContent = v.name;
        tile.append(thumbFor(v), idx, ov, del, name);
        tile.addEventListener("click", (e) => {
          if (e.target === del || e.target === ov || name.isContentEditable) return;
          recallView(i);
          grab();
        });
        ov.addEventListener("click", (e) => {
          e.stopPropagation();
          saveView(i);
        });
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          deleteView(i);
        });
        name.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          startRename(name, i);
        });
      }
      viewList.appendChild(tile);
    }
  }

  const grab = () => {
    try {
      window.focus();
      (document.getElementById("look") as HTMLElement | null)?.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  };

  // ── telescope-out behaviour ─────────────────────────────────────────────────
  let hover = false;
  let closeT: ReturnType<typeof setTimeout> | null = null;
  const setPeek = (on: boolean) => {
    viewsEl?.classList.toggle("peek", on);
    document.body.classList.toggle("views-open", on);
    if (on) syncActive();
  };
  const openNow = () => {
    if (closeT) {
      clearTimeout(closeT);
      closeT = null;
    }
    setPeek(true);
  };
  const closeSoon = () => {
    if (closeT) clearTimeout(closeT);
    closeT = setTimeout(() => {
      if (!hover) setPeek(false);
    }, 220);
  };
  const onEnter = () => {
    hover = true;
    openNow();
  };
  const onLeave = () => {
    hover = false;
    closeSoon();
  };
  const onHandleClick = () => {
    hover = false;
    setPeek(!viewsEl?.classList.contains("peek"));
  };
  const targets = [viewsEl, handleEl].filter(Boolean) as HTMLElement[];
  for (const el of targets) {
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);
  }
  handleEl?.addEventListener("click", onHandleClick);

  loadViews();
  renderViews();
  // re-key the thumbnail constellations when the accent changes
  const stopAccent = effect(() => {
    accentName.value;
    renderViews();
  });

  return {
    recallView,
    setActiveView,
    syncActive,
    list() {
      const out: { i: number; name: string }[] = [];
      slots.forEach((v, i) => {
        if (v) out.push({ i, name: v.name });
      });
      return out;
    },
    dispose() {
      stopAccent();
      setPeek(false); // clear the drawer's visual state before tearing down
      for (const el of targets) {
        el.removeEventListener("pointerenter", onEnter);
        el.removeEventListener("pointerleave", onLeave);
      }
      handleEl?.removeEventListener("click", onHandleClick);
      if (closeT) clearTimeout(closeT);
    },
  };
}
