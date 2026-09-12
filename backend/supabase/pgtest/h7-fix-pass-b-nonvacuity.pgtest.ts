import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createBareHarness,
  migrationFiles,
  migrationSql,
  seedShops,
  SHOP_A,
  type Harness,
} from "./harness";

let prior: Harness;

beforeAll(async () => {
  prior = await createBareHarness();
  for (const name of migrationFiles()) {
    if (name === "20260907020000_h7_fix_pass_b.sql") continue;
    await prior.exec(migrationSql(name));
  }
  await seedShops(prior);
}, 60_000);

afterAll(async () => {
  await prior.close();
});

describe("H-7 Fix Pass B non-vacuity against the exact prior schema", () => {
  it("reproduces the mutable future-created_at bootstrap bypass", async () => {
    await prior.exec(`update shops
      set billing_account_id = null, created_at = now() + interval '30 days'
      where id = '${SHOP_A}'`);
    const row = await prior.one<{ allowed: boolean }>(
      `select h7_shop_billing_bootstrap_allowed($1, now() + interval '48 hours') as allowed`,
      [SHOP_A],
    );
    expect(row.allowed).toBe(true);
  });

  it("proves service_role could directly execute the renamed generic writer", async () => {
    const row = await prior.one<{ allowed: boolean }>(`
      select has_function_privilege('service_role',
        'sync_apply_row_pre_h7(text,text,jsonb,uuid,uuid,text)', 'execute') as allowed`);
    expect(row.allowed).toBe(true);
  });
});
