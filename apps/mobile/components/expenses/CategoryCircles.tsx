import { Pressable, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@muthoy/validation';
import { useI18n } from '../../state/localeStore';
import { expenseCategoryIcon, expenseCategoryLabelKey } from './expenseCategoryMeta';

// B3 Group 3 (EX-4) — 5 circular category buttons: Rent / Salary / Utilities
// / Conveyance / Other. Selected state scales up and inverts colors, mirroring
// the prototype exactly; `null` selection is valid (EX-10: saving with none
// selected defaults to Other at save time, not at selection time).

interface CategoryCirclesProps {
  selected: ExpenseCategory | null;
  onSelect: (category: ExpenseCategory) => void;
}

export function CategoryCircles({ selected, onSelect }: CategoryCirclesProps) {
  const { t } = useI18n();

  return (
    <View className="gap-3">
      <Text className="font-sans-semibold text-sm text-brand-green">{t('selectCategory')}</Text>
      <View className="flex-row justify-between">
        {EXPENSE_CATEGORIES.map((category) => {
          const isSelected = selected === category;
          const labelKey = expenseCategoryLabelKey(category);
          const label = labelKey ? t(labelKey) : category;
          return (
            <Pressable
              key={category}
              onPress={() => onSelect(category)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={label}
              style={{ width: '18%', aspectRatio: 1, minHeight: 48, minWidth: 48 }}
              className={`items-center justify-center rounded-full active:scale-95 ${
                isSelected ? 'scale-110 bg-brand-green shadow-lg' : 'bg-white shadow-sm'
              }`}
            >
              <Feather name={expenseCategoryIcon(category)} size={22} color={isSelected ? '#FFFFFF' : '#059669'} />
              <Text
                numberOfLines={1}
                className={`mt-1 font-sans-semibold text-[10px] ${isSelected ? 'text-white' : 'text-brand-green'}`}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
