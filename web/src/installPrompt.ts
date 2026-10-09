/**
 * Предложение браузера «Установить приложение» (Android, Chrome и Яндекс).
 *
 * Событие beforeinstallprompt приходит один раз и рано — сразу после загрузки страницы,
 * когда экран входа ещё на месте. Поэтому ловим его здесь, при старте, и храним,
 * а экраны подписываются, когда появятся.
 */
export type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault(); // своя кнопка вместо мини-панели браузера
  deferred = event as InstallPrompt;
  notify();
});

window.addEventListener("appinstalled", () => {
  deferred = null;
  notify();
});

export const installPrompt = () => deferred;

export function onInstallPromptChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Показать системное окно установки. true — человек согласился. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  await event.prompt();
  const { outcome } = await event.userChoice;
  deferred = null;
  notify();
  return outcome === "accepted";
}
