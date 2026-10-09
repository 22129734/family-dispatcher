/**
 * Код ссылки-рекомендации (/?from=<код>). Между открытием ссылки и созданием семьи —
 * вход по телефону и PIN, поэтому код храним, пока семья не создана.
 */
const KEY = "fd.ref";

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

const fromUrl = new URLSearchParams(window.location.search).get("from");
if (fromUrl && /^[\w-]{4,32}$/.test(fromUrl)) {
  try {
    localStorage.setItem(KEY, fromUrl);
  } catch {
    /* приватный режим — код проживёт только в этой вкладке */
  }
}

let current = fromUrl ?? read();

export const referralCode = () => current;

export function clearReferral() {
  current = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* нечего чистить */
  }
}
