// CommandCenterShell — the 3D mode (spec §8). Orchestrates the Three.js scene +
// CSS3D panels + Explore controls + HUD, and renders the overlay chrome. Lazy-
// loaded by ModeRouter so the Three.js weight is only paid when entering this
// shell (the CMS shell never loads it).
//
// This is a faithful v1 of the prototype's model — spatial panels, walk-around
// Explore navigation, radar + heading HUD — built on the SAME Panel contract as
// the CMS shell (Explorer/Preview/Settings float here as interactive surfaces).
// Focus/Exposé camera, the ⌘K palette, 9 saved workspaces and the boot
// cinematic are the next increments (tracked in the spec); the architecture
// below is the seam they slot into.

import { useEffect, useRef } from "preact/hooks";
import { accent, setMode } from "../../core/stores";
import type { PanelContext } from "../../panels/panel";
import { createScene } from "./scene";
import type { SceneHandle } from "./scene";
import { placePanels } from "./panels3d";
import { attachControls } from "./controls";
import { drawRadar, headingDegrees } from "./hud";
import "./cc.css";

export function CommandCenterShell({ ctx }: { ctx: PanelContext }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const cssRef = useRef<HTMLDivElement>(null);
  const radarRef = useRef<HTMLCanvasElement>(null);
  const headingRef = useRef<HTMLSpanElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    const gl = glRef.current;
    const css = cssRef.current;
    const radar = radarRef.current;
    if (!root || !gl || !css || !radar) return;

    const handle = createScene(gl, css);
    handleRef.current = handle;
    const panels = placePanels(handle.scene, ctx);

    let frame = 0;
    const controls = attachControls({
      camera: handle.camera,
      gl: handle.gl,
      css3d: handle.css3d,
      surface: gl, // drag-look listens on the background canvas
      scene: handle.scene,
      fpsCap: 60,
      onFrame: (cam) => {
        drawRadar(radar, cam, panels.positions);
        // Heading text is cheap, but writing it every frame is needless layout
        // churn — refresh ~10×/s.
        if (frame++ % 6 === 0 && headingRef.current) {
          headingRef.current.textContent = String(Math.round(headingDegrees(cam))).padStart(3, "0");
        }
      },
    });

    const ro = new ResizeObserver(() => {
      const r = root.getBoundingClientRect();
      handle.resize(r.width, r.height);
    });
    ro.observe(root);
    const r0 = root.getBoundingClientRect();
    handle.resize(r0.width, r0.height);

    return () => {
      ro.disconnect();
      controls.dispose();
      panels.dispose();
      handle.dispose();
      handleRef.current = null;
    };
  }, [ctx]);

  // Recolor the scene when the DS accent changes.
  useEffect(() => {
    handleRef.current?.applyTheme();
  }, [accent.value]);

  return (
    <div class="cc-root" ref={rootRef}>
      <canvas class="cc-gl" ref={glRef} />
      <div class="cc-css" ref={cssRef} />
      <div class="cc-hud">
        <div class="cc-hud-top">
          <span class="cc-hud-title">Command Center</span>
          <button class="cc-exit" onClick={() => setMode("cms")}>
            Exit to CMS ↩
          </button>
        </div>
        <div class="cc-hud-bottom">
          <div class="cc-heading">
            HDG <span ref={headingRef}>000</span>°
          </div>
          <canvas class="cc-radar" ref={radarRef} width={132} height={132} />
        </div>
        <div class="cc-help">drag empty space to look · WASD to move · wheel to dolly</div>
      </div>
    </div>
  );
}
