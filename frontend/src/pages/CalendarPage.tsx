import React, { useEffect, useMemo, useRef, useState } from "react";
import ApplicationForm from "../components/ApplicationForm";
import ContactsEditor from "../components/ContactsEditor";
import DocumentsDropzone from "../components/DocumentsDropzone";
import StarRating from "../components/StarRating";
import { DateCell, TextCell } from "../components/TableCells";
import { deleteDocument, documentDownloadUrl, downloadIcs, openExternal, uploadDocuments } from "../api";
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
import { normalizeTodoStatus, TODO_STATUSES, TODO_STATUS_CLASS, type TodoStatus } from "../constants";

const toDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const buildWeekdayLabels = (): string[] => {
  const formatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });
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

const downloadEventIcs = (event: CalendarEvent) => {
  const content = buildSingleEventIcs(event);
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const safeName = `${event.type}-${event.company}-${event.dateKey}`
    .replace(/[^a-z0-9-_]+/gi, "_")
    .replace(/_+/g, "_");
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeName}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const CalendarPage: React.FC = () => {
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

  const weekdayLabels = useMemo(buildWeekdayLabels, []);
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
    () => cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    [cursor]
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
  const filteredTodos = useMemo(
    () => (selected ? todoRows.filter((row) => row.applicationId === selected) : todoRows),
    [todoRows, selected]
  );
  const pendingTodos = useMemo(
    () => filteredTodos.filter((row) => normalizeTodoStatus(row.todo.status) !== "Done").length,
    [filteredTodos]
  );
  const orderedTodos = useMemo(() => {
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
  }, [filteredTodos]);

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
    downloadEventIcs(event);
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

  const downloadTodoIcs = (row: TodoRow) => {
    const url = `/api/export/todo?app_id=${row.appId}&todo_id=${encodeURIComponent(
      row.todo.id
    )}`;
    void openExternal(url);
  };

  const detailDocuments = detailApp?.documents_files || [];
  const detailContacts = detailApp?.contacts || [];

  return (
    <div className="calendar">
      <section className="panel">
        <h2>Calendar</h2>
        <p>Track interviews and follow-ups with a consolidated event list.</p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Calendar Alerts</h3>
          <p>Upcoming or overdue follow-ups and to-do items.</p>
        </div>
        {alerts.length === 0 ? (
          <div className="empty">No event alerts.</div>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Company</th>
                  <th>Detail</th>
                  <th>Date</th>
                  <th>Status</th>
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
        )}
      </section>

      <section className="panel">
        <div className="calendar-header">
          <div>
            <h3>{monthLabel}</h3>
            <p>{eventsThisMonth} events scheduled this month.</p>
          </div>
          <div className="calendar-header-actions">
            <div className="calendar-actions">
              <button className="ghost" onClick={() => downloadIcs()}>
                Download All (ICS)
              </button>
              <button className="primary" onClick={() => downloadIcs(selected)} disabled={!selected}>
                Download Selected
              </button>
            </div>
            <div className="calendar-nav">
              <button className="ghost small" onClick={() => shiftMonth(-1)}>
                Previous
              </button>
              <button className="ghost small" onClick={handleToday}>
                Today
              </button>
              <button className="ghost small" onClick={() => shiftMonth(1)}>
                Next
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
                      <span className="calendar-more">+{remainingEvents} more</span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="calendar-day-panel">
            <h4>{selectedDateLabel}</h4>
            {selectedEvents.length === 0 ? (
              <div className="empty">No events scheduled.</div>
            ) : (
              <div className="calendar-day-list">
                {selectedEvents.map((event) => (
                  <div key={event.id} className="calendar-day-event">
                    <div className="calendar-day-event-body">
                      <strong>{event.type}</strong>
                      <span>
                        {event.company} — {event.position}
                      </span>
                      <span>{event.timeLabel ? `${event.timeLabel}` : "All-day"}</span>
                    </div>
                    <div className="row-actions">
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() => handleEventDownload(event)}
                        aria-label="Download"
                      >
                        <svg viewBox="0 0 20 20" aria-hidden="true">
                          <path d="M10 2.5a.75.75 0 0 1 .75.75v7.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06l2.22 2.22V3.25A.75.75 0 0 1 10 2.5Zm-5 12.75c0-.41.34-.75.75-.75h8.5a.75.75 0 0 1 .75.75v1.5A1.75 1.75 0 0 1 13.25 18h-6.5A1.75 1.75 0 0 1 5 16.75v-1.5Z" />
                        </svg>
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() => handleEventDetail(event)}
                        aria-label="Details"
                      >
                        <svg viewBox="0 0 20 20" aria-hidden="true">
                          <path d="M10 4.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm0 1.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-.75 1.75h1.5v1.5h-1.5v-1.5Zm0 3h1.5v3h-1.5v-3Z" />
                        </svg>
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() => handleEventEdit(event)}
                        aria-label="Edit"
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
                          aria-label="Delete"
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
      </section>

      <section className="panel">
        <div className="todo-header">
          <div>
            <h3>To-Do List</h3>
            <p>
              {hasApplications
                ? "Manage preparation tasks linked to each application."
                : "Create an application to start a to-do list."}
            </p>
          </div>
          <div className="todo-controls">
            <div className="todo-summary">
              {hasApplications ? `${pendingTodos} pending` : "—"}
            </div>
            <div className="field todo-select">
              <label>Application</label>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                disabled={!hasApplications}
              >
                <option value="">All applications</option>
                {applicationOptions.map((app) => (
                  <option key={app.value} value={app.value}>
                    {app.label}
                  </option>
                ))}
              </select>
            </div>
            <button className="primary" type="button" onClick={openTodoCreate} disabled={!hasApplications}>
              Add To-Do
            </button>
          </div>
        </div>
        {!hasApplications ? (
          <div className="empty">No applications yet. Add one to start tracking tasks.</div>
        ) : (
          <>
            {orderedTodos.length === 0 ? (
              <div className="empty">
                {selected ? "No to-do items for this application." : "No to-do items yet."}
              </div>
            ) : (
              <table className="table todo-table">
                <thead>
                  <tr>
                    <th>Application</th>
                    <th>Task</th>
                    <th>Task Location</th>
                    <th>Notes</th>
                    <th>Documents / Links</th>
                    <th>Due Date</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {orderedTodos.map((row) => {
                    const status = normalizeTodoStatus(row.todo.status);
                    const docs = parseDocumentLinks(row.todo.documents_links);
                    const appFiles = appById.get(row.appId)?.documents_files || [];
                    return (
                      <tr
                        key={`${row.applicationId}-${row.todo.id}`}
                        className={status === "Done" ? "todo-completed" : undefined}
                      >
                        <td>
                          <select
                            className="cell-select"
                            value={row.applicationId}
                            onChange={(event) =>
                              moveTodoItem(row.appId, row.todo.id, event.target.value)
                            }
                          >
                            {applicationOptions.map((app) => (
                              <option key={app.value} value={app.value}>
                                {app.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <TextCell
                            value={row.todo.task}
                            onCommit={(next) =>
                              updateTodoItem(row.appId, row.todo.id, { task: next })
                            }
                          />
                        </td>
                        <td>
                          <TextCell
                            value={row.todo.task_location || ""}
                            placeholder="Location"
                            onCommit={(next) =>
                              updateTodoItem(row.appId, row.todo.id, { task_location: next })
                            }
                          />
                        </td>
                        <td>
                          <TextCell
                            value={row.todo.notes || ""}
                            placeholder="Notes"
                            onCommit={(next) =>
                              updateTodoItem(row.appId, row.todo.id, { notes: next })
                            }
                          />
                        </td>
                        <td>
                          <TextCell
                            value={row.todo.documents_links || ""}
                            placeholder="Links"
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
                                  aria-label={`Document ${file.name}`}
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
                        </td>
                        <td>
                          <DateCell
                            value={row.todo.due_date || ""}
                            onCommit={(next) =>
                              updateTodoItem(row.appId, row.todo.id, { due_date: next })
                            }
                          />
                        </td>
                        <td>
                          <select
                            className={`cell-select todo-status ${TODO_STATUS_CLASS[status]}`}
                            value={status}
                            onChange={(event) =>
                              updateTodoItem(row.appId, row.todo.id, {
                                status: event.target.value
                              })
                            }
                          >
                            {TODO_STATUSES.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="row-actions-cell">
                          <div className="row-actions">
                            <button
                              className="icon-button"
                              type="button"
                              onClick={() => openTodoDetail(row.appId, row.todo.id)}
                              aria-label="Details"
                            >
                              <svg viewBox="0 0 20 20" aria-hidden="true">
                                <path d="M10 4.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm0 1.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-.75 1.75h1.5v1.5h-1.5v-1.5Zm0 3h1.5v3h-1.5v-3Z" />
                              </svg>
                            </button>
                            <button
                              className="icon-button"
                              type="button"
                              onClick={() => openTodoEdit(row.appId, row.todo.id)}
                              aria-label="Edit"
                            >
                              <svg viewBox="0 0 20 20" aria-hidden="true">
                                <path d="M14.85 2.85a1.5 1.5 0 0 1 2.12 2.12l-9.5 9.5-3.2.35.35-3.2 9.5-9.5ZM4.3 15.7h11.4v1.5H4.3v-1.5Z" />
                              </svg>
                            </button>
                            <button
                              className="icon-button"
                              type="button"
                              onClick={() => downloadTodoIcs(row)}
                              aria-label="Download"
                            >
                              <svg viewBox="0 0 20 20" aria-hidden="true">
                                <path d="M10 2a1 1 0 0 1 1 1v8.17l2.59-2.58a1 1 0 1 1 1.41 1.41l-4.3 4.3a1 1 0 0 1-1.41 0l-4.3-4.3a1 1 0 1 1 1.41-1.41L9 11.17V3a1 1 0 0 1 1-1Zm-6 14a1 1 0 0 1 1 1v1h10v-1a1 1 0 1 1 2 0v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a1 1 0 0 1 1-1Z" />
                              </svg>
                            </button>
                            <button
                              className="icon-button danger"
                              type="button"
                              onClick={() => removeTodoItem(row.appId, row.todo.id)}
                              aria-label="Delete"
                            >
                              <svg viewBox="0 0 20 20" aria-hidden="true">
                                <path d="M7.5 3.5h5l.5 1.5H17v1.5H3V5h3.5l.5-1.5Zm1 4h1.5v7H8.5v-7Zm3 0H13v7h-1.5v-7ZM5.5 6.5h9l-.6 9.1a1.5 1.5 0 0 1-1.5 1.4H7.6a1.5 1.5 0 0 1-1.5-1.4l-.6-9.1Z" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>

      {todoCreateDraft && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <header className="modal-header">
              <div>
                <h2>Add To-Do</h2>
                <p>
                  {todoCreateDraft.company_name} — {todoCreateDraft.position}
                </p>
              </div>
              <button className="ghost" onClick={closeTodoCreate} type="button" aria-label="Close">
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
                <label>Application</label>
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
                <label>Task</label>
                <input
                  value={todoCreateDraft.task}
                  onChange={(event) => updateTodoCreateDraft({ task: event.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Status</label>
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
                <label>Due Date</label>
                <input
                  type="date"
                  value={todoCreateDraft.due_date}
                  onChange={(event) => updateTodoCreateDraft({ due_date: event.target.value })}
                />
              </div>
              <div className="field">
                <label>Company Name</label>
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
                <label>Position</label>
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
                <label>Task Location</label>
                <input
                  value={todoCreateDraft.task_location}
                  onChange={(event) =>
                    updateTodoCreateDraft({ task_location: event.target.value })
                  }
                  placeholder="Meeting room, HQ, remote..."
                />
              </div>
              <div className="field full">
                <label>Notes</label>
                <textarea
                  value={todoCreateDraft.notes}
                  onChange={(event) => updateTodoCreateDraft({ notes: event.target.value })}
                />
              </div>
              <div className="field full">
                <label>Documents / Links</label>
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
                    <p className="documents-help">Adjunta CVs, portfolios o cartas de oferta.</p>
                    <div className="documents-list">
                      {(todoCreateApp.documents_files || []).length === 0 && (
                        <div className="documents-empty">No documents uploaded.</div>
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
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="field full">
                    <label>Contacts</label>
                    <ContactsEditor
                      contacts={todoCreateApp.contacts || []}
                      onCommit={(next) => updateApplication(todoCreateApp.id, { contacts: next })}
                    />
                  </div>
                </>
              )}
              <div className="form-actions">
                <button className="ghost" type="button" onClick={closeTodoCreate}>
                  Cancel
                </button>
                <button className="primary" type="submit">
                  Add
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
                <h2>Edit To-Do</h2>
                <p>
                  {todoEditDraft.company_name} — {todoEditDraft.position}
                </p>
              </div>
              <button className="ghost" onClick={() => setTodoEdit(null)} type="button" aria-label="Close">
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
                <label>Task</label>
                <input
                  value={todoEditDraft.task}
                  onChange={(event) => updateTodoEditDraft({ task: event.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>Status</label>
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
                <label>Due Date</label>
                <input
                  type="date"
                  value={todoEditDraft.due_date}
                  onChange={(event) => updateTodoEditDraft({ due_date: event.target.value })}
                />
              </div>
              <div className="field">
                <label>Company Name</label>
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
                <label>Position</label>
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
                <label>Task Location</label>
                <input
                  value={todoEditDraft.task_location}
                  onChange={(event) => updateTodoEditDraft({ task_location: event.target.value })}
                  placeholder="Meeting room, HQ, remote..."
                />
              </div>
              <div className="field full">
                <label>Notes</label>
                <textarea
                  value={todoEditDraft.notes}
                  onChange={(event) => updateTodoEditDraft({ notes: event.target.value })}
                />
              </div>
              <div className="field full">
                <label>Documents / Links</label>
                <textarea
                  value={todoEditDraft.documents_links}
                  onChange={(event) => updateTodoEditDraft({ documents_links: event.target.value })}
                />
              </div>
              <div className="field full">
                <DocumentsDropzone
                  onUpload={(files) => handleUploadDocuments(todoEditEntry.app.id, files)}
                />
                <p className="documents-help">Adjunta CVs, portfolios o cartas de oferta.</p>
                <div className="documents-list">
                  {(todoEditEntry.app.documents_files || []).length === 0 && (
                    <div className="documents-empty">No documents uploaded.</div>
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
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="field full">
                <label>Contacts</label>
                <ContactsEditor
                  contacts={todoEditEntry.app.contacts || []}
                  onCommit={(next) => updateApplication(todoEditEntry.app.id, { contacts: next })}
                />
              </div>
              <div className="form-actions">
                <button className="ghost" type="button" onClick={() => setTodoEdit(null)}>
                  Cancel
                </button>
                <button className="primary" type="submit">
                  Save
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
                <h3>{todoDetailDraft.task || "To-Do"}</h3>
                <p>
                  {todoDetailDraft.company_name} — {todoDetailDraft.position}
                </p>
              </div>
              <button className="ghost" onClick={() => setTodoDetail(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="drawer-body">
              <label>
                Task
                <input
                  className="cell-input"
                  value={todoDetailDraft.task}
                  onChange={(event) => updateTodoDetailDraft({ task: event.target.value })}
                />
              </label>
              <label>
                Status
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
                Due Date
                <input
                  className="cell-date"
                  type="date"
                  value={todoDetailDraft.due_date}
                  onChange={(event) => updateTodoDetailDraft({ due_date: event.target.value })}
                />
              </label>
              <label>
                Company Name
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
                Position
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
                Task Location
                <input
                  className="cell-input"
                  value={todoDetailDraft.task_location}
                  onChange={(event) => updateTodoDetailDraft({ task_location: event.target.value })}
                />
              </label>
              <label>
                Notes
                <textarea
                  value={todoDetailDraft.notes}
                  onChange={(event) => updateTodoDetailDraft({ notes: event.target.value })}
                />
              </label>
              <label>
                Documents / Links
                <textarea
                  value={todoDetailDraft.documents_links}
                  onChange={(event) =>
                    updateTodoDetailDraft({ documents_links: event.target.value })
                  }
                />
              </label>
              <div className="drawer-section">
                <h4>Contacts</h4>
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
                Save changes
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
              <button className="ghost" onClick={() => setDetailApp(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="drawer-body">
              <label>
                Company Score
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
                Notes
                <textarea
                  value={detailDraft.notes}
                  onChange={(event) =>
                    setDetailDraft((prev) => ({ ...prev, notes: event.target.value }))
                  }
                />
              </label>
              <label>
                Job Description
                <textarea
                  value={detailDraft.job_description}
                  onChange={(event) =>
                    setDetailDraft((prev) => ({ ...prev, job_description: event.target.value }))
                  }
                />
              </label>
              <label>
                Improvement Areas
                <textarea
                  value={detailDraft.improvement_areas}
                  onChange={(event) =>
                    setDetailDraft((prev) => ({ ...prev, improvement_areas: event.target.value }))
                  }
                />
              </label>
              <label>
                Skill To Upgrade
                <textarea
                  value={detailDraft.skill_to_upgrade}
                  onChange={(event) =>
                    setDetailDraft((prev) => ({ ...prev, skill_to_upgrade: event.target.value }))
                  }
                />
              </label>
              <label>
                Documents / Links
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
                <p className="documents-help">Adjunta CVs, portfolios o cartas de oferta.</p>
                <div className="documents-list">
                  {detailDocuments.length === 0 && (
                    <div className="documents-empty">No documents uploaded.</div>
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
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="drawer-section">
                <h4>Contacts</h4>
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
                Save changes
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
                <h2>Document</h2>
                <p>{documentModal.file.name}</p>
              </div>
              <button className="ghost" onClick={() => setDocumentModal(null)} type="button" aria-label="Close">
                ×
              </button>
            </header>
            <div className="doc-info">
              <div className="doc-row">
                <span className="doc-label">Name</span>
                <span>{documentModal.file.name}</span>
              </div>
              <div className="doc-row">
                <span className="doc-label">Added</span>
                <span>{formatUploadedAt(documentModal.file.uploaded_at)}</span>
              </div>
              <div className="doc-row">
                <span className="doc-label">Size</span>
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
                Download
              </button>
              <button
                className="danger"
                type="button"
                onClick={async () => {
                  await handleDeleteDocument(documentModal.appId, documentModal.file.id);
                  setDocumentModal(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CalendarPage;
