import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import StarRating from "../components/StarRating";
import { EditableTableToolbar } from "../components/blocks/BlockRenderer";
import { BlockSlotResolver, PageBuilderPage } from "../components/pageBuilder";
import {
  ColumnMenuChevronRight,
  columnMenuIconChangeType,
  columnMenuIconHide,
  columnMenuIconTrash
} from "../components/columnMenuIcons";
import { CUSTOM_PROPERTY_TYPE_MENU_ITEMS } from "../components/columnMenuTypeItems";
import {
  PIPELINE_SOURCE_TABLE_LINK_KEY,
  collectEditableTableTargets,
  buildBlockGraph,
  resolveBlock,
  getBlockLink,
  type BlockTargetSnapshot
} from "../components/pageBuilder/blockLinks";
import { type EditableTableColumnKind } from "../components/pageBuilder/types";
import { useI18n } from "../i18n";
import { useAppData } from "../state";
import { DateValueDisplay, type SelectOption } from "../components/TableCells";
import ExpandedFieldsSection, { type ExpandedFieldRow } from "../components/expanded/ExpandedFieldsSection";
import TypologyFieldControl from "../components/expanded/TypologyFieldControl";
import { deleteDocument, documentDownloadUrl, openExternal, uploadDocuments } from "../api";
import {
  type Application,
  type ApplicationInput,
  type Contact,
  type TodoItem,
  type PipelineCardConfig,
  type Settings
} from "../types";
import { followupStatus } from "../utils";
import {
  TRACKER_BASE_COLUMN_ORDER,
  TRACKER_COLUMN_LABELS,
  TRACKER_COLUMN_KINDS
} from "../shared/columnSchema";
import { useUndo } from "../undoContext";
import {
  isRecord,
  normalizeString,
  normalizeStringArray,
  normalizeCustomProperties,
  customPropertyKind
} from "../shared/normalize";
import { confirmDialog } from "../shared/confirmDialog";
import { COMPACT_TEXT_MAX_CHARS } from "../shared/textControl";
import {
  ContactsCell,
  DocumentsPropertyCell,
  LinksCell,
  TodoItemsCell,
  parseContactsPropValue,
  parseDocumentsPropValue,
  parseJsonArraySafe,
  parseLinksPropValue,
  type LinkItem
} from "./tracker/trackerCells";

type TrackerColumnProjection = {
  labelToKey: Record<string, string>;
  keyToLabel: Record<string, string>;
  orderedKeys: string[];
  kindByKey: Record<string, EditableTableColumnKind>;
};

type PipelineGroupingConfig = {
  key: string;
  values: string[];
  colors: Record<string, string>;
  allowColumnReorder: boolean;
};

type PipelineFieldDefinition = {
  key: string;
  label: string;
  kind: EditableTableColumnKind;
  options: string[];
  customPropertyKey?: string;
};

type ResolvedPipelineCardConfig = {
  pipelineField: string;
  titleColumn: string;
  visibleFields: string[];
};

const DEFAULT_COLUMN_COLOR = "#E2E8F0";
const DEFAULT_TITLE_COLUMN = "company_name";
const DEFAULT_VISIBLE_FIELDS = [
  "position",
  "job_type",
  "location",
  "outcome",
  "application_date",
  "interview_rounds",
  "company_score"
];
const LONG_TEXT_KEYS = new Set([
  "notes",
  "job_description",
  "improvement_areas",
  "skill_to_upgrade",
  "interviewers"
]);
const REQUIRED_TEXT_KEYS = new Set(["company_name", "position", "stage", "outcome", "job_type"]);
const RATING_KEYS = new Set(["company_score", "my_interview_score"]);
const NUMBER_KEYS = new Set(["pipeline_order", "interview_rounds", "total_rounds"]);
const DATE_KEYS = new Set(["application_date", "followup_date", "interview_datetime"]);
const CORE_SELECT_FIELD_CONFIG = {
  stage: { listKey: "stages", colorKey: "stage_colors" },
  outcome: { listKey: "outcomes", colorKey: "outcome_colors" },
  job_type: { listKey: "job_types", colorKey: "job_type_colors" }
} as const;
type CoreSelectFieldKey = keyof typeof CORE_SELECT_FIELD_CONFIG;
type CustomPropertyTypeKind = (typeof CUSTOM_PROPERTY_TYPE_MENU_ITEMS)[number]["kind"];

const getCoreSelectFieldConfig = (fieldKey: string) => {
  if (fieldKey in CORE_SELECT_FIELD_CONFIG) {
    return CORE_SELECT_FIELD_CONFIG[fieldKey as CoreSelectFieldKey];
  }
  return null;
};

const normalizeEditableSelectOptions = (options: SelectOption[]): SelectOption[] => {
  const seen = new Set<string>();
  const next: SelectOption[] = [];
  options.forEach((option) => {
    const label = normalizeString(option.label);
    if (!label || seen.has(label)) return;
    seen.add(label);
    next.push({
      ...option,
      label,
      color: normalizeString(option.color) || undefined
    });
  });
  return next;
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

const reorderList = (list: string[], fromLabel: string, toLabel: string) => {
  if (fromLabel === toLabel) return list;
  const next = [...list];
  const fromIndex = next.indexOf(fromLabel);
  const toIndex = next.indexOf(toLabel);
  if (fromIndex < 0 || toIndex < 0) return list;
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, fromLabel);
  return next;
};

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toIntegerOrNull = (value: unknown): number | null => {
  const parsed = toNumberOrNull(value);
  return parsed === null ? null : Math.trunc(parsed);
};

const parseTodoItemsValue = (raw: unknown): TodoItem[] => {
  if (Array.isArray(raw)) {
    const next: TodoItem[] = [];
    raw.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const obj = item as Record<string, unknown>;
      const id = typeof obj.id === "string" ? obj.id : "";
      const task = typeof obj.task === "string" ? obj.task : "";
      if (!id || !task) return;
      next.push({
        id,
        task,
        due_date: typeof obj.due_date === "string" ? obj.due_date : undefined,
        status: typeof obj.status === "string" ? obj.status : undefined,
        task_location: typeof obj.task_location === "string" ? obj.task_location : undefined,
        notes: typeof obj.notes === "string" ? obj.notes : undefined,
        documents_links: typeof obj.documents_links === "string" ? obj.documents_links : undefined
      });
    });
    return next;
  }

  if (typeof raw === "string" && raw.trim()) {
    const parsed = parseJsonArraySafe(raw);
    return parseTodoItemsValue(parsed);
  }

  return [];
};

const readGroupValue = (app: Application, key: string): string => {
  if (key.startsWith("prop__")) {
    const propertyKey = key.slice("prop__".length);
    return app.properties?.[propertyKey] || "";
  }
  const raw = (app as Record<string, unknown>)[key];
  if (raw === null || raw === undefined) return "";
  return String(raw);
};

const readFieldRawValue = (app: Application, key: string): unknown => {
  if (key.startsWith("prop__")) {
    const propertyKey = key.slice("prop__".length);
    return app.properties?.[propertyKey] || "";
  }
  return (app as Record<string, unknown>)[key];
};

const buildGroupUpdatePayload = (
  app: Application,
  key: string,
  nextValue: string
): Partial<ApplicationInput> => {
  if (key.startsWith("prop__")) {
    const propertyKey = key.slice("prop__".length);
    return {
      properties: {
        ...(app.properties || {}),
        [propertyKey]: nextValue
      }
    };
  }
  if (key === "stage" || key === "outcome" || key === "job_type") {
    return { [key]: nextValue } as Partial<ApplicationInput>;
  }
  return { [key]: nextValue } as Partial<ApplicationInput>;
};

const buildApplicationFieldPayload = (
  app: Application,
  key: string,
  rawValue: unknown
): Partial<ApplicationInput> => {
  if (key.startsWith("prop__")) {
    const propertyKey = key.slice("prop__".length);
    const nextValue =
      rawValue === null || rawValue === undefined
        ? ""
        : typeof rawValue === "string"
          ? rawValue
          : Array.isArray(rawValue) || typeof rawValue === "object"
            ? JSON.stringify(rawValue)
            : String(rawValue);
    return {
      properties: {
        ...(app.properties || {}),
        [propertyKey]: nextValue
      }
    };
  }

  if (key === "favorite") {
    return { favorite: Boolean(rawValue) };
  }

  if (key === "contacts") {
    const nextContacts = Array.isArray(rawValue) ? (rawValue as Contact[]) : [];
    return { contacts: nextContacts } as Partial<ApplicationInput>;
  }

  if (key === "todo_items") {
    const nextTodoItems = Array.isArray(rawValue) ? (rawValue as TodoItem[]) : [];
    return { todo_items: nextTodoItems } as Partial<ApplicationInput>;
  }

  if (RATING_KEYS.has(key)) {
    return { [key]: toNumberOrNull(rawValue) } as Partial<ApplicationInput>;
  }

  if (NUMBER_KEYS.has(key)) {
    return { [key]: toIntegerOrNull(rawValue) } as Partial<ApplicationInput>;
  }

  if (DATE_KEYS.has(key)) {
    const nextValue = typeof rawValue === "string" ? rawValue.trim() : String(rawValue || "").trim();
    return { [key]: nextValue || null } as Partial<ApplicationInput>;
  }

  const textValue = rawValue === null || rawValue === undefined ? "" : String(rawValue);
  if (REQUIRED_TEXT_KEYS.has(key)) {
    return { [key]: textValue } as Partial<ApplicationInput>;
  }
  return { [key]: textValue || null } as Partial<ApplicationInput>;
};

const isTrackerSourceTarget = (target: BlockTargetSnapshot): boolean => {
  const schemaRef = normalizeString(target.props.schemaRef);
  const contentSlotId = normalizeString(target.props.contentSlotId);
  return (
    schemaRef === "tracker.applications@1" ||
    target.pageId === "tracker" ||
    target.blockId === "tracker:table" ||
    contentSlotId.startsWith("tracker:content")
  );
};

const buildTrackerColumnProjection = (
  settings: Settings,
  targetProps: Record<string, unknown>
): TrackerColumnProjection => {
  const columnLabels = isRecord(settings.column_labels)
    ? (settings.column_labels as Record<string, unknown>)
    : {};
  const customProps = Array.isArray(settings.custom_properties) ? settings.custom_properties : [];
  const customPropByKey = new Map(customProps.map((prop) => [prop.key, prop]));
  const overrideOrder = isRecord(targetProps.overrides)
    ? normalizeStringArray((targetProps.overrides as Record<string, unknown>).columnOrder)
    : [];
  const settingsOrder = normalizeStringArray(settings.table_columns);

  const orderedKeys: string[] = [];
  const pushKey = (key: string) => {
    const normalized = key.trim();
    if (!normalized || orderedKeys.includes(normalized)) return;
    orderedKeys.push(normalized);
  };

  (overrideOrder.length > 0 ? overrideOrder : settingsOrder).forEach(pushKey);
  TRACKER_BASE_COLUMN_ORDER.forEach(pushKey);
  customProps.forEach((prop) => pushKey(`prop__${prop.key}`));

  const labelToKey: Record<string, string> = {};
  const keyToLabel: Record<string, string> = {};
  const kindByKey: Record<string, EditableTableColumnKind> = {};
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
    labelToKey[label] = key;
    keyToLabel[key] = label;
    kindByKey[key] = kind;
  });

  return {
    labelToKey,
    keyToLabel,
    orderedKeys,
    kindByKey
  };
};

const buildPipelineFieldDefinitions = (
  settings: Settings,
  projection: TrackerColumnProjection,
  applications: Application[]
): PipelineFieldDefinition[] => {
  const customProps = normalizeCustomProperties(settings.custom_properties);
  const customPropByKey = new Map(customProps.map((prop) => [prop.key, prop]));

  return projection.orderedKeys
    .map((key) => {
      const kind = projection.kindByKey[key];
      const label = projection.keyToLabel[key] || key;
      const customPropertyKey = key.startsWith("prop__") ? key.slice("prop__".length) : undefined;
      let options: string[] = [];

      if (kind === "select") {
        const coreSelectConfig = getCoreSelectFieldConfig(key);
        if (coreSelectConfig) {
          options = normalizeStringArray(settings[coreSelectConfig.listKey]);
        } else if (customPropertyKey) {
          const prop = customPropByKey.get(customPropertyKey) || null;
          if (prop?.type === "select") {
            options = prop.options
              .map((option) => normalizeString(option.label))
              .filter(Boolean);
          }
        }

        if (options.length === 0) {
          const fromRows = Array.from(
            new Set(
              applications
                .map((app) => normalizeString(readGroupValue(app, key)))
                .filter(Boolean)
            )
          );
          options = fromRows;
        }
      }

      return {
        key,
        label,
        kind,
        options,
        customPropertyKey
      };
    });
};

const buildPipelineGroupingConfig = (
  blockProps: Record<string, unknown>,
  settings: Settings,
  applications: Application[],
  tableTargets: BlockTargetSnapshot[],
  preferredSourceKey?: string | null
): PipelineGroupingConfig => {
  let sourceKey = "stage";
  let baseValues = normalizeStringArray(settings.stages);
  let colors: Record<string, string> = settings.stage_colors || {};
  let allowColumnReorder = true;

  const applySourceVisuals = (nextSourceKey: string) => {
    sourceKey = nextSourceKey;
    allowColumnReorder = sourceKey === "stage";
    if (sourceKey === "stage") {
      baseValues = normalizeStringArray(settings.stages);
      colors = settings.stage_colors || {};
      return;
    }
    if (sourceKey === "outcome") {
      baseValues = normalizeStringArray(settings.outcomes);
      colors = settings.outcome_colors || {};
      return;
    }
    if (sourceKey === "job_type") {
      baseValues = normalizeStringArray(settings.job_types);
      colors = settings.job_type_colors || {};
      return;
    }
    if (sourceKey.startsWith("prop__")) {
      const propertyKey = sourceKey.slice("prop__".length);
      const customProp =
        settings.custom_properties.find((prop) => prop.key === propertyKey && prop.type === "select") || null;
      baseValues = customProp
        ? customProp.options
            .map((option) => normalizeString(option.label))
            .filter(Boolean)
        : [];
      colors = customProp
        ? Object.fromEntries(
            customProp.options
              .map((option) => [normalizeString(option.label), normalizeString(option.color) || DEFAULT_COLUMN_COLOR])
              .filter(([label]) => Boolean(label))
          )
        : {};
      return;
    }
    baseValues = [];
    colors = {};
  };

  const linkedTableId = getBlockLink(blockProps, PIPELINE_SOURCE_TABLE_LINK_KEY);
  const sourceColumn = normalizeString(blockProps.sourceColumn);
  const pipelineGraph = buildBlockGraph(settings);
  const linkedTableTarget = resolveBlock(pipelineGraph, linkedTableId);
  let hasLinkedSourceOverride = false;

  if (linkedTableTarget && sourceColumn && isTrackerSourceTarget(linkedTableTarget)) {
    const projection = buildTrackerColumnProjection(settings, linkedTableTarget.props);
    const resolvedKey = projection.labelToKey[sourceColumn];
    if (resolvedKey && projection.kindByKey[resolvedKey] === "select") {
      applySourceVisuals(resolvedKey);
      hasLinkedSourceOverride = true;
    }
  }

  const selectableKeys = new Set<string>(["stage", "outcome", "job_type"]);
  (settings.custom_properties || []).forEach((prop) => {
    if (prop.type === "select") {
      selectableKeys.add(`prop__${prop.key}`);
    }
  });

  if (!hasLinkedSourceOverride && preferredSourceKey && selectableKeys.has(preferredSourceKey)) {
    applySourceVisuals(preferredSourceKey);
  }

  const values: string[] = [];
  const seen = new Set<string>();
  const pushValue = (value: string) => {
    const normalized = normalizeString(value);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    values.push(normalized);
  };

  baseValues.forEach(pushValue);

  let hasEmptyValues = false;
  applications.forEach((app) => {
    const value = normalizeString(readGroupValue(app, sourceKey));
    if (!value) {
      hasEmptyValues = true;
      return;
    }
    pushValue(value);
  });

  if (hasEmptyValues) {
    pushValue("");
  }

  if (values.length === 0) {
    values.push("");
  }

  return {
    key: sourceKey,
    values,
    colors,
    allowColumnReorder
  };
};

const PipelinePage: React.FC = () => {
  const { t } = useI18n();
  const { applications, settings, updateApplication, saveSettings, refresh } = useAppData();
  const { executeCommand } = useUndo();
  const [columnDragOver, setColumnDragOver] = useState<string | null>(null);
  const [draggedApp, setDraggedApp] = useState<{ id: number; columnValue: string } | null>(null);
  const [dragOverAppId, setDragOverAppId] = useState<number | null>(null);
  const [dragOverAppColumn, setDragOverAppColumn] = useState<string | null>(null);
  const [activeAppId, setActiveAppId] = useState<number | null>(null);
  const [fieldMenuOpen, setFieldMenuOpen] = useState<string | null>(null);
  const [fieldMenuPos, setFieldMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [fieldMenuView, setFieldMenuView] = useState<"root" | "type">("root");
  const draggedColumnRef = useRef<string | null>(null);
  const draggedAppRef = useRef<{ id: number; columnValue: string } | null>(null);
  const fieldMenuRef = useRef<HTMLDivElement | null>(null);

  if (!settings) {
    return <div className="empty">{t("Loading settings...")}</div>;
  }

  const tableTargets = useMemo(
    () => collectEditableTableTargets(settings, { excludeVariants: ["todo"], excludeTypes: ["todoTable"] }),
    [settings]
  );

  const trackerProjection = useMemo(() => buildTrackerColumnProjection(settings, {}), [settings]);

  const pipelineFields = useMemo(
    () => buildPipelineFieldDefinitions(settings, trackerProjection, applications),
    [applications, settings, trackerProjection]
  );

  const fieldByKey = useMemo(
    () => new Map(pipelineFields.map((field) => [field.key, field])),
    [pipelineFields]
  );

  const selectablePipelineFields = useMemo(
    () => pipelineFields.filter((field) => field.kind === "select"),
    [pipelineFields]
  );

  const resolvedCardConfig = useMemo<ResolvedPipelineCardConfig>(() => {
    const rawConfig = isRecord(settings.pipeline_card_config)
      ? (settings.pipeline_card_config as Record<string, unknown>)
      : {};

    const defaultPipelineField =
      selectablePipelineFields.find((field) => field.key === "stage")?.key ||
      selectablePipelineFields[0]?.key ||
      "stage";

    const pipelineField =
      typeof rawConfig.pipeline_field === "string" &&
      selectablePipelineFields.some((field) => field.key === rawConfig.pipeline_field)
        ? rawConfig.pipeline_field
        : defaultPipelineField;

    const defaultTitleColumn = fieldByKey.has(DEFAULT_TITLE_COLUMN)
      ? DEFAULT_TITLE_COLUMN
      : pipelineFields[0]?.key || DEFAULT_TITLE_COLUMN;

    const titleColumn =
      typeof rawConfig.title_column === "string" && fieldByKey.has(rawConfig.title_column)
        ? rawConfig.title_column
        : defaultTitleColumn;

    const requestedVisibleFields = Array.isArray(rawConfig.visible_fields)
      ? rawConfig.visible_fields
          .map((entry) => (typeof entry === "string" ? entry : ""))
          .filter((entry) => Boolean(entry) && fieldByKey.has(entry))
      : [];

    const fallbackVisible = DEFAULT_VISIBLE_FIELDS.filter((key) => fieldByKey.has(key));
    const normalizedVisible = (requestedVisibleFields.length > 0 ? requestedVisibleFields : fallbackVisible)
      .filter((value, index, source) => source.indexOf(value) === index)
      .filter((value) => value !== titleColumn);

    return {
      pipelineField,
      titleColumn,
      visibleFields: normalizedVisible
    };
  }, [fieldByKey, pipelineFields, selectablePipelineFields, settings.pipeline_card_config]);

  const activeApp = useMemo(
    () => (activeAppId === null ? null : applications.find((app) => app.id === activeAppId) || null),
    [activeAppId, applications]
  );

  const addableVisibleFields = useMemo(
    () =>
      pipelineFields.filter(
        (field) =>
          field.key !== resolvedCardConfig.titleColumn &&
          !resolvedCardConfig.visibleFields.includes(field.key)
      ),
    [pipelineFields, resolvedCardConfig.titleColumn, resolvedCardConfig.visibleFields]
  );

  const activeEditorFields = useMemo(() => {
    return resolvedCardConfig.visibleFields
      .filter((value, index, source) => source.indexOf(value) === index)
      .map((key) => fieldByKey.get(key) || null)
      .filter((field): field is PipelineFieldDefinition => Boolean(field));
  }, [fieldByKey, resolvedCardConfig.visibleFields]);

  const compactTextFieldByKey = useMemo<Record<string, boolean>>(() => {
    const next: Record<string, boolean> = {};

    activeEditorFields.forEach((field) => {
      if (field.kind !== "text") return;

      let maxLength = 0;
      let hasLineBreak = false;

      applications.forEach((app) => {
        const raw = readFieldRawValue(app, field.key);
        if (raw === null || raw === undefined) return;
        const text = String(raw);
        if (!text) return;
        if (text.includes("\n")) hasLineBreak = true;
        const normalizedLength = text.trim().length;
        if (normalizedLength > maxLength) {
          maxLength = normalizedLength;
        }
      });

      next[field.key] = !hasLineBreak && maxLength <= COMPACT_TEXT_MAX_CHARS;
    });

    return next;
  }, [activeEditorFields, applications]);

  const persistPipelineCardConfig = useCallback(
    async (patch: Partial<PipelineCardConfig>) => {
      const current = isRecord(settings.pipeline_card_config)
        ? (settings.pipeline_card_config as PipelineCardConfig)
        : {};
      const nextConfig: PipelineCardConfig = {
        ...current,
        ...patch
      };
      await saveSettings({ pipeline_card_config: nextConfig } as Partial<Settings>);
    },
    [saveSettings, settings.pipeline_card_config]
  );

  const handlePipelineFieldChange = useCallback(
    async (nextField: string) => {
      if (!nextField || nextField === resolvedCardConfig.pipelineField) return;
      await persistPipelineCardConfig({ pipeline_field: nextField });
    },
    [persistPipelineCardConfig, resolvedCardConfig.pipelineField]
  );

  const handleTitleColumnChange = useCallback(
    async (nextField: string) => {
      if (!nextField || nextField === resolvedCardConfig.titleColumn) return;
      const nextVisible = resolvedCardConfig.visibleFields.filter((value) => value !== nextField);
      await persistPipelineCardConfig({
        title_column: nextField,
        visible_fields: nextVisible
      });
    },
    [persistPipelineCardConfig, resolvedCardConfig.titleColumn, resolvedCardConfig.visibleFields]
  );

  const handleAddVisibleField = useCallback(async () => {
    const selectedFieldToAdd = addableVisibleFields[0]?.key || "";
    if (!selectedFieldToAdd) return;
    if (resolvedCardConfig.visibleFields.includes(selectedFieldToAdd)) return;
    await persistPipelineCardConfig({
      visible_fields: [...resolvedCardConfig.visibleFields, selectedFieldToAdd]
    });
  }, [addableVisibleFields, persistPipelineCardConfig, resolvedCardConfig.visibleFields]);

  const handleVisibleFieldReorder = useCallback(
    async (fromFieldKey: string, toFieldKey: string) => {
      if (!fromFieldKey || !toFieldKey || fromFieldKey === toFieldKey) return;
      const nextVisible = [...resolvedCardConfig.visibleFields];
      const fromIndex = nextVisible.indexOf(fromFieldKey);
      const toIndex = nextVisible.indexOf(toFieldKey);
      if (fromIndex < 0 || toIndex < 0) return;
      nextVisible.splice(fromIndex, 1);
      nextVisible.splice(toIndex, 0, fromFieldKey);
      await persistPipelineCardConfig({ visible_fields: nextVisible });
    },
    [persistPipelineCardConfig, resolvedCardConfig.visibleFields]
  );

  const closeFieldMenu = useCallback(() => {
    setFieldMenuOpen(null);
    setFieldMenuPos(null);
    setFieldMenuView("root");
  }, []);

  const openFieldMenu = useCallback(
    (fieldKey: string, event: React.MouseEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const target = event.currentTarget;
      const rect = target.getBoundingClientRect();
      const menuWidth = 220;
      const menuHeight = 200;

      let left = rect.left;
      if (left + menuWidth > window.innerWidth) {
        left = window.innerWidth - menuWidth - 10;
      }

      let top = rect.bottom + 4;
      if (top + menuHeight > window.innerHeight) {
        top = rect.top - menuHeight - 4;
      }

      setFieldMenuPos({ top, left });
      setFieldMenuOpen(fieldKey);
      setFieldMenuView("root");
    },
    []
  );

  const hideField = useCallback(
    async (fieldKey: string) => {
      if (!fieldKey) return;
      if (!resolvedCardConfig.visibleFields.includes(fieldKey)) {
        closeFieldMenu();
        return;
      }
      await persistPipelineCardConfig({
        visible_fields: resolvedCardConfig.visibleFields.filter((value) => value !== fieldKey)
      });
      closeFieldMenu();
    },
    [closeFieldMenu, persistPipelineCardConfig, resolvedCardConfig.visibleFields]
  );

  const changeCustomFieldType = useCallback(
    async (propKey: string, newKind: CustomPropertyTypeKind) => {
      if (!propKey) return;
      const customProps = Array.isArray(settings.custom_properties) ? settings.custom_properties : [];
      let changed = false;
      const nextCustomProps = customProps.map((prop) => {
        if (prop.key !== propKey) return prop;
        if (prop.type === newKind) return prop;
        changed = true;
        return {
          ...prop,
          type: newKind,
          options: newKind === "select" ? prop.options : []
        };
      });

      if (changed) {
        await saveSettings({
          custom_properties: nextCustomProps
        });
      }
      closeFieldMenu();
    },
    [closeFieldMenu, saveSettings, settings.custom_properties]
  );

  const deleteCustomField = useCallback(
    async (fieldKey: string, propKey: string) => {
      if (!propKey) return;
      const fieldLabel = fieldByKey.get(fieldKey)?.label || fieldKey;
      const confirmed = await confirmDialog({
        title: "Eliminar campo",
        message: `¿Eliminar el campo "${fieldLabel}"?`,
        confirmLabel: "Eliminar",
        cancelLabel: "Cancelar",
        tone: "danger"
      });
      if (!confirmed) return;

      const customProps = Array.isArray(settings.custom_properties) ? settings.custom_properties : [];
      const nextCustomProps = customProps.filter((prop) => prop.key !== propKey);
      if (nextCustomProps.length === customProps.length) {
        closeFieldMenu();
        return;
      }

      const currentConfig = isRecord(settings.pipeline_card_config)
        ? (settings.pipeline_card_config as PipelineCardConfig)
        : {};
      const nextVisible = resolvedCardConfig.visibleFields.filter((value) => value !== fieldKey);
      const nextTitle =
        resolvedCardConfig.titleColumn === fieldKey
          ? pipelineFields.find((field) => field.key !== fieldKey)?.key || DEFAULT_TITLE_COLUMN
          : resolvedCardConfig.titleColumn;

      await saveSettings({
        custom_properties: nextCustomProps,
        pipeline_card_config: {
          ...currentConfig,
          title_column: nextTitle,
          visible_fields: nextVisible
        }
      });
      closeFieldMenu();
    },
    [
      closeFieldMenu,
      fieldByKey,
      pipelineFields,
      resolvedCardConfig.titleColumn,
      resolvedCardConfig.visibleFields,
      saveSettings,
      settings.custom_properties,
      settings.pipeline_card_config
    ]
  );

  const fieldMenuField = useMemo(
    () => (fieldMenuOpen ? fieldByKey.get(fieldMenuOpen) || null : null),
    [fieldByKey, fieldMenuOpen]
  );
  const fieldMenuCustomPropertyKey = fieldMenuField?.customPropertyKey || "";
  const fieldMenuCanEditType = Boolean(fieldMenuCustomPropertyKey);
  const fieldMenuCanDelete = fieldMenuCanEditType;

  useEffect(() => {
    if (!fieldMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (fieldMenuRef.current && !fieldMenuRef.current.contains(event.target as Node)) {
        closeFieldMenu();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeFieldMenu();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [closeFieldMenu, fieldMenuOpen]);

  const closeCardEditor = useCallback(() => {
    setActiveAppId(null);
    closeFieldMenu();
  }, [closeFieldMenu]);

  const updateApplicationField = useCallback(
    async (app: Application, key: string, nextRawValue: unknown) => {
      const nextPayload = buildApplicationFieldPayload(app, key, nextRawValue);
      const previousRawValue = readFieldRawValue(app, key);
      const previousPayload = buildApplicationFieldPayload(app, key, previousRawValue);
      const label = fieldByKey.get(key)?.label || key;

      await executeCommand({
        description: `Actualizar ${label}`,
        async do() {
          await updateApplication(app.id, nextPayload);
        },
        async undo() {
          await updateApplication(app.id, previousPayload);
        }
      });
    },
    [executeCommand, fieldByKey, updateApplication]
  );

  const persistSelectOptionsForField = useCallback(
    async (field: PipelineFieldDefinition, nextOptions: SelectOption[]) => {
      const normalized = normalizeEditableSelectOptions(nextOptions);
      const nextLabels = normalized.map((option) => option.label);

      const coreSelectConfig = getCoreSelectFieldConfig(field.key);
      if (coreSelectConfig) {
        const prevColors = (settings[coreSelectConfig.colorKey] as Record<string, string> | undefined) || {};
        const nextColors: Record<string, string> = {};
        normalized.forEach((option) => {
          nextColors[option.label] = option.color || prevColors[option.label] || DEFAULT_COLUMN_COLOR;
        });
        await saveSettings({
          [coreSelectConfig.listKey]: nextLabels,
          [coreSelectConfig.colorKey]: nextColors
        } as Partial<Settings>);
        return;
      }

      if (field.customPropertyKey) {
        const propKey = field.customPropertyKey;
        const customProps = Array.isArray(settings.custom_properties) ? settings.custom_properties : [];
        let changed = false;
        const nextCustomProps = customProps.map((prop) => {
          if (prop.key !== propKey || prop.type !== "select") return prop;
          changed = true;
          return {
            ...prop,
            options: normalized.map((option) => ({
              label: option.label,
              color: option.color || DEFAULT_COLUMN_COLOR
            }))
          };
        });
        if (changed) {
          await saveSettings({
            custom_properties: nextCustomProps
          });
        }
      }
    },
    [
      saveSettings,
      settings.custom_properties,
      settings.job_type_colors,
      settings.outcome_colors,
      settings.stage_colors
    ]
  );

  const renderFieldDisplayValue = useCallback(
    (app: Application, field: PipelineFieldDefinition) => {
      const raw = readFieldRawValue(app, field.key);
      if (field.kind === "rating") {
        return (
          <StarRating
            value={toNumberOrNull(raw)}
            size="sm"
            step={0.5}
            readonly
          />
        );
      }
      if (field.kind === "checkbox") {
        return <span>{raw ? t("Yes") : t("No")}</span>;
      }
      if (field.kind === "date") {
        const value = typeof raw === "string" ? raw : raw ? String(raw) : "";
        return <DateValueDisplay value={value} allowTime />;
      }
      if (field.kind === "contacts") {
        if (Array.isArray(raw)) {
          return <span>{raw.length} contacts</span>;
        }
        if (typeof raw === "string" && raw.trim()) {
          return <span>{parseContactsPropValue(raw).length} contacts</span>;
        }
      }
      if (field.kind === "links") {
        if (typeof raw === "string" && raw.trim()) {
          return <span>{parseLinksPropValue(raw).length} links</span>;
        }
      }
      if (field.kind === "todo") {
        const todos = parseTodoItemsValue(raw);
        const pending = todos.filter((item) => normalizeString(item.status).toLowerCase() !== "done").length;
        return <span>{pending} pending</span>;
      }
      if (field.kind === "documents") {
        if (typeof raw === "string" && raw.trim()) {
          return <span>{parseDocumentsPropValue(raw).length} files</span>;
        }
        if (Array.isArray(raw)) {
          return <span>{raw.length} files</span>;
        }
      }
      const text = raw === null || raw === undefined || raw === "" ? "—" : String(raw);
      return <span>{text}</span>;
    },
    [t]
  );

  const selectOptionsByFieldKey = useMemo<Record<string, SelectOption[]>>(() => {
    const customProps = normalizeCustomProperties(settings.custom_properties);
    const customPropByKey = new Map(customProps.map((prop) => [prop.key, prop]));
    const next: Record<string, SelectOption[]> = {};

    pipelineFields.forEach((field) => {
      if (field.kind !== "select") return;

      const options: SelectOption[] = [{ label: "", display: "—", editable: false }];

      const coreSelectConfig = getCoreSelectFieldConfig(field.key);
      if (coreSelectConfig) {
        const labels = normalizeStringArray(settings[coreSelectConfig.listKey]);
        const colors = (settings[coreSelectConfig.colorKey] as Record<string, string> | undefined) || {};
        labels.forEach((label) => {
          options.push({
            label,
            color: colors[label] || DEFAULT_COLUMN_COLOR
          });
        });
      } else if (field.customPropertyKey) {
        const prop = customPropByKey.get(field.customPropertyKey);
        if (prop?.type === "select") {
          prop.options.forEach((option) => {
            const label = normalizeString(option.label);
            if (!label) return;
            options.push({
              label,
              color: normalizeString(option.color) || DEFAULT_COLUMN_COLOR
            });
          });
        }
      } else {
        field.options.forEach((label) => {
          const normalized = normalizeString(label);
          if (!normalized) return;
          options.push({
            label: normalized,
            color: DEFAULT_COLUMN_COLOR
          });
        });
      }

      const deduped: SelectOption[] = [];
      const seenLabels = new Set<string>();
      options.forEach((option) => {
        if (seenLabels.has(option.label)) return;
        seenLabels.add(option.label);
        deduped.push(option);
      });
      next[field.key] = deduped;
    });

    return next;
  }, [
    pipelineFields,
    settings.custom_properties,
    settings.job_type_colors,
    settings.job_types,
    settings.outcome_colors,
    settings.outcomes,
    settings.stage_colors,
    settings.stages
  ]);

  const expandedEditorRows = useMemo<ExpandedFieldRow[]>(() => {
    if (!activeApp) return [];

    return activeEditorFields.map((field) => {
      const currentValue = readFieldRawValue(activeApp, field.key);
      const selectOptions = [...(selectOptionsByFieldKey[field.key] || [{ label: "", display: "—", editable: false }])];
      if (
        currentValue !== null &&
        currentValue !== undefined &&
        field.kind === "select" &&
        String(currentValue).trim() &&
        !selectOptions.some((option) => option.label === String(currentValue))
      ) {
        selectOptions.push({
          label: String(currentValue),
          color: DEFAULT_COLUMN_COLOR
        });
      }

      const isCustomPropertyField = Boolean(field.customPropertyKey);
      const customRaw = isCustomPropertyField
        ? typeof currentValue === "string"
          ? currentValue
          : currentValue === null || currentValue === undefined
            ? ""
            : String(currentValue)
        : "";

      let renderedValue: React.ReactNode = (
        <TypologyFieldControl
          kind={field.kind}
          fieldKey={field.key}
          value={currentValue}
          enabledLabel={t("Enabled")}
          selectOptions={selectOptions}
          onCreateSelectOption={
            field.kind === "select"
              ? async (label) => {
                  const trimmed = normalizeString(label);
                  if (!trimmed) return null;
                  const normalizedOptions = normalizeEditableSelectOptions(selectOptions);
                  const existing = normalizedOptions.find(
                    (option) => option.label.toLowerCase() === trimmed.toLowerCase()
                  );
                  if (existing) return existing.label;
                  await persistSelectOptionsForField(field, [
                    ...normalizedOptions,
                    { label: trimmed, color: DEFAULT_COLUMN_COLOR, editable: true }
                  ]);
                  return trimmed;
                }
              : undefined
          }
          onUpdateSelectOptionColor={
            field.kind === "select"
              ? async (label, color) => {
                  const normalizedOptions = normalizeEditableSelectOptions(selectOptions).map((option) =>
                    option.label === label ? { ...option, color } : option
                  );
                  await persistSelectOptionsForField(field, normalizedOptions);
                }
              : undefined
          }
          onDeleteSelectOption={
            field.kind === "select"
              ? async (label) => {
                  const normalizedOptions = normalizeEditableSelectOptions(selectOptions).filter(
                    (option) => option.label !== label
                  );
                  await persistSelectOptionsForField(field, normalizedOptions);
                }
              : undefined
          }
          onReorderSelectOption={
            field.kind === "select"
              ? async (fromLabel, toLabel) => {
                  const normalizedOptions = normalizeEditableSelectOptions(selectOptions);
                  const labels = normalizedOptions.map((option) => option.label);
                  const reorderedLabels = reorderList(labels, fromLabel, toLabel);
                  if (reorderedLabels === labels) return;
                  const byLabel = new Map(normalizedOptions.map((option) => [option.label, option]));
                  const reordered = reorderedLabels
                    .map((label) => byLabel.get(label))
                    .filter((option): option is SelectOption => Boolean(option));
                  await persistSelectOptionsForField(field, reordered);
                }
              : undefined
          }
          isLongText={LONG_TEXT_KEYS.has(field.key)}
          preferMultilineText={field.kind === "text" ? !compactTextFieldByKey[field.key] : undefined}
          onCommit={(nextValue) => {
            void updateApplicationField(activeApp, field.key, nextValue);
          }}
        />
      );

      if (field.kind === "contacts") {
        const contactsValue: Contact[] = isCustomPropertyField
          ? parseContactsPropValue(customRaw)
          : Array.isArray(currentValue)
            ? (currentValue as Contact[])
            : [];
        renderedValue = (
          <ContactsCell
            contacts={contactsValue}
            onCommit={(nextContacts) => {
              if (isCustomPropertyField) {
                void updateApplicationField(
                  activeApp,
                  field.key,
                  nextContacts.length === 0 ? "" : JSON.stringify(nextContacts)
                );
                return;
              }
              void updateApplicationField(activeApp, field.key, nextContacts);
            }}
          />
        );
      } else if (field.kind === "links") {
        const linksValue: LinkItem[] = parseLinksPropValue(
          isCustomPropertyField ? customRaw : typeof currentValue === "string" ? currentValue : ""
        );
        renderedValue = (
          <LinksCell
            links={linksValue}
            onCommit={(nextLinks) => {
              if (isCustomPropertyField) {
                void updateApplicationField(
                  activeApp,
                  field.key,
                  nextLinks.length === 0 ? "" : JSON.stringify(nextLinks)
                );
                return;
              }
              void updateApplicationField(
                activeApp,
                field.key,
                nextLinks.length === 0 ? "" : JSON.stringify(nextLinks)
              );
            }}
          />
        );
      } else if (field.kind === "todo") {
        const todoValue: TodoItem[] = parseTodoItemsValue(
          isCustomPropertyField ? customRaw : currentValue
        );
        renderedValue = (
          <TodoItemsCell
            items={todoValue}
            onCommit={(nextTodoItems) => {
              if (isCustomPropertyField) {
                void updateApplicationField(
                  activeApp,
                  field.key,
                  nextTodoItems.length === 0 ? "" : JSON.stringify(nextTodoItems)
                );
                return;
              }
              void updateApplicationField(activeApp, field.key, nextTodoItems);
            }}
          />
        );
      } else if (field.kind === "documents" && isCustomPropertyField) {
        const selectedIds = parseDocumentsPropValue(customRaw);
        const files = activeApp.documents_files || [];
        renderedValue = (
          <DocumentsPropertyCell
            files={files}
            selectedIds={selectedIds}
            onCommit={(nextIds) => {
              void updateApplicationField(
                activeApp,
                field.key,
                nextIds.length === 0 ? "" : JSON.stringify(nextIds)
              );
            }}
            onDeleteFile={async (file) => {
              try {
                await deleteDocument(activeApp.id, file.id);
                await refresh();
                return true;
              } catch {
                return false;
              }
            }}
            onOpenFile={(file) => {
              void openExternal(documentDownloadUrl(activeApp.id, file.id));
            }}
            onUploadAndAttach={async (filesToUpload, signal) => {
              if (!filesToUpload || filesToUpload.length === 0) return;
              const before = new Set((activeApp.documents_files || []).map((file) => file.id));
              const uploaded = await uploadDocuments(activeApp.id, filesToUpload, signal);
              const after = uploaded.documents_files || [];
              const newIds = after.map((file) => file.id).filter((id) => !before.has(id));
              const merged = Array.from(new Set([...selectedIds, ...newIds]));
              await updateApplicationField(
                activeApp,
                field.key,
                merged.length === 0 ? "" : JSON.stringify(merged)
              );
              await refresh();
            }}
          />
        );
      }

      return {
        key: field.key,
        label: field.label,
        canReorder: true,
        dragAriaLabel: t("Reorder field {field}", { field: field.label }),
        onLabelClick: (event) => {
          openFieldMenu(field.key, event);
        },
        value: renderedValue
      };
    });
  }, [
    activeApp,
    activeEditorFields,
    compactTextFieldByKey,
    openFieldMenu,
    persistSelectOptionsForField,
    refresh,
    selectOptionsByFieldKey,
    t,
    updateApplicationField
  ]);

  const resetColumnDrag = () => {
    draggedColumnRef.current = null;
    setColumnDragOver(null);
  };

  const resetAppDrag = () => {
    draggedAppRef.current = null;
    setDraggedApp(null);
    setDragOverAppId(null);
    setDragOverAppColumn(null);
  };

  const syncStageOrder = async (stage: string, ordered: Application[]) => {
    const updates = ordered
      .map((app, index) => {
        const payload: Partial<ApplicationInput> = {};
        if (app.pipeline_order !== index) {
          payload.pipeline_order = index;
        }
        if (app.stage !== stage) {
          payload.stage = stage;
        }
        if (Object.keys(payload).length === 0) return null;
        return { id: app.id, payload, previous: { pipeline_order: app.pipeline_order, stage: app.stage } };
      })
      .filter(Boolean) as { id: number; payload: Partial<ApplicationInput>; previous: Partial<Application> }[];
    if (updates.length === 0) return;

    await executeCommand({
      description: `Reordenar ${updates.length} aplicación${updates.length > 1 ? "es" : ""} en ${stage}`,
      async do() {
        await Promise.all(updates.map(({ id, payload }) => updateApplication(id, payload)));
      },
      async undo() {
        await Promise.all(updates.map(({ id, previous }) => updateApplication(id, previous)));
      }
    });
  };

  const resolvePipelineSlot: BlockSlotResolver = (slotId, block) => {
    if (slotId !== "pipeline:board:content") return null;

    const blockProps = isRecord(block.props) ? block.props : {};
    const grouping = buildPipelineGroupingConfig(
      blockProps,
      settings,
      applications,
      tableTargets,
      resolvedCardConfig.pipelineField
    );
    const columns = grouping.values;

    const getColumnItems = (columnValue: string) => {
      const items = applications.filter((app) => normalizeString(readGroupValue(app, grouping.key)) === columnValue);
      if (grouping.key !== "stage") return items;

      const fullyOrdered =
        items.length > 0 &&
        items.every((app) => app.pipeline_order !== null && app.pipeline_order !== undefined);
      if (!fullyOrdered) return items;
      return [...items]
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
          const aOrder = a.item.pipeline_order ?? 0;
          const bOrder = b.item.pipeline_order ?? 0;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return a.index - b.index;
        })
        .map(({ item }) => item);
    };

    const reorderableStages = normalizeStringArray(settings.stages);
    const reorderableStageSet = new Set(reorderableStages);

    const handleColumnDrop = async (targetColumn: string) => {
      if (!grouping.allowColumnReorder || grouping.key !== "stage") {
        resetColumnDrag();
        return;
      }
      const fromColumn = draggedColumnRef.current;
      if (!fromColumn || fromColumn === targetColumn) {
        resetColumnDrag();
        return;
      }
      if (!reorderableStageSet.has(fromColumn) || !reorderableStageSet.has(targetColumn)) {
        resetColumnDrag();
        return;
      }
      const previousStages = [...reorderableStages];
      const nextStages = reorderList(reorderableStages, fromColumn, targetColumn);
      if (nextStages !== reorderableStages) {
        await executeCommand({
          description: `Reordenar columna ${fromColumn}`,
          async do() {
            await saveSettings({ stages: nextStages });
          },
          async undo() {
            await saveSettings({ stages: previousStages });
          }
        });
      }
      resetColumnDrag();
    };

    const handleAppDrop = async (targetColumn: string, targetId: number | null) => {
      const dragged = draggedAppRef.current;
      if (!dragged) return;
      const { id: draggedId, columnValue: sourceColumn } = dragged;
      if (targetId === draggedId) {
        resetAppDrag();
        return;
      }

      const draggedItem = applications.find((app) => app.id === draggedId);
      if (!draggedItem) {
        resetAppDrag();
        return;
      }

      if (grouping.key === "stage") {
        const sourceItems = getColumnItems(sourceColumn);
        const targetItems = sourceColumn === targetColumn ? sourceItems : getColumnItems(targetColumn);
        const sourceWithout = sourceItems.filter((item) => item.id !== draggedId);
        const insertionBase = sourceColumn === targetColumn ? sourceWithout : targetItems;
        let insertIndex = targetId
          ? insertionBase.findIndex((item) => item.id === targetId)
          : insertionBase.length;
        if (insertIndex < 0) insertIndex = insertionBase.length;

        const nextTarget = [...insertionBase];
        nextTarget.splice(insertIndex, 0, draggedItem);

        if (sourceColumn === targetColumn) {
          await syncStageOrder(targetColumn, nextTarget);
        } else {
          await Promise.all([
            syncStageOrder(targetColumn, nextTarget),
            syncStageOrder(sourceColumn, sourceWithout)
          ]);
        }
      } else {
        const currentValue = normalizeString(readGroupValue(draggedItem, grouping.key));
        if (currentValue !== targetColumn) {
          await updateApplication(draggedItem.id, buildGroupUpdatePayload(draggedItem, grouping.key, targetColumn));
        }
      }

      resetAppDrag();
    };

    const moveAppToColumn = async (app: Application, targetColumn: string) => {
      const previousValue = grouping.key === "stage" ? app.stage : readGroupValue(app, grouping.key);
      const payload =
        grouping.key === "stage"
          ? { stage: targetColumn }
          : buildGroupUpdatePayload(app, grouping.key, targetColumn);

      await executeCommand({
        description: `Mover ${app.company_name || "aplicación"} a ${targetColumn}`,
        async do() {
          await updateApplication(app.id, payload);
        },
        async undo() {
          const undoPayload =
            grouping.key === "stage"
              ? { stage: previousValue }
              : buildGroupUpdatePayload(app, grouping.key, previousValue);
          await updateApplication(app.id, undoPayload);
        }
      });
    };

    return (
      <>
        <div className="pipeline-grid">
          {columns.map((column) => {
            const items = getColumnItems(column);
            const canDragColumn = grouping.allowColumnReorder && reorderableStageSet.has(column);
            const isColumnDragOver = columnDragOver === column;
            const isAppDrop = Boolean(draggedApp && dragOverAppColumn === column);
            const columnLabel = column || "Sin valor";
            const columnColor = column ? grouping.colors[column] || DEFAULT_COLUMN_COLOR : DEFAULT_COLUMN_COLOR;

            return (
              <div
                key={`${grouping.key}:${column || "empty"}`}
                className={`pipeline-column${isColumnDragOver ? " stage-drag-over" : ""}${
                  isAppDrop ? " app-drop" : ""
                }`}
              >
                <div
                  className={`pipeline-header${canDragColumn ? " draggable" : ""}`}
                  draggable={canDragColumn && !draggedApp}
                  onDragStart={(event) => {
                    if (!canDragColumn || draggedAppRef.current) return;
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", column);
                    draggedColumnRef.current = column;
                  }}
                  onDragOver={(event) => {
                    const currentDraggedColumn = draggedColumnRef.current;
                    const currentDraggedApp = draggedAppRef.current;
                    if (canDragColumn && currentDraggedColumn && currentDraggedColumn !== column) {
                      event.preventDefault();
                      setColumnDragOver(column);
                      return;
                    }
                    if (currentDraggedApp) {
                      event.preventDefault();
                      setDragOverAppColumn(column);
                      setDragOverAppId(null);
                    }
                  }}
                  onDragLeave={() => {
                    if (columnDragOver === column) setColumnDragOver(null);
                  }}
                  onDrop={(event) => {
                    const currentDraggedColumn = draggedColumnRef.current;
                    const currentDraggedApp = draggedAppRef.current;
                    if (canDragColumn && currentDraggedColumn && currentDraggedColumn !== column) {
                      event.preventDefault();
                      void handleColumnDrop(column);
                      return;
                    }
                    if (currentDraggedApp) {
                      event.preventDefault();
                      void handleAppDrop(column, null);
                    }
                  }}
                  onDragEnd={() => {
                    resetColumnDrag();
                  }}
                >
                  <div className="pipeline-header-title">
                    <span className="pipeline-drag-handle" aria-hidden="true" />
                    <span className="tag" style={{ background: columnColor }}>
                      {columnLabel}
                    </span>
                  </div>
                  <span>{items.length}</span>
                </div>
                <div
                  className="pipeline-cards"
                  onDragOver={(event) => {
                    if (!draggedAppRef.current) return;
                    event.preventDefault();
                    setDragOverAppColumn(column);
                    setDragOverAppId(null);
                  }}
                  onDrop={(event) => {
                    if (!draggedAppRef.current) return;
                    event.preventDefault();
                    void handleAppDrop(column, null);
                  }}
                >
                  {items.length === 0 && <div className="empty">{t("No items")}</div>}
                  {items.map((app) => {
                    const followupState = followupStatus(app.followup_date);
                    const currentValue = normalizeString(readGroupValue(app, grouping.key));
                    const currentIndex = columns.indexOf(currentValue);
                    const leftColumn = currentIndex > 0 ? columns[currentIndex - 1] : null;
                    const rightColumn =
                      currentIndex >= 0 && currentIndex < columns.length - 1
                        ? columns[currentIndex + 1]
                        : null;

                    const titleField = fieldByKey.get(resolvedCardConfig.titleColumn) || null;
                    const titleRawValue = titleField
                      ? readFieldRawValue(app, titleField.key)
                      : app.company_name;
                    const titleValue =
                      titleRawValue === null || titleRawValue === undefined || String(titleRawValue).trim() === ""
                        ? t("Untitled")
                        : String(titleRawValue);
                    const subtitle =
                      resolvedCardConfig.titleColumn === "company_name"
                        ? app.position || ""
                        : app.company_name || "";

                    return (
                      <div
                        key={app.id}
                        className={`pipeline-card clickable${draggedApp?.id === app.id ? " dragging" : ""}${
                          dragOverAppId === app.id ? " drag-over" : ""
                        }`}
                        draggable
                        onClick={() => {
                          if (draggedAppRef.current) return;
                          setActiveAppId(app.id);
                        }}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", String(app.id));
                          const startColumn = normalizeString(readGroupValue(app, grouping.key));
                          draggedAppRef.current = { id: app.id, columnValue: startColumn };
                          setDraggedApp({ id: app.id, columnValue: startColumn });
                        }}
                        onDragOver={(event) => {
                          const currentDraggedApp = draggedAppRef.current;
                          if (!currentDraggedApp || currentDraggedApp.id === app.id) return;
                          event.preventDefault();
                          setDragOverAppId(app.id);
                          setDragOverAppColumn(column);
                        }}
                        onDragLeave={() => {
                          if (dragOverAppId === app.id) setDragOverAppId(null);
                        }}
                        onDrop={(event) => {
                          if (!draggedAppRef.current) return;
                          event.preventDefault();
                          void handleAppDrop(column, app.id);
                        }}
                        onDragEnd={() => {
                          resetAppDrag();
                        }}
                      >
                        <span className="pipeline-card-handle" aria-hidden="true" />
                        <div className="pipeline-card-title">
                          <h4>{titleValue}</h4>
                          {subtitle ? <p>{subtitle}</p> : null}
                        </div>
                        <div className="pipeline-meta">
                          {resolvedCardConfig.visibleFields.map((fieldKey) => {
                            const field = fieldByKey.get(fieldKey) || null;
                            if (!field) return null;
                            return (
                              <span key={`${app.id}:${field.key}`} className="pipeline-meta-row">
                                <span className="pipeline-meta-label">{field.label}</span>
                                <span className="pipeline-meta-value">
                                  {renderFieldDisplayValue(app, field)}
                                </span>
                              </span>
                            );
                          })}
                          {followupState === "overdue" && (
                            <span className="tag tag-overdue">{t("Follow-up overdue")}</span>
                          )}
                          {followupState === "soon" && (
                            <span className="tag tag-soon">{t("Follow-up soon")}</span>
                          )}
                        </div>
                        <div className="pipeline-actions">
                          <button
                            className="ghost"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (!leftColumn && leftColumn !== "") return;
                              void moveAppToColumn(app, leftColumn);
                            }}
                            disabled={leftColumn === null}
                          >
                            &larr;
                          </button>
                          <span>{currentValue || "Sin valor"}</span>
                          <button
                            className="ghost"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (!rightColumn && rightColumn !== "") return;
                              void moveAppToColumn(app, rightColumn);
                            }}
                            disabled={rightColumn === null}
                          >
                            &rarr;
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {activeApp && (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            onClick={closeCardEditor}
          >
            <div
              className="modal card-gallery-editor-modal pipeline-card-editor-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="modal-header card-gallery-editor-head">
                <div>
                  <h3>{activeApp.company_name || t("Application")}</h3>
                  <p>{activeApp.position || ""}</p>
                </div>
                <button className="ghost" type="button" onClick={closeCardEditor} aria-label="Close">
                  ×
                </button>
              </header>

              <div className="card-gallery-editor-shell">
                <section className="card-gallery-config-fields">
                  <h3>{t("Card settings")}</h3>
                  <div className="card-gallery-properties">
                    <div className="pipeline-source-column-field">
                      <div className="pipeline-source-column-head">
                        <label htmlFor="pipeline-source-column-selector">{t("Select-type column")}</label>
                        <span className="pipeline-source-column-badge">
                          {t("{count} available", { count: selectablePipelineFields.length })}
                        </span>
                      </div>
                      <div className="pipeline-source-column-control">
                        <select
                          id="pipeline-source-column-selector"
                          className="input"
                          value={resolvedCardConfig.pipelineField}
                          onChange={(event) => {
                            void handlePipelineFieldChange(event.target.value);
                          }}
                          disabled={selectablePipelineFields.length === 0}
                        >
                          {selectablePipelineFields.length === 0 ? (
                            <option value="">{t("No select columns available.")}</option>
                          ) : (
                            selectablePipelineFields.map((field) => (
                              <option key={`pipeline:${field.key}`} value={field.key}>
                                {field.label}
                              </option>
                            ))
                          )}
                        </select>
                      </div>
                      <p className="pipeline-source-column-hint">
                        {t("Source table: {table}", { table: t("Tracker Table") })}
                      </p>
                      <p className="pipeline-source-column-hint">
                        {t("The selected select column defines the pipeline columns.")}
                      </p>
                    </div>

                    <label className="card-gallery-property-row">
                      <span>{t("Title column")}</span>
                      <select
                        className="input"
                        value={resolvedCardConfig.titleColumn}
                        onChange={(event) => {
                          void handleTitleColumnChange(event.target.value);
                        }}
                      >
                        {pipelineFields.map((field) => (
                          <option key={`title:${field.key}`} value={field.key}>
                            {field.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </section>

                <section className="card-gallery-config-fields">
                  <h3>Campos visibles en tarjeta</h3>
                  <EditableTableToolbar
                    toolbar={{
                      columns: {
                        label: "Campos",
                        items: pipelineFields
                          .filter((field) => field.key !== resolvedCardConfig.titleColumn)
                          .map((field) => ({
                            key: field.key,
                            label: field.label,
                            visible: resolvedCardConfig.visibleFields.includes(field.key),
                            disabled: false
                          })),
                        onToggle: (key) => {
                          void persistPipelineCardConfig({
                            visible_fields: resolvedCardConfig.visibleFields.includes(key)
                              ? resolvedCardConfig.visibleFields.filter((value) => value !== key)
                              : [...resolvedCardConfig.visibleFields, key]
                          });
                        },
                        onShowAll:
                          resolvedCardConfig.visibleFields.length <
                          pipelineFields.filter((field) => field.key !== resolvedCardConfig.titleColumn).length
                            ? () => {
                                void persistPipelineCardConfig({
                                  visible_fields: pipelineFields
                                    .filter((field) => field.key !== resolvedCardConfig.titleColumn)
                                    .map((field) => field.key)
                                });
                              }
                            : undefined
                      }
                    }}
                  />
                </section>

                <ExpandedFieldsSection
                  title={t("Custom fields")}
                  addLabel={t("Add field")}
                  emptyRowsLabel={t("No editable fields configured yet.")}
                  clickForSettingsLabel={t("Click for settings")}
                  dragToReorderLabel={t("Drag to reorder")}
                  canAddField={addableVisibleFields.length > 0}
                  onAddField={() => {
                    void handleAddVisibleField();
                  }}
                  rows={expandedEditorRows}
                  onReorderField={(fromFieldKey, toFieldKey) => {
                    void handleVisibleFieldReorder(fromFieldKey, toFieldKey);
                  }}
                />
              </div>
            </div>
          </div>
        )}
        {fieldMenuOpen &&
          fieldMenuPos &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              className="column-menu open"
              ref={fieldMenuRef}
              style={{
                position: "fixed",
                top: `${fieldMenuPos.top}px`,
                left: `${fieldMenuPos.left}px`,
                zIndex: 50
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="column-menu-content">
                {fieldMenuView === "root" ? (
                  <div className="column-menu-list" role="menu">
                    <div
                      className={`column-menu-item ${fieldMenuCanEditType ? "" : "disabled"}`}
                      role="menuitem"
                      onClick={() => {
                        if (!fieldMenuCanEditType) return;
                        setFieldMenuView("type");
                      }}
                    >
                      <span className="column-menu-item-icon">{columnMenuIconChangeType}</span>
                      <span className="column-menu-item-label">Cambiar tipo</span>
                      <span className="column-menu-item-end">
                        <ColumnMenuChevronRight />
                      </span>
                    </div>
                    <div className="column-menu-separator" role="separator" />
                    <div
                      className="column-menu-item"
                      role="menuitem"
                      onClick={() => {
                        void hideField(fieldMenuOpen);
                      }}
                    >
                      <span className="column-menu-item-icon">{columnMenuIconHide}</span>
                      <span className="column-menu-item-label">Ocultar</span>
                    </div>
                    <div
                      className={`column-menu-item ${fieldMenuCanDelete ? "" : "disabled"}`}
                      role="menuitem"
                      onClick={() => {
                        if (!fieldMenuCanDelete) return;
                        void deleteCustomField(fieldMenuOpen, fieldMenuCustomPropertyKey);
                      }}
                    >
                      <span className="column-menu-item-icon">{columnMenuIconTrash}</span>
                      <span className="column-menu-item-label">Eliminar</span>
                    </div>
                  </div>
                ) : (
                  <div className="column-menu-list" role="menu">
                    <div
                      className="column-menu-item"
                      role="menuitem"
                      onClick={() => setFieldMenuView("root")}
                    >
                      <span className="column-menu-back">←</span>
                      <span className="column-menu-item-label">Volver</span>
                    </div>
                    <div className="column-menu-separator" role="separator" />
                    {CUSTOM_PROPERTY_TYPE_MENU_ITEMS.map((item) => (
                      <div
                        key={item.kind}
                        className={`column-menu-item ${fieldMenuCanEditType ? "" : "disabled"}`}
                        role="menuitem"
                        onClick={() => {
                          if (!fieldMenuCanEditType || !fieldMenuOpen) return;
                          void changeCustomFieldType(fieldMenuCustomPropertyKey, item.kind);
                        }}
                      >
                        <span className="column-menu-item-icon">{item.icon}</span>
                        <span className="column-menu-item-label">{item.label}</span>
                        <span className="column-menu-item-end">
                          {fieldMenuField?.kind === item.kind ? <span className="column-menu-check">✓</span> : null}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>,
            document.body
          )}
      </>
    );
  };

  return <PageBuilderPage pageId="pipeline" className="pipeline" resolveSlot={resolvePipelineSlot} />;
};

export default PipelinePage;
