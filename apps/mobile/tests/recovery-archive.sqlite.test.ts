import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { asPaisa } from "@muthoy/types";
import { sqlite } from "../db/test/expo-sqlite";
import { ALWAYS_LIVE } from "../db/errors";
import {
  RECOVERY_BUSINESS_TABLES,
  openRecoverySnapshot,
  recoveryHex,
  recoveryUtf8,
  sealRecoverySnapshot,
  type RecoveryHeader,
  type RecoverySnapshot,
} from "../domain/recoveryArchive";
import {
  webRecoveryCipher,
  syntheticRecoveryCode,
} from "./recoveryTestSupport";
vi.mock("../native/prescriptionAttachment", () => ({
  preparePrescriptionAttachment: vi.fn(),
  removePreparedPrescriptionAttachment: vi.fn(),
}));
vi.mock("../native/recoveryCrypto", () => ({ nativeRecoveryCipher: null }));
const { db } = await import("../db/test/client");
const schema = await import("../db/schema");
const {
  captureRecoverySnapshot,
  importRecoverySnapshot,
  getRecoveryExposure,
  recordVerifiedRecoveryBackup,
} = await import("../db/recoveryArchive");
const { recordChange } = await import("../db/sync-helpers");
const { recordConflict, resolveConflict } = await import("../db/conflicts");
const { createMedicineOnly, addBatchToMedicine } =
  await import("../db/inventory");
const { createSaleTransaction } = await import("../db/sales");
const { createFullSaleRefund, getRefundEligibility } =
  await import("../db/refunds");
const { collectPayment } = await import("../db/customers");
const { createPurchase } = await import("../db/purchases");
const {
  setOpeningCash,
  recordExpense,
  recordWithdrawal,
  currentBusinessDate,
  getCashSummarySync,
} = await import("../db/cash");
const { expectedCash } = await import("../domain/cashFormula");
const { publishPreparedRecoveryArchive } =
  await import("../sync/recoveryBackup");
const journal = JSON.parse(
  readFileSync("apps/mobile/db/migrations/meta/_journal.json", "utf8"),
) as { entries: { tag: string }[] };
const migrationSql = journal.entries.map((e) =>
  readFileSync("apps/mobile/db/migrations/" + e.tag + ".sql", "utf8"),
);
const destinations: DatabaseSync[] = [];
let sequence = 0;
beforeAll(() => {
  for (const sql of migrationSql) sqlite.exec(sql);
});
afterEach(() => {
  for (const target of destinations.splice(0)) target.close();
  vi.restoreAllMocks();
});
function target() {
  const raw = new DatabaseSync(":memory:");
  for (const sql of migrationSql) raw.exec(sql);
  destinations.push(raw);
  const connection = {
    execSync: (sql: string) => raw.exec(sql),
    prepareSync: (sql: string) => ({
      executeSync: (params: (string | number | null)[] = []) => {
        const statement = raw.prepare(sql);
        if (/^\s*(select|pragma|with)\b/i.test(sql))
          return { getAllSync: () => statement.all(...params) };
        statement.run(...params);
        return { getAllSync: () => [] };
      },
    }),
  };
  return { raw, connection };
}
async function fixture(full = false) {
  const n = ++sequence,
    id = (slot: number) =>
      `79000000-${String(n).padStart(4, "0")}-4000-8000-${String(slot).padStart(12, "0")}`;
  const shop = id(1),
    owner = id(2),
    role = id(3),
    staff = id(4),
    staffRole = id(5),
    account = id(6),
    supplier = id(7);
  const now = new Date().toISOString();
  db.insert(schema.shops)
    .values({
      id: shop,
      ownerId: owner,
      name: "Synthetic recovery only",
      phone: "01700000000",
    })
    .run();
  db.insert(schema.roles)
    .values([
      { id: role, shopId: shop, name: "owner" },
      { id: staffRole, shopId: shop, name: "staff" },
    ])
    .run();
  db.insert(schema.users)
    .values([
      {
        id: owner,
        shopId: shop,
        roleId: role,
        name: "Synthetic Owner",
        pinHash: "not-an-actual-credential",
        isActive: true,
      },
      {
        id: staff,
        shopId: shop,
        roleId: staffRole,
        name: "Synthetic Staff",
        pinHash: "not-an-actual-credential",
        isActive: true,
      },
    ])
    .run();
  db.insert(schema.billingAccounts)
    .values({
      id: account,
      principalOwnerUserId: owner,
      primaryShopId: shop,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.shopDirectory)
    .values({
      shopId: shop,
      billingAccountId: account,
      name: "Synthetic",
      commercialStatus: "active",
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(schema.entitlementCache)
    .values({
      billingAccountId: account,
      tier: "pro",
      status: "active",
      paidThrough: "2099-01-01T00:00:00.000Z",
      verifiedAt: now,
      lastObservedAt: now,
      version: 1,
      updatedAt: now,
    })
    .run();
  const { medicineId } = await createMedicineOnly({
    shopId: shop,
    actorUserId: owner,
    name: "Synthetic recovery medicine",
    isStillActive: ALWAYS_LIVE,
  });
  const { batchId } = await addBatchToMedicine({
    shopId: shop,
    actorUserId: owner,
    medicineId,
    batchNo: "SYNTH-RECOVERY",
    quantity: 10,
    purchasePrice: asPaisa(100),
    salePrice: asPaisa(115),
    isStillActive: ALWAYS_LIVE,
  });
  if (full) {
    await setOpeningCash({
      shopId: shop,
      staffId: owner,
      businessDate: currentBusinessDate(),
      openingCash: asPaisa(10000),
      isStillActive: ALWAYS_LIVE,
    });
    const cash = await createSaleTransaction({
      shopId: shop,
      staffId: owner,
      payment: { type: "cash", tendered: asPaisa(230) },
      lines: [{ medicineId, quantity: 2 }],
      isStillActive: ALWAYS_LIVE,
    });
    const eligible = await getRefundEligibility(shop, owner, cash.saleId);
    await createFullSaleRefund({
      shopId: shop,
      actorUserId: owner,
      saleId: cash.saleId,
      reason: "Synthetic recovery fixture",
      claim: {
        claimId: id(20),
        claimToken: "synthetic-non-hosted-authority",
        operationId: eligible.operationId,
        deviceId: id(8),
      },
      currentDeviceId: id(8),
      isStillActive: ALWAYS_LIVE,
    });
    const credit = await createSaleTransaction({
      shopId: shop,
      staffId: owner,
      payment: { type: "credit" },
      newCustomer: { name: "Synthetic recovery customer" },
      lines: [{ medicineId, quantity: 2 }],
      isStillActive: ALWAYS_LIVE,
    });
    const customer = sqlite
      .prepare("select customer_id from sales where id=?")
      .get(credit.saleId) as { customer_id: string };
    await collectPayment({
      shopId: shop,
      staffId: owner,
      customerId: customer.customer_id,
      amount: asPaisa(30),
      method: "cash",
      isStillActive: ALWAYS_LIVE,
    });
    db.insert(schema.suppliers)
      .values({
        id: supplier,
        shopId: shop,
        name: "Synthetic recovery supplier",
      })
      .run();
    await createPurchase({
      shopId: shop,
      staffId: owner,
      supplierId: supplier,
      paymentType: "cod",
      lineItems: [
        {
          medicineId,
          batchNo: "SYNTH-PURCHASE",
          expiryDate: null,
          quantity: 2,
          purchasePrice: asPaisa(100),
          salePrice: asPaisa(115),
        },
      ],
      isStillActive: ALWAYS_LIVE,
    });
    await recordExpense({
      shopId: shop,
      staffId: owner,
      category: "other",
      amount: asPaisa(50),
      description: "Synthetic",
      isStillActive: ALWAYS_LIVE,
    });
    await recordWithdrawal({
      shopId: shop,
      staffId: owner,
      amount: asPaisa(25),
      isStillActive: ALWAYS_LIVE,
    });
  }
  const header: RecoveryHeader = {
    version: 1,
    schemaVersion: 35,
    shopId: shop,
    ownerId: owner,
    deviceId: id(8),
    archiveId: id(9),
    watermark: 0,
    previousSha256: null,
    createdAt: now,
  };
  const coverage = {
    actorUserId: owner,
    saleHistoryScope: "all" as const,
    readableTables: RECOVERY_BUSINESS_TABLES,
  };
  return {
    shop,
    owner,
    staff,
    medicineId,
    batchId,
    header,
    coverage,
    snapshot: () => captureRecoverySnapshot(header, coverage, ALWAYS_LIVE),
  };
}
async function sealed(snapshot: RecoverySnapshot) {
  const archive = await sealRecoverySnapshot(
    snapshot,
    syntheticRecoveryCode,
    webRecoveryCipher,
  );
  const sha = recoveryHex(
    await webRecoveryCipher.sha256(recoveryUtf8(archive)),
  );
  return { archive, sha };
}
function memoryStorage() {
  const objects = new Map<string, string>();
  return {
    objects,
    putImmutable: vi.fn(async (path: string, archive: string) => {
      if (!objects.has(path)) objects.set(path, archive);
    }),
    download: vi.fn(async (path: string) => {
      const value = objects.get(path);
      if (!value) throw new Error("missing");
      return value;
    }),
  };
}
function ledger(shop: string) {
  return Object.fromEntries(
    [
      "sales",
      "sale_items",
      "inventory_movements",
      "batches",
      "cash_drawer",
      "credits",
      "payments",
      "purchases",
      "purchase_items",
      "sale_refunds",
      "sales_returns",
      "refund_tenders",
      "credit_payment_allocations",
      "sync_queue",
    ].map((table) => [
      table,
      sqlite
        .prepare(`select * from ${table} where shop_id=? order by id`)
        .all(shop),
    ]),
  );
}
describe("real SQLite transaction journal and isolated recovery", () => {
  it("captures real sale/refund/credit/purchase/cash writers and restores exact ledgers once", async () => {
    const f = await fixture(true),
      before = ledger(f.shop),
      snapshot = await f.snapshot();
    expect(
      expectedCash(getCashSummarySync(f.shop, currentBusinessDate())),
    ).toBe(9755);
    expect(
      sqlite
        .prepare("select sum(stock) stock from batches where shop_id=?")
        .get(f.shop),
    ).toEqual({ stock: 10 });
    expect(
      sqlite
        .prepare("select amount,balance from credits where shop_id=?")
        .all(f.shop),
    ).toEqual([{ amount: 230, balance: 200 }]);
    expect(snapshot.tables.sale_refunds).toHaveLength(1);
    expect(snapshot.tables.purchase_items).toHaveLength(1);
    expect(snapshot.tables.sync_queue.length).toBeGreaterThan(20);
    expect(
      snapshot.tables.users.every(
        (u) => u.pin_hash === "RECOVERY_REAUTH_REQUIRED",
      ),
    ).toBe(true);
    const { archive, sha } = await sealed(snapshot),
      recovered = await openRecoverySnapshot(
        archive,
        syntheticRecoveryCode,
        f.shop,
        webRecoveryCipher,
      ),
      dest = target();
    expect(
      importRecoverySnapshot(dest.connection, recovered, sha, {
        shopId: f.shop,
        ownerId: f.owner,
      }),
    ).toBe("imported");
    for (const [table, expected] of Object.entries(before))
      expect(
        dest.raw
          .prepare(`select * from ${table} where shop_id=? order by id`)
          .all(f.shop),
        table,
      ).toEqual(expected);
    expect(dest.raw.prepare("pragma foreign_key_check").all()).toEqual([]);
    expect(
      importRecoverySnapshot(dest.connection, recovered, sha, {
        shopId: f.shop,
        ownerId: f.owner,
      }),
    ).toBe("already_imported");
    expect(ledger(f.shop)).toEqual(before);
  });
  it("journal append failure rolls back a real stock writer and its outbox", async () => {
    const f = await fixture(),
      before = ledger(f.shop);
    sqlite.exec(
      "create trigger synthetic_journal_failure before insert on recovery_journal begin select raise(abort,'synthetic journal disk failure'); end",
    );
    try {
      await expect(
        addBatchToMedicine({
          shopId: f.shop,
          actorUserId: f.owner,
          medicineId: f.medicineId,
          batchNo: "FAIL",
          quantity: 3,
          purchasePrice: asPaisa(100),
          salePrice: asPaisa(115),
          isStillActive: ALWAYS_LIVE,
        }),
      ).rejects.toThrow("synthetic journal disk failure");
    } finally {
      sqlite.exec("drop trigger synthetic_journal_failure");
    }
    expect(ledger(f.shop)).toEqual(before);
  });
  it("keeps an immutable journal after original outbox acknowledgment and pruning", async () => {
    const f = await fixture(),
      before = sqlite
        .prepare("select * from recovery_journal where shop_id=? order by id")
        .all(f.shop);
    sqlite
      .prepare("update sync_queue set status='sent' where shop_id=?")
      .run(f.shop);
    sqlite.prepare("delete from sync_queue where shop_id=?").run(f.shop);
    expect(
      sqlite
        .prepare("select * from recovery_journal where shop_id=? order by id")
        .all(f.shop),
    ).toEqual(before);
    expect(() =>
      sqlite
        .prepare("update recovery_journal set payload='{}' where shop_id=?")
        .run(f.shop),
    ).toThrow("immutable");
    expect(() =>
      sqlite
        .prepare("delete from recovery_journal where shop_id=?")
        .run(f.shop),
    ).toThrow("immutable");
  });
  it("preserves pending and failed identities without double stock or cash effects", async () => {
    const f = await fixture();
    sqlite
      .prepare(
        "update sync_queue set status='failed',attempts=2,last_error='synthetic offline' where shop_id=? and table_name='batches'",
      )
      .run(f.shop);
    const snapshot = await f.snapshot(),
      dest = target(),
      { sha } = await sealed(snapshot);
    importRecoverySnapshot(dest.connection, snapshot, sha, {
      shopId: f.shop,
      ownerId: f.owner,
    });
    expect(
      dest.raw
        .prepare(
          "select id,status,attempts,payload from sync_queue order by id",
        )
        .all(),
    ).toEqual(
      sqlite
        .prepare(
          "select id,status,attempts,payload from sync_queue where shop_id=? order by id",
        )
        .all(f.shop),
    );
    expect(
      dest.raw
        .prepare("select sum(change_qty) qty from inventory_movements")
        .get(),
    ).toEqual({ qty: 10 });
  });
  it("rejects Staff, foreign shop, incomplete Owner materialization and handover", async () => {
    const f = await fixture(),
      other = await fixture();
    await expect(
      captureRecoverySnapshot(
        { ...f.header, ownerId: f.staff },
        { ...f.coverage, actorUserId: f.staff },
        ALWAYS_LIVE,
      ),
    ).rejects.toThrow();
    await expect(
      captureRecoverySnapshot(
        { ...f.header, ownerId: other.owner },
        { ...f.coverage, actorUserId: other.owner },
        ALWAYS_LIVE,
      ),
    ).rejects.toThrow();
    await expect(
      captureRecoverySnapshot(
        f.header,
        { ...f.coverage, saleHistoryScope: "own" },
        ALWAYS_LIVE,
      ),
    ).rejects.toThrow("Complete Owner");
    await expect(
      captureRecoverySnapshot(
        f.header,
        { ...f.coverage, readableTables: f.coverage.readableTables.slice(1) },
        ALWAYS_LIVE,
      ),
    ).rejects.toThrow("Complete Owner");
    await expect(
      captureRecoverySnapshot(f.header, f.coverage, () => false),
    ).rejects.toThrow();
    const snapshot = await f.snapshot();
    expect(JSON.stringify(snapshot)).not.toContain(other.owner);
  });
  it("rejects a foreign parent graph and rolls back the whole isolated import", async () => {
    const f = await fixture(),
      snapshot = await f.snapshot();
    snapshot.tables.batches[0]!.medicine_id = "foreign-or-missing";
    const dest = target(),
      { sha } = await sealed(snapshot);
    expect(() =>
      importRecoverySnapshot(dest.connection, snapshot, sha, {
        shopId: f.shop,
        ownerId: f.owner,
      }),
    ).toThrow();
    expect(dest.raw.prepare("select count(*) n from shops").get()).toEqual({
      n: 0,
    });
    expect(
      dest.raw.prepare("select count(*) n from recovery_import_receipts").get(),
    ).toEqual({ n: 0 });
  });
  it("refuses changed money precision and complete-group corruption before any import", async () => {
    const f = await fixture(true),
      s = await f.snapshot(),
      dest = target();
    s.tables.credits[0]!.amount = 1.5;
    expect(() =>
      importRecoverySnapshot(dest.connection, s, "ab".repeat(32), {
        shopId: f.shop,
        ownerId: f.owner,
      }),
    ).toThrow("Unsafe recovery numeric");
    const grouped = await f.snapshot();
    const item = grouped.tables.recovery_journal.find(
      (r) => r.operation_group_id !== null,
    )!;
    grouped.tables.recovery_journal = grouped.tables.recovery_journal.filter(
      (r) => r !== item,
    );
    expect(() =>
      importRecoverySnapshot(dest.connection, grouped, "ab".repeat(32), {
        shopId: f.shop,
        ownerId: f.owner,
      }),
    ).toThrow("Incomplete recovery operation group");
    expect(dest.raw.prepare("select count(*) n from shops").get()).toEqual({
      n: 0,
    });
  });
  it("rolls back imported financial rows on a destination disk-write fault", async () => {
    const f = await fixture(true),
      s = await f.snapshot(),
      dest = target(),
      { sha } = await sealed(s);
    dest.raw.exec(
      "create trigger synthetic_restore_failure before insert on credits begin select raise(abort,'synthetic restore disk failure'); end",
    );
    expect(() =>
      importRecoverySnapshot(dest.connection, s, sha, {
        shopId: f.shop,
        ownerId: f.owner,
      }),
    ).toThrow("synthetic restore disk failure");
    expect(dest.raw.prepare("select count(*) n from sales").get()).toEqual({
      n: 0,
    });
    expect(dest.raw.prepare("select count(*) n from shops").get()).toEqual({
      n: 0,
    });
  });
  it("refuses a populated destination, changed replay receipt and modified restored ledger", async () => {
    const f = await fixture(),
      s = await f.snapshot(),
      dest = target(),
      { sha } = await sealed(s);
    importRecoverySnapshot(dest.connection, s, sha, {
      shopId: f.shop,
      ownerId: f.owner,
    });
    expect(() =>
      importRecoverySnapshot(
        dest.connection,
        {
          ...s,
          header: {
            ...s.header,
            archiveId: "79000000-0000-4000-8000-000000000099",
          },
        },
        sha,
        { shopId: f.shop, ownerId: f.owner },
      ),
    ).toThrow("not empty");
    expect(() =>
      importRecoverySnapshot(dest.connection, s, "cd".repeat(32), {
        shopId: f.shop,
        ownerId: f.owner,
      }),
    ).toThrow("receipt");
    dest.raw.exec("update batches set sale_price=999");
    expect(() =>
      importRecoverySnapshot(dest.connection, s, sha, {
        shopId: f.shop,
        ownerId: f.owner,
      }),
    ).toThrow("restored rows changed");
  });
  it("does not mark an upload ACK as protection when download fails or is corrupted", async () => {
    const f = await fixture(),
      s = await f.snapshot(),
      { archive } = await sealed(s),
      storage = memoryStorage();
    storage.download.mockRejectedValueOnce(
      new Error("synthetic connection lost"),
    );
    await expect(
      publishPreparedRecoveryArchive(
        archive,
        syntheticRecoveryCode,
        f.shop,
        storage,
        ALWAYS_LIVE,
        webRecoveryCipher,
      ),
    ).rejects.toThrow("connection lost");
    expect(
      (await getRecoveryExposure(f.shop, f.owner, f.header.deviceId))
        .protectedWatermark,
    ).toBeNull();
    storage.download.mockResolvedValueOnce("corrupted");
    await expect(
      publishPreparedRecoveryArchive(
        archive,
        syntheticRecoveryCode,
        f.shop,
        storage,
        ALWAYS_LIVE,
        webRecoveryCipher,
      ),
    ).rejects.toThrow("digest mismatch");
    expect(
      (await getRecoveryExposure(f.shop, f.owner, f.header.deviceId))
        .protectedWatermark,
    ).toBeNull();
  });
  it("advances protection only after real decrypt/readback and conservatively exposes later offline changes", async () => {
    const f = await fixture(),
      s = await f.snapshot(),
      { archive } = await sealed(s),
      storage = memoryStorage();
    await publishPreparedRecoveryArchive(
      archive,
      syntheticRecoveryCode,
      f.shop,
      storage,
      ALWAYS_LIVE,
      webRecoveryCipher,
    );
    expect(
      await getRecoveryExposure(f.shop, f.owner, f.header.deviceId),
    ).toEqual({
      protectedWatermark: s.header.watermark,
      unprotectedChanges: 0,
    });
    await createMedicineOnly({
      shopId: f.shop,
      actorUserId: f.owner,
      name: "New synthetic offline medicine",
      isStillActive: ALWAYS_LIVE,
    });
    expect(
      (await getRecoveryExposure(f.shop, f.owner, f.header.deviceId))
        .unprotectedChanges,
    ).toBe(1);
    await expect(
      recordVerifiedRecoveryBackup(
        {
          header: { ...s.header, watermark: s.header.watermark - 1 },
          archiveSha256: "ab".repeat(32),
          verifiedAt: new Date().toISOString(),
        },
        ALWAYS_LIVE,
      ),
    ).rejects.toThrow("Stale");
  });
  it("same immutable archive retry is idempotent without overwriting the protected anchor", async () => {
    const f = await fixture(),
      s = await f.snapshot(),
      { archive } = await sealed(s),
      storage = memoryStorage();
    const receipt = await publishPreparedRecoveryArchive(
      archive,
      syntheticRecoveryCode,
      f.shop,
      storage,
      ALWAYS_LIVE,
      webRecoveryCipher,
    );
    expect(
      (
        await publishPreparedRecoveryArchive(
          archive,
          syntheticRecoveryCode,
          f.shop,
          storage,
          ALWAYS_LIVE,
          webRecoveryCipher,
        )
      ).archiveSha256,
    ).toBe(receipt.archiveSha256);
    expect(storage.objects.size).toBe(1);
  });
});

describe("journal upgrade and fail-closed source prerequisites", () => {
  it("backfills pre-upgrade pending/failed/sent identities without altering the old queue", () => {
    const old = new DatabaseSync(":memory:");
    try {
      const journalIndex = journal.entries.findIndex((entry) => entry.tag === "0034_recovery_journal");
      expect(journalIndex).toBeGreaterThan(0);
      for (const sql of migrationSql.slice(0, journalIndex)) old.exec(sql);
      for (const [index, status] of ["pending", "failed", "sent"].entries())
        old
          .prepare(
            `insert into sync_queue(id,seq,shop_id,table_name,row_id,op,payload,status,attempts,last_error) values(?,?,?,?,?,'update',?,?,?,?)`,
          )
          .run(
            "synthetic-old-" + index,
            index + 1,
            "synthetic-old-shop",
            "medicines",
            "synthetic-old-med-" + index,
            JSON.stringify({
              id: "synthetic-old-med-" + index,
              shop_id: "synthetic-old-shop",
              name: "Synthetic preserved outbox",
            }),
            status,
            index,
            index ? "synthetic old failure" : null,
          );
      const before = old
        .prepare("select * from sync_queue order by seq,id")
        .all();
      old.exec(migrationSql[journalIndex]!);
      expect(
        old.prepare("select * from sync_queue order by seq,id").all(),
      ).toEqual(before);
      expect(
        old
          .prepare(
            "select queue_id,outbox_seq,shop_id,table_name,row_id,op,payload,operation_group_id,operation_kind,operation_sequence,operation_expected_count,created_at from recovery_journal order by id",
          )
          .all(),
      ).toEqual(
        before.map((row) => ({
          queue_id: row.id,
          outbox_seq: row.seq,
          shop_id: row.shop_id,
          table_name: row.table_name,
          row_id: row.row_id,
          op: row.op,
          payload: row.payload,
          operation_group_id: row.operation_group_id,
          operation_kind: row.operation_kind,
          operation_sequence: row.operation_sequence,
          operation_expected_count: row.operation_expected_count,
          created_at: row.created_at,
        })),
      );
    } finally {
      old.close();
    }
  });
  it("missing journal migration refuses a real stock writer without losing old journal rows", async () => {
    const f = await fixture(),
      before = ledger(f.shop),
      journalBefore = sqlite
        .prepare("select * from recovery_journal where shop_id=? order by id")
        .all(f.shop);
    sqlite.exec(
      "alter table recovery_journal rename to synthetic_saved_recovery_journal",
    );
    try {
      await expect(
        addBatchToMedicine({
          shopId: f.shop,
          actorUserId: f.owner,
          medicineId: f.medicineId,
          batchNo: "MISSING-JOURNAL",
          quantity: 3,
          purchasePrice: asPaisa(100),
          salePrice: asPaisa(115),
          isStillActive: ALWAYS_LIVE,
        }),
      ).rejects.toThrow("no such table: recovery_journal");
    } finally {
      sqlite.exec(
        "alter table synthetic_saved_recovery_journal rename to recovery_journal",
      );
    }
    expect(ledger(f.shop)).toEqual(before);
    expect(
      sqlite
        .prepare("select * from recovery_journal where shop_id=? order by id")
        .all(f.shop),
    ).toEqual(journalBefore);
  });
  it("refuses a stock projection that disagrees with its archived movement identities", async () => {
    const f = await fixture(),
      snapshot = await f.snapshot(),
      dest = target();
    snapshot.tables.batches[0]!.stock = 999;
    const { sha } = await sealed(snapshot);
    expect(() =>
      importRecoverySnapshot(dest.connection, snapshot, sha, {
        shopId: f.shop,
        ownerId: f.owner,
      }),
    ).toThrow("Restored recovery rows differ");
    expect(
      dest.raw.prepare("select count(*) n from inventory_movements").get(),
    ).toEqual({ n: 0 });
    expect(dest.raw.prepare("select count(*) n from shops").get()).toEqual({
      n: 0,
    });
  });
});

describe("pending payload dependency isolation", () => {
  it("refuses a dangling queued FK even when the current live batch is valid", async () => {
    const f = await fixture(),
      snapshot = await f.snapshot(),
      dest = target();
    const queued = snapshot.tables.sync_queue.find(
      (row) => row.table_name === "batches",
    )!;
    const payload = JSON.parse(String(queued.payload)) as Record<
      string,
      unknown
    >;
    payload.medicine_id = "another-shop-or-missing-parent";
    queued.payload = JSON.stringify(payload);
    expect(snapshot.tables.batches[0]!.medicine_id).toBe(f.medicineId);
    const { sha } = await sealed(snapshot);
    expect(() =>
      importRecoverySnapshot(dest.connection, snapshot, sha, {
        shopId: f.shop,
        ownerId: f.owner,
      }),
    ).toThrow("Recovery dependency missing from the isolated shop graph");
    expect(dest.raw.prepare("select count(*) n from shops").get()).toEqual({
      n: 0,
    });
  });
});

describe("credential-free resolved conflict recovery", () => {
  it("redacts the real keep-remote writer's serialized user payload without modifying source evidence", async () => {
    const f = await fixture();
    const local = sqlite.prepare("select * from users where shop_id=? and id<>?").get(f.shop, f.owner) as Record<string, string | number | null>;
    const syntheticHash = "$2a$10$abcdefghijklmnopqrstuu03XQq4uczTxEDPe3ML4iARROHzHJ0n6";
    sqlite.prepare("update users set pin_hash=? where id=?").run(syntheticHash, local.id!);
    local.pin_hash = syntheticHash;
    const remote = { ...local, name: "Synthetic resolved user", updated_at: new Date(Date.parse(String(local.updated_at)) + 1000).toISOString() };
    db.transaction((tx) => {
      recordChange(tx, { shopId: f.shop, table: "users", rowId: String(local.id), op: "update", payload: {} });
      recordConflict(tx, { shopId: f.shop, tableName: "users", rowId: String(local.id), reason: "push_superseded", localValue: local, remoteValue: remote, localUpdatedAt: String(local.updated_at), remoteUpdatedAt: remote.updated_at });
    });
    const conflict = sqlite.prepare("select id from conflict_queue where shop_id=? and row_id=? and resolved=0").get(f.shop, local.id!) as { id: string };
    await resolveConflict(f.shop, conflict.id, f.owner, "keep_remote", ALWAYS_LIVE);
    const sourceConflict = sqlite.prepare("select * from conflict_queue where id=?").get(conflict.id) as Record<string, string | number | null>;
    const saved = JSON.parse(String(sourceConflict.superseded_payloads)) as { id: string; seq: number; op: string; payload: string }[];
    expect(saved).toHaveLength(1);
    expect(JSON.parse(saved[0]!.payload).pin_hash).toBe(syntheticHash);
    const journalBefore = sqlite.prepare("select * from recovery_journal where shop_id=? order by id").all(f.shop);
    f.header.watermark = Number((sqlite.prepare("select max(id) n from recovery_journal where shop_id=?").get(f.shop) as { n: number }).n);
    const before = ledger(f.shop);
    const snapshot = await f.snapshot();
    const archived = snapshot.tables.conflict_queue.find((row) => row.id === conflict.id)!;
    const superseded = JSON.parse(String(archived.superseded_payloads)) as typeof saved;
    expect(superseded[0]!.id).toBe(saved[0]!.id);
    expect(superseded[0]!.seq).toBe(saved[0]!.seq);
    expect(JSON.parse(superseded[0]!.payload).pin_hash).toBe("RECOVERY_REAUTH_REQUIRED");
    expect(JSON.stringify(snapshot)).not.toContain(syntheticHash);
    const { archive, sha } = await sealed(snapshot);
    const decrypted = await openRecoverySnapshot(archive, syntheticRecoveryCode, f.shop, webRecoveryCipher);
    expect(JSON.stringify(decrypted)).not.toContain(syntheticHash);
    const dest = target();
    expect(importRecoverySnapshot(dest.connection, decrypted, sha, { shopId: f.shop, ownerId: f.owner })).toBe("imported");
    expect(String((dest.raw.prepare("select superseded_payloads from conflict_queue where id=?").get(conflict.id) as { superseded_payloads: string }).superseded_payloads)).not.toContain(syntheticHash);
    expect(sqlite.prepare("select * from conflict_queue where id=?").get(conflict.id)).toEqual(sourceConflict);
    expect(sqlite.prepare("select * from recovery_journal where shop_id=? order by id").all(f.shop)).toEqual(journalBefore);
    expect(ledger(f.shop)).toEqual(before);
    expect((sqlite.prepare("select pin_hash from users where id=?").get(local.id!) as { pin_hash: string }).pin_hash).toBe(syntheticHash);
  });
});
