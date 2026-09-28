import { describe, expect, it } from 'vitest';
import { bdPhoneSchema, normalizeBdPhone, normalizeBdPhoneInput } from '@muthoy/validation';
import {
  authPhoneForSubmit,
  displayDigitsFromValue,
  phoneFieldEntryAfterChange,
  phoneFieldEntryFromInput,
  phoneFieldValueFrom,
  formatPhoneForDisplay,
  type PhoneFieldEntry,
} from './phoneInput';

/**
 * Types `keys` one at a time the way a TextInput does: each change is the
 * field's current text plus one key. A refused key leaves the field as it was.
 */
function typeKeys(keys: string): { shown: string; reported: string; steps: (PhoneFieldEntry | null)[] } {
  let shown = '';
  let reported = '';
  const steps: (PhoneFieldEntry | null)[] = [];
  for (const key of keys) {
    const entry = phoneFieldEntryAfterChange(shown, shown + key);
    steps.push(entry);
    if (entry !== null) {
      shown = entry.shown;
      reported = entry.reported;
    }
  }
  return { shown, reported, steps };
}

const CANONICAL = '+8801712345678';

describe('PhoneField input rules', () => {
  it.each([
    '01712345678',
    '1712345678',
    '8801712345678',
    '+8801712345678',
    '017-1234 5678',
    '+880 1712-345678',
    '+88 01712345678',
    '(017) 1234-5678',
  ])('reports %j in the canonical form the server and OTP provider expect', (typed) => {
    const { reported } = phoneFieldEntryFromInput(typed);
    expect(reported).toBe(CANONICAL);
    // The same string packages/validation normalises to, and a valid one.
    expect(normalizeBdPhone(reported)).toBe(CANONICAL);
    expect(bdPhoneSchema.safeParse(reported).success).toBe(true);
  });

  it('shows the digits after its fixed +880, dropping only separators', () => {
    expect(phoneFieldEntryFromInput('01712345678').shown).toBe('01712345678');
    expect(phoneFieldEntryFromInput('017-1234 5678').shown).toBe('01712345678');
    expect(phoneFieldEntryFromInput('+880 1712-345678').shown).toBe('1712345678');
    expect(phoneFieldEntryFromInput('8801712345678').shown).toBe('1712345678');
  });

  it('emits nothing for an empty field, so a required-field error is not a phantom number', () => {
    expect(phoneFieldEntryFromInput('')).toEqual({ shown: '', reported: '' });
  });

  it('leaves an incomplete number for the schema to reject', () => {
    expect(phoneFieldEntryFromInput('01712').reported).toBe('+8801712');
    expect(bdPhoneSchema.safeParse(phoneFieldEntryFromInput('01712').reported).success).toBe(false);
  });

  it('shows a prefilled canonical number without its country code', () => {
    expect(displayDigitsFromValue('+8801712345678')).toBe('1712345678');
    expect(displayDigitsFromValue('01712345678')).toBe('01712345678');
    expect(displayDigitsFromValue('')).toBe('');
  });

  it('formats a complete number for "we sent a code to", and leaves anything else alone', () => {
    expect(formatPhoneForDisplay('+8801712345678')).toBe('+880 1712-345678');
    expect(formatPhoneForDisplay('01712345678')).toBe('+880 1712-345678');
    expect(formatPhoneForDisplay('12345')).toBe('12345');
  });
});

// The review finding: the field used to strip anything that was not a digit,
// so malformed text came out the other end as a valid number. Now it follows
// normalizeBdPhoneInput exactly, and malformed text stays malformed.
describe('PhoneField never cleans malformed input up into a number', () => {
  it.each([
    ['malformed +880: a trunk 0 after the code', '+88001712345678'],
    ['malformed +880: spaced trunk 0', '+880 01712345678'],
    ['malformed +880: an operator Bangladesh does not issue', '+8801212345678'],
    ['malformed +880: a digit too many', '+88017123456789'],
    ['an embedded + after the code', '+880+1712345678'],
    ['an embedded + in the number', '017+12345678'],
    ['a trailing +', '01712345678+'],
    ['letters inside the digits', '017abc12345678'],
    ['letters among separators', '17a12-345 678'],
    ['a letter O for the zero', 'O1712345678'],
    ['a scheme prefix', 'tel:+8801712345678'],
    ['the country code twice', '880880 1712345678'],
    ['+880 then the country code again', '+880880 1712345678'],
    ['two plus-codes', '+88+8801712345678'],
    ['a doubled trunk 0', '0017 1234 5678'],
    ['a local number with a digit too many', '017123456789'],
  ])('%s (%j) is shown and reported exactly as typed, and rejected', (_label, typed) => {
    const entry = phoneFieldEntryFromInput(typed);
    expect(entry).toEqual({ shown: typed.trim(), reported: typed.trim() });
    expect(normalizeBdPhoneInput(entry.reported)).toBeNull();
    expect(bdPhoneSchema.safeParse(authPhoneForSubmit(entry.reported)).success).toBe(false);
  });

  it('reports a valid number exactly when normalizeBdPhoneInput accepts the same text', () => {
    const corpus = [
      '01712345678',
      '1712345678',
      '8801712345678',
      '+8801712345678',
      ' +880 1712-345678 ',
      '+88 01712345678',
      '0171',
      '+880',
      '+',
      '+88001712345678',
      '+880+1712345678',
      '017abc12345678',
      '+1712345678',
      '+911712345678',
      '017123456789',
      '880880 1712345678',
    ];
    for (const typed of corpus) {
      const { reported } = phoneFieldEntryFromInput(typed);
      const accepted = normalizeBdPhoneInput(typed);
      expect(normalizeBdPhoneInput(reported), `"${typed}"`).toBe(accepted);
      expect(bdPhoneSchema.safeParse(reported).success, `"${typed}"`).toBe(accepted !== null);
    }
  });
});

describe('typing, pasting and autofill keep working', () => {
  it.each([
    ['01712345678', '01712345678'],
    ['1712345678', '1712345678'],
    ['8801712345678', '1712345678'],
    ['+8801712345678', '1712345678'],
  ])('takes every key of %s, and is canonical only once complete', (keys, finalShown) => {
    const { shown, reported, steps } = typeKeys(keys);
    // Valid partial typing: no key refused, nothing malformed on the way.
    expect(steps.every((step) => step !== null)).toBe(true);
    for (const step of steps.slice(0, -1)) {
      expect(bdPhoneSchema.safeParse(step!.reported).success, step!.shown).toBe(false);
      expect(normalizeBdPhoneInput(step!.reported)).toBeNull();
    }
    expect(reported).toBe(CANONICAL);
    expect(shown).toBe(finalShown);
  });

  it('refuses a key typed past a complete number instead of cutting it off afterwards', () => {
    const { shown, reported, steps } = typeKeys('017123456789');
    expect(steps.at(-1)).toBeNull();
    expect(shown).toBe('01712345678');
    expect(reported).toBe(CANONICAL);
  });

  it('takes a whole number pasted over a complete one', () => {
    expect(phoneFieldEntryAfterChange('01712345678', '+8801812345678')?.reported).toBe('+8801812345678');
  });

  it('shows a pasted over-long number as pasted, and rejects it — never cut to fit', () => {
    expect(phoneFieldEntryAfterChange('', '017123456789')).toEqual({ shown: '017123456789', reported: '017123456789' });
  });

  it.each(['+880 1712-345678', '+880-1712-345678', '(+880) 1712345678', '01712-345678', '+88 01712 345678'])(
    'accepts the contact-autofill or paste form %j',
    (value) => {
      expect(phoneFieldEntryAfterChange('', value)?.reported).toBe(CANONICAL);
    },
  );
});

describe('auth phone boundaries outside the field', () => {
  it.each(['01712345678', '1712345678', '8801712345678', '+8801712345678', ' +880 1712-345678 '])(
    'submits %j as the canonical number, and it passes the schema',
    (value) => {
      expect(authPhoneForSubmit(value)).toBe('+8801712345678');
      expect(bdPhoneSchema.safeParse(authPhoneForSubmit(value)).success).toBe(true);
    },
  );

  it.each(['+911712345678', '+1712345678', '0171234567', '', 'abc'])(
    'leaves %j for the schema to reject with its usual message',
    (value) => {
      expect(bdPhoneSchema.safeParse(authPhoneForSubmit(value)).success).toBe(false);
    },
  );

  it('prefills a route param in canonical form, whatever spelling it arrived in', () => {
    expect(phoneFieldValueFrom('01712345678')).toBe('+8801712345678');
    expect(phoneFieldValueFrom('8801712345678')).toBe('+8801712345678');
    expect(phoneFieldValueFrom('1712345678')).toBe('+8801712345678');
  });

  it("keeps a half-typed prefill only in the field's own form, and nothing for none", () => {
    // What Device Login's field hands over when "Forgot PIN" is tapped mid-number.
    expect(phoneFieldValueFrom('+880171')).toBe('+880171');
    // Anything else incomplete is not massaged into the field's form.
    expect(phoneFieldValueFrom('0171')).toBe('');
    expect(phoneFieldValueFrom(undefined)).toBe('');
  });
});

describe('a foreign number is never re-read as Bangladeshi', () => {
  it.each([
    ['+1712345678', 'a +1 code over a Bangladeshi-looking subscriber number'],
    ['+911712345678', 'an Indian number whose last ten digits collide'],
    ['(+1) 712345678', 'a bracketed foreign code'],
    ['+0 1712345678', 'a code that does not exist'],
    ['017123456789', 'a local number a prefill would have to cut'],
  ])('rejects %j as a prefill (%s)', (value) => {
    expect(phoneFieldValueFrom(value)).toBe('');
  });

  it.each(['01712345678', '1712345678', '8801712345678', '+8801712345678'])(
    'prefills %j as the canonical Bangladeshi number',
    (value) => {
      expect(phoneFieldValueFrom(value)).toBe('+8801712345678');
    },
  );

  it('keeps a typed, pasted or autofilled foreign number exactly as written, for the schema to reject', () => {
    const entry = phoneFieldEntryFromInput('+1712345678');
    expect(entry).toEqual({ shown: '+1712345678', reported: '+1712345678' });
    expect(bdPhoneSchema.safeParse(authPhoneForSubmit(entry.reported)).success).toBe(false);
  });

  it('holds a "+" as typed until it becomes +880, then folds it into the fixed prefix', () => {
    expect(phoneFieldEntryFromInput('+')).toEqual({ shown: '+', reported: '+' });
    expect(phoneFieldEntryFromInput('+88')).toEqual({ shown: '+88', reported: '+88' });
    expect(phoneFieldEntryFromInput('+880')).toEqual({ shown: '', reported: '' });
    expect(phoneFieldEntryFromInput('+880 1712-345678')).toEqual({ shown: '1712345678', reported: '+8801712345678' });
  });

  it('never shows or formats a foreign number as a Bangladeshi one', () => {
    expect(displayDigitsFromValue('+1712345678')).toBe('+1712345678');
    expect(formatPhoneForDisplay('+1712345678')).toBe('+1712345678');
    expect(formatPhoneForDisplay('+911712345678')).toBe('+911712345678');
  });
});
