import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BlockPanel from "../BlockPanel";
import { useI18n } from "../../i18n";
import { AppBlockConfig, ChartSize, EditableTableToolbarConfig } from "./types";

type EditableContent = {
  title?: string;
  description?: string;
  text?: string;
};

const editableStorageKey = (blockId: string) => `grid_block_content_v1:${blockId}`;

const readEditableContent = (blockId: string): EditableContent => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(editableStorageKey(blockId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as EditableContent;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
};

const writeEditableContent = (blockId: string, content: EditableContent) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(editableStorageKey(blockId), JSON.stringify(content));
  } catch {
    // ignore storage failures
  }
};

const useEditableContent = (blockId: string, initial: EditableContent) => {
  const [content, setContent] = useState<EditableContent>(() => ({
    ...initial,
    ...readEditableContent(blockId)
  }));

  React.useEffect(() => {
    setContent((prev) => ({
      ...initial,
      ...readEditableContent(blockId),
      ...prev
    }));
  }, [blockId, initial.description, initial.text, initial.title]);

  React.useEffect(() => {
    writeEditableContent(blockId, content);
  }, [blockId, content]);

  return [content, setContent] as const;
};

type AutoGrowTextareaProps = {
  value: string;
  className: string;
  placeholder?: string;
  onChange: (next: string) => void;
};

const AutoGrowTextarea: React.FC<AutoGrowTextareaProps> = ({ value, className, placeholder, onChange }) => {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      className={className}
      value={value}
      placeholder={placeholder}
      rows={1}
      onChange={(event) => onChange(event.target.value)}
    />
  );
};

const HeaderEditor: React.FC<{
  id: string;
  title: string;
  description: string;
  className?: string;
  actions?: React.ReactNode;
}> = ({ id, title, description, className = "", actions }) => {
  const [content, setContent] = useEditableContent(id, { title, description });

  return (
    <div className={["panel-header", "block-header-editor", className].filter(Boolean).join(" ")}>
      <div>
        <AutoGrowTextarea
          className="block-edit-title"
          value={content.title || ""}
          onChange={(next) => setContent((prev) => ({ ...prev, title: next }))}
        />
        <AutoGrowTextarea
          className="block-edit-description"
          value={content.description || ""}
          onChange={(next) => setContent((prev) => ({ ...prev, description: next }))}
        />
      </div>
      {actions ? <div className="block-header-actions">{actions}</div> : null}
    </div>
  );
};

const TOOLBAR_MENU_WIDTH = 240;
const TOOLBAR_MENU_HEIGHT_ESTIMATE = 300;
const TOOLBAR_MENU_GUTTER = 12;
const TOOLBAR_MENU_OFFSET = 6;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const EditableTableToolbar: React.FC<{ toolbar: EditableTableToolbarConfig }> = ({ toolbar }) => {
  const { t } = useI18n();
  const [showColumns, setShowColumns] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const leading = toolbar.leading;
  const trailing = toolbar.trailing;
  const search = toolbar.search;
  const columns = toolbar.columns;

  React.useEffect(() => {
    if (!showColumns) {
      setMenuPos(null);
      return;
    }
    const trigger = triggerRef.current;
    if (!trigger) return;
    const update = () => {
      const rect = trigger.getBoundingClientRect();
      const menuWidth = TOOLBAR_MENU_WIDTH;
      const menuHeight = TOOLBAR_MENU_HEIGHT_ESTIMATE;
      const maxLeft = Math.max(TOOLBAR_MENU_GUTTER, window.innerWidth - menuWidth - TOOLBAR_MENU_GUTTER);
      const left = clamp(rect.left, TOOLBAR_MENU_GUTTER, maxLeft);
      const maxTop = Math.max(TOOLBAR_MENU_GUTTER, window.innerHeight - menuHeight - TOOLBAR_MENU_GUTTER);
      const top = clamp(rect.bottom + TOOLBAR_MENU_OFFSET, TOOLBAR_MENU_GUTTER, maxTop);
      setMenuPos({ top, left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const raf = window.requestAnimationFrame(() => setMenuVisible(true));
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.cancelAnimationFrame(raf);
    };
  }, [showColumns]);

  React.useEffect(() => {
    if (!showColumns) return;
    const handleOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setMenuVisible(false);
      setShowColumns(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuVisible(false);
        setShowColumns(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showColumns]);

  React.useEffect(() => {
    if (!columns && showColumns) {
      setMenuVisible(false);
      setShowColumns(false);
    }
  }, [columns, showColumns]);

  if (!leading && !search && !columns && !trailing) return null;

  return (
    <div className="table-toolbar">
      <div className="toolbar-actions-box table-toolbar-box">
        <div className="table-toolbar-main">
          {leading || null}
          {search && (
            <div className="tracker-search">
              <div className="tracker-search-input-wrap">
                <span className="tracker-search-leading" aria-hidden="true">
                  <svg viewBox="0 0 20 20">
                    <path d="M12.9 14 17 18.1l1.1-1.1-4.1-4.1a6.5 6.5 0 1 0-1.1 1.1ZM4.5 8.5a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" />
                  </svg>
                </span>
                <input
                  value={search.value}
                  onChange={(event) => search.onChange(event.target.value)}
                  placeholder={search.placeholder || t("Search")}
                  className="tracker-search-input"
                />
                <div className="tracker-search-actions">
                  {search.value.trim() && (
                    <button
                      type="button"
                      className="tracker-search-clear"
                      onClick={() => search.onChange("")}
                      aria-label={t("Clear search")}
                      title={t("Clear search")}
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M5.22 5.22a.75.75 0 0 1 1.06 0L10 8.94l3.72-3.72a.75.75 0 0 1 1.06 1.06L11.06 10l3.72 3.72a.75.75 0 0 1-1.06 1.06L10 11.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06L8.94 10 5.22 6.28a.75.75 0 0 1 0-1.06Z" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          {columns && (
            <div className="columns-dropdown-trigger">
              <button
                ref={triggerRef}
                className={`select-trigger ${showColumns ? "open" : ""}`}
                type="button"
                onClick={() => {
                  if (showColumns) {
                    setMenuVisible(false);
                    setShowColumns(false);
                    return;
                  }
                  setMenuVisible(false);
                  setShowColumns(true);
                }}
                aria-label={t("Columns")}
              >
                <span className="select-pill" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <svg
                    viewBox="0 0 20 20"
                    aria-hidden="true"
                    style={{ width: 14, height: 14, flex: "0 0 auto" }}
                  >
                    <path d="M10 4.5c-4.2 0-7.7 3-9 5.5 1.3 2.5 4.8 5.5 9 5.5s7.7-3 9-5.5c-1.3-2.5-4.8-5.5-9-5.5Zm0 9c-2 0-3.6-1.6-3.6-3.6S8 6.3 10 6.3s3.6 1.6 3.6 3.6S12 13.5 10 13.5Zm0-5.7c-1.2 0-2.1 1-2.1 2.1S8.8 12 10 12s2.1-1 2.1-2.1S11.2 7.8 10 7.8Z" />
                  </svg>
                  {t("Columns")}
                </span>
                <span className="select-caret">▾</span>
              </button>
            </div>
          )}
        </div>
        {trailing ? <div className="toolbar-actions-right">{trailing}</div> : null}
      </div>
      {showColumns &&
        columns &&
        menuPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className={`select-menu columns-dropdown ${menuVisible ? "open" : ""}`}
            ref={menuRef}
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              width: TOOLBAR_MENU_WIDTH,
              zIndex: 60
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="select-options" role="menu" aria-label={t("Columns")}>
              {columns.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`select-option ${item.visible ? "selected" : ""}`}
                  disabled={item.disabled}
                  onClick={() => {
                    if (item.disabled) return;
                    columns.onToggle(item.key);
                  }}
                >
                  <span className="select-swatch" style={{ backgroundColor: "var(--panel)" }} />
                  <span className="select-label">{item.label}</span>
                  <span className="select-check">{item.visible ? "✓" : ""}</span>
                </button>
              ))}
              {columns.onShowAll && (
                <>
                  <div className="column-menu-separator" />
                  <button type="button" className="select-option" onClick={columns.onShowAll}>
                    <span className="select-swatch" style={{ backgroundColor: "var(--panel)" }} />
                    <span className="select-label">{t("Show all columns")}</span>
                  </button>
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

const chartSizeClass = (size: ChartSize): string => {
  switch (size) {
    case "medium":
      return "chart-size-medium";
    case "large":
      return "chart-size-large";
    case "xlarge":
      return "chart-size-xlarge";
    default:
      return "chart-size-small";
  }
};

const BlockRenderer: React.FC<{ block: AppBlockConfig }> = ({ block }) => {
  const chartClassName = useMemo(() => {
    if (block.type !== "chart") return "";
    return chartSizeClass(block.data.size);
  }, [block]);

  switch (block.type) {
    case "text": {
      const [content, setContent] = useEditableContent(block.id, { text: block.data.text });
      return (
        <BlockPanel id={block.id} as="section">
          <AutoGrowTextarea
            className="block-edit-text"
            value={content.text || ""}
            onChange={(next) => setContent((prev) => ({ ...prev, text: next }))}
          />
        </BlockPanel>
      );
    }

    case "titleDescription": {
      return (
        <BlockPanel id={block.id} as="section">
          <HeaderEditor
            id={block.id}
            title={block.data.title}
            description={block.data.description}
            actions={block.data.actions}
          />
        </BlockPanel>
      );
    }

    case "editableTable": {
      return (
        <BlockPanel
          id={block.id}
          as="section"
          className={["table-panel-standard", block.data.panelClassName || ""].filter(Boolean).join(" ")}
        >
          <HeaderEditor
            id={`${block.id}:header`}
            title={block.data.title}
            description={block.data.description || ""}
            actions={block.data.actions}
          />
          {block.data.toolbar ? <EditableTableToolbar toolbar={block.data.toolbar} /> : null}
          {block.data.content}
        </BlockPanel>
      );
    }

    case "informationalTable": {
      return (
        <BlockPanel id={block.id} as="section">
          <HeaderEditor id={block.id} title={block.data.title} description={block.data.description} />
          {block.data.content}
        </BlockPanel>
      );
    }

    case "calendar": {
      return (
        <BlockPanel id={block.id} as="section">
          <HeaderEditor id={block.id} title={block.data.title} description={block.data.description} />
          {block.data.content}
        </BlockPanel>
      );
    }

    case "chart": {
      return (
        <BlockPanel id={block.id} as="section" className={`chart-panel ${chartClassName}`.trim()}>
          <div className="panel-header panel-header-inline">
            <h3>{block.data.title}</h3>
            {block.data.action}
          </div>
          {block.data.content}
        </BlockPanel>
      );
    }

    case "kpiCard": {
      return (
        <BlockPanel id={block.id} as="section" className="kpi-card-block">
          <p>{block.data.label}</p>
          <h2>{block.data.value}</h2>
        </BlockPanel>
      );
    }

    case "pipeline": {
      return (
        <BlockPanel id={block.id} as="section">
          <HeaderEditor id={block.id} title={block.data.title} description={block.data.description} />
          {block.data.content}
        </BlockPanel>
      );
    }

    default:
      return null;
  }
};

export default BlockRenderer;
