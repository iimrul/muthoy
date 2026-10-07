import type { Harness } from './harness';

// backend/supabase/pgtest/restDouble.ts — the PostgREST calls the sync
// function's identity and PIN-recovery code makes, executed as service_role
// against the harness's real tables and real functions.
//
// Exactly the shapes that code uses, and nothing else — any other throws, so a
// new call cannot quietly become a no-op that passes:
//   from(t).select("a, b[, roles!inner(c)]").eq(..).not(c, "is", null)[.maybeSingle()]
//   from(t).update(values).eq(..)
//   from(t).upsert(values, { onConflict, ignoreDuplicates: true })
//   rpc(fn, { p_name: value, ... })
// As service_role because that is who PostgREST runs them as on hosted: a
// GRANT a migration forgot fails here exactly as it would there.

type Row = Record<string, unknown>;

export interface RestError {
  code: string;
  message: string;
}

export interface RestResult<T> {
  data: T;
  error: RestError | null;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`restDouble: unsupported identifier ${JSON.stringify(name)}`);
  return name;
}

function asRestError(error: unknown): RestError {
  const raw = error as { code?: unknown; message?: unknown };
  return {
    code: typeof raw.code === 'string' ? raw.code : 'XX000',
    message: typeof raw.message === 'string' ? raw.message : 'query failed',
  };
}

/** PostgREST returns JSON: timestamps as strings, never Date objects or BigInts. */
function asJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? Number(item) : item))) as T;
}

interface Filter {
  column: string;
  operator: '=' | 'is not null';
  value?: unknown;
}

class Query implements PromiseLike<RestResult<unknown>> {
  private kind: 'select' | 'update' | 'upsert' = 'select';
  private columns = '*';
  private readonly filters: Filter[] = [];
  private values: Row = {};
  private onConflict: string | null = null;
  private single = false;

  constructor(
    private readonly h: Harness,
    private readonly table: string,
    private readonly events: string[],
  ) {
    ident(table);
  }

  select(columns: string): this {
    this.columns = columns;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column: ident(column), operator: '=', value });
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    if (operator !== 'is' || value !== null) throw new Error('restDouble: only not(column, "is", null)');
    this.filters.push({ column: ident(column), operator: 'is not null' });
    return this;
  }

  update(values: Row): this {
    this.kind = 'update';
    this.values = values;
    return this;
  }

  upsert(values: Row, options: { onConflict?: string; ignoreDuplicates?: boolean } = {}): this {
    if (!options.onConflict || options.ignoreDuplicates !== true) {
      throw new Error('restDouble: only upsert(values, { onConflict, ignoreDuplicates: true })');
    }
    this.kind = 'upsert';
    this.values = values;
    this.onConflict = ident(options.onConflict);
    return this;
  }

  maybeSingle(): this {
    this.single = true;
    return this;
  }

  then<A = RestResult<unknown>, B = never>(
    onFulfilled?: ((value: RestResult<unknown>) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.run().then(onFulfilled, onRejected);
  }

  private where(params: unknown[]): string {
    if (this.filters.length === 0) return '';
    return ` where ${this.filters.map((filter) => {
      if (filter.operator === 'is not null') return `t.${filter.column} is not null`;
      params.push(filter.value);
      return `t.${filter.column} = $${params.length}`;
    }).join(' and ')}`;
  }

  private async run(): Promise<RestResult<unknown>> {
    const params: unknown[] = [];
    let sql: string;
    if (this.kind === 'select') {
      sql = this.selectSql(params);
    } else if (this.kind === 'update') {
      const keys = Object.keys(this.values).map(ident);
      const sets = keys.map((key) => {
        params.push(this.values[key]);
        return `${key} = $${params.length}`;
      });
      sql = `update public.${this.table} as t set ${sets.join(', ')}${this.where(params)}`;
    } else {
      const keys = Object.keys(this.values).map(ident);
      const placeholders = keys.map((key) => {
        params.push(this.values[key]);
        return `$${params.length}`;
      });
      sql = `insert into public.${this.table} (${keys.join(', ')}) values (${placeholders.join(', ')})
             on conflict (${this.onConflict}) do nothing`;
    }
    this.events.push(`rest:${this.kind}:${this.table}`);
    try {
      const rows = await this.h.as('service_role', null, () => this.h.all<Row>(sql, params));
      if (this.kind !== 'select') return { data: null, error: null };
      const data = asJson(rows);
      if (!this.single) return { data, error: null };
      if (data.length > 1) {
        return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple rows returned' } };
      }
      return { data: data[0] ?? null, error: null };
    } catch (error) {
      return { data: null, error: asRestError(error) };
    }
  }

  /** The one embed the code uses: users → roles!inner(...) through role_id. */
  private selectSql(params: unknown[]): string {
    const parts = this.columns.split(',').map((part) => part.trim()).filter(Boolean);
    const selected: string[] = [];
    let join = '';
    for (const part of parts) {
      const embed = /^roles!inner\(([a-z_, ]+)\)$/.exec(part);
      if (embed) {
        if (this.table !== 'users') throw new Error('restDouble: roles!inner is only served for users');
        const columns = embed[1].split(',').map((column) => ident(column.trim()));
        selected.push(`json_build_object(${columns.map((column) => `'${column}', r.${column}`).join(', ')}) as roles`);
        join = ' join public.roles r on r.id = t.role_id';
      } else {
        selected.push(part === '*' ? 't.*' : `t.${ident(part)}`);
      }
    }
    return `select ${selected.join(', ')} from public.${this.table} as t${join}${this.where(params)}`;
  }
}

export interface RestDouble {
  from(table: string): Query;
  rpc(fn: string, args?: Row): Promise<RestResult<unknown>>;
}

export function restDouble(h: Harness, events: string[] = []): RestDouble {
  return {
    from: (table: string) => new Query(h, table, events),
    async rpc(fn: string, args: Row = {}) {
      const keys = Object.keys(args).map(ident);
      const sql = `select public.${ident(fn)}(${keys.map((key, index) => `${key} => $${index + 1}`).join(', ')}) as result`;
      events.push(`rpc:${fn}`);
      try {
        const rows = await h.as('service_role', null, () => h.all<{ result: unknown }>(sql, keys.map((key) => args[key])));
        return { data: asJson(rows[0]?.result ?? null), error: null };
      } catch (error) {
        return { data: null, error: asRestError(error) };
      }
    },
  };
}
