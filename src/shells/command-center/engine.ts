// Command Center engine — wires the WebGL world, first-person controls, panel
// plugins and the render loop together. Framework-thin: it mounts each panel's
// Preact UI into a `.widget` billboard element and projects them every frame.
// The HUD chrome (topbar, radar, boot, …) is layered on in later milestones.

import { render, h } from "preact";
import { Vector3 } from "three";
import { createSceneWorld } from "./world/scene";
import { attachControls } from "./camera/controls";
import { projectWidgets, type WidgetRecord } from "./layout";
import { seedPanels } from "../../panels";
import type { PanelContext, PanelDef } from "../../panels/contract";
import type { DaemonClient } from "../../core/daemon";

export interface CommandCenterHandle {
  dispose(): void;
}

interface StartOptions {
  daemon: DaemonClient;
}

/** world position for a panel's cockpit-arc placement. */
function placeWorld(p: PanelDef["placement"]): Vector3 {
  return new Vector3(p.r * Math.sin(p.t), p.y, -p.r * Math.cos(p.t));
}

export function startCommandCenter(opts: StartOptions): CommandCenterHandle {
  const glCanvas = document.getElementById("gl") as HTMLCanvasElement;
  const look = document.getElementById("look") as HTMLElement;
  const stage = document.getElementById("css3d") as HTMLElement;
  if (!glCanvas || !look || !stage) {
    throw new Error("command-center: missing layer elements (#gl / #look / #css3d)");
  }

  const world = createSceneWorld(glCanvas);
  const controls = attachControls(look);

  // ── mount panel plugins as billboards ──────────────────────────────────────
  const widgets: WidgetRecord[] = [];
  const ctx: PanelContext = {
    daemon: opts.daemon,
    openFile(path) {
      // cross-panel preview wiring lands with the preview panel (M4). Warn in
      // dev so that wiring discovers the gap instead of silently no-op'ing.
      if (import.meta.env?.DEV) console.warn(`[command-center] openFile("${path}") not wired yet`);
    },
    addPanel(type) {
      // add-panel / ⌘K spawn lands with the HUD (M5).
      if (import.meta.env?.DEV) console.warn(`[command-center] addPanel("${type}") not wired yet`);
    },
  };
  for (const def of seedPanels()) {
    const el = document.createElement("section");
    el.className = `widget w-${def.type}`;
    el.style.width = `${def.width}px`;
    stage.appendChild(el);
    render(h(def.Component, { ctx }), el);
    widgets.push({ type: def.type, world: placeWorld(def.placement), s: def.placement.s, el });
  }

  // ── render loop (fps-capped) ────────────────────────────────────────────────
  const FRAME_MS = 1000 / 60;
  let raf = 0;
  let prev = performance.now();
  let acc = 0;
  const start = prev;
  let lastSkyY = 1e9; // throttle the --sky-y write to real pitch changes

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    acc += Math.min(now - prev, 100); // clamp a long stall so movement can't fling
    prev = now;
    if (acc < FRAME_MS) return;
    acc %= FRAME_MS;

    controls.update();
    const { camera } = world;
    camera.position.copy(controls.pos);
    const t = (now - start) / 1000;
    camera.position.y += Math.sin(t * 0.7) * 0.03; // idle breathing
    camera.rotation.set(controls.pitch(), controls.yaw(), 0);

    world.recenterWorld(camera.position.x, camera.position.z);
    world.render();
    projectWidgets(widgets, camera, world.focal);

    // sky + stars track the camera pitch in lockstep with the 3D horizon.
    // Throttle to real pitch changes — an unconditional write forces a style
    // recalc on the 260vh #bg-base / #stars every frame even at rest.
    const skyY = world.focal * Math.tan(controls.pitch());
    if (Math.abs(skyY - lastSkyY) > 0.3) {
      document.documentElement.style.setProperty("--sky-y", `${skyY.toFixed(1)}px`);
      lastSkyY = skyY;
    }
  };
  raf = requestAnimationFrame(frame);

  // ── resize ──────────────────────────────────────────────────────────────────
  const onResize = () => world.resize(window.innerWidth, window.innerHeight);
  window.addEventListener("resize", onResize);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      for (const w of widgets) {
        render(null, w.el); // tear down the Preact tree…
        w.el.remove(); // …and detach the host element (no ghosts on re-mount)
      }
      world.dispose();
    },
  };
}
