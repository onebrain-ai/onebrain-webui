import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/preact";
import { SettingsModal } from "./SettingsModal";
import { vaultConfig } from "../../panels/bus";
import {
  density,
  accent,
  theme,
  htmlAutorun,
  mediaAutoplay,
  settingsCategory,
} from "../../core/stores";

// A minimal, resolvable changelog so any WhatsNew mount settles cleanly. Uses a
// version distinct from __APP_VERSION__ so the "What's new" version and the
// About version row never collide in text queries.
const SAMPLE_CHANGELOG = {
  latest: "9.9.9",
  released: "2026-07-01",
  entries: [{ version: "9.9.9", date: "2026-07-01", markdown: "### Added\n\n- **Sample feature.** details" }],
};

function stubChangelog(data: unknown = SAMPLE_CHANGELOG) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => data })));
}

/** Open the About pane (mounts WhatsNew) and wait for its fetch to settle. */
async function openAboutAndSettle() {
  fireEvent.click(screen.getByRole("tab", { name: "About" }));
  await waitFor(() => expect(screen.queryByText("Loading…")).toBeNull());
}

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
    settingsCategory.value = "appearance";
    stubChangelog();
  });
  afterEach(() => vi.unstubAllGlobals());

  // ── Shell + navigation ─────────────────────────────────────────────────────
  it("opens on the Appearance pane with its controls", () => {
    render(<SettingsModal onClose={() => {}} />);
    expect(screen.getByTestId("settings-modal")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Appearance" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("cyan")).toBeTruthy();
    expect(screen.getByText("Comfortable")).toBeTruthy();
    expect(screen.getByText("Compact")).toBeTruthy();
  });

  it("clicking a category tab switches the pane (Vault → read-only config)", () => {
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Vault" }));
    expect(screen.getByText("qmd collection")).toBeTruthy();
    expect(screen.getByText("test-vault")).toBeTruthy();
    expect(screen.getByText("01-projects")).toBeTruthy();
    expect(screen.getByText(/Read-only/)).toBeTruthy();
    expect(settingsCategory.value).toBe("vault");
  });

  it("Preview pane exposes the HTML + media toggles", () => {
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByRole("group", { name: "Run HTML scripts" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Auto-play media" })).toBeTruthy();
  });

  it("ArrowDown moves selection to the next category and focuses it", () => {
    render(<SettingsModal onClose={() => {}} />);
    const appearance = screen.getByRole("tab", { name: "Appearance" });
    fireEvent.keyDown(appearance, { key: "ArrowDown" });
    expect(settingsCategory.value).toBe("preview");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Preview" }));
  });

  it("ArrowUp wraps from the first category to the last", () => {
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Appearance" }), { key: "ArrowUp" });
    expect(settingsCategory.value).toBe("about");
  });

  it("Home and End jump to the first / last category", () => {
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Appearance" }), { key: "End" });
    expect(settingsCategory.value).toBe("about");
    fireEvent.keyDown(screen.getByRole("tab", { name: "About" }), { key: "Home" });
    expect(settingsCategory.value).toBe("appearance");
  });

  it("a non-navigation key on a tab is ignored", () => {
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Appearance" }), { key: "a" });
    expect(settingsCategory.value).toBe("appearance");
  });

  // ── Search ─────────────────────────────────────────────────────────────────
  it("searching shows results while the active category tab stays selected + focusable", () => {
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.input(screen.getByLabelText("Search settings"), { target: { value: "media" } });
    expect(screen.getByText("Results")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Auto-play media" })).toBeTruthy();
    // roving-tabindex invariant: exactly one tab stays selected + tabbable
    const appearance = screen.getByRole("tab", { name: "Appearance" });
    expect(appearance.getAttribute("aria-selected")).toBe("true");
    expect(appearance.getAttribute("tabindex")).toBe("0");
    // the panel is labelled as search results, not by a category tab
    expect(screen.getByRole("tabpanel").getAttribute("aria-label")).toBe("Search results");
  });

  it("a single match uses the singular 'setting' label", () => {
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.input(screen.getByLabelText("Search settings"), { target: { value: "density" } });
    expect(screen.getByText(/1 setting matching/)).toBeTruthy();
  });

  it("multiple matches use the plural 'settings' label", () => {
    render(<SettingsModal onClose={() => {}} />);
    // "colour" is a keyword on both Theme and Accent
    fireEvent.input(screen.getByLabelText("Search settings"), { target: { value: "colour" } });
    expect(screen.getByText(/2 settings matching/)).toBeTruthy();
  });

  it("a query with no matches shows the empty state", () => {
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.input(screen.getByLabelText("Search settings"), { target: { value: "zzzzzz" } });
    expect(screen.getByText(/No settings match/)).toBeTruthy();
  });

  it("clicking a tab clears an active search query", () => {
    render(<SettingsModal onClose={() => {}} />);
    const box = screen.getByLabelText("Search settings") as HTMLInputElement;
    fireEvent.input(box, { target: { value: "density" } });
    expect(screen.getByText("Results")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(box.value).toBe("");
    expect(screen.queryByText("Results")).toBeNull();
  });

  // ── Appearance controls ────────────────────────────────────────────────────
  it("theme toggle switches light/dark and applies data-theme", () => {
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByText("Light"));
    expect(theme.value).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    fireEvent.click(screen.getByText("Dark"));
    expect(theme.value).toBe("dark");
  });

  it("density toggle updates the store both ways", () => {
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByText("Compact"));
    expect(density.value).toBe("compact");
    fireEvent.click(screen.getByText("Comfortable"));
    expect(density.value).toBe("comfortable");
  });

  it("accent swatch updates the store and marks the active one", () => {
    accent.value = "amber";
    render(<SettingsModal onClose={() => {}} />);
    expect(screen.getByLabelText("amber").className).toContain("on");
    expect(screen.getByLabelText("cyan").className).not.toContain("on");
    fireEvent.click(screen.getByLabelText("violet"));
    expect(accent.value).toBe("violet");
  });

  it("theme buttons expose aria-pressed for the active scheme", () => {
    theme.value = "light";
    render(<SettingsModal onClose={() => {}} />);
    expect(screen.getByText("Light").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Dark").getAttribute("aria-pressed")).toBe("false");
  });

  // ── Preview controls ───────────────────────────────────────────────────────
  it("htmlAutorun On/Off toggles the store", () => {
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    const group = screen.getByRole("group", { name: "Run HTML scripts" });
    fireEvent.click(group.querySelector("button:last-child") as HTMLElement);
    expect(htmlAutorun.value).toBe(true);
    fireEvent.click(group.querySelector("button:first-child") as HTMLElement);
    expect(htmlAutorun.value).toBe(false);
  });

  it("mediaAutoplay On/Off toggles the store and reflects aria-pressed", () => {
    mediaAutoplay.value = true;
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    const group = screen.getByRole("group", { name: "Auto-play media" });
    expect((group.querySelector("button:last-child") as HTMLElement).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(group.querySelector("button:first-child") as HTMLElement);
    expect(mediaAutoplay.value).toBe(false);
  });

  // ── Vault (ConfigView) permutations ────────────────────────────────────────
  it("shows an empty state when no config is loaded", () => {
    vaultConfig.value = null;
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Vault" }));
    expect(screen.getByText("No vault config loaded.")).toBeTruthy();
  });

  it("shows recap + scheduled-jobs rows when present", () => {
    vaultConfig.value = {
      ...vaultConfig.value!,
      recap: { min_sessions: 5, min_frequency: 7 },
      schedule: ["job1", "job2"],
    } as any;
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Vault" }));
    expect(screen.getByText(/5 sessions/)).toBeTruthy();
    expect(screen.getByText("Scheduled jobs")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("recap row renders with only min_sessions, and again with only min_frequency", () => {
    vaultConfig.value = { ...vaultConfig.value!, recap: { min_sessions: 3 } } as any;
    const { unmount } = render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Vault" }));
    expect(screen.getByText(/3 sessions/)).toBeTruthy();
    unmount();

    vaultConfig.value = { ...vaultConfig.value!, recap: { min_frequency: 14 } } as any;
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Vault" }));
    expect(screen.getByText(/every 14/)).toBeTruthy();
  });

  it("checkpoint row renders with only messages, and again with only minutes", () => {
    vaultConfig.value = {
      qmd_collection: "v",
      update_channel: "stable",
      folders: {},
      checkpoint: { messages: 10, minutes: null as any },
    };
    const { unmount } = render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Vault" }));
    expect(screen.getByText(/10 msgs/)).toBeTruthy();
    unmount();

    vaultConfig.value = {
      qmd_collection: "v",
      update_channel: "stable",
      folders: {},
      checkpoint: { messages: null as any, minutes: 20 },
    };
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Vault" }));
    expect(screen.getByText(/20 min/)).toBeTruthy();
  });

  it("numeric update_channel renders; non-string update_channel is skipped", () => {
    vaultConfig.value = { qmd_collection: "v", update_channel: 42 as any, folders: {} } as any;
    const { unmount } = render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Vault" }));
    expect(screen.getByText("42")).toBeTruthy();
    unmount();

    vaultConfig.value = { qmd_collection: "vault", update_channel: null as any, folders: {} } as any;
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Vault" }));
    expect(screen.queryByText("Update channel")).toBeNull();
  });

  it("no qmd_collection skips that row; empty/undefined folders render no grid", () => {
    vaultConfig.value = { update_channel: "stable", folders: {} } as any;
    const { unmount } = render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Vault" }));
    expect(screen.queryByText("qmd collection")).toBeNull();
    expect(document.querySelector(".st-folders")).toBeNull();
    unmount();

    vaultConfig.value = { qmd_collection: "v", update_channel: "stable" } as any;
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Vault" }));
    expect(document.querySelector(".st-folders")).toBeNull();
  });

  // ── About + What's new ─────────────────────────────────────────────────────
  it("About shows the WebUI version and a Connected daemon when config is loaded", async () => {
    render(<SettingsModal onClose={() => {}} />);
    await openAboutAndSettle();
    expect(screen.getByTestId("st-version").textContent).toMatch(/^v\d+\.\d+\.\d+/);
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("Full changelog →")).toBeTruthy();
  });

  it("About shows a Connecting daemon when no config is loaded", async () => {
    vaultConfig.value = null;
    render(<SettingsModal onClose={() => {}} />);
    await openAboutAndSettle();
    expect(screen.getByText("Connecting…")).toBeTruthy();
  });

  it("What's new renders the latest changelog entry (version + date + body)", async () => {
    stubChangelog();
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "About" }));
    expect(await screen.findByText("v9.9.9")).toBeTruthy();
    expect(screen.getByText("2026-07-01")).toBeTruthy();
    expect(screen.getByText(/Sample feature/)).toBeTruthy();
  });

  it("What's new shows a loading state before the fetch resolves", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))); // never resolves
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "About" }));
    expect(screen.getByText("Loading…")).toBeTruthy();
  });

  it("What's new shows 'No changelog yet' when the changelog has no entries", async () => {
    stubChangelog({ latest: null, released: null, entries: [] });
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "About" }));
    expect(await screen.findByText("No changelog yet.")).toBeTruthy();
  });

  it("What's new omits the date when the entry has none", async () => {
    stubChangelog({ latest: "0.0.1", released: null, entries: [{ version: "0.0.1", date: null, markdown: "- x" }] });
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "About" }));
    expect(await screen.findByText("v0.0.1")).toBeTruthy();
    expect(document.querySelector(".st-wn-date")).toBeNull();
  });

  it("What's new shows an error note when the changelog request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "About" }));
    expect(await screen.findByText("Couldn’t load the changelog.")).toBeTruthy();
  });

  it("aborts the in-flight changelog fetch when About unmounts", () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
        if (init?.signal) signals.push(init.signal);
        return new Promise(() => {}); // never settles → stays in-flight until abort
      }),
    );
    const { unmount } = render(<SettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "About" }));
    expect(signals[0].aborted).toBe(false);
    unmount(); // effect cleanup calls ac.abort()
    expect(signals[0].aborted).toBe(true);
  });

  // ── Shell interactions ─────────────────────────────────────────────────────
  it("Done button calls onClose", () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.click(screen.getByText("Done"));
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape key calls onClose", () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("Tab key triggers trapFocus without throwing", () => {
    render(<SettingsModal onClose={() => {}} />);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByTestId("settings-modal")).toBeTruthy();
  });

  it("a non-Escape / non-Tab keydown does not close the modal", () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("mousedown on the backdrop closes; mousedown on an inner element does not", () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);
    const backdrop = document.querySelector(".ob-modal-backdrop") as HTMLElement;
    fireEvent.mouseDown(backdrop, { target: backdrop });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(screen.getByTestId("settings-modal"));
    expect(onClose).toHaveBeenCalledTimes(1); // unchanged
  });
});
