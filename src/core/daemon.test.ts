import { describe, it, expect, vi, beforeEach, type MockedFunction } from "vitest";
import { HttpDaemonClient } from "./daemon";
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
