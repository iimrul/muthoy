import { forwardRef } from "react";
import { TextInput, type TextInputProps } from "react-native";
import { colors } from "@muthoy/constants";

// Business forms use light product surfaces in either OS appearance.
// Explicit ink and hint defaults prevent Android's dark-theme native defaults
// from making text invisible. Individual fields retain their own overrides.
export const AppTextInput = forwardRef<TextInput, TextInputProps>(
  function AppTextInput(
    {
      className,
      placeholderTextColor = colors.midGray,
      selectionColor = colors.brandGreen,
      ...props
    },
    ref,
  ) {
    return (
      <TextInput
        ref={ref}
        placeholderTextColor={placeholderTextColor}
        selectionColor={selectionColor}
        className={`text-richBlack ${className ?? ""}`}
        {...props}
      />
    );
  },
);
