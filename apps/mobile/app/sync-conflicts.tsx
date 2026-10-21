import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { router, useFocusEffect } from 'expo-router';
import { EmptyState } from '../components/ui/EmptyState';
import { StandardHeader } from '../components/ui/StandardHeader';
import { showToast } from '../components/ui/Toast';
import {
  listConflicts,
  resolveConflict,
  type ConflictListRow,
  type ConflictResolution,
} from '../db/conflicts';
import { hasNetworkConnection } from '../sync/connectivity';
import { useI18n } from '../state/localeStore';
import { useSessionStore } from '../state/sessionStore';
import { colors } from '@muthoy/constants';
import { catalog, type CatalogKey } from '../i18n/catalog';
import { errorCatalogKey } from '../domain/errorMessages';

// H-6 / W3-02 — the Owner-facing surface for a true sync conflict.
//
// Before this, a conflict was invisible on both sides: the pull discarded a
// remote row whenever the local copy was newer, and the server told the device
// 'applied' even when its last-write-wins predicate had written nothing. The
// row was silently wrong and nothing said so.
//
// Permission-aware per ROW, not per screen. Visibility follows the affected
// table's read gate and resolution follows its write gate
// (domain/conflictTables.ts), so a cashier cannot learn an expense amount from
// a conflict notice, and a row they may see but not resolve renders read-only
// rather than offering a button the server would refuse. The route itself is
// only 'authenticated' — the real filtering lives in db/conflicts.ts's
// listConflicts, so there is one place to get it right.
//
// Presentation only (DEVELOPMENT_RULES.md): every decision is made by
// db/conflicts.ts inside one transaction.

/** The handful of fields worth showing per table. A payload dump is not a UI. */
const PREVIEW_FIELDS: Record<string, readonly string[]> = {
  customers: ['name', 'phone', 'address'],
  medicines: ['name', 'generic', 'manufacturer', 'threshold'],
  batches: ['batch_no', 'expiry_date', 'sale_price'],
  suppliers: ['name', 'phone', 'address'],
  users: ['name', 'phone'],
  shops: ['name', 'phone', 'thana', 'district'],
  expenses: ['category', 'amount', 'description'],
  cash_drawer: ['opening_cash', 'closing_counted'],
};

const FALLBACK_PREVIEW_FIELDS = ['name', 'amount', 'phone'] as const;
/**
 * What the conflicted record is CALLED, in the shopkeeper's words.
 *
 * `conflict_queue.table_name` holds a database identifier. Rendering it raw
 * showed "cash_drawer" and "sale_draft_items" on a Bangla-first screen, which
 * is meaningless in either language. Keyed off the gate table so the test can
 * prove every conflictable table has a label.
 */
function tableLabelKey(tableName: string): CatalogKey {
  const key = `conflictTable_${tableName}` as CatalogKey;
  return key in catalog.en ? key : 'conflictTableUnknown';
}

/**
 * The resolver's failures, mapped by error NAME rather than message.
 *
 * db/conflicts.ts throws English prose, and `caught.message` was rendered
 * straight to the owner. Every class sets `.name`, so this is the same
 * closed-enum approach domain/errorRedaction.ts uses — an unrecognised failure
 * falls back to the generic key instead of leaking an English database string.
 */
/**
 * Controlled vocabularies the preview would otherwise print as slugs.
 *
 * `expenses.category` is canonicalised server-side to one of five values, so
 * the card was showing "utilities" to a shopkeeper. Unlike a medicine's unit,
 * this is OUR vocabulary, not theirs, so it is ours to translate.
 */
const CATEGORY_KEYS: Record<string, CatalogKey> = {
  rent: 'categoryRent',
  salary: 'categorySalary',
  utilities: 'categoryUtilities',
  conveyance: 'categoryConveyance',
  other: 'categoryOther',
};

function previewOf(
  row: ConflictListRow,
  side: 'local' | 'remote',
  t: (key: CatalogKey) => string,
): string {
  const payload = side === 'local' ? row.localValue : row.remoteValue;
  const fields = PREVIEW_FIELDS[row.tableName] ?? FALLBACK_PREVIEW_FIELDS;
  const parts = fields
    .filter((field) => payload[field] !== undefined && payload[field] !== null)
    .map((field) => {
      const raw = String(payload[field]);
      // A payload value can be one of OUR slugs. Printing it raw is how
      // "utilities" reached a Bangla-first card.
      const key = field === 'category' ? CATEGORY_KEYS[raw] : undefined;
      return key ? t(key) : raw;
    });
  // A truncated id beats an empty card: it at least says WHICH row.
  return parts.length > 0 ? parts.join(' · ') : row.rowId.slice(0, 8);
}

export default function SyncConflictsScreen() {
  const { t } = useI18n();
  const session = useSessionStore((state) => state.session);
  const [rows, setRows] = useState<readonly ConflictListRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);

  /**
   * Which focus we are on. Every async write checks it before touching state.
   *
   * A conflict resolution outlives the focus that started it: the user can tap
   * "keep mine", navigate away, and the transaction still completes. Writing
   * rows, an error or a toast into a screen they have left is at best noise and
   * at worst a stale list overwriting a fresher one when they return. The
   * cleanup bumps the counter, so every predicate captured before the blur
   * answers false from then on.
   */
  const focusGeneration = useRef(0);

  const reload = useCallback(
    async (isActive: () => boolean = () => true) => {
      if (!session) return;
      // The actor is re-derived from SQLite inside listConflicts; the session's
      // own role and override snapshot are deliberately NOT passed.
      const next = await listConflicts(session.shopId, session.userId);
      // A read that lands after the screen blurred is stale by definition: the
      // user may have resolved a conflict elsewhere since. Dropping it is the
      // same stale-result guarantee domain/latestRequestGuard.ts gives the
      // sale search, applied to a focus read.
      if (isActive()) setRows(next);
    },
    [session],
  );

  // Re-read on focus, not once on mount: resolving a conflict elsewhere, or a
  // sync landing a new one, has to be reflected when the screen comes back.
  useFocusEffect(
    useCallback(() => {
      focusGeneration.current += 1;
      const generation = focusGeneration.current;
      const isActive = () => focusGeneration.current === generation;
      void reload(isActive);
      void hasNetworkConnection()
        .then((connected) => {
          if (isActive()) setIsOffline(!connected);
        })
        .catch(() => {
          if (isActive()) setIsOffline(true);
        });
      // Blur cancellation: both reads above outlive the focus they started in,
      // and neither may write state into a screen the user has left.
      return () => {
        focusGeneration.current += 1;
      };
    }, [reload]),
  );

  if (!session) return null;

  const resolve = async (row: ConflictListRow, resolution: ConflictResolution) => {
    const liveShopId = session.shopId;
    const liveUserId = session.userId;
    // Captured BEFORE the await, so a blur during the transaction invalidates
    // every write below rather than letting a stale result land.
    const generation = focusGeneration.current;
    const isActive = () => focusGeneration.current === generation;
    setBusyId(row.id);
    setError(null);
    try {
      await resolveConflict(
        liveShopId,
        row.id,
        liveUserId,
        resolution,
        // The device-handover guard: a resolution must never be attributed to
        // whoever happens to be holding the phone by the time it commits.
        () => {
          const current = useSessionStore.getState().session;
          return current?.userId === liveUserId && current?.shopId === liveShopId;
        },
      );
      if (!isActive()) return;
      showToast({
        message:
          resolution === 'keep_local'
            ? t('syncConflictKeepLocal')
            : t('syncConflictKeepRemote'),
      });
      await reload(isActive);
    } catch (caught) {
      // Inline and persistent, not a toast: a failure the owner has to act on
      // must not disappear after two seconds. Suppressed after a blur, because
      // an error surfacing on a screen the user has since returned to would
      // describe a row they can no longer see in that state.
      if (isActive()) {
        setError(t(errorCatalogKey(caught) ?? 'syncConflictResolveFailed'));
      }
    } finally {
      // Clear only OUR spinner. An unconditional setBusyId(null) looked safe
      // and was not: resolve A can blur, the user can return and start resolve
      // B, and A finishing would then clear B's spinner and re-enable its
      // button while B is still in flight. Keyed on the row, so a stale
      // resolution cannot speak for a live one.
      setBusyId((current) => (current === row.id ? null : current));
    }
  };

  return (
    <View className="flex-1 bg-brand-softGreen">
      <StandardHeader title={t('syncConflicts')} onBackPress={() => router.back()} />
      {rows.length === 0 ? (
        <EmptyState
          icon="check-circle"
          title={t('syncConflictsEmptyTitle')}
          message={t('syncConflictsEmptyBody')}
        />
      ) : (
        <ScrollView contentContainerClassName="gap-3 p-4 pb-28">
          <Text className="font-sans text-sm text-midGray">{t('syncConflictsIntro')}</Text>

          {isOffline ? (
            <View className="flex-row items-center gap-2 rounded-xl bg-warningBg px-3 py-2">
              <Feather name="wifi-off" size={14} color={colors.authWarningInk} />
              <Text className="flex-1 font-sans text-xs text-auth-warningInk">
                {t('syncConflictOffline')}
              </Text>
            </View>
          ) : null}

          {error ? (
            <View className="rounded-xl border border-auth-warningBorder bg-errorBg px-3 py-2">
              <Text className="font-sans text-xs text-error">{error}</Text>
            </View>
          ) : null}

          {rows.map((row) => (
            <View key={row.id} className="gap-3 rounded-2xl bg-white p-4 shadow-sm">
              <View className="flex-row items-center justify-between">
                <Text className="font-sans-bold text-sm text-richBlack">
                  {t(tableLabelKey(row.tableName))}
                </Text>
                {row.occurrences > 1 ? (
                  <Text className="font-sans text-[11px] text-midGray">
                    {t('syncConflictSeenAgain')} ×{row.occurrences}
                  </Text>
                ) : null}
              </View>
              <Text className="font-sans text-xs text-midGray">
                {row.reason === 'push_superseded'
                  ? t('syncConflictReasonSuperseded')
                  : t('syncConflictReasonPending')}
              </Text>

              <View className="gap-2">
                <View className="rounded-xl bg-brand-softGreen px-3 py-2">
                  <Text className="font-sans text-[11px] uppercase text-midGray">
                    {t('syncConflictThisDevice')}
                  </Text>
                  <Text className="font-sans-medium text-sm text-richBlack">
                    {previewOf(row, 'local', t)}
                  </Text>
                </View>
                <View className="rounded-xl bg-auth-neutralFill px-3 py-2">
                  <Text className="font-sans text-[11px] uppercase text-midGray">
                    {t('syncConflictServer')}
                  </Text>
                  <Text className="font-sans-medium text-sm text-richBlack">
                    {previewOf(row, 'remote', t)}
                  </Text>
                </View>
              </View>

              {!row.canResolve ? (
                <Text className="font-sans text-xs text-midGray">{t('syncConflictReadOnly')}</Text>
              ) : (
                <View className="gap-2">
                  {row.isGrouped ? (
                    // An atomic operation group cannot be partly discarded, so
                    // keep_remote is withheld and the reason is stated rather
                    // than rendered as a disabled button.
                    <Text className="font-sans text-xs text-auth-warningInk">
                      {t('syncConflictGrouped')}
                    </Text>
                  ) : null}
                  <View className="flex-row gap-2">
                    <Pressable
                      disabled={busyId === row.id}
                      onPress={() => void resolve(row, 'keep_local')}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: busyId === row.id }}
                      accessibilityLabel={t('syncConflictKeepLocal')}
                      hitSlop={6}
                      className="flex-1 items-center justify-center rounded-xl bg-brand-green py-3 disabled:opacity-60"
                    >
                      {busyId === row.id ? (
                        <ActivityIndicator size="small" color={colors.white} />
                      ) : (
                        <Text className="font-sans-semibold text-xs text-white">
                          {t('syncConflictKeepLocal')}
                        </Text>
                      )}
                    </Pressable>
                    {row.isGrouped ? null : (
                      <Pressable
                        disabled={busyId === row.id}
                        onPress={() => void resolve(row, 'keep_remote')}
                        accessibilityRole="button"
                        accessibilityState={{ disabled: busyId === row.id }}
                        accessibilityLabel={t('syncConflictKeepRemote')}
                        hitSlop={6}
                        className="flex-1 items-center justify-center rounded-xl border border-brand-green py-3 disabled:opacity-60"
                      >
                        <Text className="font-sans-semibold text-xs text-brand-green">
                          {t('syncConflictKeepRemote')}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
