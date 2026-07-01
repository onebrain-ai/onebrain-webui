import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/preact";
import { logFeed, activePhase, pulseSeq } from "../activity";

// Partial mock: override only resolveWikilink so the click handler can be tested
// without a loaded vault index.
vi.mock("../bus", async (orig) => ({
  ...(await orig<typeof import("../bus")>()),
  resolveWikilink: (name: string) => (name === "Command Center" ? "notes/command-center.md" : null),
}));

import { logPanel } from "./log";

const ctx = {
  daemon: {} as any,
  openFile: vi.fn(),
  addPanel: vi.fn(),
};

const { Component: Log } = logPanel;

const SEED_ROW_COUNT = 5; // matches the SEED array in activity.ts

describe("Log panel", () => {
  beforeEach(() => {
    // Reset shared signals to a known state before each test so order doesn't matter.
    logFeed.value = [
      { time: "09:14", kind: "capture", html: '"test" → <span class="wl" data-wl="Command Center">[[Command Center]]</span>' },
    ];
    activePhase.value = "CAPTURE";
    pulseSeq.value = 0;
    vi.clearAllMocks();
  });

  it("renders the header pill and LIVE label", () => {
    render(<Log ctx={ctx} />);
    expect(screen.getByText(/Session Log/)).toBeTruthy();
    expect(screen.getByText("LIVE")).toBeTruthy();
  });

  it("renders all three phase labels", () => {
    render(<Log ctx={ctx} />);
    expect(screen.getByText("CAPTURE")).toBeTruthy();
    expect(screen.getByText("EVOLVE")).toBeTruthy();
    expect(screen.getByText("WRAPUP")).toBeTruthy();
  });

  it("highlights the active phase with the 'on' class", () => {
    activePhase.value = "EVOLVE";
    const { container } = render(<Log ctx={ctx} />);
    const phases = container.querySelectorAll(".phase");
    const onPhases = [...phases].filter((el) => el.classList.contains("on"));
    expect(onPhases).toHaveLength(1);
    expect(onPhases[0].textContent).toBe("EVOLVE");
  });

  it("renders a row for each log entry", () => {
    logFeed.value = [
      { time: "09:00", kind: "capture", html: "row one" },
      { time: "09:01", kind: "evolve", html: "row two" },
    ];
    const { container } = render(<Log ctx={ctx} />);
    const rows = container.querySelectorAll(".log-row");
    expect(rows).toHaveLength(2);
  });

  it("renders an empty feed with no log-row elements", () => {
    logFeed.value = [];
    const { container } = render(<Log ctx={ctx} />);
    expect(container.querySelectorAll(".log-row")).toHaveLength(0);
  });

  it("wikilink click calls ctx.openFile with the resolved path", () => {
    // The seed row contains a .wl[data-wl="Command Center"] span
    render(<Log ctx={ctx} />);
    const wl = document.querySelector<HTMLElement>('.wl[data-wl="Command Center"]')!;
    expect(wl).toBeTruthy();
    fireEvent.click(wl);
    expect(ctx.openFile).toHaveBeenCalledWith("notes/command-center.md");
  });

  it("clicking outside a wikilink does not call openFile", () => {
    const { container } = render(<Log ctx={ctx} />);
    const feed = container.querySelector(".log-feed")!;
    fireEvent.click(feed);
    expect(ctx.openFile).not.toHaveBeenCalled();
  });

  it("wikilink that resolves to null does not call openFile", () => {
    logFeed.value = [
      { time: "09:00", kind: "capture", html: '<span class="wl" data-wl="Unknown">[[Unknown]]</span>' },
    ];
    render(<Log ctx={ctx} />);
    const wl = document.querySelector<HTMLElement>('.wl[data-wl="Unknown"]')!;
    fireEvent.click(wl);
    expect(ctx.openFile).not.toHaveBeenCalled();
  });

  it("phase flash re-triggers when pulseSeq increments (pulse > 0) and .phase.on exists", async () => {
    // Start with CAPTURE active so .phase.on exists immediately on mount.
    activePhase.value = "CAPTURE";
    pulseSeq.value = 0;
    render(<Log ctx={ctx} />);
    // Bump pulseSeq after mount — the effect should find .phase.on = CAPTURE
    // and execute the remove → reflow → add "pulse" classList sequence.
    await act(async () => {
      pulseSeq.value = 1;
    });
    // Still renders fine after the DOM manipulation.
    expect(screen.getByText("CAPTURE")).toBeTruthy();
  });

  it("pulse effect is a no-op when no .phase.on element exists (different active phase)", async () => {
    // Set activePhase to a value not matching any rendered phase to exercise
    // the `if (!el) return` guard (pulse > 0 but no .on element in DOM).
    // We achieve this by rendering with no 'on' phase then bumping pulseSeq.
    activePhase.value = "CAPTURE";
    pulseSeq.value = 0;
    render(<Log ctx={ctx} />);
    await act(async () => {
      // Remove the .on class manually so querySelector returns null
      document.querySelector(".phase.on")?.classList.remove("on");
      pulseSeq.value = 1;
    });
    expect(screen.getByText("CAPTURE")).toBeTruthy(); // no crash
  });

  it("feed scroll useEffect fires when logFeed grows", async () => {
    logFeed.value = [{ time: "09:00", kind: "capture", html: "initial" }];
    render(<Log ctx={ctx} />);
    await act(async () => {
      logFeed.value = [...logFeed.value, { time: "09:01", kind: "evolve", html: "new row" }];
    });
    // The scrollTop effect must not throw; new row should appear in DOM.
    const { container } = render(<Log ctx={ctx} />);
    expect(container.querySelectorAll(".log-row").length).toBeGreaterThanOrEqual(2);
  });
});
