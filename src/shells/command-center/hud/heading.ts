// Heading tape — compass ruler at the bottom-center, scrolls with camera yaw.
// Ported from the prototype's HEAD object (lines 3288–3328).

import { rgba } from "./canvas";

const CARD: Record<number, string> = { 0: "N", 90: "E", 180: "S", 270: "W" };

export interface Heading {
  draw(yaw: number, accentHex: string): void;
  resize(): void;
}

export function createHeading(wrap: HTMLElement, canvas: HTMLCanvasElement): Heading {
  const hctx = canvas.getContext("2d")!;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0;
  let H = 0;
  const resize = () => {
    W = canvas.width = Math.round(wrap.clientWidth * DPR);
    H = canvas.height = Math.round(wrap.clientHeight * DPR);
  };
  resize();

  return {
    resize,
    draw(yaw, acc) {
      if (!W) return;
      hctx.clearRect(0, 0, W, H);
      const hdg = (((-yaw * 180) / Math.PI) % 360 + 360) % 360;
      const cx = W / 2;
      const PPD = 7 * DPR; // pixels per degree
      const span = Math.ceil(W / 2 / PPD) + 2;
      const baseY = H * 0.82;
      hctx.textAlign = "center";
      for (let i = -span; i <= span; i++) {
        const deg = Math.round(hdg) + i;
        const shown = ((deg % 360) + 360) % 360;
        const x = cx + (deg - hdg) * PPD;
        if (x < -24 || x > W + 24) continue;
        const card = shown % 90 === 0;
        const major = shown % 10 === 0;
        const tk = card ? 17 * DPR : major ? 11 * DPR : 6 * DPR;
        hctx.strokeStyle = card ? rgba(acc, 0.95) : major ? rgba(acc, 0.5) : "rgba(255,255,255,.22)";
        hctx.lineWidth = card ? 2 * DPR : 1 * DPR;
        hctx.beginPath();
        hctx.moveTo(x, baseY);
        hctx.lineTo(x, baseY - tk);
        hctx.stroke();
        if (shown % 30 === 0) {
          hctx.fillStyle = card ? rgba(acc, 0.95) : "rgba(255,255,255,.5)";
          hctx.font = `${card ? "700 " : "500 "}${(card ? 12 : 10) * DPR}px "JetBrains Mono", monospace`;
          hctx.fillText(CARD[shown] ?? String(shown).padStart(3, "0"), x, baseY - tk - 6 * DPR);
        }
      }
      // center index — accent caret + heading readout above it
      hctx.fillStyle = acc;
      hctx.shadowColor = acc;
      hctx.shadowBlur = 10 * DPR;
      hctx.beginPath();
      hctx.moveTo(cx, baseY + 2 * DPR);
      hctx.lineTo(cx - 5 * DPR, baseY + 11 * DPR);
      hctx.lineTo(cx + 5 * DPR, baseY + 11 * DPR);
      hctx.closePath();
      hctx.fill();
      hctx.shadowBlur = 0;
      hctx.fillStyle = "#fff";
      hctx.font = `700 ${13 * DPR}px "JetBrains Mono", monospace`;
      hctx.fillText(`${String(Math.round(hdg) % 360).padStart(3, "0")}°`, cx, 15 * DPR);
    },
  };
}
