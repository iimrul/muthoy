import { assertCallerCurrent, type Caller, HttpError } from './_shared/auth.ts';
import { supabaseAdmin } from './_shared/supabaseAdmin.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function reactivateStaff(caller: Caller, body: Record<string, unknown>) {
  const staffUserId = body.staffUserId;
  const operationId = body.operationId;
  const requestedShopId = body.shopId;
  if (
    typeof staffUserId !== 'string' || !UUID.test(staffUserId)
    || typeof operationId !== 'string' || !UUID.test(operationId)
    || typeof requestedShopId !== 'string' || !UUID.test(requestedShopId)
  ) {
    throw new HttpError(400, 'Valid shopId, staffUserId and operationId are required');
  }

  const owner = await assertCallerCurrent(caller);
  if (!owner.isOwner || owner.shopId !== requestedShopId) {
    throw new HttpError(403, 'Owner access only', 'owner_required');
  }

  const { data, error } = await supabaseAdmin.rpc('h7_reactivate_staff', {
    p_owner_user_id: owner.appUserId,
    p_shop_id: owner.shopId,
    p_staff_user_id: staffUserId,
    p_operation_id: operationId,
  });
  if (error) {
    if (error.code === 'MU053') throw new HttpError(404, 'Staff account not found', 'staff_not_found');
    if (error.code === 'MU054') throw new HttpError(409, 'Deleted staff cannot be reactivated', 'staff_deleted');
    if (error.code === 'MU057') throw new HttpError(409, 'Staff plan limit reached', 'plan_limit');
    if (['MU051', 'MU055'].includes(error.code ?? '')) {
      throw new HttpError(403, 'Owner access only', 'owner_required');
    }
    if (error.code === 'MU052') throw new HttpError(409, 'Operation conflict', 'operation_conflict');
    console.error(`sync/staff-reactivate failed: db=${error.code ?? 'unknown'}`);
    throw new HttpError(500, 'Could not reactivate staff', 'staff_reactivation_failed');
  }
  return data;
}
