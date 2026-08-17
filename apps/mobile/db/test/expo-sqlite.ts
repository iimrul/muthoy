import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

export const sqlite = new DatabaseSync(':memory:');

type NamedParams = Record<string, SQLInputValue>;

export const adapter = {
  execSync(sql: string): void {
    sqlite.exec(sql);
  },
  // expo-sqlite's raw-read escape hatch (db/client.ts's `sqliteConnection`),
  // used by the hand-written aggregate SQL in db/cash.ts, customers.ts and
  // purchases.ts. Named `$param` objects map straight onto node:sqlite.
  getAllSync<T>(sql: string, params: NamedParams = {}): T[] {
    return sqlite.prepare(sql).all(params) as unknown as T[];
  },
  getFirstSync<T>(sql: string, params: NamedParams = {}): T | null {
    return (sqlite.prepare(sql).get(params) ?? null) as T | null;
  },
  prepareSync(sql: string) {
    const statement: StatementSync = sqlite.prepare(sql);
    return {
      executeSync(params: SQLInputValue[] = []) {
        if (/^\s*(select|pragma|with)\b/i.test(sql)) {
          return {
            changes: 0,
            lastInsertRowId: 0,
            getAllSync: () => statement.all(...params),
            getFirstSync: () => statement.get(...params),
          };
        }
        const result = statement.run(...params);
        return {
          changes: Number(result.changes),
          lastInsertRowId: Number(result.lastInsertRowid),
          getAllSync: () => [],
          getFirstSync: () => null,
        };
      },
      executeForRawResultSync(params: SQLInputValue[] = []) {
        statement.setReturnArrays(true);
        return { getAllSync: () => statement.all(...params) };
      },
    };
  },
};

export function openDatabaseSync() {
  return adapter;
}