// The only data entry point for the UI. Screens never talk to a storage backend directly.
//
// Adapter contract (local / sheets / firestore / any future central-DB adapter):
//   name: string
//   getSnapshot(): Promise<{ crates, items, soldiers, assignments }>
//   subscribe(onData, onError): () => void                 // emits full snapshot (+ me: { role })
//   adjustAssignment(itemId, soldierId, delta, meta)      // + sign out / − return, meta = { at, by }
//   upsertSoldiers(list), deleteSoldier(id)
//   updateItem(itemId, patch)
//   replaceAll(snapshot)                                   // migration between backends

import { DATA_BACKEND } from "../config.js";
import { buildView } from "./model.js";
import {
  assertQty, assertSafeText, assertSnapshotSafe, newId, sanitizeSnapshot, ValidationError,
} from "./schema.js";

const ADAPTERS = {
  local: () => import("./local-adapter.js"),
  sheets: () => import("./sheets-adapter.js"),
  firestore: () => import("./firestore-adapter.js"),
};
const ROLES = ["viewer", "editor", "admin"];

export const backend = DATA_BACKEND;
export { ValidationError };

let adapterPromise = null;
let current = null; // last sanitized snapshot, used for validation before writes
let actor = "";

function adapter() {
  const load = ADAPTERS[DATA_BACKEND];
  if (!load) return Promise.reject(new Error(`Unknown DATA_BACKEND: ${DATA_BACKEND}`));
  adapterPromise ??= load().then((m) => m.createAdapter());
  return adapterPromise;
}

/** Name/email recorded as "signed by" (the Sheets server uses the verified Google account instead). */
export const setActor = (name) => { actor = name; };
const meta = () => ({ at: new Date().toISOString(), by: actor });

/** Live data for the screens: { crates, soldiers, role }. Returns an unsubscribe function. */
export async function subscribeData(onData, onError) {
  try {
    const a = await adapter();
    return a.subscribe((raw) => {
      current = sanitizeSnapshot(raw);
      const role = ROLES.includes(raw?.me?.role) ? raw.me.role : "viewer";
      onData({ ...buildView(current), role });
    }, onError);
  } catch (err) {
    onError(err);
    return () => {};
  }
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

/** החתמה – sign equipment out to a soldier. */
export async function signItem(itemId, soldierId, qty) {
  const item = findItem(itemId);
  findSoldier(soldierId);
  const n = assertQty(qty);
  if (n < 1) throw new ValidationError("יש להזין כמות של 1 לפחות");
  const available = item.total - item.faulty - assignedQty(itemId);
  if (n > available) throw new ValidationError(`זמינים להחתמה רק ${Math.max(0, available)}`);
  return (await adapter()).adjustAssignment(itemId, soldierId, n, meta());
}

/** זיכוי – soldier returns equipment. */
export async function returnItem(itemId, soldierId, qty) {
  findItem(itemId);
  const n = assertQty(qty);
  const held = heldQty(itemId, soldierId);
  if (n < 1 || n > held) throw new ValidationError(`ניתן לזכות בין 1 ל-${held}`);
  return (await adapter()).adjustAssignment(itemId, soldierId, -n, meta());
}

function cleanSoldier(s) {
  return {
    id: s.id || newId("s"),
    firstName: assertSafeText(s.firstName, "שם פרטי"),
    lastName: assertSafeText(s.lastName, "שם משפחה", { optional: true }),
    team: assertSafeText(s.team, "צוות", { optional: true }),
  };
}
const soldierKey = (s) => `${s.team}|${s.firstName}|${s.lastName}`;

export async function saveSoldier(soldier) {
  ready();
  return (await adapter()).upsertSoldiers([cleanSoldier(soldier)]);
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
  if (fresh.length) await (await adapter()).upsertSoldiers(fresh);
  return { added: fresh.length, duplicates };
}

export async function deleteSoldier(soldierId) {
  findSoldier(soldierId);
  if (current.assignments.some((a) => a.soldierId === soldierId && a.qty > 0)) {
    throw new ValidationError("לא ניתן למחוק חייל שמוחתם על ציוד – יש לזכות קודם");
  }
  return (await adapter()).deleteSoldier(soldierId);
}

export async function updateItem(itemId, patch) {
  const item = findItem(itemId);
  const clean = {};
  if ("name" in patch) clean.name = assertSafeText(patch.name, "שם פריט");
  for (const f of ["total", "faulty", "min"]) if (f in patch) clean[f] = assertQty(patch[f]);
  const next = { ...item, ...clean };
  if (assignedQty(itemId) + next.faulty > next.total) {
    throw new ValidationError("סה״כ הכמות קטן מהכמות המוחתמת והתקולה");
  }
  return (await adapter()).updateItem(itemId, clean);
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
