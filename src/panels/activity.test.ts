// activity.ts has module-level signals (logFeed, activePhase, pulseSeq) that
// persist across tests — reset them in beforeEach so tests don't bleed into
// each other. reduceMotion is determined by matchMedia at module load, so we
// stub it before importing (or accept the default value in jsdom which has no
// matchMedia → defaults to false → motion is enabled).

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  logFeed,
  activePhase,
  pulseSeq,
  pushLog,
  pulsePhase,
  skillResult,
  runSkill,
} from "./activity";

// reduceMotion is evaluated ONCE at module load from matchMedia — to test the
// `!reduceMotion` false-branch (motion suppressed), we need a fresh module with a
// stubbed matchMedia that reports "prefers-reduced-motion: reduce".
describe("pulsePhase — reduceMotion=true suppresses pulseSeq bump", () => {
  it("does NOT bump pulseSeq when reduced motion is active", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("reduce"),
      addListener: () => {},
      removeListener: () => {},
    }));
    vi.resetModules();

    const { pulsePhase: pf, pulseSeq: ps, activePhase: ap } = await import("./activity");
    ap.value = "CAPTURE";
    const before = ps.value;
    pf("capture");
    // phase is still updated even under reduced motion
    expect(ap.value).toBe("CAPTURE");
    // pulseSeq must NOT have changed
    expect(ps.value).toBe(before);

    vi.unstubAllGlobals();
    vi.resetModules();
  });
});

// The SEED array has 5 rows at module load — save it so we can reset.
const SEED_LEN = 5;

beforeEach(() => {
  // Reset signals to their initial state.
  logFeed.value = logFeed.value.slice(0, SEED_LEN);
  activePhase.value = "CAPTURE";
  pulseSeq.value = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pushLog", () => {
  it("appends a row with the current HH:MM time", () => {
    pushLog("capture", "some html");
    const rows = logFeed.value;
    expect(rows.length).toBe(SEED_LEN + 1);
    const last = rows[rows.length - 1];
    expect(last.kind).toBe("capture");
    expect(last.html).toBe("some html");
    // time format HH:MM
    expect(last.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it("accumulates multiple rows", () => {
    pushLog("a", "1");
    pushLog("b", "2");
    expect(logFeed.value.length).toBe(SEED_LEN + 2);
  });
});

describe("pulsePhase", () => {
  it("sets activePhase to CAPTURE for capture-family skills", () => {
    pulsePhase("capture");
    expect(activePhase.value).toBe("CAPTURE");
    pulsePhase("braindump");
    expect(activePhase.value).toBe("CAPTURE");
    pulsePhase("bookmark");
    expect(activePhase.value).toBe("CAPTURE");
    pulsePhase("summarize");
    expect(activePhase.value).toBe("CAPTURE");
    pulsePhase("reading-notes");
    expect(activePhase.value).toBe("CAPTURE");
  });

  it("sets activePhase to EVOLVE for evolve-family skills", () => {
    pulsePhase("consolidate");
    expect(activePhase.value).toBe("EVOLVE");
    pulsePhase("connect");
    expect(activePhase.value).toBe("EVOLVE");
    pulsePhase("distill");
    expect(activePhase.value).toBe("EVOLVE");
    pulsePhase("moc");
    expect(activePhase.value).toBe("EVOLVE");
    pulsePhase("learn");
    expect(activePhase.value).toBe("EVOLVE");
    pulsePhase("memory-review");
    expect(activePhase.value).toBe("EVOLVE");
    pulsePhase("reorganize");
    expect(activePhase.value).toBe("EVOLVE");
  });

  it("sets activePhase to WRAPUP for wrapup-family skills", () => {
    pulsePhase("wrapup");
    expect(activePhase.value).toBe("WRAPUP");
    pulsePhase("recap");
    expect(activePhase.value).toBe("WRAPUP");
    pulsePhase("weekly");
    expect(activePhase.value).toBe("WRAPUP");
    pulsePhase("daily");
    expect(activePhase.value).toBe("WRAPUP");
  });

  it("is a no-op for an unknown skill name", () => {
    activePhase.value = "EVOLVE";
    pulseSeq.value = 7;
    pulsePhase("unknown-skill");
    // nothing changed
    expect(activePhase.value).toBe("EVOLVE");
    expect(pulseSeq.value).toBe(7);
  });

  it("bumps pulseSeq when motion is enabled (reduceMotion is false in jsdom)", () => {
    // jsdom has no matchMedia → reduceMotion resolves to false → pulseSeq bumps.
    pulseSeq.value = 0;
    pulsePhase("capture");
    expect(pulseSeq.value).toBe(1);
  });
});

describe("skillResult", () => {
  it("returns a known blurb for recognised skill names", () => {
    expect(skillResult("capture")).toContain("saved");
    expect(skillResult("braindump")).toContain("thoughts");
    expect(skillResult("bookmark")).toContain("bookmarked");
    expect(skillResult("summarize")).toContain("summary");
    expect(skillResult("consolidate")).toContain("inbox");
    expect(skillResult("connect")).toContain("wikilinks");
    expect(skillResult("distill")).toContain("synthesized");
    expect(skillResult("moc")).toContain("map");
    expect(skillResult("learn")).toContain("memory");
    expect(skillResult("daily")).toContain("briefing");
    expect(skillResult("weekly")).toContain("week");
    expect(skillResult("research")).toContain("web");
    expect(skillResult("doctor")).toContain("vault");
    expect(skillResult("tasks")).toContain("task");
    expect(skillResult("recap")).toContain("insights");
    expect(skillResult("wrapup")).toContain("session");
  });

  it("falls back to 'done · no changes' for an unrecognised skill", () => {
    expect(skillResult("not-a-real-skill")).toBe("done · no changes");
  });
});

describe("runSkill", () => {
  it("does nothing for an empty name", () => {
    runSkill("");
    expect(logFeed.value.length).toBe(SEED_LEN);
  });

  it("appends executing… immediately, then the result after 720 ms", () => {
    runSkill("capture");
    // immediately: one "run" row appended
    expect(logFeed.value.length).toBe(SEED_LEN + 1);
    const running = logFeed.value[logFeed.value.length - 1];
    expect(running.kind).toBe("run");
    expect(running.html).toContain("executing");

    // after 720 ms: a second "done" row appended
    vi.advanceTimersByTime(720);
    expect(logFeed.value.length).toBe(SEED_LEN + 2);
    const done = logFeed.value[logFeed.value.length - 1];
    expect(done.kind).toBe("done");
    expect(done.html).toContain("capture");
  });

  it("HTML-escapes the skill name to prevent XSS", () => {
    runSkill("<evil>");
    const row = logFeed.value[logFeed.value.length - 1];
    expect(row.html).not.toContain("<evil>");
    expect(row.html).toContain("&lt;evil&gt;");
  });

  it("pulses the phase for the skill on run", () => {
    activePhase.value = "CAPTURE";
    runSkill("wrapup");
    expect(activePhase.value).toBe("WRAPUP");
  });
});
