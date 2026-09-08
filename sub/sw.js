// Service worker for the subcontractor app.
// Two jobs: make the page installable to the home screen (iOS will not offer
// web push without that), and receive the notifications once the server side
// is in place. It deliberately does not cache pages — a cached board showing
// yesterday's schedule on site is worse than a slow one.
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) {}
  e.waitUntil(self.registration.showNotification(d.title || "עדכון הועלה", {
    body: d.body || "",
    dir: "rtl",
    lang: "he",
    tag: d.tag || "awsub",
    data: { url: d.url || "./" }
  }));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(clients.openWindow((e.notification.data && e.notification.data.url) || "./"));
});
