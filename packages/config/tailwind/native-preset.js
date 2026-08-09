// Tailwind preset FACTORY shared by apps/mobile (and later packages/ui) via
// NativeWind. Takes brand tokens as a parameter rather than requiring
// @muthoy/constants directly — packages/config must have zero runtime
// dependency on packages/constants, since constants itself depends on config
// for its shared tsconfig/eslint base (a direct require() here would create
// a workspace dependency cycle). Callers pass @muthoy/constants' own exports
// straight through — see apps/mobile/tailwind.config.js.
/**
 * @param {{ colors: Record<string, string>, fonts: any, spacing: { radius: Record<string, number> } }} tokens
 * @returns {import('tailwindcss').Config}
 */
module.exports = function createNativePreset({ colors, fonts, spacing }) {
  const radius = spacing.radius;
  return {
    theme: {
      extend: {
        colors: {
          brand: { green: colors.brandGreen, deepGreen: colors.deepGreen, softGreen: colors.softGreen },
          richBlack: colors.richBlack,
          midGray: colors.midGray,
          success: colors.success,
          error: colors.error,
          warning: colors.warning,
          warningBg: colors.warningBg,
          errorBg: colors.errorBg,
          info: colors.info,
        },
        fontFamily: {
          sans: [fonts.plusJakartaSans.regular],
          'sans-light': [fonts.plusJakartaSans.light],
          'sans-medium': [fonts.plusJakartaSans.medium],
          'sans-semibold': [fonts.plusJakartaSans.semiBold],
          'sans-bold': [fonts.plusJakartaSans.bold],
          'sans-extrabold': [fonts.plusJakartaSans.extraBold],
          bangla: [fonts.hindSiliguri.regular],
          'bangla-light': [fonts.hindSiliguri.light],
          'bangla-semibold': [fonts.hindSiliguri.semiBold],
          'bangla-bold': [fonts.hindSiliguri.bold],
          mono: [fonts.dmMono.regular],
          'mono-medium': [fonts.dmMono.medium],
        },
        borderRadius: {
          sm: `${radius.sm}px`,
          DEFAULT: `${radius.base}px`,
          md: `${radius.md}px`,
          lg: `${radius.base}px`,
          xl: `${radius.xl}px`,
        },
      },
    },
  };
};
