import { z } from 'zod';

const optionalText = z.string().trim().transform((value) => (value === '' ? undefined : value)).optional();

export const customerFieldsSchema = z.object({
  name: z.string().trim().min(2, 'Customer name is too short'),
  phone: optionalText,
  address: optionalText,
  notes: optionalText,
});

export type CustomerFieldsInput = z.input<typeof customerFieldsSchema>;
export type CustomerFieldsOutput = z.output<typeof customerFieldsSchema>;
