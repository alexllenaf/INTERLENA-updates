import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ApplicationForm from "../components/ApplicationForm";
import BlockPanel from "../components/BlockPanel";
import ContactsEditor from "../components/ContactsEditor";
import DocumentsDropzone from "../components/DocumentsDropzone";
import StarRating from "../components/StarRating";
import { DateCell, DateTimeCell, TextCell } from "../components/TableCells";
import { deleteDocument, documentDownloadUrl, downloadExcel, openExternal, uploadDocuments } from "../api";
import { useI18n } from "../i18n";
import { useAppData } from "../state";
import { Application, Contact, CustomProperty, DocumentFile } from "../types";
import {
  formatFileSize,
  formatUploadedAt,
  generateId,
  parseDocumentLinks,
  toDateInputValue,
  toDateTimeLocalValue
} from "../utils";

const BASE_COLUMN_ORDER = [
  "company_name",
  "position",
  "job_type",
  "location",
  "stage",
  "outcome",
  "application_date",
  "interview_datetime",
  "followup_date",
  "interview_rounds",
  "interview_type",
  "interviewers",
  "company_score",
  "contacts",
  "last_round_cleared",
  "total_rounds",
  "my_interview_score",
  "improvement_areas",
  "skill_to_upgrade",
  "job_description",
  "notes",
  "documents_links",
  "favorite"
];

const COLUMN_LABELS: Record<string, string> = {
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
  documents_links: "Documents / Links",
  favorite: "Favorite"
};

const COLUMN_TYPES: Record<string, string> = {
  company_name: "Text",
  position: "Text",
  job_type: "Select",
  location: "Text",
  stage: "Select",
  outcome: "Select",
  application_date: "Date",
  interview_datetime: "Date & Time",
  followup_date: "Date",
  interview_rounds: "Number",
  interview_type: "Text",
  interviewers: "Text",
  company_score: "Rating",
  contacts: "Contacts",
  last_round_cleared: "Text",
  total_rounds: "Number",
  my_interview_score: "Rating",
  improvement_areas: "Long Text",
  skill_to_upgrade: "Long Text",
  job_description: "Long Text",
  notes: "Long Text",
  documents_links: "Text",
  favorite: "Checkbox"
};

const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
  company_name: 200,
  position: 190,
  job_type: 150,
  location: 160,
  stage: 140,
  outcome: 140,
  application_date: 160,
  interview_datetime: 180,
  followup_date: 160,
  interview_rounds: 150,
  interview_type: 160,
  interviewers: 200,
  company_score: 160,
  contacts: 260,
  last_round_cleared: 170,
  total_rounds: 150,
  my_interview_score: 150,
  improvement_areas: 220,
  skill_to_upgrade: 220,
  job_description: 240,
  notes: 240,
  documents_links: 220,
  favorite: 100
};

const DEFAULT_COLUMN_WIDTH = 160;
const SELECTION_COLUMN_WIDTH = 22;
const ACTIONS_COLUMN_WIDTH = 96;
const COLUMN_MENU_WIDTH = 240;
const COLUMN_MENU_GUTTER = 12;
const COLUMN_MENU_OFFSET = 6;
const COLUMN_MENU_X_OFFSET = -6;
const COLUMN_MENU_HEIGHT_ESTIMATE = 420;
const COLUMN_MENU_ANIM_MS = 160;

type ColumnMenuView = "root" | "type" | "filter" | "sort" | "group" | "calculate";

type ColumnCalcOp =
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

type SelectOption = {
  label: string;
  display?: string;
  color?: string;
  editable?: boolean;
};

type SelectCellProps = {
  value?: string | null;
  options: SelectOption[];
  placeholder?: string;
  onCommit: (next: string) => void;
  onCreateOption?: (label: string) => Promise<string | null> | string | null;
  onUpdateOptionColor?: (label: string, color: string) => Promise<void> | void;
  onDeleteOption?: (label: string) => Promise<void> | void;
  onReorderOption?: (fromLabel: string, toLabel: string) => Promise<void> | void;
};

function getContrastColor(hex?: string): string {
  if (!hex) return "var(--text)";
  const cleaned = hex.replace("#", "");
  if (cleaned.length !== 6) return "var(--text)";
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 160 ? "#1b1f24" : "#ffffff";
}

const DEFAULT_OPTION_COLOR = "#E2E8F0";

const SelectCell: React.FC<SelectCellProps> = ({
  value,
  options,
  placeholder = "—",
  onCommit,
  onCreateOption,
  onUpdateOptionColor,
  onDeleteOption,
  onReorderOption
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dragOption, setDragOption] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Keep drag source in a ref so drop handlers still work if React doesn't re-render during drag.
  const dragOptionRef = React.useRef<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const resolved = value ?? "";
  const currentOption = options.find((opt) => opt.label === resolved);
  const displayValue = resolved ? currentOption?.display ?? resolved : placeholder;
  const color = currentOption?.color;

  React.useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (event.target instanceof Node && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setMenuFor(null);
      setDragOption(null);
      setDragOver(null);
      dragOptionRef.current = null;
    }
  }, [open]);

  const normalizedQuery = query.trim();
  const queryLower = normalizedQuery.toLowerCase();
  const exactMatch = normalizedQuery
    ? options.find((opt) => opt.label.toLowerCase() === queryLower)
    : undefined;
  const filteredOptions = normalizedQuery
    ? options.filter((opt) => {
        const label = (opt.display ?? opt.label).toLowerCase();
        return label.includes(queryLower);
      })
    : options;
  const canManage = Boolean(onUpdateOptionColor || onDeleteOption);

  const handleSelect = (label: string) => {
    onCommit(label);
    setOpen(false);
    setMenuFor(null);
  };

  const handleCreate = async () => {
    if (!normalizedQuery) return;
    if (exactMatch) {
      handleSelect(exactMatch.label);
      return;
    }
    if (!onCreateOption) return;
    const created = await Promise.resolve(onCreateOption(normalizedQuery));
    if (created) {
      handleSelect(created);
    }
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleCreate();
    }
    if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="select-cell" ref={containerRef}>
      <button
        className={`select-trigger ${open ? "open" : ""}`}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span
          className="select-pill"
          style={color ? { backgroundColor: color, color: getContrastColor(color) } : undefined}
        >
          {displayValue}
        </span>
        <span className="select-caret">▾</span>
      </button>
      {open && (
        <div className="select-menu">
          {onCreateOption && (
            <div className="select-search">
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Search or create..."
              />
            </div>
          )}
          <div className="select-options">
            {onCreateOption && normalizedQuery && !exactMatch && (
              <div className="select-option select-create" onClick={handleCreate}>
                <span className="select-swatch" />
                <span className="select-label">Create "{normalizedQuery}"</span>
              </div>
            )}
            {filteredOptions.length === 0 && (!normalizedQuery || exactMatch) && (
              <div className="select-empty">No options</div>
            )}
            {filteredOptions.map((option) => {
              const isSelected = option.label === resolved;
              const showMenu = canManage && option.editable !== false;
              const optionColor = option.color;
              const optionDisplay = (option.display ?? option.label) || placeholder;
              const draggable = Boolean(onReorderOption && option.editable !== false);
              const isDragOver = dragOver === option.label;
              return (
                <React.Fragment key={option.label || "empty"}>
                  <div
                    className={`select-option ${isSelected ? "selected" : ""} ${
                      draggable ? "draggable" : ""
                    } ${isDragOver ? "drag-over" : ""}`}
                    onClick={() => handleSelect(option.label)}
                    draggable={draggable}
                    onDragStart={(event) => {
                      if (!draggable) return;
                      event.dataTransfer.setData("text/plain", option.label);
                      event.dataTransfer.effectAllowed = "move";
                      dragOptionRef.current = option.label;
                      setDragOption(option.label);
                    }}
                    onDragOver={(event) => {
                      if (!draggable || !dragOptionRef.current) return;
                      event.preventDefault();
                      setDragOver(option.label);
                    }}
                    onDragLeave={() => {
                      if (dragOver === option.label) setDragOver(null);
                    }}
                    onDrop={(event) => {
                      const fromLabel = dragOptionRef.current;
                      if (!fromLabel || !draggable || fromLabel === option.label) return;
                      event.preventDefault();
                      onReorderOption?.(fromLabel, option.label);
                      dragOptionRef.current = null;
                      setDragOption(null);
                      setDragOver(null);
                    }}
                    onDragEnd={() => {
                      dragOptionRef.current = null;
                      setDragOption(null);
                      setDragOver(null);
                    }}
                  >
                    {draggable && <span className="select-drag">||</span>}
                    <span
                      className="select-swatch"
                      style={{ backgroundColor: optionColor || DEFAULT_OPTION_COLOR }}
                    />
                    <span className="select-label">{optionDisplay}</span>
                    {isSelected && <span className="select-check">✓</span>}
                    {showMenu && (
                      <button
                        className="select-more"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuFor((prev) => (prev === option.label ? null : option.label));
                        }}
                        aria-label="Option actions"
                      >
                        ⋯
                      </button>
                    )}
                  </div>
                  {showMenu && menuFor === option.label && (
                    <div
                      className="select-option-actions"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {onUpdateOptionColor && (
                        <label className="select-color-row">
                          <span>Color</span>
                          <input
                            type="color"
                            value={optionColor || DEFAULT_OPTION_COLOR}
                            onChange={(event) => onUpdateOptionColor(option.label, event.target.value)}
                          />
                        </label>
                      )}
                      {onDeleteOption && (
                        <button
                          className="danger"
                          type="button"
                          onClick={() => {
                            onDeleteOption(option.label);
                            setMenuFor(null);
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

type CheckboxCellProps = {
  checked: boolean;
  onCommit: (next: boolean) => void;
};

const CheckboxCell: React.FC<CheckboxCellProps> = ({ checked, onCommit }) => (
  <input
    className="cell-checkbox"
    type="checkbox"
    checked={checked}
    onChange={(event) => onCommit(event.target.checked)}
  />
);

type NumberCellProps = {
  value?: number | null;
  step?: number;
  min?: number;
  max?: number;
  onCommit: (next: number | null) => void;
};

const NumberCell: React.FC<NumberCellProps> = ({ value, step, min, max, onCommit }) => {
  const [draft, setDraft] = useState(
    value === null || value === undefined ? "" : String(value)
  );

  useEffect(() => {
    setDraft(value === null || value === undefined ? "" : String(value));
  }, [value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      if (value !== null && value !== undefined) onCommit(null);
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed)) {
      setDraft(value === null || value === undefined ? "" : String(value));
      return;
    }
    if (parsed === value) return;
    onCommit(parsed);
  };

  return (
    <input
      className="cell-number"
      type="number"
      value={draft}
      step={step}
      min={min}
      max={max}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
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

type ContactsCellProps = {
  contacts?: Contact[] | null;
  onCommit: (next: Contact[]) => void;
};

const ContactsCell: React.FC<ContactsCellProps> = ({ contacts, onCommit }) => {
  const list = contacts ?? [];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
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
    const next: Contact[] = [
      ...list,
      {
        id: generateId(),
        name,
        information: draft.information.trim() || undefined,
        email: draft.email.trim() || undefined,
        phone: draft.phone.trim() || undefined
      }
    ];
    onCommit(next);
    resetDraft();
    setOpen(false);
  };

  const handleRemove = (id: string) => {
    const next = list.filter((contact) => contact.id !== id);
    if (next.length === list.length) return;
    onCommit(next);
  };

  return (
    <div className="contacts-cell">
      <div className="contacts-list">
        {list.length === 0 && <span className="contacts-empty">—</span>}
        {list.map((contact) => (
          <div className="contact-item" key={contact.id}>
            <div className="contact-name">{contact.name}</div>
            <div className="contact-meta">
              {contact.information && <span>{contact.information}</span>}
              {contact.email && <span>{contact.email}</span>}
              {contact.phone && <span>{contact.phone}</span>}
            </div>
            <button
              className="contact-remove"
              type="button"
              onClick={() => handleRemove(contact.id)}
              aria-label="Remove contact"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button className="link-button" type="button" onClick={() => setOpen((prev) => !prev)}>
        + Add contact
      </button>
      {open && (
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

type LinkItem = {
  id: string;
  label: string;
  url: string;
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

const parseContactsPropValue = (raw: string): Contact[] => {
  const arr = parseJsonArraySafe(raw);
  const list: Contact[] = [];
  arr.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const obj = item as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name.trim() : "";
    if (!name) return;
    const id = typeof obj.id === "string" && obj.id.trim() ? obj.id : generateId();
    const information = typeof obj.information === "string" ? obj.information.trim() : "";
    const email = typeof obj.email === "string" ? obj.email.trim() : "";
    const phone = typeof obj.phone === "string" ? obj.phone.trim() : "";
    list.push({
      id,
      name,
      information: information || undefined,
      email: email || undefined,
      phone: phone || undefined
    });
  });
  return list;
};

const parseLinksPropValue = (raw: string): LinkItem[] => {
  const arr = parseJsonArraySafe(raw);
  const list: LinkItem[] = [];
  arr.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const obj = item as Record<string, unknown>;
    const urlRaw =
      typeof obj.url === "string"
        ? obj.url
        : typeof obj.href === "string"
          ? obj.href
          : typeof obj.link === "string"
            ? obj.link
            : "";
    const url = normalizeUrl(urlRaw);
    if (!url) return;
    const labelRaw =
      typeof obj.label === "string"
        ? obj.label
        : typeof obj.name === "string"
          ? obj.name
          : "";
    const label = labelRaw.trim() || guessLinkLabel(url);
    const id = typeof obj.id === "string" && obj.id.trim() ? obj.id : generateId();
    list.push({ id, label, url });
  });
  return list;
};

const parseDocumentsPropValue = (raw: string): string[] => {
  const arr = parseJsonArraySafe(raw);
  const ids: string[] = [];
  arr.forEach((item) => {
    if (typeof item === "string") {
      const cleaned = item.trim();
      if (cleaned) ids.push(cleaned);
      return;
    }
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const id = typeof obj.id === "string" ? obj.id.trim() : "";
      if (id) ids.push(id);
    }
  });
  return Array.from(new Set(ids));
};

type LinksCellProps = {
  links?: LinkItem[] | null;
  onCommit: (next: LinkItem[]) => void;
};

const normalizeUrl = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

const guessLinkLabel = (url: string): string => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\\./i, "");
    return host || url;
  } catch {
    return url;
  }
};

const LinksCell: React.FC<LinksCellProps> = ({ links, onCommit }) => {
  const list = links ?? [];
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ label: "", url: "" });

  const resetDraft = () => setDraft({ label: "", url: "" });

  const handleAdd = () => {
    const url = normalizeUrl(draft.url);
    if (!url) return;
    const label = draft.label.trim() || guessLinkLabel(url);
    const next: LinkItem[] = [...list, { id: generateId(), label, url }];
    onCommit(next);
    resetDraft();
    setOpen(false);
  };

  const handleRemove = (id: string) => {
    const next = list.filter((link) => link.id !== id);
    if (next.length === list.length) return;
    onCommit(next);
  };

  return (
    <div className="links-cell">
      <div className="links-list">
        {list.length === 0 && <span className="links-empty">—</span>}
        {list.map((link) => (
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
            <button
              className="link-remove"
              type="button"
              onClick={() => handleRemove(link.id)}
              aria-label="Remove link"
              title="Remove"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button className="link-button" type="button" onClick={() => setOpen((prev) => !prev)}>
        + Add link
      </button>
      {open && (
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

type DocumentsPropertyCellProps = {
  files: DocumentFile[];
  selectedIds: string[];
  onCommit: (nextIds: string[]) => void;
  onUploadAndAttach: (files: File[], signal: AbortSignal) => Promise<void>;
  onOpenFile: (file: DocumentFile) => void;
};

const DocumentsPropertyCell: React.FC<DocumentsPropertyCellProps> = ({
  files,
  selectedIds,
  onCommit,
  onUploadAndAttach,
  onOpenFile
}) => {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const uploadTimeoutRef = useRef<number | null>(null);

  const cancelUpload = useCallback(() => {
    if (uploadTimeoutRef.current) {
      window.clearTimeout(uploadTimeoutRef.current);
      uploadTimeoutRef.current = null;
    }
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
  }, []);

  useEffect(() => cancelUpload, [cancelUpload]);

  const toggleId = (id: string) => {
    if (selectedIds.includes(id)) {
      onCommit(selectedIds.filter((item) => item !== id));
      return;
    }
    onCommit([...selectedIds, id]);
  };

  const startUpload = async (nextFiles: File[]) => {
    if (!nextFiles || nextFiles.length === 0) return;
    if (uploading) return;
    cancelUpload();
    setUploadError(null);
    setUploading(true);
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    // Avoid infinite hangs if the backend never responds.
    uploadTimeoutRef.current = window.setTimeout(() => controller.abort(), 120_000);
    try {
      await onUploadAndAttach(nextFiles, controller.signal);
      setOpen(false);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setUploadError("Upload cancelled.");
      } else {
        const message = error instanceof Error ? error.message : "Upload failed.";
        setUploadError(message || "Upload failed.");
      }
    } finally {
      setUploading(false);
      if (uploadTimeoutRef.current) {
        window.clearTimeout(uploadTimeoutRef.current);
        uploadTimeoutRef.current = null;
      }
      uploadAbortRef.current = null;
    }
  };

  const fileById = useMemo(() => {
    const map = new Map<string, DocumentFile>();
    files.forEach((file) => map.set(file.id, file));
    return map;
  }, [files]);

  const showInlineDropzone = files.length === 0 && selectedIds.length === 0;

  return (
    <div className="docs-prop-cell">
      {showInlineDropzone ? (
        <div className={`docs-prop-inline-dropzone ${uploading ? "disabled" : ""}`}>
          <DocumentsDropzone
            onUpload={(fileList) => void startUpload(Array.from(fileList || []))}
          />
        </div>
      ) : (
        <div className="doc-chips">
          {selectedIds.length === 0 && <span className="docs-prop-empty">—</span>}
          {selectedIds.map((id) => {
            const file = fileById.get(id) || null;
            const label = file?.name || "Unknown document";
            return (
              <div className="docs-prop-chip" key={id}>
                {file ? (
                  <button
                    className="doc-chip doc-button"
                    type="button"
                    onClick={() => onOpenFile(file)}
                    title={file.name}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M5 2.5h6l4 4V17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Zm6 1.5H6v12h8V8h-3V4Z" />
                    </svg>
                    <span>
                      {file.name}
                      {file.size ? ` ${formatFileSize(file.size)}` : ""}
                    </span>
                  </button>
                ) : (
                  <span className="doc-chip" title={id}>
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M5 2.5h6l4 4V17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Zm6 1.5H6v12h8V8h-3V4Z" />
                    </svg>
                    <span>{label}</span>
                  </span>
                )}
                <button
                  className="docs-prop-remove"
                  type="button"
                  onClick={() => toggleId(id)}
                  aria-label="Remove document"
                  title="Remove"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
      {uploadError && !open && <div className="docs-prop-error">{uploadError}</div>}
      <button className="link-button" type="button" onClick={() => setOpen((prev) => !prev)}>
        + Add document
      </button>
      {open && (
        <div className="docs-prop-popover">
          <div className="docs-prop-actions">
            <button
              className="ghost small"
              type="button"
              onClick={() => setOpen(false)}
            >
              Done
            </button>
            {uploading && (
              <button className="ghost small" type="button" onClick={cancelUpload}>
                Cancel
              </button>
            )}
          </div>
          <div className={`docs-prop-popover-dropzone ${uploading ? "disabled" : ""}`}>
            <DocumentsDropzone
              onUpload={(fileList) => void startUpload(Array.from(fileList || []))}
            />
          </div>
          {uploadError && <div className="docs-prop-error">{uploadError}</div>}
          <div className="docs-prop-list">
            {files.length === 0 ? null : (
              files.map((file) => (
                <button
                  key={file.id}
                  className={`docs-prop-row ${selectedIds.includes(file.id) ? "selected" : ""}`}
                  type="button"
                  onClick={() => toggleId(file.id)}
                >
                  <span className="docs-prop-row-check">{selectedIds.includes(file.id) ? "✓" : ""}</span>
                  <span className="docs-prop-row-name">{file.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

type RatingCellProps = {
  value?: number | null;
  onCommit: (next: number | null) => void;
};

const RatingCell: React.FC<RatingCellProps> = ({ value, onCommit }) => (
  <StarRating value={value ?? null} onChange={onCommit} size="sm" step={0.5} />
);

const ColumnMenuIcon: React.FC<{ viewBox?: string; children: React.ReactNode }> = ({
  viewBox = "0 0 20 20",
  children
}) => (
  <svg aria-hidden="true" viewBox={viewBox} className="column-menu-icon">
    {children}
  </svg>
);

const ColumnMenuChevronRight = () => (
  <ColumnMenuIcon viewBox="0 0 16 16">
    <path d="M6.722 3.238a.625.625 0 1 0-.884.884L9.716 8l-3.878 3.878a.625.625 0 0 0 .884.884l4.32-4.32a.625.625 0 0 0 0-.884z" />
  </ColumnMenuIcon>
);

const TrackerPage: React.FC = () => {
  const { t } = useI18n();
  const {
    applications,
    settings,
    createApplication,
    updateApplication,
    deleteApplication,
    saveSettings,
    refresh
  } = useAppData();
  const [query, setQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [showColumns, setShowColumns] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Application | null>(null);
	  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
	  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
	  const [sortConfig, setSortConfig] = useState<{ column: string; direction: "asc" | "desc" } | null>(null);
	  const [groupBy, setGroupBy] = useState<string | null>(null);
	  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
	  const [columnCalcs, setColumnCalcs] = useState<Record<string, ColumnCalcOp>>({});
	  const [columnMenu, setColumnMenu] = useState<{ col: string; rename: string; filter: string } | null>(null);
	  const [columnMenuPos, setColumnMenuPos] = useState<{ top: number; left: number } | null>(null);
	  const [columnMenuPlacement, setColumnMenuPlacement] = useState<"top" | "bottom">("bottom");
	  const [columnMenuVisible, setColumnMenuVisible] = useState(false);
	  const [columnMenuView, setColumnMenuView] = useState<ColumnMenuView>("root");
	  const [columnMenuActiveIndex, setColumnMenuActiveIndex] = useState(0);
	  const columnMenuRef = useRef<HTMLDivElement | null>(null);
	  const columnMenuListRef = useRef<HTMLDivElement | null>(null);
	  const columnMenuFilterInputRef = useRef<HTMLInputElement | null>(null);
	  const columnMenuAnchorRef = useRef<HTMLElement | null>(null);
	  const columnMenuCloseTimerRef = useRef<number | null>(null);
	  const [detailApp, setDetailApp] = useState<Application | null>(null);
  const detailIdRef = useRef<number | null>(null);
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
  const [bulkStage, setBulkStage] = useState("");
  const [bulkOutcome, setBulkOutcome] = useState("");
  const [draggedCol, setDraggedCol] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  // Keep drag source in a ref so drop handlers work reliably even if React doesn't re-render during drag.
  const draggedColRef = useRef<string | null>(null);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const widthsRef = useRef<Record<string, number>>({});
  const [columnOrderDraft, setColumnOrderDraft] = useState<string[]>([]);
  const [resizing, setResizing] = useState<{
    col: string;
    startX: number;
    startWidth: number;
  } | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const contactsToString = (list?: Contact[] | null) =>
    (list || [])
      .map((contact) =>
        [contact.name, contact.information, contact.email, contact.phone]
          .filter(Boolean)
          .join(" ")
      )
      .join(" | ");

  const documentsToString = (list?: { name?: string | null }[] | null) =>
    (list || [])
      .map((file) => file?.name || "")
      .filter(Boolean)
      .join(" | ");

  const handleDownloadDocument = (appId: number, fileId: string) => {
    void openExternal(documentDownloadUrl(appId, fileId));
  };

  const customPropByKey = useMemo(() => {
    const map = new Map<string, CustomProperty>();
    (settings?.custom_properties || []).forEach((prop) => map.set(prop.key, prop));
    return map;
  }, [settings]);

  const filtered = useMemo(() => {
    return applications.filter((app) => {
      const matchesQuery =
        !query ||
        app.company_name.toLowerCase().includes(query.toLowerCase()) ||
        app.position.toLowerCase().includes(query.toLowerCase()) ||
        (app.location || "").toLowerCase().includes(query.toLowerCase());
      const matchesStage = stageFilter === "all" || app.stage === stageFilter;
      const matchesOutcome = outcomeFilter === "all" || app.outcome === outcomeFilter;
      const matchesColumnFilters = Object.entries(columnFilters).every(([col, raw]) => {
        const needle = raw.trim().toLowerCase();
        if (!needle) return true;
        if (col.startsWith("prop__")) {
          const key = col.replace("prop__", "");
          const value = app.properties?.[key] || "";
          const prop = customPropByKey.get(key) || null;
          if (prop?.type === "contacts") {
            return contactsToString(parseContactsPropValue(value)).toLowerCase().includes(needle);
          }
          if (prop?.type === "links") {
            const list = parseLinksPropValue(value);
            const text = list.map((link) => link.label || link.url).filter(Boolean).join(" | ");
            return text.toLowerCase().includes(needle);
          }
          if (prop?.type === "documents") {
            const ids = parseDocumentsPropValue(value);
            if (ids.length === 0) return false;
            const fileMap = new Map((app.documents_files || []).map((file) => [file.id, file.name]));
            const names = ids.map((id) => fileMap.get(id) || "").filter(Boolean);
            const text = (names.length ? names : ids).join(" | ");
            return text.toLowerCase().includes(needle);
          }
          return value.toLowerCase().includes(needle);
        }
        if (col === "contacts") {
          return contactsToString(app.contacts).toLowerCase().includes(needle);
        }
        if (col === "documents_files") {
          return documentsToString(app.documents_files).toLowerCase().includes(needle);
        }
        const value = (app as Record<string, unknown>)[col];
        if (value === null || value === undefined) return false;
        return String(value).toLowerCase().includes(needle);
      });
      return matchesQuery && matchesStage && matchesOutcome && matchesColumnFilters;
    });
  }, [applications, query, stageFilter, outcomeFilter, columnFilters, customPropByKey]);

  const sorted = useMemo(() => {
    if (!sortConfig) return filtered;
    const { column, direction } = sortConfig;
    const dir = direction === "asc" ? 1 : -1;
    const getValue = (app: Application) => {
      if (column.startsWith("prop__")) {
        const key = column.replace("prop__", "");
        const raw = app.properties?.[key] || "";
        const prop = customPropByKey.get(key) || null;
        const kind = prop?.type || "select";
        if (kind === "number" || kind === "rating") {
          if (!raw) return 0;
          const parsed = Number(raw);
          return Number.isNaN(parsed) ? 0 : parsed;
        }
        if (kind === "checkbox") return raw === "true" ? 1 : 0;
        if (kind === "date") {
          if (!raw) return 0;
          const parsed = Date.parse(raw);
          return Number.isNaN(parsed) ? 0 : parsed;
        }
        if (kind === "contacts") return contactsToString(parseContactsPropValue(raw)).toLowerCase();
        if (kind === "links") {
          const list = parseLinksPropValue(raw);
          return list.map((link) => link.label || link.url).filter(Boolean).join(" | ").toLowerCase();
        }
        if (kind === "documents") {
          const ids = parseDocumentsPropValue(raw);
          const fileMap = new Map((app.documents_files || []).map((file) => [file.id, file.name]));
          const names = ids.map((id) => fileMap.get(id) || "").filter(Boolean);
          const text = (names.length ? names : ids).join(" | ");
          return text.toLowerCase();
        }
        return raw.toLowerCase();
      }
      if (column === "contacts") {
        return contactsToString(app.contacts).toLowerCase();
      }
      if (column === "documents_files") {
        return documentsToString(app.documents_files).toLowerCase();
      }
      const value = (app as Record<string, unknown>)[column];
      if (value === null || value === undefined) return "";
      if (["application_date", "followup_date", "interview_datetime"].includes(column)) {
        const dateValue = typeof value === "string" ? Date.parse(value) : 0;
        return Number.isNaN(dateValue) ? 0 : dateValue;
      }
      if (typeof value === "number") return value;
      if (typeof value === "boolean") return value ? 1 : 0;
      return String(value).toLowerCase();
    };
    return [...filtered].sort((a, b) => {
      const aVal = getValue(a);
      const bVal = getValue(b);
      if (aVal < bVal) return -1 * dir;
      if (aVal > bVal) return 1 * dir;
      return 0;
    });
  }, [filtered, sortConfig, customPropByKey]);

  const visibleIds = useMemo(() => sorted.map((app) => app.id), [sorted]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

  const computeColumnMenuPos = useCallback((anchor: HTMLElement, menuEl?: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const menuWidth = menuEl?.offsetWidth || COLUMN_MENU_WIDTH;
    const menuHeight = menuEl?.offsetHeight || COLUMN_MENU_HEIGHT_ESTIMATE;

    const maxLeft = Math.max(COLUMN_MENU_GUTTER, window.innerWidth - menuWidth - COLUMN_MENU_GUTTER);
    const left = clamp(rect.left + COLUMN_MENU_X_OFFSET, COLUMN_MENU_GUTTER, maxLeft);

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const shouldFlip = spaceBelow < menuHeight + COLUMN_MENU_OFFSET && spaceAbove > spaceBelow;
    const placement: "top" | "bottom" = shouldFlip ? "top" : "bottom";

    const maxTop = Math.max(COLUMN_MENU_GUTTER, window.innerHeight - menuHeight - COLUMN_MENU_GUTTER);
    const rawTop =
      placement === "bottom"
        ? rect.bottom + COLUMN_MENU_OFFSET
        : rect.top - menuHeight - COLUMN_MENU_OFFSET;
    const top = clamp(rawTop, COLUMN_MENU_GUTTER, maxTop);

    return { top, left, placement };
  }, []);

  useEffect(() => {
    if (!selectAllRef.current) return;
    selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
  }, [someVisibleSelected, allVisibleSelected]);

  useEffect(() => {
    if (!settings) return;
    setColumnWidths(settings.column_widths || {});
  }, [settings]);

  useEffect(() => {
    widthsRef.current = columnWidths;
  }, [columnWidths]);

  useEffect(() => {
    if (!resizing || !settings) return;
    const handleMove = (event: MouseEvent) => {
      const delta = event.clientX - resizing.startX;
      const nextWidth = Math.max(90, resizing.startWidth + delta);
      setColumnWidths((prev) => ({ ...prev, [resizing.col]: nextWidth }));
    };
    const handleUp = () => {
      setResizing(null);
      saveSettings({ ...settings, column_widths: widthsRef.current });
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
  }, [resizing, saveSettings, settings]);

  useEffect(() => {
    const el = tableScrollRef.current;
    if (!el) return;
    const update = () => setViewportHeight(el.clientHeight);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!columnMenu) return;
    const handleOutside = (event: MouseEvent) => {
      if (!columnMenuRef.current) return;
      if (event.target instanceof Node && !columnMenuRef.current.contains(event.target)) {
        closeColumnMenu();
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [columnMenu]);

  useEffect(() => {
    return () => {
      if (columnMenuCloseTimerRef.current) {
        window.clearTimeout(columnMenuCloseTimerRef.current);
        columnMenuCloseTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
  if (!columnMenu) return;
  // Don't steal focus from inputs while the user is typing; only autofocus when opening the menu.
  if (columnMenuView === "filter") return;

  const raf = window.requestAnimationFrame(() => {
    setColumnMenuVisible(true);
    // Only focus the list if focus isn't already inside the menu.
    const active = document.activeElement;
    const insideMenu = active && columnMenuRef.current ? columnMenuRef.current.contains(active) : false;
    if (!insideMenu) {
      columnMenuListRef.current?.focus();
        }
  });
  return () => window.cancelAnimationFrame(raf);
}, [columnMenu?.col, columnMenuView]);

  useEffect(() => {
    if (!columnMenu || columnMenuView !== "filter") return;
    const raf = window.requestAnimationFrame(() => {
      columnMenuFilterInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [columnMenu, columnMenuView]);

  useEffect(() => {
    if (!columnMenu || !columnMenuAnchorRef.current) return;
    const updatePosition = () => {
      if (!columnMenuAnchorRef.current) return;
      const pos = computeColumnMenuPos(columnMenuAnchorRef.current, columnMenuRef.current || undefined);
      setColumnMenuPlacement(pos.placement);
      setColumnMenuPos({ top: pos.top, left: pos.left });
    };
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [columnMenu, columnMenuView, computeColumnMenuPos]);

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

  useEffect(() => {
    if (!tableScrollRef.current) return;
    tableScrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [query, stageFilter, outcomeFilter, columnFilters, sortConfig]);

  if (!settings) {
    return <div className="empty">Loading settings...</div>;
  }

  const detailDocuments = detailApp?.documents_files || [];
  const detailContacts = detailApp?.contacts || [];

  const normalizeLabel = (label: string) => label.trim().toLowerCase();
  const findExistingLabel = (list: string[], label: string) =>
    list.find((item) => normalizeLabel(item) === normalizeLabel(label)) || null;

  const buildSelectOptions = (
    currentValue: string | null | undefined,
    labels: string[],
    colorMap?: Record<string, string>,
    includeEmpty = false
  ): SelectOption[] => {
    const options: SelectOption[] = [];
    if (includeEmpty) {
      options.push({ label: "", display: "—", editable: false });
    }
    const seen = new Set<string>();
    labels.forEach((label) => {
      if (seen.has(label)) return;
      options.push({ label, color: colorMap?.[label], editable: true });
      seen.add(label);
    });
    if (currentValue && !seen.has(currentValue)) {
      const extra = { label: currentValue, color: colorMap?.[currentValue], editable: false };
      if (includeEmpty) {
        options.splice(1, 0, extra);
      } else {
        options.unshift(extra);
      }
    }
    return options;
  };

  const buildCustomOptions = (
    currentValue: string | null | undefined,
    propOptions: { label: string; color?: string }[],
    includeEmpty = false
  ): SelectOption[] => {
    const options: SelectOption[] = [];
    if (includeEmpty) {
      options.push({ label: "", display: "—", editable: false });
    }
    const seen = new Set<string>();
    propOptions.forEach((opt) => {
      if (seen.has(opt.label)) return;
      options.push({ label: opt.label, color: opt.color, editable: true });
      seen.add(opt.label);
    });
    if (currentValue && !seen.has(currentValue)) {
      const extra = { label: currentValue, color: undefined, editable: false };
      if (includeEmpty) {
        options.splice(1, 0, extra);
      } else {
        options.unshift(extra);
      }
    }
    return options;
  };

  const reorderList = (list: string[], fromLabel: string, toLabel: string) => {
    if (fromLabel === toLabel) return list;
    const next = [...list];
    const fromIndex = next.indexOf(fromLabel);
    const toIndex = next.indexOf(toLabel);
    if (fromIndex < 0 || toIndex < 0) return list;
    next.splice(fromIndex, 1);
    next.splice(toIndex, 0, fromLabel);
    return next;
  };

  const reorderOptions = (
    list: { label: string; color?: string }[],
    fromLabel: string,
    toLabel: string
  ) => {
    if (fromLabel === toLabel) return list;
    const next = [...list];
    const fromIndex = next.findIndex((opt) => opt.label === fromLabel);
    const toIndex = next.findIndex((opt) => opt.label === toLabel);
    if (fromIndex < 0 || toIndex < 0) return list;
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return next;
  };

  const addStageOption = async (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return null;
    const existing = findExistingLabel(settings.stages, trimmed);
    if (existing) return existing;
    const nextStages = [...settings.stages, trimmed];
    const nextColors = { ...settings.stage_colors };
    if (!nextColors[trimmed]) {
      nextColors[trimmed] = DEFAULT_OPTION_COLOR;
    }
    await saveSettings({ ...settings, stages: nextStages, stage_colors: nextColors });
    return trimmed;
  };

  const updateStageColor = async (label: string, color: string) => {
    const nextColors = { ...settings.stage_colors, [label]: color };
    await saveSettings({ ...settings, stage_colors: nextColors });
  };

  const deleteStageOption = async (label: string) => {
    const nextStages = settings.stages.filter((stage) => stage !== label);
    const { [label]: _, ...restColors } = settings.stage_colors;
    await saveSettings({ ...settings, stages: nextStages, stage_colors: restColors });
  };

  const reorderStageOption = async (fromLabel: string, toLabel: string) => {
    const nextStages = reorderList(settings.stages, fromLabel, toLabel);
    if (nextStages === settings.stages) return;
    await saveSettings({ ...settings, stages: nextStages });
  };

  const addOutcomeOption = async (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return null;
    const existing = findExistingLabel(settings.outcomes, trimmed);
    if (existing) return existing;
    const nextOutcomes = [...settings.outcomes, trimmed];
    const nextColors = { ...settings.outcome_colors };
    if (!nextColors[trimmed]) {
      nextColors[trimmed] = DEFAULT_OPTION_COLOR;
    }
    await saveSettings({ ...settings, outcomes: nextOutcomes, outcome_colors: nextColors });
    return trimmed;
  };

  const updateOutcomeColor = async (label: string, color: string) => {
    const nextColors = { ...settings.outcome_colors, [label]: color };
    await saveSettings({ ...settings, outcome_colors: nextColors });
  };

  const deleteOutcomeOption = async (label: string) => {
    const nextOutcomes = settings.outcomes.filter((outcome) => outcome !== label);
    const { [label]: _, ...restColors } = settings.outcome_colors;
    await saveSettings({ ...settings, outcomes: nextOutcomes, outcome_colors: restColors });
  };

  const reorderOutcomeOption = async (fromLabel: string, toLabel: string) => {
    const nextOutcomes = reorderList(settings.outcomes, fromLabel, toLabel);
    if (nextOutcomes === settings.outcomes) return;
    await saveSettings({ ...settings, outcomes: nextOutcomes });
  };

  const addJobTypeOption = async (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return null;
    const existing = findExistingLabel(settings.job_types, trimmed);
    if (existing) return existing;
    const nextTypes = [...settings.job_types, trimmed];
    const nextColors = { ...(settings.job_type_colors || {}) };
    if (!nextColors[trimmed]) {
      nextColors[trimmed] = DEFAULT_OPTION_COLOR;
    }
    await saveSettings({ ...settings, job_types: nextTypes, job_type_colors: nextColors });
    return trimmed;
  };

  const updateJobTypeColor = async (label: string, color: string) => {
    const nextColors = { ...(settings.job_type_colors || {}), [label]: color };
    await saveSettings({ ...settings, job_type_colors: nextColors });
  };

  const deleteJobTypeOption = async (label: string) => {
    const nextTypes = settings.job_types.filter((job) => job !== label);
    const { [label]: _, ...restColors } = settings.job_type_colors || {};
    await saveSettings({ ...settings, job_types: nextTypes, job_type_colors: restColors });
  };

  const reorderJobTypeOption = async (fromLabel: string, toLabel: string) => {
    const nextTypes = reorderList(settings.job_types, fromLabel, toLabel);
    if (nextTypes === settings.job_types) return;
    await saveSettings({ ...settings, job_types: nextTypes });
  };

  const addCustomOption = async (propKey: string, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return null;
    const propIndex = settings.custom_properties.findIndex((prop) => prop.key === propKey);
    if (propIndex < 0) return null;
    const prop = settings.custom_properties[propIndex];
    const existing = prop.options.find((opt) => normalizeLabel(opt.label) === normalizeLabel(trimmed));
    if (existing) return existing.label;
    const nextOptions = [...prop.options, { label: trimmed, color: DEFAULT_OPTION_COLOR }];
    const nextProps = [...settings.custom_properties];
    nextProps[propIndex] = { ...prop, options: nextOptions };
    await saveSettings({ ...settings, custom_properties: nextProps });
    return trimmed;
  };

  const updateCustomOptionColor = async (propKey: string, label: string, color: string) => {
    const propIndex = settings.custom_properties.findIndex((prop) => prop.key === propKey);
    if (propIndex < 0) return;
    const prop = settings.custom_properties[propIndex];
    const nextOptions = prop.options.map((opt) =>
      opt.label === label ? { ...opt, color } : opt
    );
    const nextProps = [...settings.custom_properties];
    nextProps[propIndex] = { ...prop, options: nextOptions };
    await saveSettings({ ...settings, custom_properties: nextProps });
  };

  const deleteCustomOption = async (propKey: string, label: string) => {
    const propIndex = settings.custom_properties.findIndex((prop) => prop.key === propKey);
    if (propIndex < 0) return;
    const prop = settings.custom_properties[propIndex];
    const nextOptions = prop.options.filter((opt) => opt.label !== label);
    const nextProps = [...settings.custom_properties];
    nextProps[propIndex] = { ...prop, options: nextOptions };
    await saveSettings({ ...settings, custom_properties: nextProps });
  };

  const reorderCustomOption = async (propKey: string, fromLabel: string, toLabel: string) => {
    const propIndex = settings.custom_properties.findIndex((prop) => prop.key === propKey);
    if (propIndex < 0) return;
    const prop = settings.custom_properties[propIndex];
    const nextOptions = reorderOptions(prop.options, fromLabel, toLabel);
    if (nextOptions === prop.options) return;
    const nextProps = [...settings.custom_properties];
    nextProps[propIndex] = { ...prop, options: nextOptions };
    await saveSettings({ ...settings, custom_properties: nextProps });
  };

  useEffect(() => {
    if (stageFilter !== "all" && !settings.stages.includes(stageFilter)) {
      setStageFilter("all");
    }
  }, [settings.stages, stageFilter]);

  useEffect(() => {
    if (outcomeFilter !== "all" && !settings.outcomes.includes(outcomeFilter)) {
      setOutcomeFilter("all");
    }
  }, [settings.outcomes, outcomeFilter]);

  useEffect(() => {
    setSelectedIds((prev) => {
      const appIds = new Set(applications.map((app) => app.id));
      const next = new Set<number>();
      prev.forEach((id) => {
        if (appIds.has(id)) next.add(id);
      });
      return next;
    });
  }, [applications]);

  const customColumnLabels = useMemo(() => {
    const map: Record<string, string> = {};
    settings.custom_properties.forEach((prop) => {
      map[`prop__${prop.key}`] = prop.name;
    });
    return map;
  }, [settings.custom_properties]);

  const baseColumnOrder = useMemo(() => {
    const base = settings.table_columns?.length ? settings.table_columns : BASE_COLUMN_ORDER;
    const ordered: string[] = [];
    base.forEach((col) => {
      if (!ordered.includes(col)) ordered.push(col);
    });
    BASE_COLUMN_ORDER.forEach((col) => {
      if (!ordered.includes(col)) ordered.push(col);
    });
    settings.custom_properties.forEach((prop) => {
      const key = `prop__${prop.key}`;
      if (!ordered.includes(key)) ordered.push(key);
    });
    return ordered;
  }, [settings.table_columns, settings.custom_properties]);

  useEffect(() => {
    setColumnOrderDraft(baseColumnOrder);
  }, [baseColumnOrder]);

  const hiddenFromSettings = useMemo(
    () => new Set(settings.hidden_columns || []),
    [settings.hidden_columns]
  );
  const visibleFromSettings = useMemo(
    () => baseColumnOrder.filter((col) => !hiddenFromSettings.has(col)),
    [baseColumnOrder, hiddenFromSettings]
  );

  const [visibleDraft, setVisibleDraft] = useState<string[]>(visibleFromSettings);

  useEffect(() => {
    setVisibleDraft(visibleFromSettings);
  }, [visibleFromSettings]);

  const orderedVisible = useMemo(
    () => columnOrderDraft.filter((col) => visibleDraft.includes(col)),
    [columnOrderDraft, visibleDraft]
  );

  const columnLabelOverrides = settings.column_labels || {};
  const labelForColumn = (col: string) =>
    columnLabelOverrides[col] || customColumnLabels[col] || COLUMN_LABELS[col] || col;

  const saveColumnsDraft = useCallback(() => {
  const nextHidden = columnOrderDraft.filter((col) => !visibleDraft.includes(col));
  saveSettings({
    ...settings,
    table_columns: columnOrderDraft,
    hidden_columns: nextHidden
  });
}, [columnOrderDraft, visibleDraft, saveSettings, settings]);

const prevShowColumnsRef = useRef(showColumns);
const columnsAccordionRef = useRef<HTMLDivElement | null>(null);

const columnsAnchorRef = useRef<HTMLButtonElement | null>(null);
const [columnsMenuPos, setColumnsMenuPos] = useState<{ top: number; left: number } | null>(null);
const [columnsMenuVisible, setColumnsMenuVisible] = useState(false);

const computeColumnsMenuPos = useCallback((anchor: HTMLElement) => {
  const rect = anchor.getBoundingClientRect();
  const menuWidth = COLUMN_MENU_WIDTH;
  const menuHeight = COLUMN_MENU_HEIGHT_ESTIMATE;

  const maxLeft = Math.max(COLUMN_MENU_GUTTER, window.innerWidth - menuWidth - COLUMN_MENU_GUTTER);
  const left = clamp(rect.left + COLUMN_MENU_X_OFFSET, COLUMN_MENU_GUTTER, maxLeft);

  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const shouldFlip = spaceBelow < menuHeight + COLUMN_MENU_OFFSET && spaceAbove > spaceBelow;

  const maxTop = Math.max(
    COLUMN_MENU_GUTTER,
    window.innerHeight - menuHeight - COLUMN_MENU_GUTTER
  );

  const rawTop = shouldFlip
    ? rect.top - menuHeight - COLUMN_MENU_OFFSET
    : rect.bottom + COLUMN_MENU_OFFSET;

  const top = clamp(rawTop, COLUMN_MENU_GUTTER, maxTop);

  return { top, left };
}, [clamp]);

const openColumnsMenu = () => {
  const anchor = columnsAnchorRef.current;
  if (!anchor) return;
  setColumnsMenuVisible(false);
  setColumnsMenuPos(computeColumnsMenuPos(anchor));
  setShowColumns(true);
};

const closeColumnsMenu = () => {
  setColumnsMenuVisible(false);
  setShowColumns(false);
};

const toggleColumnVisibility = (col: string) => {
  setVisibleDraft((prev) => {
    if (prev.includes(col)) return prev.filter((item) => item !== col);
    return [...prev, col];
  });
};

useEffect(() => {
  const prev = prevShowColumnsRef.current;
  if (prev && !showColumns) {
    saveColumnsDraft(); // autosave al cerrar
  }
  prevShowColumnsRef.current = showColumns;
}, [showColumns, saveColumnsDraft]);

useEffect(() => {
  if (!showColumns) {
    setColumnsMenuPos(null);
    return;
  }
  const anchor = columnsAnchorRef.current;
  if (!anchor) return;

  const update = () => setColumnsMenuPos(computeColumnsMenuPos(anchor));
  update();

  window.addEventListener("scroll", update, true);
  window.addEventListener("resize", update);

  const raf = window.requestAnimationFrame(() => setColumnsMenuVisible(true));
  return () => {
    window.removeEventListener("scroll", update, true);
    window.removeEventListener("resize", update);
    window.cancelAnimationFrame(raf);
  };
}, [showColumns, computeColumnsMenuPos]);

useEffect(() => {
  if (!showColumns) return;

  const onMouseDown = (event: MouseEvent) => {
    const menuEl = columnsAccordionRef.current;
    const anchorEl = columnsAnchorRef.current;
    if (!menuEl && !anchorEl) return;
    if (event.target instanceof Node) {
      const insideMenu = menuEl ? menuEl.contains(event.target) : false;
      const insideAnchor = anchorEl ? anchorEl.contains(event.target) : false;
      if (!insideMenu && !insideAnchor) {
        closeColumnsMenu();
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") closeColumnsMenu();
  };

  document.addEventListener("mousedown", onMouseDown);
  document.addEventListener("keydown", onKeyDown);
  return () => {
    document.removeEventListener("mousedown", onMouseDown);
    document.removeEventListener("keydown", onKeyDown);
  };
}, [showColumns]);

  const density = settings.table_density || "comfortable";
  const rowHeight = density === "compact" ? 36 : 44;

  const getColumnWidth = (col: string) =>
    columnWidths[col] || DEFAULT_COLUMN_WIDTHS[col] || DEFAULT_COLUMN_WIDTH;

  const getColumnType = (col: string) => {
    if (col.startsWith("prop__")) {
      const key = col.replace("prop__", "");
      const prop = settings.custom_properties.find((item) => item.key === key);
      const type = prop?.type || "select";
      if (type === "text") return "Text";
      if (type === "number") return "Number";
      if (type === "date") return "Date";
      if (type === "checkbox") return "Checkbox";
      if (type === "rating") return "Rating";
      return "Select";
    }
    return COLUMN_TYPES[col] || "Text";
  };

  const closeColumnMenuImmediate = () => {
    if (columnMenuCloseTimerRef.current) {
      window.clearTimeout(columnMenuCloseTimerRef.current);
      columnMenuCloseTimerRef.current = null;
    }
    setColumnMenu(null);
    setColumnMenuPos(null);
    setColumnMenuPlacement("bottom");
    setColumnMenuVisible(false);
    setColumnMenuView("root");
    setColumnMenuActiveIndex(0);
    columnMenuAnchorRef.current = null;
  };

  const closeColumnMenu = () => {
    if (!columnMenu) return;
    columnMenuAnchorRef.current?.focus?.();
    setColumnMenuVisible(false);
    if (columnMenuCloseTimerRef.current) {
      window.clearTimeout(columnMenuCloseTimerRef.current);
    }
    columnMenuCloseTimerRef.current = window.setTimeout(() => {
      closeColumnMenuImmediate();
    }, COLUMN_MENU_ANIM_MS);
  };

  const openColumnMenu = (col: string, anchor: HTMLElement) => {
    if (columnMenuCloseTimerRef.current) {
      window.clearTimeout(columnMenuCloseTimerRef.current);
      columnMenuCloseTimerRef.current = null;
    }
    columnMenuAnchorRef.current = anchor;
    setColumnMenuView("root");
    setColumnMenuActiveIndex(0);
    setColumnMenuVisible(false);
    const pos = computeColumnMenuPos(anchor);
    setColumnMenuPlacement(pos.placement);
    setColumnMenuPos({ top: pos.top, left: pos.left });
    setColumnMenu({
      col,
      rename: labelForColumn(col),
      filter: columnFilters[col] || ""
    });
  };

	  const applyColumnRename = async () => {
	    if (!columnMenu) return;
	    const nextLabel = columnMenu.rename.trim();
	    if (!nextLabel) return;
	    if (columnMenu.col.startsWith("prop__")) {
	      const key = columnMenu.col.replace("prop__", "");
	      const idx = settings.custom_properties.findIndex((prop) => prop.key === key);
	      if (idx >= 0) {
	        if (nextLabel === settings.custom_properties[idx].name) return;
	        const nextProps = [...settings.custom_properties];
	        nextProps[idx] = { ...nextProps[idx], name: nextLabel };
	        await saveSettings({ ...settings, custom_properties: nextProps });
	      }
	    } else {
	      const baseLabel = COLUMN_LABELS[columnMenu.col];
	      const currentOverride = (settings.column_labels || {})[columnMenu.col];
	      if (!currentOverride) {
	        const currentEffective = baseLabel || columnMenu.col;
	        if (nextLabel === currentEffective) return;
	      } else if (nextLabel === currentOverride && (!baseLabel || currentOverride !== baseLabel)) {
	        return;
	      }
	      const nextLabels = { ...(settings.column_labels || {}) };
	      if (baseLabel && baseLabel === nextLabel) {
	        delete nextLabels[columnMenu.col];
	      } else {
	        nextLabels[columnMenu.col] = nextLabel;
      }
      await saveSettings({ ...settings, column_labels: nextLabels });
    }
  };

	  const handleHideColumn = (col: string) => {
	    const nextVisible = visibleDraft.filter((item) => item !== col);
	    setVisibleDraft(nextVisible);
	    const nextHidden = columnOrderDraft.filter((item) => !nextVisible.includes(item));
	    saveSettings({ ...settings, hidden_columns: nextHidden });
	    setColumnFilters((prev) => ({ ...prev, [col]: "" }));
	    if (sortConfig?.column === col) {
	      setSortConfig(null);
	    }
	    closeColumnMenu();
	  };

  const handleColumnReorder = (targetCol: string) => {
    const fromCol = draggedColRef.current;
    if (!fromCol || fromCol === targetCol) return;
    const next = [...columnOrderDraft];
    const fromIndex = next.indexOf(fromCol);
    const toIndex = next.indexOf(targetCol);
    if (fromIndex < 0 || toIndex < 0) return;
    next.splice(fromIndex, 1);
    next.splice(toIndex, 0, fromCol);
    setColumnOrderDraft(next);
    saveSettings({ ...settings, table_columns: next });
    draggedColRef.current = null;
    setDraggedCol(null);
    setDragOverCol(null);
  };

  const getColumnKind = (col: string): CustomProperty["type"] => {
    if (col.startsWith("prop__")) {
      const key = col.replace("prop__", "");
      const prop = settings.custom_properties.find((item) => item.key === key);
      return prop?.type || "select";
    }
    const type = COLUMN_TYPES[col] || "Text";
    if (type === "Number") return "number";
    if (type === "Date" || type === "Date & Time") return "date";
    if (type === "Checkbox") return "checkbox";
    if (type === "Rating") return "rating";
    if (type === "Select") return "select";
    return "text";
  };

  const moveColumnToIndex = (list: string[], col: string, toIndex: number) => {
    const fromIndex = list.indexOf(col);
    if (fromIndex < 0) return list;
    const clamped = Math.max(0, Math.min(list.length - 1, toIndex));
    if (fromIndex === clamped) return list;
    const next = [...list];
    next.splice(fromIndex, 1);
    next.splice(clamped, 0, col);
    return next;
  };

  const pinColumn = (col: string) => {
    const next = moveColumnToIndex(columnOrderDraft, col, 0);
    if (next === columnOrderDraft) return;
    setColumnOrderDraft(next);
    saveSettings({ ...settings, table_columns: next });
  };

  const unpinColumn = (col: string) => {
    const next = moveColumnToIndex(columnOrderDraft, col, 1);
    if (next === columnOrderDraft) return;
    setColumnOrderDraft(next);
    saveSettings({ ...settings, table_columns: next });
  };

  const fitColumnToContent = (col: string) => {
    const sample = sorted.slice(0, 200);
    let maxLen = labelForColumn(col).length;
    sample.forEach((app) => {
      const safe = cellToString(app, col);
      maxLen = Math.max(maxLen, safe.length);
    });
    const nextWidth = Math.min(520, Math.max(90, Math.round(maxLen * 8.2 + 56)));
    setColumnWidths((prev) => ({ ...prev, [col]: nextWidth }));
    saveSettings({ ...settings, column_widths: { ...(settings.column_widths || {}), [col]: nextWidth } });
  };

  const generateUniqueCustomPropKey = () => {
    const existing = new Set(settings.custom_properties.map((prop) => prop.key));
    for (let i = 0; i < 50; i += 1) {
      const raw = generateId().replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
      const suffix = raw.slice(-8) || String(Date.now());
      const key = `p_${suffix}`;
      if (!existing.has(key)) return key;
    }
    return `p_${Date.now()}`;
  };

  const insertCustomProperty = async (anchorCol: string, side: "left" | "right") => {
    const key = generateUniqueCustomPropKey();
    const newProp: CustomProperty = { key, name: "New property", type: "select", options: [] };
    const newCol = `prop__${key}`;

    const nextProps = [...settings.custom_properties, newProp];
    const nextOrder = [...columnOrderDraft];
    const anchorIndex = nextOrder.indexOf(anchorCol);
    const insertIndex =
      anchorIndex < 0 ? nextOrder.length : side === "left" ? anchorIndex : anchorIndex + 1;
    nextOrder.splice(insertIndex, 0, newCol);

    const nextVisible = visibleDraft.includes(newCol) ? visibleDraft : [...visibleDraft, newCol];
    const nextHidden = nextOrder.filter((item) => !nextVisible.includes(item));

    setColumnOrderDraft(nextOrder);
    setVisibleDraft(nextVisible);
    await saveSettings({
      ...settings,
      custom_properties: nextProps,
      table_columns: nextOrder,
      hidden_columns: nextHidden
    });
  };

  const duplicateCustomProperty = async (col: string) => {
    if (!col.startsWith("prop__")) return;
    const key = col.replace("prop__", "");
    const idx = settings.custom_properties.findIndex((prop) => prop.key === key);
    if (idx < 0) return;
    const prop = settings.custom_properties[idx];
    const nextKey = generateUniqueCustomPropKey();
    const nextProp: CustomProperty = { ...prop, key: nextKey, name: `${prop.name} copy` };
    const nextProps = [...settings.custom_properties];
    nextProps.splice(idx + 1, 0, nextProp);

    const nextCol = `prop__${nextKey}`;
    const nextOrder = [...columnOrderDraft];
    const colIndex = nextOrder.indexOf(col);
    nextOrder.splice(colIndex < 0 ? nextOrder.length : colIndex + 1, 0, nextCol);

    const nextVisible = visibleDraft.includes(nextCol) ? visibleDraft : [...visibleDraft, nextCol];
    const nextHidden = nextOrder.filter((item) => !nextVisible.includes(item));

    setColumnOrderDraft(nextOrder);
    setVisibleDraft(nextVisible);
    await saveSettings({
      ...settings,
      custom_properties: nextProps,
      table_columns: nextOrder,
      hidden_columns: nextHidden
    });
  };

  const deleteCustomProperty = async (col: string) => {
    if (!col.startsWith("prop__")) return;
    const ok = window.confirm("Delete this property? This will remove it from your table.");
    if (!ok) return;

    const key = col.replace("prop__", "");
    const nextProps = settings.custom_properties.filter((prop) => prop.key !== key);
    const nextOrder = columnOrderDraft.filter((item) => item !== col);
    const nextVisible = visibleDraft.filter((item) => item !== col);
    const nextHidden = nextOrder.filter((item) => !nextVisible.includes(item));

    setColumnOrderDraft(nextOrder);
    setVisibleDraft(nextVisible);
    setColumnFilters((prev) => {
      const { [col]: _, ...rest } = prev;
      return rest;
    });
    setColumnCalcs((prev) => {
      const { [col]: _, ...rest } = prev;
      return rest;
    });
    if (sortConfig?.column === col) setSortConfig(null);
    if (groupBy === col) setGroupBy(null);

    await saveSettings({
      ...settings,
      custom_properties: nextProps,
      table_columns: nextOrder,
      hidden_columns: nextHidden
    });
    closeColumnMenu();
  };

  const setCustomPropertyType = async (col: string, type: CustomProperty["type"]) => {
    if (!col.startsWith("prop__")) return;
    const key = col.replace("prop__", "");
    const idx = settings.custom_properties.findIndex((prop) => prop.key === key);
    if (idx < 0) return;
    const nextProps = [...settings.custom_properties];
    nextProps[idx] = { ...nextProps[idx], type };
    await saveSettings({ ...settings, custom_properties: nextProps });
  };

  const handleBulkStage = async (value: string) => {
    if (!value) return;
    const targets = [...selectedIds];
    await Promise.all(
      targets.map((id) => updateApplication(id, { stage: value }))
    );
    setBulkStage("");
  };

  const handleBulkOutcome = async (value: string) => {
    if (!value) return;
    const targets = [...selectedIds];
    await Promise.all(
      targets.map((id) => updateApplication(id, { outcome: value }))
    );
    setBulkOutcome("");
  };

  const handleBulkDelete = async () => {
    const targets = [...selectedIds];
    await Promise.all(targets.map((id) => deleteApplication(id)));
    setSelectedIds(new Set());
  };

  const handleExportSelected = () => {
    const selected = applications.filter((app) => selectedIds.has(app.id));
    if (selected.length === 0) return;
    const columns = orderedVisible;
    const header = columns.map((col) => `"${labelForColumn(col).replace(/"/g, '""')}"`).join(",");
    const rows = selected.map((app) => {
      const values = columns.map((col) => {
        const safe = cellToString(app, col);
        return `"${safe.replace(/"/g, '""')}"`;
      });
      return values.join(",");
    });
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "selected-applications.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleCreate = async (payload: any, files: File[] = []) => {
    const created = await createApplication(payload);
    if (created && files.length > 0) {
      await uploadDocuments(created.id, files);
      await refresh();
    }
    setShowForm(false);
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

  type MenuEntry =
    | { kind: "separator"; key: string }
    | {
        kind: "item";
        key: string;
        label: string;
        icon: React.ReactNode;
        disabled?: boolean;
        submenu?: ColumnMenuView;
        end?: React.ReactNode;
        action?: () => void;
      };

  const menuCol = columnMenu?.col || "";
  const menuIsCustom = Boolean(columnMenu && menuCol.startsWith("prop__"));
  const menuPinned = Boolean(columnMenu && orderedVisible[0] === menuCol);
  const menuKind = columnMenu ? getColumnKind(menuCol) : "text";
  const currentCalc = columnMenu ? columnCalcs[menuCol] || "none" : "none";
  const filterActive = Boolean(columnMenu && (columnFilters[menuCol] || "").trim());

  const setMenuView = (next: ColumnMenuView) => {
    setColumnMenuView(next);
    setColumnMenuActiveIndex(0);
    window.requestAnimationFrame(() => {
      if (next !== "filter") columnMenuListRef.current?.focus();
    });
  };

  const iconChangeType = (
    <ColumnMenuIcon>
      <path d="M6.475 3.125a.625.625 0 1 0 0 1.25h7.975c.65 0 1.175.526 1.175 1.175v6.057l-1.408-1.408a.625.625 0 1 0-.884.884l2.475 2.475a.625.625 0 0 0 .884 0l2.475-2.475a.625.625 0 0 0-.884-.884l-1.408 1.408V5.55a2.425 2.425 0 0 0-2.425-2.425zM3.308 6.442a.625.625 0 0 1 .884 0l2.475 2.475a.625.625 0 1 1-.884.884L4.375 8.393v6.057c0 .649.526 1.175 1.175 1.175h7.975a.625.625 0 0 1 0 1.25H5.55a2.425 2.425 0 0 1-2.425-2.425V8.393L1.717 9.801a.625.625 0 1 1-.884-.884z" />
    </ColumnMenuIcon>
  );
  const iconTypeText = (
    <ColumnMenuIcon>
      <path d="M4 5.25c0-.345.28-.625.625-.625h10.75a.625.625 0 1 1 0 1.25H4.625A.625.625 0 0 1 4 5.25m0 4c0-.345.28-.625.625-.625h7.25a.625.625 0 1 1 0 1.25h-7.25A.625.625 0 0 1 4 9.25m0 4c0-.345.28-.625.625-.625h10.75a.625.625 0 1 1 0 1.25H4.625A.625.625 0 0 1 4 13.25" />
    </ColumnMenuIcon>
  );
  const iconTypeNumber = (
    <ColumnMenuIcon>
      <path d="M7.25 4.25a.625.625 0 0 1 1.23.252L8.24 5.75h3.52l.26-1.498a.625.625 0 1 1 1.23.216l-.23 1.282h1.355a.625.625 0 1 1 0 1.25h-1.58l-.7 4h1.655a.625.625 0 1 1 0 1.25H12.86l-.255 1.458a.625.625 0 0 1-1.23-.216l.216-1.242H8.06l-.255 1.458a.625.625 0 0 1-1.23-.216l.216-1.242H5.375a.625.625 0 1 1 0-1.25h1.64l.7-4H6.125a.625.625 0 1 1 0-1.25h1.81zm1.28 2.75-.7 4h3.52l.7-4z" />
    </ColumnMenuIcon>
  );
  const iconTypeSelect = (
    <ColumnMenuIcon>
      <path d="M5.5 5.5h9A1.5 1.5 0 0 1 16 7v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 13V7a1.5 1.5 0 0 1 1.5-1.5m0 1.25a.25.25 0 0 0-.25.25v6c0 .138.112.25.25.25h9a.25.25 0 0 0 .25-.25V7a.25.25 0 0 0-.25-.25zm3.4 2.2a.625.625 0 0 1 .884 0L10 9.366l.216-.216a.625.625 0 1 1 .884.884l-.658.658a.625.625 0 0 1-.884 0L8.9 10.034a.625.625 0 0 1 0-.884" />
    </ColumnMenuIcon>
  );
  const iconTypeDate = (
    <ColumnMenuIcon>
      <path d="M6.25 3.5a.625.625 0 0 1 .625.625V5h6.25v-.875a.625.625 0 1 1 1.25 0V5h.375A1.75 1.75 0 0 1 16.5 6.75v8.5A1.75 1.75 0 0 1 14.75 17h-9.5A1.75 1.75 0 0 1 3.5 15.25v-8.5A1.75 1.75 0 0 1 5.25 5h.375v-.875A.625.625 0 0 1 6.25 3.5m-1 2.75a.5.5 0 0 0-.5.5v1h10.5v-1a.5.5 0 0 0-.5-.5zm-.5 3v6a.5.5 0 0 0 .5.5h9.5a.5.5 0 0 0 .5-.5v-6z" />
    </ColumnMenuIcon>
  );
  const iconTypeCheckbox = (
    <ColumnMenuIcon>
      <path d="M6 4.75h8A1.25 1.25 0 0 1 15.25 6v8A1.25 1.25 0 0 1 14 15.25H6A1.25 1.25 0 0 1 4.75 14V6A1.25 1.25 0 0 1 6 4.75m0 1.25a.0 0 0 0-.0 0v8a.0 0 0 0 .0 0h8a.0 0 0 0 .0 0V6a.0 0 0 0-.0 0zm7.192 2.442a.625.625 0 0 1 0 .884l-3.25 3.25a.625.625 0 0 1-.884 0l-1.75-1.75a.625.625 0 1 1 .884-.884l1.308 1.308 2.808-2.808a.625.625 0 0 1 .884 0" />
    </ColumnMenuIcon>
  );
  const iconTypeRating = (
    <ColumnMenuIcon>
      <path d="M10 3.25a.75.75 0 0 1 .684.444l1.6 3.5 3.79.38a.75.75 0 0 1 .422 1.305l-2.82 2.44.82 3.66a.75.75 0 0 1-1.11.81L10 13.64 6.614 15.79a.75.75 0 0 1-1.11-.81l.82-3.66-2.82-2.44a.75.75 0 0 1 .422-1.305l3.79-.38 1.6-3.5A.75.75 0 0 1 10 3.25m0 2.59-1.02 2.23a.75.75 0 0 1-.585.43l-2.42.243 1.8 1.557a.75.75 0 0 1 .24.742l-.53 2.36 2.18-1.385a.75.75 0 0 1 .805 0l2.18 1.385-.53-2.36a.75.75 0 0 1 .24-.742l1.8-1.557-2.42-.243a.75.75 0 0 1-.585-.43z" />
    </ColumnMenuIcon>
  );
  const iconTypeContacts = (
    <ColumnMenuIcon>
      <path d="M10 3.5a3.25 3.25 0 1 1 0 6.5 3.25 3.25 0 0 1 0-6.5m0 1.25a2 2 0 1 0 0 4 2 2 0 0 0 0-4m0 6.75c2.9 0 5.25 1.68 5.25 3.75 0 .69-.56 1.25-1.25 1.25H6c-.69 0-1.25-.56-1.25-1.25 0-2.07 2.35-3.75 5.25-3.75m0 1.25c-2.14 0-4 1.17-4 2.5h8c0-1.33-1.86-2.5-4-2.5" />
    </ColumnMenuIcon>
  );
  const iconTypeLinks = (
    <ColumnMenuIcon>
      <path d="M8.22 7.28a2.5 2.5 0 0 1 3.536 0 .625.625 0 1 1-.884.884 1.25 1.25 0 0 0-1.768 0l-1.06 1.06a1.25 1.25 0 0 0 0 1.768.625.625 0 1 1-.884.884 2.5 2.5 0 0 1 0-3.536zM11.78 12.72a2.5 2.5 0 0 1-3.536 0 .625.625 0 1 1 .884-.884 1.25 1.25 0 0 0 1.768 0l1.06-1.06a1.25 1.25 0 0 0 0-1.768.625.625 0 1 1 .884-.884 2.5 2.5 0 0 1 0 3.536z" />
    </ColumnMenuIcon>
  );
  const iconTypeDocuments = (
    <ColumnMenuIcon>
      <path d="M5 2.5h6l4 4V17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Zm6 1.5H6v12h8V8h-3V4Z" />
    </ColumnMenuIcon>
  );
  const iconFilter = (
    <ColumnMenuIcon>
      <path d="M3 4.875a.625.625 0 1 0 0 1.25h14a.625.625 0 1 0 0-1.25zm2.125 5.742h9.75a.625.625 0 1 0 0-1.25h-9.75a.625.625 0 1 0 0 1.25m1.5 3.883c0-.345.28-.625.625-.625h5.5a.625.625 0 1 1 0 1.25h-5.5a.625.625 0 0 1-.625-.625" />
    </ColumnMenuIcon>
  );
  const iconSort = (
    <ColumnMenuIcon>
      <path d="M14.075 3.45a.625.625 0 0 0-.884 0l-3.497 3.5a.625.625 0 0 0 .883.884l2.431-2.431v10.705a.625.625 0 0 0 1.25 0V5.402l2.431 2.43a.625.625 0 1 0 .884-.883zM2.427 12.167a.625.625 0 0 1 .884 0l2.43 2.431V3.893a.625.625 0 0 1 1.25 0v10.705l2.431-2.43a.625.625 0 0 1 .884.883L6.81 16.55a.625.625 0 0 1-.884 0l-3.498-3.498a.625.625 0 0 1 0-.884" />
    </ColumnMenuIcon>
  );
  const iconGroup = (
    <ColumnMenuIcon>
      <path d="M3.925 2.95a.55.55 0 1 0 0 1.1h12.15a.55.55 0 1 0 0-1.1zm0 7.767a.55.55 0 0 0 0 1.1h12.15a.55.55 0 1 0 0-1.1zm-.55-4.234a1 1 0 0 1 1-1h1.8a1 1 0 0 1 1 1v1.8a1 1 0 0 1-1 1h-1.8a1 1 0 0 1-1-1zm1.1.1v1.6h1.6v-1.6zm4.625-1.1a1 1 0 0 0-1 1v1.8a1 1 0 0 0 1 1h1.8a1 1 0 0 0 1-1v-1.8a1 1 0 0 0-1-1zm.1 2.7v-1.6h1.6v1.6zm3.625-1.7a1 1 0 0 1 1-1h1.8a1 1 0 0 1 1 1v1.8a1 1 0 0 1-1 1h-1.8a1 1 0 0 1-1-1zm1.1.1v1.6h1.6v-1.6zm-9.55 6.667a1 1 0 0 0-1 1v1.8a1 1 0 0 0 1 1h1.8a1 1 0 0 0 1-1v-1.8a1 1 0 0 0-1-1zm.1 2.7v-1.6h1.6v1.6zm3.625-1.7a1 1 0 0 1 1-1h1.8a1 1 0 0 1 1 1v1.8a1 1 0 0 1-1 1H9.1a1 1 0 0 1-1-1zm1.1.1v1.6h1.6v-1.6zm4.625-1.1a1 1 0 0 0-1 1v1.8a1 1 0 0 0 1 1h1.8a1 1 0 0 0 1-1v-1.8a1 1 0 0 0-1-1zm.1 2.7v-1.6h1.6v1.6z" />
    </ColumnMenuIcon>
  );
  const iconCalc = (
    <ColumnMenuIcon>
      <path d="M4.78 3.524a.63.63 0 0 1 .583-.399h9.274a.625.625 0 1 1 0 1.25H6.976l5.663 5.163a.625.625 0 0 1 0 .924l-5.663 5.163h7.661a.625.625 0 1 1 0 1.25H5.363a.625.625 0 0 1-.421-1.087L11.29 10 4.942 4.212a.625.625 0 0 1-.162-.688" />
    </ColumnMenuIcon>
  );
  const iconPin = (
    <ColumnMenuIcon>
      <path d="M6.653 2.375A.625.625 0 0 0 6.028 3v.474A3.62 3.62 0 0 0 7.24 6.179l.289.258-.157 1.603a4.625 4.625 0 0 0-2.997 4.33V13c0 .345.28.625.625.625h4.13v3.08c0 .158.035.317.1.46l.433.94a.35.35 0 0 0 .565.103l.063-.087.44-.956c.065-.142.1-.3.1-.46v-3.08H15c.345 0 .625-.28.625-.625v-.63a4.625 4.625 0 0 0-2.997-4.33l-.157-1.603.289-.258a3.63 3.63 0 0 0 1.212-2.705V3a.625.625 0 0 0-.625-.625zm1.42 2.871c-.468-.417-.75-1-.79-1.621h5.434a2.38 2.38 0 0 1-.79 1.621l-.525.47a.63.63 0 0 0-.206.527l.227 2.318a.63.63 0 0 0 .422.531l.237.08a3.375 3.375 0 0 1 2.293 3.197v.006h-8.75v-.006c0-1.447.922-2.733 2.293-3.197l.237-.08a.63.63 0 0 0 .422-.531l.227-2.318a.63.63 0 0 0-.206-.528z" />
    </ColumnMenuIcon>
  );
  const iconHide = (
    <ColumnMenuIcon>
      <path d="M3.893 2.875a.626.626 0 0 1 .79-.02l.092.088.126.146.016.035.072.105 11.273 13.15a.624.624 0 0 1-1.036.678l-1.615-1.884c-1.12.408-2.339.633-3.611.633-3.757 0-7.049-1.946-8.707-4.843l-.155-.283a1.46 1.46 0 0 1 0-1.359l.155-.283c.89-1.554 2.249-2.835 3.898-3.688L3.826 3.757l-.072-.105a.626.626 0 0 1 .14-.777M6.031 6.33c-1.564.744-2.842 1.913-3.653 3.33l-.134.243a.21.21 0 0 0 0 .197l.134.243c1.426 2.49 4.292 4.214 7.622 4.214.958 0 1.877-.144 2.734-.406l-1.1-1.284a3.3 3.3 0 0 1-1.634.438l-.17-.004a3.307 3.307 0 0 1-3.132-3.133l-.004-.17c0-.777.269-1.492.718-2.056zm2.904 3.387q-.037.135-.038.281a1.104 1.104 0 0 0 1.218 1.097zM10 4.194c3.878 0 7.26 2.075 8.862 5.127l.074.164c.125.332.125.7 0 1.032l-.074.163a9.3 9.3 0 0 1-2.987 3.327l-.82-.955c1.15-.764 2.084-1.779 2.7-2.953l.02-.048a.2.2 0 0 0 0-.1l-.02-.049C16.382 7.282 13.438 5.445 10 5.445q-.705 0-1.378.1l-.94-1.098A10.7 10.7 0 0 1 10 4.194" />
      <path d="M10.17 6.694a3.307 3.307 0 0 1 3.136 3.303l-.005.17a3.3 3.3 0 0 1-.116.702L9.624 6.713A3 3 0 0 1 10 6.691z" />
    </ColumnMenuIcon>
  );
  const iconFit = (
    <ColumnMenuIcon>
      <path d="M16.625 8A2.625 2.625 0 0 0 14 5.375h-1.42a.625.625 0 1 1 0-1.25H14a3.875 3.875 0 0 1 0 7.75H4.259l3.333 3.333a.625.625 0 0 1-.884.884l-4.4-4.4a.625.625 0 0 1 0-.884l4.4-4.4a.625.625 0 0 1 .884.884l-3.333 3.333H14A2.625 2.625 0 0 0 16.625 8" />
    </ColumnMenuIcon>
  );
  const iconInsertLeft = (
    <ColumnMenuIcon>
      <path d="M3.024 3.524a1.92 1.92 0 0 0-1.918 1.92v9.113a1.92 1.92 0 0 0 3.837 0V5.444a1.92 1.92 0 0 0-1.919-1.92m0 1.251c.37 0 .67.3.67.67v9.112a.67.67 0 0 1-1.338 0V5.444c0-.369.3-.668.668-.669m8.612.383a.625.625 0 0 0-.884 0l-4.4 4.4a.626.626 0 0 0 0 .884l4.4 4.4a.626.626 0 0 0 .884-.884l-3.334-3.333h9.967a.625.625 0 0 0 0-1.25H8.303l3.333-3.333a.625.625 0 0 0 0-.884" />
    </ColumnMenuIcon>
  );
  const iconInsertRight = (
    <ColumnMenuIcon>
      <path d="M16.976 3.524a1.92 1.92 0 0 1 1.918 1.92v9.113a1.92 1.92 0 0 1-3.837 0V5.444c0-1.06.859-1.92 1.919-1.92m0 1.251a.67.67 0 0 0-.67.67v9.112a.67.67 0 0 0 1.338 0V5.444a.67.67 0 0 0-.668-.669m-8.612.383a.625.625 0 0 1 .884 0l4.4 4.4a.626.626 0 0 1 0 .884l-4.4 4.4a.626.626 0 0 1-.884-.884l3.334-3.333H1.731a.625.625 0 0 1 0-1.25h9.966L8.364 6.042a.625.625 0 0 1 0-.884" />
    </ColumnMenuIcon>
  );
  const iconDuplicate = (
    <ColumnMenuIcon>
      <path d="M4.5 2.375A2.125 2.125 0 0 0 2.375 4.5V12c0 1.174.951 2.125 2.125 2.125h1.625v1.625c0 1.174.951 2.125 2.125 2.125h7.5a2.125 2.125 0 0 0 2.125-2.125v-7.5a2.125 2.125 0 0 0-2.125-2.125h-1.625V4.5A2.125 2.125 0 0 0 12 2.375zm8.375 3.75H8.25A2.125 2.125 0 0 0 6.125 8.25v4.625H4.5A.875.875 0 0 1 3.625 12V4.5c0-.483.392-.875.875-.875H12c.483 0 .875.392.875.875zm-5.5 2.125c0-.483.392-.875.875-.875h7.5c.483 0 .875.392.875.875v7.5a.875.875 0 0 1-.875.875h-7.5a.875.875 0 0 1-.875-.875z" />
    </ColumnMenuIcon>
  );
  const iconTrash = (
    <ColumnMenuIcon>
      <path d="M8.806 8.505a.55.55 0 0 0-1.1 0v5.979a.55.55 0 1 0 1.1 0zm3.488 0a.55.55 0 0 0-1.1 0v5.979a.55.55 0 0 0 1.1 0z" />
      <path d="M6.386 3.925v1.464H3.523a.625.625 0 1 0 0 1.25h.897l.393 8.646A2.425 2.425 0 0 0 7.236 17.6h5.528a2.425 2.425 0 0 0 2.422-2.315l.393-8.646h.898a.625.625 0 1 0 0-1.25h-2.863V3.925c0-.842-.683-1.525-1.525-1.525H7.91c-.842 0-1.524.683-1.524 1.525M7.91 3.65h4.18c.15 0 .274.123.274.275v1.464H7.636V3.925c0-.152.123-.275.274-.275m-.9 2.99h7.318l-.39 8.588a1.175 1.175 0 0 1-1.174 1.122H7.236a1.175 1.175 0 0 1-1.174-1.122l-.39-8.589z" />
    </ColumnMenuIcon>
  );

  const menuEntries: MenuEntry[] = (() => {
    if (!columnMenu) return [];

    const backEntry: MenuEntry = {
      kind: "item",
      key: "back",
      label: "Volver",
      icon: <span className="column-menu-back">←</span>,
      action: () => setMenuView("root")
    };

    if (columnMenuView === "type") {
      const canChange = menuIsCustom;
      const mkType = (
        type: CustomProperty["type"],
        label: string,
        icon: React.ReactNode
      ): MenuEntry => ({
        kind: "item",
        key: `type-${type}`,
        label,
        icon,
        disabled: !canChange,
        end: menuKind === type ? <span className="column-menu-check">✓</span> : undefined,
        action: () => {
          if (!canChange) return;
          void setCustomPropertyType(menuCol, type);
          setMenuView("root");
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

    if (columnMenuView === "sort") {
      const isActive = sortConfig?.column === menuCol;
      return [
        backEntry,
        {
          kind: "item",
          key: "sort-asc",
          label: "A → Z",
          icon: iconSort,
          end: isActive && sortConfig?.direction === "asc" ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setSortConfig({ column: menuCol, direction: "asc" });
            closeColumnMenu();
          }
        },
        {
          kind: "item",
          key: "sort-desc",
          label: "Z → A",
          icon: iconSort,
          end: isActive && sortConfig?.direction === "desc" ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setSortConfig({ column: menuCol, direction: "desc" });
            closeColumnMenu();
          }
        },
        ...(isActive
          ? ([
              {
                kind: "item",
                key: "sort-clear",
                label: "Quitar orden",
                icon: iconSort,
                action: () => {
                  setSortConfig(null);
                  closeColumnMenu();
                }
              }
            ] as MenuEntry[])
          : [])
      ];
    }

    if (columnMenuView === "group") {
      const active = groupBy === menuCol;
      return [
        backEntry,
        {
          kind: "item",
          key: "group-toggle",
          label: active ? "Quitar grupo" : "Agrupar por esta columna",
          icon: iconGroup,
          end: active ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setCollapsedGroups(new Set());
            setGroupBy((prev) => (prev === menuCol ? null : menuCol));
            closeColumnMenu();
          }
        }
      ];
    }

    if (columnMenuView === "calculate") {
      const isNumeric = menuKind === "number" || menuKind === "rating";
      const isCheckbox = menuKind === "checkbox";
      const entries: MenuEntry[] = [
        backEntry,
        {
          kind: "item",
          key: "calc-none",
          label: "Ninguno",
          icon: iconCalc,
          end: currentCalc === "none" ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setColumnCalcs((prev) => ({ ...prev, [menuCol]: "none" }));
            setMenuView("root");
          }
        },
        {
          kind: "item",
          key: "calc-count",
          label: "Contar filas",
          icon: iconCalc,
          end: currentCalc === "count" ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setColumnCalcs((prev) => ({ ...prev, [menuCol]: "count" }));
            setMenuView("root");
          }
        },
        {
          kind: "item",
          key: "calc-count-values",
          label: "Contar valores",
          icon: iconCalc,
          end: currentCalc === "count_values" ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setColumnCalcs((prev) => ({ ...prev, [menuCol]: "count_values" }));
            setMenuView("root");
          }
        },
        {
          kind: "item",
          key: "calc-count-empty",
          label: "Contar vacios",
          icon: iconCalc,
          end: currentCalc === "count_empty" ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setColumnCalcs((prev) => ({ ...prev, [menuCol]: "count_empty" }));
            setMenuView("root");
          }
        },
        {
          kind: "item",
          key: "calc-unique",
          label: "Valores unicos",
          icon: iconCalc,
          end: currentCalc === "unique" ? <span className="column-menu-check">✓</span> : undefined,
          action: () => {
            setColumnCalcs((prev) => ({ ...prev, [menuCol]: "unique" }));
            setMenuView("root");
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
            end: currentCalc === "sum" ? <span className="column-menu-check">✓</span> : undefined,
            action: () => {
              setColumnCalcs((prev) => ({ ...prev, [menuCol]: "sum" }));
              setMenuView("root");
            }
          },
          {
            kind: "item",
            key: "calc-avg",
            label: "Media",
            icon: iconCalc,
            end: currentCalc === "avg" ? <span className="column-menu-check">✓</span> : undefined,
            action: () => {
              setColumnCalcs((prev) => ({ ...prev, [menuCol]: "avg" }));
              setMenuView("root");
            }
          },
          {
            kind: "item",
            key: "calc-min",
            label: "Minimo",
            icon: iconCalc,
            end: currentCalc === "min" ? <span className="column-menu-check">✓</span> : undefined,
            action: () => {
              setColumnCalcs((prev) => ({ ...prev, [menuCol]: "min" }));
              setMenuView("root");
            }
          },
          {
            kind: "item",
            key: "calc-max",
            label: "Maximo",
            icon: iconCalc,
            end: currentCalc === "max" ? <span className="column-menu-check">✓</span> : undefined,
            action: () => {
              setColumnCalcs((prev) => ({ ...prev, [menuCol]: "max" }));
              setMenuView("root");
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
            end: currentCalc === "checked" ? <span className="column-menu-check">✓</span> : undefined,
            action: () => {
              setColumnCalcs((prev) => ({ ...prev, [menuCol]: "checked" }));
              setMenuView("root");
            }
          },
          {
            kind: "item",
            key: "calc-unchecked",
            label: "Sin marcar",
            icon: iconCalc,
            end: currentCalc === "unchecked" ? <span className="column-menu-check">✓</span> : undefined,
            action: () => {
              setColumnCalcs((prev) => ({ ...prev, [menuCol]: "unchecked" }));
              setMenuView("root");
            }
          }
        );
      }
      return entries;
    }

    if (columnMenuView === "filter") {
      return [
        backEntry,
        ...(filterActive
          ? ([
              {
                kind: "item",
                key: "filter-clear",
                label: "Borrar filtro",
                icon: iconFilter,
                action: () => {
                  setColumnFilters((prev) => ({ ...prev, [menuCol]: "" }));
                  setColumnMenu((prev) => (prev ? { ...prev, filter: "" } : prev));
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
        end: <ColumnMenuChevronRight />
      },
      {
        kind: "separator",
        key: "sep-0"
      },
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
      {
        kind: "separator",
        key: "sep-1"
      },
      {
        kind: "item",
        key: "pin",
        label: menuPinned ? "Desfijar" : "Fijar",
        icon: iconPin,
        action: () => {
          if (menuPinned) unpinColumn(menuCol);
          else pinColumn(menuCol);
          closeColumnMenu();
        }
      },
      {
        kind: "item",
        key: "hide",
        label: "Ocultar",
        icon: iconHide,
        action: () => handleHideColumn(menuCol)
      },
      {
        kind: "item",
        key: "fit",
        label: "Ajustar contenido",
        icon: iconFit,
        action: () => {
          fitColumnToContent(menuCol);
          closeColumnMenu();
        }
      },
      {
        kind: "separator",
        key: "sep-2"
      },
      {
        kind: "item",
        key: "insert-left",
        label: "Insertar a la izquierda",
        icon: iconInsertLeft,
        action: () => {
          void insertCustomProperty(menuCol, "left");
          closeColumnMenu();
        }
      },
      {
        kind: "item",
        key: "insert-right",
        label: "Insertar a la derecha",
        icon: iconInsertRight,
        action: () => {
          void insertCustomProperty(menuCol, "right");
          closeColumnMenu();
        }
      },
      {
        kind: "item",
        key: "duplicate",
        label: "Duplicar propiedad",
        icon: iconDuplicate,
        disabled: !menuIsCustom,
        action: () => {
          if (!menuIsCustom) return;
          void duplicateCustomProperty(menuCol);
          closeColumnMenu();
        }
      },
      {
        kind: "item",
        key: "delete",
        label: "Eliminar propiedad",
        icon: iconTrash,
        disabled: !menuIsCustom,
        action: () => {
          if (!menuIsCustom) return;
          void deleteCustomProperty(menuCol);
        }
      }
    ];
  })();

  const menuActiveId =
    menuEntries[columnMenuActiveIndex]?.kind === "item"
      ? `column-menu-${columnMenuView}-${columnMenuActiveIndex}`
      : undefined;

  const moveActive = (dir: -1 | 1) => {
    if (menuEntries.length === 0) return;
    let idx = columnMenuActiveIndex;
    for (let i = 0; i < menuEntries.length; i += 1) {
      idx = (idx + dir + menuEntries.length) % menuEntries.length;
      if (menuEntries[idx]?.kind === "item") {
        setColumnMenuActiveIndex(idx);
        return;
      }
    }
  };

  const activateActive = () => {
    const entry = menuEntries[columnMenuActiveIndex];
    if (!entry || entry.kind !== "item") return;
    if (entry.disabled) return;
    if (entry.submenu) {
      setMenuView(entry.submenu);
      return;
    }
    entry.action?.();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const tag = target?.tagName || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeColumnMenu();
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeColumnMenu();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateActive();
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      const entry = menuEntries[columnMenuActiveIndex];
      if (entry && entry.kind === "item" && entry.submenu && !entry.disabled) {
        setMenuView(entry.submenu);
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      if (columnMenuView !== "root") {
        event.preventDefault();
        setMenuView("root");
      }
    }
  };

  const cellToString = (app: Application, col: string) => {
    if (col.startsWith("prop__")) {
      const key = col.replace("prop__", "");
      const raw = app.properties?.[key] || "";
      const prop = settings.custom_properties.find((item) => item.key === key);
      if (!prop) return raw;
      if (prop.type === "contacts") {
        const list = parseContactsPropValue(raw);
        return list.length === 0 ? "" : contactsToString(list);
      }
      if (prop.type === "links") {
        const list = parseLinksPropValue(raw);
        if (list.length === 0) return "";
        return list.map((link) => link.label || link.url).filter(Boolean).join(" | ");
      }
      if (prop.type === "documents") {
        const ids = parseDocumentsPropValue(raw);
        if (ids.length === 0) return "";
        const fileMap = new Map((app.documents_files || []).map((file) => [file.id, file.name]));
        const names = ids.map((id) => fileMap.get(id) || "").filter(Boolean);
        return (names.length ? names : ids).join(" | ");
      }
      return raw;
    }
    if (col === "contacts") return contactsToString(app.contacts);
    if (col === "documents_files") return documentsToString(app.documents_files);
    const value = (app as Record<string, unknown>)[col];
    if (value === null || value === undefined) return "";
    return String(value);
  };

  const rowsForDisplay = useMemo(() => {
    if (!groupBy) return sorted;
    const next = [...sorted];
    next.sort((a, b) => {
      const aKey = cellToString(a, groupBy).trim() || "(Vacio)";
      const bKey = cellToString(b, groupBy).trim() || "(Vacio)";
      if (aKey === bKey) return 0;
      if (aKey === "(Vacio)") return 1;
      if (bKey === "(Vacio)") return -1;
      return aKey.localeCompare(bKey, undefined, { sensitivity: "base" });
    });
    return next;
  }, [sorted, groupBy]);

  const groupCounts = useMemo(() => {
    if (!groupBy) return null;
    const map = new Map<string, number>();
    rowsForDisplay.forEach((app) => {
      const key = cellToString(app, groupBy).trim() || "(Vacio)";
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [rowsForDisplay, groupBy]);

  const stickyColumn = orderedVisible[0];
  const viewHeight = viewportHeight || rowHeight * 10;
  const shouldVirtualize = !groupBy && rowsForDisplay.length > 200;
  const totalHeight = shouldVirtualize ? rowsForDisplay.length * rowHeight : 0;
  const startIndex = shouldVirtualize ? Math.max(0, Math.floor(scrollTop / rowHeight) - 5) : 0;
  const endIndex = shouldVirtualize
    ? Math.min(rowsForDisplay.length, Math.ceil((scrollTop + viewHeight) / rowHeight) + 5)
    : rowsForDisplay.length;
  const visibleRows = shouldVirtualize ? rowsForDisplay.slice(startIndex, endIndex) : rowsForDisplay;
  const topSpacer = shouldVirtualize ? startIndex * rowHeight : 0;
  const bottomSpacer = shouldVirtualize ? totalHeight - endIndex * rowHeight : 0;

  const showCalcRow = orderedVisible.some((col) => (columnCalcs[col] || "none") !== "none");

  const calcValueFor = (app: Application, col: string): string | number | boolean | null => {
    if (col === "contacts") return contactsToString(app.contacts);
    if (col === "documents_files") return documentsToString(app.documents_files);
    const kind = getColumnKind(col);
    if (col.startsWith("prop__")) {
      const key = col.replace("prop__", "");
      const raw = app.properties?.[key] || "";
      if (kind === "number" || kind === "rating") {
        if (!raw) return null;
        const num = Number(raw);
        return Number.isNaN(num) ? null : num;
      }
      if (kind === "checkbox") return raw === "true";
      if (kind === "contacts") {
        const list = parseContactsPropValue(raw);
        return list.length === 0 ? "" : contactsToString(list);
      }
      if (kind === "links") {
        const list = parseLinksPropValue(raw);
        if (list.length === 0) return "";
        return list.map((link) => link.label || link.url).filter(Boolean).join(" | ");
      }
      if (kind === "documents") {
        const ids = parseDocumentsPropValue(raw);
        if (ids.length === 0) return "";
        const fileMap = new Map((app.documents_files || []).map((file) => [file.id, file.name]));
        const names = ids.map((id) => fileMap.get(id) || "").filter(Boolean);
        return (names.length ? names : ids).join(" | ");
      }
      return raw;
    }
    const value = (app as Record<string, unknown>)[col];
    if (kind === "number" || kind === "rating") {
      if (typeof value === "number") return value;
      if (value === null || value === undefined || value === "") return null;
      const num = Number(value);
      return Number.isNaN(num) ? null : num;
    }
    if (kind === "checkbox") return Boolean(value);
    if (value === null || value === undefined) return "";
    return String(value);
  };

  const calcResultFor = (col: string): string => {
    const op = columnCalcs[col] || "none";
    if (op === "none") return "";
    const rows = rowsForDisplay;
    if (op === "count") return String(rows.length);

    const values = rows.map((app) => calcValueFor(app, col));
    const isEmpty = (value: unknown) =>
      value === null || value === undefined || value === "" || (typeof value === "string" && !value.trim());

    if (op === "count_values") {
      return String(values.filter((v) => !isEmpty(v)).length);
    }
    if (op === "count_empty") {
      return String(values.filter((v) => isEmpty(v)).length);
    }
    if (op === "unique") {
      const set = new Set<string>();
      values.forEach((v) => {
        if (isEmpty(v)) return;
        set.add(String(v));
      });
      return String(set.size);
    }

    if (op === "checked" || op === "unchecked") {
      const want = op === "checked";
      return String(values.filter((v) => Boolean(v) === want).length);
    }

    const nums = values
      .map((v) => (typeof v === "number" ? v : null))
      .filter((v): v is number => v !== null);
    if (nums.length === 0) return "—";
    if (op === "sum") return String(nums.reduce((acc, n) => acc + n, 0));
    if (op === "avg")
      return String(Math.round((nums.reduce((acc, n) => acc + n, 0) / nums.length) * 100) / 100);
    if (op === "min") return String(Math.min(...nums));
    if (op === "max") return String(Math.max(...nums));
    return "";
  };

	  return (
	    <div className={`tracker density-${density}`}>
	      <BlockPanel id="tracker:toolbar" as="section" className="toolbar">
	        <div className="toolbar-left">
	          <div>
	            <h2>{t("Tracker Table")}</h2>
	            <p>{t("Search, edit, and manage every application.")}</p>
	          </div>
	        </div>
	        <div className="toolbar-right">
	          <div className="density-toggle">
	            <label htmlFor="density">{t("Density")}</label>
	            <select
	              id="density"
	              value={density}
	              onChange={(event) =>
	                saveSettings({ ...settings, table_density: event.target.value as "compact" | "comfortable" })
	              }
	            >
	              <option value="comfortable">{t("Comfortable")}</option>
	              <option value="compact">{t("Compact")}</option>
	            </select>
	          </div>
	        </div>
	      </BlockPanel>
	
	      <BlockPanel id="tracker:filters" as="section" className="filters">
	        <div className="field">
	          <label>{t("Search")}</label>
	          <input
	            value={query}
	            onChange={(e) => setQuery(e.target.value)}
	            placeholder={t("Company, role, location...")}
	          />
	        </div>
	        <div className="field">
	          <label>{t("Stage")}</label>
	          <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
	            <option value="all">{t("All")}</option>
	            {settings.stages.map((stage) => (
	              <option key={stage} value={stage}>
	                {stage}
	              </option>
	            ))}
	          </select>
	        </div>
	        <div className="field">
	          <label>{t("Outcome")}</label>
	          <select value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value)}>
	            <option value="all">{t("All")}</option>
	            {settings.outcomes.map((outcome) => (
	              <option key={outcome} value={outcome}>
	                {outcome}
	              </option>
	            ))}
	          </select>
	        </div>
	      </BlockPanel>
	
	      

		      {selectedIds.size > 0 && (
		        <div className="bulk-bar">
		          <div className="bulk-count">{t("{count} selected", { count: selectedIds.size })}</div>
	          <div className="bulk-actions">
	            <select
	              value={bulkStage}
	              onChange={(event) => {
	                setBulkStage(event.target.value);
	                handleBulkStage(event.target.value);
	              }}
	            >
	              <option value="">{t("Set stage...")}</option>
	              {settings.stages.map((stage) => (
	                <option key={stage} value={stage}>
	                  {stage}
	                </option>
	              ))}
	            </select>
	            <select
	              value={bulkOutcome}
	              onChange={(event) => {
	                setBulkOutcome(event.target.value);
	                handleBulkOutcome(event.target.value);
	              }}
	            >
	              <option value="">{t("Set outcome...")}</option>
	              {settings.outcomes.map((outcome) => (
	                <option key={outcome} value={outcome}>
	                  {outcome}
	                </option>
	              ))}
	            </select>
	            <button className="ghost" type="button" onClick={handleExportSelected}>
	              {t("Export Selected")}
	            </button>
	            <button className="danger" type="button" onClick={handleBulkDelete}>
	              {t("Delete Selected")}
	            </button>
	          </div>
	        </div>
	      )}

	      <BlockPanel id="tracker:table" as="section" className="table-panel">
	        <div
  className="table-toolbar"
  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
>

  {showColumns && columnsMenuPos &&
    createPortal(
      <div
        className={`select-menu columns-dropdown ${columnsMenuVisible ? "open" : ""}`}
        ref={columnsAccordionRef}
        style={{
          position: "fixed",
          top: columnsMenuPos.top,
          left: columnsMenuPos.left,
          width: COLUMN_MENU_WIDTH,
          zIndex: 60
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="select-options" role="menu" aria-label="Columns menu">
          {columnOrderDraft.map((col) => {
            const label = labelForColumn(col);
            const checked = visibleDraft.includes(col);
            return (
              <button
                key={col}
                type="button"
                className={`select-option ${checked ? "selected" : ""}`}
                onClick={() => toggleColumnVisibility(col)}
              >
                <span className="select-swatch" style={{ backgroundColor: "var(--panel)" }} />
                <span className="select-label">{label}</span>
                <span className="select-check">{checked ? "✓" : ""}</span>
              </button>
            );
          })}
        </div>
      </div>,
      document.body
    )}
  

  <div
    className="toolbar-actions-box"
    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}
  >
    <div className="columns-dropdown-trigger">
      <button
        ref={columnsAnchorRef}
        className={`select-trigger ${showColumns ? "open" : ""}`}
        type="button"
        onClick={() => (showColumns ? closeColumnsMenu() : openColumnsMenu())}
        aria-label="Columns"
      >
        <span className="select-pill" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <svg
            viewBox="0 0 20 20"
            aria-hidden="true"
            style={{ width: 14, height: 14, flex: "0 0 auto" }}
          >
            <path d="M10 4.5c-4.2 0-7.7 3-9 5.5 1.3 2.5 4.8 5.5 9 5.5s7.7-3 9-5.5c-1.3-2.5-4.8-5.5-9-5.5Zm0 9c-2 0-3.6-1.6-3.6-3.6S8 6.3 10 6.3s3.6 1.6 3.6 3.6S12 13.5 10 13.5Zm0-5.7c-1.2 0-2.1 1-2.1 2.1S8.8 12 10 12s2.1-1 2.1-2.1S11.2 7.8 10 7.8Z" />
          </svg>
          Columns
        </span>
        <span className="select-caret">▾</span>
      </button>
    </div>
    <div className="toolbar-actions-right" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button className="ghost" onClick={() => downloadExcel("all")}>
        {t("Export All")}
      </button>
      <button className="ghost" onClick={() => downloadExcel("favorites")}>
        {t("Export Favorites")}
      </button>
      <button className="ghost" onClick={() => downloadExcel("active")}>
        {t("Export Active")}
      </button>
      <button className="primary" onClick={() => setShowForm(true)}>
        {t("New Application")}
      </button>
    </div>
  </div>
</div>
	        <div
	          className="table-scroll"
	          ref={tableScrollRef}
	          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <table className="table">
            <thead>
              <tr>
                <th
                  className="selection-col sticky-col"
                  style={{ left: 0, width: SELECTION_COLUMN_WIDTH, minWidth: SELECTION_COLUMN_WIDTH }}
                >
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      if (checked) {
                        setSelectedIds((prev) => new Set([...prev, ...visibleIds]));
                      } else {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          visibleIds.forEach((id) => next.delete(id));
                          return next;
                        });
                      }
                    }}
                  />
                </th>
                {orderedVisible.map((col) => {
                  const width = getColumnWidth(col);
                  const isSticky = col === stickyColumn;
                  const sortActive = sortConfig?.column === col;
                  const filterActive = Boolean(columnFilters[col]?.trim());
                  return (
                    <th
                      key={col}
                      className={`column-header ${isSticky ? "sticky-col" : ""} ${
                        dragOverCol === col ? "drag-over" : ""
                      }`}
                      style={{
                        width,
                        minWidth: width,
                        left: isSticky ? SELECTION_COLUMN_WIDTH : undefined
                      }}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", col);
                        event.dataTransfer.effectAllowed = "move";
                        draggedColRef.current = col;
                        setDraggedCol(col);
                      }}
                      onDragEnd={() => {
                        draggedColRef.current = null;
                        setDraggedCol(null);
                        setDragOverCol(null);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        if (draggedColRef.current && draggedColRef.current !== col) {
                          setDragOverCol(col);
                        }
                      }}
                      onDragLeave={() => setDragOverCol(null)}
                      onDrop={(event) => {
                        event.preventDefault();
                        handleColumnReorder(col);
                      }}
                    >
                      <div className="th-content">
                        <span className="column-label">{labelForColumn(col)}</span>
                        {sortActive && (
                          <span className="sort-indicator">
                            {sortConfig?.direction === "asc" ? "↑" : "↓"}
                          </span>
                        )}
                        {filterActive && <span className="filter-indicator" />}
                        <button
                          className="column-menu-button"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (columnMenu?.col === col) {
                              closeColumnMenu();
                            } else {
                              openColumnMenu(col, event.currentTarget);
                            }
                          }}
                          aria-label="Column menu"
	                        >
	                          ...
	                        </button>
	                      </div>
	                      <div
	                        className="column-resizer"
	                        onMouseDown={(event) => {
	                          event.preventDefault();
                          event.stopPropagation();
                          setResizing({
                            col,
                            startX: event.clientX,
                            startWidth: getColumnWidth(col)
                          });
                        }}
                      />
                    </th>
                  );
                })}
                <th
                  className="actions-col"
                  style={{
                    width: ACTIONS_COLUMN_WIDTH,
                    minWidth: ACTIONS_COLUMN_WIDTH,
                    maxWidth: ACTIONS_COLUMN_WIDTH
                  }}
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {shouldVirtualize && topSpacer > 0 && (
                <tr className="spacer-row">
                  <td colSpan={orderedVisible.length + 2} style={{ height: topSpacer }} />
                </tr>
              )}
              {visibleRows.map((app, index) => {
                const stageOptions = buildSelectOptions(app.stage, settings.stages, settings.stage_colors);
                const outcomeOptions = buildSelectOptions(app.outcome, settings.outcomes, settings.outcome_colors);
                const jobTypeOptions = buildSelectOptions(
                  app.job_type,
                  settings.job_types,
                  settings.job_type_colors
                );
                const isSelected = selectedIds.has(app.id);

                const groupKey = groupBy ? cellToString(app, groupBy).trim() || "(Vacio)" : "";
                const prevGroupKey =
                  groupBy && index > 0
                    ? cellToString(visibleRows[index - 1], groupBy).trim() || "(Vacio)"
                    : "";
                const firstInGroup = Boolean(groupBy && groupKey !== prevGroupKey);
                const collapsed = Boolean(groupBy && collapsedGroups.has(groupKey));

                const row = (
                <tr key={app.id} className={isSelected ? "selected" : ""} style={{ height: rowHeight }}>
                  <td
                    className="selection-col sticky-col"
                    style={{ left: 0, width: SELECTION_COLUMN_WIDTH, minWidth: SELECTION_COLUMN_WIDTH }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (checked) {
                            next.add(app.id);
                          } else {
                            next.delete(app.id);
                          }
                          return next;
                        });
                      }}
                    />
                  </td>
                  {orderedVisible.map((col) => {
                    const width = getColumnWidth(col);
                    const isSticky = col === stickyColumn;
                    const renderCell = () => {
                    if (col === "company_name") {
                      return (
                        <TextCell
                          value={app.company_name}
                          onCommit={(next) => {
                            if (next === app.company_name) return;
                            updateApplication(app.id, { company_name: next });
                          }}
                        />
                      );
                    }
                    if (col === "position") {
                      return (
                        <TextCell
                          value={app.position}
                          onCommit={(next) => {
                            if (next === app.position) return;
                            updateApplication(app.id, { position: next });
                          }}
                        />
                      );
                    }
                    if (col === "job_type") {
                      return (
                        <SelectCell
                          value={app.job_type}
                          options={jobTypeOptions}
                          onCreateOption={addJobTypeOption}
                          onUpdateOptionColor={updateJobTypeColor}
                          onDeleteOption={deleteJobTypeOption}
                          onReorderOption={reorderJobTypeOption}
                          onCommit={(next) => {
                            if (next === app.job_type) return;
                            updateApplication(app.id, { job_type: next });
                          }}
                        />
                      );
                    }
                    if (col === "location") {
                      return (
                        <TextCell
                          value={app.location || ""}
                          onCommit={(next) => {
                            if (next === (app.location || "")) return;
                            updateApplication(app.id, { location: next });
                          }}
                        />
                      );
                    }
                    if (col === "stage") {
                      return (
                        <SelectCell
                          value={app.stage}
                          options={stageOptions}
                          onCreateOption={addStageOption}
                          onUpdateOptionColor={updateStageColor}
                          onDeleteOption={deleteStageOption}
                          onReorderOption={reorderStageOption}
                          onCommit={(next) => {
                            if (next === app.stage) return;
                            updateApplication(app.id, { stage: next });
                          }}
                        />
                      );
                    }
                    if (col === "outcome") {
                      return (
                        <SelectCell
                          value={app.outcome}
                          options={outcomeOptions}
                          onCreateOption={addOutcomeOption}
                          onUpdateOptionColor={updateOutcomeColor}
                          onDeleteOption={deleteOutcomeOption}
                          onReorderOption={reorderOutcomeOption}
                          onCommit={(next) => {
                            if (next === app.outcome) return;
                            updateApplication(app.id, { outcome: next });
                          }}
                        />
                      );
                    }
                    if (col === "application_date") {
                      return (
                        <DateCell
                          value={app.application_date}
                          onCommit={(next) => {
                            const current = toDateInputValue(app.application_date);
                            if (next === current) return;
                            updateApplication(app.id, { application_date: next ? next : null });
                          }}
                        />
                      );
                    }
                    if (col === "interview_datetime") {
                      return (
                        <DateTimeCell
                          value={app.interview_datetime}
                          onCommit={(next) => {
                            const current = toDateTimeLocalValue(app.interview_datetime);
                            if (next === current) return;
                            updateApplication(app.id, { interview_datetime: next ? next : null });
                          }}
                        />
                      );
                    }
                    if (col === "followup_date") {
                      return (
                        <DateCell
                          value={app.followup_date}
                          onCommit={(next) => {
                            const current = toDateInputValue(app.followup_date);
                            if (next === current) return;
                            updateApplication(app.id, { followup_date: next ? next : null });
                          }}
                        />
                      );
                    }
                    if (col === "interview_rounds") {
                      return (
                        <NumberCell
                          value={app.interview_rounds ?? null}
                          step={1}
                          min={0}
                          onCommit={(next) => {
                            if (next === app.interview_rounds) return;
                            updateApplication(app.id, { interview_rounds: next });
                          }}
                        />
                      );
                    }
                    if (col === "interview_type") {
                      return (
                        <TextCell
                          value={app.interview_type || ""}
                          onCommit={(next) => {
                            if (next === (app.interview_type || "")) return;
                            updateApplication(app.id, { interview_type: next });
                          }}
                        />
                      );
                    }
                    if (col === "interviewers") {
                      return (
                        <TextCell
                          value={app.interviewers || ""}
                          onCommit={(next) => {
                            if (next === (app.interviewers || "")) return;
                            updateApplication(app.id, { interviewers: next });
                          }}
                        />
                      );
                    }
                    if (col === "company_score") {
                      return (
                        <RatingCell
                          value={app.company_score ?? null}
                          onCommit={(next) => updateApplication(app.id, { company_score: next })}
                        />
                      );
                    }
                    if (col === "contacts") {
                      return (
                        <ContactsCell
                          contacts={app.contacts || []}
                          onCommit={(next) => updateApplication(app.id, { contacts: next })}
                        />
                      );
                    }
                    if (col === "last_round_cleared") {
                      return (
                        <TextCell
                          value={app.last_round_cleared || ""}
                          onCommit={(next) => {
                            if (next === (app.last_round_cleared || "")) return;
                            updateApplication(app.id, { last_round_cleared: next });
                          }}
                        />
                      );
                    }
                    if (col === "total_rounds") {
                      return (
                        <NumberCell
                          value={app.total_rounds ?? null}
                          step={1}
                          min={0}
                          onCommit={(next) => {
                            if (next === app.total_rounds) return;
                            updateApplication(app.id, { total_rounds: next });
                          }}
                        />
                      );
                    }
                    if (col === "my_interview_score") {
                      return (
                        <StarRating
                          value={app.my_interview_score ?? null}
                          onChange={(next) => updateApplication(app.id, { my_interview_score: next })}
                          size="sm"
                          step={0.5}
                        />
                      );
                    }
                    if (col === "improvement_areas") {
                      return (
                        <TextCell
                          value={app.improvement_areas || ""}
                          onCommit={(next) => {
                            if (next === (app.improvement_areas || "")) return;
                            updateApplication(app.id, { improvement_areas: next });
                          }}
                        />
                      );
                    }
                    if (col === "skill_to_upgrade") {
                      return (
                        <TextCell
                          value={app.skill_to_upgrade || ""}
                          onCommit={(next) => {
                            if (next === (app.skill_to_upgrade || "")) return;
                            updateApplication(app.id, { skill_to_upgrade: next });
                          }}
                        />
                      );
                    }
                    if (col === "job_description") {
                      return (
                        <TextCell
                          value={app.job_description || ""}
                          onCommit={(next) => {
                            if (next === (app.job_description || "")) return;
                            updateApplication(app.id, { job_description: next });
                          }}
                        />
                      );
                    }
                    if (col === "notes") {
                      return (
                        <TextCell
                          value={app.notes || ""}
                          onCommit={(next) => {
                            if (next === (app.notes || "")) return;
                            updateApplication(app.id, { notes: next });
                          }}
                        />
                      );
                    }
                    if (col === "documents_links") {
                      const files = app.documents_files || [];
                      const docs = parseDocumentLinks(app.documents_links || "");
                      return (
                        <div className="doc-cell">
                          <TextCell
                            value={app.documents_links || ""}
                            onCommit={(next) => {
                              if (next === (app.documents_links || "")) return;
                              updateApplication(app.id, { documents_links: next });
                            }}
                          />
                          {(docs.length > 0 || files.length > 0) && (
                            <div className="doc-chips">
                              {files.map((file) => (
                                <button
                                  key={`${app.id}-file-${file.id}`}
                                  className="doc-chip doc-button"
                                  type="button"
                                  onClick={() => setDocumentModal({ appId: app.id, file })}
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
                                    key={`${app.id}-doc-${index}`}
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
                                  <span key={`${app.id}-doc-${index}`} className="doc-chip">
                                    <svg viewBox="0 0 20 20" aria-hidden="true">
                                      <path d="M5 2.5h6l4 4V17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Zm6 1.5H6v12h8V8h-3V4Z" />
                                    </svg>
                                    <span>{doc.label}</span>
                                  </span>
                                )
                              )}
                            </div>
                          )}
                        </div>
                      );
                    }
                    if (col === "favorite") {
                      return (
                        <CheckboxCell
                          checked={app.favorite}
                          onCommit={(next) => {
                            if (next === app.favorite) return;
                            updateApplication(app.id, { favorite: next });
                          }}
                        />
                      );
                    }
	                    if (col.startsWith("prop__")) {
	                      const propKey = col.replace("prop__", "");
	                      const prop = settings.custom_properties.find((item) => item.key === propKey);
	                      if (!prop) return null;
	                      const currentValue = app.properties?.[propKey] || "";
	                      const commitProp = (next: string) => {
	                        if (next === currentValue) return;
	                        const nextProps = { ...(app.properties || {}) };
	                        nextProps[propKey] = next;
	                        updateApplication(app.id, { properties: nextProps });
	                      };
	                      if (prop.type === "text") {
	                        return <TextCell value={currentValue} onCommit={commitProp} />;
	                      }
	                      if (prop.type === "number") {
	                        const parsed = currentValue === "" ? null : Number(currentValue);
	                        return (
	                          <NumberCell
	                            value={Number.isNaN(parsed) ? null : parsed}
	                            step={1}
	                            onCommit={(next) => commitProp(next === null ? "" : String(next))}
	                          />
	                        );
	                      }
	                      if (prop.type === "date") {
	                        return (
	                          <DateCell
	                            value={currentValue}
	                            onCommit={(next) => commitProp(next ? next : "")}
	                          />
	                        );
	                      }
	                      if (prop.type === "checkbox") {
	                        return (
	                          <CheckboxCell
	                            checked={currentValue === "true"}
	                            onCommit={(next) => commitProp(next ? "true" : "false")}
	                          />
	                        );
	                      }
	                      if (prop.type === "rating") {
	                        const parsed = currentValue === "" ? null : Number(currentValue);
	                        return (
	                          <RatingCell
	                            value={Number.isNaN(parsed) ? null : parsed}
	                            onCommit={(next) => commitProp(next === null ? "" : String(next))}
	                          />
	                        );
	                      }
	                      if (prop.type === "contacts") {
	                        const parsed = parseContactsPropValue(currentValue);
	                        return (
	                          <ContactsCell
	                            contacts={parsed}
	                            onCommit={(next) =>
	                              commitProp(next.length === 0 ? "" : JSON.stringify(next))
	                            }
	                          />
	                        );
	                      }
	                      if (prop.type === "links") {
	                        const parsed = parseLinksPropValue(currentValue);
	                        return (
	                          <LinksCell
	                            links={parsed}
	                            onCommit={(next) =>
	                              commitProp(next.length === 0 ? "" : JSON.stringify(next))
	                            }
	                          />
	                        );
	                      }
	                      if (prop.type === "documents") {
	                        const selectedIds = parseDocumentsPropValue(currentValue);
	                        const files = app.documents_files || [];
	                        return (
	                          <DocumentsPropertyCell
	                            files={files}
	                            selectedIds={selectedIds}
	                            onCommit={(nextIds) =>
	                              commitProp(nextIds.length === 0 ? "" : JSON.stringify(nextIds))
	                            }
	                            onOpenFile={(file) => setDocumentModal({ appId: app.id, file })}
	                            onUploadAndAttach={async (filesToUpload, signal) => {
	                              if (!filesToUpload || filesToUpload.length === 0) return;
	                              const before = new Set((app.documents_files || []).map((f) => f.id));
	                              const uploaded = await uploadDocuments(app.id, filesToUpload, signal);
	                              const afterFiles = uploaded.documents_files || [];
	                              const newIds = afterFiles.map((f) => f.id).filter((id) => !before.has(id));
	                              const merged = Array.from(new Set([...selectedIds, ...newIds]));
	                              const nextProps = { ...(app.properties || {}) };
	                              nextProps[propKey] = merged.length === 0 ? "" : JSON.stringify(merged);
	                              await updateApplication(app.id, { properties: nextProps });
	                            }}
	                          />
	                        );
	                      }
	                      const options = buildCustomOptions(currentValue, prop.options, true);
	                      return (
	                        <SelectCell
	                          value={currentValue}
	                          options={options}
	                          onCreateOption={(label) => addCustomOption(propKey, label)}
	                          onUpdateOptionColor={(label, color) => updateCustomOptionColor(propKey, label, color)}
	                          onDeleteOption={(label) => deleteCustomOption(propKey, label)}
	                          onReorderOption={(fromLabel, toLabel) =>
	                            reorderCustomOption(propKey, fromLabel, toLabel)
	                          }
	                          onCommit={(next) => commitProp(next)}
	                        />
	                      );
	                    }
                    const value = (app as Record<string, unknown>)[col];
                    return (
                      <TextCell
                        value={value ? String(value) : ""}
                        onCommit={(next) => {
                          if (next === String(value ?? "")) return;
                          updateApplication(app.id, { [col]: next } as Partial<Application>);
                        }}
                      />
                    );
                  };

                    return (
                      <td
                        key={`${app.id}-${col}`}
                        className={isSticky ? "sticky-col" : ""}
                        style={{
                          width,
                          minWidth: width,
                          left: isSticky ? SELECTION_COLUMN_WIDTH : undefined
                        }}
                      >
                        {renderCell()}
                      </td>
                    );
                  })}
                  <td
                    className="row-actions-cell"
                    style={{
                      width: ACTIONS_COLUMN_WIDTH,
                      minWidth: ACTIONS_COLUMN_WIDTH,
                      maxWidth: ACTIONS_COLUMN_WIDTH
                    }}
                  >
                    <div className="row-actions">
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() => setDetailApp(app)}
                        aria-label="Details"
                      >
                        <svg viewBox="0 0 20 20" aria-hidden="true">
                          <path d="M10 4.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Zm0 1.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-.75 1.75h1.5v1.5h-1.5v-1.5Zm0 3h1.5v3h-1.5v-3Z" />
                        </svg>
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() => setEditing(app)}
                        aria-label="Edit"
                      >
                        <svg viewBox="0 0 20 20" aria-hidden="true">
                          <path d="M14.85 2.85a1.5 1.5 0 0 1 2.12 2.12l-9.5 9.5-3.2.35.35-3.2 9.5-9.5ZM4.3 15.7h11.4v1.5H4.3v-1.5Z" />
                        </svg>
                      </button>
                      <button
                        className="icon-button danger"
                        type="button"
                        onClick={() => deleteApplication(app.id)}
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
	
	                if (!groupBy) return row;
	
	                return (
	                  <React.Fragment key={`${groupKey}-${app.id}`}>
	                    {firstInGroup && (
	                      <tr className="group-row">
	                        <td colSpan={orderedVisible.length + 2}>
	                          <button
	                            className="group-toggle"
	                            type="button"
	                            onClick={() =>
	                              setCollapsedGroups((prev) => {
	                                const next = new Set(prev);
	                                if (next.has(groupKey)) next.delete(groupKey);
	                                else next.add(groupKey);
	                                return next;
	                              })
	                            }
	                          >
	                            <span className="group-caret">{collapsed ? "▸" : "▾"}</span>
	                            <span className="group-title">{groupKey}</span>
	                            <span className="group-count">{groupCounts?.get(groupKey) ?? 0}</span>
	                          </button>
	                        </td>
	                      </tr>
	                    )}
	                    {!collapsed && row}
	                  </React.Fragment>
	                );
	              })}
              {shouldVirtualize && bottomSpacer > 0 && (
                <tr className="spacer-row">
                  <td colSpan={orderedVisible.length + 2} style={{ height: bottomSpacer }} />
                </tr>
              )}
	            </tbody>
	            {showCalcRow && (
	              <tfoot>
	                <tr className="calc-row">
	                  <td
	                    className="selection-col sticky-col"
	                    style={{ left: 0, width: SELECTION_COLUMN_WIDTH, minWidth: SELECTION_COLUMN_WIDTH }}
	                  />
	                  {orderedVisible.map((col) => {
	                    const width = getColumnWidth(col);
	                    const isSticky = col === stickyColumn;
	                    const value = calcResultFor(col);
	                    return (
	                      <td
	                        key={`calc-${col}`}
	                        className={isSticky ? "sticky-col" : ""}
	                        style={{
	                          width,
	                          minWidth: width,
	                          left: isSticky ? SELECTION_COLUMN_WIDTH : undefined
	                        }}
	                      >
	                        <div className="calc-cell">{value}</div>
	                      </td>
	                    );
	                  })}
	                  <td
	                    className="row-actions-cell"
	                    style={{
	                      width: ACTIONS_COLUMN_WIDTH,
	                      minWidth: ACTIONS_COLUMN_WIDTH,
	                      maxWidth: ACTIONS_COLUMN_WIDTH
	                    }}
	                  />
	                </tr>
	              </tfoot>
	            )}
	          </table>
	        </div>
        {sorted.length === 0 && <div className="empty">No applications match your filters.</div>}
      </BlockPanel>

      {showForm && (
        <ApplicationForm
          settings={settings}
          onSubmit={handleCreate}
          onClose={() => setShowForm(false)}
        />
      )}
      {editing && (
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
      {columnMenu &&
        columnMenuPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className={`column-menu ${columnMenuVisible ? "open" : ""}`}
            data-placement={columnMenuPlacement}
            ref={columnMenuRef}
            style={{ top: columnMenuPos.top, left: columnMenuPos.left }}
            role="dialog"
            aria-modal="false"
          >
            <div className="column-menu-content">
              <div className="column-menu-header">
                <button
                  className="column-menu-type-button"
                  type="button"
                  onClick={() => setMenuView("type")}
                  aria-label="Cambiar tipo"
                >
                  {iconChangeType}
                </button>
                <input
                  className="column-menu-rename-input"
                  type="text"
                  value={columnMenu.rename}
                  onChange={(event) =>
                    setColumnMenu((prev) => (prev ? { ...prev, rename: event.target.value } : prev))
                  }
                  onBlur={() => void applyColumnRename()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void applyColumnRename();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setColumnMenu((prev) => (prev ? { ...prev, rename: labelForColumn(prev.col) } : prev));
                    }
                  }}
                  placeholder="Nombre de la propiedad"
                />
              </div>
              <div className="column-menu-scroller">
                {columnMenuView === "filter" && (
                  <div className="column-menu-filter">
                    <input
                      ref={columnMenuFilterInputRef}
                      className="column-menu-filter-input"
                      type="text"
                      value={columnMenu.filter}
                      onChange={(event) => {
                        const value = event.target.value;
                        setColumnMenu((prev) => (prev ? { ...prev, filter: value } : prev));
                        setColumnFilters((prev) => ({ ...prev, [columnMenu.col]: value }));
                      }}
                      placeholder="Escribe para filtrar..."
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.stopPropagation();
                          closeColumnMenu();
                        }
                      }}
                    />
                  </div>
                )}
                <div
                  className="column-menu-list"
                  role="menu"
                  tabIndex={0}
                  ref={columnMenuListRef}
                  aria-activedescendant={menuActiveId}
                  onKeyDown={handleMenuKeyDown}
                >
                  {menuEntries.map((entry, index) => {
                    if (entry.kind === "separator") {
                      return (
                        <div
                          key={entry.key}
                          className="column-menu-separator"
                          role="separator"
                        />
                      );
                    }
                    const isActive = index === columnMenuActiveIndex;
                    const onClick = () => {
                      if (entry.disabled) return;
                      if (entry.submenu) {
                        setMenuView(entry.submenu);
                        return;
                      }
                      entry.action?.();
                    };
                    return (
                      <div
                        key={entry.key}
                        id={`column-menu-${columnMenuView}-${index}`}
                        role="menuitem"
                        aria-disabled={entry.disabled ? "true" : undefined}
                        aria-haspopup={entry.submenu ? "dialog" : undefined}
                        aria-expanded={entry.submenu ? (columnMenuView === entry.submenu ? "true" : "false") : undefined}
                        className={`column-menu-item ${isActive ? "active" : ""} ${
                          entry.disabled ? "disabled" : ""
                        }`}
                        onMouseEnter={() => setColumnMenuActiveIndex(index)}
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
    </div>
  );
};

export default TrackerPage;
