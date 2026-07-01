import { describe, it, expect, vi, beforeEach, type MockedFunction } from "vitest";
import { HttpDaemonClient, parseSseFrame } from "./daemon";
import { DaemonError, ConflictError } from "./types";

type FetchMock = MockedFunction<typeof fetch>;
type HeadersMap = Record<string, string>;

function mockFetch(status: number, body: unknown): FetchMock {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  ) as unknown as FetchMock;
}

/** Build a ReadableStream from a sequence of UTF-8 chunks (SSE frames). */
function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(ctrl) {
      for (const c of chunks) ctrl.enqueue(enc.encode(c));
      ctrl.close();
    },
  });
}

/** Minimal mock Response with a streaming body. */
function streamResponse(chunks: string[]): Response {
  return new Response(sseStream(chunks), { status: 200, headers: { "Content-Type": "text/event-stream" } });
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

  it("409 with non-JSON body falls back to {message:'conflict', rev:null}", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 409 })));
    const c = new HttpDaemonClient("tok");
    let err: unknown;
    try { await c.saveFile("a.md", "x", "1"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).rev).toBeNull();
    expect((err as ConflictError).message).toBe("conflict");
  });
});

describe("HttpDaemonClient reads (getJson)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("config() GETs /api/config and returns the parsed body", async () => {
    const f = mockFetch(200, { qmd_collection: "ob-1" });
    vi.stubGlobal("fetch", f);
    const c = new HttpDaemonClient("tok");
    const cfg = await c.config();
    expect(cfg.qmd_collection).toBe("ob-1");
    const [url] = f.mock.calls[0];
    expect(url).toContain("/api/config");
  });

  it("tree() returns the VaultTree", async () => {
    const body = { root: "/vault", entries: [{ path: "a.md", name: "a.md", kind: "file" }] };
    vi.stubGlobal("fetch", mockFetch(200, body));
    const c = new HttpDaemonClient("tok");
    const t = await c.tree();
    expect(t.root).toBe("/vault");
    expect(t.entries).toHaveLength(1);
  });

  it("file() GETs a vault file by path (URL-encoded)", async () => {
    const f = mockFetch(200, { path: "notes/a b.md", content: "hi", rev: "1" });
    vi.stubGlobal("fetch", f);
    const c = new HttpDaemonClient("tok");
    const vf = await c.file("notes/a b.md");
    expect(vf.content).toBe("hi");
    const [url] = f.mock.calls[0];
    expect(url).toContain(encodeURIComponent("notes/a b.md"));
  });

  it("getJson(): network failure throws DaemonError with status 0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    const c = new HttpDaemonClient("tok");
    await expect(c.config()).rejects.toMatchObject({ status: 0 });
  });

  it("getJson(): non-2xx throws DaemonError with the HTTP status", async () => {
    vi.stubGlobal("fetch", mockFetch(404, { error: "not found" }));
    const c = new HttpDaemonClient("tok");
    await expect(c.tree()).rejects.toMatchObject({ status: 404 });
  });

  it("getJson(): non-JSON error body falls back to statusText", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad gateway", { status: 502, statusText: "Bad Gateway" })));
    const c = new HttpDaemonClient("tok");
    let err: unknown;
    try { await c.config(); } catch (e) { err = e; }
    expect((err as DaemonError).message).toBe("Bad Gateway");
  });

  it("omits the auth header when token is null", async () => {
    const f = mockFetch(200, { root: "/v", entries: [] });
    vi.stubGlobal("fetch", f);
    const c = new HttpDaemonClient(null);
    await c.tree();
    const h = f.mock.calls[0][1]?.headers as HeadersMap;
    expect(h["X-OneBrain-Token"]).toBeUndefined();
  });
});

describe("HttpDaemonClient extra write methods", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("deleteFile DELETEs the vault file and returns a TrashResult", async () => {
    const f = mockFetch(200, { path: "a.md", trashed_to: ".trash/a.md" });
    vi.stubGlobal("fetch", f);
    const c = new HttpDaemonClient("tok");
    const r = await c.deleteFile("a.md");
    expect(r.trashed_to).toBe(".trash/a.md");
    expect(f.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("createFolder POSTs to /api/vault/folder", async () => {
    const f = mockFetch(201, { path: "notes" });
    vi.stubGlobal("fetch", f);
    const c = new HttpDaemonClient("tok");
    const r = await c.createFolder("notes");
    expect(r.path).toBe("notes");
    const [url] = f.mock.calls[0];
    expect(url).toContain("/api/vault/folder");
  });

  it("deleteFolder DELETEs a folder", async () => {
    const f = mockFetch(200, { path: "notes", trashed_to: ".trash/notes" });
    vi.stubGlobal("fetch", f);
    const c = new HttpDaemonClient("tok");
    const r = await c.deleteFolder("notes");
    expect(r.trashed_to).toBe(".trash/notes");
    expect(f.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("tasks() unwraps the { tasks } wrapper", async () => {
    const tasks = [{ file: "a.md", line: 1, text: "do", done: false, due: "2026-07-01" }];
    vi.stubGlobal("fetch", mockFetch(200, { tasks }));
    const c = new HttpDaemonClient("tok");
    const result = await c.tasks();
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("do");
  });

  it("send(): network-level failure throws DaemonError status 0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    const c = new HttpDaemonClient("tok");
    await expect(c.createFolder("x")).rejects.toMatchObject({ status: 0 });
  });
});

describe("HttpDaemonClient.search()", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("builds the correct URL with q and mode, returns hits", async () => {
    const hits = [{ path: "a.md", score: 0.9, title: "A", snippet: "snip" }];
    const f: FetchMock = vi.fn(async () => new Response(JSON.stringify({ hits }), { status: 200 })) as unknown as FetchMock;
    vi.stubGlobal("fetch", f);
    const c = new HttpDaemonClient("tok");
    const result = await c.search("hello", "lex");
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("a.md");
    const [url] = f.mock.calls[0];
    expect(url).toContain("q=hello");
    expect(url).toContain("mode=lex");
  });

  it("throws DaemonError on non-2xx search response", async () => {
    vi.stubGlobal("fetch", mockFetch(500, { error: "internal" }));
    const c = new HttpDaemonClient("tok");
    await expect(c.search("q", "lex")).rejects.toBeInstanceOf(DaemonError);
  });

  it("re-throws AbortError when caller has signalled abort", async () => {
    const ctrl = new AbortController();
    const abortErr = new DOMException("aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn(async () => { ctrl.abort(); throw abortErr; }));
    const c = new HttpDaemonClient("tok");
    await expect(c.search("q", "lex", ctrl.signal)).rejects.toThrow("aborted");
  });

  it("wraps a non-abort network failure as DaemonError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("net"); }));
    const c = new HttpDaemonClient("tok");
    await expect(c.search("q", "lex")).rejects.toMatchObject({ status: 0 });
  });
});

describe("HttpDaemonClient.fileBlob()", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns the response blob on success", async () => {
    const f: FetchMock = vi.fn(async () => new Response(new Blob(["data"]), { status: 200 })) as unknown as FetchMock;
    vi.stubGlobal("fetch", f);
    const c = new HttpDaemonClient("tok");
    const blob = await c.fileBlob("img.png");
    expect(blob).toBeInstanceOf(Blob);
    const [url] = f.mock.calls[0];
    expect(url).toContain("/api/vault/raw");
    expect(url).toContain("img.png");
  });

  it("throws DaemonError on non-2xx", async () => {
    vi.stubGlobal("fetch", mockFetch(403, { error: "forbidden" }));
    const c = new HttpDaemonClient("tok");
    await expect(c.fileBlob("x.png")).rejects.toBeInstanceOf(DaemonError);
  });

  it("wraps network failure as DaemonError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("net"); }));
    const c = new HttpDaemonClient("tok");
    await expect(c.fileBlob("x.png")).rejects.toMatchObject({ status: 0 });
  });
});

describe("HttpDaemonClient.uploadFile()", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs octet-stream and returns {path}", async () => {
    const f = mockFetch(200, { path: "attachments/img.png" });
    vi.stubGlobal("fetch", f);
    const c = new HttpDaemonClient("tok");
    const buf = new ArrayBuffer(4);
    const r = await c.uploadFile("attachments/img.png", buf);
    expect(r.path).toBe("attachments/img.png");
    const [url, init] = f.mock.calls[0];
    expect(url).toContain("/api/vault/upload");
    expect(init?.method).toBe("POST");
    const h = init?.headers as HeadersMap;
    expect(h["Content-Type"]).toBe("application/octet-stream");
  });

  it("throws DaemonError on non-2xx", async () => {
    vi.stubGlobal("fetch", mockFetch(413, { error: "too large" }));
    const c = new HttpDaemonClient("tok");
    await expect(c.uploadFile("x.png", new ArrayBuffer(0))).rejects.toBeInstanceOf(DaemonError);
  });

  it("wraps network failure as DaemonError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("net"); }));
    const c = new HttpDaemonClient("tok");
    await expect(c.uploadFile("x.png", new ArrayBuffer(0))).rejects.toMatchObject({ status: 0 });
  });
});

describe("HttpDaemonClient.rawUrl()", () => {
  it("embeds the token in the query string for direct <img> use", () => {
    const c = new HttpDaemonClient("mytoken", "https://daemon.local");
    const url = c.rawUrl("img/photo.jpg");
    expect(url).toContain("/api/vault/raw");
    expect(url).toContain("path=img%2Fphoto.jpg");
    expect(url).toContain("token=mytoken");
  });

  it("omits the token param when token is null", () => {
    const c = new HttpDaemonClient(null);
    const url = c.rawUrl("img.png");
    expect(url).not.toContain("token=");
  });
});

describe("HttpDaemonClient — null-token branches in send/uploadFile/search/chat/fileBlob", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("send(): omits X-OneBrain-Token header when token is null", async () => {
    const f = mockFetch(201, { path: "notes", trashed_to: "" });
    vi.stubGlobal("fetch", f);
    const c = new HttpDaemonClient(null);
    await c.createFolder("notes");
    const h = f.mock.calls[0][1]?.headers as HeadersMap;
    expect(h["X-OneBrain-Token"]).toBeUndefined();
  });

  it("uploadFile: omits X-OneBrain-Token header when token is null", async () => {
    const f = mockFetch(200, { path: "x.png" });
    vi.stubGlobal("fetch", f);
    const c = new HttpDaemonClient(null);
    await c.uploadFile("x.png", new ArrayBuffer(0));
    const h = f.mock.calls[0][1]?.headers as HeadersMap;
    expect(h["X-OneBrain-Token"]).toBeUndefined();
  });

  it("search(): omits X-OneBrain-Token header when token is null", async () => {
    const f: FetchMock = vi.fn(async () => new Response(JSON.stringify({ hits: [] }), { status: 200 })) as unknown as FetchMock;
    vi.stubGlobal("fetch", f);
    const c = new HttpDaemonClient(null);
    await c.search("q", "lex");
    const h = f.mock.calls[0][1]?.headers as HeadersMap;
    expect(h["X-OneBrain-Token"]).toBeUndefined();
  });

  it("chat(): omits X-OneBrain-Token header when token is null", async () => {
    const f: FetchMock = vi.fn(async () => streamResponse(['event: done\ndata: {"result":""}\n\n'])) as unknown as FetchMock;
    vi.stubGlobal("fetch", f);
    const c = new HttpDaemonClient(null);
    await c.chat({ message: "hi" }, () => {});
    const h = f.mock.calls[0][1]?.headers as HeadersMap;
    expect(h["X-OneBrain-Token"]).toBeUndefined();
  });

  it("fileBlob(): omits X-OneBrain-Token header when token is null", async () => {
    const f: FetchMock = vi.fn(async () => new Response(new Blob(["data"]), { status: 200 })) as unknown as FetchMock;
    vi.stubGlobal("fetch", f);
    const c = new HttpDaemonClient(null);
    await c.fileBlob("img.png");
    const h = f.mock.calls[0][1]?.headers as HeadersMap;
    expect(h["X-OneBrain-Token"]).toBeUndefined();
  });
});

describe("readConflict / readError branch coverage", () => {
  beforeEach(() => vi.restoreAllMocks());

  // 409 body where error/rev are NOT strings → fallback values ("conflict", null).
  it("readConflict: non-string error+rev in 409 body → message='conflict', rev=null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: 42, rev: true }), // non-string values
      { status: 409 },
    )));
    const c = new HttpDaemonClient("tok");
    let err: unknown;
    try { await c.saveFile("a.md", "x", "1"); } catch (e) { err = e; }
    expect((err as ConflictError).message).toBe("conflict");
    expect((err as ConflictError).rev).toBeNull();
  });

  // readError: body.error is not a string → fall through to statusText.
  it("readError: non-string error value falls back to statusText", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: 123 }), { status: 503, statusText: "Service Unavailable" }),
    ));
    const c = new HttpDaemonClient("tok");
    let err: unknown;
    try { await c.tree(); } catch (e) { err = e; }
    expect((err as DaemonError).message).toBe("Service Unavailable");
  });

  // readError: empty statusText → HTTP {status} fallback.
  it("readError: empty statusText falls back to 'HTTP {status}'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503, statusText: "" })));
    const c = new HttpDaemonClient("tok");
    let err: unknown;
    try { await c.tree(); } catch (e) { err = e; }
    expect((err as DaemonError).message).toBe("HTTP 503");
  });
});

describe("parseSseFrame — default field values", () => {
  // delta event with missing text field → text defaults to "".
  it("delta event with no text field defaults to empty string", () => {
    expect(parseSseFrame('event: delta\ndata: {}')).toEqual({ type: "delta", text: "" });
  });

  // done event with missing result/session_id → defaults apply.
  it("done event with only is_error applies all defaults", () => {
    expect(parseSseFrame('event: done\ndata: {"is_error":true}')).toEqual({
      type: "done",
      result: "",
      sessionId: null,
      isError: true,
    });
  });

  // error event with no message field → "agent error" default.
  it("error event with no message field defaults to 'agent error'", () => {
    expect(parseSseFrame('event: error\ndata: {}')).toEqual({ type: "error", message: "agent error" });
  });
});

describe("HttpDaemonClient.chat() — SSE streaming", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("delivers session, delta, and done events in order", async () => {
    const frames = [
      'event: session\ndata: {"session_id":"sid-1"}\n\n',
      'event: delta\ndata: {"text":"hello"}\n\n',
      'event: done\ndata: {"result":"ok","is_error":false}\n\n',
    ];
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse(frames)));
    const c = new HttpDaemonClient("tok");
    const events: unknown[] = [];
    await c.chat({ message: "hi" }, (e) => events.push(e));
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ type: "session", sessionId: "sid-1" });
    expect(events[1]).toMatchObject({ type: "delta", text: "hello" });
    expect(events[2]).toMatchObject({ type: "done", result: "ok" });
  });

  it("sends the auth token in the request header", async () => {
    const f: FetchMock = vi.fn(async () => streamResponse(['event: done\ndata: {"result":""}\n\n'])) as unknown as FetchMock;
    vi.stubGlobal("fetch", f);
    const c = new HttpDaemonClient("secret");
    await c.chat({ message: "ping" }, () => {});
    const h = f.mock.calls[0][1]?.headers as HeadersMap;
    expect(h["X-OneBrain-Token"]).toBe("secret");
    expect(h["Accept"]).toBe("text/event-stream");
  });

  it("forwards sessionId and model in the POST body", async () => {
    const f: FetchMock = vi.fn(async () => streamResponse(['event: done\ndata: {"result":""}\n\n'])) as unknown as FetchMock;
    vi.stubGlobal("fetch", f);
    const c = new HttpDaemonClient("tok");
    await c.chat({ message: "go", sessionId: "s-1", model: "opus" }, () => {});
    const body = JSON.parse(f.mock.calls[0][1]?.body as string);
    expect(body.session_id).toBe("s-1");
    expect(body.model).toBe("opus");
  });

  it("throws DaemonError on non-2xx from chat endpoint", async () => {
    vi.stubGlobal("fetch", mockFetch(500, { error: "internal" }));
    const c = new HttpDaemonClient("tok");
    await expect(c.chat({ message: "x" }, () => {})).rejects.toBeInstanceOf(DaemonError);
  });

  it("throws DaemonError when the response has no body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      const r = new Response(null, { status: 200 });
      // Force body to null so the guard triggers.
      Object.defineProperty(r, "body", { get: () => null });
      return r;
    }));
    const c = new HttpDaemonClient("tok");
    await expect(c.chat({ message: "x" }, () => {})).rejects.toMatchObject({ status: 0 });
  });

  it("throws DaemonError on network failure before connect", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("net"); }));
    const c = new HttpDaemonClient("tok");
    await expect(c.chat({ message: "x" }, () => {})).rejects.toMatchObject({ status: 0 });
  });

  it("handles SSE frames split across chunks (streaming chunk boundary)", async () => {
    // Two chunks; together they form one complete SSE frame.
    const half1 = 'event: delta\ndata: {"te';
    const half2 = 'xt":"split"}\n\n';
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([half1, half2])));
    const c = new HttpDaemonClient("tok");
    const events: unknown[] = [];
    await c.chat({ message: "x" }, (e) => events.push(e));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "delta", text: "split" });
  });

  it("skips comment/keep-alive frames (no event emitted)", async () => {
    const frames = [
      ': keep-alive\n\n',
      'event: delta\ndata: {"text":"real"}\n\n',
    ];
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse(frames)));
    const c = new HttpDaemonClient("tok");
    const events: unknown[] = [];
    await c.chat({ message: "x" }, (e) => events.push(e));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "delta", text: "real" });
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
