import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { saveBlobAsFile } from "../../../api";
import BlockPanel from "../../BlockPanel";
import StarRating from "../../StarRating";
import { DateCell, SelectCell, type SelectOption, TextCell } from "../../TableCells";
import TrackerSearchBar from "../../tracker/TrackerSearchBar";
import {
  type EditableTableColumnKind,
  type PageBlockConfig,
  type PageBlockPropsMap
} from "../types";
import { createSlotContext, renderHeader } from "./shared";
import { type BlockDefinition, type BlockRenderContext, type BlockRenderMode } from "./types";

const DEFAULT_TABLE_COLUMNS = ["Column 1", "Column 2", "Column 3"];
const DEFAULT_TABLE_ROWS = [["", "", ""]];
const MAX_TABLE_COLUMNS = 24;
const MAX_TABLE_ROWS = 1200;
const DEFAULT_TABLE_COLUMN_WIDTH = 180;
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
    return DEFAULT_TABLE_ROWS.map((row) => row.slice(0, normalizedColumnCount));
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

type DefaultEditableTableProps = {
  block: PageBlockConfig<"editableTable">;
  mode: BlockRenderMode;
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

type TableNumberCellProps = {
  value: string;
  step?: number;
  placeholder?: string;
  onCommit: (next: string) => void;
};

const TableNumberCell: React.FC<TableNumberCellProps> = ({ value, step = 1, placeholder, onCommit }) => {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      if (value !== "") onCommit("");
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed)) {
      setDraft(value);
      return;
    }
    const next = String(parsed);
    if (next === value) return;
    onCommit(next);
  };

  return (
    <input
      className="cell-number"
      type="number"
      step={step}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(value);
        }
      }}
      placeholder={placeholder}
    />
  );
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

const ColumnMenuIcon: React.FC<{ viewBox?: string; children: React.ReactNode }> = ({
  viewBox = "0 0 20 20",
  children
}) => (
  <svg aria-hidden="true" viewBox={viewBox} className="column-menu-icon">
    {children}
  </svg>
);

const ColumnMenuChevronRight = () => (
  <ColumnMenuIcon viewBox="0 0 16 16">
    <path d="M6.722 3.238a.625.625 0 1 0-.884.884L9.716 8l-3.878 3.878a.625.625 0 0 0 .884.884l4.32-4.32a.625.625 0 0 0 0-.884z" />
  </ColumnMenuIcon>
);

const DefaultEditableTable: React.FC<DefaultEditableTableProps> = ({
  block,
  mode,
  patchBlockProps,
  extraActions,
  isExpanded,
  onToggleExpanded
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  const columnMenuListRef = useRef<HTMLDivElement | null>(null);
  const columnMenuFilterInputRef = useRef<HTMLInputElement | null>(null);
  const columnMenuAnchorRef = useRef<HTMLElement | null>(null);
  const columnMenuCloseTimerRef = useRef<number | null>(null);
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
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
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizing, setResizing] = useState<{ column: string; startX: number; startWidth: number } | null>(null);
  const columns = useMemo(() => normalizeTableColumns(block.props.customColumns), [block.props.customColumns]);
  const persistedColumnKinds = useMemo(
    () => normalizeTableColumnKinds(block.props.customColumnTypes, columns),
    [block.props.customColumnTypes, columns]
  );
  const [columnKinds, setColumnKinds] = useState<Record<string, TableColumnKind>>(persistedColumnKinds);
  const rows = useMemo(
    () => normalizeTableRows(block.props.customRows, columns.length),
    [block.props.customRows, columns.length]
  );
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
    setColumnKinds(persistedColumnKinds);
  }, [persistedColumnKinds]);

  useEffect(() => {
    setPinnedColumn((prev) => (prev && columns.includes(prev) ? prev : null));
  }, [columns]);

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
      const nextWidth = Math.max(90, resizing.startWidth + delta);
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
      next[column] = buildSelectOptionsFromRows(index, rows);
    });
    return next;
  }, [columns, rows]);

  const persistTable = (nextColumns: string[], nextRows: string[][]) => {
    patchBlockProps({
      customColumns: normalizeTableColumns(nextColumns),
      customRows: normalizeTableRows(nextRows, nextColumns.length)
    });
  };

  const updateColumnKinds = (
    nextKinds: Record<string, TableColumnKind>,
    columnList: string[] = columns
  ) => {
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
    const oldName = columns[colIndex];
    const nextName = value.trim() || oldName;
    const nextColumns = [...columns];
    nextColumns[colIndex] = nextName;
    persistTable(nextColumns, rows);
    renameColumnMeta(oldName, nextName, nextColumns);
    setColumnMenu((prev) =>
      prev && prev.column === oldName ? { ...prev, column: nextName, rename: nextName } : prev
    );
  };

  const handleDeleteColumn = (colIndex: number) => {
    if (columns.length <= 1) return;
    const columnLabel = columns[colIndex] || `Column ${colIndex + 1}`;
    const confirmed = window.confirm(
      `Delete "${columnLabel}" column? This action cannot be undone.`
    );
    if (!confirmed) return;
    const column = columns[colIndex];
    const nextColumns = columns.filter((_, index) => index !== colIndex);
    const nextRows = rows.map((row) => row.filter((_, index) => index !== colIndex));
    persistTable(nextColumns, nextRows);
    clearColumnMeta(column, nextColumns);
    setColumnMenu(null);
  };

  const handleAddColumn = () => {
    const nextColumns = [...columns, `Column ${columns.length + 1}`];
    const nextRows = rows.map((row) => [...row, ""]);
    persistTable(nextColumns, nextRows);
  };

  const insertColumnAt = (index: number) => {
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
    persistTable(nextColumns, nextRows);
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

  const handleDeleteRow = (rowIndex: number) => {
    const confirmed = window.confirm(
      `Delete row ${rowIndex + 1}? This action cannot be undone.`
    );
    if (!confirmed) return;
    const nextRows = rows.filter((_, index) => index !== rowIndex);
    persistTable(columns, nextRows);
  };

  const handleCellChange = (rowIndex: number, colIndex: number, value: string) => {
    const nextRows = rows.map((row, index) =>
      index === rowIndex ? row.map((cell, cellIndex) => (cellIndex === colIndex ? value : cell)) : row
    );
    persistTable(columns, nextRows);
  };

  const moveColumn = (fromIndex: number, toIndex: number) => {
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
    const nextWidth = Math.max(120, Math.min(560, maxLen * 8 + 36));
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

  const getColumnWidth = (column: string) => columnWidths[column] || DEFAULT_TABLE_COLUMN_WIDTH;

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

  const filteredEntries = useMemo(() => {
    const activeFilters = Object.entries(columnFilters).filter(([, value]) => value.trim().length > 0);
    if (activeFilters.length === 0) return searchedEntries;
    return searchedEntries.filter(({ row }) =>
      activeFilters.every(([column, value]) => {
        const colIndex = columns.indexOf(column);
        if (colIndex < 0) return true;
        return String(row[colIndex] || "").toLowerCase().includes(value.trim().toLowerCase());
      })
    );
  }, [columnFilters, columns, searchedEntries]);

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
  const canEdit = mode === "edit";

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
  const iconChangeType = (
    <ColumnMenuIcon>
      <path d="M6.475 3.125a.625.625 0 1 0 0 1.25h7.975c.65 0 1.175.526 1.175 1.175v6.057l-1.408-1.408a.625.625 0 1 0-.884.884l2.475 2.475a.625.625 0 0 0 .884 0l2.475-2.475a.625.625 0 0 0-.884-.884l-1.408 1.408V5.55a2.425 2.425 0 0 0-2.425-2.425zM3.308 6.442a.625.625 0 0 1 .884 0l2.475 2.475a.625.625 0 1 1-.884.884L4.375 8.393v6.057c0 .649.526 1.175 1.175 1.175h7.975a.625.625 0 0 1 0 1.25H5.55a2.425 2.425 0 0 1-2.425-2.425V8.393L1.717 9.801a.625.625 0 1 1-.884-.884z" />
    </ColumnMenuIcon>
  );
  const iconTypeText = (
    <ColumnMenuIcon>
      <path d="M4 5.25c0-.345.28-.625.625-.625h10.75a.625.625 0 1 1 0 1.25H4.625A.625.625 0 0 1 4 5.25m0 4c0-.345.28-.625.625-.625h7.25a.625.625 0 1 1 0 1.25h-7.25A.625.625 0 0 1 4 9.25m0 4c0-.345.28-.625.625-.625h10.75a.625.625 0 1 1 0 1.25H4.625A.625.625 0 0 1 4 13.25" />
    </ColumnMenuIcon>
  );
  const iconTypeNumber = (
    <ColumnMenuIcon>
      <path d="M7.25 4.25a.625.625 0 0 1 1.23.252L8.24 5.75h3.52l.26-1.498a.625.625 0 1 1 1.23.216l-.23 1.282h1.355a.625.625 0 1 1 0 1.25h-1.58l-.7 4h1.655a.625.625 0 1 1 0 1.25H12.86l-.255 1.458a.625.625 0 0 1-1.23-.216l.216-1.242H8.06l-.255 1.458a.625.625 0 0 1-1.23-.216l.216-1.242H5.375a.625.625 0 1 1 0-1.25h1.64l.7-4H6.125a.625.625 0 1 1 0-1.25h1.81zm1.28 2.75-.7 4h3.52l.7-4z" />
    </ColumnMenuIcon>
  );
  const iconTypeSelect = (
    <ColumnMenuIcon>
      <path d="M5.5 5.5h9A1.5 1.5 0 0 1 16 7v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 13V7a1.5 1.5 0 0 1 1.5-1.5m0 1.25a.25.25 0 0 0-.25.25v6c0 .138.112.25.25.25h9a.25.25 0 0 0 .25-.25V7a.25.25 0 0 0-.25-.25zm3.4 2.2a.625.625 0 0 1 .884 0L10 9.366l.216-.216a.625.625 0 1 1 .884.884l-.658.658a.625.625 0 0 1-.884 0L8.9 10.034a.625.625 0 0 1 0-.884" />
    </ColumnMenuIcon>
  );
  const iconTypeDate = (
    <ColumnMenuIcon>
      <path d="M6.25 3.5a.625.625 0 0 1 .625.625V5h6.25v-.875a.625.625 0 1 1 1.25 0V5h.375A1.75 1.75 0 0 1 16.5 6.75v8.5A1.75 1.75 0 0 1 14.75 17h-9.5A1.75 1.75 0 0 1 3.5 15.25v-8.5A1.75 1.75 0 0 1 5.25 5h.375v-.875A.625.625 0 0 1 6.25 3.5m-1 2.75a.5.5 0 0 0-.5.5v1h10.5v-1a.5.5 0 0 0-.5-.5zm-.5 3v6a.5.5 0 0 0 .5.5h9.5a.5.5 0 0 0 .5-.5v-6z" />
    </ColumnMenuIcon>
  );
  const iconTypeCheckbox = (
    <ColumnMenuIcon>
      <path d="M6 4.75h8A1.25 1.25 0 0 1 15.25 6v8A1.25 1.25 0 0 1 14 15.25H6A1.25 1.25 0 0 1 4.75 14V6A1.25 1.25 0 0 1 6 4.75m0 1.25a.0 0 0 0-.0 0v8a.0 0 0 0 .0 0h8a.0 0 0 0 .0 0V6a.0 0 0 0-.0 0zm7.192 2.442a.625.625 0 0 1 0 .884l-3.25 3.25a.625.625 0 0 1-.884 0l-1.75-1.75a.625.625 0 1 1 .884-.884l1.308 1.308 2.808-2.808a.625.625 0 0 1 .884 0" />
    </ColumnMenuIcon>
  );
  const iconTypeRating = (
    <ColumnMenuIcon>
      <path d="M10 3.25a.75.75 0 0 1 .684.444l1.6 3.5 3.79.38a.75.75 0 0 1 .422 1.305l-2.82 2.44.82 3.66a.75.75 0 0 1-1.11.81L10 13.64 6.614 15.79a.75.75 0 0 1-1.11-.81l.82-3.66-2.82-2.44a.75.75 0 0 1 .422-1.305l3.79-.38 1.6-3.5A.75.75 0 0 1 10 3.25m0 2.59-1.02 2.23a.75.75 0 0 1-.585.43l-2.42.243 1.8 1.557a.75.75 0 0 1 .24.742l-.53 2.36 2.18-1.385a.75.75 0 0 1 .805 0l2.18 1.385-.53-2.36a.75.75 0 0 1 .24-.742l1.8-1.557-2.42-.243a.75.75 0 0 1-.585-.43z" />
    </ColumnMenuIcon>
  );
  const iconTypeContacts = (
    <ColumnMenuIcon>
      <path d="M10 3.5a3.25 3.25 0 1 1 0 6.5 3.25 3.25 0 0 1 0-6.5m0 1.25a2 2 0 1 0 0 4 2 2 0 0 0 0-4m0 6.75c2.9 0 5.25 1.68 5.25 3.75 0 .69-.56 1.25-1.25 1.25H6c-.69 0-1.25-.56-1.25-1.25 0-2.07 2.35-3.75 5.25-3.75m0 1.25c-2.14 0-4 1.17-4 2.5h8c0-1.33-1.86-2.5-4-2.5" />
    </ColumnMenuIcon>
  );
  const iconTypeLinks = (
    <ColumnMenuIcon>
      <path d="M8.22 7.28a2.5 2.5 0 0 1 3.536 0 .625.625 0 1 1-.884.884 1.25 1.25 0 0 0-1.768 0l-1.06 1.06a1.25 1.25 0 0 0 0 1.768.625.625 0 1 1-.884.884 2.5 2.5 0 0 1 0-3.536zM11.78 12.72a2.5 2.5 0 0 1-3.536 0 .625.625 0 1 1 .884-.884 1.25 1.25 0 0 0 1.768 0l1.06-1.06a1.25 1.25 0 0 0 0-1.768.625.625 0 1 1 .884-.884 2.5 2.5 0 0 1 0 3.536z" />
    </ColumnMenuIcon>
  );
  const iconTypeDocuments = (
    <ColumnMenuIcon>
      <path d="M5 2.5h6l4 4V17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Zm6 1.5H6v12h8V8h-3V4Z" />
    </ColumnMenuIcon>
  );
  const iconFilter = (
    <ColumnMenuIcon>
      <path d="M3 4.875a.625.625 0 1 0 0 1.25h14a.625.625 0 1 0 0-1.25zm2.125 5.742h9.75a.625.625 0 1 0 0-1.25h-9.75a.625.625 0 1 0 0 1.25m1.5 3.883c0-.345.28-.625.625-.625h5.5a.625.625 0 1 1 0 1.25h-5.5a.625.625 0 0 1-.625-.625" />
    </ColumnMenuIcon>
  );
  const iconSort = (
    <ColumnMenuIcon>
      <path d="M14.075 3.45a.625.625 0 0 0-.884 0l-3.497 3.5a.625.625 0 0 0 .883.884l2.431-2.431v10.705a.625.625 0 0 0 1.25 0V5.402l2.431 2.43a.625.625 0 1 0 .884-.883zM2.427 12.167a.625.625 0 0 1 .884 0l2.43 2.431V3.893a.625.625 0 0 1 1.25 0v10.705l2.431-2.43a.625.625 0 0 1 .884.883L6.81 16.55a.625.625 0 0 1-.884 0l-3.498-3.498a.625.625 0 0 1 0-.884" />
    </ColumnMenuIcon>
  );
  const iconGroup = (
    <ColumnMenuIcon>
      <path d="M3.925 2.95a.55.55 0 1 0 0 1.1h12.15a.55.55 0 1 0 0-1.1zm0 7.767a.55.55 0 0 0 0 1.1h12.15a.55.55 0 1 0 0-1.1zm-.55-4.234a1 1 0 0 1 1-1h1.8a1 1 0 0 1 1 1v1.8a1 1 0 0 1-1 1h-1.8a1 1 0 0 1-1-1zm1.1.1v1.6h1.6v-1.6zm4.625-1.1a1 1 0 0 0-1 1v1.8a1 1 0 0 0 1 1h1.8a1 1 0 0 0 1-1v-1.8a1 1 0 0 0-1-1zm.1 2.7v-1.6h1.6v1.6zm3.625-1.7a1 1 0 0 1 1-1h1.8a1 1 0 0 1 1 1v1.8a1 1 0 0 1-1 1h-1.8a1 1 0 0 1-1-1zm1.1.1v1.6h1.6v-1.6zm-9.55 6.667a1 1 0 0 0-1 1v1.8a1 1 0 0 0 1 1h1.8a1 1 0 0 0 1-1v-1.8a1 1 0 0 0-1-1zm.1 2.7v-1.6h1.6v1.6zm3.625-1.7a1 1 0 0 1 1-1h1.8a1 1 0 0 1 1 1v1.8a1 1 0 0 1-1 1H9.1a1 1 0 0 1-1-1zm1.1.1v1.6h1.6v-1.6zm4.625-1.1a1 1 0 0 0-1 1v1.8a1 1 0 0 0 1 1h1.8a1 1 0 0 0 1-1v-1.8a1 1 0 0 0-1-1zm.1 2.7v-1.6h1.6v1.6z" />
    </ColumnMenuIcon>
  );
  const iconCalc = (
    <ColumnMenuIcon>
      <path d="M4.78 3.524a.63.63 0 0 1 .583-.399h9.274a.625.625 0 1 1 0 1.25H6.976l5.663 5.163a.625.625 0 0 1 0 .924l-5.663 5.163h7.661a.625.625 0 1 1 0 1.25H5.363a.625.625 0 0 1-.421-1.087L11.29 10 4.942 4.212a.625.625 0 0 1-.162-.688" />
    </ColumnMenuIcon>
  );
  const iconPin = (
    <ColumnMenuIcon>
      <path d="M6.653 2.375A.625.625 0 0 0 6.028 3v.474A3.62 3.62 0 0 0 7.24 6.179l.289.258-.157 1.603a4.625 4.625 0 0 0-2.997 4.33V13c0 .345.28.625.625.625h4.13v3.08c0 .158.035.317.1.46l.433.94a.35.35 0 0 0 .565.103l.063-.087.44-.956c.065-.142.1-.3.1-.46v-3.08H15c.345 0 .625-.28.625-.625v-.63a4.625 4.625 0 0 0-2.997-4.33l-.157-1.603.289-.258a3.63 3.63 0 0 0 1.212-2.705V3a.625.625 0 0 0-.625-.625zm1.42 2.871c-.468-.417-.75-1-.79-1.621h5.434a2.38 2.38 0 0 1-.79 1.621l-.525.47a.63.63 0 0 0-.206.527l.227 2.318a.63.63 0 0 0 .422.531l.237.08a3.375 3.375 0 0 1 2.293 3.197v.006h-8.75v-.006c0-1.447.922-2.733 2.293-3.197l.237-.08a.63.63 0 0 0 .422-.531l.227-2.318a.63.63 0 0 0-.206-.528z" />
    </ColumnMenuIcon>
  );
  const iconHide = (
    <ColumnMenuIcon>
      <path d="M3.893 2.875a.626.626 0 0 1 .79-.02l.092.088.126.146.016.035.072.105 11.273 13.15a.624.624 0 0 1-1.036.678l-1.615-1.884c-1.12.408-2.339.633-3.611.633-3.757 0-7.049-1.946-8.707-4.843l-.155-.283a1.46 1.46 0 0 1 0-1.359l.155-.283c.89-1.554 2.249-2.835 3.898-3.688L3.826 3.757l-.072-.105a.626.626 0 0 1 .14-.777M6.031 6.33c-1.564.744-2.842 1.913-3.653 3.33l-.134.243a.21.21 0 0 0 0 .197l.134.243c1.426 2.49 4.292 4.214 7.622 4.214.958 0 1.877-.144 2.734-.406l-1.1-1.284a3.3 3.3 0 0 1-1.634.438l-.17-.004a3.307 3.307 0 0 1-3.132-3.133l-.004-.17c0-.777.269-1.492.718-2.056zm2.904 3.387q-.037.135-.038.281a1.104 1.104 0 0 0 1.218 1.097zM10 4.194c3.878 0 7.26 2.075 8.862 5.127l.074.164c.125.332.125.7 0 1.032l-.074.163a9.3 9.3 0 0 1-2.987 3.327l-.82-.955c1.15-.764 2.084-1.779 2.7-2.953l.02-.048a.2.2 0 0 0 0-.1l-.02-.049C16.382 7.282 13.438 5.445 10 5.445q-.705 0-1.378.1l-.94-1.098A10.7 10.7 0 0 1 10 4.194" />
      <path d="M10.17 6.694a3.307 3.307 0 0 1 3.136 3.303l-.005.17a3.3 3.3 0 0 1-.116.702L9.624 6.713A3 3 0 0 1 10 6.691z" />
    </ColumnMenuIcon>
  );
  const iconFit = (
    <ColumnMenuIcon>
      <path d="M16.625 8A2.625 2.625 0 0 0 14 5.375h-1.42a.625.625 0 1 1 0-1.25H14a3.875 3.875 0 0 1 0 7.75H4.259l3.333 3.333a.625.625 0 0 1-.884.884l-4.4-4.4a.625.625 0 0 1 0-.884l4.4-4.4a.625.625 0 0 1 .884.884l-3.333 3.333H14A2.625 2.625 0 0 0 16.625 8" />
    </ColumnMenuIcon>
  );
  const iconInsertLeft = (
    <ColumnMenuIcon>
      <path d="M3.024 3.524a1.92 1.92 0 0 0-1.918 1.92v9.113a1.92 1.92 0 0 0 3.837 0V5.444a1.92 1.92 0 0 0-1.919-1.92m0 1.251c.37 0 .67.3.67.67v9.112a.67.67 0 0 1-1.338 0V5.444c0-.369.3-.668.668-.669m8.612.383a.625.625 0 0 0-.884 0l-4.4 4.4a.626.626 0 0 0 0 .884l4.4 4.4a.626.626 0 0 0 .884-.884l-3.334-3.333h9.967a.625.625 0 0 0 0-1.25H8.303l3.333-3.333a.625.625 0 0 0 0-.884" />
    </ColumnMenuIcon>
  );
  const iconInsertRight = (
    <ColumnMenuIcon>
      <path d="M16.976 3.524a1.92 1.92 0 0 1 1.918 1.92v9.113a1.92 1.92 0 0 1-3.837 0V5.444c0-1.06.859-1.92 1.919-1.92m0 1.251a.67.67 0 0 0-.67.67v9.112a.67.67 0 0 0 1.338 0V5.444a.67.67 0 0 0-.668-.669m-8.612.383a.625.625 0 0 1 .884 0l4.4 4.4a.626.626 0 0 1 0 .884l-4.4 4.4a.626.626 0 0 1-.884-.884l3.334-3.333H1.731a.625.625 0 0 1 0-1.25h9.966L8.364 6.042a.625.625 0 0 1 0-.884" />
    </ColumnMenuIcon>
  );
  const iconDuplicate = (
    <ColumnMenuIcon>
      <path d="M4.5 2.375A2.125 2.125 0 0 0 2.375 4.5V12c0 1.174.951 2.125 2.125 2.125h1.625v1.625c0 1.174.951 2.125 2.125 2.125h7.5a2.125 2.125 0 0 0 2.125-2.125v-7.5a2.125 2.125 0 0 0-2.125-2.125h-1.625V4.5A2.125 2.125 0 0 0 12 2.375zm8.375 3.75H8.25A2.125 2.125 0 0 0 6.125 8.25v4.625H4.5A.875.875 0 0 1 3.625 12V4.5c0-.483.392-.875.875-.875H12c.483 0 .875.392.875.875zm-5.5 2.125c0-.483.392-.875.875-.875h7.5c.483 0 .875.392.875.875v7.5a.875.875 0 0 1-.875.875h-7.5a.875.875 0 0 1-.875-.875z" />
    </ColumnMenuIcon>
  );
  const iconTrash = (
    <ColumnMenuIcon>
      <path d="M8.806 8.505a.55.55 0 0 0-1.1 0v5.979a.55.55 0 1 0 1.1 0zm3.488 0a.55.55 0 0 0-1.1 0v5.979a.55.55 0 0 0 1.1 0z" />
      <path d="M6.386 3.925v1.464H3.523a.625.625 0 1 0 0 1.25h.897l.393 8.646A2.425 2.425 0 0 0 7.236 17.6h5.528a2.425 2.425 0 0 0 2.422-2.315l.393-8.646h.898a.625.625 0 1 0 0-1.25h-2.863V3.925c0-.842-.683-1.525-1.525-1.525H7.91c-.842 0-1.524.683-1.524 1.525M7.91 3.65h4.18c.15 0 .274.123.274.275v1.464H7.636V3.925c0-.152.123-.275.274-.275m-.9 2.99h7.318l-.39 8.588a1.175 1.175 0 0 1-1.174 1.122H7.236a1.175 1.175 0 0 1-1.174-1.122l-.39-8.589z" />
    </ColumnMenuIcon>
  );

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
        disabled: !canEdit,
        end: menuKind === type ? <span className="column-menu-check">✓</span> : undefined,
        action: () => {
          if (!canEdit) return;
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
          setPinnedColumn((prev) => (prev === menuCol ? null : menuCol));
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
        action: () => {
          if (menuColIndex < 0) return;
          insertColumnAt(menuColIndex);
          closeColumnMenu();
        }
      },
      {
        kind: "item",
        key: "insert-right",
        label: "Insertar a la derecha",
        icon: iconInsertRight,
        action: () => {
          if (menuColIndex < 0) return;
          insertColumnAt(menuColIndex + 1);
          closeColumnMenu();
        }
      },
      {
        kind: "item",
        key: "duplicate",
        label: "Duplicar propiedad",
        icon: iconDuplicate,
        disabled: !canEdit || menuColIndex < 0,
        action: () => {
          if (!canEdit || menuColIndex < 0) return;
          duplicateColumnAt(menuColIndex);
          closeColumnMenu();
        }
      },
      {
        kind: "item",
        key: "delete",
        label: "Eliminar propiedad",
        icon: iconTrash,
        disabled: !canEdit || menuColIndex < 0 || columns.length <= 1,
        action: () => {
          if (!canEdit || menuColIndex < 0 || columns.length <= 1) return;
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

  return (
    <div ref={rootRef}>
      <div className="table-toolbar">
        <div className="toolbar-actions-box table-toolbar-box">
          <div className="table-toolbar-main">
            <TrackerSearchBar
              value={query}
              onChange={setQuery}
              stageFilter={stageFilter}
              onStageFilterChange={setStageFilter}
              stages={[]}
              outcomeFilter={outcomeFilter}
              onOutcomeFilterChange={setOutcomeFilter}
              outcomes={[]}
              placeholder="Company, role, location..."
              allLabel="All"
              stageLabel="Stage"
              outcomeLabel="Outcome"
              filterAriaLabel="Filter"
              clearAriaLabel="Clear search"
              alwaysShowClearButton
            />
            <details className="page-editor-columns-dropdown columns-dropdown-trigger">
              <summary className="columns-dropdown-summary" aria-label="Columns">
                <span className="columns-dropdown-eye" aria-hidden="true">
                  <svg viewBox="0 0 20 20">
                    <path d="M10 4.25c4.22 0 7.6 2.9 8.83 5.18a1.2 1.2 0 0 1 0 1.14c-1.23 2.28-4.61 5.18-8.83 5.18s-7.6-2.9-8.83-5.18a1.2 1.2 0 0 1 0-1.14C2.4 7.15 5.78 4.25 10 4.25m0 1.25c-3.7 0-6.7 2.54-7.77 4.5 1.07 1.96 4.07 4.5 7.77 4.5s6.7-2.54 7.77-4.5c-1.07-1.96-4.07-4.5-7.77-4.5m0 1.75a2.75 2.75 0 1 1 0 5.5 2.75 2.75 0 0 1 0-5.5m0 1.25a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3" />
                  </svg>
                </span>
                <span className="columns-dropdown-label">Columns</span>
                <span className="columns-dropdown-count">{columns.length - hiddenColumns.length}/{columns.length}</span>
                <span className="select-caret">▾</span>
              </summary>
              <div className="page-editor-columns-menu">
                {columns.map((column, index) => (
                  <label key={`${block.id}-column-visibility-${index}`} className="page-editor-columns-option">
                    <input
                      type="checkbox"
                      checked={!hiddenColumns.includes(column)}
                      onChange={() =>
                        setHiddenColumns((prev) =>
                          prev.includes(column) ? prev.filter((item) => item !== column) : [...prev, column]
                        )
                      }
                    />
                    <span>{column || `Column ${index + 1}`}</span>
                  </label>
                ))}
                {hasHiddenColumns && (
                  <button className="ghost small" type="button" onClick={() => setHiddenColumns([])}>
                    Show all columns
                  </button>
                )}
              </div>
            </details>
          </div>
          <div className="toolbar-actions-right">
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
            <button className="ghost" type="button" onClick={handleAddColumn} disabled={!canEdit}>
              Add Column
            </button>
              <button className="primary" type="button" onClick={handleAddRow} disabled={!canEdit}>
                {block.props.addActionLabel || "Add Row"}
              </button>
          </div>
        </div>
      </div>
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
                  return (
                    <th
                      key={`${block.id}-head-${colIndex}`}
                      className={`column-header ${dragOverColumn === column ? "drag-over" : ""}`}
                      style={{ width, minWidth: width }}
                      draggable={canEdit}
                      onDragStart={(event) => {
                        if (!canEdit) return;
                        event.dataTransfer.setData("text/plain", column);
                        event.dataTransfer.effectAllowed = "move";
                        setDraggedColumn(column);
                      }}
                      onDragEnd={() => {
                        setDraggedColumn(null);
                        setDragOverColumn(null);
                      }}
                      onDragOver={(event) => {
                        if (!canEdit || !draggedColumn || draggedColumn === column) return;
                        event.preventDefault();
                        setDragOverColumn(column);
                      }}
                      onDragLeave={() => setDragOverColumn(null)}
                      onDrop={(event) => {
                        if (!canEdit) return;
                        event.preventDefault();
                        handleColumnReorder(column);
                      }}
                    >
                      <div className="th-content">
                        <span className="column-label">{column || `Column ${colIndex + 1}`}</span>
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
                      const kind = getColumnKind(column);
                      const selectOptions = selectOptionsByColumn[column] || [];
                      const hasCurrentSelectValue =
                        cellValue.trim().length > 0 &&
                        selectOptions.some((option) => option.label === cellValue);
                      const selectCellOptions =
                        hasCurrentSelectValue || cellValue.trim().length === 0
                          ? selectOptions
                          : [{ label: cellValue }, ...selectOptions];
                      return (
                        <td key={`${block.id}-cell-${rowIndex}-${colIndex}`} style={{ width, minWidth: width }}>
                          {kind === "checkbox" ? (
                            <input
                              className="cell-checkbox"
                              type="checkbox"
                              checked={cellValue.trim().toLowerCase() === "true"}
                              onChange={(event) =>
                                handleCellChange(rowIndex, colIndex, event.target.checked ? "true" : "false")
                              }
                              disabled={!canEdit}
                            />
                          ) : kind === "rating" ? (
                            <StarRating
                              value={Number.isFinite(Number(cellValue)) ? Number(cellValue) : null}
                              onChange={
                                canEdit
                                  ? (next) =>
                                      handleCellChange(rowIndex, colIndex, next === null ? "" : String(next))
                                  : undefined
                              }
                              size="sm"
                              step={0.5}
                              readonly={!canEdit}
                            />
                          ) : kind === "number" ? (
                            canEdit ? (
                              <TableNumberCell
                                value={cellValue}
                                step={1}
                                placeholder="Value"
                                onCommit={(next) => handleCellChange(rowIndex, colIndex, next)}
                              />
                            ) : (
                              <input className="cell-number" type="number" value={cellValue} readOnly />
                            )
                          ) : kind === "select" ? (
                            canEdit ? (
                              <SelectCell
                                value={cellValue}
                                options={selectCellOptions}
                                onCreateOption={(label) => {
                                  const next = label.trim();
                                  return next || null;
                                }}
                                onCommit={(next) => handleCellChange(rowIndex, colIndex, next)}
                              />
                            ) : (
                              <span className="select-pill">{cellValue || "—"}</span>
                            )
                          ) : kind === "date" ? (
                            canEdit ? (
                              <DateCell
                                value={cellValue}
                                onCommit={(next) => handleCellChange(rowIndex, colIndex, next ? next : "")}
                              />
                            ) : (
                              <input className="cell-date" type="date" value={cellValue} readOnly />
                            )
                          ) : (
                            canEdit ? (
                              <TextCell
                                value={cellValue}
                                highlightQuery={query}
                                onCommit={(next) => handleCellChange(rowIndex, colIndex, next)}
                              />
                            ) : (
                              <input className="cell-input" value={cellValue} readOnly />
                            )
                          )}
                        </td>
                      );
                    })}
                    <td className="row-actions-cell">
                      <button
                        className="ghost small"
                        type="button"
                        onClick={() => handleDeleteRow(rowIndex)}
                        disabled={!canEdit}
                      >
                        Delete
                      </button>
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
                    return (
                      <td key={`${block.id}-calc-${index}`} style={{ width, minWidth: width }}>
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
                  onClick={() => setMenuView("type")}
                  aria-label="Cambiar tipo"
                >
                  {iconChangeType}
                </button>
                <input
                  className="column-menu-rename-input"
                  type="text"
                  value={columnMenu.rename}
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
    block.props.panelClassName || "",
    usesFallbackTable && isTableExpanded ? "table-panel-expanded" : ""
  ]
    .filter(Boolean)
    .join(" ");
  const fallbackTable = (
    <DefaultEditableTable
      block={block as PageBlockConfig<"editableTable">}
      mode={mode}
      patchBlockProps={(patch) => patchBlockProps(patch as Partial<PageBlockPropsMap["editableTable"]>)}
      extraActions={toolbarActions}
      isExpanded={usesFallbackTable && isTableExpanded}
      onToggleExpanded={() => setIsTableExpanded((prev) => !prev)}
    />
  );

  return (
    <>
      <BlockPanel id={block.id} as="section" className={panelClassName} menuActions={menuActions}>
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
