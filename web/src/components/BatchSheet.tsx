import { useState } from "react";
import { createPortal } from "react-dom";
import { api, type BatchItem, type Member, type Task } from "../api";
import { formatSpan } from "../format";
import { Avatar } from "./ui";

/**
 * В сообщении несколько дел — расписание на неделю или список. Показываем их отдельно:
 * снять лишние, поправить названия, выбрать, кому. Исполнителю — одно уведомление.
 */
export function BatchSheet({
  items,
  text,
  source,
  members,
  meId,
  assigneeId,
  onCancel,
  onSent,
}: {
  items: BatchItem[];
  text: string;
  source: "text" | "voice";
  members: Member[];
  meId: string;
  assigneeId: string | null;
  onCancel: () => void;
  onSent: (tasks: Task[]) => void;
}) {
  const [rows, setRows] = useState(items.map((item) => ({ ...item, on: true })));
  const [assignee, setAssignee] = useState<string | null>(assigneeId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = rows.filter((r) => r.on && r.title.trim());
  const doers = members.filter((m) => m.role !== "child" || m.id === meId);
  const n = chosen.length;
  const word = n % 10 === 1 && n % 100 !== 11 ? "дело" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "дела" : "дел";

  async function send() {
    if (!n) return;
    setBusy(true);
    setError(null);
    try {
      const tasks = await api.createBatch({
        tasks: chosen.map(({ title, due_at, ends_at, note, items }) => ({
          title: title.trim(),
          due_at,
          ends_at,
          note,
          items: items ?? [],
        })),
        assignee_id: assignee,
        source,
        source_text: text,
      });
      onSent(tasks);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/35" onClick={onCancel}>
      <div
        className="glass appear pb-safe max-h-[92dvh] overflow-y-auto rounded-t-[28px] px-4 pt-3 pb-4 shadow-2xl"
        style={{ background: "var(--surface-solid)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink-3/40" />
        <p className="font-display text-lg font-bold">Нашли {items.length} дел</p>
        <p className="mt-0.5 text-sm text-ink-2">Каждое станет отдельным делом. Снимите галочку с лишних.</p>

        <p className="mt-4 mb-1.5 text-xs font-semibold text-ink-3">Кому</p>
        <div className="flex flex-wrap gap-2">
          {doers.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setAssignee(m.id)}
              className={`flex h-9 items-center gap-1.5 rounded-full border pr-3 pl-1 text-sm font-medium ${
                assignee === m.id ? "border-accent bg-accent-soft" : "border-line bg-surface-2"
              }`}
            >
              <Avatar member={m} members={members} size={26} />
              {m.id === meId ? "Я" : m.name}
            </button>
          ))}
        </div>

        <ul className="mt-4 space-y-2">
          {rows.map((row, i) => (
            <li
              key={i}
              className={`flex items-start gap-3 rounded-2xl border p-3 transition ${
                row.on ? "border-line bg-surface" : "border-transparent bg-surface-2 opacity-50"
              }`}
            >
              <input
                type="checkbox"
                checked={row.on}
                onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, on: e.target.checked } : r)))}
                aria-label={`Создать: ${row.title}`}
                className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-accent)]"
              />
              <div className="min-w-0 flex-1">
                <input
                  value={row.title}
                  onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, title: e.target.value } : r)))}
                  maxLength={300}
                  aria-label="Название"
                  className="w-full bg-transparent text-base font-semibold outline-none"
                />
                <p className="text-sm text-ink-2">{formatSpan(row.due_at, row.ends_at)}</p>
                {row.note && <p className="mt-1 text-sm text-ink-3">📝 {row.note}</p>}
                {!!row.items?.length && (
                  <p className="mt-1 line-clamp-2 text-sm text-ink-3">
                    🛒 {row.items.length}: {row.items.join(", ")}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>

        {error && <p className="mt-3 text-sm text-warn">{error}</p>}
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !n}
            className="h-12 rounded-2xl bg-accent font-semibold text-accent-ink active:opacity-80 disabled:opacity-50"
          >
            {busy ? "Создаём…" : `Создать ${n} ${word}`}
          </button>
          <button type="button" onClick={onCancel} className="h-10 text-sm font-medium text-ink-2">
            Отмена
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
