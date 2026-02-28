import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ContactsManagerModal from "../../components/ContactsManagerModal";
import DocumentsDropzone from "../../components/DocumentsDropzone";
import StarRating from "../../components/StarRating";
import { DateCell, SelectCell, TextCell } from "../../components/TableCells";
import { openExternal } from "../../api";
import { normalizeTodoStatus, TODO_STATUSES, TODO_STATUS_CLASS } from "../../constants";
import type { Contact, DocumentFile, TodoItem } from "../../types";
import { formatFileSize, generateId, toDateInputValue } from "../../utils";
import { TODO_STATUS_SELECT_OPTIONS } from "./trackerConstants";

export type CheckboxCellProps = {
  checked: boolean;
  onCommit: (next: boolean) => void;
};

export const CheckboxCell: React.FC<CheckboxCellProps> = ({ checked, onCommit }) => (
  <input
    className="cell-checkbox"
    type="checkbox"
    checked={checked}
    onChange={(event) => onCommit(event.target.checked)}
  />
);

export type NumberCellProps = {
  value?: number | null;
  step?: number;
  min?: number;
  max?: number;
  onCommit: (next: number | null) => void;
};

export const NumberCell: React.FC<NumberCellProps> = ({ value, step, min, max, onCommit }) => {
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

export type TodoItemsCellProps = {
  items?: TodoItem[] | null;
  onCommit: (next: TodoItem[]) => void;
};

export const TodoItemsCell: React.FC<TodoItemsCellProps> = ({ items, onCommit }) => {
  const list = items ?? [];
  const [open, setOpen] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState({
    task: "",
    due_date: "",
    status: "Not started"
  });

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (editorRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const pendingCount = list.filter((item) => normalizeTodoStatus(item.status) !== "Done").length;

  const updateTodo = (id: string, patch: Partial<TodoItem>) => {
    const next = list.map((item) => {
      if (item.id !== id) return item;
      const merged = { ...item, ...patch };
      return {
        ...merged,
        task: (merged.task || "").trim(),
        due_date: merged.due_date ? toDateInputValue(merged.due_date) : undefined,
        status: normalizeTodoStatus(merged.status)
      };
    });
    onCommit(next);
  };

  const removeTodo = (id: string) => {
    const next = list.filter((item) => item.id !== id);
    if (next.length === list.length) return;
    onCommit(next);
  };

  const addTodo = () => {
    const task = draft.task.trim();
    if (!task) return;
    onCommit([
      ...list,
      {
        id: generateId(),
        task,
        due_date: draft.due_date || undefined,
        status: normalizeTodoStatus(draft.status)
      }
    ]);
    setDraft({ task: "", due_date: "", status: "Not started" });
  };

  return (
    <div className="todo-items-cell" ref={editorRef}>
      <div className="todo-items-summary">
        {list.length === 0 ? (
          <span className="todo-items-empty">No to-do items yet.</span>
        ) : (
          <span>{`${list.length} item${list.length === 1 ? "" : "s"} • ${pendingCount} pending`}</span>
        )}
      </div>
      <button className="link-button" type="button" onClick={() => setOpen((prev) => !prev)}>
        {open ? "Close to-dos" : "Add to-do"}
      </button>
      {open && (
        <div className="todo-items-popover">
          {list.length === 0 ? (
            <div className="todo-items-empty">No to-do items yet.</div>
          ) : (
            <table className="table todo-table todo-items-table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Due Date</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((item) => {
                  const status = normalizeTodoStatus(item.status);
                  return (
                    <tr key={item.id} className={status === "Done" ? "todo-completed" : undefined}>
                      <td>
                        <TextCell
                          value={item.task || ""}
                          onCommit={(next) => updateTodo(item.id, { task: next })}
                        />
                      </td>
                      <td>
                        <DateCell
                          value={item.due_date || ""}
                          onCommit={(next) => updateTodo(item.id, { due_date: next || undefined })}
                        />
                      </td>
                      <td>
                        <SelectCell
                          value={status}
                          options={TODO_STATUS_SELECT_OPTIONS}
                          onCommit={(next) => updateTodo(item.id, { status: normalizeTodoStatus(next) })}
                        />
                      </td>
                      <td>
                        <button className="ghost small" type="button" onClick={() => removeTodo(item.id)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="todo-items-add-row">
            <input
              className="cell-input"
              placeholder="New task"
              value={draft.task}
              onChange={(event) => setDraft((prev) => ({ ...prev, task: event.target.value }))}
            />
            <input
              className="cell-date"
              type="date"
              value={draft.due_date}
              onChange={(event) => setDraft((prev) => ({ ...prev, due_date: event.target.value }))}
            />
            <select
              className={`cell-select todo-status ${TODO_STATUS_CLASS[normalizeTodoStatus(draft.status)]}`}
              value={draft.status}
              onChange={(event) => setDraft((prev) => ({ ...prev, status: event.target.value }))}
            >
              {TODO_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <button className="primary small" type="button" onClick={addTodo}>
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export type ContactsCellProps = {
  contacts?: Contact[] | null;
  onCommit: (next: Contact[]) => void;
};

export const ContactsCell: React.FC<ContactsCellProps> = ({ contacts, onCommit }) => {
  const list = contacts ?? [];
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="contacts-cell">
      <div
        className="contacts-list contacts-list-clickable"
        onClick={() => setModalOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setModalOpen(true); }}
      >
        {list.length === 0 && <span className="contacts-empty">Sin contactos</span>}
        {list.map((contact) => (
          <div className="contact-item" key={contact.id}>
            <div className="contact-name">{contact.name}</div>
            <div className="contact-meta">
              {contact.information && <span>{contact.information}</span>}
              {contact.email && <span>{contact.email}</span>}
              {contact.phone && <span>{contact.phone}</span>}
            </div>
          </div>
        ))}
      </div>
      <button className="link-button" type="button" onClick={() => setModalOpen(true)}>
        + Añadir contacto
      </button>
      {modalOpen && (
        <ContactsManagerModal
          contacts={list}
          onCommit={onCommit}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
};

export type LinkItem = {
  id: string;
  label: string;
  url: string;
};

export const parseJsonArraySafe = (raw: string): unknown[] => {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const parseContactsPropValue = (raw: string): Contact[] => {
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

export const parseLinksPropValue = (raw: string): LinkItem[] => {
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

export const parseDocumentsPropValue = (raw: string): string[] => {
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

export type LinksCellProps = {
  links?: LinkItem[] | null;
  onCommit: (next: LinkItem[]) => void;
};

export const normalizeUrl = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

export const guessLinkLabel = (url: string): string => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\\./i, "");
    return host || url;
  } catch {
    return url;
  }
};

export const LinksCell: React.FC<LinksCellProps> = ({ links, onCommit }) => {
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

export type DocumentsPropertyCellProps = {
  files: DocumentFile[];
  selectedIds: string[];
  onCommit: (nextIds: string[]) => void;
  onUploadAndAttach: (files: File[], signal: AbortSignal) => Promise<void>;
  onDeleteFile: (file: DocumentFile) => Promise<boolean> | boolean;
  onOpenFile: (file: DocumentFile) => void;
};

export const DocumentsPropertyCell: React.FC<DocumentsPropertyCellProps> = ({
  files,
  selectedIds,
  onCommit,
  onUploadAndAttach,
  onDeleteFile,
  onOpenFile
}) => {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingDeleteFile, setPendingDeleteFile] = useState<DocumentFile | null>(null);
  const [deletingFile, setDeletingFile] = useState(false);
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
                    onClick={() => setOpen(true)}
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
                  <button className="doc-chip doc-button" type="button" onClick={() => setOpen(true)} title={id}>
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M5 2.5h6l4 4V17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Zm6 1.5H6v12h8V8h-3V4Z" />
                    </svg>
                    <span>{label}</span>
                  </button>
                )}
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
                <div
                  key={file.id}
                  className={`docs-prop-row ${selectedIds.includes(file.id) ? "selected" : ""}`}
                >
                  <button className="docs-prop-row-main" type="button" onClick={() => toggleId(file.id)}>
                    <span className="docs-prop-row-check">{selectedIds.includes(file.id) ? "✓" : ""}</span>
                    <span className="docs-prop-row-name">
                      {file.name}
                      {file.size ? ` ${formatFileSize(file.size)}` : ""}
                    </span>
                  </button>
                  <span className="docs-prop-row-actions">
                    <button
                      className="doc-icon-button info"
                      type="button"
                      aria-label="Document info"
                      title="Document info"
                      onClick={() => onOpenFile(file)}
                    >
                      i
                    </button>
                    <button
                      className="doc-icon-button danger"
                      type="button"
                      aria-label="Delete document"
                      title="Delete document"
                      onClick={() => setPendingDeleteFile(file)}
                    >
                      <svg viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M7.5 3.5h5l.5 1.5H17v1.5H3V5h3.5l.5-1.5Zm1 4h1.5v7H8.5v-7Zm3 0H13v7h-1.5v-7ZM5.5 6.5h9l-.6 9.1a1.5 1.5 0 0 1-1.5 1.4H7.6a1.5 1.5 0 0 1-1.5-1.4l-.6-9.1Z" />
                      </svg>
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
      {pendingDeleteFile && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setPendingDeleteFile(null)}>
          <div className="modal confirm-delete-modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <div>
                <h2>Delete Document</h2>
                <p>{pendingDeleteFile.name}</p>
              </div>
              <button className="ghost" type="button" onClick={() => setPendingDeleteFile(null)} aria-label="Close">
                ×
              </button>
            </header>
            <p>Do you want to delete this document?</p>
            <div className="confirm-delete-actions">
              <button className="ghost" type="button" onClick={() => setPendingDeleteFile(null)} disabled={deletingFile}>
                Cancel
              </button>
              <button
                className="icon-button danger"
                type="button"
                aria-label="Delete document"
                disabled={deletingFile}
                onClick={async () => {
                  const target = pendingDeleteFile;
                  if (!target) return;
                  setDeletingFile(true);
                  const removed = await Promise.resolve(onDeleteFile(target));
                  if (removed) {
                    onCommit(selectedIds.filter((id) => id !== target.id));
                    setPendingDeleteFile(null);
                  }
                  setDeletingFile(false);
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

export type RatingCellProps = {
  value?: number | null;
  onCommit: (next: number | null) => void;
};

export const RatingCell: React.FC<RatingCellProps> = ({ value, onCommit }) => (
  <StarRating value={value ?? null} onChange={onCommit} size="sm" step={0.5} />
);

export const ColumnMenuIcon: React.FC<{ viewBox?: string; children: React.ReactNode }> = ({
  viewBox = "0 0 20 20",
  children
}) => (
  <svg aria-hidden="true" viewBox={viewBox} className="column-menu-icon">
    {children}
  </svg>
);

export const ColumnMenuChevronRight = () => (
  <ColumnMenuIcon viewBox="0 0 16 16">
    <path d="M6.722 3.238a.625.625 0 1 0-.884.884L9.716 8l-3.878 3.878a.625.625 0 0 0 .884.884l4.32-4.32a.625.625 0 0 0 0-.884z" />
  </ColumnMenuIcon>
);
