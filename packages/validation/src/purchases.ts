import { z } from 'zod';

const optionalText = z.string().trim().transform((value) => (value === '' ? undefined : value)).optional();

export const supplierFieldsSchema = z.object({
  name: z.string().trim().min(2, 'Supplier name is too short'),
  phone: optionalText,
  address: optionalText,
  email: z.union([z.email('Enter a valid email address'), z.literal('')]).transform((value) => value || undefined).optional(),
  contactPerson: optionalText,
});

function isRealIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

const requiredExpirySchema = z.string().trim()
  .refine(isRealIsoDate, 'Enter a valid date (YYYY-MM-DD)')
  .refine((value) => isRealIsoDate(value) && new Date(`${value}T00:00:00`) >= new Date(new Date().toDateString()), 'Expiry date must be today or later');

export const purchaseLineItemFieldsSchema = z.object({
  batchNo: z.string().trim().min(1, 'Batch number is required'),
  expiryDate: requiredExpirySchema,
  quantity: z.number().int('Quantity must be a whole number').min(1, 'Quantity must be at least 1'),
  purchasePrice: z.number().min(0, 'Purchase price cannot be negative'),
  salePrice: z.number().min(0, 'Sale price cannot be negative'),
});

export type SupplierFieldsInput = z.input<typeof supplierFieldsSchema>;
export type SupplierFieldsOutput = z.output<typeof supplierFieldsSchema>;
export type PurchaseLineItemFieldsInput = z.input<typeof purchaseLineItemFieldsSchema>;
export type PurchaseLineItemFieldsOutput = z.output<typeof purchaseLineItemFieldsSchema>;
