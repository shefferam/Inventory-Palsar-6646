import * as repo from "./data/repository.js";
import { ROLE_LABEL, ROLES } from "./data/model.js";
import { openForm } from "./dialogs.js";
import { store } from "./state.js";
import { esc, toast } from "./ui.js";

let me = "";
let users = null;
let error = "";

const roleOptions = (selected) =>
  ROLES.map((r) => `<option value="${r}" ${r === selected ? "selected" : ""}>${ROLE_LABEL[r]}</option>`).join("");

export function renderUsers(view, user) {
  me = (user?.email ?? "").toLowerCase();
  view.onclick = null;
  if (!store.loaded) {
    view.innerHTML = `<p class="empty">טוען נתונים…</p>`;
    return;
  }
  if (!repo.usersSupported || store.role !== "admin") {
    view.innerHTML = `<p class="empty">${repo.usersSupported ? "מסך זה זמין למנהלי המערכת בלבד." : "ניהול משתמשים זמין כשהנתונים נשמרים ב-Google Sheets."}</p>`;
    return;
  }
  view.innerHTML = `
    <section class="page-head">
      <div>
        <h1>ניהול משתמשים</h1>
        <p class="muted">מי יכול להיכנס למערכת ומה מותר לו לעשות</p>
      </div>
    </section>
    <form class="users__add" id="user-add" novalidate>
      <label class="field"><span>כתובת Gmail</span>
        <input name="email" type="email" required maxlength="120" autocomplete="off" dir="ltr" placeholder="name@gmail.com"></label>
      <label class="field"><span>הרשאה</span>
        <select name="role">${roleOptions("viewer")}</select></label>
      <button type="submit" class="btn btn--primary">הוספה</button>
    </form>
    <p class="form__hint users__legend">צפייה – רואה הכל · עריכה – מחתים, מזכה ומעדכן ציוד · מנהל – גם ניהול משתמשים</p>
    <div id="users-list"></div>`;

  view.querySelector("#user-add").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const btn = form.querySelector("button");
    btn.disabled = true;
    try {
      const fd = new FormData(form);
      users = await repo.saveUser(fd.get("email"), fd.get("role"));
      form.reset();
      toast("המשתמש נשמר", "ok", 3000);
      renderList(view);
    } catch (err) {
      toast(err?.message || "השמירה נכשלה", "danger");
    } finally {
      btn.disabled = false;
    }
  };
  view.onchange = async (e) => {
    const select = e.target.closest("[data-role-for]");
    if (!select) return;
    select.disabled = true;
    try {
      users = await repo.saveUser(select.dataset.roleFor, select.value);
      toast("ההרשאה עודכנה", "ok", 3000);
    } catch (err) {
      toast(err?.message || "העדכון נכשל", "danger");
    }
    renderList(view);
  };
  view.onclick = (e) => {
    const btn = e.target.closest("[data-remove]");
    if (btn) confirmRemove(view, btn.dataset.remove);
  };
  load(view);
}

/** Re-render once the role is known (the first snapshot may arrive after the route was opened). */
export function refreshUsers(view, first, user) {
  if (first) renderUsers(view, user);
}

async function load(view) {
  users = null;
  error = "";
  renderList(view);
  try {
    users = await repo.listUsers();
  } catch (err) {
    error = err?.message || "טעינת המשתמשים נכשלה";
  }
  renderList(view);
}

function renderList(view) {
  const el = view.querySelector("#users-list");
  if (!el) return;
  if (error) {
    el.innerHTML = `<p class="empty">${esc(error)}</p>`;
    return;
  }
  if (!users) {
    el.innerHTML = `<p class="empty">טוען משתמשים…</p>`;
    return;
  }
  const sorted = [...users].sort((a, b) => ROLES.indexOf(b.role) - ROLES.indexOf(a.role) || a.email.localeCompare(b.email));
  el.innerHTML = `
    <ul class="users">
      ${sorted.map((u) => {
        const self = u.email === me;
        return `
        <li class="users__row">
          <span class="users__email" dir="ltr">${esc(u.email)}</span>
          ${self ? `<span class="pill pill--info">את/ה</span>` : ""}
          <select class="users__role" data-role-for="${esc(u.email)}" aria-label="הרשאה – ${esc(u.email)}" ${self ? "disabled" : ""}>${roleOptions(u.role)}</select>
          ${self ? "" : `<button type="button" class="btn btn--ghost btn--sm" data-remove="${esc(u.email)}">הסרה</button>`}
        </li>`;
      }).join("")}
    </ul>`;
}

function confirmRemove(view, email) {
  openForm({
    title: "הסרת משתמש",
    submit: "הסרה",
    danger: true,
    body: `<p class="form__lead">להסיר את <b dir="ltr">${esc(email)}</b>? המשתמש לא יוכל להיכנס למערכת.</p>`,
    onSubmit: async () => {
      users = await repo.deleteUser(email);
      renderList(view);
      return "המשתמש הוסר";
    },
  });
}
