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
// Diagnostic traces (flag-gated) to inspect page-config save/merge races.
import { summarizePageConfigs, tracePageConfig } from "./pageConfigDebug";
import { Application, ApplicationInput, Settings } from "./types";

export type AppContextValue = {
  settings: Settings | null;
  applications: Application[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  saveSettings: (next: Settings) => Promise<Settings | null>;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const parseUpdatedAt = (value: unknown): number | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const pickNewestPageConfig = (current: unknown, incoming: unknown): unknown => {
  if (!isRecord(current) || !isRecord(incoming)) return incoming;
  const currentTs = parseUpdatedAt(current.updated_at);
  const incomingTs = parseUpdatedAt(incoming.updated_at);
  if (currentTs !== null && incomingTs !== null) {
    return incomingTs >= currentTs ? incoming : current;
  }
  if (currentTs === null && incomingTs !== null) return incoming;
  if (currentTs !== null && incomingTs === null) return current;
  return incoming;
};

const mergePageConfigs = (...sources: Array<unknown>): Record<string, unknown> => {
  const merged: Record<string, unknown> = {};
  sources.forEach((source) => {
    if (!isRecord(source)) return;
    Object.entries(source).forEach(([pageId, pageConfig]) => {
      merged[pageId] = pickNewestPageConfig(merged[pageId], pageConfig);
    });
  });
  return merged;
};

const mergeSettingsForSave = (current: Settings | null, next: Settings): Settings => {
  if (!current) return next;
  const currentPages =
    current.page_configs && typeof current.page_configs === "object" ? current.page_configs : {};
  const nextPages = next.page_configs && typeof next.page_configs === "object" ? next.page_configs : {};
  return {
    ...current,
    ...next,
    page_configs: mergePageConfigs(currentPages, nextPages)
  };
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const settingsRef = React.useRef<Settings | null>(null);
  const pageConfigsRef = React.useRef<Record<string, unknown>>({});
  const saveRequestSeqRef = React.useRef(0);
  const saveAppliedSeqRef = React.useRef(0);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!settings?.page_configs || typeof settings.page_configs !== "object") return;
    pageConfigsRef.current = mergePageConfigs(pageConfigsRef.current, settings.page_configs);
    tracePageConfig("state:settings-effect:merge-page-configs", {
      pages: summarizePageConfigs(pageConfigsRef.current)
    });
  }, [settings?.page_configs]);

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
          const mergedPageConfigs = mergePageConfigs(pageConfigsRef.current, settingsData.page_configs);
          pageConfigsRef.current = mergedPageConfigs;
          tracePageConfig("state:refresh:apply-settings", {
            pages: summarizePageConfigs(mergedPageConfigs)
          });
          setSettings({
            ...settingsData,
            page_configs: mergedPageConfigs
          });
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
    const requestSeq = ++saveRequestSeqRef.current;
    const nextPages =
      next.page_configs && typeof next.page_configs === "object" ? next.page_configs : {};
    if (Object.keys(nextPages).length > 0) {
      pageConfigsRef.current = mergePageConfigs(pageConfigsRef.current, nextPages);
    }
    const stickyPages = mergePageConfigs(settingsRef.current?.page_configs, pageConfigsRef.current, nextPages);
    const mergedWithStickyPages: Settings = {
      ...mergeSettingsForSave(settingsRef.current, next),
      page_configs: stickyPages
    };
    tracePageConfig("state:saveSettings:request", {
      requestSeq,
      nextPages: summarizePageConfigs(nextPages),
      stickyPages: summarizePageConfigs(stickyPages)
    });
    try {
      const updated = await apiUpdateSettings(mergedWithStickyPages);
      tracePageConfig("state:saveSettings:response", {
        requestSeq,
        responsePages: summarizePageConfigs(updated.page_configs)
      });
      if (requestSeq < saveAppliedSeqRef.current) {
        tracePageConfig("state:saveSettings:drop-stale-response", {
          requestSeq,
          latestAppliedSeq: saveAppliedSeqRef.current
        });
        return settingsRef.current;
      }
      saveAppliedSeqRef.current = requestSeq;
      const mergedPageConfigs = mergePageConfigs(pageConfigsRef.current, updated.page_configs);
      pageConfigsRef.current = mergedPageConfigs;
      const mergedSettings = {
        ...updated,
        page_configs: mergedPageConfigs
      };
      tracePageConfig("state:saveSettings:applied", {
        requestSeq,
        mergedPages: summarizePageConfigs(mergedPageConfigs)
      });
      setSettings(mergedSettings);
      return mergedSettings;
    } catch (err) {
      tracePageConfig("state:saveSettings:error", {
        requestSeq,
        message: err instanceof Error ? err.message : String(err)
      });
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Unable to save settings.");
      }
      return null;
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
