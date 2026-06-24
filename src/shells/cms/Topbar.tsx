// CMS top app bar — the operator-console identity strip. Ported idioms from the
// 3D HUD topbar (command-center/hud/topbar.css) but self-contained for the 2D
// shell: brand lockup, live vault stats, clock, a search affordance, and a
// settings popover (accent + density) driven by the DS re-keyable accent system.

import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { vaultTree, allFiles } from "../../panels/bus";
import { ACCENTS, accent, setAccent, toggleSidebar, type AccentName } from "../../core/stores";
import { Icon } from "../../ui/Icon";
import "./topbar.css";

function Clock() {
  const now = useSignal(currentTime());
  useEffect(() => {
    const id = setInterval(() => (now.value = currentTime()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span class="tb-clock">{now.value}</span>;
}

function currentTime(): string {
  return new Date().toLocaleTimeString("en-GB"); // 24h HH:MM:SS
}

function Settings() {
  const open = useSignal(false);
  useEffect(() => {
    if (!open.value) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".tb-settings")) open.value = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") open.value = false;
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open.value]);

  return (
    <div class="tb-settings">
      <button
        class="tb-icon-btn"
        type="button"
        aria-label="Accent color"
        aria-expanded={open.value}
        onClick={() => (open.value = !open.value)}
      >
        <Icon name="settings" />
      </button>
      {open.value && (
        <div class="tb-pop" role="group" aria-label="Accent color">
          <div class="tb-grp">Accent</div>
          <div class="tb-acc-row">
            {(Object.keys(ACCENTS) as AccentName[]).map((name) => (
              <button
                key={name}
                type="button"
                class={`tb-acc${accent.value === name ? " on" : ""}`}
                style={`--sw:${ACCENTS[name]}`}
                aria-label={name}
                onClick={() => setAccent(name)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Topbar({ onSearch }: { onSearch: () => void }) {
  const tree = vaultTree.value; // subscribe → stats refresh when the vault loads
  const files = tree ? allFiles() : [];
  const notes = files.filter((p) => p.toLowerCase().endsWith(".md")).length;
  const inbox = files.filter((p) => p.toLowerCase().startsWith("00-inbox/")).length;

  return (
    <header class="cms-topbar" data-testid="cms-topbar">
      <button
        class="tb-collapse"
        type="button"
        aria-label="Toggle sidebar"
        title="Toggle sidebar"
        data-testid="cms-sidebar-toggle"
        onClick={toggleSidebar}
      >
        <Icon name="panel-left" />
      </button>
      <div class="tb-brand">
        <svg class="tb-mark" viewBox="0 0 433 466" aria-hidden="true">
          <use href="#ob-brain-mark" />
        </svg>
        <span class="tb-word">OneBrain</span>
        <span class="tb-eyebrow">Your AI Thinking Partner</span>
      </div>
      <div class="tb-spacer" />
      <div class="tb-cluster">
        <span class="tb-stat">
          <b>{notes}</b> notes
        </span>
        <span class="tb-div" />
        <span class="tb-stat">
          <b>{inbox}</b> inbox
        </span>
        <span class="tb-div" />
        <Clock />
        <button class="tb-search" type="button" onClick={onSearch} aria-label="Search vault">
          <Icon name="search" />
          <span class="tb-s-lab">Search</span>
          <span class="kbd">⌘K</span>
        </button>
        <Settings />
      </div>
    </header>
  );
}
