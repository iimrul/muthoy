import { describe, expect, it } from 'vitest';
import { BatchExpiryMismatchError, PurchaseNotVoidableError, SupplierPayableOutstandingError } from '../db/errors';
import { catalog, type CatalogKey } from './catalog';
import { countLabel, localizeValidationMessage, paymentMethodLabel, userFacingError } from './display';

const bn = (key: CatalogKey) => catalog.bn[key];

describe('B3 user-facing localization', () => {
  it('localizes methods and typed actionable errors', () => {
    expect(paymentMethodLabel('cash', bn)).toBe('ক্যাশ');
    expect(paymentMethodLabel('nagad', bn)).toBe('নগদ');
    expect(paymentMethodLabel('cash', bn)).not.toBe(paymentMethodLabel('nagad', bn));
    expect(userFacingError(new SupplierPayableOutstandingError(100), 'supplierArchiveFailedLabel', bn))
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

  it('selects locale-catalog singular and plural count labels', () => {
    expect(countLabel(1, 'itemCountLabel', 'itemsCountLabel', bn)).toBe(catalog.bn.itemCountLabel);
    expect(countLabel(2, 'itemCountLabel', 'itemsCountLabel', (key) => catalog.en[key]))
      .toBe(catalog.en.itemsCountLabel);
  });
});
