import { holdersOf, STATUS, teamLabel } from "./data/model.js";
import { backend } from "./data/repository.js";
import { openReturnForm, openSignForm } from "./actions.js";
import { bindDialog, closeDialog } from "./dialogs.js";
import { openSoldier } from "./soldiers.js";
import { canEdit, store } from "./state.js";
import { EMBLEM_SRC, esc, icon, reducedMotion } from "./ui.js";

const state = { filter: "all", query: "" };
const BACKEND_LABEL = { local: "מקומי – בדפדפן זה בלבד", sheets: "Google Sheets (משותף)", firestore: "Firestore (משותף)" };
const ROLE_LABEL = { viewer: "צפייה", editor: "עריכה", admin: "מנהל" };

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

const crateCard = (c, i) => `
  <div class="crate crate--${c.status}" role="button" tabindex="0" data-crate="${esc(c.id)}" style="--i:${i}"
       aria-label="ארגז ${esc(c.number)} – ${esc(c.name)}, סטטוס ${STATUS[c.status].label}" aria-haspopup="dialog">
    <div class="crate__lid">
      <span class="crate__stencil">ארגז ${esc(c.number)}</span>
      <span class="pill pill--${c.status}">${STATUS[c.status].label}</span>
    </div>
    <div class="crate__body">
      <div>
        <h3 class="crate__name">${esc(c.name)}</h3>
        <span class="crate__cat">${esc(c.category)} · ${esc(c.location)}</span>
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
    (state.filter === "all" || c.status === state.filter) &&
    (!q || [c.name, c.number, c.category, ...c.items.map((i) => i.name)].some((s) => s.includes(q))));
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
  const kpis = [
    ["ארגזים", crates.length, ""],
    ["סוגי פריטים", total("itemTypes"), ""],
    ["פריטים זמינים", total("available"), "ok"],
    ["אצל חיילים", total("withSoldiers"), ""],
    ["התראות פעילות", alerts.length, alerts.some((a) => a.i.status === "danger") ? "danger" : alerts.length ? "warn" : "ok"],
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

  renderCrates(view.querySelector("#crates"));
  if (animate) countUp(view);
}

export function renderDashboard(view, user) {
  const today = new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  view.innerHTML = `
    <section class="hero">
      ${emblem("sm")}
      <div>
        <h1>שלום, ${esc(user.name)}</h1>
        <p>${esc(today)} · תמונת מצב ציוד ומלאי</p>
      </div>
    </section>

    <div id="dash-live"></div>

    <section aria-labelledby="crates-title">
      <h2 class="section-title" id="crates-title">ארגזי ציוד</h2>
      <div class="toolbar">
        <label class="search">
          ${icon("search")}
          <input type="search" id="crate-search" placeholder="חיפוש ארגז או פריט…" value="${esc(state.query)}" aria-label="חיפוש ארגז או פריט">
        </label>
        <div class="chips" role="group" aria-label="סינון לפי סטטוס">
          ${[["all", "הכל"], ["ok", "תקין"], ["warn", "התראה"], ["danger", "חוסר"]].map(([k, l]) =>
            `<button type="button" class="chip" data-filter="${k}" aria-pressed="${state.filter === k}">${l}</button>`).join("")}
        </div>
      </div>
      <div class="crates" id="crates"></div>
    </section>`;

  const grid = view.querySelector("#crates");
  renderLive(view, true);

  view.querySelector("#crate-search").addEventListener("input", (e) => {
    state.query = e.target.value;
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
  dlg.innerHTML = `
    <header class="cd__head">
      <span class="crate__stencil">ארגז ${esc(c.number)}</span>
      <div class="cd__titles">
        <h2 id="crate-dialog-title">${esc(c.name)}</h2>
        <p>${esc(c.category)} · ${esc(c.location)}</p>
      </div>
      <span class="pill pill--${c.status}">${STATUS[c.status].label}</span>
      <button type="button" class="btn btn--icon" data-close aria-label="סגירה">${icon("close", "btn__icon")}</button>
    </header>
    <div class="cd__body">
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
          <div class="item item--${i.status}" style="--i:${n}">
            <div class="item__top">
              <h4 class="item__name">${esc(i.name)}</h4>
              ${i.status !== "ok" ? `<span class="pill pill--${i.status}">${itemLabel(i)}</span>` : ""}
            </div>
            ${meter(i)}
            <div class="item__nums">
              <span>זמין <b>${i.available}</b></span>
              <span>אצל חיילים <b>${i.withSoldiers}</b></span>
              ${i.faulty ? `<span>תקול <b>${i.faulty}</b></span>` : ""}
              <span>סה״כ <b>${i.total}</b></span>
            </div>
            <div class="item__min ${i.short ? "is-short" : ""}">מינימום נדרש: ${i.min}${i.short ? ` · חסרים ${i.short}` : ""}</div>
            ${edit && i.available > 0 ? `<button type="button" class="btn btn--primary btn--sm item__sign" data-sign="${esc(i.id)}">החתמה</button>` : ""}
          </div>`).join("")}
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
