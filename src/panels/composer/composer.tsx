// Composer panel — the slash-command / capture input that anchors the cockpit.
// Typing `/` opens a filtered skill menu; Enter / Run runs the skill (→ Session
// Log + rail pulse), or captures a free-form thought to the log. Ported from the
// prototype (template 1213-1222, wireComposer 2492-2513). The input is
// UNCONTROLLED (a ref) so the Skills rail's cross-panel `compose()` (which sets
// .value directly) keeps working.

import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import type { PanelDef, PanelContext } from "../contract";
import { ALL_SKILLS } from "../skills/skills";
import { runSkill, pushLog } from "../activity";
import "./composer.css";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function Composer(_props: { ctx: PanelContext }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = useSignal<[string, string][]>([]); // open when non-empty

  const closeSlash = () => (matches.value = []);

  const renderSlash = (firstToken: string) => {
    const term = firstToken.replace(/^\//, "").toLowerCase();
    matches.value = ALL_SKILLS.filter(([n]) => n.includes(term)).slice(0, 6);
  };

  const runCommand = () => {
    const input = inputRef.current;
    if (!input) return;
    const v = input.value.trim();
    if (!v) return;
    if (v.startsWith("/")) runSkill(v.slice(1).split(" ")[0]);
    else pushLog("capture", `captured "${esc(v.slice(0, 42))}" → <span class="wl" data-wl="Inbox">[[Inbox]]</span>`);
    input.value = "";
    closeSlash();
  };

  const onInput = (e: Event) => {
    const v = (e.target as HTMLInputElement).value;
    v.startsWith("/") ? renderSlash(v.split(" ")[0]) : closeSlash();
  };

  const pick = (name: string) => {
    const input = inputRef.current;
    if (input) {
      input.value = `/${name} `;
      input.focus();
    }
    closeSlash();
  };

  return (
    <>
      <div class="w-head">
        <span class="pill">
          <span class="dot" />
          // Composer
        </span>
        <span class="w-meta">⌘K</span>
      </div>
      <div class="composer">
        <span class="slash">/</span>
        <input
          ref={inputRef}
          class="cmd-input"
          type="text"
          placeholder="run a skill, or capture a thought…"
          autocomplete="off"
          onInput={onInput}
          onKeyDown={(e) => e.key === "Enter" && runCommand()}
          onBlur={() => setTimeout(closeSlash, 150)}
        />
        <button class="btn-tech" onClick={runCommand}>
          <span>Run</span>
        </button>
      </div>
      <div class={`slash-menu${matches.value.length ? " open" : ""}`}>
        {matches.value.map(([n, d]) => (
          <div class="slash-item" onClick={() => pick(n)}>
            <b>/{n}</b>
            <span>{d}</span>
          </div>
        ))}
      </div>
      <div class="composer-hint">
        Type <kbd>/</kbd> for skills · <kbd>Enter</kbd> to run · dbl-click panel to focus
      </div>
    </>
  );
}

export const composerPanel: PanelDef = {
  type: "composer",
  name: "Composer",
  width: 362,
  placement: { t: 0.06, y: -1.5, r: 5.1, s: 0.005 },
  seed: true,
  Component: Composer,
};
