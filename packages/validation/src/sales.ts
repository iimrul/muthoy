import { z } from 'zod';
import { bdPhoneSchema } from './auth';

// Checkout inputs are entered in taka at the UI boundary; the screen converts
// validated values to branded integer Paisa before calling db/sales.ts.
export const tenderedAmountSchema = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,2})?$/, 'Enter a valid amount with at most 2 decimal places')
  .transform(Number);

export const checkoutCustomerSchema = z.object({
  name: z.string().trim().min(1, 'Customer name is required'),
  phone: z
    .union([bdPhoneSchema, z.literal('')])
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
});

export type CheckoutCustomer = z.output<typeof checkoutCustomerSchema>;
