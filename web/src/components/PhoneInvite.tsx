import qrcode from "qrcode-generator";
import { useMemo, useState, type FormEvent } from "react";
import { api } from "../api";
import { formatPhone } from "../screens/PhoneLogin";

/**
 * Пригласить по номеру: близкий войдёт со своим номером — и сразу окажется в семье,
 * даже если ссылка потерялась. По желанию — СМС со ссылкой на этот номер.
 */
export function PhoneInvite({ onInvited }: { onInvited: () => void }) {
  const [phone, setPhone] = useState("+7");
  const [sendSms, setSendSms] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const ready = phone.replace(/\D/g, "").length === 11;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const invite = await api.phoneInvite(phone, sendSms);
      setDone(
        invite.sms_sent
          ? `СМС со ссылкой отправлено на ${invite.phone_masked}. Когда человек войдёт с этим номером, сразу окажется в вашей семье.`
          : `Готово: когда человек с номером ${invite.phone_masked} войдёт в приложение, сразу окажется в вашей семье.`,
      );
      setPhone("+7");
      onInvited();
    } catch (err) {
      setError((err as Error).message);
      onInvited(); // приглашение по номеру могло сохраниться, даже если СМС не ушло
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">По номеру телефона</h2>
      <p className="mt-1 text-sm text-ink-2">Самый надёжный способ: близкий войдёт со своим номером — и он уже в семье.</p>
      <form onSubmit={submit} className="mt-3 space-y-2">
        <input
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={phone}
          onChange={(e) => setPhone(formatPhone(e.target.value))}
          aria-label="Номер телефона близкого"
          className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-lg tracking-wide outline-none focus:border-accent"
        />
        <label className="flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={sendSms}
            onChange={(e) => setSendSms(e.target.checked)}
            className="h-5 w-5 accent-[var(--color-accent)]"
          />
          Отправить СМС со ссылкой на приложение
        </label>
        <button
          type="submit"
          disabled={busy || !ready}
          className="h-12 w-full rounded-2xl bg-accent font-semibold text-accent-ink active:opacity-80 disabled:opacity-40"
        >
          {busy ? "Приглашаем…" : "Пригласить"}
        </button>
      </form>
      {done && <p className="mt-2 rounded-xl bg-ok-soft px-3 py-2 text-sm text-ok">{done}</p>}
      {error && <p className="mt-2 text-sm text-warn">{error}</p>}
    </section>
  );
}

/** QR-код приглашения: близкий рядом — наводит камеру и открывает ссылку. */
export function InviteQr({ url }: { url: string }) {
  const src = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    return qr.createDataURL(6, 2);
  }, [url]);
  return (
    <section className="flex items-center gap-4">
      <img src={src} alt="QR-код приглашения" className="h-32 w-32 shrink-0 rounded-xl bg-white p-1" />
      <div>
        <h2 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">QR-код</h2>
        <p className="mt-1 text-sm text-ink-2">Близкий рядом? Пусть наведёт камеру телефона на код и откроет ссылку.</p>
      </div>
    </section>
  );
}

/** Посоветовать знакомому по СМС — не больше трёх в сутки с аккаунта. */
export function RecommendSms() {
  const [phone, setPhone] = useState("+7");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const ready = phone.replace(/\D/g, "").length === 11;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const sent = await api.recommendBySms(phone);
      setDone(
        `СМС отправлено на ${sent.phone_masked}.` +
          (sent.left_today > 0 ? ` Сегодня можно ещё ${sent.left_today}.` : " На сегодня СМС закончились."),
      );
      setPhone("+7");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="text-xs font-semibold tracking-wide text-ink-3 uppercase">СМС знакомому</h2>
      <p className="mt-1 text-sm text-ink-2">Отправим СМС со ссылкой от вашего имени — до 3 в день.</p>
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          type="tel"
          inputMode="tel"
          autoComplete="off"
          value={phone}
          onChange={(e) => setPhone(formatPhone(e.target.value))}
          aria-label="Номер телефона знакомого"
          className="h-12 min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 text-lg tracking-wide outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy || !ready}
          className="h-12 shrink-0 rounded-2xl bg-accent px-4 font-semibold text-accent-ink active:opacity-80 disabled:opacity-40"
        >
          {busy ? "…" : "Отправить"}
        </button>
      </form>
      {done && <p className="mt-2 rounded-xl bg-ok-soft px-3 py-2 text-sm text-ok">{done}</p>}
      {error && <p className="mt-2 text-sm text-warn">{error}</p>}
    </section>
  );
}
