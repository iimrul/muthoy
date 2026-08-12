import { z } from 'zod';

// Volume 0 Day 8: Add Medicine (name, generic, manufacturer, strength,
// category, unit_of_measure, requires_prescription, threshold, barcode) plus
// a first batch (batch_no, expiry, qty, purchase/sale price). The same batch
// shape is reused standalone by Add Batch (apps/mobile/app/inventory/batches.tsx)
// for adding a batch to an already-existing medicine — the one path that can
// actually hit the UNIQUE(shop_id, medicine_id, batch_no) constraint.
//
// Prices here are TAKA (a plain form-input number), never Paisa — the
// screen converts via @muthoy/types's fromTaka() at the db/ write boundary.

// An empty string from a blank TextInput means "no expiry recorded" — the
// same as omitting the field — not a malformed date. Uses refine (tolerant
// of '') + transform (maps '' -> undefined) rather than z.preprocess, which
// would type the field's form-input shape as `unknown` instead of
// `string | undefined` and break RHF's Resolver typing (see the Input/Output
// split note below).
const isoDateSchema = z
  .string()
  .refine((value) => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value), 'Enter a valid date (YYYY-MM-DD)')
  .refine((value) => {
    if (value === '') {
      return true;
    }
    const today = new Date(new Date().toDateString());
    return new Date(`${value}T00:00:00`) >= today;
  }, 'Expiry date must be today or later')
  .transform((value) => (value === '' ? undefined : value))
  .optional();

export const batchFieldsSchema = z.object({
  batchNo: z.string().trim().min(1, 'Batch number is required'),
  // db/schema.ts's batches.expiry_date is nullable — omitting it here is
  // valid and sorts the batch last in FEFO (domain/fefo.ts).
  expiryDate: isoDateSchema,
  quantity: z.number().int('Quantity must be a whole number').min(0, 'Quantity cannot be negative'),
  purchasePrice: z.number().min(0, 'Purchase price cannot be negative'),
  salePrice: z.number().min(0, 'Sale price cannot be negative'),
});

export const addBatchSchema = batchFieldsSchema;

export const addMedicineSchema = z.object({
  name: z.string().trim().min(2, 'Medicine name is too short'),
  generic: z.string().trim().optional(),
  manufacturer: z.string().trim().optional(),
  strength: z.string().trim().optional(),
  category: z.string().trim().optional(),
  unitOfMeasure: z.string().trim().min(1, 'Unit of measure is required').default('piece'),
  requiresPrescription: z.boolean(),
  threshold: z.number().int('Threshold must be a whole number').min(0, 'Threshold cannot be negative').default(20),
  barcode: z.string().trim().optional(),
  firstBatch: batchFieldsSchema,
});

// zodResolver v5 (zod v4) types the resolver as
// Resolver<z.input<Schema>, Context, z.output<Schema>> — the raw,
// pre-default/pre-transform shape RHF's Controller fields actually hold vs.
// the parsed shape handleSubmit's callback receives. unitOfMeasure/threshold
// use .default(), so those two types genuinely differ; export both rather
// than a single z.infer (which is z.output and would type-mismatch useForm's
// TFieldValues).
export type BatchFieldsInput = z.input<typeof batchFieldsSchema>;
export type BatchFieldsOutput = z.output<typeof batchFieldsSchema>;

export type AddBatchInput = z.input<typeof addBatchSchema>;
export type AddBatchOutput = z.output<typeof addBatchSchema>;

export type AddMedicineInput = z.input<typeof addMedicineSchema>;
export type AddMedicineOutput = z.output<typeof addMedicineSchema>;
