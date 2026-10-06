import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, tokenStore, type Family, type Member, type Session, type Task } from "./api";
import { Composer } from "./components/Composer";
import { FamilyScreen } from "./screens/FamilyScreen";
import { Join, Welcome } from "./screens/Onboarding";
import { PhoneLogin } from "./screens/PhoneLogin";
import { Today, type TaskActions } from "./screens/Today";

type Tab = "today" | "family";

const REFRESH_MS = 20_000;

function inviteCodeFromPath(): string | null {
  const match = window.location.pathname.match(/^\/join\/([\w-]+)/);
  return match ? match[1] : null;
}

type Stage = "booting" | "login" | "onboarding" | "home";

export default function App() {
  const [stage, setStage] = useState<Stage>("booting");
  const [session, setSession] = useState<Session | null>(null);
  const [invitedTo, setInvitedTo] = useState<string | null>(null);
  const inviteCode = inviteCodeFromPath();

  // Есть сессия → смотрим, состоит ли человек в семье; нет → вход по телефону
  const resolve = useCallback(async () => {
    if (!tokenStore.get()) return setStage("login");
    try {
      const account = await api.account();
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
    if (inviteCode) api.inviteInfo(inviteCode).then((info) => setInvitedTo(info.family_name), () => undefined);
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
  if (stage === "login") return <PhoneLogin onToken={onToken} invitedTo={invitedTo} />;
  if (stage === "onboarding" || !session) {
    return inviteCode ? <Join code={inviteCode} onSession={start} /> : <Welcome onSession={start} />;
  }
  return <Home session={session} onLogout={logout} />;
}

function Home({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("today");
  const [me, setMe] = useState<Member>(session.member);
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
    api.track("app_open");
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
      notify(
        !task.assignee_id
          ? "Добавлено — выберите, кто сделает"
          : task.assignee_id === me.id
            ? "Записано — это ваше дело"
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
            familyName={family?.name ?? ""}
            actions={actions}
            loading={loading}
          />
        ) : family ? (
          <FamilyScreen family={family} me={me} onMeChanged={setMe} onLogout={onLogout} />
        ) : null}
      </main>

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-40 flex justify-center px-4">
          <p className="appear max-w-sm rounded-2xl bg-ink px-4 py-2.5 text-center text-sm text-bg shadow-lg">{toast}</p>
        </div>
      )}

      <div className="pb-safe shrink-0 bg-bg">
        {tab === "today" && <Composer onSend={send} busy={sending} />}
        <nav className="grid grid-cols-2 border-t border-line">
          <TabButton active={tab === "today"} onClick={() => setTab("today")} label="Дела">
            <path d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />
          </TabButton>
          <TabButton active={tab === "family"} onClick={() => setTab("family")} label="Семья">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
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
