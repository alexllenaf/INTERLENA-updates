import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ApplicationForm from "../components/ApplicationForm";
import { EditableTableToolbar } from "../components/blocks/BlockRenderer";
import ContactsEditor from "../components/ContactsEditor";
import DocumentsDropzone from "../components/DocumentsDropzone";
import { BlockSlotResolver, PageBlockConfig, PageBuilderPage } from "../components/pageBuilder";
import StarRating from "../components/StarRating";
import { DateCell, SelectCell, type SelectOption, TextCell } from "../components/TableCells";
import { useI18n } from "../i18n";
import {
  deleteDocument,
  documentDownloadUrl,
  downloadIcs,
  downloadTodoIcs,
  openExternal,
  saveBlobAsFile,
  uploadDocuments
} from "../api";
import { useAppData } from "../state";
import { Application, DocumentFile, TodoItem } from "../types";
import {
  escapeIcsText,
  formatDate,
  formatFileSize,
  formatIcsDate,
  formatIcsDateTime,
  formatUploadedAt,
  followupStatus,
  generateId,
  parseDocumentLinks,
  parseLocalDateOnly
} from "../utils";
import {
  normalizeTodoStatus,
  TODO_STATUSES,
  TODO_STATUS_CLASS,
  TODO_STATUS_PILL_COLORS,
  type TodoStatus
} from "../constants";

const TODO_STATUS_SELECT_OPTIONS: SelectOption[] = TODO_STATUSES.map((status) => ({
  label: status,
  color: TODO_STATUS_PILL_COLORS[status]
}));

const toDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const buildWeekdayLabels = (locale?: string): string[] => {
  const formatter = new Intl.DateTimeFormat(locale || undefined, { weekday: "short" });
  const base = new Date(2021, 0, 4);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + index);
    return formatter.format(date);
  });
};

type CalendarEvent = {
  id: string;
  appId: number;
  applicationId: string;
  todoId?: string;
  type: "Interview" | "Follow-Up" | "To-Do";
  company: string;
  position: string;
  date: Date;
  dateKey: string;
  dateLabel: string;
  timeLabel?: string;
};

type TodoRow = {
  appId: number;
  applicationId: string;
  company: string;
  position: string;
  todo: TodoItem;
};

type TodoTarget = {
  appId: number;
  todoId: string;
};

type TodoDraft = {
  task: string;
  due_date: string;
  status: TodoStatus;
  task_location: string;
  notes: string;
  documents_links: string;
  company_name: string;
  position: string;
};

type TodoColumnId =
  | "application"
  | "task"
  | "task_location"
  | "notes"
  | "documents_links"
  | "due_date"
  | "status"
  | "actions";

type TodoColumnMenuState = {
  col: TodoColumnId;
  rename: string;
  filter: string;
};

type TodoColumnMenuView = "root" | "type" | "filter" | "sort" | "group" | "calculate";

type TodoColumnKind =
  | "text"
  | "number"
  | "select"
  | "date"
  | "checkbox"
  | "rating"
  | "contacts"
  | "links"
  | "documents";

type TodoSortConfig = { column: TodoColumnId; direction: "asc" | "desc" } | null;

type TodoColumnCalcOp =
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

const TODO_COLUMN_ORDER_DEFAULT: TodoColumnId[] = [
  "application",
  "task",
  "task_location",
  "notes",
  "documents_links",
  "due_date",
  "status",
  "actions"
];

const TODO_COLUMN_WIDTHS: Record<TodoColumnId, number> = {
  application: 220,
  task: 220,
  task_location: 180,
  notes: 260,
  documents_links: 260,
  due_date: 160,
  status: 160,
  actions: 130
};

const TODO_COLUMN_MENU_WIDTH = 240;
const TODO_COLUMN_MENU_HEIGHT_ESTIMATE = 420;
const TODO_COLUMN_MENU_GUTTER = 12;
const TODO_COLUMN_MENU_OFFSET = 6;
const TODO_COLUMN_MENU_ANIM_MS = 160;
const TODO_TABLE_PREFS_STORAGE_KEY = "calendar_todo_table_prefs_v1";

type TodoTablePrefs = {
  order: TodoColumnId[];
  hidden: TodoColumnId[];
  pinned: TodoColumnId | null;
  labels: Partial<Record<TodoColumnId, string>>;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const isTodoColumnId = (value: string): value is TodoColumnId =>
  (TODO_COLUMN_ORDER_DEFAULT as string[]).includes(value);

const normalizeTodoColumnOrder = (order: unknown): TodoColumnId[] => {
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

const readTodoTablePrefs = (): TodoTablePrefs => {
  if (typeof window === "undefined") {
    return { order: [...TODO_COLUMN_ORDER_DEFAULT], hidden: [], pinned: null, labels: {} };
  }
  try {
    const raw = window.localStorage.getItem(TODO_TABLE_PREFS_STORAGE_KEY);
    if (!raw) return { order: [...TODO_COLUMN_ORDER_DEFAULT], hidden: [], pinned: null, labels: {} };
    const parsed = JSON.parse(raw) as {
      order?: unknown;
      hidden?: unknown;
      pinned?: unknown;
      labels?: unknown;
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
    return { order, hidden, pinned, labels };
  } catch {
    return { order: [...TODO_COLUMN_ORDER_DEFAULT], hidden: [], pinned: null, labels: {} };
  }
};

const writeTodoTablePrefs = (prefs: TodoTablePrefs) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TODO_TABLE_PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage failures
  }
};

const buildSingleEventIcs = (event: CalendarEvent) => {
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

const downloadEventIcs = async (event: CalendarEvent) => {
  const content = buildSingleEventIcs(event);
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const safeName = `${event.type}-${event.company}-${event.dateKey}`
    .replace(/[^a-z0-9-_]+/gi, "_")
    .replace(/_+/g, "_");
  await saveBlobAsFile(blob, `${safeName}.ics`);
};

const CalendarPage: React.FC = () => {
  const { t, locale } = useI18n();
  const { applications, updateApplication, settings, refresh } = useAppData();
  const [selected, setSelected] = useState<string>("");
  const [editing, setEditing] = useState<Application | null>(null);
  const [detailApp, setDetailApp] = useState<Application | null>(null);
  const detailIdRef = useRef<number | null>(null);
  const [todoDetail, setTodoDetail] = useState<TodoTarget | null>(null);
  const [todoEdit, setTodoEdit] = useState<TodoTarget | null>(null);
  const [todoDetailDraft, setTodoDetailDraft] = useState<TodoDraft | null>(null);
  const [todoEditDraft, setTodoEditDraft] = useState<TodoDraft | null>(null);
  const [todoCreateDraft, setTodoCreateDraft] = useState<TodoDraft | null>(null);
  const [todoCreateAppId, setTodoCreateAppId] = useState<string>("");
  const todoDetailKeyRef = useRef<string | null>(null);
  const todoEditKeyRef = useRef<string | null>(null);
  const [documentModal, setDocumentModal] = useState<{ appId: number; file: DocumentFile } | null>(
    null
  );
  const [detailDraft, setDetailDraft] = useState({
    notes: "",
    job_description: "",
    improvement_areas: "",
    skill_to_upgrade: "",
    documents_links: "",
    company_score: null as number | null
  });
  const today = new Date();
  const [cursor, setCursor] = useState<Date>(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [selectedDay, setSelectedDay] = useState<string>(() => toDateKey(today));
  const [todoColumnOrder, setTodoColumnOrder] = useState<TodoColumnId[]>(() => readTodoTablePrefs().order);
  const [todoHiddenColumns, setTodoHiddenColumns] = useState<TodoColumnId[]>(
    () => readTodoTablePrefs().hidden
  );
  const [todoPinnedColumn, setTodoPinnedColumn] = useState<TodoColumnId | null>(
    () => readTodoTablePrefs().pinned
  );
  const [todoColumnLabelOverrides, setTodoColumnLabelOverrides] = useState<
    Partial<Record<TodoColumnId, string>>
  >(() => readTodoTablePrefs().labels);
  const [todoColumnMenu, setTodoColumnMenu] = useState<TodoColumnMenuState | null>(null);
  const [todoColumnMenuPos, setTodoColumnMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [todoColumnMenuPlacement, setTodoColumnMenuPlacement] = useState<"top" | "bottom">("bottom");
  const [todoColumnMenuVisible, setTodoColumnMenuVisible] = useState(false);
  const [todoColumnMenuView, setTodoColumnMenuView] = useState<TodoColumnMenuView>("root");
  const [todoColumnMenuActiveIndex, setTodoColumnMenuActiveIndex] = useState(0);
  const [todoDragColumn, setTodoDragColumn] = useState<TodoColumnId | null>(null);
  const [todoDragOverColumn, setTodoDragOverColumn] = useState<TodoColumnId | null>(null);
  const [todoColumnFilters, setTodoColumnFilters] = useState<Partial<Record<TodoColumnId, string>>>({});
  const [todoSortConfig, setTodoSortConfig] = useState<TodoSortConfig>(null);
  const [todoGroupBy, setTodoGroupBy] = useState<TodoColumnId | null>(null);
  const [todoCollapsedGroups, setTodoCollapsedGroups] = useState<Set<string>>(new Set());
  const [todoColumnCalcs, setTodoColumnCalcs] = useState<Partial<Record<TodoColumnId, TodoColumnCalcOp>>>(
    {}
  );
  const [todoColumnWidths, setTodoColumnWidths] = useState<Partial<Record<TodoColumnId, number>>>({});
  const [todoQuery, setTodoQuery] = useState("");
  const todoColumnMenuRef = useRef<HTMLDivElement | null>(null);
  const todoColumnMenuListRef = useRef<HTMLDivElement | null>(null);
  const todoColumnMenuFilterInputRef = useRef<HTMLInputElement | null>(null);
  const todoColumnMenuAnchorRef = useRef<HTMLElement | null>(null);
  const todoColumnMenuCloseTimerRef = useRef<number | null>(null);

  const todoColumnLabels = useMemo<Record<TodoColumnId, string>>(() => {
    const base: Record<TodoColumnId, string> = {
      application: t("Application"),
      task: t("Task"),
      task_location: t("Task Location"),
      notes: t("Notes"),
      documents_links: t("Documents / Links"),
      due_date: t("Due Date"),
      status: t("Status"),
      actions: t("Actions")
    };
    return {
      application: todoColumnLabelOverrides.application || base.application,
      task: todoColumnLabelOverrides.task || base.task,
      task_location: todoColumnLabelOverrides.task_location || base.task_location,
      notes: todoColumnLabelOverrides.notes || base.notes,
      documents_links: todoColumnLabelOverrides.documents_links || base.documents_links,
      due_date: todoColumnLabelOverrides.due_date || base.due_date,
      status: todoColumnLabelOverrides.status || base.status,
      actions: todoColumnLabelOverrides.actions || base.actions
    };
  }, [t, todoColumnLabelOverrides]);

  const weekdayLabels = useMemo(() => buildWeekdayLabels(locale), [locale]);
  useEffect(() => {
    if (!selected) return;
    const exists = applications.some((app) => app.application_id === selected);
    if (!exists) {
      setSelected("");
    }
  }, [applications, selected]);

  useEffect(() => {
    if (!detailApp) {
      detailIdRef.current = null;
      return;
    }
    if (detailIdRef.current === detailApp.id) {
      return;
    }
    detailIdRef.current = detailApp.id;
    setDetailDraft({
      notes: detailApp.notes || "",
      job_description: detailApp.job_description || "",
      improvement_areas: detailApp.improvement_areas || "",
      skill_to_upgrade: detailApp.skill_to_upgrade || "",
      documents_links: detailApp.documents_links || "",
      company_score: detailApp.company_score ?? null
    });
  }, [detailApp]);

  useEffect(() => {
    if (!detailApp) return;
    const updated = applications.find((app) => app.id === detailApp.id);
    if (updated && updated !== detailApp) {
      setDetailApp(updated);
    }
  }, [applications, detailApp]);

  const events = useMemo<CalendarEvent[]>(() => {
    const items: CalendarEvent[] = [];
    applications.forEach((app) => {
      if (app.interview_datetime) {
        const date = new Date(app.interview_datetime);
        if (!Number.isNaN(date.getTime())) {
          items.push({
            id: `${app.application_id}-interview-${date.getTime()}`,
            appId: app.id,
            applicationId: app.application_id,
            type: "Interview",
            company: app.company_name,
            position: app.position,
            date,
            dateKey: toDateKey(date),
            dateLabel: date.toLocaleDateString(),
            timeLabel: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          });
        }
      }
      if (app.followup_date) {
        const date = new Date(app.followup_date);
        if (!Number.isNaN(date.getTime())) {
          items.push({
            id: `${app.application_id}-followup-${date.getTime()}`,
            appId: app.id,
            applicationId: app.application_id,
            type: "Follow-Up",
            company: app.company_name,
            position: app.position,
            date,
            dateKey: toDateKey(date),
            dateLabel: date.toLocaleDateString()
          });
        }
      }
      const todoItems = app.todo_items || [];
      todoItems.forEach((todo) => {
        const date = parseLocalDateOnly(todo.due_date);
        if (!date) return;
        items.push({
          id: `${app.application_id}-todo-${todo.id}`,
          appId: app.id,
          applicationId: app.application_id,
          todoId: todo.id,
          type: "To-Do",
          company: app.company_name,
          position: todo.task,
          date,
          dateKey: toDateKey(date),
          dateLabel: date.toLocaleDateString()
        });
      });
    });
    return items.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [applications]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    events.forEach((event) => {
      const list = map.get(event.dateKey);
      if (list) {
        list.push(event);
      } else {
        map.set(event.dateKey, [event]);
      }
    });
    return map;
  }, [events]);

  const alerts = useMemo(() => {
    const items: Array<{
      id: string;
      type: "Follow-Up" | "To-Do";
      company: string;
      detail: string;
      date?: string | null;
      status: ReturnType<typeof followupStatus>;
    }> = [];

    applications.forEach((app) => {
      const followupStatusValue = followupStatus(app.followup_date);
      if (followupStatusValue === "overdue" || followupStatusValue === "soon") {
        items.push({
          id: `${app.application_id}-followup`,
          type: "Follow-Up",
          company: app.company_name,
          detail: app.position,
          date: app.followup_date,
          status: followupStatusValue
        });
      }

      (app.todo_items || []).forEach((todo) => {
        const todoStatus = followupStatus(todo.due_date);
        if (todoStatus === "overdue" || todoStatus === "soon") {
          items.push({
            id: `${app.application_id}-todo-${todo.id}`,
            type: "To-Do",
            company: app.company_name,
            detail: todo.task,
            date: todo.due_date,
            status: todoStatus
          });
        }
      });
    });

    return items;
  }, [applications]);

  const calendarDays = useMemo(() => {
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const weekdayOffset = (firstOfMonth.getDay() + 6) % 7;
    const start = new Date(firstOfMonth);
    start.setDate(firstOfMonth.getDate() - weekdayOffset);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [cursor]);

  const monthLabel = useMemo(
    () => cursor.toLocaleDateString(locale, { month: "long", year: "numeric" }),
    [cursor, locale]
  );

  const eventsThisMonth = useMemo(
    () =>
      events.filter(
        (event) =>
          event.date.getFullYear() === cursor.getFullYear() &&
          event.date.getMonth() === cursor.getMonth()
      ).length,
    [events, cursor]
  );

  const selectedEvents = selectedDay ? eventsByDay.get(selectedDay) ?? [] : [];
  const hasApplications = applications.length > 0;
  const appById = useMemo(() => new Map(applications.map((app) => [app.id, app])), [applications]);
  const appByApplicationId = useMemo(() => {
    return new Map(applications.map((app) => [app.application_id, app]));
  }, [applications]);
  const companyOptions = useMemo(() => {
    const set = new Set(applications.map((app) => app.company_name).filter(Boolean));
    return Array.from(set);
  }, [applications]);
  const positionOptions = useMemo(() => {
    const set = new Set(applications.map((app) => app.position).filter(Boolean));
    return Array.from(set);
  }, [applications]);
  const applicationOptions = useMemo(
    () =>
      applications.map((app) => ({
        value: app.application_id,
        label: `${app.company_name} — ${app.position}`,
        appId: app.id
      })),
    [applications]
  );
  const applicationSelectOptions = useMemo<SelectOption[]>(
    () =>
      applicationOptions.map((app) => ({
        label: app.value,
        display: app.label
      })),
    [applicationOptions]
  );
  const todoCreateApp = todoCreateAppId ? appByApplicationId.get(todoCreateAppId) : null;
  const todoDetailEntry = useMemo(() => {
    if (!todoDetail) return null;
    const app = appById.get(todoDetail.appId);
    if (!app) return null;
    const todo = (app.todo_items || []).find((item) => item.id === todoDetail.todoId);
    if (!todo) return null;
    return { app, todo };
  }, [todoDetail, appById, applications]);
  const todoEditEntry = useMemo(() => {
    if (!todoEdit) return null;
    const app = appById.get(todoEdit.appId);
    if (!app) return null;
    const todo = (app.todo_items || []).find((item) => item.id === todoEdit.todoId);
    if (!todo) return null;
    return { app, todo };
  }, [todoEdit, appById, applications]);
  useEffect(() => {
    if (!todoDetailEntry) {
      todoDetailKeyRef.current = null;
      setTodoDetailDraft(null);
      return;
    }
    const key = `${todoDetailEntry.app.id}-${todoDetailEntry.todo.id}`;
    if (todoDetailKeyRef.current === key) {
      return;
    }
    todoDetailKeyRef.current = key;
    setTodoDetailDraft({
      task: todoDetailEntry.todo.task || "",
      due_date: todoDetailEntry.todo.due_date || "",
      status: normalizeTodoStatus(todoDetailEntry.todo.status),
      task_location: todoDetailEntry.todo.task_location || "",
      notes: todoDetailEntry.todo.notes || "",
      documents_links: todoDetailEntry.todo.documents_links || "",
      company_name: todoDetailEntry.app.company_name || "",
      position: todoDetailEntry.app.position || ""
    });
  }, [todoDetailEntry]);

  useEffect(() => {
    if (!todoEditEntry) {
      todoEditKeyRef.current = null;
      setTodoEditDraft(null);
      return;
    }
    const key = `${todoEditEntry.app.id}-${todoEditEntry.todo.id}`;
    if (todoEditKeyRef.current === key) {
      return;
    }
    todoEditKeyRef.current = key;
    setTodoEditDraft({
      task: todoEditEntry.todo.task || "",
      due_date: todoEditEntry.todo.due_date || "",
      status: normalizeTodoStatus(todoEditEntry.todo.status),
      task_location: todoEditEntry.todo.task_location || "",
      notes: todoEditEntry.todo.notes || "",
      documents_links: todoEditEntry.todo.documents_links || "",
      company_name: todoEditEntry.app.company_name || "",
      position: todoEditEntry.app.position || ""
    });
  }, [todoEditEntry]);

  useEffect(() => {
    if (todoDetail && !todoDetailEntry) {
      setTodoDetail(null);
    }
  }, [todoDetail, todoDetailEntry]);

  useEffect(() => {
    if (todoEdit && !todoEditEntry) {
      setTodoEdit(null);
    }
  }, [todoEdit, todoEditEntry]);
  const todoRows = useMemo<TodoRow[]>(() => {
    const rows: TodoRow[] = [];
    applications.forEach((app) => {
      (app.todo_items || []).forEach((todo) => {
        rows.push({
          appId: app.id,
          applicationId: app.application_id,
          company: app.company_name,
          position: app.position,
          todo
        });
      });
    });
    return rows;
  }, [applications]);
  const getTodoColumnKind = useCallback((col: TodoColumnId): TodoColumnKind => {
    if (col === "application") return "select";
    if (col === "due_date") return "date";
    if (col === "status") return "select";
    if (col === "documents_links") return "links";
    return "text";
  }, []);

  const todoCellToString = useCallback((row: TodoRow, col: TodoColumnId): string => {
    if (col === "application") return `${row.applicationId} ${row.company} ${row.position}`.trim();
    if (col === "task") return row.todo.task || "";
    if (col === "task_location") return row.todo.task_location || "";
    if (col === "notes") return row.todo.notes || "";
    if (col === "documents_links") return row.todo.documents_links || "";
    if (col === "due_date") return row.todo.due_date || "";
    if (col === "status") return normalizeTodoStatus(row.todo.status);
    return "";
  }, []);

  const filteredTodos = useMemo(() => {
    const base = selected ? todoRows.filter((row) => row.applicationId === selected) : todoRows;
    const normalizedQuery = todoQuery.trim().toLowerCase();
    const byQuery = normalizedQuery
      ? base.filter((row) => {
          const status = normalizeTodoStatus(row.todo.status);
          const haystack = [
            row.applicationId,
            row.company,
            row.position,
            row.todo.task || "",
            row.todo.task_location || "",
            row.todo.notes || "",
            row.todo.documents_links || "",
            row.todo.due_date || "",
            status
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(normalizedQuery);
        })
      : base;

    const activeFilters = Object.entries(todoColumnFilters).filter(
      ([, raw]) => typeof raw === "string" && raw.trim().length > 0
    ) as Array<[TodoColumnId, string]>;
    if (activeFilters.length === 0) return byQuery;

    return byQuery.filter((row) =>
      activeFilters.every(([col, raw]) => todoCellToString(row, col).toLowerCase().includes(raw.trim().toLowerCase()))
    );
  }, [todoRows, selected, todoQuery, todoColumnFilters, todoCellToString]);
  const pendingTodos = useMemo(
    () => filteredTodos.filter((row) => normalizeTodoStatus(row.todo.status) !== "Done").length,
    [filteredTodos]
  );
  const orderedTodos = useMemo(() => {
    if (todoSortConfig) {
      const dir = todoSortConfig.direction === "asc" ? 1 : -1;
      const column = todoSortConfig.column;
      const kind = getTodoColumnKind(column);
      return [...filteredTodos].sort((a, b) => {
        const aRaw = todoCellToString(a, column);
        const bRaw = todoCellToString(b, column);
        if (kind === "date") {
          const aDate = aRaw ? Date.parse(aRaw) : Number.NaN;
          const bDate = bRaw ? Date.parse(bRaw) : Number.NaN;
          const safeA = Number.isNaN(aDate) ? Number.MAX_SAFE_INTEGER : aDate;
          const safeB = Number.isNaN(bDate) ? Number.MAX_SAFE_INTEGER : bDate;
          if (safeA < safeB) return -1 * dir;
          if (safeA > safeB) return 1 * dir;
          return 0;
        }
        const aNorm = aRaw.toLowerCase();
        const bNorm = bRaw.toLowerCase();
        if (aNorm < bNorm) return -1 * dir;
        if (aNorm > bNorm) return 1 * dir;
        return 0;
      });
    }
    return [...filteredTodos].sort((a, b) => {
      const aDate = a.todo.due_date ? Date.parse(a.todo.due_date) : Number.NaN;
      const bDate = b.todo.due_date ? Date.parse(b.todo.due_date) : Number.NaN;
      const safeA = Number.isNaN(aDate) ? Number.MAX_SAFE_INTEGER : aDate;
      const safeB = Number.isNaN(bDate) ? Number.MAX_SAFE_INTEGER : bDate;
      if (safeA !== safeB) {
        return safeA - safeB;
      }
      return (a.todo.task || "").localeCompare(b.todo.task || "");
    });
  }, [filteredTodos, getTodoColumnKind, todoCellToString, todoSortConfig]);

  const rowsForDisplay = useMemo(() => {
    if (!todoGroupBy) return orderedTodos;
    const next = [...orderedTodos];
    next.sort((a, b) => {
      const aKey = todoCellToString(a, todoGroupBy).trim() || "(Empty)";
      const bKey = todoCellToString(b, todoGroupBy).trim() || "(Empty)";
      if (aKey === bKey) return 0;
      if (aKey === "(Empty)") return 1;
      if (bKey === "(Empty)") return -1;
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    });
    return next;
  }, [orderedTodos, todoGroupBy, todoCellToString]);

  const todoGroupCounts = useMemo(() => {
    if (!todoGroupBy) return null;
    const map = new Map<string, number>();
    rowsForDisplay.forEach((row) => {
      const key = todoCellToString(row, todoGroupBy).trim() || "(Empty)";
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [rowsForDisplay, todoGroupBy, todoCellToString]);

  const orderedTodoColumns = useMemo(
    () => normalizeTodoColumnOrder(todoColumnOrder),
    [todoColumnOrder]
  );

  const visibleTodoColumns = useMemo(
    () => orderedTodoColumns.filter((col) => col === "actions" || !todoHiddenColumns.includes(col)),
    [orderedTodoColumns, todoHiddenColumns]
  );

  const hiddenTodoColumns = useMemo(
    () => orderedTodoColumns.filter((col) => col !== "actions" && todoHiddenColumns.includes(col)),
    [orderedTodoColumns, todoHiddenColumns]
  );

  const calcTodoValue = useCallback(
    (row: TodoRow, col: TodoColumnId): string | number | boolean | null => {
      const kind = getTodoColumnKind(col);
      const raw = todoCellToString(row, col);
      if (kind === "number" || kind === "rating") {
        if (!raw) return null;
        const num = Number(raw);
        return Number.isNaN(num) ? null : num;
      }
      if (kind === "checkbox") return raw === "true";
      return raw;
    },
    [getTodoColumnKind, todoCellToString]
  );

  const calcTodoResultFor = useCallback(
    (col: TodoColumnId): string => {
      const op = todoColumnCalcs[col] || "none";
      if (op === "none") return "";
      const rows = rowsForDisplay;
      if (op === "count") return String(rows.length);

      const values = rows.map((row) => calcTodoValue(row, col));
      const isEmpty = (value: unknown) =>
        value === null ||
        value === undefined ||
        value === "" ||
        (typeof value === "string" && !value.trim());

      if (op === "count_values") return String(values.filter((value) => !isEmpty(value)).length);
      if (op === "count_empty") return String(values.filter((value) => isEmpty(value)).length);
      if (op === "unique") {
        const set = new Set<string>();
        values.forEach((value) => {
          if (isEmpty(value)) return;
          set.add(String(value));
        });
        return String(set.size);
      }
      if (op === "checked" || op === "unchecked") {
        const want = op === "checked";
        return String(values.filter((value) => Boolean(value) === want).length);
      }

      const nums = values
        .map((value) => (typeof value === "number" ? value : null))
        .filter((value): value is number => value !== null);
      if (nums.length === 0) return "—";
      if (op === "sum") return String(nums.reduce((acc, value) => acc + value, 0));
      if (op === "avg") return String(Math.round((nums.reduce((acc, value) => acc + value, 0) / nums.length) * 100) / 100);
      if (op === "min") return String(Math.min(...nums));
      if (op === "max") return String(Math.max(...nums));
      return "";
    },
    [calcTodoValue, rowsForDisplay, todoColumnCalcs]
  );

  const showTodoCalcRow = useMemo(
    () => visibleTodoColumns.some((col) => (todoColumnCalcs[col] || "none") !== "none"),
    [todoColumnCalcs, visibleTodoColumns]
  );

  useEffect(() => {
    if (!todoPinnedColumn) return;
    if (todoHiddenColumns.includes(todoPinnedColumn)) {
      setTodoPinnedColumn(null);
      return;
    }
    if (orderedTodoColumns[0] !== todoPinnedColumn) {
      setTodoColumnOrder((prev) => [
        todoPinnedColumn,
        ...prev.filter((col) => col !== todoPinnedColumn)
      ]);
    }
  }, [todoHiddenColumns, todoPinnedColumn, orderedTodoColumns]);

  useEffect(() => {
    writeTodoTablePrefs({
      order: orderedTodoColumns,
      hidden: todoHiddenColumns,
      pinned: todoPinnedColumn,
      labels: todoColumnLabelOverrides
    });
  }, [orderedTodoColumns, todoHiddenColumns, todoPinnedColumn, todoColumnLabelOverrides]);

  const reorderTodoColumns = useCallback((from: TodoColumnId, to: TodoColumnId) => {
    if (from === to) return;
    setTodoColumnOrder((prev) => {
      const fromIndex = prev.indexOf(from);
      const toIndex = prev.indexOf(to);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const next = [...prev];
      next.splice(fromIndex, 1);
      next.splice(toIndex, 0, from);
      return next;
    });
  }, []);

  const toggleTodoColumnHidden = useCallback((col: TodoColumnId) => {
    if (col === "actions") return;
    setTodoHiddenColumns((prev) => {
      if (prev.includes(col)) return prev.filter((item) => item !== col);
      return [...prev, col];
    });
    setTodoColumnFilters((prev) => ({ ...prev, [col]: "" }));
    setTodoSortConfig((prev) => (prev?.column === col ? null : prev));
    setTodoGroupBy((prev) => (prev === col ? null : prev));
    setTodoPinnedColumn((prev) => (prev === col ? null : prev));
  }, []);

  const showAllTodoColumns = useCallback(() => {
    setTodoHiddenColumns([]);
  }, []);

  const pinTodoColumn = useCallback((col: TodoColumnId) => {
    if (col === "actions") return;
    setTodoPinnedColumn(col);
    setTodoHiddenColumns((prev) => prev.filter((item) => item !== col));
    setTodoColumnOrder((prev) => [col, ...prev.filter((item) => item !== col)]);
  }, []);

  const unpinTodoColumn = useCallback(() => {
    setTodoPinnedColumn(null);
  }, []);

  const fitTodoColumnToContent = useCallback(
    (col: TodoColumnId) => {
      const header = todoColumnLabels[col] || col;
      const values = rowsForDisplay.map((row) => todoCellToString(row, col));
      const maxChars = Math.max(header.length, ...values.map((value) => value.length));
      const nextWidth = clamp(maxChars * 8 + 40, 120, 560);
      setTodoColumnWidths((prev) => ({ ...prev, [col]: nextWidth }));
    },
    [rowsForDisplay, todoCellToString, todoColumnLabels]
  );

  const setTodoMenuView = useCallback((next: TodoColumnMenuView) => {
    setTodoColumnMenuView(next);
    setTodoColumnMenuActiveIndex(0);
    window.requestAnimationFrame(() => {
      if (next !== "filter") todoColumnMenuListRef.current?.focus();
    });
  }, []);

  const closeTodoColumnMenuImmediate = useCallback(() => {
    if (todoColumnMenuCloseTimerRef.current) {
      window.clearTimeout(todoColumnMenuCloseTimerRef.current);
      todoColumnMenuCloseTimerRef.current = null;
    }
    setTodoColumnMenu(null);
    setTodoColumnMenuPos(null);
    setTodoColumnMenuPlacement("bottom");
    setTodoColumnMenuVisible(false);
    setTodoColumnMenuView("root");
    setTodoColumnMenuActiveIndex(0);
    todoColumnMenuAnchorRef.current = null;
  }, []);

  const closeTodoColumnMenu = useCallback(() => {
    if (!todoColumnMenu) return;
    todoColumnMenuAnchorRef.current?.focus?.();
    setTodoColumnMenuVisible(false);
    if (todoColumnMenuCloseTimerRef.current) {
      window.clearTimeout(todoColumnMenuCloseTimerRef.current);
    }
    todoColumnMenuCloseTimerRef.current = window.setTimeout(() => {
      closeTodoColumnMenuImmediate();
    }, TODO_COLUMN_MENU_ANIM_MS);
  }, [closeTodoColumnMenuImmediate, todoColumnMenu]);

  const computeTodoColumnMenuPos = useCallback((anchor: HTMLElement, menuEl?: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const menuWidth = menuEl?.offsetWidth || TODO_COLUMN_MENU_WIDTH;
    const menuHeight = menuEl?.offsetHeight || TODO_COLUMN_MENU_HEIGHT_ESTIMATE;
    const maxLeft = Math.max(TODO_COLUMN_MENU_GUTTER, window.innerWidth - menuWidth - TODO_COLUMN_MENU_GUTTER);
    const left = clamp(rect.left, TODO_COLUMN_MENU_GUTTER, maxLeft);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const shouldFlip = spaceBelow < menuHeight + TODO_COLUMN_MENU_OFFSET && spaceAbove > spaceBelow;
    const placement: "top" | "bottom" = shouldFlip ? "top" : "bottom";
    const rawTop =
      placement === "bottom"
        ? rect.bottom + TODO_COLUMN_MENU_OFFSET
        : rect.top - menuHeight - TODO_COLUMN_MENU_OFFSET;
    const maxTop = Math.max(TODO_COLUMN_MENU_GUTTER, window.innerHeight - menuHeight - TODO_COLUMN_MENU_GUTTER);
    const top = clamp(rawTop, TODO_COLUMN_MENU_GUTTER, maxTop);
    return { top, left, placement };
  }, []);

  const applyTodoColumnRename = useCallback(() => {
    if (!todoColumnMenu) return;
    const col = todoColumnMenu.col;
    const nextLabel = todoColumnMenu.rename.trim();
    if (!nextLabel) {
      setTodoColumnMenu((prev) => (prev ? { ...prev, rename: todoColumnLabels[col] } : prev));
      return;
    }
    setTodoColumnLabelOverrides((prev) => ({
      ...prev,
      [col]: nextLabel
    }));
  }, [todoColumnLabels, todoColumnMenu]);

  const openTodoColumnMenu = useCallback(
    (col: TodoColumnId, anchor: HTMLElement) => {
      if (todoColumnMenuCloseTimerRef.current) {
        window.clearTimeout(todoColumnMenuCloseTimerRef.current);
        todoColumnMenuCloseTimerRef.current = null;
      }
      todoColumnMenuAnchorRef.current = anchor;
      setTodoColumnMenuView("root");
      setTodoColumnMenuActiveIndex(0);
      setTodoColumnMenuVisible(false);
      const pos = computeTodoColumnMenuPos(anchor);
      setTodoColumnMenuPlacement(pos.placement);
      setTodoColumnMenuPos({ top: pos.top, left: pos.left });
      setTodoColumnMenu({
        col,
        rename: todoColumnLabels[col],
        filter: todoColumnFilters[col] || ""
      });
    },
    [computeTodoColumnMenuPos, todoColumnFilters, todoColumnLabels]
  );

  useEffect(() => {
    if (!todoColumnMenu) return;
    const handleOutside = (event: MouseEvent) => {
      if (!todoColumnMenuRef.current) return;
      if (event.target instanceof Node && !todoColumnMenuRef.current.contains(event.target)) {
        closeTodoColumnMenu();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeTodoColumnMenu();
      }
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [closeTodoColumnMenu, todoColumnMenu]);

  useEffect(() => {
    return () => {
      if (todoColumnMenuCloseTimerRef.current) {
        window.clearTimeout(todoColumnMenuCloseTimerRef.current);
        todoColumnMenuCloseTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!todoColumnMenu) return;
    if (todoColumnMenuView === "filter") return;
    const raf = window.requestAnimationFrame(() => {
      setTodoColumnMenuVisible(true);
      const active = document.activeElement;
      const insideMenu = active && todoColumnMenuRef.current ? todoColumnMenuRef.current.contains(active) : false;
      if (!insideMenu) {
        todoColumnMenuListRef.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [todoColumnMenu?.col, todoColumnMenuView]);

  useEffect(() => {
    if (!todoColumnMenu || todoColumnMenuView !== "filter") return;
    const raf = window.requestAnimationFrame(() => {
      todoColumnMenuFilterInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [todoColumnMenu, todoColumnMenuView]);

  useEffect(() => {
    if (!todoColumnMenu || !todoColumnMenuAnchorRef.current) return;
    const updatePosition = () => {
      if (!todoColumnMenuAnchorRef.current) return;
      const pos = computeTodoColumnMenuPos(todoColumnMenuAnchorRef.current, todoColumnMenuRef.current || undefined);
      setTodoColumnMenuPlacement(pos.placement);
      setTodoColumnMenuPos({ top: pos.top, left: pos.left });
    };
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [todoColumnMenu, todoColumnMenuView, computeTodoColumnMenuPos]);

  type MenuEntry =
    | { kind: "separator"; key: string }
    | {
        kind: "item";
        key: string;
        label: string;
        icon: React.ReactNode;
        disabled?: boolean;
        submenu?: TodoColumnMenuView;
        end?: React.ReactNode;
        action?: () => void;
      };

  const todoMenuCol = todoColumnMenu?.col || null;
  const todoMenuKind = todoMenuCol ? getTodoColumnKind(todoMenuCol) : "text";
  const todoMenuPinned = Boolean(todoMenuCol && todoPinnedColumn === todoMenuCol);
  const todoMenuCanMove = Boolean(todoMenuCol && todoMenuCol !== "actions");
  const todoMenuCanHide = Boolean(todoMenuCol && todoMenuCol !== "actions");
  const todoMenuCanFit = Boolean(todoMenuCol && todoMenuCol !== "actions");
  const todoMenuFilterActive = Boolean(
    todoMenuCol && (todoColumnFilters[todoMenuCol] || "").trim().length > 0
  );
  const todoMenuSortActive = Boolean(todoMenuCol && todoSortConfig?.column === todoMenuCol);
  const todoMenuGroupActive = Boolean(todoMenuCol && todoGroupBy === todoMenuCol);
  const todoMenuCurrentCalc: TodoColumnCalcOp = todoMenuCol ? todoColumnCalcs[todoMenuCol] || "none" : "none";

  const iconBack = <span className="column-menu-back">←</span>;
  const iconChangeType = <span>⇅</span>;
  const iconFilter = <span>F</span>;
  const iconSort = <span>S</span>;
  const iconGroup = <span>G</span>;
  const iconCalc = <span>C</span>;
  const iconPin = <span>P</span>;
  const iconHide = <span>H</span>;
  const iconFit = <span>↔</span>;
  const iconInsertLeft = <span>&lt;+</span>;
  const iconInsertRight = <span>+&gt;</span>;
  const iconDuplicate = <span>D</span>;
  const iconDelete = <span>X</span>;

  const menuEntries: MenuEntry[] = (() => {
    if (!todoMenuCol) return [];
    const backEntry: MenuEntry = {
      kind: "item",
      key: "back",
      label: "Volver",
      icon: iconBack,
      action: () => setTodoMenuView("root")
    };
    if (todoColumnMenuView === "type") {
      const mkType = (type: TodoColumnKind, label: string): MenuEntry => ({
        kind: "item",
        key: `type-${type}`,
        label,
        icon: iconChangeType,
        disabled: true,
        end: todoMenuKind === type ? <span className="column-menu-check">✓</span> : undefined
      });
      return [
        backEntry,
        mkType("text", "Texto"),
        mkType("number", "Numero"),
        mkType("select", "Seleccion"),
        mkType("date", "Fecha"),
        mkType("checkbox", "Casilla"),
        mkType("rating", "Valoracion"),
        { kind: "separator", key: "type-sep-0" },
        mkType("contacts", "Contactos"),
        mkType("links", "Links"),
        mkType("documents", "Documento")
      ];
    }
    if (todoColumnMenuView === "sort") {
      return [
        backEntry,
        {
          kind: "item",
          key: "sort-asc",
          label: "A → Z",
          icon: iconSort,
          end:
            todoMenuSortActive && todoSortConfig?.direction === "asc" ? (
              <span className="column-menu-check">✓</span>
            ) : undefined,
          action: () => {
            setTodoSortConfig({ column: todoMenuCol, direction: "asc" });
            closeTodoColumnMenu();
          }
        },
        {
          kind: "item",
          key: "sort-desc",
          label: "Z → A",
          icon: iconSort,
          end:
            todoMenuSortActive && todoSortConfig?.direction === "desc" ? (
              <span className="column-menu-check">✓</span>
            ) : undefined,
          action: () => {
            setTodoSortConfig({ column: todoMenuCol, direction: "desc" });
            closeTodoColumnMenu();
          }
        },
        ...(todoMenuSortActive
          ? ([
              {
                kind: "item",
                key: "sort-clear",
                label: "Quitar orden",
                icon: iconSort,
                action: () => {
                  setTodoSortConfig(null);
                  closeTodoColumnMenu();
                }
              }
            ] as MenuEntry[])
          : [])
      ];
    }
    if (todoColumnMenuView === "group") {
      return [
        backEntry,
        {
          kind: "item",
          key: "group-toggle",
          label: todoMenuGroupActive ? "Quitar grupo" : "Agrupar por esta columna",
          icon: iconGroup,
          end: todoMenuGroupActive ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setTodoCollapsedGroups(new Set());
            setTodoGroupBy((prev) => (prev === todoMenuCol ? null : todoMenuCol));
            closeTodoColumnMenu();
          }
        }
      ];
    }
    if (todoColumnMenuView === "calculate") {
      const isNumeric = todoMenuKind === "number" || todoMenuKind === "rating";
      const isCheckbox = todoMenuKind === "checkbox";
      const entries: MenuEntry[] = [
        backEntry,
        {
          kind: "item",
          key: "calc-none",
          label: "Ninguno",
          icon: iconCalc,
          end: todoMenuCurrentCalc === "none" ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setTodoColumnCalcs((prev) => ({ ...prev, [todoMenuCol]: "none" }));
            setTodoMenuView("root");
          }
        },
        {
          kind: "item",
          key: "calc-count",
          label: "Contar filas",
          icon: iconCalc,
          end: todoMenuCurrentCalc === "count" ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setTodoColumnCalcs((prev) => ({ ...prev, [todoMenuCol]: "count" }));
            setTodoMenuView("root");
          }
        },
        {
          kind: "item",
          key: "calc-count-values",
          label: "Contar valores",
          icon: iconCalc,
          end: todoMenuCurrentCalc === "count_values" ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setTodoColumnCalcs((prev) => ({ ...prev, [todoMenuCol]: "count_values" }));
            setTodoMenuView("root");
          }
        },
        {
          kind: "item",
          key: "calc-count-empty",
          label: "Contar vacios",
          icon: iconCalc,
          end: todoMenuCurrentCalc === "count_empty" ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setTodoColumnCalcs((prev) => ({ ...prev, [todoMenuCol]: "count_empty" }));
            setTodoMenuView("root");
          }
        },
        {
          kind: "item",
          key: "calc-unique",
          label: "Valores unicos",
          icon: iconCalc,
          end: todoMenuCurrentCalc === "unique" ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setTodoColumnCalcs((prev) => ({ ...prev, [todoMenuCol]: "unique" }));
            setTodoMenuView("root");
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
            end: todoMenuCurrentCalc === "sum" ? <span className="column-menu-check">✓</span> : undefined,
            action: () => {
              setTodoColumnCalcs((prev) => ({ ...prev, [todoMenuCol]: "sum" }));
              setTodoMenuView("root");
            }
          },
          {
            kind: "item",
            key: "calc-avg",
            label: "Media",
            icon: iconCalc,
            end: todoMenuCurrentCalc === "avg" ? <span className="column-menu-check">✓</span> : undefined,
            action: () => {
              setTodoColumnCalcs((prev) => ({ ...prev, [todoMenuCol]: "avg" }));
              setTodoMenuView("root");
            }
          },
          {
            kind: "item",
            key: "calc-min",
            label: "Minimo",
            icon: iconCalc,
            end: todoMenuCurrentCalc === "min" ? <span className="column-menu-check">✓</span> : undefined,
            action: () => {
              setTodoColumnCalcs((prev) => ({ ...prev, [todoMenuCol]: "min" }));
              setTodoMenuView("root");
            }
          },
          {
            kind: "item",
            key: "calc-max",
            label: "Maximo",
            icon: iconCalc,
            end: todoMenuCurrentCalc === "max" ? <span className="column-menu-check">✓</span> : undefined,
            action: () => {
              setTodoColumnCalcs((prev) => ({ ...prev, [todoMenuCol]: "max" }));
              setTodoMenuView("root");
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
            end: todoMenuCurrentCalc === "checked" ? <span className="column-menu-check">✓</span> : undefined,
            action: () => {
              setTodoColumnCalcs((prev) => ({ ...prev, [todoMenuCol]: "checked" }));
              setTodoMenuView("root");
            }
          },
          {
            kind: "item",
            key: "calc-unchecked",
            label: "Sin marcar",
            icon: iconCalc,
            end: todoMenuCurrentCalc === "unchecked" ? <span className="column-menu-check">✓</span> : undefined,
            action: () => {
              setTodoColumnCalcs((prev) => ({ ...prev, [todoMenuCol]: "unchecked" }));
              setTodoMenuView("root");
            }
          }
        );
      }
      return entries;
    }
    if (todoColumnMenuView === "filter") {
      return [
        backEntry,
        ...(todoMenuFilterActive
          ? ([
              {
                kind: "item",
                key: "filter-clear",
                label: "Borrar filtro",
                icon: iconFilter,
                action: () => {
                  setTodoColumnFilters((prev) => ({ ...prev, [todoMenuCol]: "" }));
                  setTodoColumnMenu((prev) => (prev ? { ...prev, filter: "" } : prev));
                }
              }
            ] as MenuEntry[])
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
        end: <span>›</span>
      },
      { kind: "separator", key: "sep-0" },
      {
        kind: "item",
        key: "filter",
        label: "Filtrar",
        icon: iconFilter,
        submenu: "filter"
      },
      {
        kind: "item",
        key: "sort",
        label: "Ordenar",
        icon: iconSort,
        submenu: "sort"
      },
      {
        kind: "item",
        key: "group",
        label: "Grupo",
        icon: iconGroup,
        submenu: "group"
      },
      {
        kind: "item",
        key: "calc",
        label: "Calcular",
        icon: iconCalc,
        submenu: "calculate"
      },
      { kind: "separator", key: "sep-1" },
      {
        kind: "item",
        key: "pin",
        label: todoMenuPinned ? "Desfijar" : "Fijar",
        icon: iconPin,
        disabled: !todoMenuCanMove,
        action: () => {
          if (!todoMenuCanMove) return;
          if (todoMenuPinned) unpinTodoColumn();
          else pinTodoColumn(todoMenuCol);
          closeTodoColumnMenu();
        }
      },
      {
        kind: "item",
        key: "hide",
        label: "Ocultar",
        icon: iconHide,
        disabled: !todoMenuCanHide,
        action: () => {
          if (!todoMenuCanHide) return;
          toggleTodoColumnHidden(todoMenuCol);
          closeTodoColumnMenu();
        }
      },
      {
        kind: "item",
        key: "fit",
        label: "Ajustar contenido",
        icon: iconFit,
        disabled: !todoMenuCanFit,
        action: () => {
          if (!todoMenuCanFit) return;
          fitTodoColumnToContent(todoMenuCol);
          closeTodoColumnMenu();
        }
      },
      { kind: "separator", key: "sep-2" },
      {
        kind: "item",
        key: "insert-left",
        label: "Insertar a la izquierda",
        icon: iconInsertLeft,
        disabled: true
      },
      {
        kind: "item",
        key: "insert-right",
        label: "Insertar a la derecha",
        icon: iconInsertRight,
        disabled: true
      },
      {
        kind: "item",
        key: "duplicate",
        label: "Duplicar propiedad",
        icon: iconDuplicate,
        disabled: true
      },
      {
        kind: "item",
        key: "delete",
        label: "Eliminar propiedad",
        icon: iconDelete,
        disabled: true
      }
    ];
  })();

  const todoMenuActiveId =
    menuEntries[todoColumnMenuActiveIndex]?.kind === "item"
      ? `todo-column-menu-${todoColumnMenuView}-${todoColumnMenuActiveIndex}`
      : undefined;

  const moveTodoMenuActive = (dir: -1 | 1) => {
    if (menuEntries.length === 0) return;
    let idx = todoColumnMenuActiveIndex;
    for (let i = 0; i < menuEntries.length; i += 1) {
      idx = (idx + dir + menuEntries.length) % menuEntries.length;
      if (menuEntries[idx]?.kind === "item") {
        setTodoColumnMenuActiveIndex(idx);
        return;
      }
    }
  };

  const activateTodoMenuActive = () => {
    const entry = menuEntries[todoColumnMenuActiveIndex];
    if (!entry || entry.kind !== "item") return;
    if (entry.disabled) return;
    if (entry.submenu) {
      setTodoMenuView(entry.submenu);
      return;
    }
    entry.action?.();
  };

  const handleTodoMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const tag = target?.tagName || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeTodoColumnMenu();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeTodoColumnMenu();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveTodoMenuActive(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveTodoMenuActive(-1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateTodoMenuActive();
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const entry = menuEntries[todoColumnMenuActiveIndex];
      if (entry && entry.kind === "item" && entry.submenu && !entry.disabled) {
        setTodoMenuView(entry.submenu);
      }
      return;
    }
    if (event.key === "ArrowLeft" && todoColumnMenuView !== "root") {
      event.preventDefault();
      setTodoMenuView("root");
    }
  };

  const selectedDateLabel = useMemo(() => {
    const parts = selectedDay.split("-").map(Number);
    if (parts.length !== 3 || parts.some((value) => Number.isNaN(value))) {
      return "Selected day";
    }
    const [year, month, day] = parts;
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  }, [selectedDay]);

  const shiftMonth = (delta: number) => {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
    setCursor(next);
    setSelectedDay(toDateKey(next));
  };

  const handleToday = () => {
    const now = new Date();
    setCursor(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDay(toDateKey(now));
  };

  const updateTodoItem = async (appId: number, todoId: string, patch: Partial<TodoItem>) => {
    const app = applications.find((entry) => entry.id === appId);
    if (!app) return;
    const nextTodos = (app.todo_items || []).map((item) => {
      if (item.id !== todoId) return item;
      const next: TodoItem = { ...item, ...patch };
      if (patch.due_date !== undefined) {
        next.due_date = patch.due_date || undefined;
      }
      if (patch.status !== undefined) {
        next.status = normalizeTodoStatus(patch.status);
      }
      return next;
    });
    await updateApplication(appId, { todo_items: nextTodos });
  };

  const removeTodoItem = async (appId: number, todoId: string) => {
    const app = applications.find((entry) => entry.id === appId);
    if (!app) return;
    const nextTodos = (app.todo_items || []).filter((item) => item.id !== todoId);
    await updateApplication(appId, { todo_items: nextTodos });
  };

  const moveTodoItem = async (
    sourceAppId: number,
    todoId: string,
    targetApplicationId: string
  ) => {
    const sourceApp = applications.find((entry) => entry.id === sourceAppId);
    const targetApp = appByApplicationId.get(targetApplicationId);
    if (!sourceApp || !targetApp) return;
    if (sourceApp.application_id === targetApplicationId) return;
    const sourceTodos = sourceApp.todo_items || [];
    const item = sourceTodos.find((todo) => todo.id === todoId);
    if (!item) return;
    const nextSourceTodos = sourceTodos.filter((todo) => todo.id !== todoId);
    const nextTargetTodos = [...(targetApp.todo_items || []), item];
    await updateApplication(targetApp.id, { todo_items: nextTargetTodos });
    await updateApplication(sourceApp.id, { todo_items: nextSourceTodos });
  };

  const handleAddTodo = async () => {
    if (!hasApplications || !todoCreateDraft) return;
    const targetApp =
      appByApplicationId.get(todoCreateAppId) ||
      (selected ? appByApplicationId.get(selected) : applications[0]);
    if (!targetApp) return;
    const trimmedTask = todoCreateDraft.task.trim();
    if (!trimmedTask) return;
    const nextItem: TodoItem = {
      id: generateId(),
      task: trimmedTask,
      due_date: todoCreateDraft.due_date || undefined,
      status: normalizeTodoStatus(todoCreateDraft.status),
      task_location: todoCreateDraft.task_location.trim() || undefined,
      notes: todoCreateDraft.notes.trim() || undefined,
      documents_links: todoCreateDraft.documents_links.trim() || undefined
    };
    const nextTodos = [...(targetApp.todo_items || []), nextItem];
    const payload: Partial<Application> = { todo_items: nextTodos };
    const nextCompany = todoCreateDraft.company_name.trim();
    const nextPosition = todoCreateDraft.position.trim();
    if (nextCompany && nextCompany !== targetApp.company_name) {
      payload.company_name = nextCompany;
    }
    if (nextPosition && nextPosition !== targetApp.position) {
      payload.position = nextPosition;
    }
    await updateApplication(targetApp.id, payload);
    setTodoCreateDraft(null);
    setTodoCreateAppId("");
  };

  const openDetailsForApp = (appId: number) => {
    const app = appById.get(appId);
    if (!app) return;
    setDetailApp(app);
  };

  const openEditForApp = (appId: number) => {
    const app = appById.get(appId);
    if (!app) return;
    setEditing(app);
  };

  const openTodoCreate = () => {
    if (!hasApplications) return;
    const targetApp = selected ? appByApplicationId.get(selected) : applications[0];
    if (!targetApp) return;
    setTodoCreateAppId(targetApp.application_id);
    setTodoCreateDraft(buildTodoDraft(targetApp));
  };

  const closeTodoCreate = () => {
    setTodoCreateDraft(null);
    setTodoCreateAppId("");
  };

  const handleTodoCreateAppChange = (nextId: string) => {
    setTodoCreateAppId(nextId);
    const nextApp = appByApplicationId.get(nextId);
    setTodoCreateDraft((prev) =>
      prev
        ? {
            ...prev,
            company_name: nextApp?.company_name || "",
            position: nextApp?.position || ""
          }
        : prev
    );
  };

  const openTodoDetail = (appId: number, todoId: string) => {
    setTodoEdit(null);
    setTodoDetail({ appId, todoId });
  };

  const openTodoEdit = (appId: number, todoId: string) => {
    setTodoDetail(null);
    setTodoEdit({ appId, todoId });
  };

  const handleEventDetail = (event: CalendarEvent) => {
    if (event.type === "To-Do" && event.todoId) {
      openTodoDetail(event.appId, event.todoId);
      return;
    }
    openDetailsForApp(event.appId);
  };

  const handleEventEdit = (event: CalendarEvent) => {
    if (event.type === "To-Do" && event.todoId) {
      openTodoEdit(event.appId, event.todoId);
      return;
    }
    openEditForApp(event.appId);
  };

  const handleEventDownload = (event: CalendarEvent) => {
    void downloadEventIcs(event);
  };

  const handleUpdate = async (payload: any, files: File[] = []) => {
    if (!editing) return;
    await updateApplication(editing.id, payload);
    if (files.length > 0) {
      await uploadDocuments(editing.id, files);
      await refresh();
    }
    setEditing(null);
  };

  const handleUploadDocuments = async (appId: number, files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      await uploadDocuments(appId, Array.from(files));
      await refresh();
    } catch (error) {
      console.error("Failed to upload documents", error);
    }
  };

  const handleDeleteDocument = async (appId: number, fileId: string) => {
    try {
      await deleteDocument(appId, fileId);
      await refresh();
    } catch (error) {
      console.error("Failed to delete document", error);
    }
  };

  const handleDownloadDocument = (appId: number, fileId: string) => {
    void openExternal(documentDownloadUrl(appId, fileId));
  };

  const updateTodoFromDraft = async (app: Application, todoId: string, draft: TodoDraft) => {
    const todos = app.todo_items || [];
    let updated = false;
    const nextTodos = todos.map((item) => {
      if (item.id !== todoId) return item;
      updated = true;
      const trimmedTask = draft.task.trim();
      return {
        ...item,
        task: trimmedTask || item.task,
        due_date: draft.due_date || undefined,
        status: normalizeTodoStatus(draft.status),
        task_location: draft.task_location.trim() || undefined,
        notes: draft.notes.trim() || undefined,
        documents_links: draft.documents_links.trim() || undefined
      };
    });
    if (!updated) return;
    const nextCompany = draft.company_name.trim();
    const nextPosition = draft.position.trim();
    const payload: Partial<Application> = { todo_items: nextTodos };
    if (nextCompany && nextCompany !== app.company_name) {
      payload.company_name = nextCompany;
    }
    if (nextPosition && nextPosition !== app.position) {
      payload.position = nextPosition;
    }
    await updateApplication(app.id, payload);
  };

  const buildTodoDraft = (app?: Application | null): TodoDraft => ({
    task: "",
    due_date: "",
    status: "Not started",
    task_location: "",
    notes: "",
    documents_links: "",
    company_name: app?.company_name || "",
    position: app?.position || ""
  });

  const updateTodoDetailDraft = (patch: Partial<TodoDraft>) => {
    setTodoDetailDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const updateTodoEditDraft = (patch: Partial<TodoDraft>) => {
    setTodoEditDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const updateTodoCreateDraft = (patch: Partial<TodoDraft>) => {
    setTodoCreateDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const handleDownloadTodoIcs = (row: TodoRow) => {
    downloadTodoIcs(row.appId, row.todo.id);
  };

  const detailDocuments = detailApp?.documents_files || [];
  const detailContacts = detailApp?.contacts || [];

  const calendarSlots: Array<{
    id: string;
    content: React.ReactNode;
    toolbar?: React.ComponentProps<typeof EditableTableToolbar>["toolbar"];
  }> = [
    {
      id: "calendar:alerts",
      content:
        alerts.length === 0 ? (
          <div className="empty">{t("No event alerts.")}</div>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("Type")}</th>
                  <th>{t("Company")}</th>
                  <th>{t("Detail")}</th>
                  <th>{t("Date")}</th>
                  <th>{t("Status")}</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((item) => (
                  <tr key={item.id}>
                    <td>{item.type}</td>
                    <td>{item.company}</td>
                    <td>{item.detail}</td>
                    <td>{formatDate(item.date)}</td>
                    <td>
                      <span className={`tag tag-${item.status}`}>{item.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
    },
    {
      id: "calendar:month",
      content: (
          <>
            <div className="calendar-header">
              <div>
                <h3>{monthLabel}</h3>
                <p>{t("{count} events scheduled this month.", { count: eventsThisMonth })}</p>
              </div>
              <div className="calendar-header-actions">
                <div className="calendar-actions">
                  <button className="ghost" onClick={() => downloadIcs()}>
                    {t("Download All (ICS)")}
                  </button>
                  <button className="primary" onClick={() => downloadIcs(selected)} disabled={!selected}>
                    {t("Download Selected")}
                  </button>
                </div>
                <div className="calendar-nav">
                  <button className="ghost small" onClick={() => shiftMonth(-1)}>
                    {t("Previous")}
                  </button>
                  <button className="ghost small" onClick={handleToday}>
                    {t("Today")}
                  </button>
                  <button className="ghost small" onClick={() => shiftMonth(1)}>
                    {t("Next")}
                  </button>
                </div>
              </div>
            </div>

            <div className="calendar-layout">
              <div className="calendar-grid">
                {weekdayLabels.map((label) => (
                  <div key={label} className="calendar-weekday">
                    {label}
                  </div>
                ))}
                {calendarDays.map((date) => {
                  const key = toDateKey(date);
                  const dayEvents = eventsByDay.get(key) ?? [];
                  const isCurrentMonth = date.getMonth() === cursor.getMonth();
                  const isToday = key === toDateKey(today);
                  const isSelected = key === selectedDay;
                  const visibleEvents = dayEvents.slice(0, 2);
                  const remainingEvents = dayEvents.length - visibleEvents.length;
                  return (
                    <button
                      key={key}
                      type="button"
                      className={[
                        "calendar-cell",
                        isCurrentMonth ? "current" : "muted",
                        isToday ? "today" : "",
                        isSelected ? "selected" : ""
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => setSelectedDay(key)}
                    >
                      <div className="calendar-day-header">
                        <span className="calendar-day-number">{date.getDate()}</span>
                        {dayEvents.length > 0 ? (
                          <span className="calendar-day-count">{dayEvents.length}</span>
                        ) : null}
                      </div>
                      <div className="calendar-day-events">
                        {visibleEvents.map((event) => {
                          const chipClass =
                            event.type === "Follow-Up"
                              ? "followup"
                              : event.type === "To-Do"
                              ? "todo"
                              : "interview";
                          return (
                            <span key={event.id} className={`calendar-event-chip ${chipClass}`}>
                              {event.type}
                            </span>
                          );
                        })}
                        {remainingEvents > 0 ? (
                          <span className="calendar-more">{t("+{count} more", { count: remainingEvents })}</span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="calendar-day-panel">
                <h4>{selectedDateLabel}</h4>
                {selectedEvents.length === 0 ? (
                  <div className="empty">{t("No events scheduled.")}</div>
                ) : (
                  <div className="calendar-day-list">
                    {selectedEvents.map((event) => (
                      <div key={event.id} className="calendar-day-event">
                        <div className="calendar-day-event-body">
                          <strong>{event.type}</strong>
                          <span>
                            {event.company} — {event.position}
                          </span>
                          <span>{event.timeLabel ? `${event.timeLabel}` : t("All-day")}</span>
                        </div>
                        <div className="row-actions">
                          <button
                            className="icon-button"
                            type="button"
                            onClick={() => handleEventDownload(event)}
                            aria-label={t("Download")}
                          >
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                              <path d="M10 2.5a.75.75 0 0 1 .75.75v7.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06l2.22 2.22V3.25A.75.75 0 0 1 10 2.5Zm-5 12.75c0-.41.34-.75.75-.75h8.5a.75.75 0 0 1 .75.75v1.5A1.75 1.75 0 0 1 13.25 18h-6.5A1.75 1.75 0 0 1 5 16.75v-1.5Z" />
                            </svg>
                          </button>
                          <button
                            className="icon-button"
                            type="button"
                            onClick={() => handleEventDetail(event)}
                            aria-label={t("Details")}
                          >
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                              <path d="M10 4.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm0 1.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-.75 1.75h1.5v1.5h-1.5v-1.5Zm0 3h1.5v3h-1.5v-3Z" />
                            </svg>
                          </button>
                          <button
                            className="icon-button"
                            type="button"
                            onClick={() => handleEventEdit(event)}
                            aria-label={t("Edit")}
                          >
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                              <path d="M14.85 2.85a1.5 1.5 0 0 1 2.12 2.12l-9.5 9.5-3.2.35.35-3.2 9.5-9.5ZM4.3 15.7h11.4v1.5H4.3v-1.5Z" />
                            </svg>
                          </button>
                          {event.type === "To-Do" && event.todoId ? (
                            <button
                              className="icon-button danger"
                              type="button"
                              onClick={() => removeTodoItem(event.appId, event.todoId!)}
                              aria-label={t("Delete")}
                            >
                              <svg viewBox="0 0 20 20" aria-hidden="true">
                                <path d="M7.5 3.5h5l.5 1.5H17v1.5H3V5h3.5l.5-1.5Zm1 4h1.5v7H8.5v-7Zm3 0H13v7h-1.5v-7ZM5.5 6.5h9l-.6 9.1a1.5 1.5 0 0 1-1.5 1.4H7.6a1.5 1.5 0 0 1-1.5-1.4l-.6-9.1Z" />
                              </svg>
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )
    },
    {
      id: "calendar:todo",
      toolbar: {
          search: {
            value: todoQuery,
            onChange: setTodoQuery,
            placeholder: t("Search to-dos...")
          },
          columns: {
            items: orderedTodoColumns.map((col) => ({
              key: col,
              label: todoColumnLabels[col],
              visible: visibleTodoColumns.includes(col),
              disabled: col === "actions"
            })),
            onToggle: (key: string) => {
              if (!isTodoColumnId(key) || key === "actions") return;
              toggleTodoColumnHidden(key);
            },
            onShowAll: hiddenTodoColumns.length > 0 ? showAllTodoColumns : undefined
          }
        },
      content: (
          <>
            <div className="todo-controls">
              <div className="todo-summary">
                {hasApplications ? t("{count} pending", { count: pendingTodos }) : "-"}
              </div>
              <div className="field todo-select">
                <label>{t("Application")}</label>
                <select
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                  disabled={!hasApplications}
                >
                  <option value="">{t("All applications")}</option>
                  {applicationOptions.map((app) => (
                    <option key={app.value} value={app.value}>
                      {app.label}
                    </option>
                  ))}
                </select>
              </div>
              <button className="primary" type="button" onClick={openTodoCreate} disabled={!hasApplications}>
                {t("Add To-Do")}
              </button>
            </div>
            {!hasApplications ? (
              <div className="empty">{t("No applications yet. Add one to start tracking tasks.")}</div>
            ) : rowsForDisplay.length === 0 ? (
              <div className="empty">
                {selected ? t("No to-do items for this application.") : t("No to-do items yet.")}
              </div>
            ) : (
              <div className="table-scroll todo-table-scroll">
                <table className="table todo-table">
                  <thead>
                    <tr>
                      {visibleTodoColumns.map((col) => {
                        const canMove = col !== "actions";
                        const canMenu = col !== "actions";
                        const isPinned = todoPinnedColumn === col;
                        const isDragOver = todoDragOverColumn === col;
                        const sortActive = todoSortConfig?.column === col;
                        const filterActive = Boolean((todoColumnFilters[col] || "").trim());
                        const width = todoColumnWidths[col] || TODO_COLUMN_WIDTHS[col];
                        return (
                          <th
                            key={col}
                            className={[
                              isPinned ? "todo-sticky-col" : "",
                              isDragOver ? "todo-column-drag-over" : ""
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            style={{
                              width,
                              minWidth: width,
                              left: isPinned ? 0 : undefined
                            }}
                          >
                            <div
                              className={`todo-column-head ${canMove ? "draggable" : ""}`}
                              draggable={canMove}
                              onDragStart={(event) => {
                                if (!canMove) return;
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData("text/plain", col);
                                setTodoDragColumn(col);
                              }}
                              onDragOver={(event) => {
                                if (!canMove || !todoDragColumn || todoDragColumn === col) return;
                                event.preventDefault();
                                setTodoDragOverColumn(col);
                              }}
                              onDragLeave={() => {
                                if (todoDragOverColumn === col) setTodoDragOverColumn(null);
                              }}
                              onDrop={(event) => {
                                const from = todoDragColumn;
                                if (!canMove || !from || from === col) return;
                                event.preventDefault();
                                reorderTodoColumns(from, col);
                                setTodoDragColumn(null);
                                setTodoDragOverColumn(null);
                              }}
                              onDragEnd={() => {
                                setTodoDragColumn(null);
                                setTodoDragOverColumn(null);
                              }}
                            >
                              {canMove ? (
                                <span className="todo-column-drag-handle" aria-hidden="true">
                                  ||
                                </span>
                              ) : null}
                              <span className="todo-column-title">{todoColumnLabels[col]}</span>
                              {sortActive && (
                                <span className="sort-indicator">
                                  {todoSortConfig?.direction === "asc" ? "↑" : "↓"}
                                </span>
                              )}
                              {filterActive && <span className="filter-indicator" />}
                              {canMenu ? (
                                <button
                                  className="column-menu-button"
                                  type="button"
                                  aria-label="Column menu"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (todoColumnMenu?.col === col) {
                                      closeTodoColumnMenu();
                                    } else {
                                      openTodoColumnMenu(col, event.currentTarget);
                                    }
                                  }}
                                >
                                  ⋯
                                </button>
                              ) : null}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {rowsForDisplay.map((row, index) => {
                      const status = normalizeTodoStatus(row.todo.status);
                      const docs = parseDocumentLinks(row.todo.documents_links);
                      const appFiles = appById.get(row.appId)?.documents_files || [];
                      const renderCell = (col: TodoColumnId) => {
                        if (col === "application") {
                          return (
                            <SelectCell
                              value={row.applicationId}
                              options={applicationSelectOptions}
                              onCommit={(next) => moveTodoItem(row.appId, row.todo.id, next)}
                            />
                          );
                        }
                        if (col === "task") {
                          return (
                            <TextCell
                              value={row.todo.task}
                              onCommit={(next) => updateTodoItem(row.appId, row.todo.id, { task: next })}
                            />
                          );
                        }
                        if (col === "task_location") {
                          return (
                            <TextCell
                              value={row.todo.task_location || ""}
                              placeholder={t("Location")}
                              onCommit={(next) =>
                                updateTodoItem(row.appId, row.todo.id, { task_location: next })
                              }
                            />
                          );
                        }
                        if (col === "notes") {
                          return (
                            <TextCell
                              value={row.todo.notes || ""}
                              placeholder={t("Notes")}
                              onCommit={(next) => updateTodoItem(row.appId, row.todo.id, { notes: next })}
                            />
                          );
                        }
                        if (col === "documents_links") {
                          return (
                            <>
                              <TextCell
                                value={row.todo.documents_links || ""}
                                placeholder={t("Links")}
                                onCommit={(next) =>
                                  updateTodoItem(row.appId, row.todo.id, { documents_links: next })
                                }
                              />
                              {(docs.length > 0 || appFiles.length > 0) && (
                                <div className="todo-documents">
                                  {appFiles.map((file) => (
                                    <button
                                      key={`${row.appId}-file-${file.id}`}
                                      className="doc-chip doc-button"
                                      type="button"
                                      onClick={() => setDocumentModal({ appId: row.appId, file })}
                                      aria-label={t("Document {name}", { name: file.name })}
                                    >
                                      <svg viewBox="0 0 20 20" aria-hidden="true">
                                        <path d="M5 2.5h6l4 4V17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Zm6 1.5H6v12h8V8h-3V4Z" />
                                      </svg>
                                      <span>
                                        {file.name}
                                        {file.size ? ` ${formatFileSize(file.size)}` : ""}
                                      </span>
                                    </button>
                                  ))}
                                  {docs.map((doc, index) =>
                                    doc.href ? (
                                      <a
                                        key={`${row.todo.id}-doc-${index}`}
                                        className="doc-chip"
                                        href={doc.href}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        <svg viewBox="0 0 20 20" aria-hidden="true">
                                          <path d="M5 2.5h6l4 4V17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Zm6 1.5H6v12h8V8h-3V4Z" />
                                        </svg>
                                        <span>{doc.label}</span>
                                      </a>
                                    ) : (
                                      <span key={`${row.todo.id}-doc-${index}`} className="doc-chip">
                                        <svg viewBox="0 0 20 20" aria-hidden="true">
                                          <path d="M5 2.5h6l4 4V17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Zm6 1.5H6v12h8V8h-3V4Z" />
                                        </svg>
                                        <span>{doc.label}</span>
                                      </span>
                                    )
                                  )}
                                </div>
                              )}
                            </>
                          );
                        }
                        if (col === "due_date") {
                          return (
                            <DateCell
                              value={row.todo.due_date || ""}
                              onCommit={(next) => updateTodoItem(row.appId, row.todo.id, { due_date: next })}
                            />
                          );
                        }
                        if (col === "status") {
                          return (
                            <SelectCell
                              value={status}
                              options={TODO_STATUS_SELECT_OPTIONS}
                              onCommit={(next) =>
                                updateTodoItem(row.appId, row.todo.id, {
                                  status: normalizeTodoStatus(next)
                                })
                              }
                            />
                          );
                        }
                        return (
                          <div className="row-actions">
                            <button
                              className="icon-button"
                              type="button"
                              onClick={() => openTodoDetail(row.appId, row.todo.id)}
                              aria-label={t("Details")}
                            >
                              <svg viewBox="0 0 20 20" aria-hidden="true">
                                <path d="M10 4.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm0 1.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-.75 1.75h1.5v1.5h-1.5v-1.5Zm0 3h1.5v3h-1.5v-3Z" />
                              </svg>
                            </button>
                            <button
                              className="icon-button"
                              type="button"
                              onClick={() => openTodoEdit(row.appId, row.todo.id)}
                              aria-label={t("Edit")}
                            >
                              <svg viewBox="0 0 20 20" aria-hidden="true">
                                <path d="M14.85 2.85a1.5 1.5 0 0 1 2.12 2.12l-9.5 9.5-3.2.35.35-3.2 9.5-9.5ZM4.3 15.7h11.4v1.5H4.3v-1.5Z" />
                              </svg>
                            </button>
                            <button
                              className="icon-button"
                              type="button"
                              onClick={() => handleDownloadTodoIcs(row)}
                              aria-label={t("Download")}
                            >
                              <svg viewBox="0 0 20 20" aria-hidden="true">
                                <path d="M10 2a1 1 0 0 1 1 1v8.17l2.59-2.58a1 1 0 1 1 1.41 1.41l-4.3 4.3a1 1 0 0 1-1.41 0l-4.3-4.3a1 1 0 1 1 1.41-1.41L9 11.17V3a1 1 0 0 1 1-1Zm-6 14a1 1 0 0 1 1 1v1h10v-1a1 1 0 1 1 2 0v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a1 1 0 0 1 1-1Z" />
                              </svg>
                            </button>
                            <button
                              className="icon-button danger"
                              type="button"
                              onClick={() => removeTodoItem(row.appId, row.todo.id)}
                              aria-label={t("Delete")}
                            >
                              <svg viewBox="0 0 20 20" aria-hidden="true">
                                <path d="M7.5 3.5h5l.5 1.5H17v1.5H3V5h3.5l.5-1.5Zm1 4h1.5v7H8.5v-7Zm3 0H13v7h-1.5v-7ZM5.5 6.5h9l-.6 9.1a1.5 1.5 0 0 1-1.5 1.4H7.6a1.5 1.5 0 0 1-1.5-1.4l-.6-9.1Z" />
                              </svg>
                            </button>
                          </div>
                        );
                      };
                      const groupKey = todoGroupBy ? todoCellToString(row, todoGroupBy).trim() || "(Empty)" : "";
                      const prevGroupKey =
                        todoGroupBy && index > 0
                          ? todoCellToString(rowsForDisplay[index - 1], todoGroupBy).trim() || "(Empty)"
                          : "";
                      const firstInGroup = Boolean(todoGroupBy && groupKey !== prevGroupKey);
                      const collapsed = Boolean(todoGroupBy && todoCollapsedGroups.has(groupKey));

                      const rowNode = (
                        <tr
                          key={`${row.applicationId}-${row.todo.id}`}
                          className={status === "Done" ? "todo-completed" : undefined}
                        >
                          {visibleTodoColumns.map((col) => {
                            const width = todoColumnWidths[col] || TODO_COLUMN_WIDTHS[col];
                            const isPinned = todoPinnedColumn === col;
                            return (
                              <td
                                key={`${row.todo.id}-${col}`}
                                className={isPinned ? "todo-sticky-col" : ""}
                                style={{
                                  width,
                                  minWidth: width,
                                  left: isPinned ? 0 : undefined
                                }}
                              >
                                {renderCell(col)}
                              </td>
                            );
                          })}
                        </tr>
                      );
                      if (!todoGroupBy) return rowNode;
                      return (
                        <React.Fragment key={`${groupKey}-${row.applicationId}-${row.todo.id}`}>
                          {firstInGroup && (
                            <tr className="group-row">
                              <td colSpan={visibleTodoColumns.length}>
                                <button
                                  className="group-toggle"
                                  type="button"
                                  onClick={() =>
                                    setTodoCollapsedGroups((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(groupKey)) next.delete(groupKey);
                                      else next.add(groupKey);
                                      return next;
                                    })
                                  }
                                >
                                  <span className="group-caret">{collapsed ? "▸" : "▾"}</span>
                                  <span className="group-title">{groupKey}</span>
                                  <span className="group-count">{todoGroupCounts?.get(groupKey) ?? 0}</span>
                                </button>
                              </td>
                            </tr>
                          )}
                          {!collapsed && rowNode}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                  {showTodoCalcRow && (
                    <tfoot>
                      <tr className="calc-row">
                        {visibleTodoColumns.map((col) => {
                          const width = todoColumnWidths[col] || TODO_COLUMN_WIDTHS[col];
                          const isPinned = todoPinnedColumn === col;
                          return (
                            <td
                              key={`todo-calc-${col}`}
                              className={isPinned ? "todo-sticky-col" : ""}
                              style={{
                                width,
                                minWidth: width,
                                left: isPinned ? 0 : undefined
                              }}
                            >
                              <div className="calc-cell">{calcTodoResultFor(col)}</div>
                            </td>
                          );
                        })}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </>
        )
    }
  ];

  const resolveCalendarSlot = useCallback<BlockSlotResolver>(
    (slotId) => {
      if (slotId === "calendar:alerts:content") {
        return calendarSlots[0]?.content || null;
      }
      if (slotId === "calendar:month:content") {
        return calendarSlots[1]?.content || null;
      }
      if (slotId === "calendar:todo:toolbar") {
        const toolbar = calendarSlots[2]?.toolbar;
        return toolbar ? <EditableTableToolbar toolbar={toolbar} /> : null;
      }
      if (slotId === "calendar:todo:content") {
        return calendarSlots[2]?.content || null;
      }
      return null;
    },
    [calendarSlots]
  );

  const resolveCalendarBlockProps = useCallback(
    (block: PageBlockConfig) => {
      if (block.id !== "calendar:todo" || block.type !== "editableTable") return null;
      return {
        description: hasApplications
          ? t("Manage preparation tasks linked to each application.")
          : t("Create an application to start a to-do list.")
      };
    },
    [hasApplications, t]
  );

  const resolveCalendarDuplicateProps = useCallback(
    (block: PageBlockConfig) => {
      if (block.id !== "calendar:todo" || block.type !== "editableTable") return null;
      const tableBlock = block as PageBlockConfig<"editableTable">;

      const sourceColumns = visibleTodoColumns.filter((col) => col !== "actions");
      const usedNames = new Set<string>();
      const snapshotColumns = sourceColumns.map((col, index) => {
        const base = (todoColumnLabels[col] || "").trim() || `Column ${index + 1}`;
        let next = base;
        let attempt = 2;
        while (usedNames.has(next)) {
          next = `${base} ${attempt}`;
          attempt += 1;
        }
        usedNames.add(next);
        return next;
      });

      const snapshotTypes = Object.fromEntries(
        sourceColumns.map((col, index) => [snapshotColumns[index], getTodoColumnKind(col)])
      );
      const snapshotRows = rowsForDisplay.map((row) =>
        sourceColumns.map((col) => todoCellToString(row, col))
      );

      return {
        variant: tableBlock.props.variant || "todo",
        title: tableBlock.props.title || "To-Do List",
        description: tableBlock.props.description || "",
        searchPlaceholder: tableBlock.props.searchPlaceholder || t("Search to-dos..."),
        addActionLabel: tableBlock.props.addActionLabel || t("Add Row"),
        customColumns: snapshotColumns,
        customColumnTypes: snapshotTypes,
        customRows: snapshotRows,
        toolbarSlotId: undefined,
        contentSlotId: undefined,
        actionsSlotId: undefined,
        toolbarActionsSlotId: undefined
      };
    },
    [getTodoColumnKind, rowsForDisplay, t, todoCellToString, todoColumnLabels, visibleTodoColumns]
  );

  return (
    <div className="calendar">
      <PageBuilderPage
        pageId="calendar"
        className="calendar-grid-page"
        resolveSlot={resolveCalendarSlot}
        resolveBlockProps={resolveCalendarBlockProps}
        resolveDuplicateProps={resolveCalendarDuplicateProps}
      />

      {todoColumnMenu &&
        todoColumnMenuPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className={`column-menu ${todoColumnMenuVisible ? "open" : ""} todo-column-menu`}
            data-placement={todoColumnMenuPlacement}
            style={{ top: todoColumnMenuPos.top, left: todoColumnMenuPos.left, width: TODO_COLUMN_MENU_WIDTH }}
            ref={todoColumnMenuRef}
            role="dialog"
            aria-modal="false"
          >
            <div className="column-menu-content">
              <div className="column-menu-header">
                <button
                  className="column-menu-type-button"
                  type="button"
                  onClick={() => setTodoMenuView("type")}
                  aria-label="Cambiar tipo"
                >
                  {iconChangeType}
                </button>
                <input
                  className="column-menu-rename-input"
                  type="text"
                  value={todoColumnMenu.rename}
                  onChange={(event) =>
                    setTodoColumnMenu((prev) => (prev ? { ...prev, rename: event.target.value } : prev))
                  }
                  onBlur={applyTodoColumnRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      applyTodoColumnRename();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setTodoColumnMenu((prev) =>
                        prev ? { ...prev, rename: todoColumnLabels[prev.col] } : prev
                      );
                    }
                  }}
                  placeholder="Nombre de la propiedad"
                />
              </div>
              <div className="column-menu-scroller">
                {todoColumnMenuView === "filter" && (
                  <div className="column-menu-filter">
                    <input
                      ref={todoColumnMenuFilterInputRef}
                      className="column-menu-filter-input"
                      type="text"
                      value={todoColumnMenu.filter}
                      onChange={(event) => {
                        const value = event.target.value;
                        setTodoColumnMenu((prev) => (prev ? { ...prev, filter: value } : prev));
                        setTodoColumnFilters((prev) => ({ ...prev, [todoColumnMenu.col]: value }));
                      }}
                      placeholder="Escribe para filtrar..."
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.stopPropagation();
                          closeTodoColumnMenu();
                        }
                      }}
                    />
                  </div>
                )}
                <div
                  className="column-menu-list"
                  role="menu"
                  tabIndex={0}
                  ref={todoColumnMenuListRef}
                  aria-activedescendant={todoMenuActiveId}
                  onKeyDown={handleTodoMenuKeyDown}
                >
                  {menuEntries.map((entry, index) => {
                    if (entry.kind === "separator") {
                      return <div key={entry.key} className="column-menu-separator" role="separator" />;
                    }
                    const isActive = index === todoColumnMenuActiveIndex;
                    const onClick = () => {
                      if (entry.disabled) return;
                      if (entry.submenu) {
                        setTodoMenuView(entry.submenu);
                        return;
                      }
                      entry.action?.();
                    };
                    return (
                      <div
                        key={entry.key}
                        id={`todo-column-menu-${todoColumnMenuView}-${index}`}
                        role="menuitem"
                        aria-disabled={entry.disabled ? "true" : undefined}
                        aria-haspopup={entry.submenu ? "dialog" : undefined}
                        aria-expanded={
                          entry.submenu ? (todoColumnMenuView === entry.submenu ? "true" : "false") : undefined
                        }
                        className={`column-menu-item ${isActive ? "active" : ""} ${
                          entry.disabled ? "disabled" : ""
                        }`}
                        onMouseEnter={() => setTodoColumnMenuActiveIndex(index)}
                        onClick={onClick}
                      >
                        <span className="column-menu-item-icon">{entry.icon}</span>
                        <span className="column-menu-item-label">{entry.label}</span>
                        <span className="column-menu-item-end">
                          {entry.end ?? (entry.submenu ? <span>›</span> : null)}
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

      {todoCreateDraft && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <header className="modal-header">
              <div>
                <h2>{t("Add To-Do")}</h2>
                <p>
                  {todoCreateDraft.company_name} — {todoCreateDraft.position}
                </p>
              </div>
              <button className="ghost" onClick={closeTodoCreate} type="button" aria-label={t("Close")}>
                ×
              </button>
            </header>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                await handleAddTodo();
              }}
              className="form-grid"
            >
              <div className="field">
                <label>{t("Application")}</label>
                <select
                  value={todoCreateAppId}
                  onChange={(event) => handleTodoCreateAppChange(event.target.value)}
                  required
                >
                  {applicationOptions.map((app) => (
                    <option key={app.value} value={app.value}>
                      {app.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t("Task")}</label>
                <input
                  value={todoCreateDraft.task}
                  onChange={(event) => updateTodoCreateDraft({ task: event.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>{t("Status")}</label>
                <select
                  value={todoCreateDraft.status}
                  onChange={(event) =>
                    updateTodoCreateDraft({ status: event.target.value as TodoStatus })
                  }
                >
                  {TODO_STATUSES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t("Due Date")}</label>
                <input
                  type="date"
                  value={todoCreateDraft.due_date}
                  onChange={(event) => updateTodoCreateDraft({ due_date: event.target.value })}
                />
              </div>
              <div className="field">
                <label>{t("Company Name")}</label>
                <input
                  list="todo-company-options-create"
                  value={todoCreateDraft.company_name}
                  onChange={(event) =>
                    updateTodoCreateDraft({ company_name: event.target.value })
                  }
                  required
                />
                <datalist id="todo-company-options-create">
                  {companyOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </div>
              <div className="field">
                <label>{t("Position")}</label>
                <input
                  list="todo-position-options-create"
                  value={todoCreateDraft.position}
                  onChange={(event) => updateTodoCreateDraft({ position: event.target.value })}
                  required
                />
                <datalist id="todo-position-options-create">
                  {positionOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </div>
              <div className="field">
                <label>{t("Task Location")}</label>
                <input
                  value={todoCreateDraft.task_location}
                  onChange={(event) =>
                    updateTodoCreateDraft({ task_location: event.target.value })
                  }
                  placeholder={t("Meeting room, HQ, remote...")}
                />
              </div>
              <div className="field full">
                <label>{t("Notes")}</label>
                <textarea
                  value={todoCreateDraft.notes}
                  onChange={(event) => updateTodoCreateDraft({ notes: event.target.value })}
                />
              </div>
              <div className="field full">
                <label>{t("Documents / Links")}</label>
                <textarea
                  value={todoCreateDraft.documents_links}
                  onChange={(event) =>
                    updateTodoCreateDraft({ documents_links: event.target.value })
                  }
                />
              </div>
              {todoCreateApp && (
                <>
                  <div className="field full">
                    <DocumentsDropzone
                      onUpload={(files) => handleUploadDocuments(todoCreateApp.id, files)}
                    />
                    <p className="documents-help">{t("Attach resumes, portfolios, or offer letters.")}</p>
                    <div className="documents-list">
                      {(todoCreateApp.documents_files || []).length === 0 && (
                        <div className="documents-empty">{t("No documents uploaded.")}</div>
                      )}
                      {(todoCreateApp.documents_files || []).map((doc) => (
                        <div className="document-item" key={doc.id}>
                          <a
                            href={documentDownloadUrl(todoCreateApp.id, doc.id)}
                            onClick={(event) => {
                              event.preventDefault();
                              void openExternal(documentDownloadUrl(todoCreateApp.id, doc.id));
                            }}
                            rel="noreferrer"
                          >
                            {doc.name}
                          </a>
                          <span className="document-meta">
                            {doc.size ? formatFileSize(doc.size) : ""}
                          </span>
                          <button
                            className="ghost small"
                            type="button"
                            onClick={() => handleDeleteDocument(todoCreateApp.id, doc.id)}
                          >
                            {t("Remove")}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="field full">
                    <label>{t("Contacts")}</label>
                    <ContactsEditor
                      contacts={todoCreateApp.contacts || []}
                      onCommit={(next) => updateApplication(todoCreateApp.id, { contacts: next })}
                    />
                  </div>
                </>
              )}
              <div className="form-actions">
                <button className="ghost" type="button" onClick={closeTodoCreate}>
                  {t("Cancel")}
                </button>
                <button className="primary" type="submit">
                  {t("Add")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {todoEditEntry && todoEditDraft && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <header className="modal-header">
              <div>
                <h2>{t("Edit To-Do")}</h2>
                <p>
                  {todoEditDraft.company_name} — {todoEditDraft.position}
                </p>
              </div>
              <button className="ghost" onClick={() => setTodoEdit(null)} type="button" aria-label={t("Close")}>
                ×
              </button>
            </header>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                await updateTodoFromDraft(todoEditEntry.app, todoEditEntry.todo.id, todoEditDraft);
                setTodoEdit(null);
              }}
              className="form-grid"
            >
              <div className="field">
                <label>{t("Task")}</label>
                <input
                  value={todoEditDraft.task}
                  onChange={(event) => updateTodoEditDraft({ task: event.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>{t("Status")}</label>
                <select
                  value={todoEditDraft.status}
                  onChange={(event) =>
                    updateTodoEditDraft({ status: event.target.value as TodoStatus })
                  }
                >
                  {TODO_STATUSES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t("Due Date")}</label>
                <input
                  type="date"
                  value={todoEditDraft.due_date}
                  onChange={(event) => updateTodoEditDraft({ due_date: event.target.value })}
                />
              </div>
              <div className="field">
                <label>{t("Company Name")}</label>
                <input
                  list="todo-company-options-edit"
                  value={todoEditDraft.company_name}
                  onChange={(event) => updateTodoEditDraft({ company_name: event.target.value })}
                  required
                />
                <datalist id="todo-company-options-edit">
                  {companyOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </div>
              <div className="field">
                <label>{t("Position")}</label>
                <input
                  list="todo-position-options-edit"
                  value={todoEditDraft.position}
                  onChange={(event) => updateTodoEditDraft({ position: event.target.value })}
                  required
                />
                <datalist id="todo-position-options-edit">
                  {positionOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </div>
              <div className="field">
                <label>{t("Task Location")}</label>
                <input
                  value={todoEditDraft.task_location}
                  onChange={(event) => updateTodoEditDraft({ task_location: event.target.value })}
                  placeholder={t("Meeting room, HQ, remote...")}
                />
              </div>
              <div className="field full">
                <label>{t("Notes")}</label>
                <textarea
                  value={todoEditDraft.notes}
                  onChange={(event) => updateTodoEditDraft({ notes: event.target.value })}
                />
              </div>
              <div className="field full">
                <label>{t("Documents / Links")}</label>
                <textarea
                  value={todoEditDraft.documents_links}
                  onChange={(event) => updateTodoEditDraft({ documents_links: event.target.value })}
                />
              </div>
              <div className="field full">
                <DocumentsDropzone
                  onUpload={(files) => handleUploadDocuments(todoEditEntry.app.id, files)}
                />
                <p className="documents-help">{t("Attach resumes, portfolios, or offer letters.")}</p>
                <div className="documents-list">
                  {(todoEditEntry.app.documents_files || []).length === 0 && (
                    <div className="documents-empty">{t("No documents uploaded.")}</div>
                  )}
                  {(todoEditEntry.app.documents_files || []).map((doc) => (
                    <div className="document-item" key={doc.id}>
                      <a
                        href={documentDownloadUrl(todoEditEntry.app.id, doc.id)}
                        onClick={(event) => {
                          event.preventDefault();
                          void openExternal(documentDownloadUrl(todoEditEntry.app.id, doc.id));
                        }}
                        rel="noreferrer"
                      >
                        {doc.name}
                      </a>
                      <span className="document-meta">
                        {doc.size ? formatFileSize(doc.size) : ""}
                      </span>
                      <button
                        className="ghost small"
                        type="button"
                        onClick={() => handleDeleteDocument(todoEditEntry.app.id, doc.id)}
                      >
                        {t("Remove")}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="field full">
                <label>{t("Contacts")}</label>
                <ContactsEditor
                  contacts={todoEditEntry.app.contacts || []}
                  onCommit={(next) => updateApplication(todoEditEntry.app.id, { contacts: next })}
                />
              </div>
              <div className="form-actions">
                <button className="ghost" type="button" onClick={() => setTodoEdit(null)}>
                  {t("Cancel")}
                </button>
                <button className="primary" type="submit">
                  {t("Save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {todoDetailEntry && todoDetailDraft && (
        <div className="drawer-backdrop" onClick={() => setTodoDetail(null)}>
          <div className="drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h3>{todoDetailDraft.task || t("To-Do")}</h3>
                <p>
                  {todoDetailDraft.company_name} — {todoDetailDraft.position}
                </p>
              </div>
              <button className="ghost" onClick={() => setTodoDetail(null)} aria-label={t("Close")}>
                ×
              </button>
            </div>
            <div className="drawer-body">
              <label>
                {t("Task")}
                <input
                  className="cell-input"
                  value={todoDetailDraft.task}
                  onChange={(event) => updateTodoDetailDraft({ task: event.target.value })}
                />
              </label>
              <label>
                {t("Status")}
                <select
                  className={`cell-select todo-status ${TODO_STATUS_CLASS[todoDetailDraft.status]}`}
                  value={todoDetailDraft.status}
                  onChange={(event) =>
                    updateTodoDetailDraft({ status: event.target.value as TodoStatus })
                  }
                >
                  {TODO_STATUSES.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Due Date")}
                <input
                  className="cell-date"
                  type="date"
                  value={todoDetailDraft.due_date}
                  onChange={(event) => updateTodoDetailDraft({ due_date: event.target.value })}
                />
              </label>
              <label>
                {t("Company Name")}
                <input
                  className="cell-input"
                  list="todo-company-options-detail"
                  value={todoDetailDraft.company_name}
                  onChange={(event) =>
                    updateTodoDetailDraft({ company_name: event.target.value })
                  }
                />
                <datalist id="todo-company-options-detail">
                  {companyOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </label>
              <label>
                {t("Position")}
                <input
                  className="cell-input"
                  list="todo-position-options-detail"
                  value={todoDetailDraft.position}
                  onChange={(event) => updateTodoDetailDraft({ position: event.target.value })}
                />
                <datalist id="todo-position-options-detail">
                  {positionOptions.map((option) => (
                    <option key={option} value={option} />
                  ))}
                </datalist>
              </label>
              <label>
                {t("Task Location")}
                <input
                  className="cell-input"
                  value={todoDetailDraft.task_location}
                  onChange={(event) => updateTodoDetailDraft({ task_location: event.target.value })}
                />
              </label>
              <label>
                {t("Notes")}
                <textarea
                  value={todoDetailDraft.notes}
                  onChange={(event) => updateTodoDetailDraft({ notes: event.target.value })}
                />
              </label>
              <label>
                {t("Documents / Links")}
                <textarea
                  value={todoDetailDraft.documents_links}
                  onChange={(event) =>
                    updateTodoDetailDraft({ documents_links: event.target.value })
                  }
                />
              </label>
              <div className="drawer-section">
                <h4>{t("Contacts")}</h4>
                <ContactsEditor
                  contacts={todoDetailEntry.app.contacts || []}
                  onCommit={(next) => updateApplication(todoDetailEntry.app.id, { contacts: next })}
                />
              </div>
            </div>
            <div className="drawer-actions">
              <button
                className="primary"
                onClick={async () => {
                  await updateTodoFromDraft(
                    todoDetailEntry.app,
                    todoDetailEntry.todo.id,
                    todoDetailDraft
                  );
                  setTodoDetail(null);
                }}
              >
                {t("Save changes")}
              </button>
            </div>
          </div>
        </div>
      )}

      {settings && editing && (
        <ApplicationForm
          initial={editing}
          settings={settings}
          onSubmit={handleUpdate}
          onDeleteExistingDocument={(fileId) => handleDeleteDocument(editing.id, fileId)}
          onClose={() => setEditing(null)}
        />
      )}
      {detailApp && (
        <div className="drawer-backdrop" onClick={() => setDetailApp(null)}>
          <div className="drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h3>{detailApp.company_name}</h3>
                <p>{detailApp.position}</p>
              </div>
              <button className="ghost" onClick={() => setDetailApp(null)} aria-label={t("Close")}>
                ×
              </button>
            </div>
            <div className="drawer-body">
              <label>
                {t("Company Score")}
                <StarRating
                  value={detailDraft.company_score}
                  onChange={(next) =>
                    setDetailDraft((prev) => ({ ...prev, company_score: next }))
                  }
                  size="md"
                  step={0.5}
                />
              </label>
              <label>
                {t("Notes")}
                <textarea
                  value={detailDraft.notes}
                  onChange={(event) =>
                    setDetailDraft((prev) => ({ ...prev, notes: event.target.value }))
                  }
                />
              </label>
              <label>
                {t("Job Description")}
                <textarea
                  value={detailDraft.job_description}
                  onChange={(event) =>
                    setDetailDraft((prev) => ({ ...prev, job_description: event.target.value }))
                  }
                />
              </label>
              <label>
                {t("Improvement Areas")}
                <textarea
                  value={detailDraft.improvement_areas}
                  onChange={(event) =>
                    setDetailDraft((prev) => ({ ...prev, improvement_areas: event.target.value }))
                  }
                />
              </label>
              <label>
                {t("Skill to Upgrade")}
                <textarea
                  value={detailDraft.skill_to_upgrade}
                  onChange={(event) =>
                    setDetailDraft((prev) => ({ ...prev, skill_to_upgrade: event.target.value }))
                  }
                />
              </label>
              <label>
                {t("Documents / Links")}
                <textarea
                  value={detailDraft.documents_links}
                  onChange={(event) =>
                    setDetailDraft((prev) => ({ ...prev, documents_links: event.target.value }))
                  }
                />
              </label>
              <div className="drawer-section documents-section">
                <DocumentsDropzone
                  onUpload={(files) => handleUploadDocuments(detailApp.id, files)}
                />
                <p className="documents-help">{t("Attach resumes, portfolios, or offer letters.")}</p>
                <div className="documents-list">
                  {detailDocuments.length === 0 && (
                    <div className="documents-empty">{t("No documents uploaded.")}</div>
                  )}
                  {detailDocuments.map((doc) => (
                    <div className="document-item" key={doc.id}>
                      <a
                        href={documentDownloadUrl(detailApp.id, doc.id)}
                        onClick={(event) => {
                          event.preventDefault();
                          void openExternal(documentDownloadUrl(detailApp.id, doc.id));
                        }}
                        rel="noreferrer"
                      >
                        {doc.name}
                      </a>
                      <span className="document-meta">
                        {doc.size ? formatFileSize(doc.size) : ""}
                      </span>
                      <button
                        className="ghost small"
                        type="button"
                        onClick={() => handleDeleteDocument(detailApp.id, doc.id)}
                      >
                        {t("Remove")}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="drawer-section">
                <h4>{t("Contacts")}</h4>
                <ContactsEditor
                  contacts={detailContacts}
                  onCommit={(next) => updateApplication(detailApp.id, { contacts: next })}
                />
              </div>
            </div>
            <div className="drawer-actions">
              <button
                className="primary"
                onClick={async () => {
                  await updateApplication(detailApp.id, {
                    notes: detailDraft.notes || "",
                    job_description: detailDraft.job_description || "",
                    improvement_areas: detailDraft.improvement_areas || "",
                    skill_to_upgrade: detailDraft.skill_to_upgrade || "",
                    documents_links: detailDraft.documents_links || "",
                    company_score: detailDraft.company_score ?? null
                  });
                  setDetailApp(null);
                }}
              >
                {t("Save changes")}
              </button>
            </div>
          </div>
        </div>
      )}
      {documentModal && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal doc-modal">
            <header className="modal-header">
              <div>
                <h2>{t("Document")}</h2>
                <p>{documentModal.file.name}</p>
              </div>
              <button className="ghost" onClick={() => setDocumentModal(null)} type="button" aria-label={t("Close")}>
                ×
              </button>
            </header>
            <div className="doc-info">
              <div className="doc-row">
                <span className="doc-label">{t("Name")}</span>
                <span>{documentModal.file.name}</span>
              </div>
              <div className="doc-row">
                <span className="doc-label">{t("Added")}</span>
                <span>{formatUploadedAt(documentModal.file.uploaded_at)}</span>
              </div>
              <div className="doc-row">
                <span className="doc-label">{t("Size")}</span>
                <span>{documentModal.file.size ? formatFileSize(documentModal.file.size) : "—"}</span>
              </div>
            </div>
            <div className="doc-actions">
              <button
                className="ghost"
                type="button"
                onClick={() =>
                  handleDownloadDocument(documentModal.appId, documentModal.file.id)
                }
              >
                {t("Download")}
              </button>
              <button
                className="danger"
                type="button"
                onClick={async () => {
                  await handleDeleteDocument(documentModal.appId, documentModal.file.id);
                  setDocumentModal(null);
                }}
              >
                {t("Delete")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarPage;
