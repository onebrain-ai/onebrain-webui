// Chat panel — the จิโอ้ assistant, wired to the live agent (POST /api/chat →
// `claude -p` against the vault). Streams the reply, renders the assistant's
// markdown, retains context via the stored session id, persists thread history,
// and offers slash-command autocomplete for OneBrain skills.

import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import type { PanelDef, PanelContext } from "../contract";
import { Icon } from "../../ui/Icon";
import { renderMarkdown } from "../../core/markdown";
import { renderMermaidIn } from "../../core/mermaid";
import { resolveWikilink } from "../bus";
import { threads, activeId, activeThread, isBusy, stop, newThread, selectThread, send } from "./chat-store";
import "./chat.css";

/** OneBrain slash skills offered in the composer's `/` autocomplete. */
const SKILLS: ReadonlyArray<{ cmd: string; desc: string }> = [
  { cmd: "capture", desc: "Quick note + auto-link" },
  { cmd: "braindump", desc: "Dump long, multi-topic thoughts" },
  { cmd: "bookmark", desc: "Save a URL + metadata" },
  { cmd: "summarize", desc: "Fetch a URL → deep summary" },
  { cmd: "import", desc: "Local file → note" },
  { cmd: "reading-notes", desc: "Book / article → notes" },
  { cmd: "research", desc: "Web research → resources" },
  { cmd: "consolidate", desc: "Clear the inbox into the vault" },
  { cmd: "connect", desc: "Find links between notes" },
  { cmd: "distill", desc: "Synthesize a topic → digest" },
  { cmd: "recap", desc: "Pull insights from sessions" },
  { cmd: "search", desc: "Search the vault" },
  { cmd: "daily", desc: "Daily briefing" },
  { cmd: "weekly", desc: "Weekly review" },
  { cmd: "tasks", desc: "Update the task dashboard" },
  { cmd: "moc", desc: "Update the vault map" },
  { cmd: "learn", desc: "Teach the agent to remember" },
  { cmd: "doctor", desc: "Check vault health" },
  { cmd: "wrapup", desc: "Wrap up the session" },
  { cmd: "pause", desc: "Pause work for later" },
  { cmd: "resume", desc: "Resume paused work" },
  { cmd: "help", desc: "List all commands" },
];

const userHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function Chat({ ctx }: { ctx: PanelContext }) {
  const draft = useSignal("");
  const showThreads = useSignal(false);
  const slashIdx = useSignal(0);
  const attachments = useSignal<{ name: string; path: string; uploading: boolean }[]>([]);
  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const thread = activeThread();
  const msgs = thread?.messages ?? [];
  const busy = thread ? isBusy(thread.id) : false;

  // Slash autocomplete is active while the draft is `/<partial-command>` (no
  // space yet) and at least one skill matches.
  const slashMatch = /^\/([\w-]*)$/.exec(draft.value);
  const slashMatches = slashMatch ? SKILLS.filter((s) => s.cmd.startsWith(slashMatch[1].toLowerCase())) : [];
  const slashOpen = slashMatches.length > 0;

  // Keep the feed pinned to the latest message + render any mermaid as it streams.
  // Re-runs only when a message is added (length) or the last one grows (streaming
  // content) — not on every render (e.g. typing in the draft), which would scroll
  // + re-scan for mermaid needlessly.
  useEffect(() => {
    requestAnimationFrame(() => {
      const el = feedRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
        void renderMermaidIn(el);
      }
    });
  }, [msgs.length, msgs.at(-1)?.text]);

  // Auto-grow the composer up to a max height.
  const grow = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  // Click a [[wikilink]] in an assistant reply → open the linked note.
  const onFeedClick = (e: MouseEvent) => {
    const wl = (e.target as HTMLElement).closest("[data-wikilink]");
    if (!wl) return;
    e.preventDefault();
    const target = resolveWikilink(wl.getAttribute("data-wikilink") ?? "");
    if (target) ctx.openFile(target);
  };

  const onSend = () => {
    if (busy) return;
    const att = attachments.value;
    if (att.some((a) => a.uploading)) return; // wait for uploads to finish
    const text = draft.value.trim();
    if (!text && !att.length) return;
    // The agent runs with --add-dir <vault>, so referencing the uploaded paths
    // lets it Read the attached image/file directly.
    let msg = text;
    if (att.length) {
      const refs = att.map((a) => `- ${a.path}`).join("\n");
      msg = `${text ? text + "\n\n" : ""}(Attached to the vault — open to read:\n${refs})`;
    }
    draft.value = "";
    attachments.value = [];
    requestAnimationFrame(grow);
    void send(ctx.daemon, msg);
  };

  // Max attachments per message — shared by the file picker and clipboard paste.
  const MAX_ATTACHMENTS = 5;

  const addFiles = async (incoming: File[]) => {
    const room = MAX_ATTACHMENTS - attachments.value.length;
    if (room <= 0) return; // already at the cap — silently ignore the rest
    for (const file of incoming.slice(0, room)) {
      // Pasted images often have no name → synthesise one from the MIME type so
      // the daemon stores it with a real image extension.
      const ext = (file.type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "");
      const rawName = file.name || `pasted-image.${ext}`;
      const safe = rawName.replace(/[^\w.\-ก-๙]+/g, "_");
      const path = `00-inbox/imports/chat-${Math.random().toString(36).slice(2, 8)}-${safe}`;
      attachments.value = [...attachments.value, { name: rawName, path, uploading: true }];
      try {
        const buf = await file.arrayBuffer();
        await ctx.daemon.uploadFile(path, buf);
        attachments.value = attachments.value.map((a) => (a.path === path ? { ...a, uploading: false } : a));
      } catch {
        attachments.value = attachments.value.filter((a) => a.path !== path);
      }
    }
  };

  const onFiles = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    input.value = ""; // allow re-selecting the same file
    void addFiles(files);
  };

  // Paste images straight into the composer (≤ MAX_ATTACHMENTS total).
  const onPaste = (e: ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null);
    if (imgs.length === 0) return; // let normal text paste through
    e.preventDefault();
    void addFiles(imgs);
  };

  const pickSkill = (cmd: string) => {
    draft.value = `/${cmd} `;
    slashIdx.value = 0;
    requestAnimationFrame(() => {
      grow();
      inputRef.current?.focus();
    });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (slashOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); slashIdx.value = (slashIdx.value + 1) % slashMatches.length; return; }
      if (e.key === "ArrowUp") { e.preventDefault(); slashIdx.value = (slashIdx.value - 1 + slashMatches.length) % slashMatches.length; return; }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        pickSkill(slashMatches[Math.min(slashIdx.value, slashMatches.length - 1)].cmd);
        return;
      }
      if (e.key === "Escape") { slashIdx.value = -1; return; } // hides until next edit
    }
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <>
      <div class="w-head">
        <span class="pill">
          <span class="dot" />
          <span class="thai">จิโอ้</span> · Assistant
        </span>
        <span class="ch-acts">
          <button class="ch-iconbtn" type="button" title="History" aria-label="History" onClick={() => (showThreads.value = !showThreads.value)}>
            <Icon name="history" />
          </button>
          <button class="ch-iconbtn" type="button" title="New chat" aria-label="New chat" onClick={() => { newThread(); showThreads.value = false; }}>
            <Icon name="plus" />
          </button>
        </span>
      </div>

      {showThreads.value && (
        <div class="ch-threads" data-testid="chat-threads">
          {threads.value.map((th) => (
            <button
              key={th.id}
              class={th.id === activeId.value ? "ch-thread on" : "ch-thread"}
              type="button"
              onClick={() => { selectThread(th.id); showThreads.value = false; }}
            >
              <Icon name="chat" />
              <span class="ch-thread-title">{th.title || "New chat"}</span>
              <span class="ch-thread-n">{th.messages.length}</span>
            </button>
          ))}
        </div>
      )}

      <div class="chat-feed" ref={feedRef} onClick={onFeedClick}>
        {msgs.length === 0 && (
          <div class="chat-empty">
            <Icon name="sparkles" />
            <p>Chat with <span class="thai">จิโอ้</span> — ask about your vault, type <b>/</b> for a skill, or just chat</p>
          </div>
        )}
        {msgs.map((m, i) => (
          <div class={`cm ${m.role}${m.error ? " err" : ""}`} key={i}>
            <div class="cm-av">
              <Icon name={m.role === "ai" ? "robot" : "user"} />
            </div>
            <div
              class="cm-body"
              dangerouslySetInnerHTML={{
                __html:
                  (m.role === "ai" ? renderMarkdown(m.text).html : `<p>${userHtml(m.text)}</p>`) +
                  (m.streaming ? '<span class="cm-cursor"></span>' : ""),
              }}
            />
          </div>
        ))}
      </div>

      <div class="chat-composer">
        {slashOpen && slashIdx.value >= 0 && (
          <div class="ch-slash" data-testid="chat-slash">
            {slashMatches.slice(0, 7).map((s, i) => (
              <button
                key={s.cmd}
                type="button"
                class={i === Math.min(slashIdx.value, slashMatches.length - 1) ? "ch-slash-item on" : "ch-slash-item"}
                onMouseDown={(e) => { e.preventDefault(); pickSkill(s.cmd); }}
              >
                <span class="ch-slash-cmd">/{s.cmd}</span>
                <span class="ch-slash-desc">{s.desc}</span>
              </button>
            ))}
          </div>
        )}
        {attachments.value.length > 0 && (
          <div class="ch-attachments" data-testid="chat-attachments">
            {attachments.value.map((a) => (
              <span key={a.path} class={a.uploading ? "ch-att uploading" : "ch-att"}>
                {/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(a.path) && !a.uploading ? (
                  <img class="ch-att-thumb" src={ctx.daemon.rawUrl(a.path)} alt={a.name} />
                ) : (
                  <Icon name="paperclip" />
                )}
                <span class="ch-att-name">{a.name}</span>
                {!a.uploading && (
                  <button
                    type="button"
                    class="ch-att-x"
                    aria-label="Remove attachment"
                    title="Remove attachment"
                    onClick={() => { attachments.value = attachments.value.filter((x) => x.path !== a.path); }}
                  >
                    <Icon name="x" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        <div class="chat-input">
          <input ref={fileRef} type="file" multiple style="display:none" onChange={onFiles} />
          <button
            class="chat-attach"
            type="button"
            title={attachments.value.length >= MAX_ATTACHMENTS ? `Max ${MAX_ATTACHMENTS} files` : "Attach file / image (paste to add)"}
            aria-label="Attach file"
            disabled={busy || attachments.value.length >= MAX_ATTACHMENTS}
            onClick={() => fileRef.current?.click()}
          >
            <Icon name="paperclip" />
          </button>
          <textarea
            ref={inputRef}
            rows={2}
            placeholder="Ask จิโอ้…  paste ≤5 images
Enter to send · Shift+Enter for newline"
            autocomplete="off"
            spellcheck={false}
            value={draft.value}
            disabled={busy}
            onInput={(e) => { draft.value = (e.target as HTMLTextAreaElement).value; slashIdx.value = 0; grow(); }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
          {busy && thread ? (
            <button class="chat-send stop" type="button" onClick={() => stop(thread.id)} aria-label="Stop" title="Stop">
              <Icon name="x" />
            </button>
          ) : (
            <button class="chat-send" type="button" onClick={onSend} aria-label="Send" title="Send">
              <Icon name="send" />
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export const chatPanel: PanelDef = {
  type: "chat",
  name: "Chat · จิโอ้",
  width: 360,
  seed: true,
  Component: Chat,
};
