import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

export const sqlite = new DatabaseSync(':memory:');

export const adapter = {
  execSync(sql: string): void {
    sqlite.exec(sql);
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