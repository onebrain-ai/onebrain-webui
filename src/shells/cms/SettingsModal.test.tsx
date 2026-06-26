import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/preact";
import { SettingsModal } from "./SettingsModal";
import { vaultConfig } from "../../panels/bus";
import { density, accent, theme } from "../../core/stores";

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
});
