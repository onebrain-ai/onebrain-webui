// HUD top app bar — brand wordmark + live clock + node/FPS status + search /
// settings affordances. Ported from the prototype (markup 968–990, CSS 832–938).
// Clock + FPS come from the HUD store (engine-driven). Search (⌘K) and Settings
// open their panels in a later milestone — the buttons are present now.

import { fps, clock } from "./store";
import "./topbar.css";

export function TopBar() {
  return (
    <div id="topbar">
      <div class="tb-brand">
        <svg class="ob-mark" aria-hidden="true">
          <use href="#ob-brain-mark" />
        </svg>
        <span class="tb-word">OneBrain</span>
        <span class="tb-eyebrow">Command Center</span>
      </div>
      <div class="tb-spacer" />
      <div class="tb-cluster">
        <span class="tb-clock">{clock.value}</span>
        <span class="tb-div" />
        <span class="tb-stat">
          NODE · NET <b class="ok">ONLINE</b> · FPS <b>{fps.value}</b>
        </span>
        <span class="tb-div" />
        <button id="tb-search" type="button" aria-label="Open command palette (Cmd K)">
          <svg viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <span class="tb-s-lab">Search</span>
          <span class="kbd">⌘K</span>
        </button>
        <button id="settings-btn" type="button" aria-label="Settings">
          <svg viewBox="0 0 24 24">
            <line x1="21" x2="14" y1="4" y2="4" />
            <line x1="10" x2="3" y1="4" y2="4" />
            <line x1="21" x2="12" y1="12" y2="12" />
            <line x1="8" x2="3" y1="12" y2="12" />
            <line x1="21" x2="16" y1="20" y2="20" />
            <line x1="12" x2="3" y1="20" y2="20" />
            <line x1="14" x2="14" y1="2" y2="6" />
            <line x1="8" x2="8" y1="10" y2="14" />
            <line x1="16" x2="16" y1="18" y2="22" />
          </svg>
          <span class="hud-lab">Settings</span>
        </button>
      </div>
    </div>
  );
}
