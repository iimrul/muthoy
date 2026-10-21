// monitoring/report.ts — the only entry point the app calls.
//
// Three guarantees, in order of how badly their absence would hurt:
//
//   1. It cannot leak. The report is built by domain/errorRedaction.ts from
//      enumerated literals; `message`, `cause` and the stack never enter this
//      module, so there is nothing here to redact and nothing to get wrong.
//   2. It cannot throw. Every call site is already handling a failure — a
//      database that will not open, a sync cycle that died, a conflict detector
//      that hit a malformed payload. A reporter that throws there converts a
//      recoverable failure into a crash, so every path is wrapped and the
//      return type is void.
//   3. It cannot block. No await, no promise returned. A caller in a
//      transaction or an error handler must not acquire a new reason to wait.
//
// With no provider configured — the state this batch ships in — a report is
// recorded locally and nothing leaves the device.

import {
  redactForMonitoring,
  type MonitoringEvent,
  type MonitoringReport,
  type RedactionInput,
} from "../domain/errorRedaction";
import { activeProvider } from "./provider";
import { appendReport } from "./sink";

/**
 * Records a failure.
 *
 * `input.error` is accepted as `unknown` on purpose: callers in a catch block
 * have an `unknown`, and forcing them to narrow it first is how a reporter ends
 * up being skipped. Only its `name` is ever read, and only to look it up.
 */
export function reportError(input: RedactionInput): void {
  try {
    const report = redactForMonitoring(input);
    if (!report) {
      // An unrecognised event slug. Dropped rather than coerced, so a typo at a
      // call site cannot invent a category the provider has never seen.
      return;
    }
    appendReport(report);
    deliver(report);
  } catch {
    // Reaching here means the reporter itself is broken. There is nowhere left
    // to report that, and the caller's own failure is the one that matters.
  }
}

/** Shorthand for the common "this event happened, no error object" case. */
export function reportEvent(
  event: MonitoringEvent,
  context?: RedactionInput["context"],
): void {
  reportError({ event, context });
}

function deliver(report: MonitoringReport): void {
  const provider = activeProvider();
  if (!provider) {
    // The shipped state for Batch 1. The report is in the local buffer and goes
    // no further; H-8's hosted half is Batch 3.
    return;
  }
  try {
    provider.deliver(report);
  } catch {
    // A provider is third-party code and is treated as untrusted even though
    // its own contract forbids throwing. The report is already in the buffer.
  }
}
