import React, { useEffect, useMemo, useState } from "react";
import ContactsEditor from "./ContactsEditor";
import DocumentsDropzone from "./DocumentsDropzone";
import StarRating from "./StarRating";
import { documentDownloadUrl, openExternal } from "../api";
import { Application, ApplicationInput, DocumentFile, Settings, TodoItem } from "../types";
import { normalizeTodoStatus, TODO_STATUSES, TODO_STATUS_CLASS } from "../constants";
import { formatFileSize, generateId } from "../utils";

type ApplicationFormProps = {
  initial?: Application | null;
  settings: Settings;
  onSubmit: (payload: ApplicationInput, files: File[]) => void;
  onClose: () => void;
  onDeleteExistingDocument?: (fileId: string) => Promise<void> | void;
};

const defaultForm: ApplicationInput = {
  company_name: "",
  position: "",
  job_type: "",
  stage: "",
  outcome: "",
  location: "",
  application_date: "",
  interview_datetime: "",
  followup_date: "",
  interview_rounds: undefined,
  interview_type: "",
  interviewers: "",
  company_score: null,
  last_round_cleared: "",
  total_rounds: undefined,
  my_interview_score: undefined,
  improvement_areas: "",
  skill_to_upgrade: "",
  job_description: "",
  notes: "",
  todo_items: [],
  documents_links: "",
  contacts: [],
  favorite: false,
  properties: {}
};

function toNullableNumber(value: string): number | undefined {
  if (value === "" || value === undefined) return undefined;
  const num = Number(value);
  return Number.isNaN(num) ? undefined : num;
}

const ApplicationForm: React.FC<ApplicationFormProps> = ({
  initial,
  settings,
  onSubmit,
  onClose,
  onDeleteExistingDocument
}) => {
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [existingFiles, setExistingFiles] = useState<DocumentFile[]>(initial?.documents_files || []);
  const [form, setForm] = useState<ApplicationInput>(() => {
    if (!initial) return { ...defaultForm, job_type: settings.job_types[0] || "", stage: settings.stages[0] || "", outcome: settings.outcomes[0] || "" };
    return {
      company_name: initial.company_name,
      position: initial.position,
      job_type: initial.job_type,
      stage: initial.stage,
      outcome: initial.outcome,
      location: initial.location || "",
      application_date: initial.application_date || "",
      interview_datetime: initial.interview_datetime || "",
      followup_date: initial.followup_date || "",
      interview_rounds: initial.interview_rounds || undefined,
      interview_type: initial.interview_type || "",
      interviewers: initial.interviewers || "",
      company_score: initial.company_score ?? null,
      last_round_cleared: initial.last_round_cleared || "",
      total_rounds: initial.total_rounds || undefined,
      my_interview_score: initial.my_interview_score || undefined,
      improvement_areas: initial.improvement_areas || "",
      skill_to_upgrade: initial.skill_to_upgrade || "",
      job_description: initial.job_description || "",
      notes: initial.notes || "",
      todo_items: initial.todo_items || [],
      documents_links: initial.documents_links || "",
      contacts: initial.contacts || [],
      favorite: initial.favorite,
      properties: initial.properties || {}
    };
  });

  const customProps = useMemo(() => settings.custom_properties || [], [settings]);

  useEffect(() => {
    setExistingFiles(initial?.documents_files || []);
  }, [initial]);

  const updateField = (key: keyof ApplicationInput, value: ApplicationInput[keyof ApplicationInput]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateProperty = (key: string, value: string) => {
    setForm((prev) => ({
      ...prev,
      properties: { ...(prev.properties || {}), [key]: value }
    }));
  };

  const addPendingFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setPendingFiles((prev) => [...prev, ...Array.from(files)]);
  };

  const handleRemoveExisting = async (fileId: string) => {
    if (!initial || !initial.id) return;
    if (!onDeleteExistingDocument) return;
    await Promise.resolve(onDeleteExistingDocument(fileId));
    setExistingFiles((prev) => prev.filter((file) => file.id !== fileId));
  };

  const todoItems = form.todo_items || [];
  const pendingTodos = todoItems.filter(
    (item) => normalizeTodoStatus(item.status) !== "Done"
  ).length;
  const [todoDraft, setTodoDraft] = useState({
    task: "",
    due_date: "",
    status: "Not started"
  });

  const updateTodoItem = (id: string, patch: Partial<TodoItem>) => {
    const next = todoItems.map((item) => (item.id === id ? { ...item, ...patch } : item));
    updateField("todo_items", next);
  };

  const removeTodoItem = (id: string) => {
    const next = todoItems.filter((item) => item.id !== id);
    updateField("todo_items", next);
  };

  const addTodoItem = () => {
    if (!todoDraft.task.trim()) return;
    const nextItem: TodoItem = {
      id: generateId(),
      task: todoDraft.task.trim(),
      due_date: todoDraft.due_date || undefined,
      status: normalizeTodoStatus(todoDraft.status)
    };
    updateField("todo_items", [...todoItems, nextItem]);
    setTodoDraft({ task: "", due_date: "", status: "Not started" });
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const cleanedTodos = (form.todo_items || [])
      .map((item) => ({
        ...item,
        task: item.task?.trim() || "",
        due_date: item.due_date || undefined,
        status: normalizeTodoStatus(item.status)
      }))
      .filter((item) => item.task);
    onSubmit(
      {
      ...form,
      location: form.location || undefined,
      application_date: form.application_date || undefined,
      interview_datetime: form.interview_datetime || undefined,
      followup_date: form.followup_date || undefined,
      interview_type: form.interview_type || undefined,
      interviewers: form.interviewers || undefined,
      last_round_cleared: form.last_round_cleared || undefined,
      improvement_areas: form.improvement_areas || undefined,
      skill_to_upgrade: form.skill_to_upgrade || undefined,
      job_description: form.job_description || undefined,
      notes: form.notes || undefined,
      documents_links: form.documents_links || undefined,
      company_score: form.company_score ?? undefined,
      contacts: form.contacts || [],
      todo_items: cleanedTodos,
      interview_rounds: form.interview_rounds ?? undefined,
      total_rounds: form.total_rounds ?? undefined,
      my_interview_score: form.my_interview_score ?? undefined
      },
      pendingFiles
    );
    setPendingFiles([]);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <header className="modal-header">
          <div>
            <h2>{initial ? "Edit Application" : "New Application"}</h2>
            <p>Capture each touchpoint and keep your pipeline accurate.</p>
          </div>
          <button className="ghost" onClick={onClose} type="button" aria-label="Close">
            ×
          </button>
        </header>
        <form onSubmit={handleSubmit} className="form-grid">
          <div className="field">
            <label>Company Name</label>
            <input
              value={form.company_name ?? ""}
              onChange={(e) => updateField("company_name", e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>Position</label>
            <input
              value={form.position ?? ""}
              onChange={(e) => updateField("position", e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>Job Type</label>
            <select value={form.job_type} onChange={(e) => updateField("job_type", e.target.value)} required>
              {settings.job_types.map((job) => (
                <option key={job} value={job}>
                  {job}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Stage</label>
            <select value={form.stage} onChange={(e) => updateField("stage", e.target.value)} required>
              {settings.stages.map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Outcome</label>
            <select value={form.outcome} onChange={(e) => updateField("outcome", e.target.value)} required>
              {settings.outcomes.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {outcome}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Location</label>
            <input
              value={form.location ?? ""}
              onChange={(e) => updateField("location", e.target.value)}
              placeholder="Remote, City, Country"
            />
          </div>
          <div className="field">
            <label>Application Date</label>
            <input
              type="date"
              value={form.application_date || ""}
              onChange={(e) => updateField("application_date", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Interview Date & Time</label>
            <input
              type="datetime-local"
              value={form.interview_datetime || ""}
              onChange={(e) => updateField("interview_datetime", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Follow-Up Date</label>
            <input
              type="date"
              value={form.followup_date || ""}
              onChange={(e) => updateField("followup_date", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Interview Rounds</label>
            <input
              type="number"
              value={form.interview_rounds ?? ""}
              onChange={(e) => updateField("interview_rounds", toNullableNumber(e.target.value))}
            />
          </div>
          <div className="field">
            <label>Total Rounds</label>
            <input
              type="number"
              value={form.total_rounds ?? ""}
              onChange={(e) => updateField("total_rounds", toNullableNumber(e.target.value))}
            />
          </div>
          <div className="field">
            <label>My Interview Score</label>
            <StarRating
              value={form.my_interview_score ?? null}
              onChange={(next) => updateField("my_interview_score", next)}
              size="md"
              step={0.5}
            />
          </div>
          <div className="field">
            <label>Company Score</label>
            <StarRating
              value={form.company_score ?? null}
              onChange={(next) => updateField("company_score", next)}
              size="md"
              step={0.5}
            />
          </div>
          <div className="field">
            <label>Interview Type</label>
            <input
              value={form.interview_type ?? ""}
              onChange={(e) => updateField("interview_type", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Interviewers</label>
            <input
              value={form.interviewers ?? ""}
              onChange={(e) => updateField("interviewers", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Last Round Cleared</label>
            <input
              value={form.last_round_cleared ?? ""}
              onChange={(e) => updateField("last_round_cleared", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Improvement Areas</label>
            <input
              value={form.improvement_areas ?? ""}
              onChange={(e) => updateField("improvement_areas", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Skill to Upgrade</label>
            <input
              value={form.skill_to_upgrade ?? ""}
              onChange={(e) => updateField("skill_to_upgrade", e.target.value)}
            />
          </div>
          <div className="field full">
            <label>Job Description</label>
            <textarea
              value={form.job_description ?? ""}
              onChange={(e) => updateField("job_description", e.target.value)}
              rows={3}
            />
          </div>
          <div className="field full">
            <label>Notes</label>
            <textarea
              value={form.notes ?? ""}
              onChange={(e) => updateField("notes", e.target.value)}
              rows={3}
            />
          </div>
          <div className="field full">
            <label>Documents / Links</label>
            <textarea
              value={form.documents_links ?? ""}
              onChange={(e) => updateField("documents_links", e.target.value)}
              rows={2}
            />
          </div>
          <div className="field full">
            <DocumentsDropzone onUpload={addPendingFiles} />
            <p className="documents-help">Adjunta CVs, portfolios o cartas de oferta.</p>
            {existingFiles.length > 0 && (
              <div className="documents-list">
                {existingFiles.map((file) => (
                  <div className="document-item" key={file.id}>
                    {initial?.id ? (
                    <a
                      href={documentDownloadUrl(initial.id, file.id)}
                      onClick={(event) => {
                        event.preventDefault();
                        void openExternal(documentDownloadUrl(initial.id, file.id));
                      }}
                      rel="noreferrer"
                    >
                      {file.name}
                    </a>
                    ) : (
                      <span>{file.name}</span>
                    )}
                    <span className="document-meta">{file.size ? formatFileSize(file.size) : ""}</span>
                    {onDeleteExistingDocument && (
                      <button
                        className="ghost small"
                        type="button"
                        onClick={() => handleRemoveExisting(file.id)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {pendingFiles.length > 0 && (
              <div className="documents-list">
                {pendingFiles.map((file, index) => (
                  <div className="document-item" key={`${file.name}-${index}`}>
                    <span>{file.name}</span>
                    <span className="document-meta">{formatFileSize(file.size)}</span>
                    <button
                      className="ghost small"
                      type="button"
                      onClick={() =>
                        setPendingFiles((prev) => prev.filter((_, idx) => idx !== index))
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="field full">
            <label>Contacts</label>
            <ContactsEditor
              contacts={form.contacts || []}
              onCommit={(next) => updateField("contacts", next)}
            />
          </div>

          <div className="field full">
            <div className="todo-header">
              <div>
                <h4>To Do Items</h4>
                <p>Track preparation tasks for this application.</p>
              </div>
              <div className="todo-summary">{pendingTodos} pending</div>
            </div>
            {todoItems.length === 0 ? (
              <div className="empty">No to-do items yet.</div>
            ) : (
              <table className="table todo-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Due Date</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {todoItems.map((item) => {
                    const status = normalizeTodoStatus(item.status);
                    return (
                      <tr
                        key={item.id}
                        className={status === "Done" ? "todo-completed" : undefined}
                      >
                        <td>
                          <input
                            className="cell-input"
                            value={item.task || ""}
                            onChange={(event) =>
                              updateTodoItem(item.id, { task: event.target.value })
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="date"
                            className="cell-date"
                            value={item.due_date || ""}
                            onChange={(event) =>
                              updateTodoItem(item.id, { due_date: event.target.value })
                            }
                          />
                        </td>
                        <td>
                          <select
                            className={`cell-select todo-status ${TODO_STATUS_CLASS[status]}`}
                            value={status}
                            onChange={(event) =>
                              updateTodoItem(item.id, {
                                status: normalizeTodoStatus(event.target.value)
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
                        <td>
                          <button
                            className="ghost small"
                            type="button"
                            onClick={() => removeTodoItem(item.id)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div className="todo-add-row">
              <input
                className="cell-input"
                placeholder="New task"
                value={todoDraft.task}
                onChange={(event) =>
                  setTodoDraft((prev) => ({ ...prev, task: event.target.value }))
                }
              />
              <input
                type="date"
                className="cell-date"
                value={todoDraft.due_date}
                onChange={(event) =>
                  setTodoDraft((prev) => ({ ...prev, due_date: event.target.value }))
                }
              />
              <select
                className={`cell-select todo-status ${TODO_STATUS_CLASS[normalizeTodoStatus(todoDraft.status)]}`}
                value={todoDraft.status}
                onChange={(event) =>
                  setTodoDraft((prev) => ({ ...prev, status: event.target.value }))
                }
              >
                {TODO_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <button className="primary small" type="button" onClick={addTodoItem}>
                Add
              </button>
            </div>
          </div>

          {customProps.length > 0 && (
            <div className="field full">
              <h4>Custom Properties</h4>
              <div className="custom-grid">
                {customProps.map((prop) => (
                  <div key={prop.key} className="field">
                    <label>{prop.name}</label>
                    <select
                      value={form.properties?.[prop.key] || ""}
                      onChange={(e) => updateProperty(prop.key, e.target.value)}
                    >
                      <option value="">Select</option>
                      {prop.options.map((opt) => (
                        <option key={opt.label} value={opt.label}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="field full toggle-row">
            <label className="toggle">
              <input
                type="checkbox"
                checked={form.favorite}
                onChange={(e) => updateField("favorite", e.target.checked)}
              />
              <span>Favorite</span>
            </label>
          </div>

          <div className="form-actions">
            <button className="ghost" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" type="submit">
              {initial ? "Save Changes" : "Create Application"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ApplicationForm;
