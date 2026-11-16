import { readFileSync } from "node:fs";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { sqlite } from "./test/expo-sqlite";

const network = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../sync/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke: network.invoke } },
}));
const { pullChanges } = await import("../sync/pull");
const cursorStore = await import("../sync/cursorStore");
const { getLastPulledCursor, setLastPulledCursor, getLastPulledAccess } =
  cursorStore;
const { HYDRATION_TABLE_ORDER, applyRemoteRows } =
  await import("./sync-helpers");
const { getCashSummarySync } = await import("./cash");
const { expectedCash } = await import("../domain/cashFormula");
const { useSessionStore } = await import("../state/sessionStore");
const NOW = "2026-01-01T10:00:00.000Z";
let sequence = 0;
beforeAll(() => {
  const journal = JSON.parse(
    readFileSync("apps/mobile/db/migrations/meta/_journal.json", "utf8"),
  ) as { entries: { tag: string }[] };
  for (const { tag } of journal.entries)
    sqlite.exec(
      readFileSync("apps/mobile/db/migrations/" + tag + ".sql", "utf8"),
    );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  useSessionStore.setState({ session: null });
});
function fixture(withCredit = false, withCompletedDraft = false) {
  const n = ++sequence,
    id = (slot: number) =>
      `79000000-${String(n).padStart(4, "0")}-4000-8000-${String(slot).padStart(12, "0")}`;
  const shop = id(1),
    owner = id(2),
    staff = id(3),
    med = id(4),
    batch = id(5),
    ownerSale = id(6),
    staffSale = id(7),
    ownerItem = id(8),
    staffItem = id(9),
    staffTwo = id(13),
    staffTwoSale = id(14),
    staffTwoItem = id(15);
  sqlite
    .prepare(
      "INSERT INTO shops(id,owner_id,name,phone) VALUES(?,?,'Synthetic role-switch shop','01700000000')",
    )
    .run(shop, owner);
  for (const [actor, role, roleId] of [
    [owner, "owner", id(10)],
    [staff, "staff", id(11)],
    [staffTwo, "staff", id(16)],
  ]) {
    sqlite
      .prepare("INSERT INTO roles(id,shop_id,name,is_system) VALUES(?,?,?,1)")
      .run(roleId!, shop, role!);
    sqlite
      .prepare(
        "INSERT INTO users(id,shop_id,name,pin_hash,role_id,is_active) VALUES(?,?,'Synthetic actor','synthetic',?,1)",
      )
      .run(actor!, shop, roleId!);
  }
  sqlite
    .prepare(
      "INSERT INTO medicines(id,shop_id,name) VALUES(?,?,'Synthetic role-switch medicine')",
    )
    .run(med, shop);
  sqlite
    .prepare(
      "INSERT INTO batches(id,shop_id,medicine_id,batch_no,purchase_price,sale_price) VALUES(?,?,?,'SYNTH-ROLE',100,120)",
    )
    .run(batch, shop, med);
  for (const [sale, item, actor] of [
    [ownerSale, ownerItem, owner],
    [staffSale, staffItem, staff],
    [staffTwoSale, staffTwoItem, staffTwo],
  ]) {
    const timestamp = actor === staffTwo ? "2025-12-01T10:00:00.000Z" : NOW;
    sqlite
      .prepare(
        "INSERT INTO sales(id,shop_id,staff_id,invoice_no,subtotal,total,paid,cash_applied,payment_type,created_at,updated_at,is_dirty) VALUES(?,?,?,?,120,120,120,120,'cash',?,?,0)",
      )
      .run(sale!, shop, actor!, "SYNTH-" + sale, timestamp, timestamp);
    sqlite
      .prepare(
        "INSERT INTO sale_items(id,shop_id,sale_id,medicine_id,batch_id,qty,unit_price,line_total,cogs,created_at,updated_at,is_dirty) VALUES(?,?,?,?,?,1,120,120,100,?,?,0)",
      )
      .run(item!, shop, sale!, med, batch, timestamp, timestamp);
  }
  const customer = id(20),
    credit = id(21),
    payment = id(22),
    allocation = id(23),
    drawer = id(24);
  if (withCredit) {
    sqlite
      .prepare(
        "INSERT INTO customers(id,shop_id,name,created_at,updated_at,is_dirty) VALUES(?,?,'Synthetic credit customer',?,?,0)",
      )
      .run(customer, shop, NOW, NOW);
    sqlite
      .prepare(
        "UPDATE sales SET customer_id=?,subtotal=2000,total=2000,paid=500,cash_applied=500,credit_amount=1500,payment_type='split' WHERE id=?",
      )
      .run(customer, ownerSale);
    sqlite
      .prepare(
        "UPDATE sale_items SET unit_price=2000,line_total=2000 WHERE id=?",
      )
      .run(ownerItem);
    sqlite
      .prepare(
        "INSERT INTO credits(id,shop_id,customer_id,sale_id,amount,balance,created_at,updated_at,is_dirty) VALUES(?,?,?,?,1500,1050,?,?,0)",
      )
      .run(credit, shop, customer, ownerSale, NOW, NOW);
    sqlite
      .prepare(
        "INSERT INTO payments(id,shop_id,type,party_id,amount,method,created_by,created_at,updated_at,is_dirty) VALUES(?,?,'customer_payment',?,450,'cash',?,?,?,0)",
      )
      .run(payment, shop, customer, owner, NOW, NOW);
    sqlite
      .prepare(
        "INSERT INTO credit_payment_allocations(id,shop_id,customer_id,payment_id,credit_id,amount,created_at,updated_at,is_dirty) VALUES(?,?,?,?,?,450,?,?,0)",
      )
      .run(allocation, shop, customer, payment, credit, NOW, NOW);
    sqlite
      .prepare(
        "INSERT INTO cash_drawer(id,shop_id,business_date,opening_cash,closing_expected,closing_counted,opened_by,closed_by,closed_at,created_at,updated_at,is_dirty) VALUES(?,?,'2026-01-01',0,1070,1070,?,?,?,?,?,0)",
      )
      .run(drawer, shop, owner, owner, NOW, NOW, NOW);
  }
  const reconciliation = id(25);
  if (withCredit) {
    sqlite
      .prepare(
        "INSERT INTO credit_reconciliation_states(id,shop_id,customer_id,status,verified_by,verified_at,created_at,updated_at,is_dirty) VALUES(?,?,?,'verified',?,?,?,?,0)",
      )
      .run(reconciliation, shop, customer, owner, NOW, NOW, NOW);
  }
  const completedDraft = id(30);
  if (withCompletedDraft) {
    sqlite
      .prepare(
        "INSERT INTO sale_drafts(id,shop_id,status,origin_device_id,actor_id,completed_sale_id,created_at,updated_at,is_dirty) VALUES(?,?,'completed','synthetic-role-device',?,?,?,?,0)",
      )
      .run(completedDraft, shop, owner, ownerSale, NOW, NOW);
    sqlite
      .prepare(
        "UPDATE sale_drafts SET checkout_snapshot=?,prescription_no='SYNTH-RX',patient_name='Synthetic patient',prescriber_name='Synthetic clinician' WHERE id=?",
      )
      .run(
        JSON.stringify({ synthetic: true, paymentType: "cash" }),
        completedDraft,
      );
  }
  const server = (
    [
      "sales",
      "sale_items",
      "sale_drafts",
      "customers",
      "credits",
      "payments",
      "credit_payment_allocations",
      "credit_reconciliation_states",
      "cash_drawer",
    ] as const
  ).flatMap((table) =>
    sqlite
      .prepare("SELECT * FROM " + table + " WHERE shop_id=? ORDER BY id")
      .all(shop)
      .map((raw) => {
        const payload = { ...raw } as Record<string, unknown>;
        delete payload.is_dirty;
        for (const key of Object.keys(payload))
          if (key.startsWith("is_")) payload[key] = Boolean(payload[key]);
        return {
          updatedAt: String(payload.updated_at),
          tableName: table,
          rowId: String(payload.id),
          payload,
        };
      }),
  );
  server.sort(
    (a, b) =>
      a.updatedAt.localeCompare(b.updatedAt) ||
      a.tableName.localeCompare(b.tableName) ||
      a.rowId.localeCompare(b.rowId),
  );
  const serverBefore = JSON.stringify(server);
  let actor = owner;
  let readableTables = [...HYDRATION_TABLE_ORDER];
  // A real server's since-filter cannot return old rows merely because the
  // installation switched actors. No authority/apply/purge/cursor is mocked.
  network.invoke.mockImplementation(
    async (
      _name: string,
      options: {
        body: {
          action: string;
          shopId: string;
          since: { updatedAt: string } | null;
        };
      },
    ) => {
      expect(options.body.action).toBe("pull");
      expect(options.body.shopId).toBe(shop);
      const allowed = server.filter(
        (row) =>
          readableTables.includes(row.tableName) &&
          (actor === owner ||
            (row.tableName !== "sales" && row.tableName !== "sale_items") ||
            (row.tableName === "sales" && row.payload.staff_id === actor) ||
            (row.tableName === "sale_items" &&
              server.some(
                (sale) =>
                  sale.tableName === "sales" &&
                  sale.rowId === row.payload.sale_id &&
                  sale.payload.staff_id === actor,
              ))),
      );
      const changes = allowed
        .filter(
          (row) =>
            !options.body.since || row.updatedAt > options.body.since.updatedAt,
        )
        .map((row) => {
          // Contract proven by the candidate's actual SQL pgtest: preserve the
          // server snapshot and mask only hidden colleague-sale FKs on the wire.
          const saleLink =
            row.tableName === "sale_drafts" ? "completed_sale_id" : "sale_id";
          if (
            (row.tableName === "credits" || row.tableName === "sale_drafts") &&
            actor !== owner &&
            server.some(
              (sale) =>
                sale.tableName === "sales" &&
                sale.rowId === row.payload[saleLink] &&
                sale.payload.staff_id !== actor,
            )
          ) {
            return { ...row, payload: { ...row.payload, [saleLink]: null } };
          }
          return row;
        });
      return {
        data: {
          changes,
          hasMore: false,
          nextCursor: changes.length
            ? {
                updatedAt: changes.at(-1)!.updatedAt,
                tableName: changes.at(-1)!.tableName,
                rowId: changes.at(-1)!.rowId,
              }
            : null,
          accessVersion: 1,
          readableTables,
          accessUserId: actor,
          saleHistoryScope: actor === owner ? "all" : "own",
        },
        error: null,
      };
    },
  );
  setLastPulledCursor(shop, {
    updatedAt: "2026-02-01T00:00:00.000Z",
    tableName: "sales",
    rowId: staffSale,
  });
  const asActor = async (
    next: "owner" | "staff" | "staff-two",
    isCancelled: () => boolean = () => false,
  ) => {
    actor = next === "owner" ? owner : next === "staff" ? staff : staffTwo;
    useSessionStore.setState({
      session: {
        shopId: shop,
        userId: actor,
        role: next === "owner" ? "owner" : "staff",
      },
    });
    await pullChanges(shop, undefined, isCancelled, undefined, actor);
  };
  const rows = () => ({
    sales: sqlite
      .prepare("SELECT * FROM sales WHERE shop_id=? ORDER BY id")
      .all(shop),
    items: sqlite
      .prepare("SELECT * FROM sale_items WHERE shop_id=? ORDER BY id")
      .all(shop),
  });
  return {
    completedDraft,
    reconciliation,
    serverDraft: server.find((row) => row.tableName === "sale_drafts")?.payload,
    med,
    serverCredit: server.find((row) => row.tableName === "credits")?.payload,
    customer,
    credit,
    payment,
    allocation,
    drawer,
    shop,
    owner,
    staff,
    staffTwo,
    ownerSale,
    ownerItem,
    staffSale,
    staffItem,
    staffTwoSale,
    staffTwoItem,
    asActor,
    rows,
    setReadable: (tables: typeof readableTables) => {
      readableTables = tables;
    },
    serverUnchanged: () => expect(JSON.stringify(server)).toBe(serverBefore),
    queueId: id(12),
  };
}
describe("shared-device access purge and role rehydration: real SQLite/pull/cursor", () => {
  it("restores the Owner mirror after Owner -> Staff -> Owner with old server rows", async () => {
    const f = fixture();
    await f.asActor("owner");
    const before = f.rows();
    await f.asActor("staff");
    expect(f.rows().sales.map((x) => x.id)).toEqual([f.staffSale]);
    await f.asActor("owner");
    f.serverUnchanged();
    // Existing remote inserts inherit schema is_dirty=1; they do not create
    // outbox writes. Pin this metadata explicitly instead of hiding it or
    // changing the unapproved DB apply writer. Every business column matches.
    expect(f.rows()).toEqual({
      sales: before.sales.map((row) => ({
        ...row,
        is_dirty: row.staff_id === f.staff ? 0 : 1,
      })),
      items: before.items.map((row) => ({
        ...row,
        is_dirty: row.sale_id === f.staffSale ? 0 : 1,
      })),
    });
    expect(
      sqlite.prepare("SELECT id FROM sync_queue WHERE shop_id=?").all(f.shop),
    ).toEqual([]);
  });
  it("removes clean colleague history for Staff without touching another shop", async () => {
    const other = fixture(),
      otherBefore = other.rows(),
      f = fixture();
    await f.asActor("staff");
    f.serverUnchanged();
    expect(f.rows().sales.map((x) => x.id)).toEqual([f.staffSale]);
    expect(f.rows().items.map((x) => x.id)).toEqual([f.staffItem]);
    expect(other.rows()).toEqual(otherBefore);
  });
  it.each(["pending", "failed"] as const)(
    "retains an Owner graph required by a %s child mutation",
    async (status) => {
      const f = fixture();
      sqlite
        .prepare(
          "INSERT INTO sync_queue(id,seq,shop_id,table_name,row_id,op,payload,status) VALUES(?, ?,?,'sale_items',?,'insert',?,?)",
        )
        .run(
          f.queueId,
          sequence,
          f.shop,
          f.ownerItem,
          JSON.stringify({
            id: f.ownerItem,
            shop_id: f.shop,
            sale_id: f.ownerSale,
          }),
          status,
        );
      const before = f.rows(),
        queueBefore = sqlite
          .prepare("SELECT * FROM sync_queue WHERE shop_id=?")
          .all(f.shop);
      await f.asActor("staff");
      f.serverUnchanged();
      expect(f.rows()).toEqual({
        sales: before.sales.filter((row) => row.id !== f.staffTwoSale),
        items: before.items.filter((row) => row.id !== f.staffTwoItem),
      });
      expect(
        sqlite.prepare("SELECT * FROM sync_queue WHERE shop_id=?").all(f.shop),
      ).toEqual(queueBefore);
      expect(getLastPulledCursor(f.shop)).toEqual({
        updatedAt: NOW,
        tableName: "sales",
        rowId: f.staffSale,
      });
    },
  );
});

describe("materialized access transition failure boundaries", () => {
  it("rehydrates an older Staff B history after Staff A", async () => {
    const f = fixture();
    await f.asActor("staff");
    expect(f.rows().sales.map((x) => x.id)).toEqual([f.staffSale]);
    await f.asActor("staff-two");
    f.serverUnchanged();
    expect(f.rows().sales.map((x) => x.id)).toEqual([f.staffTwoSale]);
    expect(f.rows().items.map((x) => x.id)).toEqual([f.staffTwoItem]);
  });
  it("uses incremental when materialized context is unchanged", async () => {
    const f = fixture();
    await f.asActor("owner");
    const cursor = getLastPulledCursor(f.shop);
    network.invoke.mockClear();
    await f.asActor("owner");
    expect(network.invoke).toHaveBeenCalledOnce();
    expect(network.invoke.mock.calls[0]![1].body.since).toEqual(cursor);
    f.serverUnchanged();
  });
  it("rehydrates a same-actor readable-table change", async () => {
    const f = fixture();
    await f.asActor("owner");
    network.invoke.mockClear();
    f.setReadable(HYDRATION_TABLE_ORDER.filter((t) => t !== "expenses"));
    await f.asActor("owner");
    expect(network.invoke).toHaveBeenCalledTimes(2);
    expect(network.invoke.mock.calls[1]![1].body.since).toBeNull();
    network.invoke.mockClear();
    f.setReadable([...HYDRATION_TABLE_ORDER]);
    await f.asActor("owner");
    expect(network.invoke).toHaveBeenCalledTimes(2);
    expect(network.invoke.mock.calls[1]![1].body.since).toBeNull();
    f.serverUnchanged();
  });
  it.each(["cancel", "failure"] as const)(
    "keeps mirror/context/cursor intact on full-hydration %s",
    async (kind) => {
      const f = fixture();
      await f.asActor("owner");
      const before = f.rows(),
        cursor = getLastPulledCursor(f.shop),
        access = getLastPulledAccess(f.shop);
      const original = network.invoke.getMockImplementation()!;
      let calls = 0,
        cancelled = false;
      network.invoke.mockImplementation(async (...args) => {
        calls++;
        const result = await original(...args);
        if (calls === 2) {
          if (kind === "cancel") cancelled = true;
          else
            return {
              data: null,
              error: new Error("Synthetic hydration failure"),
            };
        }
        return result;
      });
      if (kind === "cancel") await f.asActor("staff", () => cancelled);
      else
        await expect(f.asActor("staff")).rejects.toThrow(
          "Synthetic hydration failure",
        );
      expect(f.rows()).toEqual(before);
      expect(getLastPulledCursor(f.shop)).toEqual(cursor);
      expect(getLastPulledAccess(f.shop)).toEqual(access);
      f.serverUnchanged();
    },
  );
  it("refuses to purge when materialized-access persistence fails", async () => {
    const f = fixture();
    await f.asActor("owner");
    const before = f.rows(),
      cursor = getLastPulledCursor(f.shop),
      access = getLastPulledAccess(f.shop);
    vi.spyOn(cursorStore, "setLastPulledAccess").mockImplementation(() => {
      throw new Error("Synthetic access persistence failure");
    });
    await expect(f.asActor("staff")).rejects.toThrow(
      "Synthetic access persistence failure",
    );
    expect(f.rows()).toEqual(before);
    expect(getLastPulledCursor(f.shop)).toEqual(cursor);
    expect(getLastPulledAccess(f.shop)).toEqual(access);
    f.serverUnchanged();
  });
});

describe("credit links after role-switch access purge", () => {
  it.each(["incremental", "explicit-full"] as const)(
    "restores an equal-timestamp credit link through %s hydration",
    async (mode) => {
      const f = fixture(true);
      await f.asActor("owner");
      const before = sqlite
        .prepare("SELECT * FROM credits WHERE shop_id=? ORDER BY id")
        .all(f.shop);
      const allocations = sqlite
        .prepare(
          "SELECT * FROM credit_payment_allocations WHERE shop_id=? ORDER BY id",
        )
        .all(f.shop);
      const drawer = sqlite
        .prepare("SELECT * FROM cash_drawer WHERE shop_id=?")
        .get(f.shop)!;
      expect(expectedCash(getCashSummarySync(f.shop, "2026-01-01"))).toBe(1070);
      expect(drawer.closing_expected).toBe(1070);
      await f.asActor("staff");
      expect(
        sqlite
          .prepare("SELECT sale_id,updated_at FROM credits WHERE id=?")
          .get(f.credit),
      ).toEqual({ sale_id: null, updated_at: NOW });
      if (mode === "explicit-full") {
        await f.asActor("owner", () => true);
        await pullChanges(f.shop, null, undefined, undefined, f.owner);
      } else {
        await f.asActor("owner");
      }
      f.serverUnchanged();
      // This is the precise regression oracle: ON DELETE SET NULL changed no
      // timestamp, so the default LWW equality branch must not lose this link.
      expect(
        sqlite.prepare("SELECT sale_id FROM credits WHERE id=?").get(f.credit),
      ).toEqual({ sale_id: f.ownerSale });
      expect(
        sqlite
          .prepare("SELECT * FROM credits WHERE shop_id=? ORDER BY id")
          .all(f.shop),
      ).toEqual(before);
      expect(
        sqlite
          .prepare(
            "SELECT * FROM credit_payment_allocations WHERE shop_id=? ORDER BY id",
          )
          .all(f.shop),
      ).toEqual(allocations);
      expect(
        sqlite.prepare("SELECT * FROM cash_drawer WHERE shop_id=?").get(f.shop),
      ).toEqual(drawer);
      expect(expectedCash(getCashSummarySync(f.shop, "2026-01-01"))).toBe(1070);
      // Same identity predicate used by the refund writer before it can proceed.
      expect(
        sqlite
          .prepare(
            "SELECT id FROM credits WHERE shop_id=? AND sale_id=? AND is_deleted=0",
          )
          .get(f.shop, f.ownerSale),
      ).toEqual({ id: f.credit });
      expect(
        sqlite.prepare("SELECT id FROM sync_queue WHERE shop_id=?").all(f.shop),
      ).toEqual([]);
    },
  );
});

describe("R1 credit-link restoration guard boundaries", () => {
  it.each(["pending", "failed"] as const)(
    "preserves a %s credit update and its queue",
    async (status) => {
      const f = fixture(true);
      await f.asActor("owner");
      await f.asActor("staff");
      const before = sqlite
        .prepare("SELECT * FROM credits WHERE id=?")
        .get(f.credit)!;
      sqlite
        .prepare(
          "INSERT INTO sync_queue(id,seq,shop_id,table_name,row_id,op,payload,status) VALUES(?,? ,?,'credits',?,'update',?,?)",
        )
        .run(
          f.queueId,
          sequence,
          f.shop,
          f.credit,
          JSON.stringify(before),
          status,
        );
      const queued = sqlite
        .prepare("SELECT * FROM sync_queue WHERE shop_id=?")
        .all(f.shop);
      await f.asActor("owner");
      expect(
        sqlite.prepare("SELECT * FROM credits WHERE id=?").get(f.credit),
      ).toEqual(before);
      expect(
        sqlite.prepare("SELECT * FROM sync_queue WHERE shop_id=?").all(f.shop),
      ).toEqual(queued);
      f.serverUnchanged();
    },
  );

  it.each(["pending", "failed"] as const)(
    "preserves a credit protected by a %s allocation dependency",
    async (status) => {
      const f = fixture(true);
      await f.asActor("owner");
      await f.asActor("staff");
      const before = sqlite
        .prepare("SELECT * FROM credits WHERE id=?")
        .get(f.credit)!;
      const allocation = sqlite
        .prepare("SELECT * FROM credit_payment_allocations WHERE id=?")
        .get(f.allocation)!;
      sqlite
        .prepare(
          "INSERT INTO sync_queue(id,seq,shop_id,table_name,row_id,op,payload,status) VALUES(?,?,?,'credit_payment_allocations',?,'insert',?,?)",
        )
        .run(
          f.queueId,
          sequence,
          f.shop,
          f.allocation,
          JSON.stringify(allocation),
          status,
        );
      const queued = sqlite
        .prepare("SELECT * FROM sync_queue WHERE shop_id=?")
        .all(f.shop);
      await f.asActor("owner");
      expect(
        sqlite.prepare("SELECT * FROM credits WHERE id=?").get(f.credit),
      ).toEqual(before);
      expect(
        sqlite.prepare("SELECT * FROM sync_queue WHERE shop_id=?").all(f.shop),
      ).toEqual(queued);
      f.serverUnchanged();
    },
  );

  it.each(["amount", "balance"] as const)(
    "refuses equal-timestamp repair when %s differs",
    async (column) => {
      const f = fixture(true);
      await f.asActor("owner");
      await f.asActor("staff");
      // Column is a closed test-owned enum, not user input.
      sqlite
        .prepare(`UPDATE credits SET ${column}=999 WHERE id=?`)
        .run(f.credit);
      const before = sqlite
        .prepare("SELECT * FROM credits WHERE id=?")
        .get(f.credit);
      await f.asActor("owner");
      expect(
        sqlite.prepare("SELECT * FROM credits WHERE id=?").get(f.credit),
      ).toEqual(before);
      f.serverUnchanged();
    },
  );

  it("retains a locally newer credit", async () => {
    const f = fixture(true);
    await f.asActor("owner");
    await f.asActor("staff");
    sqlite
      .prepare(
        "UPDATE credits SET updated_at='2026-03-01T10:00:00.000Z' WHERE id=?",
      )
      .run(f.credit);
    const before = sqlite
      .prepare("SELECT * FROM credits WHERE id=?")
      .get(f.credit);
    await f.asActor("owner");
    expect(
      sqlite.prepare("SELECT * FROM credits WHERE id=?").get(f.credit),
    ).toEqual(before);
    f.serverUnchanged();
  });

  it("keeps equal-timestamp LWW for unchanged-context explicit full hydration", async () => {
    const f = fixture(true);
    await f.asActor("owner");
    sqlite.prepare("UPDATE credits SET sale_id=NULL WHERE id=?").run(f.credit);
    const before = sqlite
      .prepare("SELECT * FROM credits WHERE id=?")
      .get(f.credit);
    await pullChanges(f.shop, null, undefined, undefined, f.owner);
    expect(
      sqlite.prepare("SELECT * FROM credits WHERE id=?").get(f.credit),
    ).toEqual(before);
    f.serverUnchanged();
  });

  it("restores an unknown legacy access context without changing monetary columns", async () => {
    const f = fixture(true);
    sqlite.prepare("UPDATE credits SET sale_id=NULL WHERE id=?").run(f.credit);
    const before = sqlite
      .prepare("SELECT * FROM credits WHERE id=?")
      .get(f.credit)!;
    await f.asActor("owner");
    expect(
      sqlite.prepare("SELECT * FROM credits WHERE id=?").get(f.credit),
    ).toEqual({ ...before, sale_id: f.ownerSale });
    f.serverUnchanged();
  });

  it.each(["missing", "foreign-shop"] as const)(
    "never links a %s sale",
    (kind) => {
      const f = fixture(true);
      const other = fixture(true);
      sqlite
        .prepare("UPDATE credits SET sale_id=NULL WHERE id=?")
        .run(f.credit);
      const before = sqlite
        .prepare("SELECT * FROM credits WHERE id=?")
        .get(f.credit);
      const saleId =
        kind === "missing"
          ? "79000000-ffff-4000-8000-999999999999"
          : other.ownerSale;
      expect(
        applyRemoteRows(
          [
            {
              tableName: "credits",
              row: { ...f.serverCredit, sale_id: saleId },
            },
          ],
          { expectedShopId: f.shop, restoreAccessPrunedCreditLinks: true },
        ),
      ).toEqual(["skipped_stale"]);
      expect(
        sqlite.prepare("SELECT * FROM credits WHERE id=?").get(f.credit),
      ).toEqual(before);
      f.serverUnchanged();
      other.serverUnchanged();
    },
  );

  it("does not opt default apply into credit-link restoration", () => {
    const f = fixture(true);
    sqlite.prepare("UPDATE credits SET sale_id=NULL WHERE id=?").run(f.credit);
    const before = sqlite
      .prepare("SELECT * FROM credits WHERE id=?")
      .get(f.credit);
    expect(
      applyRemoteRows([{ tableName: "credits", row: f.serverCredit! }], {
        expectedShopId: f.shop,
      }),
    ).toEqual(["skipped_stale"]);
    expect(
      applyRemoteRows([{ tableName: "credits", row: f.serverCredit! }], {
        restoreAccessPrunedCreditLinks: true,
      }),
    ).toEqual(["skipped_stale"]);
    expect(
      sqlite.prepare("SELECT * FROM credits WHERE id=?").get(f.credit),
    ).toEqual(before);
    f.serverUnchanged();
  });

  it("rolls back restored sales and metadata if the link update fails", async () => {
    const f = fixture(true);
    await f.asActor("owner");
    await f.asActor("staff");
    const before = f.rows();
    const creditBefore = sqlite
      .prepare("SELECT * FROM credits WHERE id=?")
      .get(f.credit);
    const cursor = getLastPulledCursor(f.shop),
      access = getLastPulledAccess(f.shop);
    sqlite.exec(
      "CREATE TEMP TRIGGER reject_credit_link BEFORE UPDATE OF sale_id ON credits BEGIN SELECT RAISE(ABORT, 'synthetic credit-link failure'); END",
    );
    try {
      await expect(f.asActor("owner")).rejects.toThrow(
        "synthetic credit-link failure",
      );
    } finally {
      sqlite.exec("DROP TRIGGER reject_credit_link");
    }
    expect(f.rows()).toEqual(before);
    expect(
      sqlite.prepare("SELECT * FROM credits WHERE id=?").get(f.credit),
    ).toEqual(creditBefore);
    expect(getLastPulledCursor(f.shop)).toEqual(cursor);
    expect(getLastPulledAccess(f.shop)).toEqual(access);
    expect(
      sqlite.prepare("SELECT id FROM sync_queue WHERE shop_id=?").all(f.shop),
    ).toEqual([]);
    f.serverUnchanged();
  });
});

// H-B candidate contract: Staff receives the same authorized credit values,
// with only the hidden colleague-sale FK masked. The active-chain failure log
// is preserved; this is local candidate acceptance, not hosted parity.
describe("H-B fresh Staff credit hydration contract", () => {
  it("hydrates a newly arriving colleague credit without a missing-parent failure", async () => {
    const f = fixture(true);
    sqlite
      .prepare("DELETE FROM credit_payment_allocations WHERE shop_id=?")
      .run(f.shop);
    sqlite.prepare("DELETE FROM credits WHERE shop_id=?").run(f.shop);
    sqlite.prepare("DELETE FROM sale_items WHERE shop_id=?").run(f.shop);
    sqlite
      .prepare("DELETE FROM sales WHERE shop_id=? AND staff_id<>?")
      .run(f.shop, f.staff);
    const before = f.rows(),
      cursor = getLastPulledCursor(f.shop);
    const access = getLastPulledAccess(f.shop);
    let failure: unknown;
    // No implementation is bypassed: actual pull/apply enforces SQLite FKs.
    try {
      await f.asActor("staff");
    } catch (error) {
      failure = error;
    }
    if (failure) {
      expect(f.rows()).toEqual(before);
      expect(getLastPulledCursor(f.shop)).toEqual(cursor);
      expect(getLastPulledAccess(f.shop)).toEqual(access);
      expect(
        sqlite.prepare("SELECT id FROM credits WHERE shop_id=?").all(f.shop),
      ).toEqual([]);
    }
    f.serverUnchanged();
    // Preserve the intended acceptance failure after proving atomic rollback.
    expect(failure).toBeUndefined();
    expect(f.rows().sales.map((row) => row.id)).toEqual([f.staffSale]);
    expect(
      sqlite.prepare("SELECT id FROM credits WHERE shop_id=?").all(f.shop),
    ).toEqual([{ id: f.credit }]);
  });
});

describe("R1 ancillary-field equality fails closed", () => {
  it.each([
    "one-sided-null",
    "invalid-remote-created",
    "invalid-local-created",
    "missing-amount",
  ] as const)(
    "skips %s without blocking hydration or altering the row",
    (kind) => {
      const f = fixture(true);
      sqlite
        .prepare("UPDATE credits SET sale_id=NULL WHERE id=?")
        .run(f.credit);
      const remote: Record<string, unknown> = { ...f.serverCredit };
      if (kind === "one-sided-null") remote.deleted_at = NOW;
      if (kind === "invalid-remote-created") remote.created_at = "invalid-date";
      if (kind === "invalid-local-created")
        sqlite
          .prepare("UPDATE credits SET created_at='invalid-date' WHERE id=?")
          .run(f.credit);
      if (kind === "missing-amount") delete remote.amount;
      const before = sqlite
        .prepare("SELECT * FROM credits WHERE id=?")
        .get(f.credit);
      expect(
        applyRemoteRows([{ tableName: "credits", row: remote }], {
          expectedShopId: f.shop,
          restoreAccessPrunedCreditLinks: true,
        }),
      ).toEqual(["skipped_stale"]);
      expect(
        sqlite.prepare("SELECT * FROM credits WHERE id=?").get(f.credit),
      ).toEqual(before);
      expect(
        sqlite.prepare("SELECT id FROM sync_queue WHERE shop_id=?").all(f.shop),
      ).toEqual([]);
      f.serverUnchanged();
    },
  );

  it("compares equivalent timestamp encodings without rewriting local metadata", () => {
    const f = fixture(true);
    sqlite.prepare("UPDATE credits SET sale_id=NULL WHERE id=?").run(f.credit);
    const before = sqlite
      .prepare("SELECT * FROM credits WHERE id=?")
      .get(f.credit)!;
    expect(
      applyRemoteRows(
        [
          {
            tableName: "credits",
            row: {
              ...f.serverCredit,
              created_at: "2026-01-01T10:00:00+00:00",
              updated_at: "2026-01-01T10:00:00+00:00",
            },
          },
        ],
        { expectedShopId: f.shop, restoreAccessPrunedCreditLinks: true },
      ),
    ).toEqual(["applied"]);
    expect(
      sqlite.prepare("SELECT * FROM credits WHERE id=?").get(f.credit),
    ).toEqual({ ...before, sale_id: f.ownerSale });
    f.serverUnchanged();
  });
});

describe("R1 legacy full-hydration access answers", () => {
  it.each(["missing", "malformed"] as const)(
    "keeps strict LWW for a %s access answer",
    async (kind) => {
      const f = fixture(true);
      sqlite
        .prepare("UPDATE credits SET sale_id=NULL WHERE id=?")
        .run(f.credit);
      const before = sqlite
        .prepare("SELECT * FROM credits WHERE id=?")
        .get(f.credit);
      const original = network.invoke.getMockImplementation()!;
      network.invoke.mockImplementation(async (...args) => {
        const result = await original(...args);
        const data = { ...result.data };
        if (kind === "missing") delete data.readableTables;
        else data.readableTables = ["shops"];
        return { ...result, data };
      });
      await f.asActor("owner", () => true);
      await pullChanges(f.shop, null, undefined, undefined, f.owner);
      expect(
        sqlite.prepare("SELECT * FROM credits WHERE id=?").get(f.credit),
      ).toEqual(before);
      expect(getLastPulledAccess(f.shop)).toBeNull();
      f.serverUnchanged();
    },
  );
});

describe("F3/F4 targeted SQLite parent-closure reproductions", () => {
  it("F3 fresh Staff completed-draft hydration keeps FK integrity", async () => {
    const f = fixture(false, true);
    sqlite.prepare("DELETE FROM sale_drafts WHERE shop_id=?").run(f.shop);
    sqlite.prepare("DELETE FROM sale_items WHERE shop_id=?").run(f.shop);
    sqlite
      .prepare("DELETE FROM sales WHERE shop_id=? AND staff_id<>?")
      .run(f.shop, f.staff);
    const before = f.rows(),
      graphBefore = scopedGraphSnapshot(f.shop),
      cursor = getLastPulledCursor(f.shop),
      access = getLastPulledAccess(f.shop);
    let failure: unknown;
    try {
      await f.asActor("staff");
    } catch (error) {
      failure = error;
    }
    if (failure) {
      expect(failure).toMatchObject({ code: "ERR_SQLITE_ERROR", errcode: 787 });
      expect(f.rows()).toEqual(before);
      expect(scopedGraphSnapshot(f.shop)).toEqual(graphBefore);
      expect(getLastPulledCursor(f.shop)).toEqual(cursor);
      expect(getLastPulledAccess(f.shop)).toEqual(access);
    }
    f.serverUnchanged();
    expect(failure).toBeUndefined();
    expect(
      sqlite
        .prepare("SELECT id,completed_sale_id FROM sale_drafts WHERE id=?")
        .get(f.completedDraft),
    ).toEqual({ id: f.completedDraft, completed_sale_id: null });
    expect(f.rows().sales.map((row) => row.id)).toEqual([f.staffSale]);
    expect(sqlite.prepare("PRAGMA foreign_keys").get()).toEqual({
      foreign_keys: 1,
    });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it.each(["all-parents", "hidden-parents"] as const)(
    "F4 allocation hydration with %s",
    async (permissions) => {
      const f = fixture(true);
      sqlite
        .prepare("DELETE FROM credit_payment_allocations WHERE shop_id=?")
        .run(f.shop);
      sqlite.prepare("DELETE FROM credits WHERE shop_id=?").run(f.shop);
      sqlite.prepare("DELETE FROM payments WHERE shop_id=?").run(f.shop);
      if (permissions === "hidden-parents")
        f.setReadable(
          HYDRATION_TABLE_ORDER.filter(
            (table) =>
              !["credits", "payments", "credit_payment_allocations"].includes(
                table,
              ),
          ),
        );
      const before = f.rows(),
        graphBefore = scopedGraphSnapshot(f.shop),
        cursor = getLastPulledCursor(f.shop),
        access = getLastPulledAccess(f.shop);
      let failure: unknown;
      try {
        await f.asActor("staff");
      } catch (error) {
        failure = error;
      }
      if (failure) {
        expect(failure).toMatchObject({
          code: "ERR_SQLITE_ERROR",
          errcode: 787,
        });
        expect(f.rows()).toEqual(before);
        expect(scopedGraphSnapshot(f.shop)).toEqual(graphBefore);
        expect(getLastPulledCursor(f.shop)).toEqual(cursor);
        expect(getLastPulledAccess(f.shop)).toEqual(access);
      }
      f.serverUnchanged();
      expect(failure).toBeUndefined();
      expect(
        sqlite
          .prepare(
            "SELECT credit_id,payment_id,amount FROM credit_payment_allocations WHERE id=?",
          )
          .get(f.allocation),
      ).toEqual(
        permissions === "all-parents"
          ? { credit_id: f.credit, payment_id: f.payment, amount: 450 }
          : undefined,
      );
      expect(sqlite.prepare("PRAGMA foreign_keys").get()).toEqual({
        foreign_keys: 1,
      });
      expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    },
  );
});

function scopedGraphSnapshot(shopId: string) {
  const tables = [
    "sales",
    "sale_items",
    "sale_drafts",
    "sale_draft_items",
    "customers",
    "credit_reconciliation_states",
    "credits",
    "payments",
    "credit_payment_allocations",
    "cash_drawer",
    "inventory_movements",
    "sync_queue",
  ] as const;
  return Object.fromEntries(
    tables.map((table) => [
      table,
      sqlite
        .prepare("SELECT * FROM " + table + " WHERE shop_id=? ORDER BY id")
        .all(shopId),
    ]),
  );
}

describe("F4-C reconciliation/customer SQLite closure", () => {
  it("hydrates a credit-view-only graph without orphaned reconciliation state", async () => {
    const f = fixture(true);
    for (const table of [
      "credit_payment_allocations",
      "credit_reconciliation_states",
      "credits",
      "payments",
      "customers",
    ])
      sqlite.prepare("DELETE FROM " + table + " WHERE shop_id=?").run(f.shop);
    f.setReadable(
      HYDRATION_TABLE_ORDER.filter(
        (table) =>
          ![
            "credits",
            "payments",
            "customers",
            "credit_payment_allocations",
            "credit_reconciliation_states",
          ].includes(table),
      ),
    );
    const before = scopedGraphSnapshot(f.shop),
      cursor = getLastPulledCursor(f.shop),
      access = getLastPulledAccess(f.shop);
    let failure: unknown;
    try {
      await f.asActor("staff");
    } catch (error) {
      failure = error;
    }
    if (failure) {
      expect(failure).toMatchObject({ code: "ERR_SQLITE_ERROR", errcode: 787 });
      expect(scopedGraphSnapshot(f.shop)).toEqual(before);
      expect(getLastPulledCursor(f.shop)).toEqual(cursor);
      expect(getLastPulledAccess(f.shop)).toEqual(access);
    }
    f.serverUnchanged();
    expect(failure).toBeUndefined();
    expect(
      sqlite
        .prepare("SELECT id FROM credit_reconciliation_states WHERE shop_id=?")
        .all(f.shop),
    ).toEqual([]);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

function draftRow(id: string) {
  return sqlite.prepare("SELECT * FROM sale_drafts WHERE id=?").get(id)!;
}
function maskLocalDraft(f: ReturnType<typeof fixture>) {
  sqlite
    .prepare("UPDATE sale_drafts SET completed_sale_id=NULL WHERE id=?")
    .run(f.completedDraft);
}
function freshStaffDraft(f: ReturnType<typeof fixture>) {
  sqlite.prepare("DELETE FROM sale_drafts WHERE shop_id=?").run(f.shop);
  sqlite.prepare("DELETE FROM sale_items WHERE shop_id=?").run(f.shop);
  sqlite
    .prepare("DELETE FROM sales WHERE shop_id=? AND staff_id<>?")
    .run(f.shop, f.staff);
}
function applyDraft(
  f: ReturnType<typeof fixture>,
  row: Record<string, unknown> = f.serverDraft!,
  restore = true,
) {
  return applyRemoteRows([{ tableName: "sale_drafts", row }], {
    expectedShopId: f.shop,
    restoreAccessPrunedDraftLinks: restore,
  });
}

describe("F3 guarded completed-draft link reconstruction", () => {
  it("restores a fresh Staff projection on Owner return without other draft writes", async () => {
    const f = fixture(false, true);
    freshStaffDraft(f);
    await f.asActor("staff");
    const before = draftRow(f.completedDraft);
    expect(before.completed_sale_id).toBeNull();
    expect(before.checkout_snapshot).not.toBeNull();
    expect(f.rows().sales.map((row) => row.id)).toEqual([f.staffSale]);
    await f.asActor("owner");
    expect(draftRow(f.completedDraft)).toEqual({
      ...before,
      completed_sale_id: f.ownerSale,
    });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    f.serverUnchanged();
  });
  it("reinserts the populated Owner draft deleted by the Staff access purge", async () => {
    const f = fixture(false, true);
    const original = draftRow(f.completedDraft);
    await f.asActor("owner");
    await f.asActor("staff");
    expect(draftRow(f.completedDraft)).toBeUndefined();
    await f.asActor("owner");
    expect(draftRow(f.completedDraft)).toEqual({ ...original, is_dirty: 1 });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    f.serverUnchanged();
  });
  it("restores an unknown legacy context, retaining every non-link field", async () => {
    const f = fixture(false, true);
    maskLocalDraft(f);
    const before = draftRow(f.completedDraft);
    await f.asActor("owner");
    expect(draftRow(f.completedDraft)).toEqual({
      ...before,
      completed_sale_id: f.ownerSale,
    });
    f.serverUnchanged();
  });
  it("keeps strict LWW for default apply and unchanged-context full hydration", async () => {
    const f = fixture(false, true);
    await f.asActor("owner");
    maskLocalDraft(f);
    const before = draftRow(f.completedDraft);
    expect(applyDraft(f, f.serverDraft!, false)).toEqual(["skipped_stale"]);
    await pullChanges(f.shop, null, undefined, undefined, f.owner);
    expect(draftRow(f.completedDraft)).toEqual(before);
    f.serverUnchanged();
  });
  it.each([
    "status",
    "origin_device_id",
    "actor_id",
    "customer_id",
    "checkout_snapshot",
    "prescription_no",
    "patient_name",
    "prescriber_name",
    "is_deleted",
    "deleted_by",
    "created_at",
    "deleted_at",
  ] as const)("refuses a changed %s field", (column) => {
    const f = fixture(true, true);
    maskLocalDraft(f);
    const values = {
      status: "held",
      origin_device_id: "changed-device",
      actor_id: f.staff,
      customer_id: f.customer,
      checkout_snapshot: "changed snapshot",
      prescription_no: "changed prescription",
      patient_name: "changed patient",
      prescriber_name: "changed clinician",
      is_deleted: 1,
      deleted_by: f.owner,
      created_at: "2025-01-01T00:00:00.000Z",
      deleted_at: NOW,
    };
    sqlite
      .prepare("UPDATE sale_drafts SET " + column + "=? WHERE id=?")
      .run(values[column], f.completedDraft);
    const before = draftRow(f.completedDraft);
    expect(applyDraft(f)).toEqual(["skipped_stale"]);
    expect(draftRow(f.completedDraft)).toEqual(before);
    f.serverUnchanged();
  });
  it("refuses an incomplete remote business snapshot", () => {
    const f = fixture(false, true);
    maskLocalDraft(f);
    const before = draftRow(f.completedDraft),
      payload = { ...f.serverDraft };
    delete payload.patient_name;
    expect(applyDraft(f, payload)).toEqual(["skipped_stale"]);
    expect(draftRow(f.completedDraft)).toEqual(before);
    f.serverUnchanged();
  });
  it.each(["missing", "foreign-shop"] as const)(
    "refuses a %s sale parent",
    (kind) => {
      const f = fixture(false, true),
        other = fixture();
      maskLocalDraft(f);
      const before = draftRow(f.completedDraft);
      expect(
        applyDraft(f, {
          ...f.serverDraft,
          completed_sale_id:
            kind === "missing"
              ? "79000000-ffff-4000-8000-999999999999"
              : other.ownerSale,
        }),
      ).toEqual(["skipped_stale"]);
      expect(draftRow(f.completedDraft)).toEqual(before);
      f.serverUnchanged();
      other.serverUnchanged();
    },
  );
  it("fails closed when another local draft already owns the unique sale link", () => {
    const f = fixture(false, true);
    maskLocalDraft(f);
    sqlite
      .prepare(
        "INSERT INTO sale_drafts(id,shop_id,status,origin_device_id,actor_id,completed_sale_id) VALUES(?,?,'completed','synthetic-other-device',?,?)",
      )
      .run(f.queueId, f.shop, f.owner, f.ownerSale);
    const before = scopedGraphSnapshot(f.shop);
    expect(applyDraft(f)).toEqual(["skipped_stale"]);
    expect(scopedGraphSnapshot(f.shop)).toEqual(before);
    f.serverUnchanged();
  });
  it.each(["pending", "failed"] as const)(
    "retains a %s direct or child dependency graph",
    async (status) => {
      for (const child of [false, true]) {
        const f = fixture(false, true);
        maskLocalDraft(f);
        if (child)
          sqlite
            .prepare(
              "INSERT INTO sale_draft_items(id,shop_id,draft_id,medicine_id,qty) VALUES(?,?,?,?,1)",
            )
            .run(f.queueId, f.shop, f.completedDraft, f.med);
        const table = child ? "sale_draft_items" : "sale_drafts",
          rowId = child ? f.queueId : f.completedDraft;
        const payload = child
          ? {
              id: rowId,
              shop_id: f.shop,
              draft_id: f.completedDraft,
              medicine_id: f.med,
              qty: 1,
            }
          : f.serverDraft;
        sqlite
          .prepare(
            "INSERT INTO sync_queue(id,seq,shop_id,table_name,row_id,op,payload,status) VALUES(?,?,?,?,?,'update',?,?)",
          )
          .run(
            f.queueId,
            sequence,
            f.shop,
            table,
            rowId,
            JSON.stringify(payload),
            status,
          );
        const before = scopedGraphSnapshot(f.shop);
        await f.asActor("owner");
        expect(scopedGraphSnapshot(f.shop)).toEqual(before);
        f.serverUnchanged();
      }
    },
  );
  it("rolls back graph/cursor/access on an injected link-update failure", async () => {
    const f = fixture(false, true);
    maskLocalDraft(f);
    const before = scopedGraphSnapshot(f.shop),
      cursor = getLastPulledCursor(f.shop),
      access = getLastPulledAccess(f.shop);
    sqlite.exec(
      `CREATE TEMP TRIGGER reject_draft_link BEFORE UPDATE OF completed_sale_id ON sale_drafts WHEN NEW.id='${f.completedDraft}' AND NEW.completed_sale_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'synthetic draft-link failure'); END`,
    );
    try {
      await expect(f.asActor("owner")).rejects.toThrow(
        "synthetic draft-link failure",
      );
    } finally {
      sqlite.exec("DROP TRIGGER reject_draft_link");
    }
    expect(scopedGraphSnapshot(f.shop)).toEqual(before);
    expect(getLastPulledCursor(f.shop)).toEqual(cursor);
    expect(getLastPulledAccess(f.shop)).toEqual(access);
    f.serverUnchanged();
  });
  it("accepts equivalent Boolean wire values without changing any metadata", () => {
    const f = fixture(false, true);
    maskLocalDraft(f);
    const before = draftRow(f.completedDraft);
    expect(applyDraft(f, { ...f.serverDraft, is_deleted: 0 })).toEqual([
      "applied",
    ]);
    expect(draftRow(f.completedDraft)).toEqual({
      ...before,
      completed_sale_id: f.ownerSale,
    });
    f.serverUnchanged();
  });
});

describe("F3/F4 incremental and revoke lifecycle", () => {
  it("applies a new masked colleague draft on a same-context incremental page", async () => {
    const f = fixture(false, true);
    freshStaffDraft(f);
    await f.asActor("staff");
    sqlite.prepare("DELETE FROM sale_drafts WHERE id=?").run(f.completedDraft);
    setLastPulledCursor(f.shop, {
      updatedAt: "2025-01-01T00:00:00.000Z",
      tableName: "sales",
      rowId: f.staffSale,
    });
    const calls = network.invoke.mock.calls.length;
    await f.asActor("staff");
    expect(network.invoke.mock.calls.slice(calls)).toHaveLength(1);
    expect(network.invoke.mock.calls.at(-1)![1].body.since).not.toBeNull();
    expect(draftRow(f.completedDraft).completed_sale_id).toBeNull();
    expect(f.rows().sales.map((row) => row.id)).toEqual([f.staffSale]);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    f.serverUnchanged();
  });
  it.each(["clean", "pending", "failed"] as const)(
    "reconciles narrowed allocation access while retaining %s work",
    async (status) => {
      const f = fixture(true);
      await f.asActor("owner");
      if (status !== "clean") {
        const payload = sqlite
          .prepare("SELECT * FROM credit_payment_allocations WHERE id=?")
          .get(f.allocation)!;
        sqlite
          .prepare(
            "INSERT INTO sync_queue(id,seq,shop_id,table_name,row_id,op,payload,status) VALUES(?,?,?,'credit_payment_allocations',?,'insert',?,?)",
          )
          .run(
            f.queueId,
            sequence,
            f.shop,
            f.allocation,
            JSON.stringify(payload),
            status,
          );
      }
      const allocation = sqlite
          .prepare("SELECT * FROM credit_payment_allocations WHERE id=?")
          .get(f.allocation),
        queue = sqlite
          .prepare("SELECT * FROM sync_queue WHERE shop_id=?")
          .all(f.shop);
      f.setReadable(
        HYDRATION_TABLE_ORDER.filter(
          (table) =>
            !["payments", "credit_payment_allocations"].includes(table),
        ),
      );
      await f.asActor("staff");
      expect(
        sqlite
          .prepare("SELECT * FROM credit_payment_allocations WHERE id=?")
          .get(f.allocation),
      ).toEqual(status === "clean" ? undefined : allocation);
      if (status !== "clean") {
        expect(
          sqlite
            .prepare("SELECT id,amount FROM payments WHERE id=?")
            .get(f.payment),
        ).toEqual({ id: f.payment, amount: 450 });
        expect(
          sqlite
            .prepare("SELECT id,amount,balance FROM credits WHERE id=?")
            .get(f.credit),
        ).toEqual({ id: f.credit, amount: 1500, balance: 1050 });
        expect(
          sqlite
            .prepare("SELECT * FROM sync_queue WHERE shop_id=?")
            .all(f.shop),
        ).toEqual(queue);
      }
      f.setReadable([...HYDRATION_TABLE_ORDER]);
      await f.asActor("owner");
      expect(
        sqlite
          .prepare(
            "SELECT credit_id,payment_id,amount FROM credit_payment_allocations WHERE id=?",
          )
          .get(f.allocation),
      ).toEqual({ credit_id: f.credit, payment_id: f.payment, amount: 450 });
      expect(
        sqlite.prepare("SELECT * FROM sync_queue WHERE shop_id=?").all(f.shop),
      ).toEqual(queue);
      expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      f.serverUnchanged();
    },
  );
});
