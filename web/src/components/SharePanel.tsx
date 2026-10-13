import qrcode from "qrcode-generator";
import { useMemo, useState, type ReactNode } from "react";
import { api } from "../api";

/**
 * Пригласить или посоветовать: крупный QR-код (знакомый рядом — наводит камеру),
 * три способа плитками и текст, который получит человек. Ссылка — внутри текста и QR:
 * Max и часть мессенджеров на iPhone берут из «Поделиться» только текст.
 */
export function SharePanel({
  kind,
  title,
  subtitle,
  url,
  text,
  qrCaption,
  phoneLabel,
  phone,
}: {
  kind: "family" | "referral";
  title: string;
  subtitle: string;
  url: string;
  text: string;
  qrCaption: string;
  /** Подпись третьей плитки: «По номеру» или «СМС» */
  phoneLabel: string;
  /** Что раскрывается по третьей плитке — форма номера */
  phone: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const canShare = typeof navigator.share === "function";
  const qr = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(url);
    code.make();
    return code.createDataURL(8, 2);
  }, [url]);

  const track = (channel: string) => api.track("invite_shared", { channel, kind });

  async function copy() {
    track("copy");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("Скопируйте сообщение", text);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function share() {
    if (!canShare) return copy();
    track("system");
    try {
      await navigator.share({ text });
    } catch {
      /* закрыли окно — ничего не делаем */
    }
  }

  // В превью сообщения ссылку не показываем целиком — она длинная и техническая
  const preview = text.replace(url, "").trim();

  return (
    <div>
      <h2 className="font-display text-xl leading-tight font-bold">{title}</h2>
      <p className="mt-1 text-sm text-ink-2">{subtitle}</p>

      <div className="mt-4 flex flex-col items-center">
        <img src={qr} alt="QR-код со ссылкой" className="h-44 w-44 rounded-2xl bg-white p-2 shadow-md" />
        <p className="mt-2 text-center text-sm text-ink-2">{qrCaption}</p>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Tile icon="✈️" label="В мессенджер" onClick={() => void share()} primary />
        <Tile icon={copied ? "✓" : "⧉"} label={copied ? "Скопировано" : "Скопировать"} onClick={() => void copy()} />
        <Tile icon="📱" label={phoneLabel} onClick={() => setPhoneOpen(!phoneOpen)} active={phoneOpen} />
      </div>
      {copied && <p className="mt-2 text-center text-sm text-ok">Вставьте в Max или любой чат — ссылка внутри</p>}

      {phoneOpen && <div className="appear mt-4">{phone}</div>}

      <div className="mt-4 rounded-2xl bg-accent-soft px-3.5 py-3">
        <p className="text-xs font-semibold text-ink-3">Что получит человек</p>
        <p className="mt-1 line-clamp-4 text-sm whitespace-pre-line text-ink-2">
          {preview} <span className="font-semibold text-accent">ссылка</span>
        </p>
      </div>
    </div>
  );
}

function Tile({
  icon,
  label,
  onClick,
  primary = false,
  active = false,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  primary?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-expanded={active || undefined}
      className={`flex h-[76px] flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[13px] leading-tight font-semibold transition active:scale-95 ${
        primary
          ? "bg-fab shadow-sm"
          : active
            ? "bg-accent text-accent-ink"
            : "border border-line bg-surface-2 text-ink"
      }`}
    >
      <span className="text-xl leading-none" aria-hidden>
        {icon}
      </span>
      {label}
    </button>
  );
}
