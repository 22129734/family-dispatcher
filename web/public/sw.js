// Service worker: устанавливаемое приложение, оболочка без сети и push-уведомления.
// API-запросы всегда идут в сеть — данные семьи не кэшируем.
const SHELL = "shell-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(["/", "/icon.svg"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match("/"))),
  );
});

// ---------- Push ----------
// Сервер присылает: { title, body, url, tag, actions: [{action, title}], act_url }

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Семейный диспетчер", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Семейный диспетчер", {
      body: data.body || "",
      tag: data.tag,
      renotify: Boolean(data.tag),
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      lang: "ru",
      actions: (data.actions || []).slice(0, 2),
      data: { url: data.url || "/", act_url: data.act_url || null },
    }),
  );
});

async function openPage(url) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if ("focus" in client) {
      await client.navigate(url).catch(() => undefined);
      return client.focus();
    }
  }
  return self.clients.openWindow(url);
}

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  const { url, act_url } = notification.data || {};
  notification.close();

  if (event.action === "accept" && act_url) {
    // «Беру» прямо из уведомления — без открытия приложения
    event.waitUntil(
      fetch(`${act_url}/accept`, { method: "POST" })
        .then(async (response) => {
          if (!response.ok) throw new Error(String(response.status));
          const info = await response.json();
          return self.registration.showNotification("Записали: вы берёте", {
            body: info.task.title,
            tag: notification.tag,
            silent: true,
            icon: "/icon-192.png",
            badge: "/badge-96.png",
            data: { url },
          });
        })
        .catch(() => openPage(url || "/")),
    );
    return;
  }
  if (event.action === "decline") {
    // Причину отказа удобнее написать на странице задачи
    event.waitUntil(openPage(`${url}?decline=1`));
    return;
  }
  event.waitUntil(openPage(url || "/"));
});
