import { Hint } from "../components/Hint";
import { useEffect, useMemo, useRef, useState, type FormEvent, type TouchEvent } from "react";
import { api, type Member, type Task } from "../api";
import { TaskCard } from "../components/TaskCard";
import { avatarTone, dayKey, parseLocal, repeatsBetween, RECURRENCE_LABEL } from "../format";
import { plural, type TaskActions } from "./Today";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MAX_DOTS = 3;
const VIEW_KEY = "fd.calendar.view";
const SWIPE_PX = 45;

type Entry = { task: Task; repeat: boolean; at: Date };
type View = "month" | "week";

const savedView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === "week" ? "week" : "month";
  } catch {
    return "month";
  }
};

const mondayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const time = (d: Date) => d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

/**
 * Календарь семьи: кто чем занят по дням. Месяц или неделя — как выбрал человек;
 * листается смахиванием вверх и вниз. Дела дня — строками, карточка — по нажатию.
 */
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
  const [view, setViewState] = useState<View>(savedView);
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(() => dayKey(today));
  // Чьи дела показывать: null — все
  const [person, setPerson] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // Сделанное за прошлый месяц — чтобы в календаре было видно и выполненное
  const [history, setHistory] = useState<Task[]>([]);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [slide, setSlide] = useState(0);

  const doneCount = tasks.filter((t) => t.status === "done").length;
  useEffect(() => {
    api.tasks(31).then(
      (list) => setHistory(list.filter((t) => t.status === "done")),
      () => undefined,
    );
  }, [doneCount]);

  const selectedDate = parseLocal(`${selected}T00:00:00`);

  function setView(next: View) {
    setViewState(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* приватный режим — запомним до перезагрузки */
    }
    if (next === "month") setMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  }

  // Месяц: 6 недель с понедельника; неделя: 7 дней выбранной недели
  const days = useMemo(() => {
    const start = view === "month" ? mondayOf(month) : mondayOf(selectedDate);
    return Array.from({ length: view === "month" ? 42 : 7 }, (_, i) => addDays(start, i));
    // selectedDate пересоздаётся каждый рендер — следим за ключом дня
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, month, selected]);

  const byDay = useMemo(() => {
    const live = new Map(tasks.map((t) => [t.id, t]));
    const all = [...tasks, ...history.filter((t) => !live.has(t.id))].filter(
      (t) => person === null || t.assignee_id === person,
    );
    const from = days[0];
    const to = addDays(days[days.length - 1], 1);
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
  }, [tasks, history, person, days]);

  const entries = byDay.get(selected) ?? [];
  const titleDate = view === "month" ? month : selectedDate;
  const monthName = titleDate.toLocaleDateString("ru-RU", { month: "long" });
  const title = `${monthName[0].toUpperCase()}${monthName.slice(1)}${
    titleDate.getFullYear() === today.getFullYear() ? "" : ` ${titleDate.getFullYear()}`
  }`;

  /** Вперёд или назад на месяц или неделю. */
  function shift(delta: number) {
    setSlide(delta);
    setOpenId(null);
    if (view === "month") {
      const next = new Date(month.getFullYear(), month.getMonth() + delta, 1);
      setMonth(next);
      const isCurrent = next.getMonth() === today.getMonth() && next.getFullYear() === today.getFullYear();
      setSelected(dayKey(isCurrent ? today : next));
    } else {
      setSelected(dayKey(addDays(selectedDate, delta * 7)));
    }
  }

  function goToday() {
    setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelected(dayKey(today));
    setOpenId(null);
  }

  // Смахивание вверх — следующий месяц или неделя, вниз — предыдущий
  const onTouchStart = (e: TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dy) > SWIPE_PX && Math.abs(dy) > Math.abs(dx)) shift(dy < 0 ? 1 : -1);
  };

  const others = members.filter((m) => m.id !== meId);

  return (
    <div className="px-4 pb-6">
      <Hint id="calendar" className="mt-4">
        Здесь все дела семьи по дням. Смахните календарь вверх или вниз, чтобы листать. Нажмите на день — увидите его дела.
      </Hint>
      <header className="flex items-center justify-between gap-2 pt-6 pb-3">
        <button onClick={goToday} className="text-left" aria-label="К сегодняшнему дню">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        </button>
        <div className="glass grid grid-cols-2 gap-1 rounded-xl p-1">
          {(
            [
              ["week", "Неделя"],
              ["month", "Месяц"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setView(value)}
              aria-pressed={view === value}
              className={`h-8 rounded-lg px-3 text-[13px] font-semibold transition ${
                view === value ? "bg-accent text-accent-ink shadow-sm" : "text-ink-2"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* Сетка листается смахиванием: здесь вертикальный жест — наш, а не прокрутка страницы */}
      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} style={{ touchAction: "pan-x" }}>
        <div className="grid grid-cols-7 text-center text-xs font-medium text-ink-3">
          {WEEKDAYS.map((d, i) => (
            <span key={d} className={`py-1 ${i >= 5 ? "text-warn/80" : ""}`}>
              {d}
            </span>
          ))}
        </div>
        <div
          key={`${view}-${dayKey(days[0])}`}
          className={`grid grid-cols-7 gap-y-1 ${slide > 0 ? "slide-up" : slide < 0 ? "slide-down" : ""}`}
        >
          {days.map((day) => {
            const key = dayKey(day);
            const list = byDay.get(key) ?? [];
            const inMonth = view === "week" || day.getMonth() === month.getMonth();
            const isToday = key === dayKey(today);
            const isSelected = key === selected;
            const overdue = list.some((e) => e.task.status !== "done" && !e.repeat && e.at < today);
            return (
              <button
                key={key}
                onClick={() => {
                  setSelected(key);
                  setOpenId(null);
                }}
                aria-label={`${day.getDate()}: ${list.length} ${plural(list.length, "дело", "дела", "дел")}`}
                className={`flex ${view === "week" ? "h-14" : "h-12"} flex-col items-center justify-start rounded-xl pt-1.5 transition ${
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
      </div>

      {others.length > 0 && (
        <div className="no-scrollbar mt-3 -mx-4 flex gap-1.5 overflow-x-auto px-4">
          {[{ id: null, name: "Все" }, { id: meId, name: "Я" }, ...others.map((m) => ({ id: m.id, name: m.name }))].map(
            (p) => (
              <button
                key={p.id ?? "all"}
                onClick={() => setPerson(p.id)}
                className={`h-8 shrink-0 rounded-full px-3.5 text-sm font-semibold transition ${
                  person === p.id ? "bg-accent text-accent-ink" : "glass text-ink-2"
                }`}
              >
                {p.name}
              </button>
            ),
          )}
        </div>
      )}

      <section className="mt-4">
        <h2 className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">
          {selectedDate.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}
          {entries.length > 0 && ` · ${entries.length}`}
        </h2>
        {entries.length === 0 && <p className="mb-3 text-sm text-ink-2">Дел на этот день нет.</p>}
        <ul className="space-y-1.5">
          {entries.map((entry) =>
            entry.repeat ? (
              <DayRow key={`${entry.task.id}-${entry.at.getTime()}`} entry={entry} members={members} meId={meId} />
            ) : openId === entry.task.id ? (
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
                onReject={(comment) => actions.reject(entry.task.id, comment)}
                onRename={(value) => actions.rename(entry.task.id, value)}
                onNote={(note) => actions.note(entry.task.id, note)}
                onAttach={(file) => actions.attach(entry.task.id, file)}
                onDetach={(fileId) => actions.detach(entry.task.id, fileId)}
                onAssign={(memberId) => actions.assign(entry.task.id, memberId)}
                onDue={(iso) => actions.due(entry.task.id, iso)}
                onEnd={(iso) => actions.end(entry.task.id, iso)}
                onRepeat={(value) => actions.repeat(entry.task.id, value)}
                onItems={(items) => actions.items(entry.task.id, items)}
                onDelete={() => actions.remove(entry.task.id)}
                onCopy={() => actions.copy(entry.task)}
              />
            ) : (
              <DayRow
                key={entry.task.id}
                entry={entry}
                members={members}
                meId={meId}
                overdue={entry.task.status !== "done" && entry.at < today}
                onOpen={() => setOpenId(entry.task.id)}
              />
            ),
          )}
        </ul>
        {openId && (
          <button onClick={() => setOpenId(null)} className="mt-2 text-sm font-medium text-accent">
            Свернуть
          </button>
        )}
        <QuickAdd day={selected} onCreated={onCreated} />
      </section>
    </div>
  );
}

/** «–10:00»: окончание, если его назвали; у повтора — та же продолжительность. */
function spanEnd(entry: Entry): string {
  const { due_at, ends_at } = entry.task;
  if (!due_at || !ends_at) return "";
  return `–${time(new Date(entry.at.getTime() + (parseLocal(ends_at).getTime() - parseLocal(due_at).getTime())))}`;
}

/** Строка дня: время · что · кто. Будущий повтор — пунктиром, задачи ещё нет. */
function DayRow({
  entry,
  members,
  meId,
  overdue = false,
  onOpen,
}: {
  entry: Entry;
  members: Member[];
  meId: string;
  overdue?: boolean;
  onOpen?: () => void;
}) {
  const { task } = entry;
  const assignee = members.find((m) => m.id === task.assignee_id);
  const done = task.status === "done";
  const body = (
    <>
      <span className={`w-[92px] shrink-0 text-sm tabular-nums ${overdue ? "font-semibold text-warn" : "text-ink-2"}`}>
        {time(entry.at)}
        {spanEnd(entry)}
      </span>
      <span className={`min-w-0 flex-1 truncate ${done ? "text-ink-3 line-through" : "font-medium"}`}>
        {entry.repeat && "↻ "}
        {task.title}
      </span>
      {task.status === "new" && !entry.repeat && !done && (
        <span className="shrink-0 rounded-full bg-[var(--warn-soft)] px-2 py-0.5 text-[11px] font-semibold text-warn">ждёт</span>
      )}
      {assignee ? (
        <span
          title={assignee.id === meId ? "я" : assignee.name}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${avatarTone(assignee.id, members)}`}
        >
          {assignee.name.slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <span className="h-7 w-7 shrink-0 rounded-full border border-dashed border-ink-3" title="никто" />
      )}
    </>
  );
  if (entry.repeat) {
    return (
      <li
        className="flex items-center gap-2.5 rounded-2xl border border-dashed border-line px-3.5 py-2.5 text-ink-2"
        title={`Повтор: ${RECURRENCE_LABEL[task.recurrence] ?? ""}`}
      >
        {body}
      </li>
    );
  }
  return (
    <li>
      <button onClick={onOpen} className="glass flex w-full items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-left active:opacity-80">
        {body}
      </button>
    </li>
  );
}

/** Дело на выбранный день без лишних слов: название и время. */
function QuickAdd({ day, onCreated }: { day: string; onCreated: (task: Task) => void }) {
  const [title, setTitle] = useState("");
  const [at, setAt] = useState("18:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.createTask({ title: title.trim(), due_at: `${day}T${at || "18:00"}:00` }));
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
        value={at}
        onChange={(e) => setAt(e.target.value)}
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
