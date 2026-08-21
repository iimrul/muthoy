const stores = new Map<string, Map<string, string>>();

export function createMMKV({ id }: { id: string }) {
  const store = stores.get(id) ?? new Map<string, string>();
  stores.set(id, store);
  return {
    set: (key: string, value: string) => void store.set(key, value),
    getString: (key: string) => store.get(key),
    remove: (key: string) => void store.delete(key),
  };
}
