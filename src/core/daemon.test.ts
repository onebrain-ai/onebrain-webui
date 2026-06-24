import { describe, it, expect, vi, beforeEach, type MockedFunction } from "vitest";
import { HttpDaemonClient, parseSseFrame } from "./daemon";
import { DaemonError } from "./types";

type FetchMock = MockedFunction<typeof fetch>;
type HeadersMap = Record<string, string>;

function mockFetch(status: number, body: unknown): FetchMock {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  ) as unknown as FetchMock;
}

describe("HttpDaemonClient writes", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("createFile POSTs raw body + token, returns rev", async () => {
    const f = mockFetch(201, { path: "a.md", rev: "111" });
    vi.stubGlobal("fetch", f);
    const c = new HttpDaemonClient("tok");
    const r = await c.createFile("a.md", "# hi");
    expect(r.rev).toBe("111");
    const [url, init] = f.mock.calls[0];
    const h = init?.headers as HeadersMap;
    expect(url).toContain("/api/vault/file?path=a.md");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe("# hi");
    expect(h["X-OneBrain-Token"]).toBe("tok");
  });

  it("saveFile sends If-Match and maps 409 to ConflictError with current rev", async () => {
    const f = mockFetch(409, { error: "rev mismatch", rev: "999" });
    vi.stubGlobal("fetch", f);
    const c = new HttpDaemonClient("tok");
    await expect(c.saveFile("a.md", "x", "111")).rejects.toMatchObject({ rev: "999" });
    const h = f.mock.calls[0][1]?.headers as HeadersMap;
    expect(h["If-Match"]).toBe("111");
  });

  it("non-409 errors map to DaemonError", async () => {
    vi.stubGlobal("fetch", mockFetch(422, { error: "not utf-8" }));
    const c = new HttpDaemonClient("tok");
    await expect(c.deleteFile("a.md")).rejects.toBeInstanceOf(DaemonError);
  });

  it("moveFile POSTs JSON {from,to}", async () => {
    const f = mockFetch(200, { from: "a.md", to: "b.md" });
    vi.stubGlobal("fetch", f);
    const c = new HttpDaemonClient("tok");
    await c.moveFile("a.md", "b.md");
    const init = f.mock.calls[0][1];
    const h = init?.headers as HeadersMap;
    expect(init?.body).toBe(JSON.stringify({ from: "a.md", to: "b.md" }));
    expect(h["Content-Type"]).toContain("application/json");
  });
});

describe("parseSseFrame", () => {
  it("parses a session event", () => {
    expect(parseSseFrame('event: session\ndata: {"session_id":"abc-123"}')).toEqual({
      type: "session",
      sessionId: "abc-123",
    });
  });

  it("parses a delta event", () => {
    expect(parseSseFrame('event: delta\ndata: {"text":"hello"}')).toEqual({ type: "delta", text: "hello" });
  });

  it("parses a done event (and defaults missing fields)", () => {
    expect(parseSseFrame('event: done\ndata: {"result":"r","is_error":false}')).toEqual({
      type: "done",
      result: "r",
      sessionId: null,
      isError: false,
    });
  });

  it("parses an error event", () => {
    expect(parseSseFrame('event: error\ndata: {"message":"boom"}')).toEqual({ type: "error", message: "boom" });
  });

  it("tolerates a leading space after data: (SSE spec)", () => {
    expect(parseSseFrame("event: delta\ndata: {\"text\":\"x\"}")).toEqual({ type: "delta", text: "x" });
  });

  it("concatenates multiple data: lines", () => {
    // SSE allows a payload split across several data: lines.
    expect(parseSseFrame('event: delta\ndata: {"text":\ndata: "multi"}')).toEqual({ type: "delta", text: "multi" });
  });

  it("returns null for a comment/keep-alive frame (no data)", () => {
    expect(parseSseFrame(": keep-alive")).toBeNull();
  });

  it("returns null for an unknown event name", () => {
    expect(parseSseFrame('event: bogus\ndata: {"x":1}')).toBeNull();
  });

  it("returns null for malformed JSON instead of throwing", () => {
    expect(parseSseFrame("event: delta\ndata: {not json")).toBeNull();
  });

  it("session event without an id is null", () => {
    expect(parseSseFrame("event: session\ndata: {}")).toBeNull();
  });
});
