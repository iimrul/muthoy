import { and, eq } from 'drizzle-orm';
import { db, sqliteConnection } from './client';
import { deviceBindingState, deviceRegistryState } from './schema';

// db/deviceRegistry.ts — A2.3's local mirror of the server device registry.
//
// This module owns exactly one question: what did the server last tell this
// installation about itself, and is that answer still the newest one?
//
// It decides nothing on its own. Every status here arrived in a server
// snapshot; nothing local may invent, escalate, or clear one. Two rules make
// the mirror trustworthy offline:
//
//   MONOTONIC. A snapshot is applied only if its registry_version is at least
//   the stored one. A replayed or reordered older snapshot — which a retry, a
//   cached proxy response, or a hostile network can all produce — cannot move
//   a revoked device back to active.
//
//   ABSENT IS UNKNOWN, NEVER REVOKED. An installation the registry has not
//   seen, or an actor the server has not mentioned, produces no objection at
//   all. That is the rollout safety property: deploying A2.3 cannot lock a
//   live shop out of its own till, because nothing becomes illegal by default.
//
// The converse also holds, and is the point of persisting it here: once a
// revocation HAS been learned, it survives restart, force-stop and sign-out,
// and only a fresh authoritative snapshot with a newer version can lift it.

export type DeviceRegistryStatus = 'unknown' | 'active' | 'revoked';
export type DeviceBindingStatus = 'active' | 'revoked';

/**
 * The refusal a caller must honour, or null when the registry has no objection.
 *
 * `read_failed` is the third state, and it is NOT null. A mirror that cannot
 * be read has not said "no objection" — it has said nothing, and the
 * difference matters here more than anywhere else in the app: these two tables
 * are the only local evidence that a handset was cut off, so a read fault
 * degrading to null would make corrupting them the way to undo a revocation.
 * Callers fail closed on it. What they must NOT do is persist it as a
 * quarantine, which is the D1 lesson pointing the other way — an unreadable
 * table is not proof of anything either.
 */
export type DeviceAccessObjection = 'device_revoked' | 'binding_revoked' | 'read_failed';

export interface LocalDeviceRegistry {
  shopId: string;
  devicePublicId: string;
  status: DeviceRegistryStatus;
  registryVersion: number;
  enforced: boolean;
  /** True only once the server has issued this installation a secret. */
  isEnrolled: boolean;
}

export interface DeviceAuthoritySnapshot {
  known: boolean;
  status: string;
  registryVersion: number;
  enforced: boolean;
  bindings: { actorUserId: string; status: string; bindingVersion: number }[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isSafeVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Strict boundary parser shared by every network path that writes the mirror. */
export function parseDeviceAuthoritySnapshot(
  value: unknown,
): DeviceAuthoritySnapshot | null {
  const candidate = record(value);
  if (
    !candidate
    || typeof candidate.known !== 'boolean'
    || typeof candidate.enforced !== 'boolean'
    || !isSafeVersion(candidate.registryVersion)
    || !Array.isArray(candidate.bindings)
  ) return null;
  if (
    (candidate.known && candidate.status !== 'active' && candidate.status !== 'revoked')
    || (!candidate.known && candidate.status !== 'unknown')
  ) return null;

  const bindings: DeviceAuthoritySnapshot['bindings'] = [];
  for (const rawBinding of candidate.bindings) {
    const binding = record(rawBinding);
    if (
      !binding
      || typeof binding.actorUserId !== 'string'
      || binding.actorUserId.length === 0
      || (binding.status !== 'active' && binding.status !== 'revoked')
      || !isSafeVersion(binding.bindingVersion)
    ) return null;
    bindings.push({
      actorUserId: binding.actorUserId as string,
      status: binding.status as DeviceBindingStatus,
      bindingVersion: binding.bindingVersion as number,
    });
  }
  return {
    known: candidate.known as boolean,
    status: candidate.status as string,
    registryVersion: candidate.registryVersion as number,
    enforced: candidate.enforced as boolean,
    bindings,
  };
}

/**
 * Whether migration 0030 has run on THIS database.
 *
 * The same guard commercial.ts uses, and for the same reason: db/auth.ts
 * consults the mirror on the PIN login path, which must keep working on a
 * database that predates this table rather than throwing on a missing relation.
 */
export function deviceRegistrySchemaInstalled(): boolean {
  try {
    sqliteConnection.getFirstSync('SELECT shop_id FROM device_registry_state LIMIT 0');
    return true;
  } catch {
    return false;
  }
}

function toRegistryStatus(value: unknown): DeviceRegistryStatus {
  return value === 'active' || value === 'revoked' ? value : 'unknown';
}

function toBindingStatus(value: unknown): DeviceBindingStatus | null {
  return value === 'active' || value === 'revoked' ? value : null;
}

function safeVersion(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export async function readLocalDeviceRegistry(
  shopId: string,
): Promise<LocalDeviceRegistry | null> {
  if (!deviceRegistrySchemaInstalled()) return null;
  const row = await db
    .select()
    .from(deviceRegistryState)
    .where(eq(deviceRegistryState.shopId, shopId))
    .get();
  if (!row) return null;
  return {
    shopId: row.shopId,
    devicePublicId: row.devicePublicId,
    status: toRegistryStatus(row.status),
    registryVersion: row.registryVersion,
    enforced: row.enforced,
    isEnrolled: typeof row.deviceSecret === 'string' && row.deviceSecret.length > 0,
  };
}

/**
 * The enrolment secret for this shop, or null.
 *
 * Returned only to sync/deviceRegistry.ts, which puts it straight on the wire
 * to the one endpoint that verifies it. It is never logged, never rendered,
 * and never written anywhere but the row it came from — the same discipline
 * CLAUDE.md rule 8 applies to PINs, for the same reason: it is a credential.
 */
/**
 * Whether the mirror ALREADY holds exactly this enrolment.
 *
 * The post-condition a credential flow checks instead of trusting
 * applyDeviceAuthority's boolean. That boolean answers "did this write land",
 * which is not the question: a snapshot the monotonic guard correctly
 * discarded, because local state is already at or past it, leaves the handset
 * perfectly enrolled — and reporting that as a failed login is what sent a
 * staff member back to retype a phone number and rotate a working secret.
 *
 * Asked of the stored row rather than of the write, so it is true only when
 * this installation genuinely has the credential it is about to rely on.
 */
export async function deviceEnrolmentMatches(
  shopId: string,
  devicePublicId: string,
  deviceSecret: string,
): Promise<boolean> {
  if (!deviceRegistrySchemaInstalled()) return false;
  const row = await db
    .select()
    .from(deviceRegistryState)
    .where(eq(deviceRegistryState.shopId, shopId))
    .get();
  return Boolean(
    row
    && row.devicePublicId === devicePublicId
    && row.deviceSecret === deviceSecret
    && toRegistryStatus(row.status) === 'active',
  );
}

export async function readDeviceSecret(shopId: string): Promise<string | null> {
  if (!deviceRegistrySchemaInstalled()) return null;
  const row = await db
    .select({ secret: deviceRegistryState.deviceSecret })
    .from(deviceRegistryState)
    .where(eq(deviceRegistryState.shopId, shopId))
    .get();
  return row?.secret && row.secret.length > 0 ? row.secret : null;
}

export async function readLocalDeviceBinding(
  shopId: string,
  actorUserId: string,
): Promise<{ status: DeviceBindingStatus; bindingVersion: number } | null> {
  if (!deviceRegistrySchemaInstalled()) return null;
  const row = await db
    .select()
    .from(deviceBindingState)
    .where(and(
      eq(deviceBindingState.shopId, shopId),
      eq(deviceBindingState.actorUserId, actorUserId),
    ))
    .get();
  const status = toBindingStatus(row?.status);
  return status ? { status, bindingVersion: row?.bindingVersion ?? 0 } : null;
}

/**
 * The registry's objection to this actor acting on this device, if any.
 *
 * Device revocation is checked FIRST and answers for everyone: "device revoke
 * must quarantine all local users for that shop" is one row, not a per-actor
 * sweep that could be applied incompletely.
 *
 * A read fault is not an objection. If the mirror cannot be consulted this
 * returns null and the caller proceeds — a broken local read must never be
 * able to manufacture a revocation, which is the same rule H-10's
 * `authority_read_failed` follows.
 */
export async function readDeviceAccessObjection(
  shopId: string,
  actorUserId: string,
): Promise<DeviceAccessObjection | null> {
  // A database that predates migration 0030 has no mirror to consult, which is
  // a different fact from a mirror that would not answer. It is the ordinary
  // pre-A2.3 state, it is how this shipped to shops mid-upgrade, and it stays
  // "no objection".
  if (!deviceRegistrySchemaInstalled()) return null;
  try {
    const registry = await readLocalDeviceRegistry(shopId);
    if (registry?.status === 'revoked') return 'device_revoked';
    const binding = await readLocalDeviceBinding(shopId, actorUserId);
    return binding?.status === 'revoked' ? 'binding_revoked' : null;
  } catch {
    // FAIL CLOSED. This used to return null, which read as prudence and was
    // the opposite: the tables exist, so a throw here means they are corrupt
    // or unreadable, and the one thing they exist to record is a revocation.
    // Answering "no objection" would have made `DELETE FROM
    // device_binding_state` — or any corruption resembling it — the way to
    // un-revoke a handset that had been cut off.
    //
    // Reported rather than raised so callers keep control: H-10 turns this
    // into `unverified`, which closes the gate without writing a quarantine,
    // because a read fault is not evidence of revocation either.
    return 'read_failed';
  }
}

/**
 * Persists a server snapshot, if it is newer than what is already stored.
 *
 * Returns whether it was applied, so a caller can tell "the server agreed with
 * me" from "I was handed a stale answer and ignored it".
 *
 * An UNKNOWN device (`known: false`) is still recorded — it pins the public id
 * and the shop's enforcement flag — but it never clears an existing status or
 * secret. That matters on the adoption path: the snapshot that comes back
 * before enrolment must not erase the enrolment that follows it, and a
 * snapshot for a device the server cannot see must not be read as proof that
 * an earlier revocation was lifted.
 */
export async function applyDeviceAuthority(
  shopId: string,
  devicePublicId: string,
  snapshot: DeviceAuthoritySnapshot,
  options: { deviceSecret?: string; now?: Date } = {},
): Promise<boolean> {
  if (!deviceRegistrySchemaInstalled()) return false;
  const fetchedAt = (options.now ?? new Date()).toISOString();
  const incomingVersion = safeVersion(snapshot.registryVersion);

  // ONE transaction: the version COMPARISON, the device row, and every
  // binding in the snapshot.
  //
  // The comparison used to happen out here, before the transaction opened,
  // and that was a real race rather than an untidiness. Two snapshots can be
  // in flight at once — a pull page and an explicit refresh, or a 403's
  // attached authority arriving while a cycle runs — and every `await`
  // between the read and the write is a point at which the other can land in
  // full. The older snapshot would then re-read a version it had already seen
  // superseded, conclude it was newer than what it remembered, and commit a
  // REVOKED device back to active.
  //
  // Inside the transaction the read and the write are one atomic step, so an
  // older snapshot can only ever observe the newer state and discard itself.
  // The drizzle expo-sqlite driver is synchronous, so there is no await in
  // here for anything to interleave with either.
  //
  // The same transaction is what makes device + bindings all-or-nothing. A
  // crash between the device row and the bindings — a kill, a battery dying
  // mid-write, both of which a shop phone does — would otherwise leave
  // registry_version ALREADY ADVANCED while a binding the same snapshot
  // revoked was still stored as active, and the monotonic guard would then
  // reject the re-sent snapshot as stale. The device would sit there
  // permanently holding a revoked account as live.
  let applied = false;
  db.transaction((tx) => {
    const current = tx
      .select()
      .from(deviceRegistryState)
      .where(eq(deviceRegistryState.shopId, shopId))
      .get();

    // Equal is allowed — a re-fetch of the same state is not a replay, and
    // refusing it would make an idempotent refresh look like an attack.
    // Strictly lower is discarded.
    if (
      current
      && current.devicePublicId === devicePublicId
      && incomingVersion < current.registryVersion
    ) {
      return;
    }

    // A credential-bearing response needs NO guard beyond the monotonic one
    // above, and the extra one it used to carry was a defect rather than a
    // safeguard.
    //
    // It refused an equal version whose stored secret differed, reasoning that
    // a delayed response must not replace a newer credential. But the server
    // increments registry_version on EVERY bind, revoke and restore, so two
    // credential responses can never share a version. Equal therefore only
    // ever means "a SECRETLESS snapshot already recorded this version" — and
    // that is the ordinary shape of a login: hydration applies the pull's
    // attached snapshot first, then the response's secret arrives for the same
    // version and was refused as a replay.
    //
    // The effect on hardware was a staff member's first sign-in on a till the
    // owner had already registered: the server enrolled them, rotated the
    // secret and answered 200, the mirror refused to store it, and the screen
    // said the login had failed. Retrying re-enrolled and rotated again,
    // forever. It also refused a credential after a reinstall, when the stored
    // row still named the previous installation id — the one moment
    // re-enrolment has to be able to land.
    //
    // A genuinely stale credential response still has a STRICTLY LOWER
    // version, which the guard above discards, and any revocation advances the
    // version past it. Nothing is accepted here that was refused for a reason.

    const nextStatus: DeviceRegistryStatus = snapshot.known
      ? toRegistryStatus(snapshot.status)
      : toRegistryStatus(current?.status);

    tx
      .insert(deviceRegistryState)
      .values({
        shopId,
        devicePublicId,
        ...(options.deviceSecret ? { deviceSecret: options.deviceSecret } : {}),
        status: nextStatus,
        registryVersion: incomingVersion,
        enforced: snapshot.enforced === true,
        fetchedAt,
      })
      .onConflictDoUpdate({
        target: deviceRegistryState.shopId,
        set: {
          devicePublicId,
          // Absent means "not re-issued", never "cleared". Only
          // forgetDeviceEnrolment below removes a secret.
          ...(options.deviceSecret ? { deviceSecret: options.deviceSecret } : {}),
          status: nextStatus,
          registryVersion: incomingVersion,
          enforced: snapshot.enforced === true,
          fetchedAt,
        },
      })
      .run();

    // Bindings are only ever written from a snapshot the server sent, and only
    // for the actors that snapshot actually named. Nothing is deleted: an
    // actor dropping out of the list is the server declining to mention them,
    // which is not the same as saying their binding is gone.
    //
    // Each carries its OWN monotonic guard, read inside this transaction for
    // exactly the same reason the device's is.
    for (const entry of Array.isArray(snapshot.bindings) ? snapshot.bindings : []) {
      const status = toBindingStatus(entry?.status);
      if (!status || typeof entry.actorUserId !== 'string' || !entry.actorUserId) continue;
      const version = safeVersion(entry.bindingVersion);
      const stored = tx
        .select()
        .from(deviceBindingState)
        .where(and(
          eq(deviceBindingState.shopId, shopId),
          eq(deviceBindingState.actorUserId, entry.actorUserId),
        ))
        .get();
      if (stored && version < stored.bindingVersion) continue;
      tx
        .insert(deviceBindingState)
        .values({
          shopId,
          actorUserId: entry.actorUserId,
          status,
          bindingVersion: version,
          fetchedAt,
        })
        .onConflictDoUpdate({
          target: [deviceBindingState.shopId, deviceBindingState.actorUserId],
          set: { status, bindingVersion: version, fetchedAt },
        })
        .run();
    }
    applied = true;
  });

  return applied;
}

/**
 * Drops the stored secret for this shop, leaving every status intact.
 *
 * Used when the server has refused this installation's credential outright, so
 * the device stops presenting one it knows is dead and falls back to phone +
 * PIN. Deliberately does NOT touch status or version: forgetting a credential
 * is not evidence about whether access was revoked, and conflating the two is
 * how a device would talk itself out of a quarantine.
 */
export async function forgetDeviceEnrolment(shopId: string): Promise<void> {
  if (!deviceRegistrySchemaInstalled()) return;
  await db
    .update(deviceRegistryState)
    .set({ deviceSecret: null })
    .where(eq(deviceRegistryState.shopId, shopId))
    .run();
}
