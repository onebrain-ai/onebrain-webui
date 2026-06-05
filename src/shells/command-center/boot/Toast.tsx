// Transient toast (top-center). HTML is caller-controlled (trusted strings from
// store.toast), so dangerouslySetInnerHTML is safe here. Ported from the
// prototype (markup 1135, CSS 668–673).

import { toastHtml, toastShow } from "./store";
import "./toast.css";

export function Toast() {
  return <div id="toast" class={toastShow.value ? "show" : ""} dangerouslySetInnerHTML={{ __html: toastHtml.value }} />;
}
