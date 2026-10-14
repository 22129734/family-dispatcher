/**
 * Откуда пришёл человек — первая точка входа, запоминаем на телефоне до регистрации.
 * Сервер сохраняет её в аккаунт (заголовок X-Source, backend/app/services/traffic.py).
 *
 * utm_source=<метка> → utm:<метка>; QR-коды помечаем utm_source=qr_<место> → qr:<место>;
 * без метки — сайт, с которого был переход (site:t.me), иначе direct.
 * Приглашение в семью и рекомендацию сервер определяет сам.
 */

const KEY = "fd_source";

const clean = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 70);

function detect(): string {
  const tag = clean(new URLSearchParams(window.location.search).get("utm_source") ?? "");
  if (tag.startsWith("qr_") && tag.length > 3) return `qr:${tag.slice(3)}`;
  if (tag) return `utm:${tag}`;
  try {
    const host = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, "") : "";
    if (host && host !== window.location.hostname) return `site:${clean(host)}`;
  } catch {
    /* битый referrer */
  }
  return "direct";
}

/** Вызывается один раз при загрузке страницы — до того, как приложение уберёт параметры из адреса. */
export function captureSource(): void {
  try {
    if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, detect());
  } catch {
    /* приватный режим без localStorage — источник посчитается как direct */
  }
}

export function trafficSource(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

// Сразу при загрузке модуля — main.tsx импортирует его первым
captureSource();
