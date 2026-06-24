// The WebGL world: renderer + camera + fog + ground + lighting + grid +
// mountains. Ported from the prototype (lines 1299–1495). Widgets are NOT in
// this scene — they are HTML billboards projected from this camera each frame
// (see ../layout.ts). This module owns only the 3D environment.

import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  FogExp2,
  PlaneGeometry,
  MeshBasicMaterial,
  Mesh,
  HemisphereLight,
  DirectionalLight,
  MathUtils,
  Color,
} from "three";
import { createGrid } from "./grid";
import { createMountains } from "./mountains";

export interface SceneHandle {
  scene: Scene;
  camera: PerspectiveCamera;
  gl: WebGLRenderer;
  /** screen-projection focal length (px) — recomputed on resize. */
  focal: number;
  /** recolor the accent-driven scene chrome (mountain ridgelines). */
  applyAccent(hex: string): void;
  /** recenter the infinite floor + horizon ring on the operator (per frame). */
  recenterWorld(camX: number, camZ: number): void;
  resize(width: number, height: number): void;
  render(): void;
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

export function createSceneWorld(canvas: HTMLCanvasElement): SceneHandle {
  const scene = new Scene();
  // deep-blue haze: the far ridge bands soften into the horizon (atmospheric
  // perspective) without erasing them.
  scene.fog = new FogExp2(0x123a6b, 0.0029);

  const camera = new PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.rotation.order = "YXZ";

  const gl = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  gl.setSize(window.innerWidth, window.innerHeight);

  // grid floor (two layers, recentered each frame)
  const grid = createGrid();
  for (const h of grid.helpers) scene.add(h);

  // solid ground just under the grid → floor is not see-through; occludes
  // anything below the plane so mountain bases never show beneath the floor.
  const ground = new Mesh(new PlaneGeometry(6000, 6000), new MeshBasicMaterial({ color: 0x070f20, fog: true }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -3.08;
  scene.add(ground);

  // lighting — high contrast so flat-shaded facets read as real low-poly dimension
  scene.add(new HemisphereLight(0x7184b4, 0x05060d, 0.55));
  const keyLight = new DirectionalLight(0xe6edff, 1.45);
  keyLight.position.set(-60, 95, 38);
  scene.add(keyLight);
  const fillLight = new DirectionalLight(0x2b4d96, 0.55); // cool blue fill → shadow faces stay blue
  fillLight.position.set(70, 22, -34);
  scene.add(fillLight);

  const accentColor = cssColor("--section-accent", "#00f3ff");
  const mountains = createMountains(accentColor);
  scene.add(mountains.group);

  let focal = window.innerHeight / 2 / Math.tan(MathUtils.degToRad(camera.fov / 2));

  return {
    scene,
    camera,
    gl,
    get focal() {
      return focal;
    },
    set focal(v: number) {
      focal = v;
    },
    applyAccent(hex: string) {
      mountains.recolor(new Color(hex));
    },
    recenterWorld(camX, camZ) {
      grid.recenter(camX, camZ);
      mountains.recenter(camX, camZ);
      // the solid floor must follow too, or its 6000² plane ends after a long
      // walk and you see sky through the gap below the grid.
      ground.position.x = camX;
      ground.position.z = camZ;
    },
    resize(width, height) {
      const w = Math.max(1, width);
      const h = Math.max(1, height);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      gl.setSize(w, h);
      focal = h / 2 / Math.tan(MathUtils.degToRad(camera.fov / 2));
    },
    render() {
      gl.render(scene, camera);
    },
    dispose() {
      mountains.dispose();
      ground.geometry.dispose();
      (ground.material as MeshBasicMaterial).dispose();
      for (const hpr of grid.helpers) {
        hpr.geometry.dispose();
        (hpr.material as { dispose(): void }).dispose();
      }
      scene.clear();
      gl.dispose();
      gl.forceContextLoss();
    },
  };
}
