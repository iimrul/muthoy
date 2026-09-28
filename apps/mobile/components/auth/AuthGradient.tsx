import { useId } from 'react';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { ABSOLUTE_FILL } from './authStyles';

// components/auth/AuthGradient.tsx — the prototype's CSS gradients, drawn with
// react-native-svg (already an app dependency; components/ui/GreenGradient.tsx
// uses it the same way). Decorative only, so it never takes touches.

function useSvgId(prefix: string): string {
  // React ids contain ':' which an SVG url(#…) reference cannot hold.
  return `${prefix}${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
}

export interface AuthGradientProps {
  from: string;
  to: string;
  /** 'diagonal' = CSS to-br / 135deg; 'vertical' = to-b. */
  direction?: 'diagonal' | 'vertical';
  /** Corner radius, when the gradient fills a rounded button. */
  radius?: number;
}

export function AuthGradient({ from, to, direction = 'diagonal', radius = 0 }: AuthGradientProps) {
  const id = useSvgId('authGradient');
  return (
    <Svg pointerEvents="none" width="100%" height="100%" style={ABSOLUTE_FILL}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2={direction === 'diagonal' ? '1' : '0'} y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" rx={radius} ry={radius} fill={`url(#${id})`} />
    </Svg>
  );
}

export interface SoftBlobProps {
  color: string;
  opacity: number;
  size: number;
  /** Absolute placement, e.g. { top: -96, right: -96 }. */
  position: { top?: number; right?: number; bottom?: number; left?: number };
}

/**
 * The prototype's blurred background circles (blur-3xl). React Native has no
 * cheap blur, so a radial fade to transparent stands in for it — the same soft
 * edge, drawn once, with nothing to recompute on a low-end device.
 */
export function SoftBlob({ color, opacity, size, position }: SoftBlobProps) {
  const id = useSvgId('authBlob');
  const radius = size / 2;
  return (
    <Svg pointerEvents="none" width={size} height={size} style={{ position: 'absolute', ...position }}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={opacity} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={radius} cy={radius} r={radius} fill={`url(#${id})`} />
    </Svg>
  );
}
