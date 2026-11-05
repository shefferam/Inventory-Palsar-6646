import { runSplash } from "./splash.js";
import { verifyEmblem, disableEmblem, initTheme, toast, toggleTheme } from "./ui.js";
import * as auth from "./auth.js";
import {
  backend, clearOfflineCache, offlineUser, setActor, subscribeData, usersSupported,
} from "./data/repository.js";
import { resetStore, store } from "./state.js";
import { renderDashboard, renderAbout, refreshDashboard, refreshCrateDialog } from "./views.js";
import { renderSoldiers, refreshSoldiers, refreshSoldierDialog } from "./soldiers.js";
import { renderHistory, refreshHistory } from "./history.js";
import { renderUsers, refreshUsers } from "./users.js";

const $ = (id) => document.getElementById(id);
const ROUTES = {
  dashboard: { render: renderDashboard, refresh: refreshDashboard, title: "דשבורד" },
  soldiers: { render: renderSoldiers, refresh: refreshSoldiers, title: "חיילים" },
  history: { render: renderHistory, refresh: refreshHistory, title: "היסטוריה" },
  users: { render: renderUsers, refresh: (view, first) => refreshUsers(view, first, user), title: "משתמשים" },
  about: { render: renderAbout, title: "אודות" },
};
let user = null;
let unsubscribe = null;
let current = null;
let renewing = null;
let connectionLost = false;
let lastFresh = null;

function route() {
  if (!user) return;
  const name = location.hash.replace(/^#\/?/, "");
  current = ROUTES[name] ? name : "dashboard";
  if (!ROUTES[name]) history.replaceState(null, "", "#/dashboard");

  const view = $("view");
  view.onclick = null;
  view.onchange = null;
  ROUTES[current].render(view, user);
  view.classList.remove("view--enter");
  void view.offsetWidth; // restart the enter animation
  view.classList.add("view--enter");

  document.querySelectorAll(".nav a").forEach((a) => {
    if (a.dataset.route === current) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  document.title = `${ROUTES[current].title} · פלס״ר 6646`;
  window.scrollTo(0, 0);
}

function onData(data) {
  const first = !store.loaded;
  if (user?.offline) data.role = "viewer";
  if (!data.cachedAt) {
    connectionLost = false;
    lastFresh = new Date().toISOString();
  }
  Object.assign(store, data, { loaded: true });
  $("nav-users").hidden = !(usersSupported && store.role === "admin");
  renderBanner();
  ROUTES[current]?.refresh?.($("view"), first);
  refreshCrateDialog();
  refreshSoldierDialog();
}

async function onDataError(err) {
  console.error(err);
  if (err?.code === 401) {
    renewing ??= renewAndResubscribe().finally(() => { renewing = null; });
    if (await renewing) return;
    return logout("פג תוקף ההתחברות – יש להתחבר מחדש.");
  }
  if (err?.code === 403) return logout(err.message || "אין לך הרשאה למערכת. פנה למנהל המערכת.", { clearCache: true });
  if (err?.code === 0) {
    connectionLost = true;
    return renderBanner();
  }
  toast(err?.message || "שגיאה בטעינת הנתונים", "danger", 8000);
}

/** The server rejected an expired token: get a new one silently and reconnect. */
async function renewAndResubscribe() {
  if (user?.offline || !(await auth.renewSession())) return false;
  (await unsubscribe)?.();
  unsubscribe = subscribeData(onData, onDataError);
  return true;
}

function renderBanner() {
  const el = $("offline-banner");
  const offline = backend !== "local" && (connectionLost || !navigator.onLine || user?.offline);
  el.hidden = !offline || !user;
  if (el.hidden) return;
  const at = store.cachedAt || lastFresh;
  const when = at ? new Date(at).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
  el.textContent = `אין חיבור לשרת – מוצגים הנתונים מעדכון אחרון${when ? ` (${when})` : ""}. שינויים יתאפשרו כשהחיבור יחזור.`;
}

function renderOfflineLogin() {
  $("offline-login").hidden = navigator.onLine || !offlineUser();
}

window.addEventListener("online", async () => {
  renderBanner();
  renderOfflineLogin();
  // Offline viewing has no sign-in; once connected, ask the user to sign in properly.
  if (user?.offline) return logout("החיבור חזר – יש להתחבר כדי לראות נתונים עדכניים.");
  // If connecting failed entirely, start the subscription again.
  if (user && connectionLost) {
    (await unsubscribe)?.();
    unsubscribe = subscribeData(onData, onDataError);
  }
});
window.addEventListener("offline", () => { renderBanner(); renderOfflineLogin(); });

function showLoginError(message) {
  const el = $("login-error");
  el.textContent = message || "";
  el.hidden = !message;
}

function showLogin(message) {
  $("app").hidden = true;
  $("login").hidden = false;
  showLoginError(message);
  renderOfflineLogin();
  if (auth.provider === "google") {
    $("google-login").hidden = true;
    const box = $("gis-button");
    box.hidden = false;
    auth.mountGoogleButton(box, showApp, (err) => showLoginError(err.message));
  } else if (auth.provider === "demo") {
    $("demo-login").hidden = false;
    $("login-note").hidden = false;
  }
}

function showApp(u) {
  user = u;
  setActor(u);
  showLoginError("");
  $("login").hidden = true;
  $("user-name").textContent = u.offline ? `${u.name} (לא מקוון)` : u.name;
  $("app").hidden = false;
  route();
  renderBanner();
  unsubscribe ??= subscribeData(onData, onDataError);
}

async function logout(message, { clearCache = false } = {}) {
  (await unsubscribe)?.();
  unsubscribe = null;
  await auth.signOut();
  // An explicit sign-out (or lost access) removes the data kept on the device for offline viewing.
  if (clearCache) clearOfflineCache();
  resetStore();
  user = null;
  current = null;
  connectionLost = false;
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  $("view").innerHTML = "";
  $("offline-banner").hidden = true;
  $("nav-users").hidden = true;
  showLogin(message);
}

// Custom button is used for Firebase/demo; with Google Identity Services the official button is rendered instead.
$("google-login").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  showLoginError("");
  if (auth.provider === "demo") {
    showLoginError("התחברות Google עדיין לא הוגדרה (js/config.js). ניתן להיכנס במצב הדגמה.");
    return;
  }
  btn.disabled = true;
  try {
    const u = await auth.signInWithFirebase();
    if (u) showApp(u);
  } catch (ex) {
    if (ex?.code !== "auth/popup-closed-by-user" && ex?.code !== "auth/cancelled-popup-request") {
      console.error(ex);
      showLoginError("ההתחברות נכשלה. נסו שוב.");
    }
  } finally {
    btn.disabled = false;
  }
});

$("demo-login").addEventListener("click", () => showApp(auth.signInDemo()));
$("offline-login").addEventListener("click", () => {
  const u = offlineUser();
  if (u) showApp(u);
});
$("logout").addEventListener("click", () => logout(undefined, { clearCache: true }));
$("theme-toggle").addEventListener("click", toggleTheme);
window.addEventListener("hashchange", route);
initTheme();

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("sw.js").catch((err) => console.warn("[Palsar] service worker not registered", err));
}

async function boot() {
  verifyEmblem().then((ok) => { if (!ok) disableEmblem(); });
  const session = auth.restoreSession().catch((ex) => { console.error(ex); return null; });
  await runSplash();
  const u = await session;
  if (u) showApp(u);
  else showLogin();
}

boot();
