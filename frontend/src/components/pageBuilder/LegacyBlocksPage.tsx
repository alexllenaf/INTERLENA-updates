import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppBlockConfig } from "../blocks/types";
import { EditableTableToolbar } from "../blocks/BlockRenderer";
import { useAppData } from "../../state";
import PageEditor from "./PageEditor";
import { BlockSlotResolver } from "./blockRegistry";
import {
  normalizePageConfig,
  persistPageConfigLocal,
  readPageConfig,
  writePageConfig
} from "./pageConfigStore";
import { PageBlockConfig, PageConfig } from "./types";

type LegacyPageModel = {
  fallbackConfig: PageConfig;
  slots: Record<string, React.ReactNode>;
};

type Props = {
  pageId: string;
  blocks: AppBlockConfig[];
  className?: string;
};

const slotIdFor = (pageId: string, blockId: string, slotName: string) => `${pageId}:${blockId}:${slotName}`;

const toPrimitiveValue = (value: React.ReactNode): string | null => {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
};

const buildPageModel = (pageId: string, blocks: AppBlockConfig[]): LegacyPageModel => {
  const slots: Record<string, React.ReactNode> = {};
  const mappedBlocks: PageBlockConfig[] = blocks.map((block) => {
    const layout = { ...block.layout };

    if (block.type === "text") {
      return {
        id: block.id,
        type: "text",
        layout,
        props: {
          text: block.data.text
        }
      };
    }

    if (block.type === "titleDescription") {
      const actionsSlotId =
        block.data.actions !== undefined
          ? slotIdFor(pageId, block.id, "actions")
          : undefined;
      if (actionsSlotId) {
        slots[actionsSlotId] = block.data.actions || null;
      }
      return {
        id: block.id,
        type: "titleDescription",
        layout,
        props: {
          title: block.data.title,
          description: block.data.description,
          actionsSlotId
        }
      };
    }

    if (block.type === "editableTable") {
      const actionsSlotId =
        block.data.actions !== undefined
          ? slotIdFor(pageId, block.id, "actions")
          : undefined;
      const toolbarSlotId =
        block.data.toolbar !== undefined
          ? slotIdFor(pageId, block.id, "toolbar")
          : undefined;
      const contentSlotId = slotIdFor(pageId, block.id, "content");

      if (actionsSlotId) slots[actionsSlotId] = block.data.actions || null;
      if (toolbarSlotId) {
        slots[toolbarSlotId] = <EditableTableToolbar toolbar={block.data.toolbar!} />;
      }
      slots[contentSlotId] = block.data.content;

      return {
        id: block.id,
        type: "editableTable",
        layout,
        props: {
          title: block.data.title,
          description: block.data.description,
          panelClassName: block.data.panelClassName,
          actionsSlotId,
          toolbarSlotId,
          contentSlotId
        }
      };
    }

    if (block.type === "informationalTable") {
      const contentSlotId = slotIdFor(pageId, block.id, "content");
      slots[contentSlotId] = block.data.content;
      return {
        id: block.id,
        type: "informationalTable",
        layout,
        props: {
          title: block.data.title,
          description: block.data.description,
          contentSlotId
        }
      };
    }

    if (block.type === "calendar") {
      const contentSlotId = slotIdFor(pageId, block.id, "content");
      slots[contentSlotId] = block.data.content;
      return {
        id: block.id,
        type: "calendar",
        layout,
        props: {
          title: block.data.title,
          description: block.data.description,
          contentSlotId
        }
      };
    }

    if (block.type === "chart") {
      const actionSlotId =
        block.data.action !== undefined
          ? slotIdFor(pageId, block.id, "action")
          : undefined;
      const contentSlotId = slotIdFor(pageId, block.id, "content");
      if (actionSlotId) slots[actionSlotId] = block.data.action || null;
      slots[contentSlotId] = block.data.content;
      return {
        id: block.id,
        type: "chart",
        layout,
        props: {
          title: block.data.title,
          size: block.data.size,
          actionSlotId,
          contentSlotId
        }
      };
    }

    if (block.type === "kpiCard") {
      const primitiveValue = toPrimitiveValue(block.data.value);
      if (primitiveValue !== null) {
        return {
          id: block.id,
          type: "kpi",
          layout,
          props: {
            label: block.data.label,
            value: primitiveValue
          }
        };
      }
      const valueSlotId = slotIdFor(pageId, block.id, "value");
      slots[valueSlotId] = block.data.value;
      return {
        id: block.id,
        type: "kpi",
        layout,
        props: {
          label: block.data.label,
          valueSlotId
        }
      };
    }

    const contentSlotId = slotIdFor(pageId, block.id, "content");
    slots[contentSlotId] = block.data.content;
    return {
      id: block.id,
      type: "pipeline",
      layout,
      props: {
        title: block.data.title,
        description: block.data.description,
        contentSlotId
      }
    };
  });

  return {
    fallbackConfig: {
      id: pageId,
      version: 1,
      blocks: mappedBlocks
    },
    slots
  };
};

const LegacyBlocksPage: React.FC<Props> = ({ pageId, blocks, className = "" }) => {
  const { settings, saveSettings } = useAppData();
  const pageModel = useMemo(() => buildPageModel(pageId, blocks), [blocks, pageId]);
  const [pageConfig, setPageConfig] = useState<PageConfig>(() => pageModel.fallbackConfig);

  const configSavedJsonRef = useRef<string>("");
  const configLocalJsonRef = useRef<string>("");
  const pageConfigRef = useRef<PageConfig>(pageConfig);
  const configSaveTimerRef = useRef<number | null>(null);
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
        if (!currentSettings || !nextConfig) return;
        const nextJson = JSON.stringify(nextConfig);
        if (!nextJson || nextJson === configSavedJsonRef.current) return;
        const updated = await saveSettingsRef.current(writePageConfig(currentSettings, pageId, nextConfig));
        if (updated) {
          configSavedJsonRef.current = nextJson;
        }
      };
      void persist();
    },
    [pageId]
  );

  useEffect(() => {
    pageConfigRef.current = pageConfig;
    configLocalJsonRef.current = JSON.stringify(pageConfig);
  }, [pageConfig]);

  useEffect(() => {
    if (!settings) return;
    const fromSettings = normalizePageConfig(pageId, settings.page_configs?.[pageId], pageModel.fallbackConfig);
    const loaded = readPageConfig(settings, pageId, pageModel.fallbackConfig);
    const loadedJson = JSON.stringify(loaded);
    const settingsJson = JSON.stringify(fromSettings);
    const hasUnsavedLocal =
      configLocalJsonRef.current &&
      configLocalJsonRef.current !== configSavedJsonRef.current;
    if (hasUnsavedLocal && loadedJson === configSavedJsonRef.current) {
      return;
    }
    configSavedJsonRef.current = loadedJson === settingsJson ? loadedJson : settingsJson;
    setPageConfig(loaded);
  }, [pageId, pageModel.fallbackConfig, settings]);

  useEffect(() => {
    if (configSaveTimerRef.current) {
      window.clearTimeout(configSaveTimerRef.current);
      configSaveTimerRef.current = null;
    }
    if (!settings) return;
    const nextJson = JSON.stringify(pageConfig);
    if (!nextJson || nextJson === configSavedJsonRef.current) return;
    configSaveTimerRef.current = window.setTimeout(() => {
      configSaveTimerRef.current = null;
      flushPageConfig(pageConfig);
    }, 260);
  }, [flushPageConfig, pageConfig, settings]);

  useEffect(() => {
    return () => {
      if (configSaveTimerRef.current) {
        window.clearTimeout(configSaveTimerRef.current);
        configSaveTimerRef.current = null;
      }
      flushPageConfig();
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

  const resolveSlot = useCallback<BlockSlotResolver>(
    (slotId) => pageModel.slots[slotId] || null,
    [pageModel.slots]
  );

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
      const currentSettings = settingsRef.current;
      if (currentSettings) {
        settingsRef.current = writePageConfig(currentSettings, pageId, stamped);
      }
    },
    [pageId]
  );

  return (
    <PageEditor
      pageId={pageId}
      pageConfig={pageConfig}
      onChange={handlePageConfigChange}
      className={className}
      resolveSlot={resolveSlot}
    />
  );
};

export default LegacyBlocksPage;
