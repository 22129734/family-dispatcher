import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, tokenStore, type Family, type Session, type Task } from "./api";
import { Composer } from "./components/Composer";
import { FamilyScreen } from "./screens/FamilyScreen";
import { CalendarScreen } from "./screens/CalendarScreen";
import { HelpScreen } from "./screens/HelpScreen";
import { Join, Welcome } from "./screens/Onboarding";
import { PhoneLogin } from "./screens/PhoneLogin";
import { SetPin } from "./screens/SetPin";
import { ActPage } from "./screens/ActPage";
import { platform, syncPush } from "./push";
import { referralCode } from "./referral";
import { Today, type TaskActions } from "./screens/Today";

type Tab = "today" | "calendar" | "family" | "help";

const REFRESH_MS = 20_000;

function actTokenFromPath(): string | null {
  const match = window.location.pathname.match(/^\/t\/([\w.-]+)/);
  return match ? match[1] : null;
}

function inviteCodeFromPath(): string | null {
  const match = window.location.pathname.match(/^\/join\/([\w-]+)/);
  return match ? match[1] : null;
}

type Stage = "booting" | "login" | "setpin" | "onboarding" | "home";

export default function App() {
  const actToken = actTokenFromPath();
  // Ссылка из уведомления работает без входа
  if (actToken) return <ActPage token={actToken} />;
  return <Main />;
}

function Main() {
  const [stage, setStage] = useState<Stage>("booting");
  const [session, setSession] = useState<Session | null>(null);
  const [invitedBy, setInvitedBy] = useState<string | null>(null);
  const [recommendedBy, setRecommendedBy] = useState<string | null>(null);
  const inviteCode = inviteCodeFromPath();

  // Есть сессия → смотрим, состоит ли человек в семье; нет → вход по телефону
  const resolve = useCallback(async () => {
    if (!tokenStore.get()) return setStage("login");
    try {
      const account = await api.account();
      // Сразу после первого входа звонком — PIN-код для следующих входов
      if (!account.has_pin) return setStage("setpin");
      if (account.member && account.family_id) {
        setSession({ token: tokenStore.get() ?? "", member: account.member, family_id: account.family_id });
        setStage("home");
      } else {
        setStage("onboarding");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) tokenStore.set(null);
      setStage("login");
    }
  }, []);

  useEffect(() => {
    void resolve();
    const ref = referralCode();
    if (inviteCode) {
      api.inviteInfo(inviteCode).then(
        (info) => setInvitedBy(info.members.join(", ") || null),
        () => undefined,
      );
    } else if (ref) {
      api.referralInfo(ref).then(
        (info) => setRecommendedBy(info.from_name),
        () => undefined,
      );
    }
  }, [resolve, inviteCode]);

  const onToken = useCallback(
    (token: string) => {
      tokenStore.set(token);
      void resolve();
    },
    [resolve],
  );

  const start = (s: Session) => {
    tokenStore.set(s.token);
    window.history.replaceState(null, "", "/");
    setSession(s);
    setStage("home");
  };

  const logout = useCallback(() => {
    void api.logout();
    tokenStore.set(null);
    setSession(null);
    setStage("login");
  }, []);

  if (stage === "booting") return <div className="min-h-dvh" />;
  if (stage === "login") return <PhoneLogin onToken={onToken} invitedBy={invitedBy} recommendedBy={recommendedBy} />;
  if (stage === "setpin") return <SetPin onDone={() => void resolve()} />;
  if (stage === "onboarding" || !session) {
    return inviteCode ? <Join code={inviteCode} onSession={start} /> : <Welcome onSession={start} />;
  }
  return <Home session={session} onLogout={logout} />;
}

function Home({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("today");
  const me = session.member;
  const [family, setFamily] = useState<Family | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [f, t] = await Promise.all([api.family(), api.tasks()]);
      setFamily(f);
      setTasks(t);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onLogout();
    } finally {
      setLoading(false);
    }
  }, [onLogout]);

  useEffect(() => {
    api.track(platform().standalone ? "pwa_opened" : "app_open");
    void syncPush();
    void refresh();
    const timer = window.setInterval(() => document.visibilityState === "visible" && void refresh(), REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const memberName = (id: string | null) =>
    id === me.id ? "вам" : (family?.members.find((m) => m.id === id)?.name ?? "никому");

  const replace = (task: Task) => setTasks((list) => list.map((t) => (t.id === task.id ? task : t)));

  async function run(action: () => Promise<void>) {
    try {
      await action();
    } catch (err) {
      notify((err as Error).message);
    }
    void refresh();
  }

  const actions: TaskActions = {
    accept: (id) => run(async () => replace(await api.accept(id))),
    decline: (id, reason) =>
      run(async () => {
        replace(await api.decline(id, reason));
        notify("Вернули автору");
      }),
    done: (id) =>
      run(async () => {
        replace(await api.done(id));
      }),
    reopen: (id) => run(async () => replace(await api.reopen(id))),
    assign: (id, memberId) => run(async () => replace(await api.updateTask(id, { assignee_id: memberId }))),
    due: (id, iso) => run(async () => replace(await api.updateTask(id, { due_at: iso }))),
    repeat: (id, recurrence) => run(async () => replace(await api.updateTask(id, { recurrence }))),
    items: (id, items) => {
      // Отметка в списке — сразу на экране, сервер догонит
      setTasks((list) => list.map((t) => (t.id === id ? { ...t, items } : t)));
      void run(async () => replace(await api.setItems(id, items)));
    },
    remove: (id) =>
      run(async () => {
        setTasks((list) => list.filter((t) => t.id !== id));
        await api.remove(id);
      }),
  };

  async function send(text: string, source: "text" | "voice") {
    setSending(true);
    try {
      const task = await api.dispatch(text, source);
      setTasks((list) => [task, ...list]);
      setTab("today");
      const assignee = family?.members.find((m) => m.id === task.assignee_id);
      notify(
        !task.assignee_id
          ? "Добавлено — выберите, кто сделает"
          : task.assignee_id === me.id
            ? "Записано — это ваше дело"
            : assignee && !assignee.notifications
              ? `Поручено: ${assignee.name}. Уведомления у него(неё) выключены — скажите сами`
              : `Поручено: ${memberName(task.assignee_id)}. Ждём ответа`,
      );
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setSending(false);
      void refresh();
    }
  }

  return (
    <div className="mx-auto flex h-dvh max-w-md flex-col">
      <main key={tab} className="pt-safe flex-1 overflow-y-auto">
        {tab === "today" ? (
          <Today
            tasks={tasks}
            members={family?.members ?? [me]}
            meId={me.id}
            actions={actions}
            loading={loading}
          />
        ) : tab === "help" ? (
          <HelpScreen />
        ) : tab === "calendar" ? (
          <CalendarScreen
            tasks={tasks}
            members={family?.members ?? [me]}
            meId={me.id}
            actions={actions}
            onCreated={(task) => {
              setTasks((list) => [task, ...list]);
              const assignee = family?.members.find((m) => m.id === task.assignee_id);
              notify(
                task.assignee_id === me.id
                  ? "Записано — это ваше дело"
                  : assignee
                    ? `Поручено: ${assignee.name}${assignee.notifications ? "" : ". Уведомления выключены — скажите сами"}`
                    : "Добавлено — выберите, кто сделает",
              );
            }}
          />
        ) : family ? (
          <FamilyScreen family={family} me={me} onLogout={onLogout} />
        ) : null}
      </main>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-40 flex justify-center px-4">
          <p className="appear max-w-sm rounded-2xl bg-ink px-4 py-2.5 text-center text-sm text-bg shadow-lg">{toast}</p>
        </div>
      )}

      <div className="pb-safe shrink-0 bg-bg">
        {tab === "today" && <Composer onSend={send} busy={sending} />}
        <nav className="grid grid-cols-4 border-t border-line">
          <TabButton active={tab === "today"} onClick={() => setTab("today")} label="Дела">
            <path d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />
          </TabButton>
          <TabButton active={tab === "calendar"} onClick={() => setTab("calendar")} label="Календарь">
            <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
          </TabButton>
          <TabButton active={tab === "family"} onClick={() => setTab("family")} label="Семья">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </TabButton>
          <TabButton active={tab === "help"} onClick={() => setTab("help")} label="Помощь">
            <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M14.83 9.17l4.24-4.24M4.93 19.07l4.24-4.24" />
          </TabButton>
        </nav>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
        active ? "text-accent" : "text-ink-3"
      }`}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
      {label}
    </button>
  );
}
