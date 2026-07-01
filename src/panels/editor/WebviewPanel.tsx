import { useEffect, useRef, useState } from "preact/hooks";
import {
  webviewUrl,
  webviewMode,
  webviewWidth,
  setWebviewWidth,
  closeWebview,
  toggleWebviewMode,
} from "./webview-store";

/** In-app webview. Reads the store; mounted by the editor when webviewOpen is
 *  true. A load-hang timer (8s) falls back to a new tab so a silently-blocked
 *  or dead frame can't strand the user on a blank pane. */
export function WebviewPanel() {
  const url = webviewUrl.value ?? "";
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Bumping this remounts the iframe (via `key`) back to the original url — a
  // reload/home, since cross-origin frames block programmatic history.back().
  const [reloadNonce, setReloadNonce] = useState(0);

  // Drag the side panel's LEFT edge to resize. The panel is pinned to the right
  // of .ed-reading-wrap, so its width = the wrap's right edge minus the cursor x.
  // A body class drops iframe pointer-events during the drag so the frame doesn't
  // swallow the mousemove stream.
  const startResize = (e: MouseEvent) => {
    e.preventDefault();
    // Falls back to the viewport width if the panel is somehow unmounted from
    // its parent mid-drag (defensive — covered by a dedicated test).
    const rightEdge =
      rootRef.current?.parentElement?.getBoundingClientRect().right ?? window.innerWidth;
    const onMove = (ev: MouseEvent) => setWebviewWidth(rightEdge - ev.clientX);
    const stop = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", stop);
      document.body.classList.remove("ed-webview-resizing");
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", stop);
    document.body.classList.add("ed-webview-resizing");
  };

  useEffect(() => {
    timer.current = setTimeout(() => {
      window.open(url, "_blank", "noopener,noreferrer");
      closeWebview();
    }, 8000);
    return () => {
      // timer.current is always set by the time cleanup runs (it's assigned
      // synchronously above, before React/preact can invoke this) — the
      // falsy branch is unreachable defensive code.
      /* v8 ignore start */
      if (timer.current) clearTimeout(timer.current);
      /* v8 ignore stop */
    };
    // Re-arm when the framed url changes, or when reload forces the iframe to
    // remount back to it (the url itself is unchanged, so it must be listed too).
  }, [url, reloadNonce]);

  const onLoad = () => {
    // Same reasoning as the cleanup above: timer.current is always set once
    // the effect has run, which is always true by the time onLoad can fire.
    /* v8 ignore start */
    if (timer.current) clearTimeout(timer.current);
    /* v8 ignore stop */
  };

  return (
    <div
      ref={rootRef}
      class={`ed-webview ed-webview-${webviewMode.value}`}
      style={webviewMode.value === "side" ? `--webview-w:${webviewWidth.value}px` : undefined}
    >
      {webviewMode.value === "side" && (
        <div class="ed-webview-resize" onMouseDown={startResize} title="Drag to resize" />
      )}
      <div class="ed-webview-bar">
        <button
          class="ed-iconbtn"
          type="button"
          aria-label="Back to document"
          title="Back to document"
          onClick={closeWebview}
        >
          &lsaquo;
        </button>
        <span class="ed-webview-url" title={url}>{url}</span>
        <button
          class="ed-iconbtn"
          type="button"
          aria-label="Reload"
          title="Reload page"
          onClick={() => setReloadNonce((n) => n + 1)}
        >
          &#8635;
        </button>
        <button
          class="ed-iconbtn"
          type="button"
          aria-label="Toggle layout"
          title="Toggle pane / side"
          onClick={toggleWebviewMode}
        >
          &#8646;
        </button>
        <a
          class="ed-iconbtn"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open in new tab"
          title="Open externally"
        >
          &#8599;
        </a>
      </div>
      <iframe
        key={`${url}#${reloadNonce}`}
        class="ed-webview-frame"
        src={url}
        sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
        referrerpolicy="no-referrer"
        onLoad={onLoad}
      />
    </div>
  );
}
