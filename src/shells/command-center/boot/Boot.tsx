// Boot screen — the cyberpunk loading sequence: ONEBRAIN lockup + counting %
// bar + asset-stream log, then an armed "Enter Command Center" button that warps
// into the field. Ported from the prototype (markup 1148–1189, JS 3101–3153).

import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { reduceMotion } from "../../../core/motion";
import { bootGone, leaveBoot } from "./store";
import "./boot.css";

const BOOT_SEQ = [
  "Booting operator kernel",
  "Mounting vault · 1,284 notes",
  "Linking harness · Claude Code",
  "Compiling 29 skills",
  "Rendering 3D field · shaders",
  "Calibrating optics · HUD online",
];

interface LogRow {
  ts: string;
  txt: string;
  active: boolean;
}

export function Boot() {
  const pct = useSignal(0);
  const armed = useSignal(false);
  const net = useSignal("BOOTING");
  const lat = useSignal("—");
  const rows = useSignal<LogRow[]>([]);

  // boot loading sequence
  useEffect(() => {
    const arm = () => {
      armed.value = true;
      net.value = "ONLINE";
      lat.value = "14ms";
      pct.value = 100;
    };
    if (reduceMotion) {
      rows.value = BOOT_SEQ.map((s, i) => ({ ts: `+${(i * 0.3).toFixed(2)}s`, txt: s, active: false }));
      arm();
      return;
    }
    let bi = 0;
    let shown = 0;
    let target = 4;
    let done = false;
    pct.value = 4;
    // smooth count-up toward the current target; arm once it reaches 100
    const counter = setInterval(() => {
      if (shown < target) {
        shown = Math.min(target, shown + Math.max(1, Math.round((target - shown) / 5)));
        pct.value = shown;
      } else if (done && shown >= 100) {
        clearInterval(counter);
        arm();
      }
    }, 26);
    // step the asset stream; each step lifts the target the counter eases toward
    const bt = setInterval(() => {
      const cur = rows.value.slice();
      if (cur.length) cur[cur.length - 1] = { ...cur[cur.length - 1], active: false };
      if (bi >= BOOT_SEQ.length) {
        rows.value = cur;
        clearInterval(bt);
        target = 100;
        done = true;
        return;
      }
      cur.push({ ts: `+${(bi * 0.3 + 0.16).toFixed(2)}s`, txt: BOOT_SEQ[bi], active: true });
      rows.value = cur;
      target = Math.round(((bi + 1) / BOOT_SEQ.length) * 100);
      bi++;
    }, 360);
    return () => {
      clearInterval(counter);
      clearInterval(bt);
    };
  }, []);

  // Enter key warps straight in once armed
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (bootGone.value) return;
      if ((e.code === "Enter" || e.code === "NumpadEnter") && armed.value) {
        e.preventDefault();
        leaveBoot();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cls = `${armed.value ? "ready" : ""}${bootGone.value ? " gone" : ""}`.trim();

  return (
    <div id="boot" class={cls}>
      <span class="boot-grid" />
      <span class="boot-floor" />
      <span class="boot-scan" />
      <div class="boot-frame">
        <i />
        <i />
        <i />
        <i />
      </div>

      <div class="boot-card">
        <div class="boot-top">
          <span class="boot-pill">
            <span class="dot" />
            System Boot
          </span>
          <span class="boot-ver">Build 3.1.6 · Operator Console</span>
        </div>

        <div class="boot-lock">
          <svg class="ob-mark boot-mark" aria-hidden="true">
            <use href="#ob-brain-mark" />
          </svg>
          <h1 class="boot-title">
            <span class="one">One</span>
            <span class="brain">Brain</span>
          </h1>
        </div>
        <div class="boot-sub2">Command Center</div>
        <p class="boot-tag">
          Your vault, skills, sessions and tasks, rendered as live panels in a 3D field. Compiling the operator HUD.
        </p>

        <div class="boot-loadrow">
          <div class="boot-bar-wrap">
            <div id="boot-bar" style={`width:${pct.value}%`} />
          </div>
          <div class="boot-pct">
            <span>{pct.value}</span>
            <i>%</i>
          </div>
        </div>

        <div class="boot-stream">
          {rows.value.map((r, i) => (
            <div class={`bl-row${r.active ? " is-active" : ""}`} key={i}>
              <span class="bl-ts">{r.ts}</span>
              <span class="bl-txt">{r.txt}</span>
              <span class="bl-ok">{r.active ? "··" : "OK"}</span>
            </div>
          ))}
        </div>

        <button class="btn-tech boot-enter" type="button" disabled={!armed.value} onClick={() => leaveBoot()}>
          <span>{armed.value ? "Enter Command Center" : "Initializing…"}</span>
        </button>

        <div class="boot-tips">
          <span>
            <b>W/S</b> move · <b>A/D</b> turn
          </span>
          <span>
            <b>Drag</b> look
          </span>
          <span>
            <b>Dbl-click</b> focus
          </span>
          <span>
            <b>0</b> exposé
          </span>
          <span>
            <b>1–9</b> views
          </span>
          <span>
            <b>＋</b> add panel
          </span>
        </div>
        <div class="boot-foot">
          NODE · NETWORK :: <b>{net.value}</b> · LAT <span>{lat.value}</span>
        </div>
      </div>
    </div>
  );
}
