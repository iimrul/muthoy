const stores = new Map<string, Map<string, string>>();

/**
 * Empties every store IN PLACE.
 *
 * Consumers hold the handle `createMMKV` returned at module scope, so the maps
 * have to be cleared rather than replaced — dropping them from `stores` would
 * leave those handles writing to an orphan. Without this, one test's persisted
 * device state silently becomes the next test's starting point.
 */
export function __resetMMKVStores(): void {
  for (const store of stores.values()) store.clear();
}

export function createMMKV({ id }: { id: string }) {
  const store = stores.get(id) ?? new Map<string, string>();
  stores.set(id, store);
  return {
    set: (key: string, value: string) => void store.set(key, value),
    getString: (key: string) => store.get(key),
    remove: (key: string) => void store.delete(key),
  };
}
