import { and, desc, eq } from "drizzle-orm";
import { requirePermission } from "./auth";
import { db } from "./client";
import { assertSessionLive } from "./errors";
import { medicines, saleDraftItems, saleDrafts, users } from "./schema";
import {
  recordChange,
  stampUpdatedAt,
  type SyncOperationGroup,
} from "./sync-helpers";
import { generateId } from "../native/id";

export interface HoldSaleDraftInput {
  shopId: string;
  actorUserId: string;
  originDeviceId: string;
  isStillActive: () => boolean;
  items: { medicineId: string; quantity: number }[];
  checkoutSnapshot?: Record<string, unknown>;
  prescription?: {
    prescriptionNo?: string;
    patientName?: string;
    prescriberName?: string;
  };
}

export interface SaleDraftRow {
  id: string;
  status: "draft" | "held" | "cancelled" | "completed";
  originDeviceId: string;
  actorId: string;
  actorName: string;
  itemCount: number;
  updatedAt: string;
  canMutate: boolean;
}

export async function holdSaleDraft(
  input: HoldSaleDraftInput,
): Promise<{ draftId: string }> {
  await requirePermission(input.shopId, input.actorUserId, "sale_entry");
  if (!input.originDeviceId.trim())
    throw new Error("Origin device is required");
  if (input.items.length === 0) throw new Error("Cannot hold an empty cart");
  const merged = new Map<string, number>();
  for (const item of input.items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0)
      throw new Error("Held quantities must be positive integers");
    merged.set(
      item.medicineId,
      (merged.get(item.medicineId) ?? 0) + item.quantity,
    );
  }
  const draftId = generateId();
  db.transaction((tx) => {
    assertSessionLive(input.isStillActive);
    const actor = tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, input.actorUserId),
          eq(users.shopId, input.shopId),
          eq(users.isActive, true),
          eq(users.isDeleted, false),
        ),
      )
      .get();
    if (!actor) throw new Error("Active user does not belong to this shop");
    const found = tx
      .select({ id: medicines.id })
      .from(medicines)
      .where(
        and(eq(medicines.shopId, input.shopId), eq(medicines.isDeleted, false)),
      )
      .all();
    const allowed = new Set(found.map((row) => row.id));
    if ([...merged.keys()].some((id) => !allowed.has(id)))
      throw new Error("Held cart contains an unavailable medicine");
    const now = new Date().toISOString();
    let sequence = 0;
    const expectedCount = 1 + merged.size;
    const operation = (): SyncOperationGroup => ({
      id: draftId,
      kind: "draft_hold",
      sequence: sequence++,
      expectedCount,
    });
    const values = {
      id: draftId,
      shopId: input.shopId,
      status: "held" as const,
      originDeviceId: input.originDeviceId,
      actorId: input.actorUserId,
      checkoutSnapshot: input.checkoutSnapshot
        ? JSON.stringify(input.checkoutSnapshot)
        : null,
      prescriptionNo: input.prescription?.prescriptionNo?.trim() || null,
      patientName: input.prescription?.patientName?.trim() || null,
      prescriberName: input.prescription?.prescriberName?.trim() || null,
      createdAt: now,
      updatedAt: now,
    };
    tx.insert(saleDrafts).values(values).run();
    recordChange(tx, {
      shopId: input.shopId,
      table: "sale_drafts",
      rowId: draftId,
      op: "insert",
      payload: values,
      operation: operation(),
    });
    for (const [medicineId, qty] of merged) {
      const id = generateId();
      const itemValues = {
        id,
        shopId: input.shopId,
        draftId,
        medicineId,
        qty,
        createdAt: now,
        updatedAt: now,
      };
      tx.insert(saleDraftItems).values(itemValues).run();
      recordChange(tx, {
        shopId: input.shopId,
        table: "sale_draft_items",
        rowId: id,
        op: "insert",
        payload: itemValues,
        operation: operation(),
      });
    }
  });
  return { draftId };
}

export async function listSaleDrafts(
  shopId: string,
  actorUserId: string,
  currentDeviceId: string,
): Promise<SaleDraftRow[]> {
  await requirePermission(shopId, actorUserId, "sale_entry");
  const rows = db
    .select({
      id: saleDrafts.id,
      status: saleDrafts.status,
      originDeviceId: saleDrafts.originDeviceId,
      actorId: saleDrafts.actorId,
      actorName: users.name,
      updatedAt: saleDrafts.updatedAt,
    })
    .from(saleDrafts)
    .innerJoin(
      users,
      and(eq(users.id, saleDrafts.actorId), eq(users.shopId, shopId)),
    )
    .where(and(eq(saleDrafts.shopId, shopId), eq(saleDrafts.isDeleted, false)))
    .orderBy(desc(saleDrafts.updatedAt), desc(saleDrafts.id))
    .all();
  const itemCounts = db
    .select({ draftId: saleDraftItems.draftId, qty: saleDraftItems.qty })
    .from(saleDraftItems)
    .where(
      and(
        eq(saleDraftItems.shopId, shopId),
        eq(saleDraftItems.isDeleted, false),
      ),
    )
    .all();
  return rows.map((row) => ({
    ...row,
    itemCount: itemCounts
      .filter((item) => item.draftId === row.id)
      .reduce((sum, item) => sum + item.qty, 0),
    canMutate:
      row.originDeviceId === currentDeviceId &&
      (row.status === "draft" || row.status === "held"),
  }));
}

export async function getSaleDraft(
  shopId: string,
  actorUserId: string,
  draftId: string,
): Promise<{
  draft: typeof saleDrafts.$inferSelect;
  items: { medicineId: string; medicineName: string; quantity: number }[];
}> {
  await requirePermission(shopId, actorUserId, "sale_entry");
  const draft = db
    .select()
    .from(saleDrafts)
    .where(
      and(
        eq(saleDrafts.id, draftId),
        eq(saleDrafts.shopId, shopId),
        eq(saleDrafts.isDeleted, false),
      ),
    )
    .get();
  if (!draft) throw new Error("Held sale not found");
  const items = db
    .select({
      medicineId: saleDraftItems.medicineId,
      medicineName: medicines.name,
      quantity: saleDraftItems.qty,
    })
    .from(saleDraftItems)
    .innerJoin(
      medicines,
      and(
        eq(medicines.id, saleDraftItems.medicineId),
        eq(medicines.shopId, shopId),
      ),
    )
    .where(
      and(
        eq(saleDraftItems.draftId, draftId),
        eq(saleDraftItems.shopId, shopId),
        eq(saleDraftItems.isDeleted, false),
      ),
    )
    .all();
  return { draft, items };
}

export async function cancelSaleDraft(
  shopId: string,
  actorUserId: string,
  draftId: string,
  currentDeviceId: string,
  isStillActive: () => boolean,
): Promise<void> {
  await requirePermission(shopId, actorUserId, "sale_entry");
  db.transaction((tx) => {
    assertSessionLive(isStillActive);
    const draft = tx
      .select({
        id: saleDrafts.id,
        status: saleDrafts.status,
        originDeviceId: saleDrafts.originDeviceId,
      })
      .from(saleDrafts)
      .where(
        and(
          eq(saleDrafts.id, draftId),
          eq(saleDrafts.shopId, shopId),
          eq(saleDrafts.isDeleted, false),
        ),
      )
      .get();
    if (!draft) throw new Error("Held sale not found");
    if (draft.originDeviceId !== currentDeviceId)
      throw new Error("Held sale is read-only on this device");
    if (draft.status !== "draft" && draft.status !== "held")
      throw new Error("Only a current or held sale can be cancelled");
    const values = stampUpdatedAt({
      status: "cancelled" as const,
      isDirty: true,
    });
    tx.update(saleDrafts).set(values).where(eq(saleDrafts.id, draftId)).run();
    recordChange(tx, {
      shopId,
      table: "sale_drafts",
      rowId: draftId,
      op: "update",
      payload: values,
      operation: {
        id: draftId,
        kind: "draft_cancel",
        sequence: 0,
        expectedCount: 1,
      },
    });
  });
}

export function markSaleDraftCompleted(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  shopId: string,
  draftId: string,
  saleId: string,
  currentDeviceId: string,
  operation?: SyncOperationGroup,
): void {
  const draft = tx
    .select({
      status: saleDrafts.status,
      originDeviceId: saleDrafts.originDeviceId,
    })
    .from(saleDrafts)
    .where(
      and(
        eq(saleDrafts.id, draftId),
        eq(saleDrafts.shopId, shopId),
        eq(saleDrafts.isDeleted, false),
      ),
    )
    .get();
  if (
    !draft ||
    draft.originDeviceId !== currentDeviceId ||
    (draft.status !== "draft" && draft.status !== "held")
  ) {
    throw new Error("Held sale cannot be completed on this device");
  }
  const values = stampUpdatedAt({
    status: "completed" as const,
    completedSaleId: saleId,
    isDirty: true,
  });
  tx.update(saleDrafts).set(values).where(eq(saleDrafts.id, draftId)).run();
  recordChange(tx, {
    shopId,
    table: "sale_drafts",
    rowId: draftId,
    op: "update",
    payload: values,
    operation,
  });
}
