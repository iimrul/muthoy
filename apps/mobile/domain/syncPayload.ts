// Wire identity must agree with the shop and row the caller requested.
// Permissions inherit their shop through roles; db/ resolves that FK.
export function assertSyncPayloadIdentity(
  tableName: string,
  payload: Readonly<Record<string, unknown>>,
  expected: { shopId: string; rowId?: string },
): void {
  if (
    typeof payload.id !== "string" || !payload.id ||
    (expected.rowId !== undefined && payload.id !== expected.rowId)
  ) {
    throw new Error("Sync payload does not match its row identity.");
  }
  if (tableName === "permissions") {
    if (typeof payload.role_id !== "string" || !payload.role_id) {
      throw new Error("Sync permission payload has no role identity.");
    }
    return;
  }
  const shopId = tableName === "shops" ? payload.id : payload.shop_id;
  if (!expected.shopId || shopId !== expected.shopId) {
    throw new Error("Sync payload does not belong to the requested shop.");
  }
}
