// One-time migrations. Idempotent — guarded by flags in localStorage.
import { loadInvoices, saveInvoices, type SupplierInvoice } from "./supplierInvoices";
import { loadSuppliers, upsertSupplier } from "./suppliers";
import { shopStorage } from "./shopStorage";
import { saveMedicines } from "./medicineData";

const FLAG_KEY = "migrations";

function getFlags(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(FLAG_KEY) || "{}"); } catch { return {}; }
}
function setFlag(name: string) {
  const f = getFlags();
  f[name] = true;
  localStorage.setItem(FLAG_KEY, JSON.stringify(f));
}

function norm(s: string) { return (s || "").toLowerCase().trim(); }

// P1 migration: stamp supplierId on invoices, drop syncStatus, move payments inline,
// link batches back to their source invoice/supplier when possible.
function migrateSupplierGraphV1() {
  if (getFlags().supplierGraphV1) return;

  const errors: any[] = [];

  // 1. Backfill invoice.supplierId from supplierName.
  try {
    const invsRaw = JSON.parse(shopStorage.getItem("supplierInvoices") || "[]") as any[];
    const suppliersByName = new Map<string, string>();
    for (const s of loadSuppliers()) suppliersByName.set(norm(s.name), s.id);

    for (const inv of invsRaw) {
      if (!inv.supplierId && inv.supplierName) {
        const key = norm(inv.supplierName);
        let sid = suppliersByName.get(key);
        if (!sid) {
          const s = upsertSupplier({ name: inv.supplierName, phone: "" });
          sid = s.id;
          suppliersByName.set(key, sid);
        }
        inv.supplierId = sid;
      }
      delete inv.syncStatus;
    }

    // 2. Move payments from old separate store into invoice.payments[].
    let oldPays: any[] = [];
    try { oldPays = JSON.parse(shopStorage.getItem("supplierPayments") || "[]"); } catch {}
    if (oldPays.length) {
      const byInvoice = new Map<string, any[]>();
      for (const p of oldPays) {
        if (!p.invoiceId) continue;
        const arr = byInvoice.get(p.invoiceId) || [];
        arr.push({ id: p.id, amount: p.amount, date: p.date, note: p.note });
        byInvoice.set(p.invoiceId, arr);
      }
      for (const inv of invsRaw) {
        const incoming = byInvoice.get(inv.id);
        if (incoming?.length) {
          inv.payments = [...(inv.payments || []), ...incoming];
        }
      }
      shopStorage.removeItem("supplierPayments");
    }

    // Persist (bypass invariants by writing raw — assertInvoiceValid will drop any leftover invalids next save).
    shopStorage.setItem("supplierInvoices", JSON.stringify(invsRaw));
  } catch (e) { errors.push({ step: "invoices", e: String(e) }); }

  // 3. Backfill batches with invoiceId/supplierId.
  try {
    const meds = JSON.parse(shopStorage.getItem("medicines") || "[]") as any[];
    const invs = loadInvoices() as SupplierInvoice[];

    // Index invoice lines by (medicineId or normalized name) + batchNo for quick match.
    const lineIndex = new Map<string, { invoiceId: string; supplierId: string }>();
    for (const inv of invs) {
      for (const l of inv.lines || []) {
        if (l.batchNo && l.matchedMedicineId != null) {
          lineIndex.set(`${l.matchedMedicineId}|${l.batchNo}`, { invoiceId: inv.id, supplierId: inv.supplierId });
        }
      }
    }

    let stampedBatches = 0, legacyBatches = 0;
    for (const med of meds) {
      if (!Array.isArray(med.batches)) continue;
      for (const b of med.batches) {
        if (b.invoiceId && b.supplierId) continue;
        const hit = b.batchNo ? lineIndex.get(`${med.id}|${b.batchNo}`) : null;
        if (hit) {
          b.invoiceId = hit.invoiceId;
          b.supplierId = hit.supplierId;
          stampedBatches++;
        } else {
          b.legacy = true;
          legacyBatches++;
        }
      }
    }
    // Funnel through saveMedicines so the cache + medicines-updated event fire uniformly.
    saveMedicines(meds as any);
    if (stampedBatches || legacyBatches) {
      console.info(`[migration] supplierGraphV1: stamped ${stampedBatches} batches, ${legacyBatches} legacy.`);
    }
  } catch (e) { errors.push({ step: "batches", e: String(e) }); }

  if (errors.length) {
    localStorage.setItem("migrationErrors", JSON.stringify(errors));
    console.warn("[migration] supplierGraphV1 errors:", errors);
  }

  // Re-save invoices via the validated path so anything still missing supplierId is dropped.
  try { saveInvoices(loadInvoices()); } catch {}

  setFlag("supplierGraphV1");
}

// Backfill paymentTerms on all existing invoices. Placeholder invoices synthesized
// by the direct add-stock flow (manualBatchEntry === true) are treated as COD —
// they never represented real debt and were inflating the dashboard payable card.
// Formal invoices (no manualBatchEntry) are stamped as credit, matching the
// behavior they had before the field existed.
function migratePaymentTermsV1() {
  if (getFlags().paymentTermsV1) return;
  try {
    const raw = shopStorage.getItem("supplierInvoices");
    if (!raw) { setFlag("paymentTermsV1"); return; }
    const invs = JSON.parse(raw) as any[];
    if (!Array.isArray(invs)) { setFlag("paymentTermsV1"); return; }

    let codStamped = 0, creditStamped = 0;
    for (const inv of invs) {
      if (inv.paymentTerms === "cod" || inv.paymentTerms === "credit") continue;
      if (inv.manualBatchEntry === true) {
        inv.paymentTerms = "cod";
        // Synthesize a matching COD payment so totals net to zero with no further owner action.
        if (!Array.isArray(inv.payments) || inv.payments.length === 0) {
          const total = Number(inv.total) || 0;
          if (total > 0) {
            inv.payments = [{
              id: `pay_cod_${inv.id}`,
              amount: total,
              date: inv.invoiceDate || new Date().toISOString().slice(0, 10),
              note: "COD",
            }];
          }
        }
        codStamped++;
      } else {
        inv.paymentTerms = "credit";
        creditStamped++;
      }
    }

    shopStorage.setItem("supplierInvoices", JSON.stringify(invs));
    if (codStamped || creditStamped) {
      console.info(`[migration] paymentTermsV1: cod=${codStamped}, credit=${creditStamped}`);
    }
  } catch (e) {
    console.warn("[migration] paymentTermsV1 error:", e);
  }
  setFlag("paymentTermsV1");
}

// Migrate staff permissions from old 5-key system to new 12-key granular system.
// Maps old broad keys (sales, inventory, reports, staff, settings) to new specific keys.
function migrateStaffPermissionsV2() {
  if (getFlags().staffPermsV2) return;

  try {
    const raw = shopStorage.getItem("staffMembers");
    if (!raw) { setFlag("staffPermsV2"); return; }
    const members = JSON.parse(raw);
    if (!Array.isArray(members)) { setFlag("staffPermsV2"); return; }

    let migrated = 0;
    for (const m of members) {
      const old = m.permissions || {};

      // Map old broad keys to new granular keys
      const newPerms = {
        sale_entry:    old.sales      ?? true,
        sale_discount: old.sales      ?? false,
        sale_return:   old.sales      ?? false,
        sale_history:  old.sales      ?? false,
        inventory_view: old.inventory ?? true,
        inventory_edit: old.inventory ?? false,
        expiry_manage:  old.inventory ?? false,
        credit_view:   old.sales      ?? false,
        credit_manage: old.sales      ?? false,
        cash_drawer:   old.reports    ?? false,
        reports:       old.reports    ?? false,
        staff_manage:  old.staff      ?? false,
      };

      m.permissions = newPerms;
      migrated++;
    }

    shopStorage.setItem("staffMembers", JSON.stringify(members));
    if (migrated > 0) {
      console.info(`[migration] staffPermsV2: migrated ${migrated} staff members`);
    }
  } catch (e) {
    console.warn("[migration] staffPermsV2 error:", e);
  }

  setFlag("staffPermsV2");
}

// Multi-shop: create shop_1 from existing registration and move all scoped
// keys into shop_1's namespace. One-time, idempotent. Runs LAST so prior
// migrations see the original flat keys.
function migrateToMultiShop() {
  if (localStorage.getItem("multiShopMigrated")) return;

  const reg = (() => {
    try { return JSON.parse(localStorage.getItem("pharmacyRegistration") || "{}"); }
    catch { return {}; }
  })();

  // Resolve shop name: prefer pharmacyRegistration, fall back to currentUser / users[0]
  const resolvedName = (() => {
    if (reg.pharmacyName) return reg.pharmacyName;
    try {
      const cur = JSON.parse(localStorage.getItem("currentUser") || "{}");
      if (cur.shopName) return cur.shopName;
      const users = JSON.parse(localStorage.getItem("users") || "[]");
      if (users[0]?.shopName) return users[0].shopName;
    } catch {}
    return "আমার দোকান";
  })();
  const resolvedNameEn = reg.pharmacyNameEn || resolvedName;

  const existingRegistry = localStorage.getItem("shopRegistry");
  if (!existingRegistry) {
    const firstShop = {
      id: "shop_1",
      name: resolvedName,
      nameEn: resolvedNameEn,
      createdAt: new Date().toISOString(),
      isActive: true,
    };
    localStorage.setItem("shopRegistry", JSON.stringify([firstShop]));
  } else {
    // Patch shop_1 if it was seeded with a generic default name
    try {
      const registry = JSON.parse(existingRegistry);
      const idx = registry.findIndex((s: any) => s.id === "shop_1");
      if (idx !== -1 && (registry[idx].name === "আমার দোকান" || registry[idx].name === "My Shop")) {
        registry[idx].name = resolvedName;
        registry[idx].nameEn = resolvedNameEn;
        localStorage.setItem("shopRegistry", JSON.stringify(registry));
      }
    } catch {}
  }
  if (!localStorage.getItem("activeShopId")) {
    localStorage.setItem("activeShopId", "shop_1");
  }

  const SCOPED = [
    "medicines","transactions","customers","creditData","expenses",
    "inventory","suppliers","supplierInvoices","supplierPayments","cashDrawer","cashOpening",
    "cashWithdrawals","cashActualCounts",
    "dailyHistory","settledCreditHistory","auditLogs","staffMembers",
    "deletedMedicineIds","lastCompletedDay","scannedMedicineData",
    "lastPaymentAllocation","reportSettings",
  ];

  SCOPED.forEach((key) => {
    const val = localStorage.getItem(key);
    if (val !== null && localStorage.getItem(`shop_1__${key}`) === null) {
      localStorage.setItem(`shop_1__${key}`, val);
      localStorage.removeItem(key);
    }
  });

  localStorage.setItem("multiShopMigrated", "true");
}

// One-time patch: fix shop_1 that was saved with a generic default name.
// Safe to run even if multiShopMigrated is already set.
function patchShop1Name() {
  if (localStorage.getItem("shop1NamePatched")) return;
  try {
    const registry = JSON.parse(localStorage.getItem("shopRegistry") || "[]");
    const idx = registry.findIndex((s: any) => s.id === "shop_1");
    if (idx !== -1 && (registry[idx].name === "আমার দোকান" || registry[idx].name === "My Shop")) {
      const cur = JSON.parse(localStorage.getItem("currentUser") || "{}");
      const users = JSON.parse(localStorage.getItem("users") || "[]");
      const resolvedName = cur.shopName || users[0]?.shopName;
      if (resolvedName) {
        registry[idx].name = resolvedName;
        registry[idx].nameEn = cur.shopNameEn || resolvedName;
        localStorage.setItem("shopRegistry", JSON.stringify(registry));
      }
    }
  } catch {}
  localStorage.setItem("shop1NamePatched", "true");
}

export function runMigrations() {
  try { migrateToMultiShop(); } catch (e) { console.error("[migration] fatal", e); }
  try { migrateSupplierGraphV1(); } catch (e) { console.error("[migration] fatal", e); }
  try { migratePaymentTermsV1(); } catch (e) { console.error("[migration] fatal", e); }
  try { migrateStaffPermissionsV2(); } catch (e) { console.error("[migration] fatal", e); }
  try { patchShop1Name(); } catch (e) { console.error("[migration] fatal", e); }
}
