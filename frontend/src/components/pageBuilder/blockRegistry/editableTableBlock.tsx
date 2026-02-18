import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { saveBlobAsFile } from "../../../api";
import { useAppData } from "../../../state";
import BlockPanel from "../../BlockPanel";
import { type SelectOption } from "../../TableCells";
import TrackerSearchBar from "../../tracker/TrackerSearchBar";
import {
  TYPE_REGISTRY,
  type ColumnTypeDef,
  type SaveSettingsFn,
  type TypeRegistryContext
} from "../../dataTypes/typeRegistry";
import { EditableTableToolbar } from "../../blocks/BlockRenderer";
import {
  type EditableTableColumnKind,
  type EditableTableSelectOption,
  type TableOverrides,
  type PageBlockConfig,
  type PageBlockPropsMap
} from "../types";
import {
  TODO_SOURCE_TABLE_LINK_KEY,
  collectEditableTableTargets,
  getBlockLink,
  patchBlockLink
} from "../blockLinks";
import { getTableSchema } from "../tableSchemaRegistry";
import { createSlotContext, renderHeader } from "./shared";
import { type BlockDefinition, type BlockRenderContext, type BlockRenderMode } from "./types";
import {
  ColumnMenuChevronRight,
  columnMenuIconCalc,
  columnMenuIconChangeType,
  columnMenuIconDuplicate,
  columnMenuIconFilter,
  columnMenuIconFit,
  columnMenuIconGroup,
  columnMenuIconHide,
  columnMenuIconInsertLeft,
  columnMenuIconInsertRight,
  columnMenuIconPin,
  columnMenuIconSort,
  columnMenuIconTrash,
  columnMenuIconTypeCheckbox,
  columnMenuIconTypeContacts,
  columnMenuIconTypeDate,
  columnMenuIconTypeDocuments,
  columnMenuIconTypeLinks,
  columnMenuIconTypeNumber,
  columnMenuIconTypeRating,
  columnMenuIconTypeSelect,
  columnMenuIconTypeText,
  columnMenuIconTypeTodo
} from "../../columnMenuIcons";

const DEFAULT_TABLE_COLUMNS = ["Column 1", "Column 2", "Column 3"];
const DEFAULT_TABLE_ROWS = [["", "", ""]];
const MAX_TABLE_COLUMNS = 24;
const MAX_TABLE_ROWS = 1200;
const DEFAULT_TABLE_COLUMN_WIDTH = 180;
const HEADER_ICON_WIDTH_BUDGET = 80;
const COLUMN_MENU_WIDTH = 240;
const COLUMN_MENU_GUTTER = 12;
const COLUMN_MENU_OFFSET = 6;
const COLUMN_MENU_X_OFFSET = -6;
const COLUMN_MENU_HEIGHT_ESTIMATE = 420;
const COLUMN_MENU_ANIM_MS = 160;
const TABLE_COLUMN_KINDS: TableColumnKind[] = [
  "text",
  "number",
  "select",
  "date",
  "checkbox",
  "rating",
  "todo",
  "contacts",
  "links",
  "documents"
];
const TABLE_COLUMN_KIND_SET = new Set<TableColumnKind>(TABLE_COLUMN_KINDS);

const normalizeTableColumns = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [...DEFAULT_TABLE_COLUMNS];
  const parsed = raw
    .map((value) => (typeof value === "string" ? value : ""))
    .slice(0, MAX_TABLE_COLUMNS);
  return parsed.length > 0 ? parsed : [...DEFAULT_TABLE_COLUMNS];
};

const normalizeTableRows = (raw: unknown, columnCount: number): string[][] => {
  const normalizedColumnCount = Math.max(1, Math.min(columnCount, MAX_TABLE_COLUMNS));
  if (!Array.isArray(raw)) {
    return DEFAULT_TABLE_ROWS.map((row) =>
      Array.from({ length: normalizedColumnCount }, (_, index) => row[index] || "")
    );
  }
  return raw
    .slice(0, MAX_TABLE_ROWS)
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) =>
      Array.from({ length: normalizedColumnCount }, (_, index) => {
        const value = row[index];
        return typeof value === "string" ? value : "";
      })
    );
};

const normalizeTableColumnKinds = (
  raw: unknown,
  columnList: string[]
): Record<string, TableColumnKind> => {
  if (!raw || typeof raw !== "object") return {};
  const parsed = raw as Record<string, unknown>;
  const allowed = new Set(columnList);
  const next: Record<string, TableColumnKind> = {};
  Object.entries(parsed).forEach(([key, value]) => {
    if (!allowed.has(key)) return;
    if (typeof value !== "string") return;
    if (!TABLE_COLUMN_KIND_SET.has(value as TableColumnKind)) return;
    next[key] = value as TableColumnKind;
  });
  return next;
};

const reorderByIndex = <T,>(list: T[], from: number, to: number): T[] => {
  if (from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

const csvEscape = (value: string) => `"${value.replace(/"/g, "\"\"")}"`;

const buildCsv = (columns: string[], tableRows: string[][]): string => {
  const header = columns.map((column) => csvEscape(column || "")).join(",");
  const body = tableRows.map((row) =>
    columns
      .map((_, colIndex) => csvEscape(String(row[colIndex] || "")))
      .join(",")
  );
  return [header, ...body].join("\n");
};

const normalizeBoolLike = (raw: string): boolean => {
  const value = raw.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "si" || value === "y";
};

const buildSelectOptionsFromRows = (columnIndex: number, tableRows: string[][]): SelectOption[] => {
  const seen = new Set<string>();
  const options: SelectOption[] = [];
  for (const row of tableRows) {
    const raw = row[columnIndex];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value || seen.has(value)) continue;
    seen.add(value);
    options.push({ label: value });
  }
  return options;
};

const FALLBACK_TYPE_REF = "text.basic@1";
const LOCAL_SELECT_TYPE_REF = "select.local@1";
const DEFAULT_SELECT_OPTION_COLOR = "#E2E8F0";
const LEGACY_KIND_TYPE_REFS: Record<TableColumnKind, string> = {
  text: "text.basic@1",
  number: "number.basic@1",
  select: LOCAL_SELECT_TYPE_REF,
  date: "date.iso@1",
  checkbox: "checkbox.bool@1",
  rating: "rating.stars_0_5_half@1",
  todo: "todo.items@1",
  contacts: "contacts.list@1",
  links: "links.list@1",
  documents: "documents.list@1"
};
const MISSING_TYPE_REF_WARNINGS = new Set<string>();

type ResolvedSchemaColumn = {
  key: string;
  label: string;
  kind: TableColumnKind;
  typeRef: string;
  typeDef: ColumnTypeDef;
  typeContext: TypeRegistryContext;
  width?: number;
  selectOptions: SelectOption[];
};

type EffectiveTableModel = {
  usingSchema: boolean;
  columns: string[];
  rows: string[][];
  columnKinds: Record<string, TableColumnKind>;
  columnWidths: Record<string, number>;
  hiddenColumns: string[];
  selectOptionsByColumn: Record<string, SelectOption[]>;
  managedSelectOptionsByColumn: Record<string, SelectOption[]>;
  schemaColumnByLabel: Record<string, ResolvedSchemaColumn>;
  storageColumnCount: number;
  remapRowsForPersistence: (displayRows: string[][]) => string[][];
};

type ResolveTableModelContext = {
  settings: unknown;
  saveSettings?: SaveSettingsFn;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
};

const normalizeSelectOptions = (options: SelectOption[]): SelectOption[] => {
  const seen = new Set<string>();
  const list: SelectOption[] = [];
  options.forEach((option) => {
    const label = typeof option?.label === "string" ? option.label.trim() : "";
    if (!label || seen.has(label)) return;
    seen.add(label);
    list.push({
      ...option,
      label
    });
  });
  return list;
};

const estimateHeaderMinWidth = (label: string): number => {
  const safeLabel = label.trim() || "Column";
  const labelWidth = safeLabel.length * 8.5;
  return Math.max(DEFAULT_TABLE_COLUMN_WIDTH, Math.ceil(labelWidth + HEADER_ICON_WIDTH_BUDGET));
};

const toEditableTableSelectOption = (option: SelectOption): EditableTableSelectOption => ({
  label: option.label,
  color: option.color,
  display: option.display,
  editable: option.editable
});

const normalizeCustomSelectOptions = (
  raw: unknown,
  columnList: string[]
): Record<string, SelectOption[]> => {
  if (!isRecord(raw)) return {};
  const allowed = new Set(columnList);
  const parsed = raw as Record<string, unknown>;
  const next: Record<string, SelectOption[]> = {};
  Object.entries(parsed).forEach(([key, value]) => {
    if (!allowed.has(key) || !Array.isArray(value)) return;
    const parsedOptions: SelectOption[] = [];
    value.forEach((entry) => {
      if (!isRecord(entry)) return;
      const label = typeof entry.label === "string" ? entry.label.trim() : "";
      if (!label) return;
      const color = typeof entry.color === "string" && entry.color.trim() ? entry.color.trim() : undefined;
      const display =
        typeof entry.display === "string" && entry.display.trim() ? entry.display.trim() : undefined;
      const editable = typeof entry.editable === "boolean" ? entry.editable : true;
      parsedOptions.push({
        label,
        color: color || DEFAULT_SELECT_OPTION_COLOR,
        display,
        editable
      });
    });
    const normalized = normalizeSelectOptions(parsedOptions);
    if (normalized.length > 0) {
      next[key] = normalized;
    }
  });
  return next;
};

const serializeCustomSelectOptions = (
  optionsByColumn: Record<string, SelectOption[]>,
  columnList: string[]
): Record<string, EditableTableSelectOption[]> => {
  const allowed = new Set(columnList);
  const next: Record<string, EditableTableSelectOption[]> = {};
  Object.entries(optionsByColumn).forEach(([column, options]) => {
    if (!allowed.has(column)) return;
    const normalized = normalizeSelectOptions(options || []);
    if (normalized.length === 0) return;
    next[column] = normalized.map(toEditableTableSelectOption);
  });
  return next;
};

const mergeSelectOptions = (primary: SelectOption[], fallback: SelectOption[]): SelectOption[] =>
  normalizeSelectOptions([...(primary || []), ...(fallback || [])]);

const applySelectOptionOverrides = (
  baseOptions: SelectOption[],
  overrideConfig: unknown,
  policy?: ColumnTypeDef["overridePolicy"]
): SelectOption[] => {
  const normalizedBase = normalizeSelectOptions(baseOptions || []);
  if (!isRecord(overrideConfig)) return normalizedBase;

  const allowRelabel = Boolean(policy?.allowRelabelOptions);
  const allowHide = Boolean(policy?.allowHideOptions);
  const allowAdd = Boolean(policy?.allowAddOptions);

  const relabelMap = allowRelabel && isRecord(overrideConfig.relabelOptions)
    ? (overrideConfig.relabelOptions as Record<string, unknown>)
    : {};
  const hideSet = allowHide ? new Set(normalizeStringArray(overrideConfig.hideOptions)) : new Set<string>();
  const addOptions = allowAdd ? normalizeStringArray(overrideConfig.addOptions) : [];

  const relabeled = normalizedBase
    .map((option) => {
      const relabelValue = relabelMap[option.label];
      const label =
        typeof relabelValue === "string" && relabelValue.trim() ? relabelValue.trim() : option.label;
      return { ...option, label };
    })
    .filter((option) => !hideSet.has(option.label));

  const appended = addOptions.map((label) => ({ label }));
  return normalizeSelectOptions([...relabeled, ...appended]);
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

const toTableColumnKind = (kind: EditableTableColumnKind): TableColumnKind =>
  TABLE_COLUMN_KIND_SET.has(kind as TableColumnKind) ? (kind as TableColumnKind) : "text";

const resolveTypeDef = (typeRef: string, schemaRef: string, columnKey: string): ColumnTypeDef => {
  const resolved = TYPE_REGISTRY[typeRef];
  if (resolved) return resolved;
  const warningKey = `${schemaRef}:${columnKey}:${typeRef}`;
  if (!MISSING_TYPE_REF_WARNINGS.has(warningKey)) {
    MISSING_TYPE_REF_WARNINGS.add(warningKey);
    console.warn(
      `[EditableTable] Unknown typeRef "${typeRef}" in schema "${schemaRef}" for column "${columnKey}". Falling back to "${FALLBACK_TYPE_REF}".`
    );
  }
  return TYPE_REGISTRY[FALLBACK_TYPE_REF];
};

const resolveEffectiveTableModel = (
  props: PageBlockPropsMap["editableTable"],
  ctx: ResolveTableModelContext
): EffectiveTableModel => {
  if (!props.schemaRef) {
    const columns = normalizeTableColumns(props.customColumns);
    const rows = normalizeTableRows(props.customRows, columns.length);
    const columnKinds = normalizeTableColumnKinds(props.customColumnTypes, columns);
    const managedSelectOptionsByColumn = normalizeCustomSelectOptions(props.customSelectOptions, columns);
    const selectOptionsByColumn: Record<string, SelectOption[]> = {};
    columns.forEach((column, index) => {
      selectOptionsByColumn[column] = mergeSelectOptions(
        managedSelectOptionsByColumn[column] || [],
        buildSelectOptionsFromRows(index, rows)
      );
    });
    return {
      usingSchema: false,
      columns,
      rows,
      columnKinds,
      columnWidths: {},
      hiddenColumns: [],
      selectOptionsByColumn,
      managedSelectOptionsByColumn,
      schemaColumnByLabel: {},
      storageColumnCount: columns.length,
      remapRowsForPersistence: (nextRows) => normalizeTableRows(nextRows, columns.length)
    };
  }

  const schema = getTableSchema(props.schemaRef, { settings: ctx.settings });
  if (!schema.columns.length) {
    const fallbackColumns = normalizeTableColumns(props.customColumns);
    const fallbackRows = normalizeTableRows(props.customRows, fallbackColumns.length);
    const managedSelectOptionsByColumn = normalizeCustomSelectOptions(
      props.customSelectOptions,
      fallbackColumns
    );
    const selectOptionsByColumn: Record<string, SelectOption[]> = {};
    fallbackColumns.forEach((column, index) => {
      selectOptionsByColumn[column] = mergeSelectOptions(
        managedSelectOptionsByColumn[column] || [],
        buildSelectOptionsFromRows(index, fallbackRows)
      );
    });
    return {
      usingSchema: false,
      columns: fallbackColumns,
      rows: fallbackRows,
      columnKinds: normalizeTableColumnKinds(props.customColumnTypes, fallbackColumns),
      columnWidths: {},
      hiddenColumns: [],
      selectOptionsByColumn,
      managedSelectOptionsByColumn,
      schemaColumnByLabel: {},
      storageColumnCount: fallbackColumns.length,
      remapRowsForPersistence: (nextRows) => normalizeTableRows(nextRows, fallbackColumns.length)
    };
  }

  const overrides: TableOverrides = props.overrides || {};
  const schemaByKey = new Map(schema.columns.map((column) => [column.key, column]));
  const schemaKeys = schema.columns.map((column) => column.key);
  const orderedKeys: string[] = [];
  normalizeStringArray(overrides.columnOrder).forEach((key) => {
    if (schemaByKey.has(key) && !orderedKeys.includes(key)) orderedKeys.push(key);
  });
  schemaKeys.forEach((key) => {
    if (!orderedKeys.includes(key)) orderedKeys.push(key);
  });

  const hiddenKeySet = new Set(
    normalizeStringArray(overrides.hiddenColumns).filter((key) => schemaByKey.has(key))
  );
  const labelOverrides = isRecord(overrides.labelOverrides)
    ? (overrides.labelOverrides as Record<string, unknown>)
    : {};
  const widthOverrides = isRecord(overrides.columnWidths)
    ? (overrides.columnWidths as Record<string, unknown>)
    : {};
  const typeOverrides = isRecord(overrides.typeOverrides)
    ? (overrides.typeOverrides as Record<string, unknown>)
    : {};

  const storageIndexByKey: Record<string, number> = {};
  schemaKeys.forEach((key, index) => {
    storageIndexByKey[key] = index;
  });
  const displayIndexByKey: Record<string, number> = {};
  orderedKeys.forEach((key, index) => {
    displayIndexByKey[key] = index;
  });

  const usedLabels = new Set<string>();
  const resolvedColumns: ResolvedSchemaColumn[] = [];
  orderedKeys.forEach((key) => {
    const column = schemaByKey.get(key);
    if (!column) return;
    const rawTypeRef = typeof column.typeRef === "string" && column.typeRef.trim() ? column.typeRef : FALLBACK_TYPE_REF;
    const typeDef = resolveTypeDef(rawTypeRef, props.schemaRef || "", key);
    const kind = toTableColumnKind(typeDef.baseKind);
    const overrideLabel = labelOverrides[key];
    const labelSeed =
      typeof overrideLabel === "string" && overrideLabel.trim()
        ? overrideLabel.trim()
        : column.label || key;
    const label = createUniqueLabel(labelSeed, usedLabels);
    const overrideWidth = widthOverrides[key];
    const width =
      typeof overrideWidth === "number" && Number.isFinite(overrideWidth) && overrideWidth > 0
        ? overrideWidth
        : typeof column.width === "number" && Number.isFinite(column.width) && column.width > 0
          ? column.width
          : undefined;
    const typeContext: TypeRegistryContext = {
      settings: isRecord(ctx.settings) ? (ctx.settings as TypeRegistryContext["settings"]) : undefined,
      saveSettings: ctx.saveSettings,
      column: {
        key,
        label,
        config: column.config || null
      }
    };
    const baseOptions = typeDef.getOptions ? typeDef.getOptions(typeContext) : [];
    const selectOptions = applySelectOptionOverrides(baseOptions, typeOverrides[key], typeDef.overridePolicy);
    resolvedColumns.push({
      key,
      label,
      kind,
      typeRef: rawTypeRef,
      typeDef,
      typeContext,
      width,
      selectOptions
    });
  });

  const columns = resolvedColumns.map((column) => column.label);
  const columnKinds: Record<string, TableColumnKind> = {};
  const columnWidths: Record<string, number> = {};
  const schemaColumnByLabel: Record<string, ResolvedSchemaColumn> = {};
  const selectOptionsByColumn: Record<string, SelectOption[]> = {};
  resolvedColumns.forEach((column) => {
    columnKinds[column.label] = column.kind;
    schemaColumnByLabel[column.label] = column;
    selectOptionsByColumn[column.label] = column.selectOptions;
    if (typeof column.width === "number") {
      columnWidths[column.label] = column.width;
    }
  });
  const hiddenColumns = resolvedColumns
    .filter((column) => hiddenKeySet.has(column.key))
    .map((column) => column.label);

  const storageRows = normalizeTableRows(props.customRows, schemaKeys.length);
  const displayRows = storageRows.map((row) =>
    orderedKeys.map((key) => {
      const storageIndex = storageIndexByKey[key];
      return storageIndex >= 0 ? row[storageIndex] || "" : "";
    })
  );

  const remapRowsForPersistence = (displayRowsInput: string[][]) => {
    const normalizedDisplayRows = normalizeTableRows(displayRowsInput, orderedKeys.length);
    return normalizedDisplayRows.map((row) =>
      schemaKeys.map((key) => {
        const displayIndex = displayIndexByKey[key];
        return displayIndex >= 0 ? row[displayIndex] || "" : "";
      })
    );
  };

  return {
    usingSchema: true,
    columns,
    rows: displayRows,
    columnKinds,
    columnWidths,
    hiddenColumns,
    selectOptionsByColumn,
    managedSelectOptionsByColumn: {},
    schemaColumnByLabel,
    storageColumnCount: schemaKeys.length,
    remapRowsForPersistence
  };
};

type DefaultEditableTableProps = {
  block: PageBlockConfig<"editableTable">;
  mode: BlockRenderMode;
  settings?: unknown;
  saveSettings?: SaveSettingsFn;
  patchBlockProps: (patch: Partial<PageBlockPropsMap["editableTable"]>) => void;
  extraActions?: React.ReactNode;
  isExpanded: boolean;
  onToggleExpanded: () => void;
};

type TableCalcOp =
  | "none"
  | "count"
  | "count_values"
  | "count_empty"
  | "unique"
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "checked"
  | "unchecked";

type TableSortConfig = { column: string; direction: "asc" | "desc" } | null;
type TableColumnKind = EditableTableColumnKind;
type ColumnMenuView = "root" | "type" | "filter" | "sort" | "group" | "calculate";

type TableRowEntry = {
  row: string[];
  rowIndex: number;
};

type ColumnMenuEntry =
  | { kind: "separator"; key: string }
  | {
      kind: "item";
      key: string;
      label: string;
      icon: React.ReactNode;
      disabled?: boolean;
      submenu?: ColumnMenuView;
      end?: React.ReactNode;
      action?: () => void;
    };

const DefaultEditableTable: React.FC<DefaultEditableTableProps> = ({
  block,
  mode,
  settings,
  saveSettings,
  patchBlockProps,
  extraActions,
  isExpanded,
  onToggleExpanded
}) => {
  const effectiveModel = useMemo(
    () => resolveEffectiveTableModel(block.props, { settings, saveSettings }),
    [block.props, settings, saveSettings]
  );
  const isSchemaBacked = effectiveModel.usingSchema;
  const isTrackerApplicationsSchema = block.props.schemaRef === "tracker.applications@1";
  const rootRef = useRef<HTMLDivElement | null>(null);
  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  const columnMenuListRef = useRef<HTMLDivElement | null>(null);
  const columnMenuFilterInputRef = useRef<HTMLInputElement | null>(null);
  const columnMenuAnchorRef = useRef<HTMLElement | null>(null);
  const columnMenuCloseTimerRef = useRef<number | null>(null);
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(effectiveModel.hiddenColumns);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [columnMenu, setColumnMenu] = useState<{ column: string; rename: string; filter: string } | null>(null);
  const [columnMenuPos, setColumnMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [columnMenuPlacement, setColumnMenuPlacement] = useState<"top" | "bottom">("bottom");
  const [columnMenuVisible, setColumnMenuVisible] = useState(false);
  const [columnMenuView, setColumnMenuView] = useState<ColumnMenuView>("root");
  const [columnMenuActiveIndex, setColumnMenuActiveIndex] = useState(0);
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [pinnedColumn, setPinnedColumn] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<TableSortConfig>(null);
  const [groupBy, setGroupBy] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [columnCalcs, setColumnCalcs] = useState<Record<string, TableCalcOp>>({});
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(effectiveModel.columnWidths);
  const [resizing, setResizing] = useState<{ column: string; startX: number; startWidth: number } | null>(null);
  const [detailRowIndex, setDetailRowIndex] = useState<number | null>(null);
  const [editRowIndex, setEditRowIndex] = useState<number | null>(null);
  const [editRowDraft, setEditRowDraft] = useState<string[] | null>(null);
  const columns = useMemo(() => effectiveModel.columns, [effectiveModel.columns]);
  const persistedColumnKinds = useMemo(() => effectiveModel.columnKinds, [effectiveModel.columnKinds]);
  const [columnKinds, setColumnKinds] = useState<Record<string, TableColumnKind>>(persistedColumnKinds);
  const rows = useMemo(() => effectiveModel.rows, [effectiveModel.rows]);
  const canEdit = mode === "edit";
  const canEditStructure = canEdit && !isSchemaBacked;
  const schemaConfigKey = useMemo(
    () =>
      JSON.stringify({
        schemaRef: block.props.schemaRef || "",
        overrides: block.props.overrides || {}
      }),
    [block.props.schemaRef, block.props.overrides]
  );
  const trackerStages = useMemo(
    () =>
      isRecord(settings) ? normalizeStringArray((settings as Record<string, unknown>).stages) : [],
    [settings]
  );
  const trackerOutcomes = useMemo(
    () =>
      isRecord(settings) ? normalizeStringArray((settings as Record<string, unknown>).outcomes) : [],
    [settings]
  );
  const stageColumnIndex = useMemo(() => {
    if (!isTrackerApplicationsSchema) return -1;
    const schemaStageColumn = Object.values(effectiveModel.schemaColumnByLabel).find(
      (column) => column.key === "stage"
    );
    if (schemaStageColumn) {
      return columns.indexOf(schemaStageColumn.label);
    }
    return columns.findIndex((column) => column.trim().toLowerCase() === "stage");
  }, [columns, effectiveModel.schemaColumnByLabel, isTrackerApplicationsSchema]);
  const outcomeColumnIndex = useMemo(() => {
    if (!isTrackerApplicationsSchema) return -1;
    const schemaOutcomeColumn = Object.values(effectiveModel.schemaColumnByLabel).find(
      (column) => column.key === "outcome"
    );
    if (schemaOutcomeColumn) {
      return columns.indexOf(schemaOutcomeColumn.label);
    }
    return columns.findIndex((column) => column.trim().toLowerCase() === "outcome");
  }, [columns, effectiveModel.schemaColumnByLabel, isTrackerApplicationsSchema]);
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const computeColumnMenuPos = (anchor: HTMLElement, menuEl?: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const menuWidth = menuEl?.offsetWidth || COLUMN_MENU_WIDTH;
    const menuHeight = menuEl?.offsetHeight || COLUMN_MENU_HEIGHT_ESTIMATE;
    const maxLeft = Math.max(COLUMN_MENU_GUTTER, window.innerWidth - menuWidth - COLUMN_MENU_GUTTER);
    const left = clamp(rect.left + COLUMN_MENU_X_OFFSET, COLUMN_MENU_GUTTER, maxLeft);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const shouldFlip = spaceBelow < menuHeight + COLUMN_MENU_OFFSET && spaceAbove > spaceBelow;
    const placement: "top" | "bottom" = shouldFlip ? "top" : "bottom";
    const maxTop = Math.max(COLUMN_MENU_GUTTER, window.innerHeight - menuHeight - COLUMN_MENU_GUTTER);
    const rawTop =
      placement === "bottom"
        ? rect.bottom + COLUMN_MENU_OFFSET
        : rect.top - menuHeight - COLUMN_MENU_OFFSET;
    const top = clamp(rawTop, COLUMN_MENU_GUTTER, maxTop);
    return { top, left, placement };
  };

  useEffect(() => {
    setHiddenColumns((prev) => prev.filter((column) => columns.includes(column)));
  }, [columns]);

  useEffect(() => {
    if (!isSchemaBacked) return;
    setHiddenColumns(effectiveModel.hiddenColumns);
    setColumnWidths((prev) => ({ ...prev, ...effectiveModel.columnWidths }));
  }, [isSchemaBacked, schemaConfigKey]);

  useEffect(() => {
    setColumnKinds(persistedColumnKinds);
  }, [persistedColumnKinds]);

  useEffect(() => {
    setPinnedColumn((prev) => {
      const visible = columns.filter((column) => !hiddenColumns.includes(column));
      if (visible.length === 0) return null;
      if (prev && visible.includes(prev)) return prev;
      return visible[0];
    });
  }, [columns, hiddenColumns]);

  useEffect(() => {
    if (!isTrackerApplicationsSchema) return;
    if (stageFilter !== "all" && !trackerStages.includes(stageFilter)) {
      setStageFilter("all");
    }
  }, [isTrackerApplicationsSchema, stageFilter, trackerStages]);

  useEffect(() => {
    if (!isTrackerApplicationsSchema) return;
    if (outcomeFilter !== "all" && !trackerOutcomes.includes(outcomeFilter)) {
      setOutcomeFilter("all");
    }
  }, [isTrackerApplicationsSchema, outcomeFilter, trackerOutcomes]);

  useEffect(() => {
    if (!columnMenu) return;
    const onOutside = (event: MouseEvent) => {
      if (!columnMenuRef.current) return;
      if (event.target instanceof Node && !columnMenuRef.current.contains(event.target)) {
        closeColumnMenu();
      }
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [columnMenu]);

  useEffect(() => {
    return () => {
      if (columnMenuCloseTimerRef.current) {
        window.clearTimeout(columnMenuCloseTimerRef.current);
        columnMenuCloseTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!columnMenu) return;
    if (columnMenuView === "filter") return;
    const raf = window.requestAnimationFrame(() => {
      setColumnMenuVisible(true);
      const active = document.activeElement;
      const insideMenu = active && columnMenuRef.current ? columnMenuRef.current.contains(active) : false;
      if (!insideMenu) {
        columnMenuListRef.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [columnMenu?.column, columnMenuView]);

  useEffect(() => {
    if (!columnMenu || columnMenuView !== "filter") return;
    const raf = window.requestAnimationFrame(() => {
      columnMenuFilterInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [columnMenu, columnMenuView]);

  useEffect(() => {
    if (!columnMenu || !columnMenuAnchorRef.current) return;
    const updatePosition = () => {
      if (!columnMenuAnchorRef.current) return;
      const pos = computeColumnMenuPos(columnMenuAnchorRef.current, columnMenuRef.current || undefined);
      setColumnMenuPlacement(pos.placement);
      setColumnMenuPos({ top: pos.top, left: pos.left });
    };
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [columnMenu, columnMenuView]);

  useEffect(() => {
    if (!resizing) return;
    const handleMove = (event: MouseEvent) => {
      const delta = event.clientX - resizing.startX;
      const minWidth = estimateHeaderMinWidth(resizing.column);
      const nextWidth = Math.max(minWidth, resizing.startWidth + delta);
      setColumnWidths((prev) => ({ ...prev, [resizing.column]: nextWidth }));
    };
    const handleUp = () => setResizing(null);
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
  }, [resizing]);

  useEffect(() => {
    if (detailRowIndex !== null && (detailRowIndex < 0 || detailRowIndex >= rows.length)) {
      setDetailRowIndex(null);
    }
    if (editRowIndex !== null && (editRowIndex < 0 || editRowIndex >= rows.length)) {
      setEditRowIndex(null);
      setEditRowDraft(null);
    }
  }, [detailRowIndex, editRowIndex, rows.length]);

  const visibleColumns = useMemo(() => {
    const base = columns
      .map((column, index) => ({ column, index }))
      .filter((entry) => !hiddenColumns.includes(entry.column))
      .map((entry) => ({ ...entry }));
    if (!pinnedColumn) return base;
    const pinIndex = base.findIndex((entry) => entry.column === pinnedColumn);
    if (pinIndex <= 0) return base;
    const [pinned] = base.splice(pinIndex, 1);
    return [pinned, ...base];
  }, [columns, hiddenColumns, pinnedColumn]);

  const selectOptionsByColumn = useMemo(() => {
    const next: Record<string, SelectOption[]> = {};
    columns.forEach((column, index) => {
      const optionsFromRows = buildSelectOptionsFromRows(index, rows);
      const schemaOptions = effectiveModel.selectOptionsByColumn[column] || [];
      next[column] = mergeSelectOptions(schemaOptions, optionsFromRows);
    });
    return next;
  }, [columns, rows, effectiveModel.selectOptionsByColumn]);

  const persistTable = (
    nextColumns: string[],
    nextRows: string[][],
    extraPatch: Partial<PageBlockPropsMap["editableTable"]> = {}
  ) => {
    if (isSchemaBacked) {
      const storageRows = effectiveModel.remapRowsForPersistence(nextRows);
      patchBlockProps({
        customRows: normalizeTableRows(storageRows, effectiveModel.storageColumnCount),
        ...extraPatch
      });
      return;
    }
    patchBlockProps({
      customColumns: normalizeTableColumns(nextColumns),
      customRows: normalizeTableRows(nextRows, nextColumns.length),
      ...extraPatch
    });
  };

  const readLegacySelectOptionsFromProps = (columnList: string[]): Record<string, SelectOption[]> =>
    normalizeCustomSelectOptions(block.props.customSelectOptions, columnList);

  const persistLegacySelectOptions = (
    column: string,
    nextOptions: SelectOption[],
    columnList: string[] = columns
  ) => {
    if (isSchemaBacked) return;
    const nextByColumn = readLegacySelectOptionsFromProps(columnList);
    const normalized = normalizeSelectOptions(nextOptions || []);
    if (normalized.length > 0) {
      nextByColumn[column] = normalized;
    } else {
      delete nextByColumn[column];
    }
    patchBlockProps({
      customSelectOptions: serializeCustomSelectOptions(nextByColumn, columnList)
    });
  };

  const updateColumnKinds = (
    nextKinds: Record<string, TableColumnKind>,
    columnList: string[] = columns
  ) => {
    if (isSchemaBacked) return;
    const normalized = normalizeTableColumnKinds(nextKinds, columnList);
    setColumnKinds(normalized);
    patchBlockProps({ customColumnTypes: normalized });
  };

  const renameColumnMeta = (oldName: string, newName: string, columnList: string[]) => {
    if (oldName === newName) return;
    setHiddenColumns((prev) => prev.map((column) => (column === oldName ? newName : column)));
    setColumnFilters((prev) => {
      if (!(oldName in prev)) return prev;
      const next = { ...prev, [newName]: prev[oldName] };
      delete next[oldName];
      return next;
    });
    setColumnCalcs((prev) => {
      if (!(oldName in prev)) return prev;
      const next = { ...prev, [newName]: prev[oldName] };
      delete next[oldName];
      return next;
    });
    setColumnWidths((prev) => {
      if (!(oldName in prev)) return prev;
      const next = { ...prev, [newName]: prev[oldName] };
      delete next[oldName];
      return next;
    });
    if (oldName in columnKinds) {
      const nextKinds = { ...columnKinds, [newName]: columnKinds[oldName] };
      delete nextKinds[oldName];
      updateColumnKinds(nextKinds, columnList);
    }
    setPinnedColumn((prev) => (prev === oldName ? newName : prev));
    setSortConfig((prev) => (prev?.column === oldName ? { ...prev, column: newName } : prev));
    setGroupBy((prev) => (prev === oldName ? newName : prev));
  };

  const clearColumnMeta = (column: string, columnList: string[]) => {
    setHiddenColumns((prev) => prev.filter((item) => item !== column));
    setColumnFilters((prev) => {
      if (!(column in prev)) return prev;
      const next = { ...prev };
      delete next[column];
      return next;
    });
    setColumnCalcs((prev) => {
      if (!(column in prev)) return prev;
      const next = { ...prev };
      delete next[column];
      return next;
    });
    setColumnWidths((prev) => {
      if (!(column in prev)) return prev;
      const next = { ...prev };
      delete next[column];
      return next;
    });
    if (column in columnKinds) {
      const nextKinds = { ...columnKinds };
      delete nextKinds[column];
      updateColumnKinds(nextKinds, columnList);
    }
    setPinnedColumn((prev) => (prev === column ? null : prev));
    setSortConfig((prev) => (prev?.column === column ? null : prev));
    setGroupBy((prev) => (prev === column ? null : prev));
  };

  const handleRenameColumn = (colIndex: number, value: string) => {
    if (!canEditStructure) return;
    const oldName = columns[colIndex];
    const nextName = value.trim() || oldName;
    const nextColumns = [...columns];
    nextColumns[colIndex] = nextName;
    let extraPatch: Partial<PageBlockPropsMap["editableTable"]> = {};
    if (oldName !== nextName) {
      const nextSelectOptions = readLegacySelectOptionsFromProps(columns);
      const sourceOptions = nextSelectOptions[oldName];
      if (sourceOptions) {
        const merged = mergeSelectOptions(nextSelectOptions[nextName] || [], sourceOptions);
        nextSelectOptions[nextName] = merged;
        delete nextSelectOptions[oldName];
      }
      extraPatch = {
        customSelectOptions: serializeCustomSelectOptions(nextSelectOptions, nextColumns)
      };
    }
    persistTable(nextColumns, rows, extraPatch);
    renameColumnMeta(oldName, nextName, nextColumns);
    setColumnMenu((prev) =>
      prev && prev.column === oldName ? { ...prev, column: nextName, rename: nextName } : prev
    );
  };

  const handleDeleteColumn = (colIndex: number) => {
    if (!canEditStructure) return;
    if (columns.length <= 1) return;
    const columnLabel = columns[colIndex] || `Column ${colIndex + 1}`;
    const confirmed = window.confirm(
      `Delete "${columnLabel}" column? This action cannot be undone.`
    );
    if (!confirmed) return;
    const column = columns[colIndex];
    const nextColumns = columns.filter((_, index) => index !== colIndex);
    const nextRows = rows.map((row) => row.filter((_, index) => index !== colIndex));
    const nextSelectOptions = readLegacySelectOptionsFromProps(columns);
    delete nextSelectOptions[column];
    persistTable(nextColumns, nextRows, {
      customSelectOptions: serializeCustomSelectOptions(nextSelectOptions, nextColumns)
    });
    clearColumnMeta(column, nextColumns);
    setColumnMenu(null);
  };

  const handleAddColumn = () => {
    if (!canEditStructure) return;
    const nextColumns = [...columns, `Column ${columns.length + 1}`];
    const nextRows = rows.map((row) => [...row, ""]);
    persistTable(nextColumns, nextRows);
  };

  const insertColumnAt = (index: number) => {
    if (!canEditStructure) return;
    const targetIndex = Math.max(0, Math.min(index, columns.length));
    const nextColumns = [...columns];
    nextColumns.splice(targetIndex, 0, `Column ${columns.length + 1}`);
    const nextRows = rows.map((row) => {
      const next = [...row];
      next.splice(targetIndex, 0, "");
      return next;
    });
    persistTable(nextColumns, nextRows);
  };

  const duplicateColumnAt = (index: number) => {
    if (!canEditStructure) return;
    if (index < 0 || index >= columns.length) return;
    const sourceName = columns[index];
    const buildCandidate = (attempt: number) =>
      attempt <= 1 ? `${sourceName} copy` : `${sourceName} copy ${attempt}`;
    let attempt = 1;
    let nextName = buildCandidate(attempt);
    while (columns.includes(nextName)) {
      attempt += 1;
      nextName = buildCandidate(attempt);
    }

    const nextColumns = [...columns];
    nextColumns.splice(index + 1, 0, nextName);
    const nextRows = rows.map((row) => {
      const next = [...row];
      next.splice(index + 1, 0, row[index] || "");
      return next;
    });
    const nextSelectOptions = readLegacySelectOptionsFromProps(columns);
    const sourceOptions = nextSelectOptions[sourceName] || [];
    if (sourceOptions.length > 0) {
      nextSelectOptions[nextName] = sourceOptions.map((option) => ({ ...option }));
    }
    persistTable(nextColumns, nextRows, {
      customSelectOptions: serializeCustomSelectOptions(nextSelectOptions, nextColumns)
    });
    updateColumnKinds(
      { ...columnKinds, [nextName]: columnKinds[sourceName] || "text" },
      nextColumns
    );
    setColumnWidths((prev) => {
      const width = prev[sourceName];
      return width ? { ...prev, [nextName]: width } : prev;
    });
    setColumnCalcs((prev) => {
      const calc = prev[sourceName];
      return calc ? { ...prev, [nextName]: calc } : prev;
    });
    setColumnMenu((prev) => (prev ? { ...prev, column: nextName, rename: nextName, filter: "" } : prev));
  };

  const handleAddRow = () => {
    const nextRows = [...rows, Array.from({ length: columns.length }, () => "")];
    persistTable(columns, nextRows);
  };

  const openDetailRow = (rowIndex: number) => {
    if (rowIndex < 0 || rowIndex >= rows.length) return;
    setDetailRowIndex(rowIndex);
  };

  const openEditRow = (rowIndex: number) => {
    if (!canEdit) return;
    const row = rows[rowIndex];
    if (!row) return;
    setEditRowIndex(rowIndex);
    setEditRowDraft(Array.from({ length: columns.length }, (_, colIndex) => row[colIndex] || ""));
  };

  const updateEditDraftCell = (colIndex: number, value: string) => {
    setEditRowDraft((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[colIndex] = value;
      return next;
    });
  };

  const saveEditedRow = () => {
    if (!canEdit) return;
    if (editRowIndex === null || !editRowDraft) return;
    const nextRows = rows.map((row, index) =>
      index === editRowIndex
        ? Array.from({ length: columns.length }, (_, colIndex) => editRowDraft[colIndex] || "")
        : row
    );
    persistTable(columns, nextRows);
    setEditRowIndex(null);
    setEditRowDraft(null);
  };

  const handleDeleteRow = (rowIndex: number) => {
    const confirmed = window.confirm(
      `Delete row ${rowIndex + 1}? This action cannot be undone.`
    );
    if (!confirmed) return;
    const nextRows = rows.filter((_, index) => index !== rowIndex);
    persistTable(columns, nextRows);
    setDetailRowIndex((prev) => {
      if (prev === null) return prev;
      if (prev === rowIndex) return null;
      return prev > rowIndex ? prev - 1 : prev;
    });
    setEditRowIndex((prev) => {
      if (prev === null) return prev;
      if (prev === rowIndex) {
        setEditRowDraft(null);
        return null;
      }
      return prev > rowIndex ? prev - 1 : prev;
    });
  };

  const handleCellChange = (rowIndex: number, colIndex: number, value: string) => {
    const nextRows = rows.map((row, index) =>
      index === rowIndex ? row.map((cell, cellIndex) => (cellIndex === colIndex ? value : cell)) : row
    );
    persistTable(columns, nextRows);
  };

  const buildSelectCellOptions = (column: string, cellValue: string): SelectOption[] => {
    const selectOptions = selectOptionsByColumn[column] || [];
    const hasCurrentSelectValue =
      cellValue.trim().length > 0 &&
      selectOptions.some((option) => option.label === cellValue);
    return hasCurrentSelectValue || cellValue.trim().length === 0
      ? selectOptions
      : [{ label: cellValue }, ...selectOptions];
  };

  const buildLegacyTypeContext = (
    column: string,
    kind: TableColumnKind
  ): TypeRegistryContext => ({
    column: {
      key: column,
      label: column
    },
    selectState:
      kind === "select"
        ? {
            options:
              effectiveModel.managedSelectOptionsByColumn[column] ||
              selectOptionsByColumn[column] ||
              [],
            setOptions: (nextOptions) =>
              persistLegacySelectOptions(column, nextOptions),
            defaultColor: DEFAULT_SELECT_OPTION_COLOR
          }
        : undefined
  });

  const serializeTypedValueForColumn = (column: string, value: unknown): string | null => {
    const schemaColumn = effectiveModel.schemaColumnByLabel[column];
    if (schemaColumn) {
      const serialized = schemaColumn.typeDef.serialize(value, schemaColumn.typeContext);
      const parsed = schemaColumn.typeDef.parse(serialized, schemaColumn.typeContext);
      const validation = schemaColumn.typeDef.validate?.(parsed, schemaColumn.typeContext);
      if (validation && !validation.valid) {
        console.warn(
          `[EditableTable] Validation failed for column "${schemaColumn.key}" (${schemaColumn.typeRef}): ${validation.reason || "invalid value"}`
        );
        return null;
      }
      return serialized;
    }

    const kind = getColumnKind(column);
    const legacyTypeRef = LEGACY_KIND_TYPE_REFS[kind] || FALLBACK_TYPE_REF;
    const legacyTypeDef = resolveTypeDef(legacyTypeRef, "editableTable.legacy", column);
    const legacyTypeContext = buildLegacyTypeContext(column, kind);
    const serialized = legacyTypeDef.serialize(value, legacyTypeContext);
    const parsed = legacyTypeDef.parse(serialized, legacyTypeContext);
    const validation = legacyTypeDef.validate?.(parsed, legacyTypeContext);
    if (validation && !validation.valid) {
      console.warn(
        `[EditableTable] Validation failed for legacy column "${column}" (${legacyTypeRef}): ${validation.reason || "invalid value"}`
      );
      return null;
    }
    return serialized;
  };

  const renderTypedCellByColumn = ({
    column,
    rawValue,
    canEditCell,
    highlightQuery,
    onCommit
  }: {
    column: string;
    rawValue: string;
    canEditCell: boolean;
    highlightQuery?: string;
    onCommit: (next: unknown) => void;
  }) => {
    const schemaColumn = effectiveModel.schemaColumnByLabel[column];
    const selectCellOptions = buildSelectCellOptions(column, rawValue);

    if (schemaColumn) {
      const parsedCellValue = schemaColumn.typeDef.parse(rawValue, schemaColumn.typeContext);
      const schemaSelectActions =
        schemaColumn.kind === "select"
          ? schemaColumn.typeDef.getSelectActions?.(schemaColumn.typeContext)
          : undefined;
      return schemaColumn.typeDef.renderCell({
        value: parsedCellValue,
        rawValue,
        canEdit: canEditCell,
        highlightQuery,
        options: selectCellOptions,
        context: schemaColumn.typeContext,
        selectActions: schemaSelectActions,
        onCommit
      });
    }

    const kind = getColumnKind(column);
    const legacyTypeRef = LEGACY_KIND_TYPE_REFS[kind] || FALLBACK_TYPE_REF;
    const legacyTypeDef = resolveTypeDef(legacyTypeRef, "editableTable.legacy", column);
    const legacyTypeContext = buildLegacyTypeContext(column, kind);
    const legacyParsedValue = legacyTypeDef.parse(rawValue, legacyTypeContext);
    const legacySelectActions =
      kind === "select"
        ? legacyTypeDef.getSelectActions?.(legacyTypeContext)
        : undefined;

    return legacyTypeDef.renderCell({
      value: legacyParsedValue,
      rawValue,
      canEdit: canEditCell,
      highlightQuery,
      options: kind === "select" ? selectCellOptions : undefined,
      context: legacyTypeContext,
      selectActions: legacySelectActions,
      onCommit
    });
  };

  const commitTypedCellValue = (rowIndex: number, colIndex: number, value: unknown) => {
    const column = columns[colIndex];
    const serialized = serializeTypedValueForColumn(column, value);
    if (serialized === null) return;
    handleCellChange(rowIndex, colIndex, serialized);
  };

  const commitTypedDraftCellValue = (colIndex: number, value: unknown) => {
    const column = columns[colIndex];
    const serialized = serializeTypedValueForColumn(column, value);
    if (serialized === null) return;
    updateEditDraftCell(colIndex, serialized);
  };

  const moveColumn = (fromIndex: number, toIndex: number) => {
    if (!canEditStructure) return;
    if (toIndex < 0 || toIndex >= columns.length || toIndex === fromIndex) return;
    const fromName = columns[fromIndex];
    const toName = columns[toIndex];
    const nextColumns = reorderByIndex(columns, fromIndex, toIndex);
    const nextRows = rows.map((row) => reorderByIndex(row, fromIndex, toIndex));
    persistTable(nextColumns, nextRows);
    setColumnMenu((prev) => (prev && prev.column === fromName ? { ...prev, column: toName } : prev));
  };

  const fitColumnToContent = (column: string) => {
    const colIndex = columns.indexOf(column);
    if (colIndex < 0) return;
    const sample = [
      column,
      ...rows.map((row) => String(row[colIndex] || ""))
    ];
    const maxLen = sample.reduce((max, value) => Math.max(max, value.length), 8);
    const minWidth = estimateHeaderMinWidth(column);
    const nextWidth = Math.max(minWidth, Math.min(560, maxLen * 8 + 36));
    setColumnWidths((prev) => ({ ...prev, [column]: nextWidth }));
  };

  const handleColumnReorder = (targetColumn: string) => {
    if (!draggedColumn || draggedColumn === targetColumn) return;
    const fromIndex = columns.indexOf(draggedColumn);
    const toIndex = columns.indexOf(targetColumn);
    if (fromIndex < 0 || toIndex < 0) return;
    moveColumn(fromIndex, toIndex);
    setDraggedColumn(null);
    setDragOverColumn(null);
    setColumnMenu(null);
  };

  const hideColumn = (column: string) => {
    const visibleCount = columns.filter((item) => !hiddenColumns.includes(item)).length;
    if (visibleCount <= 1) return;
    setHiddenColumns((prev) => (prev.includes(column) ? prev : [...prev, column]));
    closeColumnMenu();
  };

  const closeColumnMenuImmediate = () => {
    if (columnMenuCloseTimerRef.current) {
      window.clearTimeout(columnMenuCloseTimerRef.current);
      columnMenuCloseTimerRef.current = null;
    }
    setColumnMenuVisible(false);
    setColumnMenu(null);
    setColumnMenuPos(null);
    setColumnMenuView("root");
    setColumnMenuActiveIndex(0);
    columnMenuAnchorRef.current = null;
  };

  const closeColumnMenu = () => {
    if (!columnMenu) return;
    columnMenuAnchorRef.current?.focus?.();
    if (columnMenuCloseTimerRef.current) {
      window.clearTimeout(columnMenuCloseTimerRef.current);
    }
    columnMenuCloseTimerRef.current = window.setTimeout(() => {
      closeColumnMenuImmediate();
    }, COLUMN_MENU_ANIM_MS);
    setColumnMenuVisible(false);
  };

  const openColumnMenu = (column: string, anchor: HTMLElement) => {
    if (columnMenuCloseTimerRef.current) {
      window.clearTimeout(columnMenuCloseTimerRef.current);
      columnMenuCloseTimerRef.current = null;
    }
    columnMenuAnchorRef.current = anchor;
    const seedPos = computeColumnMenuPos(anchor, columnMenuRef.current || undefined);
    setColumnMenuPlacement(seedPos.placement);
    setColumnMenuPos({ top: seedPos.top, left: seedPos.left });
    setColumnMenuView("root");
    setColumnMenuActiveIndex(0);
    setColumnMenuVisible(false);
    setColumnMenu({
      column,
      rename: column,
      filter: columnFilters[column] || ""
    });
  };

  const applyColumnRename = () => {
    if (!canEditStructure) return;
    if (!columnMenu) return;
    const colIndex = columns.indexOf(columnMenu.column);
    if (colIndex < 0) return;
    const nextLabel = columnMenu.rename.trim();
    if (!nextLabel) {
      setColumnMenu((prev) => (prev ? { ...prev, rename: prev.column } : prev));
      return;
    }
    handleRenameColumn(colIndex, nextLabel);
  };

  const getColumnWidth = (column: string) =>
    Math.max(columnWidths[column] || DEFAULT_TABLE_COLUMN_WIDTH, estimateHeaderMinWidth(column));

  const baseEntries = useMemo<TableRowEntry[]>(
    () => rows.map((row, rowIndex) => ({ row, rowIndex })),
    [rows]
  );

  const searchedEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return baseEntries;
    }
    return baseEntries
      .filter(({ row }) =>
        row.some((cell, index) => {
          if (!visibleColumns.some((item) => item.index === index)) return false;
          return String(cell || "").toLowerCase().includes(normalizedQuery);
        })
      );
  }, [baseEntries, query, visibleColumns]);

  const advancedFilteredEntries = useMemo(() => {
    if (!isTrackerApplicationsSchema) return searchedEntries;
    return searchedEntries.filter(({ row }) => {
      const stageValue = stageColumnIndex >= 0 ? String(row[stageColumnIndex] || "").trim() : "";
      const outcomeValue = outcomeColumnIndex >= 0 ? String(row[outcomeColumnIndex] || "").trim() : "";
      const matchesStage = stageFilter === "all" || stageColumnIndex < 0 || stageValue === stageFilter;
      const matchesOutcome =
        outcomeFilter === "all" || outcomeColumnIndex < 0 || outcomeValue === outcomeFilter;
      return matchesStage && matchesOutcome;
    });
  }, [
    isTrackerApplicationsSchema,
    outcomeColumnIndex,
    outcomeFilter,
    searchedEntries,
    stageColumnIndex,
    stageFilter
  ]);

  const filteredEntries = useMemo(() => {
    const activeFilters = Object.entries(columnFilters).filter(([, value]) => value.trim().length > 0);
    if (activeFilters.length === 0) return advancedFilteredEntries;
    return advancedFilteredEntries.filter(({ row }) =>
      activeFilters.every(([column, value]) => {
        const colIndex = columns.indexOf(column);
        if (colIndex < 0) return true;
        return String(row[colIndex] || "").toLowerCase().includes(value.trim().toLowerCase());
      })
    );
  }, [advancedFilteredEntries, columnFilters, columns]);

  const orderedEntries = useMemo(() => {
    if (!sortConfig) return filteredEntries;
    const colIndex = columns.indexOf(sortConfig.column);
    if (colIndex < 0) return filteredEntries;
    const dir = sortConfig.direction === "asc" ? 1 : -1;
    return [...filteredEntries].sort((a, b) => {
      const aRaw = String(a.row[colIndex] || "").trim();
      const bRaw = String(b.row[colIndex] || "").trim();
      const aNum = Number(aRaw);
      const bNum = Number(bRaw);
      const bothNumeric = !Number.isNaN(aNum) && !Number.isNaN(bNum);
      if (bothNumeric) return (aNum - bNum) * dir;
      return aRaw.localeCompare(bRaw) * dir;
    });
  }, [columns, filteredEntries, sortConfig]);

  const rowsForDisplay = useMemo(() => {
    if (!groupBy) return orderedEntries;
    const colIndex = columns.indexOf(groupBy);
    if (colIndex < 0) return orderedEntries;
    return [...orderedEntries].sort((a, b) => {
      const aKey = String(a.row[colIndex] || "").trim() || "(Empty)";
      const bKey = String(b.row[colIndex] || "").trim() || "(Empty)";
      const cmp = aKey.localeCompare(bKey);
      if (cmp !== 0) return cmp;
      return a.rowIndex - b.rowIndex;
    });
  }, [columns, groupBy, orderedEntries]);

  const groupCounts = useMemo(() => {
    if (!groupBy) return null;
    const colIndex = columns.indexOf(groupBy);
    if (colIndex < 0) return null;
    const map = new Map<string, number>();
    rowsForDisplay.forEach(({ row }) => {
      const key = String(row[colIndex] || "").trim() || "(Empty)";
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [columns, groupBy, rowsForDisplay]);

  const showCalcRow = visibleColumns.some((item) => (columnCalcs[item.column] || "none") !== "none");

  const calcResultFor = (column: string): string => {
    const colIndex = columns.indexOf(column);
    if (colIndex < 0) return "";
    const op = columnCalcs[column] || "none";
    if (op === "none") return "";
    const values = rowsForDisplay.map(({ row }) => String(row[colIndex] || "").trim());
    if (op === "count") return String(rowsForDisplay.length);
    if (op === "count_values") return String(values.filter((value) => value.length > 0).length);
    if (op === "count_empty") return String(values.filter((value) => value.length === 0).length);
    if (op === "unique") return String(new Set(values.filter((value) => value.length > 0)).size);
    if (op === "checked" || op === "unchecked") {
      const boolValues = values.map((value) => {
        const normalized = value.trim().toLowerCase();
        return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "si";
      });
      return String(boolValues.filter((value) => value === (op === "checked")).length);
    }
    const nums = values
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    if (nums.length === 0) return "—";
    if (op === "sum") return String(nums.reduce((acc, value) => acc + value, 0));
    if (op === "avg") return String(Math.round((nums.reduce((acc, value) => acc + value, 0) / nums.length) * 100) / 100);
    if (op === "min") return String(Math.min(...nums));
    if (op === "max") return String(Math.max(...nums));
    return "";
  };
  const findColumnIndex = (...candidates: string[]) => {
    const lowered = new Set(candidates.map((candidate) => candidate.trim().toLowerCase()));
    return columns.findIndex((column) => lowered.has(column.trim().toLowerCase()));
  };

  const exportRowsAsCsv = async (scope: "all" | "favorites" | "active") => {
    const favoriteColIndex = findColumnIndex("favorite", "favourite", "favorito");
    const outcomeColIndex = findColumnIndex("outcome", "status", "estado");

    let exportRows = rows;
    if (scope === "favorites") {
      exportRows =
        favoriteColIndex >= 0
          ? rows.filter((row) => normalizeBoolLike(String(row[favoriteColIndex] || "")))
          : rows;
    }
    if (scope === "active") {
      exportRows =
        outcomeColIndex >= 0
          ? rows.filter((row) => String(row[outcomeColIndex] || "").trim().toLowerCase() === "in progress")
          : rows;
    }

    const csv = buildCsv(columns, exportRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const fileBase = (block.props.title || "editable_table").trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
    await saveBlobAsFile(blob, `${fileBase || "editable_table"}_${scope}.csv`);
  };

  const setMenuView = (next: ColumnMenuView) => {
    setColumnMenuView(next);
    setColumnMenuActiveIndex(0);
    window.requestAnimationFrame(() => {
      if (next !== "filter") columnMenuListRef.current?.focus();
    });
  };

  const getColumnKind = (column: string): TableColumnKind => columnKinds[column] || "text";
  const iconChangeType = columnMenuIconChangeType;
  const iconTypeText = columnMenuIconTypeText;
  const iconTypeNumber = columnMenuIconTypeNumber;
  const iconTypeSelect = columnMenuIconTypeSelect;
  const iconTypeDate = columnMenuIconTypeDate;
  const iconTypeCheckbox = columnMenuIconTypeCheckbox;
  const iconTypeRating = columnMenuIconTypeRating;
  const iconTypeTodo = columnMenuIconTypeTodo;
  const iconTypeContacts = columnMenuIconTypeContacts;
  const iconTypeLinks = columnMenuIconTypeLinks;
  const iconTypeDocuments = columnMenuIconTypeDocuments;
  const iconFilter = columnMenuIconFilter;
  const iconSort = columnMenuIconSort;
  const iconGroup = columnMenuIconGroup;
  const iconCalc = columnMenuIconCalc;
  const iconPin = columnMenuIconPin;
  const iconHide = columnMenuIconHide;
  const iconFit = columnMenuIconFit;
  const iconInsertLeft = columnMenuIconInsertLeft;
  const iconInsertRight = columnMenuIconInsertRight;
  const iconDuplicate = columnMenuIconDuplicate;
  const iconTrash = columnMenuIconTrash;

  const menuCol = columnMenu?.column || "";
  const menuColIndex = columns.indexOf(menuCol);
  const menuPinned = pinnedColumn === menuCol;
  const menuKind = columnMenu ? getColumnKind(menuCol) : "text";
  const currentCalc = columnMenu ? columnCalcs[menuCol] || "none" : "none";
  const filterActive = Boolean(columnMenu && (columnFilters[menuCol] || "").trim());
  const menuEntries: ColumnMenuEntry[] = (() => {
    if (!columnMenu) return [];

    const backEntry: ColumnMenuEntry = {
      kind: "item",
      key: "back",
      label: "Volver",
      icon: <span className="column-menu-back">←</span>,
      action: () => setMenuView("root")
    };

    if (columnMenuView === "type") {
      const mkType = (type: TableColumnKind, label: string, icon: React.ReactNode): ColumnMenuEntry => ({
        kind: "item",
        key: `type-${type}`,
        label,
        icon,
        disabled: !canEditStructure,
        end: menuKind === type ? <span className="column-menu-check">✓</span> : undefined,
        action: () => {
          if (!canEditStructure) return;
          updateColumnKinds({ ...columnKinds, [menuCol]: type });
          setMenuView("root");
        }
      });
      return [
        backEntry,
        mkType("text", "Texto", iconTypeText),
        mkType("number", "Numero", iconTypeNumber),
        mkType("select", "Seleccion", iconTypeSelect),
        mkType("date", "Fecha", iconTypeDate),
        mkType("checkbox", "Casilla", iconTypeCheckbox),
        mkType("rating", "Valoracion", iconTypeRating),
        mkType("todo", "To-Do Items", iconTypeTodo),
        { kind: "separator", key: "type-sep-0" },
        mkType("contacts", "Contactos", iconTypeContacts),
        mkType("links", "Links", iconTypeLinks),
        mkType("documents", "Documento", iconTypeDocuments)
      ];
    }

    if (columnMenuView === "sort") {
      const isActive = sortConfig?.column === menuCol;
      return [
        backEntry,
        {
          kind: "item",
          key: "sort-asc",
          label: "A → Z",
          icon: iconSort,
          end: isActive && sortConfig?.direction === "asc" ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setSortConfig({ column: menuCol, direction: "asc" });
            closeColumnMenu();
          }
        },
        {
          kind: "item",
          key: "sort-desc",
          label: "Z → A",
          icon: iconSort,
          end: isActive && sortConfig?.direction === "desc" ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setSortConfig({ column: menuCol, direction: "desc" });
            closeColumnMenu();
          }
        },
        ...(isActive
          ? ([
              {
                kind: "item",
                key: "sort-clear",
                label: "Quitar orden",
                icon: iconSort,
                action: () => {
                  setSortConfig(null);
                  closeColumnMenu();
                }
              }
            ] as ColumnMenuEntry[])
          : [])
      ];
    }

    if (columnMenuView === "group") {
      const active = groupBy === menuCol;
      return [
        backEntry,
        {
          kind: "item",
          key: "group-toggle",
          label: active ? "Quitar grupo" : "Agrupar por esta columna",
          icon: iconGroup,
          end: active ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setCollapsedGroups(new Set());
            setGroupBy((prev) => (prev === menuCol ? null : menuCol));
            closeColumnMenu();
          }
        }
      ];
    }

    if (columnMenuView === "calculate") {
      const isNumeric = menuKind === "number" || menuKind === "rating";
      const isCheckbox = menuKind === "checkbox";
      const entries: ColumnMenuEntry[] = [
        backEntry,
        {
          kind: "item",
          key: "calc-none",
          label: "Ninguno",
          icon: iconCalc,
          end: currentCalc === "none" ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setColumnCalcs((prev) => ({ ...prev, [menuCol]: "none" }));
            setMenuView("root");
          }
        },
        {
          kind: "item",
          key: "calc-count",
          label: "Contar filas",
          icon: iconCalc,
          end: currentCalc === "count" ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setColumnCalcs((prev) => ({ ...prev, [menuCol]: "count" }));
            setMenuView("root");
          }
        },
        {
          kind: "item",
          key: "calc-count-values",
          label: "Contar valores",
          icon: iconCalc,
          end: currentCalc === "count_values" ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setColumnCalcs((prev) => ({ ...prev, [menuCol]: "count_values" }));
            setMenuView("root");
          }
        },
        {
          kind: "item",
          key: "calc-count-empty",
          label: "Contar vacios",
          icon: iconCalc,
          end: currentCalc === "count_empty" ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setColumnCalcs((prev) => ({ ...prev, [menuCol]: "count_empty" }));
            setMenuView("root");
          }
        },
        {
          kind: "item",
          key: "calc-unique",
          label: "Valores unicos",
          icon: iconCalc,
          end: currentCalc === "unique" ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setColumnCalcs((prev) => ({ ...prev, [menuCol]: "unique" }));
            setMenuView("root");
          }
        }
      ];
      if (isNumeric) {
        entries.push(
          {
            kind: "item",
            key: "calc-sum",
            label: "Suma",
            icon: iconCalc,
            end: currentCalc === "sum" ? <span className="column-menu-check">✓</span> : undefined,
            action: () => {
              setColumnCalcs((prev) => ({ ...prev, [menuCol]: "sum" }));
              setMenuView("root");
            }
          },
          {
            kind: "item",
            key: "calc-avg",
            label: "Media",
            icon: iconCalc,
            end: currentCalc === "avg" ? <span className="column-menu-check">✓</span> : undefined,
            action: () => {
              setColumnCalcs((prev) => ({ ...prev, [menuCol]: "avg" }));
              setMenuView("root");
            }
          },
          {
            kind: "item",
            key: "calc-min",
            label: "Minimo",
            icon: iconCalc,
            end: currentCalc === "min" ? <span className="column-menu-check">✓</span> : undefined,
            action: () => {
              setColumnCalcs((prev) => ({ ...prev, [menuCol]: "min" }));
              setMenuView("root");
            }
          },
          {
            kind: "item",
            key: "calc-max",
            label: "Maximo",
            icon: iconCalc,
            end: currentCalc === "max" ? <span className="column-menu-check">✓</span> : undefined,
            action: () => {
              setColumnCalcs((prev) => ({ ...prev, [menuCol]: "max" }));
              setMenuView("root");
            }
          }
        );
      }
      if (isCheckbox) {
        entries.push(
          {
            kind: "item",
            key: "calc-checked",
            label: "Marcados",
            icon: iconCalc,
            end: currentCalc === "checked" ? <span className="column-menu-check">✓</span> : undefined,
            action: () => {
              setColumnCalcs((prev) => ({ ...prev, [menuCol]: "checked" }));
              setMenuView("root");
            }
          },
          {
            kind: "item",
            key: "calc-unchecked",
            label: "Sin marcar",
            icon: iconCalc,
            end: currentCalc === "unchecked" ? <span className="column-menu-check">✓</span> : undefined,
            action: () => {
              setColumnCalcs((prev) => ({ ...prev, [menuCol]: "unchecked" }));
              setMenuView("root");
            }
          }
        );
      }
      return entries;
    }

    if (columnMenuView === "filter") {
      return [
        backEntry,
        ...(filterActive
          ? ([
              {
                kind: "item",
                key: "filter-clear",
                label: "Borrar filtro",
                icon: iconFilter,
                action: () => {
                  setColumnFilters((prev) => ({ ...prev, [menuCol]: "" }));
                  setColumnMenu((prev) => (prev ? { ...prev, filter: "" } : prev));
                }
              }
            ] as ColumnMenuEntry[])
          : [])
      ];
    }

    return [
      {
        kind: "item",
        key: "change-type",
        label: "Cambiar tipo",
        icon: iconChangeType,
        disabled: !canEditStructure,
        submenu: "type",
        end: <ColumnMenuChevronRight />
      },
      { kind: "separator", key: "sep-0" },
      { kind: "item", key: "filter", label: "Filtrar", icon: iconFilter, submenu: "filter" },
      { kind: "item", key: "sort", label: "Ordenar", icon: iconSort, submenu: "sort" },
      { kind: "item", key: "group", label: "Grupo", icon: iconGroup, submenu: "group" },
      { kind: "item", key: "calc", label: "Calcular", icon: iconCalc, submenu: "calculate" },
      { kind: "separator", key: "sep-1" },
      {
        kind: "item",
        key: "pin",
        label: menuPinned ? "Desfijar" : "Fijar",
        icon: iconPin,
        action: () => {
          setPinnedColumn((prev) => {
            if (prev !== menuCol) return menuCol;
            const fallback = columns.find((column) => column !== menuCol && !hiddenColumns.includes(column));
            return fallback || menuCol;
          });
          if (!menuPinned) {
            setHiddenColumns((prev) => prev.filter((column) => column !== menuCol));
          }
          closeColumnMenu();
        }
      },
      {
        kind: "item",
        key: "hide",
        label: "Ocultar",
        icon: iconHide,
        action: () => hideColumn(menuCol)
      },
      {
        kind: "item",
        key: "fit",
        label: "Ajustar contenido",
        icon: iconFit,
        action: () => {
          fitColumnToContent(menuCol);
          closeColumnMenu();
        }
      },
      { kind: "separator", key: "sep-2" },
      {
        kind: "item",
        key: "insert-left",
        label: "Insertar a la izquierda",
        icon: iconInsertLeft,
        disabled: !canEditStructure,
        action: () => {
          if (!canEditStructure || menuColIndex < 0) return;
          insertColumnAt(menuColIndex);
          closeColumnMenu();
        }
      },
      {
        kind: "item",
        key: "insert-right",
        label: "Insertar a la derecha",
        icon: iconInsertRight,
        disabled: !canEditStructure,
        action: () => {
          if (!canEditStructure || menuColIndex < 0) return;
          insertColumnAt(menuColIndex + 1);
          closeColumnMenu();
        }
      },
      {
        kind: "item",
        key: "duplicate",
        label: "Duplicar propiedad",
        icon: iconDuplicate,
        disabled: !canEditStructure || menuColIndex < 0,
        action: () => {
          if (!canEditStructure || menuColIndex < 0) return;
          duplicateColumnAt(menuColIndex);
          closeColumnMenu();
        }
      },
      {
        kind: "item",
        key: "delete",
        label: "Eliminar propiedad",
        icon: iconTrash,
        disabled: !canEditStructure || menuColIndex < 0 || columns.length <= 1,
        action: () => {
          if (!canEditStructure || menuColIndex < 0 || columns.length <= 1) return;
          handleDeleteColumn(menuColIndex);
        }
      }
    ];
  })();

  const menuActiveId =
    menuEntries[columnMenuActiveIndex]?.kind === "item"
      ? `column-menu-${columnMenuView}-${columnMenuActiveIndex}`
      : undefined;

  const moveActive = (dir: -1 | 1) => {
    if (menuEntries.length === 0) return;
    let idx = columnMenuActiveIndex;
    for (let i = 0; i < menuEntries.length; i += 1) {
      idx = (idx + dir + menuEntries.length) % menuEntries.length;
      if (menuEntries[idx]?.kind === "item") {
        setColumnMenuActiveIndex(idx);
        return;
      }
    }
  };

  const activateActive = () => {
    const entry = menuEntries[columnMenuActiveIndex];
    if (!entry || entry.kind !== "item") return;
    if (entry.disabled) return;
    if (entry.submenu) {
      setMenuView(entry.submenu);
      return;
    }
    entry.action?.();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const tag = target?.tagName || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeColumnMenu();
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeColumnMenu();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateActive();
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const entry = menuEntries[columnMenuActiveIndex];
      if (entry && entry.kind === "item" && entry.submenu && !entry.disabled) {
        setMenuView(entry.submenu);
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      if (columnMenuView !== "root") {
        event.preventDefault();
        setMenuView("root");
      }
    }
  };

  const hasHiddenColumns = columns.some((column) => hiddenColumns.includes(column));
  const searchPlaceholder =
    (block.props.searchPlaceholder || "").trim() ||
    (isTrackerApplicationsSchema ? "Company, role, location..." : "Search...");

  return (
    <div ref={rootRef} className="editable-table-stack">
      <EditableTableToolbar
        toolbar={{
          leading: (
            <TrackerSearchBar
              value={query}
              onChange={setQuery}
              stageFilter={stageFilter}
              onStageFilterChange={setStageFilter}
              stages={trackerStages}
              outcomeFilter={outcomeFilter}
              onOutcomeFilterChange={setOutcomeFilter}
              outcomes={trackerOutcomes}
              placeholder={searchPlaceholder}
              allLabel="All"
              stageLabel="Stage"
              outcomeLabel="Outcome"
              filterAriaLabel="Filter"
              clearAriaLabel="Clear search"
              showAdvancedFilters={isTrackerApplicationsSchema}
            />
          ),
          columns: {
            items: columns.map((column, index) => ({
              key: column,
              label: column || `Column ${index + 1}`,
              visible: !hiddenColumns.includes(column)
            })),
            onToggle: (key) =>
              setHiddenColumns((prev) =>
                prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
              ),
            onShowAll: hasHiddenColumns ? () => setHiddenColumns([]) : undefined
          },
          trailing: (
            <>
              {extraActions}
              <button className="ghost" type="button" onClick={() => void exportRowsAsCsv("all")}>
                Export All
              </button>
              <button className="ghost" type="button" onClick={() => void exportRowsAsCsv("favorites")}>
                Export Favorites
              </button>
              <button className="ghost" type="button" onClick={() => void exportRowsAsCsv("active")}>
                Export Active
              </button>
              <button className="ghost" type="button" onClick={handleAddColumn} disabled={!canEditStructure}>
                Add Column
              </button>
              <button className="primary" type="button" onClick={handleAddRow} disabled={!canEdit}>
                {block.props.addActionLabel || "Add Row"}
              </button>
            </>
          )
        }}
      />
      <section className="table-panel">
        <button
          className="icon-button table-panel-expand"
          type="button"
          onClick={onToggleExpanded}
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
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                {visibleColumns.map(({ column, index: colIndex }) => {
                  const sortActive = sortConfig?.column === column;
                  const filterActive = Boolean(columnFilters[column]?.trim());
                  const width = getColumnWidth(column);
                  const isPinned = pinnedColumn === column;
                  return (
                    <th
                      key={`${block.id}-head-${colIndex}`}
                      className={`column-header ${isPinned ? "sticky-col" : ""} ${
                        dragOverColumn === column ? "drag-over" : ""
                      }`}
                      style={{ width, minWidth: width, left: isPinned ? 0 : undefined }}
                      draggable={canEditStructure}
                      onDragStart={(event) => {
                        if (!canEditStructure) return;
                        event.dataTransfer.setData("text/plain", column);
                        event.dataTransfer.effectAllowed = "move";
                        setDraggedColumn(column);
                      }}
                      onDragEnd={() => {
                        setDraggedColumn(null);
                        setDragOverColumn(null);
                      }}
                      onDragOver={(event) => {
                        if (!canEditStructure || !draggedColumn || draggedColumn === column) return;
                        event.preventDefault();
                        setDragOverColumn(column);
                      }}
                      onDragLeave={() => setDragOverColumn(null)}
                      onDrop={(event) => {
                        if (!canEditStructure) return;
                        event.preventDefault();
                        handleColumnReorder(column);
                      }}
                    >
                      <div className="th-content">
                        <span className="column-label" title={column || `Column ${colIndex + 1}`}>
                          {column || `Column ${colIndex + 1}`}
                        </span>
                        {sortActive && (
                          <span className="sort-indicator">
                            {sortConfig?.direction === "asc" ? "↑" : "↓"}
                          </span>
                        )}
                        {filterActive && <span className="filter-indicator" />}
                        <button
                          className="column-menu-button"
                          type="button"
                          aria-label="Column menu"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (columnMenu?.column === column) {
                              closeColumnMenu();
                            } else {
                              openColumnMenu(column, event.currentTarget);
                            }
                          }}
                        >
                          ...
                        </button>
                      </div>
                      <div
                        className="column-resizer"
                        onMouseDown={(event) => {
                          if (!canEdit) return;
                          event.preventDefault();
                          event.stopPropagation();
                          setResizing({
                            column,
                            startX: event.clientX,
                            startWidth: getColumnWidth(column)
                          });
                        }}
                      />
                    </th>
                  );
                })}
                <th className="actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rowsForDisplay.map(({ row, rowIndex }, index) => {
                const groupKey =
                  groupBy && columns.includes(groupBy)
                    ? String(row[columns.indexOf(groupBy)] || "").trim() || "(Empty)"
                    : "";
                const previousGroupKey =
                  groupBy && index > 0 && columns.includes(groupBy)
                    ? String(rowsForDisplay[index - 1].row[columns.indexOf(groupBy)] || "").trim() || "(Empty)"
                    : "";
                const firstInGroup = Boolean(groupBy && groupKey !== previousGroupKey);
                const collapsed = Boolean(groupBy && collapsedGroups.has(groupKey));

                const rowNode = (
                  <tr key={`${block.id}-row-${rowIndex}`}>
                    {visibleColumns.map(({ column, index: colIndex }) => {
                      const width = getColumnWidth(column);
                      const cellValue = row[colIndex] || "";
                      const isPinned = pinnedColumn === column;
                      return (
                        <td
                          key={`${block.id}-cell-${rowIndex}-${colIndex}`}
                          className={isPinned ? "sticky-col" : ""}
                          style={{ width, minWidth: width, left: isPinned ? 0 : undefined }}
                        >
                          {renderTypedCellByColumn({
                            column,
                            rawValue: cellValue,
                            canEditCell: canEdit,
                            highlightQuery: query,
                            onCommit: (next) => commitTypedCellValue(rowIndex, colIndex, next)
                          })}
                        </td>
                      );
                    })}
                    <td className="row-actions-cell">
                      <div className="row-actions">
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() => openDetailRow(rowIndex)}
                          aria-label="Details"
                        >
                          <svg viewBox="0 0 20 20" aria-hidden="true">
                            <path d="M10 4.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm0 1.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-.75 1.75h1.5v1.5h-1.5v-1.5Zm0 3h1.5v3h-1.5v-3Z" />
                          </svg>
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() => openEditRow(rowIndex)}
                          aria-label="Edit"
                          disabled={!canEdit}
                        >
                          <svg viewBox="0 0 20 20" aria-hidden="true">
                            <path d="M14.85 2.85a1.5 1.5 0 0 1 2.12 2.12l-9.5 9.5-3.2.35.35-3.2 9.5-9.5ZM4.3 15.7h11.4v1.5H4.3v-1.5Z" />
                          </svg>
                        </button>
                        <button
                          className="icon-button danger"
                          type="button"
                          onClick={() => handleDeleteRow(rowIndex)}
                          aria-label="Delete"
                          disabled={!canEdit}
                        >
                          <svg viewBox="0 0 20 20" aria-hidden="true">
                            <path d="M7.5 3.5h5l.5 1.5H17v1.5H3V5h3.5l.5-1.5Zm1 4h1.5v7H8.5v-7Zm3 0H13v7h-1.5v-7ZM5.5 6.5h9l-.6 9.1a1.5 1.5 0 0 1-1.5 1.4H7.6a1.5 1.5 0 0 1-1.5-1.4l-.6-9.1Z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );

                if (!groupBy) return rowNode;

                return (
                  <React.Fragment key={`${block.id}-group-${groupKey}-${rowIndex}`}>
                    {firstInGroup && (
                      <tr className="group-row">
                        <td colSpan={visibleColumns.length + 1}>
                          <button
                            className="group-toggle"
                            type="button"
                            onClick={() =>
                              setCollapsedGroups((prev) => {
                                const next = new Set(prev);
                                if (next.has(groupKey)) next.delete(groupKey);
                                else next.add(groupKey);
                                return next;
                              })
                            }
                          >
                            <span className="group-caret">{collapsed ? "▸" : "▾"}</span>
                            <span className="group-title">{groupKey}</span>
                            <span className="group-count">{groupCounts?.get(groupKey) || 0}</span>
                          </button>
                        </td>
                      </tr>
                    )}
                    {!collapsed && rowNode}
                  </React.Fragment>
                );
              })}
            </tbody>
            {showCalcRow && (
              <tfoot>
                <tr className="calc-row">
                  {visibleColumns.map(({ column, index }) => {
                    const width = getColumnWidth(column);
                    const isPinned = pinnedColumn === column;
                    return (
                      <td
                        key={`${block.id}-calc-${index}`}
                        className={isPinned ? "sticky-col" : ""}
                        style={{ width, minWidth: width, left: isPinned ? 0 : undefined }}
                      >
                        <div className="calc-cell">{calcResultFor(column)}</div>
                      </td>
                    );
                  })}
                  <td className="row-actions-cell" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {rowsForDisplay.length === 0 && <div className="empty">No rows match your search.</div>}
      </section>
      {columnMenu &&
        columnMenuPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className={`column-menu ${columnMenuVisible ? "open" : ""}`}
            data-placement={columnMenuPlacement}
            ref={columnMenuRef}
            style={{ top: columnMenuPos.top, left: columnMenuPos.left }}
            role="dialog"
            aria-modal="false"
          >
            <div className="column-menu-content">
              <div className="column-menu-header">
                <button
                  className="column-menu-type-button"
                  type="button"
                  onClick={() => {
                    if (!canEditStructure) return;
                    setMenuView("type");
                  }}
                  aria-label="Cambiar tipo"
                  disabled={!canEditStructure}
                >
                  {iconChangeType}
                </button>
                <input
                  className="column-menu-rename-input"
                  type="text"
                  value={columnMenu.rename}
                  readOnly={!canEditStructure}
                  onChange={(event) =>
                    setColumnMenu((prev) => (prev ? { ...prev, rename: event.target.value } : prev))
                  }
                  onBlur={() => applyColumnRename()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      applyColumnRename();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setColumnMenu((prev) => (prev ? { ...prev, rename: prev.column } : prev));
                    }
                  }}
                  placeholder="Nombre de la propiedad"
                />
              </div>
              <div className="column-menu-scroller">
                {columnMenuView === "filter" && (
                  <div className="column-menu-filter">
                    <input
                      ref={columnMenuFilterInputRef}
                      className="column-menu-filter-input"
                      type="text"
                      value={columnMenu.filter}
                      onChange={(event) => {
                        const value = event.target.value;
                        setColumnMenu((prev) => (prev ? { ...prev, filter: value } : prev));
                        setColumnFilters((prev) => ({ ...prev, [columnMenu.column]: value }));
                      }}
                      placeholder="Escribe para filtrar..."
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.stopPropagation();
                          closeColumnMenu();
                        }
                      }}
                    />
                  </div>
                )}
                <div
                  className="column-menu-list"
                  role="menu"
                  tabIndex={0}
                  ref={columnMenuListRef}
                  aria-activedescendant={menuActiveId}
                  onKeyDown={handleMenuKeyDown}
                >
                  {menuEntries.map((entry, index) => {
                    if (entry.kind === "separator") {
                      return (
                        <div
                          key={entry.key}
                          className="column-menu-separator"
                          role="separator"
                        />
                      );
                    }
                    const isActive = index === columnMenuActiveIndex;
                    const onClick = () => {
                      if (entry.disabled) return;
                      if (entry.submenu) {
                        setMenuView(entry.submenu);
                        return;
                      }
                      entry.action?.();
                    };
                    return (
                      <div
                        key={entry.key}
                        id={`column-menu-${columnMenuView}-${index}`}
                        role="menuitem"
                        aria-disabled={entry.disabled ? "true" : undefined}
                        aria-haspopup={entry.submenu ? "dialog" : undefined}
                        aria-expanded={entry.submenu ? (columnMenuView === entry.submenu ? "true" : "false") : undefined}
                        className={`column-menu-item ${isActive ? "active" : ""} ${
                          entry.disabled ? "disabled" : ""
                        }`}
                        onMouseEnter={() => setColumnMenuActiveIndex(index)}
                        onClick={onClick}
                      >
                        <span className="column-menu-item-icon">{entry.icon}</span>
                        <span className="column-menu-item-label">{entry.label}</span>
                        <span className="column-menu-item-end">
                          {entry.end ?? (entry.submenu ? <ColumnMenuChevronRight /> : null)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
      {detailRowIndex !== null &&
        rows[detailRowIndex] &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            onClick={() => setDetailRowIndex(null)}
          >
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <header className="modal-header">
                <div>
                  <h2>Row details</h2>
                  <p>Row {detailRowIndex + 1}</p>
                </div>
                <button className="ghost" type="button" onClick={() => setDetailRowIndex(null)} aria-label="Close">
                  ×
                </button>
              </header>
              <div className="form-grid">
                {columns.map((column, colIndex) => (
                  <div className="field" key={`${block.id}-detail-${detailRowIndex}-${colIndex}`}>
                    <label>{column || `Column ${colIndex + 1}`}</label>
                    <input value={rows[detailRowIndex][colIndex] || ""} readOnly />
                  </div>
                ))}
              </div>
            </div>
          </div>,
          document.body
        )}
      {editRowIndex !== null &&
        editRowDraft &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            onClick={() => {
              setEditRowIndex(null);
              setEditRowDraft(null);
            }}
          >
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <header className="modal-header">
                <div>
                  <h2>{isTrackerApplicationsSchema ? "Edit Application" : "Edit row"}</h2>
                  <p>{isTrackerApplicationsSchema ? "Update values by column type." : `Row ${editRowIndex + 1}`}</p>
                </div>
                <button
                  className="ghost"
                  type="button"
                  onClick={() => {
                    setEditRowIndex(null);
                    setEditRowDraft(null);
                  }}
                  aria-label="Close"
                >
                  ×
                </button>
              </header>
              <div className="form-grid">
                {columns.map((column, colIndex) => (
                  <div className="field" key={`${block.id}-edit-${editRowIndex}-${colIndex}`}>
                    <label>{column || `Column ${colIndex + 1}`}</label>
                    {renderTypedCellByColumn({
                      column,
                      rawValue: editRowDraft[colIndex] || "",
                      canEditCell: true,
                      onCommit: (next) => commitTypedDraftCellValue(colIndex, next)
                    })}
                  </div>
                ))}
                <div className="form-actions">
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => {
                      setEditRowIndex(null);
                      setEditRowDraft(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button className="primary" type="button" onClick={saveEditedRow}>
                    Save changes
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

const EditableTableBlockPanel: React.FC<BlockRenderContext<"editableTable">> = ({
  block,
  mode,
  patchBlockProps,
  updateBlockProps,
  resolveSlot,
  menuActions
}) => {
  const { settings, saveSettings } = useAppData();
  const [isTableExpanded, setIsTableExpanded] = useState(false);
  const [isTodoLinkModalOpen, setIsTodoLinkModalOpen] = useState(false);

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

  const linkTargets = useMemo(
    () => collectEditableTableTargets(settings, { excludeVariants: ["todo"] }),
    [settings]
  );
  const linkedTableId = getBlockLink(block.props, TODO_SOURCE_TABLE_LINK_KEY);
  const linkedTableTarget = linkedTableId
    ? linkTargets.find((target) => target.blockId === linkedTableId) || null
    : null;

  const openTodoLinkPicker = () => {
    setIsTodoLinkModalOpen(true);
  };

  const setTodoLinkedTable = (nextBlockId?: string | null) => {
    patchBlockProps(
      patchBlockLink(block.props, TODO_SOURCE_TABLE_LINK_KEY, nextBlockId) as Partial<
        PageBlockPropsMap["editableTable"]
      >
    );
    setIsTodoLinkModalOpen(false);
  };

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
    if (mode === "edit" && block.props.variant === "todo") {
      const linkLabel = linkedTableTarget
        ? `Tabla vinculada: ${linkedTableTarget.title}`
        : "Vincular con tabla editable";
      actions.push({
        key: `todo-link-table-${block.id}`,
        label: linkLabel,
        onClick: openTodoLinkPicker
      });
    }
    return [...actions, ...baseActions];
  }, [block.id, block.props.variant, density, linkedTableTarget, menuActions, mode, openTodoLinkPicker, saveSettings]);

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
    usesFallbackTable && isTableExpanded ? "table-panel-expanded" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const fallbackTable = (
    <DefaultEditableTable
      block={block as PageBlockConfig<"editableTable">}
      mode={mode}
      settings={settings}
      saveSettings={saveSettings}
      patchBlockProps={(patch) => patchBlockProps(patch as Partial<PageBlockPropsMap["editableTable"]>)}
      extraActions={toolbarActions}
      isExpanded={usesFallbackTable && isTableExpanded}
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
        {toolbar || content ? (
          <>
            {toolbar}
            {content || fallbackTable}
          </>
        ) : (
          fallbackTable
        )}
      </BlockPanel>
      {isTodoLinkModalOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setIsTodoLinkModalOpen(false)}>
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <header className="modal-header">
                <div>
                  <h2>Vincular tabla editable</h2>
                  <p>Selecciona la tabla por titulo.</p>
                </div>
                <button className="ghost" type="button" onClick={() => setIsTodoLinkModalOpen(false)} aria-label="Close">
                  ×
                </button>
              </header>
              <div className="todo-link-modal-body">
                {linkTargets.length === 0 ? (
                  <div className="empty">No hay tablas editables disponibles.</div>
                ) : (
                  <div className="todo-link-table-wrap">
                    <table className="table todo-link-table">
                      <thead>
                        <tr>
                          <th>Titulo</th>
                          <th>Pagina</th>
                          <th>To-Do</th>
                          <th>Accion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {linkTargets.map((target) => {
                          const isActive = target.blockId === linkedTableId;
                          return (
                            <tr key={target.blockId} className={isActive ? "is-active" : undefined}>
                              <td>{target.title}</td>
                              <td>{target.pageId}</td>
                              <td>{target.hasTodoColumn ? "Si" : "No"}</td>
                              <td className="todo-link-action-cell">
                                <button
                                  className={isActive ? "ghost" : "primary"}
                                  type="button"
                                  onClick={() => setTodoLinkedTable(target.blockId)}
                                >
                                  {isActive ? "Vinculada" : "Vincular"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="todo-link-footer">
                  <button className="ghost" type="button" onClick={() => setTodoLinkedTable(null)}>
                    Sin vinculo
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
      {usesFallbackTable &&
        isTableExpanded &&
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

export const EDITABLE_TABLE_BLOCK_DEFINITION: BlockDefinition<"editableTable"> = {
  type: "editableTable",
  defaultLayout: { colSpan: 60 },
  createDefaultProps: () => ({
    title: "Editable table",
    description: "Table block",
    variant: "tracker",
    searchPlaceholder: "Search...",
    addActionLabel: "Add Row",
    customColumns: ["Column 1", "Column 2", "Column 3"],
    customColumnTypes: {},
    customRows: [["", "", ""]]
  }),
  component: (ctx) => <EditableTableBlockPanel {...ctx} />
};
