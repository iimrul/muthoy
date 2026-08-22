export const MAX_INVENTORY_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_INVENTORY_CSV_ROWS = 1000;

export function parseCsv(text: string, maxRows = MAX_INVENTORY_CSV_ROWS): string[][] {
  if (new TextEncoder().encode(text).length > MAX_INVENTORY_CSV_BYTES) throw new Error('CSV exceeds 2 MiB');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
    } else field += char;
  }
  if (quoted) throw new Error('Unclosed quoted CSV field');
  row.push(field);
  if (row.some((value) => value.length > 0)) rows.push(row);
  if (Math.max(0, rows.length - 1) > maxRows) throw new Error(`CSV exceeds ${maxRows} data rows`);
  const width = rows[0]?.length ?? 0;
  if (rows.some((value) => value.length !== width)) throw new Error('CSV rows have inconsistent columns');
  return rows;
}
