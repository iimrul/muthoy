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

describe('field errors reach the user in their own language', () => {
  it('turns a DuplicateBatchError NAME into the specific message, not the generic one', () => {
    // app/inventory/batches.tsx puts `err.name` into react-hook-form, and
    // FormField runs every field error through localizeValidationMessage.
    //
    // A previous pass put ALREADY-TRANSLATED text in instead. The lookup missed
    // it and returned invalidFieldValueLabel, so adding a translation made the
    // message WORSE: the owner saw "invalid value" where they had seen which
    // batch number clashed. The name is a stable code; the sentence is not.
    expect(localizeValidationMessage('DuplicateBatchError', bn))
      .toBe(catalog.bn.duplicateBatchErrorLabel);
    expect(localizeValidationMessage('DuplicateBatchError', bn))
      .not.toBe(catalog.bn.invalidFieldValueLabel);
  });

  it('still localizes the zod messages it always did', () => {
    // The name lookup is additive: it must not shadow the raw-message map.
    expect(localizeValidationMessage('Batch number is required', bn))
      .toBe(catalog.bn.batchRequiredLabel);
    expect(localizeValidationMessage('Quantity must be at least 1', bn))
      .toBe(catalog.bn.quantityMinimumLabel);
  });

  it('falls back rather than echoing an unmapped error name', () => {
    expect(localizeValidationMessage('SomeUnmappedError', bn))
      .toBe(catalog.bn.invalidFieldValueLabel);
  });

  it('userFacingError and localizeValidationMessage agree, because they share one map', () => {
    // The two surfaces (dialog and field error) must not drift apart. Both read
    // ERROR_NAME_KEYS, and this is what would fail if someone re-introduced a
    // second map.
    const error = new BatchExpiryMismatchError('medicine', 'batch');
    expect(userFacingError(error, 'invalidFieldValueLabel', bn))
      .toBe(localizeValidationMessage(error.name, bn));
  });
});

describe('both batch field errors render specifically, not generically', () => {
  it('maps BatchExpiryMismatchError by name too', () => {
    // The purchase form sets this one on the expiryDate field. It was the
    // second site passing translated text into react-hook-form; the first fix
    // caught batches.tsx only.
    expect(localizeValidationMessage('BatchExpiryMismatchError', bn))
      .toBe(catalog.bn.batchExpiryMismatchErrorLabel);
    expect(localizeValidationMessage('BatchExpiryMismatchError', bn))
      .not.toBe(catalog.bn.invalidFieldValueLabel);
  });

  it('accepts a catalog key as a fallback code', () => {
    // purchase-create.tsx hands its own fallback key through when the thrown
    // value is not an Error at all.
    expect(localizeValidationMessage('purchaseSaveFailedLabel', bn))
      .toBe(catalog.bn.purchaseSaveFailedLabel);
  });

  it('the two batch errors are distinguishable to the user', () => {
    // If both collapsed to one message the field error would be useless: the
    // buyer could not tell a duplicate number from a clashing expiry date.
    expect(localizeValidationMessage('DuplicateBatchError', bn))
      .not.toBe(localizeValidationMessage('BatchExpiryMismatchError', bn));
  });
});

describe('inherited property names cannot leak through a lookup', () => {
  // `message` and `error.name` both originate outside this module, and both are
  // caller-assignable. A bare `table[name]` resolves 'toString' off
  // Object.prototype and hands a FUNCTION to t(), which would render
  // "function toString() { [native code] }" to a shopkeeper, or crash.
  const INHERITED = ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__'];

  it('localizeValidationMessage falls back for every inherited name', () => {
    for (const name of INHERITED) {
      expect(localizeValidationMessage(name, bn), `${name} must not resolve`)
        .toBe(catalog.bn.invalidFieldValueLabel);
    }
  });

  it('userFacingError falls back for an error named after a prototype member', () => {
    for (const name of INHERITED) {
      const error = new Error('whatever');
      error.name = name;
      expect(userFacingError(error, 'invalidFieldValueLabel', bn), `${name} must not resolve`)
        .toBe(catalog.bn.invalidFieldValueLabel);
    }
  });

  it('and a real mapping still resolves, so the guard is not just rejecting everything', () => {
    expect(localizeValidationMessage('DuplicateBatchError', bn))
      .toBe(catalog.bn.duplicateBatchErrorLabel);
  });
});
