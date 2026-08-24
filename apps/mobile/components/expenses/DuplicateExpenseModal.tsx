import { Modal, Pressable, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { formatMoney } from '@muthoy/utils';
import type { DuplicateExpenseMatch } from '../../db/cash';
import { useI18n } from '../../state/localeStore';
import { expenseCategoryLabelKey } from './expenseCategoryMeta';

// B3 Group 3 (EX-11) — advisory duplicate-detection modal, ported from the
// prototype's own in-app modal (never a browser alert()). "Log Anyway" just
// re-runs the save the caller already validated; this component never writes.

interface DuplicateExpenseModalProps {
  visible: boolean;
  match: DuplicateExpenseMatch | null;
  onCancel: () => void;
  onLogAnyway: () => void;
  isSaving: boolean;
}

export function DuplicateExpenseModal({ visible, match, onCancel, onLogAnyway, isSaving }: DuplicateExpenseModalProps) {
  const { t } = useI18n();
  if (!match) {
    return null;
  }
  const labelKey = expenseCategoryLabelKey(match.category);
  const categoryLabel = labelKey ? t(labelKey) : match.category;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 items-center justify-center bg-black/50 p-4">
        <View className="w-full max-w-sm gap-4 rounded-lg bg-white p-6 shadow-xl">
          <View className="flex-row items-center gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-warningBg">
              <Feather name="alert-triangle" size={20} color="#D97706" />
            </View>
            <Text className="flex-1 font-sans-bold text-base text-richBlack">{t('duplicateDetected')}</Text>
          </View>

          <Text className="font-sans text-sm text-midGray">{t('duplicateBody')}</Text>

          <View className="gap-1 rounded-lg bg-brand-softGreen p-3">
            <Text className="font-sans text-xs text-brand-green">{t('previousExpense')}</Text>
            <Text className="font-sans-semibold text-sm text-richBlack">
              {categoryLabel} • <Text className="font-mono">{formatMoney(match.amount)}</Text>
            </Text>
          </View>

          <View className="flex-row gap-3">
            <Pressable
              onPress={onCancel}
              disabled={isSaving}
              accessibilityRole="button"
              className="flex-1 items-center rounded-lg border border-midGray/40 py-3"
            >
              <Text className="font-sans-semibold text-sm text-midGray">{t('cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={onLogAnyway}
              disabled={isSaving}
              accessibilityRole="button"
              accessibilityState={{ disabled: isSaving }}
              className={`flex-1 items-center rounded-lg bg-brand-green py-3 ${isSaving ? 'opacity-50' : ''}`}
            >
              <Text className="font-sans-semibold text-sm text-white">
                {isSaving ? t('savingExpense') : t('logAnyway')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
