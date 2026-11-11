import { holdersOf, ROLE_LABEL, STATUS, teamLabel } from "./data/model.js";
import { backend } from "./data/repository.js";
import {
  fmtDate, fmtDateHe, openCountForm, openCountSequence, openCrateForm, openDeleteCrateForm, openDeleteItemForm, openItemForm,
  openReturnForm, openSignForm,
} from "./actions.js";
import { bindDialog, closeDialog } from "./dialogs.js";
import { openExportForm } from "./reports.js";
import { openSoldier } from "./soldiers.js";
import { canEdit, findItem, store } from "./state.js";
import { EMBLEM_SRC, esc, hebrewDate, icon, reducedMotion } from "./ui.js";

const state = { filter: "all", query: "", name: "" };
const ISSUES_SHOWN = 30;
const FILTERS = [["all", "הכל"], ["ok", "תקין"], ["warn", "התראה"], ["danger", "חוסר"], ["received", "ציוד שהתקבל"]];
const BACKEND_LABEL = { local: "מקומי – בדפדפן זה בלבד", sheets: "Google Sheets (משותף)", firestore: "Firestore (משותף)" };

export function refreshDashboard(view, first) {
  if (view.querySelector("#dash-live")) renderLive(view, first);
}

export function refreshCrateDialog() {
  const dlg = document.getElementById("crate-dialog");
  if (!dlg.open) return;
  const c = store.crates.find((x) => x.id === dlg.dataset.crate);
  if (c) fillCrate(dlg, c, false);
  else closeDialog(dlg);
}

const emblem = (size) =>
  `<span class="emblem emblem--${size}"><img src="${EMBLEM_SRC}" alt="סמל יחידת פלס״ר 6646" width="300" height="300"></span>`;

const pct = (n, total) => (total ? `${((n / total) * 100).toFixed(1)}%` : "0%");

function meter({ available, withSoldiers, faulty, total }) {
  return `<div class="meter" role="img" aria-label="זמין ${available}, אצל חיילים ${withSoldiers}, תקול ${faulty}, מתוך ${total}">
      <span class="m-avail" style="--w:${pct(available, total)}"></span>
      <span class="m-out" style="--w:${pct(withSoldiers, total)}"></span>
      <span class="m-fault" style="--w:${pct(faulty, total)}"></span>
    </div>`;
}

function itemLabel(item) {
  if (item.status === "danger") return "חוסר";
  if (item.short > 0) return "מתחת למינימום";
  if (item.faulty > 0) return "תקלה";
  return STATUS.ok.label;
}

function crateAlert(c) {
  if (c.shortages.length) return `<p class="crate__alert">${icon("alert")} ${c.shortages.length === 1 ? "פריט אחד" : `${c.shortages.length} פריטים`} מתחת למינימום</p>`;
  if (c.faulty) return `<p class="crate__alert">${icon("alert")} ${c.faulty} פריטים תקולים</p>`;
  return "";
}

const crateMeta = (c) => [c.category, c.location].filter(Boolean).map(esc).join(" · ");
const lastCount = (c) => (c.lastCountAt ? `נספר ב-${fmtDateHe(c.lastCountAt)}` : "טרם נספר");
const receivedText = (c) =>
  `התקבל מ${esc(c.receivedFrom)}${c.returnBy ? ` · להחזיר עד ${fmtDateHe(c.returnBy)}` : " · להחזרה"}${c.overdue ? " · עבר המועד!" : ""}`;

const crateCard = (c, i) => `
  <div class="crate crate--${c.status} ${c.received ? "crate--received" : ""}" role="button" tabindex="0" data-crate="${esc(c.id)}" style="--i:${i}"
       aria-label="ארגז ${esc(c.number)} – ${esc(c.name)}, סטטוס ${STATUS[c.status].label}${c.received ? `, ${receivedText(c)}` : ""}" aria-haspopup="dialog">
    <div class="crate__lid">
      <span class="crate__stencil">ארגז ${esc(c.number)}</span>
      <span class="pill pill--${c.status}">${STATUS[c.status].label}</span>
    </div>
    <div class="crate__body">
      ${c.received ? `<p class="crate__received ${c.overdue ? "is-overdue" : ""}">${receivedText(c)}</p>` : ""}
      <div>
        <h3 class="crate__name">${esc(c.name)}</h3>
        <span class="crate__cat">${crateMeta(c)}</span>
        <span class="crate__count">${lastCount(c)}</span>
      </div>
      <dl class="crate__stats">
        <div><dt>סוגי פריטים</dt><dd>${c.itemTypes}</dd></div>
        <div><dt>זמין</dt><dd>${c.available}</dd></div>
        <div><dt>אצל חיילים</dt><dd>${c.withSoldiers}</dd></div>
      </dl>
      ${meter(c)}
      ${crateAlert(c)}
    </div>
  </div>`;

function filteredCrates() {
  const q = state.query.trim();
  return store.crates.filter((c) =>
    (state.filter === "all" || (state.filter === "received" ? c.received : c.status === state.filter)) &&
    (!state.name || c.name === state.name) &&
    (!q || [c.name, c.number, c.category, c.receivedFrom, ...c.items.flatMap((i) => [i.name, i.serial])].some((s) => s.includes(q))));
}

function nameOptions() {
  const names = [...new Set(store.crates.map((c) => c.name))].sort((a, b) => a.localeCompare(b, "he"));
  if (state.name && !names.includes(state.name)) state.name = "";
  return `<option value="">כל הארגזים</option>${names.map((n) =>
    `<option value="${esc(n)}" ${n === state.name ? "selected" : ""}>${esc(n)}</option>`).join("")}`;
}

function renderCrates(grid) {
  const list = filteredCrates();
  const empty = store.loaded ? "לא נמצאו ארגזים מתאימים" : "טוען נתונים…";
  grid.innerHTML = list.length ? list.map(crateCard).join("") : `<p class="empty">${empty}</p>`;
}

function countUp(root) {
  const els = root.querySelectorAll("[data-count]");
  if (reducedMotion()) return;
  const start = performance.now();
  const dur = 800;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    els.forEach((el) => { el.textContent = Math.round(Number(el.dataset.count) * e).toLocaleString("he-IL"); });
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderLive(view, animate) {
  view.classList.toggle("is-static", !animate);
  const { crates } = store;
  const alerts = crates
    .flatMap((c) => c.items.filter((i) => i.status !== "ok").map((i) => ({ c, i })))
    .sort((a, b) => STATUS[b.i.status].rank - STATUS[a.i.status].rank);
  const total = (k) => crates.reduce((a, c) => a + c[k], 0);
  const received = crates.filter((c) => c.received);
  const kpis = [
    ["ארגזים", crates.length, ""],
    ["סוגי פריטים", total("itemTypes"), ""],
    ["פריטים זמינים", total("available"), "ok"],
    ["אצל חיילים", total("withSoldiers"), ""],
    ["התראות פעילות", alerts.length, alerts.some((a) => a.i.status === "danger") ? "danger" : alerts.length ? "warn" : "ok"],
    ...(received.length ? [["ארגזים להחזרה", received.length, received.some((c) => c.overdue) ? "danger" : "received"]] : []),
  ];
  const shown = alerts.slice(0, 4);

  view.querySelector("#dash-live").innerHTML = `
    <section class="kpis" aria-label="סיכום">
      ${kpis.map(([label, value, tone], i) => `
        <div class="kpi ${tone ? `kpi--${tone}` : ""}" style="--i:${i}">
          <span class="kpi__label">${label}</span>
          <strong class="kpi__value" data-count="${value}">${value.toLocaleString("he-IL")}</strong>
        </div>`).join("")}
    </section>

    ${alerts.length ? `
    <section aria-labelledby="alerts-title">
      <h2 class="section-title" id="alerts-title">${icon("alert", "alert__icon")} התראות</h2>
      <div class="alerts">
        ${shown.map(({ c, i }, n) => `
          <button type="button" class="alert alert--${i.status}" data-crate="${esc(c.id)}" style="--i:${n}">
            ${icon("alert", "alert__icon")}
            <span class="alert__text"><strong>${esc(i.name)}</strong> – ${itemLabel(i)}${i.short ? ` (זמין ${i.available}, מינימום ${i.min})` : i.faulty ? ` (${i.faulty} תקולים)` : ""}</span>
            <span class="alert__meta">ארגז ${esc(c.number)}</span>
          </button>`).join("")}
        ${alerts.length > shown.length ? `<p class="muted">ועוד ${alerts.length - shown.length} התראות נוספות בתוך הארגזים</p>` : ""}
      </div>
    </section>` : ""}`;

  view.querySelector("#crate-actions").innerHTML = `
    ${canEdit() ? `
    <button type="button" class="btn btn--primary btn--sm" data-act="add-crate">הוספת ארגז</button>
    <button type="button" class="btn btn--ghost btn--sm" data-act="count-all">ספירת מלאי</button>` : ""}
    <button type="button" class="btn btn--ghost btn--sm" data-act="export">ייצוא ל-Excel</button>`;
  view.querySelector("#crate-name").innerHTML = nameOptions();
  renderCrates(view.querySelector("#crates"));
  if (animate) countUp(view);
}

export function renderDashboard(view, user) {
  const today = new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const todayHe = hebrewDate(new Date());
  view.innerHTML = `
    <section class="hero">
      ${emblem("sm")}
      <div>
        <h1>שלום, ${esc(user.name)}</h1>
        <p>${esc(today)} · ${esc(todayHe)} · תמונת מצב ציוד ומלאי</p>
      </div>
    </section>

    <div id="dash-live"></div>

    <section aria-labelledby="crates-title">
      <h2 class="section-title" id="crates-title">ארגזי ציוד</h2>
      <div class="toolbar">
        <label class="search">
          ${icon("search")}
          <input type="search" id="crate-search" placeholder="חיפוש ארגז, פריט או מ. צלם…" value="${esc(state.query)}" aria-label="חיפוש ארגז, פריט או מ. צלם">
        </label>
        <select class="select" id="crate-name" aria-label="סינון לפי שם ארגז"></select>
        <div class="chips" role="group" aria-label="סינון לפי סטטוס">
          ${FILTERS.map(([k, l]) =>
            `<button type="button" class="chip ${k === "received" ? "chip--received" : ""}" data-filter="${k}" aria-pressed="${state.filter === k}">${l}</button>`).join("")}
        </div>
        <div class="page-actions" id="crate-actions"></div>
      </div>
      <div class="crates" id="crates"></div>
    </section>`;

  const grid = view.querySelector("#crates");
  renderLive(view, true);

  view.querySelector("#crate-search").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderCrates(grid);
  });
  view.querySelector("#crate-name").addEventListener("change", (e) => {
    state.name = e.target.value;
    renderCrates(grid);
  });
  view.querySelector(".chips").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-filter]");
    if (!chip) return;
    state.filter = chip.dataset.filter;
    view.querySelectorAll("[data-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b === chip)));
    renderCrates(grid);
  });

  const open = (e) => {
    if (e.target.closest('[data-act="add-crate"]')) {
      return openCrateForm(null, (id) => openCrate(store.crates.find((c) => c.id === id)));
    }
    if (e.target.closest('[data-act="count-all"]')) return openCountSequence();
    if (e.target.closest('[data-act="export"]')) return openExportForm();
    const el = e.target.closest("[data-crate]");
    if (el) openCrate(store.crates.find((c) => c.id === el.dataset.crate));
  };
  // #view persists across routes, so assign (not add) handlers to avoid stacking them.
  view.onclick = open;
  grid.onkeydown = (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-crate]")) {
      e.preventDefault();
      open(e);
    }
  };
}

export function openCrate(c) {
  if (!c) return;
  const dlg = document.getElementById("crate-dialog");
  fillCrate(dlg, c, true);
  bindDialog(dlg, (e) => {
    const crate = store.crates.find((x) => x.id === dlg.dataset.crate);
    const act = e.target.closest("[data-act]");
    if (act && crate) {
      const itemId = act.dataset.item;
      switch (act.dataset.act) {
        case "add-item": return openItemForm(crate);
        case "count": return openCountForm(crate);
        case "edit-crate": return openCrateForm(crate);
        case "delete-crate": return openDeleteCrateForm(crate);
        case "edit-item": return openItemForm(crate, findItem(itemId)?.item);
        case "delete-item": return openDeleteItemForm(itemId);
      }
    }
    const sign = e.target.closest("[data-sign]");
    if (sign) return openSignForm({ itemId: sign.dataset.sign });
    const ret = e.target.closest("[data-return]");
    if (ret) return openReturnForm(ret.dataset.return, ret.dataset.soldier);
    const soldier = e.target.closest("[data-open-soldier]");
    if (soldier) openSoldier(soldier.dataset.openSoldier);
  });
  dlg.showModal();
  dlg.querySelector(".cd__body").scrollTop = 0;
}

function fillCrate(dlg, c, animate) {
  const holders = holdersOf(c);
  const edit = canEdit();
  const scroll = dlg.querySelector(".cd__body")?.scrollTop ?? 0;
  dlg.dataset.crate = c.id;
  dlg.classList.toggle("is-static", !animate);
  dlg.classList.toggle("crate-dialog--received", c.received);
  const issues = c.issues.slice(0, ISSUES_SHOWN);
  dlg.innerHTML = `
    <header class="cd__head">
      <span class="crate__stencil">ארגז ${esc(c.number)}</span>
      <div class="cd__titles">
        <h2 id="crate-dialog-title">${esc(c.name)}</h2>
        <p>${[crateMeta(c), `${lastCount(c)}${c.lastCountBy ? ` ע״י ${esc(c.lastCountBy)}` : ""}`].filter(Boolean).join(" · ")}</p>
        ${c.received ? `<p class="cd__received ${c.overdue ? "is-overdue" : ""}">${receivedText(c)}</p>` : ""}
      </div>
      <span class="pill pill--${c.status}">${STATUS[c.status].label}</span>
      <button type="button" class="btn btn--icon" data-close aria-label="סגירה">${icon("close", "btn__icon")}</button>
    </header>
    <div class="cd__body">
      ${edit ? `
      <div class="page-actions cd__actions">
        <button type="button" class="btn btn--primary btn--sm" data-act="add-item">הוספת פריט</button>
        <button type="button" class="btn btn--ghost btn--sm" data-act="count">ספירת מלאי</button>
        <button type="button" class="btn btn--ghost btn--sm" data-act="edit-crate">עריכת ארגז</button>
        <button type="button" class="btn btn--ghost btn--sm" data-act="delete-crate">מחיקת ארגז</button>
      </div>` : ""}
      <div class="cd__summary">
        <div><span>סוגי פריטים</span><strong>${c.itemTypes}</strong></div>
        <div><span>סה״כ פריטים</span><strong>${c.total}</strong></div>
        <div><span>זמין</span><strong style="color:var(--ok)">${c.available}</strong></div>
        <div><span>אצל חיילים</span><strong>${c.withSoldiers}</strong></div>
        <div><span>תקולים</span><strong style="color:${c.faulty ? "var(--danger)" : "inherit"}">${c.faulty}</strong></div>
      </div>

      <h3 class="section-title">תכולת הארגז</h3>
      <div class="legend" style="margin:-.3rem 0 .8rem">
        <span><i style="background:var(--ok)"></i>זמין</span>
        <span><i style="background:var(--olive-400)"></i>אצל חיילים</span>
        <span><i style="background:var(--danger)"></i>תקול</span>
      </div>
      <div class="items">
        ${c.items.map((i, n) => `
          <div class="item item--${i.status} ${i.consumable ? "item--consumable" : ""}" style="--i:${n}">
            <div class="item__top">
              <h4 class="item__name">${esc(i.name)}${i.consumable ? ` <span class="tag">מתכלה</span>` : ""}</h4>
              ${i.status !== "ok" ? `<span class="pill pill--${i.status}">${itemLabel(i)}</span>` : ""}
            </div>
            ${meter(i)}
            <div class="item__nums">
              <span>${i.consumable ? "במלאי" : "זמין"} <b>${i.available}</b></span>
              ${i.consumable ? `<span>נופקו <b>${i.issuedQty}</b></span>` : `<span>אצל חיילים <b>${i.withSoldiers}</b></span>`}
              ${i.faulty ? `<span>תקול <b>${i.faulty}</b></span>` : ""}
              <span>סה״כ <b>${i.total}</b></span>
            </div>
            <div class="item__min ${i.short ? "is-short" : ""}">מינימום נדרש: ${i.min}${i.short ? ` · חסרים ${i.short}` : ""}</div>
            ${i.serial ? `<div class="item__serial">מ. צלם: <span dir="ltr">${esc(i.serial)}</span></div>` : ""}
            ${edit ? `
            <div class="item__actions">
              ${i.available > 0 ? `<button type="button" class="btn btn--primary btn--sm" data-sign="${esc(i.id)}">${i.consumable ? "ניפוק" : "החתמה"}</button>` : ""}
              <button type="button" class="btn btn--ghost btn--sm" data-act="edit-item" data-item="${esc(i.id)}">עריכה</button>
              ${i.withSoldiers ? "" : `<button type="button" class="btn btn--ghost btn--sm" data-act="delete-item" data-item="${esc(i.id)}">מחיקה</button>`}
            </div>` : ""}
          </div>`).join("") || `<p class="muted">אין עדיין פריטים בארגז זה</p>`}
      </div>

      <h3 class="section-title">${icon("users", "alert__icon")} מוחתם אצל חיילים</h3>
      <div class="holders">
        ${holders.length ? holders.map((h, n) => `
          <div class="holder" style="--i:${n}">
            <span class="holder__badge">${icon("users")}</span>
            <div class="holder__body">
              <button type="button" class="holder__name" data-open-soldier="${esc(h.soldierId)}">${esc(h.name)}</button>
              <span class="muted"> · ${esc(teamLabel(h.team))}</span>
              <ul class="holder__list">
                ${h.list.map((x) => `
                  <li>
                    <span>${esc(x.name)} ×${x.qty}</span>
                    ${edit ? `<button type="button" class="btn btn--ghost btn--sm" data-return="${esc(x.itemId)}" data-soldier="${esc(h.soldierId)}">זיכוי</button>` : ""}
                  </li>`).join("")}
              </ul>
            </div>
          </div>`).join("") : `<p class="muted">אין פריטים מארגז זה אצל חיילים</p>`}
      </div>
      ${c.items.some((i) => i.consumable) || c.issues.length ? `
      <h3 class="section-title">ניפוק ציוד מתכלה <span class="muted">· לא מוחזר, לא נרשם על החייל</span></h3>
      ${issues.length ? `
      <ul class="issues">
        ${issues.map((x) => `
          <li class="issues__row">
            <span class="issues__date">${fmtDate(x.issuedAt)}<small>${hebrewDate(x.issuedAt)}</small></span>
            <span class="issues__main"><b>${esc(x.itemName)} ×${x.qty}</b> ←
              ${x.team === null ? esc(x.name) : `<button type="button" class="holder__name" data-open-soldier="${esc(x.soldierId)}">${esc(x.name)}</button>`}
              ${x.team ? `<span class="muted">· ${esc(teamLabel(x.team))}</span>` : ""}
              ${x.note ? `<small class="signed__note">הערה: ${esc(x.note)}</small>` : ""}</span>
            <span class="issues__by">${esc(x.issuedBy)}</span>
          </li>`).join("")}
      </ul>
      ${c.issues.length > issues.length ? `<p class="muted">ועוד ${c.issues.length - issues.length} ניפוקים קודמים (בייצוא ל-Excel)</p>` : ""}`
      : `<p class="muted">עדיין לא נופק ציוד מתכלה מארגז זה</p>`}` : ""}
    </div>`;
  dlg.querySelector(".cd__body").scrollTop = scroll;
}

export function renderAbout(view, user) {
  view.onclick = null;
  view.innerHTML = `
    <article class="about">
      <header class="about__head">
        ${emblem("md")}
        <h1>פלס"ר 6646</h1>
        <p class="about__sub">מערכת ניהול ציוד ומלאי</p>
        <p class="about__motto">"הגב אליך, הלב איתך"</p>
      </header>
      <section class="about__card" style="--i:0">
        <h2>על המערכת</h2>
        <p>המערכת מרכזת את תמונת המצב של ארגזי הציוד ביחידה: מה זמין במחסן, מה נמצא אצל החיילים, היכן יש חוסר או תקלה – במבט אחד, מכל מכשיר.</p>
      </section>
      <section class="about__card" style="--i:1">
        <h2>פרטים</h2>
        <dl>
          <dt>יחידה</dt><dd>פלס"ר 6646</dd>
          <dt>משתמש</dt><dd>${esc(user.name)}${user.email ? ` (${esc(user.email)})` : ""}</dd>
          <dt>אופן התחברות</dt><dd>${user.demo ? "מצב הדגמה" : "Google"}</dd>
          <dt>מקור נתונים</dt><dd>${BACKEND_LABEL[backend] ?? backend}</dd>
          <dt>הרשאה</dt><dd>${ROLE_LABEL[store.role] ?? store.role}</dd>
          <dt>גרסה</dt><dd>0.1.0</dd>
        </dl>
      </section>
    </article>`;
}
