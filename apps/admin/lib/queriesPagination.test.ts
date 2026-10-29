import { describe, expect, test } from 'vitest';
import { readAllPages } from './queries';

describe('complete reads under a smaller PostgREST response cap', () => {
  test.each([1, 137, 1000])('reads every row with cap %i, without skips or duplicates', async (cap) => {
    const source = Array.from({ length: 1501 }, (_, id) => ({ id }));
    const offsets: number[] = [];
    const rows = await readAllPages('fixture', async (from, to) => {
      offsets.push(from);
      return { data: source.slice(from, Math.min(to + 1, from + cap)), error: null };
    });
    expect(rows).toEqual(source);
    expect(offsets.at(-1)).toBe(source.length);
    expect(offsets[1]).toBe(cap);
  });

  test('a legitimate capped read is not refused after 200 requests', async () => {
    const source = Array.from({ length: 201 }, (_, id) => ({ id }));
    expect(await readAllPages('fixture', async (from) => ({
      data: source.slice(from, from + 1), error: null,
    }))).toEqual(source);
  });

  test('accepts the exact row ceiling, but refuses one beyond it', async () => {
    const source = Array.from({ length: 200_001 }, (_, id) => ({ id }));
    const read = (length: number) => readAllPages('fixture', async (from, to) => ({
      data: source.slice(from, Math.min(to + 1, length)), error: null,
    }));
    expect(await read(200_000)).toHaveLength(200_000);
    await expect(read(200_001)).rejects.toThrow('larger than this page can read');
  });

  test('a later page error refuses instead of returning a partial list', async () => {
    await expect(readAllPages('fixture', async (from) => from === 0
      ? { data: [{ id: 1 }], error: null }
      : { data: null, error: { message: 'database unavailable' } },
    )).rejects.toThrow('fixture query failed');
  });
});
