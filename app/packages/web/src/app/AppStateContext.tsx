import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { HealthResponse } from "@trademark-evidence-assistant/shared";
import { fetchHealth } from "../api.js";

interface AppStateValue {
  health: HealthResponse | null;
  healthError: string | null;
  refetchHealth: () => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

/** Shell-level state (currently just health) shared across every page — server remains authoritative. */
export function AppStateProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const refetchHealth = useCallback(() => {
    fetchHealth()
      .then((h) => {
        setHealth(h);
        setHealthError(null);
      })
      .catch((err: unknown) => setHealthError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    refetchHealth();
  }, [refetchHealth]);

  return (
    <AppStateContext.Provider value={{ health, healthError, refetchHealth }}>{children}</AppStateContext.Provider>
  );
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) {
    throw new Error("useAppState must be used within an AppStateProvider");
  }
  return ctx;
}
