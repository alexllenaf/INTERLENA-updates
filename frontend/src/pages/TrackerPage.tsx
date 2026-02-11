import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ApplicationForm from "../components/ApplicationForm";
import ContactsEditor from "../components/ContactsEditor";
import DocumentsDropzone from "../components/DocumentsDropzone";
import StarRating from "../components/StarRating";
import { DateCell, DateTimeCell, TextCell } from "../components/TableCells";
import { deleteDocument, documentDownloadUrl, downloadExcel, openExternal, uploadDocuments } from "../api";
import { useAppData } from "../state";
import { Application, Contact, DocumentFile } from "../types";
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
                      setDragOption(option.label);
                    }}
                    onDragOver={(event) => {
                      if (!draggable || !dragOption) return;
                      event.preventDefault();
                      setDragOver(option.label);
                    }}
                    onDragLeave={() => {
                      if (dragOver === option.label) setDragOver(null);
                    }}
                    onDrop={(event) => {
                      if (!dragOption || !draggable || dragOption === option.label) return;
                      event.preventDefault();
                      onReorderOption?.(dragOption, option.label);
                      setDragOption(null);
                      setDragOver(null);
                    }}
                    onDragEnd={() => {
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

type RatingCellProps = {
  value?: number | null;
  onCommit: (next: number | null) => void;
};

const RatingCell: React.FC<RatingCellProps> = ({ value, onCommit }) => (
  <StarRating value={value ?? null} onChange={onCommit} size="sm" step={0.5} />
);

const TrackerPage: React.FC = () => {
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
  const [showColumns, setShowColumns] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Application | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [sortConfig, setSortConfig] = useState<{ column: string; direction: "asc" | "desc" } | null>(null);
  const [columnMenu, setColumnMenu] = useState<{ col: string; rename: string; filter: string } | null>(null);
  const [columnMenuPos, setColumnMenuPos] = useState<{ top: number; left: number } | null>(null);
  const columnMenuRef = useRef<HTMLDivElement | null>(null);
  const columnMenuAnchorRef = useRef<HTMLElement | null>(null);
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
  }, [applications, query, stageFilter, outcomeFilter, columnFilters]);

  const sorted = useMemo(() => {
    if (!sortConfig) return filtered;
    const { column, direction } = sortConfig;
    const dir = direction === "asc" ? 1 : -1;
    const getValue = (app: Application) => {
      if (column.startsWith("prop__")) {
        const key = column.replace("prop__", "");
        return app.properties?.[key] || "";
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
  }, [filtered, sortConfig]);

  const visibleIds = useMemo(() => sorted.map((app) => app.id), [sorted]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleIds.some((id) => selectedIds.has(id));

  const computeColumnMenuPos = useCallback((anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const left = Math.min(
      Math.max(rect.right - COLUMN_MENU_WIDTH, COLUMN_MENU_GUTTER),
      window.innerWidth - COLUMN_MENU_WIDTH - COLUMN_MENU_GUTTER
    );
    const top = rect.bottom + COLUMN_MENU_OFFSET;
    return { top, left };
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
    if (!columnMenu || !columnMenuAnchorRef.current) return;
    const updatePosition = () => {
      if (!columnMenuAnchorRef.current) return;
      setColumnMenuPos(computeColumnMenuPos(columnMenuAnchorRef.current));
    };
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [columnMenu, computeColumnMenuPos]);

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

  const handleSaveColumns = () => {
    const nextHidden = columnOrderDraft.filter((col) => !visibleDraft.includes(col));
    saveSettings({
      ...settings,
      table_columns: columnOrderDraft,
      hidden_columns: nextHidden
    });
  };

  const density = settings.table_density || "comfortable";
  const rowHeight = density === "compact" ? 36 : 44;

  const getColumnWidth = (col: string) =>
    columnWidths[col] || DEFAULT_COLUMN_WIDTHS[col] || DEFAULT_COLUMN_WIDTH;

  const getColumnType = (col: string) => {
    if (col.startsWith("prop__")) return "Select";
    return COLUMN_TYPES[col] || "Text";
  };

  const closeColumnMenu = () => {
    setColumnMenu(null);
    setColumnMenuPos(null);
    columnMenuAnchorRef.current = null;
  };

  const openColumnMenu = (col: string, anchor: HTMLElement) => {
    columnMenuAnchorRef.current = anchor;
    setColumnMenuPos(computeColumnMenuPos(anchor));
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
        const nextProps = [...settings.custom_properties];
        nextProps[idx] = { ...nextProps[idx], name: nextLabel };
        await saveSettings({ ...settings, custom_properties: nextProps });
      }
    } else {
      const baseLabel = COLUMN_LABELS[columnMenu.col];
      const nextLabels = { ...(settings.column_labels || {}) };
      if (baseLabel && baseLabel === nextLabel) {
        delete nextLabels[columnMenu.col];
      } else {
        nextLabels[columnMenu.col] = nextLabel;
      }
      await saveSettings({ ...settings, column_labels: nextLabels });
    }
    closeColumnMenu();
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
    setColumnMenu(null);
  };

  const handleColumnReorder = (targetCol: string) => {
    if (!draggedCol || draggedCol === targetCol) return;
    const next = [...columnOrderDraft];
    const fromIndex = next.indexOf(draggedCol);
    const toIndex = next.indexOf(targetCol);
    if (fromIndex < 0 || toIndex < 0) return;
    next.splice(fromIndex, 1);
    next.splice(toIndex, 0, draggedCol);
    setColumnOrderDraft(next);
    saveSettings({ ...settings, table_columns: next });
    setDraggedCol(null);
    setDragOverCol(null);
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
        let value: unknown = "";
        if (col.startsWith("prop__")) {
          const key = col.replace("prop__", "");
          value = app.properties?.[key] || "";
        } else if (col === "contacts") {
          value = contactsToString(app.contacts);
        } else if (col === "documents_files") {
          value = documentsToString(app.documents_files);
        } else {
          value = (app as Record<string, unknown>)[col];
        }
        const safe = value === null || value === undefined ? "" : String(value);
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

  const stickyColumn = orderedVisible[0];
  const viewHeight = viewportHeight || rowHeight * 10;
  const shouldVirtualize = sorted.length > 200;
  const totalHeight = shouldVirtualize ? sorted.length * rowHeight : 0;
  const startIndex = shouldVirtualize ? Math.max(0, Math.floor(scrollTop / rowHeight) - 5) : 0;
  const endIndex = shouldVirtualize
    ? Math.min(sorted.length, Math.ceil((scrollTop + viewHeight) / rowHeight) + 5)
    : sorted.length;
  const visibleRows = shouldVirtualize ? sorted.slice(startIndex, endIndex) : sorted;
  const topSpacer = shouldVirtualize ? startIndex * rowHeight : 0;
  const bottomSpacer = shouldVirtualize ? totalHeight - endIndex * rowHeight : 0;

  return (
    <div className={`tracker density-${density}`}>
      <section className="panel toolbar">
        <div className="toolbar-left">
          <div>
            <h2>Tracker Table</h2>
            <p>Search, edit, and manage every application.</p>
          </div>
        </div>
        <div className="toolbar-right">
          <div className="density-toggle">
            <label htmlFor="density">Density</label>
            <select
              id="density"
              value={density}
              onChange={(event) =>
                saveSettings({ ...settings, table_density: event.target.value as "compact" | "comfortable" })
              }
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </div>
        </div>
      </section>

      <section className="panel filters">
        <div className="field">
          <label>Search</label>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Company, role, location..." />
        </div>
        <div className="field">
          <label>Stage</label>
          <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
            <option value="all">All</option>
            {settings.stages.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Outcome</label>
          <select value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value)}>
            <option value="all">All</option>
            {settings.outcomes.map((outcome) => (
              <option key={outcome} value={outcome}>
                {outcome}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="panel columns-panel">
        <div className="columns-header">
          <div>
            <h3>Columns</h3>
            <p>Choose which columns are visible in the table.</p>
          </div>
          <div className="columns-actions">
            <button
              className="icon-button columns-toggle"
              type="button"
              aria-expanded={showColumns}
              aria-controls="columns-grid"
              onClick={() => setShowColumns((prev) => !prev)}
              title={showColumns ? "Hide columns" : "Show columns"}
            >
              {showColumns ? "▾" : "▸"}
            </button>
            <button className="ghost" onClick={() => setVisibleDraft([...columnOrderDraft])}>
              Show all
            </button>
            <button className="ghost" onClick={() => setVisibleDraft([...visibleFromSettings])}>
              Reset
            </button>
            <button className="primary" onClick={handleSaveColumns}>
              Save columns
            </button>
          </div>
        </div>
        {showColumns && (
          <div className="columns-grid" id="columns-grid">
            {columnOrderDraft.map((col) => (
              <label key={col} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={visibleDraft.includes(col)}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setVisibleDraft((prev) =>
                      checked ? [...prev, col] : prev.filter((item) => item !== col)
                    );
                  }}
                />
                <span>{labelForColumn(col)}</span>
              </label>
            ))}
          </div>
        )}
      </section>

      <section className="panel actions-panel">
        <div className="toolbar-actions-box">
          <button className="ghost" onClick={() => downloadExcel("all")}>
            Export All
          </button>
          <button className="ghost" onClick={() => downloadExcel("favorites")}>
            Export Favorites
          </button>
          <button className="ghost" onClick={() => downloadExcel("active")}>
            Export Active
          </button>
          <button className="primary" onClick={() => setShowForm(true)}>
            New Application
          </button>
        </div>
      </section>

      {selectedIds.size > 0 && (
        <div className="bulk-bar">
          <div className="bulk-count">{selectedIds.size} selected</div>
          <div className="bulk-actions">
            <select
              value={bulkStage}
              onChange={(event) => {
                setBulkStage(event.target.value);
                handleBulkStage(event.target.value);
              }}
            >
              <option value="">Set stage...</option>
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
              <option value="">Set outcome...</option>
              {settings.outcomes.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {outcome}
                </option>
              ))}
            </select>
            <button className="ghost" type="button" onClick={handleExportSelected}>
              Export Selected
            </button>
            <button className="danger" type="button" onClick={handleBulkDelete}>
              Delete Selected
            </button>
          </div>
        </div>
      )}

      <section className="panel table-panel">
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
                        setDraggedCol(col);
                      }}
                      onDragEnd={() => {
                        setDraggedCol(null);
                        setDragOverCol(null);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        if (draggedCol && draggedCol !== col) {
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
                      {columnMenu && columnMenu.col === col && columnMenuPos && (
                        <div
                          className="column-menu"
                          ref={columnMenuRef}
                          style={
                            columnMenuPos
                              ? { top: columnMenuPos.top, left: columnMenuPos.left, position: "fixed" }
                              : undefined
                          }
                        >
                          <div className="column-menu-section">
                            <button
                              className="ghost"
                              type="button"
                              onClick={() => {
                                setSortConfig({ column: col, direction: "asc" });
                                closeColumnMenu();
                              }}
                            >
                              Sort A → Z
                            </button>
                            <button
                              className="ghost"
                              type="button"
                              onClick={() => {
                                setSortConfig({ column: col, direction: "desc" });
                                closeColumnMenu();
                              }}
                            >
                              Sort Z → A
                            </button>
                            {sortActive && (
                              <button
                                className="ghost"
                                type="button"
                                onClick={() => {
                                  setSortConfig(null);
                                  closeColumnMenu();
                                }}
                              >
                                Clear sort
                              </button>
                            )}
                          </div>
                          <div className="column-menu-section">
                            <label>Filter</label>
                            <input
                              type="text"
                              value={columnMenu.filter}
                              onChange={(event) => {
                                const value = event.target.value;
                                setColumnMenu((prev) =>
                                  prev ? { ...prev, filter: value } : prev
                                );
                                setColumnFilters((prev) => ({ ...prev, [col]: value }));
                              }}
                              placeholder="Type to filter..."
                            />
                            {filterActive && (
                              <button
                                className="ghost"
                                type="button"
                                onClick={() => {
                                  setColumnFilters((prev) => ({ ...prev, [col]: "" }));
                                  setColumnMenu((prev) => (prev ? { ...prev, filter: "" } : prev));
                                }}
                              >
                                Clear filter
                              </button>
                            )}
                          </div>
                          <div className="column-menu-section">
                            <label>Rename</label>
                            <input
                              type="text"
                              value={columnMenu.rename}
                              onChange={(event) =>
                                setColumnMenu((prev) =>
                                  prev ? { ...prev, rename: event.target.value } : prev
                                )
                              }
                              placeholder="Column name"
                            />
                            <button className="primary" type="button" onClick={applyColumnRename}>
                              Save name
                            </button>
                          </div>
                          <div className="column-menu-section">
                            <span className="column-type">Type: {getColumnType(col)}</span>
                          </div>
                          <button
                            className="danger"
                            type="button"
                            onClick={() => handleHideColumn(col)}
                          >
                            Hide column
                          </button>
                        </div>
                      )}
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
              {visibleRows.map((app) => {
                const stageOptions = buildSelectOptions(app.stage, settings.stages, settings.stage_colors);
                const outcomeOptions = buildSelectOptions(app.outcome, settings.outcomes, settings.outcome_colors);
                const jobTypeOptions = buildSelectOptions(
                  app.job_type,
                  settings.job_types,
                  settings.job_type_colors
                );
                const isSelected = selectedIds.has(app.id);

                return (
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
                          onCommit={(next) => {
                            if (next === currentValue) return;
                            const nextProps = { ...(app.properties || {}) };
                            nextProps[propKey] = next;
                            updateApplication(app.id, { properties: nextProps });
                          }}
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
              })}
              {shouldVirtualize && bottomSpacer > 0 && (
                <tr className="spacer-row">
                  <td colSpan={orderedVisible.length + 2} style={{ height: bottomSpacer }} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {sorted.length === 0 && <div className="empty">No applications match your filters.</div>}
      </section>

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
    </div>
  );
};

export default TrackerPage;
