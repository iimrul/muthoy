import {
  KNOWN_ERROR_KINDS,
  MONITORING_EVENTS,
  type MonitoringEvent,
  type MonitoringReport,
} from '../domain/errorRedaction';

// crashReporting/sentryEvent.ts — what is allowed to reach Sentry, as a pure
// function.
//
// Same rule as domain/errorRedaction.ts (H-8): this module does NOT scrub. It
// builds a NEW event out of an allowlist and drops everything else, because a
// scrubber has to anticipate every shape a PIN, a phone number, a customer's
// name or a money amount can take, and an allowlist does not.
//
// Kept, because it is code, not data: the error TYPE (mapped through the same
// KNOWN_ERROR_KINDS — `e.name = pin` is legal), the stack FRAMES (function,
// file, line) with query strings and data:/eval: URLs removed, the OS, the
// phone model, the app version, and H-8's own enumerated event slugs and tags.
//
// Dropped, always: the error MESSAGE (`new Error(pin)` is legal), breadcrumbs
// (console lines carry shop and user ids), user, request, extra, server name,
// modules, culture, every context not listed, and every tag not listed. An
// event that has neither an exception nor an H-8 slug is dropped whole.
//
// Pure: no SDK import, so it is tested directly with adversarial events.

/** The structural slice of a Sentry event this module reads. */
export interface SentryFrame {
  function?: string;
  module?: string;
  filename?: string;
  abs_path?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
  platform?: string;
  package?: string;
  instruction_addr?: string;
  symbol_addr?: string;
  image_addr?: string;
  [key: string]: unknown;
}

export interface SentryException {
  type?: string;
  value?: string;
  module?: string;
  mechanism?: { type?: string; handled?: boolean; [key: string]: unknown };
  stacktrace?: { frames?: SentryFrame[]; [key: string]: unknown };
  [key: string]: unknown;
}

export interface SentryEventLike {
  event_id?: string;
  timestamp?: number;
  platform?: string;
  level?: string;
  environment?: string;
  release?: string;
  dist?: string;
  message?: string | { formatted?: string; message?: string };
  exception?: { values?: SentryException[] };
  fingerprint?: string[];
  tags?: Record<string, unknown>;
  contexts?: Record<string, Record<string, unknown> | undefined>;
  sdk?: unknown;
  debug_meta?: unknown;
  [key: string]: unknown;
}

/** The only tags that leave the device. All of them are set by this app. */
export const SENTRY_TAG_ALLOWLIST = [
  'event', 'error_kind', 'route', 'sync_phase', 'attempt', 'context_keys',
] as const;

const KNOWN_KINDS = new Set<string>(KNOWN_ERROR_KINDS);
const EVENT_SLUGS = new Set<string>(MONITORING_EVENTS);
const FINGERPRINT_PARTS = new Set<string>([...MONITORING_EVENTS, ...KNOWN_ERROR_KINDS, 'unknown']);
const MAX_TEXT = 200;
const MAX_FRAMES = 60;

const CONTEXT_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  os: ['name', 'version'],
  device: ['family', 'model', 'model_id', 'manufacturer', 'brand', 'arch', 'simulator'],
  app: ['app_version', 'app_build', 'app_identifier'],
};

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, MAX_TEXT) : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** A frame's file, without a query string, fragment, or inline source. */
export function safeFileName(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  if (/^(data|blob|javascript):/i.test(raw) || /\beval\b/i.test(raw)) return '<anonymous>';
  return raw.replace(/[?#].*$/, '');
}

function safeFrame(frame: SentryFrame): SentryFrame {
  const kept: SentryFrame = {
    function: text(frame.function),
    module: text(frame.module),
    filename: safeFileName(frame.filename),
    abs_path: safeFileName(frame.abs_path),
    lineno: finite(frame.lineno),
    colno: finite(frame.colno),
    in_app: typeof frame.in_app === 'boolean' ? frame.in_app : undefined,
    platform: text(frame.platform),
    package: safeFileName(frame.package),
    instruction_addr: text(frame.instruction_addr),
    symbol_addr: text(frame.symbol_addr),
    image_addr: text(frame.image_addr),
  };
  return Object.fromEntries(Object.entries(kept).filter(([, value]) => value !== undefined));
}

/** `error.name` is caller-assignable; only names this app knows pass through. */
export function safeErrorType(value: unknown): string {
  return typeof value === 'string' && KNOWN_KINDS.has(value) ? value : 'UnknownError';
}

function safeException(exception: SentryException): SentryException {
  const frames = Array.isArray(exception.stacktrace?.frames)
    ? exception.stacktrace.frames.slice(-MAX_FRAMES).map(safeFrame)
    : undefined;
  return {
    type: safeErrorType(exception.type),
    // The message is replaced, never trimmed: its content is the caller's.
    value: '',
    ...(exception.mechanism
      ? {
          mechanism: {
            type: text(exception.mechanism.type) ?? 'generic',
            handled: exception.mechanism.handled === true,
          },
        }
      : {}),
    ...(frames ? { stacktrace: { frames } } : {}),
  };
}

function safeContexts(contexts: SentryEventLike['contexts']): SentryEventLike['contexts'] {
  const kept: NonNullable<SentryEventLike['contexts']> = {};
  for (const [name, fields] of Object.entries(CONTEXT_ALLOWLIST)) {
    const source = contexts?.[name];
    if (!source || typeof source !== 'object') continue;
    const entries = fields
      .map((field) => [field, source[field]] as const)
      .filter(([, value]) => typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number')
      .map(([field, value]) => [field, typeof value === 'string' ? value.slice(0, MAX_TEXT) : value]);
    if (entries.length > 0) kept[name] = Object.fromEntries(entries);
  }
  return kept;
}

function safeTags(tags: SentryEventLike['tags']): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const key of SENTRY_TAG_ALLOWLIST) {
    const value = tags?.[key];
    if (typeof value === 'string' && /^[a-z0-9_.,-]{1,120}$/i.test(value)) kept[key] = value;
  }
  return kept;
}

function messageSlug(message: SentryEventLike['message']): MonitoringEvent | null {
  const raw = typeof message === 'string' ? message : message?.formatted ?? message?.message;
  return typeof raw === 'string' && EVENT_SLUGS.has(raw) ? raw as MonitoringEvent : null;
}

/**
 * The event Sentry may receive, or null to drop it. Never throws: a filter
 * that throws inside the SDK would cost the report, and a report is never
 * worth a leak, so any surprise also drops.
 */
export function sanitizeSentryEvent<T extends SentryEventLike>(event: T): T | null {
  try {
    const exceptions = Array.isArray(event.exception?.values)
      ? event.exception.values.map(safeException)
      : [];
    const slug = messageSlug(event.message);
    if (exceptions.length === 0 && !slug) return null;
    const kept: SentryEventLike = {
      event_id: text(event.event_id),
      timestamp: finite(event.timestamp),
      platform: text(event.platform),
      level: text(event.level),
      environment: text(event.environment),
      release: text(event.release),
      dist: text(event.dist),
      sdk: event.sdk,
      debug_meta: event.debug_meta,
      contexts: safeContexts(event.contexts),
      tags: safeTags(event.tags),
      ...(slug ? { message: slug } : {}),
      ...(exceptions.length > 0 ? { exception: { values: exceptions } } : {}),
      ...(Array.isArray(event.fingerprint) && event.fingerprint.every((part) => FINGERPRINT_PARTS.has(part))
        ? { fingerprint: event.fingerprint }
        : {}),
    };
    return Object.fromEntries(
      Object.entries(kept).filter(([, value]) => value !== undefined),
    ) as T;
  } catch {
    return null;
  }
}

/** One H-8 report as a Sentry message: the slug, its enumerated tags, its group. */
export function monitoringReportToSentry(report: MonitoringReport): {
  message: MonitoringEvent;
  level: 'error' | 'info';
  tags: Record<string, string>;
  fingerprint: string[];
} {
  return {
    message: report.event,
    level: report.event.endsWith('.backfilled') ? 'info' : 'error',
    tags: {
      event: report.event,
      error_kind: report.errorKind,
      route: report.route,
      sync_phase: report.syncPhase,
      attempt: String(report.attempt),
      ...(report.contextKeysPresent.length > 0
        ? { context_keys: report.contextKeysPresent.join(',') }
        : {}),
    },
    fingerprint: [report.event, report.errorKind],
  };
}
