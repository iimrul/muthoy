// monitoring/sink.ts — a bounded, device-local ring buffer for reports.
//
// Why a buffer at all when there is no provider yet: the shop runs offline for
// hours at a stretch, so "report it when the network is up" has to mean
// "remember it until then". And once a provider does exist, the delivery path
// must not be the only record — a report that fails to send has to survive.
//
// MMKV rather than SQLite, deliberately, and this is the one place in the app
// where that is the right way round:
//
//   * db/init.ts failures are exactly what this reports, so a sink that needs
//     the database cannot report the database failing to open;
//   * H-3 encrypts SQLite, and a reporter must work before the key is unwrapped;
//   * nothing here is shop data. It is six enum fields (see
//     domain/errorRedaction.ts) with no identifier in them, so MMKV's plaintext
//     storage carries nothing worth protecting. That is a property of the
//     redaction contract, not an exemption from rule 1.
//
// Bounded at CAPACITY, oldest evicted. An unbounded log on a 2GB phone is a
// slow leak that only shows up on the devices least able to absorb it.

import { createMMKV } from "react-native-mmkv";
import type { MonitoringReport } from "../domain/errorRedaction";

const storage = createMMKV({ id: "muthoy-monitoring" });
const KEY = "reports";

/**
 * Deliberately small. These are breadcrumbs for the last few failures, not an
 * audit log; `audit_logs` is the audit log and it lives in SQLite.
 */
export const CAPACITY = 50;

export interface StoredReport extends MonitoringReport {
  /** ISO-8601 UTC. The only timestamp here, and it names no business date. */
  readonly recordedAt: string;
}

/**
 * Reads the buffer, tolerating every way the stored value can be wrong.
 *
 * MMKV can come back empty on a cleared data dir, and a partially written or
 * hand-edited value is JSON that does not match the shape. Both answer "no
 * reports" rather than throwing, because a corrupt diagnostic buffer must never
 * become a second failure on top of the one being reported.
 */
export function readReports(): readonly StoredReport[] {
  let raw: string | undefined;
  try {
    raw = storage.getString(KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StoredReport =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as { event?: unknown }).event === "string" &&
        typeof (item as { recordedAt?: unknown }).recordedAt === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Appends one report, evicting the oldest if the buffer is full.
 *
 * Returns the stored entry so a caller can assert on it. Never throws: every
 * storage failure is swallowed, because losing a breadcrumb is acceptable and
 * failing a sale to record one is not.
 */
export function appendReport(
  report: MonitoringReport,
  now: () => Date = () => new Date(),
): StoredReport | null {
  const entry: StoredReport = { ...report, recordedAt: now().toISOString() };
  try {
    const existing = readReports();
    const next = [...existing, entry].slice(-CAPACITY);
    storage.set(KEY, JSON.stringify(next));
    return entry;
  } catch {
    return null;
  }
}

/** Test seam, and the hook a future "reports delivered" step would use. */
export function clearReports(): void {
  try {
    storage.remove(KEY);
  } catch {
    // Nothing to do and nothing worth reporting: the buffer is advisory.
  }
}
