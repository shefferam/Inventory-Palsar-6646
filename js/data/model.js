// Pure domain logic: turns a normalized snapshot into the view model used by the screens.

export const STATUS = {
  ok: { label: "תקין", rank: 0 },
  warn: { label: "התראה", rank: 1 },
  danger: { label: "חוסר", rank: 2 },
};

export const ROLES = ["viewer", "editor", "admin"];
export const ROLE_LABEL = { viewer: "צפייה", editor: "עריכה", admin: "מנהל" };

export const teamLabel = (t) => (/^\d+$/.test(t) ? `צוות ${t}` : t || "ללא צוות");
export const fullName = (s) => `${s.firstName} ${s.lastName}`.trim();

// Numbered teams first (1, 2, 3…), then named units (חפ״ק, מפל״ג…).
export function compareTeams(a, b) {
  const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
  if (na && nb) return Number(a) - Number(b);
  if (na !== nb) return na ? -1 : 1;
  return a.localeCompare(b, "he");
}
const compareSoldiers = (a, b) => compareTeams(a.team, b.team) || a.name.localeCompare(b.name, "he");

function buildItem(item, holders, issues) {
  const withSoldiers = holders.reduce((a, h) => a + h.qty, 0);
  const available = Math.max(0, item.total - withSoldiers - item.faulty);
  let status = "ok";
  if (item.min > 0 && available === 0) status = "danger";
  else if (available < item.min || item.faulty > 0) status = "warn";
  const issuedQty = issues.reduce((a, x) => a + x.qty, 0);
  return { ...item, holders, issues, issuedQty, withSoldiers, available, status, short: Math.max(0, item.min - available) };
}

const today = () => new Date().toLocaleDateString("sv-SE"); // local YYYY-MM-DD
const byNewest = (a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt));

function buildCrate(crate, items) {
  const sum = (k) => items.reduce((a, i) => a + i[k], 0);
  const status = items.reduce((s, i) => (STATUS[i.status].rank > STATUS[s].rank ? i.status : s), "ok");
  return {
    ...crate,
    items,
    itemTypes: items.length,
    total: sum("total"),
    available: sum("available"),
    withSoldiers: sum("withSoldiers"),
    faulty: sum("faulty"),
    shortages: items.filter((i) => i.short > 0),
    issues: items.flatMap((i) => i.issues.map((x) => ({ ...x, itemName: i.name }))).sort(byNewest),
    received: Boolean(crate.receivedFrom),
    overdue: Boolean(crate.receivedFrom && crate.returnBy && crate.returnBy < today()),
    status,
  };
}

export function buildView({ crates, items, soldiers, assignments, issues = [] }) {
  const soldierById = new Map(soldiers.map((s) => [s.id, { ...s, name: fullName(s) }]));
  const active = assignments.filter((a) => a.qty > 0);

  const holdersByItem = new Map();
  for (const a of active) {
    const s = soldierById.get(a.soldierId);
    const h = { soldierId: a.soldierId, name: s?.name ?? "חייל שנמחק", team: s?.team ?? "", qty: a.qty, signedAt: a.signedAt, signedBy: a.signedBy };
    holdersByItem.set(a.itemId, [...(holdersByItem.get(a.itemId) ?? []), h]);
  }

  // Consumables handed out: recorded on the crate only, never on the soldier.
  const issuesByItem = new Map();
  for (const x of [...issues].sort(byNewest)) {
    const s = soldierById.get(x.soldierId);
    const row = { ...x, name: s?.name ?? (x.recipient || "חייל שנמחק"), team: s ? s.team : null };
    issuesByItem.set(x.itemId, [...(issuesByItem.get(x.itemId) ?? []), row]);
  }

  const itemsByCrate = new Map();
  for (const i of items) {
    const built = buildItem(i, holdersByItem.get(i.id) ?? [], issuesByItem.get(i.id) ?? []);
    itemsByCrate.set(i.crateId, [...(itemsByCrate.get(i.crateId) ?? []), built]);
  }
  const builtCrates = crates
    .map((c) => buildCrate(c, itemsByCrate.get(c.id) ?? []))
    .sort((a, b) => a.number.localeCompare(b.number, "he", { numeric: true }));

  const itemIndex = new Map();
  for (const c of builtCrates) for (const i of c.items) itemIndex.set(i.id, { item: i, crate: c });

  const signedBySoldier = new Map();
  for (const a of active) {
    const ref = itemIndex.get(a.itemId);
    if (!ref) continue;
    const row = { itemId: a.itemId, name: ref.item.name, serial: ref.item.serial, crateNumber: ref.crate.number, crateName: ref.crate.name, qty: a.qty, signedAt: a.signedAt, signedBy: a.signedBy, note: a.note };
    signedBySoldier.set(a.soldierId, [...(signedBySoldier.get(a.soldierId) ?? []), row]);
  }
  const builtSoldiers = [...soldierById.values()]
    .map((s) => {
      const list = signedBySoldier.get(s.id) ?? [];
      return { ...s, items: list, signedQty: list.reduce((a, x) => a + x.qty, 0) };
    })
    .sort(compareSoldiers);

  return { crates: builtCrates, soldiers: builtSoldiers, issues: builtCrates.flatMap((c) => c.issues.map((x) => ({ ...x, crateNumber: c.number }))) };
}

/** Soldiers holding items from a crate, each with the items they signed for. */
export function holdersOf(crate) {
  const map = new Map();
  for (const item of crate.items) {
    for (const h of item.holders) {
      if (!map.has(h.soldierId)) map.set(h.soldierId, { soldierId: h.soldierId, name: h.name, team: h.team, list: [] });
      map.get(h.soldierId).list.push({ itemId: item.id, name: item.name, qty: h.qty });
    }
  }
  return [...map.values()].sort(compareSoldiers);
}
