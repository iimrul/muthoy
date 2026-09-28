// react-native-svg imports React Native's native component registry at module
// load, which the Vitest/Node environment cannot parse. Every shape is
// decorative on the screens under test (gradients and soft background
// circles), so each renders nothing — same treatment as vector-icons.ts.
function Nothing(): null {
  return null;
}

export default Nothing;
export const Svg = Nothing;
export const Defs = Nothing;
export const LinearGradient = Nothing;
export const RadialGradient = Nothing;
export const Stop = Nothing;
export const Rect = Nothing;
export const Circle = Nothing;
export const Ellipse = Nothing;
export const Path = Nothing;
export const G = Nothing;
export const Text = Nothing;
export const SvgXml = Nothing;
