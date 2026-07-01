import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/preact";
import { vaultTree, vaultError, vaultConfig } from "../bus";
import { tasks } from "../tasks-store";
import { statusPanel } from "./status";

// bus.allFiles() reads a module-level array populated by initVault. We mock the
// entire bus so we can control the file list without running a real daemon.
vi.mock("../bus", async (orig) => {
  const actual = await orig<typeof import("../bus")>();
  return {
    ...actual,
    allFiles: () => _mockFiles,
  };
});

// Module-level array driven per-test via the helper below.
let _mockFiles: string[] = [];
function setFiles(files: string[]) {
  _mockFiles = files;
}

const { Component: Status } = statusPanel;

// Status takes no props (no ctx)
function renderStatus() {
  return render(<Status ctx={{} as any} />);
}

describe("Status panel — daemon offline / loading", () => {
  beforeEach(() => {
    vaultTree.value = null;
    vaultError.value = null;
    vaultConfig.value = null;
    tasks.value = [];
    setFiles([]);
  });

  it("shows Connecting when vaultTree is null and no error", () => {
    render(<Status ctx={{} as any} />);
    expect(screen.getByText(/Connecting/)).toBeTruthy();
  });

  it("shows OFFLINE em when vaultError is set", () => {
    vaultError.value = "connection refused";
    render(<Status ctx={{} as any} />);
    expect(screen.getByText("OFFLINE")).toBeTruthy();
  });

  it("shows ellipsis when vault is not ready and no error", () => {
    const { container } = render(<Status ctx={{} as any} />);
    // The DAEMON line shows "…" while loading
    expect(container.textContent).toContain("…");
  });
});

describe("Status panel — vault online, no files", () => {
  beforeEach(() => {
    vaultTree.value = []; // non-null → ready
    vaultError.value = null;
    vaultConfig.value = null;
    tasks.value = [];
    setFiles([]);
  });

  it("shows Online and ONLINE in the header and daemon row", () => {
    renderStatus();
    expect(screen.getByText(/Online/)).toBeTruthy();
    expect(screen.getByText("ONLINE")).toBeTruthy();
  });

  it("shows 0 notes, 0 memory, 0 sessions, 0 due, 0 inbox", () => {
    const { container } = renderStatus();
    // The VAULT stat-line renders ":: SYNCED · 0 notes" split across text nodes
    expect(container.textContent).toContain("SYNCED");
    // metric values should all be 0
    const vals = [...container.querySelectorAll(".m-val")].map((el) => el.textContent);
    expect(vals).toEqual(["0", "0", "0"]);
  });

  it("does NOT render the area chart when all counts are 0", () => {
    const { container } = renderStatus();
    expect(container.querySelector(".st-chart")).toBeNull();
  });
});

describe("Status panel — vault online, with files", () => {
  beforeEach(() => {
    vaultTree.value = [];
    vaultError.value = null;
    vaultConfig.value = null;
    tasks.value = [];
  });

  it("counts total notes correctly", () => {
    setFiles([
      "00-inbox/note1.md",
      "00-inbox/note2.md",
      "01-projects/proj.md",
      "01-projects/image.png", // not .md, not counted
    ]);
    renderStatus();
    // notes = 3 (the .md files)
    expect(screen.getAllByText("3").length).toBeGreaterThanOrEqual(1);
  });

  it("counts inbox notes (default folder 00-inbox)", () => {
    setFiles([
      "00-inbox/a.md",
      "00-inbox/b.md",
      "01-projects/c.md",
    ]);
    const { container } = renderStatus();
    // inbox = 2; the metric labels it "inbox"
    const inboxMetric = [...container.querySelectorAll(".metric")].find(
      (m) => m.querySelector(".m-lab")?.textContent === "inbox",
    );
    expect(inboxMetric?.querySelector(".m-val")?.textContent).toBe("2");
  });

  it("counts memory notes under 05-agent/memory/", () => {
    setFiles([
      "05-agent/memory/fact1.md",
      "05-agent/memory/fact2.md",
      "05-agent/other.md", // not in memory/
    ]);
    renderStatus();
    // "memory" stat-line shows 2 notes
    const memRow = screen.getByText("MEMORY").closest("li")!;
    expect(memRow.textContent).toContain("2");
  });

  it("counts session logs under 07-logs/session/", () => {
    setFiles([
      "07-logs/session/s1.md",
      "07-logs/session/s2.md",
      "07-logs/journal.md", // not a session log
    ]);
    renderStatus();
    const sessRow = screen.getByText("SESSIONS").closest("li")!;
    expect(sessRow.textContent).toContain("2");
  });

  it("renders the area chart when at least one PARA area has notes", () => {
    setFiles([
      "01-projects/proj.md",
      "03-knowledge/kb.md",
    ]);
    const { container } = renderStatus();
    expect(container.querySelector(".st-chart")).toBeTruthy();
    expect(screen.getByText("Notes by area")).toBeTruthy();
  });

  it("renders bars sorted descending by count", () => {
    setFiles([
      "01-projects/a.md",
      "01-projects/b.md",
      "03-knowledge/c.md",
    ]);
    const { container } = renderStatus();
    const bars = container.querySelectorAll(".st-bar-row");
    // First bar should be "projects" (2) before "knowledge" (1)
    expect(bars[0].querySelector(".st-bar-lab")?.textContent).toBe("projects");
    expect(bars[1].querySelector(".st-bar-lab")?.textContent).toBe("knowledge");
  });

  it("uses custom folder names from vaultConfig", () => {
    vaultConfig.value = {
      folders: {
        inbox: "inbox",
        agent: "agent",
        logs: "logs",
      },
    } as any;
    setFiles([
      "inbox/a.md",
      "inbox/b.md",
      "agent/memory/f.md",
      "logs/session/s.md",
    ]);
    renderStatus();
    // inbox should be 2 using the overridden folder name
    const { container } = render(<Status ctx={{} as any} />);
    const inboxMetric = [...container.querySelectorAll(".metric")].find(
      (m) => m.querySelector(".m-lab")?.textContent === "inbox",
    );
    expect(inboxMetric?.querySelector(".m-val")?.textContent).toBe("2");
  });

  it("due count from dueCount signal appears in the metric row", () => {
    // Use a past date task so it's overdue
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yStr = yesterday.toISOString().slice(0, 10);
    tasks.value = [{ file: "note.md", line: 1, text: "a task", done: false, due: yStr }];
    setFiles([]);
    const { container } = renderStatus();
    const dueMetric = [...container.querySelectorAll(".metric")].find(
      (m) => m.querySelector(".m-lab")?.textContent === "due",
    );
    expect(dueMetric?.querySelector(".m-val")?.textContent).toBe("1");
  });
});
