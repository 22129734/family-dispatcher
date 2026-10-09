import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, tokenStore, type Draft, type Family, type Frequent, type Session, type Task } from "./api";
import { parseLocal, plainTitle } from "./format";
import { ConfirmSheet } from "./components/ConfirmSheet";
import { Composer } from "./components/Composer";
import { FamilyScreen } from "./screens/FamilyScreen";
import { CalendarScreen } from "./screens/CalendarScreen";
import { MoreScreen } from "./screens/MoreScreen";
import { applyTheme } from "./theme";
import { useSpeech } from "./useSpeech";
import { Join, Welcome } from "./screens/Onboarding";
import { PhoneLogin } from "./screens/PhoneLogin";
import { SetPin } from "./screens/SetPin";
import { ActPage } from "./screens/ActPage";
import { platform, syncPush } from "./push";
import { referralCode } from "./referral";
import { isAlone } from "./share";
import { Today, type TaskActions } from "./screens/Today";

type Tab = "today" | "calendar" | "family" | "more";

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
  return (
    <>
      {/* Цветные пятна под стеклом */}
      <div className="backdrop" aria-hidden>
        <i />
        <i />
        <i />
      </div>
      {/* Ссылка из уведомления работает без входа */}
      {actToken ? <ActPage token={actToken} /> : <Main />}
    </>
  );
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
        // Тема из профиля: выбранная на другом устройстве приезжает сюда
        applyTheme(account.member.theme);
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
  const [celebration, setCelebration] = useState<string | null>(null);
  // Статусы с прошлого обновления — чтобы заметить «Олег сделал!» по моим поручениям
  const seen = useRef<Map<string, Task["status"]> | null>(null);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [f, t] = await Promise.all([api.family(), api.tasks(7)]);
      const previous = seen.current;
      const justDone = previous
        ? t.find(
            (task) =>
              task.status === "done" &&
              previous.get(task.id) !== undefined &&
              previous.get(task.id) !== "done" &&
              task.created_by_id === me.id &&
              task.assignee_id !== me.id,
          )
        : undefined;
      if (justDone) {
        const who = f.members.find((m) => m.id === justDone.assignee_id)?.name ?? "Близкий";
        setCelebration(`${who} сделал(а): ${justDone.title}`);
        window.setTimeout(() => setCelebration(null), 6000);
      }
      seen.current = new Map(t.map((task) => [task.id, task.status]));
      setFamily(f);
      setTasks(t);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onLogout();
    } finally {
      setLoading(false);
    }
  }, [onLogout, me.id]);

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

  const alone = isAlone(family, me.id);

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
    rename: (id, title) => run(async () => replace(await api.updateTask(id, { title }))),
    note: (id, note) => run(async () => replace(await api.updateTask(id, { note }))),
    attach: async (id, file) => {
      try {
        replace(await api.attach(id, file));
        notify("Файл прикреплён");
      } catch (err) {
        notify((err as Error).message);
      }
    },
    detach: (id, fileId) => run(async () => replace(await api.detach(id, fileId))),
    reject: (id, comment) =>
      run(async () => {
        const task = await api.reject(id, comment);
        replace(task);
        notify(`Вернули: ${memberName(task.assignee_id)}. Ждём, пока сделает`);
      }),
    assign: (id, memberId) => run(async () => replace(await api.updateTask(id, { assignee_id: memberId }))),
    due: (id, iso) => run(async () => replace(await api.updateTask(id, { due_at: iso }))),
    end: (id, iso) => run(async () => replace(await api.updateTask(id, { ends_at: iso }))),
    repeat: (id, recurrence) => run(async () => replace(await api.updateTask(id, { recurrence }))),
    items: (id, items) => {
      // Отметка в списке — сразу на экране, сервер догонит
      setTasks((list) => list.map((t) => (t.id === id ? { ...t, items } : t)));
      void run(async () => replace(await api.setItems(id, items)));
    },
    copy: (task) => copyTask(task, plainTitle(task.title)),
    remove: (id) =>
      run(async () => {
        setTasks((list) => list.filter((t) => t.id !== id));
        await api.remove(id);
      }),
  };

  // Голос — главная кнопка в центре меню; работает с любой вкладки
  const speech = useSpeech((spoken) => void send(spoken, "voice"));
  const toggleVoice = () => {
    if (speech.listening) return speech.stop();
    setTab("today");
    speech.start();
  };

  // Шторка «Проверьте просьбу»: что сказали и что из этого понял разбор
  const [confirm, setConfirm] = useState<{
    draft: Draft;
    text: string;
    source: "text" | "voice" | "copy";
    heading?: string;
    startTime?: string;
    durationMin?: number | null;
  } | null>(null);

  // «Частые дела» над полем ввода — обновляем после каждой новой просьбы
  const [frequent, setFrequent] = useState<Frequent[]>([]);
  const loadFrequent = useCallback(() => {
    api.frequent().then(setFrequent).catch(() => undefined);
  }, []);
  useEffect(loadFrequent, [loadFrequent]);

  /** Копия дела: те же поля, время и продолжительность; день выбирают заново. */
  function copyTask(task: Task, title = task.title) {
    const minutes =
      task.due_at && task.ends_at
        ? Math.round((parseLocal(task.ends_at).getTime() - parseLocal(task.due_at).getTime()) / 60_000)
        : null;
    setConfirm({
      draft: {
        title,
        due_at: null,
        ends_at: null,
        recurrence: "none",
        priority: task.priority,
        items: task.items.map((item) => item.text),
        requires_car: task.requires_car,
        note: task.note,
        assignee_id: task.assignee_id,
        rationale: null,
        clarifying_question: null,
        unclear: true,
      },
      text: title,
      source: "copy",
      heading: "Повторить дело",
      startTime: task.due_at ? task.due_at.slice(11, 16) : undefined,
      durationMin: minutes,
    });
  }

  function announce(task: Task) {
    loadFrequent();
    setTasks((list) => [task, ...list.filter((t) => t.id !== task.id)]);
    setTab("today");
    const assignee = family?.members.find((m) => m.id === task.assignee_id);
    notify(
      !task.assignee_id
        ? "Добавлено — выберите, кто сделает"
        : task.assignee_id === me.id
          ? "Записано — это ваше дело"
          : assignee && !assignee.notifications
            ? `Попросили: ${assignee.name}. Уведомления у него(неё) выключены — скажите сами`
            : `Попросили: ${memberName(task.assignee_id)}. Ждём ответа`,
    );
  }

  async function send(text: string, source: "text" | "voice") {
    // Режим из профиля: never — сразу, always — всегда шторка, auto (по умолчанию) — если неясно
    const mode = family?.members.find((m) => m.id === me.id)?.confirm_mode ?? "auto";
    setSending(true);
    try {
      if (mode !== "never") {
        const draft = await api.parseTask(text, source);
        if (mode === "always" || draft.unclear) {
          setConfirm({ draft, text, source });
          return;
        }
        // Всё понятно — отправляем разобранное, второй раз модель не зовём
        announce(
          await api.createTask({
            title: draft.title,
            due_at: draft.due_at,
            ends_at: draft.ends_at,
            assignee_id: draft.assignee_id,
            recurrence: draft.recurrence,
            priority: draft.priority,
            items: draft.items,
            note: draft.note,
            requires_car: draft.requires_car,
            source,
            source_text: text,
          }),
        );
        return;
      }
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
              ? `Попросили: ${assignee.name}. Уведомления у него(неё) выключены — скажите сами`
              : `Попросили: ${memberName(task.assignee_id)}. Ждём ответа`,
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
      <main key={tab} className="pt-safe flex-1 overflow-y-auto pb-44">
        {tab === "today" ? (
          <Today
            tasks={tasks}
            members={family?.members ?? [me]}
            meId={me.id}
            actions={actions}
            loading={loading}
            family={family}
            onOpenFamily={() => setTab("family")}
          />
        ) : tab === "more" ? (
          <MoreScreen family={family} me={me} onLogout={onLogout} />
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
                    ? `Попросили: ${assignee.name}${assignee.notifications ? "" : ". Уведомления выключены — скажите сами"}`
                    : "Добавлено — выберите, кто сделает",
              );
            }}
          />
        ) : family ? (
          <FamilyScreen family={family} me={me} />
        ) : null}
      </main>

      {confirm && (
        <ConfirmSheet
          draft={confirm.draft}
          text={confirm.text}
          source={confirm.source}
          heading={confirm.heading}
          startTime={confirm.startTime}
          durationMin={confirm.durationMin}
          members={family?.members ?? [me]}
          meId={me.id}
          onCancel={() => setConfirm(null)}
          onSent={(task) => {
            setConfirm(null);
            announce(task);
            void refresh();
          }}
        />
      )}

      {celebration && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center px-4 pt-[max(16px,env(safe-area-inset-top))]">
          <div className="pop bg-hero flex max-w-sm items-center gap-3 rounded-3xl px-4 py-3 shadow-xl">
            <span className="text-2xl" aria-hidden>
              🎉
            </span>
            <p className="text-sm font-semibold">{celebration}</p>
          </div>
        </div>
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-44 z-30 flex justify-center px-4">
          <p className="appear max-w-sm rounded-2xl bg-ink px-4 py-2.5 text-center text-sm text-bg shadow-lg">{toast}</p>
        </div>
      )}

      <div className="pb-safe pointer-events-none fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md px-3 pb-3">
        {tab === "today" && (
          <div className="pointer-events-auto">
            <Composer
              onSend={send}
              busy={sending}
              speech={speech}
              note={alone ? "Запишется на вас — в семье пока никого нет" : null}
              spouse={family?.members.find((m) => m.id !== me.id && m.role === "adult")?.name ?? null}
              frequent={frequent}
              onFrequent={(item) => copyTask(item.task, item.title)}
            />
          </div>
        )}
        <nav className="glass pointer-events-auto mt-2 grid h-16 grid-cols-5 items-center rounded-[26px] px-1 shadow-lg">
          <TabButton active={tab === "today"} onClick={() => setTab("today")} label="Дела">
            <path d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />
          </TabButton>
          <TabButton active={tab === "calendar"} onClick={() => setTab("calendar")} label="Календарь">
            <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
          </TabButton>
          <div className="flex justify-center">
            <button
              onClick={toggleVoice}
              disabled={!speech.supported || sending}
              aria-label={speech.listening ? "Остановить запись" : "Сказать дело голосом"}
              className={`bg-fab -mt-7 flex h-14 w-14 items-center justify-center rounded-[20px] shadow-xl transition active:scale-95 disabled:opacity-50 ${
                speech.listening ? "listening" : ""
              }`}
            >
              {speech.listening ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="5" y="5" width="14" height="14" rx="3" />
                </svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4" />
                </svg>
              )}
            </button>
          </div>
          <TabButton active={tab === "family"} onClick={() => setTab("family")} label="Семья" dot={alone}>
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </TabButton>
          <TabButton active={tab === "more"} onClick={() => setTab("more")} label="Ещё">
            <path d="M5 12h.01M12 12h.01M19 12h.01" />
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
  dot = false,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  /** Точка-напоминание: на вкладке есть важное несделанное действие */
  dot?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${
        active ? "text-accent" : "text-ink-3"
      }`}
    >
      <span className="relative">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={label === "Ещё" ? 3.2 : 2} strokeLinecap="round" strokeLinejoin="round">
          {children}
        </svg>
        {dot && <span className="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-accent" aria-label="есть важное" />}
      </span>
      {label}
    </button>
  );
}
