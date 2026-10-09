import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, type PhoneCheck } from "../api";
import { Button, ErrorNote } from "../components/ui";
import { PinField } from "../components/PinField";
import { holdNumericKeyboard, releaseKeyboard } from "../keyboard";

const POLL_MS = 2500;

/** Маска ввода: «+7 999 123-45-67». Понимает набор с 8 и вставку номера целиком. */
function formatPhone(raw: string): string {
  // «+7» в поле — приставка, а не первая цифра номера
  let digits = (raw.startsWith("+7") ? raw.slice(2) : raw).replace(/\D/g, "");
  if (!raw.startsWith("+7") && digits.length === 11 && /^[78]/.test(digits)) digits = digits.slice(1);
  // набрали «8 999…» после «+7» — лишняя ведущая 8 или 7 отбрасывается на 11-й цифре
  if (digits.length > 10 && /^[78]/.test(digits)) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 8), digits.slice(8, 10)];
  let out = "+7";
  if (parts[0]) out += ` ${parts[0]}`;
  if (parts[1]) out += ` ${parts[1]}`;
  if (parts[2]) out += `-${parts[2]}`;
  if (parts[3]) out += `-${parts[3]}`;
  return out;
}

const digitsCount = (value: string) => value.replace(/\D/g, "").length;

export function PhoneLogin({
  onToken,
  invitedBy,
  recommendedBy,
  onBack,
}: {
  onToken: (token: string) => void;
  invitedBy?: string | null;
  recommendedBy?: string | null;
  /** Назад к знакомству с проектом — если человек пришёл со страницы о нём */
  onBack?: () => void;
}) {
  const [phone, setPhone] = useState("+7");
  const [consent, setConsent] = useState(false);
  // Галочку показываем, только если сервер сказал, что этот номер ещё не давал согласия:
  // вернувшимся пользователям отмечать её заново не нужно
  const [askConsent, setAskConsent] = useState(false);
  const [check, setCheck] = useState<PhoneCheck | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [pinMode, setPinMode] = useState<string | null>(null); // маска номера, если вход по PIN
  const [pin, setPin] = useState("");

  // Ожидание звонка: опрашиваем сервер и считаем оставшееся время
  useEffect(() => {
    if (!check || check.method !== "call" || !check.check_id || !check.expires_in_s) return;
    const checkId = check.check_id;
    const deadline = Date.now() + check.expires_in_s * 1000;
    setSecondsLeft(check.expires_in_s);
    setExpired(false);

    const tick = window.setInterval(() => {
      setSecondsLeft(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
    }, 1000);

    const poll = async () => {
      try {
        const status = await api.phoneCheckStatus(checkId);
        if (status.status === "confirmed" && status.token) return onToken(status.token);
        if (status.status === "expired" || status.status === "used") return setExpired(true);
      } catch {
        /* сеть моргнула — спросим ещё раз */
      }
      timer.current = window.setTimeout(poll, POLL_MS);
    };
    timer.current = window.setTimeout(poll, POLL_MS);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(timer.current);
    };
  }, [check, onToken]);

  async function start(e?: FormEvent, call = false) {
    e?.preventDefault();
    // Синхронно, пока длится нажатие: на iPhone так откроется цифровая клавиатура для PIN
    if (!call) holdNumericKeyboard();
    setBusy(true);
    setError(null);
    try {
      const started = await api.startPhoneCheck(phone, call, consent);
      if (started.method === "pin") {
        setPin("");
        setPinMode(started.phone_masked);
      } else {
        releaseKeyboard();
        setPinMode(null);
        setCheck(started);
      }
    } catch (err) {
      releaseKeyboard();
      if (err instanceof ApiError && err.status === 428) {
        setAskConsent(true);
        setError(consent ? (err as Error).message : null);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function loginWithPin(value: string) {
    setBusy(true);
    setError(null);
    try {
      const { token } = await api.pinLogin(phone, value);
      onToken(token);
    } catch (err) {
      setError((err as Error).message);
      setPin("");
      setBusy(false);
    }
  }

  if (pinMode) {
    return (
      <main className="pt-safe mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-8">
        <div className="pt-12 pb-6">
          <h1 className="text-3xl leading-tight font-bold tracking-tight">Введите PIN-код</h1>
          <p className="mt-3 text-base text-ink-2">
            Для номера <span className="font-medium text-ink">{pinMode}</span>
          </p>
        </div>
        <PinField
          value={pin}
          onChange={(value) => {
            setPin(value);
            if (value.length === 4) void loginWithPin(value);
          }}
          autoComplete="current-password"
          disabled={busy}
        />
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
        <div className="mt-auto flex flex-col gap-2 pt-6">
          <Button variant="soft" className="w-full" onClick={() => start(undefined, true)} disabled={busy}>
            Забыли PIN-код? Войти звонком
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => setPinMode(null)}>
            Изменить номер
          </Button>
        </div>
      </main>
    );
  }

  if (check && check.method === "call") {
    const minutes = Math.floor(secondsLeft / 60);
    const seconds = String(secondsLeft % 60).padStart(2, "0");
    return (
      <main className="pt-safe mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-8">
        <div className="pt-12 pb-6">
          <h1 className="text-3xl leading-tight font-bold tracking-tight">Позвоните, чтобы войти</h1>
          <p className="mt-3 text-base text-ink-2">
            С номера <span className="font-medium text-ink">{check.phone_masked}</span>. Звонок бесплатный
            и сразу сбросится — так мы убедимся, что номер ваш.
          </p>
        </div>

        {expired ? (
          <div className="flex flex-col gap-3">
            <p className="text-ink-2">Время вышло. Попробуйте ещё раз — это займёт минуту.</p>
            <Button className="w-full" onClick={() => start(undefined, true)} disabled={busy}>
              {busy ? "Готовим…" : "Попробовать снова"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <a
              href={`tel:+${check.call_phone}`}
              className="flex h-16 items-center justify-center gap-3 rounded-2xl bg-accent text-lg font-semibold text-accent-ink active:opacity-80"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              {check.call_phone_pretty}
            </a>
            <p className="flex items-center justify-center gap-2 text-sm text-ink-3">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
              Ждём звонок · {minutes}:{seconds}
            </p>
          </div>
        )}

        <div className="mt-auto pt-6">
          <Button variant="ghost" className="w-full" onClick={() => setCheck(null)}>
            Изменить номер
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="pt-safe mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-8">
      {onBack && (
        <button onClick={onBack} className="-ml-1 mt-3 h-10 self-start px-1 text-sm font-medium text-ink-2 active:opacity-60">
          ← О проекте
        </button>
      )}
      <div className={`${onBack ? "pt-4" : "pt-12"} pb-6`}>
        <img src="/icon.svg" alt="" className="mb-6 h-14 w-14" />
        {invitedBy && <p className="text-sm font-medium text-accent">Вас приглашает {invitedBy}</p>}
        {!invitedBy && recommendedBy && (
          <p className="text-sm font-medium text-accent">Вам рекомендует {recommendedBy}</p>
        )}
        <h1 className="mt-1 text-3xl leading-tight font-bold tracking-tight">Вход по номеру телефона</h1>
        <p className="mt-3 text-base text-ink-2">
          Без паролей и СМС: подтвердим номер бесплатным звонком — он сразу сбросится. Номер никому не передаём.
        </p>
      </div>

      <form onSubmit={start} className="flex flex-1 flex-col gap-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">Номер телефона</span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-lg tracking-wide text-ink outline-none focus:border-accent"
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
          />
        </label>
        {askConsent && (
          <label className="appear flex items-start gap-3 rounded-2xl bg-accent-soft p-3 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--color-accent)]"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              Соглашаюсь на обработку персональных данных по{" "}
              <a href="/privacy.html" target="_blank" className="text-accent underline">
                политике конфиденциальности
              </a>
              <span className="mt-1 block text-xs text-ink-2">Один раз для этого номера — дальше спрашивать не будем.</span>
            </span>
          </label>
        )}
        <ErrorNote>{error}</ErrorNote>
        <div className="mt-auto pt-4">
          <Button type="submit" className="w-full" disabled={busy || digitsCount(phone) !== 11 || (askConsent && !consent)}>
            {busy ? "Готовим…" : "Войти"}
          </Button>
        </div>
      </form>
    </main>
  );
}
