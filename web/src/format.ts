import type { Task } from "./api";

/** Сервер отдаёт время без часового пояса (локальное время семьи) — парсим как локальное. */
export const parseLocal = (iso: string) => new Date(iso);

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayDiff = (a: Date, b: Date) =>
  Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86_400_000);

export function formatDue(iso: string | null, now = new Date()): string {
  if (!iso) return "без срока";
  const date = parseLocal(iso);
  const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const diff = dayDiff(date, now);
  if (diff === 0) return `сегодня, ${time}`;
  if (diff === 1) return `завтра, ${time}`;
  if (diff === -1) return `вчера, ${time}`;
  const day = date.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" });
  return `${day}, ${time}`;
}

export type Bucket = "overdue" | "today" | "tomorrow" | "later" | "undated" | "done";

export const BUCKET_TITLES: Record<Bucket, string> = {
  overdue: "Просрочено",
  today: "Сегодня",
  tomorrow: "Завтра",
  later: "Позже",
  undated: "Без срока",
  done: "Сделано",
};

export function bucketOf(task: Task, now = new Date()): Bucket {
  if (task.status === "done") return "done";
  if (!task.due_at) return "undated";
  const due = parseLocal(task.due_at);
  if (due < now) return "overdue";
  const diff = dayDiff(due, now);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return "later";
}

/** Значение для <input type="datetime-local"> и обратно — в локальном времени. */
export function toInputValue(iso: string | null): string {
  const d = iso ? parseLocal(iso) : new Date(Date.now() + 3_600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fromInputValue = (value: string) => (value ? `${value}:00` : null);

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} мин`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

export const RECURRENCE_LABEL: Record<Task["recurrence"], string | null> = {
  none: null,
  daily: "каждый день",
  weekly: "каждую неделю",
  monthly: "каждый месяц",
};

export const initials = (name: string) => name.trim().slice(0, 1).toUpperCase();

const AVATAR_TONES = ["tone-a", "tone-b", "tone-c", "tone-d", "tone-e"];
export function avatarTone(memberId: string, members: { id: string }[]): string {
  const index = members.findIndex((m) => m.id === memberId);
  return AVATAR_TONES[(index < 0 ? 0 : index) % AVATAR_TONES.length];
}
