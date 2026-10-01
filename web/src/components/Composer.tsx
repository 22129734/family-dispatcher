import { useState, type FormEvent } from "react";
import { useSpeech } from "../useSpeech";

const HINTS = [
  "Завтра в 19 забрать Соню с танцев",
  "Купить продукты на выходные",
  "Каждый день в 8 выгулять собаку",
];

export function Composer({
  onSend,
  busy,
}: {
  onSend: (text: string, source: "text" | "voice") => Promise<void>;
  busy: boolean;
}) {
  const [text, setText] = useState("");
  const speech = useSpeech((spoken) => void onSend(spoken, "voice"));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    setText("");
    await onSend(message, "text");
  }

  const hint = HINTS[new Date().getMinutes() % HINTS.length];

  return (
    <div className="border-t border-line bg-bg/95 px-4 pt-3 pb-3 backdrop-blur">
      {(speech.listening || speech.interim) && (
        <p className="appear mb-2 min-h-5 text-sm text-ink-2">
          {speech.interim || "Слушаю…"}
        </p>
      )}
      {speech.error && <p className="mb-2 text-sm text-warn">{speech.error}</p>}
      <form onSubmit={submit} className="flex items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={hint}
          enterKeyHint="send"
          maxLength={1000}
          aria-label="Новое дело"
          className="h-12 min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 text-base outline-none placeholder:text-ink-3 focus:border-accent"
        />
        {text.trim() || !speech.supported ? (
          <button
            type="submit"
            disabled={busy || !text.trim()}
            aria-label="Отправить"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-ink disabled:opacity-40"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={speech.listening ? speech.stop : speech.start}
            aria-label={speech.listening ? "Остановить запись" : "Сказать голосом"}
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-ink disabled:opacity-40 ${speech.listening ? "listening" : ""}`}
          >
            {speech.listening ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="5" width="14" height="14" rx="3" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="9" y="3" width="6" height="12" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            )}
          </button>
        )}
      </form>
    </div>
  );
}
