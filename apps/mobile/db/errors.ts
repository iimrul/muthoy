// db/errors.ts — typed errors for db/ write failures. Pure (no Drizzle/
// expo-sqlite import) so it can be unit-tested directly. First of its kind in
// the repo: every prior db/ write threw a bare `new Error(...)`.

import { ACCESS_DENIED_MESSAGE } from '../domain/permissions';

// Thrown by db/inventory.ts's addBatchToMedicine when the batch number is
// already used for this medicine — the UNIQUE(shop_id, medicine_id, batch_no)
// constraint at db/schema.ts's batches_shop_medicine_batchno_unique index.
// Screens catch this and render the message inline under the batch-number
// field (Volume 0 Day 8: "a friendly error, not a crash") — never an Alert.
export class DuplicateBatchError extends Error {
  readonly medicineId: string;
  readonly batchNo: string;

  constructor(medicineId: string, batchNo: string) {
    super(`Batch number "${batchNo}" already exists for this medicine.`);
    this.name = 'DuplicateBatchError';
    this.medicineId = medicineId;
    this.batchNo = batchNo;
  }
}

export class BatchExpiryMismatchError extends Error {
  readonly medicineId: string;
  readonly batchNo: string;
  constructor(medicineId: string, batchNo: string) {
    super(`Batch "${batchNo}" already exists with a different expiry date.`);
    this.name = 'BatchExpiryMismatchError';
    this.medicineId = medicineId;
    this.batchNo = batchNo;
  }
}

// Thrown by db/staff.ts's createStaff when the phone number is already used by
// another live user — the partial UNIQUE index at db/schema.ts's
// users_phone_unique (migration 0007). Phone is the login identifier a FRESH
// device types before it holds any local rows, so it has to resolve to exactly
// one account; a duplicate is refused at entry rather than discovered later as
// an ambiguous login. Screens render this inline under the phone field, like
// DuplicateBatchError above — never an Alert.
export class DuplicatePhoneError extends Error {
  readonly phone: string;

  constructor(phone: string) {
    super('That phone number is already used by someone at this shop.');
    this.name = 'DuplicatePhoneError';
    this.phone = phone;
  }
}

/**
 * Thrown when a PIN is already in use by another live user of this device.
 *
 * PIN Login has no "who are you" step — Volume 4 scopes Beta to one shop per
 * device, so db/auth.ts's verifyPin compares the typed PIN against EVERY live
 * user's hash and returns the FIRST match. Two people sharing a PIN therefore
 * means one of them silently signs in as the other; if the collision is with
 * the owner, a staff member is handed owner access by typing their own PIN.
 *
 * Refused at the point the PIN is CHOSEN — the only place it can be refused
 * without locking somebody out later. Screens render this inline under the PIN
 * field, like DuplicatePhoneError above. It deliberately carries no digits:
 * CLAUDE.md rule 8 keeps a raw PIN out of every message and log.
 */
export class DuplicatePinError extends Error {
  constructor() {
    super('That PIN is already used by someone at this shop. Choose another.');
    this.name = 'DuplicatePinError';
  }
}

// Thrown by db/auth.ts's requirePermission/requireOwner when the actor's role
// — re-read from SQLite, never trusted from the session store — does not grant
// the action. Screens render the same friendly denial text, so a blocked
// action and a blocked route read identically to the user.
export class NotAuthorizedError extends Error {
  constructor() {
    super(ACCESS_DENIED_MESSAGE);
    this.name = 'NotAuthorizedError';
  }
}

// Thrown by db/cash.ts's assertBusinessDateOpen, and by any write path that
// calls it (sales, customer credit collections, purchases) before touching a
// business date whose cash_drawer.closed_at is already set. Volume 0 Day 10:
// a closed day's locked EOD snapshot (closing_expected/counted/variance) must
// never be invalidated by a later write — the guard is a read-only check, so
// it never reopens or rewrites the drawer itself.
export class DayClosedError extends Error {
  readonly businessDate: string;

  constructor(businessDate: string) {
    super('This day is already closed — reopening is not supported.');
    this.name = 'DayClosedError';
    this.businessDate = businessDate;
  }
}

// Thrown when the device changed hands between the moment an async write was
// started and the moment it would have committed (Volume 0 Days 5/11 device
// handover; state/switchUser.ts). A screen handler closes over the session
// that rendered it, and that closure outlives the switch — so every write that
// stamps an actor id carries a liveness callback and this is what it throws.
// Distinct from NotAuthorizedError: the actor was fully entitled, they just are
// not the person holding the phone any more.
export class StaleSessionError extends Error {
  constructor() {
    super('The active user changed. This action was not saved.');
    this.name = 'StaleSessionError';
  }
}

/**
 * Guard for every write that stamps an actor id.
 *
 * FAILS CLOSED. The parameter is required, and a missing or non-callable one
 * throws exactly like a stale session: a mutation boundary that cannot say
 * whose session it belongs to must not run. Leaving it optional would mean a
 * caller who simply forgot silently lost the protection.
 *
 * Placement:
 *  - SYNCHRONOUS db.transaction callbacks (cash, customers, purchases, sales):
 *    call it as the FIRST statement. The whole body then runs in one
 *    uninterruptible turn and switchUser() cannot land inside it.
 *  - ASYNC db.transaction callbacks (inventory, staff, settings, suppliers):
 *    call it first AND last. Those bodies await between writes, so a handover
 *    can land mid-transaction; the trailing check turns that into a throw,
 *    which rolls the whole transaction back.
 *
 * This is the ATTRIBUTION backstop, and deliberately not the AUTHORIZATION
 * one — db/auth.ts's requirePermission/requireOwner still re-derive the
 * actor's role from SQLite on every one of these paths.
 */
export function assertSessionLive(isStillActive: () => boolean): void {
  if (typeof isStillActive !== 'function' || !isStillActive()) {
    throw new StaleSessionError();
  }
}

/**
 * The liveness callback for callers that are NOT tied to an interactive
 * session: unit tests, and any deliberately session-independent path. Naming
 * the exemption makes it visible at the call site, instead of letting an
 * omitted argument quietly mean the same thing.
 */
export const ALWAYS_LIVE = (): boolean => true;

// expo-sqlite surfaces a plain Error with no `.code` — detection is by
// message text. SQLite's own wording: 'UNIQUE constraint failed:
// batches.shop_id, batches.medicine_id, batches.batch_no'. Used as a backstop
// behind addBatchToMedicine's pre-check SELECT (see db/inventory.ts).
export function isUniqueConstraintViolation(err: unknown, table: string, columns: string[]): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  if (!err.message.includes('UNIQUE constraint failed')) {
    return false;
  }
  return columns.every((column) => err.message.includes(`${table}.${column}`));
}
