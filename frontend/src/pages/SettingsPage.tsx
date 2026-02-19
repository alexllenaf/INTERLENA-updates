import React, { useState } from "react";
import BlockPanel from "../components/BlockPanel";
import {
  ApiError,
  downloadBackup,
  getGoogleOAuthStartUrl,
  getStorageInfo,
  listEmailFolders,
  openOAuthPopup,
  startEmailOAuth,
  testEmailConnection
} from "../api";
import { Locale, useI18n } from "../i18n";
import { useAppData } from "../state";
import { type Settings } from "../types";

const DEFAULT_EMAIL_SYNC: NonNullable<Settings["email_sync"]> = {
  provider: "none",
  read_enabled: false,
  imap: {
    host: "",
    port: 993,
    username: "",
    password: "",
    use_ssl: true,
    folder: "INBOX"
  },
  oauth: {
    providers: {
      oauth_google: {
        client_id: "",
        client_secret: "",
        redirect_uri: "http://127.0.0.1:8000/api/email/oauth/callback/oauth_google",
        tenant_id: ""
      },
      oauth_microsoft: {
        client_id: "",
        client_secret: "",
        redirect_uri: "http://127.0.0.1:8000/api/email/oauth/callback/oauth_microsoft",
        tenant_id: "common"
      }
    }
  }
};

const SUGGESTED_IMAP_FOLDERS = ["INBOX", "[Gmail]/All Mail", "Archive", "Sent"] as const;

const isOAuthProvider = (provider: string): provider is "oauth_google" | "oauth_microsoft" =>
  provider === "oauth_google" || provider === "oauth_microsoft";

const PROVIDER_LABEL: Record<"none" | "imap" | "oauth_google" | "oauth_microsoft", string> = {
  none: "Sin conexión",
  imap: "IMAP",
  oauth_google: "Google",
  oauth_microsoft: "Microsoft"
};

const PROVIDER_IMAP_DEFAULTS: Record<"imap" | "oauth_google" | "oauth_microsoft", { host: string; port: number; use_ssl: boolean }> = {
  imap: { host: "", port: 993, use_ssl: true },
  oauth_google: { host: "imap.gmail.com", port: 993, use_ssl: true },
  oauth_microsoft: { host: "outlook.office365.com", port: 993, use_ssl: true }
};

const pickBestInboxFolder = (folders: string[]): string | null => {
  if (!folders.length) return null;
  const exactInbox = folders.find((folder) => folder.trim().toUpperCase() === "INBOX");
  if (exactInbox) return exactInbox;

  const priorityMatchers: RegExp[] = [
    /(^|\/)inbox$/i,
    /all\s*mail/i,
    /(^|\/)archive$/i,
    /sent/i,
  ];

  for (const matcher of priorityMatchers) {
    const match = folders.find((folder) => matcher.test(folder));
    if (match) return match;
  }
  return folders[0] || null;
};

const normalizeEmailSync = (settings: Settings | null): NonNullable<Settings["email_sync"]> => {
  const raw = settings?.email_sync;
  if (!raw) return DEFAULT_EMAIL_SYNC;
  const rawProviders = raw.oauth?.providers || {};
  const normalizedProvider =
    raw.provider === "imap" || raw.provider === "oauth_google" || raw.provider === "oauth_microsoft"
      ? raw.provider
      : "none";
  return {
    provider: normalizedProvider,
    read_enabled: Boolean(raw.read_enabled),
    imap: {
      host: raw.imap?.host || "",
      port: Number.isFinite(Number(raw.imap?.port)) ? Number(raw.imap?.port) : 993,
      username: raw.imap?.username || "",
      password: raw.imap?.password || "",
      use_ssl: Boolean(raw.imap?.use_ssl),
      folder: raw.imap?.folder || "INBOX"
    },
    oauth: {
      providers: {
        oauth_google: {
          ...DEFAULT_EMAIL_SYNC.oauth?.providers?.oauth_google,
          ...(rawProviders.oauth_google || {})
        },
        oauth_microsoft: {
          ...DEFAULT_EMAIL_SYNC.oauth?.providers?.oauth_microsoft,
          ...(rawProviders.oauth_microsoft || {})
        }
      }
    }
  };
};

const SettingsPage: React.FC = () => {
  const { locale, setLocale, t } = useI18n();
  const { settings, saveSettings } = useAppData();
  const [storageInfo, setStorageInfo] = useState<null | {
    data_dir: string;
    db_path: string;
    uploads_dir: string;
    backups_dir: string;
    state_path: string;
    update_feed?: string;
  }>(null);
  const [emailSync, setEmailSync] = useState<NonNullable<Settings["email_sync"]>>(() =>
    normalizeEmailSync(settings || null)
  );
  const [savingEmailSync, setSavingEmailSync] = useState(false);
  const [testingEmailSync, setTestingEmailSync] = useState(false);
  const [loadingEmailFolders, setLoadingEmailFolders] = useState(false);
  const [imapFolders, setImapFolders] = useState<string[]>([]);
  const [autoDetectedFolder, setAutoDetectedFolder] = useState<string | null>(null);
  const [emailSyncMessage, setEmailSyncMessage] = useState<string | null>(null);
  const [emailSyncError, setEmailSyncError] = useState<string | null>(null);
  const [startingOAuth, setStartingOAuth] = useState(false);
  const [selectedImapFolderPreset, setSelectedImapFolderPreset] = useState<string>(() => {
    const current = normalizeEmailSync(settings || null).imap.folder || "INBOX";
    return SUGGESTED_IMAP_FOLDERS.includes(current as (typeof SUGGESTED_IMAP_FOLDERS)[number])
      ? current
      : "custom";
  });

  const activeOAuthProvider =
    isOAuthProvider(emailSync.provider)
      ? emailSync.provider
      : null;
  const activeOAuthConfig = activeOAuthProvider
    ? emailSync.oauth?.providers?.[activeOAuthProvider] || {}
    : null;
  const hasImapHost = Boolean((emailSync.imap.host || "").trim());
  const hasImapUser = Boolean((emailSync.imap.username || "").trim());
  const hasImapPassword = Boolean((emailSync.imap.password || "").trim());
  const hasOAuthToken = Boolean(String(activeOAuthConfig?.access_token || "").trim());
  const providerReadyBasics =
    emailSync.provider === "imap"
      ? hasImapHost && hasImapUser && hasImapPassword
      : isOAuthProvider(emailSync.provider)
      ? hasImapHost && hasImapUser
      : false;
  const authStepReady = emailSync.provider === "imap" ? hasImapPassword : hasOAuthToken;
  const basicsStepReady = hasImapHost && hasImapUser;
  const foldersStepReady = imapFolders.length > 0;
  const canRunConnectionTest =
    emailSync.provider !== "none" &&
    basicsStepReady &&
    (emailSync.provider === "imap" ? hasImapPassword : hasOAuthToken);

  const guidedSteps =
    emailSync.provider === "none"
      ? []
      : [
          { id: 1, label: "Completar datos básicos (servidor + usuario)", done: basicsStepReady },
          {
            id: 2,
            label:
              emailSync.provider === "imap"
                ? "Añadir contraseña/app password"
                : `Iniciar sesión con ${emailSync.provider === "oauth_google" ? "Google" : "Microsoft"}`,
            done: authStepReady
          },
          { id: 3, label: "Probar conexión", done: canRunConnectionTest },
          { id: 4, label: "Cargar carpetas", done: foldersStepReady },
          { id: 5, label: "Guardar configuración", done: false }
        ];

  const nextGuidedStep =
    emailSync.provider === "none"
      ? "select_provider"
      : !basicsStepReady
      ? "fill_basics"
      : !authStepReady
      ? "auth"
      : !canRunConnectionTest
      ? "test_connection"
      : !foldersStepReady
      ? "load_folders"
      : "save";

  React.useEffect(() => {
    const normalized = normalizeEmailSync(settings || null);
    setEmailSync(normalized);
    setAutoDetectedFolder(null);
    const current = normalized.imap.folder || "INBOX";
    setSelectedImapFolderPreset(
      SUGGESTED_IMAP_FOLDERS.includes(current as (typeof SUGGESTED_IMAP_FOLDERS)[number]) ? current : "custom"
    );
  }, [settings?.email_sync]);

  React.useEffect(() => {
    getStorageInfo()
      .then((info) => setStorageInfo(info))
      .catch(() => setStorageInfo(null));
  }, []);

  const startOAuthLogin = async () => {
    if (!activeOAuthProvider) return;
    if (activeOAuthProvider !== "oauth_google") {
      setEmailSyncError("OAuth Microsoft no está habilitado en el modo mínimo actual.");
      setEmailSyncMessage(null);
      return;
    }

    setStartingOAuth(true);
    setEmailSyncError(null);
    setEmailSyncMessage(null);
    try {
      const googleCfg = emailSync.oauth?.providers?.oauth_google || {};
      const clientId = String(googleCfg.client_id || "").trim();
      const clientSecret = String(googleCfg.client_secret || "").trim();
      if (clientId && clientSecret) {
        const payload = await startEmailOAuth({
          provider: "oauth_google",
          client_id: clientId,
          client_secret: clientSecret,
          scope: String(googleCfg.scope || "").trim() || undefined,
          redirect_uri: String(googleCfg.redirect_uri || "").trim() || undefined,
        });
        await openOAuthPopup(payload.auth_url);
      } else {
        await openOAuthPopup(getGoogleOAuthStartUrl());
      }
      setEmailSyncMessage("OAuth iniciado en el navegador. Completa el consentimiento y vuelve a probar conexión.");
    } catch (err) {
      if (err instanceof ApiError) {
        setEmailSyncError(err.message);
      } else {
        setEmailSyncError("No se pudo iniciar OAuth.");
      }
    } finally {
      setStartingOAuth(false);
    }
  };

  const saveEmailSync = async () => {
    setSavingEmailSync(true);
    setEmailSyncMessage(null);
    setEmailSyncError(null);
    const normalized = {
      provider: emailSync.provider,
      read_enabled: Boolean(emailSync.read_enabled),
      imap: {
        host: (emailSync.imap.host || "").trim(),
        port: Math.max(1, Math.round(Number(emailSync.imap.port) || 993)),
        username: (emailSync.imap.username || "").trim(),
        password: emailSync.imap.password || "",
        use_ssl: Boolean(emailSync.imap.use_ssl),
        folder: (emailSync.imap.folder || "INBOX").trim() || "INBOX"
      },
      oauth: {
        providers: {
          oauth_google: {
            client_id: String(emailSync.oauth?.providers?.oauth_google?.client_id || "").trim(),
            client_secret: String(emailSync.oauth?.providers?.oauth_google?.client_secret || "").trim(),
            redirect_uri:
              String(emailSync.oauth?.providers?.oauth_google?.redirect_uri || "").trim() ||
              "http://127.0.0.1:8000/oauth/google/callback",
            tenant_id: String(emailSync.oauth?.providers?.oauth_google?.tenant_id || "").trim(),
          },
          oauth_microsoft: {
            client_id: "",
            client_secret: "",
            redirect_uri:
              String(emailSync.oauth?.providers?.oauth_microsoft?.redirect_uri || "").trim() ||
              "http://127.0.0.1:8000/api/email/oauth/callback/oauth_microsoft",
            tenant_id: String(emailSync.oauth?.providers?.oauth_microsoft?.tenant_id || "common").trim() || "common",
          }
        }
      }
    } as NonNullable<Settings["email_sync"]>;

    const updated = await saveSettings({ email_sync: normalized });
    if (updated) {
      setEmailSyncMessage("Configuración de correo guardada.");
    } else {
      setEmailSyncError("No se pudo guardar la configuración de correo.");
    }
    setSavingEmailSync(false);
  };

  const runEmailConnectionTest = async () => {
    setTestingEmailSync(true);
    setEmailSyncMessage(null);
    setEmailSyncError(null);

    const payload = {
      provider: emailSync.provider,
      imap: {
        host: (emailSync.imap.host || "").trim(),
        port: Math.max(1, Math.round(Number(emailSync.imap.port) || 993)),
        username: (emailSync.imap.username || "").trim(),
        password: emailSync.imap.password || "",
        use_ssl: Boolean(emailSync.imap.use_ssl),
        folder: (emailSync.imap.folder || "INBOX").trim() || "INBOX"
      }
    } as const;

    try {
      const result = await testEmailConnection(payload);
      if (result.ok) {
        setEmailSyncMessage(result.message || "Conexión IMAP correcta.");
      } else {
        setEmailSyncError(result.message || "No se pudo validar la conexión IMAP.");
      }
    } catch {
      setEmailSyncError("No se pudo probar la conexión de correo.");
    } finally {
      setTestingEmailSync(false);
    }
  };

  const loadImapFolders = async () => {
    setLoadingEmailFolders(true);
    setEmailSyncMessage(null);
    setEmailSyncError(null);

    const payload = {
      provider: emailSync.provider,
      imap: {
        host: (emailSync.imap.host || "").trim(),
        port: Math.max(1, Math.round(Number(emailSync.imap.port) || 993)),
        username: (emailSync.imap.username || "").trim(),
        password: emailSync.imap.password || "",
        use_ssl: Boolean(emailSync.imap.use_ssl),
        folder: (emailSync.imap.folder || "INBOX").trim() || "INBOX"
      }
    } as const;

    try {
      const result = await listEmailFolders(payload);
      if (result.ok) {
        const unique = Array.from(new Set((result.folders || []).map((item) => (item || "").trim()).filter(Boolean)));
        setImapFolders(unique);
        setEmailSyncMessage(`Carpetas cargadas: ${unique.length}`);
        const currentFolder = (emailSync.imap.folder || "").trim();
        if (currentFolder && unique.includes(currentFolder)) {
          setSelectedImapFolderPreset(currentFolder);
          setAutoDetectedFolder(null);
        } else {
          const best = pickBestInboxFolder(unique);
          if (best) {
            setEmailSync((prev) => ({
              ...prev,
              imap: { ...prev.imap, folder: best }
            }));
            setSelectedImapFolderPreset(best);
            setAutoDetectedFolder(best);
          }
        }
      } else {
        setImapFolders([]);
        setEmailSyncError(result.message || "No se pudieron cargar carpetas IMAP.");
      }
    } catch {
      setImapFolders([]);
      setEmailSyncError("No se pudieron cargar carpetas IMAP.");
    } finally {
      setLoadingEmailFolders(false);
    }
  };

  const runGuidedNextStep = async () => {
    setEmailSyncError(null);
    if (nextGuidedStep === "select_provider") {
      setEmailSyncError("Paso 1: selecciona primero un proveedor de correo.");
      return;
    }
    if (nextGuidedStep === "fill_basics") {
      setEmailSyncError("Paso 2: completa servidor IMAP y usuario/correo.");
      return;
    }
    if (nextGuidedStep === "auth") {
      if (emailSync.provider === "imap") {
        setEmailSyncError("Paso 3: añade tu contraseña o app password.");
        return;
      }
      await startOAuthLogin();
      return;
    }
    if (nextGuidedStep === "test_connection") {
      await runEmailConnectionTest();
      return;
    }
    if (nextGuidedStep === "load_folders") {
      await loadImapFolders();
      return;
    }
    await saveEmailSync();
  };

  const folderOptions = React.useMemo(() => {
    const merged = new Set<string>(SUGGESTED_IMAP_FOLDERS);
    imapFolders.forEach((folder) => merged.add(folder));
    return Array.from(merged);
  }, [imapFolders]);

  const showManualFolderBadge =
    !autoDetectedFolder &&
    selectedImapFolderPreset === "custom" &&
    Boolean((emailSync.imap.folder || "").trim());

  return (
    <div className="settings">
      <BlockPanel id="settings:language" as="section">
        <h3>{t("Language")}</h3>
        <p>{t("Change the app language.")}</p>
        <div className="field">
          <label htmlFor="settings-language">{t("App language")}</label>
          <select
            id="settings-language"
            value={locale}
            onChange={(event) => {
              const next = event.target.value === "es" ? "es" : "en";
              setLocale(next as Locale);
            }}
          >
            <option value="es">{t("Spanish")}</option>
            <option value="en">{t("English")}</option>
          </select>
        </div>
      </BlockPanel>
      <BlockPanel id="settings:storage" as="section">
        <h3>{t("Storage & Backups")}</h3>
        <p>{t("Data is stored in the system app data directory, not inside the app bundle.")}</p>
        {storageInfo ? (
          <div className="storage-grid">
            <div className="storage-row">
              <span>{t("Data folder")}</span>
              <code>{storageInfo.data_dir}</code>
            </div>
            <div className="storage-row">
              <span>{t("Database")}</span>
              <code>{storageInfo.db_path}</code>
            </div>
            <div className="storage-row">
              <span>{t("Uploads")}</span>
              <code>{storageInfo.uploads_dir}</code>
            </div>
            <div className="storage-row">
              <span>{t("Backups")}</span>
              <code>{storageInfo.backups_dir}</code>
            </div>
            <div className="storage-row">
              <span>{t("State")}</span>
              <code>{storageInfo.state_path}</code>
            </div>
          </div>
        ) : (
          <div className="empty">{t("Storage info unavailable.")}</div>
        )}
        <div className="form-actions">
          <button className="ghost" type="button" onClick={downloadBackup}>
            {t("Download backup (.zip)")}
          </button>
        </div>
      </BlockPanel>
      <BlockPanel id="settings:email-sync" as="section">
        <h3>Correo (sync)</h3>
        <p>Asistente guiado para conectar tu correo en pocos pasos, sin conocimientos técnicos.</p>
        <div className="field">
          <label htmlFor="settings-email-provider">Proveedor</label>
          <select
            id="settings-email-provider"
            value={emailSync.provider}
            onChange={(event) => {
              const raw = event.target.value;
              const provider =
                raw === "imap" || raw === "oauth_google" || raw === "oauth_microsoft" ? raw : "none";
              setEmailSync((prev) => {
                if (provider === "none") {
                  return { ...prev, provider };
                }
                const defaults = PROVIDER_IMAP_DEFAULTS[provider];
                return {
                  ...prev,
                  provider,
                  imap: {
                    ...prev.imap,
                    host: (prev.imap.host || "").trim() ? prev.imap.host : defaults.host,
                    port: Number.isFinite(Number(prev.imap.port)) ? prev.imap.port : defaults.port,
                    use_ssl: prev.imap.host ? prev.imap.use_ssl : defaults.use_ssl,
                    folder: (prev.imap.folder || "INBOX").trim() || "INBOX"
                  }
                };
              });
              setEmailSyncError(null);
              setEmailSyncMessage(
                provider === "none"
                  ? null
                  : `Proveedor seleccionado: ${PROVIDER_LABEL[provider]}. Sigue la guía rápida de abajo.`
              );
            }}
          >
            <option value="none">None</option>
            <option value="imap">IMAP (usuario/contraseña)</option>
            <option value="oauth_google">OAuth Google</option>
            <option value="oauth_microsoft">OAuth Microsoft</option>
          </select>
        </div>

        {emailSync.provider !== "none" ? (
          <div className="empty">
            <strong>Guía rápida ({PROVIDER_LABEL[emailSync.provider]})</strong>
            <ol>
              <li>Completa tu correo y servidor (host/usuario).</li>
              {emailSync.provider === "imap" ? (
                <li>Pega tu contraseña (o app password) y pulsa “Probar conexión”.</li>
              ) : (
                <li>
                  Pulsa “Iniciar sesión con {emailSync.provider === "oauth_google" ? "Google" : "Microsoft"}” y
                  autoriza en el navegador.
                </li>
              )}
              <li>Pulsa “Cargar carpetas”, revisa carpeta principal y guarda.</li>
            </ol>
            <div>
              Estado: {providerReadyBasics ? "✅ Datos básicos listos" : "⚠️ Faltan datos básicos para continuar"}
            </div>
            <div style={{ marginTop: 8 }}>
              Lectura de correos: {emailSync.read_enabled ? "✅ activada" : "⏸️ aparcada"}
            </div>
            <div style={{ marginTop: 8 }}>
              <strong>Progreso asistido</strong>
              <ol>
                {guidedSteps.map((step) => (
                  <li key={step.id}>{step.done ? "✅" : "⬜"} Paso {step.id}: {step.label}</li>
                ))}
              </ol>
            </div>
          </div>
        ) : null}

        {emailSync.provider !== "none" ? (
          <>
            <div className="field">
              <label htmlFor="settings-email-read-enabled">Lectura de correos (read)</label>
              <select
                id="settings-email-read-enabled"
                value={emailSync.read_enabled ? "true" : "false"}
                onChange={(event) =>
                  setEmailSync((prev) => ({
                    ...prev,
                    read_enabled: event.target.value === "true"
                  }))
                }
              >
                <option value="false">Aparcada (solo envío)</option>
                <option value="true">Activada</option>
              </select>
              <small>Si está aparcada, la API de lectura devuelve desactivado temporalmente.</small>
            </div>
            <div className="field">
              <label htmlFor="settings-email-imap-host">Servidor IMAP (host)</label>
              <input
                id="settings-email-imap-host"
                type="text"
                value={emailSync.imap.host}
                onChange={(event) =>
                  setEmailSync((prev) => ({
                    ...prev,
                    imap: { ...prev.imap, host: event.target.value }
                  }))
                }
                placeholder="imap.gmail.com"
              />
              <small>
                {emailSync.provider === "oauth_google"
                  ? "Sugerido para Google: imap.gmail.com"
                  : emailSync.provider === "oauth_microsoft"
                  ? "Sugerido para Microsoft: outlook.office365.com"
                  : "Ejemplo: imap.gmail.com, outlook.office365.com o el de tu proveedor."}
              </small>
            </div>
            <div className="field">
              <label htmlFor="settings-email-imap-port">Puerto IMAP</label>
              <input
                id="settings-email-imap-port"
                type="number"
                min={1}
                max={65535}
                value={emailSync.imap.port}
                onChange={(event) =>
                  setEmailSync((prev) => ({
                    ...prev,
                    imap: { ...prev.imap, port: Number(event.target.value || 993) }
                  }))
                }
              />
              <small>Normalmente 993 con SSL activado.</small>
            </div>
            <div className="field">
              <label htmlFor="settings-email-imap-user">Usuario/correo</label>
              <input
                id="settings-email-imap-user"
                type="text"
                value={emailSync.imap.username}
                onChange={(event) =>
                  setEmailSync((prev) => ({
                    ...prev,
                    imap: { ...prev.imap, username: event.target.value }
                  }))
                }
              />
              <small>Usa tu correo completo (por ejemplo, nombre@dominio.com).</small>
            </div>
            <div className="field">
              <label htmlFor="settings-email-imap-folder-preset">IMAP folder (suggested)</label>
              <select
                id="settings-email-imap-folder-preset"
                value={selectedImapFolderPreset}
                onChange={(event) => {
                  const next = event.target.value;
                  setSelectedImapFolderPreset(next);
                  setAutoDetectedFolder(null);
                  if (next !== "custom") {
                    setEmailSync((prev) => ({
                      ...prev,
                      imap: { ...prev.imap, folder: next }
                    }));
                  }
                }}
              >
                {folderOptions.map((folder) => (
                  <option key={folder} value={folder}>
                    {folder}
                  </option>
                ))}
                <option value="custom">Custom</option>
              </select>
              <small>Si no sabes cuál elegir, deja INBOX.</small>
            </div>
            <div className="field">
              <label htmlFor="settings-email-imap-folder">IMAP folder</label>
              <input
                id="settings-email-imap-folder"
                type="text"
                value={emailSync.imap.folder}
                onChange={(event) =>
                  setEmailSync((prev) => {
                    const nextFolder = event.target.value;
                    setAutoDetectedFolder(null);
                    setSelectedImapFolderPreset(
                      SUGGESTED_IMAP_FOLDERS.includes(nextFolder as (typeof SUGGESTED_IMAP_FOLDERS)[number])
                        ? nextFolder
                        : "custom"
                    );
                    return {
                      ...prev,
                      imap: { ...prev.imap, folder: nextFolder }
                    };
                  })
                }
                placeholder="INBOX"
              />
              {autoDetectedFolder ? <span className="tag">Auto-detected: {autoDetectedFolder}</span> : null}
              {showManualFolderBadge ? <span className="tag">Manual</span> : null}
              <small>Esta carpeta se usará para buscar correos de forma predeterminada.</small>
            </div>
            {emailSync.provider === "imap" ? (
              <div className="field">
                <label htmlFor="settings-email-imap-password">Contraseña / app password</label>
                <input
                  id="settings-email-imap-password"
                  type="password"
                  value={emailSync.imap.password}
                  onChange={(event) =>
                    setEmailSync((prev) => ({
                      ...prev,
                      imap: { ...prev.imap, password: event.target.value }
                    }))
                  }
                />
                <small>
                  Si tu correo tiene verificación en dos pasos, usa una <strong>app password</strong> en lugar de tu
                  contraseña normal.
                </small>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="settings-email-imap-ssl">Usar SSL</label>
              <select
                id="settings-email-imap-ssl"
                value={emailSync.imap.use_ssl ? "true" : "false"}
                onChange={(event) =>
                  setEmailSync((prev) => ({
                    ...prev,
                    imap: { ...prev.imap, use_ssl: event.target.value === "true" }
                  }))
                }
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
              <small>Recomendado: dejar en Yes para una conexión segura.</small>
            </div>

            {activeOAuthProvider && activeOAuthConfig ? (
              <>
                {activeOAuthProvider === "oauth_google" ? (
                  <>
                    <div className="field">
                      <label htmlFor="settings-email-google-client-id">Google OAuth client_id</label>
                      <input
                        id="settings-email-google-client-id"
                        type="text"
                        value={String(emailSync.oauth?.providers?.oauth_google?.client_id || "")}
                        onChange={(event) =>
                          setEmailSync((prev) => ({
                            ...prev,
                            oauth: {
                              providers: {
                                ...(prev.oauth?.providers || {}),
                                oauth_google: {
                                  ...(prev.oauth?.providers?.oauth_google || {}),
                                  client_id: event.target.value,
                                },
                              },
                            },
                          }))
                        }
                        placeholder="Tu Google OAuth client_id"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="settings-email-google-client-secret">Google OAuth client_secret (opcional)</label>
                      <input
                        id="settings-email-google-client-secret"
                        type="password"
                        value={String(emailSync.oauth?.providers?.oauth_google?.client_secret || "")}
                        onChange={(event) =>
                          setEmailSync((prev) => ({
                            ...prev,
                            oauth: {
                              providers: {
                                ...(prev.oauth?.providers || {}),
                                oauth_google: {
                                  ...(prev.oauth?.providers?.oauth_google || {}),
                                  client_secret: event.target.value,
                                },
                              },
                            },
                          }))
                        }
                        placeholder="Opcional según tipo de cliente OAuth"
                      />
                    </div>
                  </>
                ) : null}
                <div className="empty">
                  Estado OAuth: {hasOAuthToken ? "✅ sesión autorizada" : "⚠️ sesión no autorizada todavía"}
                </div>
                {!hasOAuthToken ? (
                  <div className="empty">
                    Pulsa “Iniciar sesión con {activeOAuthProvider === "oauth_google" ? "Google" : "Microsoft"}” y
                    acepta permisos en el navegador. Luego vuelve aquí.
                  </div>
                ) : null}
                <div className="empty">
                  Puedes usar credenciales de Google guardadas en ajustes o, si no están, las del backend por variable de entorno.
                </div>
              </>
            ) : null}
          </>
        ) : null}

        {emailSyncMessage ? <div className="empty">{emailSyncMessage}</div> : null}
        {emailSyncError ? <div className="alert">{emailSyncError}</div> : null}

        <div className="form-actions">
          <button
            className="primary"
            type="button"
            onClick={() => void runGuidedNextStep()}
            disabled={savingEmailSync || testingEmailSync || loadingEmailFolders || startingOAuth}
          >
            {startingOAuth
              ? "Abriendo navegador..."
              : nextGuidedStep === "select_provider"
              ? "Asistente: elegir proveedor"
              : nextGuidedStep === "fill_basics"
              ? "Asistente: completar datos básicos"
              : nextGuidedStep === "auth"
              ? emailSync.provider === "imap"
                ? "Asistente: introducir contraseña"
                : `Asistente: iniciar sesión con ${activeOAuthProvider === "oauth_google" ? "Google" : "Microsoft"}`
              : nextGuidedStep === "test_connection"
              ? "Asistente: probar conexión"
              : nextGuidedStep === "load_folders"
              ? "Asistente: cargar carpetas"
              : "Asistente: guardar configuración"}
          </button>
          {activeOAuthProvider ? (
            <button
              className="ghost"
              type="button"
              onClick={() => void startOAuthLogin()}
              disabled={
                startingOAuth ||
                savingEmailSync ||
                testingEmailSync ||
                loadingEmailFolders ||
                !hasImapHost ||
                !hasImapUser
              }
              title={
                !hasImapHost || !hasImapUser
                  ? "Completa servidor IMAP y usuario primero."
                  : undefined
              }
            >
              {startingOAuth
                ? "Abriendo navegador..."
                : `Iniciar sesión con ${activeOAuthProvider === "oauth_google" ? "Google" : "Microsoft"}`}
            </button>
          ) : null}
          <button
            className="ghost"
            type="button"
            onClick={() => void runEmailConnectionTest()}
            disabled={!canRunConnectionTest || testingEmailSync || savingEmailSync || loadingEmailFolders}
          >
            {testingEmailSync ? "Probando conexión..." : "Probar conexión de correo"}
          </button>
          <button
            className="ghost"
            type="button"
            onClick={() => void loadImapFolders()}
            disabled={loadingEmailFolders || testingEmailSync || savingEmailSync || emailSync.provider === "none"}
          >
            {loadingEmailFolders ? "Cargando carpetas..." : "Cargar carpetas"}
          </button>
          <button className="primary" type="button" onClick={() => void saveEmailSync()} disabled={savingEmailSync}>
            {savingEmailSync ? "Guardando..." : "Guardar configuración de correo"}
          </button>
        </div>
      </BlockPanel>
    </div>
  );
};

export default SettingsPage;
