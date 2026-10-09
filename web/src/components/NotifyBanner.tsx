import { useEffect, useState } from "react";
import { api } from "../api";
import { enablePush, platform, pushState, type PushState } from "../push";

/**
 * Подключение уведомлений — главный риск продукта: исполнитель должен поставить
 * приложение и разрешить уведомления. Поэтому здесь же меряем воронку.
 */
export function NotifyBanner() {
  const [state, setState] = useState<PushState | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
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

  // После смены настроек в браузере или телефоне — проверить без перезагрузки
  async function recheck() {
    setState(await pushState());
  }

  return (
    <div className="appear mb-4 rounded-2xl border border-accent/40 bg-accent-soft p-4">
      {state === "ios-install" && (
        <>
          <p className="font-semibold">Чтобы просьбы приходили уведомлением</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-2">
            <li>
              Нажмите <B>«•••»</B> справа в нижней строке Safari
            </li>
            <li>
              Нажмите <B>«Поделиться»</B> <ShareIcon />
            </li>
            <li>
              В открывшемся окне нажмите <B>«•••» (Ещё)</B> и выберите <B>«На экран „Домой“»</B>
            </li>
            <li>
              Нажмите <B>«Добавить»</B>
            </li>
            <li>Откройте «Диспетчер» с экрана «Домой», войдите и нажмите «Включить»</li>
          </ol>
          <p className="mt-2 text-xs text-ink-3">
            Если кнопка «Поделиться» видна сразу внизу экрана — начните со второго шага. На iPhone
            уведомления работают только из приложения на экране «Домой» (iOS 16.4 и новее).
          </p>
        </>
      )}

      {state === "ask" && (
        <>
          <p className="font-semibold">Включите уведомления</p>
          <p className="mt-1 text-sm text-ink-2">
            Просьбы будут приходить сами — с кнопками «Беру» и «Не могу». Открывать приложение не нужно.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={turnOn}
              disabled={busy}
              className="h-11 flex-1 rounded-xl bg-accent font-semibold text-accent-ink active:opacity-80 disabled:opacity-50"
            >
              {busy ? "Подключаем…" : "Включить"}
            </button>
          </div>
        </>
      )}

      {state === "denied" && (
        <>
          <p className="font-semibold">Уведомления запрещены</p>
          <DeniedSteps />
          <button
            onClick={() => void recheck()}
            className="mt-3 h-10 w-full rounded-xl bg-surface text-sm font-medium active:opacity-70"
          >
            Я включил(а) — проверить
          </button>
        </>
      )}

      {state === "unsupported" && (
        <>
          <p className="font-semibold">Этот браузер не умеет уведомления</p>
          <p className="mt-1 text-sm text-ink-2">Откройте сайт в Chrome или Яндекс Браузере — там просьбы будут приходить сами.</p>
        </>
      )}

      <button onClick={() => setHidden(true)} className="mt-2 text-xs text-ink-3">
        Скрыть
      </button>
    </div>
  );
}

/** Как вернуть разрешение: у Chrome на Android вместо замка теперь значок с ползунками. */
function DeniedSteps() {
  const p = platform();
  if (p.ios) {
    return (
      <p className="mt-1 text-sm text-ink-2">
        Откройте <B>«Настройки»</B> телефона → <B>«Уведомления»</B> → <B>«Диспетчер»</B> и включите их.
      </p>
    );
  }
  if (p.android && p.standalone) {
    return (
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-2">
        <li>
          Откройте <B>«Настройки»</B> телефона → <B>«Приложения»</B> → <B>«Диспетчер»</B>
        </li>
        <li>
          <B>«Уведомления»</B> → включите
        </li>
        <li>Закройте Диспетчер и откройте снова</li>
      </ol>
    );
  }
  if (p.android) {
    return (
      <>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink-2">
          <li>
            Нажмите значок <B>слева от адреса сайта</B> — два ползунка <TuneIcon /> или замок
          </li>
          <li>
            <B>«Разрешения»</B> → <B>«Уведомления»</B> → <B>«Разрешить»</B>
          </li>
          <li>Обновите страницу</li>
        </ol>
        <p className="mt-2 text-xs text-ink-2">
          Пункта нет или не помогло? <B>«Настройки»</B> телефона → <B>«Приложения»</B> → <B>«Chrome»</B> (или ваш
          браузер) → <B>«Уведомления»</B> → включите. На Honor и Huawei проверьте ещё{" "}
          <B>«Настройки» → «Уведомления» → «Chrome»</B>.
        </p>
      </>
    );
  }
  return (
    <p className="mt-1 text-sm text-ink-2">
      Нажмите на значок слева от адреса сайта → <B>«Уведомления»</B> → <B>«Разрешить»</B>, затем обновите страницу.
    </p>
  );
}

function TuneIcon() {
  return (
    <svg className="inline-block align-text-bottom" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-label="значок с ползунками">
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </svg>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-ink">{children}</span>;
}

function ShareIcon() {
  return (
    <svg className="inline-block align-text-bottom" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="значок «Поделиться»">
      <path d="M12 3v13M7 8l5-5 5 5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}
