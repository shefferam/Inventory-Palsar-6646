// The only data entry point for the UI. Screens never talk to a storage backend directly.
//
// Adapter contract (local / sheets / firestore / any future central-DB adapter):
//   name: string
//   getSnapshot(): Promise<{ crates, items, soldiers, assignments }>
//   subscribe(onData, onError): () => void                 // emits full snapshot (+ me: { role })
//   adjustAssignment(itemId, soldierId, delta, meta)      // + sign out / − return, meta = { at, by, note }
//   adjustAssignments(changes, meta)                       // several { itemId, soldierId, delta } at once
//   setNotes(soldierId, itemIds, note)                     // edit the note on items the soldier already holds
//   upsertSoldiers(list), deleteSoldier(id, label)
//   upsertCrate(crate), deleteCrate(id, label)             // deleteCrate also removes the crate's items
//   addItem(item), updateItem(itemId, patch), deleteItem(id, label)
//   recordCount({ crateId, apply, items }, meta)           // stocktake
//   replaceAll(snapshot)                                   // migration between backends
// Optional: getHistory(limit), appendLog(entry) (backends without a server-side log),
//           listUsers(), saveUser(email, role), deleteUser(email) (backends with a users list),
//           sendSignEmail(soldierId, [{ itemId, qty }]) (backends that can send mail)

import { DATA_BACKEND } from "../config.js";
import { buildView, fullName, ROLES } from "./model.js";
import {
  assertEmail, assertQty, assertSafeText, assertSerial, assertSnapshotSafe, newId, sanitizeSnapshot, ValidationError,
} from "./schema.js";

const ADAPTERS = {
  local: () => import("./local-adapter.js"),
  sheets: () => import("./sheets-adapter.js"),
  firestore: () => import("./firestore-adapter.js"),
};
const CACHE_KEY = "palsar.cache.v1";

export const backend = DATA_BACKEND;
export const usersSupported = backend === "sheets";
/** The Sheets server sends mail itself; other backends open the user's mail app instead. */
export const serverEmail = backend === "sheets";
export { assertEmail, ValidationError };

let adapterPromise = null;
let current = null; // last sanitized snapshot, used for validation before writes
let actor = "";
let actorName = "";

function adapter() {
  const load = ADAPTERS[DATA_BACKEND];
  if (!load) return Promise.reject(new Error(`Unknown DATA_BACKEND: ${DATA_BACKEND}`));
  adapterPromise ??= load().then((m) => m.createAdapter()).catch((err) => {
    adapterPromise = null;
    throw navigator.onLine ? err : Object.assign(new Error("אין חיבור לשרת הנתונים"), { code: 0 });
  });
  return adapterPromise;
}

/** Who is acting; recorded as "signed by" (the Sheets server uses the verified Google account instead). */
export const setActor = (user) => {
  actor = user.email || user.name;
  actorName = user.name;
};
const meta = () => ({ at: new Date().toISOString(), by: actor });
const NOTE_MAX = 300;
const cleanNote = (note) => assertSafeText(note, "הערה", { optional: true, max: NOTE_MAX });

// ---------- Offline cache (shared backends only; the local backend is already on this device) ----------

const cacheable = backend !== "local";
function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY));
  } catch {
    return null;
  }
}
export const clearOfflineCache = () => localStorage.removeItem(CACHE_KEY);

/** The user whose data is cached on this device, for read-only viewing without a connection. */
export function offlineUser() {
  const c = cacheable && readCache();
  return c?.data ? { name: c.name || c.by, email: c.by, offline: true, demo: false } : null;
}

/** Live data for the screens: { crates, soldiers, role, cachedAt }. Returns an unsubscribe function. */
export async function subscribeData(onData, onError) {
  const deliver = (raw, cachedAt = null) => {
    current = sanitizeSnapshot(raw);
    const role = ROLES.includes(raw?.me?.role) ? raw.me.role : "viewer";
    onData({ ...buildView(current), role, cachedAt });
  };
  const cached = cacheable && readCache();
  if (cached?.data && cached.by === actor) deliver(cached.data, cached.at);
  try {
    const a = await adapter();
    return a.subscribe((raw) => {
      if (cacheable) {
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ at: new Date().toISOString(), by: actor, name: actorName, data: raw }));
        } catch (err) { console.warn("[Palsar] offline cache not saved", err); }
      }
      deliver(raw);
    }, onError);
  } catch (err) {
    onError(err);
    return () => {};
  }
}

/** Runs an adapter write and records it in the history (the Sheets server keeps its own log). */
async function write(action, details, run) {
  const a = await adapter();
  const result = await run(a);
  if (a.appendLog) {
    await Promise.resolve(a.appendLog({ ...meta(), action, details }))
      .catch((err) => console.warn("[Palsar] history entry not saved", err));
  }
  return result;
}

function ready() {
  if (!current) throw new ValidationError("הנתונים עדיין נטענים");
  return current;
}
function findItem(itemId) {
  const item = ready().items.find((i) => i.id === itemId);
  if (!item) throw new ValidationError("הפריט לא נמצא");
  return item;
}
function findSoldier(soldierId) {
  const s = ready().soldiers.find((x) => x.id === soldierId);
  if (!s) throw new ValidationError("החייל לא נמצא");
  return s;
}
const assignedQty = (itemId) =>
  current.assignments.filter((a) => a.itemId === itemId).reduce((s, a) => s + a.qty, 0);
const heldQty = (itemId, soldierId) =>
  current.assignments.filter((a) => a.itemId === itemId && a.soldierId === soldierId).reduce((s, a) => s + a.qty, 0);

/** החתמה – sign equipment out to a soldier, with an optional free-text note. */
export async function signItem(itemId, soldierId, qty, note = "") {
  const item = findItem(itemId);
  findSoldier(soldierId);
  const n = assertQty(qty);
  if (n < 1) throw new ValidationError("יש להזין כמות של 1 לפחות");
  const available = item.total - item.faulty - assignedQty(itemId);
  if (n > available) throw new ValidationError(`זמינים להחתמה רק ${Math.max(0, available)}`);
  const text = cleanNote(note);
  return write("adjustAssignment", { itemId, soldierId, delta: n, note: text },
    (a) => a.adjustAssignment(itemId, soldierId, n, { ...meta(), note: text }));
}

/** החתמת ערכה – several items to one soldier in a single write. lines: [{ itemId, qty }] */
export async function signItems(soldierId, lines, note = "") {
  findSoldier(soldierId);
  const text = cleanNote(note);
  const changes = [];
  for (const { itemId, qty } of lines) {
    const n = assertQty(qty);
    if (!n) continue;
    const item = findItem(itemId);
    const available = item.total - item.faulty - assignedQty(itemId);
    if (n > available) throw new ValidationError(`${item.name}: זמינים להחתמה רק ${Math.max(0, available)}`);
    changes.push({ itemId, soldierId, delta: n });
  }
  if (!changes.length) throw new ValidationError("לא נבחרו פריטים להחתמה");
  await write("adjustAssignments", { changes, note: text }, (a) => a.adjustAssignments(changes, { ...meta(), note: text }));
  return changes.reduce((s, c) => s + c.delta, 0);
}

/** Edits the note on items the soldier already holds (empty note clears it). */
export async function setNotes(soldierId, itemIds, note) {
  findSoldier(soldierId);
  const text = cleanNote(note);
  const held = new Set(current.assignments.filter((a) => a.soldierId === soldierId && a.qty > 0).map((a) => a.itemId));
  const ids = [...new Set(itemIds)].filter((id) => held.has(id));
  if (!ids.length) return;
  return write("setNotes", { soldierId, itemIds: ids, note: text }, (a) => a.setNotes(soldierId, ids, text));
}

/** זיכוי – soldier returns equipment. */
export async function returnItem(itemId, soldierId, qty) {
  findItem(itemId);
  const n = assertQty(qty);
  const held = heldQty(itemId, soldierId);
  if (n < 1 || n > held) throw new ValidationError(`ניתן לזכות בין 1 ל-${held}`);
  return write("adjustAssignment", { itemId, soldierId, delta: -n }, (a) => a.adjustAssignment(itemId, soldierId, -n, meta()));
}

function cleanSoldier(s) {
  return {
    id: s.id || newId("s"),
    firstName: assertSafeText(s.firstName, "שם פרטי"),
    lastName: assertSafeText(s.lastName, "שם משפחה", { optional: true }),
    team: assertSafeText(s.team, "צוות", { optional: true }),
    email: assertEmail(s.email, { optional: true }),
  };
}
const soldierKey = (s) => `${s.team}|${s.firstName}|${s.lastName}`;

export async function saveSoldier(soldier) {
  ready();
  const s = cleanSoldier(soldier);
  return write("upsertSoldiers", { soldiers: [s] }, (a) => a.upsertSoldiers([s]));
}

/** Stores the soldier's email (used for sign-out confirmations). No-op if unchanged. */
export async function saveSoldierEmail(soldierId, email) {
  const s = findSoldier(soldierId);
  const e = assertEmail(email, { optional: true });
  if (e === s.email) return;
  const rec = { ...s, email: e };
  return write("upsertSoldiers", { soldiers: [rec] }, (a) => a.upsertSoldiers([rec]));
}

/** Emails the soldier (at the saved address) a confirmation of the items just signed. Sheets backend only. */
export async function sendSignEmail(soldierId, lines) {
  const s = findSoldier(soldierId);
  if (!s.email) throw new ValidationError("לחייל אין כתובת מייל שמורה");
  const items = lines.filter((l) => Number(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: assertQty(l.qty) }));
  const a = await adapter();
  if (!a.sendSignEmail) throw new ValidationError("שליחת מייל מהשרת אינה זמינה במקור נתונים זה");
  return a.sendSignEmail(soldierId, items);
}

/** Adds soldiers from a parsed list, skipping ones already in the roster. */
export async function importSoldiers(rows) {
  const seen = new Set(ready().soldiers.map(soldierKey));
  const fresh = [];
  let duplicates = 0;
  for (const r of rows) {
    const s = cleanSoldier(r);
    if (seen.has(soldierKey(s))) { duplicates++; continue; }
    seen.add(soldierKey(s));
    fresh.push(s);
  }
  if (fresh.length) await write("upsertSoldiers", { soldiers: fresh }, (a) => a.upsertSoldiers(fresh));
  return { added: fresh.length, duplicates };
}

export async function deleteSoldier(soldierId) {
  const s = findSoldier(soldierId);
  if (current.assignments.some((a) => a.soldierId === soldierId && a.qty > 0)) {
    throw new ValidationError("לא ניתן למחוק חייל שמוחתם על ציוד – יש לזכות קודם");
  }
  const name = fullName(s);
  return write("deleteSoldier", { id: soldierId, name }, (a) => a.deleteSoldier(soldierId, name));
}

function findCrate(crateId) {
  const c = ready().crates.find((x) => x.id === crateId);
  if (!c) throw new ValidationError("הארגז לא נמצא");
  return c;
}

/** Creates or updates a crate. Returns its id. */
export async function saveCrate(crate) {
  const prev = crate.id ? findCrate(crate.id) : null;
  const clean = {
    id: crate.id || newId("c"),
    number: assertSafeText(crate.number, "מספר ארגז"),
    name: assertSafeText(crate.name, "שם הארגז"),
    category: assertSafeText(crate.category, "קטגוריה", { optional: true }),
    location: assertSafeText(crate.location, "מיקום", { optional: true }),
    lastCountAt: prev?.lastCountAt ?? "",
    lastCountBy: prev?.lastCountBy ?? "",
  };
  if (ready().crates.some((c) => c.id !== clean.id && c.number === clean.number)) {
    throw new ValidationError(`ארגז מספר ${clean.number} כבר קיים`);
  }
  await write("upsertCrate", { crate: clean }, (a) => a.upsertCrate(clean));
  return clean.id;
}

export async function deleteCrate(crateId) {
  const crate = findCrate(crateId);
  const itemIds = new Set(current.items.filter((i) => i.crateId === crateId).map((i) => i.id));
  if (current.assignments.some((a) => itemIds.has(a.itemId) && a.qty > 0)) {
    throw new ValidationError("לא ניתן למחוק ארגז שיש ממנו ציוד מוחתם – יש לזכות קודם");
  }
  const name = `ארגז ${crate.number} – ${crate.name}`;
  return write("deleteCrate", { id: crateId, name }, (a) => a.deleteCrate(crateId, name));
}

export async function addItem(crateId, data) {
  findCrate(crateId);
  const item = {
    id: newId("i"),
    crateId,
    name: assertSafeText(data.name, "שם פריט"),
    total: assertQty(data.total, "כמות כוללת"),
    faulty: assertQty(data.faulty, "כמות תקולה"),
    min: assertQty(data.min, "כמות מינימום"),
    serial: assertSerial(data.serial),
  };
  if (item.faulty > item.total) throw new ValidationError("כמות התקולים גדולה מהכמות הכוללת");
  return write("addItem", { item }, (a) => a.addItem(item));
}

export async function deleteItem(itemId) {
  const item = findItem(itemId);
  if (assignedQty(itemId) > 0) throw new ValidationError("לא ניתן למחוק פריט שמוחתם אצל חיילים – יש לזכות קודם");
  return write("deleteItem", { id: itemId, name: item.name }, (a) => a.deleteItem(itemId, item.name));
}

export async function updateItem(itemId, patch) {
  const item = findItem(itemId);
  const clean = {};
  if ("name" in patch) clean.name = assertSafeText(patch.name, "שם פריט");
  for (const f of ["total", "faulty", "min"]) if (f in patch) clean[f] = assertQty(patch[f]);
  if ("serial" in patch) clean.serial = assertSerial(patch.serial);
  if (patch.crateId && patch.crateId !== item.crateId) clean.crateId = findCrate(patch.crateId).id;
  const next = { ...item, ...clean };
  if (assignedQty(itemId) + next.faulty > next.total) {
    throw new ValidationError("סה״כ הכמות קטן מהכמות המוחתמת והתקולה");
  }
  return write("updateItem", { id: itemId, patch: clean }, (a) => a.updateItem(itemId, clean));
}

/**
 * ספירת מלאי – counts = [{ itemId, good, faulty }] physically found in the crate.
 * With `apply`, item quantities are updated to match the count. Returns the items with a gap.
 */
export async function recordCount(crateId, counts, apply) {
  findCrate(crateId);
  const items = counts.map(({ itemId, good, faulty }) => {
    const item = findItem(itemId);
    if (item.crateId !== crateId) throw new ValidationError("הפריט לא שייך לארגז");
    const assigned = assignedQty(itemId);
    const g = assertQty(good, `${item.name} – תקין`);
    const f = assertQty(faulty, `${item.name} – תקול`);
    return {
      id: itemId, good: g, faulty: f, total: g + f + assigned,
      expectedGood: Math.max(0, item.total - item.faulty - assigned), expectedFaulty: item.faulty,
    };
  });
  const payload = { crateId, apply: Boolean(apply), items };
  await write("recordCount", payload, (a) => a.recordCount(payload, meta()));
  return items.filter((i) => i.good !== i.expectedGood || i.faulty !== i.expectedFaulty);
}

/** Activity log, newest first: [{ at, by, action, details }]. */
export async function getHistory(limit = 300) {
  const a = await adapter();
  if (!a.getHistory) throw new ValidationError("היסטוריית פעולות אינה זמינה במקור נתונים זה");
  return a.getHistory(limit);
}

// ---------- Users (admin) ----------

export async function listUsers() {
  return (await adapter()).listUsers();
}

export async function saveUser(email, role) {
  const e = assertEmail(email);
  if (!ROLES.includes(role)) throw new ValidationError("הרשאה לא תקינה");
  return (await adapter()).saveUser(e, role);
}

export async function deleteUser(email) {
  return (await adapter()).deleteUser(String(email).toLowerCase());
}

/** Export everything (e.g. before migrating between backends). */
export async function exportSnapshot() {
  return sanitizeSnapshot(await (await adapter()).getSnapshot());
}

/** Replace all data in the active backend. Rejects any snapshot containing personal numbers. */
export async function importSnapshot(snapshot) {
  assertSnapshotSafe(snapshot);
  return (await adapter()).replaceAll(sanitizeSnapshot(snapshot));
}
