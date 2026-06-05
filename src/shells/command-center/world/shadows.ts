// Panel contact shadows — one soft, accent-tinted light-pool on the floor under
// each billboard so it reads as truly hovering. Analytic radial falloff in a
// shader (no texture → no dither/aliasing). Ported from the prototype
// (makeShadowMat 1369–1396, updateShadows 1561–1585).

import {
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  UniformsUtils,
  UniformsLib,
  Color,
  type Scene,
  type PerspectiveCamera,
} from "three";
import type { WidgetRecord } from "../layout";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

const SHADOW_VERT = `
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main(){
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position,1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const SHADOW_FRAG = `
  uniform vec3 uColor; uniform float uOpacity;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  void main(){
    float d = distance(vUv, vec2(0.5)) * 2.0;
    float a = pow(1.0 - smoothstep(0.0, 1.0, d), 1.6);
    if(a <= 0.001) discard;
    gl_FragColor = vec4(uColor, a * uOpacity);
    #include <fog_fragment>
  }`;

const SHADOW_BASE = new Color(0x01030a);

function makeShadowMat(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog, { uColor: { value: new Color(0x01030a) }, uOpacity: { value: 0.3 } }]),
    vertexShader: SHADOW_VERT,
    fragmentShader: SHADOW_FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
}

interface ShadowState {
  mesh: Mesh;
  /** cached panel width in world units. */
  shW: number;
}

export interface Shadows {
  update(widgets: WidgetRecord[], camera: PerspectiveCamera, accent: Color): void;
  dispose(): void;
}

export function createShadows(scene: Scene): Shadows {
  const geo = new PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2); // lie flat on the floor
  const byRec = new WeakMap<WidgetRecord, ShadowState>();
  const meshes: Mesh[] = [];
  const tint = new Color();

  return {
    update(widgets, camera, accent) {
      for (const rec of widgets) {
        let st = byRec.get(rec);
        if (!st) {
          const mesh = new Mesh(geo, makeShadowMat());
          mesh.renderOrder = 1; // draw over the grid lines
          scene.add(mesh);
          st = { mesh, shW: (rec.el.offsetWidth || 360) * 0.005 };
          byRec.set(rec, st);
          meshes.push(mesh);
        }
        const m = st.mesh;
        const h = Math.max(0, rec.world.y + 3); // height above the floor (y=-3)
        const foot = st.shW * 1.4 + h * 0.34 + 0.7;
        const dx = rec.world.x - camera.position.x;
        const dz = rec.world.z - camera.position.z;
        const L = Math.hypot(dx, dz) || 1;
        m.position.set(rec.world.x - (dx / L) * foot * 0.22, -2.97, rec.world.z - (dz / L) * foot * 0.22);
        m.rotation.y = Math.atan2(-dx, -dz);
        m.scale.set(foot * 1.2, 1, foot * 0.52);
        const u = (m.material as ShaderMaterial).uniforms;
        u.uOpacity.value = clamp(0.4 - h * 0.038, 0.12, 0.4);
        tint.copy(accent);
        (u.uColor.value as Color).copy(SHADOW_BASE).lerp(tint, 0.3);
        m.visible = rec.el.style.visibility !== "hidden";
      }
    },
    dispose() {
      for (const m of meshes) {
        scene.remove(m);
        (m.material as ShaderMaterial).dispose();
      }
      geo.dispose();
    },
  };
}
