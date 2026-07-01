// Tests for the qmd Search panel.
// The module-level signal `searchQuery` (from core/stores) is reset in beforeEach.
// The 250ms debounce is handled via real timers + setTimeout(300) in act().
// KEY: the hybrid tier replaces lex results. To observe lex-tier state, the hybrid
// call must never resolve (block on an unresolved Promise).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/preact";
import { searchPanel } from "./search";
import { vaultTree, vaultError, previewPath } from "../bus";
import { searchQuery } from "../../core/stores";

vi.mock("../bus", async (orig) => ({
  ...(await orig<typeof import("../bus")>()),
  initVault: vi.fn(async () => {}),
  allFiles: vi.fn(() => _fakeFiles),
}));

let _fakeFiles: string[] = [];
const Search = searchPanel.Component;

function makeCtx(daemonOverrides: Record<string, unknown> = {}) {
  return {
    daemon: {
      search: vi.fn(async () => []),
      ...daemonOverrides,
    } as any,
    openFile: vi.fn(),
    addPanel: vi.fn(),
  };
}

beforeEach(() => {
  searchQuery.value = "";
  vaultTree.value = null;
  vaultError.value = null;
  previewPath.value = "";
  _fakeFiles = [];
});

// Fire input on the search box and advance past the 250ms debounce.
async function triggerSearch(query: string) {
  fireEvent.input(screen.getByPlaceholderText("search the vault…"), { target: { value: query } });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 300));
  });
}

describe("Search panel — idle / empty state", () => {
  it("renders the panel header", () => {
    render(<Search ctx={makeCtx()} />);
    expect(screen.getByText(/qmd · Search/)).toBeTruthy();
  });

  it("renders the search input", () => {
    render(<Search ctx={makeCtx()} />);
    expect(screen.getByPlaceholderText("search the vault…")).toBeTruthy();
  });

  it("shows vault note count when tree is ready", () => {
    _fakeFiles = ["notes/a.md", "notes/b.md", "notes/c.md"];
    vaultTree.value = [];
    render(<Search ctx={makeCtx()} />);
    expect(screen.getByText(/3.*notes/i)).toBeTruthy();
  });

  it("shows 'loading vault…' when tree is null", () => {
    render(<Search ctx={makeCtx()} />);
    expect(screen.getByText("loading vault…")).toBeTruthy();
  });

  it("shows vault error when vaultError is set", () => {
    vaultError.value = "daemon unreachable";
    render(<Search ctx={makeCtx()} />);
    expect(screen.getByText(/daemon unreachable/)).toBeTruthy();
  });
});

describe("Search panel — typing and clear", () => {
  it("shows clear button while query is non-empty", () => {
    render(<Search ctx={makeCtx()} />);
    fireEvent.input(screen.getByPlaceholderText("search the vault…"), { target: { value: "x" } });
    expect(screen.getByLabelText("Clear search")).toBeTruthy();
  });

  it("hides clear button when query is empty", () => {
    render(<Search ctx={makeCtx()} />);
    expect(screen.queryByLabelText("Clear search")).toBeNull();
  });

  it("clicking clear resets the query signal", async () => {
    render(<Search ctx={makeCtx()} />);
    searchQuery.value = "something";
    const clearBtn = await screen.findByLabelText("Clear search");
    fireEvent.click(clearBtn);
    await waitFor(() => expect(searchQuery.value).toBe(""));
  });
});

describe("Search panel — searching spinner", () => {
  it("shows searching spinner while lex is in flight", async () => {
    const ctx = makeCtx({ search: vi.fn(() => new Promise(() => {})) });
    render(<Search ctx={ctx} />);
    await triggerSearch("hello");
    expect(screen.getByText(/searching…/)).toBeTruthy();
  });
});

describe("Search panel — keyword tier (lex)", () => {
  function makeCtxLexOnly(hits: any[]) {
    // hybrid never resolves so we can observe the lex results
    return makeCtx({
      search: vi.fn(async (_q: string, mode: string) => {
        if (mode === "lex") return hits;
        return new Promise(() => {}); // hybrid never resolves
      }),
    });
  }

  it("shows lex hits while hybrid is in flight", async () => {
    const ctx = makeCtxLexOnly([
      { path: "notes/hello.md", score: 0.9, title: "Hello Note", snippet: "" },
    ]);
    render(<Search ctx={ctx} />);
    await triggerSearch("hello");
    // Hits render even while loading=true (hybrid in-flight); spinner shows alongside hits
    await waitFor(() => expect(screen.getByText("Hello Note")).toBeTruthy(), { timeout: 2000 });
    // Status shows spinner while loading; note renders in body below it
    expect(document.querySelector(".qs-spin")).toBeTruthy();
  });

  it("shows plural result count in status line after all searches complete", async () => {
    // Both lex and hybrid resolve so loading=false and the count label renders
    const ctx = makeCtx({
      search: vi.fn(async (_q: string, mode: string) => {
        if (mode === "lex") return [
          { path: "a.md", score: 0.9, title: "Note A", snippet: "" },
          { path: "b.md", score: 0.7, title: "Note B", snippet: "" },
        ];
        // hybrid returns empty — keyword tier is kept (hybrid threw? no — it returns [])
        // But hybrid returning [] will replace lex hits! Use a throw so lex stays.
        throw new Error("hybrid off");
      }),
    });
    render(<Search ctx={ctx} />);
    await triggerSearch("note");
    // wait for loading=false (hybrid threw → loading set to false in finally)
    await waitFor(() => {
      expect(document.querySelector(".qs-spin")).toBeNull();
    }, { timeout: 2000 });
    await waitFor(() => {
      const status = document.querySelector(".qs-status");
      expect(status?.textContent).toContain("2 results");
    }, { timeout: 2000 });
  });

  it("shows '1 result' (singular) for exactly one hit", async () => {
    const ctx = makeCtx({
      search: vi.fn(async (_q: string, mode: string) => {
        if (mode === "lex") return [{ path: "solo.md", score: 0.95, title: "Solo", snippet: "" }];
        throw new Error("hybrid off");
      }),
    });
    render(<Search ctx={ctx} />);
    await triggerSearch("solo");
    await waitFor(() => {
      expect(document.querySelector(".qs-spin")).toBeNull();
    }, { timeout: 2000 });
    await waitFor(() => {
      const status = document.querySelector(".qs-status");
      expect(status?.textContent).toMatch(/1 result(?!s)/);
    }, { timeout: 2000 });
  });

  it("highlights matched terms in snippets", async () => {
    const ctx = makeCtxLexOnly([
      { path: "a.md", score: 0.8, title: "Doc", snippet: "about hello world" },
    ]);
    render(<Search ctx={ctx} />);
    await triggerSearch("hello");
    await waitFor(() => expect(screen.getByText("Doc")).toBeTruthy(), { timeout: 2000 });
    await waitFor(() => {
      expect(document.querySelectorAll("mark").length).toBeGreaterThan(0);
    }, { timeout: 2000 });
  });
});

describe("Search panel — semantic (hybrid) tier", () => {
  it("upgrades hits when hybrid resolves after lex", async () => {
    let lexResolve!: (v: any) => void;
    let hybResolve!: (v: any) => void;
    const ctx = makeCtx({
      search: vi.fn((_q: string, mode: string) => {
        if (mode === "lex") return new Promise((res) => { lexResolve = res; });
        return new Promise((res) => { hybResolve = res; });
      }),
    });
    render(<Search ctx={ctx} />);
    await triggerSearch("vue");

    await act(async () => {
      lexResolve([{ path: "a.md", score: 0.6, title: "Lex Hit", snippet: "" }]);
      await new Promise((r) => setTimeout(r, 50));
    });
    await waitFor(() => expect(screen.getByText("Lex Hit")).toBeTruthy(), { timeout: 1000 });

    await act(async () => {
      hybResolve([{ path: "b.md", score: 0.95, title: "Semantic Hit", snippet: "" }]);
      await new Promise((r) => setTimeout(r, 50));
    });
    await waitFor(() => expect(screen.getByText("Semantic Hit")).toBeTruthy(), { timeout: 1000 });
    await waitFor(() => expect(screen.queryByText("Lex Hit")).toBeNull(), { timeout: 1000 });
    const status = document.querySelector(".qs-status");
    expect(status?.textContent).toContain("keyword + semantic");
  });

  it("keeps keyword results when hybrid throws (silent fallback)", async () => {
    let hybThrow = false;
    const ctx = makeCtx({
      search: vi.fn(async (_q: string, mode: string) => {
        if (mode === "lex") return [{ path: "a.md", score: 0.7, title: "Lex Only", snippet: "" }];
        // Small delay so lex renders first, then throw
        await new Promise((r) => setTimeout(r, 20));
        hybThrow = true;
        throw new Error("semantic failed");
      }),
    });
    render(<Search ctx={ctx} />);
    await triggerSearch("test");
    await waitFor(() => expect(hybThrow).toBe(true), { timeout: 2000 });
    await waitFor(() => expect(screen.getByText("Lex Only")).toBeTruthy(), { timeout: 2000 });
    const status = document.querySelector(".qs-status");
    expect(status?.textContent).toContain("keyword");
  });
});

describe("Search panel — offline / client-side fallback", () => {
  it("falls back to filename search when lex throws", async () => {
    _fakeFiles = ["vault/my-special-file.md", "vault/other.md"];
    const ctx = makeCtx({
      search: vi.fn(async () => { throw new Error("qmd unavailable"); }),
    });
    render(<Search ctx={ctx} />);
    await triggerSearch("special");
    await waitFor(() => {
      expect(screen.getByText(/my-special-file\.md/)).toBeTruthy();
    }, { timeout: 2000 });
    const status = document.querySelector(".qs-status");
    expect(status?.textContent).toContain("filename match");
  });

  it("uses client-side path for subsequent queries after first failure", async () => {
    _fakeFiles = ["docs/alpha.md", "docs/beta.md"];
    let callCount = 0;
    const ctx = makeCtx({
      search: vi.fn(async () => {
        callCount++;
        throw new Error("offline");
      }),
    });
    render(<Search ctx={ctx} />);
    await triggerSearch("alpha");
    await waitFor(() => expect(screen.getByText(/alpha\.md/)).toBeTruthy(), { timeout: 2000 });
    const callsAfterFirst = callCount;

    // Second search — qmdOff=true so daemon.search is not called again
    searchQuery.value = "";
    await triggerSearch("beta");
    await waitFor(() => expect(screen.getByText(/beta\.md/)).toBeTruthy(), { timeout: 2000 });
    expect(callCount).toBe(callsAfterFirst);
  });

  it("shows 'filename match' label in idle state once qmd is offline", async () => {
    _fakeFiles = ["notes/test-file.md"];
    vaultTree.value = [];
    const ctx = makeCtx({
      search: vi.fn(async () => { throw new Error("qmd offline"); }),
    });
    render(<Search ctx={ctx} />);
    await triggerSearch("test");
    await waitFor(() => expect(screen.getByText(/filename match/)).toBeTruthy(), { timeout: 2000 });
    // Return to idle: clear the query
    fireEvent.input(screen.getByPlaceholderText("search the vault…"), { target: { value: "" } });
    await waitFor(() => {
      // idle body shows "filename match" now that qmdOff=true
      const body = document.querySelector(".qs-empty");
      expect(body?.textContent).toContain("filename match");
    }, { timeout: 2000 });
  });
});

describe("Search panel — no results", () => {
  it("shows 'No matches' when both lex and hybrid return empty", async () => {
    const ctx = makeCtx({ search: vi.fn(async () => []) });
    render(<Search ctx={ctx} />);
    await triggerSearch("zzznomatch");
    await waitFor(() => expect(screen.getByText(/No matches for/)).toBeTruthy(), { timeout: 2000 });
  });
});

describe("Search panel — hit click opens file", () => {
  function makeCtxWithHits(hits: any[]) {
    return makeCtx({
      search: vi.fn(async (_q: string, mode: string) => {
        if (mode === "lex") return hits;
        return new Promise(() => {}); // keep hybrid pending to preserve lex state
      }),
    });
  }

  it("calls ctx.openFile with the resolved path", async () => {
    const ctx = makeCtxWithHits([
      { path: "notes/my-note.md", score: 0.9, title: "My Note", snippet: "" },
    ]);
    render(<Search ctx={ctx} />);
    await triggerSearch("note");
    await waitFor(() => expect(screen.getByText("My Note")).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByText("My Note").closest(".qs-hit")!);
    expect(ctx.openFile).toHaveBeenCalledWith("notes/my-note.md");
  });

  it("resolves slugged path back to real path via realBySlug", async () => {
    _fakeFiles = ["Notes/My Special Note.md"];
    const ctx = makeCtxWithHits([
      { path: "notes/my-special-note.md", score: 0.9, title: "My Special Note", snippet: "" },
    ]);
    render(<Search ctx={ctx} />);
    await triggerSearch("special");
    await waitFor(() => expect(screen.getByText("My Special Note")).toBeTruthy(), { timeout: 2000 });
    fireEvent.click(screen.getByText("My Special Note").closest(".qs-hit")!);
    // Should open the REAL path, not the slug
    expect(ctx.openFile).toHaveBeenCalledWith("Notes/My Special Note.md");
  });

  it("marks the active file's hit with .active class", async () => {
    previewPath.value = "notes/active.md";
    const ctx = makeCtxWithHits([
      { path: "notes/active.md", score: 0.9, title: "Active Note", snippet: "" },
      { path: "notes/other.md", score: 0.7, title: "Other Note", snippet: "" },
    ]);
    render(<Search ctx={ctx} />);
    await triggerSearch("note");
    await waitFor(() => expect(screen.getByText("Active Note")).toBeTruthy(), { timeout: 2000 });
    expect(screen.getByText("Active Note").closest(".qs-hit")?.className).toContain("active");
    expect(screen.getByText("Other Note").closest(".qs-hit")?.className).not.toContain("active");
  });

  it("falls back to path basename when h.title is empty", async () => {
    const ctx = makeCtxWithHits([
      { path: "notes/untitled.md", score: 0.8, title: "", snippet: "" },
    ]);
    render(<Search ctx={ctx} />);
    await triggerSearch("untitled");
    // name = h.title || real.split("/").pop() || real → "untitled.md"
    await waitFor(() => expect(screen.getByText("untitled.md")).toBeTruthy(), { timeout: 2000 });
  });

  it("shows snippet when present", async () => {
    const ctx = makeCtxWithHits([
      { path: "notes/x.md", score: 0.8, title: "Note X", snippet: "some text about things" },
    ]);
    render(<Search ctx={ctx} />);
    await triggerSearch("things");
    await waitFor(() => expect(screen.getByText("Note X")).toBeTruthy(), { timeout: 2000 });
    // Snippet renders; highlight wraps "things" in <mark>
    await waitFor(() => {
      expect(document.querySelector(".qh-snip")).toBeTruthy();
    }, { timeout: 2000 });
  });
});

describe("Search panel — highlight helper", () => {
  function makeCtxWithSnippet(snippet: string) {
    return makeCtx({
      search: vi.fn(async (_q: string, mode: string) => {
        if (mode === "lex") return [{ path: "a.md", score: 0.8, title: "Note", snippet }];
        return new Promise(() => {});
      }),
    });
  }

  it("highlights multi-word query terms", async () => {
    const ctx = makeCtxWithSnippet("React and TypeScript together");
    render(<Search ctx={ctx} />);
    await triggerSearch("react typescript");
    await waitFor(() => expect(screen.getByText("Note")).toBeTruthy(), { timeout: 2000 });
    await waitFor(() => {
      expect(document.querySelectorAll("mark").length).toBe(2);
    }, { timeout: 2000 });
  });

  it("skips single-char terms (too noisy)", async () => {
    const ctx = makeCtxWithSnippet("a short snippet");
    render(<Search ctx={ctx} />);
    await triggerSearch("a");
    await waitFor(() => expect(screen.getByText("Note")).toBeTruthy(), { timeout: 2000 });
    expect(document.querySelectorAll("mark").length).toBe(0);
  });

  it("returns plain text for an empty snippet", async () => {
    const ctx = makeCtxWithSnippet("");
    render(<Search ctx={ctx} />);
    await triggerSearch("hi");
    await waitFor(() => expect(screen.getByText("Note")).toBeTruthy(), { timeout: 2000 });
    // No snippet rendered, no marks
    expect(document.querySelector(".qh-snip")).toBeNull();
  });
});

describe("Search panel — directory display", () => {
  function makeCtxWithPath(path: string, title: string) {
    return makeCtx({
      search: vi.fn(async (_q: string, mode: string) => {
        if (mode === "lex") return [{ path, score: 0.9, title, snippet: "" }];
        return new Promise(() => {});
      }),
    });
  }

  it("shows 'root' for top-level files", async () => {
    const ctx = makeCtxWithPath("root-file.md", "Root File");
    render(<Search ctx={ctx} />);
    await triggerSearch("root");
    await waitFor(() => expect(screen.getByText("Root File")).toBeTruthy(), { timeout: 2000 });
    expect(screen.getByText("root")).toBeTruthy();
  });

  it("shows parent directory path for nested files", async () => {
    const ctx = makeCtxWithPath("01-projects/work/note.md", "Work Note");
    render(<Search ctx={ctx} />);
    await triggerSearch("work");
    await waitFor(() => expect(screen.getByText("Work Note")).toBeTruthy(), { timeout: 2000 });
    expect(screen.getByText("01-projects/work")).toBeTruthy();
  });
});
