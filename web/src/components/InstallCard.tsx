import { useEffect, useState } from "react";
import { api } from "../api";
import { installPrompt, onInstallPromptChange, promptInstall } from "../installPrompt";
import { platform } from "../push";

const HIDE_KEY = "fd.install-card-hidden";

function hiddenByUser(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Значок на экран телефона: приложение открывается без адресной строки и вкладок браузера.
 * На iPhone эту роль играет подсказка в NotifyBanner — там без установки нет и уведомлений.
 */
export function InstallCard({ always = false }: { always?: boolean }) {
  const p = platform();
  const [canPrompt, setCanPrompt] = useState(() => installPrompt() !== null);
  const [hidden, setHidden] = useState(() => !always && hiddenByUser());

  useEffect(() => onInstallPromptChange(() => setCanPrompt(installPrompt() !== null)), []);
  useEffect(() => {
    if (!p.standalone && !p.ios && !hidden) api.track("install_prompt_shown", { native: String(canPrompt) });
  }, []);

  if (p.standalone || p.ios || hidden) return null;

  async function install() {
    if (await promptInstall()) api.track("install_accepted");
  }

  function hide() {
    try {
      localStorage.setItem(HIDE_KEY, "1");
    } catch {
      /* без сохранения — просто скрываем */
    }
    setHidden(true);
  }

  return (
    <section className="appear mb-4 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <img src="/icon-192.png" alt="" className="h-11 w-11 shrink-0 rounded-xl" />
        <div className="min-w-0">
          <p className="font-semibold">Значок на экран телефона</p>
          <p className="mt-0.5 text-sm text-ink-2">
            Диспетчер будет открываться как обычное приложение — без адресной строки и вкладок браузера.
          </p>
        </div>
      </div>
      {canPrompt ? (
        <button
          onClick={() => void install()}
          className="mt-3 h-11 w-full rounded-xl bg-accent font-semibold text-accent-ink active:opacity-80"
        >
          Установить
        </button>
      ) : (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink-2">
          <li>
            Нажмите <b className="font-medium text-ink">⋮</b> справа вверху браузера
          </li>
          <li>
            Выберите <b className="font-medium text-ink">«Добавить на главный экран»</b> или{" "}
            <b className="font-medium text-ink">«Установить приложение»</b>
          </li>
          <li>
            Нажмите <b className="font-medium text-ink">«Установить»</b> — значок «Диспетчер» появится на экране
          </li>
        </ol>
      )}
      {!always && (
        <button onClick={hide} className="mt-2 text-xs text-ink-3">
          Не сейчас
        </button>
      )}
    </section>
  );
}
