import { describe, it, expect } from "vitest";
import { ConflictError, DaemonError } from "./types";

describe("ConflictError", () => {
  it("is a DaemonError carrying the server's current rev", () => {
    const e = new ConflictError("rev mismatch", "123456");
    expect(e).toBeInstanceOf(DaemonError);
    expect(e.status).toBe(409);
    expect(e.rev).toBe("123456");
  });
});
