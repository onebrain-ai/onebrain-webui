// Skills Rail panel — the grouped skill catalogue. Single-click drops a skill
// into the Composer input (compose, don't run); double-click runs it (→ Session
// Log + rail pulse). Exports SKILLS / ALL_SKILLS for ⌘K. Ported from the
// prototype (template 1224–1227, SKILLS 2366–2372, fillSkills 2443–2455).

import type { PanelDef } from "../contract";
import { runSkill } from "../activity";
import "./skills.css";

/** [group, [skill, blurb][]][] — display order. */
export const SKILLS: [string, [string, string][]][] = [
  [
    "CAPTURE",
    [
      ["capture", "note + links"],
      ["braindump", "thought stream"],
      ["bookmark", "save a URL"],
      ["summarize", "read a URL"],
      ["reading-notes", "process a book"],
    ],
  ],
  [
    "EVOLVE",
    [
      ["consolidate", "process inbox"],
      ["connect", "find links"],
      ["distill", "synthesize"],
      ["moc", "map of content"],
      ["learn", "teach a fact"],
      ["memory-review", "prune memory"],
      ["reorganize", "restructure vault"],
    ],
  ],
  [
    "RHYTHM",
    [
      ["daily", "today briefing"],
      ["weekly", "week review"],
      ["recap", "promote insights"],
      ["tasks", "task board"],
      ["schedule", "add routine"],
      ["pause", "snapshot work"],
    ],
  ],
  [
    "RESEARCH",
    [
      ["research", "web research"],
      ["import", "bulk import"],
      ["qmd", "search index"],
      ["clone", "copy a note"],
    ],
  ],
  [
    "SYSTEM",
    [
      ["doctor", "vault health"],
      ["update", "pull latest"],
      ["onboarding", "first-run"],
      ["resume", "continue"],
      ["help", "all commands"],
      ["schedule-list", "list routines"],
      ["wrapup", "save session"],
    ],
  ],
];

/** flat [skill, blurb][] — ⌘K's "Run skill" group reads this. */
export const ALL_SKILLS: [string, string][] = SKILLS.flatMap(([, items]) => items);

/** drop `/name ` into the Composer input (compose, don't run). */
function compose(name: string): void {
  const ci = document.querySelector<HTMLInputElement>("#css3d .w-composer .cmd-input");
  if (ci) {
    ci.value = `/${name} `;
    ci.focus();
  }
}

function runFlash(e: MouseEvent, name: string): void {
  const row = e.currentTarget as HTMLElement;
  row.classList.add("run-flash");
  setTimeout(() => row.classList.remove("run-flash"), 420);
  runSkill(name);
}

function Skills() {
  return (
    <>
      <div class="w-head">
        <span class="pill">
          <span class="dot" />
          Skills · {ALL_SKILLS.length}
        </span>
        <span class="w-meta">RAIL</span>
      </div>
      <div class="skill-scroll">
        {SKILLS.map(([grp, items]) => (
          <>
            <div class="skill-grp">{grp}</div>
            {items.map(([n, d]) => (
              <div
                class="skill-row"
                title={`Click to compose · double-click to run /${n}`}
                onClick={() => compose(n)}
                onDblClick={(e) => runFlash(e, n)}
              >
                <span class="sd" />
                <span class="sn">/{n}</span>
                <span class="sx">{d}</span>
              </div>
            ))}
          </>
        ))}
      </div>
    </>
  );
}

export const skillsPanel: PanelDef = {
  type: "skills",
  name: "Skills Rail",
  width: 300,
  placement: { t: -1.95, y: 0.42, r: 7.0, s: 0.005 },
  seed: false, // not in the SEED arc; spawn via add-panel / ⌘K
  Component: Skills,
};
