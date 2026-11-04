import { buildSeed } from "./seed.js";
import { assignmentId } from "./schema.js";

const KEY = "palsar.db.v2";
const TABLES = ["crates", "items", "soldiers", "assignments"];

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
        });
      }
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

    async updateItem(itemId, patch) {
      const db = read();
      const item = db.items.find((i) => i.id === itemId);
      if (!item) throw new Error(`Item not found: ${itemId}`);
      Object.assign(item, patch);
      commit(db);
    },

    async replaceAll(snapshot) {
      commit(snapshot);
    },
  };
}
