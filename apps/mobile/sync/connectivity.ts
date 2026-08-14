import NetInfo, { type NetInfoSubscription } from '@react-native-community/netinfo';

function isOnline(isConnected: boolean | null, isInternetReachable: boolean | null): boolean {
  return isConnected === true && isInternetReachable !== false;
}

export function subscribeToReconnect(onReconnect: () => void): NetInfoSubscription {
  let wasOnline: boolean | null = null;
  return NetInfo.addEventListener((state) => {
    const online = isOnline(state.isConnected, state.isInternetReachable);
    if (wasOnline === false && online) {
      onReconnect();
    }
    wasOnline = online;
  });
}

export async function hasNetworkConnection(): Promise<boolean> {
  const state = await NetInfo.fetch();
  return isOnline(state.isConnected, state.isInternetReachable);
}
