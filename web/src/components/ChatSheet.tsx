import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type Comment, type Member, type Task } from "../api";
import { formatSpan, parseLocal } from "../format";
import { useBackClose } from "../backButton";

const SEEN_KEY = "fd.chat";
// Пока переписка открыта — подтягиваем ответы, не дожидаясь общего обновления
const POLL_MS = 5000;

/** Готовые вопросы исполнителя: одно нажатие вместо набора текста. */
const QUICK = ["Какой именно?", "Когда нужно?", "Где?", "Сколько?", "До какой суммы?"];

function readSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

// Прочитанное — у каждого своё: на одном телефоне могут входить двое
function markSeen(meId: string, taskId: string, count: number) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ ...readSeen(), [`${meId}:${taskId}`]: count }));
  } catch {
    /* приватный режим — точка «новое» просто погаснет до перезагрузки */
  }
}

/** Есть ли в переписке новое от другого человека. */
export function chatUnread(task: Task, meId: string): boolean {
  return (
    task.comments_count > 0 &&
    task.last_comment_by_id !== meId &&
    (readSeen()[`${meId}:${task.id}`] ?? 0) < task.comments_count
  );
}

/** Переписка по делу: исполнитель уточняет, автор отвечает — всё остаётся в деле. */
export function ChatSheet({
  task,
  members,
  meId,
  onClose,
  onSent,
}: {
  task: Task;
  members: Member[];
  meId: string;
  onClose: () => void;
  /** Сообщение ушло — перечитать дела, чтобы обновился счётчик на карточке */
  onSent: () => void;
}) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  useBackClose(true, onClose);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const author = task.created_by_id === meId;
  const nameOf = (id: string) => (id === meId ? "Вы" : (members.find((m) => m.id === id)?.name ?? "Близкий"));
  // Кому уйдёт сообщение: автору — исполнитель, исполнителю — автор
  const otherId = author ? task.assignee_id : task.created_by_id;
  const other = otherId && otherId !== meId ? nameOf(otherId) : null;

  const load = useCallback(async (auto = false) => {
    try {
      const list = await api.comments(task.id, auto);
      setComments(list);
      markSeen(meId, task.id, list.length);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [task.id, meId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => document.visibilityState === "visible" && void load(true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [comments?.length]);

  async function send(message: string) {
    const clean = message.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    try {
      const list = await api.addComment(task.id, clean);
      setComments(list);
      markSeen(meId, task.id, list.length);
      setText("");
      onSent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/35" onClick={onClose}>
      <div
        className="glass appear pb-safe flex max-h-[88dvh] flex-col rounded-t-[28px] px-4 pt-3 pb-4 shadow-2xl"
        style={{ background: "var(--surface-solid)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-ink-3/40" />
        <div className="flex shrink-0 items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg leading-snug font-bold">{task.title}</p>
            <p className="mt-0.5 text-sm text-ink-2">
              {formatSpan(task.due_at, task.ends_at)}
              {other && ` · ${author ? "исполнитель" : "автор"}: ${other}`}
            </p>
          </div>
          <button onClick={onClose} className="h-9 shrink-0 px-1 text-sm font-medium text-accent active:opacity-60">
            Закрыть
          </button>
        </div>

        <div className="mt-3 min-h-24 flex-1 space-y-2 overflow-y-auto">
          {comments === null ? (
            <p className="py-6 text-center text-sm text-ink-3">Загружаем…</p>
          ) : comments.length === 0 ? (
            <p className="py-4 text-center text-sm text-ink-2">
              {author
                ? "Здесь можно ответить на вопросы и добавить подробности."
                : "Что-то непонятно? Спросите — ответ придёт сюда."}
            </p>
          ) : (
            comments.map((c) => {
              const mineMsg = c.member_id === meId;
              return (
                <div key={c.id} className={`flex ${mineMsg ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-[15px] leading-snug ${
                      mineMsg ? "rounded-br-md bg-accent text-accent-ink" : "rounded-bl-md bg-surface-2"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{c.text}</p>
                    <p className={`mt-0.5 text-[11px] ${mineMsg ? "opacity-75" : "text-ink-3"}`}>
                      {mineMsg ? "" : `${nameOf(c.member_id)} · `}
                      {parseLocal(c.created_at).toLocaleString("ru-RU", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottom} />
        </div>

        {!author && comments !== null && comments.length === 0 && (
          <div className="mt-2 flex shrink-0 flex-wrap gap-2">
            {QUICK.map((q) => (
              <button
                key={q}
                onClick={() => void send(q)}
                disabled={busy}
                className="h-9 rounded-full border border-line bg-surface-2 px-3 text-sm font-medium active:opacity-70"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {error && <p className="mt-2 shrink-0 text-sm text-warn">{error}</p>}
        <form
          className="mt-3 flex shrink-0 items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(text);
              }
            }}
            rows={1}
            maxLength={1000}
            placeholder={author ? "Ответить или уточнить…" : "Спросить…"}
            aria-label="Сообщение"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-line bg-bg px-3 py-2.5 text-base outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={!text.trim() || busy}
            className="h-11 shrink-0 rounded-2xl bg-accent px-4 font-semibold text-accent-ink active:opacity-80 disabled:opacity-50"
          >
            Отправить
          </button>
        </form>
      </div>
    </div>,
    document.body,
  );
}
