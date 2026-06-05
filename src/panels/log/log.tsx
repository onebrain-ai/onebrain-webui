// Session Log panel — the live activity feed + CAPTURE→EVOLVE→WRAPUP phase rail.
// Seeded mock matching the prototype (lines 1229–1233, SEED_LOG 2374–2380). The
// live feed wires to real session events later.

import type { PanelDef, PanelContext } from "../contract";
import { resolveWikilink } from "../bus";
import "./log.css";

interface LogRow {
  time: string;
  kind: string;
  /** trusted HTML (our own seed). */
  html: string;
}

const SEED: LogRow[] = [
  { time: "09:14", kind: "capture", html: '"Spatial HUD concept" → <span class="wl" data-wl="Command Center">Command Center</span>' },
  { time: "09:15", kind: "connect", html: 'linked <span class="wl" data-wl="Command Center">Command Center</span> ↔ <span class="wl" data-wl="OneBrain">OneBrain</span>' },
  { time: "09:18", kind: "evolve", html: "memory +1 · spatial-ui preference" },
  { time: "09:21", kind: "tasks", html: "3 due today · 1 overdue" },
  { time: "09:24", kind: "daily", html: "briefing ready · 6 sessions logged" },
];

function Log({ ctx }: { ctx: PanelContext }) {
  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest(".wl[data-wl]");
    if (!a) return;
    const target = resolveWikilink(a.getAttribute("data-wl") ?? "");
    if (target) ctx.openFile(target);
  };
  return (
    <>
      <div class="w-head">
        <span class="pill">
          <span class="dot" />
          // Session Log
        </span>
        <span class="w-meta">LIVE</span>
      </div>
      <div class="loop-rail">
        <span class="phase on">CAPTURE</span>
        <span class="phase">EVOLVE</span>
        <span class="phase">WRAPUP</span>
      </div>
      <div class="log-feed" onClick={onClick}>
        {SEED.map((r) => (
          <div class="log-row">
            <span class="lt">{r.time}</span>
            <span class={`lk k-${r.kind}`}>{r.kind}</span>
            <span class="lm" dangerouslySetInnerHTML={{ __html: r.html }} />
          </div>
        ))}
      </div>
    </>
  );
}

export const logPanel: PanelDef = {
  type: "log",
  name: "Session Log",
  width: 330,
  placement: { t: 1.26, y: 0.4, r: 6.8, s: 0.005 },
  seed: true,
  Component: Log,
};
