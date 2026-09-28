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
          // The form field border. It was never a token, so every form
          // pasted the raw hex instead — which is how a design system
          // quietly stops being one.
          fieldBorder: colors.fieldBorder,
          success: colors.success,
          error: colors.error,
          warning: colors.warning,
          warningBg: colors.warningBg,
          errorBg: colors.errorBg,
          info: colors.info,
          // Auth parity (prototype-web). Two visual generations ship side by
          // side on purpose: `auth` is Gen A (Role Select, Registration, OTP),
          // `secure` is Gen B, the "Muthoy Secure" PIN surfaces. `notice` is
          // the shared error / warning / progress card palette.
          auth: {
            canvasFrom: colors.authCanvasFrom,
            heroEnd: colors.authHeroEnd,
            buttonEnd: colors.authButtonEnd,
            ringEnd: colors.authRingEnd,
            fieldBorder: colors.authFieldBorder,
            label: colors.authLabel,
            placeholder: colors.authPlaceholder,
            neutralFill: colors.authNeutralFill,
            errorCard: colors.authErrorCard,
            ownerAccent: colors.authOwnerAccent,
            warningBorder: colors.authWarningBorder,
            warningInk: colors.authWarningInk,
            dangerEnd: colors.authDangerEnd,
          },
          secure: {
            canvas: colors.secureCanvas,
            surface: colors.secureSurface,
            ink: colors.secureInk,
            body: colors.secureBody,
            eyebrow: colors.secureEyebrow,
            chipText: colors.secureChipText,
            dot: colors.secureDot,
            border: colors.secureBorder,
            ring: colors.secureRing,
            primary: colors.securePrimary,
            accent: colors.secureAccent,
            placeholder: colors.securePlaceholder,
            keyBorder: colors.secureKeyBorder,
            keyText: colors.secureKeyText,
            keyPressed: colors.secureKeyPressed,
            keyIcon: colors.secureKeyIcon,
            pinEmpty: colors.securePinEmpty,
            pinFilled: colors.securePinFilled,
            step: colors.secureStep,
            track: colors.secureTrack,
            footnote: colors.secureFootnote,
            blobA: colors.secureBlobA,
            blobB: colors.secureBlobB,
          },
          notice: {
            errorBg: colors.noticeErrorBg,
            errorBorder: colors.noticeErrorBorder,
            errorInk: colors.noticeErrorInk,
            errorBadge: colors.noticeErrorBadge,
            warningBg: colors.noticeWarningBg,
            warningBorder: colors.noticeWarningBorder,
            warningInk: colors.noticeWarningInk,
            warningBadge: colors.noticeWarningBadge,
            progressBg: colors.noticeProgressBg,
            progressBorder: colors.noticeProgressBorder,
            progressInk: colors.noticeProgressInk,
            progressIcon: colors.noticeProgressIcon,
          },
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
          // Auth parity: the 62dp secure icon tile and the hero sheet's top
          // corners. 2xl/3xl stay Tailwind's defaults (16/24).
          tile: `${radius.tile}px`,
          sheet: `${radius.sheet}px`,
        },
      },
    },
  };
};
