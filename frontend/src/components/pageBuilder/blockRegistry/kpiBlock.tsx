import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { normalizeTodoStatus } from "../../../constants";
import { useAppData } from "../../../state";
import { type Application, type CustomProperty } from "../../../types";
import BlockPanel from "../../BlockPanel";
import { TYPE_REGISTRY } from "../../dataTypes/typeRegistry";
import { type EditableTableColumnKind, type KpiMetricOp, type PageBlockPropsMap } from "../types";
import {
  KPI_SOURCE_TABLE_LINK_KEY,
  collectEditableTableTargets,
  getBlockLink,
  patchBlockLink
} from "../blockLinks";
import { getTableSchema } from "../tableSchemaRegistry";
import { createSlotContext } from "./shared";
import { type BlockDefinition } from "./types";

type KpiTableSnapshot = {
  columns: string[];
  rows: string[][];
  columnKinds: Record<string, EditableTableColumnKind>;
  valueOptionsByColumn: Record<string, string[]>;
};

type KpiMetricOption = {
  value: KpiMetricOp;
  label: string;
  needsColumn?: boolean;
  needsTargetValue?: boolean;
  numericOnly?: boolean;
  supportsPercent?: boolean;
};

const KPI_METRIC_OPTIONS: KpiMetricOption[] = [
  { value: "count_rows", label: "Contar filas", supportsPercent: false },
  { value: "count_values", label: "Contar valores", needsColumn: true, supportsPercent: true },
  { value: "count_empty", label: "Contar vacios", needsColumn: true, supportsPercent: true },
  { value: "unique_values", label: "Valores unicos", needsColumn: true, supportsPercent: true },
  { value: "value_count", label: "Contar un valor", needsColumn: true, needsTargetValue: true, supportsPercent: true },
  { value: "sum", label: "Sumar", needsColumn: true, numericOnly: true, supportsPercent: false },
  { value: "avg", label: "Media", needsColumn: true, numericOnly: true, supportsPercent: false }
];

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

const buildValueOptionsByColumn = (
  columns: string[],
  rows: string[][]
): Record<string, string[]> => {
  const options: Record<string, string[]> = {};
  columns.forEach((column, colIndex) => {
    const seen = new Set<string>();
    const values: string[] = [];
    rows.forEach((row) => {
      const value = normalizeString(row[colIndex] || "");
      if (!value || seen.has(value)) return;
      seen.add(value);
      values.push(value);
    });
    options[column] = values;
  });
  return options;
};

const buildTodoSnapshot = (applications: Application[]): KpiTableSnapshot => {
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
    columnKinds,
    valueOptionsByColumn: buildValueOptionsByColumn(columns, rows)
  };
};

const buildTrackerSnapshot = (
  targetProps: Record<string, unknown>,
  settings: unknown,
  applications: Application[]
): KpiTableSnapshot => {
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
    columnKinds,
    valueOptionsByColumn: buildValueOptionsByColumn(columns, rows)
  };
};

const buildEditableSnapshot = (
  targetProps: Record<string, unknown>,
  settings: unknown
): KpiTableSnapshot => {
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
      columnKinds: projection.columnKinds,
      valueOptionsByColumn: buildValueOptionsByColumn(projection.columns, rows)
    };
  }

  const columns = normalizeColumns(targetProps.customColumns);
  const rows = normalizeRows(targetProps.customRows, columns.length);
  const columnKinds = normalizeCustomKinds(targetProps.customColumnTypes, columns);
  return {
    columns,
    rows,
    columnKinds,
    valueOptionsByColumn: buildValueOptionsByColumn(columns, rows)
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

const formatMetricNumber = (value: number): string => {
  if (!Number.isFinite(value)) return "—";
  const isInt = Math.abs(value - Math.round(value)) < 0.0000001;
  if (isInt) {
    return Math.round(value).toLocaleString();
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
};

const computeMetricValue = ({
  snapshot,
  metricOp,
  column,
  targetValue,
  asPercent
}: {
  snapshot: KpiTableSnapshot;
  metricOp: KpiMetricOp;
  column: string;
  targetValue: string;
  asPercent: boolean;
}): string => {
  const metricDef = KPI_METRIC_OPTIONS.find((option) => option.value === metricOp);
  if (!metricDef) return "0";

  const rows = snapshot.rows;
  const denominator = rows.length;

  if (metricOp === "count_rows") {
    return String(denominator);
  }

  const columnIndex = snapshot.columns.indexOf(column);
  if (columnIndex < 0) return "0";
  const values = rows.map((row) => String(row[columnIndex] || "").trim());
  const isEmpty = (value: string) => value.length === 0;

  if (metricOp === "count_values") {
    const count = values.filter((value) => !isEmpty(value)).length;
    if (asPercent && metricDef.supportsPercent) {
      const pct = denominator > 0 ? (count / denominator) * 100 : 0;
      return `${formatMetricNumber(pct)}%`;
    }
    return formatMetricNumber(count);
  }

  if (metricOp === "count_empty") {
    const count = values.filter((value) => isEmpty(value)).length;
    if (asPercent && metricDef.supportsPercent) {
      const pct = denominator > 0 ? (count / denominator) * 100 : 0;
      return `${formatMetricNumber(pct)}%`;
    }
    return formatMetricNumber(count);
  }

  if (metricOp === "unique_values") {
    const count = new Set(values.filter((value) => !isEmpty(value))).size;
    if (asPercent && metricDef.supportsPercent) {
      const pct = denominator > 0 ? (count / denominator) * 100 : 0;
      return `${formatMetricNumber(pct)}%`;
    }
    return formatMetricNumber(count);
  }

  if (metricOp === "value_count") {
    const needle = targetValue.trim().toLowerCase();
    if (!needle) return "0";
    const count = values.filter((value) => value.toLowerCase() === needle).length;
    if (asPercent && metricDef.supportsPercent) {
      const pct = denominator > 0 ? (count / denominator) * 100 : 0;
      return `${formatMetricNumber(pct)}%`;
    }
    return formatMetricNumber(count);
  }

  const nums = values.map(toNumber).filter((value): value is number => value !== null);
  if (nums.length === 0) return "—";
  if (metricOp === "sum") {
    return formatMetricNumber(nums.reduce((acc, value) => acc + value, 0));
  }
  if (metricOp === "avg") {
    return formatMetricNumber(nums.reduce((acc, value) => acc + value, 0) / nums.length);
  }
  return "0";
};

const buildMetricOptions = (columnKind: EditableTableColumnKind): KpiMetricOption[] =>
  KPI_METRIC_OPTIONS.filter((option) => {
    if (!option.numericOnly) return true;
    return columnKind === "number" || columnKind === "rating";
  });

const buildAutoLabel = ({
  metricOp,
  column,
  targetValue,
  asPercent
}: {
  metricOp: KpiMetricOp;
  column: string;
  targetValue: string;
  asPercent: boolean;
}): string => {
  const cleanColumn = column.trim();
  const cleanTarget = targetValue.trim();
  let base = "KPI";
  if (metricOp === "count_rows") {
    base = "Total filas";
  } else if (metricOp === "count_values") {
    base = cleanColumn ? `Valores en ${cleanColumn}` : "Contar valores";
  } else if (metricOp === "count_empty") {
    base = cleanColumn ? `Vacios en ${cleanColumn}` : "Contar vacios";
  } else if (metricOp === "unique_values") {
    base = cleanColumn ? `Unicos en ${cleanColumn}` : "Valores unicos";
  } else if (metricOp === "value_count") {
    if (cleanColumn && cleanTarget) {
      base = `${cleanTarget} en ${cleanColumn}`;
    } else if (cleanColumn) {
      base = `Contar valor en ${cleanColumn}`;
    } else {
      base = "Contar un valor";
    }
  } else if (metricOp === "sum") {
    base = cleanColumn ? `Suma de ${cleanColumn}` : "Suma";
  } else if (metricOp === "avg") {
    base = cleanColumn ? `Media de ${cleanColumn}` : "Media";
  }
  return asPercent ? `${base} (%)` : base;
};

export const KPI_BLOCK_DEFINITION: BlockDefinition<"kpi"> = {
  type: "kpi",
  defaultLayout: { colSpan: 12 },
  createDefaultProps: () => ({ label: "KPI", value: "0" }),
  component: ({ block, mode, updateBlockProps, patchBlockProps, resolveSlot, menuActions }) => {
    const { settings, applications } = useAppData();
    const [isConfigOpen, setIsConfigOpen] = useState(false);
    const slotContext = createSlotContext(mode, updateBlockProps, patchBlockProps);
    const valueFromSlot = block.props.valueSlotId
      ? resolveSlot?.(block.props.valueSlotId, block, slotContext)
      : null;
    const tableTargets = useMemo(() => collectEditableTableTargets(settings), [settings]);
    const linkedTableId = getBlockLink(block.props, KPI_SOURCE_TABLE_LINK_KEY);
    const linkedTableTarget = linkedTableId
      ? tableTargets.find((target) => target.blockId === linkedTableId) || null
      : null;

    const resolveSnapshotForTarget = (target: (typeof linkedTableTarget) | null): KpiTableSnapshot | null => {
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

    const sourceColumn = tableSnapshot?.columns.includes(block.props.sourceColumn || "")
      ? (block.props.sourceColumn as string)
      : tableSnapshot?.columns[0] || "";
    const sourceKind = sourceColumn
      ? tableSnapshot?.columnKinds[sourceColumn] || "text"
      : "text";
    const metricOptions = buildMetricOptions(sourceKind);
    const metricOp = metricOptions.some((option) => option.value === block.props.metricOp)
      ? (block.props.metricOp as KpiMetricOp)
      : "count_rows";
    const metricDef = metricOptions.find((option) => option.value === metricOp) || metricOptions[0];
    const valueOptions = sourceColumn ? tableSnapshot?.valueOptionsByColumn[sourceColumn] || [] : [];
    const metricTargetValue =
      typeof block.props.metricTargetValue === "string" ? block.props.metricTargetValue : "";
    const allowPercent = Boolean(metricDef?.supportsPercent);
    const metricAsPercent = allowPercent && Boolean(block.props.metricAsPercent);
    const hasAutoLabelSource = Boolean(linkedTableId && tableSnapshot);
    const autoLabel = buildAutoLabel({
      metricOp,
      column: sourceColumn,
      targetValue: metricTargetValue,
      asPercent: metricAsPercent
    });
    const isAutoLabelEnabled = hasAutoLabelSource && Boolean(block.props.labelAuto);
    const label = isAutoLabelEnabled ? autoLabel : (block.props.label || "KPI");

    const computedValue = tableSnapshot
      ? computeMetricValue({
          snapshot: tableSnapshot,
          metricOp,
          column: sourceColumn,
          targetValue: metricTargetValue,
          asPercent: metricAsPercent
        })
      : null;

    const hasLinkedComputation = Boolean(linkedTableId && tableSnapshot);
    const value = hasLinkedComputation
      ? (computedValue ?? block.props.value ?? "0")
      : block.props.valueSlotId
        ? (valueFromSlot ?? block.props.value ?? "0")
        : (computedValue ?? block.props.value ?? "0");

    const linkedTableMissing = Boolean(linkedTableId && !linkedTableTarget);
    const previewRows = tableSnapshot ? tableSnapshot.rows.slice(0, 12) : [];

    const setLinkedTable = (nextBlockId?: string | null) => {
      const nextTarget = nextBlockId
        ? tableTargets.find((target) => target.blockId === nextBlockId) || null
        : null;
      const nextSnapshot = resolveSnapshotForTarget(nextTarget);
      const nextColumn = nextSnapshot?.columns[0];
      patchBlockProps({
        ...(patchBlockLink(
          block.props,
          KPI_SOURCE_TABLE_LINK_KEY,
          nextBlockId || null
        ) as Partial<PageBlockPropsMap["kpi"]>),
        labelAuto: Boolean(nextBlockId),
        sourceColumn: nextColumn,
        metricTargetValue: undefined
      });
    };

    const blockMenuActions = mode === "edit"
      ? [
          {
            key: `kpi-config-${block.id}`,
            label: "Configurar KPI",
            onClick: () => setIsConfigOpen(true)
          },
          ...(menuActions || [])
        ]
      : menuActions;

    return (
      <>
        <BlockPanel id={block.id} as="section" className="kpi-card-block" menuActions={blockMenuActions}>
          <p>{label}</p>
          <h2>{value}</h2>
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
              <div className="modal kpi-config-modal" onClick={(event) => event.stopPropagation()}>
                <header className="modal-header">
                  <div>
                    <h2>Configurar KPI</h2>
                    <p>Ajustes del bloque KPI</p>
                  </div>
                  <button className="ghost" type="button" onClick={() => setIsConfigOpen(false)} aria-label="Close">
                    ×
                  </button>
                </header>

                <div className="kpi-config-preview">
                  <div className="kpi-config-preview-label">{label}</div>
                  <div className="kpi-config-preview-value">{value}</div>
                  <div className="kpi-config-preview-meta">
                    <span>{linkedTableTarget ? linkedTableTarget.title : "Sin tabla"}</span>
                    <span>{metricDef?.label || "Metrica"}</span>
                    <span>{sourceColumn || "Sin columna"}</span>
                  </div>
                </div>

                <div className="kpi-config-grid">
                  <label className="field">
                    Etiqueta
                    <input
                      value={label}
                      onChange={(event) =>
                        patchBlockProps({
                          label: event.target.value,
                          labelAuto: false
                        })
                      }
                      placeholder="KPI"
                    />
                    {hasAutoLabelSource && (
                      <button
                        type="button"
                        className="ghost small"
                        onClick={() =>
                          patchBlockProps({
                            labelAuto: true,
                            label: autoLabel
                          })
                        }
                        disabled={isAutoLabelEnabled}
                      >
                        Usar nombre automatico
                      </button>
                    )}
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
                    Columna
                    <select
                      value={sourceColumn}
                      onChange={(event) =>
                        patchBlockProps({
                          sourceColumn: event.target.value,
                          metricTargetValue: undefined
                        })
                      }
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
                      onChange={(event) => {
                        const nextOp = event.target.value as KpiMetricOp;
                        const nextDef = KPI_METRIC_OPTIONS.find((option) => option.value === nextOp);
                        patchBlockProps({
                          metricOp: nextOp,
                          metricTargetValue: nextDef?.needsTargetValue ? block.props.metricTargetValue : undefined,
                          metricAsPercent: nextDef?.supportsPercent ? block.props.metricAsPercent : false
                        });
                      }}
                      disabled={!tableSnapshot}
                    >
                      {metricOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {metricDef?.needsTargetValue && (
                    <label className="field">
                      Valor objetivo
                      <input
                        list={`${block.id}-kpi-target-values`}
                        value={metricTargetValue}
                        onChange={(event) => patchBlockProps({ metricTargetValue: event.target.value })}
                        placeholder="Ej. In Progress"
                        disabled={!tableSnapshot || !sourceColumn}
                      />
                      <datalist id={`${block.id}-kpi-target-values`}>
                        {valueOptions.map((option) => (
                          <option key={option} value={option} />
                        ))}
                      </datalist>
                    </label>
                  )}

                  <label className="field">
                    Valor manual
                    <input
                      value={block.props.value || ""}
                      onChange={(event) => patchBlockProps({ value: event.target.value })}
                      placeholder="0"
                    />
                  </label>

                  <label className="field kpi-percent-field">
                    <span>Mostrar en %</span>
                    <input
                      type="checkbox"
                      checked={metricAsPercent}
                      disabled={!allowPercent}
                      onChange={(event) => patchBlockProps({ metricAsPercent: event.target.checked })}
                    />
                  </label>
                </div>

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
                              <th key={`kpi-preview-head-${column}`} title={column}>
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
                              <tr key={`kpi-preview-row-${rowIndex}`}>
                                {tableSnapshot.columns.map((_, colIndex) => {
                                  const cellValue = row[colIndex] || "";
                                  return (
                                    <td key={`kpi-preview-cell-${rowIndex}-${colIndex}`}>
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
