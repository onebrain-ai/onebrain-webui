// Command Center engine — wires the WebGL world, first-person controls, panel
// plugins and the render loop together. Framework-thin: it mounts each panel's
// Preact UI into a `.widget` billboard element and projects them every frame.
// The HUD chrome (topbar, radar, boot, …) is layered on in later milestones.

import { render, h } from "preact";
import { Vector3, Color } from "three";
import { createSceneWorld } from "./world/scene";
import { attachControls } from "./camera/controls";
import { projectWidgets, type WidgetRecord } from "./layout";
import { createStars } from "./world/stars";
import { createShadows } from "./world/shadows";
import { drawRadar } from "./hud/radar";
import { createHeading } from "./hud/heading";
import { fps, clock, radarCount, radarHeading } from "./hud/store";
import { seedPanels } from "../../panels";
import { initVault, openFile } from "../../panels/bus";
import { lowMotion } from "../../core/motion";
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

  // load the vault tree once (fire-and-forget) — panels react to the signals
  void initVault(opts.daemon);

  // ── mount panel plugins as billboards ──────────────────────────────────────
  const widgets: WidgetRecord[] = [];
  const ctx: PanelContext = {
    daemon: opts.daemon,
    openFile, // → bus.openFile: sets previewPath, the Preview panel reacts
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
    widgets.push({
      type: def.type,
      label: def.type.slice(0, 3).toUpperCase(),
      world: placeWorld(def.placement),
      s: def.placement.s,
      el,
    });
  }

  // ── HUD canvases (HudChrome is mounted into #app first — see main.tsx) ───────
  const radarCtx = document.querySelector<HTMLCanvasElement>("#radar canvas")?.getContext("2d") ?? null;
  const headingWrap = document.getElementById("heading");
  const headingCanvas = headingWrap?.querySelector("canvas") ?? null;
  const heading = headingWrap && headingCanvas ? createHeading(headingWrap, headingCanvas) : null;
  const starsCanvas = document.getElementById("stars") as HTMLCanvasElement | null;
  const stars = starsCanvas ? createStars(starsCanvas) : null;
  const shadows = createShadows(world.scene);

  // accent is fixed (cyan) until the Settings accent picker lands (M5). Read
  // --section-accent, but some browsers return the unresolved `var(--acc-cyan)`
  // token from getComputedStyle — fall back to the leaf token (a literal hex)
  // so the canvas rgba() never parses NaN → black.
  const rootStyle = getComputedStyle(document.documentElement);
  const rawAccent = rootStyle.getPropertyValue("--section-accent").trim();
  const accentHex = rawAccent.startsWith("#") ? rawAccent : rootStyle.getPropertyValue("--acc-cyan").trim() || "#00f3ff";
  const accentColor = new Color(accentHex);

  // live clock (HH:MM:SS) in the topbar
  const tickClock = () => {
    const n = new Date();
    clock.value = `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}:${String(n.getSeconds()).padStart(2, "0")}`;
  };
  tickClock();
  const clockTimer = setInterval(tickClock, 1000);

  // ── render loop (fps-capped) ────────────────────────────────────────────────
  let fpsFrames = 0;
  let fpsLast = performance.now();
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
    if (!lowMotion()) camera.position.y += Math.sin(t * 0.7) * 0.03; // idle breathing
    camera.rotation.set(controls.pitch(), controls.yaw(), 0);

    world.recenterWorld(camera.position.x, camera.position.z);
    world.render();
    projectWidgets(widgets, camera, world.focal);

    // HUD: fps (refresh ~2×/s), radar, heading tape, panel shadows
    fpsFrames++;
    const fdt = now - fpsLast;
    if (fdt >= 500) {
      fps.value = Math.round((fpsFrames * 1000) / fdt);
      fpsFrames = 0;
      fpsLast = now;
    }
    const yaw = controls.yaw();
    if (radarCtx) {
      const r = drawRadar(radarCtx, { yaw, camX: camera.position.x, camZ: camera.position.z, widgets, accentHex, t });
      radarCount.value = r.inRange;
      radarHeading.value = r.heading;
    }
    heading?.draw(yaw, accentHex);
    shadows.update(widgets, camera, accentColor);

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
  const onResize = () => {
    world.resize(window.innerWidth, window.innerHeight);
    heading?.resize();
  };
  window.addEventListener("resize", onResize);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      clearInterval(clockTimer);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      stars?.dispose();
      shadows.dispose();
      for (const w of widgets) {
        render(null, w.el); // tear down the Preact tree…
        w.el.remove(); // …and detach the host element (no ghosts on re-mount)
      }
      world.dispose();
    },
  };
}
