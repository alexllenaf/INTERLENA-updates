/**
 * Shared data-normalisation helpers.
 *
 * These pure functions were previously copy-pasted across 4-10 block/page
 * files.  By centralising them here every consumer stays consistent and changes
 * only need to happen once.
 */

import { type CustomProperty } from "../types";
import { type EditableTableColumnKind } from "../components/pageBuilder/types";

/* ---------- type guards ---------- */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/* ---------- string helpers ---------- */

export const normalizeString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeString(item))
    .filter(Boolean);
};

/* ---------- custom-property helpers ---------- */

export const normalizeCustomProperties = (value: unknown): CustomProperty[] => {
  if (!Array.isArray(value)) return [];
  const out: CustomProperty[] = [];
  value.forEach((entry) => {
    if (!isRecord(entry)) return;
    const key = normalizeString(entry.key);
    if (!key) return;
    const name = normalizeString(entry.name);
    const typeRaw = normalizeString(entry.type);
    const type =
      typeRaw === "select" ||
      typeRaw === "text" ||
      typeRaw === "number" ||
      typeRaw === "date" ||
      typeRaw === "checkbox" ||
      typeRaw === "rating" ||
      typeRaw === "contacts" ||
      typeRaw === "links" ||
      typeRaw === "documents"
        ? typeRaw
        : "text";
    out.push({
      key,
      name: name || key,
      type,
      options: []
    });
  });
  return out;
};

export const customPropertyKind = (prop: CustomProperty | null): EditableTableColumnKind => {
  if (!prop) return "text";
  if (prop.type === "number") return "number";
  if (prop.type === "date") return "date";
  if (prop.type === "checkbox") return "checkbox";
  if (prop.type === "rating") return "rating";
  if (prop.type === "contacts") return "contacts";
  if (prop.type === "links") return "links";
  if (prop.type === "documents") return "documents";
  if (prop.type === "select") return "select";
  return "text";
};
