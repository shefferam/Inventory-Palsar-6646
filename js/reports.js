import { compareTeams, STATUS, teamLabel } from "./data/model.js";
import { fmtDate } from "./actions.js";
import { openForm } from "./dialogs.js";
import { store } from "./state.js";
import { EMBLEM_SRC, esc } from "./ui.js";

// ---------- CSV export (opens in Excel) ----------

function csvCell(v) {
  let s = String(v ?? "");
  // Neutralise spreadsheet formulas (CSV injection).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(name, rows) {
  // BOM so Excel detects UTF-8 (Hebrew).
  const text = "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

function inventoryRows() {
  const rows = [["מספר ארגז", "שם ארגז", "קטגוריה", "מיקום", "התקבל מ", "להחזיר עד", "פריט", "מתכלה", "מ. צלם", "סה״כ", "זמין", "אצל חיילים", "נופקו", "תקול", "מינימום", "חסרים", "סטטוס", "ספירה אחרונה", "נספר ע״י"]];
  for (const c of store.crates) {
    const base = [c.number, c.name, c.category, c.location, c.receivedFrom, c.returnBy ? fmtDate(c.returnBy) : ""];
    const counted = [c.lastCountAt ? fmtDate(c.lastCountAt) : "", c.lastCountBy];
    if (!c.items.length) rows.push([...base, "", "", "", "", "", "", "", "", "", "", "", ...counted]);
    for (const i of c.items) {
      rows.push([...base, i.name, i.consumable ? "כן" : "", i.serial, i.total, i.available, i.withSoldiers, i.issuedQty, i.faulty, i.min, i.short, STATUS[i.status].label, ...counted]);
    }
  }
  return rows;
}

function issueRows() {
  const rows = [["תאריך", "ארגז", "פריט", "כמות", "ניתן ל", "צוות", "נופק ע״י", "הערה"]];
  for (const x of store.issues) {
    rows.push([fmtDate(x.issuedAt), x.crateNumber, x.itemName, x.qty, x.name, x.team === null ? "" : teamLabel(x.team), x.issuedBy, x.note]);
  }
  return rows;
}

/** Per team: soldiers, how many are signed, and the totals of every item signed (plus consumables handed out). */
export function teamSummary() {
  const teams = new Map();
  const teamOf = (key) => {
    if (!teams.has(key)) teams.set(key, { team: key, soldiers: 0, signed: 0, qty: 0, items: new Map(), issued: new Map() });
    return teams.get(key);
  };
  for (const s of store.soldiers) {
    const t = teamOf(s.team);
    t.soldiers++;
    if (s.signedQty) t.signed++;
    t.qty += s.signedQty;
    for (const x of s.items) {
      const row = t.items.get(x.itemId) ?? { name: x.name, crate: x.crateNumber, qty: 0, holders: 0 };
      row.qty += x.qty;
      row.holders++;
      t.items.set(x.itemId, row);
    }
  }
  for (const x of store.issues) {
    if (x.team === null || !teams.has(x.team)) continue;
    const t = teams.get(x.team);
    const row = t.issued.get(x.itemId) ?? { name: x.itemName, crate: x.crateNumber, qty: 0 };
    row.qty += x.qty;
    t.issued.set(x.itemId, row);
  }
  const byName = (a, b) => a.name.localeCompare(b.name, "he");
  return [...teams.values()]
    .sort((a, b) => compareTeams(a.team, b.team))
    .map((t) => ({ ...t, items: [...t.items.values()].sort(byName), issued: [...t.issued.values()].sort(byName) }));
}

function teamRows() {
  const rows = [["צוות", "פריט", "ארגז", "כמות מוחתמת", "מספר חיילים", "נופק (מתכלה)"]];
  for (const t of teamSummary()) {
    for (const r of t.items) rows.push([teamLabel(t.team), r.name, r.crate, r.qty, r.holders, ""]);
    for (const r of t.issued) rows.push([teamLabel(t.team), r.name, r.crate, "", "", r.qty]);
  }
  return rows;
}

function assignmentRows() {
  const rows = [["צוות", "חייל", "פריט", "ארגז", "כמות", "תאריך החתמה", "הוחתם ע״י", "הערה"]];
  for (const s of store.soldiers) {
    for (const x of s.items) {
      rows.push([teamLabel(s.team), s.name, x.name, `${x.crateNumber} – ${x.crateName}`, x.qty, x.signedAt ? fmtDate(x.signedAt) : "", x.signedBy, x.note]);
    }
  }
  return rows;
}

export function openExportForm() {
  openForm({
    title: "ייצוא ל-Excel",
    submit: "הורדה",
    body: `
      <fieldset class="choices">
        <legend class="form__lead">בחרו את הדוח להורדה (קובץ CSV שנפתח ב-Excel):</legend>
        <label class="choice"><input type="radio" name="kind" value="inventory" checked>
          <span><b>מצב מלאי</b><small>כל הפריטים לפי ארגז – כמויות, תקולים, חוסרים וספירה אחרונה</small></span></label>
        <label class="choice"><input type="radio" name="kind" value="assignments">
          <span><b>החתמות</b><small>כל הציוד המוחתם, לפי חייל וצוות</small></span></label>
        <label class="choice"><input type="radio" name="kind" value="teams">
          <span><b>סיכום החתמות לפי צוות</b><small>כמה מכל פריט מוחתם בכל צוות</small></span></label>
        <label class="choice"><input type="radio" name="kind" value="issues">
          <span><b>ניפוק ציוד מתכלה</b><small>מה נופק, למי, כמה ומתי</small></span></label>
      </fieldset>`,
    onSubmit: async (fd) => {
      const kind = fd.get("kind");
      if (kind === "assignments") {
        const rows = assignmentRows();
        if (rows.length === 1) throw new Error("אין כרגע ציוד מוחתם");
        downloadCsv(`palsar-assignments-${stamp()}.csv`, rows);
      } else if (kind === "teams") {
        downloadCsv(`palsar-teams-${stamp()}.csv`, teamRows());
      } else if (kind === "issues") {
        const rows = issueRows();
        if (rows.length === 1) throw new Error("עדיין לא נופק ציוד מתכלה");
        downloadCsv(`palsar-consumables-${stamp()}.csv`, rows);
      } else {
        downloadCsv(`palsar-inventory-${stamp()}.csv`, inventoryRows());
      }
      return "הקובץ הורד";
    },
  });
}

// ---------- Printable sign-out form ----------

/** Renders a signature form for one soldier into #print-area and opens the print dialog (or "Save as PDF"). */
export async function printSoldierForm(soldierId) {
  const s = store.soldiers.find((x) => x.id === soldierId);
  if (!s) return;
  const now = new Date();
  const el = document.getElementById("print-area");
  el.innerHTML = `
    <article class="sheet">
      <header class="sheet__head">
        <img class="sheet__logo" src="${EMBLEM_SRC}" alt="">
        <div class="sheet__title">
          <h1>טופס החתמת ציוד</h1>
          <p>פלס"ר 6646 · מערכת ניהול ציוד ומלאי</p>
        </div>
        <p class="sheet__date">תאריך: ${fmtDate(now.toISOString())}</p>
      </header>

      <dl class="sheet__who">
        <div><dt>שם החייל</dt><dd>${esc(s.name)}</dd></div>
        <div><dt>צוות</dt><dd>${esc(teamLabel(s.team))}</dd></div>
        <div><dt>סה״כ פריטים</dt><dd>${s.signedQty}</dd></div>
      </dl>

      ${s.items.length ? `
      <table class="sheet__table">
        <thead><tr><th>#</th><th>פריט</th><th>מ. צלם</th><th>ארגז</th><th>כמות</th><th>תאריך החתמה</th><th>הוחתם ע״י</th><th>הערה</th></tr></thead>
        <tbody>
          ${s.items.map((x, n) => `
          <tr>
            <td>${n + 1}</td>
            <td>${esc(x.name)}</td>
            <td dir="ltr">${esc(x.serial ?? "")}</td>
            <td>${esc(x.crateNumber)} – ${esc(x.crateName)}</td>
            <td>${x.qty}</td>
            <td>${x.signedAt ? fmtDate(x.signedAt) : ""}</td>
            <td>${esc(x.signedBy)}</td>
            <td>${esc(x.note ?? "")}</td>
          </tr>`).join("")}
        </tbody>
      </table>` : `<p class="sheet__empty">לא מוחתם על ציוד.</p>`}

      <p class="sheet__declare">אני מאשר/ת כי קיבלתי את הציוד המפורט לעיל, בדקתי את תקינותו, ואני אחראי/ת לשמירתו ולהחזרתו.</p>

      <div class="sheet__signs">
        <div><span>חתימת החייל</span><i></i></div>
        <div><span>שם המחתים</span><i></i></div>
        <div><span>חתימת המחתים</span><i></i></div>
        <div><span>תאריך</span><i></i></div>
      </div>

      <footer class="sheet__foot">הופק ב-${now.toLocaleString("he-IL")}</footer>
    </article>`;
  await el.querySelector(".sheet__logo").decode().catch(() => {});
  window.addEventListener("afterprint", () => el.replaceChildren(), { once: true });
  window.print();
}
