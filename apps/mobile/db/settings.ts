// db/settings.ts — the ONLY file that will touch Drizzle/SQLite for
// Settings (DEVELOPMENT_RULES.md). The Drizzle schema doesn't exist yet
// (Day 2), so these are signature-only stubs — no Drizzle import until then.

export interface ShopProfile {
  id: string;
  name: string;
  phone: string;
  address?: string;
}

// P0 slice (Volume 4 SETTINGS: "security... change own PIN — P0").
export async function getShopProfile(_shopId: string): Promise<ShopProfile> {
  throw new Error('TODO: implement shop profile query (Volume 4 SETTINGS)');
}

export async function updateShopProfile(_shopId: string, _profile: Partial<Omit<ShopProfile, 'id'>>): Promise<void> {
  throw new Error('TODO: implement shop profile update (Volume 4 SETTINGS)');
}

// TODO(P0 slice): bcrypt-hash the new PIN before writing (CLAUDE.md rule 8
// — never logged or stored in plain text). Must verify the CURRENT PIN
// first, reusing db/auth.ts's verifyPin.
export async function changeOwnPin(_userId: string, _currentRawPin: string, _newRawPin: string): Promise<void> {
  throw new Error('TODO: implement owner PIN change (Volume 4 SETTINGS, CLAUDE.md rule 8)');
}

// TODO(P1): backup key restore-on-new-phone (Volume 4 SETTINGS: "backup key
// restore-on-new-phone is P1"). Depends on Day 13's backup mechanism
// (Volume 3 BACKUP STRATEGY) — not implementable before that exists.
export async function restoreFromBackupKey(_backupKey: string): Promise<{ shopId: string }> {
  throw new Error('TODO: implement backup-key restore (P1 — post-beta, Volume 4 SETTINGS)');
}
