// Chat panel — the จิโอ้ assistant. Seeded mock conversation (matches the
// prototype, lines 2839–2862); a typed message echoes + gets a canned reply.
// Skill-routing replies wire up with the composer/skills panels later.

import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import type { PanelDef, PanelContext } from "../contract";
import { resolveWikilink } from "../bus";
import "./chat.css";

interface Msg {
  role: "you" | "ai";
  who: string;
  /** trusted HTML for seed/canned messages; escaped for user input. */
  html: string;
}

const SEED: Msg[] = [
  {
    role: "ai",
    who: "จิโอ้",
    html: "สวัสดีครับพี่เก่ง — วันนี้มี <b>3</b> งานครบกำหนด และ inbox ค้าง <b>12</b> โน้ต อยากเริ่มตรงไหนก่อนดีครับ",
  },
  { role: "you", who: "พี่เก่ง", html: "ช่วย consolidate inbox ให้หน่อย" },
  {
    role: "ai",
    who: "จิโอ้",
    html: 'ได้ครับ — รัน <span class="wl" data-wl="consolidate">/consolidate</span> แล้ว: รวมได้ 8 โน้ต · เชื่อม [[Command Center]] ↔ [[OneBrain]] เพิ่ม · รายละเอียดอยู่ใน Session Log ครับ',
  },
];

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function cannedReply(q: string): string {
  if (/inbox|กล่อง/i.test(q)) return 'ตอนนี้ inbox มี 12 โน้ตครับ ลอง <span class="wl" data-wl="consolidate">/consolidate</span> เพื่อรวมเข้าระบบ';
  if (/task|งาน/i.test(q)) return "มีงานที่ยังเปิดอยู่ครับ ดูได้ที่ panel Tasks";
  if (/หา|ค้น|search/i.test(q)) return "เปิด <b>qmd Search</b> แล้วพิมพ์คำค้นได้เลยครับ (lex+vec+hyde)";
  return 'รับทราบครับพี่เก่ง — โยงเข้ากับ [[OneBrain]] vault ให้ ถ้าอยากบันทึกเป็นโน้ตบอก <span class="wl" data-wl="capture">/capture</span> ได้เลย';
}

function Chat({ ctx }: { ctx: PanelContext }) {
  const msgs = useSignal<Msg[]>(SEED);
  const draft = useSignal("");
  const feedRef = useRef<HTMLDivElement>(null);

  const scroll = () => requestAnimationFrame(() => feedRef.current && (feedRef.current.scrollTop = feedRef.current.scrollHeight));

  const send = () => {
    const v = draft.value.trim();
    if (!v) return;
    msgs.value = [...msgs.value, { role: "you", who: "พี่เก่ง", html: esc(v) }];
    draft.value = "";
    scroll();
    setTimeout(() => {
      msgs.value = [...msgs.value, { role: "ai", who: "จิโอ้", html: cannedReply(v) }];
      scroll();
    }, 460);
  };

  const onFeedClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest(".wl[data-wl]");
    if (!a) return;
    const target = resolveWikilink(a.getAttribute("data-wl") ?? "");
    if (target) ctx.openFile(target);
  };

  return (
    <>
      <div class="w-head">
        <span class="pill">
          <span class="dot" />
          จิโอ้ · Assistant
        </span>
        <span class="w-meta">CHAT</span>
      </div>
      <div class="chat-feed" ref={feedRef} onClick={onFeedClick}>
        {msgs.value.map((m) => (
          <div class={`cm ${m.role}`}>
            <div class="cm-who">{m.who}</div>
            <span dangerouslySetInnerHTML={{ __html: m.html }} />
          </div>
        ))}
      </div>
      <div class="chat-input">
        <input
          type="text"
          placeholder="ถามจิโอ้…  พิมพ์ /skill หรือคุยได้เลย"
          autocomplete="off"
          spellcheck={false}
          value={draft.value}
          onInput={(e) => (draft.value = (e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button class="btn-tech" onClick={send}>
          <span>Send</span>
        </button>
      </div>
    </>
  );
}

export const chatPanel: PanelDef = {
  type: "chat",
  name: "Chat · จิโอ้",
  width: 360,
  placement: { t: 0.64, y: 0.26, r: 6.9, s: 0.005 },
  seed: true,
  Component: Chat,
};
