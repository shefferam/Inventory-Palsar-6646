import { SHEETS_API_URL } from "../config.js";
import { getIdToken } from "../auth.js";

const POLL_MS = 20000;

async function call(action, payload = {}) {
  if (!SHEETS_API_URL) throw Object.assign(new Error("כתובת שרת הנתונים (SHEETS_API_URL) לא הוגדרה ב-js/config.js"), { code: 500 });
  let res;
  try {
    // text/plain keeps this a "simple" CORS request, which Apps Script web apps accept.
    res = await fetch(SHEETS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ token: getIdToken(), action, payload }),
    });
  } catch {
    throw Object.assign(new Error("אין חיבור לשרת הנתונים"), { code: 0 });
  }
  const out = await res.json().catch(() => ({ ok: false, error: "תשובה לא תקינה משרת הנתונים", code: 500 }));
  if (!out.ok) throw Object.assign(new Error(out.error || "שגיאה בשרת הנתונים"), { code: out.code });
  return out.data;
}

/** Google Sheet in the owner's Drive, via the Apps Script web app (apps-script/Code.gs). */
export function createAdapter() {
  const listeners = new Set();
  let version = null;
  let last = null;
  let timer = null;
  let failed = false;

  const emit = (r) => {
    const recovered = failed;
    failed = false;
    // After a connection error, re-deliver unchanged data so the screens know they are live again.
    if (!r?.snapshot) {
      if (recovered && last) listeners.forEach((l) => l.onData(last));
      return;
    }
    version = r.version;
    last = { ...r.snapshot, me: r.me };
    listeners.forEach((l) => l.onData(last));
  };

  const poll = async () => {
    clearTimeout(timer);
    try {
      emit(await call("snapshot", { since: version }));
    } catch (err) {
      failed = true;
      listeners.forEach((l) => l.onError(err));
      if (err.code === 401 || err.code === 403) return;
    }
    if (listeners.size && !document.hidden) timer = setTimeout(poll, POLL_MS);
  };

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && listeners.size) poll();
  });
  window.addEventListener("online", () => {
    if (listeners.size) poll();
  });

  // Every write returns the fresh snapshot, so the writer sees the result immediately.
  const write = async (action, payload) => {
    const r = await call(action, payload);
    emit(r);
    return r.result;
  };

  return {
    name: "sheets",

    async getSnapshot() {
      return (await call("snapshot")).snapshot;
    },

    subscribe(onData, onError) {
      const l = { onData, onError };
      listeners.add(l);
      if (listeners.size === 1) poll();
      else if (last) queueMicrotask(() => onData(last));
      return () => {
        listeners.delete(l);
        if (!listeners.size) {
          clearTimeout(timer);
          version = null;
          last = null;
        }
      };
    },

    adjustAssignment: (itemId, soldierId, delta, meta) => write("adjustAssignment", { itemId, soldierId, delta, note: meta?.note ?? "" }),
    adjustAssignments: (changes, meta) => write("adjustAssignments", { changes, note: meta?.note ?? "" }),
    // The server derives recipient, time and user itself.
    issueItems: (issues, meta) => write("issueItems", {
      issues: issues.map(({ itemId, soldierId, qty }) => ({ itemId, soldierId, qty })), note: meta?.note ?? "",
    }),
    setNotes: (soldierId, itemIds, note) => write("setNotes", { soldierId, itemIds, note }),
    upsertSoldiers: (soldiers) => write("upsertSoldiers", { soldiers }),
    deleteSoldier: (id, name) => write("deleteSoldier", { id, name }),
    upsertCrate: (crate) => write("upsertCrate", { crate }),
    deleteCrate: (id, name) => write("deleteCrate", { id, name }),
    addItem: (item) => write("addItem", { item }),
    updateItem: (id, patch) => write("updateItem", { id, patch }),
    deleteItem: (id, name) => write("deleteItem", { id, name }),
    recordCount: (payload) => write("recordCount", payload),
    replaceAll: (snapshot) => write("replaceAll", { snapshot }),
    getHistory: (limit) => call("history", { limit }),
    listUsers: () => call("listUsers"),
    saveUser: (email, role) => write("saveUser", { email, role }),
    deleteUser: (email) => write("deleteUser", { email }),
    sendSignEmail: (soldierId, items) => write("sendSignEmail", { soldierId, items }),
  };
}
