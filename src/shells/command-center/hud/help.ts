// Controls help sheet — the collapsible shortcut reference, toggled by the corner
// button, the H key (via input.ts onHelp), or ⌘K. The sheet swaps Explore/Focus
// hint grids via body.focusmode (pure CSS). Ported from the prototype (help DOM
// 1030–1080, JS 2114–2116, CSS 614–663).

import "./help.css";

export interface Help {
  toggle(): void;
  dispose(): void;
}

export function createHelp(): Help {
  const root = document.getElementById("help");
  const btn = document.getElementById("help-btn");
  if (!root) return { toggle() {}, dispose() {} };

  const toggle = () => root.classList.toggle("open");
  const onBtn = (e: MouseEvent) => {
    e.stopPropagation();
    toggle();
  };
  const onRoot = (e: MouseEvent) => e.stopPropagation();
  const onDoc = () => root.classList.remove("open");
  btn?.addEventListener("click", onBtn);
  root.addEventListener("click", onRoot);
  document.addEventListener("click", onDoc);

  return {
    toggle,
    dispose() {
      btn?.removeEventListener("click", onBtn);
      root.removeEventListener("click", onRoot);
      document.removeEventListener("click", onDoc);
    },
  };
}
