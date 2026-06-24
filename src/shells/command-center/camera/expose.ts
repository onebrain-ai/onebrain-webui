// Exposé (key 0) — tile every panel into a front-facing grid (Mission Control),
// camera to origin facing −Z; press 0/Esc to glide back, tap a tile to drill into
// focus. Ported from the prototype (exposeLayout 2205–2248, exposeAll 2252–2272,
// collapseExpose 2273–2290, focusFromExpose 1803–1808).

import { Vector3 } from "three";
import { nearestAngle, clearKeys, settleDrag, type Rig } from "./rig";
import type { FocusActions } from "./focus";
import type { WidgetRecord } from "../layout";

export interface ExposeDeps {
  rig: Rig;
  widgets: WidgetRecord[];
  focus: FocusActions;
  /** current screen focal length (px). */
  focal: () => number;
  toast: (html: string) => void;
}

export interface Expose {
  exposeAll(): void;
  collapseExpose(): void;
  focusFromExpose(rec: WidgetRecord): void;
}

export function createExpose(deps: ExposeDeps): Expose {
  const { rig, widgets, focus } = deps;

  function exposeLayout(): Map<WidgetRecord, Vector3> {
    const order = focus.focusOrder();
    const place = new Map<WidgetRecord, Vector3>();
    const n = order.length;
    if (!n) return place;
    const cols = n <= 4 ? Math.min(n, 2) : 3;
    const rows = Math.ceil(n / cols);
    const SX = 3.6;
    const GAP = 0.95;
    const HH = (rec: WidgetRecord) => (rec.el.offsetHeight || 300) * 0.0025;
    const HW = (rec: WidgetRecord) => (rec.el.offsetWidth || 360) * 0.0025;
    const rowsArr: WidgetRecord[][] = [];
    for (let r = 0; r < rows; r++) rowsArr.push(order.slice(r * cols, r * cols + cols));
    const rowH = rowsArr.map((items) => 2 * Math.max(...items.map(HH)));
    const totalH = rowH.reduce((a, b) => a + b, 0) + GAP * (rows - 1);

    const ent: { rec: WidgetRecord; x: number; y: number }[] = [];
    let top = totalH / 2;
    for (let r = 0; r < rows; r++) {
      const items = rowsArr[r];
      const inRow = items.length;
      for (let c = 0; c < inRow; c++) {
        const x = (c - (inRow - 1) / 2) * SX;
        const y = top - HH(items[c]);
        ent.push({ rec: items[c], x, y });
      }
      top -= rowH[r] + GAP;
    }

    // fit to viewport: push the grid to a distance large enough that its full
    // footprint stays inside the usable viewport (below the 42px top bar)
    let HX = 0;
    let HY = 0;
    for (const e of ent) {
      HX = Math.max(HX, Math.abs(e.x) + HW(e.rec));
      HY = Math.max(HY, Math.abs(e.y) + HH(e.rec));
    }
    const FOCAL = deps.focal();
    const TOPBAR = 42;
    const MX = 56;
    const MY = 30;
    const availX = Math.max(120, window.innerWidth / 2 - MX);
    const availY = Math.max(120, (window.innerHeight - TOPBAR) / 2 - MY);
    const D = Math.max(5.2, (FOCAL * HX) / availX, (FOCAL * HY) / availY);
    const shiftY = (-(TOPBAR / 2) * D) / FOCAL;
    for (const e of ent) place.set(e.rec, new Vector3(e.x, e.y + shiftY, -D));
    return place;
  }

  function exposeAll(): void {
    if (rig.exposeActive) {
      collapseExpose();
      return;
    }
    focus.clearFocus();
    settleDrag(rig); // so the dragged panel tiles into the grid (exposeSaved captures its settled world)
    clearKeys(rig);
    rig.exposeSaved = {
      pos: rig.pos.clone(),
      yaw: rig.yaw,
      pitch: rig.pitch,
      pan: widgets.map((r) => r.world.clone()),
    };
    const place = exposeLayout();
    rig.viewTween = {
      fromPos: rig.pos.clone(),
      toPos: new Vector3(0, 0, 0),
      fromYaw: rig.yaw,
      toYaw: nearestAngle(rig.yaw, 0),
      fromPitch: rig.pitch,
      toPitch: 0,
      fromPan: widgets.map((r) => r.world.clone()),
      toPan: widgets.map((r) => place.get(r) ?? r.world.clone()),
      start: performance.now(),
      dur: 620,
    };
    rig.exposeActive = true;
    rig.activeViewId = null;
    document.body.classList.add("exposemode");
    deps.toast("Exposé · all panels — press <b>0</b> or <b>Esc</b> to return");
  }

  function collapseExpose(): void {
    if (!rig.exposeActive) return;
    rig.exposeActive = false;
    document.body.classList.remove("exposemode");
    clearKeys(rig);
    if (rig.exposeSaved) {
      const saved = rig.exposeSaved;
      rig.viewTween = {
        fromPos: rig.pos.clone(),
        toPos: saved.pos.clone(),
        fromYaw: rig.yaw,
        toYaw: nearestAngle(rig.yaw, saved.yaw),
        fromPitch: rig.pitch,
        toPitch: saved.pitch,
        fromPan: widgets.map((r) => r.world.clone()),
        toPan: saved.pan.map((v) => v.clone()),
        start: performance.now(),
        dur: 620,
      };
      rig.exposeSaved = null;
      deps.toast("Panels restored");
    }
  }

  function focusFromExpose(rec: WidgetRecord): void {
    if (!rig.exposeActive) return;
    rig.exposeReturn = rig.exposeSaved; // hand the snapshot to clearFocus
    rig.exposeSaved = null;
    rig.exposeActive = false;
    document.body.classList.remove("exposemode");
    focus.focusWidget(rec); // exposeActive now false → focusWidget proceeds
  }

  return { exposeAll, collapseExpose, focusFromExpose };
}
