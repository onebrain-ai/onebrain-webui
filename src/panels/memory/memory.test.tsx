// Tests for the Memory panel.
// The module-level signals (entries, loading, error, query, selectedType) are
// private to memory.tsx. We use vi.isolateModules + dynamic import per describe
// block to guarantee a clean signal state between groups. Within a group,
// tests that mutate signals (typing in search, clicking type filter) explicitly
// clean up via the reload button or by unmounting between subtests.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/preact";

// These signals are imported from the real bus (not mocked away).
import { vaultTree, vaultConfig } from "../bus";

// Hoisted mutable so the factory closure can read the current value.
let _fakeFiles: string[] = [];

vi.mock("../bus", async (orig) => ({
  ...(await orig<typeof import("../bus")>()),
  initVault: vi.fn(async () => {}),
  allFiles: vi.fn(() => _fakeFiles),
}));

function makeCtx(daemonOverrides: Record<string, unknown> = {}) {
  return {
    daemon: {
      file: vi.fn(async (path: string) => ({ path, content: "", rev: "1" })),
      ...daemonOverrides,
    } as any,
    openFile: vi.fn(),
    addPanel: vi.fn(),
  };
}

function memNote(opts: {
  type?: string;
  status?: string;
  title?: string;
  topics?: string[];
  snippet?: string;
  updated?: string;
}) {
  const fm = [
    `type: ${opts.type ?? "behavioral"}`,
    opts.status ? `status: ${opts.status}` : null,
    opts.topics?.length ? `topics:\n${opts.topics.map((t) => `  - ${t}`).join("\n")}` : null,
    `updated: ${opts.updated ?? "2026-01-01"}`,
  ]
    .filter(Boolean)
    .join("\n");
  const body = opts.title ? `# ${opts.title}\n\n${opts.snippet ?? ""}` : opts.snippet ?? "";
  return `---\n${fm}\n---\n${body}`;
}

beforeEach(() => {
  _fakeFiles = [];
  vaultTree.value = null;
  vaultConfig.value = null;
  vi.resetModules();
});

// Fresh module import so the private signals start clean.
async function freshMemory() {
  // Re-mock after reset — vi.mock is hoisted but vi.resetModules() clears the
  // module registry; subsequent dynamic imports get a fresh module instance with
  // pristine signal values. The static import at the top (for bus signals) still
  // works because it was resolved before resetModules().
  const mod = await import("./memory");
  return mod.memoryPanel.Component;
}

describe("Memory panel — null / loading state", () => {
  it("shows '—' when vault tree is null", async () => {
    const Memory = await freshMemory();
    vaultTree.value = null;
    render(<Memory ctx={makeCtx()} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("shows 'No memory facts yet.' for an empty memory folder", async () => {
    const Memory = await freshMemory();
    _fakeFiles = [];
    vaultTree.value = [];
    render(<Memory ctx={makeCtx()} />);
    await waitFor(() => expect(screen.getByText("No memory facts yet.")).toBeTruthy());
    expect(screen.getByText("0 FACTS")).toBeTruthy();
  });
});

describe("Memory panel — populated state", () => {
  it("renders active memory entries grouped by type", async () => {
    const Memory = await freshMemory();
    _fakeFiles = ["05-agent/memory/pref-concise.md", "05-agent/memory/dev-style.md"];
    const ctx = makeCtx({
      file: vi.fn(async (path: string) => {
        if (path.includes("pref-concise")) {
          return { path, content: memNote({ type: "behavioral", title: "Be Concise" }), rev: "1" };
        }
        return { path, content: memNote({ type: "dev", title: "Dev Style" }), rev: "1" };
      }),
    });
    vaultTree.value = [];
    render(<Memory ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Be Concise")).toBeTruthy());
    expect(screen.getByText("Dev Style")).toBeTruthy();
    expect(screen.getByText("2 FACTS")).toBeTruthy();
  });

  it("renders inactive entries under Archived·Replaced", async () => {
    const Memory = await freshMemory();
    _fakeFiles = ["05-agent/memory/old-rule.md"];
    const ctx = makeCtx({
      file: vi.fn(async (path: string) => ({
        path,
        content: memNote({ type: "behavioral", title: "Old Rule", status: "expired" }),
        rev: "1",
      })),
    });
    vaultTree.value = [];
    render(<Memory ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Old Rule")).toBeTruthy());
    expect(screen.getByText("Archived · Replaced")).toBeTruthy();
  });

  it("recognises all INACTIVE_RE status patterns", async () => {
    for (const status of ["replaced", "superseded", "archived", "deprecated", "stale", "retired", "obsolete", "inactive"]) {
      vi.resetModules();
      const Memory = await freshMemory();
      _fakeFiles = [`05-agent/memory/mem-${status}.md`];
      const ctx = makeCtx({
        file: vi.fn(async (path: string) => ({
          path,
          content: memNote({ type: "behavioral", title: `Rule ${status}`, status }),
          rev: "1",
        })),
      });
      vaultTree.value = null;
      const { unmount } = render(<Memory ctx={ctx} />);
      vaultTree.value = [];
      await waitFor(() => expect(screen.getByText(`Rule ${status}`)).toBeTruthy());
      expect(screen.getByText("Archived · Replaced")).toBeTruthy();
      unmount();
      vaultTree.value = null;
    }
  });

  it("humanizes filename when no H1 heading", async () => {
    const Memory = await freshMemory();
    _fakeFiles = ["05-agent/memory/my-cool-fact.md"];
    const ctx = makeCtx({
      file: vi.fn(async (path: string) => ({
        path,
        content: memNote({ type: "other", snippet: "just a snippet" }),
        rev: "1",
      })),
    });
    vaultTree.value = [];
    render(<Memory ctx={ctx} />);
    // humanize("my-cool-fact.md") → "My Cool Fact"
    await waitFor(() => expect(screen.getByText("My Cool Fact")).toBeTruthy());
  });

  it("maps unknown type to 'other'", async () => {
    const Memory = await freshMemory();
    _fakeFiles = ["05-agent/memory/fact.md"];
    const ctx = makeCtx({
      file: vi.fn(async (path: string) => ({
        path,
        content: memNote({ type: "unknown-type", title: "Misc Fact" }),
        rev: "1",
      })),
    });
    vaultTree.value = [];
    render(<Memory ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Misc Fact")).toBeTruthy());
    expect(screen.getAllByText("Other").length).toBeGreaterThan(0);
  });

  it("silently skips files that fail to load (null filter)", async () => {
    const Memory = await freshMemory();
    _fakeFiles = ["05-agent/memory/good.md", "05-agent/memory/bad.md"];
    const ctx = makeCtx({
      file: vi.fn(async (path: string) => {
        if (path.includes("bad")) throw new Error("read error");
        return { path, content: memNote({ type: "behavioral", title: "Good Fact" }), rev: "1" };
      }),
    });
    vaultTree.value = [];
    render(<Memory ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Good Fact")).toBeTruthy());
    expect(screen.getByText("1 FACTS")).toBeTruthy();
  });

  it("excludes memory.md itself (endsWith guard)", async () => {
    const Memory = await freshMemory();
    _fakeFiles = ["05-agent/memory/memory.md", "05-agent/memory/fact.md"];
    const ctx = makeCtx({
      file: vi.fn(async (path: string) => ({
        path,
        content: memNote({ type: "context", title: "Context Fact" }),
        rev: "1",
      })),
    });
    vaultTree.value = [];
    render(<Memory ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Context Fact")).toBeTruthy());
    expect(screen.getByText("1 FACTS")).toBeTruthy();
  });

  it("uses custom agent folder from vaultConfig", async () => {
    const Memory = await freshMemory();
    vaultConfig.value = { folders: { agent: "99-agent" } } as any;
    _fakeFiles = ["99-agent/memory/custom-fact.md"];
    const ctx = makeCtx({
      file: vi.fn(async (path: string) => ({
        path,
        content: memNote({ type: "project", title: "Custom Fact" }),
        rev: "1",
      })),
    });
    vaultTree.value = [];
    render(<Memory ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Custom Fact")).toBeTruthy());
  });

  it("renders snippet below title", async () => {
    const Memory = await freshMemory();
    _fakeFiles = ["05-agent/memory/with-snip.md"];
    const ctx = makeCtx({
      file: vi.fn(async (path: string) => ({
        path,
        content: memNote({ type: "behavioral", title: "Titled Note", snippet: "This is a snippet" }),
        rev: "1",
      })),
    });
    vaultTree.value = [];
    render(<Memory ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("This is a snippet")).toBeTruthy());
  });

  it("renders inactive items with is-inactive class", async () => {
    const Memory = await freshMemory();
    _fakeFiles = ["05-agent/memory/stale.md"];
    const ctx = makeCtx({
      file: vi.fn(async (path: string) => ({
        path,
        content: memNote({ type: "behavioral", title: "Stale Rule", status: "stale" }),
        rev: "1",
      })),
    });
    vaultTree.value = [];
    const { container } = render(<Memory ctx={ctx} />);
    await waitFor(() => expect(container.querySelector(".mem-item.is-inactive")).toBeTruthy());
  });

  it("sorts active entries by updated date newest-first", async () => {
    const Memory = await freshMemory();
    _fakeFiles = ["05-agent/memory/a.md", "05-agent/memory/b.md"];
    const ctx = makeCtx({
      file: vi.fn(async (path: string) => {
        if (path.endsWith("a.md")) {
          return { path, content: memNote({ type: "behavioral", title: "Older", updated: "2024-01-01" }), rev: "1" };
        }
        return { path, content: memNote({ type: "behavioral", title: "Newer", updated: "2025-06-01" }), rev: "1" };
      }),
    });
    vaultTree.value = [];
    const { container } = render(<Memory ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Newer")).toBeTruthy());
    const titles = Array.from(container.querySelectorAll(".mem-item-title")).map((el) => el.textContent);
    expect(titles[0]).toBe("Newer");
    expect(titles[1]).toBe("Older");
  });
});

describe("Memory panel — search filter", () => {
  it("filters entries by title", async () => {
    const Memory = await freshMemory();
    _fakeFiles = ["05-agent/memory/alpha.md", "05-agent/memory/beta.md"];
    const ctx = makeCtx({
      file: vi.fn(async (path: string) => {
        if (path.includes("alpha")) {
          return { path, content: memNote({ type: "behavioral", title: "Alpha Rule" }), rev: "1" };
        }
        return { path, content: memNote({ type: "dev", title: "Beta Rule" }), rev: "1" };
      }),
    });
    vaultTree.value = [];
    render(<Memory ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Alpha Rule")).toBeTruthy());
    fireEvent.input(screen.getByPlaceholderText("Search memory…"), { target: { value: "alpha" } });
    await waitFor(() => expect(screen.queryByText("Beta Rule")).toBeNull());
  });

  it("filters entries by snippet", async () => {
    const Memory = await freshMemory();
    _fakeFiles = ["05-agent/memory/alpha.md", "05-agent/memory/beta.md"];
    const ctx = makeCtx({
      file: vi.fn(async (path: string) => {
        if (path.includes("alpha")) {
          return { path, content: memNote({ type: "behavioral", title: "Alpha Rule", snippet: "detail about thing" }), rev: "1" };
        }
        return { path, content: memNote({ type: "dev", title: "Beta Rule" }), rev: "1" };
      }),
    });
    vaultTree.value = [];
    render(<Memory ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Alpha Rule")).toBeTruthy());
    fireEvent.input(screen.getByPlaceholderText("Search memory…"), { target: { value: "detail" } });
    await waitFor(() => expect(screen.queryByText("Beta Rule")).toBeNull());
  });

  it("filters entries by topic", async () => {
    const Memory = await freshMemory();
    _fakeFiles = ["05-agent/memory/alpha.md", "05-agent/memory/beta.md"];
    const ctx = makeCtx({
      file: vi.fn(async (path: string) => {
        if (path.includes("alpha")) {
          return { path, content: memNote({ type: "behavioral", title: "Alpha Rule" }), rev: "1" };
        }
        return { path, content: memNote({ type: "dev", title: "Beta Rule", topics: ["typescript"] }), rev: "1" };
      }),
    });
    vaultTree.value = [];
    render(<Memory ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Beta Rule")).toBeTruthy());
    fireEvent.input(screen.getByPlaceholderText("Search memory…"), { target: { value: "typescript" } });
    await waitFor(() => expect(screen.queryByText("Alpha Rule")).toBeNull());
  });

  it("shows 'No matches.' when query matches nothing", async () => {
    const Memory = await freshMemory();
    _fakeFiles = ["05-agent/memory/alpha.md"];
    const ctx = makeCtx({
      file: vi.fn(async (path: string) => ({
        path,
        content: memNote({ type: "behavioral", title: "Alpha Rule" }),
        rev: "1",
      })),
    });
    vaultTree.value = [];
    render(<Memory ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Alpha Rule")).toBeTruthy());
    fireEvent.input(screen.getByPlaceholderText("Search memory…"), { target: { value: "xyzzy-no-match" } });
    await waitFor(() => expect(screen.getByText("No matches.")).toBeTruthy());
  });

  it("clear-search button clears the query", async () => {
    const Memory = await freshMemory();
    _fakeFiles = ["05-agent/memory/alpha.md", "05-agent/memory/beta.md"];
    const ctx = makeCtx({
      file: vi.fn(async (path: string) => {
        if (path.includes("alpha")) return { path, content: memNote({ type: "behavioral", title: "Alpha Rule" }), rev: "1" };
        return { path, content: memNote({ type: "dev", title: "Beta Rule" }), rev: "1" };
      }),
    });
    vaultTree.value = [];
    render(<Memory ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Alpha Rule")).toBeTruthy());
    fireEvent.input(screen.getByPlaceholderText("Search memory…"), { target: { value: "alpha" } });
    const clearBtn = await screen.findByLabelText("Clear");
    fireEvent.click(clearBtn);
    await waitFor(() => expect(screen.queryByLabelText("Clear")).toBeNull());
    expect(screen.getByText("Beta Rule")).toBeTruthy();
  });
});

describe("Memory panel — chart type filter", () => {
  it("clicking a type bar filters; clear button shows all again", async () => {
    const Memory = await freshMemory();
    _fakeFiles = ["05-agent/memory/a.md", "05-agent/memory/b.md"];
    const ctx = makeCtx({
      file: vi.fn(async (path: string) => {
        if (path.endsWith("a.md")) {
          return { path, content: memNote({ type: "behavioral", title: "Behavioral Fact" }), rev: "1" };
        }
        return { path, content: memNote({ type: "dev", title: "Dev Fact" }), rev: "1" };
      }),
    });
    vaultTree.value = [];
    render(<Memory ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Behavioral Fact")).toBeTruthy());

    const barBtn = screen.getAllByRole("button").find((b) =>
      b.className.includes("mem-bar-row") && b.textContent?.includes("Behavioral")
    )!;
    fireEvent.click(barBtn);
    await waitFor(() => expect(screen.queryByText("Dev Fact")).toBeNull());

    fireEvent.click(screen.getByText("clear filter"));
    await waitFor(() => expect(screen.getByText("Dev Fact")).toBeTruthy());
  });

  it("clicking the same bar again deselects (toggle off)", async () => {
    const Memory = await freshMemory();
    _fakeFiles = ["05-agent/memory/x.md"];
    const ctx = makeCtx({
      file: vi.fn(async (path: string) => ({
        path,
        content: memNote({ type: "context", title: "Context Fact" }),
        rev: "1",
      })),
    });
    vaultTree.value = [];
    render(<Memory ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Context Fact")).toBeTruthy());

    const barBtn = screen.getAllByRole("button").find((b) =>
      b.className.includes("mem-bar-row") && b.textContent?.includes("Context")
    )!;
    fireEvent.click(barBtn); // select
    fireEvent.click(barBtn); // deselect
    await waitFor(() => expect(screen.queryByText("clear filter")).toBeNull());
    expect(screen.getByText("Context Fact")).toBeTruthy();
  });
});

describe("Memory panel — reload", () => {
  it("reload button triggers a fresh file fetch", async () => {
    const Memory = await freshMemory();
    _fakeFiles = ["05-agent/memory/fact.md"];
    const fileFn = vi.fn(async (path: string) => ({
      path,
      content: memNote({ type: "behavioral", title: "My Fact" }),
      rev: "1",
    }));
    vaultTree.value = [];
    render(<Memory ctx={makeCtx({ file: fileFn })} />);
    await waitFor(() => expect(screen.getByText("My Fact")).toBeTruthy());

    const callsBefore = fileFn.mock.calls.length;
    fireEvent.click(screen.getByLabelText("Reload memory"));
    await waitFor(() => expect(fileFn.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("rapid reload clicks while loading don't double-fetch (loading guard)", async () => {
    const Memory = await freshMemory();
    _fakeFiles = ["05-agent/memory/fact.md"];
    let resolveFile!: (v: any) => void;
    const ctx = makeCtx({
      file: vi.fn(() => new Promise((res) => { resolveFile = res; })),
    });
    vaultTree.value = [];
    render(<Memory ctx={ctx} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Reload memory"));
      fireEvent.click(screen.getByLabelText("Reload memory"));
    });
    resolveFile({ path: "fact.md", content: memNote({ type: "behavioral", title: "Slow Fact" }), rev: "1" });
    await waitFor(() => expect(screen.getByText("Slow Fact")).toBeTruthy());
  });
});

describe("Memory panel — load error state", () => {
  it("shows an error message when allFiles throws inside load() (outer catch)", async () => {
    const busMod = await import("../bus");
    const allFilesMock = busMod.allFiles as ReturnType<typeof vi.fn>;
    // allFiles is called twice: once during render (memSig calc) and once inside load().
    // We let the first call (render) succeed so the component mounts, then throw on the
    // second call (inside load()) to trigger the outer catch in load().
    let callCount = 0;
    allFilesMock.mockImplementation(() => {
      callCount++;
      if (callCount === 2) throw new Error("vault index broken");
      return [];
    });

    const Memory = await freshMemory();
    vaultTree.value = [];
    render(<Memory ctx={makeCtx()} />);
    // The outer catch sets error.value = "vault index broken" and entries.value = [].
    // With list != null and error set, the error branch renders.
    await waitFor(() => {
      expect(screen.getByText("vault index broken")).toBeTruthy();
    });
    // Restore so subsequent tests get the normal mock
    allFilesMock.mockImplementation(() => _fakeFiles);
  });
});

describe("Memory panel — clicking an entry", () => {
  it("clicking an item button does not throw", async () => {
    const Memory = await freshMemory();
    _fakeFiles = ["05-agent/memory/fact.md"];
    const ctx = makeCtx({
      file: vi.fn(async (path: string) => ({
        path,
        content: memNote({ type: "behavioral", title: "Click Me" }),
        rev: "1",
      })),
    });
    vaultTree.value = [];
    render(<Memory ctx={ctx} />);
    await waitFor(() => expect(screen.getByText("Click Me")).toBeTruthy());
    expect(() => fireEvent.click(screen.getByText("Click Me"))).not.toThrow();
  });
});
