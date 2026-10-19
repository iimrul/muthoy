-- A3 catalog-v1 capture. READ ONLY; PostgreSQL 17. No business rows or credentials.
-- Capture rows unchanged; wrap with FORMAT/identity/coverage through the documented contract.
with ns as (select oid,nspname from pg_namespace where nspname='public'),
acl as (
  select c.oid,coalesce(jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantor),
    case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,a.privilege_type,a.is_grantable)
    order by a.grantor::regrole::text,a.grantee::regrole::text,a.privilege_type)
    filter(where a.grantee is distinct from to_regrole('service_role')::oid),'[]') ordinary,
    coalesce(jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable)
    order by a.privilege_type) filter(where a.grantee=to_regrole('service_role')::oid),'[]') service
  from pg_class c join ns n on n.oid=c.relnamespace
  left join lateral aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner))) a on true
  where c.relkind in ('r','p','v','m','f','S') group by c.oid
), objects(kind,key,value) as (
  select 'schema',n.nspname,jsonb_build_object('owner',pg_get_userbyid(n.nspowner),'acl',coalesce(n.nspacl,acldefault('n',n.nspowner))::text)
  from pg_namespace n join ns on ns.oid=n.oid
  union all
  select 'relation',n.nspname||'.'||c.relname,jsonb_build_object('kind',c.relkind::text,'owner',pg_get_userbyid(c.relowner),
    'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',a.ordinary,'serviceRoleAcl',a.service,
    'persistence',c.relpersistence::text,'replicaIdentity',c.relreplident::text,'options',c.reloptions,
    'partition',case when c.relispartition then pg_get_expr(c.relpartbound,c.oid) else null end,
    'partitionKey',pg_get_partkeydef(c.oid),
    'parents',(select coalesce(jsonb_agg(jsonb_build_array(pn.nspname,pc.relname,i.inhseqno) order by i.inhseqno),'[]') from pg_inherits i join pg_class pc on pc.oid=i.inhparent join pg_namespace pn on pn.oid=pc.relnamespace where i.inhrelid=c.oid),
    'view',case when c.relkind in ('v','m') then pg_get_viewdef(c.oid,false) else null end,
    'sequence',case when s.seqrelid is not null then jsonb_build_array(s.seqtypid::regtype::text,s.seqstart,s.seqincrement,s.seqmax,s.seqmin,s.seqcache,s.seqcycle) else null end,
    'sequenceOwnership',(select coalesce(jsonb_agg(jsonb_build_array(nn.nspname,cc.relname,aa.attname,d.deptype::text) order by nn.nspname,cc.relname,aa.attname),'[]') from pg_depend d join pg_class cc on cc.oid=d.refobjid join pg_namespace nn on nn.oid=cc.relnamespace left join pg_attribute aa on aa.attrelid=cc.oid and aa.attnum=d.refobjsubid where d.classid='pg_class'::regclass and d.objid=c.oid and d.refclassid='pg_class'::regclass and d.deptype in ('a','i')),
    'foreign',(select jsonb_build_array(fs.srvname,pg_get_userbyid(fs.srvowner),w.fdwname,md5(fs.srvoptions::text),md5(ft.ftoptions::text)) from pg_foreign_table ft join pg_foreign_server fs on fs.oid=ft.ftserver join pg_foreign_data_wrapper w on w.oid=fs.srvfdw where ft.ftrelid=c.oid))
  from pg_class c join ns n on n.oid=c.relnamespace join acl a on a.oid=c.oid left join pg_sequence s on s.seqrelid=c.oid
  where c.relkind in ('r','p','v','m','f','S')
  union all
  select 'column',n.nspname||'.'||c.relname||'.'||a.attname,jsonb_build_object('position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),
    'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity::text,'generated',a.attgenerated::text,
    'collation',case when a.attcollation=0 then null else a.attcollation::regcollation::text end,'storage',a.attstorage::text,'compression',a.attcompression::text)
  from pg_attribute a join pg_class c on c.oid=a.attrelid join ns n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
  where a.attnum>0 and not a.attisdropped and c.relkind in ('r','p','v','m','f')
  union all
  select 'column_acl',n.nspname||'.'||c.relname||'.'||a.attname,jsonb_build_object('acl',coalesce((select jsonb_agg(jsonb_build_array(pg_get_userbyid(x.grantor),
    case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,x.privilege_type,x.is_grantable) order by x.grantor::regrole::text,x.grantee::regrole::text,x.privilege_type)
    from aclexplode(a.attacl) x),'[]'))
  from pg_attribute a join pg_class c on c.oid=a.attrelid join ns n on n.oid=c.relnamespace where a.attnum>0 and not a.attisdropped and c.relkind in ('r','p','v','m','f')
  union all
  select 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',jsonb_build_object(
    'definition',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,
    'language',l.lanname,'volatility',p.provolatile::text,'parallel',p.proparallel::text,'strict',p.proisstrict,'leakproof',p.proleakproof,
    'acl',coalesce((select jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantor),case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,a.privilege_type,a.is_grantable)
      order by a.grantor::regrole::text,a.grantee::regrole::text,a.privilege_type) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee is distinct from to_regrole('service_role')::oid),'[]'),
    'serviceRoleAcl',coalesce((select jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) order by a.privilege_type)
      from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=to_regrole('service_role')::oid),'[]'))
  from pg_proc p join ns n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where p.prokind in ('f','p')
  union all
  select 'policy',n.nspname||'.'||c.relname||'.'||p.polname,jsonb_build_object('command',p.polcmd::text,'permissive',p.polpermissive,
    'roles',(select jsonb_agg(case when x=0 then 'PUBLIC' else pg_get_userbyid(x) end order by 1) from unnest(p.polroles) x),
    'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))
  from pg_policy p join pg_class c on c.oid=p.polrelid join ns n on n.oid=c.relnamespace
  union all
  select 'constraint',n.nspname||'.'||c.relname||'.'||x.conname,jsonb_build_object('type',x.contype::text,'definition',pg_get_constraintdef(x.oid,false),
    'validated',x.convalidated,'deferrable',x.condeferrable,'deferred',x.condeferred,'noInherit',x.connoinherit)
  from pg_constraint x join pg_class c on c.oid=x.conrelid join ns n on n.oid=c.relnamespace
  union all
  select 'index',n.nspname||'.'||c.relname,jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),
    'valid',i.indisvalid,'ready',i.indisready,'unique',i.indisunique,'primary',i.indisprimary,'nullsNotDistinct',i.indnullsnotdistinct)
  from pg_index i join pg_class c on c.oid=i.indexrelid join ns n on n.oid=c.relnamespace
  union all
  select 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,jsonb_build_object('definition',pg_get_triggerdef(t.oid,false),'enabled',t.tgenabled::text)
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join ns n on n.oid=c.relnamespace where not t.tgisinternal
  union all
  select 'rule',n.nspname||'.'||c.relname||'.'||r.rulename,jsonb_build_object('definition',pg_get_ruledef(r.oid,false),'enabled',r.ev_enabled::text)
  from pg_rewrite r join pg_class c on c.oid=r.ev_class join ns n on n.oid=c.relnamespace where r.rulename<>'_RETURN'
  union all
  select 'type',n.nspname||'.'||t.typname,jsonb_build_object('definition',jsonb_build_object('kind',t.typtype::text,'owner',pg_get_userbyid(t.typowner),'acl',t.typacl::text,
    'base',format_type(t.typbasetype,t.typtypmod),'notNull',t.typnotnull,'default',t.typdefault,
    'enum',(select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid),
    'domainChecks',(select jsonb_agg(jsonb_build_array(c.conname,pg_get_constraintdef(c.oid),c.convalidated) order by c.conname) from pg_constraint c where c.contypid=t.oid),
    'composite',(select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) order by a.attnum) from pg_attribute a where a.attrelid=t.typrelid and a.attnum>0 and not a.attisdropped),
    'range',(select jsonb_build_array(r.rngsubtype::regtype::text,r.rngcollation::regcollation::text,(select nn.nspname||'.'||o.opcname from pg_opclass o join pg_namespace nn on nn.oid=o.opcnamespace where o.oid=r.rngsubopc),r.rngcanonical::regproc::text,r.rngsubdiff::regproc::text) from pg_range r where r.rngtypid=t.oid or r.rngmultitypid=t.oid)))
  from pg_type t join ns n on n.oid=t.typnamespace left join pg_class c on c.oid=t.typrelid where t.typtype in ('d','e','r','m') or (t.typtype='c' and c.relkind='c')
  union all
  select 'default_acl',pg_get_userbyid(d.defaclrole)||':'||coalesce(n.nspname,'*')||':'||d.defaclobjtype::text,
    jsonb_build_object('acl',coalesce((select jsonb_agg(jsonb_build_array(pg_get_userbyid(a.grantor),case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,a.privilege_type,a.is_grantable)
      order by a.grantor::regrole::text,a.grantee::regrole::text,a.privilege_type) from aclexplode(d.defaclacl) a),'[]'))
  from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
  union all
  select 'role',rolname,jsonb_build_object('superuser',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDb',rolcreatedb,
    'login',rolcanlogin,'replication',rolreplication,'bypassRls',rolbypassrls,'connectionLimit',rolconnlimit,'config',rolconfig) from pg_roles
  union all
  select 'membership',pg_get_userbyid(roleid)||':'||pg_get_userbyid(member)||':'||pg_get_userbyid(grantor),
    jsonb_build_object('admin',admin_option,'inherit',inherit_option,'set',set_option) from pg_auth_members
  union all
  select 'extension',extname,jsonb_build_object('version',extversion,'schema',extnamespace::regnamespace::text,'owner',pg_get_userbyid(extowner)) from pg_extension
  union all
  select 'publication',p.pubname,jsonb_build_object('allTables',p.puballtables,'insert',p.pubinsert,'update',p.pubupdate,'delete',p.pubdelete,'truncate',p.pubtruncate,
    'tables',(select coalesce(jsonb_agg(jsonb_build_array(t.schemaname,t.tablename,t.attnames,t.rowfilter) order by t.schemaname,t.tablename),'[]') from pg_publication_tables t where t.pubname=p.pubname)) from pg_publication p
  union all
  select 'event_trigger',evtname,jsonb_build_object('event',evtevent,'function',evtfoid::regproc::text,'enabled',evtenabled::text,'owner',pg_get_userbyid(evtowner),'tags',evttags) from pg_event_trigger
  union all
  select 'history',version,jsonb_build_object('name',name,'statementsNull',statements is null,'statementsDigest',case when statements is null then null else md5(statements::text) end) from supabase_migrations.schema_migrations
  union all
  -- Constant dynamic SELECT is parsed only when cron.job exists. No cron.* function is called.
  select 'cron','pg_cron',jsonb_build_object('profile',case when to_regclass('cron.job') is null then jsonb_build_object('present',false)
    else jsonb_build_object('present',true,'jobs',((xpath('/row/jobs/text()',query_to_xml(
      'select coalesce(jsonb_agg(jsonb_build_array(jobname,schedule,md5(command),nodename,nodeport,database,username,active) order by jobname),''[]''::jsonb) as jobs from cron.job',false,true,'')))[1]::text)::jsonb) end)
)
select kind,key,value from objects order by kind,key;
