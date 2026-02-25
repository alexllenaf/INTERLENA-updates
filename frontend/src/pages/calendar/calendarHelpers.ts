import type { SelectOption } from "../../components/TableCells";
import { saveBlobAsFile } from "../../api";
import type { Application, TodoItem } from "../../types";
import {
  escapeIcsText,
  formatIcsDate,
  formatIcsDateTime,
  followupStatus,
  parseLocalDateOnly
} from "../../utils";
import {
  normalizeTodoStatus,
  TODO_STATUSES,
  TODO_STATUS_PILL_COLORS,
  type TodoStatus
} from "../../constants";

export const TODO_STATUS_SELECT_OPTIONS: SelectOption[] = TODO_STATUSES.map((status) => ({
  label: status,
  color: TODO_STATUS_PILL_COLORS[status]
}));

export const toDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const buildWeekdayLabels = (locale?: string): string[] => {
  const formatter = new Intl.DateTimeFormat(locale || undefined, { weekday: "short" });
  const base = new Date(2021, 0, 4);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + index);
    return formatter.format(date);
  });
};

export type CalendarEvent = {
  id: string;
  appId: number;
  applicationId: string;
  todoId?: string;
  type: "Application" | "Interview" | "Follow-Up" | "To-Do";
  company: string;
  position: string;
  date: Date;
  dateKey: string;
  dateLabel: string;
  timeLabel?: string;
};

export type TodoRow = {
  appId: number;
  applicationId: string;
  company: string;
  position: string;
  todo: TodoItem;
};

export type TodoTarget = {
  appId: number;
  todoId: string;
};

export type TodoDraft = {
  task: string;
  due_date: string;
  status: TodoStatus;
  task_location: string;
  notes: string;
  documents_links: string;
  company_name: string;
  position: string;
};

export type TodoColumnId =
  | "application"
  | "task"
  | "task_location"
  | "notes"
  | "documents_links"
  | "due_date"
  | "status"
  | "actions";

export type TodoColumnMenuState = {
  col: TodoColumnId;
  rename: string;
  filter: string;
};

export type TodoColumnMenuView = "root" | "type" | "filter" | "sort" | "group" | "calculate";

export type TodoColumnKind =
  | "text"
  | "number"
  | "select"
  | "date"
  | "checkbox"
  | "rating"
  | "contacts"
  | "links"
  | "documents";

export const TODO_COLUMN_KIND_OPTIONS: TodoColumnKind[] = [
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
export const TODO_COLUMN_KIND_SET = new Set<TodoColumnKind>(TODO_COLUMN_KIND_OPTIONS);
export const TODO_COLUMN_KIND_DEFAULTS: Record<TodoColumnId, TodoColumnKind> = {
  application: "select",
  task: "text",
  task_location: "text",
  notes: "text",
  documents_links: "links",
  due_date: "date",
  status: "select",
  actions: "text"
};
export type TodoColumnKinds = Partial<Record<TodoColumnId, TodoColumnKind>>;

export type TodoSortConfig = { column: TodoColumnId; direction: "asc" | "desc" } | null;

export type TodoColumnCalcOp =
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

export const TODO_COLUMN_ORDER_DEFAULT: TodoColumnId[] = [
  "application",
  "task",
  "task_location",
  "notes",
  "documents_links",
  "due_date",
  "status",
  "actions"
];

export const TODO_COLUMN_WIDTHS: Record<TodoColumnId, number> = {
  application: 220,
  task: 220,
  task_location: 180,
  notes: 260,
  documents_links: 260,
  due_date: 160,
  status: 160,
  actions: 130
};

export const TODO_COLUMN_MENU_WIDTH = 240;
export const TODO_COLUMN_MENU_HEIGHT_ESTIMATE = 420;
export const TODO_COLUMN_MENU_GUTTER = 12;
export const TODO_COLUMN_MENU_OFFSET = 6;
export const TODO_COLUMN_MENU_ANIM_MS = 160;
export const TODO_TABLE_PREFS_STORAGE_KEY = "calendar_todo_table_prefs_v1";

export type TodoTablePrefs = {
  order: TodoColumnId[];
  hidden: TodoColumnId[];
  pinned: TodoColumnId | null;
  labels: Partial<Record<TodoColumnId, string>>;
  kinds: TodoColumnKinds;
};

export type TodoSourceAccess = {
  hasSource: boolean;
  reason: string | null;
};

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export const isTodoColumnId = (value: string): value is TodoColumnId =>
  (TODO_COLUMN_ORDER_DEFAULT as string[]).includes(value);

export const normalizeTodoColumnOrder = (order: unknown): TodoColumnId[] => {
  if (!Array.isArray(order)) return [...TODO_COLUMN_ORDER_DEFAULT];
  const list = order.filter((value): value is TodoColumnId => typeof value === "string" && isTodoColumnId(value));
  const unique: TodoColumnId[] = [];
  list.forEach((col) => {
    if (!unique.includes(col)) unique.push(col);
  });
  TODO_COLUMN_ORDER_DEFAULT.forEach((col) => {
    if (!unique.includes(col)) unique.push(col);
  });
  return unique;
};

export const normalizeTodoColumnKinds = (raw: unknown): TodoColumnKinds => {
  if (!raw || typeof raw !== "object") return {};
  const parsed = raw as Record<string, unknown>;
  const next: TodoColumnKinds = {};
  (Object.keys(TODO_COLUMN_KIND_DEFAULTS) as TodoColumnId[]).forEach((column) => {
    const value = parsed[column];
    if (typeof value !== "string") return;
    if (!TODO_COLUMN_KIND_SET.has(value as TodoColumnKind)) return;
    next[column] = value as TodoColumnKind;
  });
  return next;
};

export const readTodoTablePrefs = (): TodoTablePrefs => {
  if (typeof window === "undefined") {
    return { order: [...TODO_COLUMN_ORDER_DEFAULT], hidden: [], pinned: null, labels: {}, kinds: {} };
  }
  try {
    const raw = window.localStorage.getItem(TODO_TABLE_PREFS_STORAGE_KEY);
    if (!raw) return { order: [...TODO_COLUMN_ORDER_DEFAULT], hidden: [], pinned: null, labels: {}, kinds: {} };
    const parsed = JSON.parse(raw) as {
      order?: unknown;
      hidden?: unknown;
      pinned?: unknown;
      labels?: unknown;
      kinds?: unknown;
    };
    const order = normalizeTodoColumnOrder(parsed.order);
    const hidden = Array.isArray(parsed.hidden)
      ? parsed.hidden.filter(
          (value): value is TodoColumnId =>
            typeof value === "string" && isTodoColumnId(value) && value !== "actions"
        )
      : [];
    const pinned =
      typeof parsed.pinned === "string" &&
      isTodoColumnId(parsed.pinned) &&
      parsed.pinned !== "actions" &&
      !hidden.includes(parsed.pinned)
        ? parsed.pinned
        : null;
    const labels: Partial<Record<TodoColumnId, string>> = {};
    if (parsed.labels && typeof parsed.labels === "object") {
      Object.entries(parsed.labels as Record<string, unknown>).forEach(([key, value]) => {
        if (!isTodoColumnId(key)) return;
        if (typeof value !== "string") return;
        const trimmed = value.trim();
        if (!trimmed) return;
        labels[key] = trimmed;
      });
    }
    return { order, hidden, pinned, labels, kinds: normalizeTodoColumnKinds(parsed.kinds) };
  } catch {
    return { order: [...TODO_COLUMN_ORDER_DEFAULT], hidden: [], pinned: null, labels: {}, kinds: {} };
  }
};

export const writeTodoTablePrefs = (prefs: TodoTablePrefs) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TODO_TABLE_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage failures
  }
};

export const TRACKER_COLUMN_LABEL_FALLBACKS: Record<string, string> = {
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

export const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
};

export const normalizeStringRecord = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, raw]) => {
    if (typeof raw !== "string") return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    out[key] = trimmed;
  });
  return out;
};

export const humanizeColumnKey = (value: string): string => {
  const cleaned = value.replace(/^prop__/, "").replace(/[_-]+/g, " ").trim();
  if (!cleaned) return "Application";
  return cleaned
    .split(/\s+/)
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(" ");
};

export const resolveTrackerPinnedColumnKey = (settings: unknown): string => {
  const settingsRecord =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  const order = normalizeStringArray(settingsRecord.table_columns);
  const hidden = new Set(normalizeStringArray(settingsRecord.hidden_columns));
  const visible = order.filter((column) => !hidden.has(column));
  return visible[0] || order[0] || "company_name";
};

export const resolveTrackerPinnedColumnLabel = (settings: unknown, column: string): string => {
  const settingsRecord =
    settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  const labels = normalizeStringRecord(settingsRecord.column_labels);
  return labels[column] || TRACKER_COLUMN_LABEL_FALLBACKS[column] || humanizeColumnKey(column);
};

export const trackerApplicationValueForColumn = (app: Application, column: string): string => {
  if (column.startsWith("prop__")) {
    const key = column.slice("prop__".length);
    return app.properties?.[key] || "";
  }
  if (column === "contacts") {
    return (app.contacts || []).map((item) => item.name).filter(Boolean).join(" | ");
  }
  if (column === "todo_items") {
    return (app.todo_items || []).map((item) => item.task || "").filter(Boolean).join(" | ");
  }
  if (column === "documents_links") {
    return app.documents_links || "";
  }
  if (column === "favorite") {
    return app.favorite ? "true" : "false";
  }
  const raw = (app as Record<string, unknown>)[column];
  if (raw === null || raw === undefined) return "";
  return String(raw);
};

export const buildSingleEventIcs = (event: CalendarEvent) => {
  const uid = `${event.id}-${Date.now()}`;
  const summary = `${event.type} - ${event.company} - ${event.position}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Local Interview Tracker//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatIcsDateTime(new Date())}`,
    `SUMMARY:${escapeIcsText(summary)}`
  ];
  if (event.type === "Interview") {
    const end = new Date(event.date.getTime() + 60 * 60 * 1000);
    lines.push(`DTSTART:${formatIcsDateTime(event.date)}`);
    lines.push(`DTEND:${formatIcsDateTime(end)}`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(event.date)}`);
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\n");
};

export const downloadEventIcs = async (event: CalendarEvent) => {
  const content = buildSingleEventIcs(event);
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const safeName = `${event.type}-${event.company}-${event.dateKey}`
    .replace(/[^a-z0-9-_]+/gi, "_")
    .replace(/_+/g, "_");
  await saveBlobAsFile(blob, `${safeName}.ics`);
};
