// Test double for @sentry/react-native (vitest alias in vitest.config.ts).
//
// The real SDK reaches into react-native internals at import time and, once
// initialised, sends events to the real Sentry project. No test may do either,
// so every test that imports app/_layout (and through it crashReporting/) gets
// this recorder instead. crashReporting/crash-reporting.test.ts reads it.

export interface RecordedSentryCall {
  kind: 'init' | 'captureMessage' | 'captureException';
  args: unknown[];
}

export const __sentryCalls: RecordedSentryCall[] = [];

export function __resetSentryCalls(): void {
  __sentryCalls.length = 0;
}

export function init(options: unknown): void {
  __sentryCalls.push({ kind: 'init', args: [options] });
}

export function captureMessage(message: unknown, context?: unknown): string {
  __sentryCalls.push({ kind: 'captureMessage', args: [message, context] });
  return 'test-event-id';
}

export function captureException(error: unknown, context?: unknown): string {
  __sentryCalls.push({ kind: 'captureException', args: [error, context] });
  return 'test-event-id';
}

export function wrap<T>(component: T): T {
  return component;
}
