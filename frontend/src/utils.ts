import { Application, Settings } from "./types";

export type DocumentLink = {
  label: string;
  href?: string;
};

export function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
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
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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
