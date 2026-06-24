// Live star field — twinkle + slow drift + rare shooting stars, on the #stars
// 2D canvas behind the WebGL field. Ported from the prototype (lines 3443–3521).
// Runs its own rAF; freezes to a single static repaint under lowMotion().

import { lowMotion } from "../../../core/motion";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

interface Star {
  x: number;
  y: number;
  r: number;
  base: number;
  sp: number;
  ph: number;
  tw: number;
  dx: number;
}
interface Shooter {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  len: number;
}

export function createStars(cv: HTMLCanvasElement): { dispose(): void } {
  const ctx = cv.getContext("2d")!;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const OVER = 2.6; // canvas is 2.6× viewport tall (80vh slack above + below)
  let W = 0;
  let H = 0;
  let horizon = 0;
  let fadeBand = 0;
  let stars: Star[] = [];
  const shooters: Shooter[] = [];
  let repaint = true; // force one static repaint after resize/idle

  function build() {
    const cssH = Math.round(window.innerHeight * OVER);
    W = cv.width = Math.round(window.innerWidth * DPR);
    H = cv.height = Math.round(cssH * DPR);
    cv.style.width = `${window.innerWidth}px`;
    cv.style.height = `${cssH}px`;
    horizon = Math.round((0.8 + 0.56) * window.innerHeight * DPR);
    fadeBand = 0.34 * window.innerHeight * DPR;
    const n = Math.round((window.innerWidth / 11) * (horizon / (0.56 * window.innerHeight * DPR)));
    stars = [];
    for (let i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.pow(Math.random(), 1.2) * horizon,
        r: (0.4 + Math.random() * 1.05) * DPR,
        base: 0.32 + Math.random() * 0.55,
        sp: 0.5 + Math.random() * 1.9,
        ph: Math.random() * 6.283,
        tw: 0.45 + Math.random() * 0.5,
        dx: (0.015 + Math.random() * 0.04) * DPR,
      });
    }
    repaint = true;
  }

  function spawnShooter() {
    if (shooters.length >= 1) return;
    const ang = 0.18 + Math.random() * 0.42;
    const sp = (7 + Math.random() * 5) * DPR;
    shooters.push({
      x: Math.random() * W * 0.85,
      y: Math.random() * horizon * 0.55,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      life: 0,
      max: 0.5 + Math.random() * 0.45,
      len: (95 + Math.random() * 75) * DPR,
    });
  }

  let last = performance.now();
  let nextShoot = 14000 + Math.random() * 16000;
  let raf = 0;

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const low = lowMotion();
    if (low) {
      if (!repaint) return;
      repaint = false;
    } else {
      // keep the flag armed while motion is on, so the NEXT toggle-off still
      // gets one clean static repaint (matches the prototype's _starsRepaint).
      repaint = true;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#dff2ff";
    for (const s of stars) {
      if (!low) {
        s.x += s.dx;
        if (s.x > W) s.x -= W;
      }
      const fall = clamp((horizon - s.y) / fadeBand, 0, 1);
      let a = s.base * Math.max(0, fall);
      if (!low) a *= 1 - s.tw + s.tw * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph));
      if (a < 0.012) continue;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, 6.2832);
      ctx.fill();
    }
    if (!low) {
      nextShoot -= dt * 1000;
      if (nextShoot <= 0) {
        spawnShooter();
        nextShoot = 32000 + Math.random() * 40000;
      }
      for (let i = shooters.length - 1; i >= 0; i--) {
        const sh = shooters[i];
        sh.life += dt;
        sh.x += sh.vx;
        sh.y += sh.vy;
        if (sh.life >= sh.max || sh.y > horizon) {
          shooters.splice(i, 1);
          continue;
        }
        const fade = Math.sin(Math.min(1, sh.life / sh.max) * Math.PI);
        const m = Math.hypot(sh.vx, sh.vy) || 1;
        const tx = sh.x - (sh.vx / m) * sh.len;
        const ty = sh.y - (sh.vy / m) * sh.len;
        const g = ctx.createLinearGradient(tx, ty, sh.x, sh.y);
        g.addColorStop(0, "rgba(180,235,255,0)");
        g.addColorStop(1, `rgba(225,246,255,${(0.9 * fade).toFixed(3)})`);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.5 * DPR;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(sh.x, sh.y);
        ctx.stroke();
        ctx.globalAlpha = fade;
        ctx.fillStyle = "#eaf7ff";
        ctx.beginPath();
        ctx.arc(sh.x, sh.y, 1.6 * DPR, 0, 6.2832);
        ctx.fill();
        ctx.fillStyle = "#dff2ff";
      }
    }
    ctx.globalAlpha = 1;
  }

  const onResize = () => build();
  window.addEventListener("resize", onResize);
  build();
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    },
  };
}
