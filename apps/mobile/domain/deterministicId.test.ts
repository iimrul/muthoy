import { describe, expect, it } from 'vitest';
import { refundChildId, refundOperationId, uuidV5 } from './deterministicId';

describe('deterministic ids', () => {
  it('matches the RFC UUIDv5 vector', () => expect(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.widgets.com')).toBe('21f7f8de-8051-5b89-8680-0195ef798b6a'));
  it('is deterministic per shop and sale with deterministic children', () => {
    const id = refundOperationId('shop-1', 'sale-1');
    expect(refundOperationId('shop-1', 'sale-1')).toBe(id);
    expect(refundOperationId('shop-2', 'sale-1')).not.toBe(id);
    expect(refundChildId(id, 'stock:batch-1')).toBe(refundChildId(id, 'stock:batch-1'));
  });
});
