import type { PhoneCheck } from "./api";

/**
 * Начатый вход по звонку. Пока человек звонит, телефон часто выгружает вкладку браузера,
 * и после возврата страница грузится заново. Без этой памяти приложение забывало, что ждёт
 * звонок, и снова показывало приглашение и вход — замкнутый круг.
 */
const KEY = "fd.call";

interface Pending {
  check: PhoneCheck;
  phone: string;
  /** Когда проверка истекает, мс с 1970 */
  deadline: number;
}

export function savePendingCall(check: PhoneCheck, phone: string): Pending {
  const pending = { check, phone, deadline: Date.now() + (check.expires_in_s ?? 300) * 1000 };
  try {
    localStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    /* приватный режим — переживём без памяти */
  }
  return pending;
}

export function pendingCall(): Pending | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw) as Pending;
    if (!pending.check?.check_id || pending.deadline <= Date.now()) {
      localStorage.removeItem(KEY);
      return null;
    }
    return pending;
  } catch {
    return null;
  }
}

export function clearPendingCall() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* нечего чистить */
  }
}
