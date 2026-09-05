import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

export function GreenGradient({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <View className="relative overflow-hidden">
    <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs><LinearGradient id={dark ? 'darkGreen' : 'brandGreen'} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={dark ? '#065F46' : '#10B981'} /><Stop offset="1" stopColor={dark ? '#022C22' : '#065F46'} /></LinearGradient></Defs>
      <Rect width="100%" height="100%" fill={`url(#${dark ? 'darkGreen' : 'brandGreen'})`} />
    </Svg>
    {children}
  </View>;
}
