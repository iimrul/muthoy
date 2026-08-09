import { shopStorage } from "./shopStorage";
interface TxItem {
  name: string;
  quantity: number;
}

interface Transaction {
  timestamp: string;
  items: TxItem[];
}

function loadTransactions(): Transaction[] {
  try {
    return JSON.parse(shopStorage.getItem("transactions") || "[]");
  } catch {
    return [];
  }
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Top medicines sold today, ordered by most-recent sale timestamp. */
export function getRecentMedicines(limit = 6): string[] {
  const todayStart = startOfDay(new Date());
  const txs = loadTransactions().filter(
    (tx) => new Date(tx.timestamp).getTime() >= todayStart
  );

  // Collect per-medicine latest timestamp
  const latestAt = new Map<string, number>();
  for (const tx of txs) {
    const ts = new Date(tx.timestamp).getTime();
    for (const item of tx.items || []) {
      const name = item.name?.trim();
      if (!name) continue;
      if (!latestAt.has(name) || ts > latestAt.get(name)!) {
        latestAt.set(name, ts);
      }
    }
  }

  return [...latestAt.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name);
}

/** Top medicines by total quantity sold in the last `days` days. */
export function getFrequentMedicines(days = 7, limit = 8): string[] {
  const cutoff = Date.now() - days * 86400000;
  const txs = loadTransactions().filter(
    (tx) => new Date(tx.timestamp).getTime() >= cutoff
  );

  const counts = new Map<string, number>();
  for (const tx of txs) {
    for (const item of tx.items || []) {
      const name = item.name?.trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + (Number(item.quantity) || 1));
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name);
}

/** Top medicines by all-time quantity sold (used for the Favourite tab). */
export function getFavoriteMedicines(limit = 5): string[] {
  return getFrequentMedicines(36500, limit);
}
