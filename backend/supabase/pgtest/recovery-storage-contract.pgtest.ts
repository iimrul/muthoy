import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimsFor,
  createHarness,
  OWNER_A,
  OWNER_B,
  seedShops,
  SHOP_A,
  SHOP_B,
  STAFF_A,
  type Harness,
} from "./harness";

// Minimal Storage catalog for real PostgreSQL policy evaluation. This does NOT
// run the Storage API, its JWT verifier, object service or hosted durability.
const DEVICE = "79000000-0000-4000-8000-000000000101";
const DEVICE_ROW = "79000000-0000-4000-8000-000000000102";
const BINDING = "79000000-0000-4000-8000-000000000103";
const SESSION = "79000000-0000-4000-8000-000000000104";
const ARCHIVE = "79000000-0000-4000-8000-000000000105";
const PATH = `${SHOP_A}/${DEVICE}/${ARCHIVE}.${"ab".repeat(32)}.mr1`;
let h: Harness;
beforeEach(async () => {
  h = await createHarness();
  await seedShops(h);
  await h.exec(`
    create schema storage;
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id) on delete restrict,name text not null,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated;
    grant select,insert,update,delete on storage.objects to anon,authenticated;
    insert into billing_accounts(id,principal_owner_user_id,primary_shop_id) values
      ('79000000-0000-4000-8000-000000000110','${OWNER_A}','${SHOP_A}') on conflict(principal_owner_user_id) do nothing;
    update shops set billing_account_id=(select id from billing_accounts where principal_owner_user_id='${OWNER_A}') where id='${SHOP_A}';
    insert into shop_memberships(billing_account_id,principal_user_id,shop_id,actor_user_id,role)
      select billing_account_id,'${OWNER_A}','${SHOP_A}','${OWNER_A}','owner' from shops where id='${SHOP_A}' on conflict(principal_user_id,shop_id) do nothing;
    insert into shop_devices(id,shop_id,device_public_id,device_secret_hash,enrolled_by_user_id)
      values('${DEVICE_ROW}','${SHOP_A}','${DEVICE}','synthetic-unusable-digest','${OWNER_A}');
    insert into shop_device_bindings(id,device_id,shop_id,actor_user_id)
      values('${BINDING}','${DEVICE_ROW}','${SHOP_A}','${OWNER_A}');
    insert into auth_session_devices(auth_session_id,shop_id,actor_user_id,device_id,binding_id,secret_hash_at_bind)
      values('${SESSION}','${SHOP_A}','${OWNER_A}','${DEVICE_ROW}','${BINDING}','synthetic-unusable-digest');
  `);
  await h.exec(
    readFileSync(
      "backend/supabase/held-migrations/recovery-storage-contract.sql",
      "utf8",
    ),
  );
}, 60_000);
afterEach(async () => {
  await h?.close();
});
async function asOwner<T>(
  fn: () => Promise<T>,
  extra: Record<string, unknown> = {},
) {
  return h.as(
    "authenticated",
    { ...(await claimsFor(h, OWNER_A)), session_id: SESSION, ...extra },
    fn,
  );
}
async function upload(path = PATH) {
  return h.one(
    "insert into storage.objects(bucket_id,name) values('muthoy-recovery-dev',$1) returning name",
    [path],
  );
}
async function objects() {
  return h.all("select name from storage.objects order by name");
}
async function state() {
  return h.one(`select jsonb_build_object('shops',(select jsonb_agg(to_jsonb(t.*) order by id) from shops t),
  'devices',(select jsonb_agg(to_jsonb(t.*) order by id) from shop_devices t),
  'bindings',(select jsonb_agg(to_jsonb(t.*) order by id) from shop_device_bindings t),
  'holds',(select jsonb_agg(to_jsonb(t.*) order by shop_id,actor_user_id) from device_enrollment_holds t),
  'sales',(select jsonb_agg(to_jsonb(t.*) order by id) from sales t)) snapshot`);
}
describe("HELD private immutable DEV recovery custody authorization", () => {
  it("keeps the bucket private and live Owner insert/read tenant-scoped", async () => {
    const before = await state();
    expect(
      await h.one(
        "select public,file_size_limit::int from storage.buckets where id='muthoy-recovery-dev'",
      ),
    ).toEqual({ public: false, file_size_limit: 67108864 });
    await asOwner(() => upload());
    expect(await asOwner(() => objects())).toEqual([{ name: PATH }]);
    expect(await state()).toEqual(before);
  });
  it("denies anonymous access and an unbound session despite Owner claims", async () => {
    await expect(h.as("anon", null, () => upload())).rejects.toMatchObject({
      code: "42501",
    });
    await expect(
      asOwner(() => upload(), { session_id: null }),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await objects()).toEqual([]);
  });
  it("denies Staff and cross-shop Owner using actual DB roles rather than claimed role", async () => {
    const staff = { ...(await claimsFor(h, STAFF_A)), session_id: SESSION };
    await expect(
      h.as("authenticated", staff, () => upload()),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      h.as(
        "authenticated",
        { ...(await claimsFor(h, OWNER_B)), session_id: SESSION },
        () => upload(),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asOwner(() => upload(PATH.replace(SHOP_A, SHOP_B))),
    ).rejects.toMatchObject({ code: "42501" });
    expect(await objects()).toEqual([]);
  });
  it("allows Owner recovery reads of an older source device, but cannot upload as that device", async () => {
    const old = PATH.replace(DEVICE, "79000000-0000-4000-8000-000000000199");
    await h.one(
      "insert into storage.objects(bucket_id,name) values('muthoy-recovery-dev',$1) returning name",
      [old],
    );
    expect(await asOwner(() => objects())).toEqual([{ name: old }]);
    await expect(asOwner(() => upload(old))).rejects.toMatchObject({
      code: "42501",
    });
  });
  it.each(["device", "binding", "actor", "membership"])(
    "revoking %s removes read/write immediately without restoring any authority",
    async (kind) => {
      await asOwner(() => upload());
      if (kind === "device")
        await h.exec(
          `update shop_devices set status='revoked' where id='${DEVICE_ROW}'`,
        );
      if (kind === "binding")
        await h.exec(
          `update shop_device_bindings set status='revoked' where id='${BINDING}'`,
        );
      if (kind === "actor")
        await h.exec(`update users set is_active=false where id='${OWNER_A}'`);
      if (kind === "membership")
        await h.exec(
          `update shop_memberships set is_active=false where actor_user_id='${OWNER_A}'`,
        );
      const before = await state();
      expect(await asOwner(() => objects())).toEqual([]);
      await expect(
        asOwner(() =>
          upload(PATH.replace(ARCHIVE, "79000000-0000-4000-8000-000000000198")),
        ),
      ).rejects.toMatchObject({ code: "42501" });
      expect(await state()).toEqual(before);
      expect(await objects()).toEqual([{ name: PATH }]);
    },
  );
  it("refuses malformed/path-traversal names and a mismatched bound actor", async () => {
    for (const path of [
      "../" + PATH,
      PATH + "/extra",
      PATH.replace(".mr1", ".json"),
      PATH.toUpperCase(),
    ])
      await expect(asOwner(() => upload(path))).rejects.toMatchObject({
        code: "42501",
      });
    await h.exec(
      `update auth_session_devices set actor_user_id='${STAFF_A}' where auth_session_id='${SESSION}'`,
    );
    await expect(asOwner(() => upload())).rejects.toMatchObject({
      code: "42501",
    });
    expect(await objects()).toEqual([]);
  });
  it("immutable replay cannot overwrite/delete an existing independent copy", async () => {
    await asOwner(() => upload());
    const before = await objects();
    await expect(asOwner(() => upload())).rejects.toMatchObject({
      code: "23505",
    });
    expect(
      await asOwner(() =>
        h.all("update storage.objects set name='changed' returning name"),
      ),
    ).toEqual([]);
    expect(
      await asOwner(() => h.all("delete from storage.objects returning name")),
    ).toEqual([]);
    expect(await objects()).toEqual(before);
  });
  it("has exact definer ownership/ACLs and grants no financial table privileges", async () => {
    expect(
      await h.one(
        "select (select rolname from pg_roles where oid=p.proowner) owner,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p where oid='muthoy_recovery_path_allowed(text,boolean)'::regprocedure",
      ),
    ).toEqual({
      owner: "postgres",
      prosecdef: true,
      proconfig: ["search_path=public"],
      anon: false,
      authenticated: true,
      service: false,
    });
    expect(
      (
        await h.one<{ allowed: boolean }>(
          "select has_table_privilege('authenticated','public.credits','insert') allowed",
        )
      ).allowed,
    ).toBe(false);
  });
});
