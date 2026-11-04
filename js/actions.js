import * as repo from "./data/repository.js";
import { compareTeams, teamLabel } from "./data/model.js";
import { openForm } from "./dialogs.js";
import { findItem, store } from "./state.js";
import { esc, toast } from "./ui.js";

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

function itemOptions(selected) {
  return store.crates.map((c) => {
    const items = c.items.filter((i) => i.available > 0 || i.id === selected);
    if (!items.length) return "";
    return `<optgroup label="ארגז ${esc(c.number)} – ${esc(c.name)}">
      ${items.map((i) => `<option value="${esc(i.id)}" ${i.id === selected ? "selected" : ""}>${esc(i.name)} (זמין ${i.available})</option>`).join("")}
    </optgroup>`;
  }).join("");
}

/** החתמת ציוד – optionally pre-selecting the item and/or soldier. */
export function openSignForm({ itemId = "", soldierId = "" } = {}) {
  if (!store.soldiers.length) {
    toast("אין חיילים ברשימה. יש להוסיף או לייבא חיילים במסך \"חיילים\".");
    return;
  }
  openForm({
    title: "החתמת ציוד",
    submit: "החתם",
    body: `
      <label class="field"><span>פריט</span>
        <select name="itemId" required><option value="">בחר פריט…</option>${itemOptions(itemId)}</select></label>
      <label class="field"><span>חייל</span>
        <select name="soldierId" required><option value="">בחר חייל…</option>${soldierOptions(soldierId)}</select></label>
      <label class="field"><span>כמות</span>
        <input name="qty" type="number" min="1" step="1" value="1" inputmode="numeric" required></label>`,
    onSubmit: async (fd) => {
      const item = fd.get("itemId");
      const soldier = fd.get("soldierId");
      if (!item || !soldier) throw new Error("יש לבחור פריט וחייל");
      await repo.signItem(item, soldier, fd.get("qty"));
      return "הציוד הוחתם";
    },
  });
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
