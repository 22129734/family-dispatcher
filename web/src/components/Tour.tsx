import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type Member, type Task } from "../api";
import { dismissAllHints, suppressHints } from "./Hint";

/**
 * Обучение при первом входе: экран затемнён, подсвечено только то, что нужно нажать.
 * Человек проходит путь «поручила — сделано» на настоящем деле: пишет дело, отмечает
 * «Готово» (или отвечает «Беру», если его уже о чём-то попросили). В конце — выбор,
 * показывать ли подсказки дальше. Показываем, пока путь не пройден.
 */

const DONE_KEY = "fd.tour.";
const LATER_KEY = "fd.tour.later.";
// «Позже» — напомним через сутки
const LATER_MS = 24 * 3600 * 1000;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* приватный режим — обучение покажем снова при следующем входе */
  }
}

/** Обучение уже пройдено на этом устройстве или отложено «на потом». */
export function tourDismissed(memberId: string): boolean {
  if (read(DONE_KEY + memberId)) return true;
  const later = Number(read(LATER_KEY + memberId) ?? 0);
  return Date.now() - later < LATER_MS;
}

type Step =
  | { kind: "write" }
  | { kind: "accept"; task: Task }
  | { kind: "done"; task: Task }
  | { kind: "finish"; sentTo: string | null };

export function Tour({
  me,
  members,
  tasks,
  createdId,
  isPending,
  paused,
  onClose,
}: {
  me: Member;
  members: Member[];
  tasks: Task[];
  /** Дело, которое человек создал во время обучения */
  createdId: string | null;
  isPending: (id: string) => boolean;
  /** Открыта шторка или идёт отправка — затемнение убираем, ждём */
  paused: boolean;
  onClose: () => void;
}) {
  // Дело, на котором идёт шаг: ждём, когда его возьмут или отметят «Готово»
  const watch = useRef<{ kind: "accept" | "done"; id: string } | null>(null);
  const [finish, setFinish] = useState<{ sentTo: string | null } | null>(null);
  const spouse = members.find((m) => m.id !== me.id && m.role === "adult")?.name ?? null;

  const step: Step = finish ? { kind: "finish", sentTo: finish.sentTo } : current();

  function current(): Step {
    const watched = watch.current && tasks.find((t) => t.id === watch.current!.id);
    if (watched && watch.current!.kind === "accept") return { kind: "accept", task: watched };
    const ask = tasks.find((t) => t.assignee_id === me.id && t.status === "new" && t.created_by_id !== me.id);
    if (ask) return { kind: "accept", task: ask };
    const created = createdId ? tasks.find((t) => t.id === createdId) : undefined;
    if (created && (created.assignee_id === me.id || !created.assignee_id)) return { kind: "done", task: created };
    // Дело уже записано раньше (например, до перезагрузки) — сразу к «Готово»
    const own = tasks.find(
      (t) => t.status !== "done" && (t.assignee_id === me.id || (!t.assignee_id && t.created_by_id === me.id)),
    );
    if (own) return { kind: "done", task: own };
    return { kind: "write" };
  }

  // Шаг выполнен — переходим к финалу
  useEffect(() => {
    if (finish) return;
    const created = createdId ? tasks.find((t) => t.id === createdId) : undefined;
    if (created && created.assignee_id && created.assignee_id !== me.id) {
      setFinish({ sentTo: members.find((m) => m.id === created.assignee_id)?.name ?? "близкому" });
      return;
    }
    const w = watch.current;
    if (!w) return;
    const task = tasks.find((t) => t.id === w.id);
    if (!task) return;
    if (w.kind === "accept" && task.status !== "new") setFinish({ sentTo: null });
    if (w.kind === "done" && (task.status === "done" || isPending(task.id))) setFinish({ sentTo: null });
  });

  // Запоминаем, за каким делом следим, и подсвечиваем его
  const targetId = step.kind === "accept" || step.kind === "done" ? step.task.id : null;
  useEffect(() => {
    if (step.kind === "accept" || step.kind === "done") watch.current = { kind: step.kind, id: step.task.id };
  });

  useEffect(() => {
    api.track("tour_step", { step: step.kind });
  }, [step.kind]);

  useEffect(() => {
    suppressHints(true);
    return () => suppressHints(false);
  }, []);

  useEffect(() => {
    if (!targetId || paused) return;
    let el: Element | null = null;
    // Карточка могла ещё не появиться — ищем несколько раз
    const timer = window.setInterval(() => {
      const found = document.querySelector(`[data-tour="task-${targetId}"]`);
      if (!found || found === el) return;
      el?.removeAttribute("data-tour-on");
      el = found;
      el.setAttribute("data-tour-on", "");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 200);
    return () => {
      window.clearInterval(timer);
      el?.removeAttribute("data-tour-on");
    };
  }, [targetId, paused]);

  function later() {
    write(LATER_KEY + me.id, String(Date.now()));
    api.track("tour_later");
    onClose();
  }

  function choose(hints: boolean) {
    write(DONE_KEY + me.id, "1");
    api.track("hints_choice", { hints: hints ? "yes" : "no" });
    if (!hints) dismissAllHints();
    void api.updateMe({ hints_off: !hints }).catch(() => undefined);
    onClose();
  }

  if (paused && step.kind !== "finish") return null;

  if (step.kind === "finish") {
    return createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-5">
        <div className="pop w-full max-w-sm rounded-[28px] p-6 text-center shadow-2xl" style={{ background: "var(--surface-solid)" }}>
          <p className="text-5xl" aria-hidden>
            🎉
          </p>
          <p className="font-display mt-3 text-2xl font-bold">Получилось!</p>
          <p className="mt-2 text-[15px] text-ink-2">
            {step.sentTo
              ? `Просьба ушла: ${step.sentTo}. Когда ответят «Беру» и «Сделано» — вы увидите это здесь и получите уведомление.`
              : "Так работает Семейный диспетчер: попросили — сделано. Близкие видят, что дело взяли и что оно готово."}
          </p>
          <p className="mt-5 text-sm font-semibold text-ink-3">Показывать подсказки дальше?</p>
          <button
            onClick={() => choose(true)}
            className="bg-fab mt-2 h-12 w-full rounded-2xl font-semibold shadow-sm active:opacity-80"
          >
            Да, подсказывайте
          </button>
          <button onClick={() => choose(false)} className="mt-2 h-12 w-full rounded-2xl bg-surface-2 font-semibold active:opacity-70">
            Нет, разберусь сам(а)
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  const writing = step.kind === "write";
  const example = spouse ? "«я куплю хлеб вечером»" : "«купить хлеб вечером»";
  const coach =
    step.kind === "write"
      ? {
          n: 1,
          title: "Напишите первое дело",
          text: `Любое настоящее — например, ${example}. Напишите в поле внизу или нажмите на микрофон и скажите.${
            spouse ? ` Чтобы попросить ${spouse}, начните с имени.` : ""
          }`,
        }
      : step.kind === "accept"
        ? {
            n: 2,
            title: "Вас просят — ответьте",
            text: "Нажмите «Беру» — автор сразу увидит, что дело взяли. Непонятно, что именно нужно? Нажмите «Уточнить».",
          }
        : {
            n: 2,
            title: "Отметьте «Готово»",
            text: "Сделали — нажмите «Готово» справа внизу карточки. Так близкие видят, что дело сделано.",
          };

  return createPortal(
    <>
      {/* На шаге «напишите» поле ввода и микрофон — над затемнением, остальное недоступно */}
      <div className={`fixed inset-0 bg-black/55 ${writing ? "z-[15]" : "z-[25]"}`} aria-hidden />
      <div
        className={`pointer-events-none fixed inset-x-0 z-30 mx-auto flex max-w-md px-4 ${
          writing ? "top-[max(24px,env(safe-area-inset-top))]" : "bottom-[max(24px,env(safe-area-inset-bottom))]"
        }`}
      >
        <div role="dialog" aria-label={coach.title} className="pop pointer-events-auto w-full rounded-3xl p-4 shadow-2xl" style={{ background: "var(--surface-solid)" }}>
          <p className="text-xs font-bold tracking-wide text-accent uppercase">
            {step.kind === "accept" ? "Первое дело" : `Первое дело · шаг ${coach.n} из 2`}
          </p>
          <p className="font-display mt-1 text-lg font-bold">{coach.title}</p>
          <p className="mt-1 text-[15px] leading-snug text-ink-2">{coach.text}</p>
          {writing && (
            <button onClick={later} className="mt-2 h-8 text-sm font-medium text-ink-3 active:opacity-60">
              Позже
            </button>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
