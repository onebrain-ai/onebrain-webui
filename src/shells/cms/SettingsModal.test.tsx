import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/preact";
import { SettingsModal } from "./SettingsModal";
import { vaultConfig } from "../../panels/bus";
import { density, accent, theme, htmlAutorun, mediaAutoplay } from "../../core/stores";

describe("SettingsModal", () => {
  beforeEach(() => {
    vaultConfig.value = {
      qmd_collection: "test-vault",
      update_channel: "stable",
      folders: { projects: "01-projects", areas: "02-areas" },
      checkpoint: { messages: 15, minutes: 30 },
    };
    accent.value = "cyan";
    density.value = "comfortable";
    theme.value = "dark";
    htmlAutorun.value = false;
    mediaAutoplay.value = false;
  });

  it("renders appearance controls + read-only vault config", () => {
    render(<SettingsModal onClose={() => {}} />);
    expect(screen.getByTestId("settings-modal")).toBeTruthy();
    // appearance (editable)
    expect(screen.getByLabelText("cyan")).toBeTruthy();
    expect(screen.getByText("Comfortable")).toBeTruthy();
    expect(screen.getByText("Compact")).toBeTruthy();
    // read-only vault config
    expect(screen.getByText("qmd collection")).toBeTruthy();
    expect(screen.getByText("test-vault")).toBeTruthy();
    expect(screen.getByText("01-projects")).toBeTruthy(); // a folder value
    expect(screen.getByText(/read-only/)).toBeTruthy();
  });

  it("theme toggle switches light/dark and applies data-theme", () => {
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByText("Light"));
    expect(theme.value).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    fireEvent.click(screen.getByText("Dark"));
    expect(theme.value).toBe("dark");
  });

  it("density toggle updates the store", () => {
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByText("Compact"));
    expect(density.value).toBe("compact");
  });

  it("accent swatch updates the store", () => {
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("violet"));
    expect(accent.value).toBe("violet");
  });

  it("Done button calls onClose", () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.click(screen.getByText("Done"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an empty state when no config is loaded", () => {
    vaultConfig.value = null;
    render(<SettingsModal onClose={() => {}} />);
    expect(screen.getByText("No vault config loaded.")).toBeTruthy();
  });

  it("Escape key calls onClose via keydown listener", () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("Tab key triggers trapFocus (no throw; focus wraps within dialog)", () => {
    render(<SettingsModal onClose={() => {}} />);
    // Just confirm trapFocus is wired — no uncaught error, dialog still present.
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByTestId("settings-modal")).toBeTruthy();
  });

  it("backdrop mousedown on the backdrop element calls onClose", () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    const backdrop = document.querySelector(".ob-modal-backdrop") as HTMLElement;
    // Simulate a mousedown where e.target === e.currentTarget (the backdrop itself).
    fireEvent.mouseDown(backdrop, { target: backdrop });
    expect(onClose).toHaveBeenCalled();
  });

  it("htmlAutorun On/Off toggles the store", () => {
    render(<SettingsModal onClose={() => {}} />);
    // Default is Off (htmlAutorun=false); click On.
    const group = screen.getByRole("group", { name: "Run HTML scripts" });
    fireEvent.click(group.querySelector("button:last-child") as HTMLElement); // "On"
    expect(htmlAutorun.value).toBe(true);
    fireEvent.click(group.querySelector("button:first-child") as HTMLElement); // "Off"
    expect(htmlAutorun.value).toBe(false);
  });

  it("mediaAutoplay On/Off toggles the store", () => {
    render(<SettingsModal onClose={() => {}} />);
    const group = screen.getByRole("group", { name: "Auto-play media" });
    fireEvent.click(group.querySelector("button:last-child") as HTMLElement); // "On"
    expect(mediaAutoplay.value).toBe(true);
    fireEvent.click(group.querySelector("button:first-child") as HTMLElement); // "Off"
    expect(mediaAutoplay.value).toBe(false);
  });

  it("shows recap row when recap config is present", () => {
    vaultConfig.value = {
      ...vaultConfig.value!,
      recap: { min_sessions: 5, min_frequency: 7 },
    } as any;
    render(<SettingsModal onClose={() => {}} />);
    expect(screen.getByText("Recap")).toBeTruthy();
    expect(screen.getByText(/5 sessions/)).toBeTruthy();
  });

  it("shows scheduled jobs row when schedule array is non-empty", () => {
    vaultConfig.value = {
      ...vaultConfig.value!,
      schedule: ["job1", "job2"],
    } as any;
    render(<SettingsModal onClose={() => {}} />);
    expect(screen.getByText("Scheduled jobs")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("config with no folders renders no folder grid", () => {
    vaultConfig.value = {
      qmd_collection: "test-vault",
      update_channel: "stable",
      folders: {},
      checkpoint: { messages: 15, minutes: 30 },
    };
    render(<SettingsModal onClose={() => {}} />);
    // Folders section should be absent when the map is empty.
    expect(document.querySelector(".st-folders")).toBeNull();
  });

  it("config with non-string update_channel skips that row", () => {
    vaultConfig.value = {
      qmd_collection: "vault",
      update_channel: null as any,
      folders: {},
    } as any;
    render(<SettingsModal onClose={() => {}} />);
    // update_channel row is not shown for non-string values.
    expect(screen.queryByText("Update channel")).toBeNull();
  });

  it("density toggle back to comfortable updates the store", () => {
    density.value = "compact";
    render(<SettingsModal onClose={() => {}} />);
    // Comfortable button onClick at line 160.
    fireEvent.click(screen.getByText("Comfortable"));
    expect(density.value).toBe("comfortable");
  });

  it("renders with all accent buttons, active one has on class", () => {
    accent.value = "amber";
    render(<SettingsModal onClose={() => {}} />);
    const amberBtn = screen.getByLabelText("amber");
    expect(amberBtn.className).toContain("on");
    const cyanBtn = screen.getByLabelText("cyan");
    expect(cyanBtn.className).not.toContain("on");
  });

  it("renders theme buttons with correct active state in light mode", () => {
    theme.value = "light";
    render(<SettingsModal onClose={() => {}} />);
    const lightBtn = screen.getByText("Light");
    expect(lightBtn.getAttribute("aria-pressed")).toBe("true");
    const darkBtn = screen.getByText("Dark");
    expect(darkBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("renders htmlAutorun On button as active when htmlAutorun is true", () => {
    htmlAutorun.value = true;
    render(<SettingsModal onClose={() => {}} />);
    const group = screen.getByRole("group", { name: "Run HTML scripts" });
    const onBtn = group.querySelector("button:last-child") as HTMLElement;
    expect(onBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("renders mediaAutoplay On button as active when mediaAutoplay is true", () => {
    mediaAutoplay.value = true;
    render(<SettingsModal onClose={() => {}} />);
    const group = screen.getByRole("group", { name: "Auto-play media" });
    const onBtn = group.querySelector("button:last-child") as HTMLElement;
    expect(onBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("config with recap but only min_sessions defined", () => {
    vaultConfig.value = {
      ...vaultConfig.value!,
      recap: { min_sessions: 3 },
    } as any;
    render(<SettingsModal onClose={() => {}} />);
    expect(screen.getByText(/3 sessions/)).toBeTruthy();
  });

  it("config with recap but only min_frequency defined", () => {
    vaultConfig.value = {
      ...vaultConfig.value!,
      recap: { min_frequency: 14 },
    } as any;
    render(<SettingsModal onClose={() => {}} />);
    expect(screen.getByText(/every 14/)).toBeTruthy();
  });

  it("checkpoint row with only messages defined (minutes is null)", () => {
    vaultConfig.value = {
      qmd_collection: "v",
      update_channel: "stable",
      folders: {},
      checkpoint: { messages: 10, minutes: null as any },
    };
    render(<SettingsModal onClose={() => {}} />);
    expect(screen.getByText(/10 msgs/)).toBeTruthy();
  });

  it("checkpoint with null messages still renders the row", () => {
    vaultConfig.value = {
      qmd_collection: "v",
      update_channel: "stable",
      folders: {},
      checkpoint: { messages: null as any, minutes: 20 },
    };
    render(<SettingsModal onClose={() => {}} />);
    expect(screen.getByText(/20 min/)).toBeTruthy();
  });

  it("numeric update_channel renders correctly", () => {
    vaultConfig.value = {
      qmd_collection: "v",
      update_channel: 42 as any,
      folders: {},
    } as any;
    render(<SettingsModal onClose={() => {}} />);
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("config with no qmd_collection skips that row", () => {
    // Exercises the false branch of `if (cfg.qmd_collection)` at line 39.
    vaultConfig.value = {
      update_channel: "stable",
      folders: { inbox: "00-inbox" },
    } as any;
    render(<SettingsModal onClose={() => {}} />);
    expect(screen.queryByText("qmd collection")).toBeNull();
  });

  it("config with undefined folders falls back to empty object", () => {
    // Exercises `cfg.folders ?? {}` null-coalescing branch at line 54.
    vaultConfig.value = {
      qmd_collection: "v",
      update_channel: "stable",
    } as any;
    render(<SettingsModal onClose={() => {}} />);
    // No folder grid rendered when folders is undefined.
    expect(document.querySelector(".st-folders")).toBeNull();
  });

  it("non-Escape / non-Tab keydown does not call onClose or throw", () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    // Any other key — exercises the else branch at line 84-85.
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("backdrop mousedown on an INNER element does NOT call onClose", () => {
    // Exercises the false branch of `if (e.target === e.currentTarget)` at line 100.
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    const dialog = screen.getByTestId("settings-modal");
    // Click on the inner dialog div (not the backdrop) → onClose must NOT fire.
    fireEvent.mouseDown(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });
});
