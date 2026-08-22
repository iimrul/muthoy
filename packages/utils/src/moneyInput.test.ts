import { describe, expect, it } from 'vitest';
import { parseTakaTextToPaisa } from './moneyInput';

describe('parseTakaTextToPaisa', () => {
  it.each([['0', 0], ['12.3', 1230], ['12.34', 1234]])('%s -> %i paisa', (value, expected) => {
    expect(parseTakaTextToPaisa(value)).toBe(expected);
  });
  it.each(['1.234', '-1', '1e3', 'NaN'])('rejects %s', (value) => expect(() => parseTakaTextToPaisa(value)).toThrow());
});
