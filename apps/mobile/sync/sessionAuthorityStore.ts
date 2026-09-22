import { createMMKV } from 'react-native-mmkv';

// Device-local security state. This is intentionally separate from the
// shop-wide sync cursor/status: authority belongs to one actor in one shop and
// must survive sign-out, restart, and shop/user switches.
const storage = createMMKV({ id: 'muthoy-session-authority' });
const PREFIX = 'authority:';

export interface SessionAuthorityLease {
  v: 1;
  confirmedAtMs: number;
  highWaterAtMs: number;
  quarantineReason: string | null;
}

export type SessionAuthorityLeaseState =
  | { status: 'absent'; record: null }
  | { status: 'corrupt'; record: null }
  | { status: 'valid'; record: SessionAuthorityLease };

function key(shopId: string, userId: string): string {
  return `${PREFIX}${encodeURIComponent(shopId)}:${encodeURIComponent(userId)}`;
}

function isSafeTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parse(raw: string): SessionAuthorityLease | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidate = value as Partial<SessionAuthorityLease>;
    const exactKeys = Object.keys(value as object).sort();
    if (
      JSON.stringify(exactKeys) !== JSON.stringify([
        'confirmedAtMs', 'highWaterAtMs', 'quarantineReason', 'v',
      ])
      ||
      candidate.v !== 1
      || !isSafeTime(candidate.confirmedAtMs)
      || !isSafeTime(candidate.highWaterAtMs)
      || candidate.highWaterAtMs < candidate.confirmedAtMs
      || !(candidate.quarantineReason === null || typeof candidate.quarantineReason === 'string')
    ) {
      return null;
    }
    return candidate as SessionAuthorityLease;
  } catch {
    return null;
  }
}

export function readSessionAuthorityLease(
  shopId: string,
  userId: string,
): SessionAuthorityLeaseState {
  const raw = storage.getString(key(shopId, userId));
  if (raw === undefined) return { status: 'absent', record: null };
  const record = parse(raw);
  return record ? { status: 'valid', record } : { status: 'corrupt', record: null };
}

export function confirmSessionAuthority(shopId: string, userId: string, nowMs: number): void {
  if (!isSafeTime(nowMs)) throw new Error('Authority confirmation time must be a safe timestamp.');
  const existing = readSessionAuthorityLease(shopId, userId);
  const record: SessionAuthorityLease = {
    v: 1,
    confirmedAtMs: nowMs,
    highWaterAtMs: nowMs,
    // A routine refresh may renew a healthy lease, but may never erase a
    // quarantine. Only recoverSessionAuthority below represents the full
    // credential proof + hydration + exact-authority re-link flow.
    quarantineReason: existing.status === 'valid' ? existing.record.quarantineReason : null,
  };
  storage.set(key(shopId, userId), JSON.stringify(record));
}

export function recoverSessionAuthority(shopId: string, userId: string, nowMs: number): void {
  if (!isSafeTime(nowMs)) throw new Error('Authority recovery time must be a safe timestamp.');
  storage.set(key(shopId, userId), JSON.stringify({
    v: 1,
    confirmedAtMs: nowMs,
    highWaterAtMs: nowMs,
    quarantineReason: null,
  } satisfies SessionAuthorityLease));
}

export function advanceSessionAuthorityHighWater(
  shopId: string,
  userId: string,
  nowMs: number,
): void {
  const state = readSessionAuthorityLease(shopId, userId);
  if (state.status !== 'valid' || nowMs <= state.record.highWaterAtMs) return;
  storage.set(key(shopId, userId), JSON.stringify({ ...state.record, highWaterAtMs: nowMs }));
}

export function quarantineSessionAuthority(
  shopId: string,
  userId: string,
  reason: string,
  nowMs: number,
): void {
  const state = readSessionAuthorityLease(shopId, userId);
  const prior = state.status === 'valid' ? state.record : null;
  const safeNow = isSafeTime(nowMs) ? nowMs : 0;
  const record: SessionAuthorityLease = {
    v: 1,
    confirmedAtMs: prior?.confirmedAtMs ?? safeNow,
    highWaterAtMs: Math.max(prior?.highWaterAtMs ?? safeNow, safeNow),
    quarantineReason: reason,
  };
  storage.set(key(shopId, userId), JSON.stringify(record));
}
