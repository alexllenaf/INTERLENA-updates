import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPageBlocks, resolvePageByLegacyKey, savePageBlocks } from "../../api";
import { summarizePageConfig, tracePageConfig } from "../../pageConfigDebug";
import { useAppData } from "../../state";
import { CanonicalBlock } from "../../types";
import { useUndo } from "../../undoContext";
import PageEditor, { type CrossPageDropPayload } from "./PageEditor";
import { BlockSlotResolver } from "./blockRegistry";
import { createPageConfigFromTemplate } from "./defaultPages";
import { hasStoredPageConfig, normalizePageConfig, persistPageConfigLocal, readPageConfig } from "./pageConfigStore";
import { PAGE_CONFIG_VERSION, PageBlockConfig, PageBlockType, PageConfig } from "./types";
import { buildBlockGraph } from "./blockLinks";

type Props = {
  pageId: string;
  className?: string;
  fallbackConfig?: PageConfig;
  resolveSlot?: BlockSlotResolver;
  resolveBlockProps?: (block: PageBlockConfig) => Record<string, unknown> | null;
  resolveDuplicateProps?: (block: PageBlockConfig) => Record<string, unknown> | null;
  createBlockForType?: (type: PageBlockType, id: string) => PageBlockConfig | null;
};

// ---------------------------------------------------------------------------
// Vite HMR — module-level flush registry
// When Vite replaces this module, dispose() fires *before* the old component
// unmounts.  We keep a Set of flush callbacks so every mounted instance can
// push its pending changes with keepalive before the old module is discarded.
// ---------------------------------------------------------------------------
const _hmrFlushCallbacks = new Set<() => void>();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const cb of _hmrFlushCallbacks) {
      try { cb(); } catch { /* best-effort */ }
    }
    _hmrFlushCallbacks.clear();
  });
}

const withTimestamp = (config: PageConfig): PageConfig => ({
  ...config,
  updated_at: new Date().toISOString()
});

const parseTimestamp = (value: unknown): number | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const normalizeBlockLayout = (layout: Record<string, unknown> | null | undefined) => {
  if (!layout || typeof layout !== "object") {
    return { colSpan: 1 };
  }
  const colSpanRaw = Number(layout.colSpan);
  const colStartRaw = layout.colStart === undefined ? undefined : Number(layout.colStart);
  const rowStartRaw = layout.rowStart === undefined ? undefined : Number(layout.rowStart);
  return {
    colSpan: Number.isFinite(colSpanRaw) && colSpanRaw > 0 ? Math.round(colSpanRaw) : 1,
    ...(typeof colStartRaw === "number" && Number.isFinite(colStartRaw)
      ? { colStart: Math.round(colStartRaw) }
      : {}),
    ...(typeof rowStartRaw === "number" && Number.isFinite(rowStartRaw)
      ? { rowStart: Math.round(rowStartRaw) }
      : {})
  };
};

const toCanonicalBlocks = (pageConfig: PageConfig): CanonicalBlock[] => {
  return pageConfig.blocks.map((block) => {
    const props = (block.props || {}) as Record<string, unknown>;
    const hasText = Object.prototype.hasOwnProperty.call(props, "text");
    return {
      id: block.id,
      type: block.type,
      parent_id: null,
      layout: normalizeBlockLayout(block.layout as unknown as Record<string, unknown>),
      props,
      ...(hasText ? { content: { text: props.text } } : {})
    };
  });
};

const fromCanonicalBlocks = (
  pageId: string,
  blocks: CanonicalBlock[],
  fallback: PageConfig
): PageConfig => {
  const raw = {
    id: pageId,
    version: PAGE_CONFIG_VERSION,
    blocks: (blocks || []).map((block) => {
      const props = { ...(block.props || {}) };
      if (
        !Object.prototype.hasOwnProperty.call(props, "text") &&
        block.content &&
        typeof block.content === "object" &&
        !Array.isArray(block.content)
      ) {
        const content = block.content as Record<string, unknown>;
        if (Object.prototype.hasOwnProperty.call(content, "text")) {
          props.text = content.text;
        }
      }
      return {
        id: block.id,
        type: block.type,
        layout: normalizeBlockLayout(block.layout),
        props
      };
    })
  };

  return normalizePageConfig(pageId, raw, fallback);
};

const PageBuilderPage: React.FC<Props> = ({
  pageId,
  className = "",
  fallbackConfig,
  resolveSlot,
  resolveBlockProps,
  resolveDuplicateProps,
  createBlockForType
}) => {
  const { settings, saveSettings } = useAppData();
  const { executeCommand, undoManager } = useUndo();

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

  const [pageConfig, setPageConfig] = useState<PageConfig>(() => withTimestamp(fallback));

  const pageConfigRef = useRef<PageConfig>(pageConfig);
  const configSavedJsonRef = useRef<string>("");
  const configLocalJsonRef = useRef<string>(JSON.stringify(pageConfig));
  const canonicalPageIdRef = useRef<string | null>(null);
  const canonicalUpdatedAtRef = useRef<string | null>(null);
  const canonicalBlockCountRef = useRef(0);
  const shadowReconciledRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const pendingFlushRef = useRef<PageConfig | null>(null);
  const settingsRef = useRef(settings);
  const flushRequestSeqRef = useRef(0);
  const flushAppliedSeqRef = useRef(0);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const syncShadowSnapshot = useCallback(
    (targetPageId: string, nextConfig: PageConfig) => {
      persistPageConfigLocal(targetPageId, nextConfig);
      if (!settingsRef.current) return;
      void saveSettings({
        page_configs: {
          [targetPageId]: nextConfig
        }
      });
    },
    [saveSettings]
  );

  const maybePromoteStoredConfig = useCallback(
    async (opts: {
      canonicalPageId: string;
      canonicalUpdatedAt?: string | null;
      canonicalBlockCount: number;
      canonicalConfig: PageConfig;
    }): Promise<PageConfig> => {
      const currentSettings = settingsRef.current;

      // ---------------------------------------------------------------
      // CRITICAL: When settings haven't loaded yet, do NOT touch
      // localStorage.  The second reconciliation useEffect will fire
      // once settings arrive and perform the proper localStorage vs
      // canonical comparison.  Calling syncShadowSnapshot here would
      // overwrite localStorage with the canonical version, destroying
      // any user data (blocks, links) that only exists in localStorage.
      // ---------------------------------------------------------------
      if (!currentSettings) {
        trace("rehydrate:skip-sync:no-settings", {
          config: summarizePageConfig(opts.canonicalConfig)
        });
        return opts.canonicalConfig;
      }

      if (!hasStoredPageConfig(currentSettings, pageId)) {
        syncShadowSnapshot(pageId, opts.canonicalConfig);
        return opts.canonicalConfig;
      }

      const storedConfig = readPageConfig(currentSettings, pageId, fallback);
      const storedTs = parseTimestamp(storedConfig.updated_at);
      const canonicalTs = parseTimestamp(opts.canonicalUpdatedAt);
      const shouldPromote =
        (storedConfig.blocks.length > 0 && opts.canonicalBlockCount === 0) ||
        (storedTs !== null && (canonicalTs === null || storedTs > canonicalTs));

      if (!shouldPromote) {
        syncShadowSnapshot(pageId, opts.canonicalConfig);
        return opts.canonicalConfig;
      }

      trace("rehydrate:promote-shadow:start", {
        stored: summarizePageConfig(storedConfig),
        canonical: summarizePageConfig(opts.canonicalConfig)
      });

      try {
        const persisted = await savePageBlocks(opts.canonicalPageId, toCanonicalBlocks(storedConfig));
        const promoted = withTimestamp(
          fromCanonicalBlocks(pageId, persisted.blocks || [], storedConfig)
        );
        syncShadowSnapshot(pageId, promoted);
        trace("rehydrate:promote-shadow:success", {
          config: summarizePageConfig(promoted)
        });
        return promoted;
      } catch (error) {
        trace("rehydrate:promote-shadow:error", {
          message: error instanceof Error ? error.message : String(error)
        });
        syncShadowSnapshot(pageId, opts.canonicalConfig);
        return opts.canonicalConfig;
      }
    },
    [fallback, pageId, syncShadowSnapshot, trace]
  );

  const flushPageConfig = useCallback(
    (forceConfig?: PageConfig, keepalive?: boolean) => {
      const persist = async () => {
        const nextConfig = forceConfig || pageConfigRef.current;
        const nextJson = JSON.stringify(nextConfig);
        const requestSeq = ++flushRequestSeqRef.current;
        const expectedBlockIds = nextConfig.blocks.map((block) => block.id);

        if (!nextJson || nextJson === configSavedJsonRef.current) {
          trace("flush:skip:unchanged", {
            requestSeq,
            config: summarizePageConfig(nextConfig)
          });
          return;
        }

        trace("flush:start", {
          requestSeq,
          config: summarizePageConfig(nextConfig),
          hasCanonicalPageId: Boolean(canonicalPageIdRef.current)
        });

        const canonicalPageId = canonicalPageIdRef.current;
        if (!canonicalPageId) {
          trace("flush:skip:no-canonical-page-id", {
            requestSeq,
            config: summarizePageConfig(nextConfig)
          });
          return;
        }

        try {
          const persisted = await savePageBlocks(canonicalPageId, toCanonicalBlocks(nextConfig), keepalive);
          const canonicalConfig = withTimestamp(
            fromCanonicalBlocks(pageId, persisted.blocks || [], nextConfig)
          );
          const canonicalJson = JSON.stringify(canonicalConfig);
          const persistedBlockIds = canonicalConfig.blocks.map((block) => block.id);
          const sameBlockSet =
            expectedBlockIds.length === persistedBlockIds.length &&
            expectedBlockIds.every((blockId, index) => blockId === persistedBlockIds[index]);

          if (requestSeq < flushAppliedSeqRef.current) {
            trace("flush:drop-stale-response", {
              requestSeq,
              latestAppliedSeq: flushAppliedSeqRef.current,
              config: summarizePageConfig(canonicalConfig)
            });
            return;
          }

          if (!sameBlockSet) {
            trace("flush:reject-mismatched-response", {
              requestSeq,
              expectedBlockIds,
              persistedBlockIds
            });
            window.setTimeout(() => flushPageConfig(pageConfigRef.current), 0);
            return;
          }

          flushAppliedSeqRef.current = requestSeq;
          canonicalUpdatedAtRef.current = canonicalConfig.updated_at || null;
          canonicalBlockCountRef.current = canonicalConfig.blocks.length;
          pageConfigRef.current = canonicalConfig;
          configLocalJsonRef.current = canonicalJson;
          configSavedJsonRef.current = canonicalJson;
          syncShadowSnapshot(pageId, canonicalConfig);
          setPageConfig((prev) => (JSON.stringify(prev) === canonicalJson ? prev : canonicalConfig));
          trace("flush:canonical-success", {
            requestSeq,
            config: summarizePageConfig(canonicalConfig)
          });
          undoManager.saveCheckpoint();
        } catch (error) {
          trace("flush:canonical-error", {
            requestSeq,
            message: error instanceof Error ? error.message : String(error)
          });
        }

      };
      void persist();
    },
    [pageId, syncShadowSnapshot, trace, undoManager]
  );

  const scheduleFlushPageConfig = useCallback(
    (forceConfig?: PageConfig) => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      pendingFlushRef.current = forceConfig || null;
      saveTimerRef.current = window.setTimeout(() => {
        const pending = pendingFlushRef.current;
        pendingFlushRef.current = null;
        saveTimerRef.current = null;
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
    shadowReconciledRef.current = false;
  }, [pageId]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      trace("rehydrate:start", {
        fallback: summarizePageConfig(fallback)
      });

      try {
        const resolved = await resolvePageByLegacyKey(pageId, true);
        if (cancelled) return;

        canonicalPageIdRef.current = resolved.id;
        canonicalUpdatedAtRef.current = resolved.updated_at || null;

        const blocksPayload = await getPageBlocks(resolved.id);
        if (cancelled) return;
        canonicalBlockCountRef.current = (blocksPayload.blocks || []).length;

        const loaded = withTimestamp(fromCanonicalBlocks(pageId, blocksPayload.blocks || [], fallback));
        const applied = await maybePromoteStoredConfig({
          canonicalPageId: resolved.id,
          canonicalUpdatedAt: resolved.updated_at,
          canonicalBlockCount: (blocksPayload.blocks || []).length,
          canonicalConfig: loaded
        });
        const appliedJson = JSON.stringify(applied);
        canonicalUpdatedAtRef.current = applied.updated_at || canonicalUpdatedAtRef.current;
        canonicalBlockCountRef.current = applied.blocks.length;
        shadowReconciledRef.current = Boolean(settingsRef.current);

        setPageConfig(applied);
        pageConfigRef.current = applied;
        configLocalJsonRef.current = appliedJson;
        configSavedJsonRef.current = appliedJson;

        trace("rehydrate:canonical-success", {
          resolvedPageId: resolved.id,
          config: summarizePageConfig(applied)
        });

        if (applied.blocks.length === 0 && fallback.blocks.length > 0) {
          const seeded = withTimestamp(fallback);
          setPageConfig(seeded);
          pageConfigRef.current = seeded;
          configLocalJsonRef.current = JSON.stringify(seeded);
          persistPageConfigLocal(pageId, seeded);
          scheduleFlushPageConfig(seeded);
        }
        return;
      } catch (error) {
        trace("rehydrate:canonical-error", {
          message: error instanceof Error ? error.message : String(error)
        });
        canonicalPageIdRef.current = null;
        canonicalUpdatedAtRef.current = null;
        canonicalBlockCountRef.current = 0;
      }

      const currentSettings = settingsRef.current;
      const legacyLoaded = currentSettings
        ? readPageConfig(currentSettings, pageId, fallback)
        : fallback;
      const next = withTimestamp(legacyLoaded);
      const nextJson = JSON.stringify(next);

      setPageConfig(next);
      pageConfigRef.current = next;
      configLocalJsonRef.current = nextJson;
      configSavedJsonRef.current = nextJson;

      trace("rehydrate:legacy-fallback", {
        config: summarizePageConfig(next)
      });
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [fallback, maybePromoteStoredConfig, pageId, scheduleFlushPageConfig, trace]);

  useEffect(() => {
    if (!settings) return;
    if (!canonicalPageIdRef.current) return;
    if (shadowReconciledRef.current) return;
    if (!hasStoredPageConfig(settings, pageId)) {
      shadowReconciledRef.current = true;
      syncShadowSnapshot(pageId, pageConfigRef.current);
      return;
    }
    shadowReconciledRef.current = true;

    void (async () => {
      const reconciled = await maybePromoteStoredConfig({
        canonicalPageId: canonicalPageIdRef.current as string,
        canonicalUpdatedAt: canonicalUpdatedAtRef.current,
        canonicalBlockCount: canonicalBlockCountRef.current,
        canonicalConfig: pageConfigRef.current
      });
      const reconciledJson = JSON.stringify(reconciled);
      pageConfigRef.current = reconciled;
      configLocalJsonRef.current = reconciledJson;
      setPageConfig((prev) => (JSON.stringify(prev) === reconciledJson ? prev : reconciled));
    })();
  }, [maybePromoteStoredConfig, pageId, settings, syncShadowSnapshot]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const pending = pendingFlushRef.current;
      pendingFlushRef.current = null;
      flushPageConfig(pending || undefined, true);
    };
  }, [flushPageConfig]);

  // Register a module-level HMR flush callback so Vite dispose can persist
  // pending changes even before React has a chance to unmount the component.
  useEffect(() => {
    const hmrCb = () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const pending = pendingFlushRef.current;
      pendingFlushRef.current = null;
      flushPageConfig(pending || undefined, true);
    };
    _hmrFlushCallbacks.add(hmrCb);
    return () => { _hmrFlushCallbacks.delete(hmrCb); };
  }, [flushPageConfig]);

  useEffect(() => {
    const handlePageHide = () => flushPageConfig(undefined, true);
    const handleBeforeUnload = () => flushPageConfig(undefined, true);
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushPageConfig(undefined, true);
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [flushPageConfig]);

  const handlePageConfigChange = useCallback(
    (next: PageConfig) => {
      const previousConfig = pageConfigRef.current;

      void executeCommand({
        description: "Edit page",
        timestamp: Date.now(),
        do: () => {
          const applied = withTimestamp(next);
          setPageConfig(applied);
          pageConfigRef.current = applied;
          configLocalJsonRef.current = JSON.stringify(applied);
          persistPageConfigLocal(pageId, applied);
          trace("change:from-editor", {
            config: summarizePageConfig(applied)
          });

          scheduleFlushPageConfig(applied);
        },
        undo: () => {
          const reverted = withTimestamp(previousConfig);
          setPageConfig(reverted);
          pageConfigRef.current = reverted;
          configLocalJsonRef.current = JSON.stringify(reverted);
          persistPageConfigLocal(pageId, reverted);
          trace("undo:revert-page-config", {
            config: summarizePageConfig(reverted)
          });

          scheduleFlushPageConfig(reverted);
        }
      });
    },
    [executeCommand, pageId, scheduleFlushPageConfig, trace]
  );

  const handleDropFromAnotherPage = useCallback(
    (payload: CrossPageDropPayload) => {
      if (payload.sourcePageId === pageId) {
        handlePageConfigChange({
          ...pageConfigRef.current,
          blocks: payload.nextBlocks
        });
        return;
      }

      const nowIso = new Date().toISOString();
      const targetNext: PageConfig = {
        ...pageConfigRef.current,
        updated_at: nowIso,
        blocks: payload.nextBlocks
      };

      setPageConfig(targetNext);
      pageConfigRef.current = targetNext;
      configLocalJsonRef.current = JSON.stringify(targetNext);
      persistPageConfigLocal(pageId, targetNext);
      scheduleFlushPageConfig(targetNext);

      const sourceFallback: PageConfig = {
        id: payload.sourcePageId,
        version: PAGE_CONFIG_VERSION,
        blocks: []
      };

      void (async () => {
        try {
          const sourceResolved = await resolvePageByLegacyKey(payload.sourcePageId, true);
          const sourcePayload = await getPageBlocks(sourceResolved.id);
          const sourceCurrent = fromCanonicalBlocks(
            payload.sourcePageId,
            sourcePayload.blocks || [],
            sourceFallback
          );
          const sourceNext: PageConfig = {
            ...sourceCurrent,
            updated_at: nowIso,
            blocks: sourceCurrent.blocks.filter((block) => block.id !== payload.sourceBlockId)
          };
          await savePageBlocks(sourceResolved.id, toCanonicalBlocks(sourceNext));
          syncShadowSnapshot(payload.sourcePageId, sourceNext);
          trace("cross-page-drop:source-updated", {
            sourcePageId: payload.sourcePageId,
            sourceBlockId: payload.sourceBlockId
          });
        } catch (error) {
          trace("cross-page-drop:source-update-error", {
            sourcePageId: payload.sourcePageId,
            sourceBlockId: payload.sourceBlockId,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      })();
    },
    [handlePageConfigChange, pageId, scheduleFlushPageConfig, syncShadowSnapshot, trace]
  );

  const blockGraph = useMemo(() => buildBlockGraph(settings), [settings]);

  return (
    <PageEditor
      pageId={pageId}
      pageConfig={pageConfig}
      onChange={handlePageConfigChange}
      onDropFromAnotherPage={handleDropFromAnotherPage}
      className={className}
      resolveSlot={resolveSlot}
      resolveBlockProps={resolveBlockProps}
      resolveDuplicateProps={resolveDuplicateProps}
      createBlockForType={createBlockForType}
      blockGraph={blockGraph}
    />
  );
};

export default PageBuilderPage;
