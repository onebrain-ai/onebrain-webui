// Tiny canvas-color helper shared by the radar + heading tape. `rgba("#00f3ff",
// 0.5)` → "rgba(0,243,255,0.5)". Accepts #rgb / #rrggbb.

export function rgba(hex: string, a: number): string {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}
