// Three.js scene scaffold for the command center: a WebGL layer (grid floor +
// fog + atmosphere) behind a CSS3D layer (the interactive HTML panels), both
// driven by ONE shared perspective camera. This is the "Three.js app with an
// HTML UI layer" model from the prototype, but using the stock `CSS3DRenderer`
// so panels stay real, interactive DOM (Explorer clicks, Preview scroll) instead
// of manually-projected billboards.
//
// Colors come from the DS Operator Console palette (read off CSS variables so a
// theme/accent change flows into the 3D scene too).

import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  GridHelper,
  FogExp2,
  HemisphereLight,
  DirectionalLight,
  Color,
} from "three";
import { CSS3DRenderer } from "three/examples/jsm/renderers/CSS3DRenderer.js";

export interface SceneHandle {
  scene: Scene;
  camera: PerspectiveCamera;
  gl: WebGLRenderer;
  css3d: CSS3DRenderer;
  /** Re-read DS CSS variables and recolor the scene (call on accent change). */
  applyTheme(): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

/** Read a CSS custom property off :root as a THREE.Color (fallback if unset). */
function cssColor(name: string, fallback: string): Color {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  try {
    return new Color(raw || fallback);
  } catch {
    return new Color(fallback);
  }
}

/**
 * Build the scene against two host elements: `glCanvas` (the WebGL `<canvas>`)
 * and `cssLayer` (a div the CSS3DRenderer fills with transformed panels).
 */
export function createScene(glCanvas: HTMLCanvasElement, cssLayer: HTMLElement): SceneHandle {
  const scene = new Scene();

  const camera = new PerspectiveCamera(62, 1, 0.1, 1000);
  // Operator standing on the grid, looking slightly down the -Z hall of panels.
  camera.position.set(0, 0, 6);
  camera.rotation.order = "YXZ";

  const gl = new WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true });
  gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const css3d = new CSS3DRenderer({ element: cssLayer });

  // Lighting — soft, no shadows (panels are self-lit DOM; this is for the grid).
  scene.add(new HemisphereLight(0xb0c4ff, 0x080810, 1.1));
  const key = new DirectionalLight(0xffffff, 0.6);
  key.position.set(5, 8, 4);
  scene.add(key);

  // Grid floor — the HUD lattice, dropped to the operator's feet.
  const grid = new GridHelper(400, 200);
  grid.position.y = -3;
  (grid.material as { transparent: boolean; opacity: number }).transparent = true;
  (grid.material as { transparent: boolean; opacity: number }).opacity = 0.25;
  scene.add(grid);

  const handle: SceneHandle = {
    scene,
    camera,
    gl,
    css3d,
    applyTheme() {
      // Fog + grid take the DS canvas + accent so the world matches the theme.
      const bg = cssColor("--color-bg", "#050507");
      scene.fog = new FogExp2(bg.getHex(), 0.018);
      const accent = cssColor("--section-accent", "#00f3ff");
      (grid.material as unknown as { color: Color }).color = accent.clone().multiplyScalar(0.6);
    },
    resize(width: number, height: number) {
      const w = Math.max(1, width);
      const h = Math.max(1, height);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      gl.setSize(w, h);
      css3d.setSize(w, h);
    },
    dispose() {
      grid.geometry.dispose();
      (grid.material as { dispose(): void }).dispose();
      scene.clear();
      gl.dispose();
      // `dispose()` frees GPU objects but does NOT relinquish the GL context —
      // without this, repeated enter/exit accumulates contexts toward the
      // browser's ~16 limit and the oldest scenes get dropped (R1 H2).
      gl.forceContextLoss();
    },
  };

  handle.applyTheme();
  return handle;
}
