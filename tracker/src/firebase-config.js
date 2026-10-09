// Firebase project identifiers, bundled into app.js so the app and its connection details always
// arrive together (a phone can no longer pair a new app with an old, empty config.js from its cache).
// Not secrets: data is locked to the owner's Google accounts by Firestore rules, and the key only
// works from the owner's sites. Keep in step with ../config.js, which older cached copies still load.
export default {
  apiKey: "AIzaSyBtqpOK9PPcvqDuDTHK58OX7YKiwJhplMo",
  authDomain: "research-log-bd8a2.firebaseapp.com",
  projectId: "research-log-bd8a2",
  storageBucket: "research-log-bd8a2.firebasestorage.app",
  messagingSenderId: "123588099293",
  appId: "1:123588099293:web:ad79acb90afcdd58bb6f34"
};
