import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  completePendingAuthTimingStage,
  getPendingAuthTiming,
  handoffAuthTiming,
  startAuthTiming,
  startPendingAuthTimingStage,
} from './authTiming';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('development auth timing', () => {
  it('emits random non-identifying correlation ids only in development', () => {
    vi.stubGlobal('__DEV__', true);
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const first = startAuthTiming('offline_pin_login', performance.now());
    expect(first?.correlationId).toMatch(/^[a-f0-9]{32}$/);
    expect(log).toHaveBeenCalledWith(
      '[auth:timing]',
      expect.objectContaining({
        correlationId: first?.correlationId,
        flow: 'offline_pin_login',
        stage: 'pin_completion',
      }),
    );
  });

  it('emits no logs and creates no trace in production', () => {
    vi.stubGlobal('__DEV__', false);
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const trace = startAuthTiming('device_login', performance.now());
    handoffAuthTiming(trace);
    startPendingAuthTimingStage('initial_sync');
    completePendingAuthTimingStage('navigation_render_completion');

    expect(trace).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it('keeps one correlation through initial sync and rendered navigation', () => {
    vi.stubGlobal('__DEV__', true);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const trace = startAuthTiming('offline_pin_login', performance.now());
    handoffAuthTiming(trace);

    const correlationId = startPendingAuthTimingStage('initial_sync');
    completePendingAuthTimingStage('navigation_render_completion');

    expect(correlationId).toBe(trace?.correlationId);
    expect(getPendingAuthTiming()).toBe(trace);

    completePendingAuthTimingStage('initial_sync', 'ok', correlationId ?? undefined);
    expect(getPendingAuthTiming()).toBeUndefined();
  });
});
