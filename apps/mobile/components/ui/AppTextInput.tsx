import { forwardRef } from "react";
import { TextInput, type TextInputProps, type TextStyle } from "react-native";
import { colors } from "@muthoy/constants";

// Android pads a TextInput vertically (and adds font padding above the
// glyphs). Inside a fixed-height box (`h-10`, `h-11`, …) that padding no
// longer fits and the digits are clipped: the cart's quantity "1" read as "⊥"
// (device test, 2026-11-27). A single-line field that fixes its height and
// sets no vertical padding of its own is centred without that padding.
const FIXED_HEIGHT = /(^|\s)h-(\d+(\.\d+)?|\[[^\]]+\])(?=\s|$)/;
const OWN_VERTICAL_PADDING = /(^|\s)(p|py|pt|pb)-/;
const TIGHT_VERTICAL: TextStyle = {
  paddingVertical: 0,
  includeFontPadding: false,
  textAlignVertical: "center",
};

/** The style a fixed-height single-line field needs, or null when it has none. */
export function fixedHeightInputStyle(
  className: string | undefined,
  multiline: boolean | undefined,
): TextStyle | null {
  if (multiline || !className) return null;
  if (!FIXED_HEIGHT.test(className) || OWN_VERTICAL_PADDING.test(className)) return null;
  return TIGHT_VERTICAL;
}

// Business forms use light product surfaces in either OS appearance.
// Explicit ink and hint defaults prevent Android's dark-theme native defaults
// from making text invisible. Individual fields retain their own overrides.
export const AppTextInput = forwardRef<TextInput, TextInputProps>(
  function AppTextInput(
    {
      className,
      placeholderTextColor = colors.midGray,
      selectionColor = colors.brandGreen,
      style,
      ...props
    },
    ref,
  ) {
    const tight = fixedHeightInputStyle(className, props.multiline);
    return (
      <TextInput
        ref={ref}
        placeholderTextColor={placeholderTextColor}
        selectionColor={selectionColor}
        className={`text-richBlack ${className ?? ""}`}
        style={tight ? [tight, style] : style}
        {...props}
      />
    );
  },
);
