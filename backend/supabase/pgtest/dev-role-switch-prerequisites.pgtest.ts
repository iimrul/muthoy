import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyRow,
  createBareHarness,
  createHarness,
  migrationFiles,
  migrationSql,
  HOSTED_FUNCTION_EXECUTE_MODEL,
  type Harness,
  OWNER_A,
  OWNER_B,
  seedShops,
  SHOP_A,
  SHOP_B,
  STAFF_A,
  T0,
} from "./harness";

// DEV prerequisite test: the exact 31-file hosted prefix, not the repository's
// 37-file chain. All original contract assertions are retained independently.
// No network, active migration or hosted state is modified.
async function createDevPrefixHarness(): Promise<Harness> {
  const db = await createBareHarness();
  try {
    const prefix = migrationFiles().filter(
      (name) => name <= "20261005000000_h5_revoke_auth_user_sessions.sql",
    );
    expect(prefix).toHaveLength(31);
    expect(prefix.at(-1)).toBe(
      "20261005000000_h5_revoke_auth_user_sessions.sql",
    );
    const seal = JSON.parse(
      readFileSync("backend/supabase/migrations/e4-source-hashes.json", "utf8"),
    ) as { files: Record<string, string> };
    for (const name of prefix) {
      const bytes = migrationSql(name).replace(/\r\n/g, "\n");
      expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(
        seal.files["backend/supabase/migrations/" + name],
      );
      await db.exec(migrationSql(name));
    }
    await db.exec(HOSTED_FUNCTION_EXECUTE_MODEL);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
const CUSTOMER = "a1100000-0000-4000-8000-000000000001";
const SALE = "a1100000-0000-4000-8000-000000000002";
const CREDIT = "a1100000-0000-4000-8000-000000000003";
const RECON = "a1100000-0000-4000-8000-000000000004";
const OPERATION = "a1100000-0000-4000-8000-000000000005";
const ALLOCATION = "a1100000-0000-4000-8000-000000000006";
const LATER = "2026-08-23T05:00:00.000Z";
let h: Harness;

beforeEach(async () => {
  h = await createDevPrefixHarness();
  await seedShops(h);
  await h.exec(`
    insert into customers(id,shop_id,name,created_at,updated_at)
      values('${CUSTOMER}','${SHOP_A}','Synthetic role-switch credit','${T0}','${T0}');
    insert into sales(id,shop_id,staff_id,customer_id,invoice_no,subtotal,total,paid,payment_type,credit_amount,created_at,updated_at)
      values('${SALE}','${SHOP_A}','${OWNER_A}','${CUSTOMER}','SYNTH-ROLE-CREDIT',2000,2000,0,'credit',2000,'${T0}','${T0}');
    insert into credits(id,shop_id,customer_id,sale_id,amount,balance,created_at,updated_at)
      values('${CREDIT}','${SHOP_A}','${CUSTOMER}','${SALE}',2000,2000,'${T0}','${T0}');
    insert into credit_reconciliation_states(id,shop_id,customer_id,status,verified_by,verified_at,created_at,updated_at)
      values('${RECON}','${SHOP_A}','${CUSTOMER}','verified','${OWNER_A}','${T0}','${T0}','${T0}');
    insert into user_permissions(id,shop_id,user_id,key,allowed,created_at,updated_at) values
      ('a1100000-0000-4000-8000-000000000010','${SHOP_A}','${STAFF_A}','sales',true,'${T0}','${T0}'),
      ('a1100000-0000-4000-8000-000000000011','${SHOP_A}','${STAFF_A}','sale_history',false,'${T0}','${T0}');
  `);
  // Warm the original five-to-six argument delegation BEFORE the rename, on
  // every fixture. Heavy migration setup belongs in this existing hook, not
  // inside a test with a shorter timeout. Equal-timestamp apply changes no row.
  const original = await h.one<{ payload: Record<string, unknown> }>(
    "select to_jsonb(c.*) payload from credits c where id=$1",
    [CREDIT],
  );
  expect(
    (
      await applyRow(h, {
        table: "credits",
        op: "update",
        row: original.payload,
        shopId: SHOP_A,
        callerUserId: OWNER_A,
      })
    ).ok,
  ).toBe(true);
  // Compile both callers before the predicate rename; prove cached callers rebind.
  await h.all("select * from sync_pull_changes_b2($1,$2,null,null,null,5000)", [
    SHOP_A,
    STAFF_A,
  ]);
  await h.one("select sync_readable_tables($1,$2) tables", [SHOP_A, STAFF_A]);
  await h.exec(
    readFileSync(
      "backend/supabase/held-migrations/role-switch-credit-link-contract.sql",
      "utf8",
    ),
  );
}, 60_000);
afterEach(async () => {
  await h?.close();
});

async function snapshot() {
  return {
    customers: await h.all(
      "select to_jsonb(c.*) row from customers c order by id",
    ),
    reconciliation: await h.all(
      "select to_jsonb(c.*) row from credit_reconciliation_states c order by id",
    ),
    drafts: await h.all(
      "select to_jsonb(d.*) row from sale_drafts d order by id",
    ),
    credits: await h.all(
      "select id::text,shop_id::text,customer_id::text,sale_id::text,amount::int,balance::int,updated_at::text from credits order by id",
    ),
    payments: await h.all(
      "select id::text,amount::int,method from payments order by id",
    ),
    allocations: await h.all(
      "select id::text,payment_id::text,credit_id::text,amount::int from credit_payment_allocations order by id",
    ),
    sales: await h.all(
      "select id::text,shop_id::text,total::int,credit_amount::int from sales order by id",
    ),
  };
}
async function creditPayload(
  saleId: string | null,
): Promise<Record<string, unknown>> {
  const row = await h.one<{ payload: Record<string, unknown> }>(
    "select to_jsonb(c.*) payload from credits c where id=$1",
    [CREDIT],
  );
  return { ...row.payload, sale_id: saleId, balance: 1550, updated_at: LATER };
}
async function collection(
  saleId: string | null,
  actor = OWNER_A,
  preparedCredit?: Record<string, unknown>,
) {
  const base = {
    shop_id: SHOP_A,
    created_at: LATER,
    updated_at: LATER,
    is_deleted: false,
    deleted_at: null,
    deleted_by: null,
  };
  const rows = [
    {
      queueId: "synthetic-role-payment",
      tableName: "payments",
      rowId: OPERATION,
      op: "insert",
      payload: {
        ...base,
        id: OPERATION,
        type: "customer_payment",
        party_id: CUSTOMER,
        amount: 450,
        method: "bkash",
        ref_id: null,
        created_by: actor,
      },
    },
    {
      queueId: "synthetic-role-allocation",
      tableName: "credit_payment_allocations",
      rowId: ALLOCATION,
      op: "insert",
      payload: {
        ...base,
        id: ALLOCATION,
        customer_id: CUSTOMER,
        payment_id: OPERATION,
        credit_id: CREDIT,
        amount: 450,
      },
    },
    {
      queueId: "synthetic-role-credit",
      tableName: "credits",
      rowId: CREDIT,
      op: "update",
      payload: preparedCredit ?? (await creditPayload(saleId)),
    },
  ];
  return h.one<{ result: { status: string; error?: string } }>(
    "select sync_stage_operation_chunk($1,$2,'credit_collection',$3,$4,3,$5,0,$5,$6::jsonb) result",
    [
      SHOP_A,
      OPERATION,
      actor,
      "synthetic-role-device",
      "role-credit-contract-hash-0001",
      JSON.stringify(rows),
    ],
  );
}
async function pull(actor: string) {
  return h.all<{
    table_name: string;
    row_id: string;
    row_data: Record<string, unknown>;
  }>(
    "select table_name,row_id::text,row_data from sync_pull_changes_b2($1,$2,null,null,null,5000)",
    [SHOP_A, actor],
  );
}

describe("H-A role-purged credit link and actual server writes", () => {
  it("valid collection and replay preserve exact credit/payment/allocation ledgers", async () => {
    expect((await collection(SALE)).result.status).toBe("applied");
    const before = await snapshot();
    expect(before.credits).toEqual([
      expect.objectContaining({
        id: CREDIT,
        sale_id: SALE,
        amount: 2000,
        balance: 1550,
      }),
    ]);
    expect(before.payments).toEqual([
      { id: OPERATION, amount: 450, method: "bkash" },
    ]);
    expect(before.allocations).toEqual([
      { id: ALLOCATION, payment_id: OPERATION, credit_id: CREDIT, amount: 450 },
    ]);
    expect((await collection(SALE)).result.status).toBe("applied");
    expect(await snapshot()).toEqual(before);
  });

  it("accepts a null-link Owner collection while preserving the server sale identity", async () => {
    expect((await collection(null)).result.status).toBe("applied");
    const after = await snapshot();
    expect(after.payments).toEqual([
      { id: OPERATION, amount: 450, method: "bkash" },
    ]);
    expect(after.allocations).toEqual([
      { id: ALLOCATION, payment_id: OPERATION, credit_id: CREDIT, amount: 450 },
    ]);
    expect(after.credits).toEqual([
      expect.objectContaining({
        id: CREDIT,
        sale_id: SALE,
        amount: 2000,
        balance: 1550,
      }),
    ]);
    expect((await collection(null)).result.status).toBe("applied");
    expect(await snapshot()).toEqual(after);
  });

  it("denies a foreign Owner with unchanged ledgers", async () => {
    const before = await snapshot();
    const result = await applyRow(h, {
      table: "credits",
      op: "update",
      row: await creditPayload(null),
      shopId: SHOP_A,
      callerUserId: OWNER_B,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("MU010");
    expect(result.error).toMatch(/caller.*(live|permission)/);
    expect(await snapshot()).toEqual(before);
  });

  it("denies reassignment of the credit to another shop with unchanged ledgers", async () => {
    const before = await snapshot();
    const result = await applyRow(h, {
      table: "credits",
      op: "update",
      row: { ...(await creditPayload(null)), shop_id: SHOP_B },
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("MU003");
    expect(result.error).toBe("row does not belong to the authenticated shop");
    expect(await snapshot()).toEqual(before);
  });
});

describe("H-B actual Staff pull parent closure", () => {
  it("Owner receives the linked credit and its sale without changing server data", async () => {
    const before = await snapshot();
    const rows = await pull(OWNER_A);
    expect(
      rows.find((row) => row.table_name === "credits" && row.row_id === CREDIT)
        ?.row_data.sale_id,
    ).toBe(SALE);
    expect(
      rows.filter((row) => row.table_name === "sales").map((row) => row.row_id),
    ).toContain(SALE);
    expect(await snapshot()).toEqual(before);
  });

  it("Staff own-history pull contains no dangling colleague-credit sale reference", async () => {
    const before = await snapshot();
    const rows = await pull(STAFF_A);
    const credit = rows.find(
      (row) => row.table_name === "credits" && row.row_id === CREDIT,
    );
    expect(credit).toBeDefined(); // Non-vacuous: sales permission returns credits.
    expect(credit!.row_data.sale_id).toBeNull();
    expect(rows.filter((row) => row.table_name === "sales")).toEqual([]); // Staff isolation.
    expect(await snapshot()).toEqual(before);
    const visibleSales = new Set(
      rows.filter((row) => row.table_name === "sales").map((row) => row.row_id),
    );
    const dangling = rows.filter(
      (row) =>
        row.table_name === "credits" &&
        typeof row.row_data.sale_id === "string" &&
        !visibleSales.has(row.row_data.sale_id),
    );
    expect(
      dangling.map((row) => ({
        credit: row.row_id,
        sale: row.row_data.sale_id,
      })),
    ).toEqual([]);
  });
});

async function grantCreditManagement(allowed = true) {
  await h.exec(`insert into user_permissions(id,shop_id,user_id,key,allowed,created_at,updated_at)
    values('a1100000-0000-4000-8000-000000000012','${SHOP_A}','${STAFF_A}','credit_management',${allowed},'${T0}','${T0}')`);
}

async function pullPage(
  functionName: "sync_pull_changes_b2" | "sync_pull_changes_b2_pre_role_credit",
  actor: string,
  limit = 5000,
  cursor: {
    updated_at: string;
    table_name: string;
    row_id: string;
  } | null = null,
) {
  return h.all<{
    table_name: string;
    row_id: string;
    updated_at: string;
    row_data: Record<string, unknown>;
  }>(
    `select table_name,row_id::text,updated_at::text,row_data from ${functionName}($1,$2,$3,$4,$5,$6)`,
    [
      SHOP_A,
      actor,
      cursor?.updated_at ?? null,
      cursor?.table_name ?? null,
      cursor?.row_id ?? null,
      limit,
    ],
  );
}

describe("HELD credit contract independent boundaries", () => {
  it("accepts authorized Staff's masked collection and replay with exact ledgers", async () => {
    await grantCreditManagement();
    expect((await collection(null, STAFF_A)).result.status).toBe("applied");
    const after = await snapshot();
    expect(after.credits).toEqual([
      expect.objectContaining({
        id: CREDIT,
        sale_id: SALE,
        amount: 2000,
        balance: 1550,
      }),
    ]);
    expect(after.payments).toEqual([
      { id: OPERATION, amount: 450, method: "bkash" },
    ]);
    expect(after.allocations).toEqual([
      { id: ALLOCATION, payment_id: OPERATION, credit_id: CREDIT, amount: 450 },
    ]);
    expect(
      await h.one("select created_by::text from payments where id=$1", [
        OPERATION,
      ]),
    ).toEqual({ created_by: STAFF_A });
    expect((await collection(null, STAFF_A)).result.status).toBe("applied");
    expect(await snapshot()).toEqual(after);
  });

  it("refuses a different nonnull sale identity without any financial writes", async () => {
    const otherSale = "a1100000-0000-4000-8000-000000000007";
    await h.exec(`insert into sales(id,shop_id,staff_id,customer_id,invoice_no,subtotal,total,paid,payment_type,credit_amount,created_at,updated_at)
      values('${otherSale}','${SHOP_A}','${OWNER_A}','${CUSTOMER}','SYNTH-ROLE-OTHER',1000,1000,0,'credit',1000,'${T0}','${T0}')`);
    const before = await snapshot();
    const result = await applyRow(h, {
      table: "credits",
      op: "update",
      row: await creditPayload(otherSale),
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("MU024");
    expect(result.error).toBe("existing credit sale identity cannot change");
    expect(await snapshot()).toEqual(before);
  });

  it("preserves an existing link when an update omits the sale_id key", async () => {
    const row = await creditPayload(null);
    delete row.sale_id;
    row.balance = 2000;
    const result = await applyRow(h, {
      table: "credits",
      op: "update",
      row,
      shopId: SHOP_A,
      callerUserId: OWNER_A,
    });
    expect(result.ok).toBe(true);
    expect((await snapshot()).credits).toEqual([
      expect.objectContaining({ sale_id: SALE, amount: 2000, balance: 2000 }),
    ]);
    expect((await snapshot()).payments).toEqual([]);
    expect((await snapshot()).allocations).toEqual([]);
  });

  it("keeps standalone credit collections null without guessing a sale", async () => {
    await h.exec(`update credits set sale_id=null where id='${CREDIT}'`);
    expect((await collection(null)).result.status).toBe("applied");
    expect((await snapshot()).credits).toEqual([
      expect.objectContaining({
        id: CREDIT,
        sale_id: null,
        amount: 2000,
        balance: 1550,
      }),
    ]);
    expect((await snapshot()).payments).toEqual([
      { id: OPERATION, amount: 450, method: "bkash" },
    ]);
  });

  it.each([T0, "2026-08-01T00:00:00.000Z"])(
    "keeps existing LWW for timestamp %s",
    async (timestamp) => {
      const before = await snapshot();
      const result = await applyRow(h, {
        table: "credits",
        op: "update",
        row: { ...(await creditPayload(null)), updated_at: timestamp },
        shopId: SHOP_A,
        callerUserId: OWNER_A,
      });
      expect(result.ok).toBe(true);
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each(["revoked", "inactive"] as const)(
    "keeps %s Staff collection denied with unchanged ledgers",
    async (state) => {
      await grantCreditManagement(state !== "revoked");
      if (state === "inactive")
        await h.exec(`update users set is_active=false where id='${STAFF_A}'`);
      const before = await snapshot();
      let failure: unknown;
      try {
        const result = await collection(null, STAFF_A);
        failure = result.result;
      } catch (error) {
        failure = error;
      }
      expect(await snapshot()).toEqual(before);
      expect(failure).toBeDefined();
      // Require the actual authorization guard, not a malformed collection graph.
      if (failure instanceof Error) {
        expect(failure.message).toMatch(/live shop user|credit_management/);
        expect((failure as Error & { code?: string }).code).toBe("MU010");
      } else {
        expect(failure).toMatchObject({ status: "rejected" });
      }
    },
  );

  it("retains own-Staff and history-authorized credit links", async () => {
    await h.exec(`update sales set staff_id='${STAFF_A}' where id='${SALE}'`);
    let rows = await pull(STAFF_A);
    expect(
      rows.find((row) => row.table_name === "credits" && row.row_id === CREDIT)
        ?.row_data.sale_id,
    ).toBe(SALE);
    expect(
      rows.filter((row) => row.table_name === "sales").map((row) => row.row_id),
    ).toContain(SALE);
    await h.exec(`update sales set staff_id='${OWNER_A}' where id='${SALE}';
      update user_permissions set allowed=true where user_id='${STAFF_A}' and key='sale_history'`);
    rows = await pull(STAFF_A);
    expect(
      rows.find((row) => row.table_name === "credits" && row.row_id === CREDIT)
        ?.row_data.sale_id,
    ).toBe(SALE);
    expect(
      rows.filter((row) => row.table_name === "sales").map((row) => row.row_id),
    ).toContain(SALE);
  });

  it("changes only masked JSON keys and preserves complete page/cursor ordering", async () => {
    const before = await snapshot();
    const baseline = await pullPage(
      "sync_pull_changes_b2_pre_role_credit",
      STAFF_A,
    );
    const expected = baseline.map((row) =>
      row.table_name === "credits"
        ? { ...row, row_data: { ...row.row_data, sale_id: null } }
        : row,
    );
    expect(expected.find((row) => row.row_id === CREDIT)?.row_data.amount).toBe(
      2000,
    );
    expect(await pullPage("sync_pull_changes_b2", STAFF_A)).toEqual(expected);
    const paged: typeof expected = [];
    let cursor: (typeof expected)[number] | null = null;
    for (let page = 0; page < 100; page++) {
      const rows = await pullPage("sync_pull_changes_b2", STAFF_A, 2, cursor);
      if (!rows.length) break;
      paged.push(...rows);
      cursor = rows.at(-1)!;
      if (rows.length < 2) break;
    }
    expect(paged.length).toBeGreaterThan(2);
    expect(paged).toEqual(expected);
    expect(
      new Set(paged.map((row) => row.table_name + ":" + row.row_id)).size,
    ).toBe(paged.length);
    expect(await pullPage("sync_pull_changes_b2", OWNER_A)).toEqual(
      await pullPage("sync_pull_changes_b2_pre_role_credit", OWNER_A),
    );
    expect(await snapshot()).toEqual(before);
  });

  it("keeps unauthorized credit and cross-shop pulls excluded", async () => {
    await h.exec(
      `update user_permissions set allowed=false where user_id='${STAFF_A}' and key='sales'`,
    );
    const before = await snapshot();
    expect(
      (await pull(STAFF_A)).filter((row) => row.table_name === "credits"),
    ).toEqual([]);
    expect(await pull(OWNER_B)).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it("keeps wrapper/internals API-denied and reapplication nonrecursive", async () => {
    const signatures = [
      "sync_table_readable(uuid,text)",
      "sync_table_readable_pre_role_credit(uuid,text)",
      "sync_apply_row(text,text,jsonb,uuid,uuid,text)",
      "sync_apply_row_pre_role_credit(text,text,jsonb,uuid,uuid,text)",
      "sync_pull_changes_b2(uuid,uuid,timestamptz,text,uuid,integer)",
      "sync_pull_changes_b2_pre_role_credit(uuid,uuid,timestamptz,text,uuid,integer)",
    ];
    for (const signature of signatures) {
      expect(
        await h.one(
          "select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service",
          [signature],
        ),
      ).toEqual({
        anon: false,
        authenticated: false,
        service: !signature.includes("_pre_role_credit"),
      });
    }
    const before = await snapshot();
    await h.exec(
      readFileSync(
        "backend/supabase/held-migrations/role-switch-credit-link-contract.sql",
        "utf8",
      ),
    );
    expect(await snapshot()).toEqual(before);
    expect((await collection(null)).result.status).toBe("applied");
    expect((await snapshot()).credits).toEqual([
      expect.objectContaining({ sale_id: SALE, amount: 2000, balance: 1550 }),
    ]);
  });
});

describe("HELD five-argument compatibility on a warmed SQL session", () => {
  it("rebinds the existing delegator after wrapping an already-used six-argument function", async () => {
    // beforeEach warmed the active delegator, then applied the HELD wrapper.
    const original = await h.one<{ payload: Record<string, unknown> }>(
      "select to_jsonb(c.*) payload from credits c where id=$1",
      [CREDIT],
    );
    expect(
      (
        await applyRow(h, {
          table: "credits",
          op: "update",
          row: { ...original.payload, sale_id: null, updated_at: LATER },
          shopId: SHOP_A,
          callerUserId: OWNER_A,
        })
      ).ok,
    ).toBe(true);
    expect(
      await h.one(
        "select sale_id::text,amount::int,balance::int from credits where id=$1",
        [CREDIT],
      ),
    ).toEqual({ sale_id: SALE, amount: 2000, balance: 2000 });
  });
});

describe("HELD E4 no-bypass function privileges", () => {
  it("denies service-role direct internals while SECURITY DEFINER public wrappers work", async () => {
    const before = await snapshot();
    const preparedCredit = await creditPayload(null);
    await expect(
      h.as("service_role", null, () =>
        h.all(
          "select * from sync_pull_changes_b2_pre_role_credit($1,$2,null,null,null,5000)",
          [SHOP_A, OWNER_A],
        ),
      ),
    ).rejects.toMatchObject({
      code: "42501",
      message: expect.stringContaining(
        "permission denied for function sync_pull_changes_b2_pre_role_credit",
      ),
    });
    await expect(
      h.as("service_role", null, () =>
        h.one(
          "select sync_apply_row_pre_role_credit('credits','update',$1::jsonb,$2,$3,null)",
          [JSON.stringify(preparedCredit), SHOP_A, OWNER_A],
        ),
      ),
    ).rejects.toMatchObject({
      code: "42501",
      message: expect.stringContaining(
        "permission denied for function sync_apply_row_pre_role_credit",
      ),
    });
    expect(await snapshot()).toEqual(before);
    expect(
      (
        await h.as("service_role", null, () =>
          collection(null, OWNER_A, preparedCredit),
        )
      ).result.status,
    ).toBe("applied");
    expect((await snapshot()).credits).toEqual([
      expect.objectContaining({ sale_id: SALE, amount: 2000, balance: 1550 }),
    ]);
    const rows = await h.as("service_role", null, () => pull(STAFF_A));
    expect(
      rows.find((row) => row.table_name === "credits" && row.row_id === CREDIT)
        ?.row_data.sale_id,
    ).toBeNull();
  });
});

const COMPLETED_DRAFT = "a1100000-0000-4000-8000-000000000030";
async function seedCompletedDraft(actor = OWNER_A) {
  await h.exec(`insert into sale_drafts(id,shop_id,status,origin_device_id,actor_id,customer_id,completed_sale_id,checkout_snapshot,created_at,updated_at)
    values('${COMPLETED_DRAFT}','${SHOP_A}','completed','synthetic-role-device','${actor}','${CUSTOMER}','${SALE}',null,'${T0}','${T0}')`);
}
function missingAllocationParents(rows: Awaited<ReturnType<typeof pull>>) {
  const visible = new Set(rows.map((row) => row.table_name + ":" + row.row_id));
  const reconciliationMissing = rows
    .filter(
      (row) =>
        row.table_name === "credit_reconciliation_states" &&
        !visible.has("customers:" + row.row_data.customer_id),
    )
    .map((row) => ({
      child: row.row_id,
      parent: "customers",
      id: row.row_data.customer_id,
    }));
  return [
    ...reconciliationMissing,
    ...rows
      .filter((row) => row.table_name === "credit_payment_allocations")
      .flatMap((row) => [
        ...(!visible.has("customers:" + row.row_data.customer_id)
          ? [
              {
                child: row.row_id,
                parent: "customers",
                id: row.row_data.customer_id,
              },
            ]
          : []),
        ...(!visible.has("credits:" + row.row_data.credit_id)
          ? [
              {
                child: row.row_id,
                parent: "credits",
                id: row.row_data.credit_id,
              },
            ]
          : []),
        ...(!visible.has("payments:" + row.row_data.payment_id)
          ? [
              {
                child: row.row_id,
                parent: "payments",
                id: row.row_data.payment_id,
              },
            ]
          : []),
      ]),
  ];
}
describe("F3 completed-draft hidden-sale hypothesis: test only", () => {
  it("Owner and own-Staff draft links have readable parent controls", async () => {
    await seedCompletedDraft();
    const before = await snapshot();
    let rows = await pull(OWNER_A);
    expect(
      rows.find((row) => row.row_id === COMPLETED_DRAFT)?.row_data
        .completed_sale_id,
    ).toBe(SALE);
    expect(
      rows.some((row) => row.table_name === "sales" && row.row_id === SALE),
    ).toBe(true);
    expect(await snapshot()).toEqual(before);
    await h.exec(
      `update sales set staff_id='${STAFF_A}' where id='${SALE}'; update sale_drafts set actor_id='${STAFF_A}' where id='${COMPLETED_DRAFT}'`,
    );
    rows = await pull(STAFF_A);
    expect(
      rows.find((row) => row.row_id === COMPLETED_DRAFT)?.row_data
        .completed_sale_id,
    ).toBe(SALE);
    expect(
      rows.some((row) => row.table_name === "sales" && row.row_id === SALE),
    ).toBe(true);
  });
  it("Staff colleague-completed draft has no unreadable sale FK", async () => {
    await seedCompletedDraft();
    const before = await snapshot();
    const rows = await pull(STAFF_A);
    const draft = rows.find(
      (row) =>
        row.table_name === "sale_drafts" && row.row_id === COMPLETED_DRAFT,
    );
    expect(draft).toBeDefined();
    expect(draft!.row_data.status).toBe("completed");
    expect(
      rows.some((row) => row.table_name === "sales" && row.row_id === SALE),
    ).toBe(false);
    expect(await snapshot()).toEqual(before);
    const visibleSales = new Set(
      rows.filter((row) => row.table_name === "sales").map((row) => row.row_id),
    );
    const dangling = rows.filter(
      (row) =>
        row.table_name === "sale_drafts" &&
        typeof row.row_data.completed_sale_id === "string" &&
        !visibleSales.has(row.row_data.completed_sale_id),
    );
    expect(
      dangling.map((row) => ({
        draft: row.row_id,
        sale: row.row_data.completed_sale_id,
      })),
    ).toEqual([]);
  });
  it("foreign Owner cannot read another shop's completed draft", async () => {
    await seedCompletedDraft();
    const before = await snapshot();
    expect(await pull(OWNER_B)).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });
});
describe("F4 allocation parent-permission hypothesis: test only", () => {
  it("credit-management grant returns both allocation parents", async () => {
    expect((await collection(SALE)).result.status).toBe("applied");
    await grantCreditManagement();
    const before = await snapshot(),
      rows = await pull(STAFF_A);
    expect(
      rows.filter((row) => row.table_name === "credit_payment_allocations"),
    ).toHaveLength(1);
    expect(missingAllocationParents(rows)).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });
  it.each(["credit_view", "sale_return"] as const)(
    "%s alone does not expose allocations with hidden credit/payment parents",
    async (grant) => {
      expect((await collection(SALE)).result.status).toBe("applied");
      await grantCreditManagement(false);
      await h.exec(`update user_permissions set allowed=false where user_id='${STAFF_A}' and key='sales';
      insert into user_permissions(id,shop_id,user_id,key,allowed,created_at,updated_at)
        values('a1100000-0000-4000-8000-000000000031','${SHOP_A}','${STAFF_A}','${grant}',true,'${T0}','${T0}')`);
      const before = await snapshot(),
        rows = await pull(STAFF_A);
      expect(
        rows.filter((row) => row.table_name === "credit_payment_allocations"),
      ).toHaveLength(0);
      expect(await snapshot()).toEqual(before);
      expect(missingAllocationParents(rows)).toEqual([]);
      expect(
        rows.filter((row) => row.table_name === "credit_reconciliation_states"),
      ).toEqual([]);
    },
  );
});

describe("F4-C reconciliation/customer parent closure", () => {
  it("credit-view-only never receives a reconciliation state without its customer", async () => {
    await grantCreditManagement(false);
    await h.exec(`update user_permissions set allowed=false where user_id='${STAFF_A}' and key='sales';
      insert into user_permissions(id,shop_id,user_id,key,allowed,created_at,updated_at)
      values('a1100000-0000-4000-8000-000000000032','${SHOP_A}','${STAFF_A}','credit_view',true,'${T0}','${T0}')`);
    const before = await snapshot(),
      rows = await pull(STAFF_A);
    expect(rows.some((row) => row.table_name === "customers")).toBe(false);
    expect(await snapshot()).toEqual(before);
    const customers = new Set(
      rows
        .filter((row) => row.table_name === "customers")
        .map((row) => row.row_id),
    );
    expect(
      rows
        .filter(
          (row) =>
            row.table_name === "credit_reconciliation_states" &&
            !customers.has(String(row.row_data.customer_id)),
        )
        .map((row) => row.row_id),
    ).toEqual([]);
  });
});

async function parentReadability(actor = STAFF_A) {
  const answer = await h.one<{ tables: string[] }>(
    "select sync_readable_tables($1,$2) tables",
    [SHOP_A, actor],
  );
  return Object.fromEntries(
    [
      "customers",
      "credits",
      "payments",
      "credit_payment_allocations",
      "credit_reconciliation_states",
    ].map((table) => [table, answer.tables.includes(table)]),
  );
}
async function grantReturn() {
  await h.exec(`insert into user_permissions(id,shop_id,user_id,key,allowed,created_at,updated_at)
    values('a1100000-0000-4000-8000-000000000033','${SHOP_A}','${STAFF_A}','sale_return',true,'${T0}','${T0}')`);
}
describe("F3/F4 final SQL projection and permission boundaries", () => {
  it("masks by sale visibility even when the draft actor is Staff; history restores the exact page", async () => {
    await seedCompletedDraft(STAFF_A);
    await h.exec(
      `update sale_drafts set checkout_snapshot='synthetic complete snapshot',prescription_no='SYNTH-RX',patient_name='Synthetic patient',prescriber_name='Synthetic clinician' where id='${COMPLETED_DRAFT}'`,
    );
    const before = await snapshot(),
      baseline = await pullPage(
        "sync_pull_changes_b2_pre_role_credit",
        STAFF_A,
      );
    const expected = baseline.map((row) =>
      row.table_name === "credits"
        ? { ...row, row_data: { ...row.row_data, sale_id: null } }
        : row.table_name === "sale_drafts"
          ? { ...row, row_data: { ...row.row_data, completed_sale_id: null } }
          : row,
    );
    const actual = await pullPage("sync_pull_changes_b2", STAFF_A);
    expect(actual).toEqual(expected);
    expect(
      actual.find((row) => row.row_id === COMPLETED_DRAFT)?.row_data.actor_id,
    ).toBe(STAFF_A);
    expect(
      actual.some((row) => row.table_name === "sales" && row.row_id === SALE),
    ).toBe(false);
    await h.exec(
      `update user_permissions set allowed=true where user_id='${STAFF_A}' and key='sale_history'`,
    );
    expect(await pullPage("sync_pull_changes_b2", STAFF_A)).toEqual(
      await pullPage("sync_pull_changes_b2_pre_role_credit", STAFF_A),
    );
    expect(await snapshot()).toEqual(before);
  });
  it("projects an incremental colleague draft without changing its cursor columns", async () => {
    await seedCompletedDraft();
    const before = await snapshot();
    const cursor = {
      updated_at: T0,
      table_name: "sale_draft_items",
      row_id: "00000000-0000-0000-0000-000000000000",
    };
    const baseline = await pullPage(
        "sync_pull_changes_b2_pre_role_credit",
        STAFF_A,
        5000,
        cursor,
      ),
      actual = await pullPage("sync_pull_changes_b2", STAFF_A, 5000, cursor);
    expect(
      actual.find((row) => row.row_id === COMPLETED_DRAFT)?.row_data
        .completed_sale_id,
    ).toBeNull();
    expect(actual).toEqual(
      baseline.map((row) =>
        row.table_name === "sale_drafts"
          ? { ...row, row_data: { ...row.row_data, completed_sale_id: null } }
          : row.table_name === "credits"
            ? { ...row, row_data: { ...row.row_data, sale_id: null } }
            : row,
      ),
    );
    expect(await snapshot()).toEqual(before);
  });
  it("keeps default sales plus sale_return fail-closed without granting payment access", async () => {
    expect((await collection(SALE)).result.status).toBe("applied");
    await grantCreditManagement(false);
    await grantReturn();
    const before = await snapshot();
    expect(await parentReadability()).toEqual({
      customers: true,
      credits: true,
      payments: false,
      credit_payment_allocations: false,
      credit_reconciliation_states: true,
    });
    const rows = await pull(STAFF_A);
    expect(
      rows.filter((row) => row.table_name === "credit_payment_allocations"),
    ).toEqual([]);
    expect(
      rows.filter((row) => row.table_name === "credit_reconciliation_states"),
    ).toHaveLength(1);
    expect(missingAllocationParents(rows)).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });
  it("tests each parent denial, grant revocation and the deliberate narrower pull exception", async () => {
    expect((await collection(SALE)).result.status).toBe("applied");
    await grantCreditManagement();
    await grantReturn();
    const before = await snapshot();
    expect(await parentReadability()).toEqual({
      customers: true,
      credits: true,
      payments: true,
      credit_payment_allocations: true,
      credit_reconciliation_states: true,
    });
    await h.exec(
      `update user_permissions set allowed=false where user_id='${STAFF_A}' and key='credit_management'`,
    );
    expect(
      await h.one(
        "select sync_table_readable_pre_role_credit($1,'credit_payment_allocations') old,sync_table_readable($1,'credit_payment_allocations') current",
        [STAFF_A],
      ),
    ).toEqual({ old: true, current: false });
    await h.exec(
      `insert into user_permissions(id,shop_id,user_id,key,allowed,created_at,updated_at) values('a1100000-0000-4000-8000-000000000034','${SHOP_A}','${STAFF_A}','cash_management',true,'${T0}','${T0}')`,
    );
    expect((await parentReadability()).credit_payment_allocations).toBe(true);
    await h.exec(
      `update user_permissions set allowed=false where user_id='${STAFF_A}' and key='sales'`,
    );
    expect(await parentReadability()).toEqual({
      customers: false,
      credits: false,
      payments: true,
      credit_payment_allocations: false,
      credit_reconciliation_states: false,
    });
    expect(missingAllocationParents(await pull(STAFF_A))).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });
  it("preserves complete one-row pagination after excluding unreadable financial children", async () => {
    expect((await collection(SALE)).result.status).toBe("applied");
    await grantCreditManagement(false);
    await grantReturn();
    const before = await snapshot(),
      expected = await pullPage("sync_pull_changes_b2", STAFF_A),
      paged: typeof expected = [];
    let cursor: (typeof expected)[number] | null = null;
    for (let page = 0; page < 100; page++) {
      const rows = await pullPage("sync_pull_changes_b2", STAFF_A, 1, cursor);
      if (!rows.length) break;
      paged.push(...rows);
      cursor = rows.at(-1)!;
    }
    expect(expected.length).toBeGreaterThan(2);
    expect(paged).toEqual(expected);
    expect(
      new Set(paged.map((row) => row.table_name + ":" + row.row_id)).size,
    ).toBe(paged.length);
    expect(missingAllocationParents(paged)).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });
  it("denies direct private readability access and preserves ACLs after reapplication", async () => {
    const before = await snapshot();
    await expect(
      h.as("service_role", null, () =>
        h.one("select sync_table_readable_pre_role_credit($1,'credits')", [
          STAFF_A,
        ]),
      ),
    ).rejects.toMatchObject({
      code: "42501",
      message: expect.stringContaining(
        "permission denied for function sync_table_readable_pre_role_credit",
      ),
    });
    expect(
      await h.as("service_role", null, () =>
        h.one("select sync_table_readable($1,'credits') readable", [STAFF_A]),
      ),
    ).toEqual({ readable: true });
    await h.exec(
      readFileSync(
        "backend/supabase/held-migrations/role-switch-credit-link-contract.sql",
        "utf8",
      ),
    );
    for (const role of ["anon", "authenticated", "service_role"])
      expect(
        await h.one(
          "select has_function_privilege($1,'sync_table_readable_pre_role_credit(uuid,text)','execute') allowed",
          [role],
        ),
      ).toEqual({ allowed: false });
    expect(await snapshot()).toEqual(before);
  });
});

// Real ungrouped device dispatcher: the E4 field pin must survive BOTH
// wrapper orders, independently of grouped authorization and financial ledgers.
async function assertShopIdentityPin(connection: Harness) {
  const fields = ["name", "name_en", "phone", "latitude", "longitude", "thana", "district", "location_captured_at"];
  const before = await connection.one<Record<string, unknown>>("select * from shops where id=$1", [SHOP_A]);
  const payload = { ...before, name: "Synthetic forbidden Staff rename", name_en: "Synthetic forbidden EN", phone: "+8801799999999", latitude: 23.8103, longitude: 90.4125, thana: "Synthetic thana", district: "Synthetic district", location_captured_at: LATER, updated_at: new Date(Date.parse(String(before.updated_at)) + 1000).toISOString() };
  expect((await applyRow(connection, {table: "shops", op: "update", row: payload, shopId: SHOP_A, callerUserId: STAFF_A})).ok).toBe(true);
  const after = await connection.one<Record<string, unknown>>("select * from shops where id=$1", [SHOP_A]);
  for(const field of fields) expect(after[field], `E4 identity pin ${field}`).toEqual(before[field]);
  const owner = {...after, name: "Synthetic permitted Owner rename", updated_at: new Date(Date.parse(String(after.updated_at)) + 1000).toISOString()};
  expect((await applyRow(connection, {table: "shops", op: "update", row: owner, shopId: SHOP_A, callerUserId: OWNER_A})).ok).toBe(true);
  expect((await connection.one<{name:string}>("select name from shops where id=$1", [SHOP_A])).name).toBe(owner.name);
}

describe("DEV-first future migration ordering", () => {
  it("refuses HELD reapplication over the later E4 wrapper without changing sources or ledgers", async () => {
    for (const name of migrationFiles().filter(
      (name) => name > "20261005000000_h5_revoke_auth_user_sessions.sql" && name <= "20261031000000_e11_entitlement_verification.sql",
    ))
      await h.exec(migrationSql(name));
    const beforeIdentityPush = await snapshot();
    await assertShopIdentityPin(h);
    expect(await snapshot()).toEqual(beforeIdentityPush);
    const before = await h.all(
      "select oid::text,proname,prosrc,proacl::text from pg_proc where pronamespace='public'::regnamespace order by oid",
    );
    const ledgers = await snapshot();
    let error: unknown;
    try {
      await h.exec(
        readFileSync(
          "backend/supabase/held-migrations/role-switch-credit-link-contract.sql",
          "utf8",
        ),
      );
    } catch (caught) {
      error = caught;
      await h.exec("rollback");
    }
    expect(error).toBeDefined();
    expect(String(error)).toContain("role-credit wrapper order mismatch");
    expect(
      await h.all(
        "select oid::text,proname,prosrc,proacl::text from pg_proc where pronamespace='public'::regnamespace order by oid",
      ),
    ).toEqual(before);
    expect(await snapshot()).toEqual(ledgers);
    expect((await collection(null)).result.status).toBe("applied");
    expect((await snapshot()).credits[0]).toMatchObject({
      sale_id: SALE,
      balance: 1550,
    });
  });
});

describe("HELD ordering precondition negative controls", () => {
  async function expectRefusal(message: string) {
    const definitions = await h.all(
      "select oid::text,proname,prosrc,proowner::text,proacl::text from pg_proc where pronamespace='public'::regnamespace order by oid",
    );
    const before = await snapshot();
    let error: unknown;
    try {
      await h.exec(
        readFileSync(
          "backend/supabase/held-migrations/role-switch-credit-link-contract.sql",
          "utf8",
        ),
      );
    } catch (caught) {
      error = caught;
      await h.exec("rollback");
    }
    expect(String(error)).toContain(message);
    expect(
      await h.all(
        "select oid::text,proname,prosrc,proowner::text,proacl::text from pg_proc where pronamespace='public'::regnamespace order by oid",
      ),
    ).toEqual(definitions);
    expect(await snapshot()).toEqual(before);
  }
  it("refuses an unexpected public source before replacing any wrapper", async () => {
    await h.exec(
      "create or replace function sync_table_readable(p_app_user_id uuid,p_table text) returns boolean language sql stable security definer set search_path=public as $$ select false $$",
    );
    await expectRefusal(
      "role-credit wrapper order mismatch: later or unknown wrapper",
    );
  });
  it("refuses partial installation without normalizing the remaining objects", async () => {
    await h.exec(
      "drop function sync_table_readable_pre_role_credit(uuid,text)",
    );
    await expectRefusal(
      "role-credit wrapper order mismatch: partial installation",
    );
  });
  it("refuses an unexpected SECURITY DEFINER owner", async () => {
    await h.exec(
      "alter function sync_table_readable(uuid,text) owner to service_role",
    );
    await expectRefusal(
      "role-credit wrapper order mismatch: owner or security settings",
    );
  });
});

describe("promoted repository-order wrapper contract", () => {
  it("preserves E4 Staff identity pin and Owner control with migration38 after repository37", async () => {
    const ordered = await createHarness();
    try {
      await seedShops(ordered);
      const ledgerBefore = await ordered.all("select id,total,paid,credit_amount from sales order by id");
      await assertShopIdentityPin(ordered);
      expect(await ordered.all("select id,total,paid,credit_amount from sales order by id")).toEqual(ledgerBefore);
    } finally { await ordered.close(); }
  }, 60_000); // New38-migration fixture; no existing timeout is changed.
});
