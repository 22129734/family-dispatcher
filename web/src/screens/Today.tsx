import { Hint, useHint } from "../components/Hint";
import { useMemo, useState, type ReactNode } from "react";
import type { Family, Member, Recurrence, Task, TaskItem } from "../api";
import { isAlone } from "../share";
import { InviteSpouseCard } from "../components/InviteSpouseCard";
import { NotifyBanner } from "../components/NotifyBanner";
import { TaskCard } from "../components/TaskCard";
import { bucketOf, formatSpan, parseLocal } from "../format";

export interface TaskActions {
  accept: (id: string) => void;
  decline: (id: string, reason: string | null) => void;
  done: (id: string) => void;
  reopen: (id: string) => void;
  reject: (id: string, comment: string | null) => void;
  rename: (id: string, title: string) => void;
  note: (id: string, note: string | null) => void;
  attach: (id: string, file: File) => Promise<void>;
  detach: (id: string, fileId: string) => void;
  assign: (id: string, memberId: string) => void;
  due: (id: string, iso: string | null) => void;
  end: (id: string, iso: string | null) => void;
  participants: (id: string, ids: string[]) => void;
  repeat: (id: string, recurrence: Recurrence) => void;
  items: (id: string, items: TaskItem[]) => void;
  remove: (id: string) => void;
  /** «Повторить»: шторка с теми же полями, день выбирают заново */
  copy: (task: Task) => void;
}

export function Today({
  tasks,
  members,
  meId,
  actions,
  loading,
  family,
  onOpenFamily,
}: {
  tasks: Task[];
  members: Member[];
  meId: string;
  actions: TaskActions;
  loading: boolean;
  family: Family | null;
  onOpenFamily: () => void;
}) {
  const me = members.find((m) => m.id === meId);
  // Подсказку о карточке — после подсказки о микрофоне, не обе сразу
  const hintMic = useHint("mic");
  const [showDone, setShowDone] = useState(false);
  const now = new Date();

  // Три списка по смыслу: ответить, сделать самому, проследить за тем, о чём попросил(а)
  const { askMe, mine, asked, together, doneToday } = useMemo(() => {
    const byDue = (a: Task, b: Task) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999");
    const todayKey = new Date().toDateString();
    const open = tasks.filter((t) => t.status !== "done");
    const askMe = open.filter((t) => t.assignee_id === meId && t.status === "new" && t.created_by_id !== meId);
    return {
      askMe: askMe.sort(byDue),
      mine: open.filter((t) => t.assignee_id === meId && !askMe.includes(t)).sort(byDue),
      asked: open.filter((t) => t.created_by_id === meId && t.assignee_id !== meId).sort(byDue),
      // Совместные дела, где я не исполнитель и не автор: «муж зовёт в кино»
      together: open
        .filter((t) => t.participants.includes(meId) && t.assignee_id !== meId && t.created_by_id !== meId)
        .sort(byDue),
      doneToday: tasks.filter(
        (t) =>
          t.status === "done" &&
          (t.assignee_id === meId || t.created_by_id === meId) &&
          t.completed_at &&
          parseLocal(t.completed_at).toDateString() === todayKey,
      ),
    };
  }, [tasks, meId]);

  const myOpen = askMe.length + mine.length;
  const greeting = now.getHours() < 12 ? "Доброе утро" : now.getHours() < 18 ? "Добрый день" : "Добрый вечер";
  const empty = askMe.length + mine.length + asked.length + together.length + doneToday.length === 0;

  const card = (task: Task) => (
    <TaskCard
      key={task.id}
      task={task}
      members={members}
      meId={meId}
      overdue={task.status !== "done" && bucketOf(task) === "overdue"}
      onAccept={() => actions.accept(task.id)}
      onDecline={(reason) => actions.decline(task.id, reason)}
      onDone={() => actions.done(task.id)}
      onReopen={() => actions.reopen(task.id)}
      onReject={(comment) => actions.reject(task.id, comment)}
      onRename={(title) => actions.rename(task.id, title)}
      onNote={(note) => actions.note(task.id, note)}
      onAttach={(file) => actions.attach(task.id, file)}
      onDetach={(fileId) => actions.detach(task.id, fileId)}
      onAssign={(memberId) => actions.assign(task.id, memberId)}
      onDue={(iso) => actions.due(task.id, iso)}
      onEnd={(iso) => actions.end(task.id, iso)}
      onParticipants={(ids) => actions.participants(task.id, ids)}
      onRepeat={(value) => actions.repeat(task.id, value)}
      onItems={(items) => actions.items(task.id, items)}
      onDelete={() => actions.remove(task.id)}
      onCopy={() => actions.copy(task)}
    />
  );

  return (
    <div className="px-4 pb-4">
      <header className="pt-6 pb-4">
        <h1 className="font-display text-2xl leading-tight font-bold">
          {greeting}
          {me ? `, ${me.name}` : ""}
        </h1>
        <p className="mt-1 text-sm font-medium text-ink-2">
          {now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}
          {myOpen > 0 && ` · на вас ${myOpen} ${plural(myOpen, "дело", "дела", "дел")}`}
        </p>
      </header>

      <NotifyBanner />

      {family && me && isAlone(family, meId) && (
        <InviteSpouseCard family={family} me={me} onMoreWays={onOpenFamily} />
      )}

      {!loading && empty && <EmptyState hasMembers={members.length > 1} />}

      {!empty && !hintMic && (
        <Hint id="card" className="mb-4">
          Нажмите на дело, чтобы поменять время, исполнителя или добавить заметку. Кружок слева — отметить «Сделано».
        </Hint>
      )}

      <div className="space-y-6">
        {askMe.length > 0 && (
          <Section title="Ждут вашего ответа" count={askMe.length} accent>
            {askMe.map((task) => (
              <AskCard key={task.id} task={task} members={members} actions={actions} />
            ))}
          </Section>
        )}

        {mine.length > 0 && (
          <Section title="Мои дела" count={mine.length}>
            {mine.map(card)}
          </Section>
        )}

        {together.length > 0 && (
          <Section title="Я участвую" count={together.length}>
            {together.map(card)}
          </Section>
        )}

        {asked.length > 0 && (
          <Section title="Я попросил(а)" count={asked.length}>
            {asked.map(card)}
          </Section>
        )}

        {doneToday.length > 0 && (
          <section>
            <button
              onClick={() => setShowDone(!showDone)}
              aria-expanded={showDone}
              className="mb-2 text-[13px] font-bold tracking-wide text-ink-2 uppercase"
            >
              Сделано сегодня · {doneToday.length} {showDone ? "▴" : "▾"}
            </button>
            {showDone && <ul className="space-y-2">{doneToday.map(card)}</ul>}
          </section>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  accent = false,
  children,
}: {
  title: string;
  count: number;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className={`mb-2 text-[13px] font-bold tracking-wide uppercase ${accent ? "text-accent" : "text-ink-2"}`}>
        {title} · {count}
      </h2>
      <ul className="space-y-2">{children}</ul>
    </section>
  );
}

/** Просьба, которая ждёт ответа: крупно, с «Беру» и «Не могу» — не перепутать с остальными делами. */
function AskCard({ task, members, actions }: { task: Task; members: Member[]; actions: TaskActions }) {
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const author = members.find((m) => m.id === task.created_by_id)?.name ?? "Близкий";
  const overdue = bucketOf(task) === "overdue";
  const extra = [
    task.items.length > 0 && `список: ${task.items.length} ${plural(task.items.length, "пункт", "пункта", "пунктов")}`,
    task.files.length > 0 && `📎 ${task.files.length}`,
  ].filter(Boolean);
  return (
    <li className="bg-hero appear rounded-[24px] p-4 text-white shadow-lg">
      <p className="text-[11px] font-bold tracking-wider uppercase opacity-90">
        {overdue ? `${author} просит · просрочено` : `${author} просит`}
      </p>
      <p className="font-display mt-1 text-lg leading-snug font-bold">{task.title}</p>
      <p className="mt-1 text-sm font-medium opacity-95">
        {formatSpan(task.due_at, task.ends_at)}
        {extra.length > 0 && ` · ${extra.join(" · ")}`}
      </p>
      {task.note && <p className="mt-2 line-clamp-2 rounded-xl bg-white/20 px-2.5 py-1.5 text-sm">📝 {task.note}</p>}
      {declining ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            actions.decline(task.id, reason.trim() || null);
          }}
        >
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            placeholder="Почему не получится? Можно не писать"
            className="h-11 w-full rounded-xl bg-white px-3 text-base text-ink outline-none"
          />
          <div className="flex gap-2">
            <button type="submit" className="h-11 flex-1 rounded-xl bg-white font-semibold text-accent active:opacity-80">
              Отправить
            </button>
            <button
              type="button"
              onClick={() => setDeclining(false)}
              className="h-11 flex-1 rounded-xl bg-white/25 font-semibold active:opacity-80"
            >
              Назад
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => actions.accept(task.id)}
            className="h-11 flex-1 rounded-xl bg-white font-semibold text-accent active:opacity-80"
          >
            Беру
          </button>
          <button
            onClick={() => setDeclining(true)}
            className="h-11 flex-1 rounded-xl bg-white/25 font-semibold active:opacity-80"
          >
            Не могу
          </button>
        </div>
      )}
    </li>
  );
}

function EmptyState({ hasMembers }: { hasMembers: boolean }) {
  return (
    <div className="glass mt-2 rounded-3xl px-6 py-8 text-center">
      <p className="font-display text-lg font-bold">Пока тихо</p>
      <p className="mt-1 text-sm text-ink-2">
        Нажмите на микрофон и скажите, что нужно сделать. Например: «завтра в 7 забрать Соню с танцев».
      </p>
      {!hasMembers && (
        <p className="mt-4 text-sm text-ink-2">Просьбы уходят близким — пригласите их во вкладке «Семья».</p>
      )}
    </div>
  );
}

export function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
