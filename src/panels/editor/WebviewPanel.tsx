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

  // In-frame back/forward. We can't read the cross-origin frame's history, but
  // in-frame navigations JOIN the parent's session history, so calling
  // window.history.back()/forward() from here steers the FRAME (the app itself
  // never pushes entries — it only replaceState()s the token away). Depth is
  // tracked via the iframe's load events: the first load after a (re)mount is
  // the original page; each later load is either the completion of a pending
  // back/forward we issued, or an organic in-frame link click.
  const [depth, setDepth] = useState(0); // steps forward of the original page
  const [fwdAvail, setFwdAvail] = useState(0); // entries re-reachable via forward
  const [pendingNav, setPendingNav] = useState<"back" | "forward" | null>(null);
  const firstLoad = useRef(true);

  // Safety valve: if a pending back/forward never completes (e.g. the entry was
  // a replace-navigation, so history.back() no-opped and no load event fires),
  // clear the pending state so the buttons don't stay stuck disabled. Counters
  // are left as-is — this is best-effort bookkeeping over an opaque frame.
  useEffect(() => {
    if (pendingNav === null) return;
    const t = setTimeout(() => setPendingNav(null), 2500);
    return () => clearTimeout(t);
  }, [pendingNav]);

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
    // A (re)mounted iframe starts a fresh in-frame history: removing the old
    // frame element also drops its entries from the joint session history.
    firstLoad.current = true;
    setDepth(0);
    setFwdAvail(0);
    setPendingNav(null);
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
    if (firstLoad.current) {
      firstLoad.current = false; // the original page — not a navigation
      return;
    }
    if (pendingNav === "back") {
      setDepth((d) => d - 1);
      setFwdAvail((f) => f + 1);
    } else if (pendingNav === "forward") {
      setDepth((d) => d + 1);
      setFwdAvail((f) => f - 1);
    } else {
      // Organic in-frame navigation (a link click) — truncates forward history.
      setDepth((d) => d + 1);
      setFwdAvail(0);
    }
    setPendingNav(null);
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
          aria-label="Close"
          title="Close — back to document"
          onClick={closeWebview}
        >
          &#215;
        </button>
        <button
          class="ed-iconbtn"
          type="button"
          aria-label="Page back"
          title="Back"
          disabled={depth === 0 || pendingNav !== null}
          onClick={() => {
            setPendingNav("back");
            window.history.back();
          }}
        >
          &#8592;
        </button>
        <button
          class="ed-iconbtn"
          type="button"
          aria-label="Page forward"
          title="Forward"
          disabled={fwdAvail === 0 || pendingNav !== null}
          onClick={() => {
            setPendingNav("forward");
            window.history.forward();
          }}
        >
          &#8594;
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
