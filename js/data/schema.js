// Backend-neutral schema. Mirrors 1:1 to Google Sheets tabs, Firestore collections or SQL tables:
//   crates      { id, number, name, category, location }
//   items       { id, crateId, name, total, faulty, min }
//   soldiers    { id, firstName, lastName, team }                 – no personal numbers, by design
//   assignments { id, itemId, soldierId, qty, signedAt, signedBy } – equipment signed to a soldier
// Only whitelisted fields pass in either direction, so extra personal data stored in a
// central DB never reaches the UI.

const FIELDS = {
  crates: { id: "id", number: "text", name: "text", category: "text", location: "text" },
  items: { id: "id", crateId: "id", name: "text", total: "qty", faulty: "qty", min: "qty" },
  soldiers: { id: "id", firstName: "text", lastName: "text", team: "text" },
  assignments: { id: "id", itemId: "id", soldierId: "id", qty: "qty", signedAt: "text", signedBy: "text" },
};

// IDF personal numbers are 7 digits; block any long digit run in free text.
const PERSONAL_ID = /\d{6,}/;
const PERSONAL_ID_CELL = /^\d{6,}$/;

export class ValidationError extends Error {}

const toQty = (v) => Math.max(0, Math.floor(Number(v) || 0));
const redact = (s) => s.replace(new RegExp(PERSONAL_ID, "g"), "•••");

function cleanRecord(kind, rec) {
  const out = {};
  for (const [field, type] of Object.entries(FIELDS[kind])) {
    const v = rec?.[field];
    out[field] = type === "qty" ? toQty(v) : type === "text" ? redact(String(v ?? "").trim()) : String(v ?? "");
  }
  return out;
}

/** Normalises a raw snapshot from any adapter. */
export function sanitizeSnapshot(raw) {
  return Object.fromEntries(
    Object.keys(FIELDS).map((kind) => [kind, (raw?.[kind] ?? []).map((r) => cleanRecord(kind, r))]),
  );
}

export function assertSafeText(value, label = "שדה", { optional = false } = {}) {
  const s = String(value ?? "").trim();
  if (!s && !optional) throw new ValidationError(`${label} – שדה חובה`);
  if (s.length > 120) throw new ValidationError(`${label} ארוך מדי`);
  if (PERSONAL_ID.test(s)) throw new ValidationError("אין להזין מספרים אישיים במערכת");
  return s;
}

export function assertQty(value, label = "כמות") {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new ValidationError(`${label} חייבת להיות מספר שלם אי-שלילי`);
  return n;
}

/** Validates that a snapshot contains no personal numbers before it is written anywhere. */
export function assertSnapshotSafe(raw) {
  for (const [kind, fields] of Object.entries(FIELDS)) {
    for (const rec of raw?.[kind] ?? []) {
      for (const [field, type] of Object.entries(fields)) {
        if (type === "text" && PERSONAL_ID.test(String(rec[field] ?? ""))) {
          throw new ValidationError(`נמצא מספר אישי בנתונים (${kind}.${field}) – הייבוא בוטל`);
        }
      }
    }
  }
}

/**
 * Parses rows pasted from Excel (tab-separated) or CSV: team, [personal no.], first name, last name.
 * Personal-number cells are dropped here, before anything is stored or sent.
 */
export function parseSoldierRows(text) {
  const rows = [];
  let removedIds = 0;
  let skipped = 0;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const raw = line.split(line.includes("\t") ? "\t" : ",").map((c) => c.trim());
    removedIds += raw.filter((c) => PERSONAL_ID_CELL.test(c)).length;
    const cells = raw.filter((c) => c && !PERSONAL_ID_CELL.test(c));
    if (cells[0] === "צוות" || cells.includes("שם פרטי")) continue; // header row
    if (cells.length < 2 || cells.some((c) => PERSONAL_ID.test(c))) { skipped++; continue; }
    const [team, firstName, ...rest] = cells.length === 2 ? ["", ...cells] : cells;
    rows.push({ team, firstName, lastName: rest.join(" ") });
  }
  return { rows, removedIds, skipped };
}

export const assignmentId = (itemId, soldierId) => `${itemId}__${soldierId}`;
export const newId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
