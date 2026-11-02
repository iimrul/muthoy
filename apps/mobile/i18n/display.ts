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
  // H-7 staff creation. Mapped by NAME so AddStaffModal can route its whole
  // catch through userFacingError: db/errors.ts throws these with English
  // sentences, which the modal used to render verbatim into a Bengali UI.
  DuplicatePhoneError: 'duplicatePhoneErrorLabel',
  DuplicatePinError: 'duplicatePinErrorLabel',
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

/**
 * `userFacingError`, except that an error the mapper does NOT recognise keeps
 * its own message instead of collapsing into the fallback.
 *
 * The export and share screens deliberately surface a real operational failure
 * verbatim -- `tests/reports-final-fixes.test.tsx` pins that a rejected export
 * shows "disk full" and a refused share shows "Owner access only", and that a
 * failure is never hidden behind fake progress. Routing those screens through
 * the plain mapper threw that diagnostic away.
 *
 * A PLAN refusal is still translated, because PlanAccessError IS mapped: the
 * mapper answers with a plan label, which is not the fallback. So this keeps
 * the detail the tests want while refusing to leak "Upgrade to Pro or Ultra to
 * use this feature." into a Bengali UI.
 *
 * The residual gap is deliberate and recorded: an unmapped operational error
 * still reaches the owner in English. Translating those means mapping each one
 * by name, which is a product decision about how much detail to keep, not a
 * mechanical fix.
 */
export function userFacingErrorKeepingDetail(
  error: unknown,
  fallback: CatalogKey,
  t: Translate,
): string {
  const mapped = userFacingError(error, fallback, t);
  if (mapped !== t(fallback)) return mapped;
  return error instanceof Error && error.message ? error.message : mapped;
}

export function userFacingError(error: unknown, fallback: CatalogKey, t: Translate): string {
  if (!(error instanceof Error)) return t(fallback);

  // Own-property check: `error.name` is caller-assignable, so an error named
  // 'constructor' would otherwise resolve a function off Object.prototype.
  const named = ownKey(ERROR_NAME_KEYS, error.name);
  if (named) return t(named);

  // Read the discriminant off the error rather than mapping the name in
  // ERROR_NAME_KEYS: PlanAccessError carries several unrelated meanings -- a
  // premium feature the plan does not include, a staff seat limit, a blocked
  // shop write -- and a flat name mapping would collapse them into one wrong
  // sentence. Same shape as PurchaseNotVoidableError below. Verified on a
  // device 2026-11-02: a Free owner restocking got `medicineAddFailedLabel`
  // ("Could not save the medicine. Please try again."), which invites a retry
  // that can never succeed and never mentions the plan -- while the Home
  // screen was simultaneously showing that same shop a trial-expired Upgrade
  // banner.
  //
  // NONE of these branches may instruct an unconditional purchase, and that is
  // the harder constraint. `effectiveTier` degrades to 'free' while
  // `commercialTier` stays paid whenever the snapshot cannot be trusted:
  // offline past the 30-day verification ceiling (domain/entitlements.ts:145,
  // reason `verification_stale`), an invalid snapshot (:139), or no cached
  // snapshot at all -- which requirePremiumFeature's `!entitlement` arm
  // (db/commercial.ts:241) and the deliberately fail-closed
  // readMultiShopContext (:249) both treat as not entitled. An active, paid
  // Ultra shop then throws exactly these errors, and telling that owner to
  // upgrade is false twice over: they have already paid, and Ultra is the top
  // tier, so there is nothing to buy. Reconnecting is what restores access.
  // usePlan.ts:29 already models this as a distinct `unverified` reason, and
  // TrialBanner.tsx:50 warns in as many words that conflating unverified with
  // Free is a mistake this project has already made once on real devices.
  //
  // PlanAccessError carries only `feature`, never the reason, so the mapper
  // cannot separate "your plan excludes this" from "we cannot confirm your
  // plan" -- the wording has to hold for both until the error carries the
  // reason too. Doing that means editing db/commercial.ts, which CLAUDE.md
  // rule 10 gates behind an approved plan; it is recorded as a founder item.
  if (error.name === 'PlanAccessError') {
    const feature = (error as Error & { feature?: string }).feature;
    // A seat limit is not a locked feature. Its limit is read off
    // `effectiveTier` too (db/commercial.ts:321), so it inherits the same
    // degradation and must not promise an upgrade either.
    if (feature === 'staff_limit') return t('planStaffLimitReachedLabel');
    // `commercial_write` is thrown for an archived or inactive shop
    // (db/commercial.ts:305) as well as for the plan's shop-count limit
    // (db/commercial.ts:312). Upgrading corrects only the second, so this
    // branch must not promise it -- an owner cannot buy their way out of an
    // archived shop. Neutral wording covers both.
    if (feature === 'commercial_write') return t('planShopWriteBlockedLabel');
    return t('planNotCoveredLabel');
  }

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
