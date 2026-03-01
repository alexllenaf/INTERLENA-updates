import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError, listEmailMetadata, listGoogleAccounts } from "../../../api";
import {
  READ_MAILBOX_ALL,
  READ_MAILBOX_INBOX,
  READ_MAILBOX_SENT,
  MIN_EMAIL_LOOKBACK_DAYS,
  MAX_EMAIL_LOOKBACK_DAYS,
  buildEmailAccountOptions,
  buildLookbackStartDate,
  filterEmailMessagesByAccount,
  formatMailboxLabel,
  normalizeEmailLookbackDays,
  resolveEmailMetadataFolderParam
} from "../../../features/email/readFilters";
import {
  DEFAULT_EMAIL_SUMMARY_AWAITING_REPLY_DAYS,
  DEFAULT_EMAIL_SUMMARY_AWAITING_RESPONSE_DAYS,
  DEFAULT_EMAIL_SUMMARY_CARD_ORDER,
  DEFAULT_EMAIL_SUMMARY_TIMELINE_DAYS,
  DEFAULT_EMAIL_SUMMARY_VOLUME_DAYS,
  EMAIL_SUMMARY_CARD_LABELS,
  buildInformationalEmailSummary,
  limitEmailMessagesPerContact,
  moveEmailSummaryCard,
  normalizeEmailSummaryCardOrder,
  normalizeEmailSummaryDays,
  type EmailSummaryCardId,
  type InformationalEmailSummary
} from "../../../features/email/summaryCards";
import {
  buildEmailReadContactsFromApplications,
  buildSelectedEmailReadContacts
} from "../../../features/email/trackerContacts";
import { TRACKER_BASE_COLUMN_ORDER, TRACKER_COLUMN_LABELS } from "../../../shared/columnSchema";
import { isRecord, normalizeCustomProperties, normalizeString, normalizeStringArray } from "../../../shared/normalize";
import { useAppData } from "../../../state";
import { type Application, type EmailMetadata, type GoogleAccount } from "../../../types";
import { followupStatus } from "../../../utils";
import BlockPanel from "../../BlockPanel";
import { DateValueDisplay } from "../../TableCells";
import {
  INFORMATIONAL_TABLE_SOURCE_EMAIL_LINK_KEY,
  INFORMATIONAL_TABLE_SOURCE_TABLE_LINK_KEY,
  INFORMATIONAL_TABLE_SOURCE_CALENDAR_LINK_KEY,
  collectBlockTargets,
  collectEditableTableTargets,
  buildBlockGraph,
  resolveLinkedBlock,
  getBlockLink,
  patchBlockLink
} from "../blockLinks";
import {
  type PageBlockPropsMap,
  type AlertItemType,
  type AlertStatusFilter,
  type AlertSortOrder,
  type AlertVisibleColumn
} from "../types";
import { useEmailBlockCacheEntry } from "../emailBlockCache";
import { resolveEditableTableModel } from "./editableTableBlock";
import { SourceTablePreview } from "./sourceTablePreview";
import { createSlotContext, renderHeader } from "./shared";
import { type BlockDefinition } from "./types";

type InformationalTableSourceMode = NonNullable<PageBlockPropsMap["informationalTable"]["sourceMode"]>;

type InformationalLinkedTableModel = {
  columns: string[];
  rows: string[][];
};

type InformationalEmailMessage = EmailMetadata & {
  contactEmail: string;
  contactName: string;
  contactCompany: string;
  direction: "Recibido" | "Enviado";
};

type InformationalEmailState = {
  loading: boolean;
  error: string | null;
  messages: InformationalEmailMessage[];
  contactsReviewed: number;
  totalContacts: number;
};

const DEFAULT_COLUMNS = ["Column A", "Column B"];
const DEFAULT_ROWS = [["-", "-"]];
const DEFAULT_INFORMATIONAL_COLUMN_WIDTH = 120;
const INFORMATIONAL_HEADER_ICON_WIDTH_BUDGET = 28;
const DEFAULT_EMAIL_RECENT_LIMIT = 8;
const MIN_EMAIL_RECENT_LIMIT = 3;
const MAX_EMAIL_RECENT_LIMIT = 20;
const VISIBLE_COLUMNS_MENU_WIDTH = 280;
const FLOATING_MENU_GUTTER = 12;
const FLOATING_MENU_OFFSET = 6;
const EMAIL_ACTIVITY_COLUMNS = ["Contacto", "Empresa", "Asunto", "Tipo", "Estado", "Fecha", "Bandeja"];
const EMAIL_FOLDER_OPTIONS = [
  { value: "", label: "Heredar del bloque vinculado" },
  { value: READ_MAILBOX_ALL, label: "Todo" },
  { value: READ_MAILBOX_INBOX, label: "Inbox" },
  { value: READ_MAILBOX_SENT, label: "Enviados" }
];
const DEFAULT_EMAIL_STATE: InformationalEmailState = {
  loading: false,
  error: null,
  messages: [],
  contactsReviewed: 0,
  totalContacts: 0
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

const normalizeSourceMode = (
  value: unknown,
  fallback: InformationalTableSourceMode
): InformationalTableSourceMode => {
  if (value === "editableTable" || value === "email" || value === "manual" || value === "applicationAlerts") {
    return value;
  }
  return fallback;
};

const normalizeColumns = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [...DEFAULT_COLUMNS];
  const columns = raw
    .map((value) => (typeof value === "string" ? value : ""))
    .filter((value, index, list) => index < list.length);
  return columns.length > 0 ? columns : [...DEFAULT_COLUMNS];
};

const normalizeRows = (raw: unknown, columnCount: number): string[][] => {
  const width = Math.max(1, columnCount);
  if (!Array.isArray(raw)) {
    return DEFAULT_ROWS.map((row) => Array.from({ length: width }, (_, index) => row[index] || ""));
  }
  const rows = raw
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) =>
      Array.from({ length: width }, (_, index) => {
        const value = row[index];
        return typeof value === "string" ? value : "";
      })
    );
  return rows.length > 0 ? rows : DEFAULT_ROWS.map((row) => Array.from({ length: width }, (_, index) => row[index] || ""));
};

const normalizeColumnWidths = (raw: unknown): Record<string, number> => {
  if (!isRecord(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw)
      .map(([key, value]) => {
        const normalizedKey = key.trim();
        const numeric = Math.round(Number(value));
        if (!normalizedKey || !Number.isFinite(numeric) || numeric < 48) {
          return null;
        }
        return [normalizedKey, numeric] as const;
      })
      .filter((entry): entry is readonly [string, number] => entry !== null)
  );
};

const normalizeEmailRecentLimit = (value: unknown): number => {
  const numeric = Math.round(Number(value) || DEFAULT_EMAIL_RECENT_LIMIT);
  return Math.max(MIN_EMAIL_RECENT_LIMIT, Math.min(MAX_EMAIL_RECENT_LIMIT, numeric));
};

const normalizeSelectedColumns = (raw: unknown, availableColumns: string[]): string[] => {
  const allowed = new Set(availableColumns);
  return Array.from(
    new Set(
      normalizeStringArray(raw).filter((column) => allowed.has(column))
    )
  );
};

const normalizeOrderedColumns = (raw: unknown, availableColumns: string[]): string[] => {
  const allowed = new Set(availableColumns);
  const ordered = Array.from(
    new Set(
      normalizeStringArray(raw).filter((column) => allowed.has(column))
    )
  );
  const used = new Set(ordered);
  availableColumns.forEach((column) => {
    if (!used.has(column)) {
      ordered.push(column);
    }
  });
  return ordered;
};

const reorderByIndex = <T,>(items: T[], fromIndex: number, toIndex: number): T[] => {
  if (fromIndex === toIndex) return [...items];
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  if (typeof item === "undefined") return [...items];
  next.splice(toIndex, 0, item);
  return next;
};

const areStringArraysEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const estimateHeaderMinWidth = (label: string): number => {
  const safeLabel = label.trim() || "Column";
  const labelWidth = safeLabel.length * 8.5;
  return Math.max(DEFAULT_INFORMATIONAL_COLUMN_WIDTH, Math.ceil(labelWidth + INFORMATIONAL_HEADER_ICON_WIDTH_BUDGET));
};

const formatTargetLabel = (target: { pageId: string; title: string }) => `[${target.pageId}] ${target.title}`;

const trackerValueForColumn = (app: Application, key: string): string => {
  if (key.startsWith("prop__")) {
    return app.properties?.[key.slice("prop__".length)] || "";
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

const isTrackerSourceTarget = (target: { blockId: string; props: Record<string, unknown> }): boolean => {
  const schemaRef = normalizeString(target.props.schemaRef);
  const contentSlotId = normalizeString(target.props.contentSlotId);
  return (
    schemaRef === "tracker.applications@1" ||
    target.blockId === "tracker:table" ||
    contentSlotId.startsWith("tracker:content")
  );
};

const buildTrackerSourceModel = (
  targetProps: Record<string, unknown>,
  settings: unknown,
  applications: Application[]
): InformationalLinkedTableModel => {
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
  const hiddenColumns = new Set<string>([
    ...normalizeStringArray(settingsRecord.hidden_columns),
    ...(isRecord(targetProps.overrides)
      ? normalizeStringArray((targetProps.overrides as Record<string, unknown>).hiddenColumns)
      : [])
  ]);

  const orderedKeys: string[] = [];
  const pushKey = (key: string) => {
    const normalized = key.trim();
    if (!normalized || hiddenColumns.has(normalized) || orderedKeys.includes(normalized)) return;
    orderedKeys.push(normalized);
  };

  (overrideOrder.length > 0 ? overrideOrder : settingsOrder).forEach(pushKey);
  TRACKER_BASE_COLUMN_ORDER.forEach(pushKey);
  customProps.forEach((prop) => pushKey(`prop__${prop.key}`));

  const usedLabels = new Set<string>();
  const columns: string[] = [];
  const keyByLabel: string[] = [];
  orderedKeys.forEach((key) => {
    const labelOverride = columnLabels[key];
    let labelSeed = typeof labelOverride === "string" ? labelOverride.trim() : "";
    if (key.startsWith("prop__")) {
      const propKey = key.slice("prop__".length);
      const prop = customPropByKey.get(propKey) || null;
      if (!labelSeed) labelSeed = prop?.name || key;
    } else if (!labelSeed) {
      labelSeed = TRACKER_COLUMN_LABELS[key] || key;
    }
    const label = createUniqueLabel(labelSeed || key, usedLabels);
    columns.push(label);
    keyByLabel.push(key);
  });

  return {
    columns,
    rows: applications.map((app) => keyByLabel.map((columnKey) => trackerValueForColumn(app, columnKey)))
  };
};

const toVisibleEditableTableModel = (
  targetProps: PageBlockPropsMap["editableTable"],
  settings: unknown
): InformationalLinkedTableModel => {
  const model = resolveEditableTableModel(targetProps, { settings });
  const hidden = new Set(model.hiddenColumns);
  const visibleIndexes = model.columns
    .map((column, index) => ({ column, index }))
    .filter((entry) => !hidden.has(entry.column));
  const visibleColumns = visibleIndexes.map((entry) => entry.column);
  if (visibleColumns.length === 0) {
    return { columns: model.columns, rows: model.rows };
  }
  return {
    columns: visibleColumns,
    rows: model.rows.map((row) => visibleIndexes.map((entry) => row[entry.index] || ""))
  };
};

const filterTableColumns = (
  table: InformationalLinkedTableModel,
  visibleColumns: string[]
): InformationalLinkedTableModel => {
  if (visibleColumns.length === 0 || visibleColumns.length >= table.columns.length) {
    return table;
  }
  const indexes = visibleColumns
    .map((column) => ({ column, index: table.columns.indexOf(column) }))
    .filter((entry) => entry.index >= 0);
  if (indexes.length === 0) return table;
  return {
    columns: indexes.map((entry) => entry.column),
    rows: table.rows.map((row) => indexes.map((entry) => row[entry.index] || ""))
  };
};

const reorderTableColumns = (
  table: InformationalLinkedTableModel,
  orderedColumns: string[]
): InformationalLinkedTableModel => {
  if (orderedColumns.length === 0 || areStringArraysEqual(orderedColumns, table.columns)) {
    return table;
  }
  const indexes = orderedColumns
    .map((column) => ({ column, index: table.columns.indexOf(column) }))
    .filter((entry) => entry.index >= 0);
  if (indexes.length === 0) return table;
  return {
    columns: indexes.map((entry) => entry.column),
    rows: table.rows.map((row) => indexes.map((entry) => row[entry.index] || ""))
  };
};

const buildEmailDirection = (row: EmailMetadata, contactEmail: string): "Recibido" | "Enviado" => {
  const normalizedContact = contactEmail.toLowerCase();
  const fromAddress = normalizeString(row.from_address).toLowerCase();
  return fromAddress.includes(normalizedContact) ? "Recibido" : "Enviado";
};

const mergeEmailMessages = (messages: InformationalEmailMessage[]): InformationalEmailMessage[] => {
  const deduped = new Map<string, InformationalEmailMessage>();
  messages.forEach((message) => {
    const key = normalizeString(message.message_id) || `${message.contactEmail}:${message.date}:${message.subject}`;
    if (!key) return;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, message);
      return;
    }
    const existingTs = Date.parse(existing.date);
    const nextTs = Date.parse(message.date);
    if (!Number.isFinite(existingTs) || nextTs > existingTs) {
      deduped.set(key, message);
    }
  });
  return Array.from(deduped.values()).sort((left, right) => {
    const leftTs = Date.parse(left.date);
    const rightTs = Date.parse(right.date);
    if (!Number.isFinite(leftTs) && !Number.isFinite(rightTs)) return 0;
    if (!Number.isFinite(leftTs)) return 1;
    if (!Number.isFinite(rightTs)) return -1;
    return rightTs - leftTs;
  });
};

const formatEmailDateTime = (value: string): string => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value || "—";
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
};

const describeEmailLoadingError = (errors: string[]): string | null => {
  if (errors.length === 0) return null;
  const unique = Array.from(new Set(errors.map((value) => value.trim()).filter(Boolean)));
  if (unique.length === 1) return unique[0];
  return "No se pudieron recuperar todos los correos recientes de los contactos vinculados.";
};

const loadEmailMessagesForContacts = async (params: {
  contacts: Array<{ email: string; name: string; company: string }>;
  folder?: string;
  startDate?: string;
  refresh?: boolean;
  signal?: AbortSignal;
}): Promise<{
  messages: InformationalEmailMessage[];
  error: string | null;
}> => {
  const results = await Promise.allSettled(
    params.contacts.map(async (contact) => {
      const rows = await listEmailMetadata({
        contact_id: contact.email,
        folder: params.folder,
        start_date: params.startDate,
        refresh: params.refresh,
        signal: params.signal
      });
      return rows.map((row) => ({
        ...row,
        contactEmail: contact.email,
        contactName: contact.name || contact.email,
        contactCompany: contact.company || "",
        direction: buildEmailDirection(row, contact.email)
      }));
    })
  );

  const merged: InformationalEmailMessage[] = [];
  const errors: string[] = [];
  results.forEach((result) => {
    if (result.status === "fulfilled") {
      merged.push(...result.value);
      return;
    }
    const reason = result.reason;
    if (reason instanceof DOMException && reason.name === "AbortError") return;
    if (reason instanceof ApiError) {
      errors.push(reason.message);
      return;
    }
    errors.push("No se pudieron cargar los correos recientes.");
  });

  return {
    messages: mergeEmailMessages(merged),
    error: describeEmailLoadingError(errors)
  };
};

const renderBasicTable = (
  keyPrefix: string,
  columns: string[],
  rows: string[][],
  emptyMessage: string,
  options?: {
    columnWidths?: Record<string, number>;
    resizable?: boolean;
    onResizeStart?: (column: string, event: React.MouseEvent<HTMLDivElement>) => void;
  }
) => (
  <div className="table-scroll">
    <table className={`table informational-table-grid ${options?.resizable ? "informational-table-grid-resizable" : ""}`}>
      <thead>
        <tr>
          {columns.map((column, index) => (
            <th
              key={`${keyPrefix}-head-${index}`}
              className={options?.resizable ? "column-header informational-table-column-header" : "informational-table-column-header"}
              style={
                options?.columnWidths?.[column]
                  ? {
                      width: options.columnWidths[column],
                      minWidth: options.columnWidths[column],
                      maxWidth: options.columnWidths[column]
                    }
                  : undefined
              }
            >
              <div className="th-content">
                <span className="column-label">{column}</span>
              </div>
              {options?.resizable ? (
                <div
                  className="column-resizer informational-table-column-resizer"
                  onMouseDown={(event) => options.onResizeStart?.(column, event)}
                />
              ) : null}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={Math.max(1, columns.length)}>{emptyMessage}</td>
          </tr>
        ) : (
          rows.map((row, rowIndex) => (
            <tr key={`${keyPrefix}-row-${rowIndex}`}>
              {columns.map((column, cellIndex) => (
                <td
                  key={`${keyPrefix}-cell-${rowIndex}-${cellIndex}`}
                  className="informational-table-cell"
                  style={
                    options?.columnWidths?.[column]
                      ? {
                          width: options.columnWidths[column],
                          minWidth: options.columnWidths[column],
                          maxWidth: options.columnWidths[column]
                        }
                      : undefined
                  }
                >
                  {row[cellIndex] || ""}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);

const formatDaysWindowLabel = (days: number): string => (days === 7 ? "esta semana" : `ultimos ${days} dias`);

/* ── Calendar Alerts helpers ───────────────────────────────────── */

const ALL_ALERT_TYPES: AlertItemType[] = ["followup", "todo", "interview", "application"];
const ALL_ALERT_STATUSES: AlertStatusFilter[] = ["overdue", "soon", "ok"];
const ALL_ALERT_VISIBLE_COLUMNS: AlertVisibleColumn[] = ["type", "company", "detail", "date", "status"];
const DEFAULT_ALERT_MAX_ROWS = 50;
const MIN_ALERT_MAX_ROWS = 1;
const MAX_ALERT_MAX_ROWS = 200;
const ALERT_TYPE_LABELS: Record<AlertItemType, string> = {
  followup: "Follow-Up",
  todo: "To-Do",
  interview: "Entrevista",
  application: "Candidatura"
};
const ALERT_STATUS_LABELS: Record<AlertStatusFilter, string> = {
  overdue: "Vencido",
  soon: "Próximo",
  ok: "OK"
};
const ALERT_STATUS_TAG_CLASS: Record<string, string> = {
  overdue: "tag-overdue",
  soon: "tag-soon",
  ok: "tag-ok",
  none: "tag-none"
};
const ALERT_COLUMN_LABELS: Record<AlertVisibleColumn, string> = {
  type: "Tipo",
  company: "Empresa",
  detail: "Detalle",
  date: "Fecha",
  status: "Estado"
};
const ALERT_SORT_LABELS: Record<AlertSortOrder, string> = {
  "date-asc": "Fecha ascendente",
  "date-desc": "Fecha descendente",
  "status-first": "Vencidos primero"
};
const ALERT_COLUMNS_MENU_WIDTH = 280;

type AlertRow = {
  id: string;
  type: string;
  company: string;
  detail: string;
  date: string | null | undefined;
  status: string;
};

const normalizeAlertTypes = (raw: unknown): AlertItemType[] => {
  if (!Array.isArray(raw) || raw.length === 0) return [...ALL_ALERT_TYPES];
  const valid = raw.filter((v): v is AlertItemType => ALL_ALERT_TYPES.includes(v as AlertItemType));
  return valid.length > 0 ? valid : [...ALL_ALERT_TYPES];
};

const normalizeAlertStatuses = (raw: unknown): AlertStatusFilter[] => {
  if (!Array.isArray(raw) || raw.length === 0) return [...ALL_ALERT_STATUSES];
  const valid = raw.filter((v): v is AlertStatusFilter => ALL_ALERT_STATUSES.includes(v as AlertStatusFilter));
  return valid.length > 0 ? valid : [...ALL_ALERT_STATUSES];
};

const normalizeAlertSortOrder = (raw: unknown): AlertSortOrder => {
  if (raw === "date-asc" || raw === "date-desc" || raw === "status-first") return raw;
  return "date-asc";
};

const normalizeAlertMaxRows = (raw: unknown): number => {
  const num = Math.round(Number(raw) || DEFAULT_ALERT_MAX_ROWS);
  return Math.max(MIN_ALERT_MAX_ROWS, Math.min(MAX_ALERT_MAX_ROWS, num));
};

const normalizeAlertVisibleColumns = (raw: unknown): AlertVisibleColumn[] => {
  if (!Array.isArray(raw) || raw.length === 0) return [...ALL_ALERT_VISIBLE_COLUMNS];
  const valid = raw.filter((v): v is AlertVisibleColumn => ALL_ALERT_VISIBLE_COLUMNS.includes(v as AlertVisibleColumn));
  return valid.length > 0 ? valid : [...ALL_ALERT_VISIBLE_COLUMNS];
};

const normalizeAlertColumnOrder = (raw: unknown, visibleColumns: AlertVisibleColumn[]): AlertVisibleColumn[] => {
  if (!Array.isArray(raw) || raw.length === 0) return [...visibleColumns];
  const valid = raw.filter((v): v is AlertVisibleColumn => ALL_ALERT_VISIBLE_COLUMNS.includes(v as AlertVisibleColumn));
  const ordered: AlertVisibleColumn[] = [];
  const used = new Set<AlertVisibleColumn>();
  valid.forEach((col) => {
    if (!used.has(col)) { ordered.push(col); used.add(col); }
  });
  visibleColumns.forEach((col) => {
    if (!used.has(col)) { ordered.push(col); used.add(col); }
  });
  return ordered;
};

const buildAlertRows = (
  applications: Application[],
  types: AlertItemType[],
  statuses: AlertStatusFilter[],
  sortOrder: AlertSortOrder,
  maxRows: number
): AlertRow[] => {
  const items: AlertRow[] = [];
  const typesSet = new Set(types);
  const statusesSet = new Set(statuses);

  applications.forEach((app) => {
    if (typesSet.has("followup") && app.followup_date) {
      const st = followupStatus(app.followup_date);
      if (st !== "none" && statusesSet.has(st as AlertStatusFilter)) {
        items.push({
          id: `${app.application_id}-followup`,
          type: ALERT_TYPE_LABELS.followup,
          company: app.company_name,
          detail: app.position,
          date: app.followup_date,
          status: st
        });
      }
    }
    if (typesSet.has("todo")) {
      (app.todo_items || []).forEach((todo) => {
        const st = followupStatus(todo.due_date);
        if (st !== "none" && statusesSet.has(st as AlertStatusFilter)) {
          items.push({
            id: `${app.application_id}-todo-${todo.id}`,
            type: ALERT_TYPE_LABELS.todo,
            company: app.company_name,
            detail: todo.task,
            date: todo.due_date,
            status: st
          });
        }
      });
    }
    if (typesSet.has("interview") && app.interview_datetime) {
      const st = followupStatus(app.interview_datetime);
      if (st !== "none" && statusesSet.has(st as AlertStatusFilter)) {
        items.push({
          id: `${app.application_id}-interview`,
          type: ALERT_TYPE_LABELS.interview,
          company: app.company_name,
          detail: app.position,
          date: app.interview_datetime,
          status: st
        });
      }
    }
    if (typesSet.has("application") && app.application_date) {
      const st = followupStatus(app.application_date);
      if (st !== "none" && statusesSet.has(st as AlertStatusFilter)) {
        items.push({
          id: `${app.application_id}-application`,
          type: ALERT_TYPE_LABELS.application,
          company: app.company_name,
          detail: app.position,
          date: app.application_date,
          status: st
        });
      }
    }
  });

  const STATUS_PRIORITY: Record<string, number> = { overdue: 0, soon: 1, ok: 2 };
  items.sort((a, b) => {
    if (sortOrder === "status-first") {
      const diff = (STATUS_PRIORITY[a.status] ?? 3) - (STATUS_PRIORITY[b.status] ?? 3);
      if (diff !== 0) return diff;
    }
    const aTime = a.date ? new Date(a.date).getTime() : 0;
    const bTime = b.date ? new Date(b.date).getTime() : 0;
    if (!Number.isFinite(aTime) && !Number.isFinite(bTime)) return 0;
    if (!Number.isFinite(aTime)) return 1;
    if (!Number.isFinite(bTime)) return -1;
    return sortOrder === "date-desc" ? bTime - aTime : aTime - bTime;
  });

  return items.slice(0, maxRows);
};

const renderAlertsTable = (
  keyPrefix: string,
  alerts: AlertRow[],
  visibleColumns: AlertVisibleColumn[],
  columnOrder: AlertVisibleColumn[],
  emptyMessage: string
) => {
  // Apply column ordering: show columns in columnOrder sequence, filtered by visibility
  const visibleSet = new Set(visibleColumns);
  const orderedColumns = columnOrder.filter((col) => visibleSet.has(col));
  if (orderedColumns.length === 0) {
    visibleColumns.forEach((col) => { if (!orderedColumns.includes(col)) orderedColumns.push(col); });
  }
  return (
    <div className="table-scroll">
      <table className="table informational-table-grid">
        <thead>
          <tr>
            {orderedColumns.map((col) => (
              <th key={`${keyPrefix}-head-${col}`} className="informational-table-column-header">
                <div className="th-content">
                  <span className="column-label">{ALERT_COLUMN_LABELS[col]}</span>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {alerts.length === 0 ? (
            <tr>
              <td colSpan={Math.max(1, orderedColumns.length)}>{emptyMessage}</td>
            </tr>
          ) : (
            alerts.map((row) => (
              <tr key={`${keyPrefix}-row-${row.id}`}>
                {orderedColumns.map((col) => {
                  if (col === "type") {
                    return (
                      <td key={`${keyPrefix}-cell-${row.id}-type`} className="informational-table-cell">
                        {row.type}
                      </td>
                    );
                  }
                  if (col === "company") {
                    return (
                      <td key={`${keyPrefix}-cell-${row.id}-company`} className="informational-table-cell">
                        {row.company}
                      </td>
                    );
                  }
                  if (col === "detail") {
                    return (
                      <td key={`${keyPrefix}-cell-${row.id}-detail`} className="informational-table-cell">
                        {row.detail}
                      </td>
                    );
                  }
                  if (col === "date") {
                    return (
                      <td key={`${keyPrefix}-cell-${row.id}-date`} className="informational-table-cell">
                        <DateValueDisplay value={row.date} allowTime />
                      </td>
                    );
                  }
                  if (col === "status") {
                    return (
                      <td key={`${keyPrefix}-cell-${row.id}-status`} className="informational-table-cell">
                        <span className={`tag ${ALERT_STATUS_TAG_CLASS[row.status] || "tag-none"}`}>{row.status}</span>
                      </td>
                    );
                  }
                  return null;
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};

const normalizeInformationalEmailContactFilter = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return Array.from(new Set(normalizeStringArray(value)));
  }
  const legacyValue = normalizeString(value);
  return legacyValue ? [legacyValue] : [];
};

const normalizeInformationalEmailCompanyFilter = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return Array.from(new Set(normalizeStringArray(value)));
  }
  const legacyValue = normalizeString(value);
  return legacyValue ? [legacyValue] : [];
};

const formatInformationalEmailContactFilterSummary = (
  selectedEmails: string[],
  contacts: Array<{ email: string; name: string; company: string }>
): string => {
  if (selectedEmails.length === 0) return "Todos los contactos";
  const contactsByEmail = new Map(contacts.map((contact) => [contact.email, contact]));
  const preview = selectedEmails.slice(0, 2).map((email) => {
    const match = contactsByEmail.get(email);
    if (!match) return email;
    return `${match.name || match.email}${match.company ? ` · ${match.company}` : ""}`;
  });
  const suffix = selectedEmails.length > preview.length ? ` +${selectedEmails.length - preview.length}` : "";
  return `${preview.join(" · ")}${suffix}`;
};

const formatPendingContactsPreview = (
  contacts: InformationalEmailSummary["awaitingReply"]["contacts"],
  emptyMessage: string
): string => {
  if (contacts.length === 0) return emptyMessage;
  const preview = contacts.slice(0, 2).map((contact) => contact.contactName).filter(Boolean);
  if (preview.length === 0) return `${contacts.length} contacto${contacts.length !== 1 ? "s" : ""} detectados.`;
  const suffix = contacts.length > preview.length ? ` +${contacts.length - preview.length}` : "";
  return `${preview.join(" · ")}${suffix}`;
};

const InformationalEmailNotice: React.FC<{
  state: InformationalEmailState;
  sourceLabel: string | null;
  summary: InformationalEmailSummary;
  cardOrder: EmailSummaryCardId[];
}> = ({ state, sourceLabel, summary, cardOrder }) => {
  const activeContacts = new Set(state.messages.map((message) => message.contactEmail)).size;
  const lastActivity = state.messages[0]?.date ? formatEmailDateTime(state.messages[0].date) : null;

  let description = "";
  if (state.loading) {
    description = "Preparando un resumen estandarizado de la actividad reciente para tus contactos guardados.";
  } else if (state.totalContacts === 0) {
    description = "No hay contactos con correo guardado para revisar actividad reciente.";
  } else if (state.messages.length === 0) {
    description = "No se han encontrado correos recientes para los contactos revisados con la configuración vinculada.";
  } else {
    description =
      `Se han localizado ${state.messages.length} correos recientes asociados a ${activeContacts} contactos guardados.`;
  }

  return (
    <section className="informational-email-notice">
      <div className="informational-email-notice-copy">
        <span className="informational-email-kicker">Resumen estandarizado</span>
        <strong>Actividad reciente de correo</strong>
        <p>{description}</p>
        <div className="informational-email-notice-meta">
          {sourceLabel ? <span>Fuente: {sourceLabel}</span> : null}
          {lastActivity ? <span>Última actividad: {lastActivity}</span> : null}
          {state.totalContacts > 0 ? (
            <span>
              Contactos revisados: {state.contactsReviewed}/{state.totalContacts}
            </span>
          ) : null}
        </div>
      </div>
      <div className="informational-email-notice-metrics">
        {cardOrder.map((cardId) => {
          if (cardId === "recentVolume") {
            return (
              <article key={cardId} className="informational-email-metric">
                <div className="informational-email-metric-head">
                  <span className="informational-email-metric-kicker">
                    {summary.recentVolume.days === 7 ? "Correos esta semana" : "Correos recientes"}
                  </span>
                  <span className="informational-email-metric-window">{formatDaysWindowLabel(summary.recentVolume.days)}</span>
                </div>
                <strong>{summary.recentVolume.messageCount}</strong>
                <span className="informational-email-metric-title">
                  de {summary.recentVolume.contactCount} contacto{summary.recentVolume.contactCount !== 1 ? "s" : ""}
                </span>
                <p className="informational-email-metric-note">Actividad reciente sobre los contactos revisados.</p>
              </article>
            );
          }

          if (cardId === "receivedTimeline") {
            return (
              <article key={cardId} className="informational-email-metric informational-email-metric-chart">
                <div className="informational-email-metric-head">
                  <span className="informational-email-metric-kicker">Mensajes recibidos</span>
                  <span className="informational-email-metric-window">
                    ultimos {summary.receivedTimeline.days} dias
                  </span>
                </div>
                <strong>{summary.receivedTimeline.totalCount}</strong>
                <div className="informational-email-timeline" aria-hidden="true">
                  {summary.receivedTimeline.buckets.map((bucket) => {
                    const ratio = summary.receivedTimeline.maxCount > 0 ? bucket.count / summary.receivedTimeline.maxCount : 0;
                    return (
                      <span
                        key={bucket.key}
                        className="informational-email-timeline-column"
                        title={`${bucket.label}: ${bucket.count} mensaje${bucket.count !== 1 ? "s" : ""}`}
                      >
                        <span
                          className="informational-email-timeline-bar"
                          style={{ height: `${Math.max(bucket.count > 0 ? 16 : 8, Math.round(ratio * 100))}%` }}
                        />
                      </span>
                    );
                  })}
                </div>
                <div className="informational-email-timeline-axis">
                  <span>{summary.receivedTimeline.buckets[0]?.shortLabel || "—"}</span>
                  <span>Hoy</span>
                </div>
              </article>
            );
          }

          if (cardId === "awaitingReply") {
            if (cardOrder.includes("awaitingResponse")) {
              return (
                <article key={cardId} className="informational-email-metric informational-email-metric--split">
                  <div className="informational-email-metric-head">
                    <span className="informational-email-metric-kicker">Pendientes</span>
                    <span className="informational-email-metric-window">
                      ultimos {summary.awaitingReply.days} dias
                    </span>
                  </div>
                  <div className="informational-email-metric-row">
                    <span className="informational-email-metric-row-label">Pendientes de contestar</span>
                    <div className="informational-email-metric-row-head">
                      <strong>{summary.awaitingReply.count}</strong>
                    </div>
                    <p className="informational-email-metric-note">
                      {formatPendingContactsPreview(
                        summary.awaitingReply.contacts,
                        "Les escribiste y no consta respuesta posterior."
                      )}
                    </p>
                  </div>
                  <div className="informational-email-metric-divider" />
                  <div className="informational-email-metric-row">
                    <span className="informational-email-metric-row-label">Esperando mi respuesta</span>
                    <div className="informational-email-metric-row-head">
                      <strong>{summary.awaitingResponse.count}</strong>
                    </div>
                    <p className="informational-email-metric-note">
                      {formatPendingContactsPreview(
                        summary.awaitingResponse.contacts,
                        "Te escribieron y no consta respuesta posterior."
                      )}
                    </p>
                  </div>
                </article>
              );
            }
            return (
              <article key={cardId} className="informational-email-metric">
                <div className="informational-email-metric-head">
                  <span className="informational-email-metric-kicker">Pendientes de contestacion</span>
                  <span className="informational-email-metric-window">
                    ultimos {summary.awaitingReply.days} dias
                  </span>
                </div>
                <strong>{summary.awaitingReply.count}</strong>
                <span className="informational-email-metric-title">contactos a la espera de respuesta</span>
                <p className="informational-email-metric-note">
                  {formatPendingContactsPreview(
                    summary.awaitingReply.contacts,
                    "Les escribiste y no consta respuesta posterior."
                  )}
                </p>
              </article>
            );
          }

          if (cardId === "awaitingResponse") {
            if (cardOrder.includes("awaitingReply")) return null;
            return (
              <article key={cardId} className="informational-email-metric">
                <div className="informational-email-metric-head">
                  <span className="informational-email-metric-kicker">Pendientes de contestar</span>
                  <span className="informational-email-metric-window">
                    ultimos {summary.awaitingResponse.days} dias
                  </span>
                </div>
                <strong>{summary.awaitingResponse.count}</strong>
                <span className="informational-email-metric-title">contactos pendientes de tu respuesta</span>
                <p className="informational-email-metric-note">
                  {formatPendingContactsPreview(
                    summary.awaitingResponse.contacts,
                    "Te escribieron y no consta respuesta posterior."
                  )}
                </p>
              </article>
            );
          }

          return null;
        })}
      </div>
    </section>
  );
};

export const INFORMATIONAL_TABLE_BLOCK_DEFINITION: BlockDefinition<"informationalTable"> = {
  type: "informationalTable",
  defaultLayout: { colSpan: 60 },
  createDefaultProps: () => ({
    title: "Informational table",
    description: "Read-only metrics table",
    columns: ["Column A", "Column B"],
    rows: [["-", "-"]],
    sourceMode: "manual",
    sourceVisibleColumns: undefined,
    emailRecentLimit: DEFAULT_EMAIL_RECENT_LIMIT,
    emailSummaryVolumeDays: DEFAULT_EMAIL_SUMMARY_VOLUME_DAYS,
    emailSummaryTimelineDays: DEFAULT_EMAIL_SUMMARY_TIMELINE_DAYS,
    emailSummaryAwaitingReplyDays: DEFAULT_EMAIL_SUMMARY_AWAITING_REPLY_DAYS,
    emailSummaryAwaitingResponseDays: DEFAULT_EMAIL_SUMMARY_AWAITING_RESPONSE_DAYS,
    emailSummaryCardOrder: DEFAULT_EMAIL_SUMMARY_CARD_ORDER
  }),
  component: ({ block, mode, patchBlockProps, updateBlockProps, resolveSlot, menuActions }) => {
    const { settings, applications } = useAppData();
    const [isConfigOpen, setIsConfigOpen] = useState(false);
    const [emailState, setEmailState] = useState<InformationalEmailState>(DEFAULT_EMAIL_STATE);
    const [googleAccounts, setGoogleAccounts] = useState<GoogleAccount[]>([]);
    const [visibleColumnsMenuOpen, setVisibleColumnsMenuOpen] = useState(false);
    const [visibleColumnsMenuPos, setVisibleColumnsMenuPos] = useState<{ top: number; left: number } | null>(null);
    const [draggedColumnOption, setDraggedColumnOption] = useState<string | null>(null);
    const [dragOverColumnOption, setDragOverColumnOption] = useState<string | null>(null);
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => normalizeColumnWidths(block.props.columnWidths));
    const [resizing, setResizing] = useState<{ column: string; startX: number; startWidth: number } | null>(null);
    const [companyFilterOpen, setCompanyFilterOpen] = useState(false);
    const [companyFilterPos, setCompanyFilterPos] = useState<{ top: number; left: number } | null>(null);
    const companyFilterTriggerRef = useRef<HTMLButtonElement | null>(null);
    const companyFilterMenuRef = useRef<HTMLDivElement | null>(null);
    const [contactFilterOpen, setContactFilterOpen] = useState(false);
    const [contactFilterPos, setContactFilterPos] = useState<{ top: number; left: number } | null>(null);
    const contactFilterTriggerRef = useRef<HTMLButtonElement | null>(null);
    const contactFilterMenuRef = useRef<HTMLDivElement | null>(null);
    const visibleColumnsTriggerRef = useRef<HTMLButtonElement | null>(null);
    const visibleColumnsMenuRef = useRef<HTMLDivElement | null>(null);
    // Alert type filter floating menu
    const [alertTypeFilterOpen, setAlertTypeFilterOpen] = useState(false);
    const [alertTypeFilterPos, setAlertTypeFilterPos] = useState<{ top: number; left: number } | null>(null);
    const alertTypeFilterTriggerRef = useRef<HTMLButtonElement | null>(null);
    const alertTypeFilterMenuRef = useRef<HTMLDivElement | null>(null);
    // Alert status filter floating menu
    const [alertStatusFilterOpen, setAlertStatusFilterOpen] = useState(false);
    const [alertStatusFilterPos, setAlertStatusFilterPos] = useState<{ top: number; left: number } | null>(null);
    const alertStatusFilterTriggerRef = useRef<HTMLButtonElement | null>(null);
    const alertStatusFilterMenuRef = useRef<HTMLDivElement | null>(null);
    // Alert columns draggable menu
    const [alertColumnsMenuOpen, setAlertColumnsMenuOpen] = useState(false);
    const [alertColumnsMenuPos, setAlertColumnsMenuPos] = useState<{ top: number; left: number } | null>(null);
    const alertColumnsTriggerRef = useRef<HTMLButtonElement | null>(null);
    const alertColumnsMenuRef = useRef<HTMLDivElement | null>(null);
    const [draggedAlertColumn, setDraggedAlertColumn] = useState<string | null>(null);
    const [dragOverAlertColumn, setDragOverAlertColumn] = useState<string | null>(null);
    const columnWidthsRef = useRef<Record<string, number>>(normalizeColumnWidths(block.props.columnWidths));
    const emailLoadInFlightKeyRef = useRef<string | null>(null);
    const emailCacheGraceDoneRef = useRef(false);
    const slotContext = createSlotContext(mode, updateBlockProps, patchBlockProps);
    const slot = block.props.contentSlotId ? resolveSlot?.(block.props.contentSlotId, block, slotContext) : null;
    const enableColumnResize = mode === "edit";

    const tableTargets = useMemo(
      () => collectEditableTableTargets(settings, { excludeVariants: ["todo"], excludeTypes: ["todoTable"] }),
      [settings]
    );
    const emailTargets = useMemo(
      () => collectBlockTargets(settings).filter((target) => target.type === "email"),
      [settings]
    );
    const calendarTargets = useMemo(
      () => collectBlockTargets(settings).filter((target) => target.type === "calendar"),
      [settings]
    );
    const graph = useMemo(() => buildBlockGraph(settings), [settings]);
    const linkedTableTarget = resolveLinkedBlock(graph, block.props, INFORMATIONAL_TABLE_SOURCE_TABLE_LINK_KEY);
    const linkedEmailId = getBlockLink(block.props, INFORMATIONAL_TABLE_SOURCE_EMAIL_LINK_KEY);
    const linkedEmailTarget = resolveLinkedBlock(graph, block.props, INFORMATIONAL_TABLE_SOURCE_EMAIL_LINK_KEY);
    const linkedCalendarTarget = resolveLinkedBlock(graph, block.props, INFORMATIONAL_TABLE_SOURCE_CALENDAR_LINK_KEY);
    const emailBlockCache = useEmailBlockCacheEntry(linkedEmailId);
    const sourceMode = normalizeSourceMode(
      block.props.sourceMode,
      linkedTableTarget ? "editableTable" : linkedEmailTarget ? "email" : "manual"
    );
    const emailRecentLimit = normalizeEmailRecentLimit(block.props.emailRecentLimit);
    const emailLookbackDays = normalizeEmailLookbackDays(block.props.emailLookbackDays);
    const emailAccountFilter = normalizeString(block.props.emailAccountFilter);
    const emailCompanyFilter = useMemo(
      () => normalizeInformationalEmailCompanyFilter(block.props.emailCompanyFilter),
      [block.props.emailCompanyFilter]
    );
    const emailContactFilter = useMemo(
      () => normalizeInformationalEmailContactFilter(block.props.emailContactFilter),
      [block.props.emailContactFilter]
    );
    const emailFolderFilter = normalizeString(block.props.emailFolderFilter);
    const emailSummaryVolumeDays = normalizeEmailSummaryDays(
      block.props.emailSummaryVolumeDays,
      DEFAULT_EMAIL_SUMMARY_VOLUME_DAYS
    );
    const emailSummaryTimelineDays = normalizeEmailSummaryDays(
      block.props.emailSummaryTimelineDays,
      DEFAULT_EMAIL_SUMMARY_TIMELINE_DAYS
    );
    const emailSummaryAwaitingReplyDays = normalizeEmailSummaryDays(
      block.props.emailSummaryAwaitingReplyDays,
      DEFAULT_EMAIL_SUMMARY_AWAITING_REPLY_DAYS
    );
    const emailSummaryAwaitingResponseDays = normalizeEmailSummaryDays(
      block.props.emailSummaryAwaitingResponseDays,
      DEFAULT_EMAIL_SUMMARY_AWAITING_RESPONSE_DAYS
    );
    const emailSummaryCardOrder = useMemo(
      () => normalizeEmailSummaryCardOrder(block.props.emailSummaryCardOrder),
      [block.props.emailSummaryCardOrder]
    );
    const manualColumns = useMemo(() => normalizeColumns(block.props.columns), [block.props.columns]);
    const manualRows = useMemo(() => normalizeRows(block.props.rows, manualColumns.length), [block.props.rows, manualColumns]);
    const persistedColumnWidths = useMemo(() => normalizeColumnWidths(block.props.columnWidths), [block.props.columnWidths]);

    // ── Application Alerts data ──
    const alertTypes = useMemo(() => normalizeAlertTypes(block.props.alertTypes), [block.props.alertTypes]);
    const alertStatuses = useMemo(() => normalizeAlertStatuses(block.props.alertStatuses), [block.props.alertStatuses]);
    const alertSortOrder = normalizeAlertSortOrder(block.props.alertSortOrder);
    const alertMaxRows = normalizeAlertMaxRows(block.props.alertMaxRows);
    const alertVisibleColumns = useMemo(() => normalizeAlertVisibleColumns(block.props.alertVisibleColumns), [block.props.alertVisibleColumns]);
    const alertColumnOrder = useMemo(
      () => normalizeAlertColumnOrder(block.props.alertColumnOrder, alertVisibleColumns),
      [block.props.alertColumnOrder, alertVisibleColumns]
    );
    const alertRows = useMemo(
      () =>
        sourceMode === "applicationAlerts"
          ? buildAlertRows(applications, alertTypes, alertStatuses, alertSortOrder, alertMaxRows)
          : [],
      [applications, alertTypes, alertStatuses, alertSortOrder, alertMaxRows, sourceMode]
    );

    const linkedTableModel = useMemo<InformationalLinkedTableModel | null>(() => {
      if (!linkedTableTarget) return null;
      if (isTrackerSourceTarget(linkedTableTarget)) {
        return buildTrackerSourceModel(linkedTableTarget.props, settings, applications);
      }
      return toVisibleEditableTableModel(linkedTableTarget.props as PageBlockPropsMap["editableTable"], settings);
    }, [applications, linkedTableTarget, settings]);

    const selectedVisibleColumns = useMemo(
      () => normalizeSelectedColumns(block.props.sourceVisibleColumns, linkedTableModel?.columns || []),
      [block.props.sourceVisibleColumns, linkedTableModel]
    );
    const sourceColumnOrder = useMemo(
      () => normalizeOrderedColumns(block.props.sourceColumnOrder, linkedTableModel?.columns || []),
      [block.props.sourceColumnOrder, linkedTableModel]
    );
    const orderedLinkedTableModel = useMemo(
      () => (linkedTableModel ? reorderTableColumns(linkedTableModel, sourceColumnOrder) : null),
      [linkedTableModel, sourceColumnOrder]
    );
    const effectiveLinkedTableModel = useMemo(
      () => (orderedLinkedTableModel ? filterTableColumns(orderedLinkedTableModel, selectedVisibleColumns) : null),
      [orderedLinkedTableModel, selectedVisibleColumns]
    );
    const visibleLinkedColumns = useMemo(
      () =>
        orderedLinkedTableModel
          ? (
              selectedVisibleColumns.length > 0
                ? sourceColumnOrder.filter((column) => selectedVisibleColumns.includes(column))
                : sourceColumnOrder
            )
          : [],
      [orderedLinkedTableModel, selectedVisibleColumns, sourceColumnOrder]
    );

    const allReadContacts = useMemo(
      () =>
        buildEmailReadContactsFromApplications(
          applications,
          Array.isArray(settings?.custom_properties) ? normalizeCustomProperties(settings.custom_properties) : undefined,
          5000
        ),
      [applications, settings?.custom_properties]
    );
    const linkedEmailHasStoredSelection = Boolean(
      linkedEmailTarget && Object.prototype.hasOwnProperty.call(linkedEmailTarget.props, "sendSelectedRecipients")
    );
    const linkedEmailSelectedRecipients = useMemo(() => {
      const rawSelection = linkedEmailTarget?.props.sendSelectedRecipients;
      if (!linkedEmailHasStoredSelection || !isRecord(rawSelection)) return {};
      return Object.fromEntries(
        Object.entries(rawSelection)
          .map(([email, isSelected]) => {
            const normalizedEmail = normalizeString(email);
            if (!normalizedEmail) return null;
            return [normalizedEmail, Boolean(isSelected)] as const;
          })
          .filter((entry): entry is readonly [string, boolean] => entry !== null)
      );
    }, [linkedEmailHasStoredSelection, linkedEmailTarget?.props.sendSelectedRecipients]);
    const scopedReadContacts = useMemo(
      () =>
        linkedEmailHasStoredSelection
          ? buildSelectedEmailReadContacts(allReadContacts, linkedEmailSelectedRecipients)
          : allReadContacts,
      [allReadContacts, linkedEmailHasStoredSelection, linkedEmailSelectedRecipients]
    );
    const availableCompanyOptions = useMemo(
      () =>
        Array.from(
          new Set(
            scopedReadContacts
              .map((contact) => contact.company)
              .filter(Boolean)
          )
        ).sort((left, right) => left.localeCompare(right)),
      [scopedReadContacts]
    );
    const effectiveEmailCompanyFilter = useMemo(
      () => emailCompanyFilter.filter((c) => availableCompanyOptions.includes(c)),
      [emailCompanyFilter, availableCompanyOptions]
    );
    const companyFilteredContacts = useMemo(
      () =>
        effectiveEmailCompanyFilter.length > 0
          ? scopedReadContacts.filter((contact) => effectiveEmailCompanyFilter.includes(contact.company || ""))
          : scopedReadContacts,
      [scopedReadContacts, effectiveEmailCompanyFilter]
    );
    const effectiveEmailContactFilter = useMemo(
      () =>
        emailContactFilter.filter((email, index) =>
          index === emailContactFilter.indexOf(email) &&
          companyFilteredContacts.some((contact) => contact.email === email)
        ),
      [companyFilteredContacts, emailContactFilter]
    );
    const effectiveEmailContactFilterSummary = useMemo(
      () => formatInformationalEmailContactFilterSummary(effectiveEmailContactFilter, companyFilteredContacts),
      [companyFilteredContacts, effectiveEmailContactFilter]
    );
    const filteredReadContacts = useMemo(() => {
      let next = companyFilteredContacts;
      if (effectiveEmailContactFilter.length > 0) {
        const selectedContacts = new Set(effectiveEmailContactFilter);
        next = next.filter((contact) => selectedContacts.has(contact.email));
      }
      return next;
    }, [companyFilteredContacts, effectiveEmailContactFilter]);
    const filteredReadContactsKey = useMemo(
      () => filteredReadContacts.map((contact) => contact.email).sort((left, right) => left.localeCompare(right)).join("|"),
      [filteredReadContacts]
    );

    const linkedEmailFolder = emailFolderFilter || normalizeString(linkedEmailTarget?.props.folder) || READ_MAILBOX_ALL;
    const linkedEmailFolderParam = resolveEmailMetadataFolderParam(linkedEmailFolder);
    const linkedEmailStartDate = normalizeString(linkedEmailTarget?.props.readStartDate) || undefined;
    const effectiveEmailStartDate = emailLookbackDays ? buildLookbackStartDate(emailLookbackDays) : linkedEmailStartDate;
    const emailLoadRequestKey = `${linkedEmailId || ""}|${linkedEmailFolderParam || ""}|${effectiveEmailStartDate || ""}|${filteredReadContactsKey}`;
    const linkedEmailAccountFilter = normalizeString(linkedEmailTarget?.props.readAccountFilter) || READ_MAILBOX_ALL;
    const accountOptions = useMemo(
      () => buildEmailAccountOptions(googleAccounts, linkedEmailAccountFilter, emailAccountFilter),
      [emailAccountFilter, googleAccounts, linkedEmailAccountFilter]
    );
    const effectiveEmailAccountFilter = emailAccountFilter
      ? (accountOptions.includes(emailAccountFilter) ? emailAccountFilter : linkedEmailAccountFilter)
      : linkedEmailAccountFilter;
    const linkedEmailReadEnabled =
      typeof linkedEmailTarget?.props.readEnabled === "boolean" ? linkedEmailTarget.props.readEnabled : true;

    useEffect(() => {
      setColumnWidths(persistedColumnWidths);
    }, [persistedColumnWidths]);

    useEffect(() => {
      columnWidthsRef.current = columnWidths;
    }, [columnWidths]);

    useEffect(() => {
      if (visibleColumnsMenuOpen) return;
      setDraggedColumnOption(null);
      setDragOverColumnOption(null);
    }, [visibleColumnsMenuOpen]);

    useEffect(() => {
      if (sourceMode !== "email" && !isConfigOpen) return;
      let cancelled = false;
      void listGoogleAccounts()
        .then((accounts) => {
          if (cancelled) return;
          setGoogleAccounts(accounts);
        })
        .catch(() => {
          if (cancelled) return;
          setGoogleAccounts([]);
        });
      return () => {
        cancelled = true;
      };
    }, [isConfigOpen, sourceMode]);

    useEffect(() => {
      if (!isConfigOpen || sourceMode !== "editableTable" || !linkedTableModel || linkedTableModel.columns.length === 0) {
        setVisibleColumnsMenuOpen(false);
        setVisibleColumnsMenuPos(null);
        setDraggedColumnOption(null);
        setDragOverColumnOption(null);
      }
    }, [isConfigOpen, linkedTableModel, sourceMode]);

    useEffect(() => {
      if (!visibleColumnsMenuOpen || !visibleColumnsTriggerRef.current) return;
      const updatePosition = () => {
        if (!visibleColumnsTriggerRef.current) return;
        const rect = visibleColumnsTriggerRef.current.getBoundingClientRect();
        const menuHeight = visibleColumnsMenuRef.current?.offsetHeight || 320;
        const menuWidth = Math.min(VISIBLE_COLUMNS_MENU_WIDTH, window.innerWidth - FLOATING_MENU_GUTTER * 2);
        const maxLeft = Math.max(FLOATING_MENU_GUTTER, window.innerWidth - menuWidth - FLOATING_MENU_GUTTER);
        const left = Math.min(Math.max(rect.left, FLOATING_MENU_GUTTER), maxLeft);
        const spaceBelow = window.innerHeight - rect.bottom;
        const shouldFlip = spaceBelow < menuHeight + FLOATING_MENU_OFFSET && rect.top > spaceBelow;
        const rawTop = shouldFlip ? rect.top - menuHeight - FLOATING_MENU_OFFSET : rect.bottom + FLOATING_MENU_OFFSET;
        const maxTop = Math.max(FLOATING_MENU_GUTTER, window.innerHeight - menuHeight - FLOATING_MENU_GUTTER);
        const top = Math.min(Math.max(rawTop, FLOATING_MENU_GUTTER), maxTop);
        setVisibleColumnsMenuPos({ top, left });
      };
      const handleOutside = (event: MouseEvent) => {
        const target = event.target as Node;
        if (
          visibleColumnsMenuRef.current?.contains(target) ||
          visibleColumnsTriggerRef.current?.contains(target)
        ) {
          return;
        }
        setVisibleColumnsMenuOpen(false);
      };
      updatePosition();
      document.addEventListener("mousedown", handleOutside);
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
      return () => {
        document.removeEventListener("mousedown", handleOutside);
        window.removeEventListener("scroll", updatePosition, true);
        window.removeEventListener("resize", updatePosition);
      };
    }, [visibleColumnsMenuOpen]);

    useEffect(() => {
      if (!isConfigOpen || sourceMode !== "email") {
        setCompanyFilterOpen(false);
        setCompanyFilterPos(null);
        setContactFilterOpen(false);
        setContactFilterPos(null);
      }
    }, [isConfigOpen, sourceMode]);

    useEffect(() => {
      if (!companyFilterOpen || !companyFilterTriggerRef.current) return;
      const MENU_WIDTH = 280;
      const updatePosition = () => {
        if (!companyFilterTriggerRef.current) return;
        const rect = companyFilterTriggerRef.current.getBoundingClientRect();
        const menuHeight = companyFilterMenuRef.current?.offsetHeight || 280;
        const menuWidth = Math.min(MENU_WIDTH, window.innerWidth - FLOATING_MENU_GUTTER * 2);
        const maxLeft = Math.max(FLOATING_MENU_GUTTER, window.innerWidth - menuWidth - FLOATING_MENU_GUTTER);
        const left = Math.min(Math.max(rect.left, FLOATING_MENU_GUTTER), maxLeft);
        const spaceBelow = window.innerHeight - rect.bottom;
        const shouldFlip = spaceBelow < menuHeight + FLOATING_MENU_OFFSET && rect.top > spaceBelow;
        const rawTop = shouldFlip ? rect.top - menuHeight - FLOATING_MENU_OFFSET : rect.bottom + FLOATING_MENU_OFFSET;
        const maxTop = Math.max(FLOATING_MENU_GUTTER, window.innerHeight - menuHeight - FLOATING_MENU_GUTTER);
        const top = Math.min(Math.max(rawTop, FLOATING_MENU_GUTTER), maxTop);
        setCompanyFilterPos({ top, left });
      };
      const handleOutside = (event: MouseEvent) => {
        const target = event.target as Node;
        if (
          companyFilterMenuRef.current?.contains(target) ||
          companyFilterTriggerRef.current?.contains(target)
        ) return;
        setCompanyFilterOpen(false);
      };
      updatePosition();
      document.addEventListener("mousedown", handleOutside);
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
      return () => {
        document.removeEventListener("mousedown", handleOutside);
        window.removeEventListener("scroll", updatePosition, true);
        window.removeEventListener("resize", updatePosition);
      };
    }, [companyFilterOpen]);

    useEffect(() => {
      if (!contactFilterOpen || !contactFilterTriggerRef.current) return;
      const MENU_WIDTH = 320;
      const updatePosition = () => {
        if (!contactFilterTriggerRef.current) return;
        const rect = contactFilterTriggerRef.current.getBoundingClientRect();
        const menuHeight = contactFilterMenuRef.current?.offsetHeight || 280;
        const menuWidth = Math.min(MENU_WIDTH, window.innerWidth - FLOATING_MENU_GUTTER * 2);
        const maxLeft = Math.max(FLOATING_MENU_GUTTER, window.innerWidth - menuWidth - FLOATING_MENU_GUTTER);
        const left = Math.min(Math.max(rect.left, FLOATING_MENU_GUTTER), maxLeft);
        const spaceBelow = window.innerHeight - rect.bottom;
        const shouldFlip = spaceBelow < menuHeight + FLOATING_MENU_OFFSET && rect.top > spaceBelow;
        const rawTop = shouldFlip ? rect.top - menuHeight - FLOATING_MENU_OFFSET : rect.bottom + FLOATING_MENU_OFFSET;
        const maxTop = Math.max(FLOATING_MENU_GUTTER, window.innerHeight - menuHeight - FLOATING_MENU_GUTTER);
        const top = Math.min(Math.max(rawTop, FLOATING_MENU_GUTTER), maxTop);
        setContactFilterPos({ top, left });
      };
      const handleOutside = (event: MouseEvent) => {
        const target = event.target as Node;
        if (
          contactFilterMenuRef.current?.contains(target) ||
          contactFilterTriggerRef.current?.contains(target)
        ) return;
        setContactFilterOpen(false);
      };
      updatePosition();
      document.addEventListener("mousedown", handleOutside);
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
      return () => {
        document.removeEventListener("mousedown", handleOutside);
        window.removeEventListener("scroll", updatePosition, true);
        window.removeEventListener("resize", updatePosition);
      };
    }, [contactFilterOpen]);

    // ── Alert floating menus: cleanup on config/mode change ──
    useEffect(() => {
      if (!isConfigOpen || sourceMode !== "applicationAlerts") {
        setAlertTypeFilterOpen(false);
        setAlertTypeFilterPos(null);
        setAlertStatusFilterOpen(false);
        setAlertStatusFilterPos(null);
        setAlertColumnsMenuOpen(false);
        setAlertColumnsMenuPos(null);
        setDraggedAlertColumn(null);
        setDragOverAlertColumn(null);
      }
    }, [isConfigOpen, sourceMode]);

    useEffect(() => {
      if (!alertColumnsMenuOpen) {
        setDraggedAlertColumn(null);
        setDragOverAlertColumn(null);
      }
    }, [alertColumnsMenuOpen]);

    // ── Alert type filter floating menu positioning ──
    useEffect(() => {
      if (!alertTypeFilterOpen || !alertTypeFilterTriggerRef.current) return;
      const MENU_WIDTH = 260;
      const updatePosition = () => {
        if (!alertTypeFilterTriggerRef.current) return;
        const rect = alertTypeFilterTriggerRef.current.getBoundingClientRect();
        const menuHeight = alertTypeFilterMenuRef.current?.offsetHeight || 200;
        const menuWidth = Math.min(MENU_WIDTH, window.innerWidth - FLOATING_MENU_GUTTER * 2);
        const maxLeft = Math.max(FLOATING_MENU_GUTTER, window.innerWidth - menuWidth - FLOATING_MENU_GUTTER);
        const left = Math.min(Math.max(rect.left, FLOATING_MENU_GUTTER), maxLeft);
        const spaceBelow = window.innerHeight - rect.bottom;
        const shouldFlip = spaceBelow < menuHeight + FLOATING_MENU_OFFSET && rect.top > spaceBelow;
        const rawTop = shouldFlip ? rect.top - menuHeight - FLOATING_MENU_OFFSET : rect.bottom + FLOATING_MENU_OFFSET;
        const maxTop = Math.max(FLOATING_MENU_GUTTER, window.innerHeight - menuHeight - FLOATING_MENU_GUTTER);
        const top = Math.min(Math.max(rawTop, FLOATING_MENU_GUTTER), maxTop);
        setAlertTypeFilterPos({ top, left });
      };
      const handleOutside = (event: MouseEvent) => {
        const target = event.target as Node;
        if (alertTypeFilterMenuRef.current?.contains(target) || alertTypeFilterTriggerRef.current?.contains(target)) return;
        setAlertTypeFilterOpen(false);
      };
      updatePosition();
      document.addEventListener("mousedown", handleOutside);
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
      return () => {
        document.removeEventListener("mousedown", handleOutside);
        window.removeEventListener("scroll", updatePosition, true);
        window.removeEventListener("resize", updatePosition);
      };
    }, [alertTypeFilterOpen]);

    // ── Alert status filter floating menu positioning ──
    useEffect(() => {
      if (!alertStatusFilterOpen || !alertStatusFilterTriggerRef.current) return;
      const MENU_WIDTH = 220;
      const updatePosition = () => {
        if (!alertStatusFilterTriggerRef.current) return;
        const rect = alertStatusFilterTriggerRef.current.getBoundingClientRect();
        const menuHeight = alertStatusFilterMenuRef.current?.offsetHeight || 180;
        const menuWidth = Math.min(MENU_WIDTH, window.innerWidth - FLOATING_MENU_GUTTER * 2);
        const maxLeft = Math.max(FLOATING_MENU_GUTTER, window.innerWidth - menuWidth - FLOATING_MENU_GUTTER);
        const left = Math.min(Math.max(rect.left, FLOATING_MENU_GUTTER), maxLeft);
        const spaceBelow = window.innerHeight - rect.bottom;
        const shouldFlip = spaceBelow < menuHeight + FLOATING_MENU_OFFSET && rect.top > spaceBelow;
        const rawTop = shouldFlip ? rect.top - menuHeight - FLOATING_MENU_OFFSET : rect.bottom + FLOATING_MENU_OFFSET;
        const maxTop = Math.max(FLOATING_MENU_GUTTER, window.innerHeight - menuHeight - FLOATING_MENU_GUTTER);
        const top = Math.min(Math.max(rawTop, FLOATING_MENU_GUTTER), maxTop);
        setAlertStatusFilterPos({ top, left });
      };
      const handleOutside = (event: MouseEvent) => {
        const target = event.target as Node;
        if (alertStatusFilterMenuRef.current?.contains(target) || alertStatusFilterTriggerRef.current?.contains(target)) return;
        setAlertStatusFilterOpen(false);
      };
      updatePosition();
      document.addEventListener("mousedown", handleOutside);
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
      return () => {
        document.removeEventListener("mousedown", handleOutside);
        window.removeEventListener("scroll", updatePosition, true);
        window.removeEventListener("resize", updatePosition);
      };
    }, [alertStatusFilterOpen]);

    // ── Alert columns draggable menu positioning ──
    useEffect(() => {
      if (!alertColumnsMenuOpen || !alertColumnsTriggerRef.current) return;
      const updatePosition = () => {
        if (!alertColumnsTriggerRef.current) return;
        const rect = alertColumnsTriggerRef.current.getBoundingClientRect();
        const menuHeight = alertColumnsMenuRef.current?.offsetHeight || 320;
        const menuWidth = Math.min(ALERT_COLUMNS_MENU_WIDTH, window.innerWidth - FLOATING_MENU_GUTTER * 2);
        const maxLeft = Math.max(FLOATING_MENU_GUTTER, window.innerWidth - menuWidth - FLOATING_MENU_GUTTER);
        const left = Math.min(Math.max(rect.left, FLOATING_MENU_GUTTER), maxLeft);
        const spaceBelow = window.innerHeight - rect.bottom;
        const shouldFlip = spaceBelow < menuHeight + FLOATING_MENU_OFFSET && rect.top > spaceBelow;
        const rawTop = shouldFlip ? rect.top - menuHeight - FLOATING_MENU_OFFSET : rect.bottom + FLOATING_MENU_OFFSET;
        const maxTop = Math.max(FLOATING_MENU_GUTTER, window.innerHeight - menuHeight - FLOATING_MENU_GUTTER);
        const top = Math.min(Math.max(rawTop, FLOATING_MENU_GUTTER), maxTop);
        setAlertColumnsMenuPos({ top, left });
      };
      const handleOutside = (event: MouseEvent) => {
        const target = event.target as Node;
        if (alertColumnsMenuRef.current?.contains(target) || alertColumnsTriggerRef.current?.contains(target)) return;
        setAlertColumnsMenuOpen(false);
      };
      updatePosition();
      document.addEventListener("mousedown", handleOutside);
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
      return () => {
        document.removeEventListener("mousedown", handleOutside);
        window.removeEventListener("scroll", updatePosition, true);
        window.removeEventListener("resize", updatePosition);
      };
    }, [alertColumnsMenuOpen]);

    useEffect(() => {
      if (!resizing) return;
      const handleMove = (event: MouseEvent) => {
        const delta = event.clientX - resizing.startX;
        const minWidth = estimateHeaderMinWidth(resizing.column);
        const nextWidth = Math.max(minWidth, resizing.startWidth + delta);
        setColumnWidths((prev) => ({ ...prev, [resizing.column]: Math.round(nextWidth) }));
      };
      const handleUp = () => {
        const finalWidth = columnWidthsRef.current[resizing.column];
        if (Number.isFinite(finalWidth) && finalWidth > 0 && persistedColumnWidths[resizing.column] !== finalWidth) {
          patchBlockProps({
            columnWidths: {
              ...persistedColumnWidths,
              [resizing.column]: finalWidth
            }
          });
        }
        setResizing(null);
      };
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleUp);
      return () => {
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleUp);
      };
    }, [patchBlockProps, persistedColumnWidths, resizing]);

    // Legacy canonical table resolution removed — the global BlockGraph resolves all blocks by blockId.

    useEffect(() => {
      if (sourceMode !== "email") {
        emailLoadInFlightKeyRef.current = null;
        setEmailState(DEFAULT_EMAIL_STATE);
        return;
      }

      if (!linkedEmailTarget) {
        emailLoadInFlightKeyRef.current = null;
        setEmailState({
          ...DEFAULT_EMAIL_STATE,
          totalContacts: filteredReadContacts.length
        });
        return;
      }

      if (!linkedEmailReadEnabled) {
        emailLoadInFlightKeyRef.current = null;
        setEmailState({
          ...DEFAULT_EMAIL_STATE,
          error: "El bloque de correo vinculado tiene la lectura de correos desactivada.",
          totalContacts: filteredReadContacts.length
        });
        return;
      }

      if (filteredReadContacts.length === 0) {
        emailLoadInFlightKeyRef.current = null;
        setEmailState({
          ...DEFAULT_EMAIL_STATE,
          totalContacts: 0
        });
        return;
      }

      // ── Fast path: reuse messages already loaded by the linked email block ──
      if (emailBlockCache && emailBlockCache.ready && emailBlockCache.messages.length > 0) {
        const contactSet = new Set(filteredReadContacts.map((c) => c.email));
        const matched = emailBlockCache.messages
          .filter((msg) => contactSet.has(msg.contactEmail))
          .map((msg) => ({
            ...msg,
            direction: buildEmailDirection(msg, msg.contactEmail) as "Recibido" | "Enviado"
          }));
        emailLoadInFlightKeyRef.current = emailLoadRequestKey;
        setEmailState({
          loading: false,
          error: null,
          messages: mergeEmailMessages(matched),
          contactsReviewed: filteredReadContacts.length,
          totalContacts: filteredReadContacts.length
        });
        return;
      }

      // ── If the email block is still loading, wait for it ──
      if (emailBlockCache && emailBlockCache.loading) {
        setEmailState({
          loading: true,
          error: null,
          messages: [],
          contactsReviewed: filteredReadContacts.length,
          totalContacts: filteredReadContacts.length
        });
        return;
      }

      // ── Grace period: the linked email block may not have published yet ──
      // On first mount both blocks render in the same cycle; the email block's
      // publish useEffect hasn't fired yet so emailBlockCache is null.  Wait a
      // short moment so the cache has a chance to appear before we launch our
      // own (potentially heavy) HTTP requests.
      if (linkedEmailId && !emailBlockCache && !emailCacheGraceDoneRef.current) {
        emailCacheGraceDoneRef.current = true;
        const graceTimer = setTimeout(() => {
          // After the grace period, bump the in-flight key so the effect re-runs
          // and re-evaluates the cache.
          emailLoadInFlightKeyRef.current = null;
          setEmailState((prev) => ({ ...prev })); // trigger re-render
        }, 250);
        setEmailState({
          loading: true,
          error: null,
          messages: [],
          contactsReviewed: filteredReadContacts.length,
          totalContacts: filteredReadContacts.length
        });
        return () => { clearTimeout(graceTimer); };
      }

      // ── Fallback: fetch from API (no cache available) ──
      if (emailLoadInFlightKeyRef.current === emailLoadRequestKey) {
        return;
      }
      emailLoadInFlightKeyRef.current = emailLoadRequestKey;

      const controller = new AbortController();
      const contactsToLoad = filteredReadContacts;
      setEmailState({
        loading: true,
        error: null,
        messages: [],
        contactsReviewed: contactsToLoad.length,
        totalContacts: filteredReadContacts.length
      });

      void (async () => {
        try {
          const cached = await loadEmailMessagesForContacts({
            contacts: contactsToLoad,
            folder: linkedEmailFolderParam,
            startDate: effectiveEmailStartDate,
            refresh: false,
            signal: controller.signal
          });
          if (controller.signal.aborted) return;
          if (cached.messages.length > 0) {
            setEmailState({
              loading: false,
              error: cached.error,
              messages: cached.messages,
              contactsReviewed: contactsToLoad.length,
              totalContacts: filteredReadContacts.length
            });
            return;
          }

          const refreshed = await loadEmailMessagesForContacts({
            contacts: contactsToLoad,
            folder: linkedEmailFolderParam,
            startDate: effectiveEmailStartDate,
            refresh: true,
            signal: controller.signal
          });
          if (controller.signal.aborted) return;
          setEmailState({
            loading: false,
            error: refreshed.error || cached.error,
            messages: refreshed.messages,
            contactsReviewed: contactsToLoad.length,
            totalContacts: filteredReadContacts.length
          });
        } catch (error: unknown) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setEmailState({
            loading: false,
            error: error instanceof ApiError ? error.message : "No se pudo cargar la actividad reciente de correo.",
            messages: [],
            contactsReviewed: contactsToLoad.length,
            totalContacts: filteredReadContacts.length
          });
        }
      })();

      return () => {
        controller.abort();
        if (emailLoadInFlightKeyRef.current === emailLoadRequestKey) {
          emailLoadInFlightKeyRef.current = null;
        }
      };
    }, [
      emailLoadRequestKey,
      filteredReadContactsKey,
      linkedEmailReadEnabled,
      linkedEmailFolderParam,
      effectiveEmailStartDate,
      linkedEmailId,
      sourceMode,
      emailBlockCache
    ]);

    const filteredEmailMessages = useMemo(
      () => filterEmailMessagesByAccount(emailState.messages, effectiveEmailAccountFilter),
      [effectiveEmailAccountFilter, emailState.messages]
    );
    const effectiveEmailState = useMemo<InformationalEmailState>(
      () => ({
        ...emailState,
        messages: filteredEmailMessages
      }),
      [emailState, filteredEmailMessages]
    );
    const limitedDisplayEmailMessages = useMemo(
      () => limitEmailMessagesPerContact(filteredEmailMessages, emailRecentLimit),
      [emailRecentLimit, filteredEmailMessages]
    );
    const emailSummary = useMemo(
      () =>
        buildInformationalEmailSummary(filteredEmailMessages, {
          recentVolumeDays: emailSummaryVolumeDays,
          timelineDays: emailSummaryTimelineDays,
          awaitingReplyDays: emailSummaryAwaitingReplyDays,
          awaitingResponseDays: emailSummaryAwaitingResponseDays
        }),
      [
        filteredEmailMessages,
        emailSummaryAwaitingReplyDays,
        emailSummaryAwaitingResponseDays,
        emailSummaryTimelineDays,
        emailSummaryVolumeDays
      ]
    );
    const emailTableData = useMemo(
      () => ({
        columns: EMAIL_ACTIVITY_COLUMNS,
        rows: limitedDisplayEmailMessages.map((message) => [
          message.contactName || message.contactEmail,
          message.contactCompany || "—",
          message.subject || "Sin asunto",
          message.direction,
          message.is_read ? "Leído" : "Pendiente",
          formatEmailDateTime(message.date),
          message.folder || linkedEmailFolder || "—"
        ])
      }),
      [limitedDisplayEmailMessages, linkedEmailFolder]
    );

    const selectedTableValue = linkedTableTarget?.blockId || "";
    const visibleColumnsSummary = !linkedTableModel || linkedTableModel.columns.length === 0
      ? "Selecciona una tabla"
      : visibleLinkedColumns.length === linkedTableModel.columns.length
        ? `Todas (${linkedTableModel.columns.length})`
        : `${visibleLinkedColumns.length}/${linkedTableModel.columns.length} visibles`;

    const setSourceMode = (nextMode: InformationalTableSourceMode) => {
      patchBlockProps({ sourceMode: nextMode });
    };

    const persistEmailSummaryOrder = (nextOrder: EmailSummaryCardId[]) => {
      const normalized = normalizeEmailSummaryCardOrder(nextOrder);
      patchBlockProps({
        emailSummaryCardOrder:
          normalized.every((cardId, index) => cardId === DEFAULT_EMAIL_SUMMARY_CARD_ORDER[index])
            ? undefined
            : normalized
      });
    };

    const shiftEmailSummaryCard = (cardId: EmailSummaryCardId, offset: -1 | 1) => {
      persistEmailSummaryOrder(moveEmailSummaryCard(emailSummaryCardOrder, cardId, offset));
    };

    const toggleVisibleColumn = (column: string) => {
      if (!linkedTableModel) return;
      const displayedColumns = selectedVisibleColumns.length > 0 ? selectedVisibleColumns : linkedTableModel.columns;
      const checked = displayedColumns.includes(column);
      const next = checked ? displayedColumns.filter((item) => item !== column) : [...displayedColumns, column];
      if (next.length === 0) return;
      patchBlockProps({
        sourceVisibleColumns: next.length === linkedTableModel.columns.length ? undefined : next
      });
    };

    const resetVisibleColumns = () => {
      patchBlockProps({ sourceVisibleColumns: undefined });
    };

    const persistSourceColumnOrder = (nextOrder: string[]) => {
      if (!linkedTableModel) return;
      patchBlockProps({
        sourceColumnOrder: areStringArraysEqual(nextOrder, linkedTableModel.columns) ? undefined : nextOrder
      });
    };

    const moveSourceColumn = (fromColumn: string, toColumn: string) => {
      if (!linkedTableModel || fromColumn === toColumn) return;
      const fromIndex = sourceColumnOrder.indexOf(fromColumn);
      const toIndex = sourceColumnOrder.indexOf(toColumn);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
      persistSourceColumnOrder(reorderByIndex(sourceColumnOrder, fromIndex, toIndex));
    };

    const setLinkedTable = (nextBlockId: string) => {
      patchBlockProps({
        ...(patchBlockLink(
          block.props,
          INFORMATIONAL_TABLE_SOURCE_TABLE_LINK_KEY,
          nextBlockId || null
        ) as Partial<PageBlockPropsMap["informationalTable"]>),
        sourceCanonicalTableRef: undefined,
        sourceColumnOrder: undefined,
        sourceVisibleColumns: undefined,
        sourceMode: "editableTable"
      });
    };

    const setLinkedEmail = (nextBlockId: string) => {
      patchBlockProps({
        ...(patchBlockLink(
          block.props,
          INFORMATIONAL_TABLE_SOURCE_EMAIL_LINK_KEY,
          nextBlockId || null
        ) as Partial<PageBlockPropsMap["informationalTable"]>),
        sourceMode: "email"
      });
    };

    const setLinkedCalendar = (nextBlockId: string) => {
      patchBlockProps({
        ...(patchBlockLink(
          block.props,
          INFORMATIONAL_TABLE_SOURCE_CALENDAR_LINK_KEY,
          nextBlockId || null
        ) as Partial<PageBlockPropsMap["informationalTable"]>),
        sourceMode: "applicationAlerts"
      });
    };

    const toggleAlertType = (at: AlertItemType) => {
      const checked = alertTypes.includes(at);
      const next = checked ? alertTypes.filter((t) => t !== at) : [...alertTypes, at];
      patchBlockProps({
        alertTypes: next.length >= ALL_ALERT_TYPES.length ? undefined : next.length > 0 ? next : undefined
      });
    };

    const toggleAlertStatus = (st: AlertStatusFilter) => {
      const checked = alertStatuses.includes(st);
      const next = checked ? alertStatuses.filter((s) => s !== st) : [...alertStatuses, st];
      patchBlockProps({
        alertStatuses: next.length >= ALL_ALERT_STATUSES.length ? undefined : next.length > 0 ? next : undefined
      });
    };

    const toggleAlertVisibleColumn = (col: AlertVisibleColumn) => {
      const checked = alertVisibleColumns.includes(col);
      const next = checked ? alertVisibleColumns.filter((c) => c !== col) : [...alertVisibleColumns, col];
      if (next.length === 0) return;
      patchBlockProps({
        alertVisibleColumns: next.length >= ALL_ALERT_VISIBLE_COLUMNS.length ? undefined : next
      });
    };

    const moveAlertColumn = (fromCol: AlertVisibleColumn, toCol: AlertVisibleColumn) => {
      if (fromCol === toCol) return;
      const fromIndex = alertColumnOrder.indexOf(fromCol);
      const toIndex = alertColumnOrder.indexOf(toCol);
      if (fromIndex < 0 || toIndex < 0) return;
      const reordered = reorderByIndex(alertColumnOrder, fromIndex, toIndex);
      const isDefault = reordered.every((c, i) => c === ALL_ALERT_VISIBLE_COLUMNS[i]);
      patchBlockProps({ alertColumnOrder: isDefault ? undefined : reordered });
    };

    const alertTypesSummary =
      alertTypes.length >= ALL_ALERT_TYPES.length
        ? `Todos (${ALL_ALERT_TYPES.length})`
        : alertTypes.map((t) => ALERT_TYPE_LABELS[t]).join(" · ");

    const alertStatusesSummary =
      alertStatuses.length >= ALL_ALERT_STATUSES.length
        ? `Todos (${ALL_ALERT_STATUSES.length})`
        : alertStatuses.map((s) => ALERT_STATUS_LABELS[s]).join(" · ");

    const alertColumnsSummary =
      alertVisibleColumns.length >= ALL_ALERT_VISIBLE_COLUMNS.length
        ? `Todas (${ALL_ALERT_VISIBLE_COLUMNS.length})`
        : `${alertVisibleColumns.length}/${ALL_ALERT_VISIBLE_COLUMNS.length} visibles`;

    const startColumnResize = (column: string, event: React.MouseEvent<HTMLDivElement>) => {
      if (!enableColumnResize) return;
      event.preventDefault();
      event.stopPropagation();
      const header = event.currentTarget.closest("th");
      const measuredWidth =
        header instanceof HTMLTableCellElement ? Math.round(header.getBoundingClientRect().width) : undefined;
      setResizing({
        column,
        startX: event.clientX,
        startWidth:
          columnWidthsRef.current[column] ||
          (Number.isFinite(measuredWidth) ? measuredWidth : undefined) ||
          estimateHeaderMinWidth(column)
      });
    };

    const blockMenuActions = mode === "edit"
      ? [
          {
            key: `informational-table-config-${block.id}`,
            label: "Configurar tabla informativa",
            onClick: () => setIsConfigOpen(true)
          },
          ...(menuActions || [])
        ]
      : menuActions;

    const renderBlockContent = () => {
      if (sourceMode === "editableTable") {
        if (!linkedTableTarget) {
          return <div className="empty">Selecciona una tabla editable para vincular este bloque.</div>;
        }
        if (!linkedTableModel) {
          return <div className="empty">La tabla editable canónica vinculada ya no está disponible.</div>;
        }
        return renderBasicTable(
          `${block.id}-linked-table`,
          effectiveLinkedTableModel?.columns || orderedLinkedTableModel?.columns || linkedTableModel.columns,
          effectiveLinkedTableModel?.rows || orderedLinkedTableModel?.rows || linkedTableModel.rows,
          "La tabla vinculada no tiene filas.",
          {
            columnWidths,
            resizable: enableColumnResize,
            onResizeStart: startColumnResize
          }
        );
      }

      if (sourceMode === "email") {
        if (!linkedEmailTarget) {
          return <div className="empty">Selecciona un bloque de correo para mostrar correos recientes.</div>;
        }
        return (
          <div className="informational-email-stack">
            <InformationalEmailNotice
              state={effectiveEmailState}
              sourceLabel={formatTargetLabel(linkedEmailTarget)}
              summary={emailSummary}
              cardOrder={emailSummaryCardOrder}
            />
            {effectiveEmailState.error ? <div className="alert">{effectiveEmailState.error}</div> : null}
            {emailState.loading && emailTableData.rows.length === 0 ? (
              <div className="empty">Cargando actividad reciente de correo...</div>
            ) : emailTableData.rows.length === 0 ? (
              <div className="empty">No hay correos recientes disponibles para los contactos revisados.</div>
            ) : (
              renderBasicTable(
                `${block.id}-email-table`,
                emailTableData.columns,
                emailTableData.rows,
                "No hay correos recientes disponibles.",
                {
                  columnWidths,
                  resizable: enableColumnResize,
                  onResizeStart: startColumnResize
                }
              )
            )}
          </div>
        );
      }

      if (sourceMode === "applicationAlerts") {
        return renderAlertsTable(
          `${block.id}-alerts-table`,
          alertRows,
          alertVisibleColumns,
          alertColumnOrder,
          "No hay alertas pendientes."
        );
      }

      if (slot) return slot;

      return renderBasicTable(`${block.id}-manual-table`, manualColumns, manualRows, "Sin filas en esta tabla.", {
        columnWidths,
        resizable: enableColumnResize,
        onResizeStart: startColumnResize
      });
    };

    const previewContent = (() => {
      if (sourceMode === "editableTable") {
        if (!linkedTableModel) {
          return <div className="empty">Vincula una tabla editable para ver una vista previa.</div>;
        }
        return (
          <SourceTablePreview
            table={effectiveLinkedTableModel || orderedLinkedTableModel || linkedTableModel}
            title="Vista previa de la tabla vinculada"
            maxRows={8}
            keyPrefix={`${block.id}-linked-preview`}
            emptyMessage="La tabla vinculada no tiene filas."
          />
        );
      }
      if (sourceMode === "email") {
        return (
          <div className="informational-email-preview">
            <InformationalEmailNotice
              state={effectiveEmailState}
              sourceLabel={linkedEmailTarget ? formatTargetLabel(linkedEmailTarget) : null}
              summary={emailSummary}
              cardOrder={emailSummaryCardOrder}
            />
            {effectiveEmailState.error ? <div className="alert">{effectiveEmailState.error}</div> : null}
            <SourceTablePreview
              table={emailTableData}
              title="Correos recientes"
              maxRows={6}
              keyPrefix={`${block.id}-email-preview`}
              emptyMessage="No hay correos recientes disponibles."
            />
          </div>
        );
      }
      if (sourceMode === "applicationAlerts") {
        return renderAlertsTable(
          `${block.id}-alerts-preview`,
          alertRows.slice(0, 8),
          alertVisibleColumns,
          alertColumnOrder,
          "No hay alertas pendientes."
        );
      }
      return (
        <SourceTablePreview
          table={{ columns: manualColumns, rows: manualRows }}
          title="Vista previa manual"
          maxRows={8}
          keyPrefix={`${block.id}-manual-preview`}
          emptyMessage="La tabla manual no tiene filas."
        />
      );
    })();

    return (
      <>
        <BlockPanel id={block.id} as="section" menuActions={blockMenuActions}>
          {renderHeader(block.id, mode, block.props.title || "", block.props.description || "", (patch) => patchBlockProps(patch))}
          {renderBlockContent()}
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
                    <h2>Configurar tabla informativa</h2>
                    <p>Define si este bloque se alimenta manualmente, desde una tabla editable o desde correo.</p>
                  </div>
                  <button className="ghost" type="button" onClick={() => setIsConfigOpen(false)} aria-label="Close">
                    ×
                  </button>
                </header>

                <div className="block-config-layout informational-table-config-layout">
                  <div className="block-config-main">
                    <section className="block-config-section">
                      <div className="block-config-section-head">
                        <div>
                          <h3>Origen de datos</h3>
                          <p>Selecciona cómo se construye el contenido de esta tabla de solo lectura.</p>
                        </div>
                      </div>

                      <div className="block-config-grid">
                        <div className="field">
                          <label htmlFor={`${block.id}-informational-source-mode`}>Modo</label>
                          <select
                            id={`${block.id}-informational-source-mode`}
                            value={sourceMode}
                            onChange={(event) => setSourceMode(event.target.value as InformationalTableSourceMode)}
                          >
                            <option value="manual">Manual</option>
                            <option value="editableTable">Tabla editable</option>
                            <option value="email">Correo</option>
                            <option value="applicationAlerts">Calendario</option>
                          </select>
                        </div>

                        {sourceMode === "editableTable" ? (
                          <>
                            <div className="field">
                            <label htmlFor={`${block.id}-informational-source-table`}>Tabla editable</label>
                            <select
                              id={`${block.id}-informational-source-table`}
                              value={selectedTableValue}
                              onChange={(event) => {
                                void setLinkedTable(event.target.value);
                              }}
                            >
                              <option value="">Selecciona una tabla</option>
                              {tableTargets.map((target) => (
                                <option
                                  key={target.blockId}
                                  value={target.blockId}
                                >
                                  {formatTargetLabel(target)}
                                </option>
                              ))}
                            </select>
                          </div>

                            <div className="field full">
                              <span className="block-field-label">Columnas visibles</span>
                              <p className="block-field-hint">
                                Elige qué columnas de la tabla editable quieres mostrar y arrástralas para cambiar su orden.
                              </p>
                              <div className="informational-table-columns-control">
                                <button
                                  ref={visibleColumnsTriggerRef}
                                  type="button"
                                  className={`select-trigger informational-table-columns-trigger ${visibleColumnsMenuOpen ? "open" : ""}`}
                                  onClick={() => setVisibleColumnsMenuOpen((current) => !current)}
                                  disabled={
                                    !linkedTableModel ||
                                    linkedTableModel.columns.length === 0
                                  }
                                  aria-haspopup="menu"
                                  aria-expanded={visibleColumnsMenuOpen}
                                >
                                  <span className="select-pill">{visibleColumnsSummary}</span>
                                  <span className="select-caret">▾</span>
                                </button>
                                <button
                                  type="button"
                                  className="ghost"
                                  onClick={resetVisibleColumns}
                                  disabled={
                                    !linkedTableModel ||
                                    linkedTableModel.columns.length === 0
                                  }
                                >
                                  Mostrar todas
                                </button>
                              </div>
                              {!linkedTableModel || linkedTableModel.columns.length === 0 ? (
                                <div className="empty">
                                  Selecciona primero una tabla para elegir columnas.
                                </div>
                              ) : null}
                            </div>
                          </>
                        ) : null}

                        {sourceMode === "email" ? (
                          <>
                            <div className="field">
                              <label htmlFor={`${block.id}-informational-source-email`}>Bloque de correo</label>
                              <select
                                id={`${block.id}-informational-source-email`}
                                value={linkedEmailTarget?.blockId || ""}
                                onChange={(event) => setLinkedEmail(event.target.value)}
                              >
                                <option value="">Selecciona un bloque de correo</option>
                                {emailTargets.map((target) => (
                                  <option key={target.blockId} value={target.blockId}>
                                    {formatTargetLabel(target)}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="field">
                              <label id={`${block.id}-informational-email-company`}>Empresa</label>
                              <button
                                ref={companyFilterTriggerRef}
                                type="button"
                                className={`select-trigger informational-email-filter-trigger ${companyFilterOpen ? "open" : ""}`}
                                onClick={() => setCompanyFilterOpen((prev) => !prev)}
                                disabled={availableCompanyOptions.length === 0}
                                aria-haspopup="listbox"
                                aria-expanded={companyFilterOpen}
                              >
                                <span className="select-pill">
                                  {effectiveEmailCompanyFilter.length === 0
                                    ? "Todas las empresas"
                                    : effectiveEmailCompanyFilter.length === 1
                                      ? effectiveEmailCompanyFilter[0]
                                      : `${effectiveEmailCompanyFilter[0]} +${effectiveEmailCompanyFilter.length - 1}`}
                                </span>
                                <span className="select-caret">▾</span>
                              </button>
                              {availableCompanyOptions.length === 0 ? (
                                <p className="block-field-hint">No hay empresas disponibles.</p>
                              ) : null}
                            </div>

                            <div className="field">
                              <label id={`${block.id}-informational-email-contact`}>Contacto</label>
                              <button
                                ref={contactFilterTriggerRef}
                                type="button"
                                className={`select-trigger informational-email-filter-trigger ${contactFilterOpen ? "open" : ""}`}
                                onClick={() => setContactFilterOpen((prev) => !prev)}
                                disabled={companyFilteredContacts.length === 0}
                                aria-haspopup="listbox"
                                aria-expanded={contactFilterOpen}
                              >
                                <span className="select-pill">{effectiveEmailContactFilterSummary}</span>
                                <span className="select-caret">▾</span>
                              </button>
                              {companyFilteredContacts.length === 0 ? (
                                <p className="block-field-hint">No hay contactos disponibles.</p>
                              ) : null}
                            </div>

                            <div className="field">
                              <label htmlFor={`${block.id}-informational-email-folder`}>Carpeta</label>
                              <select
                                id={`${block.id}-informational-email-folder`}
                                value={emailFolderFilter}
                                onChange={(event) =>
                                  patchBlockProps({
                                    emailFolderFilter: event.target.value || undefined
                                  })
                                }
                              >
                                {EMAIL_FOLDER_OPTIONS.map((option) => (
                                  <option key={`${block.id}-folder-${option.value || "default"}`} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="field">
                              <label htmlFor={`${block.id}-informational-email-account`}>Cuenta usada</label>
                              <select
                                id={`${block.id}-informational-email-account`}
                                value={emailAccountFilter}
                                onChange={(event) =>
                                  patchBlockProps({
                                    emailAccountFilter: event.target.value || undefined
                                  })
                                }
                              >
                                <option value="">Heredar del bloque vinculado</option>
                                {accountOptions.map((account) => (
                                  <option key={`${block.id}-account-${account}`} value={account}>
                                    {account === READ_MAILBOX_ALL ? "Todas las cuentas" : account}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="field">
                              <label htmlFor={`${block.id}-informational-email-limit`}>Correos recientes a mostrar</label>
                              <input
                                id={`${block.id}-informational-email-limit`}
                                type="number"
                                min={MIN_EMAIL_RECENT_LIMIT}
                                max={MAX_EMAIL_RECENT_LIMIT}
                                value={emailRecentLimit}
                                onChange={(event) =>
                                  patchBlockProps({
                                    emailRecentLimit: normalizeEmailRecentLimit(event.target.value)
                                  })
                                }
                              />
                              <p className="block-field-hint">
                                Limita las filas visibles por contacto en la tabla inferior; no recorta el resumen superior.
                              </p>
                            </div>

                            <div className="field">
                              <label htmlFor={`${block.id}-informational-email-lookback`}>
                                Días hacia atrás
                              </label>
                              <input
                                id={`${block.id}-informational-email-lookback`}
                                type="number"
                                min={MIN_EMAIL_LOOKBACK_DAYS}
                                max={MAX_EMAIL_LOOKBACK_DAYS}
                                placeholder="Heredar del bloque"
                                value={emailLookbackDays ?? ""}
                                onChange={(event) =>
                                  patchBlockProps({
                                    emailLookbackDays: normalizeEmailLookbackDays(event.target.value)
                                  })
                                }
                              />
                            </div>

                            <div className="field full">
                              <span className="block-field-label">Resumen de correo</span>
                              <p className="block-field-hint">
                                Ajusta la ventana temporal de cada widget y organiza el orden en que aparecen.
                              </p>
                              <div className="informational-email-summary-settings">
                                <div className="field">
                                  <label htmlFor={`${block.id}-informational-email-summary-volume-days`}>
                                    Correos recientes
                                  </label>
                                  <input
                                    id={`${block.id}-informational-email-summary-volume-days`}
                                    type="number"
                                    min={MIN_EMAIL_LOOKBACK_DAYS}
                                    max={MAX_EMAIL_LOOKBACK_DAYS}
                                    value={emailSummaryVolumeDays}
                                    onChange={(event) =>
                                      patchBlockProps({
                                        emailSummaryVolumeDays: normalizeEmailSummaryDays(
                                          event.target.value,
                                          DEFAULT_EMAIL_SUMMARY_VOLUME_DAYS
                                        )
                                      })
                                    }
                                  />
                                  <p className="block-field-hint">Cuenta correos en la ventana temporal indicada.</p>
                                </div>

                                <div className="field">
                                  <label htmlFor={`${block.id}-informational-email-summary-timeline-days`}>
                                    Timeline recibidos
                                  </label>
                                  <input
                                    id={`${block.id}-informational-email-summary-timeline-days`}
                                    type="number"
                                    min={MIN_EMAIL_LOOKBACK_DAYS}
                                    max={MAX_EMAIL_LOOKBACK_DAYS}
                                    value={emailSummaryTimelineDays}
                                    onChange={(event) =>
                                      patchBlockProps({
                                        emailSummaryTimelineDays: normalizeEmailSummaryDays(
                                          event.target.value,
                                          DEFAULT_EMAIL_SUMMARY_TIMELINE_DAYS
                                        )
                                      })
                                    }
                                  />
                                  <p className="block-field-hint">Grafico de mensajes recibidos durante los ultimos dias.</p>
                                </div>

                                <div className="field">
                                  <label htmlFor={`${block.id}-informational-email-summary-awaiting-reply-days`}>
                                    Pendientes de contestacion
                                  </label>
                                  <input
                                    id={`${block.id}-informational-email-summary-awaiting-reply-days`}
                                    type="number"
                                    min={MIN_EMAIL_LOOKBACK_DAYS}
                                    max={MAX_EMAIL_LOOKBACK_DAYS}
                                    value={emailSummaryAwaitingReplyDays}
                                    onChange={(event) =>
                                      patchBlockProps({
                                        emailSummaryAwaitingReplyDays: normalizeEmailSummaryDays(
                                          event.target.value,
                                          DEFAULT_EMAIL_SUMMARY_AWAITING_REPLY_DAYS
                                        )
                                      })
                                    }
                                  />
                                  <p className="block-field-hint">Contactos a los que escribiste y no contestaron despues.</p>
                                </div>

                                <div className="field">
                                  <label htmlFor={`${block.id}-informational-email-summary-awaiting-response-days`}>
                                    Pendientes de contestar
                                  </label>
                                  <input
                                    id={`${block.id}-informational-email-summary-awaiting-response-days`}
                                    type="number"
                                    min={MIN_EMAIL_LOOKBACK_DAYS}
                                    max={MAX_EMAIL_LOOKBACK_DAYS}
                                    value={emailSummaryAwaitingResponseDays}
                                    onChange={(event) =>
                                      patchBlockProps({
                                        emailSummaryAwaitingResponseDays: normalizeEmailSummaryDays(
                                          event.target.value,
                                          DEFAULT_EMAIL_SUMMARY_AWAITING_RESPONSE_DAYS
                                        )
                                      })
                                    }
                                  />
                                  <p className="block-field-hint">Contactos que escribieron y siguen esperando tu respuesta.</p>
                                </div>
                              </div>

                              <div className="informational-email-summary-order">
                                <div className="informational-email-summary-order-head">
                                  <span className="block-field-label">Orden del resumen</span>
                                  <button
                                    type="button"
                                    className="ghost"
                                    onClick={() => patchBlockProps({ emailSummaryCardOrder: undefined })}
                                  >
                                    Restablecer
                                  </button>
                                </div>
                                <div className="informational-email-summary-order-list">
                                  {emailSummaryCardOrder.map((cardId, index) => (
                                    <div key={`${block.id}-summary-card-${cardId}`} className="informational-email-summary-order-item">
                                      <span>
                                        {index + 1}. {EMAIL_SUMMARY_CARD_LABELS[cardId]}
                                      </span>
                                      <div className="informational-email-summary-order-actions">
                                        <button
                                          type="button"
                                          className="ghost"
                                          onClick={() => shiftEmailSummaryCard(cardId, -1)}
                                          disabled={index === 0}
                                        >
                                          Subir
                                        </button>
                                        <button
                                          type="button"
                                          className="ghost"
                                          onClick={() => shiftEmailSummaryCard(cardId, 1)}
                                          disabled={index === emailSummaryCardOrder.length - 1}
                                        >
                                          Bajar
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </>
                        ) : null}

                        {sourceMode === "applicationAlerts" ? (
                          <>
                            <div className="field">
                              <label htmlFor={`${block.id}-informational-source-calendar`}>Calendario vinculado</label>
                              <select
                                id={`${block.id}-informational-source-calendar`}
                                value={linkedCalendarTarget?.blockId || ""}
                                onChange={(event) => setLinkedCalendar(event.target.value)}
                              >
                                <option value="">Sin vincular (todas las aplicaciones)</option>
                                {calendarTargets.map((target) => (
                                  <option key={target.blockId} value={target.blockId}>
                                    {formatTargetLabel(target)}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="field">
                              <span className="block-field-label">Tipos de alerta</span>
                              <p className="block-field-hint">Filtra qué tipos de evento mostrar.</p>
                              <div className="informational-table-columns-control">
                                <button
                                  ref={alertTypeFilterTriggerRef}
                                  type="button"
                                  className={`select-trigger informational-table-columns-trigger ${alertTypeFilterOpen ? "open" : ""}`}
                                  onClick={() => setAlertTypeFilterOpen((c) => !c)}
                                  aria-haspopup="listbox"
                                  aria-expanded={alertTypeFilterOpen}
                                >
                                  <span className="select-pill">{alertTypesSummary}</span>
                                  <span className="select-caret">▾</span>
                                </button>
                              </div>
                            </div>

                            <div className="field">
                              <span className="block-field-label">Estados visibles</span>
                              <p className="block-field-hint">Filtra por estado de la alerta.</p>
                              <div className="informational-table-columns-control">
                                <button
                                  ref={alertStatusFilterTriggerRef}
                                  type="button"
                                  className={`select-trigger informational-table-columns-trigger ${alertStatusFilterOpen ? "open" : ""}`}
                                  onClick={() => setAlertStatusFilterOpen((c) => !c)}
                                  aria-haspopup="listbox"
                                  aria-expanded={alertStatusFilterOpen}
                                >
                                  <span className="select-pill">{alertStatusesSummary}</span>
                                  <span className="select-caret">▾</span>
                                </button>
                              </div>
                            </div>

                            <div className="field">
                              <label htmlFor={`${block.id}-informational-alert-sort`}>Ordenar por</label>
                              <select
                                id={`${block.id}-informational-alert-sort`}
                                value={alertSortOrder}
                                onChange={(event) =>
                                  patchBlockProps({
                                    alertSortOrder: (event.target.value as AlertSortOrder) || undefined
                                  })
                                }
                              >
                                {(Object.keys(ALERT_SORT_LABELS) as AlertSortOrder[]).map((key) => (
                                  <option key={key} value={key}>
                                    {ALERT_SORT_LABELS[key]}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="field">
                              <label htmlFor={`${block.id}-informational-alert-max`}>Máximo de filas</label>
                              <input
                                id={`${block.id}-informational-alert-max`}
                                type="number"
                                min={MIN_ALERT_MAX_ROWS}
                                max={MAX_ALERT_MAX_ROWS}
                                value={alertMaxRows}
                                onChange={(event) =>
                                  patchBlockProps({
                                    alertMaxRows: normalizeAlertMaxRows(event.target.value)
                                  })
                                }
                              />
                              <p className="block-field-hint">Límite de filas a mostrar en la tabla de alertas.</p>
                            </div>

                            <div className="field full">
                              <span className="block-field-label">Columnas visibles</span>
                              <p className="block-field-hint">Selecciona y arrastra para reordenar las columnas.</p>
                              <div className="informational-table-columns-control">
                                <button
                                  ref={alertColumnsTriggerRef}
                                  type="button"
                                  className={`select-trigger informational-table-columns-trigger ${alertColumnsMenuOpen ? "open" : ""}`}
                                  onClick={() => setAlertColumnsMenuOpen((c) => !c)}
                                  aria-haspopup="menu"
                                  aria-expanded={alertColumnsMenuOpen}
                                >
                                  <span className="select-pill">{alertColumnsSummary}</span>
                                  <span className="select-caret">▾</span>
                                </button>
                                <button
                                  type="button"
                                  className="ghost"
                                  onClick={() => patchBlockProps({ alertVisibleColumns: undefined, alertColumnOrder: undefined })}
                                  disabled={alertVisibleColumns.length === ALL_ALERT_VISIBLE_COLUMNS.length && alertColumnOrder.every((c, i) => c === ALL_ALERT_VISIBLE_COLUMNS[i])}
                                >
                                  Mostrar todas
                                </button>
                              </div>
                            </div>
                          </>
                        ) : null}
                      </div>
                    </section>
                  </div>

                  <aside className="block-config-sidebar">
                    <section className="block-config-sidebar-card informational-table-status-card">
                      <div className="block-config-section-head compact">
                        <div>
                          <h3>Estado actual</h3>
                          <p>Resumen rápido de la configuración activa del bloque.</p>
                        </div>
                      </div>
                      <div className="informational-table-status-list">
                        <div className="informational-table-status-item">
                          <span>Modo</span>
                          <strong>{sourceMode === "editableTable" ? "Tabla editable" : sourceMode === "email" ? "Correo" : sourceMode === "applicationAlerts" ? "Calendario" : "Manual"}</strong>
                        </div>
                        <div className="informational-table-status-item">
                          <span>Origen</span>
                          <strong>
                            {sourceMode === "editableTable"
                              ? linkedTableTarget
                                ? formatTargetLabel(linkedTableTarget)
                                : "Sin vincular"
                              : sourceMode === "email"
                                ? linkedEmailTarget
                                  ? formatTargetLabel(linkedEmailTarget)
                                  : "Sin vincular"
                                : sourceMode === "applicationAlerts"
                                  ? linkedCalendarTarget
                                    ? formatTargetLabel(linkedCalendarTarget)
                                    : "Todas las aplicaciones"
                                  : "Tabla local"}
                          </strong>
                        </div>
                        <div className="informational-table-status-item">
                          <span>Filas visibles</span>
                          <strong>
                            {sourceMode === "editableTable"
                              ? effectiveLinkedTableModel?.rows.length || linkedTableModel?.rows.length || 0
                              : sourceMode === "email"
                                ? emailTableData.rows.length
                                : sourceMode === "applicationAlerts"
                                  ? alertRows.length
                                  : manualRows.length}
                          </strong>
                        </div>
                        {sourceMode === "editableTable" && linkedTableModel ? (
                          <div className="informational-table-status-item">
                            <span>Columnas visibles</span>
                            <strong>
                              {(effectiveLinkedTableModel?.columns.length || linkedTableModel.columns.length)}/
                              {linkedTableModel.columns.length}
                            </strong>
                          </div>
                        ) : null}
                        {sourceMode === "email" ? (
                          <>
                            <div className="informational-table-status-item">
                              <span>Filtros</span>
                              <strong>
                                {[
                                  effectiveEmailCompanyFilter || "Todas las empresas",
                                  effectiveEmailContactFilterSummary,
                                  formatMailboxLabel(linkedEmailFolder || READ_MAILBOX_ALL),
                                  effectiveEmailAccountFilter === READ_MAILBOX_ALL
                                    ? "Todas las cuentas"
                                    : effectiveEmailAccountFilter,
                                  emailLookbackDays
                                    ? `Últimos ${emailLookbackDays} días`
                                    : effectiveEmailStartDate
                                      ? `Desde ${effectiveEmailStartDate}`
                                      : "Sin límite temporal"
                                ].join(" · ")}
                              </strong>
                            </div>
                            <div className="informational-table-status-item">
                              <span>Ventanas resumen</span>
                              <strong>
                                {[
                                  `Correos ${emailSummaryVolumeDays}d`,
                                  `Timeline ${emailSummaryTimelineDays}d`,
                                  `Espera ${emailSummaryAwaitingReplyDays}d`,
                                  `Contestar ${emailSummaryAwaitingResponseDays}d`
                                ].join(" · ")}
                              </strong>
                            </div>
                            <div className="informational-table-status-item">
                              <span>Orden resumen</span>
                              <strong>{emailSummaryCardOrder.map((cardId) => EMAIL_SUMMARY_CARD_LABELS[cardId]).join(" · ")}</strong>
                            </div>
                          </>
                        ) : null}
                        {sourceMode === "applicationAlerts" ? (
                          <>
                            <div className="informational-table-status-item">
                              <span>Tipos</span>
                              <strong>{alertTypes.map((t) => ALERT_TYPE_LABELS[t]).join(" · ")}</strong>
                            </div>
                            <div className="informational-table-status-item">
                              <span>Estados</span>
                              <strong>{alertStatuses.map((s) => ALERT_STATUS_LABELS[s]).join(" · ")}</strong>
                            </div>
                            <div className="informational-table-status-item">
                              <span>Orden</span>
                              <strong>{ALERT_SORT_LABELS[alertSortOrder]}</strong>
                            </div>
                            <div className="informational-table-status-item">
                              <span>Columnas</span>
                              <strong>{alertVisibleColumns.map((c) => ALERT_COLUMN_LABELS[c]).join(" · ")}</strong>
                            </div>
                            <div className="informational-table-status-item">
                              <span>Máximo filas</span>
                              <strong>{alertMaxRows}</strong>
                            </div>
                          </>
                        ) : null}
                      </div>
                    </section>
                  </aside>
                </div>

                {previewContent}
              </div>
            </div>,
            document.body
          )}
        {visibleColumnsMenuOpen &&
          visibleColumnsMenuPos &&
          linkedTableModel &&
          linkedTableModel.columns.length > 0 &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              ref={visibleColumnsMenuRef}
              className="select-menu informational-table-columns-menu"
              style={{
                position: "fixed",
                top: visibleColumnsMenuPos.top,
                left: visibleColumnsMenuPos.left,
                width:
                  typeof window !== "undefined"
                    ? Math.min(VISIBLE_COLUMNS_MENU_WIDTH, window.innerWidth - FLOATING_MENU_GUTTER * 2)
                    : VISIBLE_COLUMNS_MENU_WIDTH,
                zIndex: 80
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="select-options" role="menu" aria-label="Columnas visibles">
                {sourceColumnOrder.map((column) => {
                  const checked = visibleLinkedColumns.includes(column);
                  return (
                    <button
                      key={`${block.id}-visible-column-option-${column}`}
                      type="button"
                      className={`select-option draggable ${checked ? "selected" : ""} ${dragOverColumnOption === column ? "drag-over" : ""}`}
                      draggable
                      onDragStart={() => {
                        setDraggedColumnOption(column);
                        setDragOverColumnOption(null);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        if (!draggedColumnOption || draggedColumnOption === column) return;
                        setDragOverColumnOption(column);
                      }}
                      onDragLeave={() => {
                        setDragOverColumnOption((current) => (current === column ? null : current));
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (!draggedColumnOption || draggedColumnOption === column) return;
                        moveSourceColumn(draggedColumnOption, column);
                        setDraggedColumnOption(null);
                        setDragOverColumnOption(null);
                      }}
                      onDragEnd={() => {
                        setDraggedColumnOption(null);
                        setDragOverColumnOption(null);
                      }}
                      onClick={() => toggleVisibleColumn(column)}
                    >
                      <span className="select-drag" aria-hidden="true">⋮⋮</span>
                      <span className="select-swatch" style={{ backgroundColor: "var(--panel)" }} />
                      <span className="select-label">{column}</span>
                      <span className="select-check">{checked ? "✓" : ""}</span>
                    </button>
                  );
                })}
                <div className="column-menu-separator" />
                <button type="button" className="select-option" onClick={resetVisibleColumns}>
                  <span className="select-swatch" style={{ backgroundColor: "var(--panel)" }} />
                  <span className="select-label">Mostrar todas</span>
                </button>
              </div>
            </div>,
            document.body
          )}
        {companyFilterOpen &&
          companyFilterPos &&
          availableCompanyOptions.length > 0 &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              ref={companyFilterMenuRef}
              className="select-menu informational-email-filter-menu"
              style={{
                position: "fixed",
                top: companyFilterPos.top,
                left: companyFilterPos.left,
                width:
                  typeof window !== "undefined"
                    ? Math.min(280, window.innerWidth - FLOATING_MENU_GUTTER * 2)
                    : 280,
                zIndex: 80
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div
                className="select-options informational-email-filter-list"
                role="listbox"
                aria-labelledby={`${block.id}-informational-email-company`}
                aria-multiselectable="true"
              >
                {availableCompanyOptions.map((company) => {
                  const checked = effectiveEmailCompanyFilter.includes(company);
                  return (
                    <button
                      type="button"
                      key={`${block.id}-company-${company}`}
                      className={`select-option${checked ? " selected" : ""}`}
                      onClick={() => {
                        const next = checked
                          ? effectiveEmailCompanyFilter.filter((c) => c !== company)
                          : [...effectiveEmailCompanyFilter, company];
                        patchBlockProps({
                          emailCompanyFilter: next.length > 0 ? next : undefined,
                          emailContactFilter: undefined
                        });
                      }}
                    >
                      <span className="select-label">{company}</span>
                      <span className="select-check">{checked ? "✓" : ""}</span>
                    </button>
                  );
                })}
                <div className="column-menu-separator" />
                <button
                  type="button"
                  className="select-option"
                  onClick={() => {
                    patchBlockProps({ emailCompanyFilter: undefined, emailContactFilter: undefined });
                    setCompanyFilterOpen(false);
                  }}
                  disabled={effectiveEmailCompanyFilter.length === 0}
                >
                  <span className="select-label">Mostrar todas</span>
                </button>
              </div>
            </div>,
            document.body
          )}
        {contactFilterOpen &&
          contactFilterPos &&
          companyFilteredContacts.length > 0 &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              ref={contactFilterMenuRef}
              className="select-menu informational-email-filter-menu"
              style={{
                position: "fixed",
                top: contactFilterPos.top,
                left: contactFilterPos.left,
                width:
                  typeof window !== "undefined"
                    ? Math.min(320, window.innerWidth - FLOATING_MENU_GUTTER * 2)
                    : 320,
                zIndex: 80
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div
                className="select-options informational-email-filter-list"
                role="listbox"
                aria-labelledby={`${block.id}-informational-email-contact`}
                aria-multiselectable="true"
              >
                {companyFilteredContacts.map((contact) => {
                  const checked = effectiveEmailContactFilter.includes(contact.email);
                  return (
                    <button
                      type="button"
                      key={`${block.id}-contact-${contact.email}`}
                      className={`select-option${checked ? " selected" : ""}`}
                      onClick={() => {
                        const next = checked
                          ? effectiveEmailContactFilter.filter((e) => e !== contact.email)
                          : [...effectiveEmailContactFilter, contact.email];
                        patchBlockProps({
                          emailContactFilter: next.length > 0 ? next : undefined
                        });
                      }}
                    >
                      <span className="select-label">
                        {contact.name || contact.email}
                        {contact.company ? (
                          <span className="select-label-muted"> · {contact.company}</span>
                        ) : null}
                      </span>
                      <span className="select-check">{checked ? "✓" : ""}</span>
                    </button>
                  );
                })}
                <div className="column-menu-separator" />
                <button
                  type="button"
                  className="select-option"
                  onClick={() => {
                    patchBlockProps({ emailContactFilter: undefined });
                    setContactFilterOpen(false);
                  }}
                  disabled={effectiveEmailContactFilter.length === 0}
                >
                  <span className="select-label">Mostrar todos</span>
                </button>
              </div>
            </div>,
            document.body
          )}
        {/* Alert type filter floating menu */}
        {alertTypeFilterOpen &&
          alertTypeFilterPos &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              ref={alertTypeFilterMenuRef}
              className="select-menu informational-email-filter-menu"
              style={{
                position: "fixed",
                top: alertTypeFilterPos.top,
                left: alertTypeFilterPos.left,
                width:
                  typeof window !== "undefined"
                    ? Math.min(280, window.innerWidth - FLOATING_MENU_GUTTER * 2)
                    : 280,
                zIndex: 80
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div
                className="select-options informational-email-filter-list"
                role="listbox"
                aria-label="Tipos de alerta"
                aria-multiselectable="true"
              >
                {ALL_ALERT_TYPES.map((at) => {
                  const checked = alertTypes.includes(at);
                  return (
                    <button
                      type="button"
                      key={`${block.id}-alert-type-option-${at}`}
                      className={`select-option${checked ? " selected" : ""}`}
                      onClick={() => toggleAlertType(at)}
                    >
                      <span className="select-label">{ALERT_TYPE_LABELS[at]}</span>
                      <span className="select-check">{checked ? "✓" : ""}</span>
                    </button>
                  );
                })}
                <div className="column-menu-separator" />
                <button
                  type="button"
                  className="select-option"
                  onClick={() => {
                    patchBlockProps({ alertTypes: undefined });
                    setAlertTypeFilterOpen(false);
                  }}
                  disabled={alertTypes.length >= ALL_ALERT_TYPES.length}
                >
                  <span className="select-label">Seleccionar todos</span>
                </button>
              </div>
            </div>,
            document.body
          )}
        {/* Alert status filter floating menu */}
        {alertStatusFilterOpen &&
          alertStatusFilterPos &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              ref={alertStatusFilterMenuRef}
              className="select-menu informational-email-filter-menu"
              style={{
                position: "fixed",
                top: alertStatusFilterPos.top,
                left: alertStatusFilterPos.left,
                width:
                  typeof window !== "undefined"
                    ? Math.min(240, window.innerWidth - FLOATING_MENU_GUTTER * 2)
                    : 240,
                zIndex: 80
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div
                className="select-options informational-email-filter-list"
                role="listbox"
                aria-label="Estados de alerta"
                aria-multiselectable="true"
              >
                {ALL_ALERT_STATUSES.map((st) => {
                  const checked = alertStatuses.includes(st);
                  return (
                    <button
                      type="button"
                      key={`${block.id}-alert-status-option-${st}`}
                      className={`select-option${checked ? " selected" : ""}`}
                      onClick={() => toggleAlertStatus(st)}
                    >
                      <span className="select-label"><span className={`tag tag-${st}`}>{ALERT_STATUS_LABELS[st]}</span></span>
                      <span className="select-check">{checked ? "✓" : ""}</span>
                    </button>
                  );
                })}
                <div className="column-menu-separator" />
                <button
                  type="button"
                  className="select-option"
                  onClick={() => {
                    patchBlockProps({ alertStatuses: undefined });
                    setAlertStatusFilterOpen(false);
                  }}
                  disabled={alertStatuses.length >= ALL_ALERT_STATUSES.length}
                >
                  <span className="select-label">Seleccionar todos</span>
                </button>
              </div>
            </div>,
            document.body
          )}
        {/* Alert columns draggable floating menu */}
        {alertColumnsMenuOpen &&
          alertColumnsMenuPos &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              ref={alertColumnsMenuRef}
              className="select-menu informational-table-columns-menu"
              style={{
                position: "fixed",
                top: alertColumnsMenuPos.top,
                left: alertColumnsMenuPos.left,
                width:
                  typeof window !== "undefined"
                    ? Math.min(VISIBLE_COLUMNS_MENU_WIDTH, window.innerWidth - FLOATING_MENU_GUTTER * 2)
                    : VISIBLE_COLUMNS_MENU_WIDTH,
                zIndex: 80
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="select-options" role="menu" aria-label="Columnas de alertas">
                {alertColumnOrder.map((col) => {
                  const checked = alertVisibleColumns.includes(col);
                  return (
                    <button
                      key={`${block.id}-alert-col-option-${col}`}
                      type="button"
                      className={`select-option draggable ${checked ? "selected" : ""} ${dragOverAlertColumn === col ? "drag-over" : ""}`}
                      draggable
                      onDragStart={() => {
                        setDraggedAlertColumn(col);
                        setDragOverAlertColumn(null);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        if (!draggedAlertColumn || draggedAlertColumn === col) return;
                        setDragOverAlertColumn(col);
                      }}
                      onDragLeave={() => {
                        setDragOverAlertColumn((current) => (current === col ? null : current));
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (!draggedAlertColumn || draggedAlertColumn === col) return;
                        moveAlertColumn(draggedAlertColumn as AlertVisibleColumn, col);
                        setDraggedAlertColumn(null);
                        setDragOverAlertColumn(null);
                      }}
                      onDragEnd={() => {
                        setDraggedAlertColumn(null);
                        setDragOverAlertColumn(null);
                      }}
                      onClick={() => toggleAlertVisibleColumn(col)}
                    >
                      <span className="select-drag" aria-hidden="true">⋮⋮</span>
                      <span className="select-swatch" style={{ backgroundColor: "var(--panel)" }} />
                      <span className="select-label">{ALERT_COLUMN_LABELS[col]}</span>
                      <span className="select-check">{checked ? "✓" : ""}</span>
                    </button>
                  );
                })}
                <div className="column-menu-separator" />
                <button
                  type="button"
                  className="select-option"
                  onClick={() => {
                    patchBlockProps({ alertVisibleColumns: undefined, alertColumnOrder: undefined });
                    setAlertColumnsMenuOpen(false);
                  }}
                >
                  <span className="select-swatch" style={{ backgroundColor: "var(--panel)" }} />
                  <span className="select-label">Mostrar todas</span>
                </button>
              </div>
            </div>,
            document.body
          )}
      </>
    );
  }
};
