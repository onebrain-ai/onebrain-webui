import { describe, it, expect } from "vitest";
import { ConflictError, DaemonError } from "./types";

describe("DaemonError", () => {
  it("stores the status code and message, sets name", () => {
    const e = new DaemonError(503, "service unavailable");
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(503);
    expect(e.message).toBe("service unavailable");
    expect(e.name).toBe("DaemonError");
  });

  it("status 0 represents a network-level failure (daemon unreachable)", () => {
    const e = new DaemonError(0, "cannot reach the daemon");
    expect(e.status).toBe(0);
  });
});

describe("ConflictError", () => {
  it("is a DaemonError carrying the server's current rev", () => {
    const e = new ConflictError("rev mismatch", "123456");
    expect(e).toBeInstanceOf(DaemonError);
    expect(e.status).toBe(409);
    expect(e.rev).toBe("123456");
    expect(e.name).toBe("ConflictError");
  });

  it("allows rev=null when the server body has no rev field", () => {
    const e = new ConflictError("conflict", null);
    expect(e.rev).toBeNull();
    expect(e.status).toBe(409);
  });
});
