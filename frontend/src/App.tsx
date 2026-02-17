import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { getUpdateInfo, openExternal } from "./api";
import { useI18n } from "./i18n";
import { CORE_PAGE_PLUGINS } from "./pagePlugins";
import { AppProvider, useAppData } from "./state";
import BlockPanel from "./components/BlockPanel";
import CustomSheetPage from "./pages/CustomSheetPage";
import { BrandProfile, UpdateInfo } from "./types";

const SettingsPage = React.lazy(() => import("./pages/SettingsPage"));

const DEFAULT_PROFILE: BrandProfile = {
  name: "Tu Nombre",
  role: "Ingeniero Industrial IA",
  avatarSrc: "/brand-avatar.svg",
  avatarAlt: "Foto de perfil",
};

const PencilIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z" />
    <path d="M20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.82 3.75 3.75 1.83-1.82z" />
  </svg>
);

const TrashIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm-1 6h2v9H8V9zm6 0h2v9h-2V9zM6 9h2v9H6V9z" />
  </svg>
);

const CameraIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M9 4a2 2 0 0 0-1.6.8L6.7 6H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2.7l-.7-1.2A2 2 0 0 0 14 4H9zm3 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z" />
  </svg>
);

const GearIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.27 7.27 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.23-1.13.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.72 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.58-.23 1.13-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.2A3.2 3.2 0 1 1 12 8.8a3.2 3.2 0 0 1 0 6.4Z" />
  </svg>
);

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

const NAV_LABELS_STORAGE_KEY = "sidebar_nav_labels_v1";
const CUSTOM_SHEETS_STORAGE_KEY = "sidebar_custom_sheets_v1";

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

const readCustomSheets = (): CustomSheet[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_SHEETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const rec = item as Record<string, unknown>;
        const id = typeof rec.id === "string" ? rec.id.trim() : "";
        const name = typeof rec.name === "string" ? rec.name.trim() : "";
        if (!id || !name) return null;
        return { id, name };
      })
      .filter((item): item is CustomSheet => Boolean(item));
  } catch {
    return [];
  }
};

const writeCustomSheets = (sheets: CustomSheet[]) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CUSTOM_SHEETS_STORAGE_KEY, JSON.stringify(sheets));
  } catch {
    // ignore storage failures
  }
};

const createSheetId = () => `sheet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const AppShell: React.FC = () => {
  const { t } = useI18n();
  const { loading, error, settings, saveSettings } = useAppData();
  const navigate = useNavigate();
  const location = useLocation();
  const isDashboard = CORE_PAGE_PLUGINS.some(
    (plugin) => plugin.showTopbar && plugin.path === location.pathname
  );
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [profile, setProfile] = useState<BrandProfile>(DEFAULT_PROFILE);
  const [editingField, setEditingField] = useState<"name" | "role" | null>(null);
  const [isAvatarMenuOpen, setIsAvatarMenuOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [navLabelOverrides, setNavLabelOverrides] = useState<Record<string, string>>(() =>
    readNavLabelOverrides()
  );
  const [customSheets, setCustomSheets] = useState<CustomSheet[]>(() => readCustomSheets());
  const [sheetToDelete, setSheetToDelete] = useState<CustomSheet | null>(null);
  const hasLoadedProfileRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const avatarMenuRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

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
    openExternal(updateInfo.url);
  };

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
        ...settings,
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
    writeCustomSheets(customSheets);
  }, [customSheets]);

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
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  useEffect(() => {
    if (!isCameraOpen && streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, [isCameraOpen]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

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

  const openCamera = async () => {
    setIsAvatarMenuOpen(false);
    setCameraError(null);
    setIsCameraOpen(true);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(t("Your browser cannot open the camera. Use Upload photo."));
      cameraInputRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
    } catch {
      setCameraError(t("Could not access the camera. Use Upload photo."));
      setIsCameraOpen(false);
      cameraInputRef.current?.click();
    }
  };

  const closeCamera = () => {
    setIsCameraOpen(false);
    setCameraError(null);
  };

  const capturePhoto = () => {
    if (!videoRef.current) {
      return;
    }
    const width = videoRef.current.videoWidth;
    const height = videoRef.current.videoHeight;
    if (!width || !height) {
      setCameraError(t("Camera is not ready yet."));
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.drawImage(videoRef.current, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setProfile((current) => ({
      ...current,
      avatarSrc: dataUrl,
    }));
    closeCamera();
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

  const renameBaseNavItem = (path: string, fallback: string) => {
    const currentLabel = resolveNavLabel(path, fallback);
    const nextLabel = window.prompt(t("Rename page"), currentLabel);
    if (nextLabel === null) return;
    const trimmed = nextLabel.trim();
    if (!trimmed || trimmed === fallback) {
      setNavLabelOverrides((prev) => {
        const { [path]: _, ...rest } = prev;
        return rest;
      });
      return;
    }
    setNavLabelOverrides((prev) => ({ ...prev, [path]: trimmed }));
  };

  const renameCustomSheet = (sheetId: string, currentName: string) => {
    const nextLabel = window.prompt(t("Rename page"), currentName);
    if (nextLabel === null) return;
    const trimmed = nextLabel.trim();
    if (!trimmed) return;
    setCustomSheets((prev) =>
      prev.map((sheet) => (sheet.id === sheetId ? { ...sheet, name: trimmed } : sheet))
    );
  };

  const addCustomSheet = () => {
    const id = createSheetId();
    const name = t("New Sheet");
    const next: CustomSheet = { id, name };
    setCustomSheets((prev) => [...prev, next]);
    navigate(`/sheet/${id}`);
  };

  const deleteCustomSheetConfigData = useCallback(
    async (sheetId: string) => {
      const pageId = `sheet:${sheetId}`;
      if (typeof window !== "undefined") {
        try {
          const localKey = "page_configs_local_v1";
          const raw = window.localStorage.getItem(localKey);
          if (raw) {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed[pageId]) {
              delete parsed[pageId];
              window.localStorage.setItem(localKey, JSON.stringify(parsed));
            }
          }
        } catch {
          // ignore storage failures
        }
      }
      if (!settings?.page_configs || !(pageId in settings.page_configs)) return;
      const nextPageConfigs = { ...settings.page_configs };
      delete nextPageConfigs[pageId];
      await saveSettings({
        ...settings,
        page_configs: nextPageConfigs
      });
    },
    [saveSettings, settings]
  );

  const confirmDeleteCustomSheet = useCallback(async () => {
    if (!sheetToDelete) return;
    const deleting = sheetToDelete;
    setSheetToDelete(null);
    setCustomSheets((prev) => prev.filter((sheet) => sheet.id !== deleting.id));
    if (location.pathname === `/sheet/${deleting.id}`) {
      navigate(CORE_PAGE_PLUGINS[0]?.path || "/dashboard");
    }
    await deleteCustomSheetConfigData(deleting.id);
  }, [deleteCustomSheetConfigData, location.pathname, navigate, sheetToDelete]);

  const hasTauri = typeof window !== "undefined" && !!(window as unknown as { __TAURI__?: unknown }).__TAURI__;
  const resolvedVersion = hasTauri ? appVersion || updateInfo?.current_version || null : "DEV";
  const shouldShowUpdate =
    hasTauri &&
    !!updateInfo?.update_available &&
    !!updateInfo?.url &&
    (!resolvedVersion || !updateInfo?.latest_version || isNewerVersion(updateInfo.latest_version, resolvedVersion));

  return (
    <div className="app-shell">
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
            <div className="nav-item" key={item.path}>
              <NavLink
                to={item.path}
                end={item.end}
                className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
              >
                {resolveNavLabel(item.path, item.label)}
              </NavLink>
              <div className="nav-item-actions">
                <button
                  className="icon-button nav-link-action nav-link-edit"
                  type="button"
                  aria-label={t("Rename page")}
                  title={t("Rename page")}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    renameBaseNavItem(item.path, item.label);
                  }}
                >
                  <PencilIcon />
                </button>
              </div>
            </div>
          ))}
          {customSheets.map((sheet) => (
            <div className="nav-item" key={sheet.id}>
              <NavLink
                to={`/sheet/${sheet.id}`}
                className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")}
              >
                {sheet.name}
              </NavLink>
              <div className="nav-item-actions">
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
                    renameCustomSheet(sheet.id, sheet.name);
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
          <p>{t("Local-first · SQLite/Postgres")}</p>
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
            <div className="status-pill">
              {loading ? t("Loading...") : t("Ready")}
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
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={t("Take photo")}
          onClick={closeCamera}
        >
          <div className="modal camera-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>{t("Take photo")}</h3>
                <p>{t("Use the camera to update your profile photo.")}</p>
              </div>
              <button className="icon-button" type="button" onClick={closeCamera} aria-label={t("Close")}>
                X
              </button>
            </div>
            <div className="camera-body">
              {cameraError ? (
                <div className="alert">{cameraError}</div>
              ) : (
                <video ref={videoRef} className="camera-video" playsInline muted autoPlay />
              )}
            </div>
            <div className="camera-actions">
              <button className="ghost" type="button" onClick={closeCamera}>
                {t("Cancel")}
              </button>
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  closeCamera();
                  fileInputRef.current?.click();
                }}
              >
                {t("Upload photo")}
              </button>
              <button className="primary" type="button" onClick={capturePhoto} disabled={!!cameraError}>
                {t("Capture")}
              </button>
            </div>
            <canvas ref={canvasRef} className="camera-canvas" />
          </div>
        </div>
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
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
};

export default App;
