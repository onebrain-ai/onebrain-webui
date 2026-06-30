// CMS top app bar — the operator-console identity strip: brand lockup, live
// vault stats, clock, a search affordance, and a settings popover (accent +
// density) driven by the DS re-keyable accent system.

import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { vaultTree, allFiles } from "../../panels/bus";
import { toggleSidebar, chatOpen, setChatOpen } from "../../core/stores";
import { Icon } from "../../ui/Icon";
import { SettingsModal } from "./SettingsModal";
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
  return (
    <div class="tb-settings">
      <button
        class="tb-icon-btn"
        type="button"
        aria-label="Settings"
        title="Settings"
        aria-haspopup="dialog"
        aria-expanded={open.value}
        onClick={() => (open.value = true)}
      >
        <Icon name="settings" />
      </button>
      {open.value && <SettingsModal onClose={() => (open.value = false)} />}
    </div>
  );
}

export function Topbar() {
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
        <button
          class={chatOpen.value ? "tb-icon-btn is-active" : "tb-icon-btn"}
          type="button"
          aria-label="Toggle chat"
          title={chatOpen.value ? "Close chat" : "Open chat"}
          aria-pressed={chatOpen.value}
          data-testid="cms-topbar-chat-toggle"
          onClick={() => setChatOpen(!chatOpen.value)}
        >
          <Icon name="chat" />
        </button>
        <Settings />
      </div>
    </header>
  );
}
