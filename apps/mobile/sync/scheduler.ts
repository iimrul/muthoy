import { AppState } from 'react-native';
import { hasNetworkConnection } from './connectivity';

const SYNC_INTERVAL_MS = 120_000;

export function startForegroundScheduler(onTick: () => void): () => void {
  const interval = setInterval(() => {
    if (AppState.currentState !== 'active') {
      return;
    }
    void hasNetworkConnection().then((online) => {
      if (online) {
        onTick();
      }
    }).catch(() => undefined);
  }, SYNC_INTERVAL_MS);
  return () => clearInterval(interval);
}
