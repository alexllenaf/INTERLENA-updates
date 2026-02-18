import React from "react";

import { openExternal, saveBlobAsFile } from "../../api";
import StarRating from "../StarRating";
import DocumentsDropzone from "../DocumentsDropzone";
import { DateCell, DateTimeCell, SelectCell, type SelectOption, TextCell } from "../TableCells";
import {
  normalizeTodoStatus,
  TODO_STATUSES,
  TODO_STATUS_CLASS,
  TODO_STATUS_PILL_COLORS
} from "../../constants";
import { Contact, Settings, TodoItem } from "../../types";
import {
  formatFileSize,
  formatUploadedAt,
  generateId,
  toDateInputValue,
  toDateTimeLocalValue
} from "../../utils";
import { type EditableTableColumnKind } from "../pageBuilder/types";

export type TypeOverridePolicy = {
  allowAddOptions?: boolean;
  allowRelabelOptions?: boolean;
  allowHideOptions?: boolean;
};

export type TypeValidationResult = { valid: true } | { valid: false; reason?: string };

export type SaveSettingsFn = (next: Partial<Settings>) => Promise<Settings | null> | Settings | null;

export type TypeRegistryContext = {
  settings?: Partial<Settings> | null;
  saveSettings?: SaveSettingsFn;
  column?: {
    key?: string;
    label?: string;
    config?: Record<string, unknown> | null;
  };
  selectState?: {
    options?: SelectOption[];
    setOptions?: (next: SelectOption[]) => void;
    defaultColor?: string;
  };
};

export type ColumnTypeRenderArgs = {
  value: unknown;
  rawValue: string;
  canEdit: boolean;
  highlightQuery?: string;
  options?: SelectOption[];
  context?: TypeRegistryContext;
  selectActions?: ColumnTypeSelectActions;
  onCommit: (next: unknown) => void;
};

export type ColumnTypeSelectActions = {
  onCreateOption?: (label: string) => Promise<string | null> | string | null;
  onUpdateOptionColor?: (label: string, color: string) => Promise<void> | void;
  onDeleteOption?: (label: string) => Promise<void> | void;
  onReorderOption?: (fromLabel: string, toLabel: string) => Promise<void> | void;
};

export type ColumnTypeDef = {
  id: string;
  baseKind: EditableTableColumnKind;
  parse: (raw: string, ctx: TypeRegistryContext) => unknown;
  serialize: (value: unknown, ctx: TypeRegistryContext) => string;
  validate?: (value: unknown, ctx: TypeRegistryContext) => TypeValidationResult;
  renderCell: (args: ColumnTypeRenderArgs) => React.ReactNode;
  getOptions?: (ctx: TypeRegistryContext) => SelectOption[];
  getSelectActions?: (ctx: TypeRegistryContext) => ColumnTypeSelectActions;
  overridePolicy?: TypeOverridePolicy;
};

const DEFAULT_OPTION_COLOR = "#E2E8F0";

type LinkItem = {
  id: string;
  label: string;
  url: string;
};

type TableDocumentItem = {
  id: string;
  name: string;
  size?: number;
  content_type?: string;
  uploaded_at?: string;
  href?: string;
};

const TODO_STATUS_SELECT_OPTIONS: SelectOption[] = TODO_STATUSES.map((status) => ({
  label: status,
  color: TODO_STATUS_PILL_COLORS[status]
}));

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const normalizeBoolLike = (raw: string): boolean => {
  const value = raw.trim().toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "si" || value === "y";
};

const parseJsonArraySafe = (raw: string): unknown[] => {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const parseContacts = (raw: string): Contact[] => {
  const parsed = parseJsonArraySafe(raw);
  const list: Contact[] = [];
  parsed.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) return;
    const id = typeof record.id === "string" && record.id.trim() ? record.id : generateId();
    const information = typeof record.information === "string" ? record.information.trim() : "";
    const email = typeof record.email === "string" ? record.email.trim() : "";
    const phone = typeof record.phone === "string" ? record.phone.trim() : "";
    list.push({
      id,
      name,
      information: information || undefined,
      email: email || undefined,
      phone: phone || undefined
    });
  });
  if (list.length === 0 && raw.trim()) {
    return raw
      .split(/\r?\n|,|;+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((name) => ({ id: generateId(), name }));
  }
  return list;
};

const normalizeUrl = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

const isRelativeHref = (raw: string): boolean =>
  raw.startsWith("/") ||
  raw.startsWith("./") ||
  raw.startsWith("../") ||
  raw.startsWith("?") ||
  raw.startsWith("#");

const normalizeDocumentHref = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (isRelativeHref(trimmed)) return trimmed;
  return normalizeUrl(trimmed);
};

const inferDocumentHref = (name: string): string | undefined => {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  if (isRelativeHref(trimmed)) return normalizeDocumentHref(trimmed);
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return normalizeDocumentHref(trimmed);
  if (trimmed.startsWith("www.")) return normalizeDocumentHref(trimmed);
  return undefined;
};

const guessLinkLabel = (url: string): string => {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, "") || url;
  } catch {
    return url;
  }
};

const parseLinks = (raw: string): LinkItem[] => {
  const fromJson = parseJsonArraySafe(raw);
  if (fromJson.length > 0) {
    const list: LinkItem[] = [];
    fromJson.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const record = item as Record<string, unknown>;
      const urlRaw =
        typeof record.url === "string"
          ? record.url
          : typeof record.href === "string"
            ? record.href
            : "";
      const url = normalizeUrl(urlRaw);
      if (!url) return;
      const labelRaw =
        typeof record.label === "string"
          ? record.label
          : typeof record.name === "string"
            ? record.name
            : "";
      const label = labelRaw.trim() || guessLinkLabel(url);
      const id = typeof record.id === "string" && record.id.trim() ? record.id : generateId();
      list.push({ id, label, url });
    });
    return list;
  }
  return raw
    .split(/\r?\n|,|;+/)
    .map((entry) => normalizeUrl(entry))
    .filter(Boolean)
    .map((url) => ({ id: generateId(), label: guessLinkLabel(url), url }));
};

const parseDocuments = (raw: string): TableDocumentItem[] => {
  const parsed = parseJsonArraySafe(raw);
  const list: TableDocumentItem[] = [];
  parsed.forEach((item) => {
    if (typeof item === "string") {
      const name = item.trim();
      if (!name) return;
      list.push({
        id: generateId(),
        name,
        href: inferDocumentHref(name)
      });
      return;
    }
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const id =
      typeof record.id === "string" && record.id.trim() ? record.id.trim() : generateId();
    const nameSource =
      typeof record.name === "string"
        ? record.name
        : typeof record.label === "string"
          ? record.label
          : typeof record.title === "string"
            ? record.title
            : typeof record.url === "string"
              ? record.url
              : typeof record.href === "string"
                ? record.href
                : id;
    const name = nameSource.trim();
    if (!name) return;
    const size =
      typeof record.size === "number" && Number.isFinite(record.size) ? record.size : undefined;
    const content_type =
      typeof record.content_type === "string" && record.content_type.trim()
        ? record.content_type.trim()
        : undefined;
    const uploaded_at =
      typeof record.uploaded_at === "string" && record.uploaded_at.trim()
        ? record.uploaded_at.trim()
        : undefined;
    const href =
      typeof record.href === "string" && record.href.trim()
        ? normalizeDocumentHref(record.href)
        : typeof record.url === "string" && record.url.trim()
          ? normalizeDocumentHref(record.url)
          : undefined;
    list.push({ id, name, size, content_type, uploaded_at, href });
  });
  if (list.length === 0 && raw.trim()) {
    return raw
      .split(/\r?\n|,|;+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => ({
        id: generateId(),
        name: entry,
        href: inferDocumentHref(entry)
      }));
  }
  const seen = new Set<string>();
  return list.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
};

const parseTodoItems = (raw: string): TodoItem[] => {
  const parsed = parseJsonArraySafe(raw);
  const list: TodoItem[] = [];
  parsed.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const task = typeof record.task === "string" ? record.task.trim() : "";
    if (!task) return;
    const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : generateId();
    const due_date =
      typeof record.due_date === "string" && record.due_date.trim()
        ? toDateInputValue(record.due_date)
        : undefined;
    const status = normalizeTodoStatus(
      typeof record.status === "string" ? record.status : undefined
    );
    const task_location =
      typeof record.task_location === "string" && record.task_location.trim()
        ? record.task_location.trim()
        : undefined;
    const notes =
      typeof record.notes === "string" && record.notes.trim() ? record.notes.trim() : undefined;
    const documents_links =
      typeof record.documents_links === "string" && record.documents_links.trim()
        ? record.documents_links.trim()
        : undefined;

    list.push({
      id,
      task,
      due_date: due_date || undefined,
      status,
      task_location,
      notes,
      documents_links
    });
  });

  if (list.length === 0 && raw.trim()) {
    return raw
      .split(/\r?\n|;+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((task) => ({
        id: generateId(),
        task,
        status: "Not started"
      }));
  }
  return list;
};

const readNumericConfig = (ctx: TypeRegistryContext, key: string): number | null => {
  const value = ctx.column?.config?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const parseNumber = (raw: string, ctx: TypeRegistryContext): number | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  const min = readNumericConfig(ctx, "min");
  const max = readNumericConfig(ctx, "max");
  let next = parsed;
  if (min !== null) next = Math.max(min, next);
  if (max !== null) next = Math.min(max, next);
  return next;
};

const parseRating = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed * 2) / 2;
  return clamp(rounded, 0, 5);
};

const mapSettingsOptions = (labels?: string[], colors?: Record<string, string>): SelectOption[] => {
  if (!Array.isArray(labels)) return [];
  const seen = new Set<string>();
  const options: SelectOption[] = [];
  labels.forEach((label) => {
    const clean = typeof label === "string" ? label.trim() : "";
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    options.push({
      label: clean,
      color: colors?.[clean] || DEFAULT_OPTION_COLOR,
      editable: true
    });
  });
  return options;
};

const normalizeSelectOptionList = (options?: SelectOption[]): SelectOption[] => {
  if (!Array.isArray(options)) return [];
  const seen = new Set<string>();
  const list: SelectOption[] = [];
  options.forEach((option) => {
    const label = typeof option?.label === "string" ? option.label.trim() : "";
    if (!label || seen.has(label)) return;
    seen.add(label);
    list.push({
      ...option,
      label,
      color: option?.color || DEFAULT_OPTION_COLOR,
      editable: option?.editable === false ? false : true
    });
  });
  return list;
};

const normalizeLabel = (value: string) => value.trim().toLowerCase();

const findExistingLabel = (list: string[], needle: string): string | null => {
  const match = list.find((entry) => normalizeLabel(entry) === normalizeLabel(needle));
  return match || null;
};

const reorderList = (list: string[], fromLabel: string, toLabel: string): string[] => {
  if (fromLabel === toLabel) return list;
  const next = [...list];
  const fromIndex = next.indexOf(fromLabel);
  const toIndex = next.indexOf(toLabel);
  if (fromIndex < 0 || toIndex < 0) return list;
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, fromLabel);
  return next;
};

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    : [];

const toColorMap = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const map: Record<string, string> = {};
  Object.entries(record).forEach(([key, raw]) => {
    if (typeof raw !== "string") return;
    const color = raw.trim();
    if (!color) return;
    map[key] = color;
  });
  return map;
};

type SettingsSelectConfig = {
  listKey: "stages" | "outcomes" | "job_types";
  colorKey: "stage_colors" | "outcome_colors" | "job_type_colors";
};

const SETTINGS_SELECT_CONFIG: Record<string, SettingsSelectConfig> = {
  "select.settings.stages@1": { listKey: "stages", colorKey: "stage_colors" },
  "select.settings.outcomes@1": { listKey: "outcomes", colorKey: "outcome_colors" },
  "select.settings.job_types@1": { listKey: "job_types", colorKey: "job_type_colors" }
};

const getManagedSelectActions = (
  ctx: TypeRegistryContext,
  typeRef: keyof typeof SETTINGS_SELECT_CONFIG
): ColumnTypeSelectActions => {
  const config = SETTINGS_SELECT_CONFIG[typeRef];
  const rawSettings =
    ctx.settings && typeof ctx.settings === "object" && !Array.isArray(ctx.settings)
      ? (ctx.settings as Record<string, unknown>)
      : null;
  const saveSettings = ctx.saveSettings;
  if (!rawSettings || !saveSettings) {
    return {};
  }

  const readList = () => toStringArray(rawSettings[config.listKey]);
  const readColors = () => toColorMap(rawSettings[config.colorKey]);

  return {
    onCreateOption: async (label: string) => {
      const trimmed = label.trim();
      if (!trimmed) return null;
      const list = readList();
      const existing = findExistingLabel(list, trimmed);
      if (existing) return existing;
      const nextList = [...list, trimmed];
      const nextColors = readColors();
      if (!nextColors[trimmed]) nextColors[trimmed] = DEFAULT_OPTION_COLOR;
      await Promise.resolve(
        saveSettings({
          [config.listKey]: nextList,
          [config.colorKey]: nextColors
        } as Partial<Settings>)
      );
      return trimmed;
    },
    onUpdateOptionColor: async (label: string, color: string) => {
      if (!label.trim()) return;
      const nextColors = { ...readColors(), [label]: color };
      await Promise.resolve(
        saveSettings({
          [config.colorKey]: nextColors
        } as Partial<Settings>)
      );
    },
    onDeleteOption: async (label: string) => {
      const nextList = readList().filter((entry) => entry !== label);
      const nextColors = { ...readColors() };
      delete nextColors[label];
      await Promise.resolve(
        saveSettings({
          [config.listKey]: nextList,
          [config.colorKey]: nextColors
        } as Partial<Settings>)
      );
    },
    onReorderOption: async (fromLabel: string, toLabel: string) => {
      const list = readList();
      const nextList = reorderList(list, fromLabel, toLabel);
      if (nextList === list) return;
      await Promise.resolve(
        saveSettings({
          [config.listKey]: nextList
        } as Partial<Settings>)
      );
    }
  };
};

const getLocalSelectActions = (ctx: TypeRegistryContext): ColumnTypeSelectActions => {
  const selectState = ctx.selectState;
  const setOptions = selectState?.setOptions;
  if (!setOptions) return {};
  const defaultColor = selectState.defaultColor || DEFAULT_OPTION_COLOR;
  const readOptions = () => normalizeSelectOptionList(selectState.options);
  const writeOptions = (next: SelectOption[]) => {
    setOptions(normalizeSelectOptionList(next));
  };

  return {
    onCreateOption: (label: string) => {
      const trimmed = label.trim();
      if (!trimmed) return null;
      const options = readOptions();
      const existing = options.find(
        (option) => normalizeLabel(option.label) === normalizeLabel(trimmed)
      );
      if (existing) return existing.label;
      writeOptions([
        ...options,
        {
          label: trimmed,
          color: defaultColor,
          editable: true
        }
      ]);
      return trimmed;
    },
    onUpdateOptionColor: (label: string, color: string) => {
      const trimmed = label.trim();
      if (!trimmed) return;
      const options = readOptions();
      const next = options.map((option) =>
        option.label === trimmed ? { ...option, color } : option
      );
      writeOptions(next);
    },
    onDeleteOption: (label: string) => {
      const trimmed = label.trim();
      if (!trimmed) return;
      const options = readOptions();
      const next = options.filter((option) => option.label !== trimmed);
      writeOptions(next);
    },
    onReorderOption: (fromLabel: string, toLabel: string) => {
      const options = readOptions();
      const labels = options.map((option) => option.label);
      const reorderedLabels = reorderList(labels, fromLabel, toLabel);
      if (reorderedLabels === labels) return;
      const byLabel = new Map(options.map((option) => [option.label, option]));
      const next = reorderedLabels
        .map((label) => byLabel.get(label))
        .filter((option): option is SelectOption => Boolean(option));
      writeOptions(next);
    }
  };
};

const baseTextRenderer = (args: ColumnTypeRenderArgs) =>
  React.createElement(TextCell, {
    value: args.rawValue,
    highlightQuery: args.highlightQuery,
    readOnly: !args.canEdit,
    onCommit: (next: string) => args.onCommit(next)
  });

const baseDateRenderer = (args: ColumnTypeRenderArgs) =>
  args.canEdit
    ? React.createElement(DateCell, {
        value: args.rawValue,
        onCommit: (next: string) => args.onCommit(next || "")
      })
    : React.createElement("input", { className: "cell-date", type: "date", value: args.rawValue, readOnly: true });

const baseDateTimeRenderer = (args: ColumnTypeRenderArgs) =>
  args.canEdit
    ? React.createElement(DateTimeCell, {
        value: args.rawValue,
        onCommit: (next: string) => args.onCommit(next || "")
      })
    : React.createElement("input", {
        className: "cell-datetime",
        type: "datetime-local",
        value: args.rawValue,
        readOnly: true
      });

type NumberTypeCellProps = {
  value: number | null;
  canEdit: boolean;
  step?: number;
  min?: number;
  max?: number;
  onCommit: (next: number | null) => void;
};

const NumberTypeCell: React.FC<NumberTypeCellProps> = ({
  value,
  canEdit,
  step = 1,
  min,
  max,
  onCommit
}) => {
  const [draft, setDraft] = React.useState(value === null || value === undefined ? "" : String(value));

  React.useEffect(() => {
    setDraft(value === null || value === undefined ? "" : String(value));
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      onCommit(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setDraft(value === null || value === undefined ? "" : String(value));
      return;
    }
    let next = parsed;
    if (typeof min === "number" && Number.isFinite(min)) next = Math.max(min, next);
    if (typeof max === "number" && Number.isFinite(max)) next = Math.min(max, next);
    onCommit(next);
  };

  return (
    <input
      className="cell-number"
      type="number"
      value={draft}
      step={step}
      min={min}
      max={max}
      readOnly={!canEdit}
      onChange={(event) => {
        if (!canEdit) return;
        setDraft(event.target.value);
      }}
      onBlur={() => {
        if (!canEdit) return;
        commit();
      }}
      onKeyDown={(event) => {
        if (!canEdit) return;
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(value === null || value === undefined ? "" : String(value));
        }
      }}
    />
  );
};

const baseNumberRenderer = (args: ColumnTypeRenderArgs) => {
  const parsed =
    typeof args.value === "number"
      ? args.value
      : typeof args.rawValue === "string" && args.rawValue.trim()
        ? Number(args.rawValue)
        : Number.NaN;
  const value = Number.isFinite(parsed) ? parsed : null;
  const step = readNumericConfig(args.context || {}, "step") ?? 1;
  const min = readNumericConfig(args.context || {}, "min");
  const max = readNumericConfig(args.context || {}, "max");
  return React.createElement(NumberTypeCell, {
    value,
    canEdit: args.canEdit,
    step,
    min: min ?? undefined,
    max: max ?? undefined,
    onCommit: (next: number | null) => args.onCommit(next)
  });
};

const baseCheckboxRenderer = (args: ColumnTypeRenderArgs) =>
  React.createElement("input", {
    className: "cell-checkbox",
    type: "checkbox",
    checked: Boolean(args.value),
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => args.onCommit(event.target.checked),
    disabled: !args.canEdit
  });

const baseRatingRenderer = (args: ColumnTypeRenderArgs) =>
  React.createElement(StarRating, {
    value: typeof args.value === "number" ? args.value : null,
    onChange: args.canEdit ? (next: number | null) => args.onCommit(next) : undefined,
    size: "sm",
    step: 0.5,
    readonly: !args.canEdit
  });

const baseSelectRenderer = (args: ColumnTypeRenderArgs) =>
  args.canEdit
    ? React.createElement(SelectCell, {
        value: args.rawValue,
        options: args.options || [],
        onCreateOption:
          args.selectActions?.onCreateOption ||
          ((label: string) => {
            const next = label.trim();
            return next || null;
          }),
        onUpdateOptionColor: args.selectActions?.onUpdateOptionColor,
        onDeleteOption: args.selectActions?.onDeleteOption,
        onReorderOption: args.selectActions?.onReorderOption,
        onCommit: (next: string) => args.onCommit(next)
      })
    : React.createElement("span", { className: "select-pill" }, args.rawValue || "—");

type TodoItemsTypeCellProps = {
  items: TodoItem[];
  canEdit: boolean;
  onCommit: (next: TodoItem[]) => void;
};

const TodoItemsTypeCell: React.FC<TodoItemsTypeCellProps> = ({ items, canEdit, onCommit }) => {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState({
    task: "",
    due_date: "",
    status: "Not started"
  });

  const pendingCount = React.useMemo(
    () => items.filter((item) => normalizeTodoStatus(item.status) !== "Done").length,
    [items]
  );

  const updateItem = (id: string, patch: Partial<TodoItem>) => {
    if (!canEdit) return;
    const next = items.map((item) => {
      if (item.id !== id) return item;
      const merged = { ...item, ...patch };
      return {
        ...merged,
        task: (merged.task || "").trim(),
        due_date: merged.due_date ? toDateInputValue(merged.due_date) : undefined,
        status: normalizeTodoStatus(merged.status)
      };
    });
    onCommit(next);
  };

  const removeItem = (id: string) => {
    if (!canEdit) return;
    const next = items.filter((item) => item.id !== id);
    if (next.length === items.length) return;
    onCommit(next);
  };

  const addItem = () => {
    if (!canEdit) return;
    const task = draft.task.trim();
    if (!task) return;
    onCommit([
      ...items,
      {
        id: generateId(),
        task,
        due_date: draft.due_date || undefined,
        status: normalizeTodoStatus(draft.status)
      }
    ]);
    setDraft({ task: "", due_date: "", status: "Not started" });
  };

  return (
    <div className="todo-items-cell">
      <div className="todo-items-summary">
        {items.length === 0 ? (
          <span className="todo-items-empty">No to-do items yet.</span>
        ) : (
          <span>{`${items.length} item${items.length === 1 ? "" : "s"} • ${pendingCount} pending`}</span>
        )}
      </div>
      {canEdit && (
        <button className="link-button" type="button" onClick={() => setOpen((prev) => !prev)}>
          {open ? "Close to-dos" : "Add to-do"}
        </button>
      )}
      {canEdit && open && (
        <div className="todo-items-popover">
          {items.length === 0 ? (
            <div className="todo-items-empty">No to-do items yet.</div>
          ) : (
            <table className="table todo-table todo-items-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Due Date</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const status = normalizeTodoStatus(item.status);
                  return (
                    <tr key={item.id} className={status === "Done" ? "todo-completed" : undefined}>
                      <td>
                        <TextCell
                          value={item.task || ""}
                          onCommit={(next) => updateItem(item.id, { task: next })}
                        />
                      </td>
                      <td>
                        <DateCell
                          value={item.due_date || ""}
                          onCommit={(next) => updateItem(item.id, { due_date: next || undefined })}
                        />
                      </td>
                      <td>
                        <SelectCell
                          value={status}
                          options={TODO_STATUS_SELECT_OPTIONS}
                          onCommit={(next) => updateItem(item.id, { status: normalizeTodoStatus(next) })}
                        />
                      </td>
                      <td>
                        <button
                          className="ghost small"
                          type="button"
                          onClick={() => removeItem(item.id)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="todo-items-add-row">
            <input
              className="cell-input"
              placeholder="New task"
              value={draft.task}
              onChange={(event) => setDraft((prev) => ({ ...prev, task: event.target.value }))}
            />
            <input
              className="cell-date"
              type="date"
              value={draft.due_date}
              onChange={(event) => setDraft((prev) => ({ ...prev, due_date: event.target.value }))}
            />
            <select
              className={`cell-select todo-status ${TODO_STATUS_CLASS[normalizeTodoStatus(draft.status)]}`}
              value={draft.status}
              onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value }))}
            >
              {TODO_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <button className="primary small" type="button" onClick={addItem}>
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

type ContactsTypeCellProps = {
  contacts: Contact[];
  canEdit: boolean;
  onCommit: (next: Contact[]) => void;
};

const ContactsTypeCell: React.FC<ContactsTypeCellProps> = ({ contacts, canEdit, onCommit }) => {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState({
    name: "",
    information: "",
    email: "",
    phone: ""
  });

  const resetDraft = () =>
    setDraft({
      name: "",
      information: "",
      email: "",
      phone: ""
    });

  const handleAdd = () => {
    const name = draft.name.trim();
    if (!name) return;
    onCommit([
      ...contacts,
      {
        id: generateId(),
        name,
        information: draft.information.trim() || undefined,
        email: draft.email.trim() || undefined,
        phone: draft.phone.trim() || undefined
      }
    ]);
    resetDraft();
    setOpen(false);
  };

  const handleRemove = (id: string) => {
    if (!canEdit) return;
    const next = contacts.filter((contact) => contact.id !== id);
    if (next.length === contacts.length) return;
    onCommit(next);
  };

  return (
    <div className="contacts-cell">
      <div className="contacts-list">
        {contacts.length === 0 && <span className="contacts-empty">No contacts yet.</span>}
        {contacts.map((contact) => (
          <div className="contact-item" key={contact.id}>
            <div className="contact-name">{contact.name}</div>
            <div className="contact-meta">
              {contact.information && <span>{contact.information}</span>}
              {contact.email && <span>{contact.email}</span>}
              {contact.phone && <span>{contact.phone}</span>}
            </div>
            {canEdit && (
              <button
                className="contact-remove"
                type="button"
                onClick={() => handleRemove(contact.id)}
                aria-label="Remove contact"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <button className="link-button" type="button" onClick={() => setOpen((prev) => !prev)}>
          Add contact
        </button>
      )}
      {canEdit && open && (
        <div className="contacts-popover">
          <label>
            Name
            <input
              value={draft.name}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Name"
            />
          </label>
          <label>
            Information
            <input
              value={draft.information}
              onChange={(event) => setDraft((prev) => ({ ...prev, information: event.target.value }))}
              placeholder="Role, LinkedIn, etc."
            />
          </label>
          <label>
            Email
            <input
              value={draft.email}
              onChange={(event) => setDraft((prev) => ({ ...prev, email: event.target.value }))}
              placeholder="name@email.com"
            />
          </label>
          <label>
            Phone
            <input
              value={draft.phone}
              onChange={(event) => setDraft((prev) => ({ ...prev, phone: event.target.value }))}
              placeholder="+34 ..."
            />
          </label>
          <div className="contacts-popover-actions">
            <button
              className="ghost small"
              type="button"
              onClick={() => {
                resetDraft();
                setOpen(false);
              }}
            >
              Cancel
            </button>
            <button className="primary small" type="button" onClick={handleAdd}>
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

type LinksTypeCellProps = {
  links: LinkItem[];
  canEdit: boolean;
  onCommit: (next: LinkItem[]) => void;
};

const LinksTypeCell: React.FC<LinksTypeCellProps> = ({ links, canEdit, onCommit }) => {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState({ label: "", url: "" });

  const resetDraft = () => setDraft({ label: "", url: "" });

  const handleAdd = () => {
    const url = normalizeUrl(draft.url);
    if (!url) return;
    const label = draft.label.trim() || guessLinkLabel(url);
    onCommit([...links, { id: generateId(), label, url }]);
    resetDraft();
    setOpen(false);
  };

  const handleRemove = (id: string) => {
    if (!canEdit) return;
    const next = links.filter((link) => link.id !== id);
    if (next.length === links.length) return;
    onCommit(next);
  };

  return (
    <div className="links-cell">
      <div className="links-list">
        {links.length === 0 && <span className="links-empty">—</span>}
        {links.map((link) => (
          <div className="link-item" key={link.id}>
            <button
              className="link-open"
              type="button"
              onClick={() => void openExternal(link.url)}
              title={link.url}
            >
              <div className="link-label">{link.label}</div>
              <div className="link-meta">{link.url}</div>
            </button>
            {canEdit && (
              <button
                className="link-remove"
                type="button"
                onClick={() => handleRemove(link.id)}
                aria-label="Remove link"
                title="Remove"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <button className="link-button" type="button" onClick={() => setOpen((prev) => !prev)}>
          + Add link
        </button>
      )}
      {canEdit && open && (
        <div className="links-popover">
          <label>
            Label
            <input
              value={draft.label}
              onChange={(event) => setDraft((prev) => ({ ...prev, label: event.target.value }))}
              placeholder="Website, job post, ..."
            />
          </label>
          <label>
            URL
            <input
              value={draft.url}
              onChange={(event) => setDraft((prev) => ({ ...prev, url: event.target.value }))}
              placeholder="https://..."
            />
          </label>
          <div className="links-popover-actions">
            <button
              className="ghost small"
              type="button"
              onClick={() => {
                resetDraft();
                setOpen(false);
              }}
            >
              Cancel
            </button>
            <button className="primary small" type="button" onClick={handleAdd}>
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

type DocumentsTypeCellProps = {
  documents: TableDocumentItem[];
  canEdit: boolean;
  onCommit: (next: TableDocumentItem[]) => void;
};

const DocumentsTypeCell: React.FC<DocumentsTypeCellProps> = ({ documents, canEdit, onCommit }) => {
  const [open, setOpen] = React.useState(false);
  const [infoDocument, setInfoDocument] = React.useState<TableDocumentItem | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null);

  const handleAddFiles = (files: FileList | null) => {
    if (!canEdit || !files || files.length === 0) return;
    const additions: TableDocumentItem[] = Array.from(files).map((file) => ({
      id: generateId(),
      name: file.name,
      size: file.size,
      content_type: file.type || undefined,
      uploaded_at: new Date().toISOString(),
      href: URL.createObjectURL(file)
    }));
    onCommit([...documents, ...additions]);
  };

  const handleDownloadDocument = React.useCallback(async (doc: TableDocumentItem) => {
    const href = doc.href?.trim();
    if (!href) return;

    if (/^(blob:|data:)/i.test(href)) {
      try {
        const response = await fetch(href);
        const blob = await response.blob();
        await saveBlobAsFile(blob, doc.name || "document");
        return;
      } catch (error) {
        console.error("Failed to download embedded document", error);
      }
    }

    await openExternal(href);
  }, []);

  const handleRemove = (id: string) => {
    if (!canEdit) return;
    const next = documents.filter((doc) => doc.id !== id);
    if (next.length === documents.length) return;
    onCommit(next);
    setInfoDocument((prev) => (prev?.id === id ? null : prev));
    setPendingDeleteId((prev) => (prev === id ? null : prev));
  };

  const pendingDeleteDocument =
    pendingDeleteId ? documents.find((doc) => doc.id === pendingDeleteId) || null : null;

  return (
    <div className="docs-prop-cell">
      <div className="doc-chips">
        {documents.length === 0 && <span className="docs-prop-empty">—</span>}
        {documents.map((doc) => (
          <div className="docs-prop-chip" key={doc.id}>
            <button
              className="doc-chip doc-button"
              type="button"
              onClick={() => setOpen(true)}
              title={doc.name}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M5 2.5h6l4 4V17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Zm6 1.5H6v12h8V8h-3V4Z" />
              </svg>
              <span>{doc.name}</span>
            </button>
          </div>
        ))}
      </div>
      {canEdit && (
        <button className="link-button" type="button" onClick={() => setOpen((prev) => !prev)}>
          + Add document
        </button>
      )}
      {canEdit && open && (
        <div className="docs-prop-popover">
          <div className="docs-prop-actions">
            <button className="ghost small" type="button" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
          <div className="docs-prop-popover-dropzone">
            <DocumentsDropzone onUpload={handleAddFiles} />
          </div>
          <div className="docs-prop-list">
            {documents.length === 0 ? (
              <span className="docs-prop-empty">No documents yet.</span>
            ) : (
              documents.map((doc) => (
                <div key={`row-${doc.id}`} className="docs-prop-row">
                  <span className="docs-prop-row-check">{doc.href ? "↗" : "•"}</span>
                  <span className="docs-prop-row-name">
                    {doc.name}
                    {doc.size ? ` ${formatFileSize(doc.size)}` : ""}
                  </span>
                  <span className="docs-prop-row-actions">
                    <button
                      className="doc-icon-button info"
                      type="button"
                      aria-label="Document info"
                      title="Document info"
                      onClick={() => setInfoDocument(doc)}
                    >
                      i
                    </button>
                    <button
                      className="doc-icon-button danger"
                      type="button"
                      aria-label="Delete document"
                      title="Delete document"
                      onClick={() => setPendingDeleteId(doc.id)}
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M7.5 3.5h5l.5 1.5H17v1.5H3V5h3.5l.5-1.5Zm1 4h1.5v7H8.5v-7Zm3 0H13v7h-1.5v-7ZM5.5 6.5h9l-.6 9.1a1.5 1.5 0 0 1-1.5 1.4H7.6a1.5 1.5 0 0 1-1.5-1.4l-.6-9.1Z" />
                      </svg>
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
      {infoDocument && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setInfoDocument(null)}>
          <div className="modal doc-modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <div>
                <h2>Document</h2>
                <p>{infoDocument.name}</p>
              </div>
              <button className="ghost" type="button" onClick={() => setInfoDocument(null)} aria-label="Close">
                ×
              </button>
            </header>
            <div className="doc-info">
              <div className="doc-row">
                <span className="doc-label">Name</span>
                <span>{infoDocument.name}</span>
              </div>
              <div className="doc-row">
                <span className="doc-label">Added</span>
                <span>{formatUploadedAt(infoDocument.uploaded_at)}</span>
              </div>
              <div className="doc-row">
                <span className="doc-label">Size</span>
                <span>{infoDocument.size ? formatFileSize(infoDocument.size) : "—"}</span>
              </div>
            </div>
            <div className="doc-actions">
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  void handleDownloadDocument(infoDocument);
                }}
                disabled={!infoDocument.href}
              >
                Download
              </button>
              {canEdit && (
                <button
                  className="doc-icon-button danger"
                  type="button"
                  aria-label="Delete document"
                  onClick={() => setPendingDeleteId(infoDocument.id)}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M7.5 3.5h5l.5 1.5H17v1.5H3V5h3.5l.5-1.5Zm1 4h1.5v7H8.5v-7Zm3 0H13v7h-1.5v-7ZM5.5 6.5h9l-.6 9.1a1.5 1.5 0 0 1-1.5 1.4H7.6a1.5 1.5 0 0 1-1.5-1.4l-.6-9.1Z" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {pendingDeleteDocument && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setPendingDeleteId(null)}>
          <div className="modal confirm-delete-modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <div>
                <h2>Delete Document</h2>
                <p>{pendingDeleteDocument.name}</p>
              </div>
              <button className="ghost" type="button" onClick={() => setPendingDeleteId(null)} aria-label="Close">
                ×
              </button>
            </header>
            <p>Do you want to delete this document?</p>
            <div className="confirm-delete-actions">
              <button className="ghost" type="button" onClick={() => setPendingDeleteId(null)}>
                Cancel
              </button>
              <button
                className="doc-icon-button danger"
                type="button"
                aria-label="Delete document"
                onClick={() => handleRemove(pendingDeleteDocument.id)}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M7.5 3.5h5l.5 1.5H17v1.5H3V5h3.5l.5-1.5Zm1 4h1.5v7H8.5v-7Zm3 0H13v7h-1.5v-7ZM5.5 6.5h9l-.6 9.1a1.5 1.5 0 0 1-1.5 1.4H7.6a1.5 1.5 0 0 1-1.5-1.4l-.6-9.1Z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const contactsRenderer = (args: ColumnTypeRenderArgs) =>
  React.createElement(ContactsTypeCell, {
    contacts: Array.isArray(args.value) ? (args.value as Contact[]) : [],
    canEdit: args.canEdit,
    onCommit: (next: Contact[]) => args.onCommit(next)
  });

const todoItemsRenderer = (args: ColumnTypeRenderArgs) =>
  React.createElement(TodoItemsTypeCell, {
    items: Array.isArray(args.value) ? (args.value as TodoItem[]) : [],
    canEdit: args.canEdit,
    onCommit: (next: TodoItem[]) => args.onCommit(next)
  });

const linksRenderer = (args: ColumnTypeRenderArgs) =>
  React.createElement(LinksTypeCell, {
    links: Array.isArray(args.value) ? (args.value as LinkItem[]) : [],
    canEdit: args.canEdit,
    onCommit: (next: LinkItem[]) => args.onCommit(next)
  });

const documentsRenderer = (args: ColumnTypeRenderArgs) =>
  React.createElement(DocumentsTypeCell, {
    documents: Array.isArray(args.value) ? (args.value as TableDocumentItem[]) : [],
    canEdit: args.canEdit,
    onCommit: (next: TableDocumentItem[]) => args.onCommit(next)
  });

const selectOverridePolicy: TypeOverridePolicy = {
  allowAddOptions: true,
  allowRelabelOptions: true,
  allowHideOptions: true
};

export const TYPE_REGISTRY: Record<string, ColumnTypeDef> = {
  "text.basic@1": {
    id: "text.basic@1",
    baseKind: "text",
    parse: (raw: string) => raw ?? "",
    serialize: (value: unknown) => (value === null || value === undefined ? "" : String(value)),
    renderCell: baseTextRenderer
  },
  "number.basic@1": {
    id: "number.basic@1",
    baseKind: "number",
    parse: parseNumber,
    serialize: (value: unknown, ctx: TypeRegistryContext) => {
      if (value === null || value === undefined) return "";
      if (typeof value === "string") {
        const parsed = parseNumber(value, ctx);
        return parsed === null ? "" : String(parsed);
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        const min = readNumericConfig(ctx, "min");
        const max = readNumericConfig(ctx, "max");
        let next = value;
        if (min !== null) next = Math.max(min, next);
        if (max !== null) next = Math.min(max, next);
        return String(next);
      }
      return "";
    },
    validate: (value: unknown, ctx: TypeRegistryContext) => {
      if (value === null || value === undefined || value === "") return { valid: true };
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { valid: false, reason: "Expected number value." };
      }
      const min = readNumericConfig(ctx, "min");
      const max = readNumericConfig(ctx, "max");
      if (min !== null && value < min) return { valid: false, reason: `Value must be >= ${min}.` };
      if (max !== null && value > max) return { valid: false, reason: `Value must be <= ${max}.` };
      return { valid: true };
    },
    renderCell: baseNumberRenderer
  },
  "date.iso@1": {
    id: "date.iso@1",
    baseKind: "date",
    parse: (raw: string) => toDateInputValue(raw),
    serialize: (value: unknown) => toDateInputValue(value === null || value === undefined ? "" : String(value)),
    validate: (value: unknown) => {
      if (!value) return { valid: true };
      if (typeof value !== "string") return { valid: false, reason: "Expected ISO date string." };
      return /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? { valid: true }
        : { valid: false, reason: "Expected format YYYY-MM-DD." };
    },
    renderCell: baseDateRenderer
  },
  "datetime.iso@1": {
    id: "datetime.iso@1",
    baseKind: "date",
    parse: (raw: string) => toDateTimeLocalValue(raw),
    serialize: (value: unknown) =>
      toDateTimeLocalValue(value === null || value === undefined ? "" : String(value)),
    validate: (value: unknown) => {
      if (!value) return { valid: true };
      if (typeof value !== "string") return { valid: false, reason: "Expected ISO datetime string." };
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
        ? { valid: true }
        : { valid: false, reason: "Expected format YYYY-MM-DDTHH:mm." };
    },
    renderCell: baseDateTimeRenderer
  },
  "checkbox.bool@1": {
    id: "checkbox.bool@1",
    baseKind: "checkbox",
    parse: (raw: string) => normalizeBoolLike(raw || ""),
    serialize: (value: unknown) => (Boolean(value) ? "true" : "false"),
    renderCell: baseCheckboxRenderer
  },
  "rating.stars_0_5_half@1": {
    id: "rating.stars_0_5_half@1",
    baseKind: "rating",
    parse: (raw: string) => parseRating(raw),
    serialize: (value: unknown) => {
      if (value === null || value === undefined || value === "") return "";
      const parsed =
        typeof value === "number"
          ? value
          : typeof value === "string"
            ? Number(value)
            : Number.NaN;
      if (!Number.isFinite(parsed)) return "";
      return String(clamp(Math.round(parsed * 2) / 2, 0, 5));
    },
    validate: (value: unknown) => {
      if (value === null || value === undefined || value === "") return { valid: true };
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { valid: false, reason: "Expected rating number." };
      }
      if (value < 0 || value > 5) return { valid: false, reason: "Rating must be between 0 and 5." };
      if (Math.abs(value * 2 - Math.round(value * 2)) > 0.0001) {
        return { valid: false, reason: "Rating must be in 0.5 increments." };
      }
      return { valid: true };
    },
    renderCell: baseRatingRenderer
  },
  "todo.items@1": {
    id: "todo.items@1",
    baseKind: "todo",
    parse: (raw: string) => parseTodoItems(raw),
    serialize: (value: unknown) => {
      const list = Array.isArray(value) ? (value as TodoItem[]) : [];
      return JSON.stringify(
        list
          .map((item) => {
            const task = (item.task || "").trim();
            if (!task) return null;
            const due_date = item.due_date ? toDateInputValue(item.due_date) : undefined;
            const task_location = item.task_location?.trim() || undefined;
            const notes = item.notes?.trim() || undefined;
            const documents_links = item.documents_links?.trim() || undefined;
            return {
              id: item.id || generateId(),
              task,
              due_date: due_date || undefined,
              status: normalizeTodoStatus(item.status),
              task_location,
              notes,
              documents_links
            };
          })
          .filter((item) => item !== null)
      );
    },
    renderCell: todoItemsRenderer
  },
  "contacts.list@1": {
    id: "contacts.list@1",
    baseKind: "contacts",
    parse: (raw: string) => parseContacts(raw),
    serialize: (value: unknown) => {
      const list = Array.isArray(value) ? (value as Contact[]) : [];
      return JSON.stringify(
        list
          .filter((item) => item && typeof item === "object")
          .map((item) => ({
            id: item.id || generateId(),
            name: item.name || "",
            information: item.information || undefined,
            email: item.email || undefined,
            phone: item.phone || undefined
          }))
          .filter((item) => item.name.trim().length > 0)
      );
    },
    renderCell: contactsRenderer
  },
  "links.list@1": {
    id: "links.list@1",
    baseKind: "links",
    parse: (raw: string) => parseLinks(raw),
    serialize: (value: unknown) => {
      const list = Array.isArray(value) ? (value as LinkItem[]) : [];
      return JSON.stringify(
        list
          .map((item) => {
            const url = normalizeUrl(item?.url || "");
            if (!url) return null;
            return {
              id: item.id || generateId(),
              label: item.label?.trim() || guessLinkLabel(url),
              url
            };
          })
          .filter((item): item is { id: string; label: string; url: string } => Boolean(item))
      );
    },
    renderCell: linksRenderer
  },
  "documents.list@1": {
    id: "documents.list@1",
    baseKind: "documents",
    parse: (raw: string) => parseDocuments(raw),
    serialize: (value: unknown) => {
      const docs = Array.isArray(value) ? (value as unknown[]) : [];
      const normalized = docs
        .map((entry) => {
          if (!entry || typeof entry !== "object") {
            if (typeof entry === "string" && entry.trim()) {
              return { id: generateId(), name: entry.trim() };
            }
            return null;
          }
          const record = entry as Record<string, unknown>;
          const id =
            typeof record.id === "string" && record.id.trim() ? record.id.trim() : generateId();
          const name =
            typeof record.name === "string" && record.name.trim()
              ? record.name.trim()
              : typeof record.label === "string" && record.label.trim()
                ? record.label.trim()
                : typeof record.title === "string" && record.title.trim()
                  ? record.title.trim()
                  : "";
          if (!name) return null;
          const size =
            typeof record.size === "number" && Number.isFinite(record.size) ? record.size : undefined;
          const content_type =
            typeof record.content_type === "string" && record.content_type.trim()
              ? record.content_type.trim()
              : undefined;
          const uploaded_at =
            typeof record.uploaded_at === "string" && record.uploaded_at.trim()
              ? record.uploaded_at.trim()
              : undefined;
          const href =
            typeof record.href === "string" && record.href.trim()
              ? normalizeDocumentHref(record.href)
              : typeof record.url === "string" && record.url.trim()
                ? normalizeDocumentHref(record.url)
                : undefined;
          return {
            id,
            name,
            size,
            content_type,
            uploaded_at,
            href
          };
        })
        .filter((item): item is TableDocumentItem => Boolean(item));
      return normalized.length > 0 ? JSON.stringify(normalized) : "";
    },
    renderCell: documentsRenderer
  },
  "select.settings.stages@1": {
    id: "select.settings.stages@1",
    baseKind: "select",
    parse: (raw: string) => raw ?? "",
    serialize: (value: unknown) => (value === null || value === undefined ? "" : String(value)),
    renderCell: baseSelectRenderer,
    getOptions: (ctx: TypeRegistryContext) =>
      mapSettingsOptions(ctx.settings?.stages, ctx.settings?.stage_colors),
    getSelectActions: (ctx: TypeRegistryContext) =>
      getManagedSelectActions(ctx, "select.settings.stages@1"),
    overridePolicy: selectOverridePolicy
  },
  "select.local@1": {
    id: "select.local@1",
    baseKind: "select",
    parse: (raw: string) => raw ?? "",
    serialize: (value: unknown) => (value === null || value === undefined ? "" : String(value)),
    renderCell: baseSelectRenderer,
    getOptions: (ctx: TypeRegistryContext) => normalizeSelectOptionList(ctx.selectState?.options),
    getSelectActions: (ctx: TypeRegistryContext) => getLocalSelectActions(ctx),
    overridePolicy: selectOverridePolicy
  },
  "select.settings.outcomes@1": {
    id: "select.settings.outcomes@1",
    baseKind: "select",
    parse: (raw: string) => raw ?? "",
    serialize: (value: unknown) => (value === null || value === undefined ? "" : String(value)),
    renderCell: baseSelectRenderer,
    getOptions: (ctx: TypeRegistryContext) =>
      mapSettingsOptions(ctx.settings?.outcomes, ctx.settings?.outcome_colors),
    getSelectActions: (ctx: TypeRegistryContext) =>
      getManagedSelectActions(ctx, "select.settings.outcomes@1"),
    overridePolicy: selectOverridePolicy
  },
  "select.settings.job_types@1": {
    id: "select.settings.job_types@1",
    baseKind: "select",
    parse: (raw: string) => raw ?? "",
    serialize: (value: unknown) => (value === null || value === undefined ? "" : String(value)),
    renderCell: baseSelectRenderer,
    getOptions: (ctx: TypeRegistryContext) =>
      mapSettingsOptions(ctx.settings?.job_types, ctx.settings?.job_type_colors),
    getSelectActions: (ctx: TypeRegistryContext) =>
      getManagedSelectActions(ctx, "select.settings.job_types@1"),
    overridePolicy: selectOverridePolicy
  }
};
