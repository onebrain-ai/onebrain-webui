// HUD drawing — a top-down radar + heading readout, painted straight onto a 2D
// canvas inside the render loop (NOT via Preact, so it doesn't trigger a
// component re-render every frame). Reads the DS accent off CSS so the HUD
// matches the theme.

import type { PerspectiveCamera, Vector3 } from "three";

const RADAR = 132; // canvas px (square)

function accent(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--section-accent").trim() || "#00f3ff";
}

/** Heading in compass degrees (0 = looking down -Z, increasing clockwise). */
export function headingDegrees(camera: PerspectiveCamera): number {
  const deg = (-camera.rotation.y * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/**
 * Paint the radar: the operator at center, panels as blips placed by their
 * world offset from the camera, and a heading sweep line. `panelPositions` are
 * the panels' world positions.
 */
export function drawRadar(
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera,
  panelPositions: Vector3[],
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio, 2);
  if (canvas.width !== RADAR * dpr) {
    canvas.width = RADAR * dpr;
    canvas.height = RADAR * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, RADAR, RADAR);

  const cx = RADAR / 2;
  const cy = RADAR / 2;
  const r = RADAR / 2 - 6;
  const col = accent();

  // Rings + crosshair.
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  for (const rr of [r, r * 0.66, r * 0.33]) {
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.stroke();

  // Heading sweep — a line pointing where the operator looks.
  const yaw = camera.rotation.y;
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  // Screen up = forward (-Z); rotate by yaw.
  ctx.lineTo(cx + Math.sin(yaw) * r, cy - Math.cos(yaw) * r);
  ctx.stroke();

  // Panel blips, positioned relative to the operator, rotated into view space.
  const px = camera.position.x;
  const pz = camera.position.z;
  const scale = r / 9; // ~9 world units → radar edge
  ctx.fillStyle = col;
  for (const p of panelPositions) {
    let dx = p.x - px;
    let dz = p.z - pz;
    // Rotate by -yaw so "forward" is up on the radar.
    const rx = dx * Math.cos(-yaw) - dz * Math.sin(-yaw);
    const rz = dx * Math.sin(-yaw) + dz * Math.cos(-yaw);
    const bx = cx + rx * scale;
    const by = cy + rz * scale; // +z (behind) maps downward
    if (Math.hypot(bx - cx, by - cy) > r) continue;
    ctx.beginPath();
    ctx.arc(bx, by, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
