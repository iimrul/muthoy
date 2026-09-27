// Node stand-in for expo-device, aliased in vitest.config.ts the same way
// db/test/expo-crypto.ts and db/test/react-native-mmkv.ts stand in for their
// native modules.
//
// The real package reaches expo-modules-core's EventEmitter at import time and
// ships source this runner cannot parse, so merely importing it fails suites
// that never touch a device at all — sync/pull.ts pulls sync/deviceRegistry.ts
// into its graph.
//
// Everything here is COSMETIC: A2.3 uses these three fields only to label a row
// in the Owner's registered-devices list. The device's identity is
// native/deviceId.ts's random id, and nothing is authorized on the strength of
// a model name.

export const osName: string | null = 'Android';
export const modelName: string | null = 'Test Device';
export const osVersion: string | null = '14';
