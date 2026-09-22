import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { colors } from '@muthoy/constants';
import { useI18n } from '../../state/localeStore';

// components/ui/BaseModal.tsx — Phase C Pass 1.
//
// Every sheet in the app re-implemented the same shell: a transparent Modal, a
// black/40 scrim, an absolutely-positioned Pressable behind the card to catch
// the backdrop tap, a rounded-top-3xl white panel, and a title row with an
// X button. SupplierPickerField alone contains two copies of it.
//
// Re-implementing it per sheet is how sheets drift: some got the backdrop tap,
// some did not; some handled the keyboard, most did not; the close control's
// hit area and icon size varied. This is that shell, once.
//
// It owns NO content decisions. Children render exactly what the calling sheet
// rendered before, and nothing here reads or writes data.

export interface BaseSheetProps {
  visible: boolean;
  /** Backdrop tap, the X button, and Android Back all route here. */
  onClose: () => void;
  title?: string;
  /** Rendered on the title row, opposite the close button. */
  headerAccessory?: ReactNode;
  children: ReactNode;
  /** Set false for a sheet whose own content must not be scrolled past. */
  dismissOnBackdropPress?: boolean;
  /** Tailwind classes for the panel, e.g. a max height on a long list. */
  panelClassName?: string;
  /**
   * Hides the default visible close button only when the content supplies its
   * own equally accessible dismiss control.
   */
  hasEquivalentDismissControl?: boolean;
}

/**
 * The bottom sheet. This is the shape the app already uses everywhere — a panel
 * anchored to the bottom edge — so it is the default rather than a variant.
 *
 * The keyboard wrapper is the one behaviour that is NEW rather than extracted:
 * several sheets contain text inputs and none of them moved out from under the
 * keyboard. It is presentation, not logic, and it cannot change what any form
 * submits.
 */
export function BaseSheet({
  visible,
  onClose,
  title,
  headerAccessory,
  children,
  dismissOnBackdropPress = true,
  panelClassName = '',
  hasEquivalentDismissControl = false,
}: BaseSheetProps) {
  const { t } = useI18n();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end bg-black/40"
      >
        {dismissOnBackdropPress ? (
          <Pressable
            onPress={onClose}
            accessible={false}
            testID="modal-backdrop"
            className="absolute inset-0"
          />
        ) : null}
        <View className={`rounded-t-3xl bg-white p-5 shadow-2xl ${panelClassName}`.trim()}>
          {title || headerAccessory || !hasEquivalentDismissControl ? (
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="font-sans-bold text-lg text-richBlack">{title ?? ''}</Text>
              <View className="flex-row items-center gap-2">
                {headerAccessory}
                {!hasEquivalentDismissControl ? (
                  <Pressable
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel={t('closeLabel')}
                    // 32pt is the smallest the existing sheets used; kept, with the
                    // hitSlop that several of them were missing.
                    hitSlop={8}
                    className="h-8 w-8 items-center justify-center"
                  >
                    <Feather name="x" size={20} color={colors.midGray} />
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export interface BaseModalProps extends Omit<BaseSheetProps, 'panelClassName'> {
  panelClassName?: string;
}

/**
 * The centred variant, for a short confirmation that would look lost anchored
 * to the bottom edge. Same contract, same close affordances.
 */
export function BaseModal({
  visible,
  onClose,
  title,
  headerAccessory,
  children,
  dismissOnBackdropPress = true,
  panelClassName = '',
  hasEquivalentDismissControl = false,
}: BaseModalProps) {
  const { t } = useI18n();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 items-center justify-center bg-black/40 p-6"
      >
        {dismissOnBackdropPress ? (
          <Pressable
            onPress={onClose}
            accessible={false}
            testID="modal-backdrop"
            className="absolute inset-0"
          />
        ) : null}
        <View className={`w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl ${panelClassName}`.trim()}>
          {title || headerAccessory || !hasEquivalentDismissControl ? (
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="font-sans-bold text-lg text-richBlack">{title ?? ''}</Text>
              <View className="flex-row items-center gap-2">
                {headerAccessory}
                {!hasEquivalentDismissControl ? (
                  <Pressable
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel={t('closeLabel')}
                    hitSlop={8}
                    className="h-8 w-8 items-center justify-center"
                  >
                    <Feather name="x" size={20} color={colors.midGray} />
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
