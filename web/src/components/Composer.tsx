import { useEffect, useState, type FormEvent } from "react";

/**
 * Примеры сменяются по кругу и показывают, что умеет диспетчер: повторы, список покупок,
 * «напомни мне», просьбу по имени, срочное. «Пример:» в начале — без него подсказку
 * принимали за уже введённый текст. Длина — чтобы помещались на экране 340 px.
 */
function hints(spouse: string | null): string[] {
  const name = spouse ?? "Олег";
  return [
    "Пример: по средам поливать цветы",
    `Пример: ${name}, забери Машу в 19`,
    "Пример: купи хлеб, молоко и яйца",
    "Пример: напомни мне в 9 позвонить",
    "Пример: по будням отвести в школу",
    "Пример: раз в месяц оплатить свет",
    "Пример: срочно купить лекарства",
    "Пример: я заберу посылку в субботу",
  ];
}

const HINT_MS = 3500;

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
  spouse,
}: {
  onSend: (text: string, source: "text" | "voice") => Promise<void>;
  busy: boolean;
  speech: SpeechState;
  /** Пояснение под полем — например, что дело запишется на вас */
  note?: string | null;
  /** Имя второго взрослого — для примера просьбы по имени */
  spouse?: string | null;
}) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const examples = hints(spouse ?? null);
  const [hintIndex, setHintIndex] = useState(() => Math.floor(Math.random() * examples.length));

  // Пока поле пустое и в него не печатают — показываем следующий пример
  useEffect(() => {
    if (text || focused) return;
    const timer = window.setInterval(() => setHintIndex((i) => (i + 1) % examples.length), HINT_MS);
    return () => window.clearInterval(timer);
  }, [text, focused, examples.length]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    setText("");
    await onSend(message, "text");
  }

  const hint = examples[hintIndex % examples.length];

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
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          // Подсказка мельче текста: длинные примеры помещаются, а ввод остаётся 16 px (иначе iPhone приближает)
          className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[14px] placeholder:text-ink-3"
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
