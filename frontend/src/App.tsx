import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  ApiError,
  completeOnboarding,
  createPage as createCanonicalPage,
  deletePage,
  getOnboardingStatus,
  getOnboardingTemplates,
  getUpdateInfo,
  listPages as listCanonicalPages,
  resolvePageByLegacyKey,
  updatePage as updateCanonicalPage,
  openExternal
} from "./api";
import CameraModal from "./components/CameraModal";
import ConfirmDialogHost from "./components/ConfirmDialogHost";
import { clearLocalPageConfig } from "./components/pageBuilder/pageConfigStore";
import { getCrossPageDragState } from "./components/pageBuilder/crossPageDragStore";
import { PencilIcon, TrashIcon, CameraIcon, GearIcon } from "./components/SidebarIcons";
import { useI18n } from "./i18n";
import { CORE_PAGE_PLUGINS } from "./pagePlugins";
import { confirmDialog } from "./shared/confirmDialog";
import { Command, UndoManager } from "./shared/undoManager";
import { AppProvider, useAppData } from "./state";
import { UndoProvider } from "./undoContext";
import { EmailBlockCacheProvider } from "./components/pageBuilder/emailBlockCache";
import BlockPanel from "./components/BlockPanel";
import CustomSheetPage from "./pages/CustomSheetPage";
import { BrandProfile, OnboardingTemplate, UpdateInfo } from "./types";

const SettingsPage = React.lazy(() => import("./pages/SettingsPage"));

const DEFAULT_PROFILE: BrandProfile = {
  name: "Tu Nombre",
  role: "Ingeniero Industrial IA",
  avatarSrc: "/brand-avatar.svg",
  avatarAlt: "Foto de perfil",
};

const parseVersion = (value: string | null | undefined): number[] => {
  if (!value) return [];
  return value
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((part) => Number.parseInt(part, 10))
    .filter((num) => !Number.isNaN(num));
};

const isNewerVersion = (latest: string | null | undefined, current: string | null | undefined): boolean => {
  const latestParts = parseVersion(latest);
  const currentParts = parseVersion(current);
  const maxLen = Math.max(latestParts.length, currentParts.length);
  for (let i = 0; i < maxLen; i += 1) {
    const left = latestParts[i] ?? 0;
    const right = currentParts[i] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return false;
};

type CustomSheet = {
  id: string;
  name: string;
};

type SidebarRenameTarget =
  | {
      kind: "base";
      path: string;
      fallback: string;
    }
  | {
      kind: "sheet";
      sheetId: string;
    };

const NAV_LABELS_STORAGE_KEY = "sidebar_nav_labels_v1";
const DRAG_HOVER_OPEN_DELAY_MS = 220;
const DRAG_HOVER_STALE_MS = 5000;

const readNavLabelOverrides = (): Record<string, string> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(NAV_LABELS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const next: Record<string, string> = {};
    Object.entries(parsed).forEach(([key, value]) => {
      if (typeof value !== "string") return;
      const trimmed = value.trim();
      if (trimmed) next[key] = trimmed;
    });
    return next;
  } catch {
    return {};
  }
};

const writeNavLabelOverrides = (labels: Record<string, string>) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NAV_LABELS_STORAGE_KEY, JSON.stringify(labels));
  } catch {
    // ignore storage failures
  }
};

const createSheetId = () => `sheet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const AppShell: React.FC = () => {
  const { t } = useI18n();
  const { loading, error, refresh, settings, saveSettings } = useAppData();
  const navigate = useNavigate();
  const location = useLocation();
  const isDashboard = CORE_PAGE_PLUGINS.some(
    (plugin) => plugin.showTopbar && plugin.path === location.pathname
  );
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [onboardingLoading, setOnboardingLoading] = useState(true);
  const [onboardingCompleted, setOnboardingCompleted] = useState(true);
  const [onboardingTemplates, setOnboardingTemplates] = useState<OnboardingTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("blank_v1");
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [profile, setProfile] = useState<BrandProfile>(DEFAULT_PROFILE);
  const [editingField, setEditingField] = useState<"name" | "role" | null>(null);
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [navLabelOverrides, setNavLabelOverrides] = useState<Record<string, string>>(() =>
    readNavLabelOverrides()
  );
  const [customSheets, setCustomSheets] = useState<CustomSheet[]>([]);
  const [renameTarget, setRenameTarget] = useState<SidebarRenameTarget | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [sheetToDelete, setSheetToDelete] = useState<CustomSheet | null>(null);
  const hasLoadedProfileRef = useRef(false);
  const hasUndoCheckpointRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const avatarMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const dragHoverTimerRef = useRef<number | null>(null);
  const undoManagerRef = useRef<UndoManager | null>(null);
  if (!undoManagerRef.current) {
    undoManagerRef.current = new UndoManager(100);
  }
  const undoManager = undoManagerRef.current;
  const [, setUndoVersion] = useState(0);

  useEffect(() => undoManager.subscribe(() => setUndoVersion((value) => value + 1)), [undoManager]);

  const runUndoableCommand = useCallback(
    async (command: Command) => {
      try {
        await undoManager.execute(command);
      } catch (err) {
        const message = err instanceof Error ? err.message : t("Action failed.");
        setUpdateError(message);
      }
    },
    [t, undoManager]
  );

  const runNonUndoableAction = useCallback(
    async (label: string, action: () => Promise<void> | void) => {
      if (undoManager.canUndo || undoManager.canRedo || undoManager.isDirty) {
        const proceed = await confirmDialog({
          title: t("Clear undo history"),
          message: t('"{label}" cannot be undone. Current undo history will be cleared. Continue?', {
            label
          }),
          confirmLabel: t("Continue"),
          cancelLabel: t("Cancel"),
          tone: "danger"
        });
        if (!proceed) return;
      }
      undoManager.clear();
      try {
        await action();
      } finally {
        undoManager.saveCheckpoint();
      }
    },
    [t, undoManager]
  );

  useEffect(() => {
    let active = true;
    getUpdateInfo()
      .then((info) => {
        if (active) {
          setUpdateInfo(info);
        }
      })
      .catch(() => {
        if (active) {
          setUpdateInfo(null);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadOnboarding = async () => {
      try {
        const [status, templates] = await Promise.all([
          getOnboardingStatus(),
          getOnboardingTemplates()
        ]);
        if (!active) return;
        setOnboardingTemplates(templates);
        setOnboardingCompleted(Boolean(status.completed));
        if (templates.length > 0) {
          setSelectedTemplateId((current) =>
            current && templates.some((template) => template.id === current)
              ? current
              : templates[0].id
          );
        }
      } catch {
        if (!active) return;
        setOnboardingCompleted(true);
      } finally {
        if (active) {
          setOnboardingLoading(false);
        }
      }
    };
    void loadOnboarding();
    return () => {
      active = false;
    };
  }, []);

  const syncCustomSheetsFromCanonical = useCallback(async () => {
    try {
      const pages = await listCanonicalPages();
      const sheets = pages
        .filter((page) => typeof page.legacy_key === "string" && page.legacy_key.startsWith("sheet:"))
        .map((page) => ({
          id: page.legacy_key!.slice("sheet:".length),
          name: (page.title || "").trim() || "Untitled"
        }))
        .filter((sheet) => Boolean(sheet.id))
        .sort((a, b) => a.name.localeCompare(b.name));
      setCustomSheets(sheets);
    } catch {
      // ignore and keep current sidebar state
    }
  }, []);

  useEffect(() => {
    if (!onboardingCompleted) return;
    void syncCustomSheetsFromCanonical();
  }, [onboardingCompleted, syncCustomSheetsFromCanonical]);

  useEffect(() => {
    let alive = true;
    const loadVersion = async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        const version = await getVersion();
        if (alive) {
          setAppVersion(version);
        }
      } catch {
        // ignore in non-tauri contexts
      }
    };
    loadVersion();
    return () => {
      alive = false;
    };
  }, []);

  const handleUpdateClick = async () => {
    if (!updateInfo?.url || isUpdating) {
      return;
    }
    const updateUrl = updateInfo.url;
    await runNonUndoableAction(t("Download update"), async () => {
      setUpdateError(null);
      setIsUpdating(true);
      try {
        const hasTauri = !!(window as unknown as { __TAURI__?: unknown }).__TAURI__;
        if (hasTauri) {
          const { checkUpdate, installUpdate } = await import("@tauri-apps/api/updater");
          const { relaunch } = await import("@tauri-apps/api/process");
          const { shouldUpdate } = await checkUpdate();
          if (!shouldUpdate) {
            setUpdateError(t("You're already on the latest version."));
            return;
          }
          await installUpdate();
          await relaunch();
          return;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : t("Could not auto-install.");
        setUpdateError(t("{message} Opening the package...", { message }));
      } finally {
        setIsUpdating(false);
      }
      openExternal(updateUrl);
    });
  };

  const handleCompleteOnboarding = useCallback(async () => {
    if (!selectedTemplateId || onboardingBusy) return;
    setOnboardingBusy(true);
    setOnboardingError(null);
    try {
      await completeOnboarding({
        template_id: selectedTemplateId,
        workspace_name: workspaceNameDraft.trim() || undefined
      });
      setOnboardingCompleted(true);
      await refresh();
      await syncCustomSheetsFromCanonical();
      navigate("/");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setOnboardingCompleted(true);
        await refresh();
        await syncCustomSheetsFromCanonical();
        navigate("/");
      } else {
        setOnboardingError(
          error instanceof Error ? error.message : t("Unable to complete onboarding.")
        );
      }
    } finally {
      setOnboardingBusy(false);
    }
  }, [
    navigate,
    onboardingBusy,
    refresh,
    selectedTemplateId,
    syncCustomSheetsFromCanonical,
    t,
    workspaceNameDraft
  ]);

  useEffect(() => {
    const warmPages = () => {
      CORE_PAGE_PLUGINS.forEach((plugin) => {
        void plugin.preload();
      });
      void import("./pages/SettingsPage");
    };
    if ("requestIdleCallback" in window) {
      const handle = window.requestIdleCallback(warmPages);
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(warmPages, 1200);
    return () => window.clearTimeout(handle);
  }, []);

  useEffect(() => {
    if (!settings || hasLoadedProfileRef.current) {
      return;
    }
    const nextProfile = settings.brand_profile
      ? { ...DEFAULT_PROFILE, ...settings.brand_profile }
      : DEFAULT_PROFILE;
    setProfile(nextProfile);
    hasLoadedProfileRef.current = true;
  }, [settings]);

  useEffect(() => {
    if (loading || hasUndoCheckpointRef.current) return;
    undoManager.saveCheckpoint();
    hasUndoCheckpointRef.current = true;
  }, [loading, undoManager]);

  useEffect(() => {
    if (!settings || !hasLoadedProfileRef.current) {
      return;
    }
    const settingsProfile = settings.brand_profile ?? null;
    if (settingsProfile && JSON.stringify(settingsProfile) === JSON.stringify(profile)) {
      return;
    }
    if (!settingsProfile && JSON.stringify(DEFAULT_PROFILE) === JSON.stringify(profile)) {
      return;
    }
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveSettings({
        brand_profile: profile,
      });
    }, 400);
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [profile, saveSettings, settings]);

  useEffect(() => {
    writeNavLabelOverrides(navLabelOverrides);
  }, [navLabelOverrides]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (avatarMenuRef.current && !avatarMenuRef.current.contains(target)) {
        setIsAvatarMenuOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsAvatarMenuOpen(false);
        setIsCameraOpen(false);
        setIsSettingsOpen(false);
      }
    };
    const shouldIgnoreUndoShortcutTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tag = element.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (element.isContentEditable) return true;
      return Boolean(element.closest("[contenteditable='true']"));
    };
    const handleUndoKeybindings = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (shouldIgnoreUndoShortcutTarget(event.target)) return;
      const key = event.key.toLowerCase();

      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        void (async () => {
          try {
            await undoManager.redo();
          } catch (err) {
            const message = err instanceof Error ? err.message : t("Redo failed.");
            setUpdateError(message);
          }
        })();
        return;
      }

      if (key === "z") {
        event.preventDefault();
        void (async () => {
          try {
            await undoManager.undo();
          } catch (err) {
            const message = err instanceof Error ? err.message : t("Undo failed.");
            setUpdateError(message);
          }
        })();
        return;
      }

      if (key === "y") {
        event.preventDefault();
        void (async () => {
          try {
            await undoManager.redo();
          } catch (err) {
            const message = err instanceof Error ? err.message : t("Redo failed.");
            setUpdateError(message);
          }
        })();
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    document.addEventListener("keydown", handleUndoKeybindings);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("keydown", handleUndoKeybindings);
    };
  }, [t, undoManager]);

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) {
      return;
    }
    setIsAvatarMenuOpen(false);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        setProfile((current) => ({
          ...current,
          avatarSrc: result,
        }));
      }
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const openCamera = () => {
    setIsAvatarMenuOpen(false);
    setIsCameraOpen(true);
  };

  const closeCamera = () => {
    setIsCameraOpen(false);
  };

  const handleCameraCapture = (dataUrl: string) => {
    setProfile((current) => ({ ...current, avatarSrc: dataUrl }));
    setIsCameraOpen(false);
  };

  const handleCameraUpload = () => {
    setIsCameraOpen(false);
    fileInputRef.current?.click();
  };

  const handleProfileKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
      setEditingField(null);
    }
    if (event.key === "Escape") {
      event.currentTarget.blur();
      setEditingField(null);
    }
  };

  const baseNavItems = useMemo(
    () =>
      CORE_PAGE_PLUGINS
        .filter((plugin) => plugin.showInSidebar !== false)
        .map((plugin) => ({
          path: plugin.path,
          label: t(plugin.labelKey),
          end: plugin.end
        })),
    [t]
  );

  const resolveNavLabel = useCallback(
    (path: string, fallback: string) => navLabelOverrides[path] || fallback,
    [navLabelOverrides]
  );

  const closeRenameModal = useCallback(() => {
    setRenameTarget(null);
    setRenameDraft("");
  }, []);

  const clearDragHoverTimer = useCallback(() => {
    if (dragHoverTimerRef.current) {
      window.clearTimeout(dragHoverTimerRef.current);
      dragHoverTimerRef.current = null;
    }
  }, []);

  const scheduleDragHoverOpen = useCallback(
    (targetPath: string) => {
      const drag = getCrossPageDragState();
      if (!drag?.active) return;
      if (Date.now() - drag.updatedAt > DRAG_HOVER_STALE_MS) return;
      if (location.pathname === targetPath) return;
      clearDragHoverTimer();
      dragHoverTimerRef.current = window.setTimeout(() => {
        dragHoverTimerRef.current = null;
        const latest = getCrossPageDragState();
        if (!latest?.active) return;
        if (Date.now() - latest.updatedAt > DRAG_HOVER_STALE_MS) return;
        if (window.location.pathname === targetPath) return;
        navigate(targetPath);
      }, DRAG_HOVER_OPEN_DELAY_MS);
    },
    [clearDragHoverTimer, location.pathname, navigate]
  );

  useEffect(() => () => clearDragHoverTimer(), [clearDragHoverTimer]);

  const openBaseNavRename = (path: string, fallback: string) => {
    setRenameDraft(resolveNavLabel(path, fallback));
    setRenameTarget({ kind: "base", path, fallback });
  };

  const openCustomSheetRename = (sheetId: string, currentName: string) => {
    setRenameDraft(currentName);
    setRenameTarget({ kind: "sheet", sheetId });
  };

  const confirmRename = useCallback(() => {
    if (!renameTarget) return;
    const trimmed = renameDraft.trim();
    if (renameTarget.kind === "base") {
      const { path, fallback } = renameTarget;
      const previousValue = navLabelOverrides[path];
      const hasPrevious = Object.prototype.hasOwnProperty.call(navLabelOverrides, path);
      const nextValue = !trimmed || trimmed === fallback ? null : trimmed;

      if ((previousValue ?? null) === nextValue) {
        closeRenameModal();
        return;
      }

      void runUndoableCommand({
        description: t("Rename page"),
        timestamp: Date.now(),
        do: () => {
          setNavLabelOverrides((prev) => {
            const next = { ...prev };
            if (nextValue) {
              next[path] = nextValue;
            } else {
              delete next[path];
            }
            return next;
          });
          closeRenameModal();
        },
        undo: () => {
          setNavLabelOverrides((prev) => {
            const next = { ...prev };
            if (hasPrevious) {
              next[path] = previousValue as string;
            } else {
              delete next[path];
            }
            return next;
          });
        }
      });
      return;
    }
    if (!trimmed) return;

    const targetSheet = customSheets.find((sheet) => sheet.id === renameTarget.sheetId);
    if (!targetSheet || targetSheet.name === trimmed) {
      closeRenameModal();
      return;
    }

    const oldName = targetSheet.name;
    const sheetId = renameTarget.sheetId;

    void runUndoableCommand({
      description: t("Rename page"),
      timestamp: Date.now(),
      do: async () => {
        setCustomSheets((prev) =>
          prev.map((sheet) => (sheet.id === sheetId ? { ...sheet, name: trimmed } : sheet))
        );
        try {
          const resolved = await resolvePageByLegacyKey(`sheet:${sheetId}`, false);
          if (resolved?.id) {
            await updateCanonicalPage(resolved.id, { title: trimmed });
          }
        } catch {
          // keep local name as fallback
        }
        closeRenameModal();
      },
      undo: async () => {
        setCustomSheets((prev) =>
          prev.map((sheet) => (sheet.id === sheetId ? { ...sheet, name: oldName } : sheet))
        );
        try {
          const resolved = await resolvePageByLegacyKey(`sheet:${sheetId}`, false);
          if (resolved?.id) {
            await updateCanonicalPage(resolved.id, { title: oldName });
          }
        } catch {
          // ignore undo persistence failures
        }
      }
    });
  }, [
    closeRenameModal,
    customSheets,
    navLabelOverrides,
    renameDraft,
    renameTarget,
    runUndoableCommand,
    t
  ]);

  const addCustomSheet = () => {
    const id = createSheetId();
    const name = t("New Sheet");
    const next: CustomSheet = { id, name };
    const pageId = `sheet:${id}`;

    void runUndoableCommand({
      description: t("Add new sheet"),
      timestamp: Date.now(),
      do: async () => {
        await createCanonicalPage({
          title: name,
          legacy_key: pageId
        });
        setCustomSheets((prev) => [...prev, next]);
        navigate(`/sheet/${id}`);
      },
      undo: async () => {
        setCustomSheets((prev) => prev.filter((sheet) => sheet.id !== id));
        try {
          const resolved = await resolvePageByLegacyKey(pageId, false);
          if (resolved?.id) {
            await deletePage(resolved.id);
          }
        } catch {
          // ignore undo persistence failures
        }
        clearLocalPageConfig(pageId);
        if (settings?.page_configs && typeof settings.page_configs === "object") {
          const nextPageConfigs = { ...(settings.page_configs as Record<string, unknown>) };
          delete nextPageConfigs[pageId];
          void saveSettings({ page_configs: nextPageConfigs });
        }
        if (location.pathname === `/sheet/${id}`) {
          navigate(CORE_PAGE_PLUGINS[0]?.path || "/dashboard");
        }
      }
    });
  };

  const clearCustomSheetShadow = useCallback(
    (sheetId: string) => {
      const pageId = `sheet:${sheetId}`;
      clearLocalPageConfig(pageId);
      if (!settings?.page_configs || typeof settings.page_configs !== "object") return;
      const currentPageConfigs = settings.page_configs as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(currentPageConfigs, pageId)) return;
      const nextPageConfigs = { ...currentPageConfigs };
      delete nextPageConfigs[pageId];
      void saveSettings({ page_configs: nextPageConfigs });
    },
    [saveSettings, settings]
  );

  const deleteCustomSheetConfigData = useCallback(
    async (sheetId: string) => {
      const pageId = `sheet:${sheetId}`;
      try {
        const resolved = await resolvePageByLegacyKey(pageId, false);
        if (resolved?.id) {
          await deletePage(resolved.id);
        }
      } catch {
        // ignore cleanup failures
      } finally {
        clearCustomSheetShadow(sheetId);
      }
    },
    [clearCustomSheetShadow]
  );

  const confirmDeleteCustomSheet = useCallback(async () => {
    if (!sheetToDelete) return;
    const deleting = sheetToDelete;
    await runNonUndoableAction(t("Delete sheet"), async () => {
      setSheetToDelete(null);
      setCustomSheets((prev) => prev.filter((sheet) => sheet.id !== deleting.id));
      if (location.pathname === `/sheet/${deleting.id}`) {
        navigate(CORE_PAGE_PLUGINS[0]?.path || "/dashboard");
      }
      await deleteCustomSheetConfigData(deleting.id);
    });
  }, [deleteCustomSheetConfigData, location.pathname, navigate, runNonUndoableAction, sheetToDelete, t]);

  const hasTauri = typeof window !== "undefined" && !!(window as unknown as { __TAURI__?: unknown }).__TAURI__;
  const resolvedVersion = hasTauri ? appVersion || updateInfo?.current_version || null : "DEV";
  const shouldShowUpdate =
    hasTauri &&
    !!updateInfo?.update_available &&
    !!updateInfo?.url &&
    (!resolvedVersion || !updateInfo?.latest_version || isNewerVersion(updateInfo.latest_version, resolvedVersion));

  if (onboardingLoading) {
    return (
      <UndoProvider undoManager={undoManager}>
        <div className="app-shell">
          <main className="content">
            <div className="empty">{t("Loading workspace...")}</div>
          </main>
        </div>
      </UndoProvider>
    );
  }

  if (!onboardingCompleted) {
    return (
      <UndoProvider undoManager={undoManager}>
        <div className="app-shell">
          <main className="content">
            <div className="modal settings-modal" style={{ maxWidth: 820, margin: "48px auto" }}>
              <div className="modal-header">
                <div>
                  <h3>{t("Welcome")}</h3>
                  <p>{t("Select a starter template for your local workspace.")}</p>
                </div>
              </div>
              <div className="settings-section">
                <h4>{t("Template")}</h4>
                <div className="settings-grid two-col">
                  {onboardingTemplates.map((template) => (
                    <label key={template.id} className="settings-option">
                      <input
                        type="radio"
                        name="onboarding-template"
                        value={template.id}
                        checked={selectedTemplateId === template.id}
                        onChange={() => setSelectedTemplateId(template.id)}
                      />
                      <span>
                        <strong>{template.name}</strong>
                        <small>{template.description}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="settings-section">
                <h4>{t("Workspace name (optional)")}</h4>
                <input
                  className="text-input"
                  type="text"
                  value={workspaceNameDraft}
                  onChange={(event) => setWorkspaceNameDraft(event.target.value)}
                  placeholder={t("My Workspace")}
                />
              </div>
              {onboardingError && <div className="alert">{onboardingError}</div>}
              <div className="modal-actions" style={{ justifyContent: "flex-end" }}>
                <button
                  className="primary"
                  type="button"
                  disabled={onboardingBusy || !selectedTemplateId}
                  onClick={() => void handleCompleteOnboarding()}
                >
                  {onboardingBusy ? t("Preparing...") : t("Create workspace")}
                </button>
              </div>
            </div>
          </main>
        </div>
      </UndoProvider>
    );
  }

  return (
    <UndoProvider undoManager={undoManager}>
      <div className="app-shell">
      <header className="global-undo-bar">
        <div className="undo-redo-controls" role="toolbar" aria-label={t("Undo and redo")}>
          <button
            type="button"
            className="undo-redo-button"
            disabled={!undoManager.canUndo}
            onClick={() => {
              void (async () => {
                try {
                  await undoManager.undo();
                } catch (err) {
                  const message = err instanceof Error ? err.message : t("Undo failed.");
                  setUpdateError(message);
                }
              })();
            }}
            title={
              undoManager.nextUndoDescription
                ? t("Deshacer {description}", { description: undoManager.nextUndoDescription })
                : t("Deshacer")
            }
          >
            ↶ {undoManager.nextUndoDescription ? undoManager.nextUndoDescription : t("Deshacer")}
          </button>
          <button
            type="button"
            className="undo-redo-button"
            disabled={!undoManager.canRedo}
            onClick={() => {
              void (async () => {
                try {
                  await undoManager.redo();
                } catch (err) {
                  const message = err instanceof Error ? err.message : t("Redo failed.");
                  setUpdateError(message);
                }
              })();
            }}
            title={
              undoManager.nextRedoDescription
                ? t("Rehacer {description}", { description: undoManager.nextRedoDescription })
                : t("Rehacer")
            }
          >
            ↷ {undoManager.nextRedoDescription ? undoManager.nextRedoDescription : t("Rehacer")}
          </button>
        </div>
        <div className="status-pill">
          {loading ? t("Loading...") : undoManager.isDirty ? t("Unsaved changes") : t("Ready")}
        </div>
      </header>
      <BlockPanel id="app:sidebar" as="aside" variant="raw" className="sidebar">
        <div className="brand">
          <div className="brand-mark profile-avatar" ref={avatarMenuRef}>
            <input
              ref={fileInputRef}
              className="profile-file-input"
              type="file"
              accept="image/*"
              onChange={handleAvatarChange}
            />
            <input
              ref={cameraInputRef}
              className="profile-file-input"
              type="file"
              accept="image/*"
              capture="user"
              onChange={handleAvatarChange}
            />
            <button
              className="avatar-button"
              type="button"
              aria-label={t("Change photo")}
              aria-expanded={isAvatarMenuOpen}
              onClick={() => setIsAvatarMenuOpen((open) => !open)}
            >
              <img className="brand-avatar" src={profile.avatarSrc} alt={profile.avatarAlt} />
              <span className="avatar-badge">
                <CameraIcon />
              </span>
            </button>
            {isAvatarMenuOpen && (
              <div className="avatar-menu" role="menu">
                <button
                  className="avatar-action-button"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsAvatarMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                >
                  {t("Upload photo")}
                </button>
                <button
                  className="avatar-action-button secondary"
                  type="button"
                  role="menuitem"
                  onClick={openCamera}
                >
                  {t("Take photo")}
                </button>
              </div>
            )}
          </div>
          <div>
            <div className="brand-line">
              {editingField === "name" ? (
                <input
                  id="profile-name"
                  className="brand-input brand-input-title"
                  type="text"
                  value={profile.name}
                  autoFocus
                  onChange={(event) =>
                    setProfile((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  onBlur={() => setEditingField(null)}
                  onKeyDown={handleProfileKeyDown}
                />
              ) : (
                <>
                  <span className="brand-title-value">{profile.name}</span>
                  <button
                    className="icon-button brand-edit"
                    type="button"
                    aria-label={t("Edit name")}
                    onClick={() => setEditingField("name")}
                  >
                    <PencilIcon />
                  </button>
                </>
              )}
            </div>
            <div className="brand-line">
              {editingField === "role" ? (
                <input
                  id="profile-role"
                  className="brand-input brand-input-subtitle"
                  type="text"
                  value={profile.role}
                  autoFocus
                  onChange={(event) =>
                    setProfile((current) => ({
                      ...current,
                      role: event.target.value,
                    }))
                  }
                  onBlur={() => setEditingField(null)}
                  onKeyDown={handleProfileKeyDown}
                />
              ) : (
                <>
                  <span className="brand-subtitle-value">{profile.role}</span>
                  <button
                    className="icon-button brand-edit"
                    type="button"
                    aria-label={t("Edit role")}
                    onClick={() => setEditingField("role")}
                  >
                    <PencilIcon />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        <nav className="nav">
          {baseNavItems.map((item) => (
            <div
              className="nav-item"
              key={item.path}
              onPointerEnter={() => scheduleDragHoverOpen(item.path)}
              onPointerLeave={clearDragHoverTimer}
            >
              <NavLink
                to={item.path}
                end={item.end}
                className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
              >
                {resolveNavLabel(item.path, item.label)}
              </NavLink>
              <div className="nav-item-actions nav-item-actions-base">
                <button
                  className="icon-button nav-link-action nav-link-edit"
                  type="button"
                  aria-label={t("Rename page")}
                  title={t("Rename page")}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openBaseNavRename(item.path, item.label);
                  }}
                >
                  <PencilIcon />
                </button>
              </div>
            </div>
          ))}
          {customSheets.map((sheet) => (
            <div
              className="nav-item"
              key={sheet.id}
              onPointerEnter={() => scheduleDragHoverOpen(`/sheet/${sheet.id}`)}
              onPointerLeave={clearDragHoverTimer}
            >
              <NavLink
                to={`/sheet/${sheet.id}`}
                className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
              >
                {sheet.name}
              </NavLink>
              <div className="nav-item-actions nav-item-actions-sheet">
                <button
                  className="icon-button nav-link-action nav-link-delete"
                  type="button"
                  aria-label={t("Delete sheet")}
                  title={t("Delete sheet")}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setSheetToDelete(sheet);
                  }}
                >
                  <TrashIcon />
                </button>
                <button
                  className="icon-button nav-link-action nav-link-edit"
                  type="button"
                  aria-label={t("Rename page")}
                  title={t("Rename page")}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openCustomSheetRename(sheet.id, sheet.name);
                  }}
                >
                  <PencilIcon />
                </button>
              </div>
            </div>
          ))}
          <button className="nav-add-sheet" type="button" onClick={addCustomSheet}>
            <span className="nav-add-sheet-icon">+</span>
            <span>{t("Add new sheet")}</span>
          </button>
        </nav>
        <div className="sidebar-footer">
          <button
            className="sidebar-settings-button"
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            aria-label={t("Settings")}
            title={t("Settings")}
          >
            <GearIcon />
          </button>
          <p>Lenna Labs</p>
        </div>
      </BlockPanel>
      <main className="content">
        {isDashboard && (
          <header className="topbar">
            <div>
              <h1>
                {t("Personal Interview & Application Tracker")}
                {resolvedVersion && <span className="app-version">v{resolvedVersion}</span>}
              </h1>
              <p>{t("Offline-first workspace for your job search pipeline.")}</p>
            </div>
          </header>
        )}
        {shouldShowUpdate && (
          <section className="update-banner" role="status">
            <div>
              <strong>{t("New version {version} available.", { version: updateInfo.latest_version })}</strong>
              <p>{updateInfo.notes || t("Download the latest build to update.")}</p>
              {updateError && <p>{updateError}</p>}
            </div>
            <div className="update-actions">
              <button
                className="primary"
                onClick={handleUpdateClick}
                disabled={isUpdating}
              >
                {isUpdating ? t("Updating...") : t("Download update")}
              </button>
            </div>
          </section>
        )}
        {error && <div className="alert">{error}</div>}
        <div className="page">
          <Suspense fallback={<div className="empty">{t("Loading page...")}</div>}>
            <Routes>
              {CORE_PAGE_PLUGINS.map((plugin) => {
                const PluginComponent = plugin.component;
                return <Route key={plugin.id} path={plugin.path} element={<PluginComponent />} />;
              })}
              <Route path="/sheet/:sheetId" element={<CustomSheetPage sheets={customSheets} />} />
            </Routes>
          </Suspense>
        </div>
      </main>
      {isSettingsOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={t("Settings")}
          onClick={() => setIsSettingsOpen(false)}
        >
          <div className="modal settings-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>{t("Settings")}</h3>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                aria-label={t("Close")}
              >
                X
              </button>
            </div>
            <Suspense fallback={<div className="empty">{t("Loading settings...")}</div>}>
              <SettingsPage />
            </Suspense>
          </div>
        </div>
      )}
      {isCameraOpen && (
        <CameraModal
          onCapture={handleCameraCapture}
          onUpload={handleCameraUpload}
          onClose={closeCamera}
        />
      )}
      {sheetToDelete && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={t("Delete sheet")}
          onClick={() => setSheetToDelete(null)}
        >
          <div className="modal confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="confirm-modal-body">
              <h3>{t("Delete sheet")}</h3>
              <p>{t('Are you sure you want to delete "{name}"?', { name: sheetToDelete.name })}</p>
            </div>
            <div className="confirm-modal-actions">
              <button className="ghost" type="button" onClick={() => setSheetToDelete(null)}>
                {t("Cancel")}
              </button>
              <button className="danger" type="button" onClick={() => void confirmDeleteCustomSheet()}>
                {t("Delete")}
              </button>
            </div>
          </div>
        </div>
      )}
      {renameTarget && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={t("Rename page")}
          onClick={closeRenameModal}
        >
          <div className="modal confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="confirm-modal-body">
              <h3>{t("Rename page")}</h3>
            </div>
            <input
              className="confirm-modal-input"
              type="text"
              value={renameDraft}
              autoFocus
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  confirmRename();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeRenameModal();
                }
              }}
            />
            <div className="confirm-modal-actions">
              <button className="ghost" type="button" onClick={closeRenameModal}>
                {t("Cancel")}
              </button>
              <button
                className="primary"
                type="button"
                onClick={confirmRename}
                disabled={renameTarget.kind === "sheet" && !renameDraft.trim()}
              >
                {t("Save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </UndoProvider>
  );
};

const App: React.FC = () => {
  return (
    <AppProvider>
      <EmailBlockCacheProvider>
        <AppShell />
        <ConfirmDialogHost />
      </EmailBlockCacheProvider>
    </AppProvider>
  );
};

export default App;
