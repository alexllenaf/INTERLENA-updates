import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  API_BASE,
  ApiError,
  createApplication as apiCreate,
  deleteApplication as apiDelete,
  getApplications,
  getSettings,
  updateApplication as apiUpdate,
  updateSettings as apiUpdateSettings
} from "./api";
import { Application, ApplicationInput, Settings } from "./types";

export type AppContextValue = {
  settings: Settings | null;
  applications: Application[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  saveSettings: (next: Settings) => Promise<void>;
  createApplication: (payload: ApplicationInput) => Promise<Application | null>;
  updateApplication: (id: number, payload: Partial<ApplicationInput>) => Promise<void>;
  deleteApplication: (id: number) => Promise<void>;
};

const AppContext = createContext<AppContextValue | undefined>(undefined);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isNetworkError = (err: unknown) => {
  if (err instanceof TypeError) return true;
  if (!err || typeof err !== "object") return false;
  if (!("message" in err)) return false;
  const message = String((err as { message?: unknown }).message || "");
  return message.toLowerCase().includes("fetch") || message.toLowerCase().includes("network");
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const delays = [200, 400, 800, 1200, 2000];
    try {
      for (let attempt = 0; attempt <= delays.length; attempt += 1) {
        try {
          const [settingsData, applicationsData] = await Promise.all([
            getSettings(),
            getApplications()
          ]);
          setSettings(settingsData);
          setApplications(applicationsData);
          return;
        } catch (err) {
          if (err instanceof ApiError) {
            setError(err.message);
            return;
          }
          const shouldRetry = isNetworkError(err) && attempt < delays.length;
          if (!shouldRetry) {
            setError(`Unexpected error while loading data (API: ${API_BASE}).`);
            return;
          }
          await sleep(delays[attempt]);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveSettings = useCallback(async (next: Settings) => {
    setError(null);
    try {
      const updated = await apiUpdateSettings(next);
      setSettings(updated);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Unable to save settings.");
      }
    }
  }, []);

  const createApplication = useCallback(async (payload: ApplicationInput) => {
    setError(null);
    try {
      const created = await apiCreate(payload);
      setApplications((prev) => [created, ...prev]);
      return created;
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Unable to create application.");
      }
      return null;
    }
  }, []);

  const updateApplication = useCallback(
    async (id: number, payload: Partial<ApplicationInput>) => {
      setError(null);
      try {
        const updated = await apiUpdate(id, payload);
        setApplications((prev) => prev.map((item) => (item.id === id ? updated : item)));
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("Unable to update application.");
        }
      }
    },
    []
  );

  const deleteApplication = useCallback(async (id: number) => {
    setError(null);
    try {
      await apiDelete(id);
      setApplications((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Unable to delete application.");
      }
    }
  }, []);

  const value = useMemo(
    () => ({
      settings,
      applications,
      loading,
      error,
      refresh,
      saveSettings,
      createApplication,
      updateApplication,
      deleteApplication
    }),
    [settings, applications, loading, error, refresh, saveSettings, createApplication, updateApplication, deleteApplication]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export function useAppData(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error("useAppData must be used inside AppProvider");
  }
  return ctx;
}
