import { getRandomBytes } from 'expo-crypto';

export type AuthTimingFlow =
  | 'owner_pin_setup'
  | 'staff_creation'
  | 'offline_pin_login'
  | 'device_login';

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function randomCorrelationId(): string {
  return Array.from(getRandomBytes(16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface AuthTimingTrace {
  readonly correlationId: string;
  readonly flow: AuthTimingFlow;
  mark: (stage: string, outcome?: 'ok' | 'error') => void;
  measure: <T>(stage: string, operation: () => Promise<T>) => Promise<T>;
}

interface PendingTrace {
  trace: AuthTimingTrace;
  startedStages: Set<string>;
  completedStages: Set<string>;
}

let pendingTrace: PendingTrace | null = null;

function isDevelopment(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

/**
 * Development-only authentication timings. The correlation id is fresh random
 * data and is never derived from a credential, token, user, or shop.
 */
export function startAuthTiming(
  flow: AuthTimingFlow,
  pinCompletedAt: number,
): AuthTimingTrace | undefined {
  if (!isDevelopment()) {
    return undefined;
  }

  const correlationId = randomCorrelationId();
  const startedAt = pinCompletedAt;
  let lastAt = pinCompletedAt;

  const write = (stage: string, durationMs: number, outcome: 'ok' | 'error') => {
    if (!isDevelopment()) {
      return;
    }
    const current = now();
    console.info('[auth:timing]', {
      correlationId,
      flow,
      stage,
      durationMs: Math.round(durationMs),
      totalMs: Math.round(current - startedAt),
      outcome,
    });
    lastAt = current;
  };

  const trace: AuthTimingTrace = {
    correlationId,
    flow,
    mark(stage, outcome = 'ok') {
      const current = now();
      write(stage, current - lastAt, outcome);
    },
    async measure(stage, operation) {
      const stageStartedAt = now();
      try {
        const result = await operation();
        write(stage, now() - stageStartedAt, 'ok');
        return result;
      } catch (error) {
        write(stage, now() - stageStartedAt, 'error');
        throw error;
      }
    },
  };

  trace.mark('pin_completion');
  return trace;
}

/** Carries only the random trace object across login -> layout -> dashboard. */
export function handoffAuthTiming(trace: AuthTimingTrace | undefined): void {
  if (!isDevelopment() || !trace) {
    return;
  }
  pendingTrace = { trace, startedStages: new Set(), completedStages: new Set() };
}

export function getPendingAuthTiming(): AuthTimingTrace | undefined {
  return isDevelopment() ? pendingTrace?.trace : undefined;
}

export function startPendingAuthTimingStage(stage: 'initial_sync'): string | null {
  if (!isDevelopment() || !pendingTrace || pendingTrace.startedStages.has(stage)) {
    return null;
  }
  pendingTrace.trace.mark(`${stage}_start`);
  pendingTrace.startedStages.add(stage);
  return pendingTrace.trace.correlationId;
}

/**
 * Navigation and initial sync finish independently. Retain the trace until both
 * have reported, then discard it without a timer.
 */
export function completePendingAuthTimingStage(
  stage: 'initial_sync' | 'navigation_render_completion',
  outcome: 'ok' | 'error' = 'ok',
  expectedCorrelationId?: string,
): void {
  if (
    !isDevelopment()
    || !pendingTrace
    || (expectedCorrelationId && pendingTrace.trace.correlationId !== expectedCorrelationId)
    || pendingTrace.completedStages.has(stage)
  ) {
    return;
  }
  pendingTrace.trace.mark(stage, outcome);
  pendingTrace.completedStages.add(stage);
  if (
    pendingTrace.completedStages.has('initial_sync')
    && pendingTrace.completedStages.has('navigation_render_completion')
  ) {
    pendingTrace = null;
  }
}
