import { useCallback, useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { router } from 'expo-router';
import { formatNumber } from '@muthoy/utils';
import { EmptyState } from '../../components/ui/EmptyState';
import { StandardHeader } from '../../components/ui/StandardHeader';
import { listBatchesByExpiry, type ExpiryListRow } from '../../db/inventory';
import type { ExpiryStatus } from '../../domain/notificationRules';
import { useSessionStore } from '../../state/sessionStore';

// Expiry Management — Volume 0 Day 9. Every non-deleted batch for this shop,
// nearest REAL expiry date first (CLAUDE.md rule 3 — recomputed at read
// time, db/inventory.ts's listBatchesByExpiry, never a stored day-count).
// Read-only: no money/stock mutation, no Supabase/network reads — SQLite via
// db/inventory.ts only.
//
// TODO(settings): "Soon" uses the repo-wide shared default window
// (domain/notificationRules.ts's EXPIRY_WINDOW_DAYS_DEFAULT = 30 days, the
// same window the Notifications expiry job alerts on, so the badge here and
// the alert the owner receives always agree). A per-shop configurable
// threshold does NOT exist in the schema yet and is not invented here — it
// needs a real Settings slice (Volume 4 SETTINGS). Until then this screen is
// intentionally not configurable.
const STATUS_LABEL: Record<ExpiryStatus, string> = {
  expired: 'Expired',
  critical: 'Critical',
  warning: 'Soon',
  ok: 'OK',
  unknown: 'No expiry',
};

// Reuses the existing error/warning/success tokens (@muthoy/constants) —
// no new colors invented for this screen.
const STATUS_CLASSES: Record<ExpiryStatus, string> = {
  expired: 'bg-error',
  critical: 'bg-errorBg',
  warning: 'bg-warningBg',
  ok: 'bg-brand-softGreen',
  unknown: 'bg-brand-softGreen',
};

const STATUS_TEXT_CLASSES: Record<ExpiryStatus, string> = {
  expired: 'text-white',
  critical: 'text-error',
  warning: 'text-warning',
  ok: 'text-success',
  unknown: 'text-midGray',
};

export default function ExpiryManagementScreen() {
  const session = useSessionStore((state) => state.session);
  const [rows, setRows] = useState<ExpiryListRow[]>([]);

  const reload = useCallback(async () => {
    if (!session) {
      return;
    }
    setRows(await listBatchesByExpiry(session.shopId));
  }, [session]);

  useEffect(() => {
    // SQLite load-on-mount, same pattern as the sibling inventory screens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  if (!session) {
    return null;
  }

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title="Expiry" onBackPress={() => router.back()} />
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        className="flex-1"
        contentContainerClassName="flex-grow gap-3 p-4"
        onRefresh={reload}
        refreshing={false}
        ListEmptyComponent={
          <EmptyState title="No batches yet" message="Batches you add to medicines will show up here, nearest expiry first." />
        }
        renderItem={({ item }) => <ExpiryRow row={item} />}
      />
    </View>
  );
}

function ExpiryRow({ row }: { row: ExpiryListRow }) {
  return (
    <View className="gap-1 rounded-lg bg-white p-4">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 gap-1">
          <Text className="font-sans-medium text-base text-richBlack">{row.medicineName}</Text>
          <Text className="font-sans text-xs text-midGray">Batch {row.batchNo}</Text>
        </View>
        <View className={`rounded-full px-3 py-1 ${STATUS_CLASSES[row.status]}`}>
          <Text className={`font-sans-semibold text-xs ${STATUS_TEXT_CLASSES[row.status]}`}>{STATUS_LABEL[row.status]}</Text>
        </View>
      </View>
      <View className="flex-row items-center justify-between">
        <Text className="font-sans text-xs text-midGray">{row.expiryDate ?? 'No expiry date recorded'}</Text>
        <Text className="font-sans text-sm text-richBlack">{formatNumber(row.quantityAvailable)} left</Text>
      </View>
    </View>
  );
}
