import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

type SyncControlCode =
  | 'permissions_changed'
  | 'hook_not_configured'
  | 'request_failed_after_refresh';

interface FunctionErrorBody {
  code?: unknown;
  error?: unknown;
}

export class SyncHaltedError extends Error {
  constructor(
    message: string,
    public readonly code: SyncControlCode,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SyncHaltedError';
  }
}

async function readFunctionsHttpErrorBody(error: unknown): Promise<FunctionErrorBody | null> {
  if (!(error instanceof FunctionsHttpError)) {
    return null;
  }
  const response = error.context as Partial<Response> | undefined;
  if (!response || typeof response.clone !== 'function') {
    return null;
  }
  try {
    const body: unknown = await response.clone().json();
    return body && typeof body === 'object' && !Array.isArray(body)
      ? body as FunctionErrorBody
      : null;
  } catch {
    return null;
  }
}

/**
 * Retries one stale-claim request after a token refresh. Control-plane failures
 * throw before callers mutate any outbox row or consume its normal retry budget.
 */
export async function invokeSyncWithClaimRefresh(
  body: Record<string, unknown>,
): Promise<{ data: unknown; error: Error | null }> {
  let refreshed = false;

  while (true) {
    const { data, error } = await supabase.functions.invoke('sync', { body });
    if (!error) {
      return { data, error: null };
    }

    const details = await readFunctionsHttpErrorBody(error);
    if (details?.code === 'hook_not_configured') {
      throw new SyncHaltedError(
        typeof details.error === 'string'
          ? details.error
          : 'Authentication hook is not configured',
        'hook_not_configured',
        error,
      );
    }

    if (details?.code === 'permissions_changed') {
      if (!refreshed) {
        refreshed = true;
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError) {
          throw new SyncHaltedError(
            refreshError.message,
            'permissions_changed',
            refreshError,
          );
        }
        continue;
      }
      throw new SyncHaltedError(
        typeof details.error === 'string'
          ? details.error
          : 'Permissions changed; refresh the session',
        'permissions_changed',
        error,
      );
    }

    if (refreshed) {
      throw new SyncHaltedError(
        typeof details?.error === 'string' ? details.error : error.message,
        'request_failed_after_refresh',
        error,
      );
    }

    return { data: null, error };
  }
}
