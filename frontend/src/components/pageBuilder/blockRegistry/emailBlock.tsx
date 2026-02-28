import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BlockPanel from "../../BlockPanel";
import RichTextEditor from "../../RichTextEditor";
import MergeTagPicker, { buildMergeTagsFromContacts } from "../../MergeTagPicker";
import {
  ApiError,
  getEmailBody,
  getEmailReadStats,
  listEmailMetadata,
  disconnectSingleGoogleAccount,
  getGoogleOAuthStartUrl,
  getEmailSendStats,
  listGoogleAccounts,
  selectGoogleAccount,
  sendEmailBatch,
} from "../../../api";
import {
  READ_MAILBOX_ALL,
  READ_MAILBOX_INBOX,
  READ_MAILBOX_SENT,
  buildEmailAccountOptions,
  formatMailboxLabel,
  isInboxMailbox,
  isSentMailbox,
  normalizeMailboxName,
  resolveEmailMetadataFolderParam
} from "../../../features/email/readFilters";
import {
  buildEmailContactsFromApplications,
  buildSelectedEmailReadContacts
} from "../../../features/email/trackerContacts";
import { buildHighlightChunks } from "../../../features/tracker/highlight";
import { confirmDialog } from "../../../shared/confirmDialog";
import {
  type EmailMetadata,
  type EmailReadStats,
  type EmailSendBatchResult,
  type EmailSendContact,
  type EmailSendStats,
  type GoogleAccount,
  type Settings,
} from "../../../types";
import { useAppData } from "../../../state";
import { formatDateDisplay } from "../../../utils";
import { createSlotContext, renderHeader } from "./shared";
import { type BlockDefinition } from "./types";

const parseCustomFields = (value: string): Record<string, string> => {
  const result: Record<string, string> = {};
  const chunks = value
    .split(/[;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  chunks.forEach((chunk) => {
    const separator = chunk.indexOf("=");
    if (separator <= 0) return;
    const key = chunk.slice(0, separator).trim();
    const fieldValue = chunk.slice(separator + 1).trim();
    if (!key) return;
    result[key] = fieldValue;
  });
  return result;
};

const stringifyCustomFields = (value: Record<string, string> | undefined): string => {
  if (!value) return "";
  return Object.entries(value)
    .map(([key, fieldValue]) => `${key}=${fieldValue}`)
    .join("; ");
};

const renderTemplate = (template: string, values: Record<string, string>) =>
  template.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_, rawKey: string) => {
    const key = String(rawKey || "");
    return values[key] ?? values[key.toLowerCase()] ?? "";
  });

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(" ");

const isWorkflowToggleEnabled = (value: unknown, fallback = true) =>
  typeof value === "boolean" ? value : fallback;

type LinkPreviewItem = {
  label: string;
  url: string;
};

const tryParseJsonValue = (raw: string): unknown | null => {
  const value = String(raw || "").trim();
  if (!value || (value[0] !== "{" && value[0] !== "[")) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const extractLinkPreviewItems = (raw: string): LinkPreviewItem[] => {
  const parsed = tryParseJsonValue(raw);
  if (!parsed) return [];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const url = String(item.url || "").trim();
      if (!url) return null;
      const label = String(item.label || item.name || item.id || url).trim();
      return { label, url };
    })
    .filter((item): item is LinkPreviewItem => Boolean(item));
};

const toReadableFieldValue = (raw: string): string => {
  const parsed = tryParseJsonValue(raw);
  if (!parsed) return formatDateDisplay(raw);
  try {
    return JSON.stringify(parsed, null, 2);
  } catch {
    return formatDateDisplay(raw);
  }
};

const renderHighlightedText = (text: string, query: string) => {
  const value = text || "—";
  if (!query.trim()) return value;
  const chunks = buildHighlightChunks(value, query);
  const hasMatch = chunks.some((chunk) => chunk.match);
  if (!hasMatch) return value;
  return (
    <>
      {chunks.map((chunk, index) =>
        chunk.match ? (
          <mark key={`${chunk.text}-${index}`}>{chunk.text}</mark>
        ) : (
          <span key={`${chunk.text}-${index}`}>{chunk.text}</span>
        )
      )}
    </>
  );
};

const StepHeader: React.FC<{
  label?: string;
  active?: boolean;
  done?: boolean;
  blocked?: boolean;
  inlineContent?: React.ReactNode;
  rightContent?: React.ReactNode;
  className?: string;
}> = ({
  label,
  active = false,
  done = false,
  blocked = false,
  inlineContent,
  rightContent,
  className,
}) => (
  <div
    className={cx(
      "email-send-step-header",
      className,
      active && "is-active",
      done && "is-done",
      (Boolean(inlineContent) || Boolean(rightContent)) && "has-inline"
    )}
  >
    {label ? <span className="email-send-step-label">{label}</span> : null}
    {inlineContent ? <div className="email-send-step-inline email-send-step-inline-left">{inlineContent}</div> : null}
    {rightContent ? <div className="email-send-step-inline-right">{rightContent}</div> : null}
  </div>
);

const StatusPill: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
  <span className={cx("email-send-status-pill", ok ? "is-ok" : "is-warn")}>
    <span className="email-send-status-pill-dot">{ok ? "●" : "○"}</span>
    {label}
  </span>
);

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 019.5 24c0-1.59.28-3.13.76-4.59l-7.98-6.19A23.99 23.99 0 000 24c0 3.77.9 7.35 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

const MetricTodayIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M3.75 3a.75.75 0 0 0-.75.75v12.5c0 .41.34.75.75.75h12.5a.75.75 0 0 0 .75-.75V3.75A.75.75 0 0 0 16.25 3H3.75Zm.75 12.5V4.5h11v11h-11Zm1.75-2.25a.75.75 0 0 1 0-1.5h1.8a.75.75 0 0 1 0 1.5h-1.8Zm3.35 0a.75.75 0 0 1 0-1.5h4.2a.75.75 0 0 1 0 1.5h-4.2Zm-3.35-3.5a.75.75 0 0 1 0-1.5h7.55a.75.75 0 0 1 0 1.5H6.25Z" />
  </svg>
);

const MetricRemainingIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M2.75 5.25A2.25 2.25 0 0 1 5 3h10a2.25 2.25 0 0 1 2.25 2.25v9.5A2.25 2.25 0 0 1 15 17H5a2.25 2.25 0 0 1-2.25-2.25v-9.5ZM5 4.5a.75.75 0 0 0-.75.75v.4l5.75 3.55 5.75-3.55v-.4a.75.75 0 0 0-.75-.75H5Zm10.75 2.9-5.36 3.3a.75.75 0 0 1-.78 0l-5.36-3.3v7.35c0 .41.34.75.75.75h10c.41 0 .75-.34.75-.75V7.4Z" />
  </svg>
);

const MetricUsageIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M10 2.75a7.25 7.25 0 1 0 7.25 7.25.75.75 0 0 0-1.5 0A5.75 5.75 0 1 1 10 4.25a.75.75 0 0 0 0-1.5Z" />
    <path d="M10 3.5a.75.75 0 0 1 .75-.75A7.26 7.26 0 0 1 17.25 9a.75.75 0 0 1-1.5 0 5.76 5.76 0 0 0-5-4.75A.75.75 0 0 1 10 3.5Z" />
  </svg>
);

const PreviewEyeIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M10 4.5c4.44 0 7.74 2.9 8.95 5.5-1.2 2.6-4.5 5.5-8.95 5.5S2.26 12.6 1.05 10C2.26 7.4 5.56 4.5 10 4.5Zm0 1.5c-3.38 0-6.03 2.06-7.29 4 1.26 1.94 3.91 4 7.29 4s6.03-2.06 7.29-4c-1.26-1.94-3.91-4-7.29-4Zm0 1.75A2.25 2.25 0 1 1 7.75 10 2.25 2.25 0 0 1 10 7.75Zm0 1.5A.75.75 0 1 0 10.75 10 .75.75 0 0 0 10 9.25Z" />
  </svg>
);

const SendProgressIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="10" cy="10" r="7" className="email-send-send-spinner-track" />
    <path d="M17 10a7 7 0 0 0-7-7" className="email-send-send-spinner-head" />
  </svg>
);

const SendPlaneIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M17.7 2.28a.75.75 0 0 1 .02 1.03L8.9 12.38a.75.75 0 0 1-.36.21l-3.6.9a.75.75 0 0 1-.91-.9l.9-3.6a.75.75 0 0 1 .2-.36l9.08-8.82a.75.75 0 0 1 1.03.02l2.46 2.45Zm-3.03-1.41L6.3 9.01l-.58 2.31 2.31-.58 8.16-8.37-1.52-1.5Zm-3.12 10.76a.75.75 0 0 1 1.04-.09l3.5 2.8a.75.75 0 0 1-.94 1.18l-3.5-2.8a.75.75 0 0 1-.1-1.05Z" />
  </svg>
);

const AttachmentPhotoIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M3.75 3A1.75 1.75 0 0 0 2 4.75v10.5C2 16.22 2.78 17 3.75 17h12.5c.97 0 1.75-.78 1.75-1.75V4.75C18 3.78 17.22 3 16.25 3H3.75Zm-.25 12.25v-1.66l3.12-3.11a.75.75 0 0 1 1.06 0l1.56 1.56 3.47-3.47a.75.75 0 0 1 1.06 0l2.73 2.73v3.95a.25.25 0 0 1-.25.25H3.75a.25.25 0 0 1-.25-.25Zm9.12-7a1.62 1.62 0 1 0 0-3.24 1.62 1.62 0 0 0 0 3.24Z" />
  </svg>
);

const AttachmentDocumentIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M5 2.75A1.75 1.75 0 0 0 3.25 4.5v11A1.75 1.75 0 0 0 5 17.25h10A1.75 1.75 0 0 0 16.75 15.5V7.19a1.75 1.75 0 0 0-.5-1.23l-2.72-2.71a1.75 1.75 0 0 0-1.23-.5H5Zm0 1.5h6.75v2.5c0 .97.78 1.75 1.75 1.75h1.75v7a.25.25 0 0 1-.25.25H5a.25.25 0 0 1-.25-.25v-11c0-.14.11-.25.25-.25Zm1.5 7.25a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1-.75-.75Zm0 2.5a.75.75 0 0 1 .75-.75h3.75a.75.75 0 0 1 0 1.5H7.25a.75.75 0 0 1-.75-.75Z" />
  </svg>
);

const PanelChevronIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M11.78 4.22a.75.75 0 0 1 0 1.06L7.06 10l4.72 4.72a.75.75 0 1 1-1.06 1.06L5.47 10.53a.75.75 0 0 1 0-1.06l5.25-5.25a.75.75 0 0 1 1.06 0Z" />
  </svg>
);

type EmailComposerAttachmentKind = "image" | "document";

type EmailComposerAttachment = {
  id: string;
  kind: EmailComposerAttachmentKind;
  file: File;
  dataBase64: string;
  sendDataBase64: string;
  sendContentType?: string;
  sendSizeBytes: number;
  renderWidth?: number;
  naturalWidth?: number;
  naturalHeight?: number;
};

type EmailStoredAttachment = {
  id: string;
  kind: EmailComposerAttachmentKind;
  filename: string;
  contentType?: string;
  size: number;
  lastModified: number;
  dataBase64: string;
  sendDataBase64?: string;
  sendContentType?: string;
  sendSizeBytes?: number;
  renderWidth?: number;
  naturalWidth?: number;
  naturalHeight?: number;
};

type EmailInlineAttachmentCatalogItem = {
  kind: EmailComposerAttachmentKind;
  filename: string;
  sizeBytes: number;
  previewUrl?: string;
  renderWidth?: number;
};

type EmailComposerLibraryEntry = {
  id: string;
  subjectTemplate: string;
  bodyTemplate: string;
  attachments: EmailStoredAttachment[];
  selectedRecipients?: Record<string, boolean>;
  recipientCount: number;
  updatedAt: string;
};

type EmailReadMessage = EmailMetadata & {
  contactEmail: string;
  contactName: string;
  contactCompany: string;
};

type ReadContactSelection = {
  email: string;
  name: string;
  company: string;
};

type ReadSearchScope = "all" | "from" | "subject" | "attachment" | "message";
type ReadSearchHistoryEntry = {
  query: string;
  scope: ReadSearchScope;
};

const MAX_EMAIL_ATTACHMENTS = 10;
const MAX_EMAIL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_EMAIL_ATTACHMENT_SINGLE_BYTES = 10 * 1024 * 1024;
const MAX_EMAIL_LIBRARY_ENTRIES = 100;
const MAX_READ_SEARCH_HISTORY = 5;
const FULL_CONTENT_BODY_MARKER_REGEX = /<!--\s*email-read-mode:full\s*-->/gi;
const READ_START_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const READ_SEARCH_SCOPE_OPTIONS: Array<{ value: ReadSearchScope; label: string }> = [
  { value: "all", label: "Todo" },
  { value: "from", label: "Remitente" },
  { value: "subject", label: "Asunto" },
  { value: "attachment", label: "Adjunto" },
  { value: "message", label: "Mensaje" },
];

const isReadSearchScope = (value: unknown): value is ReadSearchScope =>
  value === "all" || value === "from" || value === "subject" || value === "attachment" || value === "message";

const normalizeReadStartDate = (value: unknown): string => {
  const raw = String(value || "").trim();
  return READ_START_DATE_PATTERN.test(raw) ? raw : "";
};

const getReadSearchScopeLabel = (scope: ReadSearchScope): string =>
  READ_SEARCH_SCOPE_OPTIONS.find((option) => option.value === scope)?.label || READ_SEARCH_SCOPE_OPTIONS[0].label;

const formatReadSearchHistoryEntry = (entry: ReadSearchHistoryEntry): string => {
  const query = String(entry.query || "").trim();
  if (!query) return "";
  if (entry.scope === "all") return query;
  return `${getReadSearchScopeLabel(entry.scope)}: ${query}`;
};
const INLINE_IMAGE_MIN_WIDTH = 120;
const INLINE_IMAGE_MAX_WIDTH = 960;
const INLINE_IMAGE_DEFAULT_WIDTH = 360;
const IMAGE_FILE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "heic",
  "heif",
  "tiff",
  "tif",
  "avif",
]);

const getFileExtension = (filename: string): string => {
  const value = String(filename || "").trim().toLowerCase();
  const dot = value.lastIndexOf(".");
  if (dot < 0 || dot === value.length - 1) return "";
  return value.slice(dot + 1);
};

const inferAttachmentKind = (
  preferredKind: EmailComposerAttachmentKind,
  filename: string,
  contentType: string | undefined
): EmailComposerAttachmentKind => {
  const mime = String(contentType || "").trim().toLowerCase();
  if (mime.startsWith("image/")) return "image";
  const ext = getFileExtension(filename);
  if (IMAGE_FILE_EXTENSIONS.has(ext)) return "image";
  return preferredKind;
};

const clampInlineImageWidth = (value: number): number => {
  return Math.max(INLINE_IMAGE_MIN_WIDTH, Math.min(INLINE_IMAGE_MAX_WIDTH, Math.round(value || INLINE_IMAGE_DEFAULT_WIDTH)));
};

const formatAttachmentBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
};

const formatReadLimitBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) return formatAttachmentBytes(bytes);
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
};

const formatUsagePercent = (value: number): string => {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `${safeValue.toFixed(safeValue >= 10 || Number.isInteger(safeValue) ? 0 : 1)}%`;
};

const base64ByteLength = (base64: string): number => {
  const value = String(base64 || "").trim();
  if (!value) return 0;
  const cleaned = value.replace(/\s+/g, "");
  const padding = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((cleaned.length * 3) / 4) - padding);
};

const extractAttachmentIdsFromHtml = (html: string): Set<string> => {
  const ids = new Set<string>();
  const value = String(html || "");
  const regex = /data-attachment-id=(?:"([^"]+)"|'([^']+)')/g;
  let match: RegExpExecArray | null = regex.exec(value);
  while (match) {
    const id = String(match[1] || match[2] || "").trim();
    if (id) ids.add(id);
    match = regex.exec(value);
  }
  return ids;
};

const buildDataUrl = (contentType: string | undefined, dataBase64: string): string => {
  const type = String(contentType || "").trim() || "application/octet-stream";
  return `data:${type};base64,${dataBase64}`;
};

const readImageNaturalSize = async (dataBase64: string, contentType: string | undefined): Promise<{ width: number; height: number }> => {
  if (typeof Image === "undefined") return { width: 0, height: 0 };
  const src = buildDataUrl(contentType, dataBase64);
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth || image.width || 0, height: image.naturalHeight || image.height || 0 });
    };
    image.onerror = () => reject(new Error("No se pudo leer la imagen."));
    image.src = src;
  });
};

const resizeImageBase64ToWidth = async (
  dataBase64: string,
  contentType: string | undefined,
  targetWidth: number
): Promise<{ dataBase64: string; contentType: string; sizeBytes: number; width: number; height: number }> => {
  if (typeof document === "undefined" || typeof Image === "undefined") {
    return {
      dataBase64,
      contentType: String(contentType || "").trim() || "image/jpeg",
      sizeBytes: base64ByteLength(dataBase64),
      width: clampInlineImageWidth(targetWidth),
      height: 0,
    };
  }

  const natural = await readImageNaturalSize(dataBase64, contentType);
  const width = Math.max(1, Math.min(clampInlineImageWidth(targetWidth), natural.width || clampInlineImageWidth(targetWidth)));
  const height = Math.max(1, Math.round(((natural.height || width) * width) / Math.max(1, natural.width || width)));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return {
      dataBase64,
      contentType: String(contentType || "").trim() || "image/jpeg",
      sizeBytes: base64ByteLength(dataBase64),
      width,
      height,
    };
  }

  const image = new Image();
  const source = buildDataUrl(contentType, dataBase64);
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("No se pudo renderizar la imagen."));
    image.src = source;
  });
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  const outputType = String(contentType || "").startsWith("image/") ? String(contentType) : "image/jpeg";
  const withQuality = outputType === "image/jpeg" || outputType === "image/webp";
  const resizedDataUrl = withQuality ? canvas.toDataURL(outputType, 0.88) : canvas.toDataURL(outputType);
  const comma = resizedDataUrl.indexOf(",");
  const resizedBase64 = comma >= 0 ? resizedDataUrl.slice(comma + 1) : dataBase64;
  return {
    dataBase64: resizedBase64,
    contentType: outputType,
    sizeBytes: base64ByteLength(resizedBase64),
    width,
    height,
  };
};

const formatLibraryTimestamp = (value: string): string => {
  return formatDateDisplay(value, { invalidPlaceholder: "Fecha desconocida" });
};

const htmlToPreviewText = (html: string): string => {
  const source = String(html || "").trim();
  if (!source) return "";
  if (typeof document !== "undefined") {
    const element = document.createElement("div");
    element.innerHTML = source;
    const text = (element.textContent || element.innerText || "").replace(/\s+/g, " ").trim();
    return text;
  }
  return source.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
};

const looksLikeHtml = (value: string): boolean => /<\/?[a-z][\s\S]*>/i.test(String(value || ""));

const escapeHtml = (value: string): string =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const sanitizeEmailHtml = (value: string): string => {
  const source = String(value || "");
  if (!source.trim() || typeof document === "undefined") return source;

  const template = document.createElement("template");
  template.innerHTML = source;
  template.content.querySelectorAll("script, iframe, object, embed, form, input, button, textarea, select, link, meta, base").forEach((node) => {
    node.remove();
  });
  template.content.querySelectorAll("*").forEach((node) => {
    Array.from(node.attributes).forEach((attribute) => {
      const attrName = attribute.name.toLowerCase();
      const attrValue = String(attribute.value || "").trim();
      if (attrName.startsWith("on")) {
        node.removeAttribute(attribute.name);
        return;
      }
      if ((attrName === "href" || attrName === "src" || attrName === "xlink:href") && /^javascript:/i.test(attrValue)) {
        node.removeAttribute(attribute.name);
      }
    });
  });
  return template.innerHTML.trim();
};

const toEmailBodyHtml = (value: string): string => {
  const source = String(value || "").replace(FULL_CONTENT_BODY_MARKER_REGEX, "").trim();
  if (!source) return "<p class=\"email-send-read-body-empty\">Sin contenido.</p>";
  if (looksLikeHtml(source)) {
    const sanitized = sanitizeEmailHtml(source);
    return sanitized || "<p class=\"email-send-read-body-empty\">Sin contenido.</p>";
  }
  return `<pre class="email-send-read-body-pre">${escapeHtml(source)}</pre>`;
};

const formatMessageTimestamp = (value: string): string => {
  return formatDateDisplay(value, { invalidPlaceholder: "Fecha desconocida" });
};

const extractAttachmentNamesFromBody = (body: string): string[] => {
  const source = String(body || "");
  if (!source.trim()) return [];
  const names = new Set<string>();
  if (typeof document !== "undefined") {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = source;
    wrapper.querySelectorAll<HTMLElement>("[data-filename]").forEach((node) => {
      const filename = String(node.getAttribute("data-filename") || "").trim();
      if (filename) names.add(filename);
    });
  }
  const filenameRegex =
    /\b[A-Za-z0-9][A-Za-z0-9 _().,\-]{0,140}\.(?:pdf|docx?|xlsx?|pptx?|csv|txt|zip|rar|7z|png|jpe?g|gif|webp|bmp|svg|heic|tiff?|odt|rtf)\b/gi;
  let match: RegExpExecArray | null = filenameRegex.exec(source);
  while (match) {
    const value = String(match[0] || "").trim();
    if (value) names.add(value);
    match = filenameRegex.exec(source);
  }
  return Array.from(names);
};

const INLINE_ATTACHMENT_DOCUMENT_ICON_PATH =
  "M5 2.75A1.75 1.75 0 0 0 3.25 4.5v11A1.75 1.75 0 0 0 5 17.25h10A1.75 1.75 0 0 0 16.75 15.5V7.19a1.75 1.75 0 0 0-.5-1.23l-2.72-2.71a1.75 1.75 0 0 0-1.23-.5H5Zm0 1.5h6.75v2.5c0 .97.78 1.75 1.75 1.75h1.75v7a.25.25 0 0 1-.25.25H5a.25.25 0 0 1-.25-.25v-11c0-.14.11-.25.25-.25Zm1.5 7.25a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1-.75-.75Zm0 2.5a.75.75 0 0 1 .75-.75h3.75a.75.75 0 0 1 0 1.5H7.25a.75.75 0 0 1-.75-.75Z";

const renderPreviewBodyWithInlineAttachments = (
  html: string,
  attachmentCatalog: Record<string, EmailInlineAttachmentCatalogItem>
): string => {
  const source = String(html || "");
  if (!source.trim() || typeof document === "undefined") return source;

  const wrapper = document.createElement("div");
  wrapper.innerHTML = source;
  const inlineAttachments = wrapper.querySelectorAll<HTMLElement>("[data-email-attachment='true']");
  if (!inlineAttachments.length) return source;

  inlineAttachments.forEach((node) => {
    const attachmentId = String(node.getAttribute("data-attachment-id") || "").trim();
    const catalogItem = attachmentId ? attachmentCatalog[attachmentId] : undefined;
    const kindSource = String(catalogItem?.kind || node.getAttribute("data-kind") || "").trim().toLowerCase();
    const kind: EmailComposerAttachmentKind = kindSource === "image" ? "image" : "document";
    const filename = String(catalogItem?.filename || node.getAttribute("data-filename") || "Documento").trim() || "Documento";
    const sizeBytes = Number(catalogItem?.sizeBytes ?? Number(node.getAttribute("data-size-bytes") || 0)) || 0;
    const renderWidth = clampInlineImageWidth(
      Number(catalogItem?.renderWidth ?? Number(node.getAttribute("data-render-width") || INLINE_IMAGE_DEFAULT_WIDTH))
    );
    const previewUrl = kind === "image" ? String(catalogItem?.previewUrl || "").trim() : "";

    node.className = "email-inline-attachment";
    node.setAttribute("data-email-attachment", "true");
    node.setAttribute("data-kind", kind);
    node.setAttribute("data-filename", filename);
    node.setAttribute("data-size-bytes", String(sizeBytes));
    node.setAttribute("data-render-width", String(renderWidth));
    if (attachmentId) {
      node.setAttribute("data-attachment-id", attachmentId);
    }
    node.style.setProperty("--email-attachment-render-width", `${renderWidth}px`);
    node.replaceChildren();

    if (kind === "image") {
      const imageWrap = document.createElement("span");
      imageWrap.className = "email-inline-attachment-image-wrap";
      if (previewUrl) {
        const image = document.createElement("img");
        image.className = "email-inline-attachment-image";
        image.src = previewUrl;
        image.alt = filename;
        image.draggable = false;
        imageWrap.appendChild(image);
      } else {
        const fallback = document.createElement("span");
        fallback.className = "email-inline-attachment-image-fallback";
        fallback.textContent = "Imagen";
        imageWrap.appendChild(fallback);
      }

      const meta = document.createElement("span");
      meta.className = "email-inline-attachment-meta email-inline-attachment-meta-image";
      const name = document.createElement("span");
      name.className = "email-inline-attachment-name";
      name.title = filename;
      name.textContent = filename;
      const size = document.createElement("span");
      size.className = "email-inline-attachment-size";
      size.textContent = formatAttachmentBytes(sizeBytes);
      meta.append(name, size);
      imageWrap.appendChild(meta);
      node.appendChild(imageWrap);
      return;
    }

    const fileWrap = document.createElement("span");
    fileWrap.className = "email-inline-attachment-file-wrap";
    const iconWrap = document.createElement("span");
    iconWrap.className = "email-inline-attachment-icon-wrap";
    iconWrap.setAttribute("aria-hidden", "true");
    const iconSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    iconSvg.setAttribute("viewBox", "0 0 20 20");
    iconSvg.setAttribute("width", "20");
    iconSvg.setAttribute("height", "20");
    const iconPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    iconPath.setAttribute("d", INLINE_ATTACHMENT_DOCUMENT_ICON_PATH);
    iconPath.setAttribute("fill", "currentColor");
    iconSvg.appendChild(iconPath);
    iconWrap.appendChild(iconSvg);

    const meta = document.createElement("span");
    meta.className = "email-inline-attachment-meta";
    const name = document.createElement("span");
    name.className = "email-inline-attachment-name";
    name.title = filename;
    name.textContent = filename;
    const size = document.createElement("span");
    size.className = "email-inline-attachment-size";
    size.textContent = formatAttachmentBytes(sizeBytes);
    meta.append(name, size);

    fileWrap.append(iconWrap, meta);
    node.appendChild(fileWrap);
  });

  return wrapper.innerHTML;
};

const fileSignature = (file: File) => `${file.name}::${file.size}::${file.lastModified}`;

const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const value = String(base64 || "").trim();
  if (!value) return new ArrayBuffer(0);
  const raw = atob(value);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let idx = 0; idx < raw.length; idx += 1) {
    bytes[idx] = raw.charCodeAt(idx);
  }
  return buffer;
};

const normalizeStoredAttachment = (input: unknown): EmailStoredAttachment | null => {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  const id = String(row.id || "").trim();
  const filename = String(row.filename || "").trim();
  const contentType = String(row.contentType || "").trim() || undefined;
  const sendContentType = String(row.sendContentType || "").trim() || undefined;
  const rawKind = row.kind === "image" ? "image" : row.kind === "document" ? "document" : null;
  const inferredKind = inferAttachmentKind("document", filename, contentType || sendContentType);
  const kind: EmailComposerAttachmentKind = rawKind === "image" || rawKind === "document"
    ? rawKind === "document" && inferredKind === "image"
      ? "image"
      : rawKind
    : inferredKind;
  const dataBase64 = String(row.dataBase64 || "").trim();
  if (!id || !filename || !dataBase64) return null;
  return {
    id,
    kind,
    filename,
    contentType,
    size: Number(row.size || 0) || 0,
    lastModified: Number(row.lastModified || 0) || Date.now(),
    dataBase64,
    sendDataBase64: String(row.sendDataBase64 || "").trim() || undefined,
    sendContentType,
    sendSizeBytes: Number(row.sendSizeBytes || 0) || undefined,
    renderWidth: Number(row.renderWidth || 0) || undefined,
    naturalWidth: Number(row.naturalWidth || 0) || undefined,
    naturalHeight: Number(row.naturalHeight || 0) || undefined,
  };
};

const deserializeStoredAttachment = (stored: EmailStoredAttachment): EmailComposerAttachment | null => {
  try {
    const file = new File([base64ToArrayBuffer(stored.dataBase64)], stored.filename, {
      type: stored.contentType || "application/octet-stream",
      lastModified: stored.lastModified || Date.now(),
    });
    return {
      id: stored.id,
      kind: stored.kind,
      file,
      dataBase64: stored.dataBase64,
      sendDataBase64: stored.sendDataBase64 || stored.dataBase64,
      sendContentType: stored.sendContentType || stored.contentType || file.type || undefined,
      sendSizeBytes: Number(stored.sendSizeBytes || 0) || Number(stored.size || 0) || base64ByteLength(stored.sendDataBase64 || stored.dataBase64),
      renderWidth: Number(stored.renderWidth || 0) || undefined,
      naturalWidth: Number(stored.naturalWidth || 0) || undefined,
      naturalHeight: Number(stored.naturalHeight || 0) || undefined,
    };
  } catch {
    return null;
  }
};

const serializeAttachment = (item: EmailComposerAttachment): EmailStoredAttachment => {
  return {
    id: item.id,
    kind: item.kind,
    filename: item.file.name,
    contentType: item.file.type || undefined,
    size: item.file.size,
    lastModified: item.file.lastModified,
    dataBase64: item.dataBase64,
    sendDataBase64: item.sendDataBase64,
    sendContentType: item.sendContentType,
    sendSizeBytes: item.sendSizeBytes,
    renderWidth: item.renderWidth,
    naturalWidth: item.naturalWidth,
    naturalHeight: item.naturalHeight,
  };
};

const normalizeLibraryEntry = (input: unknown, includeSelection: boolean): EmailComposerLibraryEntry | null => {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  const id = String(row.id || "").trim();
  if (!id) return null;
  const subjectTemplate = String(row.subjectTemplate || "");
  const bodyTemplate = String(row.bodyTemplate || "");
  const attachments = Array.isArray(row.attachments)
    ? row.attachments
        .map(normalizeStoredAttachment)
        .filter((item): item is EmailStoredAttachment => Boolean(item))
    : [];
  const recipientCount = Number(row.recipientCount || 0) || 0;
  const updatedAt = String(row.updatedAt || "").trim() || new Date().toISOString();
  const selectedRecipients: Record<string, boolean> | undefined =
    includeSelection && row.selectedRecipients && typeof row.selectedRecipients === "object"
      ? Object.fromEntries(
          Object.entries(row.selectedRecipients as Record<string, unknown>).map(([key, value]) => [
            key,
            Boolean(value),
          ])
        )
      : undefined;
  return {
    id,
    subjectTemplate,
    bodyTemplate,
    attachments,
    selectedRecipients,
    recipientCount,
    updatedAt,
  };
};

const normalizeLibraryEntries = (value: unknown, includeSelection: boolean): EmailComposerLibraryEntry[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeLibraryEntry(item, includeSelection))
    .filter((item): item is EmailComposerLibraryEntry => Boolean(item));
};

const normalizeReadSearchHistory = (value: unknown): ReadSearchHistoryEntry[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const next: ReadSearchHistoryEntry[] = [];
  value.forEach((item) => {
    const query =
      typeof item === "string"
        ? item
        : item && typeof item === "object"
          ? String((item as { query?: unknown }).query || "")
          : "";
    const normalizedQuery = String(query || "").trim();
    const rawScope = item && typeof item === "object" ? (item as { scope?: unknown }).scope : "all";
    const scope: ReadSearchScope = isReadSearchScope(rawScope) ? rawScope : "all";
    const key = `${scope}::${normalizedQuery.toLowerCase()}`;
    if (!normalizedQuery || seen.has(key)) return;
    seen.add(key);
    next.push({ query: normalizedQuery, scope });
  });
  return next.slice(0, MAX_READ_SEARCH_HISTORY);
};

const readFileAsBase64 = async (file: File): Promise<string> => {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      const commaIndex = value.indexOf(",");
      resolve(commaIndex >= 0 ? value.slice(commaIndex + 1) : value);
    };
    reader.onerror = () => reject(reader.error || new Error(`No se pudo leer ${file.name}`));
    reader.readAsDataURL(file);
  });
};

const Divider: React.FC = () => <hr className="email-send-divider" />;

export const EMAIL_BLOCK_DEFINITION: BlockDefinition<"email"> = {
  type: "email",
  defaultLayout: { colSpan: 60 },
  createDefaultProps: () => ({
    title: "Correo",
    description: "Bandeja sincronizada por metadatos y cuerpo bajo demanda.",
    contactId: "",
    readEnabled: true,
    sendEnabled: true,
    folder: READ_MAILBOX_ALL,
    cacheSize: 50,
    readStartDate: "",
    readLoadFullContent: false,
    readAccountFilter: READ_MAILBOX_ALL,
    readSearchHistory: [],
    sendSubjectTemplate: "Hola {{Nombre}}, seguimiento de candidatura en {{Empresa}}",
    sendBodyTemplate:
      "Hola {{Nombre}},\n\nTe escribo para dar seguimiento al proceso con {{Empresa}}.\n\nGracias por tu tiempo.",
    sendContactLimit: 500
  }),
  component: ({ block, mode, patchBlockProps, updateBlockProps, resolveSlot, menuActions }) => {
    const { settings, saveSettings, applications } = useAppData();
    const slotContext = createSlotContext(mode, updateBlockProps, patchBlockProps);
    const slot = block.props.contentSlotId ? resolveSlot?.(block.props.contentSlotId, block, slotContext) : null;
    const isReadModeEnabled = isWorkflowToggleEnabled(block.props.readEnabled, true);
    const isSendModeEnabled = isWorkflowToggleEnabled(block.props.sendEnabled, true);
    const hasAnyWorkflowEnabled = isReadModeEnabled || isSendModeEnabled;

    const initialStoredAttachments = (block.props.sendDraftAttachments || [])
      .map(normalizeStoredAttachment)
      .filter((item): item is EmailStoredAttachment => Boolean(item));
    const initialAttachments = initialStoredAttachments
      .map(deserializeStoredAttachment)
      .filter((item): item is EmailComposerAttachment => Boolean(item));

    const [selectedRecipients, setSelectedRecipients] = useState<Record<string, boolean>>(
      () => block.props.sendSelectedRecipients || {}
    );
    const [sending, setSending] = useState(false);
    const [oauthStarting, setOauthStarting] = useState(false);
    const [isRecipientPanelCollapsed, setIsRecipientPanelCollapsed] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);
    const [sendMessage, setSendMessage] = useState<string | null>(null);
    const [sendStats, setSendStats] = useState<EmailSendStats | null>(null);
    const [readStats, setReadStats] = useState<EmailReadStats | null>(null);
    const [sendResult, setSendResult] = useState<EmailSendBatchResult | null>(null);
    const [googleAccounts, setGoogleAccounts] = useState<GoogleAccount[]>([]);
    const [acctDropdownOpen, setAcctDropdownOpen] = useState(false);
    const [activeRecipientEmail, setActiveRecipientEmail] = useState<string | null>(null);
    const [recipientQuery, setRecipientQuery] = useState("");
    const [attachments, setAttachments] = useState<EmailComposerAttachment[]>(() => initialAttachments);
    const [draftEntries, setDraftEntries] = useState<EmailComposerLibraryEntry[]>(
      () => normalizeLibraryEntries(block.props.sendDraftEntries, true)
    );
    const [sentEntries, setSentEntries] = useState<EmailComposerLibraryEntry[]>(
      () => normalizeLibraryEntries(block.props.sendSentEntries, false)
    );
    const [libraryOpen, setLibraryOpen] = useState(false);
    const [libraryTab, setLibraryTab] = useState<"drafts" | "sent">("drafts");
    const [activeDraftEntryId, setActiveDraftEntryId] = useState<string | null>(null);
    const [libraryEditingEntryId, setLibraryEditingEntryId] = useState<string | null>(null);
    const [libraryEditSubject, setLibraryEditSubject] = useState("");
    const [libraryEditBody, setLibraryEditBody] = useState("");
    const [editorWindowOpen, setEditorWindowOpen] = useState(false);
    const [readBodyWindowOpen, setReadBodyWindowOpen] = useState(false);
    const [workflowTab, setWorkflowTab] = useState<"read" | "send">(
      () => (isWorkflowToggleEnabled(block.props.readEnabled, true) ? "read" : "send")
    );
    const [isConfigOpen, setIsConfigOpen] = useState(false);
    const [configError, setConfigError] = useState<string | null>(null);
    const [syncingGlobalRead, setSyncingGlobalRead] = useState(false);
    const [readMessages, setReadMessages] = useState<EmailReadMessage[]>([]);
    const [readMessagesLoading, setReadMessagesLoading] = useState(false);
    const [readMessagesRefreshing, setReadMessagesRefreshing] = useState(false);
    const [readMessagesError, setReadMessagesError] = useState<string | null>(null);
    const [activeReadMessageId, setActiveReadMessageId] = useState<string | null>(null);
    const [readBodyById, setReadBodyById] = useState<Record<string, string>>({});
    const [readBodyLoadingId, setReadBodyLoadingId] = useState<string | null>(null);
    const [readBodyPrefetching, setReadBodyPrefetching] = useState(false);
    const [readSearchQuery, setReadSearchQuery] = useState("");
    const [readSearchHistory, setReadSearchHistory] = useState<ReadSearchHistoryEntry[]>(
      () => normalizeReadSearchHistory(block.props.readSearchHistory)
    );
    const [readSearchHistoryOpen, setReadSearchHistoryOpen] = useState(false);
    const [readFiltersOpen, setReadFiltersOpen] = useState(false);
    const [readSearchScope, setReadSearchScope] = useState<ReadSearchScope>("all");
    const [readAccountFilter, setReadAccountFilter] = useState<string>(
      () => String(block.props.readAccountFilter || READ_MAILBOX_ALL)
    );

    const subjectInputRef = useRef<HTMLInputElement>(null);
    const acctDropdownRef = useRef<HTMLDivElement>(null);
    const readSearchRef = useRef<HTMLDivElement>(null);
    const photoInputRef = useRef<HTMLInputElement>(null);
    const documentInputRef = useRef<HTMLInputElement>(null);
    const bodyEditorRef = useRef<any>(null);
    const persistSelectedRef = useRef("");
    const persistAttachmentsRef = useRef("");
    const persistDraftEntriesRef = useRef("");
    const persistSentEntriesRef = useRef("");
    const persistReadSearchHistoryRef = useRef("");
    const suppressAttachmentBodySyncRef = useRef(0);
    const readBodyByIdRef = useRef<Record<string, string>>({});
    const [bodyEditorReadyToken, setBodyEditorReadyToken] = useState(0);
    const handleBodyEditorReady = React.useCallback((editor: any | null) => {
      bodyEditorRef.current = editor;
      if (editor) {
        setBodyEditorReadyToken((prev) => prev + 1);
      }
    }, []);

    const openPhotoPicker = React.useCallback(() => {
      const input = photoInputRef.current;
      if (!input) return;
      if (typeof input.showPicker === "function") {
        input.showPicker();
        return;
      }
      input.click();
    }, []);

    const contacts = useMemo(
      () =>
        buildEmailContactsFromApplications(
          applications,
          settings?.custom_properties,
          Math.max(1, Math.min(5000, block.props.sendContactLimit || 500))
        ),
      [applications, settings?.custom_properties, block.props.sendContactLimit]
    );

    const customFieldsDraft = useMemo(
      () =>
        contacts.reduce<Record<string, string>>((acc, row) => {
          if (row.email) acc[row.email] = stringifyCustomFields(row.custom_fields);
          return acc;
        }, {}),
      [contacts]
    );

    /* ── Available merge tags derived from loaded contacts ────────── */
    const mergeTags = useMemo(() => buildMergeTagsFromContacts(contacts), [contacts]);

    const refreshSendStats = React.useCallback(async () => {
      try {
        const stats = await getEmailSendStats();
        setSendStats(stats);
      } catch {
        setSendStats(null);
      }
      try {
        const accts = await listGoogleAccounts();
        setGoogleAccounts(accts);
      } catch {
        /* ignore */
      }
    }, []);

    const refreshReadStats = React.useCallback(async () => {
      try {
        const stats = await getEmailReadStats();
        setReadStats(stats);
      } catch {
        setReadStats(null);
      }
    }, []);

    useEffect(() => {
      void refreshSendStats();
    }, [refreshSendStats]);

    useEffect(() => {
      void refreshReadStats();
    }, [refreshReadStats]);

    useEffect(() => {
      readBodyByIdRef.current = readBodyById;
    }, [readBodyById]);

    useEffect(() => {
      setReadBodyById({});
      readBodyByIdRef.current = {};
      setReadBodyLoadingId(null);
    }, [block.props.readLoadFullContent]);

    /* Close account dropdown on outside click */
    useEffect(() => {
      const handler = (e: MouseEvent) => {
        if (acctDropdownRef.current && !acctDropdownRef.current.contains(e.target as Node)) {
          setAcctDropdownOpen(false);
        }
      };
      if (acctDropdownOpen) {
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
      }
    }, [acctDropdownOpen]);

    useEffect(() => {
      if (!readFiltersOpen && !readSearchHistoryOpen) return;
      const onClickOutside = (event: MouseEvent) => {
        if (!readSearchRef.current) return;
        if (event.target instanceof Node && !readSearchRef.current.contains(event.target)) {
          setReadFiltersOpen(false);
          setReadSearchHistoryOpen(false);
        }
      };
      const onEscape = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          setReadFiltersOpen(false);
          setReadSearchHistoryOpen(false);
        }
      };
      document.addEventListener("mousedown", onClickOutside);
      document.addEventListener("keydown", onEscape);
      return () => {
        document.removeEventListener("mousedown", onClickOutside);
        document.removeEventListener("keydown", onEscape);
      };
    }, [readFiltersOpen, readSearchHistoryOpen]);

    useEffect(() => {
      const selected = block.props.sendSelectedRecipients || {};
      const nextStoredAttachments = (block.props.sendDraftAttachments || [])
        .map(normalizeStoredAttachment)
        .filter((item): item is EmailStoredAttachment => Boolean(item));
      const nextAttachments = nextStoredAttachments
        .map(deserializeStoredAttachment)
        .filter((item): item is EmailComposerAttachment => Boolean(item));
      const nextDraftEntries = normalizeLibraryEntries(block.props.sendDraftEntries, true);
      const nextSentEntries = normalizeLibraryEntries(block.props.sendSentEntries, false);
      const nextReadSearchHistory = normalizeReadSearchHistory(block.props.readSearchHistory);

      setSelectedRecipients(selected);
      setAttachments(nextAttachments);
      setDraftEntries(nextDraftEntries);
      setSentEntries(nextSentEntries);
      setActiveDraftEntryId(null);
      setLibraryEditingEntryId(null);
      setLibraryEditSubject("");
      setLibraryEditBody("");
      setReadBodyWindowOpen(false);
      setWorkflowTab(isWorkflowToggleEnabled(block.props.readEnabled, true) ? "read" : "send");
      setIsConfigOpen(false);
      setConfigError(null);
      setSyncingGlobalRead(false);
      setReadMessages([]);
      setReadMessagesLoading(false);
      setReadMessagesError(null);
      setActiveReadMessageId(null);
      setReadBodyById({});
      readBodyByIdRef.current = {};
      setReadBodyLoadingId(null);
      setReadBodyPrefetching(false);
      setReadStats(null);
      setReadSearchQuery("");
      setReadSearchHistory(nextReadSearchHistory);
      setReadSearchHistoryOpen(false);
      setReadFiltersOpen(false);
      setReadSearchScope("all");
      setReadAccountFilter(String(block.props.readAccountFilter || READ_MAILBOX_ALL));

      persistSelectedRef.current = JSON.stringify(selected);
      persistAttachmentsRef.current = JSON.stringify(nextStoredAttachments);
      persistDraftEntriesRef.current = JSON.stringify(nextDraftEntries);
      persistSentEntriesRef.current = JSON.stringify(nextSentEntries);
      persistReadSearchHistoryRef.current = JSON.stringify(nextReadSearchHistory);
    }, [block.id]);

    useEffect(() => {
      if (workflowTab === "read" && !isReadModeEnabled && isSendModeEnabled) {
        setWorkflowTab("send");
        return;
      }
      if (workflowTab === "send" && !isSendModeEnabled && isReadModeEnabled) {
        setWorkflowTab("read");
      }
    }, [isReadModeEnabled, isSendModeEnabled, workflowTab]);

    useEffect(() => {
      const serialized = JSON.stringify(selectedRecipients);
      if (serialized === persistSelectedRef.current) return;
      persistSelectedRef.current = serialized;
      patchBlockProps({ sendSelectedRecipients: selectedRecipients });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedRecipients]);

    useEffect(() => {
      const payload = attachments.map(serializeAttachment);
      const serialized = JSON.stringify(payload);
      if (serialized === persistAttachmentsRef.current) return;
      persistAttachmentsRef.current = serialized;
      patchBlockProps({ sendDraftAttachments: payload });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [attachments]);

    useEffect(() => {
      const serialized = JSON.stringify(draftEntries);
      if (serialized === persistDraftEntriesRef.current) return;
      persistDraftEntriesRef.current = serialized;
      patchBlockProps({ sendDraftEntries: draftEntries });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draftEntries]);

    useEffect(() => {
      const serialized = JSON.stringify(sentEntries);
      if (serialized === persistSentEntriesRef.current) return;
      persistSentEntriesRef.current = serialized;
      patchBlockProps({ sendSentEntries: sentEntries });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sentEntries]);

    useEffect(() => {
      const payload = normalizeReadSearchHistory(readSearchHistory);
      const serialized = JSON.stringify(payload);
      if (serialized === persistReadSearchHistoryRef.current) return;
      persistReadSearchHistoryRef.current = serialized;
      patchBlockProps({ readSearchHistory: payload });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [readSearchHistory]);

    useEffect(() => {
      if (!libraryOpen) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") setLibraryOpen(false);
      };
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }, [libraryOpen]);

    useEffect(() => {
      if (!editorWindowOpen) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") setEditorWindowOpen(false);
      };
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }, [editorWindowOpen]);

    useEffect(() => {
      if (workflowTab === "read" && editorWindowOpen) {
        setEditorWindowOpen(false);
      }
    }, [workflowTab, editorWindowOpen]);

    useEffect(() => {
      if (!readBodyWindowOpen) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") setReadBodyWindowOpen(false);
      };
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }, [readBodyWindowOpen]);

    useEffect(() => {
      if (workflowTab === "send" && readBodyWindowOpen) {
        setReadBodyWindowOpen(false);
      }
    }, [workflowTab, readBodyWindowOpen]);

    useEffect(() => {
      if (!libraryOpen) {
        setLibraryEditingEntryId(null);
        setLibraryEditSubject("");
        setLibraryEditBody("");
      }
    }, [libraryOpen]);

    useEffect(() => {
      setLibraryEditingEntryId(null);
      setLibraryEditSubject("");
      setLibraryEditBody("");
    }, [libraryTab]);

    useEffect(() => {
      const editor = bodyEditorRef.current as any;
      if (!editor?.chain || typeof editor.getHTML !== "function") return;
      const currentBody = String(editor.getHTML() || "");
      const attachmentIdsInBody = extractAttachmentIdsFromHtml(currentBody);
      const missingInlineAttachments = attachments.filter((item) => {
        const id = String(item.id || "");
        if (!id) return false;
        return !attachmentIdsInBody.has(id);
      });
      if (!missingInlineAttachments.length) return;
      suppressAttachmentBodySyncRef.current += 1;
      let released = false;
      const releaseSyncGuard = () => {
        if (released) return;
        released = true;
        suppressAttachmentBodySyncRef.current = Math.max(0, suppressAttachmentBodySyncRef.current - 1);
      };

      // Defer TipTap node insertion to avoid React flushSync warnings inside passive effects.
      const timerId = window.setTimeout(() => {
        const liveEditor = bodyEditorRef.current as any;
        if (!liveEditor?.chain) {
          releaseSyncGuard();
          return;
        }
        missingInlineAttachments.forEach((item) => {
          liveEditor
            .chain()
            .focus()
            .insertEmailAttachment({
              attachmentId: item.id,
              kind: item.kind,
              filename: item.file.name,
              sizeBytes: item.sendSizeBytes || item.file.size,
              renderWidth: item.renderWidth,
            })
            .run();
        });
        window.setTimeout(releaseSyncGuard, 0);
      }, 0);

      return () => {
        window.clearTimeout(timerId);
        releaseSyncGuard();
      };
    }, [attachments, bodyEditorReadyToken, block.id]);

    const isConnected = Boolean(sendStats?.connected && String(sendStats?.sent_by || "").trim());
    const connectedEmail = String(sendStats?.sent_by || "").trim();
    const readMailbox = normalizeMailboxName(block.props.folder || READ_MAILBOX_ALL);
    const readMailboxParam = resolveEmailMetadataFolderParam(readMailbox);
    const readStartDate = normalizeReadStartDate(block.props.readStartDate);
    const readLoadFullContent = Boolean(block.props.readLoadFullContent);
    const isGlobalReadEnabled = Boolean(settings?.email_sync?.read_enabled);
    const hasReadUsageLimit = Boolean(readStats?.connected && Number(readStats?.daily_limit_bytes || 0) > 0);
    const readUsagePeriodLabel =
      String(readStats?.limit_label || "").toLowerCase().includes("diari") ? "Diario" : "Límite";
    const readUsageTooltip = hasReadUsageLimit
      ? `${formatReadLimitBytes(Number(readStats?.downloaded_today_bytes || 0))} usadas del límite de ${formatReadLimitBytes(
          Number(readStats?.daily_limit_bytes || 0)
        )}`
      : "";
    useEffect(() => {
      setSelectedRecipients((prev) => {
        const next = contacts.reduce<Record<string, boolean>>((acc, row) => {
          if (!row.email) return acc;
          acc[row.email] = Object.prototype.hasOwnProperty.call(prev, row.email)
            ? Boolean(prev[row.email])
            : false;
          return acc;
        }, {});
        const prevKeys = Object.keys(prev);
        const nextKeys = Object.keys(next);
        if (prevKeys.length === nextKeys.length && prevKeys.every((key) => prev[key] === next[key])) {
          return prev;
        }
        return next;
      });
    }, [contacts]);

    useEffect(() => {
      if (!contacts.length) {
        setActiveRecipientEmail(null);
        return;
      }
      if (!activeRecipientEmail || !contacts.some((contact) => contact.email === activeRecipientEmail)) {
        setActiveRecipientEmail(contacts[0].email);
      }
    }, [contacts, activeRecipientEmail]);

    const filteredContacts = useMemo(() => {
      const needle = recipientQuery.trim().toLowerCase();
      if (!needle) return contacts;
      return contacts.filter((contact) => {
        const mergedFields = {
          ...(contact.custom_fields || {}),
          ...parseCustomFields(customFieldsDraft[contact.email] || ""),
        };
        const haystack = [
          contact.name,
          contact.first_name,
          contact.last_name,
          contact.email,
          contact.company,
          ...Object.entries(mergedFields).flatMap(([key, value]) => [key, String(value || "")]),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      });
    }, [contacts, recipientQuery, customFieldsDraft]);

    useEffect(() => {
      if (!recipientQuery.trim() || filteredContacts.length === 0) return;
      if (!activeRecipientEmail || !filteredContacts.some((contact) => contact.email === activeRecipientEmail)) {
        setActiveRecipientEmail(filteredContacts[0].email);
      }
    }, [recipientQuery, filteredContacts, activeRecipientEmail]);

    const startGoogleLoginForSend = () => {
      /* ── The backend /oauth/google/start validates configuration
       *    (client_id + client_secret) and shows a clear HTML error
       *    page if anything is missing.  So we just open the URL
       *    directly — no async pre-check needed.
       *
       *    We use a synthetic <a target="_blank"> click because it
       *    is the most Safari-friendly way to open a new tab.  ──── */

      setOauthStarting(true);
      setSendError(null);
      setSendMessage(null);

      const authUrl = getGoogleOAuthStartUrl();

      // Synthetic <a> click — most reliable cross-browser new tab
      const link = document.createElement("a");
      link.href = authUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      document.body.appendChild(link);
      link.click();
      link.remove();

      setSendMessage("Se abrió Google en una nueva pestaña. Autoriza el acceso y vuelve aquí para enviar.");

      // Poll backend every few seconds to detect when OAuth completes
      const timers = [3000, 7000, 12000, 20000, 30000];
      timers.forEach((ms) => {
        window.setTimeout(() => void refreshSendStats(), ms);
      });

      setOauthStarting(false);
    };

    const totalAttachmentBytes = useMemo(() => {
      return attachments.reduce((total, item) => total + (item.sendSizeBytes || item.file.size), 0);
    }, [attachments]);

    const attachmentCatalog = useMemo(() => {
      return Object.fromEntries(
        attachments.map((item) => {
          const previewUrl = item.kind === "image"
            ? buildDataUrl(item.sendContentType || item.file.type || "image/jpeg", item.sendDataBase64 || item.dataBase64)
            : undefined;
          return [
            item.id,
            {
              kind: item.kind,
              filename: item.file.name,
              sizeBytes: item.sendSizeBytes || item.file.size,
              previewUrl,
              renderWidth: item.renderWidth,
            },
          ];
        })
      ) as Record<string, EmailInlineAttachmentCatalogItem>;
    }, [attachments]);

    const addAttachments = async (files: FileList | null, kind: EmailComposerAttachmentKind) => {
      const incoming = Array.from(files || []);
      if (!incoming.length) return;

      const existingSignatures = new Set(attachments.map((item) => fileSignature(item.file)));
      const uniqueIncoming = incoming.filter((file) => !existingSignatures.has(fileSignature(file)));

      if (!uniqueIncoming.length) {
        setSendError("Los archivos seleccionados ya estaban adjuntos.");
        return;
      }

      if (attachments.length + uniqueIncoming.length > MAX_EMAIL_ATTACHMENTS) {
        setSendError(`Máximo ${MAX_EMAIL_ATTACHMENTS} adjuntos por envío.`);
        return;
      }

      let nextTotal = totalAttachmentBytes;
      const nextAttachments: EmailComposerAttachment[] = [];
      for (const file of uniqueIncoming) {
        if (file.size > MAX_EMAIL_ATTACHMENT_SINGLE_BYTES) {
          setSendError(`"${file.name}" supera el límite de ${formatAttachmentBytes(MAX_EMAIL_ATTACHMENT_SINGLE_BYTES)}.`);
          return;
        }
        if (nextTotal + file.size > MAX_EMAIL_ATTACHMENT_BYTES) {
          setSendError(`Los adjuntos no pueden superar ${formatAttachmentBytes(MAX_EMAIL_ATTACHMENT_BYTES)} en total.`);
          return;
        }
        nextTotal += file.size;
        const resolvedKind = inferAttachmentKind(kind, file.name, file.type || undefined);
        nextAttachments.push({
          id: `${fileSignature(file)}-${Date.now()}-${nextAttachments.length}`,
          kind: resolvedKind,
          file,
          dataBase64: "",
          sendDataBase64: "",
          sendContentType: file.type || undefined,
          sendSizeBytes: file.size,
        });
      }

      try {
        const nextWithData = await Promise.all(
          nextAttachments.map(async (item) => {
            const dataBase64 = await readFileAsBase64(item.file);
            const contentType = item.file.type || undefined;
            if (item.kind !== "image") {
              return {
                ...item,
                dataBase64,
                sendDataBase64: dataBase64,
                sendContentType: contentType,
                sendSizeBytes: base64ByteLength(dataBase64) || item.file.size,
              };
            }

            let naturalWidth = 0;
            let naturalHeight = 0;
            try {
              const natural = await readImageNaturalSize(dataBase64, contentType);
              naturalWidth = natural.width;
              naturalHeight = natural.height;
            } catch {
              naturalWidth = 0;
              naturalHeight = 0;
            }

            const targetWidth = clampInlineImageWidth(
              naturalWidth > 0 ? Math.min(naturalWidth, INLINE_IMAGE_DEFAULT_WIDTH) : INLINE_IMAGE_DEFAULT_WIDTH
            );
            let sendDataBase64 = dataBase64;
            let sendContentType = contentType;
            let sendSizeBytes = base64ByteLength(dataBase64) || item.file.size;
            if (naturalWidth > 0 && naturalWidth > targetWidth + 1) {
              try {
                const resized = await resizeImageBase64ToWidth(dataBase64, contentType, targetWidth);
                sendDataBase64 = resized.dataBase64;
                sendContentType = resized.contentType;
                sendSizeBytes = resized.sizeBytes;
              } catch {
                // keep original payload
              }
            }

            return {
              ...item,
              dataBase64,
              sendDataBase64,
              sendContentType,
              sendSizeBytes,
              renderWidth: targetWidth,
              naturalWidth: naturalWidth || undefined,
              naturalHeight: naturalHeight || undefined,
            };
          })
        );
        setSendError(null);
        setAttachments((prev) => [...prev, ...nextWithData]);
        const editor = bodyEditorRef.current as any;
        if (editor?.chain) {
          suppressAttachmentBodySyncRef.current += 1;
          nextWithData.forEach((item) => {
            editor
              .chain()
              .focus()
              .insertEmailAttachment({
                attachmentId: item.id,
                kind: item.kind,
                filename: item.file.name,
                sizeBytes: item.sendSizeBytes || item.file.size,
                renderWidth: item.renderWidth,
              })
              .run();
          });
          window.setTimeout(() => {
            suppressAttachmentBodySyncRef.current = Math.max(0, suppressAttachmentBodySyncRef.current - 1);
          }, 0);
        }
      } catch (err) {
        if (err instanceof Error && err.message.trim()) {
          setSendError(err.message);
        } else {
          setSendError("No se pudo leer uno de los archivos seleccionados.");
        }
      }
    };

    const handleBodyAttachmentIdsChange = React.useCallback((attachmentIds: string[]) => {
      if (suppressAttachmentBodySyncRef.current > 0) return;
      const allowed = new Set(
        attachmentIds
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      );
      setAttachments((prev) => {
        if (!prev.length) return prev;
        const next = prev.filter((item) => allowed.has(String(item.id || "").trim()));
        return next.length === prev.length ? prev : next;
      });
    }, []);

    const handleInlineAttachmentResize = React.useCallback((attachmentId: string, width: number) => {
      const nextWidth = clampInlineImageWidth(width);
      const target = attachments.find((item) => item.id === attachmentId && item.kind === "image");
      if (!target) return;

      setAttachments((prev) =>
        prev.map((item) =>
          item.id === attachmentId
            ? {
                ...item,
                renderWidth: nextWidth,
              }
            : item
        )
      );

      void (async () => {
        try {
          const resized = await resizeImageBase64ToWidth(
            target.dataBase64,
            target.file.type || target.sendContentType,
            nextWidth
          );
          setAttachments((prev) =>
            prev.map((item) =>
              item.id === attachmentId
                ? {
                    ...item,
                    renderWidth: nextWidth,
                    sendDataBase64: resized.dataBase64,
                    sendContentType: resized.contentType,
                    sendSizeBytes: resized.sizeBytes,
                    naturalWidth: target.naturalWidth || resized.width,
                    naturalHeight: target.naturalHeight || resized.height,
                  }
                : item
            )
          );
        } catch {
          // Keep current payload if resize fails.
        }
      })();
    }, [attachments]);

    const selectedContacts = useMemo(() => {
      return contacts
        .filter((item) => Boolean(selectedRecipients[item.email]))
        .map((item) => ({
          ...item,
          custom_fields: {
            ...(item.custom_fields || {}),
            ...parseCustomFields(customFieldsDraft[item.email] || "")
          }
        }));
    }, [contacts, selectedRecipients, customFieldsDraft]);

    const selectedContactByEmail = useMemo(() => {
      const map: Record<string, EmailSendContact> = {};
      selectedContacts.forEach((contact) => {
        map[contact.email] = contact;
      });
      return map;
    }, [selectedContacts]);

    const readContactsForSelection = useMemo(
      () => buildSelectedEmailReadContacts(contacts, selectedRecipients),
      [contacts, selectedRecipients]
    );
    const selectedContactEmails = useMemo(
      () => readContactsForSelection.map((contact) => contact.email),
      [readContactsForSelection]
    );

    const selectedContactEmailsKey = useMemo(() => selectedContactEmails.join("|"), [selectedContactEmails]);

    const activeLibraryEntries = useMemo(() => {
      return libraryTab === "drafts" ? draftEntries : sentEntries;
    }, [libraryTab, draftEntries, sentEntries]);

    const activeRecipient = useMemo(() => {
      const source = recipientQuery.trim() ? filteredContacts : contacts;
      if (!source.length) return null;
      return source.find((contact) => contact.email === activeRecipientEmail) || source[0];
    }, [contacts, filteredContacts, recipientQuery, activeRecipientEmail]);

    const previewSource = useMemo(() => {
      if (!selectedContacts.length) return null;
      if (activeRecipient?.email && selectedContactByEmail[activeRecipient.email]) {
        return selectedContactByEmail[activeRecipient.email];
      }
      return selectedContacts[0];
    }, [selectedContacts, activeRecipient, selectedContactByEmail]);

    const activeRecipientCustomFields = useMemo(() => {
      if (!activeRecipient?.email) return [] as Array<[string, string]>;
      const values = {
        ...(activeRecipient.custom_fields || {}),
        ...parseCustomFields(customFieldsDraft[activeRecipient.email] || ""),
      };
      return Object.entries(values).filter(([key, value]) => key.trim() && String(value || "").trim());
    }, [activeRecipient, customFieldsDraft]);

    const activeRecipientCustomFieldRows = useMemo(() => {
      return activeRecipientCustomFields.map(([key, rawValue]) => {
        const value = String(rawValue || "");
        return {
          key,
          rawValue: value,
          readableValue: toReadableFieldValue(value),
          links: extractLinkPreviewItems(value),
        };
      });
    }, [activeRecipientCustomFields]);

    useEffect(() => {
      if (readAccountFilter === READ_MAILBOX_ALL) return;
      if (googleAccounts.some((account) => account.email === readAccountFilter)) return;
      setReadAccountFilter(READ_MAILBOX_ALL);
      patchBlockProps({ readAccountFilter: READ_MAILBOX_ALL });
    }, [googleAccounts, patchBlockProps, readAccountFilter]);

    const mergeReadMessages = React.useCallback((messages: EmailReadMessage[]): EmailReadMessage[] => {
      const sorted = [...messages].sort((a, b) => {
        const aTs = Date.parse(String(a.date || ""));
        const bTs = Date.parse(String(b.date || ""));
        if (!Number.isFinite(aTs) && !Number.isFinite(bTs)) return 0;
        if (!Number.isFinite(aTs)) return 1;
        if (!Number.isFinite(bTs)) return -1;
        return bTs - aTs;
      });
      const seen = new Set<string>();
      return sorted.filter((item) => {
        if (seen.has(item.message_id)) return false;
        seen.add(item.message_id);
        return true;
      });
    }, []);

    const formatReadLoadError = React.useCallback((loadErrors: Array<{ contactEmail: string; message: string }>): string | null => {
      if (loadErrors.length === 0) return null;
      if (loadErrors.length === 1) {
        const [error] = loadErrors;
        return `${error.contactEmail}: ${error.message}`;
      }
      const uniqueMessages = Array.from(
        new Set(
          loadErrors
            .map((item) => String(item.message || "").trim())
            .filter(Boolean)
        )
      );
      if (uniqueMessages.length === 1) return uniqueMessages[0];
      return `No se pudieron cargar ${loadErrors.length} contactos seleccionados.`;
    }, []);

    const applyReadMessages = React.useCallback((messages: EmailReadMessage[]) => {
      setReadMessages(messages);
      setActiveReadMessageId((prev) => {
        if (prev && messages.some((item) => item.message_id === prev)) return prev;
        return messages[0]?.message_id || null;
      });
    }, []);

    const loadReadMessagesForContacts = React.useCallback(
      async (
        contactsForRead: ReadContactSelection[],
        refresh: boolean,
        options?: {
          onPartialResult?: (messages: EmailReadMessage[], errorMessage: string | null) => void;
          shouldStop?: () => boolean;
          signal?: AbortSignal;
        }
      ): Promise<{
        messages: EmailReadMessage[];
        errorMessage: string | null;
      }> => {
        const merged: EmailReadMessage[] = [];
        const loadErrors: Array<{ contactEmail: string; message: string }> = [];
        let shouldAbortRemainingContacts = false;

        const emitPartialResult = () => {
          options?.onPartialResult?.(mergeReadMessages(merged), formatReadLoadError(loadErrors));
        };

        for (const contact of contactsForRead) {
          if (options?.shouldStop?.() || shouldAbortRemainingContacts) break;
          try {
            const rows = await listEmailMetadata({
              contact_id: contact.email,
              folder: readMailboxParam,
              start_date: readStartDate || undefined,
              refresh,
              signal: options?.signal,
            });
            merged.push(
              ...rows.map((row) => ({
                ...row,
                contactEmail: contact.email,
                contactName: contact.name || contact.email,
                contactCompany: contact.company || "",
              }))
            );
          } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") {
              break;
            }
            if (err instanceof ApiError) {
              loadErrors.push({ contactEmail: contact.email, message: err.message });
              if (err.status >= 500) {
                shouldAbortRemainingContacts = true;
              }
            } else {
              loadErrors.push({ contactEmail: contact.email, message: "No se pudieron cargar los correos." });
              shouldAbortRemainingContacts = true;
            }
          }
          emitPartialResult();
        }

        return {
          messages: mergeReadMessages(merged),
          errorMessage: formatReadLoadError(loadErrors),
        };
      },
      [formatReadLoadError, mergeReadMessages, readMailboxParam, readStartDate]
    );

    const fetchReadMessageBody = React.useCallback(async (messageId: string): Promise<{ body: string; cached: boolean }> => {
      const targetId = String(messageId || "").trim();
      if (!targetId) return { body: "", cached: true };
      if (Object.prototype.hasOwnProperty.call(readBodyByIdRef.current, targetId)) {
        return { body: String(readBodyByIdRef.current[targetId] || ""), cached: true };
      }
      try {
        const payload = await getEmailBody(targetId, { full_content: readLoadFullContent });
        const body = String(payload.body || "");
        setReadBodyById((prev) => {
          if (Object.prototype.hasOwnProperty.call(prev, targetId)) return prev;
          const next = { ...prev, [targetId]: body };
          readBodyByIdRef.current = next;
          return next;
        });
        return { body, cached: Boolean(payload.cached) };
      } catch (err) {
        setReadBodyById((prev) => {
          if (Object.prototype.hasOwnProperty.call(prev, targetId)) return prev;
          const next = { ...prev, [targetId]: "" };
          readBodyByIdRef.current = next;
          return next;
        });
        throw err;
      }
    }, [readLoadFullContent]);

    useEffect(() => {
      if (!isReadModeEnabled || workflowTab !== "read") return;
      if (!selectedContactEmails.length) {
        setReadMessages([]);
        setReadMessagesLoading(false);
        setReadMessagesRefreshing(false);
        setReadMessagesError(null);
        setActiveReadMessageId(null);
        return;
      }
      if (!isGlobalReadEnabled) {
        setReadMessages([]);
        setReadMessagesLoading(false);
        setReadMessagesRefreshing(false);
        setReadMessagesError("La lectura global del correo está desactivada. Actívala en Ajustes o desde la configuración del bloque.");
        setActiveReadMessageId(null);
        return;
      }
      let cancelled = false;
      const controller = new AbortController();
      const loadReadMessages = async () => {
        setReadMessagesLoading(true);
        setReadMessagesRefreshing(false);
        setReadMessagesError(null);
        setReadMessages([]);
        setActiveReadMessageId(null);
        const cached = await loadReadMessagesForContacts(readContactsForSelection, false, {
          shouldStop: () => cancelled || controller.signal.aborted,
          signal: controller.signal,
          onPartialResult: (messages, errorMessage) => {
            if (cancelled) return;
            applyReadMessages(messages);
            setReadMessagesError(errorMessage);
          },
        });
        if (cancelled) return;
        applyReadMessages(cached.messages);
        setReadMessagesError(cached.errorMessage);
        setReadMessagesLoading(false);
        void refreshReadStats();
        if (cached.messages.length > 0) return;

        setReadMessagesRefreshing(true);
        const refreshed = await loadReadMessagesForContacts(readContactsForSelection, true, {
          shouldStop: () => cancelled || controller.signal.aborted,
          signal: controller.signal,
          onPartialResult: (messages, errorMessage) => {
            if (cancelled) return;
            applyReadMessages(messages);
            setReadMessagesError(errorMessage);
          },
        });
        if (cancelled) return;
        applyReadMessages(refreshed.messages);
        setReadMessagesError(refreshed.errorMessage);
        setReadMessagesRefreshing(false);
        void refreshReadStats();
      };
      void loadReadMessages();
      return () => {
        cancelled = true;
        controller.abort();
      };
    }, [
      isReadModeEnabled,
      isGlobalReadEnabled,
      workflowTab,
      selectedContactEmails,
      selectedContactEmailsKey,
      readContactsForSelection,
      applyReadMessages,
      loadReadMessagesForContacts,
      refreshReadStats,
    ]);

    useEffect(() => {
      if (!isReadModeEnabled || workflowTab !== "read") return;
      if (!activeReadMessageId) return;
      if (Object.prototype.hasOwnProperty.call(readBodyById, activeReadMessageId)) return;
      let cancelled = false;
      const targetId = activeReadMessageId;
      setReadBodyLoadingId(targetId);
      void fetchReadMessageBody(targetId)
        .then((result) => {
          if (!cancelled && !result.cached) {
            void refreshReadStats();
          }
        })
        .catch((err) => {
          if (cancelled) return;
          if (err instanceof ApiError) setReadMessagesError(err.message);
          else setReadMessagesError("No se pudo cargar el contenido del correo.");
        })
        .finally(() => {
          if (!cancelled) {
            setReadBodyLoadingId((prev) => (prev === targetId ? null : prev));
          }
        });
      return () => {
        cancelled = true;
      };
    }, [isReadModeEnabled, workflowTab, activeReadMessageId, readBodyById, fetchReadMessageBody, refreshReadStats]);

    const requiresBodyForSearch = readSearchScope === "all" || readSearchScope === "attachment" || readSearchScope === "message";
    const shouldPrefetchBodiesForSearch = requiresBodyForSearch && Boolean(readSearchQuery.trim());

    useEffect(() => {
      if (!isReadModeEnabled || workflowTab !== "read" || !shouldPrefetchBodiesForSearch || !readMessages.length) {
        setReadBodyPrefetching(false);
        return;
      }
      const missingIds = readMessages
        .map((item) => item.message_id)
        .filter((messageId) => !Object.prototype.hasOwnProperty.call(readBodyByIdRef.current, messageId));
      if (!missingIds.length) {
        setReadBodyPrefetching(false);
        return;
      }

      let cancelled = false;
      const prefetchBodies = async () => {
        setReadBodyPrefetching(true);
        let remoteFetchDetected = false;
        for (const messageId of missingIds) {
          if (cancelled) break;
          try {
            const result = await fetchReadMessageBody(messageId);
            remoteFetchDetected = remoteFetchDetected || !result.cached;
          } catch {
            // Ignore individual fetch failures while prefetching.
          }
        }
        if (!cancelled) {
          setReadBodyPrefetching(false);
          if (remoteFetchDetected) {
            void refreshReadStats();
          }
        }
      };
      void prefetchBodies();
      return () => {
        cancelled = true;
      };
    }, [isReadModeEnabled, workflowTab, shouldPrefetchBodiesForSearch, readMessages, fetchReadMessageBody, refreshReadStats]);

    const readBodyTextById = useMemo(() => {
      return Object.fromEntries(
        Object.entries(readBodyById).map(([messageId, body]) => [messageId, htmlToPreviewText(String(body || ""))])
      ) as Record<string, string>;
    }, [readBodyById]);

    const readAttachmentNamesById = useMemo(() => {
      return Object.fromEntries(
        Object.entries(readBodyById).map(([messageId, body]) => [messageId, extractAttachmentNamesFromBody(body)])
      ) as Record<string, string[]>;
    }, [readBodyById]);

    const filteredReadMessages = useMemo(() => {
      const searchNeedle = readSearchQuery.trim().toLowerCase();
      const accountNeedle = readAccountFilter === READ_MAILBOX_ALL ? "" : readAccountFilter.trim().toLowerCase();

      return readMessages.filter((message) => {
        const folder = String(message.folder || "");
        const fromValue = String(message.from_address || "");
        const toValue = String(message.to_address || "");
        const subjectValue = String(message.subject || "");
        const bodyText = String(readBodyTextById[message.message_id] || "");
        const attachmentNames = readAttachmentNamesById[message.message_id] || [];

        if (accountNeedle) {
          const accountFields =
            isSentMailbox(folder) ? [fromValue] :
            isInboxMailbox(folder) ? [toValue, fromValue] :
            [fromValue, toValue];
          const matchesAccount = accountFields.some((value) => value.toLowerCase().includes(accountNeedle));
          if (!matchesAccount) return false;
        }

        if (!searchNeedle) return true;

        const byScope =
          readSearchScope === "from"
            ? fromValue
            : readSearchScope === "subject"
              ? subjectValue
              : readSearchScope === "attachment"
                ? attachmentNames.join(" ")
                : readSearchScope === "message"
                  ? bodyText
                  : [
                      message.contactName,
                      message.contactEmail,
                      message.contactCompany,
                      fromValue,
                      toValue,
                      subjectValue,
                      formatMailboxLabel(message.folder || ""),
                      bodyText,
                      attachmentNames.join(" "),
                    ].join(" ");
        if (!byScope.toLowerCase().includes(searchNeedle)) {
          return false;
        }
        return true;
      });
    }, [
      readMessages,
      readSearchQuery,
      readSearchScope,
      readAccountFilter,
      readBodyTextById,
      readAttachmentNamesById,
    ]);

    useEffect(() => {
      if (!isReadModeEnabled || workflowTab !== "read") return;
      if (!filteredReadMessages.length) {
        setActiveReadMessageId(null);
        return;
      }
      if (!activeReadMessageId || !filteredReadMessages.some((message) => message.message_id === activeReadMessageId)) {
        setActiveReadMessageId(filteredReadMessages[0].message_id);
      }
    }, [isReadModeEnabled, workflowTab, filteredReadMessages, activeReadMessageId]);

    const activeReadMessage = useMemo(() => {
      if (!filteredReadMessages.length) return null;
      if (!activeReadMessageId) return filteredReadMessages[0];
      return filteredReadMessages.find((message) => message.message_id === activeReadMessageId) || filteredReadMessages[0];
    }, [filteredReadMessages, activeReadMessageId]);

    const activeReadBody = activeReadMessage ? String(readBodyById[activeReadMessage.message_id] || "") : "";
    const activeReadBodyHtml = useMemo(() => toEmailBodyHtml(activeReadBody), [activeReadBody]);
    const activeReadAttachmentNames = useMemo(() => {
      if (!activeReadMessage) return [] as string[];
      return readAttachmentNamesById[activeReadMessage.message_id] || [];
    }, [activeReadMessage, readAttachmentNamesById]);
    const buildEmailSyncPatch = React.useCallback(
      (readEnabled: boolean): NonNullable<Settings["email_sync"]> => {
        const current = settings?.email_sync;
        const currentProviders = current?.oauth?.providers || {};
        return {
          provider: current?.provider || "none",
          read_enabled: readEnabled,
          imap: {
            host: current?.imap?.host || "",
            port: Number.isFinite(Number(current?.imap?.port)) ? Number(current?.imap?.port) : 993,
            username: current?.imap?.username || "",
            password: current?.imap?.password || "",
            use_ssl: current?.imap?.use_ssl !== false,
            folder: current?.imap?.folder || READ_MAILBOX_INBOX,
          },
          oauth: {
            providers: {
              ...currentProviders
            }
          }
        };
      },
      [settings?.email_sync]
    );

    const updateReadModeEnabled = React.useCallback(
      async (nextEnabled: boolean) => {
        setConfigError(null);
        patchBlockProps({ readEnabled: nextEnabled });
        if (!nextEnabled || isGlobalReadEnabled) return;
        setSyncingGlobalRead(true);
        try {
          const updated = await saveSettings({ email_sync: buildEmailSyncPatch(true) });
          if (!updated) {
            setConfigError("No se pudo activar la lectura global del correo.");
          }
        } catch {
          setConfigError("No se pudo activar la lectura global del correo.");
        } finally {
          setSyncingGlobalRead(false);
        }
      },
      [buildEmailSyncPatch, isGlobalReadEnabled, patchBlockProps, saveSettings]
    );

    const blockMenuActions = useMemo(
      () =>
        mode === "edit"
          ? [
              {
                key: `email-config-${block.id}`,
                label: "Configurar correo",
                onClick: () => setIsConfigOpen(true)
              },
              ...(menuActions || [])
            ]
          : menuActions,
      [block.id, menuActions, mode]
    );

    const readFolderOptions = useMemo(() => {
      const folderMap = new Map<string, string>();
      [READ_MAILBOX_ALL, READ_MAILBOX_INBOX, READ_MAILBOX_SENT].forEach((value) => {
        folderMap.set(value, value);
      });
      const currentFolderKey = normalizeMailboxName(readMailbox).toUpperCase();
      if (!folderMap.has(currentFolderKey)) {
        folderMap.set(currentFolderKey, readMailbox);
      }
      readMessages.forEach((message) => {
        const folder = normalizeMailboxName(message.folder || "");
        if (!folder) return;
        const key = normalizeMailboxName(folder).toUpperCase();
        if (!folderMap.has(key)) {
          folderMap.set(key, folder);
        }
      });
      return Array.from(folderMap.values());
    }, [readMessages, readMailbox]);

    const readAccountOptions = useMemo(() => {
      return buildEmailAccountOptions(googleAccounts);
    }, [googleAccounts]);

    const hasAdvancedReadFilters = readSearchScope !== "all";
    const activeReadSearchScopeOption = useMemo(
      () => READ_SEARCH_SCOPE_OPTIONS.find((option) => option.value === readSearchScope) || READ_SEARCH_SCOPE_OPTIONS[0],
      [readSearchScope]
    );
    const activeReadSearchScopeLabel = activeReadSearchScopeOption.value === "all" ? "" : activeReadSearchScopeOption.label;
    const readSearchNeedle = readSearchQuery.trim();

    const commitReadSearchQuery = React.useCallback(
      (raw: string, scopeOverride?: ReadSearchScope) => {
        const value = String(raw || "").trim();
        if (!value) return;
        const scope = scopeOverride || readSearchScope;
        const valueKey = value.toLowerCase();
        setReadSearchHistory((prev) => {
          const next = [
            { query: value, scope },
            ...prev.filter((item) => !(item.scope === scope && item.query.toLowerCase() === valueKey)),
          ];
          return next.slice(0, MAX_READ_SEARCH_HISTORY);
        });
      },
      [readSearchScope]
    );

    const getReadHighlightQueryForField = React.useCallback(
      (field: "subject" | "from" | "contact" | "message"): string => {
        if (!readSearchNeedle) return "";
        if (readSearchScope === "all") return readSearchNeedle;
        if (readSearchScope === "subject" && field === "subject") return readSearchNeedle;
        if (readSearchScope === "from" && field === "from") return readSearchNeedle;
        if ((readSearchScope === "message" || readSearchScope === "attachment") && field === "message") {
          return readSearchNeedle;
        }
        return "";
      },
      [readSearchNeedle, readSearchScope]
    );

    const getVisibleReadMessageSnippet = React.useCallback(
      (message: EmailReadMessage): string => {
        const bodySnippet = String(readBodyTextById[message.message_id] || "");
        const attachmentSnippet = (readAttachmentNamesById[message.message_id] || []).join(" · ");
        if (!attachmentSnippet) return bodySnippet;
        if (readSearchScope === "attachment") return attachmentSnippet;
        if (readSearchScope === "all" && readSearchNeedle) {
          const bodyMatches = bodySnippet.toLowerCase().includes(readSearchNeedle.toLowerCase());
          const attachmentMatches = attachmentSnippet.toLowerCase().includes(readSearchNeedle.toLowerCase());
          if (attachmentMatches && !bodyMatches) return attachmentSnippet;
        }
        return bodySnippet;
      },
      [readAttachmentNamesById, readBodyTextById, readSearchNeedle, readSearchScope]
    );

    const preview = useMemo(() => {
      const first = previewSource;
      if (!first) return null;
      const values: Record<string, string> = {
        name: first.name || "",
        Nombre: first.first_name || first.name?.split(" ")[0] || "",
        nombre: first.first_name || first.name?.split(" ")[0] || "",
        first_name: first.first_name || first.name?.split(" ")[0] || "",
        last_name: first.last_name || "",
        Apellidos: first.last_name || "",
        apellidos: first.last_name || "",
        email: first.email || "",
        Email: first.email || "",
        company: first.company || "",
        Empresa: first.company || "",
        empresa: first.company || "",
      };
      Object.entries(first.custom_fields || {}).forEach(([key, value]) => {
        values[key] = String(value || "");
        values[key.toLowerCase()] = String(value || "");
      });
      return {
        subject: renderTemplate(block.props.sendSubjectTemplate || "", values),
        body: renderTemplate(block.props.sendBodyTemplate || "", values)
      };
    }, [previewSource, block.props.sendSubjectTemplate, block.props.sendBodyTemplate]);

    const previewBodyHtml = useMemo(() => {
      if (!preview?.body) return "";
      return renderPreviewBodyWithInlineAttachments(preview.body, attachmentCatalog);
    }, [preview?.body, attachmentCatalog]);

    const handleSenderAccountChange = async (email: string) => {
      const nextEmail = String(email || "").trim();
      if (!nextEmail) return;
      const isAlreadyActive = googleAccounts.some((account) => account.active && account.email === nextEmail);
      if (isAlreadyActive) return;
      setSendError(null);
      try {
        await selectGoogleAccount(nextEmail);
        await refreshSendStats();
      } catch (err) {
        if (err instanceof ApiError) setSendError(err.message);
        else setSendError("No se pudo seleccionar la cuenta de envío.");
      }
    };

    const renderBodyComposerEditor = (windowed: boolean) => (
      <div className={cx("email-send-editor-wrap", windowed && "is-windowed")}>
        <RichTextEditor
          value={block.props.sendBodyTemplate || ""}
          onChange={(html) => patchBlockProps({ sendBodyTemplate: html })}
          onEditorReady={handleBodyEditorReady}
          attachmentCatalog={attachmentCatalog}
          onAttachmentResize={handleInlineAttachmentResize}
          onAttachmentIdsChange={handleBodyAttachmentIdsChange}
          contentOverlay={!windowed ? (
            <button
              type="button"
              className="email-send-editor-expand-button"
              onClick={() => setEditorWindowOpen(true)}
              title="Ampliar editor"
              aria-label="Ampliar editor"
            >
              <span className="email-send-editor-expand-glyph" aria-hidden="true">⤢</span>
            </button>
          ) : null}
          placeholder="Hola {{Nombre}}, ..."
          minHeight={120}
          toolbarExtra={(editor) => (
            <div className="email-send-editor-toolbar-stack">
              <div className="email-send-editor-toolbar-extra">
                <div className="email-send-editor-toolbar-left">
                  {mergeTags.length > 0 ? (
                    <MergeTagPicker
                      tags={mergeTags}
                      onInsert={(tag) => {
                        editor.chain().focus().insertContent(`{{${tag.key}}}`).run();
                      }}
                      buttonLabel="Variables"
                    />
                  ) : null}
                </div>
                <div className="email-send-editor-toolbar-right">
                  <button
                    type="button"
                    className="ghost email-send-attachment-button"
                    onClick={openPhotoPicker}
                    title="Añadir foto"
                    aria-label="Añadir foto"
                  >
                    <span className="email-send-attachment-button-icon" aria-hidden="true">
                      <AttachmentPhotoIcon />
                    </span>
                  </button>
                  <button
                    type="button"
                    className="ghost email-send-attachment-button"
                    onClick={() => documentInputRef.current?.click()}
                    title="Añadir documento"
                    aria-label="Añadir documento"
                  >
                    <span className="email-send-attachment-button-icon" aria-hidden="true">
                      <AttachmentDocumentIcon />
                    </span>
                  </button>
                  <span className="email-send-attachments-summary">
                    {attachments.length} adjunto{attachments.length !== 1 ? "s" : ""} · {formatAttachmentBytes(totalAttachmentBytes)}
                  </span>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(event) => {
                      void addAttachments(event.target.files, "image");
                      event.target.value = "";
                    }}
                  />
                  <input
                    ref={documentInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,.txt,.rtf,.odt,.pages,.xls,.xlsx,.ppt,.pptx,.csv,.zip"
                    multiple
                    hidden
                    onChange={(event) => {
                      void addAttachments(event.target.files, "document");
                      event.target.value = "";
                    }}
                  />
                </div>
              </div>
              <div className="email-send-editor-subject-row">
                <span className="email-send-editor-subject-label">Asunto</span>
                <input
                  ref={subjectInputRef}
                  id={`${block.id}-send-subject`}
                  className="email-send-editor-subject-input"
                  value={block.props.sendSubjectTemplate || ""}
                  onChange={(event) => patchBlockProps({ sendSubjectTemplate: event.target.value })}
                  placeholder="Hola {{Nombre}}, seguimiento en {{Empresa}}"
                />
              </div>
              <div className="email-send-editor-subject-row email-send-editor-from-row">
                <span className="email-send-editor-subject-label">De:</span>
                <select
                  id={`${block.id}-send-from`}
                  className="email-send-editor-subject-input email-send-editor-from-select"
                  value={googleAccounts.find((account) => account.active)?.email || googleAccounts[0]?.email || ""}
                  onChange={(event) => {
                    void handleSenderAccountChange(event.target.value);
                  }}
                  disabled={!isConnected || googleAccounts.length === 0}
                >
                  {googleAccounts.length === 0 ? (
                    <option value="">Sin cuentas conectadas</option>
                  ) : (
                    googleAccounts.map((account) => (
                      <option key={account.email} value={account.email}>
                        {account.email}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>
          )}
        />
      </div>
    );

    const renderReadMessageDetail = (windowed: boolean) => (
      <article className={cx("email-send-read-detail", windowed && "is-windowed")}>
        {activeReadMessage ? (
          <>
            <div className="email-send-read-detail-head">
              <h4>{activeReadMessage.subject || "Sin asunto"}</h4>
              <div className="email-send-read-detail-meta">
                <span><strong>De:</strong> {activeReadMessage.from_address || "—"}</span>
                <span><strong>Para:</strong> {activeReadMessage.to_address || "—"}</span>
                <span><strong>Contacto:</strong> {activeReadMessage.contactName || activeReadMessage.contactEmail || "—"}</span>
                <span><strong>Fecha:</strong> {formatMessageTimestamp(activeReadMessage.date)}</span>
              </div>
              {activeReadAttachmentNames.length > 0 ? (
                <div className="email-send-read-attachments">
                  {activeReadAttachmentNames.map((filename) => (
                    <span
                      key={`${activeReadMessage.message_id}-${filename}`}
                      className="email-send-read-attachment-pill"
                    >
                      {filename}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            {readBodyLoadingId === activeReadMessage.message_id && !activeReadBody ? (
              <div className="email-send-read-loading">Cargando contenido del correo…</div>
            ) : activeReadBody ? (
              <div className={cx("email-send-read-detail-body-wrap", windowed && "is-windowed")}>
                {!windowed ? (
                  <button
                    type="button"
                    className="email-send-editor-expand-button"
                    onClick={() => setReadBodyWindowOpen(true)}
                    title="Ampliar correo"
                    aria-label="Ampliar correo"
                  >
                    <span className="email-send-editor-expand-glyph" aria-hidden="true">⤢</span>
                  </button>
                ) : null}
                <div
                  className={cx("page-builder-text", "email-send-read-detail-body", windowed && "is-windowed")}
                  dangerouslySetInnerHTML={{ __html: activeReadBodyHtml }}
                />
              </div>
            ) : (
              <div className="email-send-read-loading">Este correo no tiene cuerpo disponible.</div>
            )}
          </>
        ) : (
          <div className="email-send-read-loading">Selecciona un correo para ver el detalle.</div>
        )}
      </article>
    );

    const saveDraft = () => {
      if (!(block.props.sendSubjectTemplate || "").trim() && !(block.props.sendBodyTemplate || "").trim()) {
        setSendError("Escribe asunto o cuerpo antes de guardar el borrador.");
        return;
      }
      const timestamp = new Date().toISOString();
      const existingId =
        activeDraftEntryId && draftEntries.some((entry) => entry.id === activeDraftEntryId) ? activeDraftEntryId : null;
      const draftId = existingId || `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const selectedSnapshot = Object.fromEntries(
        Object.entries(selectedRecipients).filter(([, isSelected]) => Boolean(isSelected))
      );
      const nextEntry: EmailComposerLibraryEntry = {
        id: draftId,
        subjectTemplate: block.props.sendSubjectTemplate || "",
        bodyTemplate: block.props.sendBodyTemplate || "",
        attachments: attachments.map(serializeAttachment),
        selectedRecipients: selectedSnapshot,
        recipientCount: selectedContacts.length,
        updatedAt: timestamp,
      };
      setDraftEntries((prev) => [nextEntry, ...prev.filter((entry) => entry.id !== draftId)].slice(0, MAX_EMAIL_LIBRARY_ENTRIES));
      setActiveDraftEntryId(draftId);
      setSendResult(null);
      setSendError(null);
      setSendMessage(existingId ? "Borrador actualizado." : "Borrador guardado.");
    };

    const applyLibraryEntry = (entry: EmailComposerLibraryEntry) => {
      patchBlockProps({
        sendSubjectTemplate: entry.subjectTemplate,
        sendBodyTemplate: entry.bodyTemplate,
      });
      const restoredAttachments = entry.attachments
        .map(deserializeStoredAttachment)
        .filter((item): item is EmailComposerAttachment => Boolean(item));
      setAttachments(restoredAttachments);

      if (entry.selectedRecipients) {
        const selectedSnapshot = Object.fromEntries(
          Object.entries(entry.selectedRecipients).filter(([, isSelected]) => Boolean(isSelected))
        );
        setSelectedRecipients((prev) => {
          const next: Record<string, boolean> = {};
          Object.keys(prev).forEach((email) => {
            next[email] = Boolean(selectedSnapshot[email]);
          });
          Object.entries(selectedSnapshot).forEach(([email, isSelected]) => {
            next[email] = Boolean(isSelected);
          });
          return next;
        });
        setActiveDraftEntryId(entry.id);
      } else {
        setActiveDraftEntryId(null);
      }

      setSendResult(null);
      setLibraryOpen(false);
      setSendError(null);
      setSendMessage("Composición cargada desde la biblioteca.");
    };

    const startLibraryEntryEdit = (entry: EmailComposerLibraryEntry) => {
      setLibraryEditingEntryId(entry.id);
      setLibraryEditSubject(entry.subjectTemplate);
      setLibraryEditBody(entry.bodyTemplate);
    };

    const cancelLibraryEntryEdit = () => {
      setLibraryEditingEntryId(null);
      setLibraryEditSubject("");
      setLibraryEditBody("");
    };

    const saveLibraryEntryEdit = () => {
      const targetId = libraryEditingEntryId;
      if (!targetId) return;
      const nextSubject = libraryEditSubject;
      const nextBody = libraryEditBody;
      const updatedAt = new Date().toISOString();
      const patchEntry = (entry: EmailComposerLibraryEntry): EmailComposerLibraryEntry =>
        entry.id === targetId
          ? {
              ...entry,
              subjectTemplate: nextSubject,
              bodyTemplate: nextBody,
              updatedAt,
            }
          : entry;

      if (libraryTab === "drafts") {
        setDraftEntries((prev) => prev.map(patchEntry));
      } else {
        setSentEntries((prev) => prev.map(patchEntry));
      }

      cancelLibraryEntryEdit();
      setSendError(null);
      setSendMessage("Elemento actualizado en la biblioteca.");
    };

    const removeLibraryEntry = async (entry: EmailComposerLibraryEntry, sourceTab: "drafts" | "sent") => {
      const confirmed = await confirmDialog({
        title: "Eliminar elemento",
        message: `Se eliminará \"${entry.subjectTemplate || "Sin asunto"}\".`,
        confirmLabel: "Eliminar",
        cancelLabel: "Cancelar",
        tone: "danger",
      });
      if (!confirmed) return;

      if (sourceTab === "drafts") {
        setDraftEntries((prev) => prev.filter((item) => item.id !== entry.id));
      } else {
        setSentEntries((prev) => prev.filter((item) => item.id !== entry.id));
      }

      if (activeDraftEntryId === entry.id) {
        setActiveDraftEntryId(null);
      }
      if (libraryEditingEntryId === entry.id) {
        cancelLibraryEntryEdit();
      }

      setSendError(null);
      setSendMessage("Elemento eliminado de la biblioteca.");
    };

    const requestSendConfirmation = async () => {
      if (sending) return;
      if (!selectedContacts.length) {
        setSendError("Selecciona al menos un contacto para enviar.");
        return;
      }
      if (!(block.props.sendSubjectTemplate || "").trim() || !(block.props.sendBodyTemplate || "").trim()) {
        setSendError("Completa asunto y cuerpo base antes de enviar.");
        return;
      }
      setSendError(null);
      const confirmed = await confirmDialog({
        title: "Confirmar envío",
        message: `Se enviarán ${selectedContacts.length} emails${attachments.length ? ` con ${attachments.length} adjunto${attachments.length !== 1 ? "s" : ""}` : ""}.`,
        confirmLabel: "Enviar",
        cancelLabel: "Cancelar",
      });
      if (!confirmed) return;
      await runSend();
    };

    const runSend = async () => {
      if (!selectedContacts.length) {
        setSendError("Selecciona al menos un contacto para enviar.");
        return;
      }
      if (!(block.props.sendSubjectTemplate || "").trim() || !(block.props.sendBodyTemplate || "").trim()) {
        setSendError("Completa asunto y cuerpo base antes de enviar.");
        return;
      }
      setSending(true);
      setSendError(null);
      setSendMessage(null);
      setSendResult(null);
      try {
        const payloadAttachments = await Promise.all(
          attachments.map(async (item) => ({
            filename: item.file.name,
            content_type: item.sendContentType || item.file.type || undefined,
            data_base64: item.sendDataBase64 || item.dataBase64 || await readFileAsBase64(item.file),
          }))
        );
        const result = await sendEmailBatch({
          subject_template: block.props.sendSubjectTemplate || "",
          body_template: block.props.sendBodyTemplate || "",
          contacts: selectedContacts.map((item) => ({
            name: item.name,
            email: item.email,
            company: item.company,
            custom_fields: item.custom_fields || {}
          })),
          attachments: payloadAttachments,
        });
        setSendResult(result);
        setSentEntries((prev) => {
          const snapshot: EmailComposerLibraryEntry = {
            id: `sent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            subjectTemplate: block.props.sendSubjectTemplate || "",
            bodyTemplate: block.props.sendBodyTemplate || "",
            attachments: attachments.map(serializeAttachment),
            recipientCount: selectedContacts.length,
            updatedAt: new Date().toISOString(),
          };
          return [snapshot, ...prev].slice(0, MAX_EMAIL_LIBRARY_ENTRIES);
        });
        setSendMessage(`Envío completado. Enviados: ${result.sent}, errores: ${result.errors}.`);
        await refreshSendStats();
      } catch (err) {
        if (err instanceof ApiError) setSendError(err.message);
        else setSendError("No se pudo enviar la campaña.");
      } finally {
        setSending(false);
      }
    };

    const activeAccount = googleAccounts.find((account) => account.active);
    const hasMessageTemplate =
      Boolean(String(block.props.sendSubjectTemplate || "").trim()) &&
      Boolean(String(block.props.sendBodyTemplate || "").trim());
    const subtleInfoMessage = useMemo(() => {
      if (!sendMessage) return null;
      if (sendResult && sendMessage.startsWith("Envío completado.")) return null;
      return sendMessage;
    }, [sendMessage, sendResult]);
    const isReadTab = workflowTab === "read";
    const hasSelectableAccounts = googleAccounts.length > 0;
    const activeAccountEmail = isReadTab
      ? String(readStats?.account_id || activeAccount?.email || connectedEmail || "—")
      : activeAccount?.email || connectedEmail || "—";
    const accountInlineBlock =
      ((hasSelectableAccounts && (isConnected || hasReadUsageLimit)) || (isReadTab && Boolean(readStats?.account_id))) ? (
        <div className="email-send-card email-send-account-card">
          <div ref={acctDropdownRef} className="email-send-account-selector">
            <button
              type="button"
              onClick={() => {
                if (!hasSelectableAccounts) return;
                setAcctDropdownOpen((prev) => !prev);
              }}
              className={cx("email-send-account-trigger", acctDropdownOpen && "is-open")}
              disabled={!hasSelectableAccounts}
            >
              <span className="email-send-account-avatar">
                {activeAccountEmail.charAt(0).toUpperCase()}
              </span>
              <strong className="email-send-account-active-email">{activeAccountEmail}</strong>
              {hasSelectableAccounts ? (
                <span className="email-send-account-caret" aria-hidden="true">▾</span>
              ) : null}
            </button>

            {hasSelectableAccounts && acctDropdownOpen ? (
              <div className="email-send-account-menu">
                {googleAccounts.map((acct) => (
                  <div
                    key={acct.email}
                    className={cx("email-send-account-item", acct.active && "is-active")}
                    onClick={() => {
                      if (!acct.active) {
                        void (async () => {
                          try {
                            await selectGoogleAccount(acct.email);
                            await refreshSendStats();
                          } catch (err) {
                            if (err instanceof ApiError) setSendError(err.message);
                          }
                        })();
                      }
                      setAcctDropdownOpen(false);
                    }}
                    role={acct.active ? undefined : "button"}
                    tabIndex={acct.active ? -1 : 0}
                    onKeyDown={(event) => {
                      if (acct.active) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        (event.currentTarget as HTMLElement).click();
                      }
                    }}
                  >
                    <span className={cx("email-send-account-item-avatar", acct.active && "is-active")}>
                      {acct.email.charAt(0).toUpperCase()}
                    </span>
                    <span className="email-send-account-item-email">{acct.email}</span>
                    {acct.active ? (
                      <>
                        {!isReadTab ? (
                          <span className="email-send-account-item-state">● Activa</span>
                        ) : null}
                        <button
                          className="ghost email-send-disconnect-all email-send-account-hover-disconnect"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void (async () => {
                              setSendError(null);
                              setSendMessage(null);
                              try {
                                const out = await disconnectSingleGoogleAccount(acct.email);
                                setSendMessage(out.message || "Cuenta desconectada.");
                                await refreshSendStats();
                              } catch (err) {
                                if (err instanceof ApiError) setSendError(err.message);
                                else setSendError("No se pudo desconectar la cuenta.");
                              }
                              setAcctDropdownOpen(false);
                            })();
                          }}
                        >
                          Desconectar
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="ghost email-send-disconnect-all email-send-account-hover-disconnect"
                        onClick={(event) => {
                          event.stopPropagation();
                          void (async () => {
                            setSendError(null);
                            setSendMessage(null);
                            try {
                              const out = await disconnectSingleGoogleAccount(acct.email);
                              setSendMessage(out.message || "Cuenta desconectada.");
                              await refreshSendStats();
                            } catch (err) {
                              if (err instanceof ApiError) setSendError(err.message);
                              else setSendError("No se pudo desconectar la cuenta.");
                            }
                            setAcctDropdownOpen(false);
                          })();
                        }}
                        aria-label={`Desconectar ${acct.email}`}
                      >
                        Desconectar
                      </button>
                    )}
                  </div>
                ))}
                <div className="email-send-account-divider" />
                <button
                  type="button"
                  className="email-send-account-add"
                  onClick={() => {
                    if (oauthStarting) return;
                    setAcctDropdownOpen(false);
                    startGoogleLoginForSend();
                  }}
                  disabled={oauthStarting}
                >
                  <span className="email-send-account-add-icon">+</span>
                  <span className="email-send-account-add-label">{oauthStarting ? "Abriendo…" : "Añadir cuenta"}</span>
                  <GoogleIcon />
                </button>
              </div>
            ) : null}
          </div>

          {isReadTab && hasReadUsageLimit ? (
            <div className="email-send-metrics">
              <span className="email-send-metric-pill" title={readUsageTooltip} aria-label={readUsageTooltip}>
                <span className="email-send-metric-icon"><MetricUsageIcon /></span>
                {readUsagePeriodLabel}: <strong>{formatUsagePercent(Number(readStats?.used_percent || 0))}</strong> usado
              </span>
            </div>
          ) : null}

          {sendStats && !isReadTab ? (
            <div className="email-send-metrics">
              <span className="email-send-metric-pill">
                <span className="email-send-metric-icon"><MetricTodayIcon /></span>
                <strong>{sendStats.sent_today}/{sendStats.daily_limit}</strong> hoy
              </span>
              <span className="email-send-metric-pill">
                <span className="email-send-metric-icon"><MetricRemainingIcon /></span>
                <strong>{sendStats.remaining_today}</strong> restantes
              </span>
              {sendStats.warning ? (
                <span className="email-send-metric-warning">⚠️ {sendStats.warning}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null;
    const composeHeaderInlineContent = (
      <div className="email-send-header-inline-left">
        {hasAnyWorkflowEnabled ? (
          <div className="email-send-mode-tabs" role="tablist" aria-label="Modo de correo">
            {isReadModeEnabled ? (
              <button
                type="button"
                role="tab"
                aria-selected={isReadTab}
                className={cx("email-send-mode-tab", isReadTab && "is-active")}
                onClick={() => setWorkflowTab("read")}
              >
                Leer
              </button>
            ) : null}
            {isSendModeEnabled ? (
              <button
                type="button"
                role="tab"
                aria-selected={!isReadTab}
                className={cx("email-send-mode-tab", !isReadTab && "is-active")}
                onClick={() => setWorkflowTab("send")}
              >
                Enviar
              </button>
            ) : null}
          </div>
        ) : (
          <div className="email-block-config-chip">Bloque de correo desactivado</div>
        )}
        {accountInlineBlock}
      </div>
    );
    const composeHeaderRightContent = (
      <div className="email-send-header-actions">
        <button
          type="button"
          className="ghost email-send-header-action"
          onClick={saveDraft}
          disabled={sending}
        >
          Guardar borrador
        </button>
        <button
          type="button"
          className="ghost email-send-header-action"
          onClick={() => {
            setLibraryTab("drafts");
            setLibraryOpen(true);
          }}
        >
          Historial
        </button>
        <button
          className="primary email-send-send-button email-send-send-button-header"
          type="button"
          onClick={() => {
            void requestSendConfirmation();
          }}
          disabled={sending || selectedContacts.length === 0 || !isConnected}
        >
          {sending ? (
            <>
              <span className="email-send-send-spinner" aria-hidden="true">
                <SendProgressIcon />
              </span>
              Enviando…
            </>
          ) : (
            <>
              <span className="email-send-send-button-icon" aria-hidden="true">
                <SendPlaneIcon />
              </span>
              Enviar a {selectedContacts.length} contacto{selectedContacts.length !== 1 ? "s" : ""}
            </>
          )}
        </button>
      </div>
    );

    return (
      <BlockPanel id={block.id} as="section" menuActions={blockMenuActions}>
        {renderHeader(
          block.id,
          mode,
          block.props.title || "",
          block.props.description || "",
          (patch) => patchBlockProps(patch)
        )}

        {mode === "edit" ? null : null}

        {slot ? (
          slot
        ) : (
          <div className="email-send-workflow">
            {subtleInfoMessage ? (
              <div className="email-send-subtle-note">{subtleInfoMessage}</div>
            ) : null}
            {sendError ? (
              <div className="email-send-feedback is-error">
                <span className="email-send-feedback-icon" aria-hidden="true">⚠️</span>
                {sendError}
              </div>
            ) : null}

            {isSendModeEnabled && (!isConnected || googleAccounts.length === 0) ? (
              <section className="email-send-card email-send-step-card">
                <StepHeader label="Cuenta de envío" active done={false} />
                <Divider />
                <div className="email-send-step-body">
                  <button
                    type="button"
                    onClick={() => startGoogleLoginForSend()}
                    disabled={oauthStarting}
                    className="email-send-google-button"
                  >
                    <GoogleIcon />
                    {oauthStarting ? "Abriendo Google…" : "Iniciar sesión con Google"}
                  </button>
                </div>
              </section>
            ) : null}

            <section className={cx("email-send-card email-send-step-card", !isConnected && !isReadTab && "is-dimmed")}>
              <StepHeader
                active={isConnected && contacts.length > 0 && hasMessageTemplate && !sendResult}
                done={!!sendResult}
                blocked={!isConnected}
                inlineContent={composeHeaderInlineContent}
                className="email-send-step-header-with-tabs"
                rightContent={!isReadTab && isSendModeEnabled ? composeHeaderRightContent : undefined}
              />
              <Divider />

              {!hasAnyWorkflowEnabled ? (
                <div className="email-block-config-empty">
                  Activa al menos una opción en Configurar correo para usar este bloque.
                </div>
              ) : (
                <div
                  className={cx(
                    "email-send-compose-shell",
                    isRecipientPanelCollapsed && "is-recipient-panel-collapsed"
                  )}
                >
                <aside
                  id={`${block.id}-recipient-panel`}
                  className={cx(
                    "email-send-recipient-panel",
                    isRecipientPanelCollapsed && "is-collapsed"
                  )}
                  aria-hidden={isRecipientPanelCollapsed}
                >
                  <div className="email-send-recipient-panel-header">
                    <div className="email-send-recipient-title-row">
                      <strong>Destinatarios</strong>
                      <span>
                        {selectedContacts.length}/{filteredContacts.length || 0}
                      </span>
                    </div>
                    <div className="tracker-search-input-wrap email-send-recipient-search-wrap">
                      <span className="tracker-search-leading" aria-hidden="true">
                        <svg viewBox="0 0 20 20">
                          <path d="M12.9 14 17 18.1l1.1-1.1-4.1-4.1a6.5 6.5 0 1 0-1.1 1.1ZM4.5 8.5a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" />
                        </svg>
                      </span>
                      <input
                        value={recipientQuery}
                        onChange={(event) => setRecipientQuery(event.target.value)}
                        placeholder="Company, role, location..."
                        className="tracker-search-input"
                      />
                      {recipientQuery.trim() ? (
                        <div className="tracker-search-actions">
                          <button
                            type="button"
                            className="tracker-search-clear"
                            onClick={() => setRecipientQuery("")}
                            aria-label="Clear recipient search"
                            title="Clear recipient search"
                          >
                            <svg viewBox="0 0 20 20" aria-hidden="true">
                              <path d="M5.22 5.22a.75.75 0 0 1 1.06 0L10 8.94l3.72-3.72a.75.75 0 0 1 1.06 1.06L11.06 10l3.72 3.72a.75.75 0 0 1-1.06 1.06L10 11.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06L8.94 10 5.22 6.28a.75.75 0 0 1 0-1.06Z" />
                            </svg>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {filteredContacts.length > 0 ? (
                    <div className="email-send-recipient-scroll">
                      {filteredContacts.map((contact) => (
                        <div
                          key={`${contact.email}-${contact.company}`}
                          className={cx(
                            "email-send-recipient-item",
                            activeRecipient?.email === contact.email && "is-active",
                            selectedRecipients[contact.email] && "is-selected"
                          )}
                          onClick={() => setActiveRecipientEmail(contact.email)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setActiveRecipientEmail(contact.email);
                            }
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(selectedRecipients[contact.email])}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              setSelectedRecipients((prev) => ({ ...prev, [contact.email]: event.target.checked }))
                            }
                            className="email-send-check"
                          />
                          <div className="email-send-recipient-item-main">
                            <span className="email-send-recipient-name">{renderHighlightedText(contact.name || "—", recipientQuery)}</span>
                            <span className="email-send-recipient-email">{renderHighlightedText(contact.email || "—", recipientQuery)}</span>
                            <span className="email-send-recipient-company">{renderHighlightedText(contact.company || "—", recipientQuery)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="email-send-recipient-empty">
                      {contacts.length > 0
                        ? "No hay coincidencias para esa búsqueda."
                        : "No hay contactos en el tracker."}
                    </div>
                  )}

                  {activeRecipient ? (
                    <div className="email-send-recipient-detail">
                      <div className="email-send-recipient-detail-title">Detalle</div>
                      <div className="email-send-recipient-meta-grid">
                        <div>
                          <span>Nombre</span>
                          <strong>{renderHighlightedText(activeRecipient.name || "—", recipientQuery)}</strong>
                        </div>
                        <div>
                          <span>Email</span>
                          <strong>{renderHighlightedText(activeRecipient.email || "—", recipientQuery)}</strong>
                        </div>
                        <div>
                          <span>Empresa</span>
                          <strong>{renderHighlightedText(activeRecipient.company || "—", recipientQuery)}</strong>
                        </div>
                      </div>
                      <div className="email-send-recipient-detail-title">Campos personalizados</div>
                      {activeRecipientCustomFieldRows.length > 0 ? (
                        <div className="email-send-recipient-fields">
                          {activeRecipientCustomFieldRows.map((field) => (
                            <div key={`${activeRecipient.email}-${field.key}`} className="email-send-recipient-field-row">
                              <div className="email-send-recipient-field-key">{renderHighlightedText(field.key, recipientQuery)}</div>
                              <div className="email-send-recipient-field-value">
                                {field.links.length > 0 ? (
                                  <div className="email-send-recipient-link-list">
                                    {field.links.map((item, idx) => (
                                      <a
                                        key={`${field.key}-${item.url}-${idx}`}
                                        href={item.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="email-send-recipient-link"
                                        title={item.url}
                                      >
                                        {renderHighlightedText(item.label, recipientQuery)}
                                      </a>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="email-send-recipient-field-value-text">
                                    {renderHighlightedText(field.readableValue, recipientQuery)}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="email-send-recipient-fields-empty">Sin campos personalizados.</div>
                      )}
                    </div>
                  ) : null}
                </aside>
                <button
                  type="button"
                  className={cx(
                    "email-send-panel-toggle",
                    isRecipientPanelCollapsed && "is-collapsed"
                  )}
                  onClick={() => setIsRecipientPanelCollapsed((prev) => !prev)}
                  aria-controls={`${block.id}-recipient-panel`}
                  aria-expanded={!isRecipientPanelCollapsed}
                  aria-label={
                    isRecipientPanelCollapsed
                      ? "Mostrar panel de destinatarios"
                      : "Ocultar panel de destinatarios"
                  }
                  title={
                    isRecipientPanelCollapsed
                      ? "Mostrar panel de destinatarios"
                      : "Ocultar panel de destinatarios"
                  }
                >
                  <span className="email-send-panel-toggle-icon-wrap" aria-hidden="true">
                    <span className="email-send-panel-toggle-icon">
                      <PanelChevronIcon />
                    </span>
                  </span>
                </button>

                <div className="email-send-compose-main">
                  <div className="email-send-template-grid">
                    {isReadTab ? (
                      <div className="email-send-read-placeholder">
                          <div className="email-send-read-toolbar-head">
                            <div className="email-send-recipient-title-row">
                              <strong>Mensajes</strong>
                              <span>
                                {readMessagesLoading
                                  ? "Cargando…"
                                  : readMessagesRefreshing
                                    ? "Actualizando…"
                                    : `${readMessages.length} cargados`}
                              </span>
                            </div>
                          <div className="email-send-read-toolbar">
                            <div className="email-send-read-toolbar-row">
                            <div className="tracker-search email-send-read-search email-send-read-search-inline" ref={readSearchRef}>
                              <div
                                className={cx(
                                  "tracker-search-input-wrap email-send-read-search-wrap",
                                  activeReadSearchScopeLabel && "has-scope-prefix"
                                )}
                              >
                                <span className="tracker-search-leading" aria-hidden="true">
                                  <svg viewBox="0 0 20 20">
                                    <path d="M12.9 14 17 18.1l1.1-1.1-4.1-4.1a6.5 6.5 0 1 0-1.1 1.1ZM4.5 8.5a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" />
                                  </svg>
                                </span>
                                {activeReadSearchScopeLabel ? (
                                  <span className="email-send-read-search-prefix">{activeReadSearchScopeLabel}:</span>
                                ) : null}
                                <input
                                  value={readSearchQuery}
                                  onFocus={() => {
                                    setReadFiltersOpen(false);
                                    if (!readSearchQuery.trim() && readSearchHistory.length > 0) {
                                      setReadSearchHistoryOpen(true);
                                    }
                                  }}
                                  onClick={() => {
                                    setReadFiltersOpen(false);
                                    if (!readSearchQuery.trim() && readSearchHistory.length > 0) {
                                      setReadSearchHistoryOpen(true);
                                    }
                                  }}
                                  onBlur={() => {
                                    commitReadSearchQuery(readSearchQuery);
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      commitReadSearchQuery(readSearchQuery);
                                      setReadSearchHistoryOpen(false);
                                    }
                                  }}
                                  onChange={(event) => {
                                    const nextValue = event.target.value;
                                    setReadSearchQuery(nextValue);
                                    if (nextValue.trim()) {
                                      setReadSearchHistoryOpen(false);
                                    } else if (readSearchHistory.length > 0) {
                                      setReadSearchHistoryOpen(true);
                                    }
                                  }}
                                  placeholder="Company, role, location..."
                                  className="tracker-search-input"
                                />
                                <div className="tracker-search-actions">
                                  {readSearchQuery.trim() ? (
                                    <button
                                      type="button"
                                      className="tracker-search-clear"
                                      onClick={() => {
                                        commitReadSearchQuery(readSearchQuery);
                                        setReadSearchQuery("");
                                        if (readSearchHistory.length > 0) {
                                          setReadSearchHistoryOpen(true);
                                        }
                                      }}
                                      aria-label="Limpiar búsqueda de correos"
                                      title="Limpiar búsqueda de correos"
                                    >
                                      <svg viewBox="0 0 20 20" aria-hidden="true">
                                        <path d="M5.22 5.22a.75.75 0 0 1 1.06 0L10 8.94l3.72-3.72a.75.75 0 0 1 1.06 1.06L11.06 10l3.72 3.72a.75.75 0 0 1-1.06 1.06L10 11.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06L8.94 10 5.22 6.28a.75.75 0 0 1 0-1.06Z" />
                                      </svg>
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className={`tracker-search-filter ${readFiltersOpen ? "open" : ""} ${
                                      hasAdvancedReadFilters ? "active" : ""
                                    }`}
                                    onClick={() => {
                                      setReadSearchHistoryOpen(false);
                                      setReadFiltersOpen((prev) => !prev);
                                    }}
                                    aria-label="Filter"
                                    aria-expanded={readFiltersOpen}
                                  >
                                    <svg viewBox="0 0 20 20" aria-hidden="true">
                                      <path d="M3 4.75A.75.75 0 0 1 3.75 4h12.5a.75.75 0 0 1 .56 1.25L12 10.54V15a.75.75 0 0 1-1.2.6l-2-1.5a.75.75 0 0 1-.3-.6v-2.96L3.19 5.25A.75.75 0 0 1 3 4.75Z" />
                                    </svg>
                                  </button>
                                </div>
                              </div>

                              {readSearchHistoryOpen && !readSearchQuery.trim() && readSearchHistory.length > 0 ? (
                                <div
                                  className="tracker-search-popover email-send-read-search-popover email-send-read-history-popover"
                                  role="listbox"
                                  aria-label="Historial de búsqueda"
                                >
                                  <div className="email-send-read-history-title">Historial reciente</div>
                                  <div className="email-send-read-history-list">
                                    {readSearchHistory.map((entry, idx) => (
                                      <button
                                        type="button"
                                        key={`${entry.scope}-${entry.query}-${idx}`}
                                        className="email-send-read-history-item"
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => {
                                          setReadSearchScope(entry.scope);
                                          setReadSearchQuery(entry.query);
                                          commitReadSearchQuery(entry.query, entry.scope);
                                          setReadSearchHistoryOpen(false);
                                        }}
                                      >
                                        {formatReadSearchHistoryEntry(entry)}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ) : null}

                              {readFiltersOpen ? (
                                <div
                                  className="tracker-search-popover email-send-read-search-popover email-send-read-filter-popover"
                                  role="dialog"
                                  aria-label="Filter"
                                >
                                  <div className="email-send-read-history-title">Filtrar por</div>
                                  <div className="email-send-read-filter-options">
                                    {READ_SEARCH_SCOPE_OPTIONS.map((option) => (
                                      <button
                                        key={option.value}
                                        type="button"
                                        className={`email-send-read-filter-option ${
                                          readSearchScope === option.value ? "is-active" : ""
                                        }`}
                                        onClick={() => {
                                          setReadSearchScope(option.value);
                                          setReadFiltersOpen(false);
                                        }}
                                      >
                                        {option.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>

                            <label className="email-send-read-select-wrap">
                              <span className="email-send-read-select-label">Enviados por</span>
                              <select
                                className="email-send-input email-send-read-select"
                                value={readAccountFilter}
                                onChange={(event) => {
                                  const nextValue = event.target.value;
                                  setReadAccountFilter(nextValue);
                                  patchBlockProps({ readAccountFilter: nextValue });
                                }}
                              >
                                {readAccountOptions.map((value) => (
                                  <option key={value} value={value}>
                                    {value === READ_MAILBOX_ALL ? "Todas las cuentas" : value}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="email-send-read-select-wrap">
                              <span className="email-send-read-select-label">Bandeja</span>
                              <select
                                className="email-send-input email-send-read-select"
                                value={readMailbox}
                                onChange={(event) => {
                                  patchBlockProps({ folder: normalizeMailboxName(event.target.value) });
                                }}
                              >
                                {readFolderOptions.map((folder) => (
                                  <option key={folder} value={folder}>
                                    {formatMailboxLabel(folder)}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        </div>
                        </div>

                        {readBodyPrefetching ? (
                          <div className="email-send-read-prefetch">Cargando cuerpos para filtros avanzados…</div>
                        ) : null}

                        {!selectedContactEmails.length ? (
                          <div className="email-send-read-empty">
                            Selecciona uno o más contactos en la barra lateral para leer sus correos.
                          </div>
                        ) : readMessagesLoading && readMessages.length === 0 ? (
                          <div className="email-send-read-empty">Cargando correos de los contactos seleccionados…</div>
                        ) : readMessagesRefreshing && readMessages.length === 0 ? (
                          <div className="email-send-read-empty">Sin caché local. Sincronizando correos con el proveedor…</div>
                        ) : readMessagesError && readMessages.length === 0 ? (
                          <div className="email-send-read-empty is-error">{readMessagesError}</div>
                        ) : readMessages.length === 0 ? (
                          <div className="email-send-read-empty">No hay correos cargados para los contactos seleccionados.</div>
                        ) : filteredReadMessages.length === 0 ? (
                          <div className="email-send-read-empty">No hay correos que coincidan con la búsqueda actual.</div>
                        ) : (
                          <div className="email-send-read-layout">
                            <aside className="email-send-read-list">
                              <div className="email-send-read-list-head">
                                <strong>{filteredReadMessages.length} correos</strong>
                                <span>
                                  {selectedContactEmails.length} contacto{selectedContactEmails.length !== 1 ? "s" : ""}
                                </span>
                              </div>
                              <div className="email-send-read-list-scroll">
                                {filteredReadMessages.map((message) => {
                                  const isActive = activeReadMessage?.message_id === message.message_id;
                                  const bodySnippet = getVisibleReadMessageSnippet(message);
                                  return (
                                    <button
                                      type="button"
                                      key={message.message_id}
                                      className={cx("email-send-read-message-item", isActive && "is-active")}
                                      onClick={() => setActiveReadMessageId(message.message_id)}
                                    >
                                      <div className="email-send-read-message-top">
                                        <strong>{renderHighlightedText(message.subject || "Sin asunto", getReadHighlightQueryForField("subject"))}</strong>
                                        <span>{formatMessageTimestamp(message.date)}</span>
                                      </div>
                                      <div className="email-send-read-message-meta">
                                        <span>{renderHighlightedText(message.from_address || "Sin remitente", getReadHighlightQueryForField("from"))}</span>
                                        <span>{formatMailboxLabel(message.folder || "")}</span>
                                      </div>
                                      <div className="email-send-read-message-contact">
                                        {renderHighlightedText(message.contactName || message.contactEmail || "Contacto", getReadHighlightQueryForField("contact"))}
                                      </div>
                                      {bodySnippet ? (
                                        <p className="email-send-read-message-snippet">
                                          {renderHighlightedText(bodySnippet, getReadHighlightQueryForField("message"))}
                                        </p>
                                      ) : (
                                        <p className="email-send-read-message-snippet is-empty">Sin vista previa</p>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </aside>

                            {renderReadMessageDetail(false)}
                          </div>
                        )}

                        {readMessagesError && readMessages.length > 0 ? (
                          <div className="email-send-read-warning">{readMessagesError}</div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="email-send-field-stack">
                        {!editorWindowOpen ? renderBodyComposerEditor(false) : null}
                      </div>
                    )}
                  </div>

                  {!isReadTab ? (
                    preview ? (
                      <div className="email-send-preview">
                        <div className="email-send-preview-head">
                          <span className="email-send-preview-icon" aria-hidden="true">
                            <PreviewEyeIcon />
                          </span>
                          <div className="email-send-preview-head-copy">
                            <span className="email-send-preview-kicker">Vista previa</span>
                            <strong className="email-send-preview-contact">
                              {previewSource?.name || previewSource?.email || "contacto activo"}
                            </strong>
                          </div>
                        </div>
                        <div className="email-send-preview-content">
                          <div className="email-send-preview-subject">
                            <span className="email-send-preview-label">Asunto</span>
                            <p>{preview.subject}</p>
                          </div>
                          <div
                            className="page-builder-text email-send-preview-body"
                            dangerouslySetInnerHTML={{ __html: previewBodyHtml }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="email-send-preview-empty">
                        Selecciona al menos un destinatario para ver la vista previa personalizada.
                      </div>
                    )
                  ) : null}
                </div>
              </div>
              )}

              {sendResult ? (
                <div className="email-send-result">
                  <div className="email-send-result-metrics">
                    <span className="email-send-result-pill is-sent">
                      {sendResult.sent} enviados
                    </span>
                    <span className={cx("email-send-result-pill", sendResult.errors > 0 ? "is-error" : "is-muted")}>
                      {sendResult.errors} errores
                    </span>
                    <span className="email-send-result-pill is-batch">
                      Lote: {sendResult.batch_id}
                    </span>
                  </div>
                  {sendResult.warning ? (
                    <div className="email-send-result-warning">⚠️ {sendResult.warning}</div>
                  ) : null}
                  <div className="table-scroll email-send-table-wrap">
                    <table className="table email-send-table">
                      <thead>
                        <tr>
                          <th>Email</th>
                          <th>Estado</th>
                          <th>Detalle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sendResult.results.map((row, idx) => (
                          <tr key={`${row.email}-${idx}`}>
                            <td className="email-send-email-cell">{row.email || "—"}</td>
                            <td>
                              <StatusPill ok={row.status === "sent"} label={row.status} />
                            </td>
                            <td className="email-send-message-cell">{row.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </section>
          </div>
        )}

        {libraryOpen && typeof document !== "undefined"
          ? createPortal(
              <div
                className="email-send-library-backdrop"
                role="dialog"
                aria-modal="true"
                aria-label="Biblioteca de correos"
                onClick={() => setLibraryOpen(false)}
              >
                <div className="email-send-library-modal" onClick={(event) => event.stopPropagation()}>
                  <div className="email-send-library-header">
                    <div className="email-send-library-header-copy">
                      <strong>Biblioteca de correos</strong>
                      <span>Reutiliza, edita o elimina borradores y envíos previos.</span>
                    </div>
                    <button
                      type="button"
                      className="ghost email-send-library-close"
                      onClick={() => setLibraryOpen(false)}
                      aria-label="Cerrar biblioteca"
                    >
                      Cerrar
                    </button>
                  </div>

                  <div className="email-send-library-tabs">
                    <button
                      type="button"
                      className={cx("email-send-library-tab", libraryTab === "drafts" && "is-active")}
                      onClick={() => setLibraryTab("drafts")}
                    >
                      Borradores ({draftEntries.length})
                    </button>
                    <button
                      type="button"
                      className={cx("email-send-library-tab", libraryTab === "sent" && "is-active")}
                      onClick={() => setLibraryTab("sent")}
                    >
                      Enviados ({sentEntries.length})
                    </button>
                  </div>

                  <div className="email-send-library-list">
                    {activeLibraryEntries.length > 0 ? (
                      activeLibraryEntries.map((entry) => {
                        const isEditing = libraryEditingEntryId === entry.id;
                        const bodyPreview = htmlToPreviewText(entry.bodyTemplate);
                        return (
                          <article key={entry.id} className="email-send-library-card">
                            <div className="email-send-library-card-head">
                              <strong title={entry.subjectTemplate || "Sin asunto"}>
                                {entry.subjectTemplate.trim() || "Sin asunto"}
                              </strong>
                              <span>{formatLibraryTimestamp(entry.updatedAt)}</span>
                            </div>
                            <div className="email-send-library-card-meta">
                              <span>{entry.recipientCount} destinatario{entry.recipientCount !== 1 ? "s" : ""}</span>
                              <span>{entry.attachments.length} adjunto{entry.attachments.length !== 1 ? "s" : ""}</span>
                            </div>

                            {isEditing ? (
                              <div className="email-send-library-edit">
                                <input
                                  className="email-send-input email-send-library-edit-input"
                                  value={libraryEditSubject}
                                  onChange={(event) => setLibraryEditSubject(event.target.value)}
                                  placeholder="Asunto"
                                />
                                <textarea
                                  className="email-send-library-edit-body"
                                  value={libraryEditBody}
                                  onChange={(event) => setLibraryEditBody(event.target.value)}
                                  rows={6}
                                  placeholder="Contenido del correo"
                                />
                              </div>
                            ) : (
                              <p className="email-send-library-card-body">
                                {bodyPreview || "Sin contenido."}
                              </p>
                            )}

                            <div className="email-send-library-card-actions">
                              {isEditing ? (
                                <>
                                  <button type="button" className="primary" onClick={saveLibraryEntryEdit}>
                                    Guardar cambios
                                  </button>
                                  <button type="button" className="ghost" onClick={cancelLibraryEntryEdit}>
                                    Cancelar
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button type="button" className="ghost" onClick={() => applyLibraryEntry(entry)}>
                                    Reusar
                                  </button>
                                  <button type="button" className="ghost" onClick={() => startLibraryEntryEdit(entry)}>
                                    Editar
                                  </button>
                                  <button
                                    type="button"
                                    className="ghost"
                                    onClick={() => void removeLibraryEntry(entry, libraryTab)}
                                  >
                                    Eliminar
                                  </button>
                                </>
                              )}
                            </div>
                          </article>
                        );
                      })
                    ) : (
                      <div className="email-send-library-empty">
                        {libraryTab === "drafts"
                          ? "No hay borradores guardados."
                          : "No hay correos enviados en el historial."}
                      </div>
                    )}
                  </div>
                </div>
              </div>,
              document.body
            )
          : null}

        {editorWindowOpen && typeof document !== "undefined"
          ? createPortal(
              <div
                className="email-send-editor-window-backdrop"
                role="dialog"
                aria-modal="true"
                aria-label="Editor ampliado"
                onClick={() => setEditorWindowOpen(false)}
              >
                <div className="email-send-editor-window" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    className="ghost email-send-editor-window-close"
                    onClick={() => setEditorWindowOpen(false)}
                    aria-label="Cerrar editor ampliado"
                  >
                    Cerrar
                  </button>
                  <div className="email-send-editor-window-body">
                    {renderBodyComposerEditor(true)}
                  </div>
                </div>
              </div>,
              document.body
            )
          : null}

        {readBodyWindowOpen && typeof document !== "undefined"
          ? createPortal(
              <div
                className="email-send-editor-window-backdrop"
                role="dialog"
                aria-modal="true"
                aria-label="Correo ampliado"
                onClick={() => setReadBodyWindowOpen(false)}
              >
                <div
                  className="email-send-editor-window email-send-read-window"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    className="ghost email-send-editor-window-close"
                    onClick={() => setReadBodyWindowOpen(false)}
                    aria-label="Cerrar correo ampliado"
                  >
                    Cerrar
                  </button>
                  <div className="email-send-read-window-body">
                    {renderReadMessageDetail(true)}
                  </div>
                </div>
              </div>,
              document.body
            )
          : null}

        {isConfigOpen && typeof document !== "undefined"
          ? createPortal(
              <div
                className="modal-backdrop"
                role="dialog"
                aria-modal="true"
                aria-label="Configurar correo"
                onClick={() => setIsConfigOpen(false)}
              >
                <div className="modal email-block-config-modal" onClick={(event) => event.stopPropagation()}>
                  <header className="modal-header">
                    <div>
                      <h2>Configurar correo</h2>
                      <p>Activa o desactiva lectura y envío en este bloque.</p>
                    </div>
                    <button className="ghost" type="button" onClick={() => setIsConfigOpen(false)} aria-label="Cerrar">
                      ×
                    </button>
                  </header>

                  <div className="email-block-config-list">
                    <label className="email-block-config-row">
                      <div className="email-block-config-copy">
                        <strong>Enviar correos activado</strong>
                        <span>Muestra la pestaña de envío y el editor de campañas en este bloque.</span>
                      </div>
                      <span className="email-block-config-switch">
                        <input
                          type="checkbox"
                          checked={isSendModeEnabled}
                          onChange={(event) => {
                            setConfigError(null);
                            patchBlockProps({ sendEnabled: event.target.checked });
                          }}
                        />
                        <span className="email-block-config-switch-ui" aria-hidden="true" />
                      </span>
                    </label>

                    <div className="email-block-config-row email-block-config-row-stacked">
                      <div className="email-block-config-row-head">
                        <div className="email-block-config-copy">
                          <strong>Leer correos activado</strong>
                          <span>Muestra la pestaña de lectura. Si la lectura global estaba aparcada, se intenta activarla.</span>
                        </div>
                        <span className="email-block-config-switch">
                          <input
                            type="checkbox"
                            checked={isReadModeEnabled}
                            onChange={(event) => {
                              void updateReadModeEnabled(event.target.checked);
                            }}
                          />
                          <span className="email-block-config-switch-ui" aria-hidden="true" />
                        </span>
                      </div>

                      <div className="email-block-config-extra">
                        <label className="email-block-config-field">
                          <span className="email-block-config-field-label">Buscar mensajes desde</span>
                          <div className="email-block-config-field-row">
                            <input
                              type="date"
                              className="email-send-input email-block-config-input"
                              value={readStartDate}
                              onChange={(event) => {
                                setConfigError(null);
                                patchBlockProps({ readStartDate: normalizeReadStartDate(event.target.value) });
                              }}
                            />
                            <button
                              type="button"
                              className="ghost email-block-config-field-action"
                              onClick={() => {
                                setConfigError(null);
                                patchBlockProps({ readStartDate: "" });
                              }}
                              disabled={!readStartDate}
                            >
                              Desde siempre
                            </button>
                          </div>
                          <span className="email-block-config-field-note">Vacío = busca todo el histórico disponible.</span>
                        </label>

                        <label className="email-block-config-inline-toggle">
                          <div className="email-block-config-copy">
                            <strong>Contenido completo del mensaje</strong>
                            <span>Carga HTML y muestra adjuntos visibles dentro del correo. Consume más lectura IMAP.</span>
                          </div>
                          <span className="email-block-config-switch">
                            <input
                              type="checkbox"
                              checked={readLoadFullContent}
                              onChange={(event) => {
                                setConfigError(null);
                                patchBlockProps({ readLoadFullContent: event.target.checked });
                              }}
                            />
                            <span className="email-block-config-switch-ui" aria-hidden="true" />
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>

                  {syncingGlobalRead ? (
                    <div className="email-block-config-note">Activando lectura global…</div>
                  ) : null}
                  {configError ? (
                    <div className="email-block-config-note is-error">{configError}</div>
                  ) : null}
                </div>
              </div>,
              document.body
            )
          : null}
      </BlockPanel>
    );
  }
};
