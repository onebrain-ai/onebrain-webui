// Lay the SAME registered panels (Explorer, Preview, Settings) out as floating
// surfaces in the command center. Each is a real DOM element mounted through the
// one Panel contract (PanelDef.build) with `surface: 'command-center'`, wrapped
// in a CSS3DObject so it's a true, interactive panel in 3D space — proving D2
// ("one panel contract, two shells").

import { CSS3DObject } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import { Vector3 } from "three";
import type { Scene } from "three";
import { getPanel } from "../../panels/panel";
import type { PanelContext, PanelInstance } from "../../panels/panel";

// CSS3DRenderer maps 1 CSS px → 1 world unit, so panels are sized in px then
// scaled WAY down to a sane world size. 460px @ 0.011 ≈ 5 world units wide.
const PANEL_W = 460;
const PANEL_H = 560;
const PANEL_SCALE = 0.011;

interface PlacedPanel {
  object: CSS3DObject;
  instance: PanelInstance;
}

/** Which panels to float, and where (an arc in front of the operator). */
const LAYOUT: { type: string; x: number; z: number; ry: number }[] = [
  { type: "explorer", x: -5.6, z: -1.5, ry: 0.5 },
  { type: "preview", x: 0, z: -3, ry: 0 },
  { type: "settings", x: 5.6, z: -1.5, ry: -0.5 },
];

export interface PlacedPanels {
  /** World positions of the placed panels (for the radar). */
  positions: Vector3[];
  /** Unmount every panel instance and detach its object. */
  dispose(): void;
}

/** Build the floating panels into `scene`. */
export function placePanels(scene: Scene, ctx: PanelContext): PlacedPanels {
  const placed: PlacedPanel[] = [];
  const ccCtx: PanelContext = { ...ctx, surface: "command-center" };

  for (const slot of LAYOUT) {
    const def = getPanel(slot.type);
    if (!def) continue;

    // Panel chrome: a glassy framed surface (DS tokens) with a title bar and a
    // mount body the panel renders into.
    const el = document.createElement("div");
    el.className = "cc-panel";
    el.style.width = `${PANEL_W}px`;
    el.style.height = `${PANEL_H}px`;

    const head = document.createElement("header");
    head.className = "cc-panel-head";
    head.textContent = def.name;
    el.appendChild(head);

    const body = document.createElement("div");
    body.className = "cc-panel-body";
    el.appendChild(body);

    const instance = def.build(body, ccCtx);

    const object = new CSS3DObject(el);
    object.position.set(slot.x, 0, slot.z);
    object.rotation.y = slot.ry;
    object.scale.setScalar(PANEL_SCALE);
    scene.add(object);

    placed.push({ object, instance });
  }

  return {
    positions: placed.map((p) => p.object.position.clone()),
    dispose() {
      for (const p of placed) {
        p.instance.unmount();
        scene.remove(p.object);
        p.object.element.remove();
      }
    },
  };
}
