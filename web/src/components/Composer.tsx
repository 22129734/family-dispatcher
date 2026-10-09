import { useState, type FormEvent } from "react";

// «Пример:» в начале — без него люди принимали подсказку за уже введённый текст
// Короткие, чтобы целиком помещались в поле даже на узком экране (340 px)
const HINTS = [
  "Пример: забрать Соню в 19",
  "Пример: купить хлеб, молоко",
  "Пример: выгулять собаку в 8",
];

interface SpeechState {
  listening: boolean;
  interim: string;
  error: string | null;
}

/** Поле для дела текстом. Голос — большая кнопка в центре меню, здесь — что она слышит. */
export function Composer({
  onSend,
  busy,
  speech,
  note,
}: {
  onSend: (text: string, source: "text" | "voice") => Promise<void>;
  busy: boolean;
  speech: SpeechState;
  /** Пояснение под полем — например, что дело запишется на вас */
  note?: string | null;
}) {
  const [text, setText] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    setText("");
    await onSend(message, "text");
  }

  const hint = HINTS[new Date().getMinutes() % HINTS.length];

  return (
    <div>
      {(speech.listening || speech.interim) && (
        <p className="glass appear mb-2 rounded-2xl px-4 py-2.5 text-sm">
          <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-accent align-middle" />
          {speech.interim || "Слушаю — скажите, что нужно сделать…"}
        </p>
      )}
      {speech.error && <p className="glass mb-2 rounded-2xl px-4 py-2 text-sm text-warn">{speech.error}</p>}
      <form onSubmit={submit} className="glass flex items-center gap-2 rounded-[22px] p-1.5 pl-4 shadow-md">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={hint}
          enterKeyHint="send"
          maxLength={1000}
          aria-label="Новое дело"
          className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-ink-3"
        />
        <button
          type="submit"
          disabled={busy || !text.trim()}
          aria-label="Отправить"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-ink transition disabled:opacity-30"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>
      {note && <p className="mt-1.5 px-2 text-xs font-medium text-accent">{note}</p>}
    </div>
  );
}
