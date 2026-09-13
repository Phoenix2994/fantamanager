// Service worker per le notifiche push in background (FCM). Non passa dalla
// build Angular (va servito così com'è, alla radice dello scope dell'app —
// vedi PushNotificationService per la registrazione esplicita con lo scope
// corretto sotto /fantamanager/ su GitHub Pages): la configurazione Firebase
// qui sotto è quindi duplicata da src/environments/environment.ts invece che
// importata — non è un segreto (le chiavi web Firebase sono pubbliche per
// natura, protette dalle Firestore rules, non dalla loro segretezza), ma se
// il progetto Firebase cambia va aggiornata anche qui a mano.
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyATKYO9GCuqKbwWW2JOIoDduBraqaBU8U8',
  authDomain: 'fantamanager-cf18d.firebaseapp.com',
  projectId: 'fantamanager-cf18d',
  storageBucket: 'fantamanager-cf18d.firebasestorage.app',
  messagingSenderId: '890489260390',
  appId: '1:890489260390:web:a9aa23a50eed58b0ab20a7',
});

const messaging = firebase.messaging();

// Notifiche ricevute mentre l'app NON è in primo piano (in foreground ci
// pensa onMessage() nel service Angular, con uno snackbar invece che una
// notifica di sistema).
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'Fantamanager';
  const options = {
    body: payload.notification && payload.notification.body,
    icon: 'icon-192.png',
  };
  self.registration.showNotification(title, options);
});
