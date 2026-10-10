import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, type Draft, type Member, type Recurrence, type Task } from "../api";
import { addToTime, endIso } from "../format";
import { AttachButton } from "./TaskFiles";
import { Avatar } from "./ui";

const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return isoDate(d);
};

const DAYS: [string, () => string][] = [
  ["Сегодня", () => addDays(0)],
  ["Завтра", () => addDays(1)],
  ["Послезавтра", () => addDays(2)],
];
const TIMES: [string, string][] = [
  ["Утром", "09:00"],
  ["Днём", "13:00"],
  ["Вечером", "19:00"],
];
const REPEATS: [Recurrence, string][] = [
  ["none", "Нет"],
  ["daily", "Каждый день"],
  ["weekdays", "По будням"],
  ["weekly", "Каждую неделю"],
  ["monthly", "Каждый месяц"],
];

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 rounded-full border px-3 text-sm font-medium whitespace-nowrap transition ${
        on ? "border-transparent bg-accent text-accent-ink" : "border-line bg-surface-2"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * «Проверьте просьбу»: разобранная фраза со всеми полями — поправить и отправить.
 * Уведомление исполнителю уходит после отправки, вместе с прикреплёнными файлами.
 */
export function ConfirmSheet({
  draft,
  text,
  source,
  members,
  meId,
  heading = "Проверьте просьбу",
  startTime: initialTime,
  durationMin,
  onCancel,
  onSent,
}: {
  draft: Draft;
  text: string;
  source: "text" | "voice" | "copy";
  members: Member[];
  meId: string;
  heading?: string;
  /** Копия дела: прежнее время и продолжительность, день выбирают заново */
  startTime?: string;
  durationMin?: number | null;
  onCancel: () => void;
  onSent: (task: Task) => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [assignee, setAssignee] = useState<string | null>(draft.assignee_id);
  const [date, setDate] = useState(draft.due_at ? draft.due_at.slice(0, 10) : "");
  const [time, setTime] = useState(draft.due_at ? draft.due_at.slice(11, 16) : (initialTime ?? ""));
  const [end, setEnd] = useState(
    draft.ends_at ? draft.ends_at.slice(11, 16) : durationMin ? addToTime(initialTime || "18:00", durationMin) : "",
  );
  const [showEnd, setShowEnd] = useState(!!draft.ends_at || !!durationMin);
  const [repeat, setRepeat] = useState<Recurrence>(draft.recurrence);
  const [urgent, setUrgent] = useState(draft.priority === "high");
  const [items, setItems] = useState<string[]>(draft.items);
  const [newItem, setNewItem] = useState("");
  const [note, setNote] = useState(draft.note ?? "");
  const [files, setFiles] = useState<File[]>([]);
  // Сразу видно главное: что, кому, когда. Остальное раскрыто, только если разбор его уже заполнил
  const [more, setMore] = useState(
    draft.recurrence !== "none" || draft.priority === "high" || !!draft.note || draft.items.length > 0,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doers = members.filter((m) => m.role !== "child" || m.id === meId);
  const target = members.find((m) => m.id === assignee);
  const dueAt = date ? `${date}T${time || "18:00"}:00` : null;
  const endsAt = dueAt && showEnd && end ? endIso(dueAt, end) : null;
  const startTime = time || "18:00";
  // У копии продолжительность сохраняется: сдвинули начало — окончание следом
  useEffect(() => {
    if (durationMin && showEnd) setEnd(addToTime(startTime, durationMin));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startTime]);

  async function send() {
    if (!title.trim()) return setError("Напишите, что нужно сделать");
    setBusy(true);
    setError(null);
    try {
      const toOther = !!assignee && assignee !== meId;
      const task = await api.createTask({
        title: title.trim(),
        due_at: dueAt,
        ends_at: endsAt,
        assignee_id: assignee,
        recurrence: repeat,
        priority: urgent ? "high" : "normal",
        items,
        note: note.trim() || null,
        requires_car: draft.requires_car,
        source,
        source_text: text,
        // С файлами — уведомим после загрузки, чтобы скриншот пришёл вместе с просьбой
        defer_notify: files.length > 0 && toOther,
      });
      let latest = task;
      for (const file of files) latest = await api.attach(task.id, file);
      if (files.length > 0 && toOther) await api.notifyTask(task.id);
      onSent(latest);
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
        <p className="font-display text-lg font-bold">{heading}</p>
        {draft.clarifying_question && !draft.due_at && (
          <p className="mt-1 text-sm font-medium text-warn">{draft.clarifying_question}</p>
        )}

        <Label>Что сделать</Label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={300}
          className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-base outline-none focus:border-accent"
        />

        <Label>Кому</Label>
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

        <Label>День</Label>
        <div className="flex flex-wrap gap-2">
          {DAYS.map(([label, value]) => (
            <Chip key={label} on={date === value()} onClick={() => setDate(value())}>
              {label}
            </Chip>
          ))}
          <label className={`flex h-9 items-center rounded-full border px-3 text-sm font-medium ${
            date && !DAYS.some(([, v]) => v() === date) ? "border-transparent bg-accent text-accent-ink" : "border-line bg-surface-2"
          }`}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Выбрать дату"
              className="w-[118px] bg-transparent text-sm outline-none"
            />
          </label>
          <Chip on={!date} onClick={() => setDate("")}>
            Без срока
          </Chip>
        </div>

        {date && (
          <>
            <Label>Время</Label>
            <div className="flex flex-wrap gap-2">
              {TIMES.map(([label, value]) => (
                <Chip key={label} on={time === value} onClick={() => setTime(value)}>
                  {label}
                </Chip>
              ))}
              <label className={`flex h-9 items-center rounded-full border px-3 text-sm font-medium ${
                time && !TIMES.some(([, v]) => v === time) ? "border-transparent bg-accent text-accent-ink" : "border-line bg-surface-2"
              }`}>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  aria-label="Точное время"
                  className="w-[74px] bg-transparent text-sm outline-none"
                />
              </label>
            </div>

            {showEnd ? (
              <>
                <Label>До скольки</Label>
                <div className="flex flex-wrap gap-2">
                  {([[30, "30 мин"], [60, "1 час"], [120, "2 часа"]] as const).map(([minutes, label]) => (
                    <Chip key={minutes} on={end === addToTime(startTime, minutes)} onClick={() => setEnd(addToTime(startTime, minutes))}>
                      {label}
                    </Chip>
                  ))}
                  <label className={`flex h-9 items-center rounded-full border px-3 text-sm font-medium ${
                    end && ![30, 60, 120].some((m) => addToTime(startTime, m) === end)
                      ? "border-transparent bg-accent text-accent-ink"
                      : "border-line bg-surface-2"
                  }`}>
                    <input
                      type="time"
                      value={end}
                      onChange={(e) => setEnd(e.target.value)}
                      aria-label="Время окончания"
                      className="w-[74px] bg-transparent text-sm outline-none"
                    />
                  </label>
                  <Chip
                    on={false}
                    onClick={() => {
                      setShowEnd(false);
                      setEnd("");
                    }}
                  >
                    Без окончания
                  </Chip>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setShowEnd(true);
                  setEnd(addToTime(startTime, 60));
                }}
                className="mt-3 text-sm font-medium text-accent"
              >
                + до скольки
              </button>
            )}
          </>
        )}

        {more ? (
          <>
          <Label>Повтор</Label>
          <div className="flex flex-wrap gap-2">
            {REPEATS.map(([value, label]) => (
              <Chip key={value} on={repeat === value} onClick={() => setRepeat(value)}>
                {label}
              </Chip>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Chip on={urgent} onClick={() => setUrgent(!urgent)}>
              {urgent ? "✓ Срочно" : "Срочно"}
            </Chip>
          </div>

          <Label>Заметка</Label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            rows={2}
            placeholder="Кабинет, адрес, что взять с собой, номер заказа…"
            className="w-full resize-none rounded-xl border border-line bg-bg px-3 py-2 text-base outline-none focus:border-accent"
          />

          <Label>Список с галочками — покупки, вопросы врачу, что взять</Label>
          <div className="flex flex-wrap gap-1.5">
            {items.map((item, i) => (
              <span key={`${item}-${i}`} className="flex h-8 items-center gap-1 rounded-full bg-surface-2 pr-1 pl-3 text-sm">
                {item}
                <button
                  type="button"
                  onClick={() => setItems(items.filter((_, j) => j !== i))}
                  aria-label={`Убрать ${item}`}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-ink-3"
                >
                  ×
                </button>
              </span>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newItem.trim()) setItems([...items, newItem.trim()]);
                setNewItem("");
              }}
            >
              <input
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                placeholder="+ пункт"
                maxLength={120}
                className="h-8 w-28 rounded-full border border-dashed border-line bg-transparent px-3 text-sm outline-none focus:border-accent"
              />
            </form>
          </div>

          <Label>Файлы — код получения, фото, PDF</Label>
          <div className="flex flex-wrap items-center gap-2">
            {files.map((file, i) => (
              <span key={`${file.name}-${i}`} className="flex h-9 max-w-44 items-center gap-1 rounded-xl bg-surface-2 pr-1 pl-3 text-sm">
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  aria-label="Убрать файл"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-3"
                >
                  ×
                </button>
              </span>
            ))}
            {files.length < 5 && (
              <AttachButton onFile={async (file) => setFiles((list) => [...list, file])} label="Прикрепить" />
            )}
          </div>

          </>
        ) : (
          <button type="button" onClick={() => setMore(true)} className="mt-4 text-sm font-medium text-accent">
            Ещё параметры: повтор, срочно, заметка, список, файлы
          </button>
        )}

        {error && <p className="mt-3 text-sm text-warn">{error}</p>}

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy}
            className="h-12 rounded-2xl bg-accent font-semibold text-accent-ink active:opacity-80 disabled:opacity-50"
          >
            {busy ? "Отправляем…" : !assignee ? "Сохранить" : assignee === meId ? "Записать себе" : `Отправить: ${target?.name ?? ""}`}
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

function Label({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 mb-1.5 text-xs font-semibold text-ink-3">{children}</p>;
}
