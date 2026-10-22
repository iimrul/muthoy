import { describe, expect, it, vi } from 'vitest';
import { asPaisa } from '@muthoy/types';
import { buildPrescriptionLines, type PrescriptionLookupResult } from './prescriptionLines';

function stocked(
  name: string,
  overrides: Partial<PrescriptionLookupResult> = {},
): PrescriptionLookupResult {
  return {
    medicineId: `medicine-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    activeBatch: {
      id: 'batch-1',
      expiryDate: '2099-01-01',
      salePrice: asPaisa(1200),
      quantityAvailable: 7,
    },
    activeBatchNo: 'B-2401',
    ...overrides,
  };
}

describe('buildPrescriptionLines', () => {
  it('matches a line the shop stocks and carries its batch, expiry, price and ceiling', async () => {
    const lines = await buildPrescriptionLines('Napa Extra\nBatch: B-2401', async () => [
      stocked('Napa Extra'),
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0]!.match).toEqual({
      medicineId: 'medicine-napa-extra',
      name: 'Napa Extra',
      batchId: 'batch-1',
      batchNo: 'B-2401',
      expiryDate: '2099-01-01',
      unitPrice: asPaisa(1200),
      availableQuantity: 7,
    });
    // Never pre-added: the shopkeeper presses Add, or nothing happens.
    expect(lines[0]!.isAdded).toBe(false);
  });

  it('keeps an unmatched line in the list rather than dropping it', async () => {
    const lines = await buildPrescriptionLines('Mysterymed 999', async () => []);

    // Silently losing a prescribed medicine is worse than showing one that
    // still needs a search.
    expect(lines).toHaveLength(1);
    expect(lines[0]!.match).toBeNull();
    expect(lines[0]!.rawText).toBe('Mysterymed 999');
  });

  it('splits a multi-item prescription and matches each line independently', async () => {
    const lookup = vi.fn(async (name: string) =>
      name.toLowerCase().includes('napa') ? [stocked('Napa Extra')] : [],
    );

    const lines = await buildPrescriptionLines(
      'Napa Extra\nBatch: B-2401\n\nMysterymed 999\n\nSeclo 20mg',
      lookup,
    );

    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.match !== null)).toEqual([true, false, false]);
    // One id per position, so React keys stay stable for a given build.
    expect(lines.map((line) => line.id)).toEqual(['rx-0', 'rx-1', 'rx-2']);
  });

  it('refuses a prefix match — the same rule the sale scan uses', async () => {
    // searchMedicinesForSale does FTS PREFIX matching, so "exactly one result"
    // is not evidence that a short OCR read is really that product.
    const lines = await buildPrescriptionLines('Napa', async () => [stocked('Napa Extra')]);

    expect(lines[0]!.match).toBeNull();
  });

  it('refuses an ambiguous match of two products', async () => {
    const lines = await buildPrescriptionLines('Napa Extra', async () => [
      stocked('Napa Extra'),
      stocked('Napa Extra', { medicineId: 'medicine-duplicate' }),
    ]);

    expect(lines[0]!.match).toBeNull();
  });

  it('matches case-insensitively, because print and OCR disagree on case', async () => {
    const lines = await buildPrescriptionLines('NAPA EXTRA', async () => [stocked('Napa Extra')]);

    expect(lines[0]!.match?.medicineId).toBe('medicine-napa-extra');
    // The stocked spelling wins, not the shouted one off the prescription.
    expect(lines[0]!.match?.name).toBe('Napa Extra');
  });

  it('collapses the whitespace OCR leaves in a line', async () => {
    const lines = await buildPrescriptionLines('Napa   Extra\n  Batch:  B-2401 ', async () => []);

    expect(lines[0]!.rawText).toBe('Napa Extra Batch: B-2401');
  });

  it('does not look anything up for a line with no usable name', async () => {
    const lookup = vi.fn(async () => []);
    await buildPrescriptionLines('1+1+1', lookup);

    expect(lookup).not.toHaveBeenCalled();
  });

  it('returns nothing for text that holds no lines at all', async () => {
    expect(await buildPrescriptionLines('   ', async () => [])).toEqual([]);
  });
});
