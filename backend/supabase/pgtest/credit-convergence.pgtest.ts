import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createHarness,
  type Harness,
  OWNER_A,
  seedShops,
  SHOP_A,
  T0,
} from "./harness";

// B3 Groups 4-6 review-fix — CREDIT CONVERGENCE PROOF.
//
// The client-side canonicalization (customer-detail/credit-sales/dashboard
// all reading balance-column, plus the refund-consistency regression test in
// credit-completeness.sqlite.test.ts / b2-refunds.sqlite.test.ts) only proves
// the SQLite side agrees with itself. It says nothing about what happens once
// a collection round-trips through the server: whether the server's own
// balance recomputation lands on the same number, whether two devices
// collecting against the same customer converge instead of diverging, and
// whether a retried chunk (the exact failure mode a flaky connection
// produces) applies once, not twice.
//
// Searching every existing pgtest file (`grep -r credit_collection
// backend/supabase/pgtest`) turns up nothing — the `credit_collection`
// dispatcher branch added in 20260821010000_phase_b2_sales_inventory_sync.sql
// has shipped since B2 with zero coverage through the actual
// sync_stage_operation_chunk -> sync_apply_operation path. This file closes
// that gap using the existing credit_collection branch exactly as-is — no
// sync logic was touched to make these tests pass.

const CUSTOMER_1 = "96000000-0000-4000-8000-000000000001";
const CUSTOMER_2 = "96000000-0000-4000-8000-000000000002";
const CUSTOMER_3 = "96000000-0000-4000-8000-000000000003";
const CREDIT_1 = "96000000-0000-4000-8100-000000000001";
const CREDIT_2 = "96000000-0000-4000-8100-000000000002";
const CREDIT_3 = "96000000-0000-4000-8100-000000000003";
const RECON_1 = "96000000-0000-4000-8200-000000000001";
const RECON_2 = "96000000-0000-4000-8200-000000000002";
const RECON_3 = "96000000-0000-4000-8200-000000000003";
const CREATED_AT = "2026-08-23T04:00:00.000Z";

let h: Harness | null = null;

beforeEach(async () => {
  h = await createHarness();
  await seedShops(h);
  await h.exec(`
    insert into customers(id,shop_id,name,created_at,updated_at) values
      ('${CUSTOMER_1}','${SHOP_A}','Convergence Customer 1','${T0}','${T0}'),
      ('${CUSTOMER_2}','${SHOP_A}','Convergence Customer 2','${T0}','${T0}'),
      ('${CUSTOMER_3}','${SHOP_A}','Convergence Customer 3','${T0}','${T0}');
    insert into credits(id,shop_id,customer_id,sale_id,amount,balance,created_at,updated_at) values
      ('${CREDIT_1}','${SHOP_A}','${CUSTOMER_1}',null,100000,100000,'${T0}','${T0}'),
      ('${CREDIT_2}','${SHOP_A}','${CUSTOMER_2}',null,100000,100000,'${T0}','${T0}'),
      ('${CREDIT_3}','${SHOP_A}','${CUSTOMER_3}',null,50000,50000,'${T0}','${T0}');
    insert into credit_reconciliation_states(id,shop_id,customer_id,status,verified_by,verified_at,created_at,updated_at) values
      ('${RECON_1}','${SHOP_A}','${CUSTOMER_1}','verified','${OWNER_A}','${T0}','${T0}','${T0}'),
      ('${RECON_2}','${SHOP_A}','${CUSTOMER_2}','verified','${OWNER_A}','${T0}','${T0}','${T0}'),
      ('${RECON_3}','${SHOP_A}','${CUSTOMER_3}','verified','${OWNER_A}','${T0}','${T0}','${T0}');
  `);
}, 60_000);

afterEach(async () => {
  await h?.close();
  h = null;
});

function paymentRow(id: string, customerId: string, amount: number, overrides: Record<string, unknown> = {}) {
  return {
    id, shop_id: SHOP_A, type: "customer_payment", party_id: customerId, amount,
    method: "bkash", ref_id: null, created_by: OWNER_A, created_at: CREATED_AT, updated_at: CREATED_AT,
    is_deleted: false, deleted_at: null, deleted_by: null,
    ...overrides,
  };
}
function allocationRow(id: string, customerId: string, paymentId: string, creditId: string, amount: number) {
  return {
    id, shop_id: SHOP_A, customer_id: customerId, payment_id: paymentId, credit_id: creditId, amount,
    created_at: CREATED_AT, updated_at: CREATED_AT, is_deleted: false, deleted_at: null, deleted_by: null,
  };
}
function creditUpdateRow(id: string, customerId: string, amount: number, balance: number, updatedAt: string) {
  return {
    id, shop_id: SHOP_A, customer_id: customerId, sale_id: null, amount, balance,
    created_at: T0, updated_at: updatedAt, is_deleted: false, deleted_at: null, deleted_by: null,
  };
}
function row(queueId: string, tableName: string, op: "insert" | "update", payload: Record<string, unknown>) {
  return { queueId, tableName, rowId: payload.id, op, payload };
}

// credit_payment_allocations.id is a uuid primary key — derive a distinct,
// still-valid uuid per operation rather than a non-uuid suffixed string.
function allocIdFor(operationId: string): string {
  return operationId.replace("-8300-", "-8400-");
}

async function stageCollection(
  operationId: string,
  paymentId: string,
  customerId: string,
  creditId: string,
  amount: number,
  newBalance: number,
  updatedAt: string,
  deviceId: string,
  payloadHash: string,
) {
  const rows = [
    row(`${operationId}-q1`, "payments", "insert", paymentRow(paymentId, customerId, amount, { id: operationId })),
    row(`${operationId}-q2`, "credit_payment_allocations", "insert",
      allocationRow(allocIdFor(operationId), customerId, operationId, creditId, amount)),
    row(`${operationId}-q3`, "credits", "update", creditUpdateRow(creditId, customerId, 100000, newBalance, updatedAt)),
  ];
  return h!.one<{ result: { status: string } }>(
    `select sync_stage_operation_chunk(
       $1,$2,'credit_collection',$3,$4,3,$5,0,$5,$6::jsonb
     ) result`,
    [SHOP_A, operationId, OWNER_A, deviceId, payloadHash, JSON.stringify(rows)],
  );
}

describe("credit_collection — sync/pull canonical balance", () => {
  it("a collection applied through the grouped-sync path pulls back the exact same balance the server computed", async () => {
    const opId = "96000000-0000-4000-8300-000000000001";
    const paymentId = opId;
    const staged = await stageCollection(opId, paymentId, CUSTOMER_1, CREDIT_1, 40000, 60000, "2026-08-23T05:00:00.000Z", "device-a", "credit-convergence-pull-hash-0001");
    expect(staged.result.status).toBe("applied");

    const stored = await h!.one<{ balance: number }>(`select balance::int from credits where id=$1`, [CREDIT_1]);
    expect(stored.balance).toBe(60000);

    const pulled = await h!.all<{ table_name: string; row_data: Record<string, unknown> }>(
      `select table_name,row_data from sync_pull_changes_b2($1,$2,null,null,null,500)
        where table_name in ('credits','payments','credit_payment_allocations')`,
      [SHOP_A, OWNER_A],
    );
    const pulledCredit = pulled.find((r) => r.table_name === "credits" && r.row_data.id === CREDIT_1);
    const pulledPayment = pulled.find((r) => r.table_name === "payments" && r.row_data.id === paymentId);
    const pulledAllocation = pulled.find((r) => r.table_name === "credit_payment_allocations" && r.row_data.credit_id === CREDIT_1);

    // The canonical read (customer-detail/credit-sales/dashboard's shared
    // balance-column expression) is nothing more than SUM(credits.balance) —
    // proving the PULLED row carries the server-computed 60000 is proving a
    // second device reconstructing this customer from a fresh pull lands on
    // the exact same number collectPayment's writer already committed to.
    expect(pulledCredit?.row_data.balance).toBe(60000);
    expect(Number(pulledPayment?.row_data.amount)).toBe(40000);
    expect(Number(pulledAllocation?.row_data.amount)).toBe(40000);
  });
});

describe("credit_collection — multi-device convergence", () => {
  it("two devices collecting against the same customer in sequence converge on one server-side balance, not two diverging ones", async () => {
    const opA = "96000000-0000-4000-8300-000000000010";
    const opB = "96000000-0000-4000-8300-000000000011";

    // Device A collects ৳400 first — server balance goes 1000 -> 600.
    const stagedA = await stageCollection(opA, opA, CUSTOMER_2, CREDIT_2, 40000, 60000, "2026-08-23T05:00:00.000Z", "device-a", "credit-convergence-multidevice-hash-a");
    expect(stagedA.result.status).toBe("applied");

    // Device B — a second physical device, offline while A collected —
    // now syncs its own ৳250 collection. Its payload's claimed new balance
    // (35000) is computed against the balance IT last knew about (60000,
    // pulled after A's write), not a stale value, exactly as the real
    // client's collectPayment always re-reads current balance before
    // writing. The server independently re-derives this from
    // credits.balance - allocated, so a stale/wrong claim would still be
    // rejected with MU024 regardless of what the client believes.
    const stagedB = await stageCollection(opB, opB, CUSTOMER_2, CREDIT_2, 25000, 35000, "2026-08-23T06:00:00.000Z", "device-b", "credit-convergence-multidevice-hash-b");
    expect(stagedB.result.status).toBe("applied");

    const finalBalance = await h!.one<{ balance: number }>(`select balance::int from credits where id=$1`, [CREDIT_2]);
    expect(finalBalance.balance).toBe(35000);

    // Both devices' payments survive — convergence means the two writes
    // compose, neither silently overwrites the other.
    const payments = await h!.all<{ id: string; amount: number }>(
      `select id,amount::int from payments where party_id=$1 and type='customer_payment' order by amount`,
      [CUSTOMER_2],
    );
    expect(payments).toEqual([{ id: opB, amount: 25000 }, { id: opA, amount: 40000 }]);

    const allocatedSum = await h!.one<{ sum: number }>(
      `select coalesce(sum(amount),0)::int sum from credit_payment_allocations where credit_id=$1`,
      [CREDIT_2],
    );
    expect(allocatedSum.sum).toBe(65000);

    // A subsequent pull (what device C, or A re-syncing, would reconstruct
    // the customer from) lands on the exact same converged number.
    const pulled = await h!.all<{ table_name: string; row_data: Record<string, unknown> }>(
      `select table_name,row_data from sync_pull_changes_b2($1,$2,null,null,null,500)
        where table_name='credits'`,
      [SHOP_A, OWNER_A],
    );
    const pulledCredit = pulled.find((r) => r.row_data.id === CREDIT_2);
    expect(pulledCredit?.row_data.balance).toBe(35000);
  });
});

describe("credit_collection — retry/idempotency", () => {
  it("replaying the identical chunk twice (a flaky-connection retry) applies once, never double-decrementing the balance", async () => {
    const opId = "96000000-0000-4000-8300-000000000020";
    const first = await stageCollection(opId, opId, CUSTOMER_3, CREDIT_3, 20000, 30000, "2026-08-23T05:00:00.000Z", "device-a", "credit-convergence-retry-hash-0001");
    expect(first.result.status).toBe("applied");
    // Same operation id, same rows, same device — exactly what a client
    // retries after a dropped ack, per db/sync-helpers.ts's outbox contract.
    const second = await stageCollection(opId, opId, CUSTOMER_3, CREDIT_3, 20000, 30000, "2026-08-23T05:00:00.000Z", "device-a", "credit-convergence-retry-hash-0001");
    expect(second.result.status).toBe("applied");

    const finalBalance = await h!.one<{ balance: number }>(`select balance::int from credits where id=$1`, [CREDIT_3]);
    // Single application: 50000 - 20000 = 30000. A double-apply bug would
    // land here at 10000 instead.
    expect(finalBalance.balance).toBe(30000);

    const paymentCount = await h!.one<{ count: number }>(
      `select count(*)::int count from payments where id=$1`, [opId],
    );
    expect(paymentCount.count).toBe(1);

    const allocatedSum = await h!.one<{ sum: number }>(
      `select coalesce(sum(amount),0)::int sum from credit_payment_allocations where payment_id=$1`,
      [opId],
    );
    expect(allocatedSum.sum).toBe(20000);
  });
});
