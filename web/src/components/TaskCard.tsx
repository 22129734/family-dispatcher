import { useState } from "react";
import type { Member, Recurrence, Task, TaskItem } from "../api";
import { formatDue, fromInputValue, RECURRENCE_LABEL, toInputValue } from "../format";
import { Avatar } from "./ui";

interface Props {
  task: Task;
  members: Member[];
  meId: string;
  overdue: boolean;
  onAccept: () => void;
  onDecline: (reason: string | null) => void;
  onDone: () => void;
  onReopen: () => void;
  onAssign: (memberId: string) => void;
  onDue: (iso: string | null) => void;
  onRepeat: (recurrence: Recurrence) => void;
  onItems: (items: TaskItem[]) => void;
  onDelete: () => void;
}

const REPEAT_OPTIONS: [Recurrence, string][] = [
  ["none", "Не повторять"],
  ["daily", "Каждый день"],
  ["weekdays", "По будням"],
  ["weekly", "Каждую неделю"],
  ["monthly", "Каждый месяц"],
];

/** Статус поручения так, как его видит автор. */
function statusLabel(task: Task, assignee: Member | undefined, meId: string) {
  if (task.status === "done") return { text: "Сделано", tone: "text-ok" };
  if (!task.assignee_id) {
    return { text: task.decline_reason ?? "Не назначено — выберите, кто сделает", tone: "text-warn" };
  }
  if (task.assignee_id === meId) return null;
  const name = assignee?.name ?? "Исполнитель";
  if (task.status === "accepted") {
    return { text: `${name} взял(а)${task.remembered_at ? " · помнит" : ""}`, tone: "text-ok" };
  }
  if (assignee && !assignee.notifications) {
    return { text: `${name} не получает уведомления — скажите сами`, tone: "text-warn" };
  }
  return { text: `Ждёт ответа: ${name}`, tone: "text-ink-3" };
}

export function TaskCard(props: Props) {
  const { task, members, meId, overdue } = props;
  const [open, setOpen] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const assignee = members.find((m) => m.id === task.assignee_id);
  const done = task.status === "done";
  const mine = task.assignee_id === meId;
  const author = task.created_by_id === meId;
  const canFinish = mine || author || !task.assignee_id;
  const recurrence = RECURRENCE_LABEL[task.recurrence];
  const status = statusLabel(task, assignee, meId);
  const needsMyAnswer = mine && task.status === "new";

  return (
    <li
      className={`appear rounded-2xl border bg-surface transition ${
        needsMyAnswer ? "border-accent" : mine && !done ? "border-accent/40" : "border-line"
      } ${done ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-3 p-3.5">
        <button
          onClick={done ? props.onReopen : props.onDone}
          disabled={!canFinish}
          aria-label={done ? "Вернуть в работу" : "Отметить сделанным"}
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition disabled:opacity-30 ${
            done ? "border-ok bg-ok text-white" : "border-ink-3 active:bg-ok-soft"
          }`}
        >
          {done && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5L20 7" />
            </svg>
          )}
        </button>

        <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
          <p className={`text-base leading-snug ${done ? "line-through" : ""}`}>{task.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
            <span className={overdue ? "font-medium text-warn" : ""}>{formatDue(task.due_at)}</span>
            {recurrence && <span>· {recurrence}</span>}
            {task.priority === "high" && !done && <span className="font-medium text-warn">· срочно</span>}
          </p>
          {status && <p className={`mt-1 text-sm font-medium ${status.tone}`}>{status.text}</p>}
        </button>

        <div className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
          <Avatar member={assignee} members={members} />
          <span className="max-w-16 truncate text-[11px] text-ink-3">{mine ? "я" : (assignee?.name ?? "никто")}</span>
        </div>
      </div>

      {/* Ответ исполнителя — прямо в карточке, без раскрытия */}
      {needsMyAnswer && !declining && (
        <div className="flex gap-2 px-3.5 pb-3.5">
          <button onClick={props.onAccept} className="h-11 flex-1 rounded-xl bg-accent font-semibold text-accent-ink active:opacity-80">
            Беру
          </button>
          <button onClick={() => setDeclining(true)} className="h-11 rounded-xl bg-surface-2 px-4 font-medium active:opacity-70">
            Не могу
          </button>
        </div>
      )}
      {task.items.length > 0 && <Items task={task} canEdit={!done} onItems={props.onItems} />}

      {mine && task.status === "accepted" && (
        <div className="px-3.5 pb-3.5">
          {/* Кнопка-действие, а не отметка: пустой кружок и контур, зелёная заливка — только у сделанного */}
          <button
            onClick={props.onDone}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-ok font-semibold text-ok active:bg-ok-soft"
          >
            <span className="h-4 w-4 rounded-full border-2 border-current" aria-hidden />
            Отметить «Сделано»
          </button>
        </div>
      )}
      {declining && (
        <form
          className="space-y-2 px-3.5 pb-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            props.onDecline(reason.trim() || null);
            setDeclining(false);
          }}
        >
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            placeholder="Почему? Например: до 21 на работе"
            className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-base outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <button type="submit" className="h-10 flex-1 rounded-xl bg-surface-2 text-sm font-medium active:opacity-70">
              Вернуть автору
            </button>
            <button type="button" onClick={() => setDeclining(false)} className="h-10 rounded-xl px-4 text-sm text-ink-2">
              Отмена
            </button>
          </div>
        </form>
      )}

      {!done && task.clarifying_question && !task.due_at && !open && author && (
        <button
          onClick={() => setOpen(true)}
          className="mx-3.5 mb-3.5 block w-[calc(100%-1.75rem)] rounded-xl bg-accent-soft px-3 py-2 text-left text-sm"
        >
          💬 {task.clarifying_question}
        </button>
      )}

      {open && (
        <div className="appear space-y-3 border-t border-line px-3.5 py-3">
          {task.rationale && <p className="text-sm text-ink-2">💡 {task.rationale}</p>}

          {!done && (
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-3">Когда</span>
                <input
                  type="datetime-local"
                  defaultValue={toInputValue(task.due_at)}
                  onChange={(e) => props.onDue(fromInputValue(e.target.value))}
                  className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-base"
                />
              </label>

              <div>
                <span className="mb-1 block text-xs font-medium text-ink-3">Повторять</span>
                <div className="flex flex-wrap gap-2">
                  {REPEAT_OPTIONS.map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => props.onRepeat(value)}
                      className={`h-9 rounded-full border px-3 text-sm ${
                        task.recurrence === value ? "border-accent bg-accent-soft" : "border-line"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="mb-1 block text-xs font-medium text-ink-3">Кто делает</span>
                <div className="flex flex-wrap gap-2">
                  {members.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => props.onAssign(m.id)}
                      className={`flex h-9 items-center gap-1.5 rounded-full border pr-3 pl-1 text-sm ${
                        m.id === task.assignee_id ? "border-accent bg-accent-soft" : "border-line"
                      }`}
                    >
                      <Avatar member={m} members={members} size={26} />
                      {m.id === meId ? "Я" : m.name}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="flex gap-2 pt-1">
            {mine && !done && task.status === "accepted" && (
              <button
                onClick={() => setDeclining(true)}
                className="h-10 flex-1 rounded-xl bg-surface-2 text-sm font-medium active:opacity-70"
              >
                Не получится — вернуть
              </button>
            )}
            {author && (
              <button onClick={props.onDelete} className="h-10 rounded-xl px-4 text-sm font-medium text-warn active:opacity-70">
                Удалить
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/** Список покупок: отмечает любой в семье, пункт можно добавить. */
function Items({ task, canEdit, onItems }: { task: Task; canEdit: boolean; onItems: (items: TaskItem[]) => void }) {
  const [adding, setAdding] = useState("");
  const left = task.items.filter((i) => !i.done).length;

  const toggle = (index: number) =>
    onItems(task.items.map((item, i) => (i === index ? { ...item, done: !item.done } : item)));

  return (
    <div className="px-3.5 pb-3">
      <p className="mb-1 text-xs font-medium text-ink-3">
        {left ? `Осталось ${left} из ${task.items.length}` : "Всё куплено"}
      </p>
      <ul className="space-y-0.5">
        {task.items.map((item, index) => (
          <li key={`${item.text}-${index}`}>
            <button
              disabled={!canEdit}
              onClick={() => toggle(index)}
              className="flex w-full items-center gap-2.5 rounded-lg py-1.5 text-left active:bg-surface-2"
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 text-[11px] ${
                  item.done ? "border-ok bg-ok text-white" : "border-ink-3"
                }`}
                aria-hidden
              >
                {item.done ? "✓" : ""}
              </span>
              <span className={item.done ? "text-ink-3 line-through" : ""}>{item.text}</span>
            </button>
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          className="mt-1"
          onSubmit={(e) => {
            e.preventDefault();
            const text = adding.trim();
            if (!text) return;
            onItems([...task.items, { text, done: false }]);
            setAdding("");
          }}
        >
          <input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            maxLength={120}
            placeholder="+ добавить в список"
            className="h-9 w-full rounded-lg border border-transparent bg-transparent px-1 text-sm outline-none focus:border-line"
          />
        </form>
      )}
    </div>
  );
}
