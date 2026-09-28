import { View } from 'react-native';
import { fillTemplate } from '../../i18n/display';
import { useI18n } from '../../state/localeStore';

// components/auth/StepIndicator.tsx — the PIN setup progress bar: one segment
// per onboarding step, filled up to and including the current one.

export interface StepIndicatorProps {
  /** 1-based. */
  current: number;
  total: number;
}

export function StepIndicator({ current, total }: StepIndicatorProps) {
  const { t, formatNumber } = useI18n();
  return (
    <View
      className="mb-3 w-full flex-row items-center gap-2"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={fillTemplate(t('authStepLabel'), {
        step: formatNumber(current),
        total: formatNumber(total),
      })}
      accessibilityValue={{ min: 1, max: total, now: current }}
    >
      {Array.from({ length: total }, (_, index) => (
        <View
          key={index}
          className={`h-1.5 flex-1 rounded-full ${index < current ? 'bg-secure-step' : 'bg-secure-track'}`}
        />
      ))}
    </View>
  );
}
