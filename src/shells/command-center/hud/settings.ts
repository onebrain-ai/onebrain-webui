// Settings popover — accent · ambient motion · fullscreen · FPS cap. Wires the
// static #settings-pop DOM to the shared stores (core/accent, core/motion,
// core/perf); the swatches / switches / segments reflect store state reactively.
// Ported from the prototype (settings DOM 985–1028, JS 1958–2124, CSS 494–567).

import { effect } from "@preact/signals";
import { ACCENT_KEYS, ACCENT_HEX, accentName, setAccent } from "../../../core/accent";
import { ambientOn, setAmbient } from "../../../core/motion";
import { fpsCap, setFpsCap } from "../../../core/perf";
import { isFullscreen, toggleFullscreen } from "./fullscreen";
import "./settings.css";

export interface Settings {
  /** open the popover (used by ⌘K's "Settings" action). */
  open(): void;
  dispose(): void;
}

export function createSettings(): Settings {
  const btn = document.getElementById("settings-btn");
  const pop = document.getElementById("settings-pop");
  if (!pop) return { open() {}, dispose() {} };

  // ── accent swatches (rebuilt on accent change so the .on ring tracks) ──
  const accRow = pop.querySelector<HTMLElement>("#global-acc");
  function buildSwatches(): void {
    if (!accRow) return;
    accRow.innerHTML = "";
    for (const key of ACCENT_KEYS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "acc-sw" + (accentName.peek() === key ? " on" : "");
      b.style.background = ACCENT_HEX[key];
      b.style.color = ACCENT_HEX[key];
      b.title = key;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        setAccent(key);
      });
      accRow.appendChild(b);
    }
  }

  // ── fullscreen switch (kept in sync with the real fullscreen state) ──
  const fsSwitch = document.getElementById("fs-switch");
  function syncFs(): void {
    if (!fsSwitch) return;
    const on = isFullscreen();
    fsSwitch.classList.toggle("on", on);
    fsSwitch.setAttribute("aria-checked", on ? "true" : "false");
  }
  const onFs = (e: MouseEvent) => {
    e.stopPropagation();
    toggleFullscreen();
  };
  fsSwitch?.addEventListener("click", onFs);
  document.addEventListener("fullscreenchange", syncFs);
  document.addEventListener("webkitfullscreenchange", syncFs);

  // ── ambient switch ──
  const ambSwitch = document.getElementById("amb-switch");
  const onAmb = (e: MouseEvent) => {
    e.stopPropagation();
    setAmbient(!ambientOn.peek());
  };
  ambSwitch?.addEventListener("click", onAmb);

  // ── FPS-cap segmented selector ──
  const segBtns = Array.from(pop.querySelectorAll<HTMLButtonElement>("#fps-seg .seg-btn"));
  const onSeg = (e: MouseEvent) => {
    e.stopPropagation();
    setFpsCap(Number((e.currentTarget as HTMLElement).dataset.fps));
  };
  segBtns.forEach((b) => b.addEventListener("click", onSeg));

  // ── reflect store state into the controls reactively ──
  const stop = effect(() => {
    accentName.value;
    buildSwatches();
    const amb = ambientOn.value;
    if (ambSwitch) {
      ambSwitch.classList.toggle("on", amb);
      ambSwitch.setAttribute("aria-checked", amb ? "true" : "false");
    }
    const cap = fpsCap.value;
    segBtns.forEach((b) => {
      const on = Number(b.dataset.fps) === cap;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  });
  syncFs();

  // ── open / close ──
  const onBtn = (e: MouseEvent) => {
    e.stopPropagation();
    pop.classList.toggle("open");
  };
  const onPop = (e: MouseEvent) => e.stopPropagation();
  const onDoc = () => pop.classList.remove("open");
  btn?.addEventListener("click", onBtn);
  pop.addEventListener("click", onPop);
  document.addEventListener("click", onDoc);

  return {
    open() {
      pop.classList.add("open");
    },
    dispose() {
      stop();
      btn?.removeEventListener("click", onBtn);
      pop.removeEventListener("click", onPop);
      document.removeEventListener("click", onDoc);
      fsSwitch?.removeEventListener("click", onFs);
      ambSwitch?.removeEventListener("click", onAmb);
      segBtns.forEach((b) => b.removeEventListener("click", onSeg));
      document.removeEventListener("fullscreenchange", syncFs);
      document.removeEventListener("webkitfullscreenchange", syncFs);
    },
  };
}
