import { Application, ApplicationInput, Settings, UpdateInfo, View } from "./types";

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

export async function updateSettings(settings: Settings): Promise<Settings> {
  const data = await request<{ settings: Settings }>("/settings", {
    method: "PUT",
    body: JSON.stringify({ settings })
  });
  return data.settings;
}

export async function getApplications(params: {
  q?: string;
  outcomes?: string[];
  stages?: string[];
  job_types?: string[];
  favorites_only?: boolean;
} = {}): Promise<Application[]> {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  params.outcomes?.forEach((outcome) => query.append("outcomes", outcome));
  params.stages?.forEach((stage) => query.append("stages", stage));
  params.job_types?.forEach((job) => query.append("job_types", job));
  if (params.favorites_only) query.set("favorites_only", "true");
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<Application[]>(`/applications${suffix}`);
}

export async function createApplication(payload: ApplicationInput): Promise<Application> {
  return request<Application>("/applications", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateApplication(id: number, payload: Partial<ApplicationInput>): Promise<Application> {
  return request<Application>(`/applications/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export async function uploadDocuments(appId: number, files: File[]): Promise<Application> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  return requestForm<Application>(`/applications/${appId}/documents`, {
    method: "POST",
    body: formData
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
  await request(`/applications/${id}`, { method: "DELETE" });
}

export async function bulkDelete(ids: number[]): Promise<void> {
  await request("/applications/bulk-delete", {
    method: "POST",
    body: JSON.stringify(ids)
  });
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
