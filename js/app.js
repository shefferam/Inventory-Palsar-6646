import { runSplash } from "./splash.js";
import { verifyEmblem, disableEmblem, toast } from "./ui.js";
import * as auth from "./auth.js";
import { setActor, subscribeData } from "./data/repository.js";
import { resetStore, store } from "./state.js";
import { renderDashboard, renderAbout, refreshDashboard, refreshCrateDialog } from "./views.js";
import { renderSoldiers, refreshSoldiers, refreshSoldierDialog } from "./soldiers.js";

const $ = (id) => document.getElementById(id);
const ROUTES = {
  dashboard: { render: renderDashboard, refresh: refreshDashboard, title: "דשבורד" },
  soldiers: { render: renderSoldiers, refresh: refreshSoldiers, title: "חיילים" },
  about: { render: renderAbout, title: "אודות" },
};
let user = null;
let unsubscribe = null;
let current = null;

function route() {
  if (!user) return;
  const name = location.hash.replace(/^#\/?/, "");
  current = ROUTES[name] ? name : "dashboard";
  if (!ROUTES[name]) history.replaceState(null, "", "#/dashboard");

  const view = $("view");
  view.onclick = null;
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
  Object.assign(store, data, { loaded: true });
  ROUTES[current]?.refresh?.($("view"), first);
  refreshCrateDialog();
  refreshSoldierDialog();
}

function onDataError(err) {
  console.error(err);
  if (err?.code === 401) return logout("פג תוקף ההתחברות – יש להתחבר מחדש.");
  if (err?.code === 403) return logout(err.message || "אין לך הרשאה למערכת. פנה למנהל המערכת.");
  toast(err?.message || "שגיאה בטעינת הנתונים", "danger", 8000);
}

function showLoginError(message) {
  const el = $("login-error");
  el.textContent = message || "";
  el.hidden = !message;
}

function showLogin(message) {
  $("app").hidden = true;
  $("login").hidden = false;
  showLoginError(message);
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
  setActor(u.email || u.name);
  showLoginError("");
  $("login").hidden = true;
  $("user-name").textContent = u.name;
  $("app").hidden = false;
  route();
  unsubscribe ??= subscribeData(onData, onDataError);
}

async function logout(message) {
  (await unsubscribe)?.();
  unsubscribe = null;
  await auth.signOut();
  resetStore();
  user = null;
  current = null;
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  $("view").innerHTML = "";
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
$("logout").addEventListener("click", () => logout());
window.addEventListener("hashchange", route);

async function boot() {
  verifyEmblem().then((ok) => { if (!ok) disableEmblem(); });
  const session = auth.restoreSession().catch((ex) => { console.error(ex); return null; });
  await runSplash();
  const u = await session;
  if (u) showApp(u);
  else showLogin();
}

boot();
