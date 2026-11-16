// Local-only synthetic PostgREST stand-in for Admin local acceptance.
//
// WHAT THIS IS: a tiny in-memory emulation of the slice of PostgREST that
// supabase-js uses (select with eq/neq/in/is/gt/gte/lt/lte/like/ilike filters,
// order, limit/offset/Range, exact counts, single/maybeSingle, insert, update,
// rpc). It binds 127.0.0.1 only and holds SYNTHETIC rows only.
//
// WHAT THIS IS NOT: Supabase. It enforces no RLS, no grants, no constraints and
// no embedded-resource joins. A page that renders against it proves the page's
// own rendering, navigation and error handling — never hosted data, RLS or
// gate E15. Every request is appended to the request log so a test can assert
// what the panel did (and did not) read or write.

import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const OPERATORS = new Set(['eq', 'neq', 'in', 'is', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike']);
const RESERVED_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function parseFilter(raw) {
  const negated = raw.startsWith('not.');
  const body = negated ? raw.slice(4) : raw;
  const dot = body.indexOf('.');
  if (dot < 0) return null;
  const op = body.slice(0, dot);
  if (!OPERATORS.has(op)) return null;
  let value = body.slice(dot + 1);
  if ((op === 'like' || op === 'ilike') && value.startsWith('"') && value.endsWith('"')) {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return { op, value, negated };
}

function likeToRegExp(pattern, flags) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*');
  return new RegExp('^' + escaped + '$', flags);
}

function compare(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && typeof a !== 'boolean') return na - nb;
  return String(a) < String(b) ? -1 : 1;
}

function matches(row, column, filter) {
  const cell = row[column];
  let result;
  switch (filter.op) {
    case 'eq': result = cell !== null && cell !== undefined && String(cell) === filter.value; break;
    case 'neq': result = cell === null || cell === undefined || String(cell) !== filter.value; break;
    case 'is':
      result = filter.value === 'null' ? cell === null || cell === undefined : String(cell) === filter.value;
      break;
    case 'in': {
      const list = filter.value.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, ''));
      result = cell !== null && cell !== undefined && list.includes(String(cell));
      break;
    }
    case 'gt': result = compare(cell, filter.value) > 0; break;
    case 'gte': result = compare(cell, filter.value) >= 0; break;
    case 'lt': result = compare(cell, filter.value) < 0; break;
    case 'lte': result = compare(cell, filter.value) <= 0; break;
    case 'like': result = likeToRegExp(filter.value, '').test(String(cell ?? '')); break;
    case 'ilike': result = likeToRegExp(filter.value, 'i').test(String(cell ?? '')); break;
    default: result = true;
  }
  return filter.negated ? !result : result;
}

function applyFilters(rows, params) {
  let out = rows;
  for (const [key, raw] of params) {
    if (RESERVED_PARAMS.has(key)) continue;
    // Flat logical predicates used by pharmacy search. Nested expressions and
    // quoted commas remain outside this synthetic adapter's supported scope.
    if (key === 'or' || key === 'and') {
      const conditions = raw.replace(/^\(|\)$/g, '').split(',').map((clause) => {
        const dot = clause.indexOf('.');
        return { column: clause.slice(0, dot), filter: parseFilter(clause.slice(dot + 1)) };
      });
      if (conditions.length && conditions.every((c) => c.filter !== null)) {
        out = out.filter((row) => key === 'or'
          ? conditions.some((c) => matches(row, c.column, c.filter))
          : conditions.every((c) => matches(row, c.column, c.filter)));
      }
      continue;
    }
    const filter = parseFilter(raw);
    if (filter) out = out.filter((row) => matches(row, key, filter));
  }
  return out;
}

function applyOrder(rows, orderParam) {
  if (!orderParam) return rows;
  const keys = orderParam.split(',').map((part) => {
    const [column, direction] = part.split('.');
    return { column, desc: direction === 'desc' };
  });
  return [...rows].sort((a, b) => {
    for (const key of keys) {
      const c = compare(a[key.column], b[key.column]);
      if (c !== 0) return key.desc ? -c : c;
    }
    return 0;
  });
}

function applyWindow(rows, params, rangeHeader) {
  let start = Number(params.get('offset') ?? 0);
  let end = params.has('limit') ? start + Number(params.get('limit')) - 1 : rows.length - 1;
  const range = /^(\d+)-(\d+)$/.exec(rangeHeader ?? '');
  if (range) {
    start = Number(range[1]);
    end = Number(range[2]);
  }
  return { page: rows.slice(start, end + 1), start };
}

function json(res, status, body, headers = {}) {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * @param {{ port: number, tables: Record<string, object[]>, rpcs?: Record<string, (args: object) => unknown>,
 *           requestLog?: string, failTables?: string[] }} options
 */
export function startMockSupabase(options) {
  const tables = new Map(Object.entries(options.tables).map(([name, rows]) => [name, rows.map((r) => ({ ...r }))]));
  const failTables = new Set(options.failTables ?? []);
  const rpcs = options.rpcs ?? {};

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const body = req.method === 'GET' || req.method === 'HEAD' ? null : await readBody(req);
    if (options.requestLog) {
      appendFileSync(
        options.requestLog,
        JSON.stringify({ at: new Date().toISOString(), method: req.method, path: url.pathname, query: url.search, body }) + '\n',
      );
    }

    const rpcMatch = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(url.pathname);
    if (rpcMatch) {
      const handler = rpcs[rpcMatch[1]];
      if (!handler) return json(res, 404, { code: 'PGRST202', message: `mock: no rpc ${rpcMatch[1]}` });
      return json(res, 200, handler(body ?? {}));
    }

    const tableMatch = /^\/rest\/v1\/([a-z0-9_]+)$/.exec(url.pathname);
    if (!tableMatch) return json(res, 404, { message: 'mock: unknown path' });
    const name = tableMatch[1];
    if (failTables.has(name)) {
      return json(res, 500, { code: 'XX000', message: `mock: injected failure for ${name}` });
    }
    if (!tables.has(name)) tables.set(name, []);
    const rows = tables.get(name);
    const prefer = String(req.headers.prefer ?? '');
    const wantsObject = String(req.headers.accept ?? '').includes('vnd.pgrst.object+json');
    const wantsRepresentation = prefer.includes('return=representation');

    if (req.method === 'GET' || req.method === 'HEAD') {
      const filtered = applyOrder(applyFilters(rows, url.searchParams), url.searchParams.get('order'));
      const { page, start } = applyWindow(filtered, url.searchParams, req.headers.range);
      const headers = {};
      if (/count=(exact|planned|estimated)/.test(prefer)) {
        headers['content-range'] = page.length === 0 ? `*/${filtered.length}` : `${start}-${start + page.length - 1}/${filtered.length}`;
      }
      if (req.method === 'HEAD') return json(res, 200, undefined, headers);
      if (wantsObject) {
        if (page.length !== 1) {
          return json(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${page.length} rows` });
        }
        return json(res, 200, page[0], headers);
      }
      return json(res, 200, page, headers);
    }

    if (req.method === 'POST') {
      const incoming = Array.isArray(body) ? body : [body ?? {}];
      const created = incoming.map((row) => ({
        id: randomUUID(),
        created_at: new Date().toISOString(),
        ...row,
      }));
      rows.push(...created);
      if (!wantsRepresentation) return json(res, 201, undefined);
      return json(res, 201, wantsObject ? created[0] : created);
    }

    if (req.method === 'PATCH') {
      const targets = applyFilters(rows, url.searchParams);
      for (const row of targets) Object.assign(row, body ?? {});
      if (!wantsRepresentation) return json(res, 204, undefined);
      if (wantsObject) {
        if (targets.length !== 1) return json(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
        return json(res, 200, targets[0]);
      }
      return json(res, 200, targets);
    }

    if (req.method === 'DELETE') {
      const targets = new Set(applyFilters(rows, url.searchParams));
      tables.set(name, rows.filter((row) => !targets.has(row)));
      return json(res, wantsRepresentation ? 200 : 204, wantsRepresentation ? [...targets] : undefined);
    }

    return json(res, 405, { message: 'mock: method not allowed' });
  });

  return new Promise((resolve) => {
    server.listen(options.port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        tables,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
