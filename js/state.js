// Latest data from the repository, shared by all screens.
export const store = { crates: [], soldiers: [], issues: [], role: "viewer", loaded: false };

export const canEdit = () => store.role === "editor" || store.role === "admin";

export function findItem(itemId) {
  for (const crate of store.crates) {
    const item = crate.items.find((i) => i.id === itemId);
    if (item) return { item, crate };
  }
  return null;
}

export function resetStore() {
  Object.assign(store, { crates: [], soldiers: [], issues: [], role: "viewer", loaded: false });
}
