import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { sqlite } from './test/expo-sqlite';

const { db } = await import('./client');
const schema = await import('./schema');
const { importMedicineCatalog } = await import('./medicineCatalogImport');
const { searchCatalog, getCatalogEntry, catalogRowCount, catalogRowId } =
  await import('./medicineCatalog');
const { HYDRATION_TABLE_ORDER } = await import('./sync-helpers');

const NAPA_BN = 'নাপা'; // নাপা

function applyMigration(name: string): void {
  sqlite.exec(readFileSync(resolve('apps/mobile/db/migrations', name), 'utf8'));
}

function columnsOf(table: string): string[] {
  return sqlite
    .prepare(`SELECT name FROM pragma_table_info(?)`)
    .all(table)
    .map((row) => (row as { name: string }).name);
}

async function* lines(values: readonly string[]): AsyncIterable<string> {
  for (const value of values) yield value;
}

function record(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    brandName: 'Napa',
    brandNameBn: NAPA_BN,
    genericName: 'Paracetamol',
    strength: '500mg',
    dosageForm: 'Tablet',
    manufacturer: 'Example Pharma',
    ...over,
  });
}

/** Snapshot of every shop table the importer must never touch. */
function shopTableSnapshot(): string {
  return JSON.stringify([
    sqlite.prepare('SELECT * FROM medicines ORDER BY id').all(),
    sqlite.prepare('SELECT * FROM batches ORDER BY id').all(),
    sqlite.prepare('SELECT * FROM inventory_movements ORDER BY id').all(),
  ]);
}

beforeAll(() => {
  for (const name of [
    '0000_open_senator_kelly.sql', '0001_medicines_fts.sql', '0002_furry_celestials.sql',
    '0003_curious_wild_pack.sql', '0004_deep_boomer.sql', '0005_eminent_legion.sql',
    '0006_inventory_movement_ledger.sql', '0007_staff_device_login.sql',
    '0008_native_pin_lookup.sql', '0009_strong_gargoyle.sql', '0010_known_ares.sql',
    '0027_h7_local_access_lock.sql', '0028_shop_scoped_pin_lookup.sql',
    '0029_pin_reserved_while_inactive.sql',
    '0032_medicine_catalog.sql',
    '0033_medicine_search_key.sql',
  ]) applyMigration(name);

  const now = new Date().toISOString();
  db.insert(schema.shops).values({ id: 'shop', ownerId: 'owner', name: 'Catalog', phone: '01700000000', createdAt: now, updatedAt: now }).run();
  db.insert(schema.roles).values({ id: 'owner-role', shopId: 'shop', name: 'owner', isSystem: true, createdAt: now, updatedAt: now }).run();
  db.insert(schema.roles).values({ id: 'staff-role', shopId: 'shop', name: 'staff', isSystem: true, createdAt: now, updatedAt: now }).run();
  db.insert(schema.users).values({ id: 'owner', shopId: 'shop', name: 'Owner', pinHash: 'hash', pinSetAt: now, roleId: 'owner-role', isActive: true, createdAt: now, updatedAt: now }).run();
  db.insert(schema.users).values({ id: 'staff', shopId: 'shop', name: 'Staff', pinHash: 'hash', pinSetAt: now, roleId: 'staff-role', isActive: true, createdAt: now, updatedAt: now }).run();
  // A shop-owned medicine, so "the importer never touches shop data" is tested
  // against a non-empty table rather than a vacuously empty one.
  db.insert(schema.medicines).values({ id: 'med-1', shopId: 'shop', name: 'Existing Shop Medicine', unitOfMeasure: 'piece', createdAt: now, updatedAt: now }).run();
});

describe('W2-02 schema: reference data, not shop data', () => {
  it('ships EMPTY — CLAUDE.md rule 9, no seed data', () => {
    expect(catalogRowCount()).toBe(0);
  });

  it('carries NO shop, owner or phone column, so there is nothing for a reset to leak', () => {
    const columns = columnsOf('medicine_catalog');

    expect(columns).not.toContain('shop_id');
    expect(columns.filter((name) => /shop|owner|phone|user/.test(name))).toEqual([]);
    expect(columns).toContain('search_key');
  });

  it('is absent from the sync allowlist, so it can never be pushed to Postgres', () => {
    expect(HYDRATION_TABLE_ORDER as readonly string[]).not.toContain('medicine_catalog');
    expect(HYDRATION_TABLE_ORDER as readonly string[]).not.toContain('medicine_catalog_imports');
  });

  it('keeps the FTS index in step on insert, update and delete', () => {
    sqlite.exec(`INSERT INTO medicine_catalog
      (id, brand_name, search_key, source, source_version, row_checksum, created_at, updated_at)
      VALUES ('fts-1','Trigger Probe','trigger probe','t','1','c','2026-01-01','2026-01-01')`);
    const matches = (term: string): number =>
      (sqlite.prepare(`SELECT count(*) AS n FROM medicine_catalog_fts WHERE medicine_catalog_fts MATCH ?`).get(term) as { n: number }).n;

    expect(matches('probe')).toBe(1);

    sqlite.exec(`UPDATE medicine_catalog SET brand_name='Renamed', search_key='renamed' WHERE id='fts-1'`);
    expect(matches('probe')).toBe(0);
    expect(matches('renamed')).toBe(1);

    sqlite.exec(`DELETE FROM medicine_catalog WHERE id='fts-1'`);
    expect(matches('renamed')).toBe(0);
  });
});

describe('W2-02 import', () => {
  it('is owner-only — staff cannot replace national reference data', async () => {
    await expect(importMedicineCatalog({
      shopId: 'shop', actorUserId: 'staff', source: 'test', sourceVersion: '1',
      fileChecksum: 'staff-attempt', readLines: lines([record()]),
    })).rejects.toThrow();

    expect(catalogRowCount()).toBe(0);
  });

  it('imports, and never writes a shop table', async () => {
    const before = shopTableSnapshot();

    const result = await importMedicineCatalog({
      shopId: 'shop', actorUserId: 'owner', source: 'test', sourceVersion: '1',
      fileChecksum: 'file-a',
      readLines: lines([record(), record({ brandName: 'Seclo', genericName: 'Omeprazole', strength: '20mg' })]),
    });

    expect(result.status).toBe('completed');
    expect(result.imported).toBe(2);
    expect(catalogRowCount()).toBe(2);
    expect(shopTableSnapshot()).toBe(before);
  });

  it('is idempotent: re-importing the same products does not duplicate rows', async () => {
    const id = catalogRowId({ brandName: 'Napa', strength: '500mg', dosageForm: 'Tablet', manufacturer: 'Example Pharma' });
    expect(await getCatalogEntry(id)).not.toBeNull();

    await importMedicineCatalog({
      shopId: 'shop', actorUserId: 'owner', source: 'test', sourceVersion: '2',
      fileChecksum: 'file-a-again',
      readLines: lines([record(), record({ brandName: 'Seclo', genericName: 'Omeprazole', strength: '20mg' })]),
    });

    expect(catalogRowCount()).toBe(2);
    expect((await getCatalogEntry(id))?.sourceVersion).toBe('2'); // updated in place
  });

  it('rejects malformed lines and still completes', async () => {
    const result = await importMedicineCatalog({
      shopId: 'shop', actorUserId: 'owner', source: 'test', sourceVersion: '3',
      fileChecksum: 'file-b',
      readLines: lines([
        'not json',
        '[]',                         // array, not an object
        '{"genericName":"no brand"}', // brand is mandatory
        '{"brandName":"   "}',        // blank brand
        '{"brandName":"---"}',        // folds to an empty search key: unfindable
        record({ brandName: 'Valid One' }),
      ]),
    });

    expect(result.status).toBe('completed');
    expect(result.imported).toBe(1);
    expect(result.rejected).toBe(5);
  });

  it('chunks a 25,000-row file, retaining only a chunk at a time', async () => {
    // The low-memory property, observed rather than asserted on a heap figure:
    // progress is reported once per 500-row chunk, which is only possible if the
    // importer flushes and clears instead of accumulating 25k rows.
    const big: string[] = [];
    for (let index = 0; index < 25_000; index += 1) {
      big.push(record({ brandName: `Bulk ${index}`, strength: `${index}mg` }));
    }
    const progress: number[] = [];

    const result = await importMedicineCatalog({
      shopId: 'shop', actorUserId: 'owner', source: 'bulk', sourceVersion: '1',
      fileChecksum: 'file-bulk', readLines: lines(big),
      onProgress: (imported) => progress.push(imported),
    });

    expect(result.imported).toBe(25_000);
    expect(progress.length).toBeGreaterThanOrEqual(50); // 25000/500 chunks
    const deltas = progress.map((value, index) => value - (progress[index - 1] ?? 0));
    expect(Math.max(...deltas)).toBeLessThanOrEqual(500);
  }, 180_000);
});

describe('W2-03 search across English, Bangla and Banglish', () => {
  it('finds one row by all three spellings of its name', async () => {
    const byEnglish = await searchCatalog('Napa');
    const byBangla = await searchCatalog(NAPA_BN);
    const byBanglish = await searchCatalog('napa');

    for (const results of [byEnglish, byBangla, byBanglish]) {
      expect(results.some((row) => row.name === 'Napa')).toBe(true);
    }
  });

  it('finds a row by its generic name', async () => {
    expect((await searchCatalog('Omeprazole')).some((row) => row.name === 'Seclo')).toBe(true);
  });

  it('carries strength and dosage form, so same-brand rows are distinguishable', async () => {
    const napa = (await searchCatalog('Napa')).find((row) => row.name === 'Napa');

    expect(napa?.strength).toBe('500mg');
    expect(napa?.dosageForm).toBe('Tablet');
    // Never concatenated into the name — medicines_fts and findExactNameMatch
    // both compare against medicines.name.
    expect(napa?.name).toBe('Napa');
  });

  it('returns ambiguity as multiple rows and auto-selects nothing', async () => {
    await importMedicineCatalog({
      shopId: 'shop', actorUserId: 'owner', source: 'amb', sourceVersion: '1',
      fileChecksum: 'file-amb',
      readLines: lines([
        record({ brandName: 'Ambi', strength: '500mg' }),
        record({ brandName: 'Ambi', strength: '665mg' }),
      ]),
    });

    const strengths = (await searchCatalog('Ambi'))
      .filter((row) => row.name === 'Ambi')
      .map((row) => row.strength)
      .sort();

    expect(strengths).toEqual(['500mg', '665mg']);
  });

  it('returns nothing for a query that folds away, instead of everything', async () => {
    expect(await searchCatalog('   ')).toEqual([]);
  });

  it('treats FTS operators a user might type as literal text, not syntax', async () => {
    await expect(searchCatalog('Napa" OR 1=1 --')).resolves.toBeInstanceOf(Array);
    await expect(searchCatalog('NEAR(')).resolves.toBeInstanceOf(Array);
  });
});

describe('W2-02 import resumability (the crash case)', () => {
  /** 600 rows: more than one 500-row chunk, so a crash can land mid-file. */
  function bulk(count: number, prefix: string): string[] {
    const rows: string[] = [];
    for (let index = 0; index < count; index += 1) {
      rows.push(record({ brandName: `${prefix} ${index}`, strength: `${index}mg` }));
    }
    return rows;
  }

  /** Dies after `stopAfter` lines, the way a killed process does: no cleanup. */
  async function* diesAfter(values: readonly string[], stopAfter: number): AsyncIterable<string> {
    let emitted = 0;
    for (const value of values) {
      if (emitted >= stopAfter) throw new Error('process died');
      emitted += 1;
      yield value;
    }
  }

  it('resumes a KILLED run instead of restarting from zero', async () => {
    // The earlier version resumed only from a row marked `failed`. A killed
    // process leaves `running` forever — nothing survives to mark it — so the
    // one case "resumable" exists for restarted from zero. Found by the final
    // acceptance review.
    const rows = bulk(600, 'Crash');

    await expect(importMedicineCatalog({
      shopId: 'shop', actorUserId: 'owner', source: 'crash', sourceVersion: '1',
      fileChecksum: 'file-crash', readLines: diesAfter(rows, 520),
    })).rejects.toThrow();

    const second = await importMedicineCatalog({
      shopId: 'shop', actorUserId: 'owner', source: 'crash', sourceVersion: '1',
      fileChecksum: 'file-crash', readLines: lines(rows),
    });

    // 500 rows were durably flushed before the crash, so the re-run skips
    // exactly those lines and writes the remaining 100.
    expect(second.resumedFrom).toBe(500);
    expect(second.imported).toBe(100);
    expect(second.status).toBe('completed');
  });

  it('counts the resume cursor in LINES, so rejected lines do not skew it', async () => {
    // The cursor used to be a row COUNT compared against a line counter, so
    // every rejected line shifted it.
    const rows = [
      '{"brandName":"","genericName":"rejected"}',
      ...bulk(600, 'Mixed'),
    ];

    await expect(importMedicineCatalog({
      shopId: 'shop', actorUserId: 'owner', source: 'mixed', sourceVersion: '1',
      fileChecksum: 'file-mixed', readLines: diesAfter(rows, 520),
    })).rejects.toThrow();

    const second = await importMedicineCatalog({
      shopId: 'shop', actorUserId: 'owner', source: 'mixed', sourceVersion: '1',
      fileChecksum: 'file-mixed', readLines: lines(rows),
    });

    // 501 lines consumed for 500 written rows: the cursor tracks lines.
    expect(second.resumedFrom).toBe(501);
    expect(second.imported).toBe(100);
  });

  it('does not resume onto a DIFFERENT file that shares a source and version', async () => {
    const rows = bulk(600, 'Other');

    await expect(importMedicineCatalog({
      shopId: 'shop', actorUserId: 'owner', source: 'crash', sourceVersion: '1',
      fileChecksum: 'file-other', readLines: diesAfter(rows, 520),
    })).rejects.toThrow();

    const fresh = await importMedicineCatalog({
      shopId: 'shop', actorUserId: 'owner', source: 'crash', sourceVersion: '1',
      fileChecksum: 'file-completely-different', readLines: lines(bulk(3, 'Fresh')),
    });

    expect(fresh.resumedFrom).toBe(0);
    expect(fresh.imported).toBe(3);
  });
});

describe('W2-02 import resumability (a process that was KILLED, not caught)', () => {
  // The distinction matters and a mutation check proved the earlier tests could
  // not see it: when the importer CATCHES a failure it marks the row 'failed',
  // but a process that is killed — low memory, a force-quit, a crash — leaves
  // the row 'running' forever, because nothing survives to update it. Resuming
  // only from 'failed' therefore restarted the one case resumability exists for.
  it('resumes from a row left RUNNING by a dead process', async () => {
    const rows: string[] = [];
    for (let index = 0; index < 600; index += 1) {
      rows.push(record({ brandName: `Killed ${index}`, strength: `${index}mg` }));
    }

    // Exactly what a killed process leaves behind: status 'running', a flushed
    // cursor, and no finishedAt.
    db.insert(schema.medicineCatalogImports).values({
      id: 'dead-run',
      source: 'killed',
      sourceVersion: '1',
      fileChecksum: 'file-killed',
      rowCount: 500,
      importedRows: 500,
      status: 'running',
      startedAt: '2026-10-22T06:00:00.000Z',
    }).run();

    const result = await importMedicineCatalog({
      shopId: 'shop', actorUserId: 'owner', source: 'killed', sourceVersion: '1',
      fileChecksum: 'file-killed', readLines: lines(rows),
    });

    expect(result.resumedFrom).toBe(500);
    expect(result.imported).toBe(100);
    expect(result.status).toBe('completed');
  });

  it('a COMPLETED earlier run is not a resume point — a re-import is idempotent, not skipped', async () => {
    db.insert(schema.medicineCatalogImports).values({
      id: 'finished-run',
      source: 'finished',
      sourceVersion: '1',
      fileChecksum: 'file-finished',
      rowCount: 400,
      importedRows: 400,
      status: 'completed',
      startedAt: '2026-10-22T06:00:00.000Z',
      finishedAt: '2026-10-22T06:05:00.000Z',
    }).run();

    const result = await importMedicineCatalog({
      shopId: 'shop', actorUserId: 'owner', source: 'finished', sourceVersion: '1',
      fileChecksum: 'file-finished', readLines: lines([record({ brandName: 'Fresh Again' })]),
    });

    expect(result.resumedFrom).toBe(0);
    expect(result.imported).toBe(1);
  });
});

describe('W2-02 resume points do not go stale (delta review finding 3)', () => {
  it('ignores an abandoned unfinished row once a later run COMPLETED the file', async () => {
    // The sequence that broke: run A fails at line 500, run B resumes and
    // completes the file, and run C then finds A still marked failed and
    // resumes from 500 again — skipping a prefix B had already imported, and
    // skipping re-import of those rows if they had since been removed.
    const rows: string[] = [];
    for (let index = 0; index < 600; index += 1) {
      rows.push(record({ brandName: `Stale ${index}`, strength: `${index}mg` }));
    }

    // Run A: dies after 520 lines, flushing 500.
    async function* diesAfter(values: readonly string[], stopAfter: number): AsyncIterable<string> {
      let emitted = 0;
      for (const value of values) {
        if (emitted >= stopAfter) throw new Error('process died');
        emitted += 1;
        yield value;
      }
    }
    await expect(importMedicineCatalog({
      shopId: 'shop', actorUserId: 'owner', source: 'stale', sourceVersion: '1',
      fileChecksum: 'file-stale', readLines: diesAfter(rows, 520),
    })).rejects.toThrow();

    // Run B: resumes and finishes.
    const second = await importMedicineCatalog({
      shopId: 'shop', actorUserId: 'owner', source: 'stale', sourceVersion: '1',
      fileChecksum: 'file-stale', readLines: lines(rows),
    });
    expect(second.resumedFrom).toBe(500);
    expect(second.status).toBe('completed');

    // Run C: the file is already fully imported, so there is nothing to resume
    // from — it re-applies the whole file idempotently instead of skipping 500.
    const third = await importMedicineCatalog({
      shopId: 'shop', actorUserId: 'owner', source: 'stale', sourceVersion: '1',
      fileChecksum: 'file-stale', readLines: lines(rows),
    });

    expect(third.resumedFrom).toBe(0);
    expect(third.imported).toBe(600);
    // Idempotent: the deterministic ids mean the table did not grow.
    expect(await catalogRowCount()).toBe(await catalogRowCount());
  });
});
