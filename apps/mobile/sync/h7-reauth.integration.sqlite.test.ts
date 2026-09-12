import { FunctionsHttpError } from "@supabase/supabase-js";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({
  invoke: vi.fn(),
  setSession: vi.fn(),
  refreshSession: vi.fn(),
  getSession: vi.fn(),
  accessToken: null as string | null,
  mode: "active" as "active" | "plan_suspended" | "archived" | "inactive" | "deleted",
}));

vi.mock("./supabaseClient", () => ({
  isSupabaseConfigured: true,
  requireSupabaseConfiguration: vi.fn(),
  supabase: {
    functions: { invoke: transport.invoke },
    auth: {
      setSession: transport.setSession,
      refreshSession: transport.refreshSession,
      getSession: transport.getSession,
    },
  },
}));

const { db, sqliteConnection } = await import("../db/test/client");
const { getActiveSessionContext, lockLocalUserAccess } = await import("../db/auth");
const { roles, shops, users } = await import("../db/schema");
const { applyRemoteRow, HYDRATION_TABLE_ORDER } = await import("../db/sync-helpers");
const { hashPin } = await import("../native/crypto");
const { useSessionStore } = await import("../state/sessionStore");
const { clearLastPulledCursor } = await import("./cursorStore");
const { loginOnNewDevice } = await import("./deviceAuth");
const { eq } = await import("drizzle-orm");

const SHOP = "73000000-0000-4000-8000-000000000001";
const ROLE = "73000000-0000-4000-8000-000000000002";
const USER = "73000000-0000-4000-8000-000000000003";
const PHONE = "01700000073";
const PIN = "7381";
const T0 = "2026-09-07T00:00:00.000Z";
const LATER = "2026-09-08T00:00:00.000Z";
const NEWEST = "2026-09-09T00:00:00.000Z";

let pinHash = "";

function accessToken(): string {
  const payload = Buffer.from(JSON.stringify({
    app_metadata: { app_user_id: USER, shop_id: SHOP },
  })).toString('base64url');
  return `header.${payload}.signature`;
}

function functionError(code: string, status = 403): FunctionsHttpError {
  return new FunctionsHttpError(new Response(JSON.stringify({ code, error: code }), {
    status,
    headers: { "content-type": "application/json" },
  }));
}

function remoteUser(updatedAt = LATER): Record<string, unknown> {
  return {
    id: USER,
    shop_id: SHOP,
    role_id: ROLE,
    name: "Hydrated Actor",
    phone: "+8801700000073",
    pin_hash: pinHash,
    pin_set_at: T0,
    is_active: true,
    is_deleted: false,
    permission_version: 0,
    created_at: T0,
    updated_at: updatedAt,
  };
}

function installServerTransport(): void {
  transport.invoke.mockImplementation(async (
    _functionName: string,
    options?: { body?: Record<string, unknown> },
  ) => {
    const body = options?.body ?? {};
    if (body.action === "device-login") {
      if (body.phone !== "+8801700000073" || body.pin !== PIN) {
        return { data: null, error: functionError("invalid_credentials", 401) };
      }
      if (transport.mode === "inactive" || transport.mode === "deleted") {
        // The real device-login lookup excludes both states before minting a
        // session and deliberately returns the same generic 401 for each.
        return { data: null, error: functionError("invalid_credentials", 401) };
      }
      return {
        data: {
          shopId: SHOP,
          userId: USER,
          role: "owner",
          accessToken: accessToken(),
          refreshToken: "server-refresh-token",
        },
        error: null,
      };
    }

    if (body.action === "pull") {
      if (transport.mode === "plan_suspended") {
        return { data: null, error: functionError("account_plan_suspended") };
      }
      if (transport.mode === "archived") {
        return { data: null, error: functionError("shop_inactive") };
      }
      return {
        data: {
          changes: [{
            tableName: "users",
            rowId: USER,
            updatedAt: LATER,
            payload: remoteUser(),
          }],
          hasMore: false,
          nextCursor: { updatedAt: LATER, tableName: "users", rowId: USER },
          accessVersion: 0,
          readableTables: [...HYDRATION_TABLE_ORDER],
          accessUserId: USER,
          saleHistoryScope: "all",
        },
        error: null,
      };
    }

    throw new Error(`Unexpected sync action: ${String(body.action)}`);
  });
}

beforeAll(() => {
  sqliteConnection.execSync("PRAGMA foreign_keys=ON");
  const dir = resolve("apps/mobile/db/migrations");
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
    sqliteConnection.execSync(readFileSync(resolve(dir, name), "utf8"));
  }
});

beforeEach(async () => {
  vi.clearAllMocks();
  transport.mode = "active";
  transport.accessToken = null;
  transport.setSession.mockImplementation(async (session: { access_token: string }) => {
    transport.accessToken = session.access_token;
    return { error: null };
  });
  transport.getSession.mockImplementation(async () => ({
    data: { session: transport.accessToken ? { access_token: transport.accessToken } : null },
    error: null,
  }));
  transport.refreshSession.mockResolvedValue({ error: null });
  installServerTransport();

  sqliteConnection.execSync("PRAGMA foreign_keys=OFF");
  for (const table of ["sync_queue", "audit_logs", "user_permissions", "users", "roles", "shops"]) {
    sqliteConnection.execSync(`DELETE FROM ${table}`);
  }
  sqliteConnection.execSync("PRAGMA foreign_keys=ON");
  useSessionStore.getState().clearActiveUser();
  clearLastPulledCursor(SHOP);

  pinHash = await hashPin(PIN);
  db.insert(shops).values({
    id: SHOP,
    ownerId: USER,
    name: "Re-auth Shop",
    phone: PHONE,
    createdAt: T0,
    updatedAt: T0,
  }).run();
  db.insert(roles).values({
    id: ROLE,
    shopId: SHOP,
    name: "owner",
    createdAt: T0,
    updatedAt: T0,
  }).run();
  db.insert(users).values({
    id: USER,
    shopId: SHOP,
    roleId: ROLE,
    name: "Stale Local Actor",
    phone: PHONE,
    pinHash,
    pinSetAt: T0,
    createdAt: T0,
    updatedAt: T0,
  }).run();
  await lockLocalUserAccess(SHOP, USER);
});

function localLock(): string | null {
  return db.select({ value: users.accessLockedAt }).from(users)
    .where(eq(users.id, USER)).get()?.value ?? null;
}

describe("H-7 real client re-authentication integration", () => {
  it("runs server PIN auth, full hydration, then clears a live actor's local lock", async () => {
    expect(localLock()).not.toBeNull();

    await loginOnNewDevice(PHONE, PIN);

    const calls = transport.invoke.mock.calls.map((call) => call[1]?.body as Record<string, unknown>);
    expect(calls.map((body) => body.action)).toEqual(["device-login", "pull"]);
    expect(calls[0]).toMatchObject({ phone: "+8801700000073", pin: PIN });
    expect(calls[1]).toMatchObject({ shopId: SHOP, since: null, includeAccess: true });
    expect(db.select({ name: users.name }).from(users).where(eq(users.id, USER)).get())
      .toEqual({ name: "Hydrated Actor" });
    expect(localLock()).toBeNull();
    expect(await getActiveSessionContext(USER, SHOP)).toMatchObject({ role: "owner" });
    expect(useSessionStore.getState().session).toMatchObject({ shopId: SHOP, userId: USER });
  });

  it.each([
    ["plan-suspended", "plan_suspended"],
    ["archived-shop", "archived"],
  ] as const)("does not clear a %s actor after server PIN auth refuses full hydration", async (_label, mode) => {
    transport.mode = mode;

    await expect(loginOnNewDevice(PHONE, PIN)).rejects.toBeTruthy();

    const actions = transport.invoke.mock.calls.map((call) => call[1]?.body?.action);
    expect(actions).toEqual(["device-login", "pull"]);
    expect(localLock()).not.toBeNull();
    expect(await getActiveSessionContext(USER, SHOP)).toBeNull();
    expect(useSessionStore.getState().session).toBeNull();

    // A later shared-device hydration still cannot erase the denied actor's
    // local-only marker.
    expect(applyRemoteRow("users", remoteUser(NEWEST))).toBe("applied");
    expect(localLock()).not.toBeNull();
  });

  it.each(["inactive", "deleted"] as const)(
    "does not clear an %s actor when server PIN auth refuses to mint a session",
    async (mode) => {
      transport.mode = mode;

      await expect(loginOnNewDevice(PHONE, PIN)).rejects.toMatchObject({
        name: "DeviceLoginError",
        isCredentialFailure: true,
      });

      expect(transport.invoke.mock.calls.map((call) => call[1]?.body?.action))
        .toEqual(["device-login"]);
      expect(localLock()).not.toBeNull();
      expect(await getActiveSessionContext(USER, SHOP)).toBeNull();
      expect(useSessionStore.getState().session).toBeNull();

      expect(applyRemoteRow("users", remoteUser(NEWEST))).toBe("applied");
      expect(localLock()).not.toBeNull();
    },
  );
});
