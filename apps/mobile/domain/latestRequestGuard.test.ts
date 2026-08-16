import { describe, expect, it } from 'vitest';
import { createLatestRequestGuard } from './latestRequestGuard';

describe('createLatestRequestGuard', () => {
  it('reports a single in-flight request as latest', () => {
    const guard = createLatestRequestGuard();
    const id = guard.start();
    expect(guard.isLatest(id)).toBe(true);
  });

  it('reports an earlier request as no longer latest once a newer one starts', () => {
    const guard = createLatestRequestGuard();
    const first = guard.start();
    const second = guard.start();
    expect(guard.isLatest(first)).toBe(false);
    expect(guard.isLatest(second)).toBe(true);
  });

  it('keeps only the newest id current across several starts', () => {
    const guard = createLatestRequestGuard();
    guard.start();
    guard.start();
    const third = guard.start();
    expect(guard.isLatest(third)).toBe(true);
    expect(guard.isLatest(third - 1)).toBe(false);
    expect(guard.isLatest(third - 2)).toBe(false);
  });

  it('gives independent guards their own counters', () => {
    const guardA = createLatestRequestGuard();
    const guardB = createLatestRequestGuard();
    const idA = guardA.start();
    guardB.start();
    guardB.start();
    expect(guardA.isLatest(idA)).toBe(true);
  });
});
