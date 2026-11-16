import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createBareHarness, createHarness, HOSTED_FUNCTION_EXECUTE_MODEL, migrationFiles,
  migrationSql, seedShops, SHOP_A, SHOP_B, OWNER_A, STAFF_A, T0, type Harness,
} from './harness';

const CANDIDATE = 'backend/supabase/held-migrations/20261116002928_admin_dev_compatibility.sql';
const sql = readFileSync(CANDIDATE, 'utf8');
// Captured current DEV patch, test-only: reproduces DEV's non-prefix history
// without requiring unrelated local migration promotions in a clean checkout.
const staffReference = readFileSync('docs/reviews/iphone-admin-2026-11-16/fixtures/dev-staff-sale-repair.sql', 'utf8');
const stores = ['admin_audit_log', 'admin_role_assignments', 'admin_support_cases',
  'admin_support_notes', 'admin_platform_settings', 'financial_publications'];
const rpc = 'publish_financial_snapshot(text,text,date,date,bigint,bigint,bigint,integer,integer,text,integer,integer,integer,integer,text)';
const id = (n: number) => `f2160000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function fixture(dev: boolean): Promise<Harness> {
  const h = dev ? await createBareHarness() : await createHarness();
  if(dev) {
    const files = migrationFiles().filter((name) => name <= '20261005000000_h5_revoke_auth_user_sessions.sql');
    expect(files).toHaveLength(31);
    for (const name of files) await h.exec(migrationSql(name));
    await h.exec(HOSTED_FUNCTION_EXECUTE_MODEL);
  }
  const current=await h.one<{body:string}>(`select md5(prosrc) body from pg_proc where oid=
    'sync_apply_operation_pre_b3_withdrawal(uuid,uuid,text,uuid,text,jsonb)'::regprocedure`);
  if(current.body!=='d4f8a9bfbeaa410244089594c7757cdc') await h.exec(staffReference);
  return h;
}

async function attempt(h: Harness, role: string, statement: string): Promise<string | null> {
  return h.as(role, null, async () => {
    try { await h.exec(statement); return null; }
    catch (error) { return (error as { code?: string }).code ?? 'unknown'; }
  });
}

async function functions(h: Harness) {
  return h.all(`select p.oid::regprocedure::text signature, pg_get_userbyid(p.proowner) owner,
    p.prosecdef,p.proconfig,p.proacl::text,md5(p.prosrc) body from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname not in ('publish_financial_snapshot','financial_publications_immutable') order by 1`);
}

async function business(h: Harness) {
  const rows: Record<string, unknown> = {};
  for (const table of ['shops','users','roles','customers','medicines','batches','sales','sale_items','credits','inventory_movements','cash_drawer']) {
    rows[table] = await h.all(`select to_jsonb(t.*) row from public.${table} t order by t.id`);
  }
  return rows;
}

export const STORE_SHAPE = `select md5(string_agg(shape, E'\\n' order by shape collate "C")) hash from (
  select c.relname || ':column:' || a.attnum || ':' || a.attname || ':' || format_type(a.atttypid,a.atttypmod)
    || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin,d.adrelid),'')
    || ':' || coalesce(a.attacl::text,'') shape
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    where n.nspname='public' and c.relname=any($1::text[]) and a.attnum>0 and not a.attisdropped
  union all select c.relname || ':constraint:' || k.conname || ':' || pg_get_constraintdef(k.oid)
    from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1::text[])
  union all select c.relname || ':index:' || pg_get_indexdef(i.indexrelid)
    from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1::text[])
) shapes`;

function publish(overrides: { month?: number; k?: number; clearing?: number; gross?: number; refunds?: number; value?: number; cohort?: string; start?: string; end?: string } = {}) {
  const {month=1,k=5,clearing=3,gross=50000,refunds=10000,value=40000,cohort='platform_all'} = overrides;
  const start=overrides.start ?? `2025-${String(month).padStart(2,'0')}-01`;
  const end=overrides.end ?? `2025-${String(month).padStart(2,'0')}-${[4,6,9,11].includes(month)?30:month===2?28:31}`;
  // Inputs are fixed synthetic test values, never request/user SQL.
  return `select * from publish_financial_snapshot('refund_net_pharmacy_sales','${cohort}',
    '${start}'::date,'${end}'::date,${gross}::bigint,${refunds}::bigint,${value}::bigint,
    12,7,'${'a'.repeat(64)}',${k},6,3,${clearing},'synthetic-founder')`;
}

describe.each([true,false])('held Admin compatibility — exact DEV order=%s', (dev) => {
  let h: Harness;
  let originalFunctions: unknown;
  let originalBusiness: unknown;
  let originalOtherAcl: unknown;
  let shape: unknown;
  const otherAcl = `select c.relname,c.relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and not(c.relname=any($1::text[])) order by 1`;
  beforeAll(async () => {
    h = await fixture(dev);
    await seedShops(h);
    originalFunctions = await functions(h);
    originalBusiness = await business(h);
    originalOtherAcl = await h.all(otherAcl,[[...stores,'sale_refunds','audit_logs']]);
    if (dev) {
      expect(await h.one("select to_regclass('public.admin_role_assignments')::text value")).toEqual({value:null});
      expect(await attempt(h,'service_role','select * from admin_role_assignments')).toBe('42P01');
    }
    await h.exec(sql);
    shape = await h.one(STORE_SHAPE,[stores]);
    expect(shape).toEqual({hash:'fb0af5fc6b0b2f63ae3f891239ee3297'});
  },180_000);
  afterAll(async () => { await h?.close(); });

  it('changes no existing business rows, sync/entitlement functions or unrelated table ACLs', async () => {
    expect(await functions(h)).toEqual(originalFunctions);
    expect(await business(h)).toEqual(originalBusiness);
    expect(await h.all(otherAcl,[[...stores,'sale_refunds','audit_logs']])).toEqual(originalOtherAcl);
    expect(await h.one(`select md5(prosrc) body from pg_proc where oid=
      'sync_apply_operation_pre_b3_withdrawal(uuid,uuid,text,uuid,text,jsonb)'::regprocedure`))
      .toEqual({body:'d4f8a9bfbeaa410244089594c7757cdc'});
  });

  it.each([100,0])('the retained Staff repair uploads cash=%i sale once and still denies standalone credit edits', async cash => {
    const offset=cash?100:200;
    const uuid=(n:number)=>id(offset+n);
    const date=cash?'2026-11-15':'2026-11-14';
    const now=date+'T10:00:00.000Z';
    await h.exec(`insert into user_permissions(id,shop_id,user_id,key,allowed,created_at,updated_at)
      values('${id(50)}','${SHOP_A}','${STAFF_A}','sales',true,'${T0}','${T0}') on conflict(id) do nothing;
      insert into customers(id,shop_id,name) values('${uuid(1)}','${SHOP_A}','Synthetic buyer');
      insert into medicines(id,shop_id,name) values('${uuid(2)}','${SHOP_A}','Synthetic medicine');
      insert into batches(id,shop_id,medicine_id,batch_no,stock,purchase_price,sale_price)
        values('${uuid(3)}','${SHOP_A}','${uuid(2)}','SYNTH-ADMIN-${cash}',0,100,300);
      insert into inventory_movements(id,shop_id,batch_id,change_qty,reason,created_by,created_at,updated_at)
        values('${uuid(20)}','${SHOP_A}','${uuid(3)}',10,'opening_balance','${OWNER_A}','${T0}','${T0}')`);
    const base={shop_id:SHOP_A,created_at:now,updated_at:now,is_deleted:false,deleted_at:null,deleted_by:null};
    const row=(tableName:string,n:number,payload:Record<string,unknown>)=>({tableName,rowId:uuid(n),op:'insert',payload:{...base,id:uuid(n),...payload}});
    const rows=[
      row('credit_reconciliation_states',7,{customer_id:uuid(1),status:'verified',canonical_hash:null,verified_by:STAFF_A,verified_at:now}),
      row('sales',4,{invoice_no:'SYNTH-ADMIN-'+cash,business_date:date,staff_id:STAFF_A,customer_id:uuid(1),subtotal:300,total:300,paid:cash,change:0,discount_type:null,discount_value:null,discount_amount:0,payment_type:cash?'split':'credit',cash_applied:cash,credit_amount:300-cash,free_reason:null,tax_rate_bp:0,tax_amount:0,tax_label:null}),
      row('sale_items',5,{sale_id:uuid(4),medicine_id:uuid(2),batch_id:uuid(3),qty:1,unit_price:300,discount_type:null,discount_value:null,discount_amount:0,line_total:300,cogs:100,promotion_bps:0,promotion_amount:0}),
      row('credits',6,{customer_id:uuid(1),sale_id:uuid(4),amount:300-cash,balance:300-cash}),
      row('inventory_movements',8,{batch_id:uuid(3),change_qty:-1,reason:'sale',ref_id:uuid(4),created_by:STAFF_A}),
      ...(cash?[row('cash_drawer',9,{business_date:date,opening_cash:0,opened_by:STAFF_A,opened_at:now,closed_by:null,closed_at:null,closing_expected:null,closing_counted:null})]:[]),
    ];
    const stage=()=>h.as('service_role',null,()=>h.one<{result:{status:string}}>(
      "select sync_stage_operation_chunk($1,$2,'sale',$3,'synthetic-admin',$4,'synthetic-admin-hash-0001',0,'synthetic-admin-hash-0001',$5::jsonb) result",
      [SHOP_A,uuid(4),STAFF_A,rows.length,JSON.stringify(rows)]));
    expect((await stage()).result.status).toBe('applied');
    const applied=await business(h);
    expect((await stage()).result.status).toBe('applied');
    expect(await business(h)).toEqual(applied);
    expect(await h.one('select stock from batches where id=$1',[uuid(3)])).toEqual({stock:9});
    expect(await h.one('select total::int,cash_applied::int,credit_amount::int from sales where id=$1',[uuid(4)]))
      .toEqual({total:300,cash_applied:cash,credit_amount:300-cash});
    await expect(h.as('service_role',null,()=>h.one(
      "select sync_apply_row('credit_reconciliation_states','update',$1::jsonb,$2,$3,'synthetic-admin')",
      [JSON.stringify(rows[0]!.payload),SHOP_A,STAFF_A]))).rejects.toMatchObject({code:'MU010'});
    expect(await business(h)).toEqual(applied);
  });

  it('all six stores enforce RLS and have no API policies', async () => {
    const rows=await h.all<{relrowsecurity:boolean}>(`select relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname=any($1::text[])`,[stores]);
    expect(rows).toHaveLength(6);
    expect(rows.every(row=>row.relrowsecurity)).toBe(true);
    expect(await h.all('select * from pg_policies where schemaname=\'public\' and tablename=any($1::text[])',[stores])).toEqual([]);
  });

  it.each(['anon','authenticated'])('%s cannot read or insert into any Admin store or execute the publication RPC', async role => {
    for(const table of stores) {
      expect(await attempt(h,role,`select * from ${table}`),table).toBe('42501');
      expect(await attempt(h,role,`insert into ${table} default values`),table).toBe('42501');
      expect(await attempt(h,role,`truncate ${table}`),table).toBe('42501');
    }
    expect(await attempt(h,role,publish())).toBe('42501');
  });

  it('service_role reads all stores and shop audit; cannot write shop audit or refunds', async () => {
    for(const table of [...stores,'audit_logs','sale_refunds']) expect(await attempt(h,'service_role',`select count(*) from ${table}`)).toBeNull();
    for(const table of ['audit_logs','sale_refunds']) for(const statement of [`insert into ${table} default values`,`update ${table} set id=id`,`delete from ${table}`,`truncate ${table}`])
      expect(await attempt(h,'service_role',statement),statement).toBe('42501');
  });

  it('role narrowing, disabling and revocation persist; attribution and deletion stay forbidden', async () => {
    await h.as('service_role',null,()=>h.exec(`insert into admin_role_assignments(username,role,assigned_by) values('synthetic-operator','support','synthetic-founder');
      update admin_role_assignments set role='read_only',is_active=false,sessions_revoked_at='${T0}',updated_at=now() where username='synthetic-operator'`));
    expect(await h.one("select role,is_active,sessions_revoked_at is not null revoked from admin_role_assignments where username='synthetic-operator'"))
      .toEqual({role:'read_only',is_active:false,revoked:true});
    for(const statement of ["update admin_role_assignments set assigned_by='forged'","update admin_role_assignments set username='forged'",'delete from admin_role_assignments'])
      expect(await attempt(h,'service_role',statement)).toBe('42501');
  });

  it('audit appends durable records and refuses modification, deletion and truncation', async () => {
    await h.as('service_role',null,()=>h.exec("insert into admin_audit_log(at,actor,action,outcome) values(now(),'synthetic-claim','login.failure','failure')"));
    expect(await h.one("select actor_verified from admin_audit_log where actor='synthetic-claim'" )).toEqual({actor_verified:false});
    for(const statement of ["update admin_audit_log set actor='forged'",'delete from admin_audit_log','truncate admin_audit_log'])
      expect(await attempt(h,'service_role',statement)).toBe('42501');
  });

  it('support cases/notes persist; foreign shops, moved attribution and removed history are refused', async () => {
    await h.as('service_role',null,()=>h.exec(`insert into admin_support_cases(id,shop_id,category,summary,opened_by) values('${id(1)}','${SHOP_A}','sync','Synthetic case','synthetic-founder');
      update admin_support_cases set status='resolved',assignee='synthetic-support',priority='high' where id='${id(1)}';
      insert into admin_support_notes(case_id,body,author) values('${id(1)}','Synthetic note','synthetic-support')`));
    expect(await h.one('select status from admin_support_cases where id=$1',[id(1)])).toEqual({status:'resolved'});
    expect(await attempt(h,'service_role',`update admin_support_cases set shop_id='${SHOP_B}'`)).toBe('42501');
    expect(await attempt(h,'service_role',`insert into admin_support_cases(shop_id,category,summary,opened_by) values('${id(99)}','sync','Synthetic orphan','synthetic-founder')`)).toBe('23503');
    for(const statement of ["update admin_support_notes set body='forged'",'delete from admin_support_notes','truncate admin_support_notes','delete from admin_support_cases'])
      expect(await attempt(h,'service_role',statement)).toBe('42501');
    expect(await attempt(h,'postgres',`delete from admin_support_cases where id='${id(1)}'`)).toBe('23001');
  });

  it('settings persist only allowlisted keys, with immutable identity', async () => {
    await h.as('service_role',null,()=>h.exec(`insert into admin_platform_settings(key,value,updated_by) values('flag.maps_enabled','true','synthetic-founder');
      update admin_platform_settings set value='false',updated_by='synthetic-founder' where key='flag.maps_enabled'`));
    expect(await h.one("select value from admin_platform_settings where key='flag.maps_enabled'")).toEqual({value:false});
    expect(await attempt(h,'service_role',"insert into admin_platform_settings(key,value,updated_by) values('arbitrary.secret','true','synthetic-founder')")).toBe('23514');
    expect(await attempt(h,'service_role',"update admin_platform_settings set key='flag.analytics_enabled'" )).toBe('42501');
  });

  it('publication and audit commit together; a repeat reads the first value without leaking new amounts', async () => {
    const first=await h.as('service_role',null,()=>h.one<{publication_id:string;published_now:boolean;published_value_paisa:number|string}>(publish()));
    expect(first.published_now).toBe(true);
    expect(Number(first.published_value_paisa)).toBe(40000);
    const repeat=await h.as('service_role',null,()=>h.one(publish({refunds:10700,value:39300})));
    expect(repeat).toEqual({...first,published_now:false});
    expect(await h.one("select meta from admin_audit_log where action='publication.already_published' order by at desc limit 1"))
      .toEqual({meta:{value_paisa:40000,already_published:true}});
    for(const statement of ["insert into financial_publications default values",'update financial_publications set value_paisa=0','delete from financial_publications','truncate financial_publications'])
      expect(await attempt(h,'service_role',statement)).toBe('42501');
    expect(await attempt(h,'postgres','update financial_publications set value_paisa=value_paisa')).toBe('23001');
    expect(await attempt(h,'postgres','delete from financial_publications')).toBe('23001');
    expect(await attempt(h,'postgres','truncate financial_publications')).toBe('23001');
  });

  it.each([
    {month:2,k:1}, {month:2,clearing:2}, {month:2,cohort:'single_shop'},
    {month:2,start:'2025-02-02'}, {month:2,gross:50000,refunds:10000,value:39999},
  ])('refuses unsafe publication %j without an audit/publication write', async overrides => {
    const before=await h.one('select (select count(*) from financial_publications)::int p,(select count(*) from admin_audit_log)::int a');
    expect(await attempt(h,'service_role',publish(overrides))).not.toBeNull();
    expect(await h.one('select (select count(*) from financial_publications)::int p,(select count(*) from admin_audit_log)::int a')).toEqual(before);
  });

  it('failed publication audit rolls back its serving row', async () => {
    await h.exec("create function public.synthetic_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'synthetic audit unavailable'; end $$; create trigger synthetic_audit_failure before insert on admin_audit_log for each row execute function public.synthetic_audit_failure()");
    try {
      expect(await attempt(h,'service_role',publish({month:3}))).toBe('P0001');
      expect(await h.one("select count(*)::int n from financial_publications where period_start='2025-03-01'")).toEqual({n:0});
    } finally { await h.exec('drop trigger synthetic_audit_failure on admin_audit_log; drop function public.synthetic_audit_failure()'); }
  });

  it('both publication functions pin search_path; the trigger helper has no direct service/API grant', async () => {
    const rows=await h.all<{proconfig:string[]}>("select proconfig from pg_proc where oid=any(array['financial_publications_immutable()'::regprocedure,$1::regprocedure])",[rpc]);
    expect(rows).toHaveLength(2);
    for(const row of rows) expect(row.proconfig).toContain('search_path=public, pg_temp');
    for(const role of ['anon','authenticated','service_role'])
      expect(await h.one('select has_function_privilege($1,\'financial_publications_immutable()\',\'execute\') allowed',[role])).toEqual({allowed:false});
  });

  it('reapplication preserves business rows, Admin history and schema', async () => {
    const before=await business(h);
    const history=await h.all('select to_jsonb(t.*) row from admin_audit_log t order by id');
    await h.exec(sql);
    expect(await business(h)).toEqual(before);
    expect(await h.all('select to_jsonb(t.*) row from admin_audit_log t order by id')).toEqual(history);
    expect(await h.one(STORE_SHAPE,[stores])).toEqual(shape);
    expect(await functions(h)).toEqual(originalFunctions);
  });

  it.each([
    'set local role service_role',
    'alter table admin_platform_settings add column synthetic_unreviewed text',
    'grant select(username) on admin_role_assignments to anon',
    'drop table admin_platform_settings',
    'alter table admin_role_assignments disable row level security',
    'create policy synthetic_exposure on admin_role_assignments for select to anon using (true)',
    'alter function financial_publications_immutable() security definer',
    `create or replace function sync_apply_operation_pre_b3_withdrawal(p_shop_id uuid,p_operation_id uuid,p_operation_kind text,p_actor_id uuid,p_device_id text,p_rows jsonb)
      returns text language sql security definer set search_path=public as 'select ''unknown''::text'`,
  ])('refuses unknown/partial installation atomically: %s', async mutation => {
    await h.exec('begin');
    try {
      await h.exec(mutation);
      await expect(h.exec(sql)).rejects.toMatchObject({code:'55000'});
    } finally { await h.exec('rollback'); }
    expect(await h.one(STORE_SHAPE,[stores])).toEqual(shape);
    expect(await functions(h)).toEqual(originalFunctions);
  });

  it('refuses an unreviewed publication function body before replacing it', async () => {
    const row=await h.one<{definition:string}>('select pg_get_functiondef($1::regprocedure) definition',[rpc]);
    await h.exec('begin');
    try {
      await h.exec(row.definition.replace('declare','declare\n-- synthetic unreviewed source'));
      await expect(h.exec(sql)).rejects.toMatchObject({code:'55000'});
    } finally { await h.exec('rollback'); }
    expect(await h.one('select pg_get_functiondef($1::regprocedure) definition',[rpc])).toEqual(row);
  });

  it('an isolated backup restores Admin history, publications, business data and Staff function', async () => {
    const businessBefore=await business(h);
    const audit=await h.all('select to_jsonb(t.*) row from admin_audit_log t order by id');
    const publications=await h.all('select to_jsonb(t.*) row from financial_publications t order by id');
    const image=await h.db.dumpDataDir();
    const restored=await PGlite.create({loadDataDir:image});
    try {
      expect((await restored.query('select to_jsonb(t.*) row from admin_audit_log t order by id')).rows).toEqual(audit);
      expect((await restored.query('select to_jsonb(t.*) row from financial_publications t order by id')).rows).toEqual(publications);
      for(const [table,rows] of Object.entries(businessBefore))
        expect((await restored.query(`select to_jsonb(t.*) row from public.${table} t order by t.id`)).rows).toEqual(rows);
      expect((await restored.query(`select md5(prosrc) body from pg_proc where oid='sync_apply_operation_pre_b3_withdrawal(uuid,uuid,text,uuid,text,jsonb)'::regprocedure`)).rows)
        .toEqual([{body:'d4f8a9bfbeaa410244089594c7757cdc'}]);
    } finally { await restored.close(); }
  },60_000);
});
