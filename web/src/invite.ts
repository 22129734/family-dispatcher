/**
 * Код приглашения в семью (/join/<код>). Запоминаем его на телефоне: между открытием ссылки
 * и входом человек звонит, ставит PIN, переходит из Max или Telegram в обычный браузер или
 * на значок на экране — адрес со ссылкой теряется, а приглашение должно сработать.
 */
const KEY = "fd.invite";

const fromPath = window.location.pathname.match(/^\/join\/([\w-]+)/)?.[1] ?? null;
if (fromPath) {
  try {
    localStorage.setItem(KEY, fromPath);
  } catch {
    /* приватный режим — код проживёт только в этой вкладке */
  }
}

function stored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

let current = fromPath ?? stored();

export const inviteCode = () => current;

export function clearInvite() {
  current = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* нечего чистить */
  }
}
