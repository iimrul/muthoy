// domain/errorMessages.ts — the one place a thrown error becomes screen text.
//
// Before this, screens rendered `caught.message` directly. Every message in
// db/ is written in English, so a Bangla-first POS showed English the moment
// anything went wrong — which is exactly when a shopkeeper most needs to
// understand what happened. It is also the least tested path on any screen, so
// it stayed broken while the happy path was fully translated.
//
// Mapped by `error.name` rather than by message text. Every error class in
// db/errors.ts sets `name` in its constructor, and a name is a stable
// identifier where a sentence is not; it is the same closed-enum approach
// domain/errorRedaction.ts uses to decide what may reach a monitoring sink.
//
// An unrecognised error returns null, and the caller supplies a screen-specific
// fallback. Nothing here ever returns the original message.

import { catalog, type CatalogKey } from "../i18n/catalog";

/**
 * Error class name -> catalog key.
 *
 * Only failures a user can act on, or at least understand, are listed. A
 * programming fault (TypeError, a Drizzle error) deliberately has no entry: it
 * collapses to the caller's generic fallback rather than inventing reassuring
 * copy for a bug.
 */
export const ERROR_MESSAGE_KEYS: Record<string, CatalogKey> = {
  // Conflict resolution (db/conflicts.ts)
  ConflictNotFoundError: "syncConflictNotFound",
  ConflictGroupedOperationError: "syncConflictGroupedBlocked",
  // Shared guards reachable from almost any write (db/errors.ts)
  NotAuthorizedError: "syncConflictNotAuthorized",
  DayClosedError: "syncConflictDayClosed",
  CommercialReadOnlyError: "syncConflictPlanReadOnly",
  StaleSessionError: "syncConflictStaleSession",
  DeviceAccessRevokedError: "syncConflictDeviceRevoked",
};

/**
 * The catalog key for a thrown value, or null when there is no safe mapping.
 *
 * Reads only `name`, and only to look it up — so an error whose message carries
 * a phone number, a PIN or a customer's name cannot leak through this path.
 */
export function errorCatalogKey(error: unknown): CatalogKey | null {
  if (error === null || typeof error !== "object") return null;
  const name = (error as { name?: unknown }).name;
  if (typeof name !== "string") return null;
  const key = ERROR_MESSAGE_KEYS[name];
  return key && key in catalog.en ? key : null;
}
