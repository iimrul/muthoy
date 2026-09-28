import { create } from 'zustand';

// state/deviceRelinkStore.ts — "this installation must sign in again".
//
// A2.3 with enforcement on: a session minted before this installation was
// registered is refused by sync with `device_session_unbound`. Nothing is
// revoked — the person and the till are both fine — but sync stays halted
// until an authoritative phone + PIN sign-in binds the installation. Before
// this, the only trace was a notification; the till kept selling offline with
// no visible reason its data had stopped leaving the phone.
//
// sync/index.ts sets it on that refusal and clears it on the next completed
// cycle; components/auth/DeviceRelinkBanner.tsx shows it. In memory only: the
// next halted cycle re-raises it after a restart.

export interface DeviceRelinkRequirement {
  shopId: string;
  userId: string;
}

interface DeviceRelinkState {
  required: DeviceRelinkRequirement | null;
}

export const useDeviceRelinkStore = create<DeviceRelinkState>(() => ({ required: null }));

export function markDeviceRelinkRequired(shopId: string, userId: string): void {
  useDeviceRelinkStore.setState({ required: { shopId, userId } });
}

export function clearDeviceRelinkRequired(): void {
  if (useDeviceRelinkStore.getState().required !== null) {
    useDeviceRelinkStore.setState({ required: null });
  }
}
