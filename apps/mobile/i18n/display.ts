import type { CatalogKey } from './catalog';

type Translate = (key: CatalogKey) => string;

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
  return t(labels[method] ?? 'paymentMethodOtherLabel');
}

export function purchaseSourceLabel(source: string, t: Translate): string {
  return source === 'ocr' ? t('sourceOcrLabel') : t('sourceManualLabel');
}

export function purchaseTermsLabel(terms: string, t: Translate): string {
  return terms === 'cod' ? t('codLabel') : t('onCreditLabel');
}

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
  };
  const key = labels[message];
  return t(key ?? 'invalidFieldValueLabel');
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

  const byName: Record<string, CatalogKey> = {
    NotAuthorizedError: 'accessDenied',
    DayClosedError: 'dayClosedErrorLabel',
    StaleSessionError: 'sessionChangedRetryLabel',
    SupplierPayableOutstandingError: 'supplierOutstandingArchiveErrorLabel',
    DuplicateBatchError: 'duplicateBatchErrorLabel',
    BatchExpiryMismatchError: 'batchExpiryMismatchErrorLabel',
  };
  const named = byName[error.name];
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
  };
  return t(byMessage[error.message] ?? fallback);
}
