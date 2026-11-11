import * as repo from "./data/repository.js";
import { compareTeams, teamLabel } from "./data/model.js";
import { openForm } from "./dialogs.js";
import { findItem, store } from "./state.js";
import { esc, icon, toast } from "./ui.js";

export const fmtDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
};

function soldierOptions(selected) {
  const teams = new Map();
  for (const s of store.soldiers) teams.set(s.team, [...(teams.get(s.team) ?? []), s]);
  return [...teams.keys()].sort(compareTeams).map((team) => `
    <optgroup label="${esc(teamLabel(team))}">
      ${teams.get(team).map((s) => `<option value="${esc(s.id)}" ${s.id === selected ? "selected" : ""}>${esc(s.name)}</option>`).join("")}
    </optgroup>`).join("");
}

function itemOptions(selected, consumable = false) {
  return store.crates.map((c) => {
    const items = c.items.filter((i) => i.consumable === consumable && (i.available > 0 || i.id === selected));
    if (!items.length) return "";
    return `<optgroup label="ארגז ${esc(c.number)} – ${esc(c.name)}">
      ${items.map((i) => `<option value="${esc(i.id)}" ${i.id === selected ? "selected" : ""}>${esc(i.name)} (${consumable ? "במלאי" : "זמין"} ${i.available})</option>`).join("")}
    </optgroup>`;
  }).join("");
}

const NO_SOLDIERS = "אין חיילים ברשימה. יש להוסיף או לייבא חיילים במסך \"חיילים\".";

/** ניפוק ציוד מתכלה – recorded on the crate only; nothing is signed to the soldier and nothing comes back. */
export function openIssueForm({ itemId = "", soldierId = "" } = {}) {
  if (!store.soldiers.length) return toast(NO_SOLDIERS);
  openForm({
    title: "ניפוק ציוד מתכלה",
    submit: "ניפוק",
    body: `
      <p class="form__hint">ציוד מתכלה לא נרשם על החייל ולא מוחזר – הניפוק מתועד בארגז בלבד, והכמות יורדת מהמלאי.</p>
      <label class="field"><span>פריט</span>
        <select name="itemId" required><option value="">בחר פריט…</option>${itemOptions(itemId, true)}</select></label>
      <label class="field"><span>למי ניתן</span>
        <select name="soldierId" required><option value="">בחר חייל…</option>${soldierOptions(soldierId)}</select></label>
      <label class="field"><span>כמות</span>
        <input name="qty" type="number" min="1" step="1" value="1" inputmode="numeric" required></label>
      <label class="field"><span>הערה (לא חובה)</span>
        <textarea name="note" class="field__note" rows="2" maxlength="300" placeholder="למשל: לשבוע שטח"></textarea></label>`,
    onSubmit: async (fd) => {
      const item = fd.get("itemId");
      const soldier = fd.get("soldierId");
      if (!item || !soldier) throw new Error("יש לבחור פריט ומקבל");
      const n = await repo.issueItems(soldier, [{ itemId: item, qty: fd.get("qty") }], fd.get("note"));
      return n === 1 ? "נופקה יחידה אחת" : `נופקו ${n} יחידות`;
    },
  });
}

/** החתמת ציוד – optionally pre-selecting the item and/or soldier. */
export function openSignForm({ itemId = "", soldierId = "" } = {}) {
  if (findItem(itemId)?.item.consumable) return openIssueForm({ itemId, soldierId });
  if (!store.soldiers.length) {
    toast(NO_SOLDIERS);
    return;
  }
  const form = openForm({
    title: "החתמת ציוד",
    submit: "החתם",
    body: `
      <label class="field"><span>פריט</span>
        <select name="itemId" required><option value="">בחר פריט…</option>${itemOptions(itemId)}</select></label>
      <label class="field"><span>חייל</span>
        <select name="soldierId" required><option value="">בחר חייל…</option>${soldierOptions(soldierId)}</select></label>
      <label class="field"><span>כמות</span>
        <input name="qty" type="number" min="1" step="1" value="1" inputmode="numeric" required></label>
      ${NOTE_FIELD}
      ${NOTIFY_FIELDS}`,
    onSubmit: async (fd) => {
      const item = fd.get("itemId");
      const soldier = fd.get("soldierId");
      if (!item || !soldier) throw new Error("יש לבחור פריט וחייל");
      const email = notifyTarget(fd);
      const noteText = fd.get("note");
      const carry = previousNoteItems(form, soldier, [item]);
      await repo.signItem(item, soldier, fd.get("qty"), noteText);
      await updatePreviousNote(soldier, carry, noteText);
      const note = email ? await notifySoldier(soldier, email, [{ itemId: item, qty: Number(fd.get("qty")) }], fd.get("note")) : "";
      return `הציוד הוחתם${note}`;
    },
  });
  bindNote(form);
  bindNotify(form);
}

// ---------- Sign-out note (the soldier's previous note is shown and can be edited) ----------

const NOTE_FIELD = `
  <label class="field"><span>הערה (לא חובה)</span>
    <textarea name="note" class="field__note" rows="2" maxlength="300" placeholder="למשל: לתרגיל השבועי, הפנס עם שריטה קלה"></textarea></label>
  <p class="form__hint" data-note-hint hidden>מוצגת ההערה הקודמת של החייל – אפשר לערוך או למחוק אותה. השינוי יחול גם על הפריטים שכבר מוחתמים עם הערה זו.</p>`;

/** The note on this item for the soldier, otherwise the soldier's most recent note. */
function previousNote(soldierId, itemId) {
  const s = store.soldiers.find((x) => x.id === soldierId);
  const withNote = (s?.items ?? []).filter((x) => x.note);
  const same = withNote.find((x) => x.itemId === itemId);
  if (same) return same.note;
  return [...withNote].sort((a, b) => String(b.signedAt).localeCompare(String(a.signedAt)))[0]?.note ?? "";
}

function bindNote(form) {
  const soldier = form.querySelector('[name="soldierId"]');
  const item = form.querySelector('[name="itemId"]');
  const area = form.querySelector('[name="note"]');
  const hint = form.querySelector("[data-note-hint]");
  const fill = () => {
    const prev = previousNote(soldier.value, item?.value);
    area.value = prev;
    area.dataset.prev = prev;
    hint.hidden = !prev;
  };
  soldier.addEventListener("change", fill);
  item?.addEventListener("change", fill);
  fill();
}

/** Items already held with the previous note, when the user edited it (captured before signing changes the store). */
function previousNoteItems(form, soldierId, signedIds) {
  const prev = form.querySelector('[name="note"]').dataset.prev ?? "";
  const next = String(form.querySelector('[name="note"]').value ?? "").trim();
  if (!prev || next === prev) return [];
  const s = store.soldiers.find((x) => x.id === soldierId);
  return (s?.items ?? []).filter((x) => x.note === prev && !signedIds.includes(x.itemId)).map((x) => x.itemId);
}

/** Runs after signing; never throws so the completed sign-out isn't reported as failed. */
async function updatePreviousNote(soldierId, itemIds, note) {
  if (!itemIds.length) return;
  try {
    await repo.setNotes(soldierId, itemIds, note);
  } catch (err) {
    toast(`הציוד הוחתם, אך עדכון ההערה הקודמת נכשל: ${err?.message || "שגיאה לא ידועה"}`, "danger", 8000);
  }
}

// ---------- Email confirmation to the soldier ----------

const NOTIFY_FIELDS = `
  <div class="notify">
    <label class="check"><input type="checkbox" name="notify"> שליחת אישור החתמה במייל לחייל</label>
    <label class="field" data-notify-email hidden><span>מייל החייל</span>
      <input name="email" type="email" dir="ltr" maxlength="120" autocomplete="off" placeholder="name@gmail.com"></label>
    <p class="form__hint" data-notify-hint hidden>הכתובת תישמר בפרטי החייל${repo.serverEmail ? "" : " · ייפתח חלון מייל מוכן לשליחה"}.</p>
  </div>`;

/** Prefills the saved address of the chosen soldier and shows the field only when sending is ticked. */
function bindNotify(form) {
  const select = form.querySelector('[name="soldierId"]');
  const box = form.querySelector('[name="notify"]');
  const email = form.querySelector('[name="email"]');
  const sync = () => {
    form.querySelector("[data-notify-email]").hidden = !box.checked;
    form.querySelector("[data-notify-hint]").hidden = !box.checked;
  };
  const fill = () => {
    const s = store.soldiers.find((x) => x.id === select.value);
    email.value = s?.email ?? "";
    box.checked = Boolean(s?.email);
    sync();
  };
  select.addEventListener("change", fill);
  box.addEventListener("change", () => {
    sync();
    if (box.checked && !email.value) email.focus();
  });
  fill();
}

// Validated before signing, so a bad address never leaves the action half-done.
const notifyTarget = (fd) => (fd.get("notify") === "on" ? repo.assertEmail(fd.get("email")) : null);

/** Runs after a successful sign-out: saves the address on the soldier and sends the confirmation. Never throws. */
async function notifySoldier(soldierId, email, lines, note = "") {
  try {
    await repo.saveSoldierEmail(soldierId, email);
    if (repo.serverEmail) {
      await repo.sendSignEmail(soldierId, lines);
      return ` · נשלח אישור ל-${email}`;
    }
    openMailDraft(soldierId, email, lines, note);
    return " · נפתח מייל אישור לשליחה";
  } catch (err) {
    toast(`הציוד הוחתם, אך שליחת המייל נכשלה: ${err?.message || "שגיאה לא ידועה"}`, "danger", 8000);
    return "";
  }
}

/** Without a mail-capable server: open the user's mail app with a ready message. */
function openMailDraft(soldierId, email, lines, note) {
  const s = store.soldiers.find((x) => x.id === soldierId);
  const list = lines.map((l) => {
    const ref = findItem(l.itemId);
    return ref ? `• ${ref.item.name} ×${l.qty} (ארגז ${ref.crate.number})` : "";
  }).filter(Boolean);
  const body = [
    `שלום ${s?.firstName ?? ""},`, "",
    `ב-${fmtDate(new Date().toISOString())} חתמת על הציוד הבא:`, ...list, "",
    ...(String(note ?? "").trim() ? [`הערה: ${String(note).trim()}`, ""] : []),
    "יש לשמור על הציוד ולהחזירו בתום השימוש.", "",
    'פלס"ר 6646 – מערכת ניהול ציוד ומלאי',
  ].join("\n");
  // The address passed assertEmail, so it contains no characters that need encoding.
  location.href = `mailto:${email}?subject=${encodeURIComponent('פלס"ר 6646 – אישור החתמת ציוד')}&body=${encodeURIComponent(body)}`;
}

/** זיכוי ציוד מחייל. */
export function openReturnForm(itemId, soldierId) {
  const ref = findItem(itemId);
  const holder = ref?.item.holders.find((h) => h.soldierId === soldierId);
  if (!holder) return;
  openForm({
    title: "זיכוי ציוד",
    submit: "זכה",
    body: `
      <p class="form__lead"><b>${esc(holder.name)}</b> מחזיר/ה <b>${esc(ref.item.name)}</b>
        <span class="muted">(ארגז ${esc(ref.crate.number)} · מוחתם: ${holder.qty})</span></p>
      <label class="field"><span>כמות לזיכוי</span>
        <input name="qty" type="number" min="1" max="${holder.qty}" step="1" value="${holder.qty}" inputmode="numeric" required></label>`,
    onSubmit: async (fd) => {
      await repo.returnItem(itemId, soldierId, fd.get("qty"));
      return "הציוד זוכה";
    },
  });
}

const datalist = (id, key) =>
  `<datalist id="${id}">${[...new Set(store.crates.map((c) => c[key]).filter(Boolean))]
    .map((v) => `<option value="${esc(v)}">`).join("")}</datalist>`;

/** הוספת / עריכת ארגז. `onCreated(id)` runs after a new crate is saved. */
export function openCrateForm(crate = null, onCreated) {
  openForm({
    title: crate ? "עריכת ארגז" : "הוספת ארגז",
    submit: crate ? "שמירה" : "הוספה",
    body: `
      <label class="field"><span>מספר ארגז</span>
        <input name="number" required maxlength="20" autocomplete="off" value="${esc(crate?.number ?? "")}"></label>
      <label class="field"><span>שם הארגז</span>
        <input name="name" required maxlength="60" autocomplete="off" value="${esc(crate?.name ?? "")}"></label>
      <label class="field"><span>קטגוריה</span>
        <input name="category" list="crate-categories" maxlength="40" autocomplete="off" value="${esc(crate?.category ?? "")}"></label>
      <label class="field"><span>מיקום</span>
        <input name="location" list="crate-locations" maxlength="40" autocomplete="off" value="${esc(crate?.location ?? "")}"></label>
      ${datalist("crate-categories", "category")}
      ${datalist("crate-locations", "location")}
      <div class="received-fields">
        <label class="field"><span>התקבל מגורם אחר (לא חובה)</span>
          <input name="receivedFrom" maxlength="60" autocomplete="off" placeholder="למשל: גדוד 50, פלוגה ב׳" value="${esc(crate?.receivedFrom ?? "")}"></label>
        <label class="field"><span>להחזיר עד</span>
          <input name="returnBy" type="date" value="${esc(crate?.returnBy ?? "")}"></label>
        <p class="form__hint">למילוי רק כשהציוד בארגז חתום מול גורם אחר וצריך להחזיר אותו. ארגזים כאלה מוצגים בצבע שונה.</p>
      </div>`,
    onSubmit: async (fd) => {
      const id = await repo.saveCrate({
        id: crate?.id, number: fd.get("number"), name: fd.get("name"), category: fd.get("category"), location: fd.get("location"),
        receivedFrom: fd.get("receivedFrom"), returnBy: fd.get("returnBy"),
      });
      if (crate) return "הארגז עודכן";
      onCreated?.(id);
      return "הארגז נוסף";
    },
  });
}

export function openDeleteCrateForm(crate) {
  openForm({
    title: "מחיקת ארגז",
    submit: "מחיקה",
    danger: true,
    body: `<p class="form__lead">למחוק את <b>ארגז ${esc(crate.number)} – ${esc(crate.name)}</b>${crate.items.length ? ` ואת ${crate.items.length} הפריטים שבו` : ""}?</p>`,
    onSubmit: async () => {
      await repo.deleteCrate(crate.id);
      return "הארגז נמחק";
    },
  });
}

/** הוספת פריט לארגז, או עריכת פריט קיים. */
export function openItemForm(crate, item = null) {
  const num = (name, label, value) => `
    <label class="field"><span>${label}</span>
      <input name="${name}" type="number" min="0" step="1" inputmode="numeric" required value="${value}"></label>`;
  openForm({
    title: item ? "עריכת פריט" : `הוספת פריט – ארגז ${crate.number}`,
    submit: item ? "שמירה" : "הוספה",
    body: `
      <label class="field"><span>שם הפריט</span>
        <input name="name" required maxlength="80" autocomplete="off" value="${esc(item?.name ?? "")}"></label>
      <div class="field-row">
        ${num("total", "כמות כוללת", item?.total ?? 1)}
        ${num("faulty", "תקולים", item?.faulty ?? 0)}
        ${num("min", "מינימום נדרש", item?.min ?? 0)}
      </div>
      <label class="field"><span>מ. צלם</span>
        <input name="serial" maxlength="300" autocomplete="off" dir="ltr" placeholder="למשל 1234567, 1234568" value="${esc(item?.serial ?? "")}"></label>
      <p class="form__hint">אפשר לרשום כמה מספרים, מופרדים בפסיק. שדה זה מיועד למספרי ציוד בלבד – אין להזין בו מספר אישי.</p>
      <label class="check"><input type="checkbox" name="consumable" ${item?.consumable ? "checked" : ""} ${item?.withSoldiers && !item.consumable ? "disabled" : ""}>
        ציוד מתכלה – מנופק ולא מוחזר (למשל כלים חד-פעמיים)</label>
      ${item?.withSoldiers ? `<p class="form__hint">מוחתמים כעת אצל חיילים: ${item.withSoldiers}</p>` : ""}
      ${item ? `
      <label class="field"><span>ארגז</span>
        <select name="crateId">${store.crates.map((c) =>
          `<option value="${esc(c.id)}" ${c.id === crate.id ? "selected" : ""}>ארגז ${esc(c.number)} – ${esc(c.name)}</option>`).join("")}</select></label>` : ""}`,
    onSubmit: async (fd) => {
      const data = { name: fd.get("name"), total: fd.get("total"), faulty: fd.get("faulty"), min: fd.get("min"), serial: fd.get("serial") };
      const consumable = fd.get("consumable") === "on";
      if (item) {
        const crateId = fd.get("crateId");
        await repo.updateItem(item.id, { ...data, crateId, ...(consumable !== item.consumable && { consumable }) });
        const target = crateId !== crate.id && store.crates.find((c) => c.id === crateId);
        return target ? `הפריט הועבר לארגז ${target.number}` : "הפריט עודכן";
      }
      await repo.addItem(crate.id, { ...data, consumable });
      return "הפריט נוסף";
    },
  });
}

export function openDeleteItemForm(itemId) {
  const ref = findItem(itemId);
  if (!ref) return;
  openForm({
    title: "מחיקת פריט",
    submit: "מחיקה",
    danger: true,
    body: `<p class="form__lead">למחוק את <b>${esc(ref.item.name)}</b> מארגז ${esc(ref.crate.number)}?</p>`,
    onSubmit: async () => {
      await repo.deleteItem(itemId);
      return "הפריט נמחק";
    },
  });
}

/** החתמת ערכה – pick a soldier and any number of items with quantities. */
export function openKitSignForm({ soldierId = "" } = {}) {
  if (!store.soldiers.length) {
    toast(NO_SOLDIERS);
    return;
  }
  const crates = store.crates
    .map((c) => ({ c, items: c.items.filter((i) => i.available > 0) }))
    .filter((x) => x.items.length);
  if (!crates.length) {
    toast("אין כרגע ציוד זמין להחתמה");
    return;
  }
  const form = openForm({
    title: "החתמת ציוד",
    submit: "החתם",
    wide: true,
    body: `
      <label class="field"><span>חייל</span>
        <select name="soldierId" required><option value="">בחר חייל…</option>${soldierOptions(soldierId)}</select></label>
      <label class="search search--block">
        ${icon("search")}
        <input type="search" data-kit-filter placeholder="סינון פריטים…" aria-label="סינון פריטים"></label>
      <div class="kit">
        ${crates.map(({ c, items }) => `
          <fieldset class="kit__crate">
            <legend>ארגז ${esc(c.number)} – ${esc(c.name)}</legend>
            ${items.map((i) => `
              <label class="kit__row" data-name="${esc(i.name)}">
                <span class="kit__name">${esc(i.name)}${i.consumable ? ` <span class="tag">מתכלה</span>` : ""} <small class="muted">זמין ${i.available}</small></span>
                <input type="number" name="qty:${esc(i.id)}" min="0" max="${i.available}" step="1" value="" placeholder="0" inputmode="numeric" aria-label="כמות – ${esc(i.name)}">
              </label>`).join("")}
          </fieldset>`).join("")}
      </div>
      ${crates.some(({ items }) => items.some((i) => i.consumable))
        ? `<p class="form__hint">פריטים שמסומנים "מתכלה" מנופקים ולא מוחתמים – הם נרשמים בארגז בלבד ולא על החייל.</p>` : ""}
      <p class="form__hint" data-kit-summary aria-live="polite">לא נבחרו פריטים</p>
      ${NOTE_FIELD}
      ${NOTIFY_FIELDS}`,
    onSubmit: async (fd) => {
      const soldier = fd.get("soldierId");
      if (!soldier) throw new Error("יש לבחור חייל");
      const email = notifyTarget(fd);
      const lines = [...fd.entries()]
        .filter(([k, v]) => k.startsWith("qty:") && Number(v) > 0)
        .map(([k, v]) => ({ itemId: k.slice(4), qty: v }));
      const consumable = (l) => findItem(l.itemId)?.item.consumable;
      const signLines = lines.filter((l) => !consumable(l));
      const issueLines = lines.filter(consumable);
      if (!lines.length) throw new Error("לא נבחרו פריטים");
      // Check the consumables first, so a bad line doesn't leave the sign-out half done.
      if (issueLines.length) repo.checkIssue(soldier, issueLines);
      const noteText = fd.get("note");
      const done = [];
      if (signLines.length) {
        const carry = previousNoteItems(form, soldier, signLines.map((l) => l.itemId));
        const n = await repo.signItems(soldier, signLines, noteText);
        await updatePreviousNote(soldier, carry, noteText);
        done.push(n === 1 ? "פריט אחד הוחתם" : `הוחתמו ${n} פריטים`);
      }
      if (issueLines.length) {
        const n = await repo.issueItems(soldier, issueLines, noteText);
        done.push(`נופקו ${n} יחידות מתכלות`);
      }
      const note = email && signLines.length ? await notifySoldier(soldier, email, signLines, fd.get("note")) : "";
      return `${done.join(" · ")}${note}`;
    },
  });
  bindNote(form);
  bindNotify(form);

  const summary = form.querySelector("[data-kit-summary]");
  form.querySelector(".kit").addEventListener("input", () => {
    const picked = [...form.querySelectorAll(".kit input")].filter((el) => Number(el.value) > 0);
    const total = picked.reduce((s, el) => s + Number(el.value), 0);
    form.querySelectorAll(".kit__row").forEach((row) => row.classList.toggle("is-picked", Number(row.querySelector("input").value) > 0));
    summary.textContent = picked.length ? `נבחרו ${picked.length} סוגי פריטים · ${total} יחידות` : "לא נבחרו פריטים";
  });
  form.querySelector("[data-kit-filter]").addEventListener("input", (e) => {
    const q = e.target.value.trim();
    form.querySelectorAll(".kit__crate").forEach((set) => {
      let shown = 0;
      set.querySelectorAll(".kit__row").forEach((row) => {
        const match = !q || row.dataset.name.includes(q) || set.querySelector("legend").textContent.includes(q);
        row.hidden = !match;
        shown += match;
      });
      set.hidden = !shown;
    });
  });
}

/** ספירת מלאי לכל הארגזים בזה אחר זה, לפי מספר ארגז. */
export function openCountSequence() {
  const ids = store.crates.map((c) => c.id);
  if (!ids.length) return toast("אין ארגזים לספירה");
  openCountForm(store.crates[0], { queue: ids.slice(1), total: ids.length });
}

/** ספירת מלאי לארגז אחד. `queue` holds the crates still to count in a sequence. */
export function openCountForm(crate, { queue = [], total = 1 } = {}) {
  const position = total - queue.length;
  const qtyInput = (name, value, label) =>
    `<input type="number" name="${name}" min="0" step="1" inputmode="numeric" required value="${value}" data-expected="${value}" aria-label="${label}">`;
  const form = openForm({
    title: `ספירת מלאי – ארגז ${crate.number}${total > 1 ? ` (${position} מתוך ${total})` : ""}`,
    submit: queue.length ? "שמירה והמשך" : "שמירת הספירה",
    wide: true,
    body: `
      <p class="form__lead"><b>${esc(crate.name)}</b> – ספרו את מה שנמצא פיזית בארגז (ללא ציוד שמוחתם אצל חיילים).</p>
      ${crate.lastCountAt ? `<p class="form__hint">ספירה קודמת: ${fmtDate(crate.lastCountAt)}${crate.lastCountBy ? ` · ע״י ${esc(crate.lastCountBy)}` : ""}</p>` : ""}
      ${crate.items.length ? `
      <div class="count" role="table" aria-label="ספירת פריטים">
        <div class="count__row count__row--head" role="row">
          <span role="columnheader">פריט</span><span role="columnheader">צפוי</span>
          <span role="columnheader">תקין בארגז</span><span role="columnheader">תקול בארגז</span>
        </div>
        ${crate.items.map((i) => `
        <div class="count__row" role="row">
          <span class="count__name" role="cell">${esc(i.name)}${i.withSoldiers ? `<small class="muted">אצל חיילים: ${i.withSoldiers}</small>` : ""}</span>
          <span class="count__exp" role="cell">${i.available}${i.faulty ? ` + ${i.faulty} תקול` : ""}</span>
          <span role="cell">${qtyInput(`good:${esc(i.id)}`, i.available, `תקין – ${esc(i.name)}`)}</span>
          <span role="cell">${qtyInput(`faulty:${esc(i.id)}`, i.faulty, `תקול – ${esc(i.name)}`)}</span>
        </div>`).join("")}
      </div>
      <label class="check"><input type="checkbox" name="apply" checked> עדכון הכמויות במערכת לפי הספירה</label>
      <p class="form__hint" data-count-summary aria-live="polite">אין פערים</p>` : `<p class="muted">אין פריטים בארגז זה – יירשם רק תאריך הספירה.</p>`}`,
    onSubmit: async (fd) => {
      const counts = crate.items.map((i) => ({ itemId: i.id, good: fd.get(`good:${i.id}`), faulty: fd.get(`faulty:${i.id}`) }));
      const apply = fd.get("apply") === "on";
      const gaps = await repo.recordCount(crate.id, counts, apply);
      if (queue.length) {
        const [nextId, ...rest] = queue;
        form.closest("dialog").addEventListener("close", () => {
          const next = store.crates.find((c) => c.id === nextId);
          if (next) openCountForm(next, { queue: rest, total });
        }, { once: true });
      }
      if (!gaps.length) return `ספירת ארגז ${crate.number} נשמרה – ללא פערים`;
      return `ספירת ארגז ${crate.number} נשמרה – פערים ב-${gaps.length} פריטים${apply ? " (הכמויות עודכנו)" : ""}`;
    },
  });

  const summary = form.querySelector("[data-count-summary]");
  form.querySelector(".count")?.addEventListener("input", () => {
    let gaps = 0;
    form.querySelectorAll(".count__row:not(.count__row--head)").forEach((row) => {
      const gap = [...row.querySelectorAll("input")].some((el) => el.value !== el.dataset.expected);
      row.classList.toggle("is-gap", gap);
      gaps += gap;
    });
    summary.textContent = gaps ? `פערים ב-${gaps} פריטים` : "אין פערים";
  });
}
