import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  tokenStore,
  type BatchItem,
  type Draft,
  type Family,
  type Frequent,
  type InviteInfo,
  type Session,
  type Task,
} from "./api";
import { parseLocal, plainTitle } from "./format";
import { ConfirmSheet } from "./components/ConfirmSheet";
import { BatchSheet } from "./components/BatchSheet";
import { ChatSheet } from "./components/ChatSheet";
import { prepareFile } from "./components/TaskFiles";
import { Tour, tourDismissed } from "./components/Tour";
import { Composer } from "./components/Composer";
import { dismissAllHints, dismissHint, Hint } from "./components/Hint";
import { FamilyScreen } from "./screens/FamilyScreen";
import { CalendarScreen } from "./screens/CalendarScreen";
import { MoreScreen } from "./screens/MoreScreen";
import { applyTheme } from "./theme";
import { useSpeech } from "./useSpeech";
import { Join, MoveToFamily, Welcome } from "./screens/Onboarding";
import { clearInvite, inviteCode, setInvite } from "./invite";
import { pendingCall } from "./pendingCall";
import { PhoneLogin } from "./screens/PhoneLogin";
import { SetPin } from "./screens/SetPin";
import { ActPage } from "./screens/ActPage";
import { platform, syncPush } from "./push";
import { referralCode } from "./referral";
import { isAlone } from "./share";
import { Today, type TaskActions } from "./screens/Today";
import { InviteIntro, Landing, RecommendIntro } from "./screens/Landing";

// Уже входил на этом устройстве — знакомство не нужно, сразу вход
const KNOWN_KEY = "fd.known";
const rememberDevice = () => {
  try {
    localStorage.setItem(KNOWN_KEY, "1");
  } catch {
    /* приватный режим — в следующий раз снова покажем знакомство */
  }
};
const knownDevice = () => {
  try {
    return localStorage.getItem(KNOWN_KEY) === "1";
  } catch {
    return false;
  }
};

type Tab = "today" | "calendar" | "family" | "more";

const REFRESH_MS = 20_000;
// Сколько секунд можно «Вернуть» после «Готово»
const UNDO_MS = 5_000;

function actTokenFromPath(): string | null {
  const match = window.location.pathname.match(/^\/t\/([\w.-]+)/);
  return match ? match[1] : null;
}


type Stage = "booting" | "login" | "setpin" | "onboarding" | "move" | "home";

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
  const [inviter, setInviter] = useState<string | null>(null);
  // Имя пригласившего ещё грузится — не мелькаем «Близкий приглашает» и чужой страницей
  const [linkChecked, setLinkChecked] = useState(false);
  // Приглашение — из ссылки или запомненное на телефоне, если ссылка потерялась
  const [code, setCode] = useState<string | null>(inviteCode);
  const [moveInfo, setMoveInfo] = useState<InviteInfo | null>(null);
  // Знакомство до входа: «full» — страница о проекте, «short» — личный экран приглашения или рекомендации
  const [intro, setIntro] = useState<"full" | "short" | null>(() =>
    // Вернулись из звонка — сразу к ожиданию подтверждения, без знакомства
    platform().standalone || knownDevice() || pendingCall() ? null : code || referralCode() ? "short" : "full",
  );

  // Есть сессия → смотрим, состоит ли человек в семье; нет → вход по телефону
  const resolve = useCallback(async () => {
    if (!tokenStore.get()) return setStage("login");
    try {
      const account = await api.account();
      rememberDevice();
      // Номер пригласили в семью — дальше как по ссылке-приглашению
      if (account.invite && account.invite.code !== inviteCode()) {
        setInvite(account.invite.code);
        setCode(account.invite.code);
      }
      // Сразу после первого входа звонком — PIN-код для следующих входов
      if (!account.has_pin) return setStage("setpin");
      if (account.member && account.family_id) {
        // Тема из профиля: выбранная на другом устройстве приезжает сюда
        applyTheme(account.member.theme);
        setSession({ token: tokenStore.get() ?? "", member: account.member, family_id: account.family_id });
        // Позвали в другую семью, а своя уже есть — спросим, перейти ли
        const pending = inviteCode();
        if (pending) {
          const info = await api.inviteInfo(pending).catch(() => null);
          if (info && info.family_id !== account.family_id) {
            setMoveInfo(info);
            return setStage("move");
          }
          clearInvite();
          setCode(null);
        }
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
    if (code) {
      api.inviteInfo(code).then(
        (info) => {
          setInvitedBy(info.members.join(", ") || null);
          setInviter(info.members[0] ?? null);
        },
        () => undefined,
      ).finally(() => setLinkChecked(true));
    } else if (ref) {
      api.referralInfo(ref).then(
        (info) => setRecommendedBy(info.from_name),
        () => undefined,
      ).finally(() => setLinkChecked(true));
    } else {
      setLinkChecked(true);
    }
  }, [resolve, code]);

  const onToken = useCallback(
    (token: string) => {
      tokenStore.set(token);
      rememberDevice();
      void resolve();
    },
    [resolve],
  );

  const start = (s: Session) => {
    clearInvite();
    setCode(null);
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
  if (stage === "login" && intro === "short" && !linkChecked) return <div className="min-h-dvh" />;
  if (stage === "login" && intro === "short" && code) {
    return <InviteIntro inviter={inviter} onJoin={() => setIntro(null)} />;
  }
  if (stage === "login" && intro === "short" && recommendedBy) {
    return (
      <RecommendIntro
        from={recommendedBy}
        onTry={() => setIntro(null)}
        onMore={() => setIntro("full")}
        onLogin={() => setIntro(null)}
      />
    );
  }
  if (stage === "login" && (intro === "full" || (intro === "short" && !code))) {
    // Рекомендация ещё грузится или код не нашёлся — показываем страницу о проекте
    return <Landing onTry={() => setIntro(null)} onLogin={() => setIntro(null)} />;
  }
  if (stage === "login") {
    return (
      <PhoneLogin
        onToken={onToken}
        invitedBy={invitedBy}
        recommendedBy={recommendedBy}
        onBack={knownDevice() ? undefined : () => setIntro(code ? "short" : "full")}
      />
    );
  }
  if (stage === "setpin") return <SetPin onDone={() => void resolve()} />;
  if (stage === "move" && moveInfo && code && session) {
    return (
      <MoveToFamily
        code={code}
        info={moveInfo}
        onMoved={start}
        onStay={() => {
          clearInvite();
          setCode(null);
          window.history.replaceState(null, "", "/");
          setStage("home");
        }}
      />
    );
  }
  if (stage === "onboarding" || !session) {
    return code ? <Join code={code} onSession={start} /> : <Welcome onSession={start} />;
  }
  return <Home session={session} onLogout={logout} />;
}

function Home({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("today");
  const [family, setFamily] = useState<Family | null>(null);
  // Из семьи — свежее: имя могли поменять в «Ещё»
  const me = family?.members.find((m) => m.id === session.member.id) ?? session.member;
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

  // Выбрал(а) «Нет, разберусь» на другом устройстве — подсказки закрыты и здесь
  useEffect(() => {
    if (me.hints_off) dismissAllHints();
  }, [me.hints_off]);

  // Обучение при первом входе — пока человек не прошёл путь «поручила — сделано»
  const [tourClosed, setTourClosed] = useState(() => tourDismissed(session.member.id));
  const [tourTaskId, setTourTaskId] = useState<string | null>(null);
  const tourNeeded = !tourClosed && !loading && !!family && me.path_done === false;
  // Начатое обучение доводим до вопроса о подсказках, даже если путь уже засчитан
  const [tourStarted, setTourStarted] = useState(false);
  useEffect(() => {
    if (tourNeeded) setTourStarted(true);
  }, [tourNeeded]);
  const tourOn = !tourClosed && (tourNeeded || tourStarted);

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

  // «Готово» с отменой: дело зеленеет сразу, на сервер уходит через 5 секунд
  const pending = useRef(new Map<string, number>());
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [undo, setUndo] = useState<{ id: string; title: string } | null>(null);

  function forget(id: string) {
    window.clearTimeout(pending.current.get(id));
    pending.current.delete(id);
    setPendingIds([...pending.current.keys()]);
    setUndo((current) => (current?.id === id ? null : current));
  }

  function commitDone(id: string) {
    if (!pending.current.has(id)) return;
    forget(id);
    void run(async () => replace(await api.done(id)));
  }

  const undoDone = (id: string) => forget(id);

  // Свернули приложение до истечения 5 секунд — отправляем отмеченное сразу, чтобы не потерять
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") for (const id of [...pending.current.keys()]) commitDone(id);
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  });

  const actions: TaskActions = {
    accept: (id) => run(async () => replace(await api.accept(id))),
    decline: (id, reason) =>
      run(async () => {
        replace(await api.decline(id, reason));
        notify("Вернули автору");
      }),
    // «Готово»: на сервер — через 5 секунд, до этого можно «Вернуть»
    done: (id) => {
      if (pending.current.has(id)) return;
      const title = tasks.find((t) => t.id === id)?.title ?? "";
      pending.current.set(id, window.setTimeout(() => commitDone(id), UNDO_MS));
      setPendingIds([...pending.current.keys()]);
      setUndo({ id, title });
    },
    isPending: (id) => pendingIds.includes(id),
    thank: (id) =>
      run(async () => {
        const task = await api.thank(id);
        replace(task);
        notify(`${memberName(task.assignee_id)} получит ваше спасибо 💜`);
      }),
    undo: (id) => undoDone(id),
    reopen: (id) => run(async () => replace(await api.reopen(id))),
    rename: (id, title) => run(async () => replace(await api.updateTask(id, { title }))),
    note: (id, note, repeat) =>
      run(async () => replace(await api.updateTask(id, repeat === undefined ? { note } : { note, note_repeat: repeat }))),
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
    participants: (id, ids) => run(async () => replace(await api.updateTask(id, { participants: ids }))),
    repeat: (id, value) =>
      run(async () =>
        replace(
          await api.updateTask(id, {
            recurrence: value.recurrence,
            repeat_days: value.days,
            repeat_until: value.forever ? null : value.until,
            repeat_forever: value.forever,
          }),
        ),
      ),
    items: (id, items) => {
      // Отметка в списке — сразу на экране, сервер догонит
      setTasks((list) => list.map((t) => (t.id === id ? { ...t, items } : t)));
      void run(async () => replace(await api.setItems(id, items)));
    },
    copy: (task) => copyTask(task, plainTitle(task.title)),
    chat: (task) => setChatId(task.id),
    remove: (id) =>
      run(async () => {
        setTasks((list) => list.filter((t) => t.id !== id));
        await api.remove(id);
      }),
  };

  // Переписка по делу; из уведомления приходит ссылка /?chat=<id>
  const [chatId, setChatId] = useState<string | null>(() => {
    const id = new URLSearchParams(window.location.search).get("chat");
    if (id) window.history.replaceState(null, "", window.location.pathname);
    return id;
  });
  const chatTask = chatId ? tasks.find((t) => t.id === chatId) : undefined;

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

  // Несколько дел в одном сообщении — шторка со списком
  const [batch, setBatch] = useState<{
    items: BatchItem[];
    text: string;
    source: "text" | "voice";
    assigneeId: string | null;
  } | null>(null);

  // Высота нижней панели (поле, «Частые дела», меню) — уведомления ставим над ней, а не поверх
  const dock = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(176);
  useEffect(() => {
    const el = dock.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setDockHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
        repeat_days: [],
        repeat_until: null,
        priority: task.priority,
        items: task.items.map((item) => item.text),
        requires_car: task.requires_car,
        note: task.note,
        assignee_id: task.assignee_id,
        participant_ids: task.participants,
        rationale: null,
        clarifying_question: null,
        unclear: true,
        batch: [],
      },
      text: title,
      source: "copy",
      heading: "Повторить дело",
      startTime: task.due_at ? task.due_at.slice(11, 16) : undefined,
      durationMin: minutes,
    });
  }

  function announce(task: Task) {
    dismissHint("mic");
    setTourTaskId(task.id);
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

  /** Скриншот записи из другого приложения → дела в шторке проверки. */
  async function sendImage(file: File) {
    setSending(true);
    notify("Смотрим скриншот…");
    try {
      const draft = await api.parseImage(await prepareFile(file));
      setToast(null);
      if (draft.batch.length >= 2) {
        setBatch({ items: draft.batch, text: "Со скриншота", source: "text", assigneeId: draft.assignee_id });
      } else {
        setConfirm({ draft, text: draft.title, source: "text", heading: "Со скриншота" });
      }
    } catch (err) {
      notify((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function send(text: string, source: "text" | "voice") {
    // Режим из профиля: never — сразу, always — всегда шторка, auto (по умолчанию) — если неясно
    const mode = family?.members.find((m) => m.id === me.id)?.confirm_mode ?? "auto";
    // Длинное или многострочное сообщение — возможно, несколько дел: разбираем даже в режиме «сразу»
    const maybeMany = text.includes("\n") || text.length > 150;
    setSending(true);
    try {
      if (mode !== "never" || maybeMany) {
        const draft = await api.parseTask(text, source);
        if (draft.batch.length >= 2) {
          setBatch({ items: draft.batch, text, source, assigneeId: draft.assignee_id });
          return;
        }
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
            participants: draft.participant_ids,
            recurrence: draft.recurrence,
            repeat_days: draft.repeat_days,
            repeat_until: draft.repeat_until,
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
      setTourTaskId(task.id);
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
          <MoreScreen family={family} me={me} onLogout={onLogout} onProfileChange={() => void refresh()} />
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

      {batch && (
        <BatchSheet
          items={batch.items}
          text={batch.text}
          source={batch.source}
          members={family?.members ?? [me]}
          meId={me.id}
          assigneeId={batch.assigneeId}
          onCancel={() => setBatch(null)}
          onSent={(created) => {
            setBatch(null);
            setTourTaskId(created[0]?.id ?? null);
            setTasks((list) => [...created, ...list]);
            loadFrequent();
            notify(`Создано дел: ${created.length}`);
            void refresh();
          }}
        />
      )}

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

      {tourOn && (
        <Tour
          me={me}
          members={family?.members ?? [me]}
          tasks={tasks}
          createdId={tourTaskId}
          isPending={(id) => pendingIds.includes(id)}
          paused={!!confirm || !!batch || !!chatTask || sending || tab !== "today"}
          onClose={() => setTourClosed(true)}
        />
      )}

      {chatTask && (
        <ChatSheet
          task={chatTask}
          members={family?.members ?? [me]}
          meId={me.id}
          onClose={() => {
            setChatId(null);
            void refresh();
          }}
          onSent={() => void refresh()}
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

      {undo && (
        <div className="fixed inset-x-0 z-30 flex justify-center px-4" style={{ bottom: dockHeight + 8 }}>
          <div className="appear flex w-full max-w-sm items-center gap-3 rounded-2xl bg-ink py-2 pr-2 pl-4 text-sm text-bg shadow-lg">
            <span className="min-w-0 flex-1 truncate">Готово: {undo.title}</span>
            <button
              onClick={() => undoDone(undo.id)}
              className="h-9 shrink-0 rounded-xl bg-white/15 px-3 font-semibold active:opacity-70"
            >
              Вернуть
            </button>
          </div>
        </div>
      )}

      {toast && !undo && (
        <div className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4" style={{ bottom: dockHeight + 8 }}>
          <p className="appear max-w-sm rounded-2xl bg-ink px-4 py-2.5 text-center text-sm text-bg shadow-lg">{toast}</p>
        </div>
      )}

      <div ref={dock} className="pb-safe pointer-events-none fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md px-3 pb-3">
        {tab === "today" && (
          <div className="pointer-events-auto">
            <Hint id="mic" className="mb-2">
              Нажмите на микрофон внизу и скажите, что нужно сделать. Или напишите в поле — например, «Олег, купи хлеб».
            </Hint>
            <Composer
              onSend={send}
              busy={sending}
              speech={speech}
              note={alone ? "Запишется на вас — в семье пока никого нет" : null}
              spouse={family?.members.find((m) => m.id !== me.id && m.role === "adult")?.name ?? null}
              frequent={frequent}
              onFrequent={(item) => copyTask(item.task, item.title)}
              onImage={(file) => void sendImage(file)}
              highlight={tourOn && !tourTaskId}
            />
          </div>
        )}
        <nav className="glass pointer-events-auto mt-2 grid h-16 grid-cols-5 items-center rounded-[26px] px-1 shadow-lg">
          <TabButton active={tab === "today"} onClick={() => setTab("today")} label="Дела" locked={tourOn}>
            <path d="M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" />
          </TabButton>
          <TabButton active={tab === "calendar"} onClick={() => setTab("calendar")} label="Календарь" locked={tourOn}>
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
          <TabButton active={tab === "family"} onClick={() => setTab("family")} label="Семья" dot={alone} locked={tourOn}>
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
          </TabButton>
          <TabButton active={tab === "more"} onClick={() => setTab("more")} label="Ещё" locked={tourOn}>
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
  locked = false,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  /** Точка-напоминание: на вкладке есть важное несделанное действие */
  dot?: boolean;
  /** Идёт обучение при первом входе — вкладки недоступны, только поле ввода и микрофон */
  locked?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={locked}
      className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold disabled:opacity-35 ${
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
