import { useEffect, useRef } from "preact/hooks";
import { webviewUrl, webviewMode, closeWebview, toggleWebviewMode } from "./webview-store";

/** In-app webview. Reads the store; mounted by the editor when webviewOpen is
 *  true. A load-hang timer (8s) falls back to a new tab so a silently-blocked
 *  or dead frame can't strand the user on a blank pane. */
export function WebviewPanel() {
  const url = webviewUrl.value ?? "";
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    // Re-arm when the framed url changes.
  }, [url]);

  const onLoad = () => {
    // Same reasoning as the cleanup above: timer.current is always set once
    // the effect has run, which is always true by the time onLoad can fire.
    /* v8 ignore start */
    if (timer.current) clearTimeout(timer.current);
    /* v8 ignore stop */
  };

  return (
    <div class={`ed-webview ed-webview-${webviewMode.value}`}>
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
        class="ed-webview-frame"
        src={url}
        sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
        referrerpolicy="no-referrer"
        onLoad={onLoad}
      />
    </div>
  );
}
