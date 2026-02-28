import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { normalizeTodoStatus } from "../../../constants";
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
import { TYPE_REGISTRY } from "../../dataTypes/typeRegistry";
import {
  CHART_SOURCE_TABLE_LINK_KEY,
  collectEditableTableTargets,
  getBlockLink,
  patchBlockLink
} from "../blockLinks";
import { getTableSchema } from "../tableSchemaRegistry";
import {
  type ChartMetricOp,
  type ChartSize,
  type ChartVisualType,
  type EditableTableColumnKind,
  type PageBlockPropsMap
} from "../types";
import {
  chartSizeClass,
  chartSizeColSpan,
  chartSizeWidthLabel,
  createSlotContext,
  normalizeChartSize
} from "./shared";
import { SourceTablePreview } from "./sourceTablePreview";
import { type BlockDefinition } from "./types";

type ChartTableSnapshot = {
  columns: string[];
  rows: string[][];
  columnKinds: Record<string, EditableTableColumnKind>;
};

type ChartMetricOption = {
  value: ChartMetricOp;
  label: string;
  needsValueColumn?: boolean;
  numericOnly?: boolean;
};

type ChartPoint = {
  category: string;
  value: number;
};

const CHART_VISUAL_OPTIONS: Array<{ value: ChartVisualType; label: string }> = [
  { value: "bar", label: "Barras" },
  { value: "line", label: "Linea" },
  { value: "area", label: "Area" },
  { value: "pie", label: "Circular" },
  { value: "timeline", label: "Timeline" }
];

const CHART_SIZE_OPTIONS: Array<{ value: ChartSize; label: string }> = [
  { value: "small", label: "Pequeño" },
  { value: "medium", label: "Medio" },
  { value: "large", label: "Grande" }
];

const CHART_METRIC_OPTIONS: ChartMetricOption[] = [
  { value: "count_rows", label: "Contar filas por categoria" },
  { value: "count_values", label: "Contar valores por categoria", needsValueColumn: true },
  { value: "sum", label: "Sumar por categoria", needsValueColumn: true, numericOnly: true },
  { value: "avg", label: "Media por categoria", needsValueColumn: true, numericOnly: true }
];

const CHART_COLORS = [
  "#2B6CB0",
  "#2F855A",
  "#D69E2E",
  "#D53F8C",
  "#805AD5",
  "#DD6B20",
  "#319795",
  "#4A5568"
];
const DEFAULT_CHART_SERIES_COLOR = "#2B6CB0";

const DEFAULT_COLUMN_LABELS = ["Column 1", "Column 2", "Column 3"];
const DEFAULT_ROW = [["", "", ""]];
const MAX_COLUMNS = 24;
const MAX_ROWS = 1200;
const EMPTY_CATEGORY_LABEL = "(Vacio)";

const normalizeColumns = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [...DEFAULT_COLUMN_LABELS];
  const parsed = raw
    .map((value) => (typeof value === "string" ? value : ""))
    .slice(0, MAX_COLUMNS);
  return parsed.length > 0 ? parsed : [...DEFAULT_COLUMN_LABELS];
};

const normalizeRows = (raw: unknown, columnCount: number): string[][] => {
  const count = Math.max(1, Math.min(columnCount, MAX_COLUMNS));
  if (!Array.isArray(raw)) {
    return DEFAULT_ROW.map((row) =>
      Array.from({ length: count }, (_, index) => row[index] || "")
    );
  }
  return raw
    .slice(0, MAX_ROWS)
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) =>
      Array.from({ length: count }, (_, index) => {
        const value = row[index];
        return typeof value === "string" ? value : "";
      })
    );
};

const normalizeCustomKinds = (
  raw: unknown,
  columns: string[]
): Record<string, EditableTableColumnKind> => {
  if (!isRecord(raw)) return {};
  const allowed = new Set(columns);
  const out: Record<string, EditableTableColumnKind> = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (!allowed.has(key)) return;
    const kind = normalizeString(value);
    if (
      kind === "text" ||
      kind === "number" ||
      kind === "select" ||
      kind === "date" ||
      kind === "checkbox" ||
      kind === "rating" ||
      kind === "todo" ||
      kind === "contacts" ||
      kind === "links" ||
      kind === "documents"
    ) {
      out[key] = kind;
    }
  });
  return out;
};

const toUniqueLabel = (label: string, used: Set<string>): string => {
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

const inferKindFromTypeRef = (typeRefRaw: unknown): EditableTableColumnKind => {
  const typeRef = normalizeString(typeRefRaw);
  const typeDef = typeRef ? TYPE_REGISTRY[typeRef] : undefined;
  if (typeDef) {
    return typeDef.baseKind;
  }
  if (typeRef.startsWith("number.")) return "number";
  if (typeRef.startsWith("rating.")) return "rating";
  if (typeRef.startsWith("select.")) return "select";
  if (typeRef.startsWith("date.") || typeRef.startsWith("datetime.")) return "date";
  if (typeRef.startsWith("checkbox.")) return "checkbox";
  if (typeRef.startsWith("todo.")) return "todo";
  if (typeRef.startsWith("contacts.")) return "contacts";
  if (typeRef.startsWith("links.")) return "links";
  if (typeRef.startsWith("documents.")) return "documents";
  return "text";
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

const isTrackerTableSource = (target: {
  type: string;
  pageId: string;
  blockId: string;
  props: Record<string, unknown>;
}) => {
  const schemaRef = normalizeString(target.props.schemaRef);
  const contentSlotId = normalizeString(target.props.contentSlotId);
  return (
    schemaRef === "tracker.applications@1" ||
    target.blockId === "tracker:table" ||
    contentSlotId.startsWith("tracker:content")
  );
};

const isTodoTableSource = (target: {
  type: string;
  pageId: string;
  blockId: string;
  props: Record<string, unknown>;
}) => {
  const variant = normalizeString(target.props.variant);
  const contentSlotId = normalizeString(target.props.contentSlotId);
  return (
    target.type === "todoTable" ||
    variant === "todo" ||
    target.pageId === "calendar" ||
    target.blockId.includes("todo") ||
    contentSlotId.startsWith("calendar:todo")
  );
};

const resolveSchemaProjection = (
  props: Record<string, unknown>,
  settings: unknown
): {
  schemaKeys: string[];
  orderedKeys: string[];
  columns: string[];
  columnKinds: Record<string, EditableTableColumnKind>;
} | null => {
  const schemaRef = normalizeString(props.schemaRef);
  if (!schemaRef) return null;

  const schema = getTableSchema(schemaRef, { settings });
  if (!schema.columns.length) return null;

  const schemaByKey = new Map(schema.columns.map((column) => [column.key, column]));
  const schemaKeys = schema.columns.map((column) => column.key);
  const overrides = isRecord(props.overrides) ? props.overrides : {};
  const columnOrder = normalizeStringArray(overrides.columnOrder);
  const orderedKeys: string[] = [];
  columnOrder.forEach((key) => {
    if (schemaByKey.has(key) && !orderedKeys.includes(key)) {
      orderedKeys.push(key);
    }
  });
  schemaKeys.forEach((key) => {
    if (!orderedKeys.includes(key)) {
      orderedKeys.push(key);
    }
  });

  const labelOverrides = isRecord(overrides.labelOverrides)
    ? (overrides.labelOverrides as Record<string, unknown>)
    : {};
  const usedLabels = new Set<string>();
  const columns: string[] = [];
  const columnKinds: Record<string, EditableTableColumnKind> = {};

  orderedKeys.forEach((key) => {
    const schemaColumn = schemaByKey.get(key);
    if (!schemaColumn) return;
    const labelOverride = labelOverrides[key];
    const labelSeed =
      typeof labelOverride === "string" && labelOverride.trim()
        ? labelOverride.trim()
        : schemaColumn.label || key;
    const label = toUniqueLabel(labelSeed, usedLabels);
    columns.push(label);
    columnKinds[label] = inferKindFromTypeRef(schemaColumn.typeRef);
  });

  return {
    schemaKeys,
    orderedKeys,
    columns,
    columnKinds
  };
};

const buildTodoSnapshot = (applications: Application[]): ChartTableSnapshot => {
  const columns = [
    "Application",
    "Task",
    "Task Location",
    "Notes",
    "Documents / Links",
    "Due Date",
    "Status"
  ];
  const columnKinds: Record<string, EditableTableColumnKind> = {
    Application: "select",
    Task: "text",
    "Task Location": "text",
    Notes: "text",
    "Documents / Links": "links",
    "Due Date": "date",
    Status: "select"
  };
  const rows = applications.flatMap((app) =>
    (app.todo_items || []).map((todo) => [
      app.application_id || `${app.company_name} - ${app.position}`,
      todo.task || "",
      todo.task_location || "",
      todo.notes || "",
      todo.documents_links || "",
      todo.due_date || "",
      normalizeTodoStatus(todo.status)
    ])
  );
  return {
    columns,
    rows,
    columnKinds
  };
};

const buildTrackerSnapshot = (
  targetProps: Record<string, unknown>,
  settings: unknown,
  applications: Application[]
): ChartTableSnapshot => {
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
  const columnKinds: Record<string, EditableTableColumnKind> = {};
  const keyByLabel: string[] = [];
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

    const label = toUniqueLabel(labelSeed || key, usedLabels);
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

const buildEditableSnapshot = (
  targetProps: Record<string, unknown>,
  settings: unknown
): ChartTableSnapshot => {
  const projection = resolveSchemaProjection(targetProps, settings);
  if (projection) {
    const storageRows = normalizeRows(targetProps.customRows, projection.schemaKeys.length);
    const storageIndexByKey: Record<string, number> = {};
    projection.schemaKeys.forEach((key, index) => {
      storageIndexByKey[key] = index;
    });
    const rows = storageRows.map((row) =>
      projection.orderedKeys.map((columnKey) => {
        const index = storageIndexByKey[columnKey];
        return index >= 0 ? row[index] || "" : "";
      })
    );
    return {
      columns: projection.columns,
      rows,
      columnKinds: projection.columnKinds
    };
  }

  const columns = normalizeColumns(targetProps.customColumns);
  const rows = normalizeRows(targetProps.customRows, columns.length);
  const columnKinds = normalizeCustomKinds(targetProps.customColumnTypes, columns);
  return {
    columns,
    rows,
    columnKinds
  };
};

const toNumber = (raw: string): number | null => {
  const value = raw.trim();
  if (!value) return null;
  const compact = value.replace(/\s+/g, "");
  const normalized =
    compact.includes(",") && !compact.includes(".")
      ? compact.replace(",", ".")
      : compact.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeSeriesColor = (raw: unknown): string => {
  if (typeof raw !== "string") return DEFAULT_CHART_SERIES_COLOR;
  const value = raw.trim();
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
    return DEFAULT_CHART_SERIES_COLOR;
  }
  return value;
};

const hexToRgba = (hex: string, alpha: number): string => {
  const normalized = normalizeSeriesColor(hex).replace("#", "");
  const source = normalized.length === 3
    ? normalized.split("").map((ch) => `${ch}${ch}`).join("")
    : normalized;
  const r = Number.parseInt(source.slice(0, 2), 16);
  const g = Number.parseInt(source.slice(2, 4), 16);
  const b = Number.parseInt(source.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const parseTimelineDate = (raw: string): Date | null => {
  const value = raw.trim();
  if (!value) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  const date = new Date(parsed);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const toTimelineBucketLabel = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const formatMetricNumber = (value: number): string => {
  if (!Number.isFinite(value)) return "0";
  const isInt = Math.abs(value - Math.round(value)) < 0.0000001;
  if (isInt) {
    return Math.round(value).toLocaleString();
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
};

const buildChartPoints = ({
  snapshot,
  metricOp,
  categoryColumn,
  valueColumn
}: {
  snapshot: ChartTableSnapshot;
  metricOp: ChartMetricOp;
  categoryColumn: string;
  valueColumn: string;
}): ChartPoint[] => {
  const categoryIndex = snapshot.columns.indexOf(categoryColumn);
  if (categoryIndex < 0) return [];
  const valueIndex = snapshot.columns.indexOf(valueColumn);

  const aggregate = new Map<
    string,
    { rows: number; nonEmptyValues: number; numericSum: number; numericCount: number }
  >();

  snapshot.rows.forEach((row) => {
    const categoryRaw = String(row[categoryIndex] || "").trim();
    const category = categoryRaw || EMPTY_CATEGORY_LABEL;
    const entry = aggregate.get(category) || {
      rows: 0,
      nonEmptyValues: 0,
      numericSum: 0,
      numericCount: 0
    };
    entry.rows += 1;

    if (valueIndex >= 0) {
      const rawValue = String(row[valueIndex] || "").trim();
      if (rawValue) {
        entry.nonEmptyValues += 1;
      }
      const numericValue = toNumber(rawValue);
      if (numericValue !== null) {
        entry.numericSum += numericValue;
        entry.numericCount += 1;
      }
    }

    aggregate.set(category, entry);
  });

  return Array.from(aggregate.entries())
    .map(([category, entry]) => {
      if (metricOp === "count_values") {
        return { category, value: entry.nonEmptyValues };
      }
      if (metricOp === "sum") {
        return { category, value: entry.numericSum };
      }
      if (metricOp === "avg") {
        return {
          category,
          value: entry.numericCount > 0 ? entry.numericSum / entry.numericCount : 0
        };
      }
      return { category, value: entry.rows };
    })
    .filter((point) => Number.isFinite(point.value));
};

const buildTimelinePoints = ({
  snapshot,
  metricOp,
  categoryColumn,
  valueColumn
}: {
  snapshot: ChartTableSnapshot;
  metricOp: ChartMetricOp;
  categoryColumn: string;
  valueColumn: string;
}): ChartPoint[] => {
  const categoryIndex = snapshot.columns.indexOf(categoryColumn);
  if (categoryIndex < 0) return [];
  const valueIndex = snapshot.columns.indexOf(valueColumn);

  const aggregate = new Map<
    string,
    { sortKey: number; rows: number; nonEmptyValues: number; numericSum: number; numericCount: number }
  >();

  snapshot.rows.forEach((row) => {
    const rawCategory = String(row[categoryIndex] || "");
    const parsedDate = parseTimelineDate(rawCategory);
    if (!parsedDate) return;
    const category = toTimelineBucketLabel(parsedDate);
    const sortKey = Date.UTC(parsedDate.getFullYear(), parsedDate.getMonth(), 1);
    const entry = aggregate.get(category) || {
      sortKey,
      rows: 0,
      nonEmptyValues: 0,
      numericSum: 0,
      numericCount: 0
    };

    entry.rows += 1;
    if (valueIndex >= 0) {
      const rawValue = String(row[valueIndex] || "").trim();
      if (rawValue) {
        entry.nonEmptyValues += 1;
      }
      const numericValue = toNumber(rawValue);
      if (numericValue !== null) {
        entry.numericSum += numericValue;
        entry.numericCount += 1;
      }
    }

    aggregate.set(category, entry);
  });

  const timelinePoints = Array.from(aggregate.entries())
    .sort((a, b) => a[1].sortKey - b[1].sortKey)
    .map(([category, entry]) => {
      if (metricOp === "count_values") {
        return { category, value: entry.nonEmptyValues };
      }
      if (metricOp === "sum") {
        return { category, value: entry.numericSum };
      }
      if (metricOp === "avg") {
        return {
          category,
          value: entry.numericCount > 0 ? entry.numericSum / entry.numericCount : 0
        };
      }
      return { category, value: entry.rows };
    })
    .filter((point) => Number.isFinite(point.value));

  if (timelinePoints.length > 0) return timelinePoints;
  return buildChartPoints({ snapshot, metricOp, categoryColumn, valueColumn });
};

const renderChartPreview = ({
  renderKey,
  chartType,
  metricOp,
  data,
  seriesColor
}: {
  renderKey: string;
  chartType: ChartVisualType;
  metricOp: ChartMetricOp;
  data: ChartPoint[];
  seriesColor: string;
}) => {
  const allowDecimals = metricOp === "avg";
  const tooltipFormatter = (value: number | string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? formatMetricNumber(parsed) : String(value || "");
  };

  if (chartType === "pie") {
    return (
      <ResponsiveContainer key={renderKey} width="100%" height="100%">
        <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <Tooltip formatter={tooltipFormatter} />
          <Legend />
          <Pie data={data} dataKey="value" nameKey="category" outerRadius="78%" paddingAngle={2}>
            {data.map((entry, index) => (
              <Cell key={`pie-cell-${entry.category}-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "line") {
    return (
      <ResponsiveContainer key={renderKey} width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 20, left: 8, bottom: 36 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#CBD5E0" />
          <XAxis dataKey="category" angle={-18} textAnchor="end" height={56} interval={0} />
          <YAxis allowDecimals={allowDecimals} />
          <Tooltip formatter={tooltipFormatter} />
          <Line type="monotone" dataKey="value" stroke={seriesColor} strokeWidth={2.6} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "area") {
    return (
      <ResponsiveContainer key={renderKey} width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 20, left: 8, bottom: 36 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#CBD5E0" />
          <XAxis dataKey="category" angle={-18} textAnchor="end" height={56} interval={0} />
          <YAxis allowDecimals={allowDecimals} />
          <Tooltip formatter={tooltipFormatter} />
          <Area type="monotone" dataKey="value" stroke={seriesColor} fill={hexToRgba(seriesColor, 0.3)} />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "timeline") {
    return (
      <ResponsiveContainer key={renderKey} width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 20, left: 8, bottom: 32 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#CBD5E0" />
          <XAxis dataKey="category" tick={{ fontSize: 11 }} padding={{ left: 8, right: 8 }} />
          <YAxis allowDecimals={allowDecimals} tick={{ fontSize: 11 }} />
          <Tooltip formatter={tooltipFormatter} />
          <Line type="monotone" dataKey="value" stroke={seriesColor} strokeWidth={3} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer key={renderKey} width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 20, left: 8, bottom: 36 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#CBD5E0" />
        <XAxis dataKey="category" angle={-18} textAnchor="end" height={56} interval={0} />
        <YAxis allowDecimals={allowDecimals} />
        <Tooltip formatter={tooltipFormatter} />
        <Bar dataKey="value" fill={seriesColor} radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
};

const buildMetricOptions = (valueKind: EditableTableColumnKind): ChartMetricOption[] =>
  CHART_METRIC_OPTIONS.filter((option) => {
    if (!option.numericOnly) return true;
    return valueKind === "number" || valueKind === "rating";
  });

export const CHART_BLOCK_DEFINITION: BlockDefinition<"chart"> = {
  type: "chart",
  defaultLayout: { colSpan: chartSizeColSpan("medium") },
  createDefaultProps: () => ({
    title: "Chart",
    size: "medium",
    chartType: "bar",
    metricOp: "count_rows",
    seriesColor: DEFAULT_CHART_SERIES_COLOR
  }),
  component: ({
    block,
    mode,
    patchBlockProps,
    updateBlockProps,
    patchBlockLayout,
    resolveSlot,
    menuActions
  }) => {
    const { settings, applications } = useAppData();
    const [isConfigOpen, setIsConfigOpen] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const slotContext = createSlotContext(mode, updateBlockProps, patchBlockProps);
    const action = block.props.actionSlotId ? resolveSlot?.(block.props.actionSlotId, block, slotContext) : null;
    const slot = block.props.contentSlotId ? resolveSlot?.(block.props.contentSlotId, block, slotContext) : null;
    const tableTargets = useMemo(() => collectEditableTableTargets(settings), [settings]);
    const linkedTableId = getBlockLink(block.props, CHART_SOURCE_TABLE_LINK_KEY);
    const linkedTableTarget = linkedTableId
      ? tableTargets.find((target) => target.blockId === linkedTableId) || null
      : null;

    const resolveSnapshotForTarget = (target: (typeof linkedTableTarget) | null): ChartTableSnapshot | null => {
      if (!target) return null;
      if (isTodoTableSource(target)) {
        return buildTodoSnapshot(applications);
      }
      if (isTrackerTableSource(target)) {
        return buildTrackerSnapshot(target.props, settings, applications);
      }
      return buildEditableSnapshot(target.props, settings);
    };

    const tableSnapshot = useMemo(
      () => resolveSnapshotForTarget(linkedTableTarget),
      [applications, linkedTableTarget, settings]
    );

    const chartType: ChartVisualType =
      block.props.chartType === "line" ||
      block.props.chartType === "area" ||
      block.props.chartType === "pie" ||
      block.props.chartType === "timeline" ||
      block.props.chartType === "bar"
        ? block.props.chartType
        : "bar";
    const seriesColor = normalizeSeriesColor(block.props.seriesColor);

    const sourceCategoryColumn = tableSnapshot?.columns.includes(block.props.sourceCategoryColumn || "")
      ? (block.props.sourceCategoryColumn as string)
      : tableSnapshot?.columns[0] || "";
    const valueColumnCandidates = tableSnapshot?.columns.filter((column) => column !== sourceCategoryColumn) || [];
    const sourceValueColumn = valueColumnCandidates.includes(block.props.sourceValueColumn || "")
      ? (block.props.sourceValueColumn as string)
      : valueColumnCandidates[0] || "";
    const valueKind = sourceValueColumn ? tableSnapshot?.columnKinds[sourceValueColumn] || "text" : "text";
    const metricOptions = buildMetricOptions(valueKind);
    const metricOp = metricOptions.some((option) => option.value === block.props.metricOp)
      ? (block.props.metricOp as ChartMetricOp)
      : "count_rows";
    const metricDef = metricOptions.find((option) => option.value === metricOp) || metricOptions[0];

    const chartPoints = useMemo(
      () =>
        tableSnapshot
          ? chartType === "timeline"
            ? buildTimelinePoints({
                snapshot: tableSnapshot,
                metricOp,
                categoryColumn: sourceCategoryColumn,
                valueColumn: sourceValueColumn
              })
            : buildChartPoints({
                snapshot: tableSnapshot,
                metricOp,
                categoryColumn: sourceCategoryColumn,
                valueColumn: sourceValueColumn
              })
          : [],
      [chartType, metricOp, sourceCategoryColumn, sourceValueColumn, tableSnapshot]
    );

    const hasLinkedChart = Boolean(linkedTableId && tableSnapshot);
    const linkedTableMissing = Boolean(linkedTableId && !linkedTableTarget);
    const chartTypeLabel =
      CHART_VISUAL_OPTIONS.find((option) => option.value === chartType)?.label || "Grafico";
    const chartTitle = block.props.title || "Chart";
    const chartSize = normalizeChartSize(block.props.size);
    const chartSizeLabel =
      CHART_SIZE_OPTIONS.find((option) => option.value === chartSize)?.label || "Medio";
    const chartWidthLabel = chartSizeWidthLabel(chartSize);
    const dataSourceModeLabel = linkedTableTarget ? "Automatico" : "Libre";
    const tableHelpText = linkedTableTarget
      ? `Usando ${linkedTableTarget.title} como origen.`
      : "Sin tabla vinculada, el grafico usara el contenido conectado o quedara sin datos.";
    const categoryHelpText = sourceCategoryColumn
      ? `Agrupa los datos por ${sourceCategoryColumn}.`
      : "Selecciona una tabla para ver las columnas disponibles.";
    const metricHelpText = !tableSnapshot
      ? "Vincula una tabla para habilitar el calculo por categorias."
      : metricDef?.needsValueColumn
        ? `La metrica utiliza ${sourceValueColumn || "una columna de valor"} para el calculo.`
        : `Cuenta filas agrupadas por ${sourceCategoryColumn || "categoria"}.`;
    const valueColumnHelpText = metricDef?.needsValueColumn
      ? (sourceValueColumn
        ? `Columna de valor activa: ${sourceValueColumn}.`
        : "Selecciona una columna con datos numericos o compatibles.")
      : "Esta metrica no necesita una columna de valor.";
    const chartPointCountLabel = chartPoints.length === 1 ? "1 grupo" : `${chartPoints.length} grupos`;
    const previewStatusLabel = chartPoints.length > 0 ? chartPointCountLabel : "Sin datos";
    const chartRenderKey = [
      block.id,
      block.layout.colSpan,
      block.layout.colStart || 0,
      chartType,
      metricOp
    ].join(":");
    const chartPreview = chartPoints.length > 0
      ? renderChartPreview({
          renderKey: chartRenderKey,
          chartType,
          metricOp,
          data: chartPoints,
          seriesColor
        })
      : null;

    const setChartSize = (nextSize: ChartSize) => {
      patchBlockProps({ size: nextSize });
      patchBlockLayout({ colSpan: chartSizeColSpan(nextSize) });
    };

    const setLinkedTable = (nextBlockId?: string | null) => {
      const nextTarget = nextBlockId
        ? tableTargets.find((target) => target.blockId === nextBlockId) || null
        : null;
      const nextSnapshot = resolveSnapshotForTarget(nextTarget);
      const nextCategory = nextSnapshot?.columns[0];
      const nextValueCandidates =
        nextSnapshot?.columns.filter((column) => column !== nextCategory) || [];
      const nextNumericValue =
        nextValueCandidates.find((column) => {
          const kind = nextSnapshot?.columnKinds[column];
          return kind === "number" || kind === "rating";
        }) || nextValueCandidates[0];

      patchBlockProps({
        ...(patchBlockLink(
          block.props,
          CHART_SOURCE_TABLE_LINK_KEY,
          nextBlockId || null
        ) as Partial<PageBlockPropsMap["chart"]>),
        sourceCategoryColumn: nextBlockId ? nextCategory : undefined,
        sourceValueColumn: nextBlockId ? nextNumericValue : undefined,
        metricOp: nextBlockId ? "count_rows" : block.props.metricOp,
        chartType: block.props.chartType || "bar",
        seriesColor
      });
    };

    const blockMenuActions = mode === "edit"
      ? [
          {
            key: `chart-config-${block.id}`,
            label: "Configurar grafico",
            onClick: () => setIsConfigOpen(true)
          },
          ...(menuActions || [])
        ]
      : menuActions;

    const showLinkedChart = hasLinkedChart;
    const chartOrSlot = showLinkedChart
      ? (
        <div className="chart-shell chart-linked-shell">
          {chartPreview || <div className="empty">Sin datos suficientes para este grafico.</div>}
        </div>
        )
      : (slot || <div className="empty">Chart data is not connected yet.</div>);

    useEffect(() => {
      if (!isExpanded) return;
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          setIsExpanded(false);
        }
      };
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isExpanded]);

    const slotClassName = React.isValidElement(slot) && typeof slot.props.className === "string"
      ? slot.props.className
      : null;
    const expandedChartContent = showLinkedChart
      ? (
        <div className="chart-shell chart-linked-shell chart-shell-lg">
          {chartPreview || <div className="empty">Sin datos suficientes para este grafico.</div>}
        </div>
        )
      : React.isValidElement(slot) && slotClassName !== null
        ? React.cloneElement(
            slot as React.ReactElement<{ className?: string }>,
            {
              className: (() => {
                const base = slotClassName;
                if (base.includes("chart-shell-lg")) return base;
                if (base.includes("chart-shell")) return `${base} chart-shell-lg`.trim();
                return `${base} chart-shell chart-shell-lg`.trim();
              })()
            }
          )
        : (
          <div className="chart-shell chart-shell-lg">
            {slot || <div className="empty">Chart data is not connected yet.</div>}
          </div>
          );

    return (
      <>
        <BlockPanel
          id={block.id}
          as="section"
          className={["chart-panel", chartSizeClass(block.props.size || "medium")].join(" ")}
          menuActions={blockMenuActions}
        >
          <div className="panel-header panel-header-inline">
            <h3>{block.props.title || "Chart"}</h3>
            {action}
            <button
              className="icon-button chart-expand"
              type="button"
              aria-label="Expand chart"
              onClick={() => setIsExpanded(true)}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M11 3a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0V4.41l-4.29 4.3a1 1 0 0 1-1.42-1.42L14.59 3H12a1 1 0 0 1-1-1Zm-2 14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-5a1 1 0 1 1 2 0v3.59l4.29-4.3a1 1 0 1 1 1.42 1.42L5.41 16H8a1 1 0 0 1 1 1Z" />
              </svg>
            </button>
          </div>
          {chartOrSlot}
        </BlockPanel>

        {isExpanded &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              className="modal-backdrop"
              role="dialog"
              aria-modal="true"
              onClick={() => setIsExpanded(false)}
            >
              <div className="modal chart-modal" onClick={(event) => event.stopPropagation()}>
                <header className="modal-header">
                  <div>
                    <h2>{block.props.title || "Chart"}</h2>
                  </div>
                  <button className="ghost" type="button" onClick={() => setIsExpanded(false)} aria-label="Close">
                    ×
                  </button>
                </header>
                {expandedChartContent}
              </div>
            </div>,
            document.body
          )}

        {isConfigOpen &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              className="modal-backdrop"
              role="dialog"
              aria-modal="true"
              onClick={() => setIsConfigOpen(false)}
            >
              <div className="modal block-config-modal" onClick={(event) => event.stopPropagation()}>
                <header className="modal-header">
                  <div>
                    <h2>Configurar grafico</h2>
                    <p>Ajustes del bloque de grafico</p>
                  </div>
                  <button className="ghost" type="button" onClick={() => setIsConfigOpen(false)} aria-label="Close">
                    ×
                  </button>
                </header>

                <div className="block-config-layout">
                  <div className="block-config-main">
                    <section className="block-config-section">
                      <div className="block-config-section-head">
                        <div>
                          <h3>Presentacion</h3>
                          <p>Define el titulo, el tipo de grafico y el espacio que ocupara en la pagina.</p>
                        </div>
                        <span className="block-status-badge">{chartTypeLabel}</span>
                      </div>

                      <div className="block-config-grid">
                        <label className="field">
                          <span className="block-field-label">Titulo</span>
                          <input
                            value={block.props.title || ""}
                            onChange={(event) => patchBlockProps({ title: event.target.value })}
                            placeholder="Chart title"
                          />
                          <p className="block-field-hint">Titulo mostrado en la cabecera del bloque.</p>
                        </label>

                        <label className="field">
                          <span className="block-field-label">Tipo de grafico</span>
                          <select
                            value={chartType}
                            onChange={(event) =>
                              patchBlockProps({ chartType: event.target.value as ChartVisualType })
                            }
                          >
                            {CHART_VISUAL_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <p className="block-field-hint">Elige la visualizacion que mejor cuenta la historia del dato.</p>
                        </label>

                        <label className="field">
                          <span className="block-field-label">Tamano</span>
                          <select
                            value={chartSize}
                            onChange={(event) => setChartSize(event.target.value as ChartSize)}
                          >
                            {CHART_SIZE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <p className="block-field-hint">
                            Pequeno ocupa 1/4, medio 1/2 y grande usa todo el ancho.
                          </p>
                        </label>

                        {chartType !== "pie" && (
                          <label className="field chart-series-color-field">
                            <span className="block-field-label">Color de serie</span>
                            <div className="chart-series-color-control">
                              <span
                                className="chart-series-color-icon"
                                style={{ backgroundColor: seriesColor }}
                                aria-hidden="true"
                              />
                              <input
                                className="chart-series-color-input"
                                type="color"
                                value={seriesColor}
                                onChange={(event) => patchBlockProps({ seriesColor: event.target.value })}
                                aria-label="Elegir color de serie"
                              />
                              <span className="chart-series-color-value">{seriesColor.toUpperCase()}</span>
                            </div>
                            <p className="block-field-hint">Color principal aplicado a la serie del grafico.</p>
                          </label>
                        )}
                      </div>
                    </section>

                    <section className="block-config-section">
                      <div className="block-config-section-head">
                        <div>
                          <h3>Fuente de datos</h3>
                          <p>Selecciona la tabla y la columna que actuara como categoria principal.</p>
                        </div>
                        <span className={`block-status-badge ${linkedTableTarget ? "ready" : "muted"}`}>
                          {linkedTableTarget ? "Tabla conectada" : "Sin tabla"}
                        </span>
                      </div>

                      <div className="block-config-grid">
                        <label className="field">
                          <span className="block-field-label">Tabla vinculada</span>
                          <select
                            value={linkedTableId || ""}
                            onChange={(event) => setLinkedTable(event.target.value || null)}
                          >
                            <option value="">Sin tabla</option>
                            {tableTargets.map((target) => (
                              <option key={target.blockId} value={target.blockId}>
                                [{target.pageId}] {target.title}
                              </option>
                            ))}
                          </select>
                          <p className="block-field-hint">{tableHelpText}</p>
                        </label>

                        <label className="field">
                          <span className="block-field-label">Columna categoria</span>
                          <select
                            value={sourceCategoryColumn}
                            onChange={(event) => {
                              const nextCategory = event.target.value;
                              const nextCandidates =
                                tableSnapshot?.columns.filter((column) => column !== nextCategory) || [];
                              const nextValue = nextCandidates.includes(sourceValueColumn)
                                ? sourceValueColumn
                                : nextCandidates[0] || "";
                              patchBlockProps({
                                sourceCategoryColumn: nextCategory,
                                sourceValueColumn: nextValue || undefined
                              });
                            }}
                            disabled={!tableSnapshot}
                          >
                            {!tableSnapshot && <option value="">Sin columnas</option>}
                            {tableSnapshot?.columns.map((column) => (
                              <option key={column} value={column}>
                                {column}
                              </option>
                            ))}
                          </select>
                          <p className="block-field-hint">{categoryHelpText}</p>
                        </label>
                      </div>
                    </section>

                    <section className="block-config-section">
                      <div className="block-config-section-head">
                        <div>
                          <h3>Calculo</h3>
                          <p>Define como se agregan los datos y, si hace falta, la columna de valor.</p>
                        </div>
                        <span className="block-status-badge">{metricDef?.label || "Metrica"}</span>
                      </div>

                      <div className="block-config-grid">
                        <label className="field">
                          <span className="block-field-label">Metrica</span>
                          <select
                            value={metricOp}
                            onChange={(event) => patchBlockProps({ metricOp: event.target.value as ChartMetricOp })}
                            disabled={!tableSnapshot}
                          >
                            {metricOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <p className="block-field-hint">{metricHelpText}</p>
                        </label>

                        {metricDef?.needsValueColumn && (
                          <label className="field">
                            <span className="block-field-label">Columna valor</span>
                            <select
                              value={sourceValueColumn}
                              onChange={(event) => patchBlockProps({ sourceValueColumn: event.target.value })}
                              disabled={!tableSnapshot || valueColumnCandidates.length === 0}
                            >
                              {valueColumnCandidates.length === 0 && <option value="">Sin columnas</option>}
                              {valueColumnCandidates.map((column) => (
                                <option key={column} value={column}>
                                  {column}
                                </option>
                              ))}
                            </select>
                            <p className="block-field-hint">{valueColumnHelpText}</p>
                          </label>
                        )}
                      </div>
                    </section>

                    <section className="block-config-section">
                      <div className="block-config-section-head">
                        <div>
                          <h3>Vista previa</h3>
                          <p>Comprueba el resultado antes de cerrar la configuracion.</p>
                        </div>
                        <span className={`block-status-badge ${chartPoints.length > 0 ? "ready" : "muted"}`}>
                          {previewStatusLabel}
                        </span>
                      </div>
                      <div className="chart-config-shell">
                        {chartPreview || <div className="empty">Sin datos suficientes para este grafico.</div>}
                      </div>
                    </section>
                  </div>

                  <aside className="block-config-sidebar">
                    <div className="block-config-preview">
                      <div className="block-config-preview-label">{chartTitle}</div>
                      <div className="block-config-preview-value">{chartTypeLabel}</div>
                      <div className="block-config-preview-meta">
                        <span>{linkedTableTarget ? linkedTableTarget.title : "Sin tabla"}</span>
                        <span>{metricDef?.label || "Metrica"}</span>
                        <span>{sourceCategoryColumn || "Sin categoria"}</span>
                        {metricDef?.needsValueColumn && <span>{sourceValueColumn || "Sin valor"}</span>}
                      </div>
                    </div>

                    <section className="block-config-sidebar-card">
                      <div className="block-config-section-head compact">
                        <div>
                          <h3>Resumen</h3>
                          <p>Estado actual de la configuracion del grafico.</p>
                        </div>
                        <span className={`block-status-badge ${linkedTableTarget ? "ready" : "muted"}`}>
                          {dataSourceModeLabel}
                        </span>
                      </div>

                      <div className="block-summary-list">
                        <div className="block-summary-row">
                          <span>Tipo</span>
                          <strong>{chartTypeLabel}</strong>
                        </div>
                        <div className="block-summary-row">
                          <span>Tamano</span>
                          <strong>{`${chartSizeLabel} / ${chartWidthLabel}`}</strong>
                        </div>
                        <div className="block-summary-row">
                          <span>Fuente</span>
                          <strong>{linkedTableTarget?.title || "Sin tabla"}</strong>
                        </div>
                        <div className="block-summary-row">
                          <span>Categoria</span>
                          <strong>{sourceCategoryColumn || "Sin categoria"}</strong>
                        </div>
                        <div className="block-summary-row">
                          <span>Metrica</span>
                          <strong>{metricDef?.label || "Sin metrica"}</strong>
                        </div>
                        <div className="block-summary-row">
                          <span>Valor</span>
                          <strong>{metricDef?.needsValueColumn ? (sourceValueColumn || "Sin valor") : "No aplica"}</strong>
                        </div>
                        <div className="block-summary-row">
                          <span>Grupos</span>
                          <strong>{chartPointCountLabel}</strong>
                        </div>
                      </div>

                      {chartType !== "pie" && (
                        <div className="chart-summary-color">
                          <span
                            className="chart-series-color-icon"
                            style={{ backgroundColor: seriesColor }}
                            aria-hidden="true"
                          />
                          <strong>{seriesColor.toUpperCase()}</strong>
                          <span>Color principal</span>
                        </div>
                      )}
                    </section>
                  </aside>
                </div>

                {tableSnapshot && <SourceTablePreview table={tableSnapshot} keyPrefix="chart-preview" />}

                {linkedTableMissing && (
                  <p className="kpi-edit-hint">La tabla vinculada ya no existe. Selecciona otra.</p>
                )}
              </div>
            </div>,
            document.body
          )}
      </>
    );
  }
};
