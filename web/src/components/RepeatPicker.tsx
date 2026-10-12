import type { Recurrence } from "../api";
import { nextRepeats, parseLocal, shortDate, smartUntil, weekdayOf, WEEKDAY_SHORT } from "../format";

export interface RepeatValue {
  recurrence: Recurrence;
  /** «По дням недели»: 0 — пн … 6 — вс */
  days: number[];
  /** До какого числа (YYYY-MM-DD); null вместе с forever — повторять всегда */
  until: string | null;
  forever: boolean;
}

const FREQ: [Recurrence, string][] = [
  ["none", "Не повторять"],
  ["daily", "Каждый день"],
  ["weekdays", "По будням"],
  ["weekends", "По выходным"],
  ["days", "По дням недели"],
  ["weekly", "Каждую неделю"],
  ["monthly", "Каждый месяц"],
];

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

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
 * Повтор: как часто, по каким дням и до какого числа. Срок по умолчанию подбираем
 * по частоте — чтобы «каждую неделю» не тянулась в календаре на годы.
 */
export function RepeatPicker({
  value,
  due,
  onChange,
}: {
  value: RepeatValue;
  /** Первый раз — от него считаем дни и срок */
  due: string | null;
  onChange: (value: RepeatValue) => void;
}) {
  const start = due ? parseLocal(due) : new Date();
  const from = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const plus = (days: number, months = 0) => {
    const d = new Date(from);
    d.setDate(d.getDate() + days);
    d.setMonth(d.getMonth() + months);
    return ymd(d);
  };
  const quick: [string, string][] = [
    ["2 недели", plus(14)],
    ["Месяц", plus(0, 1)],
    ["3 месяца", plus(0, 3)],
  ];

  function setFreq(recurrence: Recurrence) {
    if (recurrence === "none") return onChange({ recurrence, days: [], until: null, forever: false });
    const days = recurrence === "days" ? (value.days.length ? value.days : [weekdayOf(start)]) : [];
    // Сменили частоту — подставляем разумный срок, если человек сам его не выбрал
    const until = value.forever ? null : value.recurrence === "none" ? smartUntil(recurrence, start) : value.until;
    onChange({ recurrence, days, until: until ?? smartUntil(recurrence, start), forever: value.forever });
  }

  const later =
    value.recurrence !== "none" && due && value.until
      ? nextRepeats(due, value.recurrence, value.days, value.until, new Date(`${value.until}T23:59:59`), 400)
      : null;
  const count = later ? later.length + 1 : null;
  const lastDay = later?.length ? ymd(later[later.length - 1]) : due ? due.slice(0, 10) : null;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {FREQ.map(([freq, label]) => (
          <Chip key={freq} on={value.recurrence === freq} onClick={() => setFreq(freq)}>
            {label}
          </Chip>
        ))}
      </div>

      {value.recurrence === "days" && (
        <>
          <p className="mt-4 mb-1.5 text-xs font-semibold text-ink-3">Дни</p>
          <div className="grid grid-cols-7 gap-1.5">
            {WEEKDAY_SHORT.map((label, day) => {
              const on = value.days.includes(day);
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const days = on ? value.days.filter((d) => d !== day) : [...value.days, day].sort();
                    if (days.length) onChange({ ...value, days });
                  }}
                  className={`h-10 rounded-xl text-sm font-semibold capitalize transition ${
                    on ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-2"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </>
      )}

      {value.recurrence !== "none" && (
        <>
          <p className="mt-4 mb-1.5 text-xs font-semibold text-ink-3">До какого числа</p>
          <div className="flex flex-wrap gap-2">
            {quick.map(([label, date]) => (
              <Chip
                key={label}
                on={!value.forever && value.until === date}
                onClick={() => onChange({ ...value, until: date, forever: false })}
              >
                {label}
              </Chip>
            ))}
            <label
              className={`flex h-9 items-center rounded-full border px-3 text-sm font-medium ${
                !value.forever && value.until && !quick.some(([, d]) => d === value.until)
                  ? "border-transparent bg-accent text-accent-ink"
                  : "border-line bg-surface-2"
              }`}
            >
              <input
                type="date"
                value={value.forever ? "" : (value.until ?? "")}
                min={ymd(from)}
                onChange={(e) => e.target.value && onChange({ ...value, until: e.target.value, forever: false })}
                aria-label="До какой даты повторять"
                className="w-[118px] bg-transparent text-sm outline-none"
              />
            </label>
            <Chip on={value.forever} onClick={() => onChange({ ...value, until: null, forever: true })}>
              Всегда
            </Chip>
          </div>
          <p className="mt-2 text-sm font-medium text-ok">
            {value.forever
              ? "Без конца — пока не выключите повтор"
              : count && value.until
                ? `${count} ${count % 10 === 1 && count % 100 !== 11 ? "раз" : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? "раза" : "раз"} · последний — ${shortDate(lastDay ?? value.until)}`
                : value.until
                  ? `до ${shortDate(value.until)}`
                  : ""}
          </p>
        </>
      )}
    </div>
  );
}
