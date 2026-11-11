import { loadFirebaseApp, SDK } from "../firebase.js";
import { assignmentId } from "./schema.js";

const COLLECTIONS = ["crates", "items", "soldiers", "assignments", "issues"];
const BATCH_LIMIT = 450; // Firestore allows 500 writes per batch

/** Shared cloud database. Same contract as local-adapter.js; access is enforced by firestore.rules. */
export async function createAdapter() {
  const [app, fs] = await Promise.all([loadFirebaseApp(), import(`${SDK}/firebase-firestore.js`)]);
  const db = fs.getFirestore(app);
  const docsOf = (snap) => snap.docs.map((d) => ({ ...d.data(), id: d.id }));

  return {
    name: "firestore",

    async getSnapshot() {
      const entries = await Promise.all(
        COLLECTIONS.map(async (c) => [c, docsOf(await fs.getDocs(fs.collection(db, c)))]),
      );
      return Object.fromEntries(entries);
    },

    subscribe(onData, onError) {
      const state = {};
      const unsubs = COLLECTIONS.map((c) =>
        fs.onSnapshot(fs.collection(db, c), (snap) => {
          state[c] = docsOf(snap);
          if (COLLECTIONS.every((k) => state[k])) onData({ ...state, me: { role: "editor" } });
        }, onError),
      );
      return () => unsubs.forEach((u) => u());
    },

    adjustAssignment(itemId, soldierId, delta, meta) {
      return this.adjustAssignments([{ itemId, soldierId, delta }], meta);
    },

    adjustAssignments(changes, meta) {
      const refs = changes.map((c) => fs.doc(db, "assignments", assignmentId(c.itemId, c.soldierId)));
      return fs.runTransaction(db, async (tx) => {
        const snaps = await Promise.all(refs.map((r) => tx.get(r)));
        changes.forEach(({ itemId, soldierId, delta }, i) => {
          const prev = snaps[i].exists() ? snaps[i].data() : null;
          const qty = (prev?.qty ?? 0) + delta;
          if (qty < 0) throw new Error("לא ניתן לזכות יותר ממה שהוחתם");
          if (qty === 0) return tx.delete(refs[i]);
          tx.set(refs[i], {
            itemId, soldierId, qty,
            signedAt: delta > 0 ? meta.at : prev.signedAt,
            signedBy: delta > 0 ? meta.by : prev.signedBy,
            note: delta > 0 && "note" in meta ? meta.note : prev?.note ?? "",
          });
        });
      });
    },

    // Consumables are never signed to soldiers, so total − faulty is what's in stock.
    issueItems(issues, meta) {
      return fs.runTransaction(db, async (tx) => {
        const refs = issues.map((x) => fs.doc(db, "items", x.itemId));
        const snaps = await Promise.all(refs.map((r) => tx.get(r)));
        snaps.forEach((snap, i) => {
          const item = snap.data();
          if (!item) throw new Error("הפריט לא נמצא");
          if (issues[i].qty > item.total - item.faulty) throw new Error(`${item.name}: אין מספיק במלאי`);
        });
        snaps.forEach((snap, i) => tx.update(refs[i], { total: snap.data().total - issues[i].qty }));
        for (const { id, ...x } of issues) {
          tx.set(fs.doc(db, "issues", id), { ...x, issuedAt: meta.at, issuedBy: meta.by, note: meta.note ?? "" });
        }
      });
    },

    async upsertSoldiers(list) {
      for (let i = 0; i < list.length; i += BATCH_LIMIT) {
        const batch = fs.writeBatch(db);
        list.slice(i, i + BATCH_LIMIT).forEach(({ id, ...data }) => batch.set(fs.doc(db, "soldiers", id), data));
        await batch.commit();
      }
    },

    deleteSoldier(id) {
      return fs.deleteDoc(fs.doc(db, "soldiers", id));
    },

    upsertCrate({ id, ...data }) {
      return fs.setDoc(fs.doc(db, "crates", id), data);
    },

    async deleteCrate(id) {
      const items = await fs.getDocs(fs.query(fs.collection(db, "items"), fs.where("crateId", "==", id)));
      const batch = fs.writeBatch(db);
      items.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(fs.doc(db, "crates", id));
      return batch.commit();
    },

    addItem({ id, ...data }) {
      return fs.setDoc(fs.doc(db, "items", id), data);
    },

    updateItem(itemId, patch) {
      return fs.updateDoc(fs.doc(db, "items", itemId), patch);
    },

    deleteItem(id) {
      return fs.deleteDoc(fs.doc(db, "items", id));
    },

    setNotes(soldierId, itemIds, note) {
      const batch = fs.writeBatch(db);
      itemIds.forEach((itemId) => batch.update(fs.doc(db, "assignments", assignmentId(itemId, soldierId)), { note }));
      return batch.commit();
    },

    recordCount({ crateId, apply, items }, meta) {
      const batch = fs.writeBatch(db);
      batch.update(fs.doc(db, "crates", crateId), { lastCountAt: meta.at, lastCountBy: meta.by });
      if (apply) items.forEach(({ id, total, faulty }) => batch.update(fs.doc(db, "items", id), { total, faulty }));
      return batch.commit();
    },

    appendLog(entry) {
      return fs.addDoc(fs.collection(db, "log"), entry);
    },

    async getHistory(limit) {
      const q = fs.query(fs.collection(db, "log"), fs.orderBy("at", "desc"), fs.limit(limit));
      return (await fs.getDocs(q)).docs.map((d) => d.data());
    },

    async replaceAll(snapshot) {
      const ops = [];
      for (const c of COLLECTIONS) {
        const keep = new Set(snapshot[c].map((r) => r.id));
        (await fs.getDocs(fs.collection(db, c))).docs
          .filter((d) => !keep.has(d.id))
          .forEach((d) => ops.push((b) => b.delete(d.ref)));
        for (const { id, ...data } of snapshot[c]) ops.push((b) => b.set(fs.doc(db, c, id), data));
      }
      for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
        const batch = fs.writeBatch(db);
        ops.slice(i, i + BATCH_LIMIT).forEach((op) => op(batch));
        await batch.commit();
      }
    },
  };
}
