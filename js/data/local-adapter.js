import { buildSeed } from "./seed.js";
import { assignmentId } from "./schema.js";

const KEY = "palsar.db.v2";
const TABLES = ["crates", "items", "soldiers", "assignments"];
const LOG_LIMIT = 500;

function applyDelta(db, itemId, soldierId, delta, meta) {
  const id = assignmentId(itemId, soldierId);
  const cur = db.assignments.find((a) => a.id === id);
  const qty = (cur?.qty ?? 0) + delta;
  if (qty < 0) throw new Error("לא ניתן לזכות יותר ממה שהוחתם");
  db.assignments = db.assignments.filter((a) => a.id !== id);
  if (qty > 0) {
    db.assignments.push({
      id, itemId, soldierId, qty,
      signedAt: delta > 0 ? meta.at : cur.signedAt,
      signedBy: delta > 0 ? meta.by : cur.signedBy,
      note: delta > 0 && "note" in meta ? meta.note : cur?.note ?? "",
    });
  }
}

/** Local database in the browser (this device only). Same contract as sheets-adapter.js. */
export function createAdapter() {
  const listeners = new Set();

  const read = () => {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      try {
        const db = JSON.parse(raw);
        TABLES.forEach((t) => { db[t] ??= []; });
        return db;
      } catch { console.warn("[Palsar] Local DB corrupted – reseeding"); }
    }
    const seed = buildSeed();
    localStorage.setItem(KEY, JSON.stringify(seed));
    return seed;
  };
  const emit = (db) => listeners.forEach((fn) => fn({ ...db, me: { role: "admin" } }));
  const commit = (db) => {
    localStorage.setItem(KEY, JSON.stringify(db));
    emit(db);
  };

  // Keep other open tabs in sync.
  window.addEventListener("storage", (e) => { if (e.key === KEY) emit(read()); });

  return {
    name: "local",

    async getSnapshot() {
      return read();
    },

    subscribe(onData) {
      listeners.add(onData);
      queueMicrotask(() => onData({ ...read(), me: { role: "admin" } }));
      return () => listeners.delete(onData);
    },

    async adjustAssignment(itemId, soldierId, delta, meta) {
      const db = read();
      applyDelta(db, itemId, soldierId, delta, meta);
      commit(db);
    },

    async adjustAssignments(changes, meta) {
      const db = read();
      changes.forEach((c) => applyDelta(db, c.itemId, c.soldierId, c.delta, meta));
      commit(db);
    },

    async setNotes(soldierId, itemIds, note) {
      const db = read();
      for (const a of db.assignments) if (a.soldierId === soldierId && itemIds.includes(a.itemId)) a.note = note;
      commit(db);
    },

    async upsertSoldiers(list) {
      const db = read();
      for (const s of list) {
        const i = db.soldiers.findIndex((x) => x.id === s.id);
        if (i >= 0) db.soldiers[i] = s;
        else db.soldiers.push(s);
      }
      commit(db);
    },

    async deleteSoldier(id) {
      const db = read();
      db.soldiers = db.soldiers.filter((s) => s.id !== id);
      commit(db);
    },

    async upsertCrate(crate) {
      const db = read();
      const i = db.crates.findIndex((c) => c.id === crate.id);
      if (i >= 0) db.crates[i] = crate;
      else db.crates.push(crate);
      commit(db);
    },

    async deleteCrate(id) {
      const db = read();
      const gone = new Set(db.items.filter((i) => i.crateId === id).map((i) => i.id));
      db.crates = db.crates.filter((c) => c.id !== id);
      db.items = db.items.filter((i) => !gone.has(i.id));
      db.assignments = db.assignments.filter((a) => !gone.has(a.itemId));
      commit(db);
    },

    async addItem(item) {
      const db = read();
      db.items.push(item);
      commit(db);
    },

    async deleteItem(id) {
      const db = read();
      db.items = db.items.filter((i) => i.id !== id);
      db.assignments = db.assignments.filter((a) => a.itemId !== id);
      commit(db);
    },

    async updateItem(itemId, patch) {
      const db = read();
      const item = db.items.find((i) => i.id === itemId);
      if (!item) throw new Error(`Item not found: ${itemId}`);
      Object.assign(item, patch);
      commit(db);
    },

    async recordCount({ crateId, apply, items }, meta) {
      const db = read();
      const crate = db.crates.find((c) => c.id === crateId);
      if (!crate) throw new Error(`Crate not found: ${crateId}`);
      Object.assign(crate, { lastCountAt: meta.at, lastCountBy: meta.by });
      if (apply) {
        for (const { id, total, faulty } of items) {
          const item = db.items.find((i) => i.id === id);
          if (item) Object.assign(item, { total, faulty });
        }
      }
      commit(db);
    },

    async appendLog(entry) {
      const db = read();
      db.log = [...(db.log ?? []), entry].slice(-LOG_LIMIT);
      localStorage.setItem(KEY, JSON.stringify(db));
    },

    async getHistory(limit) {
      return (read().log ?? []).slice(-limit).reverse();
    },

    async replaceAll(snapshot) {
      commit(snapshot);
    },
  };
}
