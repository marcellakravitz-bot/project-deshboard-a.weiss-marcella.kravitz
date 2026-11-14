// Service worker for the apps (14.11.26 · build 61).
// Two jobs: make the page installable to the home screen (iOS will not offer
// web push without that), and show the notifications.
// It deliberately does not cache pages — a cached board showing yesterday's
// schedule on site is worse than a slow one.
//
// 14.11.26 — a notification now carries its words ("עדכון ב-SD" / "לוח חשמל
// קומה 7 - אושר") and the address of the item. Pressed, it opens the app on
// that item; if the app is already open, that window moves there instead of a
// second one opening.
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) {}
  e.waitUntil(self.registration.showNotification(d.title || "עדכון בפרויקט", {
    body: d.body || "",
    dir: "rtl",
    lang: "he",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: d.tag || "awsub",
    renotify: true,
    data: { url: d.url || "./" }
  }));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var rel = (e.notification.data && e.notification.data.url) || "./";
  var url = new URL(rel, self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    var mine = list.filter(function (c) { return c.url.indexOf(self.registration.scope) === 0; })[0];
    if (mine && "navigate" in mine) {
      return mine.focus().then(function (c) { return (c || mine).navigate(url); }).catch(function () { return self.clients.openWindow(url); });
    }
    return self.clients.openWindow(url);
  }));
});
