import { useEffect, useState, type ReactNode } from "react";

/**
 * Подсказки в нужный момент: по одной, когда человек впервые дошёл до места.
 * Закрытые запоминаем на устройстве; «Показать подсказки заново» — во вкладке «Ещё».
 */

export type HintId = "mic" | "card" | "calendar" | "family" | "more";

const KEY = "fd.hints";
const EVENT = "fd-hints";

function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function writeSeen(seen: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...seen]));
  } catch {
    /* приватный режим — подсказка закроется только до перезагрузки */
  }
  window.dispatchEvent(new Event(EVENT));
}

export const hintSeen = (id: HintId) => readSeen().has(id);

export function dismissHint(id: HintId) {
  const seen = readSeen();
  if (seen.has(id)) return;
  seen.add(id);
  writeSeen(seen);
}

export function resetHints() {
  writeSeen(new Set());
}

/** Видна ли подсказка; обновляется, когда её закрыли в другом месте экрана. */
export function useHint(id: HintId): boolean {
  const [show, setShow] = useState(() => !hintSeen(id));
  useEffect(() => {
    const update = () => setShow(!hintSeen(id));
    window.addEventListener(EVENT, update);
    return () => window.removeEventListener(EVENT, update);
  }, [id]);
  return show;
}

export function Hint({ id, children, className = "" }: { id: HintId; children: ReactNode; className?: string }) {
  const show = useHint(id);
  if (!show) return null;
  return (
    <div role="note" className={`glass appear flex items-start gap-3 rounded-2xl border-accent/30 p-3.5 shadow-md ${className}`}>
      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-accent" aria-hidden />
      <p className="min-w-0 flex-1 text-sm leading-snug">{children}</p>
      <button
        onClick={() => dismissHint(id)}
        className="-my-1 h-8 shrink-0 rounded-xl bg-accent px-3 text-sm font-semibold text-accent-ink active:opacity-80"
      >
        Понятно
      </button>
    </div>
  );
}
