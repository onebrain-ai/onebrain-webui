// CLI Console panel — a canned `onebrain` terminal (POC mockup, matching the
// prototype). Enter runs a command: known commands print a scripted response,
// `skill <name>` runs the real skill runner (→ Session Log + rail pulse), `clear`
// resets. Ported from the prototype (template 1260–1264, CLI_BANNER/CLI_CMDS/
// buildCli 2864–2887).

import { useSignal } from "@preact/signals";
import { useRef, useEffect } from "preact/hooks";
import type { PanelDef } from "../contract";
import { runSkill, skillResult } from "../activity";
import "./cli.css";

const BANNER = '<span class="ci-dim">OneBrain CLI 3.2.21 · vault: ob-1 · type a command (try: doctor)</span>';

const CMDS: Record<string, string> = {
  doctor:
    '<span class="ci-cmd">doctor</span>\n<span class="ci-ok">✓</span> vault structure OK · PARA 00–07\n<span class="ci-ok">✓</span> links: 0 broken · 3 orphan notes\n<span class="ci-warn">!</span> inbox backlog: 12 notes — run /consolidate\n<span class="ci-ok">✓</span> memory/: 47 facts · onebrain.yml valid\n<span class="ci-ok">✓</span> qmd index fresh · 1,284 notes embedded',
  "vault sync":
    '<span class="ci-cmd">vault sync</span>\n<span class="ci-dim">scanning 1,284 notes…</span>\n<span class="ci-ok">✓</span> synced · 6 changed · 0 conflicts',
  "qmd status":
    '<span class="ci-cmd">qmd status</span>\nindex: <span class="ci-acc">ready</span> · model bge-small · 1,284 docs\nmode: lex+vec+hyde · last reindex 2026-06-03 09:02',
  "schedule list":
    '<span class="ci-cmd">schedule list</span>\n<span class="ci-acc">daily</span>        08:00      → /daily\n<span class="ci-acc">weekly</span>       Fri 17:00  → /weekly\n<span class="ci-acc">consolidate</span>  21:00      → /consolidate',
  session: '<span class="ci-cmd">session</span>\nactive · started 09:14 · 5 skills run · 6 logs',
  help: '<span class="ci-cmd">help</span>\ncommands: doctor · vault sync · qmd status · schedule list · session · skill &lt;name&gt; · version · clear',
  version: '<span class="ci-cmd">version</span>\nonebrain 3.2.21',
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function Cli() {
  const lines = useSignal<string[]>([BANNER]);
  const draft = useSignal("");
  const outRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.value]);

  const print = (html: string) => (lines.value = [...lines.value, html]);

  const run = (raw: string) => {
    const cmd = raw.trim();
    if (!cmd) return;
    if (cmd === "clear") {
      lines.value = [BANNER];
      return;
    }
    const m = /^skill\s+(\S+)/.exec(cmd);
    if (m) {
      const n = m[1];
      const res = skillResult(n).replace(/<[^>]+>/g, ""); // strip the result's HTML for the terminal
      print(`<span class="ci-cmd">${esc(cmd)}</span>\n<span class="ci-ok">✓</span> ran /${esc(n)} · ${esc(res)}`);
      runSkill(n);
      return;
    }
    const key = cmd.replace(/\s+/g, " ");
    print(
      CMDS[key] ||
        `<span class="ci-cmd">${esc(cmd)}</span>\n<span class="ci-warn">unknown command</span> · try: doctor · qmd status · help`,
    );
  };

  return (
    <>
      <div class="w-head">
        <span class="pill">
          <span class="dot" />
          onebrain · CLI
        </span>
        <span class="w-meta">v3.2.21</span>
      </div>
      <div class="cli-out" ref={outRef}>
        {lines.value.map((html) => (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ))}
      </div>
      <div class="cli-line">
        <span class="cli-ps">onebrain ❯</span>
        <input
          class="cli-in"
          type="text"
          placeholder="doctor · vault sync · qmd status · schedule list"
          autocomplete="off"
          spellcheck={false}
          value={draft.value}
          onInput={(e) => (draft.value = (e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              run(draft.value);
              draft.value = "";
            }
          }}
        />
      </div>
    </>
  );
}

export const cliPanel: PanelDef = {
  type: "cli",
  name: "CLI Console",
  width: 414,
  placement: { t: 1.95, y: 0.4, r: 6.8, s: 0.005 },
  seed: false, // not in the SEED arc; spawn via add-panel / ⌘K
  Component: Cli,
};
