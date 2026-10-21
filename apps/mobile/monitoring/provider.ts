// monitoring/provider.ts — the seam a hosted crash reporter plugs into.
//
// H-8 in docs/plans/pre-rc-master-plan.md stays NOT DONE after this batch: the
// repository's gate demands a forced crash, migration failure, sync failure,
// payment failure and auth failure each appearing in a real provider, verified
// on a device. None of that is here. What IS here is the half that has to be
// right BEFORE a DSN is ever configured — the privacy contract and the offline
// behaviour — because a reporter that leaks a PIN is worse than no reporter,
// and that defect is invisible until somebody reads a crash report.
//
// The interface takes a MonitoringReport and nothing else. It cannot be handed
// an Error, a message or a context object: domain/errorRedaction.ts is the only
// way to build its argument, so there is no path by which caller text reaches a
// provider. That is the whole design.

import type { MonitoringReport } from "../domain/errorRedaction";

export interface MonitoringProvider {
  /**
   * Delivers one report. MUST NOT throw and MUST NOT return a rejected
   * promise — report.ts treats a provider as untrusted and guards it anyway,
   * but the contract is stated here so an implementer knows it.
   */
  readonly deliver: (report: MonitoringReport) => void;
  /** For diagnostics and tests. Never sent anywhere. */
  readonly name: string;
}

let provider: MonitoringProvider | null = null;

/**
 * Installs a provider. Called from app startup once a DSN exists — which is
 * Batch 3 work. Until then nothing calls this and the sink is purely local.
 */
export function configureMonitoring(next: MonitoringProvider | null): void {
  provider = next;
}

export function activeProvider(): MonitoringProvider | null {
  return provider;
}

/** Test seam. Production code never needs it. */
export function resetMonitoringProvider(): void {
  provider = null;
}
