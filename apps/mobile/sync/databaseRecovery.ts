// H-3 missing-key recovery orchestration. Server credential proof is the first
// state-changing gate; db/ owns every local database/file operation.

import { verifyPinForUser } from '../db/auth';
import {
  closeDatabaseRecoveryTarget,
  openDatabaseRecoveryTarget,
  promoteHydratedRecoveryDatabase,
  releaseLockedRecoveryDatabase,
  verifyCurrentRecoveryDatabase,
} from '../db/databaseRecovery';
import {
  beginDatabaseKeyRecovery,
  completeDatabaseKeyRecovery,
} from '../db/databaseKey';
import {
  activateHydratedDevice,
  authenticateNewDeviceCredentials,
  DeviceLoginError,
  hydrateAuthenticatedDevice,
} from './deviceAuth';

export async function recoverDatabaseFromServer(phone: string, pin: string): Promise<void> {
  // Mandatory first gate: no key or filesystem mutation before the server has
  // authenticated the operator and bound the returned cloud actor.
  const response = await authenticateNewDeviceCredentials(phone, pin);
  const keyHex = await beginDatabaseKeyRecovery();
  try {
    const state = await openDatabaseRecoveryTarget(keyHex);

    if (state === 'needs-hydration') {
      await hydrateAuthenticatedDevice(response, pin);
      verifyCurrentRecoveryDatabase();
      await promoteHydratedRecoveryDatabase(keyHex);
    }

    // Re-derive the exact actor from the promoted main, never from the server
    // response or the now-closed recovery candidate.
    const local = await verifyPinForUser(pin, response.shopId, response.userId);
    if (!local || local.userId !== response.userId || local.shopId !== response.shopId) {
      throw new DeviceLoginError('Your shop data did not download completely. Please try again.', false);
    }

    // The new main is open, verified, and actor-bound. Activate the exact local
    // actor before marking key recovery complete; therefore pending=false also
    // proves activation succeeded if a crash strands locked cleanup.
    await activateHydratedDevice(local);
    await completeDatabaseKeyRecovery();

    // No operation after the durable completion marker may turn this into a
    // second key rotation. Normal startup repeats bounded artifact cleanup.
    try {
      closeDatabaseRecoveryTarget();
    } catch {
      // State is cleared before close; main was already verified.
    }
    try {
      await releaseLockedRecoveryDatabase(keyHex);
    } catch {
      // Locked copy remains for verified steady-state cleanup on next open.
    }
  } catch (error) {
    try {
      closeDatabaseRecoveryTarget();
    } catch {
      // Preserve the authoritative recovery failure and every on-disk copy.
    }
    throw error;
  }
}
