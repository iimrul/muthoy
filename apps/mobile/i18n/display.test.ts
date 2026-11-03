import { describe, expect, it } from 'vitest';
import { BatchExpiryMismatchError, PurchaseNotVoidableError, SupplierPayableOutstandingError } from '../db/errors';
import { catalog, type CatalogKey } from './catalog';
import { countLabel, fillTemplate, localizeValidationMessage, paymentMethodLabel, returnReasonLabel, userFacingError, userFacingErrorKeepingDetail } from './display';

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

  it('tells a blocked owner the plan is the reason, and keeps the two plan refusals apart', () => {
    // Shape-based on purpose: db/commercial.ts cannot be imported here without
    // a SQLite harness. The real class is pinned against this mapping in
    // db/b2-restock.sqlite.test.ts, which constructs it through a genuine
    // refusal; these two tests only pass together.
    const planError = (feature: string) =>
      Object.assign(new Error('Upgrade to Pro or Ultra to use this feature.'), {
        name: 'PlanAccessError',
        feature,
      });

    expect(userFacingError(planError('supplier_invoices'), 'medicineAddFailedLabel', bn))
      .toBe(catalog.bn.planNotCoveredLabel);
    // The generic fallback is what a device actually showed on 2026-11-02.
    expect(userFacingError(planError('supplier_invoices'), 'medicineAddFailedLabel', bn))
      .not.toBe(catalog.bn.medicineAddFailedLabel);
    // A seat limit is not a locked feature, so it must not borrow that wording.
    expect(userFacingError(planError('staff_limit'), 'medicineAddFailedLabel', bn))
      .toBe(catalog.bn.planStaffLimitReachedLabel);
    expect(userFacingError(planError('staff_limit'), 'medicineAddFailedLabel', bn))
      .not.toBe(userFacingError(planError('expenses'), 'medicineAddFailedLabel', bn));
    // Never leak the raw English sentence the Error carries.
    expect(userFacingError(planError('export'), 'medicineAddFailedLabel', bn))
      .not.toContain('Upgrade to Pro or Ultra');

    // `commercial_write` is also thrown for an archived or inactive shop
    // (db/commercial.ts:305), not only for the shop-count limit (:312). An
    // owner cannot upgrade their way out of an archived shop, so this must not
    // reuse the upgrade wording -- the first version of this fix did.
    const shopWrite = userFacingError(planError('commercial_write'), 'medicineAddFailedLabel', bn);
    expect(shopWrite).toBe(catalog.bn.planShopWriteBlockedLabel);
    expect(shopWrite).not.toBe(catalog.bn.planNotCoveredLabel);
    expect(shopWrite).not.toBe(catalog.bn.planStaffLimitReachedLabel);
  });

  it('never tells a blocked owner to buy a plan they may already own', () => {
    // The hardest case is not a Free shop, it is a PAYING one. A paid, active
    // Ultra shop that has been offline past the 30-day verification ceiling
    // resolves to effectiveTier 'free' (domain/entitlements.ts:145) while
    // commercialTier stays 'ultra', and a device holding no cached snapshot at
    // all is treated the same way by requirePremiumFeature's `!entitlement`
    // arm (db/commercial.ts:241) and by the fail-closed readMultiShopContext
    // (:249). All of them throw the SAME PlanAccessError these labels render.
    // For that owner "upgrade" is false twice over -- already paid, and Ultra
    // is the top tier -- so reconnecting, not paying, is the remedy, and both
    // labels have to say so. The first version of this fix did not.
    for (const key of ['planNotCoveredLabel', 'planStaffLimitReachedLabel'] as const) {
      expect(catalog.en[key], `${key} (en) must not imply paying is the only remedy`)
        .toMatch(/connect to the internet/i);
      expect(catalog.bn[key], `${key} (bn) must not imply paying is the only remedy`)
        .toContain('ইন্টারনেটে');
    }
  });

  it('keeps a plan refusal translated even when the fallback IS a plan key', () => {
    // The first version of userFacingErrorKeepingDetail decided "the mapper
    // did not know this" by comparing its answer to t(fallback). Pass a plan
    // key as the fallback and that comparison is true for a PlanAccessError,
    // so the owner got the error's own English -- the exact leak the helper
    // exists to prevent. Mapping status is now returned, not inferred.
    const planError = Object.assign(
      new Error('Upgrade to Pro or Ultra to use this feature.'),
      { name: 'PlanAccessError', feature: 'export' },
    );
    const shown = userFacingErrorKeepingDetail(planError, 'planNotCoveredLabel', bn);
    expect(shown).toBe(catalog.bn.planNotCoveredLabel);
    expect(shown).not.toContain('Upgrade to Pro or Ultra');
  });

  it('keeps an unmapped failure verbatim, and falls back when it has nothing to say', () => {
    // reports-final-fixes.test.tsx pins that a real failure reaches the user.
    expect(userFacingErrorKeepingDetail(new Error('disk full'), 'exportFailedLabel', bn))
      .toBe('disk full');
    // An empty message is not detail; it must not blank the dialog.
    expect(userFacingErrorKeepingDetail(new Error(''), 'exportFailedLabel', bn))
      .toBe(catalog.bn.exportFailedLabel);
    // A non-Error must never have `.message` read off it.
    expect(userFacingErrorKeepingDetail('not an error', 'exportFailedLabel', bn))
      .toBe(catalog.bn.exportFailedLabel);
  });

  it('maps the manager Cashier-preset restriction instead of dropping it', () => {
    // db/staff.ts:304 throws a plain Error whose sentence is genuinely useful.
    // Collapsing the Add Staff catch into one mapper call would have made it
    // generic, so it is mapped by message rather than lost.
    expect(userFacingError(
      new Error('Managers may add Cashiers with the Cashier preset only'),
      'staffAddFailedLabel', bn,
    )).toBe(catalog.bn.managerCashierPresetOnlyLabel);
  });

  it('never exposes an unknown raw database message', () => {
    expect(userFacingError(new Error('internal operation count mismatch'), 'purchaseSaveFailedLabel', bn))
      .toBe(catalog.bn.purchaseSaveFailedLabel);
    expect(localizeValidationMessage('Invalid input: expected number, received NaN', bn))
      .toBe(catalog.bn.invalidFieldValueLabel);
  });

  it('maps the staff duplicate errors by name instead of leaking their English', () => {
    // db/errors.ts throws these with English sentences, and AddStaffModal used
    // to render `cause.message` verbatim into a Bengali UI. Mapping them by
    // NAME is what lets that whole catch collapse into one userFacingError
    // call that also covers the plan refusal.
    const named = (name: string, message: string) =>
      Object.assign(new Error(message), { name });

    expect(userFacingError(named('DuplicatePhoneError', 'That phone is taken.'), 'staffAddFailedLabel', bn))
      .toBe(catalog.bn.duplicatePhoneErrorLabel);
    expect(userFacingError(
      named('DuplicatePinError', 'That PIN is already used by someone at this shop. Choose another.'),
      'staffAddFailedLabel', bn,
    )).toBe(catalog.bn.duplicatePinErrorLabel);

    // The raw English must not survive into the Bengali string.
    expect(userFacingError(named('DuplicatePinError', 'x'), 'staffAddFailedLabel', bn))
      .not.toContain('already used by someone at this shop');
    // And an unmapped staff failure still falls back rather than leaking.
    expect(userFacingError(new Error('sqlite disk image is malformed'), 'staffAddFailedLabel', bn))
      .toBe(catalog.bn.staffAddFailedLabel);
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
