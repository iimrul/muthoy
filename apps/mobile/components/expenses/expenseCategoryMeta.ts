import type { ComponentProps } from 'react';
import type Feather from '@expo/vector-icons/Feather';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@muthoy/validation';
import type { CatalogKey } from '../../i18n/catalog';

// B3 Group 3 — category → icon/label lookup, with a safe fallback for any
// value outside EXPENSE_CATEGORIES. Migration 0018 backfills every existing
// row to the 5-category set (D-4), but a device syncing on a stale
// pre-migration build can still produce old-taxonomy payloads. Sync now
// canonicalizes them and both databases reject unknown final values; this
// fallback remains for a pre-enforcement/corrupted local row.

type FeatherIconName = ComponentProps<typeof Feather>['name'];

const CATEGORY_ICONS: Record<ExpenseCategory, FeatherIconName> = {
  rent: 'home',
  salary: 'briefcase',
  utilities: 'zap',
  // Feather has no "car" glyph; "truck" is the closest conveyance icon.
  conveyance: 'truck',
  other: 'more-horizontal',
};

const CATEGORY_LABEL_KEYS: Record<ExpenseCategory, CatalogKey> = {
  rent: 'categoryRent',
  salary: 'categorySalary',
  utilities: 'categoryUtilities',
  conveyance: 'categoryConveyance',
  other: 'categoryOther',
};

const FALLBACK_ICON: FeatherIconName = 'more-horizontal';

export function isKnownExpenseCategory(category: string): category is ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(category);
}

/** Icon for a category value that may be legacy/unrecognized. */
export function expenseCategoryIcon(category: string): FeatherIconName {
  return isKnownExpenseCategory(category) ? CATEGORY_ICONS[category] : FALLBACK_ICON;
}

/** Catalog key for a known category, or null for a legacy/unrecognized one —
 * callers fall back to rendering the raw string in that case. */
export function expenseCategoryLabelKey(category: string): CatalogKey | null {
  return isKnownExpenseCategory(category) ? CATEGORY_LABEL_KEYS[category] : null;
}
