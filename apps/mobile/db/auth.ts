// db/auth.ts — the ONLY file that will touch Drizzle/SQLite for auth
// (DEVELOPMENT_RULES.md). The Drizzle schema doesn't exist yet (Day 2), so
// these are signature-only stubs — no Drizzle/bcrypt import until then.

export interface RegisterShopInput {
  shopName: string;
  phone: string;
}

// TODO(Day 4): create the shop + owner user in one transaction. Must
// generate a unique, non-hardcoded shop id (CLAUDE.md rule 7 — a new owner
// on the same device must NEVER see a previous owner's data). The PIN
// itself is set separately by setOwnerPin, after PIN Setup.
export async function createShopAndOwner(_input: RegisterShopInput): Promise<{ shopId: string; userId: string }> {
  throw new Error('TODO: implement shop + owner creation (Volume 0 Day 4, CLAUDE.md rule 7)');
}

// TODO(Day 4): bcrypt-hash the PIN before it's written — CLAUDE.md rule 8:
// never logged or stored in plain text. Caller (PIN Setup screen) must not
// pass the raw PIN to any logging path either.
export async function setOwnerPin(_userId: string, _rawPin: string): Promise<void> {
  throw new Error('TODO: implement bcrypt PIN hashing + write (Volume 0 Day 4, CLAUDE.md rule 8)');
}

// TODO(Day 5): check the raw PIN against the stored bcrypt hash, fully
// offline. Returns the session (shop_id + role) on success — Volume 4:
// "Both converge on a session carrying shop_id + role."
export async function verifyPin(_userId: string, _rawPin: string): Promise<{ shopId: string; role: 'owner' | 'staff' } | null> {
  throw new Error('TODO: implement offline bcrypt PIN verification (Volume 0 Day 5)');
}
