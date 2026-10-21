import { catalog, type CatalogKey } from './catalog';

type Translate = (key: CatalogKey) => string;

/**
 * An own-property lookup in a key table.
 *
 * Every name passed to these helpers originates outside this module — a zod
 * message, a thrown error's `name`, a caller's fallback code — so a bare
 * `table[name]` would resolve `toString`, `constructor` or `valueOf` off
 * Object.prototype and return a function where a catalog key is expected.
 */
export function ownKey(
  table: Readonly<Record<string, CatalogKey>>,
  name: string,
): CatalogKey | undefined {
  return Object.prototype.hasOwnProperty.call(table, name)
    ? table[name]
    : undefined;
}

export function paymentMethodLabel(method: string, t: Translate): string {
  const labels: Record<string, CatalogKey> = {
    cash: 'paymentMethodCashLabel',
    bkash: 'paymentMethodBkashLabel',
    nagad: 'paymentMethodNagadLabel',
    rocket: 'paymentMethodRocketLabel',
    card: 'paymentMethodCardLabel',
    bank: 'paymentMethodBankLabel',
    other: 'paymentMethodOtherLabel',
  };
  return t(ownKey(labels, method) ?? 'paymentMethodOtherLabel');
}

export function purchaseSourceLabel(source: string, t: Translate): string {
  return source === 'ocr' ? t('sourceOcrLabel') : t('sourceManualLabel');
}

export function purchaseTermsLabel(terms: string, t: Translate): string {
  return terms === 'cod' ? t('codLabel') : t('onCreditLabel');
}

// B3 Group 7: maps a purchase-return reason to its translated preset label.
// A reason that isn't one of the seven preset slugs is the free-text note
// entered under "Other" — rendered literally, never translated, exactly like
// a customer-entered name or note elsewhere in the app.
const RETURN_REASON_SLUGS: Record<string, CatalogKey> = {
  expired: 'reasonExpiredLabel',
  near_expiry: 'reasonNearExpiryLabel',
  slow_moving: 'reasonSlowMovingLabel',
  damaged: 'reasonDamagedLabel',
  wrong_item: 'reasonWrongItemLabel',
  supplier_recall: 'reasonSupplierRecallLabel',
  other: 'reasonOtherLabel',
};
export function returnReasonLabel(reason: string, t: Translate): string {
  const key = ownKey(RETURN_REASON_SLUGS, reason);
  return key ? t(key) : reason;
}
export function purchaseLineReturnStatusLabel(
  status: 'received' | 'partially_returned' | 'fully_returned',
  t: Translate,
): string {
  if (status === 'partially_returned') return t('partiallyReturnedLabel');
  if (status === 'fully_returned') return t('fullyReturnedLabel');
  return t('receivedStatusLabel');
}

/**
 * Error class name -> catalog key. The single map for turning a thrown error
 * into text a shopkeeper can read.
 *
 * Keyed on `name` because the messages in db/errors.ts interpolate (a batch
 * number, a date) and so cannot be map keys, while a class name is stable. An
 * unlisted error falls back to the caller's own key rather than leaking the
 * original English message.
 *
 * Module-level and shared on purpose: `userFacingError` (dialogs and toasts)
 * and `localizeValidationMessage` (react-hook-form field errors) both read it,
 * so a mapping is declared once instead of diverging between the two surfaces.
 */
export const ERROR_NAME_KEYS: Record<string, CatalogKey> = {
  NotAuthorizedError: 'accessDenied',
  DayClosedError: 'dayClosedErrorLabel',
  StaleSessionError: 'sessionChangedRetryLabel',
  SupplierPayableOutstandingError: 'supplierOutstandingArchiveErrorLabel',
  DuplicateBatchError: 'duplicateBatchErrorLabel',
  BatchExpiryMismatchError: 'batchExpiryMismatchErrorLabel',
  PurchaseLineNotReceivedError: 'lineNotReceivedForReturnLabel',
  PurchaseReturnExceedsAvailableError: 'quantityExceedsAvailableLabel',
  PurchaseReturnReasonRequiredError: 'reasonRequiredLabel',
  // H-6 conflict resolution.
  ConflictNotFoundError: 'syncConflictNotFound',
  ConflictGroupedOperationError: 'syncConflictGroupedBlocked',
  CommercialReadOnlyError: 'syncConflictPlanReadOnly',
  DeviceAccessRevokedError: 'syncConflictDeviceRevoked',
};

export function localizeValidationMessage(message: string | undefined, t: Translate): string | undefined {
  if (!message) return undefined;
  const labels: Record<string, CatalogKey> = {
    'Customer name is too short': 'customerNameTooShortLabel',
    'Supplier name is too short': 'supplierNameTooShortLabel',
    'Enter a valid email address': 'invalidEmailLabel',
    'Batch number is required': 'batchRequiredLabel',
    'Enter a valid date (YYYY-MM-DD)': 'invalidDateLabel',
    'Expiry date must be today or later': 'expiryTodayOrLaterLabel',
    'Quantity must be a whole number': 'quantityWholeLabel',
    'Quantity must be at least 1': 'quantityMinimumLabel',
    'Purchase price cannot be negative': 'purchasePriceNegativeLabel',
    'Sale price cannot be negative': 'salePriceNegativeLabel',
    // @muthoy/validation's auth schemas (packages/validation/src/auth.ts).
    'Enter a valid Bangladeshi mobile number (e.g. 01712345678)': 'authPhoneInvalid',
    'Shop name is too short': 'authShopNameTooShort',
    'PIN must be exactly 4 digits': 'authPinFourDigits',
    'Verification code must be exactly 6 digits': 'authOtpSixDigits',
    'PINs do not match': 'authPinsDoNotMatch',
  };
  // Three tiers, in order: a raw zod/db sentence, an error CLASS NAME used as a
  // stable code (db/errors.ts messages interpolate a batch number or a date, so
  // they cannot be map keys, but the name can), then a catalog key handed
  // straight through — which is what the purchase form does when the thrown
  // value is not an Error at all. ERROR_NAME_KEYS is the same map
  // `userFacingError` reads, so dialogs and field errors cannot drift apart.
  //
  // Every lookup is an OWN-property check. `message` comes from a thrown value,
  // so a plain `labels[message]` resolves 'toString' or 'constructor' off
  // Object.prototype and hands a function to `t()` where a catalog key belongs.
  // Same reason fillTemplate below guards its slots.
  const key = ownKey(labels, message)
    ?? ownKey(ERROR_NAME_KEYS, message)
    ?? (Object.prototype.hasOwnProperty.call(catalog.en, message)
      ? (message as CatalogKey)
      : undefined);
  return t(key ?? 'invalidFieldValueLabel');
}

/**
 * Fills `{name}` slots in a catalog string. A slot with no value is left as
 * written, so a missing argument is visible rather than silently blank.
 */
export function fillTemplate(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (slot, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : slot,
  );
}

export function countLabel(
  count: number,
  singular: CatalogKey,
  plural: CatalogKey,
  t: Translate,
): string {
  return t(count === 1 ? singular : plural);
}

export function userFacingError(error: unknown, fallback: CatalogKey, t: Translate): string {
  if (!(error instanceof Error)) return t(fallback);

  // Own-property check: `error.name` is caller-assignable, so an error named
  // 'constructor' would otherwise resolve a function off Object.prototype.
  const named = ownKey(ERROR_NAME_KEYS, error.name);
  if (named) return t(named);

  if (error.name === 'PurchaseNotVoidableError') {
    const reason = (error as Error & { reason?: string }).reason;
    return t(reason === 'has_payment' ? 'purchaseHasPaymentErrorLabel' : 'purchaseHasStockErrorLabel');
  }

  const byMessage: Record<string, CatalogKey> = {
    'Customer does not belong to this shop': 'customerMissingLabel',
    'Collection amount exceeds outstanding balance': 'amountDueLabel',
    'A supplier with this name and phone already exists': 'duplicateSupplierErrorLabel',
    'Supplier does not belong to this shop': 'supplierMissingLabel',
    'Payment amount must be a positive whole number of paisa': 'enterValidAmountLabel',
    'Purchase does not belong to this shop': 'invoiceMissingLabel',
    'This purchase has been voided': 'purchaseVoidedErrorLabel',
    'This purchase was paid in full on delivery': 'codPaymentBlockedErrorLabel',
    'This purchase is already fully paid': 'purchaseFullyPaidErrorLabel',
    'Cannot create a purchase without line items': 'addLineItemFirstLabel',
    'This line has already been received': 'lineAlreadyReceivedErrorLabel',
    'Purchase line does not belong to this purchase': 'purchaseLineMissingErrorLabel',
    'Batch must have zero stock, no oversell, and no active promotion': 'medicineArchiveRequirementsLabel',
    'Medicine not found': 'medicineMissingLabel',
  };
  return t(ownKey(byMessage, error.message) ?? fallback);
}
