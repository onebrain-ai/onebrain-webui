import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/preact";
import { ModeRouter } from "./ModeRouter";
import { setMode } from "../core/stores";

vi.mock("./command-center/engine", () => ({ startCommandCenter: vi.fn(() => ({})) }));

const daemon = {} as any;

describe("ModeRouter", () => {
  it("renders the CMS shell when mode is cms", () => {
    setMode("cms");
    render(<ModeRouter daemon={daemon} />);
    expect(screen.getByTestId("cms-shell")).toBeTruthy();
  });
});
