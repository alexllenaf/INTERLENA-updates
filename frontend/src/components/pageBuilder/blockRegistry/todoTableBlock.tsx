import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppData } from "../../../state";
import { type Application, type CustomProperty } from "../../../types";
import BlockPanel from "../../BlockPanel";
import {
  TODO_SOURCE_TABLE_LINK_KEY,
  collectEditableTableTargets,
  getBlockLink,
  patchBlockLink
} from "../blockLinks";
import { type PageBlockConfig, type PageBlockPropsMap } from "../types";
import { createSlotContext, renderHeader } from "./shared";
import { SourceTablePreview } from "./sourceTablePreview";
import { type BlockDefinition, type BlockRenderContext, type BlockRenderMode } from "./types";
import { DefaultEditableTable, resolveEditableTableModel } from "./editableTableBlock";

type TodoBlockMenuAction = {
  key: string;
  label: string;
  onClick: () => void;
};

type TodoLinkedTableModel = {
  columns: string[];
  rows: string[][];
};

const TRACKER_BASE_COLUMN_ORDER = [
  "company_name",
  "position",
  "job_type",
  "location",
  "stage",
  "outcome",
  "application_date",
  "interview_datetime",
  "followup_date",
  "interview_rounds",
  "interview_type",
  "interviewers",
  "company_score",
  "contacts",
  "last_round_cleared",
  "total_rounds",
  "my_interview_score",
  "improvement_areas",
  "skill_to_upgrade",
  "job_description",
  "notes",
  "todo_items",
  "documents_links",
  "favorite"
];

const TRACKER_COLUMN_LABELS: Record<string, string> = {
  company_name: "Company",
  position: "Position",
  job_type: "Job Type",
  location: "Location",
  stage: "Stage",
  outcome: "Outcome",
  application_date: "Application Date",
  interview_datetime: "Interview",
  followup_date: "Follow-Up",
  interview_rounds: "Interview Rounds",
  interview_type: "Interview Type",
  interviewers: "Interviewers",
  company_score: "Company Score",
  contacts: "Contacts",
  last_round_cleared: "Last Round Cleared",
  total_rounds: "Total Rounds",
  my_interview_score: "Interview Score",
  improvement_areas: "Improvement Areas",
  skill_to_upgrade: "Skill To Upgrade",
  job_description: "Job Description",
  notes: "Notes",
  todo_items: "To-Do Items",
  documents_links: "Documents / Links",
  favorite: "Favorite"
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeString(item))
    .filter(Boolean);
};

const normalizeCustomProperties = (value: unknown): CustomProperty[] => {
  if (!Array.isArray(value)) return [];
  const out: CustomProperty[] = [];
  value.forEach((entry) => {
    if (!isRecord(entry)) return;
    const key = normalizeString(entry.key);
    if (!key) return;
    const name = normalizeString(entry.name);
    const typeRaw = normalizeString(entry.type);
    const type =
      typeRaw === "select" ||
      typeRaw === "text" ||
      typeRaw === "number" ||
      typeRaw === "date" ||
      typeRaw === "checkbox" ||
      typeRaw === "rating" ||
      typeRaw === "contacts" ||
      typeRaw === "links" ||
      typeRaw === "documents"
        ? typeRaw
        : "text";
    out.push({
      key,
      name: name || key,
      type,
      options: []
    });
  });
  return out;
};

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

const isTrackerSourceProps = (targetProps: Record<string, unknown>): boolean => {
  const schemaRef = normalizeString(targetProps.schemaRef);
  const contentSlotId = normalizeString(targetProps.contentSlotId);
  return schemaRef === "tracker.applications@1" || contentSlotId.startsWith("tracker:content");
};

const buildTrackerSourcePreview = (
  targetProps: Record<string, unknown>,
  settings: unknown,
  applications: Application[]
): TodoLinkedTableModel => {
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

  const usedLabels = new Set<string>();
  const columns: string[] = [];
  const keyByLabel: string[] = [];
  orderedKeys.forEach((key) => {
    const labelOverride = columnLabels[key];
    let labelSeed = typeof labelOverride === "string" ? labelOverride.trim() : "";

    if (key.startsWith("prop__")) {
      const propKey = key.slice("prop__".length);
      const prop = customPropByKey.get(propKey) || null;
      if (!labelSeed) labelSeed = prop?.name || key;
    } else if (!labelSeed) {
      labelSeed = TRACKER_COLUMN_LABELS[key] || key;
    }

    const label = createUniqueLabel(labelSeed || key, usedLabels);
    columns.push(label);
    keyByLabel.push(key);
  });

  const rows = applications.map((app) => keyByLabel.map((columnKey) => trackerValueForColumn(app, columnKey)));

  return {
    columns,
    rows
  };
};

type UseTodoTableBlockConfigArgs = {
  block: PageBlockConfig<"todoTable">;
  mode: BlockRenderMode;
  settings?: unknown;
  patchBlockProps: (patch: Partial<PageBlockPropsMap["todoTable"]>) => void;
  resolveLinkedTableModel: (props: PageBlockPropsMap["editableTable"]) => TodoLinkedTableModel | null;
};

type UseTodoTableBlockConfigResult = {
  menuAction: TodoBlockMenuAction | null;
  modal: React.ReactNode;
};

const useTodoTableBlockConfig = ({
  block,
  mode,
  settings,
  patchBlockProps,
  resolveLinkedTableModel
}: UseTodoTableBlockConfigArgs): UseTodoTableBlockConfigResult => {
  const [isTodoLinkModalOpen, setIsTodoLinkModalOpen] = useState(false);
  const [isTodoLinkMenuOpen, setIsTodoLinkMenuOpen] = useState(false);
  const todoLinkMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isTodoLinkModalOpen || !isTodoLinkMenuOpen) return;
    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (todoLinkMenuRef.current?.contains(event.target)) return;
      setIsTodoLinkMenuOpen(false);
    };
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsTodoLinkMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleDocumentMouseDown);
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [isTodoLinkMenuOpen, isTodoLinkModalOpen]);

  const linkTargets = useMemo(
    () => collectEditableTableTargets(settings, { excludeVariants: ["todo"], excludeTypes: ["todoTable"] }),
    [settings]
  );
  const linkedTableId = getBlockLink(block.props, TODO_SOURCE_TABLE_LINK_KEY);
  const linkedTableTarget = linkedTableId
    ? linkTargets.find((target) => target.blockId === linkedTableId) || null
    : null;
  const linkedTableModel = useMemo(() => {
    if (!linkedTableTarget) return null;
    return resolveLinkedTableModel(linkedTableTarget.props as PageBlockPropsMap["editableTable"]);
  }, [linkedTableTarget, resolveLinkedTableModel]);

  const openTodoLinkPicker = useCallback(() => {
    setIsTodoLinkModalOpen(true);
    setIsTodoLinkMenuOpen(false);
  }, []);

  const closeTodoLinkPicker = useCallback(() => {
    setIsTodoLinkMenuOpen(false);
    setIsTodoLinkModalOpen(false);
  }, []);

  const setTodoLinkedTable = (nextBlockId?: string | null) => {
    patchBlockProps(
      patchBlockLink(block.props, TODO_SOURCE_TABLE_LINK_KEY, nextBlockId) as Partial<PageBlockPropsMap["todoTable"]>
    );
    setIsTodoLinkMenuOpen(false);
  };

  const menuAction = useMemo<TodoBlockMenuAction | null>(() => {
    if (mode !== "edit") return null;
    const linkLabel = linkedTableTarget ? `Tabla vinculada: ${linkedTableTarget.title}` : "Vincular con tabla editable";
    return {
      key: `todo-link-table-${block.id}`,
      label: linkLabel,
      onClick: openTodoLinkPicker
    };
  }, [block.id, linkedTableTarget, mode, openTodoLinkPicker]);

  const modal =
    isTodoLinkModalOpen &&
    typeof document !== "undefined" &&
    createPortal(
      <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={closeTodoLinkPicker}>
        <div className="modal" onClick={(event) => event.stopPropagation()}>
          <header className="modal-header">
            <div>
              <h2>Vincular tabla editable</h2>
              <p>Selecciona una tabla para vincular el To-Do list.</p>
            </div>
            <button className="ghost" type="button" onClick={closeTodoLinkPicker} aria-label="Close">
              ×
            </button>
          </header>
          <div className="todo-link-modal-body">
            <div className="field todo-link-select-field">
              <span>Tabla vinculada</span>
              <div className="todo-link-select-wrap" ref={todoLinkMenuRef}>
                <button
                  type="button"
                  className={`select-trigger ${isTodoLinkMenuOpen ? "open" : ""}`}
                  onClick={() => setIsTodoLinkMenuOpen((prev) => !prev)}
                  aria-haspopup="listbox"
                  aria-expanded={isTodoLinkMenuOpen}
                >
                  <span className="select-pill">
                    {linkedTableTarget ? `[${linkedTableTarget.pageId}] ${linkedTableTarget.title}` : "Sin vinculo"}
                  </span>
                  <span className="select-caret">▾</span>
                </button>
                {isTodoLinkMenuOpen && (
                  <div className="select-menu todo-link-select-menu">
                    {linkTargets.length === 0 ? (
                      <div className="select-empty">No hay tablas editables disponibles.</div>
                    ) : (
                      <div className="select-options" role="listbox" aria-label="Tablas editables">
                        <button
                          type="button"
                          className={`select-option ${!linkedTableId ? "selected" : ""}`}
                          onClick={() => setTodoLinkedTable(null)}
                        >
                          <span className="select-swatch" style={{ backgroundColor: "var(--panel)" }} />
                          <span className="select-label">Sin vinculo</span>
                          <span className="select-check">{!linkedTableId ? "✓" : ""}</span>
                        </button>
                        <div className="column-menu-separator" />
                        {linkTargets.map((target) => {
                          const isActive = target.blockId === linkedTableId;
                          return (
                            <button
                              type="button"
                              key={target.blockId}
                              className={`select-option ${isActive ? "selected" : ""}`}
                              onClick={() => setTodoLinkedTable(target.blockId)}
                            >
                              <span className="select-swatch" style={{ backgroundColor: "var(--panel)" }} />
                              <span className="todo-link-option-copy">
                                <span className="select-label">{target.title}</span>
                                <span className="todo-link-option-meta">
                                  [{target.pageId}] · To-Do: {target.hasTodoColumn ? "Si" : "No"}
                                </span>
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
              <SourceTablePreview table={linkedTableModel} keyPrefix="todo-link-preview" />
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

  return {
    menuAction,
    modal
  };
};

const TableExpandButton: React.FC<{ isExpanded: boolean; onToggle: () => void }> = ({ isExpanded, onToggle }) => (
  <button
    className="icon-button table-panel-expand"
    type="button"
    onClick={onToggle}
    aria-label={isExpanded ? "Close expanded table" : "Expand table"}
  >
    {isExpanded ? (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M5.22 4.16a.75.75 0 0 1 1.06 0L10 7.88l3.72-3.72a.75.75 0 1 1 1.06 1.06L11.06 8.94l3.72 3.72a.75.75 0 1 1-1.06 1.06L10 10l-3.72 3.72a.75.75 0 0 1-1.06-1.06l3.72-3.72-3.72-3.72a.75.75 0 0 1 0-1.06Z" />
      </svg>
    ) : (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M11 3a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0V4.41l-4.29 4.3a1 1 0 0 1-1.42-1.42L14.59 3H12a1 1 0 0 1-1-1Zm-2 14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-5a1 1 0 1 1 2 0v3.59l4.29-4.3a1 1 0 1 1 1.42 1.42L5.41 16H8a1 1 0 0 1 1 1Z" />
      </svg>
    )}
  </button>
);

const TodoTableBlockPanel: React.FC<BlockRenderContext<"todoTable">> = ({
  block,
  mode,
  patchBlockProps,
  updateBlockProps,
  resolveSlot,
  menuActions
}) => {
  const { settings, saveSettings, applications } = useAppData();
  const [isTableExpanded, setIsTableExpanded] = useState(false);

  useEffect(() => {
    if (!isTableExpanded) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsTableExpanded(false);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isTableExpanded]);

  const todoTableConfig = useTodoTableBlockConfig({
    block,
    mode,
    settings,
    patchBlockProps,
    resolveLinkedTableModel: (props) => {
      const sourceProps = props as unknown as Record<string, unknown>;
      if (isTrackerSourceProps(sourceProps)) {
        return buildTrackerSourcePreview(sourceProps, settings, applications);
      }
      const model = resolveEditableTableModel(props, {
        settings,
        saveSettings
      });
      return {
        columns: model.columns,
        rows: model.rows
      };
    }
  });

  const density = settings?.table_density || "comfortable";
  const blockMenuActions = useMemo(() => {
    const baseActions = menuActions || [];
    const actions = [
      {
        key: `table-density-comfortable-${block.id}`,
        label: `${density === "comfortable" ? "[x]" : "[ ]"} Density: Comfortable`,
        onClick: () => {
          if (density === "comfortable") return;
          saveSettings({ table_density: "comfortable" });
        }
      },
      {
        key: `table-density-compact-${block.id}`,
        label: `${density === "compact" ? "[x]" : "[ ]"} Density: Compact`,
        onClick: () => {
          if (density === "compact") return;
          saveSettings({ table_density: "compact" });
        }
      }
    ];
    if (todoTableConfig.menuAction) {
      actions.push(todoTableConfig.menuAction);
    }
    return [...actions, ...baseActions];
  }, [block.id, density, menuActions, saveSettings, todoTableConfig.menuAction]);

  const slotContext = createSlotContext(mode, updateBlockProps, patchBlockProps);
  const actions = block.props.actionsSlotId ? resolveSlot?.(block.props.actionsSlotId, block, slotContext) : null;
  const toolbar = block.props.toolbarSlotId ? resolveSlot?.(block.props.toolbarSlotId, block, slotContext) : null;
  const content = block.props.contentSlotId ? resolveSlot?.(block.props.contentSlotId, block, slotContext) : null;
  const toolbarActions = block.props.toolbarActionsSlotId
    ? resolveSlot?.(block.props.toolbarActionsSlotId, block, slotContext)
    : null;
  const usesFallbackTable = !toolbar && !content;
  const panelClassName = [
    "table-panel-standard",
    `density-${density}`,
    block.props.panelClassName || "",
    isTableExpanded ? "table-panel-expanded" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const fallbackTable = (
    <DefaultEditableTable
      block={block as unknown as PageBlockConfig<"editableTable">}
      mode={mode}
      settings={settings}
      saveSettings={saveSettings}
      patchBlockProps={(patch) => patchBlockProps(patch as Partial<PageBlockPropsMap["todoTable"]>)}
      extraActions={toolbarActions}
      isExpanded={isTableExpanded}
      onToggleExpanded={() => setIsTableExpanded((prev) => !prev)}
    />
  );

  return (
    <>
      <BlockPanel id={block.id} as="section" className={panelClassName} menuActions={blockMenuActions}>
        {renderHeader(
          block.id,
          mode,
          block.props.title || "",
          block.props.description || "",
          (patch) => patchBlockProps(patch),
          actions
        )}
        {!usesFallbackTable && (
          <TableExpandButton isExpanded={isTableExpanded} onToggle={() => setIsTableExpanded((prev) => !prev)} />
        )}
        {toolbar || content ? (
          <>
            {toolbar}
            {content || fallbackTable}
          </>
        ) : (
          fallbackTable
        )}
      </BlockPanel>
      {todoTableConfig.modal}
      {isTableExpanded &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="modal-backdrop table-expand-backdrop"
            role="presentation"
            onClick={() => setIsTableExpanded(false)}
          />,
          document.body
        )}
    </>
  );
};

export const TODO_TABLE_BLOCK_DEFINITION: BlockDefinition<"todoTable"> = {
  type: "todoTable",
  defaultLayout: { colSpan: 60 },
  createDefaultProps: () => ({
    title: "To-Do List",
    description: "Manage preparation tasks linked to each application.",
    variant: "todo",
    searchPlaceholder: "Search to-dos...",
    addActionLabel: "Add Row",
    toolbarSlotId: "calendar:todo:toolbar",
    contentSlotId: "calendar:todo:content",
    customColumns: ["Task", "Due Date", "Status"],
    customColumnTypes: {},
    customRows: [["", "", ""]]
  }),
  component: (ctx) => <TodoTableBlockPanel {...ctx} />
};
