import * as repo from "./data/repository.js";
import { teamLabel } from "./data/model.js";
import { parseSoldierRows } from "./data/schema.js";
import { bindDialog, closeDialog, openForm } from "./dialogs.js";
import { fmtDate, openKitSignForm, openReturnForm } from "./actions.js";
import { printSoldierForm } from "./reports.js";
import { canEdit, store } from "./state.js";
import { esc, icon } from "./ui.js";

const state = { query: "", team: "all" };

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("");

// ---------- Soldiers screen ----------

export function renderSoldiers(view) {
  view.innerHTML = `
    <section class="page-head">
      <div>
        <h1>חיילים והחתמות</h1>
        <p class="muted">מצב החתמת ציוד לפי חייל וצוות</p>
      </div>
      <div class="page-actions" id="sol-actions"></div>
    </section>
    <div id="sol-kpis"></div>
    <div class="toolbar">
      <label class="search">
        ${icon("search")}
        <input type="search" id="sol-search" placeholder="חיפוש חייל או פריט…" value="${esc(state.query)}" aria-label="חיפוש חייל או פריט">
      </label>
      <div class="chips" id="sol-teams" role="group" aria-label="סינון לפי צוות"></div>
    </div>
    <div id="sol-list"></div>`;

  view.querySelector("#sol-search").addEventListener("input", (e) => {
    state.query = e.target.value;
    view.classList.add("is-static");
    renderList(view);
  });
  view.onclick = (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "sign") return openKitSignForm();
    if (act === "add") return openSoldierForm();
    if (act === "import") return openImportForm();
    const chip = e.target.closest("[data-team]");
    if (chip) {
      state.team = chip.dataset.team;
      return renderLive(view, false);
    }
    const card = e.target.closest("[data-soldier]");
    if (card) openSoldier(card.dataset.soldier);
  };
  renderLive(view, true);
}

export function refreshSoldiers(view, first) {
  if (view.querySelector("#sol-list")) renderLive(view, first);
}

function renderLive(view, animate) {
  view.classList.toggle("is-static", !animate);
  const soldiers = store.soldiers;
  const signed = soldiers.filter((s) => s.signedQty > 0).length;
  const kpis = [
    ["חיילים", soldiers.length, ""],
    ["מוחתמים על ציוד", signed, "ok"],
    ["ללא ציוד", soldiers.length - signed, ""],
    ["פריטים מוחתמים", soldiers.reduce((a, s) => a + s.signedQty, 0), ""],
  ];
  view.querySelector("#sol-kpis").innerHTML = `
    <section class="kpis" aria-label="סיכום">
      ${kpis.map(([label, value, tone], i) => `
        <div class="kpi ${tone ? `kpi--${tone}` : ""}" style="--i:${i}">
          <span class="kpi__label">${label}</span>
          <strong class="kpi__value">${value.toLocaleString("he-IL")}</strong>
        </div>`).join("")}
    </section>`;

  view.querySelector("#sol-actions").innerHTML = canEdit() ? `
    <button type="button" class="btn btn--primary btn--sm" data-act="sign">החתמת ציוד</button>
    <button type="button" class="btn btn--ghost btn--sm" data-act="add">הוספת חייל</button>
    <button type="button" class="btn btn--ghost btn--sm" data-act="import">ייבוא רשימה</button>` : "";

  const teams = [...new Set(soldiers.map((s) => s.team))];
  if (!["all", "signed", ...teams].includes(state.team)) state.team = "all";
  const chips = [["all", "הכל"], ["signed", "מוחתמים"], ...teams.map((t) => [t, teamLabel(t)])];
  view.querySelector("#sol-teams").innerHTML = chips.map(([k, l]) =>
    `<button type="button" class="chip" data-team="${esc(k)}" aria-pressed="${state.team === k}">${esc(l)}</button>`).join("");

  renderList(view);
}

function renderList(view) {
  const el = view.querySelector("#sol-list");
  if (!store.loaded) {
    el.innerHTML = `<p class="empty">טוען נתונים…</p>`;
    return;
  }
  if (!store.soldiers.length) {
    el.innerHTML = `<p class="empty">אין עדיין חיילים במערכת.${canEdit()
      ? "<br>לחצו על \"ייבוא רשימה\" והדביקו את העמודות מקובץ ה-Excel – מספרים אישיים יוסרו אוטומטית." : ""}</p>`;
    return;
  }
  const q = state.query.trim();
  const list = store.soldiers.filter((s) =>
    (state.team === "all" || (state.team === "signed" ? s.signedQty > 0 : s.team === state.team)) &&
    (!q || s.name.includes(q) || s.items.some((i) => i.name.includes(q))));
  if (!list.length) {
    el.innerHTML = `<p class="empty">לא נמצאו חיילים מתאימים</p>`;
    return;
  }

  const groups = new Map();
  for (const s of list) groups.set(s.team, [...(groups.get(s.team) ?? []), s]);
  let n = 0;
  el.innerHTML = [...groups].map(([team, members]) => `
    <section class="team">
      <h2 class="section-title">${esc(teamLabel(team))} <span class="muted">· ${members.length}</span></h2>
      <div class="soldiers">
        ${members.map((s) => `
          <button type="button" class="soldier ${s.signedQty ? "soldier--signed" : ""}" data-soldier="${esc(s.id)}" style="--i:${Math.min(n++, 24)}">
            <span class="soldier__avatar" aria-hidden="true">${esc(initials(s.name))}</span>
            <span class="soldier__main">
              <strong>${esc(s.name)}</strong>
              <small>${s.signedQty
                ? esc(s.items.map((x) => (x.qty > 1 ? `${x.name} ×${x.qty}` : x.name)).join(" · "))
                : "ללא ציוד מוחתם"}</small>
            </span>
            ${s.signedQty ? `<span class="soldier__count" title="פריטים מוחתמים">${s.signedQty}</span>` : ""}
          </button>`).join("")}
      </div>
    </section>`).join("");
}

// ---------- Soldier card dialog ----------

export function openSoldier(soldierId) {
  const dlg = document.getElementById("soldier-dialog");
  if (!fillSoldier(dlg, soldierId, true)) return;
  bindDialog(dlg, (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = dlg.dataset.soldier;
    if (btn.dataset.act === "sign") openKitSignForm({ soldierId: id });
    else if (btn.dataset.act === "print") printSoldierForm(id);
    else if (btn.dataset.act === "return") openReturnForm(btn.dataset.item, id);
    else if (btn.dataset.act === "edit") openSoldierForm(store.soldiers.find((s) => s.id === id));
    else if (btn.dataset.act === "delete") openDeleteForm(id);
  });
  dlg.showModal();
}

export function refreshSoldierDialog() {
  const dlg = document.getElementById("soldier-dialog");
  if (dlg.open && !fillSoldier(dlg, dlg.dataset.soldier, false)) closeDialog(dlg);
}

function fillSoldier(dlg, soldierId, animate) {
  const s = store.soldiers.find((x) => x.id === soldierId);
  if (!s) return false;
  const edit = canEdit();
  dlg.dataset.soldier = s.id;
  dlg.classList.toggle("is-static", !animate);
  dlg.innerHTML = `
    <header class="cd__head">
      <span class="soldier__avatar soldier__avatar--lg" aria-hidden="true">${esc(initials(s.name))}</span>
      <div class="cd__titles">
        <h2 id="soldier-dialog-title">${esc(s.name)}</h2>
        <p>${esc(teamLabel(s.team))}${s.email ? ` · <span dir="ltr">${esc(s.email)}</span>` : ""}</p>
      </div>
      <span class="pill ${s.signedQty ? "pill--info" : "pill--ok"}">${s.signedQty ? `מוחתם · ${s.signedQty}` : "ללא ציוד"}</span>
      <button type="button" class="btn btn--icon" data-close aria-label="סגירה">${icon("close", "btn__icon")}</button>
    </header>
    <div class="cd__body">
      <div class="page-actions cd__actions">
        ${edit ? `
        <button type="button" class="btn btn--primary btn--sm" data-act="sign">החתמת ציוד</button>
        <button type="button" class="btn btn--ghost btn--sm" data-act="edit">עריכת פרטים</button>
        <button type="button" class="btn btn--ghost btn--sm" data-act="delete">מחיקה</button>` : ""}
        <button type="button" class="btn btn--ghost btn--sm" data-act="print">הדפסת טופס החתמה</button>
      </div>
      <h3 class="section-title">ציוד מוחתם</h3>
      ${s.items.length ? `<div class="signed">${s.items.map((x, n) => `
        <div class="signed__row" style="--i:${n}">
          <div class="signed__main">
            <strong>${esc(x.name)}</strong> <span class="signed__qty">×${x.qty}</span>
            <small class="muted">ארגז ${esc(x.crateNumber)} – ${esc(x.crateName)}${x.signedAt ? ` · נחתם ${fmtDate(x.signedAt)}` : ""}${x.signedBy ? ` · ע״י ${esc(x.signedBy)}` : ""}</small>
            ${x.note ? `<small class="signed__note">הערה: ${esc(x.note)}</small>` : ""}
          </div>
          ${edit ? `<button type="button" class="btn btn--ghost btn--sm" data-act="return" data-item="${esc(x.itemId)}">זיכוי</button>` : ""}
        </div>`).join("")}</div>` : `<p class="muted">לא מוחתם על ציוד.</p>`}
    </div>`;
  return true;
}

// ---------- Forms ----------

export function openSoldierForm(s = null) {
  const teams = [...new Set(store.soldiers.map((x) => x.team).filter(Boolean))];
  openForm({
    title: s ? "עריכת פרטי חייל" : "הוספת חייל",
    submit: s ? "שמירה" : "הוספה",
    body: `
      <label class="field"><span>שם פרטי</span>
        <input name="firstName" required maxlength="60" autocomplete="off" value="${esc(s?.firstName ?? "")}"></label>
      <label class="field"><span>שם משפחה</span>
        <input name="lastName" maxlength="60" autocomplete="off" value="${esc(s?.lastName ?? "")}"></label>
      <label class="field"><span>צוות</span>
        <input name="team" list="team-list" maxlength="40" autocomplete="off" placeholder="לדוגמה: 1, חפק, מפלג" value="${esc(s?.team ?? "")}"></label>
      <datalist id="team-list">${teams.map((t) => `<option value="${esc(t)}">`).join("")}</datalist>
      <label class="field"><span>מייל (לאישורי החתמה)</span>
        <input name="email" type="email" dir="ltr" maxlength="120" autocomplete="off" placeholder="name@gmail.com" value="${esc(s?.email ?? "")}"></label>
      <p class="form__hint">אין להזין מספר אישי.</p>`,
    onSubmit: async (fd) => {
      await repo.saveSoldier({
        id: s?.id, firstName: fd.get("firstName"), lastName: fd.get("lastName"), team: fd.get("team"), email: fd.get("email"),
      });
      return s ? "הפרטים נשמרו" : "החייל נוסף";
    },
  });
}

function openDeleteForm(soldierId) {
  const s = store.soldiers.find((x) => x.id === soldierId);
  if (!s) return;
  openForm({
    title: "מחיקת חייל",
    submit: "מחיקה",
    danger: true,
    body: `<p class="form__lead">למחוק את <b>${esc(s.name)}</b> מרשימת החיילים?</p>`,
    onSubmit: async () => {
      await repo.deleteSoldier(soldierId);
      return "החייל נמחק";
    },
  });
}

export function openImportForm() {
  const form = openForm({
    title: "ייבוא רשימת חיילים",
    submit: "ייבוא",
    body: `
      <p class="form__lead">העתיקו מה-Excel את העמודות <b>צוות</b>, <b>שם פרטי</b> ו<b>שם משפחה</b> (אפשר להעתיק גם עם עמודת מ.א.) והדביקו כאן.</p>
      <p class="form__hint form__hint--ok">מספרים אישיים מוסרים אוטומטית לפני השמירה ואינם נשמרים במערכת.</p>
      <label class="field"><span>נתונים להדבקה</span>
        <textarea name="rows" rows="8" spellcheck="false" placeholder="1&#9;ישראל&#9;ישראלי"></textarea></label>
      <p class="form__hint" id="import-preview" aria-live="polite"></p>`,
    onSubmit: async (fd) => {
      const { rows } = parseSoldierRows(fd.get("rows"));
      if (!rows.length) throw new Error("לא זוהו שורות חיילים בטקסט שהודבק");
      const { added, duplicates } = await repo.importSoldiers(rows);
      return `נוספו ${added} חיילים${duplicates ? ` (${duplicates} כבר קיימים – דולגו)` : ""}`;
    },
  });
  const textarea = form.querySelector("textarea");
  const preview = form.querySelector("#import-preview");
  textarea.addEventListener("input", () => {
    const { rows, removedIds, skipped } = parseSoldierRows(textarea.value);
    preview.textContent = textarea.value.trim()
      ? `זוהו ${rows.length} חיילים${removedIds ? ` · הוסרו ${removedIds} מספרים אישיים` : ""}${skipped ? ` · ${skipped} שורות לא זוהו` : ""}`
      : "";
  });
}
