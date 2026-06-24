// Activity bus — the shared Session-Log feed + the skill runner. Running a skill
// (from the CLI console, the Skills rail, the Composer, or ⌘K) appends an
// "executing…" line then a realistic result to every Session Log panel, and
// pulses the CAPTURE→EVOLVE→WRAPUP rail. One model so every surface stays in
// sync. Ported from the prototype (SEED_LOG 2374–2380, pushLog 2405–2412,
// PHASE_OF/pulsePhase 2414–2424, SKILL_RESULT/runSkill 2426–2441).

import { signal } from "@preact/signals";
import { reduceMotion } from "../core/motion";

export interface LogRow {
  time: string;
  kind: string;
  /** trusted HTML (seed rows + our own templated skill results; user-derived
   *  fragments are escaped before they reach here). */
  html: string;
}

const SEED: LogRow[] = [
  { time: "09:14", kind: "capture", html: '"Spatial HUD concept" → <span class="wl" data-wl="Command Center">[[Command Center]]</span>' },
  { time: "09:15", kind: "connect", html: 'linked <span class="wl" data-wl="Command Center">[[Command Center]]</span> ↔ <span class="wl" data-wl="OneBrain">[[OneBrain]]</span>' },
  { time: "09:18", kind: "evolve", html: "memory +1 · spatial-ui preference" },
  { time: "09:21", kind: "tasks", html: "3 due today · 1 overdue" },
  { time: "09:24", kind: "daily", html: "briefing ready · 6 sessions logged" },
];

/** the live log feed — every Session Log panel renders from this. */
export const logFeed = signal<LogRow[]>(SEED);

/** which rail phase is lit (drives the .on highlight). */
export const activePhase = signal<"CAPTURE" | "EVOLVE" | "WRAPUP">("CAPTURE");
/** bumped on every pulse so the Log panel can re-trigger the flash animation. */
export const pulseSeq = signal(0);

const nowHM = () => {
  const n = new Date();
  return `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Append a row to the shared feed (lands in every open Session Log panel). */
export function pushLog(kind: string, html: string): void {
  logFeed.value = [...logFeed.value, { time: nowHM(), kind, html }];
}

const PHASE_OF: Record<string, "CAPTURE" | "EVOLVE" | "WRAPUP"> = {
  capture: "CAPTURE", braindump: "CAPTURE", bookmark: "CAPTURE", summarize: "CAPTURE", "reading-notes": "CAPTURE",
  consolidate: "EVOLVE", connect: "EVOLVE", distill: "EVOLVE", moc: "EVOLVE", learn: "EVOLVE", "memory-review": "EVOLVE", reorganize: "EVOLVE",
  wrapup: "WRAPUP", recap: "WRAPUP", weekly: "WRAPUP", daily: "WRAPUP",
};

/** Light the rail phase a skill belongs to + bump the pulse token (when motion). */
export function pulsePhase(name: string): void {
  const phase = PHASE_OF[name];
  if (!phase) return;
  activePhase.value = phase;
  if (!reduceMotion) pulseSeq.value = pulseSeq.peek() + 1;
}

const SKILL_RESULT: Record<string, string> = {
  capture: 'saved → <span class="wl" data-wl="Inbox">[[Inbox]]</span> · 2 links suggested',
  braindump: "12 thoughts filed · 3 tasks extracted",
  bookmark: 'bookmarked → <span class="wl" data-wl="Bookmarks">[[Bookmarks]]</span>',
  summarize: 'summary → <span class="wl" data-wl="Resources">[[Resources]]</span>',
  consolidate: "inbox cleared · 8 notes merged",
  connect: "4 new wikilinks across the graph",
  distill: 'synthesized → <span class="wl" data-wl="Distilled">[[Distilled]]</span>',
  moc: 'map rebuilt → <span class="wl" data-wl="MOC">[[MOC]]</span>',
  learn: "memory +1 fact stored",
  daily: "briefing ready · 3 due today",
  weekly: "week reviewed · 6 sessions",
  research: 'web research saved → <span class="wl" data-wl="Resources">[[Resources]]</span>',
  doctor: "vault healthy · 0 broken links",
  tasks: "task board updated",
  recap: "2 insights promoted to memory",
  wrapup: 'session saved → <span class="wl" data-wl="07-logs">[[07-logs]]</span>',
};

/** the result blurb for a skill (trusted HTML) — also used by the CLI (stripped). */
export function skillResult(name: string): string {
  return SKILL_RESULT[name] || "done · no changes";
}

/** Run a skill: log "executing…", pulse the rail, then log the result (720ms). */
export function runSkill(name: string): void {
  if (!name) return;
  const safe = esc(name);
  pushLog("run", `ran <span class="wl">/${safe}</span> · executing…`);
  pulsePhase(name);
  setTimeout(() => pushLog("done", `<span class="wl">/${safe}</span> → ${skillResult(name)}`), 720);
}
