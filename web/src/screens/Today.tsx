import { useMemo, useState } from "react";
import type { Family, Member, Recurrence, Task, TaskItem } from "../api";
import { isAlone } from "../share";
import { InstallCard } from "../components/InstallCard";
import { InviteSpouseCard } from "../components/InviteSpouseCard";
import { NotifyBanner } from "../components/NotifyBanner";
import { TaskCard } from "../components/TaskCard";
import { avatarTone, BUCKET_TITLES, bucketOf, formatSpan, parseLocal, type Bucket } from "../format";

const ORDER: Bucket[] = ["overdue", "today", "tomorrow", "later", "undated", "done"];

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
  repeat: (id: string, recurrence: Recurrence) => void;
  items: (id: string, items: TaskItem[]) => void;
  remove: (id: string) => void;
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
  const [scope, setScope] = useState<Scope>("mine");
  const now = new Date();

  const groups = useMemo(() => {
    const today = new Date().toDateString();
    const visible = tasks.filter(
      (t) =>
        inScope(t, scope, meId) &&
        (t.status !== "done" || (t.completed_at && parseLocal(t.completed_at).toDateString() === today)),
    );
    const map = new Map<Bucket, Task[]>();
    for (const task of visible) {
      const bucket = bucketOf(task);
      map.set(bucket, [...(map.get(bucket) ?? []), task]);
    }
    return ORDER.filter((b) => map.has(b)).map((b) => [b, map.get(b)!] as const);
  }, [tasks, scope, meId]);

  const myOpen = tasks.filter((t) => t.assignee_id === meId && t.status !== "done").length;
  const waitingTasks = tasks.filter(
    (t) => t.created_by_id === meId && t.status === "new" && t.assignee_id && t.assignee_id !== meId,
  );
  const askedMe = tasks.filter((t) => t.assignee_id === meId && t.status === "new").length;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const doneWeek = tasks.filter(
    (t) => t.status === "done" && t.completed_at && parseLocal(t.completed_at).getTime() >= weekAgo,
  ).length;
  const greeting = now.getHours() < 12 ? "Доброе утро" : now.getHours() < 18 ? "Добрый день" : "Добрый вечер";

  // Самое важное сейчас: ближайшее незакрытое дело, которое касается меня
  const hero = tasks
    .filter((t) => t.status !== "done" && (t.assignee_id === meId || t.created_by_id === meId))
    .sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"))[0];
  const shopping = tasks.find((t) => t.status !== "done" && t.items.some((i) => !i.done));
  const waitingWho = members.find((m) => m.id === waitingTasks[0]?.assignee_id)?.name;

  return (
    <div className="px-4 pb-4">
      <header className="flex items-start justify-between gap-3 pt-6 pb-3">
        <div>
          <p className="text-sm font-medium text-ink-2">
            {now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="font-display mt-0.5 text-2xl leading-tight font-bold">
            {greeting}
            {me ? `, ${me.name}` : ""}
          </h1>
          {myOpen > 0 && (
            <p className="mt-1 text-sm font-semibold text-ink-2">
              на вас {myOpen} {plural(myOpen, "дело", "дела", "дел")}
            </p>
          )}
        </div>
        <div className="mt-1 flex shrink-0">
          {members.slice(0, 4).map((m) => (
            <span
              key={m.id}
              title={m.name}
              className={`-ml-2 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white/80 text-sm font-bold text-white first:ml-0 ${avatarTone(m.id, members)}`}
            >
              {m.name.slice(0, 1).toUpperCase()}
            </span>
          ))}
        </div>
      </header>

      {/* Бенто: самое срочное, счётчики, покупки */}
      <div className="grid grid-cols-2 gap-2.5">
        {hero ? (
          <div className="bg-hero col-span-2 rounded-[26px] p-4 shadow-lg">
            <p className="text-[11px] font-bold tracking-wider uppercase opacity-90">
              {hero.due_at && parseLocal(hero.due_at) < now ? "Просрочено" : "Сейчас важнее всего"}
            </p>
            <p className="font-display mt-1 text-xl leading-snug font-bold">{hero.title}</p>
            <div className="mt-3 flex items-center justify-between text-sm font-semibold">
              <span className="opacity-95">
                {formatSpan(hero.due_at, hero.ends_at)} ·{" "}
                {hero.assignee_id === meId ? "я" : (members.find((m) => m.id === hero.assignee_id)?.name ?? "никто")}
              </span>
              <span className="rounded-full bg-white/25 px-2.5 py-1 text-xs">
                {hero.status === "accepted" ? "✓ взято" : hero.assignee_id ? "ждёт ответа" : "без исполнителя"}
              </span>
            </div>
          </div>
        ) : (
          <div className="bg-hero col-span-2 rounded-[26px] p-4 shadow-lg">
            <p className="font-display text-xl leading-snug font-bold">Всё спокойно</p>
            <p className="mt-1 text-sm opacity-90">Нажмите на микрофон внизу и скажите, что нужно сделать.</p>
          </div>
        )}
        <div className="bg-surface rounded-[22px] border p-3.5">
          <p className="font-display text-3xl leading-none font-bold">{waitingTasks.length + askedMe}</p>
          <p className="mt-1.5 text-xs font-semibold text-ink-2">
            {askedMe > 0
              ? `${plural(askedMe, "ждёт", "ждут", "ждут")} вашего ответа`
              : waitingWho
                ? `ждут ответа: ${waitingWho}`
                : "ждут ответа"}
          </p>
        </div>
        <div className="bg-surface rounded-[22px] border p-3.5">
          <p className="font-display text-3xl leading-none font-bold">{doneWeek}</p>
          <p className="mt-1.5 text-xs font-semibold text-ink-2">сделано семьёй за неделю</p>
        </div>
        {shopping && (
          <div className="bg-surface col-span-2 rounded-[22px] border p-3.5">
            <p className="text-xs font-semibold text-ink-2">
              🛒 {shopping.title} · {shopping.items.filter((i) => i.done).length} из {shopping.items.length}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {shopping.items.map((item, index) => (
                <button
                  key={`${item.text}-${index}`}
                  onClick={() =>
                    actions.items(
                      shopping.id,
                      shopping.items.map((it, i) => (i === index ? { ...it, done: !it.done } : it)),
                    )
                  }
                  className={`rounded-full bg-surface-2 px-3 py-1 text-sm font-medium ${item.done ? "text-ink-3 line-through" : ""}`}
                >
                  {item.text}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 mb-3">
        {/* Во всю ширину и в одну строку: на узких iPhone подписи переносились и вылезали за рамку */}
        <div className="glass grid grid-cols-3 gap-1 rounded-2xl p-1">
          {SCOPES.map(([value, label]) => (
            <button
              key={value}
              onClick={() => setScope(value)}
              className={`h-9 min-w-0 rounded-xl px-1 text-[13px] font-semibold whitespace-nowrap transition ${
                scope === value ? "bg-accent text-accent-ink shadow-sm" : "text-ink-2"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {family && me && isAlone(family, meId) && (
        <InviteSpouseCard family={family} me={me} onMoreWays={onOpenFamily} />
      )}
      <InstallCard />
      <NotifyBanner />

      {!loading && groups.length === 0 && <EmptyState hasMembers={members.length > 1} scope={scope} />}

      <div className="space-y-6">
        {groups.map(([bucket, items]) => (
          <section key={bucket}>
            <h2
              className={`mb-2 text-xs font-semibold tracking-wide uppercase ${
                bucket === "overdue" ? "text-warn" : "text-ink-3"
              }`}
            >
              {BUCKET_TITLES[bucket]} · {items.length}
            </h2>
            <ul className="space-y-2">
              {items.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  members={members}
                  meId={meId}
                  overdue={bucket === "overdue"}
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
                  onRepeat={(value) => actions.repeat(task.id, value)}
                  onItems={(items) => actions.items(task.id, items)}
                  onDelete={() => actions.remove(task.id)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

export type Scope = "mine" | "assigned" | "all";

export const SCOPES: [Scope, string][] = [
  ["mine", "Мне"],
  ["assigned", "Я попросил(а)"],
  ["all", "Вся семья"],
];

export function inScope(task: Task, scope: Scope, meId: string) {
  if (scope === "mine") return task.assignee_id === meId;
  if (scope === "assigned") return task.created_by_id === meId && task.assignee_id !== meId;
  return true;
}

function EmptyState({ hasMembers, scope }: { hasMembers: boolean; scope: Scope }) {
  const text = {
    mine: "Вас пока ни о чём не просили.",
    assigned: "Вы пока ни о чём не просили.",
    all: "В семье пока нет дел.",
  }[scope];
  return (
    <div className="glass mt-2 rounded-3xl px-6 py-8 text-center">
      <p className="font-display text-lg font-bold">Пока тихо</p>
      <p className="mt-1 text-sm text-ink-2">
        {text} Нажмите на микрофон и скажите, что нужно сделать. Например: «завтра в 7 забрать Соню с танцев».
      </p>
      {!hasMembers && (
        <p className="mt-4 text-sm text-ink-2">
          Просьбы уходят близким — пригласите близких во вкладке «Семья».
        </p>
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
