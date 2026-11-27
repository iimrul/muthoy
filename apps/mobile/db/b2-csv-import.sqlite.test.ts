// Founder item 2 (2026-11-27): bulk inventory from a spreadsheet, through the
// real importer on real SQLite. The template must import once its example rows
// are replaced, every problem in a file is reported at once, and a refused
// file writes nothing.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { sqlite } from './test/expo-sqlite';
import { ALWAYS_LIVE } from './errors';

const { db } = await import('./client');
const schema = await import('./schema');
const { importInventoryCsv, previewInventoryCsv, InventoryCsvError } = await import('./inventoryImport');
const { buildInventoryCsvTemplate } = await import('../domain/inventoryCsvTemplate');

function applyMigration(name: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', name), 'utf8'));
}

beforeAll(() => {
  for (const name of [
    '0000_open_senator_kelly.sql', '0001_medicines_fts.sql', '0002_furry_celestials.sql',
    '0003_curious_wild_pack.sql', '0004_deep_boomer.sql', '0005_eminent_legion.sql',
    '0006_inventory_movement_ledger.sql', '0007_staff_device_login.sql', '0008_native_pin_lookup.sql',
    '0009_strong_gargoyle.sql', '0010_known_ares.sql', '0027_h7_local_access_lock.sql',
    '0028_shop_scoped_pin_lookup.sql', '0029_pin_reserved_while_inactive.sql',
    '0033_medicine_search_key.sql', '0034_recovery_journal.sql',
  ]) applyMigration(name);
  const now = new Date().toISOString();
  db.insert(schema.shops).values({ id: 'shop', ownerId: 'owner', name: 'CSV', phone: '01700000000', createdAt: now, updatedAt: now }).run();
  db.insert(schema.roles).values({ id: 'owner-role', shopId: 'shop', name: 'owner', isSystem: true, createdAt: now, updatedAt: now }).run();
  db.insert(schema.users).values({ id: 'owner', shopId: 'shop', name: 'Owner', pinHash: 'hash', pinSetAt: now, roleId: 'owner-role', isActive: true, createdAt: now, updatedAt: now }).run();
});

const HEADER = 'name,generic,manufacturer,type,batch_no,expiry_date,stock,purchase_price,sale_price';

async function failureOf(csv: string): Promise<InstanceType<typeof InventoryCsvError>> {
  try {
    await previewInventoryCsv('shop', 'owner', csv);
  } catch (caught) {
    expect(caught).toBeInstanceOf(InventoryCsvError);
    return caught as InstanceType<typeof InventoryCsvError>;
  }
  throw new Error('preview accepted a file it should refuse');
}

/** Where and what — the quoted value and medicine name are checked separately. */
async function issuesOf(csv: string): Promise<unknown[]> {
  return (await failureOf(csv)).issues.map(({ value: _value, medicineName: _name, ...where }) => where);
}

const counts = () => ({
  medicines: db.select().from(schema.medicines).all().length,
  batches: db.select().from(schema.batches).all().length,
});

describe('the downloadable template', () => {
  it('refuses the template as downloaded: its example rows are not stock', async () => {
    expect(await issuesOf(buildInventoryCsvTemplate())).toEqual([
      { rowNumber: 2, code: 'example_row', column: 'batch_no' },
      { rowNumber: 3, code: 'example_row', column: 'batch_no' },
    ]);
  });

  it('imports through the real importer once the example batches are replaced', async () => {
    const filled = buildInventoryCsvTemplate().replace('EXAMPLE-1', 'NP-0127').replace('EXAMPLE-2', 'TP-0627');
    const preview = await previewInventoryCsv('shop', 'owner', filled);
    expect(preview.rows).toMatchObject([
      { name: 'Napa 500mg', type: 'tablet', batchNo: 'NP-0127', stock: 100, purchasePrice: 80, salePrice: 120, unitOfMeasure: 'piece', lowStockThresholdOverride: 20, action: 'create_medicine' },
      { name: 'Telmepress 20', type: 'capsule', batchNo: 'TP-0627', stock: 50, action: 'create_medicine' },
    ]);
    await importInventoryCsv('shop', 'owner', filled, preview.fingerprint, ALWAYS_LIVE);
    const types = db.select({ name: schema.medicines.name, type: schema.medicines.type }).from(schema.medicines).all();
    expect(types).toEqual(expect.arrayContaining([
      { name: 'Napa 500mg', type: 'tablet' },
      { name: 'Telmepress 20', type: 'capsule' },
    ]));
  });
});

// After the template test the shop holds Napa 500mg (tablet, Beximco
// Pharmaceuticals) and Telmepress 20 (CAPSULE, Square Pharmaceuticals).
describe('which medicine a row joins (founder, 2026-11-28)', () => {
  const row = (company: string, form: string, batch: string) =>
    `${HEADER}\nTelmepress 20,Telmisartan,${company},${form},${batch},2027-06-30,10,6.00,8.00`;

  it('never adds a tablet row to the capsule of the same name — it is a new medicine', async () => {
    const preview = await previewInventoryCsv('shop', 'owner', row('Square Pharmaceuticals', 'tablet', 'T-1'));
    expect(preview.rows[0]).toMatchObject({ action: 'create_medicine', medicineId: null, type: 'tablet' });
  });

  it('adds a capsule row to the capsule', async () => {
    const preview = await previewInventoryCsv('shop', 'owner', row('Square Pharmaceuticals', 'capsule', 'C-2'));
    expect(preview.rows[0]).toMatchObject({ action: 'add_batch', type: 'capsule' });
    expect(preview.rows[0]?.medicineId).toBeTruthy();
  });

  it('treats "Square" and "SQUARE PHARMACEUTICALS LTD." as the same company', async () => {
    for (const company of ['Square', 'SQUARE PHARMACEUTICALS LTD.']) {
      const preview = await previewInventoryCsv('shop', 'owner', row(company, 'capsule', `S-${company.length}`));
      expect(preview.rows[0]).toMatchObject({ action: 'add_batch' });
      expect(preview.warnings).toEqual([]);
    }
  });

  it('warns — never merges, never refuses — when the company is spelled almost the same', async () => {
    const preview = await previewInventoryCsv('shop', 'owner', row('Sqaure Pharmaceuticals', 'capsule', 'W-1'));
    expect(preview.rows[0]).toMatchObject({ action: 'create_medicine' });
    expect(preview.warnings).toEqual([{
      rowNumber: 2, code: 'similar_company', medicineName: 'Telmepress 20',
      value: 'Sqaure Pharmaceuticals', existing: 'Square Pharmaceuticals',
    }]);
  });

  it('asks for the form when the shop has the same name as both a tablet and a capsule', async () => {
    const both = `${HEADER}\nNapa 500mg,Paracetamol,Beximco Pharmaceuticals,capsule,NC-1,,5,1.00,2.00`;
    const created = await previewInventoryCsv('shop', 'owner', both);
    expect(created.rows[0]).toMatchObject({ action: 'create_medicine' });
    await importInventoryCsv('shop', 'owner', both, created.fingerprint, ALWAYS_LIVE);
    const failure = await failureOf(`${HEADER}\nNapa 500mg,Paracetamol,Beximco Pharmaceuticals,,NX-1,,5,1.00,2.00`);
    expect(failure.issues).toEqual([{
      rowNumber: 2, code: 'ambiguous_medicine', column: 'type', value: 'tablet, capsule', medicineName: 'Napa 500mg',
    }]);
  });

  it('keeps a tablet and a capsule of one name in one file as two medicines', async () => {
    const preview = await previewInventoryCsv('shop', 'owner', [
      HEADER,
      'Monas 10,Montelukast,ACME,tablet,MT-1,,5,1.00,2.00',
      'Monas 10,Montelukast,ACME,capsule,MC-1,,5,1.00,2.00',
    ].join('\n'));
    expect(preview.rows.map((r) => r.action)).toEqual(['create_medicine', 'create_medicine']);
  });

  it('names the medicine and quotes the cell for every problem, and counts the rows', async () => {
    const failure = await failureOf([
      HEADER,
      'Ace,Paracetamol,Square,tablet,A-9,31/12/2027,ten,1.00,1.50',
      'Fexo,Fexofenadine,Square,tablet,F-9,2027-12-31,5,4.00,5.00',
      ',Cetirizine,ACME,tablet,C-9,,5,abc,2.00',
    ].join('\n'));
    expect(failure.rowCount).toBe(3);
    expect(failure.issues).toEqual([
      { rowNumber: 2, code: 'bad_stock', column: 'stock', value: 'ten', medicineName: 'Ace' },
      { rowNumber: 2, code: 'bad_expiry', column: 'expiry_date', value: '31/12/2027', medicineName: 'Ace' },
      { rowNumber: 4, code: 'missing_text', column: 'name' },
      { rowNumber: 4, code: 'bad_price', column: 'purchase_price', value: 'abc' },
    ]);
  });
});

describe('every problem at once, and nothing written', () => {
  it('lists each bad row and column in one pass', async () => {
    const before = counts();
    const csv = [
      HEADER,
      'Ace,Paracetamol,Square,tablet,A-1,2027-02-30,ten,1.00,1.50',
      'Seclo 20,,Square,capsule,S-1,2027-01-01,5,abc,8.00',
      'Fexo,Fexofenadine,Square,tablet,F-1,31/12/2027,5,4.00,5.00',
      'Fexo,Fexofenadine,Square,tablet,F-1,2027-12-31,5,4.00,5.00',
    ].join('\n');
    expect(await issuesOf(csv)).toEqual([
      { rowNumber: 2, code: 'bad_stock', column: 'stock' },
      { rowNumber: 2, code: 'bad_expiry', column: 'expiry_date' },
      { rowNumber: 3, code: 'missing_text', column: 'generic' },
      { rowNumber: 3, code: 'bad_price', column: 'purchase_price' },
      { rowNumber: 4, code: 'bad_expiry', column: 'expiry_date' },
    ]);
    expect(counts()).toEqual(before);
  });

  it('reports a repeated medicine+batch row', async () => {
    const csv = [HEADER, 'Ace,Paracetamol,Square,tablet,D-1,,5,1.00,1.50', 'ace,paracetamol,square,tablet,d-1,,3,1.00,1.50'].join('\n');
    expect(await issuesOf(csv)).toEqual([{ rowNumber: 3, code: 'duplicate_row', column: 'batch_no' }]);
  });

  it('names every missing required column, not just the first', async () => {
    expect(await issuesOf('name,generic\nAce,Paracetamol')).toEqual([
      { rowNumber: null, code: 'missing_column', column: 'manufacturer' },
      { rowNumber: null, code: 'missing_column', column: 'batch_no' },
      { rowNumber: null, code: 'missing_column', column: 'stock' },
      { rowNumber: null, code: 'missing_column', column: 'purchase_price' },
      { rowNumber: null, code: 'missing_column', column: 'sale_price' },
    ]);
  });

  it('says a header-only file has no rows', async () => {
    expect(await issuesOf(`${HEADER}\n\n,,,,,,,,\n`)).toEqual([{ rowNumber: null, code: 'no_rows' }]);
  });

  it('refuses a batch already in inventory, together with the row problems, and writes nothing', async () => {
    const before = counts();
    const csv = [HEADER, 'Napa 500mg,Paracetamol,Beximco Pharmaceuticals,tablet,NP-0127,2027-12-31,10,0.80,1.20', 'Maxpro 20,Esomeprazole,Renata,capsule,M-1,2027-12-31,-4,5.00,7.00'].join('\n');
    expect(await issuesOf(csv)).toEqual([
      { rowNumber: 2, code: 'batch_exists', column: 'batch_no' },
      { rowNumber: 3, code: 'bad_stock', column: 'stock' },
    ]);
    expect(counts()).toEqual(before);
  });
});

describe('files as spreadsheets really save them', () => {
  it('reads an Excel CSV: BOM, CRLF, spelled-out headers, blank lines and a trailing empty column', async () => {
    const csv = '﻿Name,Generic,Manufacturer,Type,Batch No,Expiry Date (YYYY-MM-DD),Stock,Purchase Price,Sale Price,\r\n'
      + '\r\n'
      + 'Monas 10,Montelukast,ACME,Tab.,MN-1,2027-05-31,30,9.00,12.00,\r\n'
      + ',,,,,,,,,\r\n'
      + 'Ometid 20,Omeprazole,Opsonin,Suppository,OM-1,,0,3.00,4.00,\r\n';
    const preview = await previewInventoryCsv('shop', 'owner', csv);
    // Row numbers stay the spreadsheet's own, blank lines included.
    expect(preview.rows).toMatchObject([
      { rowNumber: 3, name: 'Monas 10', type: 'tablet', expiryDate: '2027-05-31', stock: 30 },
      { rowNumber: 5, name: 'Ometid 20', type: 'other', expiryDate: null, stock: 0 },
    ]);
  });

  it('names the row an unquoted comma split, and reads the others', async () => {
    const csv = [HEADER, 'Napa Extra,Paracetamol, Caffeine,Beximco,tablet,NE-1,,5,1.00,2.00', 'Fexo,Fexofenadine,Square,tablet,FX-9,,5,4.00,5.00'].join('\n');
    expect(await issuesOf(csv)).toEqual([{ rowNumber: 2, code: 'uneven_columns' }]);
  });

  it('accepts a short row (trailing empty cells left off) as empty optional cells', async () => {
    const preview = await previewInventoryCsv('shop', 'owner', `${HEADER},unit,threshold\nZinc,Zinc,Square,,ZN-2,,5,1.00,2.00`);
    expect(preview.rows[0]).toMatchObject({ unitOfMeasure: 'piece', lowStockThresholdOverride: null });
  });

  it('explains an unclosed quote and an oversized file instead of failing silently', async () => {
    expect(await issuesOf(`${HEADER}\n"Napa,Paracetamol,Beximco,tablet,B,,5,1.00,2.00`)).toEqual([{ rowNumber: null, code: 'unclosed_quote' }]);
    const tooMany = [HEADER, ...Array.from({ length: 1001 }, (_, i) => `M${i},G,C,,B${i},,1,1.00,2.00`)].join('\n');
    expect(await issuesOf(tooMany)).toEqual([{ rowNumber: null, code: 'too_many_rows' }]);
  });

  it('refuses a barcode Excel rounded, and repairs one it only stripped zeros from', async () => {
    const head = `${HEADER},barcode`;
    expect(await issuesOf(`${head}\nNapa,Paracetamol,Beximco,tablet,BC-1,,5,1.00,2.00,8.94123E+12`)).toEqual([
      { rowNumber: 2, code: 'bad_barcode', column: 'barcode' },
    ]);
    const preview = await previewInventoryCsv('shop', 'owner', [
      head,
      'Tums,Calcium,Haleon,tablet,BC-2,,5,1.00,2.00,36000291452',
      'Ace,Paracetamol,Square,tablet,="0012",,5,1.00,2.00,="8941234567896"',
    ].join('\n'));
    expect(preview.rows).toMatchObject([
      { barcode: '036000291452' },
      { batchNo: '0012', barcode: '8941234567896' },
    ]);
  });

  it('leaves the form empty when the type column is', async () => {
    const preview = await previewInventoryCsv('shop', 'owner', `${HEADER}\nZinc,Zinc,Square,,Z-1,,5,1.00,2.00`);
    expect(preview.rows[0]?.type).toBeNull();
  });
});
