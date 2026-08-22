import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimsFor,
  createBareHarness,
  createHarness,
  type Harness,
  migrationFiles,
  migrationSql,
  OWNER_A,
  OWNER_B,
  seedShops,
  SHOP_A,
  STAFF_A,
} from "./harness";

const SALE = "81000000-0000-4000-8000-000000000001";
const OPERATION = "82000000-0000-4000-8000-000000000001";
const OTHER_OPERATION = "82000000-0000-4000-8000-000000000002";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
  await seedShops(h);
  await h.exec(`
    insert into cash_drawer(id,shop_id,business_date,opening_cash,opened_by,opened_at,created_at,updated_at)
    values('83000000-0000-4000-8000-000000000001','${SHOP_A}',(now() at time zone 'Asia/Dhaka')::date,0,'${OWNER_A}',now(),now(),now());
    insert into sales(id,shop_id,invoice_no,business_date,subtotal,discount_amount,total,paid,change,payment_type,
      cash_applied,credit_amount,staff_id,created_at,updated_at)
    values('${SALE}','${SHOP_A}','B2-REFUND-1',(now() at time zone 'Asia/Dhaka')::date,1000,0,1000,1000,0,'cash',1000,0,'${OWNER_A}',now(),now());
  `);
}, 60_000);

afterEach(async () => h.close());

describe("B2 refund authority", () => {
  it("returns the same persisted claim for the same operation/device and rejects a competitor", async () => {
    const first = await h.one<{
      claim: { claimId: string; claimToken: string };
    }>(`select sync_claim_refund($1,$2,$3,$4,$5) claim`, [
      SHOP_A,
      SALE,
      OPERATION,
      OWNER_A,
      "device-a",
    ]);
    const retry = await h.one<{
      claim: { claimId: string; claimToken: string };
    }>(`select sync_claim_refund($1,$2,$3,$4,$5) claim`, [
      SHOP_A,
      SALE,
      OPERATION,
      OWNER_A,
      "device-a",
    ]);
    expect(retry.claim).toEqual(first.claim);
    await expect(
      h.one(`select sync_claim_refund($1,$2,$3,$4,$5)`, [
        SHOP_A,
        SALE,
        OTHER_OPERATION,
        OWNER_A,
        "device-b",
      ]),
    ).rejects.toMatchObject({ code: "MU020" });
  });

  it("denies a cross-shop actor before creating authority", async () => {
    await expect(
      h.one(`select sync_claim_refund($1,$2,$3,$4,$5)`, [
        SHOP_A,
        SALE,
        OPERATION,
        OWNER_B,
        "device-b",
      ]),
    ).rejects.toMatchObject({ code: "MU010" });
    const count = await h.one<{ count: number }>(
      "select count(*)::int count from refund_claims",
    );
    expect(count.count).toBe(0);
  });
});

describe("B2 grouped staging integrity", () => {
  it("recomputes chunk identity server-side and rejects changed rows with a reused client hash", async () => {
    const row = (status: string) =>
      JSON.stringify([
        {
          tableName: "sale_drafts",
          rowId: OPERATION,
          op: "insert",
          payload: {
            id: OPERATION,
            shop_id: SHOP_A,
            status,
            origin_device_id: "device-a",
            actor_id: OWNER_A,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            is_deleted: false,
          },
        },
      ]);
    await h.one(
      `select sync_stage_operation_chunk($1,$2,'draft_hold',$3,'device-a',2,'client-hash-0001',0,'client-hash-0001',$4::jsonb)`,
      [SHOP_A, OPERATION, OWNER_A, row("held")],
    );
    await expect(
      h.one(
        `select sync_stage_operation_chunk($1,$2,'draft_hold',$3,'device-a',2,'client-hash-0001',0,'client-hash-0001',$4::jsonb)`,
        [SHOP_A, OPERATION, OWNER_A, row("cancelled")],
      ),
    ).rejects.toMatchObject({ code: "MU025" });
  });

  it("does not grant authenticated callers direct staging or claim execution", async () => {
    await expect(
      h.as("authenticated", null, () =>
        h.one(`select sync_claim_refund($1,$2,$3,$4,$5)`, [
          SHOP_A,
          SALE,
          OPERATION,
          OWNER_A,
          "device-a",
        ]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      h.as("authenticated", null, () =>
        h.one(
          `select sync_stage_operation_chunk($1,$2,'draft_hold',$3,'device-a',1,'client-hash-0001',0,'client-hash-0001','[]'::jsonb)`,
          [SHOP_A, OPERATION, OWNER_A],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("B2 expiry-disposal authorization (M1)", () => {
  const PERM_WRITE = "84000000-0000-4000-8000-000000000001";
  const PERM_EXPIRY = "84000000-0000-4000-8000-000000000002";
  const BOGUS_BATCH = "84000000-0000-4000-8000-0000000000ba";
  const MOVEMENT = "84000000-0000-4000-8000-0000000000c0";

  const permitted = async (reason: string): Promise<boolean> =>
    (
      await h.one<{ allowed: boolean }>(
        `select sync_row_permitted($1, 'inventory_movements', $2::jsonb) as allowed`,
        [STAFF_A, JSON.stringify({ reason })],
      )
    ).allowed;

  it("requires expiry_manage on top of inventory_write for an expiry_disposal movement", async () => {
    await h.exec(`insert into user_permissions(id,shop_id,user_id,key,allowed,created_at,updated_at)
      values('${PERM_WRITE}','${SHOP_A}','${STAFF_A}','inventory_write',true,now(),now())`);
    // A plain adjustment still rides inventory_write alone — scope unchanged.
    expect(await permitted("adjustment")).toBe(true);
    // Expiry disposal is denied until expiry_manage is ALSO granted, matching
    // the client's adjustBatchStock (inventory_edit + expiry_manage).
    expect(await permitted("expiry_disposal")).toBe(false);
    await h.exec(`insert into user_permissions(id,shop_id,user_id,key,allowed,created_at,updated_at)
      values('${PERM_EXPIRY}','${SHOP_A}','${STAFF_A}','expiry_manage',true,now(),now())`);
    expect(await permitted("expiry_disposal")).toBe(true);
  });

  it("denies authenticated callers any direct inventory_movements write, so no RLS path bypasses the gate", async () => {
    await expect(
      h.as("authenticated", await claimsFor(h, STAFF_A), () =>
        h.one(
          `insert into inventory_movements
             (id,shop_id,batch_id,change_qty,reason,created_by,created_at,updated_at)
           values($1,$2,$3,-1,'expiry_disposal',$4,now(),now())`,
          [MOVEMENT, SHOP_A, BOGUS_BATCH, STAFF_A],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("B2 reconciliation backfill parity (M2)", () => {
  it("quarantines legacy credit AND payment customers as pending with a deterministic id = customer_id, matching SQLite", async () => {
    const bare = await createBareHarness();
    const ROLE = "85000000-0000-4000-8000-000000000001";
    const CUST_PAID = "85000000-0000-4000-8000-000000000010";
    const CUST_CREDIT = "85000000-0000-4000-8000-000000000011";
    const CUST_CLEAN = "85000000-0000-4000-8000-000000000012";
    const B2 = "20260821010000_phase_b2_sales_inventory_sync.sql";
    try {
      for (const name of migrationFiles()) {
        // Seed legacy history immediately BEFORE the B2 upgrade runs its backfill.
        if (name === B2) {
          await bare.exec(`
            insert into shops(id,owner_id,name,phone,created_at,updated_at)
              values('${SHOP_A}','${OWNER_A}','Shop A','+8801700000001',now(),now());
            insert into roles(id,shop_id,name,is_system,created_at,updated_at)
              values('${ROLE}','${SHOP_A}','owner',true,now(),now());
            insert into users(id,shop_id,name,pin_hash,role_id,is_active,created_at,updated_at)
              values('${OWNER_A}','${SHOP_A}','Owner','hash','${ROLE}',true,now(),now());
            insert into customers(id,shop_id,name,created_at,updated_at) values
              ('${CUST_PAID}','${SHOP_A}','Paid',now(),now()),
              ('${CUST_CREDIT}','${SHOP_A}','Credit',now(),now()),
              ('${CUST_CLEAN}','${SHOP_A}','Clean',now(),now());
            insert into payments(id,shop_id,type,party_id,amount,method,created_by,created_at,updated_at)
              values('85000000-0000-4000-8000-000000000020','${SHOP_A}','customer_payment','${CUST_PAID}',100,'cash','${OWNER_A}',now(),now());
            insert into credits(id,shop_id,customer_id,amount,balance,created_at,updated_at)
              values('85000000-0000-4000-8000-000000000021','${SHOP_A}','${CUST_CREDIT}',500,500,now(),now());
          `);
        }
        await bare.exec(migrationSql(name));
      }
      const rows = await bare.all<{
        id: string;
        customer_id: string;
        status: string;
      }>(
        `select id, customer_id, status from credit_reconciliation_states
          where shop_id = $1 order by customer_id`,
        [SHOP_A],
      );
      // Paid and credit-only BOTH quarantined as 'pending'; history-free 'Clean'
      // gets no row. id equals customer_id on both engines.
      expect(rows).toEqual([
        { id: CUST_PAID, customer_id: CUST_PAID, status: "pending" },
        { id: CUST_CREDIT, customer_id: CUST_CREDIT, status: "pending" },
      ]);
    } finally {
      await bare.close();
    }
  }, 180_000);
});
