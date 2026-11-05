import { STATUS, teamLabel } from "./data/model.js";
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
  const rows = [["מספר ארגז", "שם ארגז", "קטגוריה", "מיקום", "פריט", "מ. צלם", "סה״כ", "זמין", "אצל חיילים", "תקול", "מינימום", "חסרים", "סטטוס", "ספירה אחרונה", "נספר ע״י"]];
  for (const c of store.crates) {
    const base = [c.number, c.name, c.category, c.location];
    const counted = [c.lastCountAt ? fmtDate(c.lastCountAt) : "", c.lastCountBy];
    if (!c.items.length) rows.push([...base, "", "", "", "", "", "", "", "", "", ...counted]);
    for (const i of c.items) {
      rows.push([...base, i.name, i.serial, i.total, i.available, i.withSoldiers, i.faulty, i.min, i.short, STATUS[i.status].label, ...counted]);
    }
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
      </fieldset>`,
    onSubmit: async (fd) => {
      if (fd.get("kind") === "assignments") {
        const rows = assignmentRows();
        if (rows.length === 1) throw new Error("אין כרגע ציוד מוחתם");
        downloadCsv(`palsar-assignments-${stamp()}.csv`, rows);
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
