import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { normalizeTodoStatus, TODO_STATUSES } from "../../../constants";
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
import { type EditableTableColumnKind, type KpiMetricOp, type PageBlockPropsMap } from "../types";
import {
  KPI_SOURCE_TABLE_LINK_KEY,
  collectEditableTableTargets,
  buildBlockGraph,
  getBlockLink,
  resolveBlock,
  resolveLinkedBlock,
  patchBlockLink
} from "../blockLinks";
import { resolveEditableTableModel } from "./editableTableBlock";
import { createSlotContext } from "./shared";
import { SourceTablePreview } from "./sourceTablePreview";
import { type BlockDefinition } from "./types";

type KpiTableSnapshot = {
  columns: string[];
  rows: string[][];
  columnKinds: Record<string, EditableTableColumnKind>;
  valueOptionsByColumn: Record<string, string[]>;
  valueCountsByColumn: Record<string, Record<string, number>>;
};

type KpiMetricOption = {
  value: KpiMetricOp;
  label: string;
  needsColumn?: boolean;
  needsTargetValue?: boolean;
  numericOnly?: boolean;
  supportsPercent?: boolean;
};

type FloatingMenuPosition = {
  top: number;
  left: number;
  width: number;
  openUp: boolean;
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

const normalizeSelectOptionLabels = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const labels: string[] = [];
  raw.forEach((entry) => {
    const label = typeof entry === "string"
      ? normalizeString(entry)
      : isRecord(entry)
        ? normalizeString(entry.label)
        : "";
    if (!label || seen.has(label)) return;
    seen.add(label);
    labels.push(label);
  });
  return labels;
};

const normalizeCustomPropertiesWithOptions = (raw: unknown): CustomProperty[] => {
  const props = normalizeCustomProperties(raw);
  const optionLabelsByKey = new Map<string, string[]>();
  if (Array.isArray(raw)) {
    raw.forEach((entry) => {
      if (!isRecord(entry)) return;
      const key = normalizeString(entry.key);
      if (!key) return;
      optionLabelsByKey.set(key, normalizeSelectOptionLabels(entry.options));
    });
  }
  return props.map((prop) => ({
    ...prop,
    options: (optionLabelsByKey.get(prop.key) || []).map((label) => ({ label }))
  }));
};

const buildValueOptionsByColumn = (
  columns: string[],
  rows: string[][],
  predefinedOptionsByColumn: Record<string, string[]> = {}
): Record<string, string[]> => {
  const options: Record<string, string[]> = {};
  columns.forEach((column, colIndex) => {
    const seen = new Set<string>();
    const values: string[] = [];
    (predefinedOptionsByColumn[column] || []).forEach((rawValue) => {
      const value = normalizeString(rawValue);
      if (!value || seen.has(value)) return;
      seen.add(value);
      values.push(value);
    });
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

const buildValueCountsByColumn = (
  columns: string[],
  rows: string[][]
): Record<string, Record<string, number>> => {
  const counts: Record<string, Record<string, number>> = {};
  columns.forEach((column, colIndex) => {
    const values: Record<string, number> = {};
    rows.forEach((row) => {
      const value = normalizeString(row[colIndex] || "");
      if (!value) return;
      values[value] = (values[value] || 0) + 1;
    });
    counts[column] = values;
  });
  return counts;
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
  const predefinedOptionsByColumn = {
    Status: [...TODO_STATUSES]
  };
  const valueCountsByColumn = buildValueCountsByColumn(columns, rows);
  return {
    columns,
    rows,
    columnKinds,
    valueOptionsByColumn: buildValueOptionsByColumn(columns, rows, predefinedOptionsByColumn),
    valueCountsByColumn
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
  const customProps = normalizeCustomPropertiesWithOptions(settingsRecord.custom_properties);
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
  const predefinedOptionsByColumn: Record<string, string[]> = {};
  const keyByLabel: string[] = [];
  const usedLabels = new Set<string>();
  const createUniqueLabel = (label: string) => {
    const base = label.trim() || "Column";
    if (!usedLabels.has(base)) {
      usedLabels.add(base);
      return base;
    }
    let attempt = 2;
    while (usedLabels.has(`${base} (${attempt})`)) {
      attempt += 1;
    }
    const next = `${base} (${attempt})`;
    usedLabels.add(next);
    return next;
  };
  orderedKeys.forEach((key) => {
    const labelOverride = columnLabels[key];
    let labelSeed = typeof labelOverride === "string" ? labelOverride.trim() : "";
    let kind: EditableTableColumnKind = "text";
    let selectOptions: string[] = [];

    if (key.startsWith("prop__")) {
      const propKey = key.slice("prop__".length);
      const prop = customPropByKey.get(propKey) || null;
      if (!labelSeed) labelSeed = prop?.name || key;
      kind = customPropertyKind(prop);
      if (kind === "select") {
        selectOptions = normalizeSelectOptionLabels(prop?.options);
      }
    } else {
      if (!labelSeed) labelSeed = TRACKER_COLUMN_LABELS[key] || key;
      kind = TRACKER_COLUMN_KINDS[key] || "text";
      if (key === "stage") {
        selectOptions = normalizeStringArray(settingsRecord.stages);
      } else if (key === "outcome") {
        selectOptions = normalizeStringArray(settingsRecord.outcomes);
      } else if (key === "job_type") {
        selectOptions = normalizeStringArray(settingsRecord.job_types);
      }
    }

    const label = createUniqueLabel(labelSeed || key);
    columns.push(label);
    keyByLabel.push(key);
    columnKinds[label] = kind;
    if (selectOptions.length > 0) {
      predefinedOptionsByColumn[label] = selectOptions;
    }
  });

  const rows = applications.map((app) => keyByLabel.map((columnKey) => trackerValueForColumn(app, columnKey)));
  const valueCountsByColumn = buildValueCountsByColumn(columns, rows);

  return {
    columns,
    rows,
    columnKinds,
    valueOptionsByColumn: buildValueOptionsByColumn(columns, rows, predefinedOptionsByColumn),
    valueCountsByColumn
  };
};

const buildEditableSnapshot = (
  targetProps: Record<string, unknown>,
  settings: unknown
): KpiTableSnapshot => {
  const model = resolveEditableTableModel(targetProps as PageBlockPropsMap["editableTable"], { settings });
  const predefinedOptionsByColumn: Record<string, string[]> = {};
  Object.entries(model.selectOptionsByColumn).forEach(([column, options]) => {
    const labels = normalizeSelectOptionLabels(options);
    if (labels.length > 0) {
      predefinedOptionsByColumn[column] = labels;
    }
  });
  const valueCountsByColumn = buildValueCountsByColumn(model.columns, model.rows);
  return {
    columns: model.columns,
    rows: model.rows,
    columnKinds: model.columnKinds,
    valueOptionsByColumn: buildValueOptionsByColumn(model.columns, model.rows, predefinedOptionsByColumn),
    valueCountsByColumn
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
  targetValues,
  asPercent
}: {
  snapshot: KpiTableSnapshot;
  metricOp: KpiMetricOp;
  column: string;
  targetValues: string[];
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
    const needles = new Set(
      targetValues
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
    );
    if (!needles.size) return "0";
    const count = values.filter((value) => needles.has(value.toLowerCase())).length;
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
  targetValues,
  asPercent
}: {
  metricOp: KpiMetricOp;
  column: string;
  targetValues: string[];
  asPercent: boolean;
}): string => {
  const cleanColumn = column.trim();
  const cleanTargets = Array.from(
    new Set(targetValues.map((value) => value.trim()).filter(Boolean))
  );
  const targetLabel =
    cleanTargets.length === 0
      ? ""
      : cleanTargets.length === 1
        ? cleanTargets[0]
        : cleanTargets.length === 2
          ? `${cleanTargets[0]} + ${cleanTargets[1]}`
          : `${cleanTargets[0]} + ${cleanTargets[1]} + ${cleanTargets.length - 2} mas`;
  let base = "KPI";
  if (metricOp === "count_rows") {
    base = cleanColumn ? `Total filas ${cleanColumn}` : "Total filas";
  } else if (metricOp === "count_values") {
    base = cleanColumn ? `Total valores ${cleanColumn}` : "Total valores";
  } else if (metricOp === "count_empty") {
    base = cleanColumn ? `Total vacios ${cleanColumn}` : "Total vacios";
  } else if (metricOp === "unique_values") {
    base = cleanColumn ? `Valores unicos ${cleanColumn}` : "Valores unicos";
  } else if (metricOp === "value_count") {
    if (cleanColumn && targetLabel) {
      base = `Total ${cleanColumn}: ${targetLabel}`;
    } else if (cleanColumn) {
      base = `Contar valor ${cleanColumn}`;
    } else if (targetLabel) {
      base = `Contar ${targetLabel}`;
    } else {
      base = "Contar un valor";
    }
  } else if (metricOp === "sum") {
    base = cleanColumn ? `Suma ${cleanColumn}` : "Suma";
  } else if (metricOp === "avg") {
    base = cleanColumn ? `Media ${cleanColumn}` : "Media";
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
    const [isTargetMenuOpen, setIsTargetMenuOpen] = useState(false);
    const [targetMenuPosition, setTargetMenuPosition] = useState<FloatingMenuPosition | null>(null);
    const targetMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
    const targetMenuRef = useRef<HTMLDivElement | null>(null);
    const slotContext = createSlotContext(mode, updateBlockProps, patchBlockProps);
    const valueFromSlot = block.props.valueSlotId
      ? resolveSlot?.(block.props.valueSlotId, block, slotContext)
      : null;
    const tableTargets = useMemo(() => collectEditableTableTargets(settings), [settings]);
    const graph = useMemo(() => buildBlockGraph(settings), [settings]);
    const linkedTableTarget = resolveLinkedBlock(graph, block.props, KPI_SOURCE_TABLE_LINK_KEY);

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
    const valueCounts = sourceColumn ? tableSnapshot?.valueCountsByColumn[sourceColumn] || {} : {};
    const metricTargetValues = useMemo(() => {
      const fromArray = Array.isArray(block.props.metricTargetValues)
        ? block.props.metricTargetValues
            .map((value) => normalizeString(value))
            .filter(Boolean)
        : [];
      if (fromArray.length > 0) {
        return Array.from(new Set(fromArray));
      }
      const legacyValue = normalizeString(block.props.metricTargetValue);
      return legacyValue ? [legacyValue] : [];
    }, [block.props.metricTargetValue, block.props.metricTargetValues]);
    const targetOptionValues = useMemo(() => {
      const merged = [...valueOptions];
      metricTargetValues.forEach((value) => {
        if (!merged.includes(value)) {
          merged.push(value);
        }
      });
      return merged;
    }, [metricTargetValues, valueOptions]);
    const targetSummaryLabel = metricTargetValues.length === 0
      ? "Seleccionar valores"
      : metricTargetValues.length === 1
        ? metricTargetValues[0]
        : `${metricTargetValues.length} valores seleccionados`;
    const selectedTargetPreview = metricTargetValues.slice(0, 3);
    const remainingTargetCount = Math.max(0, metricTargetValues.length - selectedTargetPreview.length);
    const selectedTargetCountLabel = metricTargetValues.length === 1
      ? "1 valor seleccionado"
      : `${metricTargetValues.length} valores seleccionados`;
    const allowPercent = Boolean(metricDef?.supportsPercent);
    const metricAsPercent = allowPercent && Boolean(block.props.metricAsPercent);
    const hasAutoLabelSource = Boolean(linkedTableTarget && tableSnapshot);
    const autoLabel = buildAutoLabel({
      metricOp,
      column: sourceColumn,
      targetValues: metricTargetValues,
      asPercent: metricAsPercent
    });
    const isAutoLabelEnabled = hasAutoLabelSource && Boolean(block.props.labelAuto);
    const label = isAutoLabelEnabled ? autoLabel : (block.props.label || "KPI");

    const computedValue = tableSnapshot
      ? computeMetricValue({
          snapshot: tableSnapshot,
          metricOp,
          column: sourceColumn,
          targetValues: metricTargetValues,
          asPercent: metricAsPercent
        })
      : null;

    const hasLinkedComputation = Boolean(linkedTableTarget && tableSnapshot);
    const value = hasLinkedComputation
      ? (computedValue ?? block.props.value ?? "0")
      : block.props.valueSlotId
        ? (valueFromSlot ?? block.props.value ?? "0")
        : (computedValue ?? block.props.value ?? "0");

    const linkedBlockId = getBlockLink(block.props, KPI_SOURCE_TABLE_LINK_KEY);
    const linkedTableMissing = Boolean(linkedBlockId && !linkedTableTarget);
    const dataSourceModeLabel = linkedTableTarget ? "Automatico" : "Manual";
    const metricHelpText = !tableSnapshot
      ? "Vincula una tabla para habilitar el calculo automatico."
      : metricDef?.needsColumn
        ? `Se calculara sobre la columna ${sourceColumn || "seleccionada"}.`
        : "La metrica se calcula sobre todas las filas de la tabla.";
    const manualValueHelpText = hasLinkedComputation
      ? "Se usa como respaldo si la tabla deja de estar disponible."
      : "Valor mostrado cuando el KPI no esta vinculado a una tabla.";
    const percentHelpText = allowPercent
      ? "Muestra el resultado relativo al total disponible."
      : "Disponible solo en metricas de conteo.";

    const setLinkedTable = (nextBlockId?: string | null) => {
      const nextTarget = nextBlockId ? resolveBlock(graph, nextBlockId) : null;
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
        metricTargetValue: undefined,
        metricTargetValues: undefined
      });
    };
    const setMetricTargetValues = (nextValues: string[]) => {
      const deduped = Array.from(new Set(nextValues.map((value) => value.trim()).filter(Boolean)));
      patchBlockProps({
        metricTargetValues: deduped.length > 0 ? deduped : undefined,
        metricTargetValue: deduped[0] || undefined
      });
    };

    useEffect(() => {
      if (!isConfigOpen || !metricDef?.needsTargetValue || targetOptionValues.length === 0) {
        setIsTargetMenuOpen(false);
      }
    }, [isConfigOpen, metricDef?.needsTargetValue, targetOptionValues.length]);

    useEffect(() => {
      if (!isTargetMenuOpen) return;
      if (typeof window === "undefined") return;

      const updatePosition = () => {
        const trigger = targetMenuTriggerRef.current;
        if (!trigger) {
          setTargetMenuPosition(null);
          return;
        }
        const rect = trigger.getBoundingClientRect();
        const width = Math.max(rect.width, 260);
        const viewportHeight = window.innerHeight || 0;
        const spaceBelow = viewportHeight - rect.bottom;
        const openUp = spaceBelow < 280 && rect.top > spaceBelow;
        setTargetMenuPosition({
          top: openUp ? rect.top - 6 : rect.bottom + 6,
          left: rect.left,
          width,
          openUp
        });
      };

      const handleDocumentMouseDown = (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (targetMenuRef.current?.contains(target)) return;
        if (targetMenuTriggerRef.current?.contains(target)) return;
        setIsTargetMenuOpen(false);
      };

      const handleWindowKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          setIsTargetMenuOpen(false);
        }
      };

      updatePosition();
      document.addEventListener("mousedown", handleDocumentMouseDown);
      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("keydown", handleWindowKeyDown);

      return () => {
        document.removeEventListener("mousedown", handleDocumentMouseDown);
        window.removeEventListener("resize", updatePosition);
        window.removeEventListener("scroll", updatePosition, true);
        window.removeEventListener("keydown", handleWindowKeyDown);
      };
    }, [isTargetMenuOpen]);

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
              <div className="modal block-config-modal" onClick={(event) => event.stopPropagation()}>
                <header className="modal-header">
                  <div>
                    <h2>Configurar KPI</h2>
                    <p>Ajustes del bloque KPI</p>
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
                          <h3>Identidad</h3>
                          <p>Define el nombre visible y el valor de respaldo del KPI.</p>
                        </div>
                        {hasAutoLabelSource && (
                          <button
                            type="button"
                            className={`ghost small block-inline-toggle ${isAutoLabelEnabled ? "active" : ""}`}
                            onClick={() =>
                              patchBlockProps({
                                labelAuto: !isAutoLabelEnabled,
                                label: isAutoLabelEnabled ? label : autoLabel
                              })
                            }
                          >
                            {isAutoLabelEnabled ? "Nombre automatico activo" : "Usar nombre automatico"}
                          </button>
                        )}
                      </div>

                      <div className="block-config-grid">
                        <label className="field">
                          <span className="block-field-label">Etiqueta</span>
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
                          <p className="block-field-hint">
                            {isAutoLabelEnabled
                              ? "La etiqueta se actualiza automaticamente segun la metrica elegida."
                              : "Puedes escribir una etiqueta fija o activar el nombre automatico."}
                          </p>
                        </label>

                        <label className="field">
                          <span className="block-field-label">Valor manual</span>
                          <input
                            value={block.props.value || ""}
                            onChange={(event) => patchBlockProps({ value: event.target.value })}
                            placeholder="0"
                          />
                          <p className="block-field-hint">{manualValueHelpText}</p>
                        </label>
                      </div>
                    </section>

                    <section className="block-config-section">
                      <div className="block-config-section-head">
                        <div>
                          <h3>Fuente de datos</h3>
                          <p>Selecciona la tabla y la columna desde la que se calcula el KPI.</p>
                        </div>
                        <span className={`block-status-badge ${linkedTableTarget ? "ready" : "muted"}`}>
                          {linkedTableTarget ? "Tabla conectada" : "Sin tabla"}
                        </span>
                      </div>

                      <div className="block-config-grid">
                        <label className="field">
                          <span className="block-field-label">Tabla vinculada</span>
                          <select
                            value={linkedTableTarget?.blockId || ""}
                            onChange={(event) => setLinkedTable(event.target.value || null)}
                          >
                            <option value="">Sin tabla</option>
                            {tableTargets.map((target) => (
                              <option key={target.blockId} value={target.blockId}>
                                [{target.pageId}] {target.title}
                              </option>
                            ))}
                          </select>
                          <p className="block-field-hint">
                            {linkedTableTarget
                              ? `Usando ${linkedTableTarget.title} como origen.`
                              : "Sin tabla vinculada, el KPI mostrara el valor manual."}
                          </p>
                        </label>

                        <label className="field">
                          <span className="block-field-label">Columna</span>
                          <select
                            value={sourceColumn}
                            onChange={(event) =>
                              patchBlockProps({
                                sourceColumn: event.target.value,
                                metricTargetValue: undefined,
                                metricTargetValues: undefined
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
                          <p className="block-field-hint">
                            {sourceColumn
                              ? `Columna activa: ${sourceColumn}.`
                              : "Selecciona una tabla para ver las columnas disponibles."}
                          </p>
                        </label>
                      </div>
                    </section>

                    <section className="block-config-section">
                      <div className="block-config-section-head">
                        <div>
                          <h3>Calculo</h3>
                          <p>Ajusta la metrica, el filtro objetivo y el formato del resultado.</p>
                        </div>
                        <span className="block-status-badge">{metricDef?.label || "Metrica"}</span>
                      </div>

                      <div className="block-config-grid">
                        <label className="field">
                          <span className="block-field-label">Metrica</span>
                          <select
                            value={metricOp}
                            onChange={(event) => {
                              const nextOp = event.target.value as KpiMetricOp;
                              const nextDef = KPI_METRIC_OPTIONS.find((option) => option.value === nextOp);
                              patchBlockProps({
                                metricOp: nextOp,
                                metricTargetValue: nextDef?.needsTargetValue ? block.props.metricTargetValue : undefined,
                                metricTargetValues: nextDef?.needsTargetValue ? block.props.metricTargetValues : undefined,
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
                          <p className="block-field-hint">{metricHelpText}</p>
                        </label>

                        <label className={`field block-toggle-field ${allowPercent ? "" : "disabled"}`}>
                          <div className="block-toggle-head">
                            <span className="block-field-label">Mostrar en %</span>
                            <input
                              type="checkbox"
                              checked={metricAsPercent}
                              disabled={!allowPercent}
                              onChange={(event) => patchBlockProps({ metricAsPercent: event.target.checked })}
                            />
                          </div>
                          <p className="block-field-hint">{percentHelpText}</p>
                        </label>

                        {metricDef?.needsTargetValue && (
                          <div className="field full kpi-target-field">
                            <div className="kpi-target-head">
                              <div>
                                <span className="block-field-label">Valor objetivo</span>
                                <p className="block-field-hint">
                                  Filtra la metrica por uno o varios valores de la columna seleccionada.
                                </p>
                              </div>
                              <span className={`block-status-badge ${metricTargetValues.length > 0 ? "ready" : "muted"}`}>
                                {metricTargetValues.length > 0 ? selectedTargetCountLabel : "Sin filtro"}
                              </span>
                            </div>

                            {targetOptionValues.length === 0 ? (
                              <p className="kpi-target-empty">No hay valores disponibles en esta columna.</p>
                            ) : (
                              <>
                                <button
                                  ref={targetMenuTriggerRef}
                                  type="button"
                                  className={`select-trigger kpi-target-trigger ${isTargetMenuOpen ? "open" : ""}`}
                                  disabled={!tableSnapshot || !sourceColumn}
                                  onClick={() => setIsTargetMenuOpen((prev) => !prev)}
                                  aria-haspopup="listbox"
                                  aria-expanded={isTargetMenuOpen}
                                >
                                  <span className={`select-pill ${metricTargetValues.length === 0 ? "kpi-target-placeholder" : ""}`}>
                                    {targetSummaryLabel}
                                  </span>
                                  <span className="select-caret">▾</span>
                                </button>

                                <div className="kpi-target-tags">
                                  {metricTargetValues.length === 0 ? (
                                    <span className="kpi-target-chip muted">Sin filtros aplicados</span>
                                  ) : (
                                    <>
                                      {selectedTargetPreview.map((targetValue) => (
                                        <span key={`${block.id}-target-chip-${targetValue}`} className="kpi-target-chip">
                                          {targetValue}
                                        </span>
                                      ))}
                                      {remainingTargetCount > 0 && (
                                        <span className="kpi-target-chip count">+{remainingTargetCount}</span>
                                      )}
                                    </>
                                  )}
                                </div>

                                <p className="kpi-target-summary">
                                  {metricTargetValues.length > 0
                                    ? `${selectedTargetCountLabel}. Puedes combinar varios valores.`
                                    : "Selecciona uno o varios valores para acotar el calculo."}
                                </p>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </section>
                  </div>

                  <aside className="block-config-sidebar">
                    <div className="block-config-preview">
                      <div className="block-config-preview-label">{label}</div>
                      <div className="block-config-preview-value">{value}</div>
                      <div className="block-config-preview-meta">
                        <span>{linkedTableTarget ? linkedTableTarget.title : "Sin tabla"}</span>
                        <span>{metricDef?.label || "Metrica"}</span>
                        <span>{sourceColumn || "Sin columna"}</span>
                      </div>
                    </div>

                    <section className="block-config-sidebar-card">
                      <div className="block-config-section-head compact">
                        <div>
                          <h3>Resumen</h3>
                          <p>Estado actual de la configuracion.</p>
                        </div>
                        <span className={`block-status-badge ${linkedTableTarget ? "ready" : "muted"}`}>
                          {dataSourceModeLabel}
                        </span>
                      </div>

                      <div className="block-summary-list">
                        <div className="block-summary-row">
                          <span>Etiqueta</span>
                          <strong>{isAutoLabelEnabled ? "Automatica" : "Manual"}</strong>
                        </div>
                        <div className="block-summary-row">
                          <span>Fuente</span>
                          <strong>{linkedTableTarget?.title || "Valor manual"}</strong>
                        </div>
                        <div className="block-summary-row">
                          <span>Columna</span>
                          <strong>{metricDef?.needsColumn ? (sourceColumn || "Sin columna") : "No aplica"}</strong>
                        </div>
                        <div className="block-summary-row">
                          <span>Objetivo</span>
                          <strong>{metricDef?.needsTargetValue ? (metricTargetValues.length > 0 ? selectedTargetCountLabel : "Sin filtro") : "No aplica"}</strong>
                        </div>
                        <div className="block-summary-row">
                          <span>Formato</span>
                          <strong>{metricAsPercent ? "Porcentaje" : "Valor directo"}</strong>
                        </div>
                      </div>

                      {metricDef?.needsTargetValue && metricTargetValues.length > 0 && (
                        <div className="kpi-target-tags summary">
                          {selectedTargetPreview.map((targetValue) => (
                            <span key={`${block.id}-target-summary-${targetValue}`} className="kpi-target-chip">
                              {targetValue}
                            </span>
                          ))}
                          {remainingTargetCount > 0 && (
                            <span className="kpi-target-chip count">+{remainingTargetCount}</span>
                          )}
                        </div>
                      )}
                    </section>
                  </aside>
                </div>

                {tableSnapshot && <SourceTablePreview table={tableSnapshot} keyPrefix="kpi-preview" />}

                {linkedTableMissing && (
                  <p className="kpi-edit-hint">La tabla vinculada ya no existe. Selecciona otra.</p>
                )}
              </div>
            </div>,
            document.body
          )}
        {isConfigOpen &&
          isTargetMenuOpen &&
          targetMenuPosition &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              ref={targetMenuRef}
              className="select-menu block-floating-menu kpi-target-floating-menu"
              style={{
                position: "fixed",
                top: targetMenuPosition.top,
                left: targetMenuPosition.left,
                width: targetMenuPosition.width,
                transform: targetMenuPosition.openUp ? "translateY(-100%)" : undefined,
                zIndex: 45
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="kpi-target-menu-head">
                <strong>Valores objetivo</strong>
                <span>{targetOptionValues.length} opciones</span>
              </div>
              <div className="select-options" role="listbox" aria-label="Valores objetivo" aria-multiselectable="true">
                {targetOptionValues.map((option) => {
                  const checked = metricTargetValues.includes(option);
                  const optionCount = valueCounts[option] || 0;
                  return (
                    <button
                      type="button"
                      key={`${block.id}-target-window-${option}`}
                      className={`select-option ${checked ? "selected" : ""}`}
                      onClick={() => {
                        if (checked) {
                          setMetricTargetValues(metricTargetValues.filter((value) => value !== option));
                        } else {
                          setMetricTargetValues([...metricTargetValues, option]);
                        }
                      }}
                    >
                      <span className="select-swatch" style={{ backgroundColor: "var(--panel)" }} />
                      <span className="select-label">{option}</span>
                      <span className="block-option-count">{optionCount}</span>
                      <span className="select-check">{checked ? "✓" : ""}</span>
                    </button>
                  );
                })}
              </div>
              <div className="column-menu-separator" />
              <button type="button" className="select-option" onClick={() => setMetricTargetValues([])}>
                <span className="select-swatch" style={{ backgroundColor: "var(--panel)" }} />
                <span className="select-label">Limpiar seleccion</span>
              </button>
            </div>,
            document.body
          )}
      </>
    );
  }
};
