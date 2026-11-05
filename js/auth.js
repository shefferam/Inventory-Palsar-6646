import { GOOGLE_CLIENT_ID } from "./config.js";
import { isFirebaseConfigured, loadFirebaseApp, SDK } from "./firebase.js";

const DEMO_KEY = "palsar.demoUser";
const TOKEN_KEY = "palsar.idToken";
const GIS_SRC = "https://accounts.google.com/gsi/client";

/** "google" = Google Identity Services (used with the Sheets backend) | "firebase" | "demo" (nothing configured). */
export const provider = GOOGLE_CLIENT_ID ? "google" : isFirebaseConfigured ? "firebase" : "demo";

// ---------- Google Identity Services ----------

function decodeJwt(token) {
  const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Display only – the Sheets server verifies the token's signature and audience with Google.
function userFromToken(token) {
  try {
    const c = decodeJwt(token);
    if (c.exp * 1000 < Date.now() + 60_000) return null;
    return { name: c.name || c.email, email: c.email, demo: false };
  } catch {
    return null;
  }
}

export const getIdToken = () => sessionStorage.getItem(TOKEN_KEY);

// Google ID tokens last 1 hour; renew silently a few minutes before expiry.
const RENEW_BEFORE_MS = 5 * 60_000;
let renewTimer = null;

function storeToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
  scheduleRenew();
}

function scheduleRenew() {
  clearTimeout(renewTimer);
  const token = getIdToken();
  if (!token) return;
  const wait = decodeJwt(token).exp * 1000 - Date.now() - RENEW_BEFORE_MS;
  renewTimer = setTimeout(renew, Math.max(0, wait));
}

async function renew() {
  if (!getIdToken()) return;
  try {
    await loadGis();
    // With auto_select this re-issues a token without UI; otherwise Google shows a one-tap "continue" prompt.
    google.accounts.id.prompt();
  } catch (err) {
    console.warn("[Palsar] token renewal failed", err);
  }
}

// Timers are throttled in background tabs, so re-check when the user returns.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && provider === "google") scheduleRenew();
});

let renewWaiters = [];

/** Tries to get a fresh token now (e.g. after the server rejected an expired one). Resolves true on success. */
export function renewSession(timeoutMs = 20_000) {
  if (provider !== "google" || !getIdToken()) return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = (ok) => {
      clearTimeout(timer);
      renewWaiters = renewWaiters.filter((w) => w !== done);
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    renewWaiters.push(done);
    renew();
  });
}

let gisReady = null;
let onGisUser = () => {};
let onGisError = () => {};

function loadGis() {
  gisReady ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => {
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: ({ credential }) => {
          const user = userFromToken(credential);
          if (!user) return onGisError(new Error("ההתחברות נכשלה"));
          const prev = getIdToken();
          const renewed = prev && decodeJwt(prev).email === user.email;
          storeToken(credential);
          [...renewWaiters].forEach((done) => done(true));
          if (!renewed) onGisUser(user);
        },
        auto_select: true,
        cancel_on_tap_outside: true,
        use_fedcm_for_prompt: true,
      });
      resolve();
    };
    s.onerror = () => { gisReady = null; reject(new Error("לא ניתן לטעון את התחברות Google")); };
    document.head.append(s);
  });
  return gisReady;
}

/** Renders the official "Sign in with Google" button and offers One Tap for returning users. */
export async function mountGoogleButton(container, onUser, onError) {
  onGisUser = onUser;
  onGisError = onError;
  try {
    await loadGis();
    container.replaceChildren();
    google.accounts.id.renderButton(container, {
      theme: "filled_black", size: "large", shape: "pill", text: "signin_with", locale: "he",
      width: Math.min(Math.max(container.clientWidth, 240), 400),
    });
    google.accounts.id.prompt();
  } catch (err) {
    onError(err);
  }
}

// ---------- Firebase (optional alternative) ----------

let fb = null;
async function loadFirebase() {
  if (fb) return fb;
  const [app, authMod] = await Promise.all([loadFirebaseApp(), import(`${SDK}/firebase-auth.js`)]);
  fb = { auth: authMod.getAuth(app), ...authMod };
  return fb;
}
const fromFirebase = (u) => ({ name: u.displayName || u.email || "משתמש", email: u.email || "", demo: false });

export async function signInWithFirebase() {
  const { auth, GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await loadFirebase();
  const googleProvider = new GoogleAuthProvider();
  try {
    return fromFirebase((await signInWithPopup(auth, googleProvider)).user);
  } catch (err) {
    // Mobile browsers often block popups – fall back to a full-page redirect.
    if (err?.code === "auth/popup-blocked" || err?.code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    throw err;
  }
}

// ---------- Common ----------

export async function restoreSession() {
  if (provider === "google") {
    const token = getIdToken();
    const user = token && userFromToken(token);
    if (!user) sessionStorage.removeItem(TOKEN_KEY);
    else scheduleRenew();
    return user || null;
  }
  if (provider === "firebase") {
    const { auth, onAuthStateChanged } = await loadFirebase();
    return new Promise((resolve) => {
      const stop = onAuthStateChanged(auth, (u) => { stop(); resolve(u ? fromFirebase(u) : null); });
    });
  }
  return sessionStorage.getItem(DEMO_KEY) ? { name: "משתמש הדגמה", email: "", demo: true } : null;
}

export function signInDemo() {
  sessionStorage.setItem(DEMO_KEY, "1");
  return { name: "משתמש הדגמה", email: "", demo: true };
}

export async function signOut() {
  clearTimeout(renewTimer);
  sessionStorage.removeItem(DEMO_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  if (provider === "google") window.google?.accounts.id.disableAutoSelect();
  if (provider === "firebase") {
    const { auth, signOut: fbSignOut } = await loadFirebase();
    await fbSignOut(auth);
  }
}
