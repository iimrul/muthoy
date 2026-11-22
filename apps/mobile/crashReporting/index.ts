import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { configureMonitoring } from '../monitoring';
import { monitoringReportToSentry, sanitizeSentryEvent, type SentryEventLike } from './sentryEvent';

// crashReporting/ — H-8's hosted half: Sentry.
//
// Lives OUTSIDE monitoring/ on purpose: monitoring.test.ts asserts nothing in
// that directory can reach the network. monitoring/ owns the privacy contract;
// this file only plugs a provider into its seam and starts the SDK.
//
// What reaches Sentry:
//   1. Crashes and unhandled JS errors, captured by the SDK's own handlers,
//      then rebuilt by sanitizeSentryEvent (type + frames, never a message).
//   2. Every H-8 report (reportError / reportEvent), as its enumerated slug.
// What never does: breadcrumbs, screenshots, the view hierarchy, network
// requests, performance traces, session replay, or any user identity.
//
// Native crashes (Java/NDK) need the native SDK, which arrives with the next
// app build; until then the SDK runs JS-only and still reports JS errors.

/**
 * The project's ingest key. A DSN is a PUBLIC identifier by design — it ships
 * inside every app binary — and grants only the right to SEND events. It is
 * not the Sentry auth token, which must never be committed.
 */
export const SENTRY_DSN =
  'https://ceba189930557ef7d6ed8ec2b18a96ed@o4512474906886144.ingest.de.sentry.io/4512474922745936';

let started = false;

function appVariant(): string {
  try {
    const variant = Constants.expoConfig?.extra?.appVariant;
    return typeof variant === 'string' && variant.length > 0 ? variant : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Starts crash reporting once. Never throws: a broken reporter must not stop the app. */
export function initCrashReporting(): void {
  if (started) return;
  started = true;
  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: appVariant(),
      sendDefaultPii: false,
      // Breadcrumbs are console lines, taps and requests: shop ids, user ids
      // and URLs. None leaves the device, natively or from JS.
      maxBreadcrumbs: 0,
      beforeBreadcrumb: () => null,
      attachScreenshot: false,
      attachViewHierarchy: false,
      attachStacktrace: false,
      // No performance tracing: transactions carry URLs and screen names.
      tracesSampleRate: 0,
      enableAutoPerformanceTracing: false,
      enableAppStartTracking: false,
      enableNativeFramesTracking: false,
      enableStallTracking: false,
      enableUserInteractionTracing: false,
      enableCaptureFailedRequests: false,
      // Crash-free session counts per release: no identity, no content.
      enableAutoSessionTracking: true,
      // The filter reads a structural slice of the SDK's event type (so it can
      // be tested without the SDK) and returns the same object shape.
      beforeSend: (event) =>
        sanitizeSentryEvent(event as unknown as SentryEventLike) as unknown as typeof event | null,
    });
    configureMonitoring({
      name: 'sentry',
      deliver: (report) => {
        try {
          const message = monitoringReportToSentry(report);
          Sentry.captureMessage(message.message, {
            level: message.level,
            tags: message.tags,
            fingerprint: message.fingerprint,
          });
        } catch {
          // A provider must not throw (monitoring/provider.ts).
        }
      },
    });
  } catch {
    // Reporting is best-effort; the shop keeps selling without it.
  }
}

/** Test seam. */
export function resetCrashReportingForTests(): void {
  started = false;
}
