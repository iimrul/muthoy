import { describe, expect, it } from 'vitest';
import { BatchExpiryMismatchError, PurchaseNotVoidableError, SupplierPayableOutstandingError } from '../db/errors';
import { catalog, type CatalogKey } from './catalog';
import { countLabel, fillTemplate, localizeValidationMessage, paymentMethodLabel, returnReasonLabel, userFacingError } from './display';

const bn = (key: CatalogKey) => catalog.bn[key];

describe('B3 user-facing localization', () => {
  it('localizes methods and typed actionable errors', () => {
    expect(paymentMethodLabel('cash', bn)).toBe('ক্যাশ');
    expect(paymentMethodLabel('nagad', bn)).toBe('নগদ');
    expect(paymentMethodLabel('cash', bn)).not.toBe(paymentMethodLabel('nagad', bn));
    expect(userFacingError(new SupplierPayableOutstandingError(100, 0), 'supplierArchiveFailedLabel', bn))
      .toBe(catalog.bn.supplierOutstandingArchiveErrorLabel);
    expect(userFacingError(new PurchaseNotVoidableError('has_payment'), 'voidFailedLabel', bn))
      .toBe(catalog.bn.purchaseHasPaymentErrorLabel);
    expect(userFacingError(new BatchExpiryMismatchError('medicine', 'batch'), 'purchaseSaveFailedLabel', bn))
      .toBe(catalog.bn.batchExpiryMismatchErrorLabel);
  });

  it('never exposes an unknown raw database message', () => {
    expect(userFacingError(new Error('internal operation count mismatch'), 'purchaseSaveFailedLabel', bn))
      .toBe(catalog.bn.purchaseSaveFailedLabel);
    expect(localizeValidationMessage('Invalid input: expected number, received NaN', bn))
      .toBe(catalog.bn.invalidFieldValueLabel);
  });

  it('localizes inventory archive failures instead of exposing DB copy', () => {
    expect(
      userFacingError(
        new Error('Batch must have zero stock, no oversell, and no active promotion'),
        'medicineArchiveFailedLabel',
        bn,
      ),
    ).toBe(catalog.bn.medicineArchiveRequirementsLabel);
    expect(
      userFacingError(new Error('internal sqlite failure'), 'medicineArchiveFailedLabel', bn),
    ).toBe(catalog.bn.medicineArchiveFailedLabel);
  });

  it('selects locale-catalog singular and plural count labels', () => {
    expect(countLabel(1, 'itemCountLabel', 'itemsCountLabel', bn)).toBe(catalog.bn.itemCountLabel);
    expect(countLabel(2, 'itemCountLabel', 'itemsCountLabel', (key) => catalog.en[key]))
      .toBe(catalog.en.itemsCountLabel);
  });

  it('localizes every purchase-return preset, including Other', () => {
    expect(returnReasonLabel('other', bn)).toBe(catalog.bn.reasonOtherLabel);
    expect(returnReasonLabel('supplier_recall', (key) => catalog.en[key])).toBe(catalog.en.reasonSupplierRecallLabel);
    expect(returnReasonLabel('free-form note', bn)).toBe('free-form note');
  });
});

describe('auth parity localization', () => {
  it('localizes every @muthoy/validation auth message instead of showing English', () => {
    for (const message of [
      'Enter a valid Bangladeshi mobile number (e.g. 01712345678)',
      'Shop name is too short',
      'PIN must be exactly 4 digits',
      'Verification code must be exactly 6 digits',
      'PINs do not match',
    ]) {
      const localized = localizeValidationMessage(message, bn);
      expect(localized).not.toBe(catalog.bn.invalidFieldValueLabel);
      expect(localized).not.toBe(message);
    }
  });

  it('fills named slots and leaves a missing one visible', () => {
    expect(fillTemplate('{count} of {total} digits entered', { count: 2, total: 4 })).toBe('2 of 4 digits entered');
    expect(fillTemplate(catalog.bn.pinProgressA11y, { count: '২', total: '৪' })).toBe('৪টির মধ্যে ২টি সংখ্যা দেওয়া হয়েছে');
    expect(fillTemplate('Step {step}', {})).toBe('Step {step}');
  });

  it('keeps PIN as PIN in Bangla (locked decision)', () => {
    expect(Object.values(catalog.bn).some((value) => value.includes('পিন'))).toBe(false);
  });
});
