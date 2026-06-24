// Low-poly mountain ring — 4 receding bands (atmospheric perspective), locked to
// the camera each frame so they sit on an unreachable horizon: visible far away,
// never walked to. Ported from the prototype (lines 1411–1495).
//
// Each peak is one of four silhouette profiles (spike / mesa / butte / shard),
// vertex-painted dark-base→light-cap so flat facets read as snow-lit volume, and
// wrapped in a glowing additive "tron" ridgeline whose colour follows the accent.

import {
  Group,
  Mesh,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  LineSegments,
  LineBasicMaterial,
  MeshStandardMaterial,
  BufferAttribute,
  Matrix4,
  Color,
  AdditiveBlending,
  type BufferGeometry,
} from "three";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** one peak silhouette — built with its BASE AT THE ORIGIN (y=0) so it can be
 *  sheared (lean) and planted on the floor (y=−3) without sinking below it. */
function peakGeometry(h: number): BufferGeometry {
  const r = h * (0.42 + Math.random() * 0.5); // base radius
  const t = Math.random();
  let geo: BufferGeometry;
  if (t < 0.4) {
    geo = new ConeGeometry(r, h, 4 + Math.floor(Math.random() * 4), 1); // sharp spike
  } else if (t < 0.66) {
    geo = new CylinderGeometry(r * (0.14 + Math.random() * 0.3), r, h, 4 + Math.floor(Math.random() * 3), 1); // mesa
  } else if (t < 0.86) {
    geo = new ConeGeometry(r * 1.25, h * 0.72, 5 + Math.floor(Math.random() * 3), 1); // blunt butte
  } else {
    geo = new ConeGeometry(r * 0.9, h * 1.1, 3, 1); // craggy shard
  }
  geo.rotateY(Math.random() * Math.PI * 2);
  // plant the LOWEST vertex exactly on y=0 (profiles have different real heights)
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox!.min.y, 0);
  const shx = (Math.random() - 0.5) * 0.4;
  const shz = (Math.random() - 0.5) * 0.4; // gentle apex lean, base stays planted
  geo.applyMatrix4(new Matrix4().set(1, shx, 0, 0, 0, 1, 0, 0, 0, shz, 1, 0, 0, 0, 0, 1));
  geo.scale(0.74 + Math.random() * 0.9, 1, 0.74 + Math.random() * 0.6); // varied ridges
  return geo;
}

const _cBase = new Color();
const _cCap = new Color();
const _cV = new Color();
/** height gradient (dark base → light cap) so flat-shaded facets read as
 *  snow-lit low-poly volume. */
function paintByHeight(geo: BufferGeometry, baseHex: number, capHex: number): void {
  _cBase.set(baseHex);
  _cCap.set(capHex);
  const p = geo.attributes.position;
  let maxY = 0;
  for (let i = 0; i < p.count; i++) maxY = Math.max(maxY, p.getY(i));
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    // clamp first: base verts can land at −1e-7 → pow(neg) = NaN = garbage facets
    const k = Math.pow(clamp(maxY > 0 ? p.getY(i) / maxY : 0, 0, 1), 0.85);
    _cV.copy(_cBase).lerp(_cCap, k);
    col[i * 3] = _cV.r;
    col[i * 3 + 1] = _cV.g;
    col[i * 3 + 2] = _cV.b;
  }
  geo.setAttribute("color", new BufferAttribute(col, 3));
}

interface Ring {
  rad: number;
  count: number;
  hMin: number;
  hMax: number;
  col: number;
  cap: number;
  rim: number;
  op: number;
}

const RINGS: Ring[] = [
  { rad: 200, count: 40, hMin: 10, hMax: 26, col: 0x1a2b50, cap: 0x8fa6dc, rim: 0.26, op: 1.0 }, // nearest — crisp
  { rad: 330, count: 46, hMin: 18, hMax: 48, col: 0x21345c, cap: 0x8aa0d6, rim: 0.17, op: 1.0 },
  { rad: 480, count: 52, hMin: 34, hMax: 86, col: 0x2c4170, cap: 0x8aa0d2, rim: 0.1, op: 0.64 }, // softened
  { rad: 650, count: 58, hMin: 60, hMax: 142, col: 0x3a5088, cap: 0x90a4d4, rim: 0.05, op: 0.4 }, // farthest — melts into haze
];

/** Build the mountain ring. `accentColor` seeds the ridgeline glow; call
 *  `recolor` on accent change and `recenter` each frame. */
export function createMountains(accentColor: Color): {
  group: Group;
  recolor(c: Color): void;
  recenter(camX: number, camZ: number): void;
  dispose(): void;
} {
  const group = new Group();
  const edgeMats: LineBasicMaterial[] = [];
  const meshMats: MeshStandardMaterial[] = [];
  const bands: Group[] = [];
  const geometries: BufferGeometry[] = []; // peak geos + their derived edge geos

  RINGS.forEach((rg, ri) => {
    const band = new Group();
    for (let i = 0; i < rg.count; i++) {
      const a = (i / rg.count) * Math.PI * 2 + ri * 0.19 + (Math.random() - 0.5) * 0.12;
      const h = rg.hMin + Math.random() * (rg.hMax - rg.hMin);
      const geo = peakGeometry(h);
      paintByHeight(geo, rg.col, rg.cap);
      geometries.push(geo);
      const soft = rg.op < 0.999;
      const meshMat = new MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 1,
        metalness: 0,
        transparent: soft,
        opacity: rg.op,
        depthWrite: !soft, // far bands: translucent + no depth-write → soft, hazy
      });
      meshMats.push(meshMat);
      const mesh = new Mesh(geo, meshMat);
      const dist = rg.rad + (Math.random() - 0.5) * rg.rad * 0.18;
      mesh.position.set(Math.cos(a) * dist, -3, Math.sin(a) * dist); // base on the floor plane
      band.add(mesh);
      const em = new LineBasicMaterial({
        color: accentColor.clone(),
        transparent: true,
        opacity: rg.rim,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const edgeGeo = new EdgesGeometry(geo, 24);
      geometries.push(edgeGeo); // derived geometry has its own GPU buffer → must dispose
      const edges = new LineSegments(edgeGeo, em);
      edges.position.copy(mesh.position);
      band.add(edges);
      edgeMats.push(em);
    }
    group.add(band);
    bands.push(band);
  });

  return {
    group,
    recolor(c) {
      for (const em of edgeMats) em.color.copy(c);
    },
    recenter(camX, camZ) {
      // locked 1:1 to the camera so the peaks stay infinitely far (static depth)
      for (const b of bands) {
        b.position.x = camX;
        b.position.z = camZ;
      }
    },
    dispose() {
      for (const g of geometries) g.dispose();
      for (const em of edgeMats) em.dispose();
      for (const m of meshMats) m.dispose();
    },
  };
}
