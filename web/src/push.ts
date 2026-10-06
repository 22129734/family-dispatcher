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

export type PushState =
  | "unsupported" // браузер не умеет push (или iPhone без установки на экран «Домой»)
  | "ios-install" // iPhone: нужно добавить на экран «Домой»
  | "denied" // пользователь запретил уведомления
  | "ask" // можно предложить включить
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
  const permission = await Notification.requestPermission();
  api.track(permission === "granted" ? "push_permission_granted" : "push_permission_denied");
  if (permission !== "granted") return permission === "denied" ? "denied" : "ask";
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await sendToServer(subscription);
  return "on";
}

/** При каждом входе подтверждаем подписку: устройство могло сменить владельца. */
export async function syncPush() {
  if (!platform().supported || Notification.permission !== "granted") return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) await sendToServer(subscription).catch(() => undefined);
}
