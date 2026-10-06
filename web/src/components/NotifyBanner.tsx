import { useEffect, useState } from "react";
import { api } from "../api";
import { enablePush, platform, pushState, type PushState } from "../push";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/**
 * Подключение уведомлений — главный риск продукта: исполнитель должен поставить
 * приложение и разрешить уведомления. Поэтому здесь же меряем воронку.
 */
export function NotifyBanner() {
  const [state, setState] = useState<PushState | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    api
      .pushStatus()
      .then(async (status) => {
        if (!status.enabled || !status.public_key) return;
        setPublicKey(status.public_key);
        const current = await pushState();
        setState(current);
        if (current !== "on") api.track("push_prompt_shown", { state: current });
      })
      .catch(() => undefined);

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallPrompt);
      api.track("install_prompt_shown");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (hidden || !state || state === "on" || !publicKey) return null;

  async function turnOn() {
    setBusy(true);
    try {
      setState(await enablePush(publicKey!));
    } catch {
      setState(await pushState());
    } finally {
      setBusy(false);
    }
  }

  async function installApp() {
    if (!install) return;
    await install.prompt();
    const choice = await install.userChoice;
    if (choice.outcome === "accepted") api.track("install_accepted");
    setInstall(null);
  }

  return (
    <div className="appear mb-4 rounded-2xl border border-accent/40 bg-accent-soft p-4">
      {state === "ios-install" && (
        <>
          <p className="font-semibold">Чтобы поручения приходили уведомлением</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-2">
            <li>
              Нажмите <span className="font-medium text-ink">«Поделиться»</span>{" "}
              <ShareIcon /> внизу Safari
            </li>
            <li>
              Выберите <span className="font-medium text-ink">«На экран „Домой“»</span>
            </li>
            <li>Откройте «Диспетчер» с экрана «Домой» и включите уведомления</li>
          </ol>
          <p className="mt-2 text-xs text-ink-3">На iPhone уведомления работают только так (iOS 16.4 и новее)</p>
        </>
      )}

      {state === "ask" && (
        <>
          <p className="font-semibold">Включите уведомления</p>
          <p className="mt-1 text-sm text-ink-2">
            Поручения будут приходить сами — с кнопками «Беру» и «Не могу». Открывать приложение не нужно.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={turnOn}
              disabled={busy}
              className="h-11 flex-1 rounded-xl bg-accent font-semibold text-accent-ink active:opacity-80 disabled:opacity-50"
            >
              {busy ? "Подключаем…" : "Включить"}
            </button>
            {install && platform().android && (
              <button onClick={installApp} className="h-11 rounded-xl bg-surface px-4 text-sm font-medium active:opacity-70">
                Установить
              </button>
            )}
          </div>
        </>
      )}

      {state === "denied" && (
        <>
          <p className="font-semibold">Уведомления запрещены</p>
          <p className="mt-1 text-sm text-ink-2">
            {platform().ios
              ? "Откройте «Настройки» → «Уведомления» → «Диспетчер» и включите их."
              : "Нажмите на значок замка рядом с адресом сайта → «Уведомления» → «Разрешить», затем обновите страницу."}
          </p>
        </>
      )}

      {state === "unsupported" && (
        <>
          <p className="font-semibold">Этот браузер не умеет уведомления</p>
          <p className="mt-1 text-sm text-ink-2">Откройте сайт в Chrome или Яндекс Браузере — там поручения будут приходить сами.</p>
        </>
      )}

      <button onClick={() => setHidden(true)} className="mt-2 text-xs text-ink-3">
        Скрыть
      </button>
    </div>
  );
}

function ShareIcon() {
  return (
    <svg className="inline-block align-text-bottom" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="значок «Поделиться»">
      <path d="M12 3v13M7 8l5-5 5 5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}
