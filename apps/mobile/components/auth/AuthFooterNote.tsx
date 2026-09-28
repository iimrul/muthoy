import { Text } from 'react-native';
import { useCopyFont } from './typography';

// components/auth/AuthFooterNote.tsx — the small reassurance line under a PIN
// pad or a form. Copy is the caller's, and must be TRUE for production: the
// prototype's "Your PIN stays securely stored on this device" is not (the hash
// syncs so the owner can sign in on a new phone), so it is never used.

export interface AuthFooterNoteProps {
  text: string;
  tone?: 'secure' | 'brand';
}

export function AuthFooterNote({ text, tone = 'secure' }: AuthFooterNoteProps) {
  const font = useCopyFont();
  return (
    <Text
      className={`${font()} mt-2 px-4 text-center text-[11px] leading-5 ${
        tone === 'secure' ? 'text-secure-footnote' : 'text-midGray'
      }`}
    >
      {text}
    </Text>
  );
}
