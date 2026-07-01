import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/preact";

// Mock runSkill so we don't touch the real activity bus in skill-execution tests.
vi.mock("../activity", () => ({
  runSkill: vi.fn(),
}));

import { skillsPanel, SKILLS, ALL_SKILLS } from "./skills";
import { runSkill } from "../activity";

const { Component: Skills } = skillsPanel;

describe("Skills panel — static data", () => {
  it("ALL_SKILLS is the flat union of every group", () => {
    const flat = SKILLS.flatMap(([, items]) => items);
    expect(ALL_SKILLS).toEqual(flat);
  });

  it("has 5 groups", () => {
    expect(SKILLS).toHaveLength(5);
  });
});

describe("Skills panel — render", () => {
  it("renders the pill with the correct skill count", () => {
    render(<Skills ctx={{} as any} />);
    expect(screen.getByText(`Skills · ${ALL_SKILLS.length}`)).toBeTruthy();
    expect(screen.getByText("RAIL")).toBeTruthy();
  });

  it("renders all group headings", () => {
    render(<Skills ctx={{} as any} />);
    for (const [grp] of SKILLS) {
      expect(screen.getByText(grp)).toBeTruthy();
    }
  });

  it("renders a row for every skill with its slash-prefix and blurb", () => {
    render(<Skills ctx={{} as any} />);
    for (const [name, blurb] of ALL_SKILLS) {
      expect(screen.getByText(`/${name}`)).toBeTruthy();
      expect(screen.getByText(blurb)).toBeTruthy();
    }
  });
});

describe("Skills panel — single-click compose", () => {
  beforeEach(() => {
    // compose() queries the real DOM for .w-composer .cmd-input — provide a stub
    const input = document.createElement("input");
    input.className = "cmd-input";
    const composer = document.createElement("div");
    composer.className = "w-composer";
    composer.appendChild(input);
    document.body.appendChild(composer);
  });

  afterEach(() => {
    document.querySelector(".w-composer")?.remove();
  });

  it("single-click sets the composer input value to /name (with trailing space)", () => {
    render(<Skills ctx={{} as any} />);
    // click the first skill row
    const [firstName] = ALL_SKILLS[0];
    fireEvent.click(screen.getByText(`/${firstName}`));
    const input = document.querySelector<HTMLInputElement>(".w-composer .cmd-input")!;
    expect(input.value).toBe(`/${firstName} `);
  });

  it("single-click when no composer input present does not throw", () => {
    document.querySelector(".w-composer")?.remove(); // remove the stub
    render(<Skills ctx={{} as any} />);
    expect(() => fireEvent.click(screen.getByText(`/${ALL_SKILLS[0][0]}`))).not.toThrow();
  });
});

describe("Skills panel — double-click run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("double-click calls runSkill with the skill name", () => {
    render(<Skills ctx={{} as any} />);
    const [firstName] = ALL_SKILLS[0];
    fireEvent.dblClick(screen.getByText(`/${firstName}`).closest(".skill-row")!);
    expect(runSkill).toHaveBeenCalledWith(firstName);
  });

  it("double-click adds run-flash class then removes it after 420ms", () => {
    render(<Skills ctx={{} as any} />);
    const [firstName] = ALL_SKILLS[0];
    const row = screen.getByText(`/${firstName}`).closest(".skill-row")! as HTMLElement;
    fireEvent.dblClick(row);
    expect(row.classList.contains("run-flash")).toBe(true);
    vi.advanceTimersByTime(420);
    expect(row.classList.contains("run-flash")).toBe(false);
  });
});
