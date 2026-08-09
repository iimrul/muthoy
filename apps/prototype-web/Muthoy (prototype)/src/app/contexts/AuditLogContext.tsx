import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { shopStorage } from "../utils/shopStorage";

export type AuditActionType =
  | "sale"
  | "edit"
  | "delete"
  | "discount"
  | "refund"
  | "credit"
  | "stock"
  | "invoice_void"
  | "invoice_edit"
  | "pin_changed"
  | "staff_pin_reset";

export interface AuditLogEntry {
  id: string;
  action: AuditActionType;
  staffId: string;
  staffName: string;
  staffArchived?: boolean;
  timestamp: string;
  reference?: string;
  amount?: number;
  notes?: string;
  before?: Record<string, any>;
  after?: Record<string, any>;
}

interface AuditLogContextValue {
  logs: AuditLogEntry[];
  addLog: (entry: Omit<AuditLogEntry, "id" | "timestamp">) => void;
  archiveStaff: (staffId: string) => void;
}

const STORAGE_KEY = "auditLogs";
const ARCHIVED_KEY = "archivedStaffIds";

const AuditLogContext = createContext<AuditLogContextValue | undefined>(undefined);

export function AuditLogProvider({ children }: { children: ReactNode }) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);

  useEffect(() => {
    const loadLogs = () => {
      try {
        const raw = shopStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed: AuditLogEntry[] = JSON.parse(raw);
          const archived: string[] = JSON.parse(shopStorage.getItem(ARCHIVED_KEY) || "[]");
          setLogs(parsed.map((l) => ({ ...l, staffArchived: archived.includes(l.staffId) })));
        } else {
          setLogs([]);
        }
        // No seeding on fresh install — real users start with an empty log.
      } catch {
        setLogs([]);
      }
    };

    // Load on mount
    loadLogs();

    // Reload when active shop changes
    const handleShopChange = () => loadLogs();
    window.addEventListener("activeShopChanged", handleShopChange);
    return () => window.removeEventListener("activeShopChanged", handleShopChange);
  }, []);

  const addLog = useCallback((entry: Omit<AuditLogEntry, "id" | "timestamp">) => {
    const newEntry: AuditLogEntry = {
      ...entry,
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };
    setLogs((prev) => {
      const next = [newEntry, ...prev];
      try {
        shopStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const archiveStaff = useCallback((staffId: string) => {
    try {
      const archived: string[] = JSON.parse(shopStorage.getItem(ARCHIVED_KEY) || "[]");
      if (!archived.includes(staffId)) {
        archived.push(staffId);
        shopStorage.setItem(ARCHIVED_KEY, JSON.stringify(archived));
      }
    } catch {}
    setLogs((prev) => prev.map((l) => (l.staffId === staffId ? { ...l, staffArchived: true } : l)));
  }, []);

  return (
    <AuditLogContext.Provider value={{ logs, addLog, archiveStaff }}>
      {children}
    </AuditLogContext.Provider>
  );
}

export function useAuditLog() {
  const ctx = useContext(AuditLogContext);
  if (!ctx) {
    // Return a safe fallback for environments without AuditLogProvider (e.g., Figma preview)
    console.warn("useAuditLog called outside AuditLogProvider - using fallback");
    return {
      logs: [],
      addLog: () => {},
      archiveStaff: () => {},
    };
  }
  return ctx;
}
