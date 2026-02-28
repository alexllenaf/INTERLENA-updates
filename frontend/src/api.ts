import {
  Application,
  ApplicationInput,
  CanonicalBlock,
  CanonicalDatabaseDetail,
  CanonicalDatabaseRecord,
  CanonicalDatabase,
  CanonicalPage,
  DatabaseRecordsResult,
  EmailBodyResult,
  EmailConnectionTestInput,
  EmailConnectionTestResult,
  EmailFoldersListResult,
  EmailOAuthStartInput,
  EmailOAuthStartResult,
  EmailReadStats,
  EmailMetadata,
  EmailMetadataInput,
  EmailMetadataSyncResult,
  EmailSendBatchResult,
  EmailSendContact,
  EmailSendStats,
  GoogleAccount,
  OnboardingCompleteInput,
  OnboardingCompleteResult,
  OnboardingStatus,
  OnboardingTemplate,
  PageBlocksResult,
  PageResolveResult,
  Settings,
  UpdateInfo,
  View
} from "./types";

export const API_BASE = import.meta.env.VITE_API_BASE || "/api";

const hasTauri = () =>
  typeof window !== "undefined" && !!(window as unknown as { __TAURI__?: unknown }).__TAURI__;

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const DATETIME_FIELDS = new Set(["application_date", "interview_datetime", "followup_date"]);

const toTrimmedOrNull = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const sanitizeContacts = (value: unknown): unknown => {
  if (!Array.isArray(value)) return value;
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => {
      const contact = entry as Record<string, unknown>;
      const name = toTrimmedOrNull(contact.name);
      if (!name) return null;
      const id = toTrimmedOrNull(contact.id) || `contact-${Date.now()}-${index}`;
      return {
        id,
        name,
        first_name: toTrimmedOrNull(contact.first_name) || undefined,
        last_name: toTrimmedOrNull(contact.last_name) || undefined,
        information: toTrimmedOrNull(contact.information) || undefined,
        email: toTrimmedOrNull(contact.email) || undefined,
        phone: toTrimmedOrNull(contact.phone) || undefined
      };
    })
    .filter(Boolean);
};

const sanitizeTodoItems = (value: unknown): unknown => {
  if (!Array.isArray(value)) return value;
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry, index) => {
      const todo = entry as Record<string, unknown>;
      const task = toTrimmedOrNull(todo.task);
      if (!task) return null;
      const id = toTrimmedOrNull(todo.id) || `todo-${Date.now()}-${index}`;
      return {
        id,
        task,
        due_date: toTrimmedOrNull(todo.due_date) || undefined,
        status: toTrimmedOrNull(todo.status) || undefined,
        task_location: toTrimmedOrNull(todo.task_location) || undefined,
        notes: toTrimmedOrNull(todo.notes) || undefined,
        documents_links: toTrimmedOrNull(todo.documents_links) || undefined
      };
    })
    .filter(Boolean);
};

const sanitizeApplicationPayload = <T extends Record<string, unknown>>(payload: T): T => {
  const next: Record<string, unknown> = { ...payload };

  Object.keys(next).forEach((key) => {
    const value = next[key];

    if (DATETIME_FIELDS.has(key)) {
      next[key] = typeof value === "string" ? toTrimmedOrNull(value) : value;
      return;
    }

    if (key === "contacts") {
      next[key] = sanitizeContacts(value);
      return;
    }

    if (key === "todo_items") {
      next[key] = sanitizeTodoItems(value);
    }
  });

  return next as T;
};

async function openExternal(url: string) {
  if (!url) return;
  let target = url;
  if (target.startsWith("file://")) {
    try {
      target = decodeURI(target.replace("file://", ""));
    } catch {
      // keep original url if decode fails
    }
  }

  const tauri = (window as unknown as {
    __TAURI__?: { shell?: { open?: (url: string) => Promise<void> } };
  }).__TAURI__;
  if (tauri?.shell?.open) {
    try {
      await tauri.shell.open(target);
      return;
    } catch {
      // fall through
    }
  }

  const popup = window.open(target, "_blank");
  if (popup) {
    popup.focus();
    return;
  }

  const link = document.createElement("a");
  link.href = target;
  link.target = "_blank";
  link.rel = "noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function openOAuthPopup(url: string) {
  if (!url) return;
  const width = 520;
  const height = 720;

  const tauri = (window as unknown as {
    __TAURI__?: { shell?: { open?: (url: string) => Promise<void> } };
  }).__TAURI__;

  if (tauri) {
    try {
      const { WebviewWindow, currentMonitor } = await import("@tauri-apps/api/window");
      const monitor = await currentMonitor();
      const screenWidth = Number(monitor?.size?.width || 1440);
      const screenHeight = Number(monitor?.size?.height || 900);
      const x = Math.max(0, Math.floor((screenWidth - width) / 2));
      const y = Math.max(0, Math.floor((screenHeight - height) / 2));
      new WebviewWindow(`oauth-${Date.now()}`, {
        url,
        title: "Google Sign-In",
        width,
        height,
        resizable: true,
        center: false,
        x,
        y,
      });
      return;
    } catch {
      // fallback below
    }
  }

  const left = Math.max(0, Math.floor((window.screen.width - width) / 2));
  const top = Math.max(0, Math.floor((window.screen.height - height) / 2));
  const popup = window.open(
    url,
    "google-oauth",
    `popup=yes,width=${width},height=${height},left=${left},top=${top}`
  );
  if (popup) {
    popup.focus();
    return;
  }

  await openExternal(url);
}

const parseContentDispositionFilename = (header: string | null): string | null => {
  if (!header) return null;
  const starMatch = header.match(/filename\*=([^;]+)/i);
  if (starMatch?.[1]) {
    const raw = starMatch[1].trim();
    const cleaned = raw.replace(/^UTF-8''/i, "").replace(/^"|"$/g, "");
    try {
      return decodeURIComponent(cleaned);
    } catch {
      return cleaned;
    }
  }
  const match = header.match(/filename=([^;]+)/i);
  if (match?.[1]) {
    return match[1].trim().replace(/^"|"$/g, "");
  }
  return null;
};

const downloadBlobInBrowser = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export async function saveBlobAsFile(blob: Blob, filename: string) {
  if (hasTauri()) {
    try {
      const { save } = await import("@tauri-apps/api/dialog");
      const { writeBinaryFile } = await import("@tauri-apps/api/fs");
      const path = await save({ defaultPath: filename });
      if (path) {
        const data = new Uint8Array(await blob.arrayBuffer());
        await writeBinaryFile({ path, contents: data });
        return;
      }
    } catch (error) {
      console.error("Failed to save file with Tauri", error);
    }
  }
  downloadBlobInBrowser(blob, filename);
}

const downloadFromUrl = async (url: string, fallbackFilename: string) => {
  if (!url) return;
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) {
      throw new Error(`Download failed (${res.status})`);
    }
    const blob = await res.blob();
    const filename =
      parseContentDispositionFilename(res.headers.get("content-disposition")) ||
      fallbackFilename;
    await saveBlobAsFile(blob, filename);
  } catch (error) {
    console.error("Failed to download file", error);
    if (!hasTauri()) {
      void openExternal(url);
    }
  }
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {})
    },
    ...options
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.detail) {
        message = data.detail;
      }
    } catch {
      // ignore
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

async function requestForm<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.detail) {
        message = data.detail;
      }
    } catch {
      // ignore
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export async function getSettings(): Promise<Settings> {
  const data = await request<{ settings: Settings }>("/settings");
  return data.settings;
}

export async function getUpdateInfo(): Promise<UpdateInfo> {
  return request<UpdateInfo>("/update");
}

export async function getStorageInfo(): Promise<{
  data_dir: string;
  db_path: string;
  uploads_dir: string;
  backups_dir: string;
  state_path: string;
  update_feed?: string;
}> {
  return request("/storage");
}

export async function updateSettings(settings: Partial<Settings>): Promise<Settings> {
  const data = await request<{ settings: Settings }>("/settings", {
    method: "PUT",
    body: JSON.stringify({ settings })
  });
  return data.settings;
}

export async function listPages(): Promise<CanonicalPage[]> {
  return request<CanonicalPage[]>("/pages");
}

export async function createPage(payload: {
  title: string;
  legacy_key?: string;
}): Promise<CanonicalPage> {
  return request<CanonicalPage>("/pages", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updatePage(
  pageId: string,
  payload: {
    title?: string;
    icon?: string | null;
    cover?: string | null;
  }
): Promise<CanonicalPage> {
  return request<CanonicalPage>(`/pages/${encodeURIComponent(pageId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export async function resolvePageByLegacyKey(
  legacyKey: string,
  createIfMissing = true
): Promise<CanonicalPage> {
  const query = new URLSearchParams();
  query.set("create_if_missing", createIfMissing ? "true" : "false");
  const data = await request<PageResolveResult>(
    `/pages/resolve/${encodeURIComponent(legacyKey)}?${query.toString()}`
  );
  return data.page;
}

export async function getPageBlocks(pageId: string): Promise<PageBlocksResult> {
  return request<PageBlocksResult>(`/pages/${encodeURIComponent(pageId)}/blocks`);
}

export async function getPageBlocksByLegacyKey(legacyKey: string): Promise<PageBlocksResult> {
  return request<PageBlocksResult>(`/pages/by-legacy/${encodeURIComponent(legacyKey)}/blocks`);
}

export async function savePageBlocks(pageId: string, blocks: CanonicalBlock[]): Promise<PageBlocksResult> {
  return request<PageBlocksResult>(`/pages/${encodeURIComponent(pageId)}/blocks`, {
    method: "PUT",
    body: JSON.stringify({ blocks })
  });
}

export async function deletePage(pageId: string): Promise<void> {
  await request(`/pages/${encodeURIComponent(pageId)}`, {
    method: "DELETE"
  });
}

export async function getDatabases(): Promise<CanonicalDatabase[]> {
  return request<CanonicalDatabase[]>("/databases");
}

export async function getDatabaseByName(databaseName: string): Promise<{
  id: string;
  name: string;
  created_at?: string | null;
  updated_at?: string | null;
}> {
  return request(`/databases/by-name/${encodeURIComponent(databaseName)}`);
}

export async function getDatabaseDetail(databaseId: string): Promise<CanonicalDatabaseDetail> {
  return request<CanonicalDatabaseDetail>(`/databases/${encodeURIComponent(databaseId)}`);
}

export async function getDatabaseRecords(
  databaseId: string,
  params: { view_id?: string } = {}
): Promise<DatabaseRecordsResult> {
  const query = new URLSearchParams();
  if (params.view_id) query.set("view_id", params.view_id);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<DatabaseRecordsResult>(`/databases/${encodeURIComponent(databaseId)}/records${suffix}`);
}

export async function createDatabaseRecord(
  databaseId: string,
  payload: { values?: Record<string, unknown>; page?: Record<string, unknown> }
): Promise<CanonicalDatabaseRecord> {
  return request<CanonicalDatabaseRecord>(`/databases/${encodeURIComponent(databaseId)}/records`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateDatabaseRecord(
  databaseId: string,
  recordId: string,
  payload: { values?: Record<string, unknown>; page?: Record<string, unknown> }
): Promise<CanonicalDatabaseRecord> {
  return request<CanonicalDatabaseRecord>(
    `/databases/${encodeURIComponent(databaseId)}/records/${encodeURIComponent(recordId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload)
    }
  );
}

export async function deleteDatabaseRecord(databaseId: string, recordId: string): Promise<void> {
  await request(
    `/databases/${encodeURIComponent(databaseId)}/records/${encodeURIComponent(recordId)}`,
    {
      method: "DELETE"
    }
  );
}

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  return request<OnboardingStatus>("/onboarding/status");
}

export async function getOnboardingTemplates(): Promise<OnboardingTemplate[]> {
  return request<OnboardingTemplate[]>("/onboarding/templates");
}

export async function completeOnboarding(
  payload: OnboardingCompleteInput
): Promise<OnboardingCompleteResult> {
  return request<OnboardingCompleteResult>("/onboarding/complete", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

const APPLICATIONS_DATABASE_NAME = "Applications";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const parseUnknownJson = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const toNumericOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toIntegerOrNull = (value: unknown): number | null => {
  const parsed = toNumericOrNull(value);
  return parsed === null ? null : Math.trunc(parsed);
};

const toTextOrNull = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return String(value);
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const toBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "si";
  }
  return false;
};

const parseTodoItemsValue = (value: unknown): Application["todo_items"] => {
  const parsed = parseUnknownJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((entry) => isRecord(entry))
    .map((entry, index) => {
      const id = toTextOrNull(entry.id) || `todo-${index}`;
      const task = toTextOrNull(entry.task) || "";
      if (!task) return null;
      return {
        id,
        task,
        due_date: toTextOrNull(entry.due_date) || undefined,
        status: toTextOrNull(entry.status) || undefined,
        task_location: toTextOrNull(entry.task_location) || undefined,
        notes: toTextOrNull(entry.notes) || undefined,
        documents_links: toTextOrNull(entry.documents_links) || undefined
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
};

const parseDocumentsFilesValue = (value: unknown): Application["documents_files"] => {
  const parsed = parseUnknownJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((entry) => isRecord(entry))
    .map((entry, index) => {
      const id = toTextOrNull(entry.id) || `file-${index}`;
      const name = toTextOrNull(entry.name) || "";
      if (!name) return null;
      return {
        id,
        name,
        size: toIntegerOrNull(entry.size) ?? undefined,
        content_type: toTextOrNull(entry.content_type) || undefined,
        uploaded_at: toTextOrNull(entry.uploaded_at) || undefined
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
};

const parseContactsValue = (value: unknown): Application["contacts"] => {
  const parsed = parseUnknownJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((entry) => isRecord(entry))
    .map((entry, index) => {
      const id = toTextOrNull(entry.id) || `contact-${index}`;
      const name = toTextOrNull(entry.name) || "";
      if (!name) return null;
      return {
        id,
        name,
        first_name: toTextOrNull(entry.first_name) || undefined,
        last_name: toTextOrNull(entry.last_name) || undefined,
        information: toTextOrNull(entry.information) || undefined,
        email: toTextOrNull(entry.email) || undefined,
        phone: toTextOrNull(entry.phone) || undefined
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
};

const parsePropertiesValue = (value: unknown): Record<string, string> => {
  const parsed = parseUnknownJson(value);
  if (!isRecord(parsed)) return {};
  const out: Record<string, string> = {};
  Object.entries(parsed).forEach(([key, raw]) => {
    if (raw === null || raw === undefined) return;
    out[key] = String(raw);
  });
  return out;
};

const stableNumericIdFromRecordId = (recordId: string): number => {
  let hash = 0;
  for (let i = 0; i < recordId.length; i += 1) {
    hash = (hash * 31 + recordId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash || 1);
};

const mapCanonicalRecordToApplication = (record: CanonicalDatabaseRecord): Application => {
  const raw = isRecord(record.properties) ? record.properties : {};
  const numericId = toIntegerOrNull(raw.id) ?? stableNumericIdFromRecordId(record.id);
  const applicationId =
    toTextOrNull(raw.application_id) || `app-${numericId}-${String(record.id).slice(0, 8)}`;

  return {
    id: numericId,
    application_id: applicationId,
    company_name: toTextOrNull(raw.company_name) || "",
    position: toTextOrNull(raw.position) || "",
    job_type: toTextOrNull(raw.job_type) || "",
    stage: toTextOrNull(raw.stage) || "",
    outcome: toTextOrNull(raw.outcome) || "",
    pipeline_order: toIntegerOrNull(raw.pipeline_order),
    location: toTextOrNull(raw.location),
    application_date: toTextOrNull(raw.application_date),
    interview_datetime: toTextOrNull(raw.interview_datetime),
    followup_date: toTextOrNull(raw.followup_date),
    interview_rounds: toIntegerOrNull(raw.interview_rounds),
    interview_type: toTextOrNull(raw.interview_type),
    interviewers: toTextOrNull(raw.interviewers),
    company_score: toNumericOrNull(raw.company_score),
    last_round_cleared: toTextOrNull(raw.last_round_cleared),
    total_rounds: toIntegerOrNull(raw.total_rounds),
    my_interview_score: toNumericOrNull(raw.my_interview_score),
    improvement_areas: toTextOrNull(raw.improvement_areas),
    skill_to_upgrade: toTextOrNull(raw.skill_to_upgrade),
    job_description: toTextOrNull(raw.job_description),
    notes: toTextOrNull(raw.notes),
    todo_items: parseTodoItemsValue(raw.todo_items),
    documents_links: toTextOrNull(raw.documents_links),
    documents_files: parseDocumentsFilesValue(raw.documents_files),
    contacts: parseContactsValue(raw.contacts),
    favorite: toBoolean(raw.favorite),
    created_at: toTextOrNull(raw.created_at) || record.created_at || null,
    updated_at: toTextOrNull(raw.updated_at) || record.updated_at || null,
    last_viewed: toTextOrNull(raw.last_viewed),
    created_by: toTextOrNull(raw.created_by),
    properties: parsePropertiesValue(raw.properties_json)
  };
};

const buildApplicationPageTitle = (app: Pick<Application, "company_name" | "position">): string => {
  const company = (app.company_name || "").trim();
  const position = (app.position || "").trim();
  if (company && position) return `${company} - ${position}`;
  if (company) return company;
  if (position) return position;
  return "Application";
};

type CanonicalApplicationsSnapshot = {
  databaseId: string;
  records: CanonicalDatabaseRecord[];
  applications: Application[];
  recordIdByLegacyId: Map<number, string>;
};

const loadCanonicalApplicationsSnapshot = async (): Promise<CanonicalApplicationsSnapshot> => {
  const database = await getDatabaseByName(APPLICATIONS_DATABASE_NAME);
  const payload = await getDatabaseRecords(database.id);
  const records = payload.records as CanonicalDatabaseRecord[];
  const applications = records.map(mapCanonicalRecordToApplication);
  const recordIdByLegacyId = new Map<number, string>();
  applications.forEach((app, index) => {
    recordIdByLegacyId.set(app.id, records[index].id);
  });
  return {
    databaseId: database.id,
    records,
    applications,
    recordIdByLegacyId
  };
};

const filterCanonicalApplications = (
  applications: Application[],
  params: {
    q?: string;
    outcomes?: string[];
    stages?: string[];
    job_types?: string[];
    favorites_only?: boolean;
  }
): Application[] => {
  const query = (params.q || "").trim().toLowerCase();
  const outcomeSet = new Set((params.outcomes || []).map((value) => value.trim()).filter(Boolean));
  const stageSet = new Set((params.stages || []).map((value) => value.trim()).filter(Boolean));
  const jobTypeSet = new Set((params.job_types || []).map((value) => value.trim()).filter(Boolean));

  return applications.filter((app) => {
    if (params.favorites_only && !app.favorite) return false;
    if (outcomeSet.size > 0 && !outcomeSet.has(app.outcome || "")) return false;
    if (stageSet.size > 0 && !stageSet.has(app.stage || "")) return false;
    if (jobTypeSet.size > 0 && !jobTypeSet.has(app.job_type || "")) return false;
    if (!query) return true;
    const haystack = [
      app.company_name,
      app.position,
      app.location || "",
      app.notes || ""
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
};

const buildCanonicalValuesForCreate = (
  payload: ApplicationInput,
  nextNumericId: number
): Record<string, unknown> => {
  const nowIso = new Date().toISOString();
  return {
    id: nextNumericId,
    application_id:
      toTextOrNull(payload.application_id) || `app-${nextNumericId}-${Date.now().toString(36)}`,
    company_name: payload.company_name,
    position: payload.position,
    job_type: payload.job_type,
    stage: payload.stage,
    outcome: payload.outcome,
    pipeline_order: payload.pipeline_order ?? null,
    location: payload.location ?? null,
    application_date: payload.application_date ?? null,
    interview_datetime: payload.interview_datetime ?? null,
    followup_date: payload.followup_date ?? null,
    interview_rounds: payload.interview_rounds ?? null,
    interview_type: payload.interview_type ?? null,
    interviewers: payload.interviewers ?? null,
    company_score: payload.company_score ?? null,
    last_round_cleared: payload.last_round_cleared ?? null,
    total_rounds: payload.total_rounds ?? null,
    my_interview_score: payload.my_interview_score ?? null,
    improvement_areas: payload.improvement_areas ?? null,
    skill_to_upgrade: payload.skill_to_upgrade ?? null,
    job_description: payload.job_description ?? null,
    notes: payload.notes ?? null,
    todo_items: payload.todo_items || [],
    documents_links: payload.documents_links ?? null,
    documents_files: payload.documents_files || [],
    contacts: payload.contacts || [],
    favorite: Boolean(payload.favorite),
    created_at: nowIso,
    updated_at: nowIso,
    created_by: payload.created_by || "local",
    properties_json: payload.properties || {}
  };
};

const buildCanonicalValuesForUpdate = (
  payload: Partial<ApplicationInput>
): Record<string, unknown> => {
  const next: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  };

  const assignIfPresent = <K extends keyof ApplicationInput>(key: K, targetKey?: string) => {
    if (!(key in payload)) return;
    next[targetKey || key] = payload[key] ?? null;
  };

  assignIfPresent("company_name");
  assignIfPresent("position");
  assignIfPresent("job_type");
  assignIfPresent("stage");
  assignIfPresent("outcome");
  assignIfPresent("pipeline_order");
  assignIfPresent("location");
  assignIfPresent("application_date");
  assignIfPresent("interview_datetime");
  assignIfPresent("followup_date");
  assignIfPresent("interview_rounds");
  assignIfPresent("interview_type");
  assignIfPresent("interviewers");
  assignIfPresent("company_score");
  assignIfPresent("last_round_cleared");
  assignIfPresent("total_rounds");
  assignIfPresent("my_interview_score");
  assignIfPresent("improvement_areas");
  assignIfPresent("skill_to_upgrade");
  assignIfPresent("job_description");
  assignIfPresent("notes");
  assignIfPresent("todo_items");
  assignIfPresent("documents_links");
  assignIfPresent("documents_files");
  assignIfPresent("contacts");
  if ("favorite" in payload) {
    next.favorite = Boolean(payload.favorite);
  }
  if ("created_by" in payload) {
    next.created_by = payload.created_by ?? null;
  }
  if ("properties" in payload) {
    next.properties_json = payload.properties || {};
  }

  return next;
};

export async function getApplications(params: {
  q?: string;
  outcomes?: string[];
  stages?: string[];
  job_types?: string[];
  favorites_only?: boolean;
} = {}): Promise<Application[]> {
  const snapshot = await loadCanonicalApplicationsSnapshot();
  const filtered = filterCanonicalApplications(snapshot.applications, params);
  return [...filtered].sort((left, right) => {
    const leftTs = Date.parse(left.updated_at || left.created_at || "");
    const rightTs = Date.parse(right.updated_at || right.created_at || "");
    if (Number.isFinite(leftTs) && Number.isFinite(rightTs) && leftTs !== rightTs) {
      return rightTs - leftTs;
    }
    return right.id - left.id;
  });
}

export async function createApplication(payload: ApplicationInput): Promise<Application> {
  const sanitized = sanitizeApplicationPayload(payload as Record<string, unknown>) as ApplicationInput;
  const snapshot = await loadCanonicalApplicationsSnapshot();
  const maxId = snapshot.applications.reduce((max, item) => Math.max(max, item.id || 0), 0);
  const nextId = maxId + 1;
  const created = await createDatabaseRecord(snapshot.databaseId, {
    values: buildCanonicalValuesForCreate(sanitized, nextId),
    page: {
      title: buildApplicationPageTitle({
        company_name: sanitized.company_name,
        position: sanitized.position
      }),
      icon: "briefcase"
    }
  });
  return mapCanonicalRecordToApplication(created);
}

export async function updateApplication(id: number, payload: Partial<ApplicationInput>): Promise<Application> {
  const sanitized = sanitizeApplicationPayload(payload as Record<string, unknown>) as Partial<ApplicationInput>;
  const snapshot = await loadCanonicalApplicationsSnapshot();
  const recordId = snapshot.recordIdByLegacyId.get(id);
  if (!recordId) {
    throw new Error("Canonical record not found");
  }
  const current = snapshot.applications.find((item) => item.id === id) || null;
  const nextCompany =
    "company_name" in sanitized ? String(sanitized.company_name || "") : current?.company_name || "";
  const nextPosition =
    "position" in sanitized ? String(sanitized.position || "") : current?.position || "";
  const updated = await updateDatabaseRecord(snapshot.databaseId, recordId, {
    values: buildCanonicalValuesForUpdate(sanitized),
    page: {
      title: buildApplicationPageTitle({
        company_name: nextCompany,
        position: nextPosition
      })
    }
  });
  return mapCanonicalRecordToApplication(updated);
}

export async function uploadDocuments(
  appId: number,
  files: File[],
  signal?: AbortSignal
): Promise<Application> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  return requestForm<Application>(`/applications/${appId}/documents`, {
    method: "POST",
    body: formData,
    signal
  });
}

export async function deleteDocument(appId: number, fileId: string): Promise<Application> {
  return requestForm<Application>(`/applications/${appId}/documents/${fileId}`, {
    method: "DELETE"
  });
}

export function documentDownloadUrl(appId: number, fileId: string): string {
  return `${API_BASE}/applications/${appId}/documents/${fileId}`;
}

export async function deleteApplication(id: number): Promise<void> {
  const snapshot = await loadCanonicalApplicationsSnapshot();
  const recordId = snapshot.recordIdByLegacyId.get(id);
  if (!recordId) {
    throw new Error("Canonical record not found");
  }
  await deleteDatabaseRecord(snapshot.databaseId, recordId);
}

export async function bulkDelete(ids: number[]): Promise<void> {
  await Promise.all(ids.map((id) => deleteApplication(id)));
}

export async function getViews(): Promise<View[]> {
  return request<View[]>("/views");
}

export async function createView(payload: Omit<View, "view_id" | "created_at" | "updated_at">): Promise<View> {
  return request<View>("/views", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateView(viewId: string, payload: Partial<View>): Promise<View> {
  return request<View>(`/views/${viewId}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function deleteView(viewId: string): Promise<void> {
  await request(`/views/${viewId}`, { method: "DELETE" });
}

export async function syncEmailMetadata(payload: {
  contact_id: string;
  folder?: string;
  messages: EmailMetadataInput[];
}): Promise<EmailMetadataSyncResult> {
  return request<EmailMetadataSyncResult>("/email/sync-metadata", {
    method: "POST",
    body: JSON.stringify({
      contact_id: payload.contact_id,
      folder: payload.folder || "INBOX",
      messages: payload.messages
    })
  });
}

export async function listEmailMetadata(params: {
  contact_id: string;
  folder?: string;
  limit?: number;
  start_date?: string;
  refresh?: boolean;
  signal?: AbortSignal;
}): Promise<EmailMetadata[]> {
  const query = new URLSearchParams();
  query.set("contact_id", params.contact_id);
  if (params.folder) query.set("folder", params.folder);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.start_date) query.set("start_date", params.start_date);
  if (typeof params.refresh === "boolean") query.set("refresh", params.refresh ? "true" : "false");
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<EmailMetadata[]>(`/email/messages${suffix}`, {
    signal: params.signal,
  });
}

export async function getEmailBody(
  messageId: string,
  params?: {
    full_content?: boolean;
  }
): Promise<EmailBodyResult> {
  const query = new URLSearchParams();
  if (params?.full_content) query.set("full_content", "true");
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<EmailBodyResult>(`/email/messages/${encodeURIComponent(messageId)}/body${suffix}`);
}

export async function saveEmailBody(messageId: string, body: string): Promise<EmailBodyResult> {
  return request<EmailBodyResult>(`/email/messages/${encodeURIComponent(messageId)}/body`, {
    method: "PUT",
    body: JSON.stringify({ body })
  });
}

export async function testEmailConnection(payload: EmailConnectionTestInput): Promise<EmailConnectionTestResult> {
  return request<EmailConnectionTestResult>("/email/test-connection", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function listEmailFolders(payload: EmailConnectionTestInput): Promise<EmailFoldersListResult> {
  return request<EmailFoldersListResult>("/email/list-folders", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function startEmailOAuth(payload: EmailOAuthStartInput): Promise<EmailOAuthStartResult> {
  return request<EmailOAuthStartResult>("/email/oauth/start", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function listEmailSendContacts(limit = 500): Promise<EmailSendContact[]> {
  const query = new URLSearchParams();
  query.set("limit", String(limit));
  return request<EmailSendContact[]>(`/email/send/contacts-source?${query.toString()}`);
}

export async function getEmailSendStats(): Promise<EmailSendStats> {
  return request<EmailSendStats>("/email/send/stats");
}

export async function getEmailReadStats(): Promise<EmailReadStats> {
  return request<EmailReadStats>("/email/read/stats");
}

export async function sendEmailBatch(payload: {
  subject_template: string;
  body_template: string;
  contacts: Array<{
    name?: string;
    email: string;
    company?: string;
    custom_fields?: Record<string, string>;
  }>;
  attachments?: Array<{
    filename: string;
    content_type?: string;
    data_base64: string;
  }>;
}): Promise<EmailSendBatchResult> {
  return request<EmailSendBatchResult>("/email/send/batch", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function disconnectGoogleOAuth(): Promise<{ ok: boolean; message: string }> {
  return request<{ ok: boolean; message: string }>("/oauth/google/disconnect", {
    method: "POST"
  });
}

export async function listGoogleAccounts(): Promise<GoogleAccount[]> {
  const res = await request<{ ok: boolean; accounts: GoogleAccount[] }>("/oauth/google/accounts");
  return res.accounts || [];
}

export async function selectGoogleAccount(email: string): Promise<{ ok: boolean; message: string }> {
  return request<{ ok: boolean; message: string }>("/oauth/google/accounts/select", {
    method: "POST",
    body: JSON.stringify({ email })
  });
}

export async function disconnectSingleGoogleAccount(email: string): Promise<{ ok: boolean; message: string }> {
  return request<{ ok: boolean; message: string }>("/oauth/google/accounts/disconnect", {
    method: "POST",
    body: JSON.stringify({ email })
  });
}

export async function checkGoogleOAuthConfig(): Promise<{ ok: boolean; error: string | null }> {
  return request<{ ok: boolean; error: string | null }>("/oauth/google/check");
}

export function getGoogleOAuthStartUrl(): string {
  const base = String(API_BASE || "/api").trim();
  const normalized = base.replace(/\/+$/, "");
  if (!normalized) return "/api/oauth/google/start";
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return `${normalized}/oauth/google/start`;
  }
  const prefixed = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `${prefixed}/oauth/google/start`;
}

export function downloadExcel(scope: "all" | "favorites" | "active" = "all") {
  void downloadFromUrl(`${API_BASE}/export/excel?scope=${scope}`, `applications_${scope}.xlsx`);
}

export function downloadIcs(applicationId?: string) {
  const url = applicationId
    ? `${API_BASE}/export/ics?application_id=${encodeURIComponent(applicationId)}`
    : `${API_BASE}/export/ics`;
  const fallback = applicationId ? `${applicationId}.ics` : "events.ics";
  void downloadFromUrl(url, fallback);
}

export function downloadBackup() {
  void downloadFromUrl(`${API_BASE}/backup/export`, "backup.zip");
}

export function downloadTodoIcs(appId: number, todoId: string) {
  const url = `${API_BASE}/export/todo?app_id=${appId}&todo_id=${encodeURIComponent(todoId)}`;
  void downloadFromUrl(url, `todo_${todoId}.ics`);
}

export { ApiError, openExternal };
