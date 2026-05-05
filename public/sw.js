// Listen for Push Notifications from the server
self.addEventListener('push', event => {
  const data = event.data.json();
  
  self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icon.png',
    data: data.data
  });
});

// Open the app when the user clicks the notification
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});
