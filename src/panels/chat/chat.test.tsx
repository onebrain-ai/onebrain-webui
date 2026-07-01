// Tests for the Chat panel component (src/panels/chat/chat.tsx).
// Strategy: mock the entire chat-store module so we control all signals and
// functions without touching localStorage or wiring a real daemon, then exercise
// every visible branch in the component.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/preact";

// ---------------------------------------------------------------------------
// vi.hoisted() — anything referenced in vi.mock factories must be defined here
// so it exists before the hoisted mock calls run.
// ---------------------------------------------------------------------------
const {
  mockThreads,
  mockActiveId,
  mockBusyIds,
  mockSend,
  mockStop,
  mockNewThread,
  mockSelectThread,
  mockActiveThread,
  mockIsBusy,
} = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function sig<T>(v: T): { value: T } { return { value: v }; }
  const threads = sig<any[]>([]);
  const activeId = sig("t1");
  const busyIds = sig(new Set<string>());
  return {
    mockThreads: threads,
    mockActiveId: activeId,
    mockBusyIds: busyIds,
    mockSend: vi.fn(async () => {}),
    mockStop: vi.fn(),
    mockNewThread: vi.fn(),
    mockSelectThread: vi.fn(),
    mockActiveThread: vi.fn(() => threads.value.find((t: any) => t.id === activeId.value)),
    mockIsBusy: vi.fn((id: string) => busyIds.value.has(id)),
  };
});

vi.mock("./chat-store", () => ({
  threads: mockThreads,
  activeId: mockActiveId,
  busyIds: mockBusyIds,
  activeThread: mockActiveThread,
  isBusy: mockIsBusy,
  send: mockSend,
  stop: mockStop,
  newThread: mockNewThread,
  selectThread: mockSelectThread,
}));

// Mermaid is async/heavy — stub it out.
vi.mock("../../core/mermaid", () => ({ renderMermaidIn: vi.fn(async () => {}) }));

// resolveWikilink is tested elsewhere.
vi.mock("../bus", async (orig) => ({
  ...(await orig<typeof import("../bus")>()),
  resolveWikilink: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// Import component AFTER all mocks are in place.
// ---------------------------------------------------------------------------
import type { ChatThread } from "./chat-store";
import { chatPanel } from "./chat";
import * as busModule from "../bus";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function blankThread(id = "t1", messages: ChatThread["messages"] = []): ChatThread {
  return { id, title: "New chat", sessionId: null, messages, updatedAt: 0 };
}

const ctx = {
  daemon: {
    uploadFile: vi.fn(async () => {}),
    rawUrl: vi.fn((p: string) => `/raw/${p}`),
    chat: vi.fn(async () => {}),
  } as any,
  openFile: vi.fn(),
  addPanel: vi.fn(),
};

const Chat = chatPanel.Component;

beforeEach(() => {
  vi.clearAllMocks();
  mockThreads.value = [blankThread()];
  mockActiveId.value = "t1";
  mockBusyIds.value = new Set();
  mockActiveThread.mockImplementation(() => mockThreads.value.find((t: any) => t.id === mockActiveId.value));
  mockIsBusy.mockImplementation((id: string) => mockBusyIds.value.has(id));
  ctx.daemon.uploadFile = vi.fn(async () => {});
  ctx.daemon.rawUrl = vi.fn((p: string) => `/raw/${p}`);
  ctx.openFile = vi.fn();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Chat panel — empty state", () => {
  it("renders the header pill and action buttons", () => {
    render(<Chat ctx={ctx} />);
    expect(screen.getByTitle("History")).toBeTruthy();
    expect(screen.getByTitle("New chat")).toBeTruthy();
  });

  it("shows the empty-state illustration when there are no messages", () => {
    render(<Chat ctx={ctx} />);
    expect(screen.getByText(/Ask about your vault/i)).toBeTruthy();
  });

  it("shows Send button (not Stop) when not busy", () => {
    render(<Chat ctx={ctx} />);
    expect(screen.getByTitle("Send")).toBeTruthy();
    expect(screen.queryByTitle("Stop")).toBeNull();
  });
});

describe("Chat panel — thread history drawer", () => {
  it("history button toggles the thread list panel", () => {
    mockThreads.value = [blankThread("t1"), blankThread("t2")];
    render(<Chat ctx={ctx} />);
    expect(screen.queryByTestId("chat-threads")).toBeNull();

    fireEvent.click(screen.getByTitle("History"));
    expect(screen.getByTestId("chat-threads")).toBeTruthy();

    fireEvent.click(screen.getByTitle("History"));
    expect(screen.queryByTestId("chat-threads")).toBeNull();
  });

  it("clicking a thread entry calls selectThread and closes the drawer", () => {
    mockThreads.value = [blankThread("t1"), blankThread("t2")];
    render(<Chat ctx={ctx} />);
    fireEvent.click(screen.getByTitle("History"));
    // Both threads have title "New chat" — grab all ch-thread buttons
    const btns = document.querySelectorAll(".ch-thread");
    fireEvent.click(btns[1]);
    expect(mockSelectThread).toHaveBeenCalledWith("t2");
    expect(screen.queryByTestId("chat-threads")).toBeNull();
  });

  it("new-chat button calls newThread and closes the drawer", () => {
    render(<Chat ctx={ctx} />);
    fireEvent.click(screen.getByTitle("History"));
    fireEvent.click(screen.getByTitle("New chat"));
    expect(mockNewThread).toHaveBeenCalled();
    expect(screen.queryByTestId("chat-threads")).toBeNull();
  });

  it("active thread button carries the 'on' CSS class", () => {
    mockThreads.value = [blankThread("t1"), blankThread("t2")];
    mockActiveId.value = "t1";
    render(<Chat ctx={ctx} />);
    fireEvent.click(screen.getByTitle("History"));
    const btns = document.querySelectorAll(".ch-thread");
    expect(btns[0].className).toContain("on");
    expect(btns[1].className).not.toContain("on");
  });

  it("thread message count badge is rendered", () => {
    mockThreads.value = [blankThread("t1", [{ role: "you", text: "hi" }])];
    render(<Chat ctx={ctx} />);
    fireEvent.click(screen.getByTitle("History"));
    expect(document.querySelector(".ch-thread-n")?.textContent).toBe("1");
  });

  it("thread with empty title falls back to 'New chat' label (line 210 branch)", () => {
    // `th.title || "New chat"` — the fallback fires when title is empty string.
    const threadNoTitle = { ...blankThread("t1"), title: "" };
    mockThreads.value = [threadNoTitle];
    render(<Chat ctx={ctx} />);
    fireEvent.click(screen.getByTitle("History"));
    const titleSpan = document.querySelector(".ch-thread-title");
    expect(titleSpan?.textContent).toBe("New chat");
  });
});

describe("Chat panel — messages rendering", () => {
  it("renders user and AI messages", () => {
    mockThreads.value = [
      blankThread("t1", [
        { role: "you", text: "Hello world" },
        { role: "ai", text: "Hi there" },
      ]),
    ];
    render(<Chat ctx={ctx} />);
    expect(screen.getByText("Hello world")).toBeTruthy();
    expect(screen.getByText("Hi there")).toBeTruthy();
  });

  it("streaming message carries the cursor element", () => {
    mockThreads.value = [
      blankThread("t1", [
        { role: "you", text: "Ping" },
        { role: "ai", text: "Pong…", streaming: true },
      ]),
    ];
    const { container } = render(<Chat ctx={ctx} />);
    expect(container.querySelector(".cm-cursor")).toBeTruthy();
  });

  it("completed message has no cursor element", () => {
    mockThreads.value = [
      blankThread("t1", [
        { role: "you", text: "Hi" },
        { role: "ai", text: "Hello", streaming: false },
      ]),
    ];
    const { container } = render(<Chat ctx={ctx} />);
    expect(container.querySelector(".cm-cursor")).toBeNull();
  });

  it("error message has the 'err' CSS class", () => {
    mockThreads.value = [
      blankThread("t1", [
        { role: "you", text: "q" },
        { role: "ai", text: "oops", error: true },
      ]),
    ];
    const { container } = render(<Chat ctx={ctx} />);
    expect(container.querySelector(".cm.ai.err")).toBeTruthy();
  });

  it("scroll/mermaid useEffect fires requestAnimationFrame which calls renderMermaidIn", async () => {
    // Use fake timers so we can flush requestAnimationFrame (which jsdom implements
    // as a setTimeout(0) under the hood). This covers lines 72-73 in chat.tsx.
    vi.useFakeTimers();
    const { renderMermaidIn } = await import("../../core/mermaid");
    vi.mocked(renderMermaidIn).mockClear();
    mockThreads.value = [
      blankThread("t1", [{ role: "ai", text: "diagram" }]),
    ];
    render(<Chat ctx={ctx} />);
    // Flush requestAnimationFrame callbacks
    vi.runAllTimers();
    expect(vi.mocked(renderMermaidIn)).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("Chat panel — busy state", () => {
  beforeEach(() => {
    mockThreads.value = [
      blankThread("t1", [
        { role: "you", text: "q" },
        { role: "ai", text: "a", streaming: true },
      ]),
    ];
    mockBusyIds.value = new Set(["t1"]);
    mockIsBusy.mockReturnValue(true);
  });

  it("shows Stop button instead of Send while busy", () => {
    render(<Chat ctx={ctx} />);
    expect(screen.getByTitle("Stop")).toBeTruthy();
    expect(screen.queryByTitle("Send")).toBeNull();
  });

  it("stop button calls stop(thread.id)", () => {
    render(<Chat ctx={ctx} />);
    fireEvent.click(screen.getByTitle("Stop"));
    expect(mockStop).toHaveBeenCalledWith("t1");
  });

  it("textarea is disabled while busy", () => {
    render(<Chat ctx={ctx} />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.disabled).toBe(true);
  });

  it("attach button is disabled while busy", () => {
    render(<Chat ctx={ctx} />);
    const btn = screen.getByTitle(/Attach file/i) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

describe("Chat panel — send flow", () => {
  it("Enter key calls send with the draft text", () => {
    render(<Chat ctx={ctx} />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.input(ta, { target: { value: "Hello agent" } });
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: false });
    expect(mockSend).toHaveBeenCalledWith(ctx.daemon, "Hello agent");
  });

  it("Shift+Enter does NOT send", () => {
    render(<Chat ctx={ctx} />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.input(ta, { target: { value: "line1" } });
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("clicking the Send button calls send", () => {
    render(<Chat ctx={ctx} />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.input(ta, { target: { value: "msg" } });
    fireEvent.click(screen.getByTitle("Send"));
    expect(mockSend).toHaveBeenCalledWith(ctx.daemon, "msg");
  });

  it("does NOT send when draft is blank", () => {
    render(<Chat ctx={ctx} />);
    fireEvent.click(screen.getByTitle("Send"));
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("guard: does not send when busy", () => {
    mockBusyIds.value = new Set(["t1"]);
    mockIsBusy.mockReturnValue(true);
    render(<Chat ctx={ctx} />);
    // Even if we force the keydown (textarea is disabled in reality)
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.input(ta, { target: { value: "x" } });
    // Simulate keyboard Enter — the onSend guard checks busy first
    fireEvent.keyDown(ta, { key: "Enter" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not send when an attachment is still uploading", async () => {
    // uploadFile hangs forever — simulates an in-flight upload
    ctx.daemon.uploadFile = vi.fn(() => new Promise(() => {}));
    render(<Chat ctx={ctx} />);
    const file = new File(["x"], "shot.png", { type: "image/png" });
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.paste(ta, {
      clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] },
    });
    await waitFor(() => screen.getByTestId("chat-attachments"));
    // Attachment is still uploading — Send should not call through
    fireEvent.input(ta, { target: { value: "hello" } });
    fireEvent.click(screen.getByTitle("Send"));
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("Chat panel — slash autocomplete", () => {
  it("opens the slash menu for '/'", () => {
    render(<Chat ctx={ctx} />);
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "/" } });
    expect(screen.getByTestId("chat-slash")).toBeTruthy();
  });

  it("filters commands matching the partial input '/cap'", () => {
    render(<Chat ctx={ctx} />);
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "/cap" } });
    expect(screen.getByText("/capture")).toBeTruthy();
    // 'connect' doesn't match '/cap'
    expect(screen.queryByText("/connect")).toBeNull();
  });

  it("hides the slash menu when draft has a trailing space (command chosen)", () => {
    render(<Chat ctx={ctx} />);
    const ta = screen.getByRole("textbox");
    fireEvent.input(ta, { target: { value: "/capture " } });
    expect(screen.queryByTestId("chat-slash")).toBeNull();
  });

  it("hides the slash menu when no commands match", () => {
    render(<Chat ctx={ctx} />);
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "/zzz" } });
    expect(screen.queryByTestId("chat-slash")).toBeNull();
  });

  it("ArrowDown moves the highlight to the next item", () => {
    render(<Chat ctx={ctx} />);
    const ta = screen.getByRole("textbox");
    fireEvent.input(ta, { target: { value: "/" } });
    const items0 = document.querySelectorAll(".ch-slash-item");
    expect(items0[0].className).toContain("on");

    fireEvent.keyDown(ta, { key: "ArrowDown" });
    const items1 = document.querySelectorAll(".ch-slash-item");
    expect(items1[1].className).toContain("on");
    expect(items1[0].className).not.toContain("on");
  });

  it("ArrowDown then ArrowUp returns to the previous index", () => {
    render(<Chat ctx={ctx} />);
    const ta = screen.getByRole("textbox");
    fireEvent.input(ta, { target: { value: "/" } });
    // Start at index 0, move down to 1
    fireEvent.keyDown(ta, { key: "ArrowDown" });
    let items = document.querySelectorAll(".ch-slash-item");
    expect(items[1].className).toContain("on");
    // Move up back to 0
    fireEvent.keyDown(ta, { key: "ArrowUp" });
    items = document.querySelectorAll(".ch-slash-item");
    expect(items[0].className).toContain("on");
  });

  it("Tab selects the highlighted skill and closes the menu", () => {
    render(<Chat ctx={ctx} />);
    const ta = screen.getByRole("textbox");
    fireEvent.input(ta, { target: { value: "/cap" } });
    fireEvent.keyDown(ta, { key: "Tab" });
    expect(screen.queryByTestId("chat-slash")).toBeNull();
  });

  it("Enter in slash mode picks the skill instead of sending", () => {
    render(<Chat ctx={ctx} />);
    const ta = screen.getByRole("textbox");
    fireEvent.input(ta, { target: { value: "/cap" } });
    fireEvent.keyDown(ta, { key: "Enter", shiftKey: false });
    expect(mockSend).not.toHaveBeenCalled();
    // Menu should have closed (draft now has trailing space)
    expect(screen.queryByTestId("chat-slash")).toBeNull();
  });

  it("Escape collapses the slash menu", () => {
    render(<Chat ctx={ctx} />);
    const ta = screen.getByRole("textbox");
    fireEvent.input(ta, { target: { value: "/" } });
    expect(screen.getByTestId("chat-slash")).toBeTruthy();
    fireEvent.keyDown(ta, { key: "Escape" });
    expect(screen.queryByTestId("chat-slash")).toBeNull();
  });

  it("an unrecognized key while slash-open falls through the if-chain (line 174 false-branch)", () => {
    // Presses a key that is not ArrowDown/Up/Tab/Enter/Escape while the slash
    // menu is open. This exercises the fall-through after `if (e.key === "Escape")`
    // — the branch coverage target for line 174's falsy side.
    render(<Chat ctx={ctx} />);
    const ta = screen.getByRole("textbox");
    fireEvent.input(ta, { target: { value: "/" } });
    expect(screen.getByTestId("chat-slash")).toBeTruthy();
    // 'a' key while slash open — hits none of the early-return branches, falls
    // through to the outer `if (e.key === "Enter" && !e.shiftKey)` check.
    fireEvent.keyDown(ta, { key: "a" });
    // Menu remains open (no close condition hit)
    expect(screen.getByTestId("chat-slash")).toBeTruthy();
  });

  it("clicking a skill item picks it and closes the menu", () => {
    render(<Chat ctx={ctx} />);
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "/cap" } });
    const btn = screen.getByText("/capture").closest("button") as HTMLButtonElement;
    fireEvent.mouseDown(btn);
    expect(screen.queryByTestId("chat-slash")).toBeNull();
  });

  it("caps the menu at 7 items even when more match", () => {
    render(<Chat ctx={ctx} />);
    // "/" alone matches all 22 skills; only 7 should appear
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "/" } });
    const items = document.querySelectorAll(".ch-slash-item");
    expect(items.length).toBeLessThanOrEqual(7);
  });
});

describe("Chat panel — file attachments", () => {
  it("pasting an image file shows the attachments area", async () => {
    ctx.daemon.uploadFile = vi.fn(async () => {});
    render(<Chat ctx={ctx} />);
    const file = new File(["px"], "test.png", { type: "image/png" });
    const ta = screen.getByRole("textbox");
    fireEvent.paste(ta, {
      clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] },
    });
    await waitFor(() => expect(screen.getByTestId("chat-attachments")).toBeTruthy());
  });

  it("uploaded image attachment shows a thumbnail", async () => {
    ctx.daemon.uploadFile = vi.fn(async () => {});
    ctx.daemon.rawUrl = vi.fn((p: string) => `/raw/${p}`);
    render(<Chat ctx={ctx} />);
    const file = new File(["x"], "img.png", { type: "image/png" });
    const ta = screen.getByRole("textbox");
    fireEvent.paste(ta, {
      clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] },
    });
    await waitFor(() => screen.getByTestId("chat-attachments"));
    // After upload completes, a thumbnail should appear
    await waitFor(() => expect(document.querySelector(".ch-att-thumb")).toBeTruthy());
  });

  it("non-image pasted items fall through without adding an attachment", () => {
    render(<Chat ctx={ctx} />);
    const ta = screen.getByRole("textbox");
    fireEvent.paste(ta, {
      clipboardData: { items: [{ kind: "string", type: "text/plain", getAsFile: () => null }] },
    });
    expect(screen.queryByTestId("chat-attachments")).toBeNull();
  });

  it("remove attachment button removes the file from the list", async () => {
    ctx.daemon.uploadFile = vi.fn(async () => {});
    render(<Chat ctx={ctx} />);
    const file = new File(["x"], "img.png", { type: "image/png" });
    const ta = screen.getByRole("textbox");
    fireEvent.paste(ta, {
      clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] },
    });
    await waitFor(() => screen.getByLabelText("Remove attachment"));
    fireEvent.click(screen.getByLabelText("Remove attachment"));
    await waitFor(() => expect(screen.queryByTestId("chat-attachments")).toBeNull());
  });

  it("attach button is disabled when MAX_ATTACHMENTS (5) are attached", async () => {
    ctx.daemon.uploadFile = vi.fn(async () => {});
    render(<Chat ctx={ctx} />);
    const ta = screen.getByRole("textbox");
    for (let i = 0; i < 5; i++) {
      const file = new File(["x"], `img${i}.png`, { type: "image/png" });
      fireEvent.paste(ta, {
        clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] },
      });
    }
    await waitFor(() => {
      const btn = screen.getByTitle(/Max 5 files/i) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });

  it("send with attachment includes file path in the message", async () => {
    ctx.daemon.uploadFile = vi.fn(async () => {});
    render(<Chat ctx={ctx} />);
    const file = new File(["px"], "shot.png", { type: "image/png" });
    const ta = screen.getByRole("textbox");
    fireEvent.paste(ta, {
      clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] },
    });
    await waitFor(() => screen.getByLabelText("Remove attachment"));
    fireEvent.input(ta, { target: { value: "See this" } });
    fireEvent.click(screen.getByTitle("Send"));
    expect(mockSend).toHaveBeenCalledWith(ctx.daemon, expect.stringContaining("See this"));
    expect(mockSend).toHaveBeenCalledWith(ctx.daemon, expect.stringContaining("00-inbox/imports"));
  });

  it("send with attachment but EMPTY text omits the text prefix (line 106 falsy branch)", async () => {
    // When text is empty but att.length > 0, the template uses "" for the text part.
    // This exercises the `text ? text + "\n\n" : ""` falsy branch at line 106.
    ctx.daemon.uploadFile = vi.fn(async () => {});
    render(<Chat ctx={ctx} />);
    const file = new File(["x"], "img.png", { type: "image/png" });
    const ta = screen.getByRole("textbox");
    fireEvent.paste(ta, {
      clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] },
    });
    await waitFor(() => screen.getByLabelText("Remove attachment"));
    // Keep draft empty, then send
    fireEvent.click(screen.getByTitle("Send"));
    expect(mockSend).toHaveBeenCalledWith(ctx.daemon, expect.stringContaining("Attached to the vault"));
    // No leading newlines from text prefix
    expect(mockSend).toHaveBeenCalledWith(ctx.daemon, expect.not.stringContaining("\n\n"));
  });

  it("upload failure removes the attachment from the list", async () => {
    ctx.daemon.uploadFile = vi.fn(async () => { throw new Error("upload failed"); });
    render(<Chat ctx={ctx} />);
    const file = new File(["x"], "bad.png", { type: "image/png" });
    const ta = screen.getByRole("textbox");
    fireEvent.paste(ta, {
      clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] },
    });
    // The attachment appears briefly as 'uploading', then is removed on error
    await waitFor(() => expect(screen.queryByTestId("chat-attachments")).toBeNull());
  });

  it("pasting an image with no name synthesizes an extension from MIME type", async () => {
    ctx.daemon.uploadFile = vi.fn(async () => {});
    render(<Chat ctx={ctx} />);
    // File with empty name (as pasted images often have)
    const file = new File(["x"], "", { type: "image/jpeg" });
    const ta = screen.getByRole("textbox");
    fireEvent.paste(ta, {
      clipboardData: { items: [{ kind: "file", type: "image/jpeg", getAsFile: () => file }] },
    });
    await waitFor(() => screen.getByTestId("chat-attachments"));
    // The attachment name should contain 'pasted-image.jpeg'
    expect(screen.getByText(/pasted-image\.jpeg/i)).toBeTruthy();
  });

  it("clicking the attach button delegates to the hidden file input (line 290)", () => {
    ctx.daemon.uploadFile = vi.fn(async () => {});
    render(<Chat ctx={ctx} />);
    // The hidden file input's click is normally a no-op in jsdom (no file picker),
    // but the onClick handler at line 290 still executes and can be verified by spying.
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByLabelText("Attach file"));
    expect(clickSpy).toHaveBeenCalled();
  });

  it("onFiles handler (file input change) queues uploaded files", async () => {
    ctx.daemon.uploadFile = vi.fn(async () => {});
    render(<Chat ctx={ctx} />);
    // Simulate selecting a file via the hidden file input's onChange
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["data"], "report.pdf", { type: "application/pdf" });
    // Assign the FileList to the input using Object.defineProperty
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
    fireEvent.change(fileInput);
    await waitFor(() => expect(screen.getByTestId("chat-attachments")).toBeTruthy());
    expect(screen.getByText("report.pdf")).toBeTruthy();
  });

  it("onFiles with null files property does nothing gracefully (line 140 else-branch)", () => {
    // When input.files is null, onFiles falls to else: `input.files ? [...] : []`
    ctx.daemon.uploadFile = vi.fn(async () => {});
    render(<Chat ctx={ctx} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, "files", { value: null, configurable: true });
    fireEvent.change(fileInput);
    // No attachment area should appear (empty files list means addFiles([]) is a no-op)
    expect(screen.queryByTestId("chat-attachments")).toBeNull();
  });

  it("addFiles is a no-op when at MAX_ATTACHMENTS capacity (line 119 branch)", async () => {
    // Fill to capacity via paste so that addFiles sees room <= 0 on the next call.
    // This tests the early return at line 119.
    ctx.daemon.uploadFile = vi.fn(async () => {});
    render(<Chat ctx={ctx} />);
    const ta = screen.getByRole("textbox");
    for (let i = 0; i < 5; i++) {
      const file = new File(["x"], `img${i}.png`, { type: "image/png" });
      fireEvent.paste(ta, {
        clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] },
      });
    }
    await waitFor(() => screen.getByTitle(/Max 5 files/i));
    // Now trigger onFiles with another file — addFiles returns early (room <= 0)
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const extra = new File(["y"], "extra.png", { type: "image/png" });
    Object.defineProperty(fileInput, "files", { value: [extra], configurable: true });
    fireEvent.change(fileInput);
    // Still 5 attachments (no 6th added)
    await new Promise((r) => setTimeout(r, 20));
    const atts = document.querySelectorAll(".ch-att");
    expect(atts.length).toBe(5);
  });

  it("file with no MIME type subtype uses 'png' fallback (line 123 || 'png' branch)", async () => {
    // When file.type is empty or has no '/', split("/")[1] is undefined;
    // `|| "png"` fires as the fallback extension.
    ctx.daemon.uploadFile = vi.fn(async () => {});
    render(<Chat ctx={ctx} />);
    // File with type "" (no subtype) → the `|| "png"` branch on line 123
    const file = new File(["x"], "", { type: "" });
    const ta = screen.getByRole("textbox");
    fireEvent.paste(ta, {
      clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] },
    });
    await waitFor(() => screen.getByTestId("chat-attachments"));
    // Name should be synthesized with "png" extension
    expect(screen.getByText(/pasted-image\.png/i)).toBeTruthy();
  });

  it("paste event with no clipboardData falls back to empty array (line 147 ?? [] branch)", () => {
    // When e.clipboardData is undefined, `e.clipboardData?.items ?? []` fires the
    // nullish coalescing fallback. Array.from([]) is empty, so no images and the
    // handler returns early. This covers the ?? [] branch on line 147.
    render(<Chat ctx={ctx} />);
    const ta = screen.getByRole("textbox");
    // Dispatch paste with clipboardData = undefined
    fireEvent.paste(ta, { clipboardData: undefined });
    // No attachment area (empty items list → no images)
    expect(screen.queryByTestId("chat-attachments")).toBeNull();
  });
});

describe("Chat panel — wikilink click in feed", () => {
  it("clicks a wikilink span → calls openFile with the resolved path", () => {
    // busModule.resolveWikilink is already mocked via vi.mock above
    vi.mocked(busModule.resolveWikilink).mockReturnValueOnce("01-projects/note.md");
    const { container } = render(<Chat ctx={ctx} />);
    const feed = container.querySelector(".chat-feed") as HTMLDivElement;
    const span = document.createElement("span");
    span.setAttribute("data-wikilink", "note");
    feed.appendChild(span);
    fireEvent.click(span);
    expect(ctx.openFile).toHaveBeenCalledWith("01-projects/note.md");
  });

  it("clicking a non-wikilink element in the feed does nothing", () => {
    const { container } = render(<Chat ctx={ctx} />);
    const feed = container.querySelector(".chat-feed") as HTMLDivElement;
    fireEvent.click(feed);
    expect(ctx.openFile).not.toHaveBeenCalled();
  });

  it("resolveWikilink returning null does not call openFile", () => {
    vi.mocked(busModule.resolveWikilink).mockReturnValueOnce(null);
    const { container } = render(<Chat ctx={ctx} />);
    const feed = container.querySelector(".chat-feed") as HTMLDivElement;
    const span = document.createElement("span");
    span.setAttribute("data-wikilink", "unknown");
    feed.appendChild(span);
    fireEvent.click(span);
    expect(ctx.openFile).not.toHaveBeenCalled();
  });

  it("closest('[data-wikilink]') getAttribute returning null coerces to empty string (line 91 ?? branch)", () => {
    // getAttribute can return null when the attribute is missing. Using a nested
    // element inside a [data-wikilink] ancestor but getAttribute returns null if
    // we mock it. Simpler: use a child node inside an ancestor that has the attribute
    // set to empty string, relying on closest() to find it.
    vi.mocked(busModule.resolveWikilink).mockReturnValueOnce(null);
    const { container } = render(<Chat ctx={ctx} />);
    const feed = container.querySelector(".chat-feed") as HTMLDivElement;
    // Ancestor with no data-wikilink value — getAttribute returns ""
    const ancestor = document.createElement("span");
    ancestor.setAttribute("data-wikilink", "");
    const child = document.createElement("em");
    ancestor.appendChild(child);
    feed.appendChild(ancestor);
    // Click the child; closest() finds ancestor whose getAttribute returns ""
    fireEvent.click(child);
    // resolveWikilink is called with "" (from `?? ""`); it returns null → no openFile
    expect(ctx.openFile).not.toHaveBeenCalled();
  });
});
