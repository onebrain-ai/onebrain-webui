// Endless tron grid floor — two concentric GridHelpers with a per-fragment
// radial alpha falloff (custom shader). Ported from the prototype (makeGrid,
// lines 1316–1349).
//
// The grid is a FIXED cool steel-blue — it does NOT follow the accent (the floor
// is scene chrome, not a signal). Each frame the caller recenters it on the
// operator (`recenter`) so the plane is infinite — you can never reach an edge.

import { GridHelper, AdditiveBlending, Color } from "three";

/** fixed bright cool tron-cyan — floor chrome, independent of --section-accent */
const GRID_COLOR = 0x4ab0ff;
const GRID_CELL = 5;
const GRID2_CELL = 20;

interface GridLayer {
  helper: GridHelper;
  cell: number;
}

function makeGrid(size: number, div: number, op: number, y: number, near: number, far: number): GridHelper {
  const g = new GridHelper(size, div);
  const mat = g.material as GridHelper["material"] & {
    color: Color;
    transparent: boolean;
    opacity: number;
    fog: boolean;
    blending: number;
    depthWrite: boolean;
    onBeforeCompile: (sh: ShaderLike) => void;
  };
  mat.vertexColors = false;
  mat.color.set(GRID_COLOR);
  mat.transparent = true;
  mat.opacity = op;
  mat.fog = false; // we do our own radial fade instead of fog
  mat.blending = AdditiveBlending; // lines GLOW against the dark floor (tron)
  mat.depthWrite = false;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNear = { value: near };
    sh.uniforms.uFar = { value: far };
    // Pass object-space xz as a varying — it interpolates LINEARLY along each
    // line, so the radial distance is measured per-FRAGMENT. (Measuring
    // length() per-vertex averages the two far line-ENDS, which wrongly fades
    // out exactly the lines passing right under the operator.)
    sh.vertexShader = sh.vertexShader
      .replace("void main() {", "varying vec2 vGP;\nvoid main() {")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n vGP = position.xz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("void main() {", "varying vec2 vGP;\nuniform float uNear;\nuniform float uFar;\nvoid main() {")
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\n" +
          " float gR = length(vGP);\n" + // per-fragment radius from the operator
          " float gFade = clamp(1.0 - (gR - uNear)/(uFar - uNear), 0.0, 1.0);\n" + // crisp underfoot → faint far
          " diffuseColor.a *= gFade;",
      );
  };
  g.position.set(0, y, 0);
  return g;
}

/** minimal structural type for the onBeforeCompile shader object we touch. */
interface ShaderLike {
  uniforms: Record<string, { value: number }>;
  vertexShader: string;
  fragmentShader: string;
}

/** Build the two-layer grid floor. Add `.helpers` to the scene; call
 *  `recenter(camX, camZ)` once per frame. */
export function createGrid(): {
  helpers: GridHelper[];
  recenter(camX: number, camZ: number): void;
} {
  const layers: GridLayer[] = [
    { helper: makeGrid(720, 144, 0.2, -3, 14, 150), cell: GRID_CELL }, // cell 5 — faint under the operator
    { helper: makeGrid(2880, 144, 0.085, -3.05, 60, 520), cell: GRID2_CELL }, // cell 20 — far floor
  ];
  return {
    helpers: layers.map((l) => l.helper),
    recenter(camX, camZ) {
      // snap to the cell grid so lines never appear to crawl as you move
      for (const l of layers) {
        l.helper.position.x = Math.round(camX / l.cell) * l.cell;
        l.helper.position.z = Math.round(camZ / l.cell) * l.cell;
      }
    },
  };
}
