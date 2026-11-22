import { useCallback, useSyncExternalStore } from 'react';
import { syncStateOf, type SyncCounts, type SyncState } from '../components/sync/syncState';

// state/liveSyncState.ts — the queue state behind the header's blinking dot.
//
// The founder (2026-11-22): the header's sync button shows a blinking yellow
// dot while changes wait to be sent and a blinking red one when they cannot
// be sent. Headers sit on many screens and the tab shell keeps them mounted,
// so this is ONE watcher per shop, shared by every subscriber, rather than a
// query per header.
//
// Deliberately free of database and sync imports. The sync engine installs
// the source (sync/index.ts); until it has, every subscriber reads
// 'unavailable' and no dot is drawn. That keeps StandardHeader — used by
// almost every screen and its tests — from pulling the sync engine into its
// import graph.

export interface LiveSyncSource {
  read(shopId: string): SyncCounts;
  subscribe(shopId: string, onCompleted: () => Promise<void> | void): () => void;
}

/**
 * How often an open screen re-counts the queue. A sale enqueues a row and
 * triggers a cycle; the cycle's completion refreshes at once, and this catches
 * everything that completion does not announce (a row marked failed, a
 * skipped cycle, a write made while offline). One indexed COUNT per tick.
 */
export const LIVE_SYNC_POLL_MS = 4_000;

interface Watch {
  listeners: Set<() => void>;
  state: SyncState;
  stop: () => void;
}

let source: LiveSyncSource | null = null;
const watches = new Map<string, Watch>();

export function installLiveSyncSource(next: LiveSyncSource | null): void {
  source = next;
  for (const shopId of watches.keys()) refresh(shopId);
}

function read(shopId: string): SyncState {
  if (!source) return 'unavailable';
  try {
    return syncStateOf(source.read(shopId));
  } catch {
    // The database is not open yet, or is being replaced: no claim at all.
    return 'unavailable';
  }
}

function refresh(shopId: string): void {
  const watch = watches.get(shopId);
  if (!watch) return;
  const next = read(shopId);
  if (next === watch.state) return;
  watch.state = next;
  for (const listener of [...watch.listeners]) listener();
}

function startWatch(shopId: string): Watch {
  const timer = setInterval(() => refresh(shopId), LIVE_SYNC_POLL_MS);
  let unsubscribe = () => {};
  try {
    unsubscribe = source?.subscribe(shopId, () => refresh(shopId)) ?? unsubscribe;
  } catch {
    // Polling still covers it.
  }
  return {
    listeners: new Set(),
    state: read(shopId),
    stop: () => {
      clearInterval(timer);
      unsubscribe();
    },
  };
}

/** Subscribes to one shop's queue state; the last subscriber stops the watch. */
export function watchLiveSyncState(shopId: string, listener: () => void): () => void {
  let watch = watches.get(shopId);
  if (!watch) {
    watch = startWatch(shopId);
    watches.set(shopId, watch);
  }
  const current = watch;
  current.listeners.add(listener);
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size === 0 && watches.get(shopId) === current) {
      current.stop();
      watches.delete(shopId);
    }
  };
}

export function liveSyncStateOf(shopId: string): SyncState {
  return watches.get(shopId)?.state ?? read(shopId);
}

const NO_WATCH = () => () => {};

/** The queue state for `shopId`, live; 'unavailable' without a shop. */
export function useLiveSyncState(shopId: string | null | undefined): SyncState {
  const subscribe = useCallback(
    (listener: () => void) => (shopId ? watchLiveSyncState(shopId, listener) : NO_WATCH()),
    [shopId],
  );
  const snapshot = useCallback(
    (): SyncState => (shopId ? liveSyncStateOf(shopId) : 'unavailable'),
    [shopId],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Test seam. */
export function resetLiveSyncState(): void {
  for (const watch of watches.values()) watch.stop();
  watches.clear();
  source = null;
}
