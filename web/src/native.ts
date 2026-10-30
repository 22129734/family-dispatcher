/**
 * Android-приложение из RuStore: веб-версия открыта внутри него и общается с ним через
 * window.DispatcherApp. Там нет Web Push и Web Speech — вместо них push RuStore и системный
 * голосовой ввод. Ответы приложения приходят в window.dispatcherNative.
 */
import { api, type Task } from "./api";

interface DispatcherApp {
  version(): string;
  pushToken(): string;
  notificationsState(): "on" | "ask" | "unavailable";
  requestNotifications(): void;
  startVoice(): void;
  saveSnapshot(json: string): void;
  clearSnapshot(): void;
}

type Listener = (value: string | null) => void;
const listeners: Record<string, Set<Listener>> = {};

function on(name: string, listener: Listener): () => void {
  (listeners[name] ??= new Set()).add(listener);
  return () => listeners[name]?.delete(listener);
}

declare global {
  interface Window {
    DispatcherApp?: DispatcherApp;
    dispatcherNative?: Record<string, Listener>;
  }
}

// Приложение вызывает window.dispatcherNative.<имя>(значение)
window.dispatcherNative = new Proxy({} as Record<string, Listener>, {
  get: (_target, name: string) => (value: string | null) => listeners[name]?.forEach((fn) => fn(value)),
});

export function nativeApp(): DispatcherApp | null {
  return window.DispatcherApp ?? null;
}

export const isNativeApp = () => nativeApp() !== null;

// ---------- Push RuStore ----------

let sentToken: string | null = null;

/** Передать push-токен телефона на сервер — он теперь принадлежит тому, кто вошёл. */
async function registerToken(token: string | null) {
  if (!token || token === sentToken) return;
  await api.nativePushRegister(token);
  sentToken = token;
}

/** При входе и при смене токена (RuStore выдал новый) — токен на сервер. */
export function syncNativePush() {
  const app = nativeApp();
  if (!app) return;
  void registerToken(app.pushToken()).catch(() => undefined);
}

on("onPushToken", (token) => void registerToken(token).catch(() => undefined));

export function nativePushState(): "on" | "ask" | "unavailable" {
  return nativeApp()?.notificationsState() ?? "unavailable";
}

/** По нажатию «Включить»: системный вопрос Android, затем токен на сервер. */
export function enableNativePush(): Promise<"on" | "ask" | "unavailable"> {
  const app = nativeApp();
  if (!app) return Promise.resolve("unavailable");
  return new Promise((resolve) => {
    const off = on("onNotifications", (state) => {
      off();
      syncNativePush();
      resolve((state as "on" | "ask" | "unavailable") ?? "ask");
    });
    app.requestNotifications();
  });
}

/** Выход из аккаунта: этому телефону больше не слать уведомления человека, дела забыть. */
export async function forgetNativeDevice() {
  const app = nativeApp();
  if (!app) return;
  const token = app.pushToken();
  if (token) await api.nativePushUnregister(token).catch(() => undefined);
  sentToken = null;
  app.clearSnapshot();
}

// ---------- Голос ----------

/** Системный голосовой ввод Android; текст (или null — отменили) придёт в onResult. */
export function startNativeVoice(onResult: (text: string | null) => void): () => void {
  const app = nativeApp();
  if (!app) return () => undefined;
  const off = on("onVoice", (text) => {
    off();
    onResult(text);
  });
  app.startVoice();
  return off;
}

// ---------- Офлайн ----------

function when(task: Task): string {
  if (!task.due_at) return "без срока";
  const due = new Date(task.due_at);
  return due.toLocaleString("ru-RU", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Снимок открытых дел: приложение покажет его без интернета. */
export function saveNativeSnapshot(tasks: Task[], names: Record<string, string>) {
  const app = nativeApp();
  if (!app) return;
  const open = tasks
    .filter((t) => t.status !== "done")
    .slice(0, 50)
    .map((t) => {
      const who = t.assignee_id ? names[t.assignee_id] : null;
      const status = t.status === "new" ? "ждёт ответа" : "взято";
      return { title: t.title, details: [when(t), who, status].filter(Boolean).join(" · ") };
    });
  try {
    app.saveSnapshot(JSON.stringify({ saved_at: new Date().toISOString(), tasks: open }));
  } catch {
    /* приложение старой версии — без офлайн-экрана */
  }
}
