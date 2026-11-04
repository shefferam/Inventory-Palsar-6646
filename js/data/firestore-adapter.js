import { loadFirebaseApp, SDK } from "../firebase.js";
import { assignmentId } from "./schema.js";

const COLLECTIONS = ["crates", "items", "soldiers", "assignments"];
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
      const ref = fs.doc(db, "assignments", assignmentId(itemId, soldierId));
      return fs.runTransaction(db, async (tx) => {
        const cur = await tx.get(ref);
        const prev = cur.exists() ? cur.data() : null;
        const qty = (prev?.qty ?? 0) + delta;
        if (qty < 0) throw new Error("לא ניתן לזכות יותר ממה שהוחתם");
        if (qty === 0) return tx.delete(ref);
        tx.set(ref, {
          itemId, soldierId, qty,
          signedAt: delta > 0 ? meta.at : prev.signedAt,
          signedBy: delta > 0 ? meta.by : prev.signedBy,
        });
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

    updateItem(itemId, patch) {
      return fs.updateDoc(fs.doc(db, "items", itemId), patch);
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
