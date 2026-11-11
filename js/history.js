import * as repo from "./data/repository.js";
import { fullName, ROLE_LABEL } from "./data/model.js";
import { store } from "./state.js";
import { esc, hebrewDate, icon } from "./ui.js";

const LIMIT = 300;
const KINDS = [
  ["all", "הכל"],
  ["sign", "החתמות, זיכויים וניפוקים"],
  ["equipment", "ציוד וספירות"],
  ["soldiers", "חיילים"],
  ["users", "משתמשים"],
];
const state = { query: "", kind: "all", entries: null, error: "" };

// ---------- Turning log entries into readable lines ----------

function names() {
  const items = new Map();
  const crates = new Map();
  for (const c of store.crates) {
    crates.set(c.id, c);
    for (const i of c.items) items.set(i.id, i.name);
  }
  const soldiers = new Map(store.soldiers.map((s) => [s.id, s.name]));
  return {
    item: (id, fallback) => items.get(id) ?? fallback ?? "פריט שנמחק",
    soldier: (id, fallback) => soldiers.get(id) ?? fallback ?? "חייל שנמחק",
    crate: (id) => (crates.has(id) ? `ארגז ${crates.get(id).number}` : "ארגז שנמחק"),
  };
}

function describe(e, n) {
  const d = e.details ?? {};
  const note = d.note ? ` · הערה: ${d.note}` : "";
  switch (e.action) {
    case "adjustAssignment": {
      const qty = Math.abs(Number(d.delta) || 0);
      return d.delta > 0
        ? { kind: "sign", text: `החתמה: ${n.item(d.itemId)} ×${qty} ← ${n.soldier(d.soldierId)}${note}` }
        : { kind: "sign", text: `זיכוי: ${n.item(d.itemId)} ×${qty} מ${n.soldier(d.soldierId)}` };
    }
    case "adjustAssignments": {
      const list = (d.changes ?? []).map((c) => `${n.item(c.itemId)} ×${c.delta}`).join(", ");
      return { kind: "sign", text: `החתמת ערכה ל${n.soldier(d.changes?.[0]?.soldierId)}: ${list}${note}` };
    }
    case "issueItems": {
      const list = (d.issues ?? []).map((x) => `${n.item(x.itemId)} ×${x.qty}`).join(", ");
      return { kind: "sign", text: `ניפוק מתכלה ל${n.soldier(d.issues?.[0]?.soldierId)}: ${list}${note}` };
    }
    case "setNotes":
      return { kind: "sign", text: `עדכון הערה של ${n.soldier(d.soldierId)} (${(d.itemIds ?? []).length} פריטים): ${d.note || "ההערה נמחקה"}` };
    case "upsertSoldiers": {
      const list = d.soldiers ?? [];
      return list.length === 1
        ? { kind: "soldiers", text: `שמירת פרטי חייל: ${fullName(list[0])}` }
        : { kind: "soldiers", text: `ייבוא ${list.length} חיילים` };
    }
    case "deleteSoldier": return { kind: "soldiers", text: `מחיקת חייל: ${n.soldier(d.id, d.name)}` };
    case "upsertCrate": return {
      kind: "equipment",
      text: `שמירת ארגז ${d.crate?.number ?? ""} – ${d.crate?.name ?? ""}${d.crate?.receivedFrom ? ` (התקבל מ${d.crate.receivedFrom})` : ""}`,
    };
    case "deleteCrate": return { kind: "equipment", text: `מחיקת ${d.name ?? "ארגז"}` };
    case "addItem": return { kind: "equipment", text: `הוספת פריט${d.item?.consumable ? " מתכלה" : ""}: ${d.item?.name ?? ""} (${d.item?.total ?? 0}) ל${n.crate(d.item?.crateId)}` };
    case "deleteItem": return { kind: "equipment", text: `מחיקת פריט: ${d.name ?? n.item(d.id)}` };
    case "updateItem": {
      const p = d.patch ?? {};
      const parts = [
        "total" in p && `סה״כ ${p.total}`,
        "faulty" in p && `תקולים ${p.faulty}`,
        "min" in p && `מינימום ${p.min}`,
        p.crateId && `הועבר ל${n.crate(p.crateId)}`,
        "serial" in p && `מ. צלם ${p.serial || "—"}`,
        "consumable" in p && (p.consumable ? "הוגדר כמתכלה" : "בוטל סימון מתכלה"),
      ].filter(Boolean);
      return { kind: "equipment", text: `עדכון פריט: ${p.name ?? n.item(d.id)}${parts.length ? ` (${parts.join(", ")})` : ""}` };
    }
    case "recordCount": {
      const gaps = (d.items ?? []).filter((i) => i.good !== i.expectedGood || i.faulty !== i.expectedFaulty);
      const detail = gaps.map((i) => `${n.item(i.id)}: נספרו ${i.good} מתוך ${i.expectedGood}`).join(", ");
      return {
        kind: "equipment",
        text: `ספירת מלאי – ${n.crate(d.crateId)}: ${gaps.length ? `פערים ב-${gaps.length} פריטים (${detail})` : "ללא פערים"}${gaps.length && d.apply ? " · הכמויות עודכנו" : ""}`,
      };
    }
    case "saveUser": return { kind: "users", text: `הרשאה: ${d.email} ← ${ROLE_LABEL[d.role] ?? d.role}` };
    case "sendSignEmail": return { kind: "sign", text: `נשלח מייל אישור החתמה ל${n.soldier(d.soldierId)}` };
    case "deleteUser": return { kind: "users", text: `הסרת משתמש: ${d.email}` };
    case "replaceAll": return { kind: "equipment", text: "החלפת כל הנתונים (ייבוא מלא)" };
    default: return { kind: "other", text: e.action };
  }
}

const day = (iso) =>
  `${new Date(iso).toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${hebrewDate(iso)}`;
const time = (iso) => new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });

// ---------- Screen ----------

export function renderHistory(view) {
  view.innerHTML = `
    <section class="page-head">
      <div>
        <h1>היסטוריית פעולות</h1>
        <p class="muted">מי החתים, זיכה או עדכן – ומתי (${LIMIT} הפעולות האחרונות)</p>
      </div>
      <div class="page-actions"><button type="button" class="btn btn--ghost btn--sm" data-act="reload">רענון</button></div>
    </section>
    <div class="toolbar">
      <label class="search">
        ${icon("search")}
        <input type="search" id="hist-search" placeholder="חיפוש חייל, פריט או משתמש…" value="${esc(state.query)}" aria-label="חיפוש בהיסטוריה">
      </label>
      <div class="chips" role="group" aria-label="סינון לפי סוג פעולה">
        ${KINDS.map(([k, l]) => `<button type="button" class="chip" data-kind="${k}" aria-pressed="${state.kind === k}">${l}</button>`).join("")}
      </div>
    </div>
    <div id="hist-list"></div>`;

  view.querySelector("#hist-search").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderList(view);
  });
  view.onclick = (e) => {
    if (e.target.closest('[data-act="reload"]')) return load(view);
    const chip = e.target.closest("[data-kind]");
    if (!chip) return;
    state.kind = chip.dataset.kind;
    view.querySelectorAll("[data-kind]").forEach((b) => b.setAttribute("aria-pressed", String(b === chip)));
    renderList(view);
  };
  load(view);
}

/** Re-resolve names when data changes (e.g. the snapshot arrived after the history). */
export function refreshHistory(view) {
  if (view.querySelector("#hist-list") && state.entries) renderList(view);
}

async function load(view) {
  state.entries = null;
  state.error = "";
  renderList(view);
  try {
    state.entries = await repo.getHistory(LIMIT);
  } catch (err) {
    state.error = err?.message || "טעינת ההיסטוריה נכשלה";
  }
  if (view.querySelector("#hist-list")) renderList(view);
}

function renderList(view) {
  const el = view.querySelector("#hist-list");
  if (state.error) {
    el.innerHTML = `<p class="empty">${esc(state.error)}</p>`;
    return;
  }
  if (!state.entries) {
    el.innerHTML = `<p class="empty">טוען היסטוריה…</p>`;
    return;
  }
  const n = names();
  const q = state.query.trim();
  const rows = state.entries
    .map((e) => ({ ...e, by: String(e.by ?? ""), ...describe(e, n) }))
    .filter((r) => (state.kind === "all" || r.kind === state.kind) && (!q || r.text.includes(q) || r.by.includes(q)));
  if (!rows.length) {
    el.innerHTML = `<p class="empty">${state.entries.length ? "לא נמצאו פעולות מתאימות" : "עדיין לא נרשמו פעולות"}</p>`;
    return;
  }
  const groups = new Map();
  for (const r of rows) {
    const key = day(r.at);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  el.innerHTML = [...groups].map(([label, list]) => `
    <section class="hist-day">
      <h2 class="section-title">${esc(label)}</h2>
      <ol class="hist">
        ${list.map((r) => `
          <li class="hist__row hist__row--${r.kind}">
            <time class="hist__time" datetime="${esc(r.at)}">${time(r.at)}</time>
            <span class="hist__text">${esc(r.text)}</span>
            <span class="hist__by">${esc(r.by)}</span>
          </li>`).join("")}
      </ol>
    </section>`).join("");
}
