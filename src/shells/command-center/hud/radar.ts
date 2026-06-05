// Radar minimap — bottom-right, objects-in-range. Ported from the prototype's
// drawRadar (lines 3192–3277). Canvas backing store is 320×320 (rendered at
// 128px). Reads camera yaw + position, the widget world positions, and the
// accent; returns the in-range count + heading for the caption.

import { rgba } from "./canvas";
import { lowMotion } from "../../../core/motion";

export interface RadarTarget {
  /** world position (THREE.Vector3-like: x/z used). */
  world: { x: number; z: number };
  /** short blip label (e.g. "EXP"). */
  label: string;
  /** per-panel accent hex, or undefined → use the global accent. */
  accent?: string;
}

const RV = 320;
const RC = RV / 2;
const RR = RC - 14; // outer cardinal ring
const RDATA = RR - 26; // inner blip radius
const MAXR = 28; // world range

const CARDS: [string, number, number][] = [
  ["N", 0, -1],
  ["E", 1, 0],
  ["S", 0, 1],
  ["W", -1, 0],
];

export interface RadarFrame {
  yaw: number;
  camX: number;
  camZ: number;
  widgets: RadarTarget[];
  accentHex: string;
  /** elapsed seconds (drives the sweep). */
  t: number;
  /** the focused target, or null. */
  focused?: RadarTarget | null;
}

/** Draw one radar frame; returns the caption data (count in range + heading°). */
export function drawRadar(rctx: CanvasRenderingContext2D, f: RadarFrame): { inRange: number; heading: number } {
  const { yaw, camX, camZ, widgets, accentHex: acc } = f;
  const low = lowMotion();
  rctx.clearRect(0, 0, RV, RV);
  const sweepAng = low ? -1 : (f.t * 1.25) % (Math.PI * 2);

  // range rings + crosshair
  rctx.strokeStyle = "rgba(255,255,255,.09)";
  rctx.lineWidth = 1.4;
  rctx.beginPath();
  rctx.arc(RC, RC, RR, 0, 7);
  rctx.stroke();
  [1, 0.66, 0.33].forEach((s) => {
    rctx.beginPath();
    rctx.arc(RC, RC, RDATA * s, 0, 7);
    rctx.stroke();
  });
  rctx.beginPath();
  rctx.moveTo(RC, RC - RDATA);
  rctx.lineTo(RC, RC + RDATA);
  rctx.moveTo(RC - RDATA, RC);
  rctx.lineTo(RC + RDATA, RC);
  rctx.stroke();

  // cardinal bearings — rotate with heading
  {
    const sy0 = Math.sin(yaw);
    const cy0 = Math.cos(yaw);
    rctx.textAlign = "center";
    rctx.textBaseline = "middle";
    for (const [letter, ddx, ddz] of CARDS) {
      const fwd = ddx * -sy0 + ddz * -cy0;
      const r = ddx * cy0 + ddz * -sy0;
      const isN = letter === "N";
      rctx.strokeStyle = isN ? rgba(acc, 0.9) : "rgba(255,255,255,.28)";
      rctx.lineWidth = isN ? 2.4 : 1.3;
      rctx.beginPath();
      rctx.moveTo(RC + r * (RR - 5), RC - fwd * (RR - 5));
      rctx.lineTo(RC + r * RR, RC - fwd * RR);
      rctx.stroke();
      rctx.fillStyle = isN ? rgba(acc, 0.95) : "rgba(255,255,255,.5)";
      rctx.font = `${isN ? "700 " : "500 "}${isN ? 21 : 17}px "JetBrains Mono", monospace`;
      if (isN) {
        rctx.shadowColor = acc;
        rctx.shadowBlur = 8;
      }
      rctx.fillText(letter, RC + r * (RR - 14), RC - fwd * (RR - 14));
      rctx.shadowBlur = 0;
    }
    rctx.textBaseline = "alphabetic";
  }

  // sweep wedge
  if (!low) {
    rctx.save();
    rctx.translate(RC, RC);
    rctx.rotate(sweepAng);
    const g = rctx.createLinearGradient(0, 0, RDATA, 0);
    g.addColorStop(0, rgba(acc, 0));
    g.addColorStop(1, rgba(acc, 0.22));
    rctx.fillStyle = g;
    rctx.beginPath();
    rctx.moveTo(0, 0);
    rctx.arc(0, 0, RDATA, -0.34, 0);
    rctx.closePath();
    rctx.fill();
    rctx.strokeStyle = rgba(acc, 0.5);
    rctx.lineWidth = 1.4;
    rctx.beginPath();
    rctx.moveTo(0, 0);
    rctx.lineTo(RDATA, 0);
    rctx.stroke();
    rctx.restore();
  }

  // blips
  const sy = Math.sin(yaw);
  const cyaw = Math.cos(yaw);
  const k = RDATA / MAXR;
  let inRange = 0;
  for (const rec of widgets) {
    const dx = rec.world.x - camX;
    const dz = rec.world.z - camZ;
    const fwd = dx * -sy + dz * -cyaw;
    const rgt = dx * cyaw + dz * -sy;
    let range = Math.hypot(dx, dz);
    let s = 1;
    let dim = false;
    if (range > MAXR) {
      s = MAXR / range;
      dim = true;
    } else {
      inRange++;
    }
    const bx = RC + rgt * k * s;
    const by = RC - fwd * k * s;
    const focused = rec === f.focused;
    const pacc = rec.accent ?? acc;
    const col = focused ? "#ffffff" : pacc;
    // ping: as the sweep crosses a blip it flashes twice behind one expanding ring
    let prog = -1;
    let blink = 0;
    if (sweepAng >= 0 && !dim) {
      const blipAng = Math.atan2(by - RC, bx - RC);
      let delta = (sweepAng - blipAng) % (Math.PI * 2);
      if (delta < 0) delta += Math.PI * 2;
      const RING = 0.9;
      if (delta < RING) prog = delta / RING;
      const BLINK = 0.5;
      if (delta < BLINK) blink = Math.abs(Math.sin((delta / BLINK) * Math.PI * 2));
    }
    if (prog >= 0) {
      rctx.strokeStyle = rgba(col, 0.5 * (1 - prog));
      rctx.lineWidth = 1.6;
      rctx.beginPath();
      rctx.arc(bx, by, 5 + prog * 13, 0, 7);
      rctx.stroke();
    }
    if (!dim) {
      rctx.shadowColor = col;
      rctx.shadowBlur = 11 + blink * 18;
    }
    rctx.fillStyle = rgba(col, dim ? 0.45 : 1);
    rctx.beginPath();
    rctx.arc(bx, by, (focused ? 6 : 4.6) + blink * 2.6, 0, 7);
    rctx.fill();
    rctx.shadowBlur = 0;
    rctx.fillStyle = rgba("#ffffff", dim ? 0.45 : 0.82 + blink * 0.18);
    rctx.font = '600 14px "JetBrains Mono", monospace';
    rctx.textAlign = "center";
    rctx.fillText(rec.label, bx, by - 9);
  }

  // operator marker (center, points up = forward)
  rctx.fillStyle = acc;
  rctx.beginPath();
  rctx.moveTo(RC, RC - 9);
  rctx.lineTo(RC - 6, RC + 6);
  rctx.lineTo(RC + 6, RC + 6);
  rctx.closePath();
  rctx.fill();

  const heading = (((Math.round((-yaw * 180) / Math.PI) % 360) + 360) % 360);
  return { inRange, heading };
}
