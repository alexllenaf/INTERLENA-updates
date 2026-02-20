import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppData } from "../../../state";
import { type Application, type CustomProperty } from "../../../types";
import {
  TRACKER_BASE_COLUMN_ORDER,
  TRACKER_COLUMN_LABELS,
  TRACKER_COLUMN_KINDS
} from "../../../shared/columnSchema";
import {
  isRecord,
  normalizeString,
  normalizeStringArray,
  normalizeCustomProperties,
  customPropertyKind
} from "../../../shared/normalize";
import BlockPanel from "../../BlockPanel";
import {
  PIPELINE_SOURCE_TABLE_LINK_KEY,
  collectEditableTableTargets,
  getBlockLink,
  patchBlockLink
} from "../blockLinks";
import { type EditableTableColumnKind, type PageBlockPropsMap } from "../types";
import { resolveEditableTableModel } from "./editableTableBlock";
import { createSlotContext, renderHeader } from "./shared";
import { SourceTablePreview } from "./sourceTablePreview";
import { type BlockDefinition } from "./types";

type PipelineLinkedTableModel = {
  columns: string[];
  rows: string[][];
  columnKinds: Record<string, EditableTableColumnKind>;
};

type PipelineTableTarget = ReturnType<typeof collectEditableTableTargets>[number];

const createUniqueLabel = (label: string, used: Set<string>): string => {
  const base = label.trim() || "Column";
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let attempt = 2;
  while (used.has(`${base} (${attempt})`)) {
    attempt += 1;
  }
  const next = `${base} (${attempt})`;
  used.add(next);
  return next;
};

const trackerValueForColumn = (app: Application, key: string): string => {
  if (key.startsWith("prop__")) {
    const propertyKey = key.slice("prop__".length);
    return app.properties?.[propertyKey] || "";
  }
  if (key === "contacts") {
    return (app.contacts || [])
      .map((contact) => contact.name || "")
      .filter(Boolean)
      .join(" | ");
  }
  if (key === "todo_items") {
    return (app.todo_items || [])
      .map((todo) => todo.task || "")
      .filter(Boolean)
      .join(" | ");
  }
  if (key === "documents_links") {
    return app.documents_links || "";
  }
  if (key === "favorite") {
    return app.favorite ? "true" : "false";
  }
  const raw = (app as Record<string, unknown>)[key];
  if (raw === null || raw === undefined) return "";
  return String(raw);
};

const isTrackerSourceTarget = (target: PipelineTableTarget): boolean => {
  const schemaRef = normalizeString(target.props.schemaRef);
  const contentSlotId = normalizeString(target.props.contentSlotId);
  return (
    schemaRef === "tracker.applications@1" ||
    target.blockId === "tracker:table" ||
    contentSlotId.startsWith("tracker:content")
  );
};

const buildTrackerSourceModel = (
  targetProps: Record<string, unknown>,
  settings: unknown,
  applications: Application[]
): PipelineLinkedTableModel => {
  const settingsRecord = isRecord(settings) ? settings : {};
  const columnLabels = isRecord(settingsRecord.column_labels)
    ? (settingsRecord.column_labels as Record<string, unknown>)
    : {};
  const customProps = normalizeCustomProperties(settingsRecord.custom_properties);
  const customPropByKey = new Map(customProps.map((prop) => [prop.key, prop]));
  const overrideOrder = isRecord(targetProps.overrides)
    ? normalizeStringArray((targetProps.overrides as Record<string, unknown>).columnOrder)
    : [];
  const settingsOrder = normalizeStringArray(settingsRecord.table_columns);

  const orderedKeys: string[] = [];
  const pushKey = (key: string) => {
    const normalized = key.trim();
    if (!normalized || orderedKeys.includes(normalized)) return;
    orderedKeys.push(normalized);
  };

  (overrideOrder.length > 0 ? overrideOrder : settingsOrder).forEach(pushKey);
  TRACKER_BASE_COLUMN_ORDER.forEach(pushKey);
  customProps.forEach((prop) => pushKey(`prop__${prop.key}`));

  const columns: string[] = [];
  const keyByLabel: string[] = [];
  const columnKinds: Record<string, EditableTableColumnKind> = {};
  const usedLabels = new Set<string>();
  orderedKeys.forEach((key) => {
    const labelOverride = columnLabels[key];
    let labelSeed = typeof labelOverride === "string" ? labelOverride.trim() : "";
    let kind: EditableTableColumnKind = "text";

    if (key.startsWith("prop__")) {
      const propKey = key.slice("prop__".length);
      const prop = customPropByKey.get(propKey) || null;
      if (!labelSeed) labelSeed = prop?.name || key;
      kind = customPropertyKind(prop);
    } else {
      if (!labelSeed) labelSeed = TRACKER_COLUMN_LABELS[key] || key;
      kind = TRACKER_COLUMN_KINDS[key] || "text";
    }

    const label = createUniqueLabel(labelSeed || key, usedLabels);
    columns.push(label);
    keyByLabel.push(key);
    columnKinds[label] = kind;
  });

  const rows = applications.map((app) => keyByLabel.map((columnKey) => trackerValueForColumn(app, columnKey)));

  return {
    columns,
    rows,
    columnKinds
  };
};

export const PIPELINE_BLOCK_DEFINITION: BlockDefinition<"pipeline"> = {
  type: "pipeline",
  defaultLayout: { colSpan: 60 },
  createDefaultProps: () => ({
    title: "Pipeline",
    description: "Track stages as opportunities move."
  }),
  component: ({ block, mode, patchBlockProps, updateBlockProps, resolveSlot, menuActions }) => {
    const { settings, saveSettings, applications } = useAppData();
    const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
    const [isLinkMenuOpen, setIsLinkMenuOpen] = useState(false);
    const [isSourceColumnMenuOpen, setIsSourceColumnMenuOpen] = useState(false);
    const linkMenuRef = useRef<HTMLDivElement | null>(null);
    const sourceColumnMenuRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      if (!isLinkModalOpen || !isLinkMenuOpen) return;
      const handleDocumentMouseDown = (event: MouseEvent) => {
        if (!(event.target instanceof Node)) return;
        if (linkMenuRef.current?.contains(event.target)) return;
        setIsLinkMenuOpen(false);
      };
      const handleWindowKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          setIsLinkMenuOpen(false);
        }
      };
      document.addEventListener("mousedown", handleDocumentMouseDown);
      window.addEventListener("keydown", handleWindowKeyDown);
      return () => {
        document.removeEventListener("mousedown", handleDocumentMouseDown);
        window.removeEventListener("keydown", handleWindowKeyDown);
      };
    }, [isLinkMenuOpen, isLinkModalOpen]);

    useEffect(() => {
      if (!isSourceColumnMenuOpen) return;
      const handleDocumentMouseDown = (event: MouseEvent) => {
        if (!(event.target instanceof Node)) return;
        if (sourceColumnMenuRef.current?.contains(event.target)) return;
        setIsSourceColumnMenuOpen(false);
      };
      const handleWindowKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          setIsSourceColumnMenuOpen(false);
        }
      };
      document.addEventListener("mousedown", handleDocumentMouseDown);
      window.addEventListener("keydown", handleWindowKeyDown);
      return () => {
        document.removeEventListener("mousedown", handleDocumentMouseDown);
        window.removeEventListener("keydown", handleWindowKeyDown);
      };
    }, [isSourceColumnMenuOpen]);

    const tableTargets = useMemo(
      () => collectEditableTableTargets(settings, { excludeVariants: ["todo"], excludeTypes: ["todoTable"] }),
      [settings]
    );
    const linkedTableId = getBlockLink(block.props, PIPELINE_SOURCE_TABLE_LINK_KEY);
    const linkedTableTarget = linkedTableId
      ? tableTargets.find((target) => target.blockId === linkedTableId) || null
      : null;
    const resolveLinkedTableModel = useCallback(
      (target: PipelineTableTarget | null): PipelineLinkedTableModel | null => {
        if (!target) return null;
        if (isTrackerSourceTarget(target)) {
          return buildTrackerSourceModel(target.props, settings, applications);
        }
        const model = resolveEditableTableModel(target.props as PageBlockPropsMap["editableTable"], {
          settings,
          saveSettings
        });
        return {
          columns: model.columns,
          rows: model.rows,
          columnKinds: model.columnKinds
        };
      },
      [applications, saveSettings, settings]
    );
    const linkedTableModel = useMemo(
      () => resolveLinkedTableModel(linkedTableTarget),
      [linkedTableTarget, resolveLinkedTableModel]
    );
    const selectableColumns = useMemo(
      () =>
        linkedTableModel?.columns.filter((column) => linkedTableModel.columnKinds[column] === "select") || [],
      [linkedTableModel]
    );
    const selectedSourceColumn = selectableColumns.includes(block.props.sourceColumn || "")
      ? (block.props.sourceColumn as string)
      : "";

    const openLinkPicker = useCallback(() => {
      setIsLinkModalOpen(true);
      setIsLinkMenuOpen(false);
      setIsSourceColumnMenuOpen(false);
    }, []);

    const closeLinkPicker = useCallback(() => {
      setIsLinkMenuOpen(false);
      setIsLinkModalOpen(false);
    }, []);

    const setLinkedTable = (nextBlockId?: string | null) => {
      const nextTarget = nextBlockId
        ? tableTargets.find((target) => target.blockId === nextBlockId) || null
        : null;
      const nextModel = resolveLinkedTableModel(nextTarget);
      const nextSelectableColumns =
        nextModel?.columns.filter((column) => nextModel.columnKinds[column] === "select") || [];
      const nextSourceColumn = nextSelectableColumns.includes(block.props.sourceColumn || "")
        ? (block.props.sourceColumn as string)
        : nextSelectableColumns[0] || undefined;

      patchBlockProps({
        ...(patchBlockLink(
          block.props,
          PIPELINE_SOURCE_TABLE_LINK_KEY,
          nextBlockId || null
        ) as Partial<PageBlockPropsMap["pipeline"]>),
        sourceColumn: nextSourceColumn
      });
      setIsLinkMenuOpen(false);
      setIsSourceColumnMenuOpen(false);
    };

    const setSourceColumn = (nextColumn?: string) => {
      patchBlockProps({
        sourceColumn: nextColumn || undefined
      });
      setIsSourceColumnMenuOpen(false);
    };

    const blockMenuActions = useMemo(() => {
      if (mode !== "edit") return menuActions;
      const linkLabel = linkedTableTarget ? `Tabla vinculada: ${linkedTableTarget.title}` : "Vincular con tabla editable";
      return [
        {
          key: `pipeline-link-table-${block.id}`,
          label: linkLabel,
          onClick: openLinkPicker
        },
        ...(menuActions || [])
      ];
    }, [block.id, linkedTableTarget, menuActions, mode, openLinkPicker]);

    const slotContext = createSlotContext(mode, updateBlockProps, patchBlockProps);
    const slot = block.props.contentSlotId ? resolveSlot?.(block.props.contentSlotId, block, slotContext) : null;
    const modal =
      isLinkModalOpen &&
      typeof document !== "undefined" &&
      createPortal(
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={closeLinkPicker}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <div>
                <h2>Vincular tabla editable</h2>
                <p>Selecciona una tabla para usarla como fuente del pipeline.</p>
              </div>
              <button className="ghost" type="button" onClick={closeLinkPicker} aria-label="Close">
                ×
              </button>
            </header>
            <div className="todo-link-modal-body">
              <div className="field todo-link-select-field">
                <span>Tabla vinculada</span>
                <div className="todo-link-select-wrap" ref={linkMenuRef}>
                  <button
                    type="button"
                    className={`select-trigger ${isLinkMenuOpen ? "open" : ""}`}
                    onClick={() => setIsLinkMenuOpen((prev) => !prev)}
                    aria-haspopup="listbox"
                    aria-expanded={isLinkMenuOpen}
                  >
                    <span className="select-pill">
                      {linkedTableTarget ? `[${linkedTableTarget.pageId}] ${linkedTableTarget.title}` : "Sin vinculo"}
                    </span>
                    <span className="select-caret">▾</span>
                  </button>
                  {isLinkMenuOpen && (
                    <div className="select-menu todo-link-select-menu">
                      {tableTargets.length === 0 ? (
                        <div className="select-empty">No hay tablas editables disponibles.</div>
                      ) : (
                        <div className="select-options" role="listbox" aria-label="Tablas editables">
                          <button
                            type="button"
                            className={`select-option ${!linkedTableId ? "selected" : ""}`}
                            onClick={() => setLinkedTable(null)}
                          >
                            <span className="select-swatch" style={{ backgroundColor: "var(--panel)" }} />
                            <span className="select-label">Sin vinculo</span>
                            <span className="select-check">{!linkedTableId ? "✓" : ""}</span>
                          </button>
                          <div className="column-menu-separator" />
                          {tableTargets.map((target) => {
                            const isActive = target.blockId === linkedTableId;
                            return (
                              <button
                                type="button"
                                key={target.blockId}
                                className={`select-option ${isActive ? "selected" : ""}`}
                                onClick={() => setLinkedTable(target.blockId)}
                              >
                                <span className="select-swatch" style={{ backgroundColor: "var(--panel)" }} />
                                <span className="todo-link-option-copy">
                                  <span className="select-label">{target.title}</span>
                                  <span className="todo-link-option-meta">[{target.pageId}]</span>
                                </span>
                                <span className="select-check">{isActive ? "✓" : ""}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {linkedTableModel ? (
                <SourceTablePreview table={linkedTableModel} keyPrefix="pipeline-link-preview" />
              ) : (
                <p className="todo-link-preview-empty">Selecciona una tabla para ver la vista previa.</p>
              )}
              {linkedTableId && !linkedTableTarget && (
                <p className="kpi-edit-hint">La tabla vinculada ya no existe. Selecciona otra.</p>
              )}
            </div>
          </div>
        </div>,
        document.body
      );

    return (
      <>
        <BlockPanel id={block.id} as="section" menuActions={blockMenuActions}>
          {renderHeader(
            block.id,
            mode,
            block.props.title || "",
            block.props.description || "",
            (patch) => patchBlockProps(patch)
          )}
          {mode === "edit" && (
            <div className="field pipeline-source-column-field">
              <div className="pipeline-source-column-head">
                <label htmlFor={`pipeline-source-column-${block.id}`}>Columna de tipo select</label>
                <span className="pipeline-source-column-badge">{selectableColumns.length} disponibles</span>
              </div>
              <div className="pipeline-source-column-control" ref={sourceColumnMenuRef}>
                <button
                  id={`pipeline-source-column-${block.id}`}
                  type="button"
                  className={`select-trigger ${isSourceColumnMenuOpen ? "open" : ""}`}
                  onClick={() => setIsSourceColumnMenuOpen((prev) => !prev)}
                  aria-haspopup="listbox"
                  aria-expanded={isSourceColumnMenuOpen}
                  disabled={!linkedTableTarget || selectableColumns.length === 0}
                >
                  <span className="select-pill">
                    {selectedSourceColumn ||
                      (!linkedTableTarget
                        ? "Vincula una tabla para habilitar columnas"
                        : selectableColumns.length === 0
                          ? "No hay columnas de tipo select en la tabla"
                          : "Selecciona una columna")}
                  </span>
                  <span className="select-caret">▾</span>
                </button>
                {isSourceColumnMenuOpen && (
                  <div className="select-menu pipeline-source-column-menu">
                    <div className="select-options" role="listbox" aria-label="Columnas select disponibles">
                      <button
                        type="button"
                        className={`select-option ${!selectedSourceColumn ? "selected" : ""}`}
                        onClick={() => setSourceColumn(undefined)}
                      >
                        <span className="select-swatch" style={{ backgroundColor: "var(--panel)" }} />
                        <span className="select-label">Sin columna</span>
                        <span className="select-check">{!selectedSourceColumn ? "✓" : ""}</span>
                      </button>
                      <div className="column-menu-separator" />
                      {selectableColumns.map((column) => {
                        const isActive = column === selectedSourceColumn;
                        return (
                          <button
                            type="button"
                            key={column}
                            className={`select-option ${isActive ? "selected" : ""}`}
                            onClick={() => setSourceColumn(column)}
                          >
                            <span className="select-swatch" style={{ backgroundColor: "var(--panel)" }} />
                            <span className="select-label">{column}</span>
                            <span className="select-check">{isActive ? "✓" : ""}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
              <p className="pipeline-source-column-hint">
                {linkedTableTarget
                  ? `Tabla fuente: ${linkedTableTarget.title}`
                  : "Selecciona una tabla fuente desde el menu de 3 puntos."}
              </p>
            </div>
          )}
          <div className="pipeline-board-wrap">{slot || <div className="empty">Pipeline content is not connected yet.</div>}</div>
        </BlockPanel>
        {modal}
      </>
    );
  }
};
