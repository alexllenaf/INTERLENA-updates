import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPageBlocks, resolvePageByLegacyKey, savePageBlocks } from "../../api";
import { summarizePageConfig, tracePageConfig } from "../../pageConfigDebug";
import { useAppData } from "../../state";
import { CanonicalBlock } from "../../types";
import { useUndo } from "../../undoContext";
import PageEditor, { type CrossPageDropPayload } from "./PageEditor";
import { BlockSlotResolver } from "./blockRegistry";
import { createPageConfigFromTemplate } from "./defaultPages";
import { normalizePageConfig, readPageConfig } from "./pageConfigStore";
import { PAGE_CONFIG_VERSION, PageBlockConfig, PageBlockType, PageConfig } from "./types";

type Props = {
  pageId: string;
  className?: string;
  fallbackConfig?: PageConfig;
  resolveSlot?: BlockSlotResolver;
  resolveBlockProps?: (block: PageBlockConfig) => Record<string, unknown> | null;
  resolveDuplicateProps?: (block: PageBlockConfig) => Record<string, unknown> | null;
  createBlockForType?: (type: PageBlockType, id: string) => PageBlockConfig | null;
};

const withTimestamp = (config: PageConfig): PageConfig => ({
  ...config,
  updated_at: new Date().toISOString()
});

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
  const { settings } = useAppData();
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
  const saveTimerRef = useRef<number | null>(null);
  const pendingFlushRef = useRef<PageConfig | null>(null);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const flushPageConfig = useCallback(
    (forceConfig?: PageConfig) => {
      const persist = async () => {
        const nextConfig = forceConfig || pageConfigRef.current;
        const nextJson = JSON.stringify(nextConfig);

        if (!nextJson || nextJson === configSavedJsonRef.current) {
          trace("flush:skip:unchanged", {
            config: summarizePageConfig(nextConfig)
          });
          return;
        }

        trace("flush:start", {
          config: summarizePageConfig(nextConfig),
          hasCanonicalPageId: Boolean(canonicalPageIdRef.current)
        });

        const canonicalPageId = canonicalPageIdRef.current;
        if (!canonicalPageId) {
          trace("flush:skip:no-canonical-page-id", {
            config: summarizePageConfig(nextConfig)
          });
          return;
        }

        try {
          const persisted = await savePageBlocks(canonicalPageId, toCanonicalBlocks(nextConfig));
          const canonicalConfig = withTimestamp(
            fromCanonicalBlocks(pageId, persisted.blocks || [], nextConfig)
          );
          const canonicalJson = JSON.stringify(canonicalConfig);
          pageConfigRef.current = canonicalConfig;
          configLocalJsonRef.current = canonicalJson;
          configSavedJsonRef.current = canonicalJson;
          setPageConfig((prev) => (JSON.stringify(prev) === canonicalJson ? prev : canonicalConfig));
          trace("flush:canonical-success", {
            config: summarizePageConfig(canonicalConfig)
          });
          undoManager.saveCheckpoint();
        } catch (error) {
          trace("flush:canonical-error", {
            message: error instanceof Error ? error.message : String(error)
          });
        }

      };
      void persist();
    },
    [pageId, trace, undoManager]
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
    let cancelled = false;

    const load = async () => {
      trace("rehydrate:start", {
        fallback: summarizePageConfig(fallback)
      });

      try {
        const resolved = await resolvePageByLegacyKey(pageId, true);
        if (cancelled) return;

        canonicalPageIdRef.current = resolved.id;

        const blocksPayload = await getPageBlocks(resolved.id);
        if (cancelled) return;

        const loaded = withTimestamp(fromCanonicalBlocks(pageId, blocksPayload.blocks || [], fallback));
        const loadedJson = JSON.stringify(loaded);

        setPageConfig(loaded);
        pageConfigRef.current = loaded;
        configLocalJsonRef.current = loadedJson;
        configSavedJsonRef.current = loadedJson;

        trace("rehydrate:canonical-success", {
          resolvedPageId: resolved.id,
          config: summarizePageConfig(loaded)
        });

        if ((blocksPayload.blocks || []).length === 0 && fallback.blocks.length > 0) {
          const seeded = withTimestamp(fallback);
          setPageConfig(seeded);
          pageConfigRef.current = seeded;
          configLocalJsonRef.current = JSON.stringify(seeded);
          scheduleFlushPageConfig(seeded);
        }
        return;
      } catch (error) {
        trace("rehydrate:canonical-error", {
          message: error instanceof Error ? error.message : String(error)
        });
        canonicalPageIdRef.current = null;
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
  }, [fallback, pageId, scheduleFlushPageConfig, trace]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const pending = pendingFlushRef.current;
      pendingFlushRef.current = null;
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
      const previousConfig = pageConfigRef.current;

      void executeCommand({
        description: "Edit page",
        timestamp: Date.now(),
        do: () => {
          const applied = withTimestamp(next);
          setPageConfig(applied);
          pageConfigRef.current = applied;
          configLocalJsonRef.current = JSON.stringify(applied);
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
    [handlePageConfigChange, pageId, scheduleFlushPageConfig, trace]
  );

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
    />
  );
};

export default PageBuilderPage;
