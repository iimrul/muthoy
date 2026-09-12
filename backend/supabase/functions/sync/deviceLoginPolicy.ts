export type DeviceLoginRole = "owner" | "manager" | "staff";

export interface DeviceLoginCandidate {
  id: string;
  shop_id: string;
  pin_hash: string | null;
  pin_set_at: string | null;
  is_active: boolean;
  is_deleted: boolean;
  plan_suspended_at: string | null;
  roles: { name: string; is_deleted: boolean } | null;
  shops: { archived_at: string | null; is_deleted: boolean } | null;
}

export interface DeviceLoginActor {
  id: string;
  shopId: string;
  pinHash: string;
  roleName: DeviceLoginRole;
}

/**
 * Converts the server-selected users row into the only actor device-login may
 * authenticate. Client input never participates in the shop decision.
 */
export function resolveDeviceLoginActor(
  candidate: DeviceLoginCandidate | null,
): DeviceLoginActor | null {
  if (
    !candidate ||
    candidate.is_deleted ||
    !candidate.is_active ||
    candidate.plan_suspended_at !== null ||
    !candidate.pin_hash ||
    !candidate.pin_set_at ||
    !candidate.roles ||
    candidate.roles.is_deleted ||
    !candidate.shops ||
    candidate.shops.is_deleted ||
    candidate.shops.archived_at !== null
  ) {
    return null;
  }

  const roleName = candidate.roles.name;
  if (roleName !== "owner" && roleName !== "manager" && roleName !== "staff") {
    return null;
  }

  return {
    id: candidate.id,
    shopId: candidate.shop_id,
    pinHash: candidate.pin_hash,
    roleName,
  };
}

/** Both values come from the resolved database actor, never request metadata. */
export function deviceLoginAppMetadata(shopId: string): {
  shop_id: string;
  active_shop_id: string;
} {
  return { shop_id: shopId, active_shop_id: shopId };
}

export function mintedSessionMatchesActor(
  minted: {
    authUserId: string;
    appUserId: string | null;
    shopId: string | null;
  },
  expected: { authUserId: string; appUserId: string; shopId: string },
): boolean {
  return (
    minted.authUserId === expected.authUserId &&
    minted.appUserId === expected.appUserId &&
    minted.shopId === expected.shopId
  );
}
