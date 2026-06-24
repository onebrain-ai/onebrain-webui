// Fullscreen toggle — shared by the Settings switch (F) and ⌘K. Wraps the
// vendor-prefixed fullscreen API; failures surface as a toast. Ported from the
// prototype (fsActive/toggleFullscreen 2068–2078).

import { toast } from "../boot/store";

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

export function isFullscreen(): boolean {
  const d = document as FsDocument;
  return !!(document.fullscreenElement || d.webkitFullscreenElement);
}

export function toggleFullscreen(): void {
  const d = document as FsDocument;
  try {
    if (isFullscreen()) {
      (document.exitFullscreen || d.webkitExitFullscreen)?.call(document);
    } else {
      const el = document.documentElement as FsElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      const p = req?.call(el);
      if (p && typeof (p as Promise<void>).catch === "function") {
        (p as Promise<void>).catch(() => toast("Fullscreen blocked by the browser"));
      }
    }
  } catch {
    toast("Fullscreen unavailable here");
  }
}
