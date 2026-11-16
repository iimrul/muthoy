// SYNTHETIC rows for Admin local acceptance. No real pharmacy, person, phone,
// coordinate or sale. Phone fields are deliberately NOT phone-shaped, so no
// evidence scanner or reader mistakes them for a real number.
//
// `empty`     — every table empty: the fresh-platform state (CLAUDE.md rule 9).
// `synthetic` — a few shops, accounts and entitlements, including a very long
//               name and a Bangla name, to exercise tables and layout.

export const SYNTHETIC_SHOP_ID = '00000000-0000-4000-8000-0000000000a1';
const SHOP_B = '00000000-0000-4000-8000-0000000000a2';
const SHOP_C = '00000000-0000-4000-8000-0000000000a3';
const ACCOUNT_A = '00000000-0000-4000-8000-0000000000b1';
const ACCOUNT_B = '00000000-0000-4000-8000-0000000000b2';
const OWNER_A = '00000000-0000-4000-8000-0000000000c1';
const OWNER_B = '00000000-0000-4000-8000-0000000000c2';

function shop(id, name, nameEn, district, plan, account, createdAt) {
  return {
    id,
    name,
    name_en: nameEn,
    phone: 'SYNTHETIC-NO-PHONE',
    district,
    thana: 'Synthetic Thana',
    plan,
    commercial_status: 'active',
    commercial_reason: null,
    archived_at: null,
    billing_account_id: account,
    is_deleted: false,
    latitude: null,
    longitude: null,
    location_captured_at: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function synthetic() {
  return {
    shops: [
      shop(SYNTHETIC_SHOP_ID, 'Synthetic Pharmacy A', 'Synthetic Pharmacy A', 'Dhaka', 'pro', ACCOUNT_A, '2026-10-01T04:00:00.000Z'),
      shop(
        SHOP_B,
        'Synthetic Pharmacy With An Exceptionally Long Registered Trading Name For Layout Stress Testing Ltd',
        'Synthetic Pharmacy With An Exceptionally Long Registered Trading Name For Layout Stress Testing Ltd',
        'Chattogram', 'free', ACCOUNT_B, '2026-10-05T04:00:00.000Z',
      ),
      shop(SHOP_C, 'সিনথেটিক ফার্মেসি', 'Synthetic Bangla Pharmacy', 'Sylhet', 'free', ACCOUNT_B, '2026-10-09T04:00:00.000Z'),
    ],
    billing_accounts: [
      { id: ACCOUNT_A, principal_owner_user_id: OWNER_A, primary_shop_id: SYNTHETIC_SHOP_ID, launch_trial_granted_at: null, created_at: '2026-10-01T04:00:00.000Z' },
      { id: ACCOUNT_B, principal_owner_user_id: OWNER_B, primary_shop_id: SHOP_B, launch_trial_granted_at: null, created_at: '2026-10-05T04:00:00.000Z' },
    ],
    entitlement_snapshots: [],
    billing_subscriptions: [],
    shop_memberships: [],
    users: [],
    sales: [],
    sale_refunds: [],
    payment_orders: [],
    payment_provider_events: [],
    plan_offerings: [],
    financial_publications: [],
    audit_logs: [],
    admin_role_assignments: [],
    admin_audit_log: [],
    admin_support_cases: [],
    admin_support_notes: [],
    admin_platform_settings: [],
  };
}

export function fixtureTables(name) {
  if (name === 'empty') {
    return Object.fromEntries(Object.keys(synthetic()).map((table) => [table, []]));
  }
  if (name === 'synthetic') return synthetic();
  throw new Error('unknown fixture: ' + name);
}
