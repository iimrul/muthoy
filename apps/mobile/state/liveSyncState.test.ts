import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installLiveSyncSource,
  LIVE_SYNC_POLL_MS,
  liveSyncStateOf,
  resetLiveSyncState,
  watchLiveSyncState,
  type LiveSyncSource,
} from './liveSyncState';

function fakeSource(initial = { pending: 0, failed: 0, stuck: 0 }) {
  let counts = initial;
  let completion: (() => Promise<void> | void) | null = null;
  const unsubscribe = vi.fn();
  const source: LiveSyncSource = {
    read: vi.fn(() => counts),
    subscribe: vi.fn((_shopId, listener) => { completion = listener; return unsubscribe; }),
  };
  return {
    source,
    unsubscribe,
    set(next: { pending: number; failed: number; stuck: number }) { counts = next; },
    complete: async () => { await completion?.(); },
  };
}

beforeEach(() => { vi.useFakeTimers(); resetLiveSyncState(); });
afterEach(() => { resetLiveSyncState(); vi.useRealTimers(); });

describe('the header sync dot state', () => {
  it('claims nothing before the sync engine installs a source', () => {
    const listener = vi.fn();
    const stop = watchLiveSyncState('shop-a', listener);
    expect(liveSyncStateOf('shop-a')).toBe('unavailable');
    stop();
  });

  it('shares ONE watcher per shop however many headers subscribe', () => {
    const fake = fakeSource({ pending: 2, failed: 0, stuck: 0 });
    installLiveSyncSource(fake.source);
    const stopA = watchLiveSyncState('shop-a', vi.fn());
    const stopB = watchLiveSyncState('shop-a', vi.fn());
    expect(fake.source.subscribe).toHaveBeenCalledTimes(1);
    expect(liveSyncStateOf('shop-a')).toBe('waiting');
    stopA();
    expect(fake.unsubscribe).not.toHaveBeenCalled();
    stopB();
    expect(fake.unsubscribe).toHaveBeenCalledOnce();
    // The last subscriber also stops the polling.
    vi.mocked(fake.source.read).mockClear();
    vi.advanceTimersByTime(LIVE_SYNC_POLL_MS * 3);
    expect(fake.source.read).not.toHaveBeenCalled();
  });

  it('turns yellow when a write is waiting and clears when the cycle completes', async () => {
    const fake = fakeSource();
    installLiveSyncSource(fake.source);
    const listener = vi.fn();
    const stop = watchLiveSyncState('shop-a', listener);
    expect(liveSyncStateOf('shop-a')).toBe('sent');

    fake.set({ pending: 1, failed: 0, stuck: 0 });
    vi.advanceTimersByTime(LIVE_SYNC_POLL_MS);
    expect(liveSyncStateOf('shop-a')).toBe('waiting');
    expect(listener).toHaveBeenCalledTimes(1);

    fake.set({ pending: 0, failed: 0, stuck: 0 });
    await fake.complete();
    expect(liveSyncStateOf('shop-a')).toBe('sent');
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });

  it('turns red when a row fails or keeps retrying, and only notifies on a change', () => {
    const fake = fakeSource({ pending: 3, failed: 0, stuck: 1 });
    installLiveSyncSource(fake.source);
    const listener = vi.fn();
    const stop = watchLiveSyncState('shop-a', listener);
    expect(liveSyncStateOf('shop-a')).toBe('failing');
    vi.advanceTimersByTime(LIVE_SYNC_POLL_MS * 2);
    expect(listener).not.toHaveBeenCalled();
    stop();
  });

  it('reads as unavailable, not as sent, when the database cannot answer', () => {
    installLiveSyncSource({
      read: () => { throw new Error('database not open'); },
      subscribe: () => () => {},
    });
    const stop = watchLiveSyncState('shop-a', vi.fn());
    expect(liveSyncStateOf('shop-a')).toBe('unavailable');
    stop();
  });

  it('picks up a source installed after a header already subscribed', () => {
    const listener = vi.fn();
    const stop = watchLiveSyncState('shop-a', listener);
    installLiveSyncSource(fakeSource({ pending: 0, failed: 2, stuck: 0 }).source);
    expect(liveSyncStateOf('shop-a')).toBe('failing');
    expect(listener).toHaveBeenCalledOnce();
    stop();
  });
});
