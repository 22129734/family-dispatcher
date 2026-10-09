import { useMemo, useState } from "react";
import type { Family, Member, Recurrence, Task, TaskItem } from "../api";
import { isAlone } from "../share";
import { InstallCard } from "../components/InstallCard";
import { InviteSpouseCard } from "../components/InviteSpouseCard";
import { NotifyBanner } from "../components/NotifyBanner";
import { TaskCard } from "../components/TaskCard";
import { BUCKET_TITLES, bucketOf, type Bucket } from "../format";

const ORDER: Bucket[] = ["overdue", "today", "tomorrow", "later", "undated", "done"];

export interface TaskActions {
  accept: (id: string) => void;
  decline: (id: string, reason: string | null) => void;
  done: (id: string) => void;
  reopen: (id: string) => void;
  assign: (id: string, memberId: string) => void;
  due: (id: string, iso: string | null) => void;
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
    const visible = tasks.filter((t) => inScope(t, scope, meId));
    const map = new Map<Bucket, Task[]>();
    for (const task of visible) {
      const bucket = bucketOf(task);
      map.set(bucket, [...(map.get(bucket) ?? []), task]);
    }
    return ORDER.filter((b) => map.has(b)).map((b) => [b, map.get(b)!] as const);
  }, [tasks, scope, meId]);

  const myOpen = tasks.filter((t) => t.assignee_id === meId && t.status !== "done").length;
  const waiting = tasks.filter(
    (t) => t.created_by_id === meId && t.status === "new" && t.assignee_id !== meId,
  ).length;
  const greeting = now.getHours() < 12 ? "Доброе утро" : now.getHours() < 18 ? "Добрый день" : "Добрый вечер";

  return (
    <div className="px-4 pb-4">
      <header className="pt-6 pb-4">
        <h1 className="text-2xl font-bold tracking-tight">
          {greeting}
          {myOpen > 0 ? `, на вас ${myOpen} ${plural(myOpen, "дело", "дела", "дел")}` : ""}
        </h1>
        {waiting > 0 && (
          <p className="mt-1 text-sm text-ink-2">
            Ждут ответа {waiting} {plural(waiting, "поручение", "поручения", "поручений")}
          </p>
        )}
        <div className="mt-4 inline-flex rounded-xl bg-surface-2 p-1">
          {SCOPES.map(([value, label]) => (
            <button
              key={value}
              onClick={() => setScope(value)}
              className={`h-8 rounded-lg px-3 text-sm font-medium transition ${
                scope === value ? "bg-surface text-ink shadow-sm" : "text-ink-2"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

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
                  onAssign={(memberId) => actions.assign(task.id, memberId)}
                  onDue={(iso) => actions.due(task.id, iso)}
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
  ["assigned", "Я поручил(а)"],
  ["all", "Вся семья"],
];

export function inScope(task: Task, scope: Scope, meId: string) {
  if (scope === "mine") return task.assignee_id === meId;
  if (scope === "assigned") return task.created_by_id === meId && task.assignee_id !== meId;
  return true;
}

function EmptyState({ hasMembers, scope }: { hasMembers: boolean; scope: Scope }) {
  const text = {
    mine: "Вам пока ничего не поручили.",
    assigned: "Вы пока никому ничего не поручали.",
    all: "В семье пока нет дел.",
  }[scope];
  return (
    <div className="mt-6 rounded-3xl border border-dashed border-line px-6 py-10 text-center">
      <p className="text-4xl">🏡</p>
      <p className="mt-3 text-lg font-semibold">Пока тихо</p>
      <p className="mt-1 text-sm text-ink-2">
        {text} Нажмите на микрофон и скажите, что нужно сделать. Например: «завтра в 7 забрать Соню с танцев».
      </p>
      {!hasMembers && (
        <p className="mt-4 text-sm text-ink-2">
          Поручения уходят близким — пригласите мужа или жену во вкладке «Семья».
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
