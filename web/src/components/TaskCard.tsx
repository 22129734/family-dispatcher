import { useEffect, useState } from "react";
import type { Member, Recurrence, Task, TaskItem } from "../api";
import { endIso, formatSpan, fromInputValue, RECURRENCE_LABEL, toInputValue } from "../format";
import { Avatar } from "./ui";
import { AttachButton, FileStrip, PICKUP_RE } from "./TaskFiles";

interface Props {
  task: Task;
  members: Member[];
  meId: string;
  overdue: boolean;
  onAccept: () => void;
  onDecline: (reason: string | null) => void;
  onDone: () => void;
  onReopen: () => void;
  onReject: (comment: string | null) => void;
  onRename: (title: string) => void;
  onNote: (note: string | null) => void;
  onAttach: (file: File) => Promise<void>;
  onDetach: (fileId: string) => void;
  onAssign: (memberId: string) => void;
  onDue: (iso: string | null) => void;
  onEnd: (iso: string | null) => void;
  onParticipants: (ids: string[]) => void;
  onRepeat: (recurrence: Recurrence) => void;
  onItems: (items: TaskItem[]) => void;
  onDelete: () => void;
  onCopy: () => void;
  /** «Готово» нажато, 5 секунд можно вернуть */
  pending?: boolean;
  onUndo?: () => void;
  onThank?: () => void;
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
  // «Не выполнено» — у автора на деле, которое сделал другой человек
  const canReject = done && author && !!task.assignee_id && !mine;
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  const authorName = members.find((m) => m.id === task.created_by_id)?.name ?? "Автор";
  const [title, setTitle] = useState(task.title);
  useEffect(() => setTitle(task.title), [task.title]);
  const [note, setNote] = useState(task.note ?? "");
  // С сервера подтягиваем, только если там другое (не затираем пробел, который сейчас печатают)
  useEffect(() => setNote((local) => (local.trim() === (task.note ?? "") ? local : (task.note ?? ""))), [task.note]);
  // Сохраняем сами через секунду тишины — не полагаемся на уход из поля
  useEffect(() => {
    if (note.trim() === (task.note ?? "")) return;
    const timer = window.setTimeout(() => props.onNote(note.trim() || null), 1000);
    return () => window.clearTimeout(timer);
    // props.onNote меняется на каждый рендер — следим только за текстом
  }, [note, task.note]);
  const [firstItem, setFirstItem] = useState("");
  const [showEnd, setShowEnd] = useState(false);
  const withNames = task.participants
    .map((id) => (id === meId ? "я" : members.find((m) => m.id === id)?.name))
    .filter(Boolean)
    .join(", ");
  // «Кто ещё участвует» — если человек включил настройку или участники уже есть
  const canAddParticipants = !!members.find((m) => m.id === meId)?.allow_participants || task.participants.length > 0;
  // Редкие поля правки — под «Ещё»; раскрыты сразу, если в них уже что-то есть
  const [more, setMore] = useState(task.recurrence !== "none" || !!task.note);
  // Посылка с маркетплейса без кода получения — подскажем прикрепить
  const askForCode = !done && task.files.length === 0 && PICKUP_RE.test(task.title);
  const recurrence = RECURRENCE_LABEL[task.recurrence];
  const status = statusLabel(task, assignee, meId);
  const needsMyAnswer = mine && task.status === "new";
  // «Сделано» уже нажали, но ещё можно вернуть — карточка зелёная
  const finished = done || !!props.pending;
  // «Готово» — у своих дел; у сделанного — чтобы вернуть в работу
  const showDone = !needsMyAnswer && (done ? mine || author : mine || (!task.assignee_id && author));

  return (
    <li
      className={`appear rounded-2xl border transition ${
        props.pending
          ? "border-ok/40 bg-ok-soft"
          : `bg-surface ${needsMyAnswer ? "border-accent" : mine && !done ? "border-accent/40" : "border-line"}`
      } ${done ? "opacity-70" : ""}`}
    >
      <div className="flex gap-2 p-3.5">
        <div className="min-w-0 flex-1">
          <button className="w-full text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
            <p className={`text-base leading-snug ${finished ? "text-ink-2 line-through" : ""}`}>{task.title}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
              {props.pending ? (
                <span className="font-semibold text-ok">Сделано</span>
              ) : (
                <span className={overdue ? "font-medium text-warn" : ""}>{formatSpan(task.due_at, task.ends_at)}</span>
              )}
              {recurrence && <span>· {recurrence}</span>}
              {task.priority === "high" && !finished && <span className="font-medium text-warn">· срочно</span>}
              {withNames && <span>· вместе: {withNames}</span>}
            </p>
            {status && !props.pending && <p className={`mt-1 text-sm font-medium ${status.tone}`}>{status.text}</p>}
            {task.note && !open && (
              <p className="mt-1.5 line-clamp-2 w-fit rounded-lg bg-surface-2 px-2 py-1 text-sm text-ink-2">📝 {task.note}</p>
            )}
          </button>

          {task.files.length > 0 && (
            <div className="mt-2">
              <FileStrip
                files={task.files}
                canRemove={(file) => file.uploaded_by_id === meId || author}
                onRemove={(file) => props.onDetach(file.id)}
              />
            </div>
          )}
          {askForCode && (
            <div className="mt-2">
              <AttachButton onFile={props.onAttach} label="Прикрепить код получения" />
            </div>
          )}
          {task.items.length > 0 && <Items task={task} canEdit={!finished} onItems={props.onItems} />}
        </div>

        {/* Справа: кто делает и карандаш сверху, «Готово» — снизу, в строке с последней информацией */}
        <div className="flex shrink-0 flex-col items-end justify-between gap-2">
          <div className="flex items-center gap-1">
            {!mine && <Avatar member={assignee} members={members} size={26} />}
            {!props.pending && (
              <button
                onClick={() => setOpen(!open)}
                aria-label={open ? "Свернуть" : "Изменить"}
                aria-expanded={open}
                className={`-mt-1 -mr-1.5 flex h-8 w-8 items-center justify-center rounded-full transition ${
                  open ? "bg-accent text-accent-ink" : "text-ink-3 active:bg-surface-2"
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                </svg>
              </button>
            )}
          </div>
          {showDone && (
            <button
              onClick={props.pending ? props.onUndo : done ? props.onReopen : props.onDone}
              aria-label={finished ? "Вернуть в работу" : "Отметить: готово"}
              className={`flex h-9 items-center gap-2 rounded-full pr-3.5 pl-2.5 text-sm font-semibold transition active:scale-95 ${
                finished ? "bg-ok text-white" : "bg-accent text-accent-ink shadow-sm"
              }`}
            >
              {finished ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12l5 5 9-10" />
                </svg>
              ) : (
                <span className="h-4 w-4 rounded-[5px] border-2 border-current opacity-90" aria-hidden />
              )}
              Готово
            </button>
          )}
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
      {!done && task.feedback && (
        <p className="mx-3.5 mb-3 rounded-xl bg-warn-soft px-3 py-2 text-sm">
          <span className="font-semibold text-warn">{author ? "Вы вернули: " : `${authorName}: не выполнено — `}</span>
          {task.feedback}
        </p>
      )}


      {done && mine && !author && task.thanked_at && (
        <p className="mx-3.5 mb-3 text-sm font-semibold text-accent">💜 {authorName} говорит спасибо</p>
      )}
      {done && !rejecting && !open && (
        <div className="flex flex-wrap gap-2 px-3.5 pb-3">
          {author && !mine && task.assignee_id && (
            <button
              onClick={props.onThank}
              disabled={!!task.thanked_at}
              className={`h-9 rounded-xl px-3 text-sm font-semibold transition active:scale-95 ${
                task.thanked_at ? "bg-accent-soft text-accent" : "bg-fab shadow-sm"
              }`}
            >
              {task.thanked_at ? "💜 Вы сказали спасибо" : "Спасибо 💜"}
            </button>
          )}
          {canReject && (
            <button
              onClick={() => setRejecting(true)}
              className="h-9 rounded-xl border border-warn/40 px-3 text-sm font-semibold text-warn active:bg-warn-soft"
            >
              Не выполнено
            </button>
          )}
          <button
            onClick={props.onCopy}
            className="h-9 rounded-xl border border-line px-3 text-sm font-semibold text-ink-2 active:bg-surface-2"
          >
            ⧉ Повторить
          </button>
        </div>
      )}
      {rejecting && (
        <form
          className="space-y-2 px-3.5 pb-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            props.onReject(comment.trim() || null);
            setRejecting(false);
            setComment("");
          }}
        >
          <textarea
            autoFocus
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={300}
            rows={2}
            placeholder="Что не так? Например: купил не тот хлеб"
            className="w-full resize-none rounded-xl border border-line bg-bg px-3 py-2 text-base outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <button type="submit" className="h-10 flex-1 rounded-xl bg-accent text-sm font-semibold text-accent-ink active:opacity-80">
              Вернуть: {members.find((m) => m.id === task.assignee_id)?.name ?? "исполнителю"}
            </button>
            <button type="button" onClick={() => setRejecting(false)} className="h-10 rounded-xl px-4 text-sm text-ink-2">
              Отмена
            </button>
          </div>
        </form>
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
                <span className="mb-1 block text-xs font-medium text-ink-3">Что сделать</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => title.trim() && title.trim() !== task.title && props.onRename(title.trim())}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  maxLength={300}
                  className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-base outline-none focus:border-accent"
                />
              </label>

              <div>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-ink-3">Когда</span>
                  <input
                    type="datetime-local"
                    defaultValue={toInputValue(task.due_at)}
                    onChange={(e) => props.onDue(fromInputValue(e.target.value))}
                    className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-base"
                  />
                </label>
                {task.due_at &&
                  (task.ends_at || showEnd ? (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-sm text-ink-2">до</span>
                      <input
                        key={task.ends_at ?? "new"}
                        type="time"
                        defaultValue={task.ends_at?.slice(11, 16) ?? ""}
                        onChange={(e) => e.target.value && props.onEnd(endIso(task.due_at!, e.target.value))}
                        aria-label="Время окончания"
                        className="h-11 w-32 rounded-xl border border-line bg-bg px-3 text-base"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setShowEnd(false);
                          if (task.ends_at) props.onEnd(null);
                        }}
                        aria-label="Убрать окончание"
                        className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-3"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowEnd(true)}
                      className="mt-2 text-sm font-medium text-accent"
                    >
                      + до скольки
                    </button>
                  ))}
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
              {canAddParticipants && (
                <div>
                  <span className="mb-1 block text-xs font-medium text-ink-3">Кто ещё участвует</span>
                  <div className="flex flex-wrap gap-2">
                    {members
                      .filter((m) => m.id !== task.assignee_id)
                      .map((m) => {
                        const on = task.participants.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            onClick={() =>
                              props.onParticipants(
                                on ? task.participants.filter((id) => id !== m.id) : [...task.participants, m.id],
                              )
                            }
                            className={`flex h-9 items-center gap-1.5 rounded-full border pr-3 pl-1 text-sm ${
                              on ? "border-accent bg-accent-soft" : "border-line"
                            }`}
                          >
                            <Avatar member={m} members={members} size={26} />
                            {m.id === meId ? "Я" : m.name}
                            {on && " ✓"}
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}

              {more ? (
                <>
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

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-3">Заметка</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder="Кабинет, адрес, что взять с собой, номер заказа…"
                  className="w-full resize-y rounded-xl border border-line bg-bg px-3 py-2 text-base outline-none focus:border-accent"
                />
              </label>

              {task.items.length === 0 && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!firstItem.trim()) return;
                    props.onItems([{ text: firstItem.trim(), done: false }]);
                    setFirstItem("");
                  }}
                >
                  <span className="mb-1 block text-xs font-medium text-ink-3">Список с галочками</span>
                  <input
                    value={firstItem}
                    onChange={(e) => setFirstItem(e.target.value)}
                    maxLength={120}
                    placeholder="+ пункт: покупка, вопрос врачу, что взять"
                    className="h-11 w-full rounded-xl border border-dashed border-line bg-bg px-3 text-base outline-none focus:border-accent"
                  />
                </form>
              )}

              <div>
                <span className="mb-1 block text-xs font-medium text-ink-3">Файлы</span>
                <AttachButton onFile={props.onAttach} label="Фото, скриншот или PDF" />
              </div>

                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setMore(true)}
                  className="text-sm font-medium text-accent"
                >
                  Ещё: повтор, заметка, список, файлы
                </button>
              )}
            </>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {author && !mine && task.assignee_id && !done && (
              <button
                onClick={props.onDone}
                className="h-10 rounded-xl bg-ok-soft px-4 text-sm font-medium text-ok active:opacity-70"
              >
                ✓ Уже сделано
              </button>
            )}
            <button
              onClick={props.onCopy}
              className="h-10 rounded-xl bg-surface-2 px-4 text-sm font-medium active:opacity-70"
            >
              ⧉ Повторить
            </button>
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
    <div className="mt-2">
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
