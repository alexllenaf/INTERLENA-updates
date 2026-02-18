import React, { useMemo, useState } from "react";
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
import { chartSizeClass, createSlotContext } from "./shared";
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
const TRACKER_COLUMN_KINDS: Record<string, EditableTableColumnKind> = {
  company_name: "text",
  position: "text",
  job_type: "select",
  location: "text",
  stage: "select",
  outcome: "select",
  application_date: "date",
  interview_datetime: "date",
  followup_date: "date",
  interview_rounds: "number",
  interview_type: "text",
  interviewers: "text",
  company_score: "rating",
  contacts: "contacts",
  last_round_cleared: "text",
  total_rounds: "number",
  my_interview_score: "rating",
  improvement_areas: "text",
  skill_to_upgrade: "text",
  job_description: "text",
  notes: "text",
  todo_items: "todo",
  documents_links: "documents",
  favorite: "checkbox"
};
const EMPTY_CATEGORY_LABEL = "(Vacio)";

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

const customPropertyKind = (prop: CustomProperty | null): EditableTableColumnKind => {
  if (!prop) return "text";
  if (prop.type === "number") return "number";
  if (prop.type === "date") return "date";
  if (prop.type === "checkbox") return "checkbox";
  if (prop.type === "rating") return "rating";
  if (prop.type === "contacts") return "contacts";
  if (prop.type === "links") return "links";
  if (prop.type === "documents") return "documents";
  if (prop.type === "select") return "select";
  return "text";
};

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
  pageId: string;
  blockId: string;
  props: Record<string, unknown>;
}) => {
  const schemaRef = normalizeString(target.props.schemaRef);
  const contentSlotId = normalizeString(target.props.contentSlotId);
  return (
    schemaRef === "tracker.applications@1" ||
    target.pageId === "tracker" ||
    target.blockId === "tracker:table" ||
    contentSlotId.startsWith("tracker:content")
  );
};

const isTodoTableSource = (target: {
  pageId: string;
  blockId: string;
  props: Record<string, unknown>;
}) => {
  const variant = normalizeString(target.props.variant);
  const contentSlotId = normalizeString(target.props.contentSlotId);
  return (
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
  chartType,
  metricOp,
  data,
  seriesColor
}: {
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
      <ResponsiveContainer width="100%" height="100%">
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
      <ResponsiveContainer width="100%" height="100%">
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
      <ResponsiveContainer width="100%" height="100%">
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
      <ResponsiveContainer width="100%" height="100%">
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
    <ResponsiveContainer width="100%" height="100%">
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
  defaultLayout: { colSpan: 20 },
  createDefaultProps: () => ({
    title: "Chart",
    size: "medium",
    chartType: "bar",
    metricOp: "count_rows",
    seriesColor: DEFAULT_CHART_SERIES_COLOR
  }),
  component: ({ block, mode, patchBlockProps, updateBlockProps, resolveSlot, menuActions }) => {
    const { settings, applications } = useAppData();
    const [isConfigOpen, setIsConfigOpen] = useState(false);
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
    const previewRows = tableSnapshot ? tableSnapshot.rows.slice(0, 12) : [];
    const chartTypeLabel =
      CHART_VISUAL_OPTIONS.find((option) => option.value === chartType)?.label || "Grafico";
    const chartPreview = chartPoints.length > 0
      ? renderChartPreview({
          chartType,
          metricOp,
          data: chartPoints,
          seriesColor
        })
      : null;

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
          </div>
          {chartOrSlot}
        </BlockPanel>

        {isConfigOpen &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              className="modal-backdrop"
              role="dialog"
              aria-modal="true"
              onClick={() => setIsConfigOpen(false)}
            >
              <div className="modal chart-config-modal" onClick={(event) => event.stopPropagation()}>
                <header className="modal-header">
                  <div>
                    <h2>Configurar grafico</h2>
                    <p>Ajustes del bloque de grafico</p>
                  </div>
                  <button className="ghost" type="button" onClick={() => setIsConfigOpen(false)} aria-label="Close">
                    ×
                  </button>
                </header>

                <div className="kpi-config-preview">
                  <div className="kpi-config-preview-label">{block.props.title || "Chart"}</div>
                  <div className="kpi-config-preview-value">{chartTypeLabel}</div>
                  <div className="kpi-config-preview-meta">
                    <span>{linkedTableTarget ? linkedTableTarget.title : "Sin tabla"}</span>
                    <span>{metricDef?.label || "Metrica"}</span>
                    <span>{sourceCategoryColumn || "Sin categoria"}</span>
                    {metricDef?.needsValueColumn && <span>{sourceValueColumn || "Sin valor"}</span>}
                  </div>
                </div>

                <div className="kpi-config-grid">
                  <label className="field">
                    Titulo
                    <input
                      value={block.props.title || ""}
                      onChange={(event) => patchBlockProps({ title: event.target.value })}
                      placeholder="Chart title"
                    />
                  </label>

                  <label className="field">
                    Tabla vinculada
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
                  </label>

                  <label className="field">
                    Tipo de grafico
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
                  </label>

                  {chartType !== "pie" && (
                    <label className="field">
                      Color de serie
                      <input
                        type="color"
                        value={seriesColor}
                        onChange={(event) => patchBlockProps({ seriesColor: event.target.value })}
                      />
                    </label>
                  )}

                  <label className="field">
                    Tamano
                    <select
                      value={block.props.size || "medium"}
                      onChange={(event) => patchBlockProps({ size: event.target.value as ChartSize })}
                    >
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large</option>
                      <option value="xlarge">XLarge</option>
                    </select>
                  </label>

                  <label className="field">
                    Columna categoria
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
                  </label>

                  <label className="field">
                    Metrica
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
                  </label>

                  {metricDef?.needsValueColumn && (
                    <label className="field">
                      Columna valor
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
                    </label>
                  )}
                </div>

                <section className="kpi-source-preview">
                  <div className="kpi-source-preview-head">
                    <h3>Vista previa de grafico</h3>
                    <p>{chartPoints.length} grupos</p>
                  </div>
                  <div className="chart-config-shell">
                    {chartPreview || <div className="empty">Sin datos suficientes para este grafico.</div>}
                  </div>
                </section>

                {tableSnapshot && (
                  <section className="kpi-source-preview">
                    <div className="kpi-source-preview-head">
                      <h3>Vista previa de tabla</h3>
                      <p>
                        {tableSnapshot.rows.length} filas
                        {tableSnapshot.rows.length > previewRows.length
                          ? ` (mostrando ${previewRows.length})`
                          : ""}
                      </p>
                    </div>
                    <div className="table-scroll kpi-source-preview-scroll">
                      <table className="table kpi-source-preview-table">
                        <thead>
                          <tr>
                            {tableSnapshot.columns.map((column) => (
                              <th key={`chart-preview-head-${column}`} title={column}>
                                {column}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previewRows.length === 0 ? (
                            <tr>
                              <td colSpan={Math.max(1, tableSnapshot.columns.length)}>Sin filas en esta tabla.</td>
                            </tr>
                          ) : (
                            previewRows.map((row, rowIndex) => (
                              <tr key={`chart-preview-row-${rowIndex}`}>
                                {tableSnapshot.columns.map((_, colIndex) => {
                                  const cellValue = row[colIndex] || "";
                                  return (
                                    <td key={`chart-preview-cell-${rowIndex}-${colIndex}`}>
                                      <span className="kpi-preview-cell" title={cellValue}>
                                        {cellValue}
                                      </span>
                                    </td>
                                  );
                                })}
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

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
