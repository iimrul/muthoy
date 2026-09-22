import { Pressable, Text, TextInput, View } from 'react-native';
import { useI18n } from '../../state/localeStore';
import { BaseSheet } from '../ui/BaseModal';

// components/sale/DiscountFields.tsx — Phase C Pass 1.
//
// The discount control was written inline inside app/sale/checkout.tsx. It is
// lifted here unchanged so a second surface can use it without a copy, and so
// Pass 3 has one place to restyle when it takes Checkout against the prototype.
//
// It computes NOTHING. domain/discounts.ts owns the maths, checkout.tsx owns the
// quote lifecycle, and this file owns three buttons and a text field. The
// `onChange` signature is deliberately "here is the new state, both halves at
// once" so the caller keeps resetting its stale quote in exactly one place —
// splitting it into two callbacks is how a screen ends up resetting the quote
// for the type change and forgetting to for the value change.

/** Checkout's own shape. NOT domain/discounts.ts's Discount — that one carries
 *  a resolved rule ('percentage' | 'flat'), while this is what the user is
 *  typing, including the "no discount" state the domain has no word for. */
export type CheckoutDiscountType = 'none' | 'amount' | 'percentage';

export interface DiscountFieldsProps {
  type: CheckoutDiscountType;
  /** The raw text as typed, not a parsed number: parsing belongs to the caller,
   *  which is where the error message it produces is rendered. */
  text: string;
  onChange: (next: { type: CheckoutDiscountType; text: string }) => void;
  errorMessage?: string | null;
}

const TYPES: readonly CheckoutDiscountType[] = ['none', 'amount', 'percentage'];

export function DiscountFields({ type, text, onChange, errorMessage }: DiscountFieldsProps) {
  const { t } = useI18n();
  const label = (value: CheckoutDiscountType): string => {
    if (value === 'amount') return t('amountTypeLabel');
    if (value === 'percentage') return t('percentageTypeLabel');
    return t('noneLabel');
  };

  return (
    <View className="gap-3">
      <View className="flex-row gap-2">
        {TYPES.map((value) => (
          <Pressable
            key={value}
            onPress={() => onChange({ type: value, text })}
            accessibilityRole="button"
            accessibilityLabel={label(value)}
            accessibilityState={{ selected: type === value }}
            className={`flex-1 items-center rounded-lg border py-2 ${type === value ? 'border-brand-green bg-brand-softGreen' : 'border-midGray bg-white'}`}
          >
            <Text
              className={`font-sans-medium text-sm ${type === value ? 'text-brand-green' : 'text-richBlack'}`}
            >
              {label(value)}
            </Text>
          </Pressable>
        ))}
      </View>
      {type !== 'none' ? (
        <TextInput
          value={text}
          onChangeText={(next) => onChange({ type, text: next })}
          keyboardType="decimal-pad"
          accessibilityLabel={t('checkoutDiscountLabel')}
          placeholder={
            type === 'amount' ? t('discountAmountPlaceholder') : t('discountPercentPlaceholder')
          }
          // CLAUDE.md rule 6: a taka amount is money and uses DM Mono; a
          // percentage is not, and uses Plus Jakarta Sans.
          className={`rounded-lg border border-midGray p-3 ${type === 'amount' ? 'font-mono' : 'font-sans'}`}
        />
      ) : null}
      {errorMessage ? (
        <Text className="font-sans text-sm text-error">{errorMessage}</Text>
      ) : null}
    </View>
  );
}

export interface DiscountModalProps extends DiscountFieldsProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * The same control in the shared sheet shell, for surfaces where the discount
 * is an occasional action rather than a permanent section of the form.
 *
 * Checkout deliberately keeps the INLINE form: turning its always-visible
 * section into a modal is a change to how that screen works, which belongs to
 * Pass 3's Checkout parity pass and to the founder's review of it — not to a
 * Pass 1 extraction whose whole contract is that nothing moves.
 */
export function DiscountModal({ visible, onClose, ...fields }: DiscountModalProps) {
  const { t } = useI18n();
  return (
    <BaseSheet visible={visible} onClose={onClose} title={t('checkoutDiscountLabel')}>
      <DiscountFields {...fields} />
    </BaseSheet>
  );
}
