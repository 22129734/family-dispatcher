import { useState } from "react";
import type { Member, Task } from "../api";
import { formatDue, fromInputValue, RECURRENCE_LABEL, toInputValue } from "../format";
import { Avatar } from "./ui";

interface Props {
  task: Task;
  members: Member[];
  meId: string;
  overdue: boolean;
  onDone: () => void;
  onReopen: () => void;
  onReassign: () => void;
  onAssign: (memberId: string) => void;
  onDue: (iso: string | null) => void;
  onDelete: () => void;
}

export function TaskCard(props: Props) {
  const { task, members, meId, overdue } = props;
  const [open, setOpen] = useState(false);
  const assignee = members.find((m) => m.id === task.assignee_id);
  const done = task.status === "done";
  const mine = task.assignee_id === meId;
  const recurrence = RECURRENCE_LABEL[task.recurrence];

  return (
    <li
      className={`appear rounded-2xl border bg-surface transition ${
        mine && !done ? "border-accent/40" : "border-line"
      } ${done ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-3 p-3.5">
        <button
          onClick={done ? props.onReopen : props.onDone}
          aria-label={done ? "Вернуть в работу" : "Отметить сделанным"}
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition ${
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
            {task.requires_car && <span>· 🚗</span>}
            {task.priority === "high" && !done && <span className="font-medium text-warn">· срочно</span>}
          </p>
        </button>

        <div className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
          <Avatar member={assignee} members={members} />
          <span className="max-w-16 truncate text-[11px] text-ink-3">{mine ? "я" : (assignee?.name ?? "никто")}</span>
        </div>
      </div>

      {!done && task.clarifying_question && !task.due_at && !open && (
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
            {!done && (
              <button
                onClick={props.onReassign}
                className="h-10 flex-1 rounded-xl bg-surface-2 text-sm font-medium active:opacity-70"
              >
                ↻ Не могу — передать
              </button>
            )}
            <button
              onClick={props.onDelete}
              className="h-10 rounded-xl px-4 text-sm font-medium text-warn active:opacity-70"
            >
              Удалить
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
