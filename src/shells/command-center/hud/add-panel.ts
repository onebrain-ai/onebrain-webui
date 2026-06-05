// Add-panel launcher (bottom-left) — opens a type menu that spawns a fresh panel
// of the chosen type in front of the camera. Built imperatively from the panel
// registry (a new panel auto-appears here). Ported from the prototype
// (buildAddMenu / addBtn wiring 2964–2986, CSS 786–807).

import { allPanels } from "../../../panels";
import "./add-panel.css";

export interface AddMenuDeps {
  addPanel: (type: string) => void;
}

export interface AddMenu {
  dispose(): void;
}

export function createAddMenu(deps: AddMenuDeps): AddMenu {
  const root = document.getElementById("add-panel");
  const btn = document.getElementById("add-btn");
  const menu = document.getElementById("add-menu");
  if (!root || !btn || !menu) return { dispose() {} };

  menu.innerHTML = "";
  const head = document.createElement("div");
  head.className = "add-head";
  head.textContent = "Add panel";
  menu.appendChild(head);
  for (const def of allPanels()) {
    const it = document.createElement("button");
    it.type = "button";
    it.className = "add-item";
    const dot = document.createElement("span");
    dot.className = "ai-dot";
    it.append(dot, document.createTextNode(def.name)); // name as text node — no innerHTML
    it.addEventListener("click", (e) => {
      e.stopPropagation();
      deps.addPanel(def.type);
      root.classList.remove("open");
    });
    menu.appendChild(it);
  }

  const onBtn = (e: MouseEvent) => {
    e.stopPropagation();
    root.classList.toggle("open");
  };
  const onMenu = (e: MouseEvent) => e.stopPropagation();
  const onDoc = () => root.classList.remove("open");
  btn.addEventListener("click", onBtn);
  menu.addEventListener("click", onMenu);
  document.addEventListener("click", onDoc);

  return {
    dispose() {
      btn.removeEventListener("click", onBtn);
      menu.removeEventListener("click", onMenu);
      document.removeEventListener("click", onDoc);
    },
  };
}
