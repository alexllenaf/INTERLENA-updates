import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ApplicationForm from "../components/ApplicationForm";
import { EditableTableToolbar } from "../components/blocks/BlockRenderer";
import { useUndo } from "../undoContext";
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
  columnMenuIconTypeText
} from "../components/columnMenuIcons";
import ContactsEditor from "../components/ContactsEditor";
import DocumentsDropzone from "../components/DocumentsDropzone";
import { BlockSlotResolver, PageBlockConfig, PageBuilderPage } from "../components/pageBuilder";
import type { CalendarBlockProps, CalendarColorScheme } from "../components/pageBuilder/types";
import {
  TODO_SOURCE_TABLE_LINK_KEY,
  collectEditableTableTargets,
  buildBlockGraph,
  resolveBlock,
  getBlockLink
} from "../components/pageBuilder/blockLinks";
import StarRating from "../components/StarRating";
import { DateCell, DateTimeCell, DateValueDisplay, SelectCell, type SelectOption, TextCell } from "../components/TableCells";
import TrackerSearchBar from "../components/tracker/TrackerSearchBar";
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
  formatFileSize,
  formatIcsDate,
  formatIcsDateTime,
  formatUploadedAt,
  followupStatus,
  generateId,
  parseDocumentLinks,
  parseLocalDateOnly,
  toDateTimeLocalValue
} from "../utils";
import {
  normalizeTodoStatus,
  TODO_STATUSES,
  TODO_STATUS_CLASS,
  TODO_STATUS_PILL_COLORS,
  type TodoStatus
} from "../constants";
import {
  TODO_STATUS_SELECT_OPTIONS,
  toDateKey,
  buildWeekdayLabels,
  buildSingleEventIcs,
  downloadEventIcs,
  clamp,
  isTodoColumnId,
  normalizeTodoColumnOrder,
  normalizeTodoColumnKinds,
  readTodoTablePrefs,
  writeTodoTablePrefs,
  TRACKER_COLUMN_LABEL_FALLBACKS,
  normalizeStringArray,
  normalizeStringRecord,
  humanizeColumnKey,
  resolveTrackerPinnedColumnKey,
  resolveTrackerPinnedColumnLabel,
  trackerApplicationValueForColumn,
  TODO_COLUMN_KIND_OPTIONS,
  TODO_COLUMN_KIND_SET,
  TODO_COLUMN_KIND_DEFAULTS,
  TODO_COLUMN_ORDER_DEFAULT,
  TODO_COLUMN_WIDTHS,
  TODO_COLUMN_MENU_WIDTH,
  TODO_COLUMN_MENU_GUTTER,
  TODO_COLUMN_MENU_OFFSET,
  TODO_COLUMN_MENU_HEIGHT_ESTIMATE,
  TODO_COLUMN_MENU_ANIM_MS,
  TODO_TABLE_PREFS_STORAGE_KEY,
  type CalendarEvent,
  type TodoRow,
  type TodoTarget,
  type TodoDraft,
  type TodoColumnId,
  type TodoColumnMenuState,
  type TodoColumnMenuView,
  type TodoColumnKind,
  type TodoColumnKinds,
  type TodoSortConfig,
  type TodoColumnCalcOp,
  type TodoTablePrefs,
  type TodoSourceAccess
} from "./calendar/calendarHelpers";
import { confirmDialog } from "../shared/confirmDialog";

const CalendarPage: React.FC = () => {
  const { t, locale } = useI18n();
  const { applications, updateApplication, settings, refresh } = useAppData();
  const { executeCommand } = useUndo();
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
  const todoPrefs = useMemo(() => readTodoTablePrefs(), []);
  const [todoColumnOrder, setTodoColumnOrder] = useState<TodoColumnId[]>(() => todoPrefs.order);
  const [todoHiddenColumns, setTodoHiddenColumns] = useState<TodoColumnId[]>(() => todoPrefs.hidden);
  const [todoPinnedColumn, setTodoPinnedColumn] = useState<TodoColumnId | null>(() => todoPrefs.pinned);
  const [todoColumnLabelOverrides, setTodoColumnLabelOverrides] = useState<
    Partial<Record<TodoColumnId, string>>
  >(() => todoPrefs.labels);
  const [todoColumnKinds, setTodoColumnKinds] = useState<TodoColumnKinds>(() => todoPrefs.kinds);
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
  // Row drag-and-drop state for todo table
  const [todoDraggedRowId, setTodoDraggedRowId] = useState<string | null>(null);
  const [todoDragOverRowId, setTodoDragOverRowId] = useState<string | null>(null);
  const todoDraggedRowRef = useRef<string | null>(null);
  const [manualTodoOrder, setManualTodoOrder] = useState<string[] | null>(null);

  const editableTableTargets = useMemo(
    () => collectEditableTableTargets(settings, { excludeVariants: ["todo"], excludeTypes: ["todoTable"] }),
    [settings]
  );
  const calendarGraph = useMemo(() => buildBlockGraph(settings), [settings]);

  /* ── Calendar block configuration (calendar:month) ────────────────── */
  const calendarBlockConfig = useMemo<Partial<CalendarBlockProps>>(() => {
    const snap = resolveBlock(calendarGraph, "calendar:month");
    return (snap?.props ?? {}) as Partial<CalendarBlockProps>;
  }, [calendarGraph]);

  const calVisibleEventTypes = calendarBlockConfig.visibleEventTypes;
  const calColorScheme: CalendarColorScheme = calendarBlockConfig.colorScheme ?? "type";
  const calShowDayPanel = calendarBlockConfig.showDayPanel ?? true;
  const calShowEventCount = calendarBlockConfig.showEventCount ?? true;
  const calShowTimeLabels = calendarBlockConfig.showTimeLabels ?? true;
  const calMaxEventsPerDay = calendarBlockConfig.maxEventsPerDay ?? 2;
  const calWeekStartDay = calendarBlockConfig.weekStartDay ?? 0;
  const calCompanyFilter = calendarBlockConfig.companyFilter;
  const calDisplayMode = calendarBlockConfig.displayMode ?? "month";

  const defaultTodoSourceTarget = useMemo(
    () => editableTableTargets.find((target) => target.hasTodoColumn) || editableTableTargets[0] || null,
    [editableTableTargets]
  );

  const isTrackerTodoSource = useMemo(() => {
    if (!defaultTodoSourceTarget) return false;
    const contentSlotId =
      typeof defaultTodoSourceTarget.props?.contentSlotId === "string"
        ? defaultTodoSourceTarget.props.contentSlotId
        : "";
    return (
      defaultTodoSourceTarget.pageId === "tracker" ||
      defaultTodoSourceTarget.blockId === "tracker:table" ||
      contentSlotId.startsWith("tracker:content")
    );
  }, [defaultTodoSourceTarget]);

  const todoSourcePinnedTrackerColumn = useMemo(
    () => (isTrackerTodoSource ? resolveTrackerPinnedColumnKey(settings) : null),
    [isTrackerTodoSource, settings]
  );

  const todoSourceApplicationLabel = useMemo(() => {
    if (!isTrackerTodoSource || !todoSourcePinnedTrackerColumn) return t("Application");
    return resolveTrackerPinnedColumnLabel(settings, todoSourcePinnedTrackerColumn);
  }, [isTrackerTodoSource, settings, t, todoSourcePinnedTrackerColumn]);

  const todoColumnLabels = useMemo<Record<TodoColumnId, string>>(() => {
    const base: Record<TodoColumnId, string> = {
      application: todoSourceApplicationLabel,
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
  }, [t, todoColumnLabelOverrides, todoSourceApplicationLabel]);

  const resolveTodoSourceAccess = useCallback(
    (block?: PageBlockConfig | null): TodoSourceAccess => {
      const explicitLinkId = block ? getBlockLink(block.props, TODO_SOURCE_TABLE_LINK_KEY) : null;
      const explicitTarget = explicitLinkId
        ? editableTableTargets.find((t) => t.blockId === explicitLinkId) || null
        : null;
      const explicitExistsInGraph = explicitLinkId ? resolveBlock(calendarGraph, explicitLinkId) !== null : false;
      const sourceTarget = explicitTarget || defaultTodoSourceTarget;

      if (explicitLinkId && !explicitExistsInGraph) {
        return {
          hasSource: false,
          reason: t("The linked editable table no longer exists.")
        };
      }
      if (!sourceTarget) {
        return {
          hasSource: false,
          reason: t("No editable table is available to link this to-do list.")
        };
      }
      if (!sourceTarget.hasTodoColumn) {
        return {
          hasSource: false,
          reason: t("The linked editable table has no To-Do column.")
        };
      }
      return {
        hasSource: true,
        reason: null
      };
    },
    [defaultTodoSourceTarget, editableTableTargets, t]
  );

  const weekdayLabels = useMemo(() => buildWeekdayLabels(locale, calWeekStartDay), [locale, calWeekStartDay]);
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
      if (app.application_date) {
        const date = new Date(app.application_date);
        if (!Number.isNaN(date.getTime())) {
          items.push({
            id: `${app.application_id}-application-${date.getTime()}`,
            appId: app.id,
            applicationId: app.application_id,
            type: "Application",
            company: app.company_name,
            position: app.position,
            date,
            dateKey: toDateKey(date),
            dateLabel: date.toLocaleDateString()
          });
        }
      }
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
        const rawDueDate = (todo.due_date || "").trim();
        const hasTime = /(?:T|\s)\d{2}:\d{2}/.test(rawDueDate);
        const date = hasTime ? new Date(rawDueDate) : parseLocalDateOnly(rawDueDate);
        if (!date) return;
        if (hasTime && Number.isNaN(date.getTime())) return;
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
          dateLabel: date.toLocaleDateString(),
          timeLabel: hasTime
            ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : undefined
        });
      });
    });
    return items.sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [applications]);

  /* ── Apply calendar config filters (event types + company) ──────── */
  const filteredEvents = useMemo<CalendarEvent[]>(() => {
    let result = events;
    if (calVisibleEventTypes && calVisibleEventTypes.length > 0) {
      const allowedSet = new Set(calVisibleEventTypes);
      result = result.filter((e) => allowedSet.has(e.type));
    }
    if (calCompanyFilter && calCompanyFilter.length > 0) {
      const companySet = new Set(calCompanyFilter);
      result = result.filter((e) => companySet.has(e.company));
    }
    return result;
  }, [events, calVisibleEventTypes, calCompanyFilter]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    filteredEvents.forEach((event) => {
      const list = map.get(event.dateKey);
      if (list) {
        list.push(event);
      } else {
        map.set(event.dateKey, [event]);
      }
    });
    return map;
  }, [filteredEvents]);

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
    if (calDisplayMode === "week") {
      // Week view: show 7 days starting from the week that contains `cursor`
      const dayOfWeekMondayBased = (cursor.getDay() + 6) % 7;
      const weekOffset = (dayOfWeekMondayBased - calWeekStartDay + 7) % 7;
      const start = new Date(cursor);
      start.setDate(cursor.getDate() - weekOffset);
      return Array.from({ length: 7 }, (_, index) => {
        const date = new Date(start);
        date.setDate(start.getDate() + index);
        return date;
      });
    }
    // Month view (default)
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const dayOfWeekMondayBased = (firstOfMonth.getDay() + 6) % 7;
    const weekdayOffset = (dayOfWeekMondayBased - calWeekStartDay + 7) % 7;
    const start = new Date(firstOfMonth);
    start.setDate(firstOfMonth.getDate() - weekdayOffset);
    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }, [cursor, calWeekStartDay, calDisplayMode]);

  const monthLabel = useMemo(
    () => {
      if (calDisplayMode === "week") {
        const first = calendarDays[0];
        const last = calendarDays[calendarDays.length - 1];
        const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
        return `${first.toLocaleDateString(locale, opts)} – ${last.toLocaleDateString(locale, { ...opts, year: "numeric" })}`;
      }
      return cursor.toLocaleDateString(locale, { month: "long", year: "numeric" });
    },
    [cursor, locale, calDisplayMode, calendarDays]
  );

  const eventsThisMonth = useMemo(
    () =>
      filteredEvents.filter(
        (event) =>
          calDisplayMode === "week"
            ? event.date >= calendarDays[0] && event.date <= calendarDays[calendarDays.length - 1]
            : event.date.getFullYear() === cursor.getFullYear() &&
              event.date.getMonth() === cursor.getMonth()
      ).length,
    [filteredEvents, cursor, calDisplayMode, calendarDays]
  );

  const selectedEvents = selectedDay ? eventsByDay.get(selectedDay) ?? [] : [];
  const hasApplications = applications.length > 0;
  const appById = useMemo(() => new Map(applications.map((app) => [app.id, app])), [applications]);
  const appByApplicationId = useMemo(() => {
    return new Map(applications.map((app) => [app.application_id, app]));
  }, [applications]);
  const todoSourceApplicationText = useCallback(
    (app: Application): string => {
      if (isTrackerTodoSource && todoSourcePinnedTrackerColumn) {
        const value = trackerApplicationValueForColumn(app, todoSourcePinnedTrackerColumn).trim();
        if (value) return value;
      }
      return `${app.company_name} — ${app.position}`;
    },
    [isTrackerTodoSource, todoSourcePinnedTrackerColumn]
  );
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
        label: todoSourceApplicationText(app),
        appId: app.id
      })),
    [applications, todoSourceApplicationText]
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
  const getTodoColumnKind = useCallback(
    (col: TodoColumnId): TodoColumnKind => {
      return todoColumnKinds[col] || TODO_COLUMN_KIND_DEFAULTS[col];
    },
    [todoColumnKinds]
  );

  const todoCellToString = useCallback((row: TodoRow, col: TodoColumnId): string => {
    if (col === "application") {
      const app = appById.get(row.appId);
      const pinnedValue = app ? todoSourceApplicationText(app) : `${row.company} — ${row.position}`;
      return `${row.applicationId} ${pinnedValue} ${row.company} ${row.position}`.trim();
    }
    if (col === "task") return row.todo.task || "";
    if (col === "task_location") return row.todo.task_location || "";
    if (col === "notes") return row.todo.notes || "";
    if (col === "documents_links") return row.todo.documents_links || "";
    if (col === "due_date") return row.todo.due_date || "";
    if (col === "status") return normalizeTodoStatus(row.todo.status);
    return "";
  }, [appById, todoSourceApplicationText]);

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
    // Apply manual row order when no sort or group is active
    const base = (() => {
      if (manualTodoOrder && !todoSortConfig && !todoGroupBy) {
        const byId = new Map(orderedTodos.map((r) => [r.todo.id, r]));
        const ordered = manualTodoOrder
          .map((id) => byId.get(id))
          .filter((r): r is TodoRow => !!r);
        const inOrder = new Set(manualTodoOrder);
        orderedTodos.forEach((r) => { if (!inOrder.has(r.todo.id)) ordered.push(r); });
        return ordered;
      }
      return orderedTodos;
    })();
    if (!todoGroupBy) return base;
    const next = [...base];
    next.sort((a, b) => {
      const aKey = todoCellToString(a, todoGroupBy).trim() || "(Empty)";
      const bKey = todoCellToString(b, todoGroupBy).trim() || "(Empty)";
      if (aKey === bKey) return 0;
      if (aKey === "(Empty)") return 1;
      if (bKey === "(Empty)") return -1;
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    });
    return next;
  }, [orderedTodos, todoGroupBy, todoCellToString, manualTodoOrder, todoSortConfig]);

  // Clear manual todo order when sort or group changes
  useEffect(() => {
    setManualTodoOrder(null);
  }, [todoSortConfig, todoGroupBy]);

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
      labels: todoColumnLabelOverrides,
      kinds: todoColumnKinds
    });
  }, [orderedTodoColumns, todoHiddenColumns, todoPinnedColumn, todoColumnLabelOverrides, todoColumnKinds]);

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
  const todoMenuCanSetType = Boolean(todoMenuCol && todoMenuCol !== "actions");
  const todoMenuFilterActive = Boolean(
    todoMenuCol && (todoColumnFilters[todoMenuCol] || "").trim().length > 0
  );
  const todoMenuSortActive = Boolean(todoMenuCol && todoSortConfig?.column === todoMenuCol);
  const todoMenuGroupActive = Boolean(todoMenuCol && todoGroupBy === todoMenuCol);
  const todoMenuCurrentCalc: TodoColumnCalcOp = todoMenuCol ? todoColumnCalcs[todoMenuCol] || "none" : "none";

  const iconBack = <span className="column-menu-back">←</span>;
  const iconChangeType = columnMenuIconChangeType;
  const iconTypeText = columnMenuIconTypeText;
  const iconTypeNumber = columnMenuIconTypeNumber;
  const iconTypeSelect = columnMenuIconTypeSelect;
  const iconTypeDate = columnMenuIconTypeDate;
  const iconTypeCheckbox = columnMenuIconTypeCheckbox;
  const iconTypeRating = columnMenuIconTypeRating;
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
  const iconDelete = columnMenuIconTrash;

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
      const mkType = (type: TodoColumnKind, label: string, icon: React.ReactNode): MenuEntry => ({
        kind: "item",
        key: `type-${type}`,
        label,
        icon,
        disabled: !todoMenuCanSetType,
        end: todoMenuKind === type ? <span className="column-menu-check">✓</span> : undefined,
        action: () => {
          if (!todoMenuCol || todoMenuCol === "actions") return;
          setTodoColumnKinds((prev) => ({ ...prev, [todoMenuCol]: type }));
          setTodoMenuView("root");
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
        disabled: !todoMenuCanSetType,
        submenu: "type",
        end: <ColumnMenuChevronRight />
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
    if (calDisplayMode === "week") {
      const next = new Date(cursor);
      next.setDate(cursor.getDate() + delta * 7);
      setCursor(next);
      setSelectedDay(toDateKey(next));
      return;
    }
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
    const previousTodos = app.todo_items || [];
    const nextTodos = previousTodos.map((item) => {
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
    
    await executeCommand({
      description: `Actualizar todo: ${previousTodos.find(t => t.id === todoId)?.task || "tarea"}`,
      async do() {
        await updateApplication(appId, { todo_items: nextTodos });
      },
      async undo() {
        await updateApplication(appId, { todo_items: previousTodos });
      }
    });
  };

  const removeTodoItem = async (appId: number, todoId: string) => {
    const confirmed = await confirmDialog({
      title: t("Delete to-do item"),
      message: t("Delete this to-do item?"),
      confirmLabel: t("Delete"),
      cancelLabel: t("Cancel"),
      tone: "danger"
    });
    if (!confirmed) return;
    const app = applications.find((entry) => entry.id === appId);
    if (!app) return;
    const previousTodos = app.todo_items || [];
    const nextTodos = previousTodos.filter((item) => item.id !== todoId);
    
    await executeCommand({
      description: `Eliminar todo: ${previousTodos.find(t => t.id === todoId)?.task || "tarea"}`,
      async do() {
        await updateApplication(appId, { todo_items: nextTodos });
      },
      async undo() {
        await updateApplication(appId, { todo_items: previousTodos });
      }
    });
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
    const targetTodos = targetApp.todo_items || [];
    const item = sourceTodos.find((todo) => todo.id === todoId);
    if (!item) return;
    const nextSourceTodos = sourceTodos.filter((todo) => todo.id !== todoId);
    const nextTargetTodos = [...targetTodos, item];
    
    await executeCommand({
      description: `Mover todo: ${item.task}`,
      async do() {
        await updateApplication(targetApp.id, { todo_items: nextTargetTodos });
        await updateApplication(sourceApp.id, { todo_items: nextSourceTodos });
      },
      async undo() {
        await updateApplication(targetApp.id, { todo_items: targetTodos });
        await updateApplication(sourceApp.id, { todo_items: sourceTodos });
      }
    });
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
    const previousTodos = targetApp.todo_items || [];
    const nextTodos = [...previousTodos, nextItem];
    const payload: Partial<Application> = { todo_items: nextTodos };
    const nextCompany = todoCreateDraft.company_name.trim();
    const nextPosition = todoCreateDraft.position.trim();
    if (nextCompany && nextCompany !== targetApp.company_name) {
      payload.company_name = nextCompany;
    }
    if (nextPosition && nextPosition !== targetApp.position) {
      payload.position = nextPosition;
    }
    
    await executeCommand({
      description: `Crear todo: ${trimmedTask}`,
      async do() {
        await updateApplication(targetApp.id, payload);
      },
      async undo() {
        await updateApplication(targetApp.id, { todo_items: previousTodos });
      }
    });
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
    const appId = editing.id;
    const previousApp = { ...editing };
    
    await executeCommand({
      description: `Actualizar ${editing.company_name || "evento"}`,
      async do() {
        await updateApplication(appId, payload);
        if (files.length > 0) {
          await uploadDocuments(appId, files);
          await refresh();
        }
      },
      async undo() {
        await updateApplication(appId, previousApp);
      }
    });
    setEditing(null);
  };

  const handleUploadDocuments = async (appId: number, files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      await uploadDocuments(appId, Array.from(files));
      await updateApplication(appId, {});
    } catch (error) {
      console.error("Failed to upload documents", error);
    }
  };

  const handleDeleteDocument = async (
    appId: number,
    fileId: string,
    opts?: { confirm?: boolean }
  ): Promise<boolean> => {
    if (opts?.confirm !== false) {
      const confirmed = await confirmDialog({
        title: t("Delete document"),
        message: t("Delete this document? This action cannot be undone."),
        confirmLabel: t("Delete"),
        cancelLabel: t("Cancel"),
        tone: "danger"
      });
      if (!confirmed) return false;
    }
    try {
      await deleteDocument(appId, fileId);
      await updateApplication(appId, {});
      return true;
    } catch (error) {
      console.error("Failed to delete document", error);
      return false;
    }
  };

  const handleDownloadDocument = (appId: number, fileId: string) => {
    void openExternal(documentDownloadUrl(appId, fileId));
  };

  const updateTodoFromDraft = async (app: Application, todoId: string, draft: TodoDraft) => {
    const todos = app.todo_items || [];
    let updated = false;
    const previousTodos = [...todos];
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
    
    await executeCommand({
      description: `Actualizar todo: ${todos.find(t => t.id === todoId)?.task || "tarea"}`,
      async do() {
        await updateApplication(app.id, payload);
      },
      async undo() {
        await updateApplication(app.id, { todo_items: previousTodos });
      }
    });
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

  /* ── Chip CSS class resolved by colorScheme config ──────────────── */
  const getChipClass = useCallback(
    (event: CalendarEvent): string => {
      if (calColorScheme === "status") {
        if (event.type === "To-Do") {
          const app = appById.get(event.appId);
          const todo = app?.todo_items?.find((t) => t.id === event.todoId);
          const status = todo ? normalizeTodoStatus(todo.status) : "pending";
          return status === "done" ? "application" : status === "in-progress" ? "interview" : "todo";
        }
        if (event.type === "Follow-Up") {
          const app = appById.get(event.appId);
          const fStatus = followupStatus(app?.followup_date);
          return fStatus === "overdue" ? "followup" : fStatus === "soon" ? "interview" : "application";
        }
        return event.type === "Interview" ? "interview" : "application";
      }
      if (calColorScheme === "company") {
        let hash = 0;
        for (const ch of event.company) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
        const idx = Math.abs(hash) % 6;
        return `company-${idx}`;
      }
      // default: "type"
      return event.type === "Follow-Up"
        ? "followup"
        : event.type === "To-Do"
        ? "todo"
        : event.type === "Application"
        ? "application"
        : "interview";
    },
    [calColorScheme, appById]
  );

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
                    <td><DateValueDisplay value={item.date} allowTime /></td>
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
                  const isCurrentMonth = calDisplayMode === "week" || date.getMonth() === cursor.getMonth();
                  const isToday = key === toDateKey(today);
                  const isSelected = key === selectedDay;
                  const visibleEvents = dayEvents.slice(0, calMaxEventsPerDay);
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
                        {calShowEventCount && dayEvents.length > 0 ? (
                          <span className="calendar-day-count">{dayEvents.length}</span>
                        ) : null}
                      </div>
                      <div className="calendar-day-events">
                        {visibleEvents.map((event) => {
                          const chipClass = getChipClass(event);
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

              {calShowDayPanel && (
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
                          {calShowTimeLabels && (
                            <span>{event.timeLabel ? `${event.timeLabel}` : t("All-day")}</span>
                          )}
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
              )}
            </div>
          </>
        )
    },
    {
      id: "calendar:todo",
      toolbar: {
          leading: (
            <TrackerSearchBar
              value={todoQuery}
              onChange={setTodoQuery}
              stageFilter={selected || "all"}
              onStageFilterChange={(next) => setSelected(next === "all" ? "" : next)}
              stages={applicationOptions.map((app) => app.value)}
              stageOptions={applicationOptions.map((app) => ({ value: app.value, label: app.label }))}
              outcomeFilter="all"
              onOutcomeFilterChange={() => undefined}
              outcomes={[]}
              placeholder={t("Search to-dos...")}
              allLabel={t("All")}
              stageAllLabel={t("All applications")}
              stageLabel={t("Application")}
              outcomeLabel={t("Status")}
              hideOutcomeFilter
              filterAriaLabel={t("Filter")}
              clearAriaLabel={t("Clear search")}
              alwaysShowClearButton
            />
          ),
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
          },
          trailing: (
            <>
              <div className="todo-summary">{hasApplications ? t("{count} pending", { count: pendingTodos }) : "-"}</div>
              <button className="primary" type="button" onClick={openTodoCreate} disabled={!hasApplications}>
                {t("Add To-Do")}
              </button>
            </>
          )
        },
      content: (
          <>
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
                      <th className="row-handle-col" />
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
                              canMove ? "column-header" : "",
                              isPinned ? "todo-sticky-col" : "",
                              isDragOver ? "todo-column-drag-over drag-over" : ""
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            style={{
                              width,
                              minWidth: width,
                              left: isPinned ? 0 : undefined
                            }}
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
                            <div className="todo-column-head th-content">
                              <span className="todo-column-title column-label">{todoColumnLabels[col]}</span>
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
                                  ...
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
                            <DateTimeCell
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
                          className={`editable-row${status === "Done" ? " todo-completed" : ""}${todoDragOverRowId === row.todo.id ? " row-drag-over" : ""}`}
                          onDragOver={(e) => {
                            if (todoDraggedRowRef.current === null || todoDraggedRowRef.current === row.todo.id) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            setTodoDragOverRowId(row.todo.id);
                          }}
                          onDragLeave={() => setTodoDragOverRowId(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            const fromId = todoDraggedRowRef.current;
                            if (fromId && fromId !== row.todo.id) {
                              const currentOrder = rowsForDisplay.map((r) => r.todo.id);
                              const fromIdx = currentOrder.indexOf(fromId);
                              const toIdx = currentOrder.indexOf(row.todo.id);
                              if (fromIdx >= 0 && toIdx >= 0) {
                                const next = [...currentOrder];
                                next.splice(fromIdx, 1);
                                next.splice(toIdx, 0, fromId);
                                setManualTodoOrder(next);
                              }
                            }
                            todoDraggedRowRef.current = null;
                            setTodoDraggedRowId(null);
                            setTodoDragOverRowId(null);
                          }}
                        >
                          <td
                            className="row-handle-col"
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", row.todo.id);
                              todoDraggedRowRef.current = row.todo.id;
                              setTodoDraggedRowId(row.todo.id);
                            }}
                            onDragEnd={() => {
                              todoDraggedRowRef.current = null;
                              setTodoDraggedRowId(null);
                              setTodoDragOverRowId(null);
                            }}
                          >
                            <div className="row-handle-group">
                              <button
                                className="row-insert-handle"
                                type="button"
                                aria-label="Add new to-do"
                                onClick={openTodoCreate}
                              >
                                <svg viewBox="0 0 16 16" aria-hidden="true" className="row-insert-icon">
                                  <path d="M8 2.5a.75.75 0 0 1 .75.75v4h4a.75.75 0 0 1 0 1.5h-4v4a.75.75 0 0 1-1.5 0v-4h-4a.75.75 0 0 1 0-1.5h4v-4A.75.75 0 0 1 8 2.5Z" />
                                </svg>
                              </button>
                              <div
                                className="row-grip-handle"
                                role="img"
                                aria-hidden="true"
                              />
                            </div>
                          </td>
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
                              <td colSpan={visibleTodoColumns.length + 1}>
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
                        <td className="row-handle-col" />
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
    (slotId, block) => {
      if (slotId === "calendar:alerts:content") {
        return calendarSlots[0]?.content || null;
      }
      if (slotId === "calendar:month:content") {
        return calendarSlots[1]?.content || null;
      }
      if (slotId === "calendar:todo:toolbar") {
        const source = resolveTodoSourceAccess(block);
        if (!source.hasSource) {
          return (
            <EditableTableToolbar
              toolbar={{
                leading: <div className="todo-summary">{source.reason || t("No linked source.")}</div>,
                trailing: (
                  <button className="primary" type="button" disabled>
                    {t("Add To-Do")}
                  </button>
                )
              }}
            />
          );
        }
        const toolbar = calendarSlots[2]?.toolbar;
        return toolbar ? <EditableTableToolbar toolbar={toolbar} /> : null;
      }
      if (slotId === "calendar:todo:content") {
        const source = resolveTodoSourceAccess(block);
        if (!source.hasSource) {
          return <div className="empty">{source.reason || t("No linked source.")}</div>;
        }
        return calendarSlots[2]?.content || null;
      }
      return null;
    },
    [calendarSlots, resolveTodoSourceAccess, t]
  );

  const resolveCalendarBlockProps = useCallback(
    (block: PageBlockConfig) => {
      if (
        block.type !== "todoTable" &&
        !(block.type === "editableTable" && (block as PageBlockConfig<"editableTable">).props.variant === "todo")
      ) {
        return null;
      }
      const tableBlock = block as PageBlockConfig<"todoTable">;
      const source = resolveTodoSourceAccess(block);
      return {
        description: source.hasSource
          ? hasApplications
            ? t("Manage preparation tasks linked to each application.")
            : t("Create an application to start a to-do list.")
          : source.reason || t("No linked source.")
      };
    },
    [hasApplications, resolveTodoSourceAccess, t]
  );

  const resolveCalendarDuplicateProps = useCallback(
    (block: PageBlockConfig) => {
      if (
        block.type !== "todoTable" &&
        !(block.type === "editableTable" && (block as PageBlockConfig<"editableTable">).props.variant === "todo")
      ) {
        return null;
      }
      const tableBlock = block as PageBlockConfig<"todoTable">;

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
        variant: "todo",
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
        toolbarActionsSlotId: undefined,
        links: tableBlock.props.links
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
                  type="datetime-local"
                  value={toDateTimeLocalValue(todoCreateDraft.due_date)}
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
                  type="datetime-local"
                  value={toDateTimeLocalValue(todoEditDraft.due_date)}
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
                  type="datetime-local"
                  value={toDateTimeLocalValue(todoDetailDraft.due_date)}
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
                className="icon-button danger"
                type="button"
                aria-label={t("Delete")}
                onClick={async () => {
                  const removed = await handleDeleteDocument(documentModal.appId, documentModal.file.id);
                  if (!removed) return;
                  setDocumentModal(null);
                }}
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

export default CalendarPage;
