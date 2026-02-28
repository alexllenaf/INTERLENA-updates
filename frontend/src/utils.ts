import { Application, Settings } from "./types";

export type DocumentLink = {
  label: string;
  href?: string;
};

type ParsedDateValue = {
  date: string | null;
  time: string | null;
};

type DateDisplayOptions = {
  allowTime?: boolean;
  emptyPlaceholder?: string;
  invalidPlaceholder?: string;
};

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;
const TIME_ONLY_PATTERN = /^(\d{2}):(\d{2})$/;
const RANGE_SPLITTERS = ["\n", " -> ", " → ", " | ", "|", " to ", " a ", " / ", " - ", " — ", " – "];

const formatDdMmYyyy = (value: string) => {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
};

const combineDateAndTime = (dateLabel: string, timeLabel: string) => {
  if (dateLabel && timeLabel) return `${dateLabel}  ${timeLabel}`;
  return dateLabel || timeLabel;
};

const parseDateValue = (raw?: string | null): ParsedDateValue | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const dateOnlyMatch = DATE_ONLY_PATTERN.exec(trimmed);
  if (dateOnlyMatch) {
    return {
      date: `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}`,
      time: null
    };
  }

  const dateTimeMatch = DATE_TIME_PATTERN.exec(trimmed);
  if (dateTimeMatch) {
    return {
      date: `${dateTimeMatch[1]}-${dateTimeMatch[2]}-${dateTimeMatch[3]}`,
      time: `${dateTimeMatch[4]}:${dateTimeMatch[5]}`
    };
  }

  const timeOnlyMatch = TIME_ONLY_PATTERN.exec(trimmed);
  if (timeOnlyMatch) {
    return {
      date: null,
      time: `${timeOnlyMatch[1]}:${timeOnlyMatch[2]}`
    };
  }

  const normalizedDateTime = toDateTimeLocalValue(trimmed);
  if (normalizedDateTime) {
    const [date, time = "00:00"] = normalizedDateTime.split("T");
    return { date, time };
  }

  const normalizedDate = toDateInputValue(trimmed);
  if (normalizedDate) {
    return { date: normalizedDate, time: null };
  }

  return null;
};

const splitRangeValue = (raw: string): [string, string | null] => {
  const trimmed = raw.trim();
  for (const splitter of RANGE_SPLITTERS) {
    if (!trimmed.includes(splitter)) continue;
    const parts = trimmed
      .split(splitter)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length >= 2) return [parts[0], parts[1]];
  }
  return [trimmed, null];
};

const normalizeRangePoints = (value?: string | null) => {
  if (!value) return null;
  const [startRaw, endRaw] = splitRangeValue(value);
  const start = parseDateValue(startRaw);
  const end = parseDateValue(endRaw);
  if (!start && !end) return null;

  const normalizedStart = start ? { ...start } : { date: end?.date ?? null, time: null };
  const normalizedEnd = end ? { ...end } : null;

  if (normalizedStart.date === null && normalizedEnd?.date) {
    normalizedStart.date = normalizedEnd.date;
  }
  if (normalizedEnd && normalizedEnd.date === null && normalizedStart.date) {
    normalizedEnd.date = normalizedStart.date;
  }

  return { start: normalizedStart, end: normalizedEnd };
};

const isVisibleTime = (time?: string | null) => Boolean(time) && time !== "00:00";

const formatPointLabel = (point: ParsedDateValue, showTime: boolean) => {
  const dateLabel = point.date ? formatDdMmYyyy(point.date) : "";
  const timeLabel = showTime && point.time ? point.time : "";
  return combineDateAndTime(dateLabel, timeLabel);
};

export function formatDateDisplay(value?: string | null, options: DateDisplayOptions = {}): string {
  const emptyPlaceholder = options.emptyPlaceholder ?? "—";
  const invalidPlaceholder = options.invalidPlaceholder;
  if (!value) return emptyPlaceholder;
  const normalized = normalizeRangePoints(value);
  if (!normalized) return invalidPlaceholder ?? String(value);

  const allowTime = options.allowTime ?? true;
  const { start, end } = normalized;

  if (!end) {
    return formatPointLabel(start, allowTime && isVisibleTime(start.time)) || emptyPlaceholder;
  }

  const sameDate = Boolean(start.date && end.date && start.date === end.date);
  const hasAnyVisibleTime = allowTime && (isVisibleTime(start.time) || isVisibleTime(end.time));
  const showStartTime = allowTime && Boolean(start.time) && (isVisibleTime(start.time) || (hasAnyVisibleTime && Boolean(end.time)));
  const showEndTime = allowTime && Boolean(end.time) && (isVisibleTime(end.time) || (hasAnyVisibleTime && Boolean(start.time)));

  if (sameDate) {
    const dateLabel = start.date ? formatDdMmYyyy(start.date) : "";
    if (showStartTime && showEndTime && start.time && end.time) {
      if (start.time === end.time) return combineDateAndTime(dateLabel, start.time) || emptyPlaceholder;
      return combineDateAndTime(dateLabel, `${start.time} a ${end.time}`) || emptyPlaceholder;
    }
    if (showStartTime && start.time) return combineDateAndTime(dateLabel, start.time) || emptyPlaceholder;
    if (showEndTime && end.time) return combineDateAndTime(dateLabel, end.time) || emptyPlaceholder;
    return dateLabel || emptyPlaceholder;
  }

  const startLabel = formatPointLabel(start, showStartTime);
  const endLabel = formatPointLabel(end, showEndTime);
  if (startLabel && endLabel) return `empieza: ${startLabel}\ntermina: ${endLabel}`;
  return startLabel || endLabel || invalidPlaceholder || String(value);
}

export function formatDateOnlyDisplay(value?: string | null): string {
  return formatDateDisplay(value, { allowTime: false });
}

export function formatDate(value?: string | null): string {
  return formatDateDisplay(value);
}

export function formatDateTime(value?: string | null): string {
  return formatDateDisplay(value);
}

export function toDateInputValue(value?: string | null): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function toDateTimeLocalValue(value?: string | null): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    return value.slice(0, 16);
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)) {
    return value.replace(" ", "T").slice(0, 16);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

export function scoreToStars(score?: number | null, settings?: Settings): string {
  if (score === null || score === undefined || !settings) return "-";
  const min = settings.score_scale.min;
  const max = settings.score_scale.max;
  if (max === min) return "-";
  const normalized = ((score - min) / (max - min)) * 5;
  const stars = Math.max(0, Math.min(5, Math.round(normalized)));
  return "★".repeat(stars) + "☆".repeat(5 - stars);
}

export function followupStatus(value?: string | null): "overdue" | "soon" | "ok" | "none" {
  if (!value) return "none";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "none";
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = date.getTime() - startOfToday.getTime();
  const days = diff / (1000 * 60 * 60 * 24);
  if (days < 0) return "overdue";
  if (days <= 3) return "soon";
  return "ok";
}

export function successRate(applications: Application[]): string {
  if (!applications.length) return "0.0%";
  const offers = applications.filter((app) => app.outcome === "Offer").length;
  return `${((offers / applications.length) * 100).toFixed(1)}%`;
}

export function averageOfferScore(applications: Application[]): number | null {
  const offers = applications.filter((app) => app.outcome === "Offer");
  if (!offers.length) return null;
  const scores = offers
    .map((app) => app.my_interview_score)
    .filter((score): score is number => score !== null && score !== undefined);
  if (!scores.length) return null;
  return scores.reduce((acc, score) => acc + score, 0) / scores.length;
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function parseLocalDateOnly(value?: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) {
    const [, year, month, day] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseDocumentLinks(raw?: string | null): DocumentLink[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n|,|;+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (/^https?:\/\//i.test(part)) {
        try {
          const url = new URL(part);
          const last = url.pathname.split("/").filter(Boolean).pop();
          return {
            href: part,
            label: last ? decodeURIComponent(last) : url.hostname
          };
        } catch {
          return { href: part, label: part };
        }
      }
      return { label: part };
    });
}

export function formatFileSize(bytes?: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatUploadedAt(value?: string | null): string {
  return formatDateDisplay(value);
}

const pad2 = (value: number) => String(value).padStart(2, "0");

export function formatIcsDate(date: Date): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
}

export function formatIcsDateTime(date: Date): string {
  return `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}T${pad2(
    date.getHours()
  )}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
}

export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}
