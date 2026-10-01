import { useMemo, useState } from "react";
import type { Member, Task } from "../api";
import { TaskCard } from "../components/TaskCard";
import { BUCKET_TITLES, bucketOf, type Bucket } from "../format";

const ORDER: Bucket[] = ["overdue", "today", "tomorrow", "later", "undated", "done"];

export interface TaskActions {
  done: (id: string) => void;
  reopen: (id: string) => void;
  reassign: (id: string) => void;
  assign: (id: string, memberId: string) => void;
  due: (id: string, iso: string | null) => void;
  remove: (id: string) => void;
}

export function Today({
  tasks,
  members,
  meId,
  familyName,
  actions,
  loading,
}: {
  tasks: Task[];
  members: Member[];
  meId: string;
  familyName: string;
  actions: TaskActions;
  loading: boolean;
}) {
  const [scope, setScope] = useState<"mine" | "all">("all");
  const now = new Date();

  const groups = useMemo(() => {
    const visible = scope === "mine" ? tasks.filter((t) => t.assignee_id === meId) : tasks;
    const map = new Map<Bucket, Task[]>();
    for (const task of visible) {
      const bucket = bucketOf(task);
      map.set(bucket, [...(map.get(bucket) ?? []), task]);
    }
    return ORDER.filter((b) => map.has(b)).map((b) => [b, map.get(b)!] as const);
  }, [tasks, scope, meId]);

  const myOpen = tasks.filter((t) => t.assignee_id === meId && t.status === "open").length;
  const greeting = now.getHours() < 12 ? "Доброе утро" : now.getHours() < 18 ? "Добрый день" : "Добрый вечер";

  return (
    <div className="px-4 pb-4">
      <header className="pt-6 pb-4">
        <p className="text-sm text-ink-2">{familyName}</p>
        <h1 className="mt-0.5 text-2xl font-bold tracking-tight">
          {greeting}
          {myOpen > 0 ? `, на вас ${myOpen} ${plural(myOpen, "дело", "дела", "дел")}` : ""}
        </h1>
        <div className="mt-4 inline-flex rounded-xl bg-surface-2 p-1">
          {(["all", "mine"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setScope(value)}
              className={`h-8 rounded-lg px-4 text-sm font-medium transition ${
                scope === value ? "bg-surface text-ink shadow-sm" : "text-ink-2"
              }`}
            >
              {value === "all" ? "Вся семья" : "Мои"}
            </button>
          ))}
        </div>
      </header>

      {!loading && groups.length === 0 && <EmptyState hasMembers={members.length > 1} />}

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
                  onDone={() => actions.done(task.id)}
                  onReopen={() => actions.reopen(task.id)}
                  onReassign={() => actions.reassign(task.id)}
                  onAssign={(memberId) => actions.assign(task.id, memberId)}
                  onDue={(iso) => actions.due(task.id, iso)}
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

function EmptyState({ hasMembers }: { hasMembers: boolean }) {
  return (
    <div className="mt-6 rounded-3xl border border-dashed border-line px-6 py-10 text-center">
      <p className="text-4xl">🏡</p>
      <p className="mt-3 text-lg font-semibold">Пока тихо</p>
      <p className="mt-1 text-sm text-ink-2">
        Нажмите на микрофон и скажите, что нужно сделать. Например: «в субботу отвезти маму на дачу».
      </p>
      {!hasMembers && (
        <p className="mt-4 text-sm text-ink-2">
          Диспетчер раскладывает дела между людьми — пригласите близких во вкладке «Семья».
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
