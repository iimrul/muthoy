const { withGradleProperties } = require('expo/config-plugins');

// FOUNDER DECISION 2026-11-21: Muthoy supports Android 8.0 (API 26) and newer.
// The frame-processor OCR (react-native-vision-camera-ocr-plus, native/
// LiveTextCamera.tsx) reads camera frames through Android 8.0 hardware-buffer
// APIs and does not compile below API 26. Expo autolinking copies this gradle
// property into the version catalog and from there into every native module's
// minSdkVersion (expo-modules-autolinking ExpoRootProjectPlugin).
const MIN_SDK_VERSION = '26';
const PROPERTY = 'android.minSdkVersion';

function applyMinSdk(properties) {
  const others = properties.filter((item) => !(item.type === 'property' && item.key === PROPERTY));
  return [...others, { type: 'property', key: PROPERTY, value: MIN_SDK_VERSION }];
}

module.exports = (config) => withGradleProperties(config, (modConfig) => {
  modConfig.modResults = applyMinSdk(modConfig.modResults);
  return modConfig;
});
module.exports.applyMinSdk = applyMinSdk;
module.exports.MIN_SDK_VERSION = MIN_SDK_VERSION;
