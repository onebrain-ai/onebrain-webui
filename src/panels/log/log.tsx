// Session Log panel — the live activity feed + CAPTURE→EVOLVE→WRAPUP phase rail.
// Renders from the shared `activity` bus so a skill run from anywhere (CLI /
// Skills / ⌘K) streams in here and pulses the rail. Ported from the prototype
// (template 1229–1233, SEED_LOG 2374–2380, pushLog/pulsePhase 2405–2424).

import { useRef, useEffect } from "preact/hooks";
import type { PanelDef, PanelContext } from "../contract";
import { resolveWikilink } from "../bus";
import { logFeed, activePhase, pulseSeq } from "../activity";
import "./log.css";

const PHASES = ["CAPTURE", "EVOLVE", "WRAPUP"] as const;

function Log({ ctx }: { ctx: PanelContext }) {
  const railRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const phase = activePhase.value;
  const rows = logFeed.value;
  const pulse = pulseSeq.value;

  // re-trigger the CSS flash on the lit phase whenever a skill runs (remove →
  // reflow → add, like the prototype). Skip the initial mount (pulse === 0).
  useEffect(() => {
    if (pulse === 0) return;
    const el = railRef.current?.querySelector<HTMLElement>(".phase.on");
    if (!el) return;
    el.classList.remove("pulse");
    void el.offsetWidth;
    el.classList.add("pulse");
  }, [pulse]);

  // keep the newest row in view as the feed grows
  useEffect(() => {
    const f = feedRef.current;
    if (f) f.scrollTop = f.scrollHeight;
  }, [rows]);

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
      <div class="loop-rail" ref={railRef}>
        {PHASES.map((p) => (
          <span class={`phase${p === phase ? " on" : ""}`}>{p}</span>
        ))}
      </div>
      <div class="log-feed" ref={feedRef} onClick={onClick}>
        {rows.map((r) => (
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
