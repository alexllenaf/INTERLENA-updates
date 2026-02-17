import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppData } from "../../state";
// Diagnostic traces (flag-gated) for rehydrate/flush lifecycle.
import { summarizePageConfig, tracePageConfig } from "../../pageConfigDebug";
import PageEditor from "./PageEditor";
import { BlockSlotResolver } from "./blockRegistry";
import { createPageConfigFromTemplate } from "./defaultPages";
import {
  hasStoredPageConfig,
  normalizePageConfig,
  persistPageConfigLocal,
  readPageConfig,
  writePageConfig
} from "./pageConfigStore";
import { PageBlockConfig, PageBlockType, PageConfig } from "./types";

type Props = {
  pageId: string;
  className?: string;
  fallbackConfig?: PageConfig;
  resolveSlot?: BlockSlotResolver;
  resolveBlockProps?: (block: PageBlockConfig) => Record<string, unknown> | null;
  createBlockForType?: (type: PageBlockType, id: string) => PageBlockConfig | null;
};

const parseUpdatedAt = (value: string | undefined): number => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const PageBuilderPage: React.FC<Props> = ({
  pageId,
  className = "",
  fallbackConfig,
  resolveSlot,
  resolveBlockProps,
  createBlockForType
}) => {
  const { settings, saveSettings } = useAppData();
  const trace = useCallback(
    (event: string, payload?: Record<string, unknown>) => {
      tracePageConfig(`builder:${pageId}:${event}`, payload);
    },
    [pageId]
  );
  const fallback = useMemo(
    () => fallbackConfig || createPageConfigFromTemplate(pageId),
    [fallbackConfig, pageId]
  );

  const [pageConfig, setPageConfig] = useState<PageConfig>(() => fallback);

  const configSavedJsonRef = useRef<string>("");
  const configLocalJsonRef = useRef<string>("");
  const pageConfigRef = useRef<PageConfig>(pageConfig);
  const configSaveTimerRef = useRef<number | null>(null);
  const pendingFlushConfigRef = useRef<PageConfig | null>(null);
  const settingsRef = useRef(settings);
  const saveSettingsRef = useRef(saveSettings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    saveSettingsRef.current = saveSettings;
  }, [saveSettings]);

  const flushPageConfig = useCallback(
    (forceConfig?: PageConfig) => {
      const persist = async () => {
        const currentSettings = settingsRef.current;
        const nextConfig = forceConfig || pageConfigRef.current;
        if (!currentSettings || !nextConfig) {
          trace("flush:skip:missing-input", {
            hasSettings: Boolean(currentSettings),
            hasConfig: Boolean(nextConfig)
          });
          return;
        }
        const hasUpdatedAt = typeof nextConfig.updated_at === "string" && nextConfig.updated_at.trim().length > 0;
        if (!forceConfig && !hasUpdatedAt) {
          trace("flush:skip:unstamped-config", {
            config: summarizePageConfig(nextConfig)
          });
          return;
        }
        const nextJson = JSON.stringify(nextConfig);
        if (!nextJson || nextJson === configSavedJsonRef.current) {
          trace("flush:skip:unchanged", {
            config: summarizePageConfig(nextConfig)
          });
          return;
        }
        trace("flush:start", {
          config: summarizePageConfig(nextConfig)
        });
        const updated = await saveSettingsRef.current(writePageConfig(currentSettings, pageId, nextConfig));
        if (updated) {
          configSavedJsonRef.current = nextJson;
          trace("flush:success", {
            config: summarizePageConfig(nextConfig)
          });
        } else {
          trace("flush:save-returned-null", {
            config: summarizePageConfig(nextConfig)
          });
        }
      };
      void persist();
    },
    [pageId, trace]
  );

  const scheduleFlushPageConfig = useCallback(
    (forceConfig?: PageConfig) => {
      if (configSaveTimerRef.current) {
        window.clearTimeout(configSaveTimerRef.current);
      }
      pendingFlushConfigRef.current = forceConfig || null;
      configSaveTimerRef.current = window.setTimeout(() => {
        const pending = pendingFlushConfigRef.current;
        pendingFlushConfigRef.current = null;
        configSaveTimerRef.current = null;
        flushPageConfig(pending || undefined);
      }, 260);
    },
    [flushPageConfig]
  );

  useEffect(() => {
    pageConfigRef.current = pageConfig;
    configLocalJsonRef.current = JSON.stringify(pageConfig);
  }, [pageConfig]);

  useEffect(() => {
    if (!settings) return;
    const fromSettings = normalizePageConfig(pageId, settings.page_configs?.[pageId], fallback);
    const loaded = readPageConfig(settings, pageId, fallback);
    const loadedJson = JSON.stringify(loaded);
    const settingsJson = JSON.stringify(fromSettings);
    const loadedTs = parseUpdatedAt(loaded.updated_at);
    const localTs = parseUpdatedAt(pageConfigRef.current?.updated_at);
    const localJson = configLocalJsonRef.current;
    trace("rehydrate:start", {
      localTs,
      loadedTs,
      local: summarizePageConfig(pageConfigRef.current),
      loaded: summarizePageConfig(loaded),
      fromSettings: summarizePageConfig(fromSettings)
    });
    configSavedJsonRef.current = settingsJson;

    // Never rollback to an older config when async settings updates arrive out of order.
    const sameTimestampConflict = localTs > 0 && loadedTs > 0 && localTs === loadedTs && localJson !== loadedJson;
    if ((localTs > loadedTs || sameTimestampConflict) && localJson) {
      trace("rehydrate:skip-rollback", {
        localTs,
        loadedTs,
        sameTimestampConflict
      });
      scheduleFlushPageConfig(pageConfigRef.current);
      return;
    }

    setPageConfig((prev) => {
      const prevJson = JSON.stringify(prev);
      return prevJson === loadedJson ? prev : loaded;
    });

    // If local config is newer than backend, sync it back.
    if (loadedJson !== settingsJson) {
      trace("rehydrate:sync-loaded-to-settings", {
        loaded: summarizePageConfig(loaded),
        fromSettings: summarizePageConfig(fromSettings)
      });
      scheduleFlushPageConfig(loaded);
    }

    if (!hasStoredPageConfig(settings, pageId)) {
      const seeded: PageConfig = {
        ...loaded,
        updated_at: new Date().toISOString()
      };
      const seededJson = JSON.stringify(seeded);
      setPageConfig(seeded);
      pageConfigRef.current = seeded;
      configLocalJsonRef.current = seededJson;
      persistPageConfigLocal(pageId, seeded);
      settingsRef.current = writePageConfig(settings, pageId, seeded);
      trace("rehydrate:seed-missing-config", {
        seeded: summarizePageConfig(seeded)
      });
      scheduleFlushPageConfig(seeded);
    }
  }, [fallback, pageId, scheduleFlushPageConfig, settings, trace]);

  useEffect(() => {
    return () => {
      if (configSaveTimerRef.current) {
        window.clearTimeout(configSaveTimerRef.current);
        configSaveTimerRef.current = null;
      }
      const pending = pendingFlushConfigRef.current;
      pendingFlushConfigRef.current = null;
      flushPageConfig(pending || undefined);
    };
  }, [flushPageConfig]);

  useEffect(() => {
    const handlePageHide = () => flushPageConfig();
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushPageConfig();
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [flushPageConfig]);

  const handlePageConfigChange = useCallback(
    (next: PageConfig) => {
      const stamped: PageConfig = {
        ...next,
        updated_at: new Date().toISOString()
      };
      setPageConfig(stamped);
      pageConfigRef.current = stamped;
      configLocalJsonRef.current = JSON.stringify(stamped);
      persistPageConfigLocal(pageId, stamped);
      trace("change:from-editor", {
        config: summarizePageConfig(stamped)
      });
      const currentSettings = settingsRef.current;
      if (currentSettings) {
        settingsRef.current = writePageConfig(currentSettings, pageId, stamped);
      }
      scheduleFlushPageConfig(stamped);
    },
    [pageId, scheduleFlushPageConfig, trace]
  );

  return (
    <PageEditor
      pageId={pageId}
      pageConfig={pageConfig}
      onChange={handlePageConfigChange}
      className={className}
      resolveSlot={resolveSlot}
      resolveBlockProps={resolveBlockProps}
      createBlockForType={createBlockForType}
    />
  );
};

export default PageBuilderPage;
