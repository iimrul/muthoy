import { beforeEach, describe, expect, it } from 'vitest';
import { __resetSentryCalls, __sentryCalls } from '../db/test/sentry-react-native';
import { reportError, resetMonitoringProvider } from '../monitoring';
import { initCrashReporting, resetCrashReportingForTests, SENTRY_DSN } from './index';
import {
  monitoringReportToSentry,
  safeFileName,
  sanitizeSentryEvent,
  type SentryEventLike,
} from './sentryEvent';

// CLAUDE.md rule 8 and H-8: nothing a shop types may reach Sentry. These rows
// feed the filter events shaped like the ones that would leak, and require
// that the leak is ABSENT from what comes out — not merely masked.

const PIN = '4821';
const PHONE = '01712345678';

function leakyEvent(): SentryEventLike {
  return {
    event_id: 'abc123',
    timestamp: 1_790_000_000,
    platform: 'javascript',
    level: 'fatal',
    environment: 'production',
    release: 'com.muthoy.pos@1.0.0+42',
    message: `PIN ${PIN} for ${PHONE}`,
    exception: {
      values: [{
        type: `Error ${PIN}`,
        value: `wrong PIN ${PIN} for customer ${PHONE}`,
        mechanism: { type: 'onerror', handled: false, data: { phone: PHONE } },
        stacktrace: {
          frames: [
            {
              function: 'checkout',
              filename: `app:///index.android.bundle?phone=${PHONE}`,
              lineno: 10,
              colno: 4,
              in_app: true,
              vars: { pin: PIN },
              context_line: `const pin = "${PIN}"`,
            },
            { function: 'eval', filename: `data:text/javascript,${PIN}`, lineno: 1 },
          ],
        },
      }],
    },
    breadcrumbs: [{ message: `logged in ${PHONE}` }],
    user: { id: 'owner-1', phone: PHONE },
    request: { url: `https://x.supabase.co/rest/v1/customers?phone=eq.${PHONE}` },
    extra: { pin: PIN },
    server_name: 'Rahim-phone',
    contexts: {
      device: { model: 'SM-A047F', manufacturer: 'samsung', name: `Rahim ${PHONE}` },
      os: { name: 'Android', version: '14', kernel_version: 'secret' },
      app: { app_version: '1.0.0', app_build: '42', app_name: 'Muthoy' },
      culture: { locale: 'bn-BD', timezone: 'Asia/Dhaka' },
    },
    tags: { route: 'sale', customer_phone: PHONE, event: `bad ${PIN}` },
    fingerprint: [`custom ${PIN}`],
  };
}

describe('the Sentry event filter', () => {
  it('lets no PIN or phone number through from any field', () => {
    const kept = sanitizeSentryEvent(leakyEvent());
    expect(kept).not.toBeNull();
    const serialized = JSON.stringify(kept);
    expect(serialized).not.toContain(PIN);
    expect(serialized).not.toContain(PHONE);
    expect(serialized).not.toContain('Rahim');
  });

  it('keeps the code location, the phone model and the release, and drops the rest', () => {
    const kept = sanitizeSentryEvent(leakyEvent())!;
    expect(Object.keys(kept).sort()).toEqual([
      'contexts', 'environment', 'event_id', 'exception', 'level', 'platform', 'release', 'tags', 'timestamp',
    ]);
    const [exception] = kept.exception!.values!;
    expect(exception).toMatchObject({ type: 'UnknownError', value: '', mechanism: { type: 'onerror', handled: false } });
    expect(exception?.stacktrace?.frames).toEqual([
      { function: 'checkout', filename: 'app:///index.android.bundle', lineno: 10, colno: 4, in_app: true },
      { function: 'eval', filename: '<anonymous>', lineno: 1 },
    ]);
    expect(kept.contexts).toEqual({
      os: { name: 'Android', version: '14' },
      device: { model: 'SM-A047F', manufacturer: 'samsung' },
      app: { app_version: '1.0.0', app_build: '42' },
    });
    expect(kept.tags).toEqual({ route: 'sale' });
  });

  it('keeps an error type the app itself defines', () => {
    const kept = sanitizeSentryEvent({
      exception: { values: [{ type: 'SyncHaltedError', value: 'server text' }] },
    })!;
    expect(kept.exception?.values?.[0]).toEqual({ type: 'SyncHaltedError', value: '' });
  });

  it('drops a free-text message event whole, and keeps an H-8 slug', () => {
    expect(sanitizeSentryEvent({ message: `hello ${PHONE}` })).toBeNull();
    expect(sanitizeSentryEvent({ message: 'sync.halted', tags: { event: 'sync.halted' } }))
      .toEqual({ message: 'sync.halted', tags: { event: 'sync.halted' }, contexts: {} });
  });

  it('never throws, even on a hostile event', () => {
    const hostile = { get exception(): never { throw new Error(PIN); } } as unknown as SentryEventLike;
    expect(sanitizeSentryEvent(hostile)).toBeNull();
  });

  it('strips query strings and inline sources from file names', () => {
    expect(safeFileName('app:///main.jsbundle?x=1#y')).toBe('app:///main.jsbundle');
    expect(safeFileName('blob:abc')).toBe('<anonymous>');
    expect(safeFileName('')).toBeUndefined();
  });
});

describe('H-8 reports become Sentry messages', () => {
  it('sends the slug and its enumerated tags only', () => {
    const mapped = monitoringReportToSentry({
      event: 'sync.halted',
      errorKind: 'SyncHaltedError',
      route: 'background',
      syncPhase: 'unknown',
      attempt: 1,
      contextKeysPresent: ['actorUserId', 'shopId'],
    } as never);
    expect(mapped).toEqual({
      message: 'sync.halted',
      level: 'error',
      tags: {
        event: 'sync.halted', error_kind: 'SyncHaltedError', route: 'background',
        sync_phase: 'unknown', attempt: '1', context_keys: 'actorUserId,shopId',
      },
      fingerprint: ['sync.halted', 'SyncHaltedError'],
    });
    // The mapped message survives the filter unchanged.
    expect(sanitizeSentryEvent({ message: mapped.message, tags: mapped.tags, fingerprint: mapped.fingerprint }))
      .toMatchObject({ message: 'sync.halted', fingerprint: ['sync.halted', 'SyncHaltedError'] });
  });
});

describe('starting crash reporting', () => {
  beforeEach(() => {
    __resetSentryCalls();
    resetMonitoringProvider();
    resetCrashReportingForTests();
  });

  it('starts Sentry once, with every identity- and content-bearing feature off', () => {
    initCrashReporting();
    initCrashReporting();
    const inits = __sentryCalls.filter((call) => call.kind === 'init');
    expect(inits).toHaveLength(1);
    const options = inits[0]!.args[0] as Record<string, unknown>;
    expect(options).toMatchObject({
      dsn: SENTRY_DSN,
      sendDefaultPii: false,
      maxBreadcrumbs: 0,
      attachScreenshot: false,
      attachViewHierarchy: false,
      tracesSampleRate: 0,
      enableCaptureFailedRequests: false,
      enableUserInteractionTracing: false,
    });
    expect((options.beforeBreadcrumb as () => unknown)()).toBeNull();
    const beforeSend = options.beforeSend as (event: SentryEventLike) => SentryEventLike | null;
    expect(JSON.stringify(beforeSend(leakyEvent()))).not.toContain(PIN);
  });

  it('routes every H-8 report to Sentry as its slug', () => {
    initCrashReporting();
    reportError({ event: 'db.init.failed', error: new Error(`key ${PIN}`), route: 'startup' });
    const messages = __sentryCalls.filter((call) => call.kind === 'captureMessage');
    expect(messages).toHaveLength(1);
    expect(messages[0]!.args[0]).toBe('db.init.failed');
    expect(JSON.stringify(messages[0]!.args)).not.toContain(PIN);
  });
});
