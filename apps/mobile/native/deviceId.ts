import { createMMKV } from 'react-native-mmkv';
import { generateId } from './id';

const storage = createMMKV({ id: 'muthoy-device-identity' });
const DEVICE_ID_KEY = 'device-id';

/** Stable installation identity used to bind held sales and refund claims. */
export function getDeviceId(): string {
  const existing = storage.getString(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = generateId();
  storage.set(DEVICE_ID_KEY, created);
  return created;
}
