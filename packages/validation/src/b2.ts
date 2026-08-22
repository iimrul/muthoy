import { z } from 'zod';

export const basisPointsSchema = z.number().int().min(0).max(10_000);
export const expirySettingsSchema = z.object({
  nearDays: z.number().int().min(0),
  farDays: z.number().int().min(0),
}).refine(({ nearDays, farDays }) => nearDays < farDays, { message: 'Near expiry days must be less than far expiry days' });

export const refundReasonSchema = z.string().trim().min(1, 'Refund reason is required');

const exactMoneyText = z.string().trim().regex(/^\d+(?:\.\d{1,2})?$/, 'Use non-negative taka with at most 2 decimals');
export const inventoryCsvRowSchema = z.object({
  name: z.string().trim().min(1),
  generic: z.string().trim().min(1),
  manufacturer: z.string().trim().min(1),
  batch_no: z.string().trim().min(1),
  stock: z.coerce.number().int().min(0),
  purchase_price: exactMoneyText,
  sale_price: exactMoneyText,
  type: z.string().trim().optional(),
  expiry: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  threshold_override: z.coerce.number().int().min(0).optional(),
  barcode: z.string().trim().optional(),
  production_unit: z.string().trim().min(1).default('piece'),
});
