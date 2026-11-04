import { firebaseConfig } from "./firebase-config.js";

export const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
export const isFirebaseConfigured = Boolean(firebaseConfig && firebaseConfig.apiKey);

let appPromise = null;

/** Single Firebase app instance shared by auth and Firestore. */
export function loadFirebaseApp() {
  if (!isFirebaseConfigured) return Promise.reject(new Error("Firebase is not configured (js/firebase-config.js)"));
  appPromise ??= import(`${SDK}/firebase-app.js`).then(({ initializeApp }) => initializeApp(firebaseConfig));
  return appPromise;
}
