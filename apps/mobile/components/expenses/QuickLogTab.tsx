import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { parseTakaTextToPaisa } from '@muthoy/utils';
import type { Paisa } from '@muthoy/types';
import type { ExpenseCategory } from '@muthoy/validation';
import type { DuplicateExpenseMatch } from '../../db/cash';
import { useI18n } from '../../state/localeStore';
import { AmountKeypad, type AmountKeypadKey } from './AmountKeypad';
import { CategoryCircles } from './CategoryCircles';
import { DuplicateExpenseModal } from './DuplicateExpenseModal';

// B3 Group 3 — Quick Log tab: category circles, amount card + keypad,
// optional note, duplicate-detection modal, saved banner.
//
// The typed-in form fields (category/amountText/description) are CONTROLLED
// from the screen, not local state here — this screen is owner-only
// (useOwnerAccess), so a device handover that briefly logs in Staff renders
// AccessDenied instead of this whole subtree, unmounting it. Screen-level
// hooks survive that (the screen component itself never unmounts, only what
// it conditionally returns), so lifting the fields there is what keeps a
// half-typed amount from silently vanishing during a handover — exactly the
// guarantee tests/switch-user-writes.test.tsx checks. Everything else here
// (isSaving/error/duplicate modal/saved banner) is genuinely transient UI
// state that doesn't need to survive a remount, so it stays local.

const SAVED_BANNER_FADE_IN_MS = 150;
const SAVED_BANNER_HOLD_MS = 1500;
const SAVED_BANNER_FADE_OUT_MS = 350;

export function isPositiveExpenseAmountText(value: string): boolean {
  if (!value) return false;
  try {
    return parseTakaTextToPaisa(value) > 0;
  } catch {
    return false;
  }
}

interface PendingSave {
  category: ExpenseCategory;
  amount: Paisa;
  description?: string;
}

interface QuickLogTabProps {
  category: ExpenseCategory | null;
  onCategoryChange: (category: ExpenseCategory | null) => void;
  amountText: string;
  onAmountTextChange: (text: string) => void;
  description: string;
  onDescriptionChange: (text: string) => void;
  onCheckDuplicate: (category: ExpenseCategory, amount: Paisa) => Promise<DuplicateExpenseMatch | null>;
  /** Resolves `false` when the write was skipped because the session went
   *  stale mid-flight — the form must stay exactly as the outgoing user left
   *  it, not reset as if the save had gone through (see db/errors.ts's
   *  assertSessionLive contract). */
  onSave: (input: PendingSave) => Promise<boolean>;
}

export function QuickLogTab({
  category,
  onCategoryChange,
  amountText,
  onAmountTextChange,
  description,
  onDescriptionChange,
  onCheckDuplicate,
  onSave,
}: QuickLogTabProps) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateExpenseMatch | null>(null);
  const [pending, setPending] = useState<PendingSave | null>(null);
  const [justLogged, setJustLogged] = useState(false);
  const [bannerOpacity] = useState(() => new Animated.Value(0));
  const saveLock = useRef(false);
  const duplicateCheckLock = useRef(false);

  useEffect(() => () => {
    bannerOpacity.stopAnimation();
  }, [bannerOpacity]);

  const handleKeyPress = (key: AmountKeypadKey) => {
    setError(null);
    if (key === 'backspace') {
      onAmountTextChange(amountText.slice(0, -1));
      return;
    }
    if (key === '.' && amountText.includes('.')) {
      return;
    }
    if (amountText === '0' && key !== '.') {
      onAmountTextChange(key);
      return;
    }
    // Cap at 2 decimal places — parseTakaTextToPaisa would otherwise throw
    // on a 3rd digit, surfacing as a confusing error after the fact.
    const decimalIndex = amountText.indexOf('.');
    if (decimalIndex !== -1 && amountText.length - decimalIndex > 2) {
      return;
    }
    onAmountTextChange(amountText + key);
  };

  const handleClearAmount = () => {
    onAmountTextChange('');
    setError(null);
  };

  const resetForm = () => {
    onAmountTextChange('');
    onCategoryChange(null);
    onDescriptionChange('');
    setError(null);
  };

  const showSavedBanner = () => {
    setJustLogged(true);
    bannerOpacity.stopAnimation();
    bannerOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(bannerOpacity, {
        toValue: 1,
        duration: SAVED_BANNER_FADE_IN_MS,
        useNativeDriver: true,
      }),
      Animated.delay(SAVED_BANNER_HOLD_MS),
      Animated.timing(bannerOpacity, {
        toValue: 0,
        duration: SAVED_BANNER_FADE_OUT_MS,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setJustLogged(false);
    });
  };

  const performSave = async (input: PendingSave) => {
    if (saveLock.current) return;
    saveLock.current = true;
    setIsSaving(true);
    setError(null);
    try {
      const committed = await onSave(input);
      if (committed) {
        resetForm();
        setDuplicate(null);
        setPending(null);
        showSavedBanner();
      }
    } catch {
      setError(t('expenseWriteFailed'));
    } finally {
      saveLock.current = false;
      setIsSaving(false);
    }
  };

  const handleLogExpense = async () => {
    if (duplicateCheckLock.current || !isPositiveExpenseAmountText(amountText)) return;
    let amount: Paisa;
    try {
      amount = parseTakaTextToPaisa(amountText);
    } catch {
      setError(t('openingCashInvalid'));
      return;
    }
    if (amount <= 0) {
      return;
    }
    // EX-10: saving with no category selected defaults to Other.
    const resolvedCategory: ExpenseCategory = category ?? 'other';
    const trimmedDescription = description.trim();
    const input: PendingSave = {
      category: resolvedCategory,
      amount,
      description: trimmedDescription.length > 0 ? trimmedDescription : undefined,
    };

    duplicateCheckLock.current = true;
    setIsCheckingDuplicate(true);
    setError(null);
    try {
      const match = await onCheckDuplicate(resolvedCategory, amount);
      if (match) {
        setDuplicate(match);
        setPending(input);
        return;
      }
    } catch {
      setError(t('expenseDuplicateCheckFailed'));
      return;
    } finally {
      duplicateCheckLock.current = false;
      setIsCheckingDuplicate(false);
    }
    await performSave(input);
  };

  const canSave = isPositiveExpenseAmountText(amountText) && !isSaving && !isCheckingDuplicate;

  return (
    <View className="gap-6 p-4">
      {justLogged ? (
        <Animated.View
          style={{ opacity: bannerOpacity }}
          className="flex-row items-center gap-2 rounded-lg border border-brand-green bg-brand-softGreen px-3.5 py-2.5"
        >
          <Feather name="check-circle" size={18} color="#059669" />
          <Text className="font-sans-semibold text-sm text-brand-green">{t('expenseSaved')}</Text>
        </Animated.View>
      ) : null}

      <CategoryCircles selected={category} onSelect={onCategoryChange} />

      <View className="rounded-lg bg-white p-4 shadow-sm">
        <Text className="mb-1 font-sans text-xs text-midGray">{t('amount')}</Text>
        <View className="flex-row items-center justify-between">
          <Text className="font-mono text-3xl font-bold text-richBlack">৳ {amountText || '0'}</Text>
          {amountText ? (
            <Pressable onPress={handleClearAmount} accessibilityRole="button" accessibilityLabel={t('cancel')}>
              <Feather name="x" size={20} color="#DC2626" />
            </Pressable>
          ) : null}
        </View>
      </View>

      <AmountKeypad onKeyPress={handleKeyPress} />

      <View className="gap-1">
        <Text className="font-sans text-xs text-midGray">{t('notePlaceholder')}</Text>
        <TextInput
          value={description}
          onChangeText={onDescriptionChange}
          placeholder={t('addDetailsPlaceholder')}
          accessibilityLabel={t('notePlaceholder')}
          style={{ minHeight: 48 }}
          className="rounded-lg border border-midGray/40 px-3 py-2 font-sans text-sm text-richBlack"
        />
      </View>

      {error ? (
        <Text accessibilityRole="alert" className="font-sans text-sm text-error">
          {error}
        </Text>
      ) : null}

      <Pressable
        onPress={() => void handleLogExpense()}
        disabled={!canSave}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSave }}
        style={{ minHeight: 48 }}
        className={`items-center rounded-lg bg-brand-green py-4 shadow-lg ${canSave ? '' : 'opacity-50'}`}
      >
        <Text className="font-sans-bold text-base text-white">{t('logExpense')}</Text>
      </Pressable>

      <DuplicateExpenseModal
        visible={duplicate !== null}
        match={duplicate}
        onCancel={() => {
          setDuplicate(null);
          setPending(null);
        }}
        onLogAnyway={() => {
          if (pending && !isSaving) {
            void performSave(pending);
          }
        }}
        isSaving={isSaving}
      />
    </View>
  );
}
