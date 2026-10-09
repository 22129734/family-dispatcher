import { useEffect, useState } from "react";
import { api, type ActInfo } from "../api";
import { Button } from "../components/ui";
import { formatDue } from "../format";
import { FileStrip } from "../components/TaskFiles";

/** Страница задачи из уведомления: ответить без входа в приложение. */
export function ActPage({ token }: { token: string }) {
  const [info, setInfo] = useState<ActInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(() => new URLSearchParams(window.location.search).has("decline"));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.actInfo(token).then(setInfo, (err) => setError((err as Error).message));
  }, [token]);

  async function act(action: "accept" | "decline" | "done" | "remember") {
    setBusy(true);
    try {
      setInfo(await api.act(token, action, action === "decline" ? reason.trim() || null : null));
      setDeclining(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const task = info?.task;
  const mine = task && info.assignee_name === info.member_name;

  return (
    <main className="pt-safe mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-8">
      <div className="pt-12">
        <img src="/icon.svg" alt="" className="mb-6 h-12 w-12" />
        {error && <p className="text-lg">{error}</p>}
        {task && (
          <>
            <p className="text-sm font-medium text-accent">
              {task.created_by_id && info.author_name !== info.member_name
                ? `${info.author_name} просит вас`
                : "Ваше дело"}
            </p>
            <h1 className="mt-1 text-3xl leading-tight font-bold tracking-tight">{task.title}</h1>
            <p className="mt-2 text-ink-2">{formatDue(task.due_at)}</p>
            {task.note && (
              <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-base">📝 {task.note}</p>
            )}
            {task.items.length > 0 && (
              <ul className="mt-3 space-y-1">
                {task.items.map((item, i) => (
                  <li key={`${item.text}-${i}`} className={`text-base ${item.done ? "text-ink-3 line-through" : ""}`}>
                    {item.done ? "☑" : "☐"} {item.text}
                  </li>
                ))}
              </ul>
            )}
            {task.files.length > 0 && (
              <div className="mt-3">
                <FileStrip files={task.files} />
              </div>
            )}
            {task.feedback && task.status !== "done" && (
              <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-sm">
                <span className="font-semibold text-warn">{info.author_name}: не выполнено — </span>
                {task.feedback}
              </p>
            )}
            <p className="mt-4 text-base font-medium">
              {task.status === "done"
                ? "✓ Сделано"
                : task.status === "accepted"
                  ? `✓ ${mine ? "Вы берёте" : `${info.assignee_name} берёт`}${task.remembered_at ? (mine ? " · помните" : " · помнит") : ""}`
                  : task.assignee_id
                    ? (mine ? "Ждёт вашего ответа" : "Ждёт ответа")
                    : (task.decline_reason ?? "Без исполнителя")}
            </p>
          </>
        )}
      </div>

      {info && (
        <div className="mt-auto flex flex-col gap-2 pt-8">
          {declining ? (
            <>
              <input
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={200}
                placeholder="Почему? Например: до 21 на работе"
                className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-base outline-none focus:border-accent"
              />
              <Button onClick={() => act("decline")} disabled={busy}>
                Отправить отказ
              </Button>
              <Button variant="ghost" onClick={() => setDeclining(false)}>
                Отмена
              </Button>
            </>
          ) : (
            <>
              {info.can_accept && (
                <Button onClick={() => act("accept")} disabled={busy}>
                  Беру
                </Button>
              )}
              {info.can_remember && (
                <Button variant="soft" onClick={() => act("remember")} disabled={busy}>
                  Я помню
                </Button>
              )}
              {info.can_done && !info.can_accept && (
                <Button onClick={() => act("done")} disabled={busy}>
                  Сделано
                </Button>
              )}
              {info.can_decline && (
                <Button variant="soft" onClick={() => setDeclining(true)} disabled={busy}>
                  Не могу
                </Button>
              )}
            </>
          )}
          <Button variant="ghost" onClick={() => (window.location.href = "/")}>
            Открыть все дела
          </Button>
        </div>
      )}
    </main>
  );
}
