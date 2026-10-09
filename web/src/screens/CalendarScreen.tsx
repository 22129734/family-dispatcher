import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, type Member, type Task } from "../api";
import { TaskCard } from "../components/TaskCard";
import { avatarTone, dayKey, parseLocal, repeatsBetween, RECURRENCE_LABEL } from "../format";
import { inScope, plural, SCOPES, type Scope, type TaskActions } from "./Today";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MAX_DOTS = 3;

type Entry = { task: Task; repeat: boolean; at: Date };

/** Календарь семьи: месяц с отметками дел и список дел выбранного дня. */
export function CalendarScreen({
  tasks,
  members,
  meId,
  actions,
  onCreated,
}: {
  tasks: Task[];
  members: Member[];
  meId: string;
  actions: TaskActions;
  onCreated: (task: Task) => void;
}) {
  const today = new Date();
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(() => dayKey(today));
  const [scope, setScope] = useState<Scope>("all");
  // Сделанное за прошлый месяц — чтобы в календаре было видно и выполненное
  const [history, setHistory] = useState<Task[]>([]);

  // Перезапрашиваем, только когда меняется число сделанных, а не при каждом обновлении списка
  const doneCount = tasks.filter((t) => t.status === "done").length;
  useEffect(() => {
    api.tasks(31).then(
      (list) => setHistory(list.filter((t) => t.status === "done")),
      () => undefined,
    );
  }, [doneCount]);

  // Сетка: с понедельника недели, где 1-е число, 6 недель
  const days = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - ((start.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [month]);

  const byDay = useMemo(() => {
    const live = new Map(tasks.map((t) => [t.id, t]));
    const all = [...tasks, ...history.filter((t) => !live.has(t.id))].filter((t) => inScope(t, scope, meId));
    const from = days[0];
    const to = new Date(days[41].getFullYear(), days[41].getMonth(), days[41].getDate() + 1);
    const map = new Map<string, Entry[]>();
    const add = (key: string, entry: Entry) => map.set(key, [...(map.get(key) ?? []), entry]);
    for (const task of all) {
      if (!task.due_at) continue;
      const due = parseLocal(task.due_at);
      add(dayKey(due), { task, repeat: false, at: due });
      for (const at of repeatsBetween(task, from, to)) add(dayKey(at), { task, repeat: true, at });
    }
    for (const list of map.values()) list.sort((a, b) => a.at.getTime() - b.at.getTime());
    return map;
  }, [tasks, history, scope, meId, days]);

  const undated = tasks.filter((t) => !t.due_at && t.status !== "done" && inScope(t, scope, meId)).length;
  const entries = byDay.get(selected) ?? [];
  const selectedDate = parseLocal(`${selected}T00:00:00`);
  const monthName = month.toLocaleDateString("ru-RU", { month: "long" });
  const monthTitle = `${monthName[0].toUpperCase()}${monthName.slice(1)}${
    month.getFullYear() === today.getFullYear() ? "" : ` ${month.getFullYear()}`
  }`;

  const shiftMonth = (delta: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));

  return (
    <div className="px-4 pb-6">
      <header className="flex items-center justify-between pt-6 pb-3">
        <h1 className="text-2xl font-bold tracking-tight">{monthTitle}</h1>
        <div className="flex gap-1">
          <NavButton label="Предыдущий месяц" onClick={() => shiftMonth(-1)} d="M15 18l-6-6 6-6" />
          <button
            onClick={() => {
              setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
              setSelected(dayKey(today));
            }}
            className="h-9 rounded-full px-3 text-sm font-medium text-accent active:bg-surface-2"
          >
            Сегодня
          </button>
          <NavButton label="Следующий месяц" onClick={() => shiftMonth(1)} d="M9 18l6-6-6-6" />
        </div>
      </header>

      <div className="glass mb-3 inline-flex rounded-2xl p-1">
        {SCOPES.map(([value, label]) => (
          <button
            key={value}
            onClick={() => setScope(value)}
            className={`h-8 rounded-xl px-3 text-sm font-semibold transition ${
              scope === value ? "bg-accent text-accent-ink shadow-sm" : "text-ink-2"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-7 text-center text-xs font-medium text-ink-3">
        {WEEKDAYS.map((d, i) => (
          <span key={d} className={`py-1 ${i >= 5 ? "text-warn/80" : ""}`}>
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {days.map((day) => {
          const key = dayKey(day);
          const list = byDay.get(key) ?? [];
          const inMonth = day.getMonth() === month.getMonth();
          const isToday = key === dayKey(today);
          const isSelected = key === selected;
          const open = list.filter((e) => e.task.status !== "done");
          const overdue = open.some((e) => !e.repeat && e.at < today);
          return (
            <button
              key={key}
              onClick={() => setSelected(key)}
              aria-label={`${day.getDate()}: ${list.length} ${plural(list.length, "дело", "дела", "дел")}`}
              className={`flex h-12 flex-col items-center justify-start rounded-xl pt-1.5 transition ${
                isSelected ? "bg-accent-soft ring-1 ring-accent" : "active:bg-surface-2"
              } ${inMonth ? "" : "opacity-35"}`}
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-sm ${
                  isToday ? "bg-accent font-semibold text-accent-ink" : ""
                }`}
              >
                {day.getDate()}
              </span>
              <span className="mt-0.5 flex h-1.5 gap-0.5">
                {list.slice(0, MAX_DOTS).map((e, i) => (
                  <span
                    key={i}
                    className={`h-1.5 w-1.5 rounded-full ${
                      e.task.status === "done"
                        ? "bg-ink-3/50"
                        : overdue
                          ? "bg-warn"
                          : e.task.assignee_id
                            ? avatarTone(e.task.assignee_id, members)
                            : "bg-ink-3"
                    } ${e.repeat ? "opacity-50" : ""}`}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <section className="mt-5">
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">
          {selectedDate.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}
          {entries.length > 0 && ` · ${entries.length}`}
        </h2>
        {entries.length === 0 && <p className="mb-3 text-sm text-ink-2">Дел на этот день нет.</p>}
        <ul className="space-y-2">
          {entries.map((entry) =>
            entry.repeat ? (
              <RepeatRow key={`${entry.task.id}-${entry.at.getTime()}`} entry={entry} members={members} meId={meId} />
            ) : (
              <TaskCard
                key={entry.task.id}
                task={entry.task}
                members={members}
                meId={meId}
                overdue={entry.task.status !== "done" && entry.at < today}
                onAccept={() => actions.accept(entry.task.id)}
                onDecline={(reason) => actions.decline(entry.task.id, reason)}
                onDone={() => actions.done(entry.task.id)}
                onReopen={() => actions.reopen(entry.task.id)}
                onAssign={(memberId) => actions.assign(entry.task.id, memberId)}
                onDue={(iso) => actions.due(entry.task.id, iso)}
                onRepeat={(value) => actions.repeat(entry.task.id, value)}
                onItems={(items) => actions.items(entry.task.id, items)}
                onDelete={() => actions.remove(entry.task.id)}
              />
            ),
          )}
        </ul>
        <QuickAdd day={selected} onCreated={onCreated} />
        {undated > 0 && (
          <p className="mt-4 text-xs text-ink-3">
            Ещё {undated} {plural(undated, "дело", "дела", "дел")} без срока — они на вкладке «Дела».
          </p>
        )}
      </section>
    </div>
  );
}

/** Будущий повтор: задачи ещё нет, сервер создаст её после «Сделано» у текущей. */
function RepeatRow({ entry, members, meId }: { entry: Entry; members: Member[]; meId: string }) {
  const assignee = members.find((m) => m.id === entry.task.assignee_id);
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-dashed border-line px-3.5 py-3 text-ink-2">
      <span className="text-sm tabular-nums">
        {entry.at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
      </span>
      <span className="min-w-0 flex-1 truncate">{entry.task.title}</span>
      <span className="shrink-0 text-xs">
        ↻ {RECURRENCE_LABEL[entry.task.recurrence]}
        {assignee ? ` · ${assignee.id === meId ? "я" : assignee.name}` : ""}
      </span>
    </li>
  );
}

/** Дело на выбранный день без лишних слов: название и время. */
function QuickAdd({ day, onCreated }: { day: string; onCreated: (task: Task) => void }) {
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("18:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.createTask(title.trim(), `${day}T${time || "18:00"}:00`));
      setTitle("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={300}
        placeholder="+ Дело на этот день"
        className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-base outline-none focus:border-accent"
      />
      <input
        type="time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        aria-label="Время"
        className="h-11 w-24 rounded-xl border border-line bg-surface px-2 text-base"
      />
      <button
        type="submit"
        disabled={busy || !title.trim()}
        className="h-11 rounded-xl bg-accent px-4 font-semibold text-accent-ink disabled:opacity-40"
      >
        OK
      </button>
      {error && <p className="text-sm text-warn">{error}</p>}
    </form>
  );
}

function NavButton({ label, onClick, d }: { label: string; onClick: () => void; d: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-full text-ink-2 active:bg-surface-2"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </button>
  );
}
