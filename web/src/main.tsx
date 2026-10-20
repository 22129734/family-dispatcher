import "./source"; // откуда пришёл человек — до того, как приложение уберёт параметры из адреса
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./theme"; // тема из памяти телефона — до первого кадра
import "./installPrompt"; // ловим предложение установки до первого экрана
import "./referral"; // запоминаем код рекомендации из ссылки до входа

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  // Новая версия: новый service worker берёт управление — перезагружаемся один раз,
  // чтобы человек не сидел на старой сборке (так было на Honor: две вкладки вместо четырёх)
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    window.location.reload();
  });

  // Нажали на уведомление, а приложение уже открыто: service worker вывел окно вперёд
  // и просит открыть страницу дела (sw.js, openPage)
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { type?: string; url?: string } | null;
    if (data?.type !== "open" || !data.url) return;
    const target = new URL(data.url, window.location.origin);
    if (target.origin === window.location.origin && target.href !== window.location.href) {
      window.location.assign(target.href);
    }
  });
  navigator.serviceWorker.startMessages();

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => {
        // Приложение с экрана может жить днями — проверяем обновление при каждом возврате
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") void registration.update();
        });
      })
      .catch(() => undefined);
  });
}
