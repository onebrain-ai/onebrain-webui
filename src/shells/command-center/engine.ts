// Command Center engine — wires the WebGL world, first-person controls, panel
// plugins, the HUD chrome and the render loop together. Framework-thin: it mounts
// each panel's Preact UI into a `.widget` billboard element and projects them
// every frame. M5c adds the operator chrome (⌘K · settings · add-panel · help)
// and live panel spawning / workspace reset.

import { render, h } from "preact";
import { Vector3, Color } from "three";
import { createSceneWorld } from "./world/scene";
import { createRig, updateMovement, stepFocus, stepView, advanceDrag, easeFocusDof, clamp } from "./camera/rig";
import { attachInput } from "./camera/input";
import { createFocus } from "./camera/focus";
import { createViews, type Views } from "./camera/views";
import { createExpose } from "./camera/expose";
import { makeWidgetInteractive } from "./interact";
import { projectWidgets, type WidgetRecord } from "./layout";
import { createStars } from "./world/stars";
import { createShadows } from "./world/shadows";
import { drawRadar } from "./hud/radar";
import { createHeading } from "./hud/heading";
import { createCmdK } from "./hud/cmdk";
import { createSettings } from "./hud/settings";
import { createAddMenu } from "./hud/add-panel";
import { createHelp } from "./hud/help";
import { toggleFullscreen } from "./hud/fullscreen";
import { fps, clock, radarCount, radarHeading } from "./hud/store";
import { toast } from "./boot/store";
import { seedPanels, getPanel } from "../../panels";
import { initVault, openFile } from "../../panels/bus";
import { lowMotion } from "../../core/motion";
import { accentHex, initAccent } from "../../core/accent";
import { frameMs } from "../../core/perf";
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

  // apply the persisted accent before first paint so panels + HUD read a real hex
  initAccent();

  const world = createSceneWorld(glCanvas);
  const rig = createRig();
  world.applyAccent(accentHex()); // sync the scene chrome (mountains) to the saved accent

  // load the vault tree once (fire-and-forget) — panels react to the signals
  void initVault(opts.daemon);

  // ── panel mounting ──────────────────────────────────────────────────────────
  const widgets: WidgetRecord[] = [];
  let widgetSeq = 0;
  let views: Views | undefined; // created below; addPanel/resetLayout reference it lazily
  // focus / exposé close over the widgets array (populated just below)
  const focus = createFocus({ rig, camera: world.camera, widgets, focal: () => world.focal, toast });
  const expose = createExpose({ rig, widgets, focus, focal: () => world.focal, toast });

  /** Mount a panel plugin as a billboard + wire its interactions. */
  function spawnPanel(def: PanelDef, worldPos: Vector3, key: string, t?: number): WidgetRecord {
    const el = document.createElement("section");
    el.className = `widget w-${def.type}`;
    el.style.width = `${def.width}px`;
    stage.appendChild(el);
    render(h(def.Component, { ctx }), el);
    const rec: WidgetRecord = {
      type: def.type,
      key,
      label: def.type.slice(0, 3).toUpperCase(),
      t: t ?? Math.atan2(worldPos.x, -worldPos.z),
      world: worldPos,
      s: def.placement.s,
      el,
    };
    widgets.push(rec);
    makeWidgetInteractive(rec, { rig, camera: world.camera, focus, focusFromExpose: expose.focusFromExpose });
    return rec;
  }

  const ctx: PanelContext = {
    daemon: opts.daemon,
    openFile, // → bus.openFile: sets previewPath, the Preview panel reacts
    addPanel(type) {
      const def = getPanel(type);
      if (!def) return;
      if (rig.focusedRec) focus.clearFocus();
      if (rig.exposeActive) expose.collapseExpose();
      // place the new panel dead-centre in front of the camera, and closer than
      // every existing panel so it's never hidden behind another (z is by depth)
      const dir = new Vector3();
      world.camera.getWorldDirection(dir);
      const tmp = new Vector3();
      let nearest = Infinity;
      for (const r of widgets) {
        tmp.copy(r.world).applyMatrix4(world.camera.matrixWorldInverse);
        const d = -tmp.z;
        if (d > 0.4) nearest = Math.min(nearest, d);
      }
      const dist = clamp(Number.isFinite(nearest) ? nearest - 1.0 : 4.8, 2.6, 5.2);
      const worldPos = new Vector3().copy(world.camera.position).addScaledVector(dir, dist);
      spawnPanel(def, worldPos, `${type}-${++widgetSeq}`);
      views?.setActiveView(null);
      toast(`Added · <b>${def.name}</b>`);
    },
  };

  for (const def of seedPanels()) spawnPanel(def, placeWorld(def.placement), def.type, def.placement.t);

  /** Tear down every panel, recentre the camera, and re-seed the default desk. */
  function resetLayout(): void {
    focus.clearFocus();
    if (rig.exposeActive) expose.collapseExpose();
    rig.viewTween = rig.focusTween = null;
    rig.exposeSaved = rig.exposeReturn = rig.focusReturn = null;
    rig.dragRec = null;
    document.body.classList.remove("focusmode", "exposemode", "views-open");
    for (const w of widgets) {
      render(null, w.el);
      w.el.remove();
    }
    widgets.length = 0;
    widgetSeq = 0;
    rig.pos.set(0, 0, 0);
    rig.yaw = 0;
    rig.pitch = 0;
    for (const def of seedPanels()) spawnPanel(def, placeWorld(def.placement), def.type, def.placement.t);
    views?.setActiveView(null);
    toast("Workspace reset to defaults");
  }

  // ── HUD chrome (HudChrome is mounted into #app first — see main.tsx) ──────────
  views = createViews({ rig, widgets, clearFocus: focus.clearFocus, toast });
  const settings = createSettings();
  const help = createHelp();
  const cmdk = createCmdK({
    rig,
    widgets,
    focus,
    views,
    expose,
    addPanel: (type) => ctx.addPanel(type),
    openSettings: settings.open,
    toggleHelp: help.toggle,
    resetLayout,
  });
  const addMenu = createAddMenu({ addPanel: (type) => ctx.addPanel(type) });
  const input = attachInput(look, rig, { focus, expose, views, onHelp: help.toggle, onFullscreen: toggleFullscreen });

  // ── HUD canvases ──────────────────────────────────────────────────────────────
  const radarCtx = document.querySelector<HTMLCanvasElement>("#radar canvas")?.getContext("2d") ?? null;
  const headingWrap = document.getElementById("heading");
  const headingCanvas = headingWrap?.querySelector("canvas") ?? null;
  const heading = headingWrap && headingCanvas ? createHeading(headingWrap, headingCanvas) : null;
  const starsCanvas = document.getElementById("stars") as HTMLCanvasElement | null;
  const stars = starsCanvas ? createStars(starsCanvas) : null;
  const shadows = createShadows(world.scene);

  // live accent — re-read each frame so the Settings picker re-keys the canvas
  // chrome (radar / heading / shadows) and the scene mountains without a reload.
  let accentStr = accentHex();
  const accentColor = new Color(accentStr);

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
  let raf = 0;
  let prev = performance.now();
  let acc = 0;
  const start = prev;
  let lastSkyY = 1e9; // throttle the --sky-y write to real pitch changes

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const FRAME_MS = frameMs(); // honour the live Settings FPS cap
    acc += Math.min(now - prev, 100); // clamp a long stall so movement can't fling
    prev = now;
    if (acc < FRAME_MS) return;
    acc %= FRAME_MS;

    const { camera } = world;
    // advance camera + interaction state
    updateMovement(rig);
    easeFocusDof(rig, camera);
    advanceDrag(rig);
    stepFocus(rig);
    stepView(rig, widgets);
    camera.position.copy(rig.pos);
    const t = (now - start) / 1000;
    if (!lowMotion()) camera.position.y += Math.sin(t * 0.7) * 0.03; // idle breathing
    camera.rotation.set(rig.pitch, rig.yaw, 0);

    world.recenterWorld(camera.position.x, camera.position.z);
    world.render();
    projectWidgets(widgets, camera, world.focal, rig);

    // pick up an accent change (cheap string compare) and re-key everything
    const aHex = accentHex();
    if (aHex !== accentStr) {
      accentStr = aHex;
      accentColor.set(aHex);
      world.applyAccent(aHex);
    }

    // HUD: fps (refresh ~2×/s), radar, heading tape, panel shadows
    fpsFrames++;
    const fdt = now - fpsLast;
    if (fdt >= 500) {
      fps.value = Math.round((fpsFrames * 1000) / fdt);
      fpsFrames = 0;
      fpsLast = now;
    }
    const yaw = rig.yaw;
    if (radarCtx) {
      const r = drawRadar(radarCtx, {
        yaw,
        camX: camera.position.x,
        camZ: camera.position.z,
        widgets,
        accentHex: accentStr,
        t,
        focused: rig.focusedRec,
      });
      radarCount.value = r.inRange;
      radarHeading.value = r.heading;
    }
    heading?.draw(yaw, accentStr);
    shadows.update(widgets, camera, accentColor);

    // sky + stars track the camera pitch in lockstep with the 3D horizon.
    const skyY = world.focal * Math.tan(rig.pitch);
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
      input.dispose();
      cmdk.dispose();
      settings.dispose();
      addMenu.dispose();
      help.dispose();
      views?.dispose();
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
