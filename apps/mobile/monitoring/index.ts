// monitoring/ — H-8's core. See report.ts for the contract and
// domain/errorRedaction.ts for why nothing here can carry a PIN.
//
// Importing from this barrel keeps call sites to one line and makes the
// module-graph assertions in monitoring.test.ts meaningful: nothing in this
// directory may reach the network, and nothing may import dev/runtimeDiagnostics
// (which deliberately retains raw context and is DEV-only).

export { reportError, reportEvent } from "./report";
export {
  configureMonitoring,
  resetMonitoringProvider,
  type MonitoringProvider,
} from "./provider";
export { readReports, clearReports, CAPACITY, type StoredReport } from "./sink";
export type {
  MonitoringEvent,
  MonitoringReport,
  MonitoringRoute,
  SyncPhase,
} from "../domain/errorRedaction";
