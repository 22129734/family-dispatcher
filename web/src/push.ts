import { api } from "./api";

/** Где запущено приложение — от этого зависит, как включить уведомления. */
export function platform() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Mac") && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return { ios, android: /Android/.test(ua), standalone, supported };
}

/** Браузер — у Яндекс Браузера на Android уведомления от сайтов часто не работают. */
export function browserName(): "yandex" | "samsung" | "firefox" | "chrome" | "other" {
  const ua = navigator.userAgent;
  if (/YaBrowser|YaSearchBrowser/.test(ua)) return "yandex";
  if (/SamsungBrowser/.test(ua)) return "samsung";
  if (/Firefox|FxiOS/.test(ua)) return "firefox";
  if (/Chrome|CriOS/.test(ua)) return "chrome";
  return "other";
}

export type PushState =
  | "unsupported" // браузер не умеет push (или iPhone без установки на экран «Домой»)
  | "ios-install" // iPhone: нужно добавить на экран «Домой»
  | "denied" // пользователь запретил уведомления
  | "ask" // можно предложить включить
  | "failed" // нажали «Включить», а браузер не дал — объясняем, что делать
  | "on"; // подписка есть

export async function pushState(): Promise<PushState> {
  const p = platform();
  if (p.ios && !p.standalone) return "ios-install";
  if (!p.supported) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "ask";
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? "on" : "ask";
}

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function sendToServer(subscription: PushSubscription) {
  const json = subscription.toJSON();
  await api.pushSubscribe(json.endpoint ?? subscription.endpoint, json.keys?.p256dh ?? "", json.keys?.auth ?? "");
}

/** Запросить разрешение (только по нажатию) и подписаться. */
export async function enablePush(publicKey: string): Promise<PushState> {
  const browser = browserName();
  const fail = (step: string, error = "") => {
    api.track("push_enable_failed", { browser, step, error: error.slice(0, 80) });
    return "failed" as const;
  };
  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch (err) {
    return fail("permission", (err as Error).name);
  }
  api.track(permission === "granted" ? "push_permission_granted" : "push_permission_denied", { browser });
  // Яндекс Браузер и часть других отвечают «нет», не показав человеку вопроса — молча не оставляем
  if (permission !== "granted") return browser === "yandex" ? fail("permission", permission) : permission === "denied" ? "denied" : "failed";
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
    await sendToServer(subscription);
  } catch (err) {
    return fail("subscribe", `${(err as Error).name}: ${(err as Error).message}`);
  }
  return "on";
}

/** При каждом входе подтверждаем подписку: устройство могло сменить владельца. */
export async function syncPush() {
  if (!platform().supported || Notification.permission !== "granted") return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) await sendToServer(subscription).catch(() => undefined);
}
