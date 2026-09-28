import { Text, View } from 'react-native';
import { useCopyFont } from './typography';

// components/auth/AuthTitleBlock.tsx — eyebrow, title and body, in the two
// generations' type scales:
//   secure (Gen B): 11px tracked eyebrow, 22px semibold title, 13px body
//   brand  (Gen A): 24px bold title, 14px body

export interface AuthTitleBlockProps {
  title: string;
  body?: string;
  eyebrow?: string;
  tone?: 'secure' | 'brand';
}

export function AuthTitleBlock({ title, body, eyebrow, tone = 'secure' }: AuthTitleBlockProps) {
  const font = useCopyFont();

  if (tone === 'brand') {
    return (
      <View className="mb-4 items-center">
        <Text accessibilityRole="header" className={`${font('bold')} mb-2 text-center text-2xl text-richBlack`}>
          {title}
        </Text>
        {body ? <Text className={`${font()} text-center text-sm text-midGray`}>{body}</Text> : null}
      </View>
    );
  }

  return (
    <View className="mb-3 w-full items-center">
      {eyebrow ? (
        <Text className={`${font('bold')} mb-1.5 text-center text-[11px] uppercase tracking-[2.2px] text-secure-eyebrow`}>
          {eyebrow}
        </Text>
      ) : null}
      <Text
        accessibilityRole="header"
        className={`${font('semibold')} text-center text-[22px] leading-[28px] text-secure-ink`}
      >
        {title}
      </Text>
      {body ? (
        <Text className={`${font()} mt-1 max-w-[270px] text-center text-[13px] leading-[19px] text-secure-body`}>
          {body}
        </Text>
      ) : null}
    </View>
  );
}
