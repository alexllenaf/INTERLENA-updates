import React, { useEffect, useMemo, useState } from "react";
import BlockPanel from "../../BlockPanel";
import {
  ApiError,
  disconnectGoogleOAuth,
  getGoogleOAuthStartUrl,
  getEmailSendStats,
  listEmailSendContacts,
  sendEmailBatch,
} from "../../../api";
import { type EmailSendBatchResult, type EmailSendContact, type EmailSendStats } from "../../../types";
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

/* ── Visual design tokens ────────────────────────────────────────── */

const sectionCardStyle: React.CSSProperties = {
  border: "1px solid rgba(15, 23, 42, 0.08)",
  borderRadius: 14,
  padding: "16px 18px",
  background: "linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)",
  boxShadow: "0 1px 3px rgba(15, 23, 42, 0.04)",
};

const rowGridStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
};

const stepBadge = (num: number, active: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  borderRadius: "50%",
  fontSize: 13,
  fontWeight: 700,
  flexShrink: 0,
  background: active ? "var(--accent, #4f46e5)" : "#e2e8f0",
  color: active ? "#fff" : "#64748b",
  transition: "all 200ms ease",
});

const StepHeader: React.FC<{ num: number; label: string; active?: boolean; done?: boolean }> = ({
  num,
  label,
  active = false,
  done = false,
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
    <span style={stepBadge(num, active || done)}>
      {done ? "✓" : num}
    </span>
    <span style={{ fontWeight: 600, fontSize: 14, color: active ? "var(--text, #0f172a)" : "#64748b" }}>
      {label}
    </span>
  </div>
);

const StatusPill: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "3px 10px",
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 600,
      background: ok ? "#ecfdf5" : "#fef3c7",
      color: ok ? "#059669" : "#b45309",
      border: `1px solid ${ok ? "#a7f3d0" : "#fde68a"}`,
    }}
  >
    <span style={{ fontSize: 10 }}>{ok ? "●" : "○"}</span>
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

const Divider: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <hr
    style={{
      border: "none",
      borderTop: "1px solid rgba(15, 23, 42, 0.06)",
      margin: "4px 0",
      ...style,
    }}
  />
);

export const EMAIL_BLOCK_DEFINITION: BlockDefinition<"email"> = {
  type: "email",
  defaultLayout: { colSpan: 60 },
  createDefaultProps: () => ({
    title: "Correo",
    description: "Bandeja sincronizada por metadatos y cuerpo bajo demanda.",
    contactId: "",
    folder: "INBOX",
    cacheSize: 50,
    sendSubjectTemplate: "Hola {{Nombre}}, seguimiento de candidatura en {{Empresa}}",
    sendBodyTemplate:
      "Hola {{Nombre}},\n\nTe escribo para dar seguimiento al proceso con {{Empresa}}.\n\nGracias por tu tiempo.",
    sendContactLimit: 500
  }),
  component: ({ block, mode, patchBlockProps, updateBlockProps, resolveSlot, menuActions }) => {
    const slotContext = createSlotContext(mode, updateBlockProps, patchBlockProps);
    const slot = block.props.contentSlotId ? resolveSlot?.(block.props.contentSlotId, block, slotContext) : null;

    const [contacts, setContacts] = useState<EmailSendContact[]>([]);
    const [selectedRecipients, setSelectedRecipients] = useState<Record<string, boolean>>({});
    const [customFieldsDraft, setCustomFieldsDraft] = useState<Record<string, string>>({});
    const [loadingContacts, setLoadingContacts] = useState(false);
    const [sending, setSending] = useState(false);
    const [oauthStarting, setOauthStarting] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);
    const [sendMessage, setSendMessage] = useState<string | null>(null);
    const [sendStats, setSendStats] = useState<EmailSendStats | null>(null);
    const [sendResult, setSendResult] = useState<EmailSendBatchResult | null>(null);

    const refreshSendStats = React.useCallback(async () => {
      try {
        const stats = await getEmailSendStats();
        setSendStats(stats);
      } catch {
        setSendStats(null);
      }
    }, []);

    useEffect(() => {
      void refreshSendStats();
    }, [refreshSendStats]);

    const isConnected = Boolean(sendStats?.connected && String(sendStats?.sent_by || "").trim());
    const connectedEmail = String(sendStats?.sent_by || "").trim();

    const loadContacts = async () => {
      setLoadingContacts(true);
      setSendError(null);
      setSendMessage(null);
      try {
        const rows = await listEmailSendContacts(Math.max(1, Math.min(5000, block.props.sendContactLimit || 500)));
        setContacts(rows);
        setSelectedRecipients(
          rows.reduce<Record<string, boolean>>((acc, row) => {
            if (row.email) acc[row.email] = true;
            return acc;
          }, {})
        );
        setCustomFieldsDraft(
          rows.reduce<Record<string, string>>((acc, row) => {
            if (row.email) acc[row.email] = stringifyCustomFields(row.custom_fields);
            return acc;
          }, {})
        );
        setSendMessage(`Lista cargada: ${rows.length} contactos desde tracker.`);
      } catch (err) {
        if (err instanceof ApiError) {
          setSendError(err.message);
        } else {
          setSendError("No se pudo cargar la lista de contactos.");
        }
      } finally {
        setLoadingContacts(false);
      }
    };

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

    const preview = useMemo(() => {
      const first = selectedContacts[0];
      if (!first) return null;
      const values: Record<string, string> = {
        name: first.name || "",
        Nombre: first.name || "",
        email: first.email || "",
        Email: first.email || "",
        company: first.company || "",
        Empresa: first.company || "",
      };
      Object.entries(first.custom_fields || {}).forEach(([key, value]) => {
        values[key] = String(value || "");
        values[key.toLowerCase()] = String(value || "");
      });
      return {
        subject: renderTemplate(block.props.sendSubjectTemplate || "", values),
        body: renderTemplate(block.props.sendBodyTemplate || "", values)
      };
    }, [selectedContacts, block.props.sendSubjectTemplate, block.props.sendBodyTemplate]);

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
        const result = await sendEmailBatch({
          subject_template: block.props.sendSubjectTemplate || "",
          body_template: block.props.sendBodyTemplate || "",
          contacts: selectedContacts.map((item) => ({
            name: item.name,
            email: item.email,
            company: item.company,
            custom_fields: item.custom_fields || {}
          }))
        });
        setSendResult(result);
        setSendMessage(`Envío completado. Enviados: ${result.sent}, errores: ${result.errors}.`);
        await refreshSendStats();
      } catch (err) {
        if (err instanceof ApiError) setSendError(err.message);
        else setSendError("No se pudo enviar la campaña.");
      } finally {
        setSending(false);
      }
    };

    return (
      <BlockPanel id={block.id} as="section" menuActions={menuActions}>
        {renderHeader(
          block.id,
          mode,
          block.props.title || "",
          block.props.description || "",
          (patch) => patchBlockProps(patch)
        )}

        {mode === "edit" ? (
          <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
            <input
              className="block-edit-title"
              value={block.props.contactId || ""}
              onChange={(event) => patchBlockProps({ contactId: event.target.value })}
              placeholder="Contact ID"
              aria-label={`${block.id}-contact-id`}
            />
            <input
              className="block-edit-title"
              value={block.props.folder || "INBOX"}
              onChange={(event) => patchBlockProps({ folder: event.target.value || "INBOX" })}
              placeholder="Folder"
              aria-label={`${block.id}-folder`}
            />
            <input
              className="block-edit-title"
              type="number"
              min={30}
              max={50}
              value={block.props.cacheSize || 50}
              onChange={(event) => patchBlockProps({ cacheSize: Number(event.target.value || 50) })}
              placeholder="Cache size"
              aria-label={`${block.id}-cache-size`}
            />
            <input
              className="block-edit-title"
              type="number"
              min={1}
              max={5000}
              value={block.props.sendContactLimit || 500}
              onChange={(event) => patchBlockProps({ sendContactLimit: Number(event.target.value || 500) })}
              placeholder="Contact limit"
              aria-label={`${block.id}-send-contact-limit`}
            />
          </div>
        ) : null}

        {slot ? (
          slot
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {/* ── Hero header ─────────────────────────────────── */}
            <div
              style={{
                ...sectionCardStyle,
                background: "linear-gradient(135deg, #eef2ff 0%, #f8fafc 50%, #f0fdf4 100%)",
                borderColor: "rgba(79, 70, 229, 0.12)",
                padding: "18px 20px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 22 }}>✉️</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>Asistente de envío de emails</div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                      Envía emails personalizados a tus contactos con Google OAuth
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <StatusPill ok={isConnected} label={isConnected ? "Conectado" : "Sin sesión"} />
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => void refreshSendStats()}
                    title="Actualizar estado"
                    style={{ padding: "6px 8px", fontSize: 13, minWidth: "unset", borderRadius: 8 }}
                  >
                    ↻
                  </button>
                </div>
              </div>
            </div>

            {/* ── Feedback area ───────────────────────────────── */}
            {sendMessage ? (
              <div
                style={{
                  ...sectionCardStyle,
                  background: "linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%)",
                  border: "1px solid #a7f3d0",
                  color: "#065f46",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                <span style={{ fontSize: 16 }}>✅</span>
                {sendMessage}
              </div>
            ) : null}
            {sendError ? (
              <div className="alert" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>⚠️</span>
                {sendError}
              </div>
            ) : null}

            {/* ── STEP 1 — Google Auth ────────────────────────── */}
            <div style={sectionCardStyle}>
              <StepHeader num={1} label="Conectar cuenta de Google" active={!isConnected} done={isConnected} />
              <Divider />

              {/* Session info when connected */}
              {sendStats && isConnected ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                    gap: 10,
                    margin: "12px 0",
                  }}
                >
                  {[
                    { label: "Cuenta", value: connectedEmail || "—", icon: "👤" },
                    { label: "Enviados hoy", value: `${sendStats.sent_today} / ${sendStats.daily_limit}`, icon: "📊" },
                    { label: "Restantes", value: String(sendStats.remaining_today), icon: "📨" },
                  ].map((item) => (
                    <div
                      key={item.label}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 12px",
                        borderRadius: 10,
                        background: "#f8fafc",
                        border: "1px solid rgba(15, 23, 42, 0.06)",
                      }}
                    >
                      <span style={{ fontSize: 16 }}>{item.icon}</span>
                      <div>
                        <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.4px" }}>{item.label}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>{item.value}</div>
                      </div>
                    </div>
                  ))}
                  {sendStats.warning ? (
                    <div style={{ gridColumn: "1 / -1", fontSize: 12, color: "#b45309", padding: "4px 0" }}>
                      ⚠️ {sendStats.warning}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => startGoogleLoginForSend()}
                  disabled={oauthStarting}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "9px 18px",
                    borderRadius: 10,
                    fontWeight: 600,
                    fontSize: 13,
                    border: "1px solid #dadce0",
                    background: "#fff",
                    color: "#3c4043",
                    cursor: oauthStarting ? "not-allowed" : "pointer",
                    opacity: oauthStarting ? 0.6 : 1,
                    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                    transition: "box-shadow 150ms ease, background 150ms ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!oauthStarting) {
                      (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 2px 6px rgba(0,0,0,0.15)";
                      (e.currentTarget as HTMLButtonElement).style.background = "#f8f9fa";
                    }
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.08)";
                    (e.currentTarget as HTMLButtonElement).style.background = "#fff";
                  }}
                >
                  <GoogleIcon />
                  {oauthStarting ? "Abriendo Google…" : isConnected ? "Cambiar cuenta" : "Iniciar sesión con Google"}
                </button>

                {isConnected ? (
                  <button
                    className="ghost"
                    type="button"
                    style={{ fontSize: 13, padding: "9px 14px", borderRadius: 10 }}
                    onClick={() => {
                      void (async () => {
                        setSendError(null);
                        setSendMessage(null);
                        try {
                          const out = await disconnectGoogleOAuth();
                          setSendMessage(out.message || "Google OAuth desconectado.");
                          await refreshSendStats();
                        } catch (err) {
                          if (err instanceof ApiError) setSendError(err.message);
                          else setSendError("No se pudo desconectar Google OAuth.");
                        }
                      })();
                    }}
                  >
                    Desconectar
                  </button>
                ) : null}
              </div>
            </div>

            {/* ── STEP 2 — Load contacts ──────────────────────── */}
            <div style={{ ...sectionCardStyle, opacity: isConnected ? 1 : 0.55, transition: "opacity 200ms ease" }}>
              <StepHeader num={2} label="Cargar contactos del tracker" active={isConnected && contacts.length === 0} done={contacts.length > 0} />
              <Divider />
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                <button
                  className="ghost"
                  type="button"
                  onClick={() => void loadContacts()}
                  disabled={loadingContacts || !isConnected}
                  style={{ fontSize: 13, padding: "9px 16px", borderRadius: 10 }}
                >
                  {loadingContacts ? "Cargando…" : "Cargar lista de contactos"}
                </button>
                {contacts.length > 0 ? (
                  <span style={{ fontSize: 12, color: "#64748b" }}>
                    {contacts.length} contacto{contacts.length !== 1 ? "s" : ""} · {selectedContacts.length} seleccionado{selectedContacts.length !== 1 ? "s" : ""}
                  </span>
                ) : (
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>
                    Se extraerán del tracker activo
                  </span>
                )}
              </div>

              {contacts.length > 0 ? (
                <div
                  className="table-scroll"
                  style={{
                    marginTop: 12,
                    border: "1px solid rgba(15, 23, 42, 0.06)",
                    borderRadius: 10,
                    overflow: "hidden",
                  }}
                >
                  <table className="table" style={{ fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        <th style={{ width: 42, textAlign: "center" }}></th>
                        <th>Nombre</th>
                        <th>Email</th>
                        <th>Empresa</th>
                        <th>Campos personalizados</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contacts.map((contact) => (
                        <tr key={`${contact.email}-${contact.company}`}>
                          <td style={{ textAlign: "center" }}>
                            <input
                              type="checkbox"
                              checked={Boolean(selectedRecipients[contact.email])}
                              onChange={(event) =>
                                setSelectedRecipients((prev) => ({ ...prev, [contact.email]: event.target.checked }))
                              }
                              style={{ width: 16, height: 16, accentColor: "var(--accent, #4f46e5)" }}
                            />
                          </td>
                          <td style={{ fontWeight: 500 }}>{contact.name || "—"}</td>
                          <td style={{ color: "#4f46e5" }}>{contact.email}</td>
                          <td>{contact.company || "—"}</td>
                          <td>
                            <input
                              className="block-edit-title"
                              value={customFieldsDraft[contact.email] || ""}
                              onChange={(event) =>
                                setCustomFieldsDraft((prev) => ({ ...prev, [contact.email]: event.target.value }))
                              }
                              placeholder="Posicion=Frontend; Ciudad=Madrid"
                              style={{ fontSize: 12 }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>

            {/* ── STEP 3 — Template & preview ─────────────────── */}
            <div style={{ ...sectionCardStyle, opacity: isConnected ? 1 : 0.55, transition: "opacity 200ms ease" }}>
              <StepHeader num={3} label="Plantilla y vista previa" active={contacts.length > 0 && !preview} done={!!preview} />
              <Divider />

              <div style={{ ...rowGridStyle, marginTop: 10 }}>
                <div>
                  <label
                    htmlFor={`${block.id}-send-subject`}
                    style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.4px" }}
                  >
                    Asunto base
                  </label>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>
                    Usa {"{{Nombre}}"}, {"{{Empresa}}"}, etc. como variables
                  </div>
                  <input
                    id={`${block.id}-send-subject`}
                    className="block-edit-title"
                    value={block.props.sendSubjectTemplate || ""}
                    onChange={(event) => patchBlockProps({ sendSubjectTemplate: event.target.value })}
                    placeholder="Hola {{Nombre}}, seguimiento en {{Empresa}}"
                    style={{ fontSize: 13 }}
                  />
                </div>

                <div>
                  <label
                    htmlFor={`${block.id}-send-body`}
                    style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.4px" }}
                  >
                    Cuerpo base
                  </label>
                  <textarea
                    id={`${block.id}-send-body`}
                    value={block.props.sendBodyTemplate || ""}
                    onChange={(event) => patchBlockProps({ sendBodyTemplate: event.target.value })}
                    rows={5}
                    style={{
                      width: "100%",
                      fontSize: 13,
                      borderRadius: 10,
                      border: "1px solid rgba(15, 23, 42, 0.1)",
                      padding: "10px 12px",
                      marginTop: 4,
                      fontFamily: "inherit",
                      resize: "vertical",
                    }}
                    placeholder="Hola {{Nombre}}, ..."
                  />
                </div>
              </div>

              {preview ? (
                <div
                  style={{
                    marginTop: 14,
                    padding: "14px 16px",
                    borderRadius: 10,
                    background: "#fffbeb",
                    border: "1px solid #fde68a",
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#b45309", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 6 }}>
                    👁️ Vista previa — primer contacto seleccionado
                  </div>
                  <div style={{ fontSize: 13 }}>
                    <strong>Asunto:</strong> {preview.subject}
                  </div>
                  <div
                    className="page-builder-text"
                    style={{
                      marginTop: 6,
                      whiteSpace: "pre-wrap",
                      fontSize: 13,
                      color: "#44403c",
                      lineHeight: 1.6,
                    }}
                  >
                    {preview.body}
                  </div>
                </div>
              ) : null}
            </div>

            {/* ── STEP 4 — Send ───────────────────────────────── */}
            <div style={{ ...sectionCardStyle, opacity: isConnected ? 1 : 0.55, transition: "opacity 200ms ease" }}>
              <StepHeader num={4} label="Enviar emails" active={selectedContacts.length > 0 && !sendResult} done={!!sendResult} />
              <Divider />
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                <button
                  className="primary"
                  type="button"
                  onClick={() => void runSend()}
                  disabled={sending || selectedContacts.length === 0 || !isConnected}
                  style={{
                    fontSize: 13,
                    padding: "10px 22px",
                    borderRadius: 10,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {sending ? (
                    <>
                      <span style={{ display: "inline-block", animation: "spin 1s linear infinite", fontSize: 14 }}>⏳</span>
                      Enviando…
                    </>
                  ) : (
                    <>
                      Enviar a {selectedContacts.length} contacto{selectedContacts.length !== 1 ? "s" : ""}
                    </>
                  )}
                </button>
                {selectedContacts.length === 0 && contacts.length > 0 ? (
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>
                    Selecciona al menos un contacto arriba
                  </span>
                ) : null}
              </div>

              {sendResult ? (
                <div style={{ marginTop: 14 }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                      gap: 8,
                      marginBottom: 10,
                    }}
                  >
                    <div style={{ padding: "8px 12px", borderRadius: 10, background: "#ecfdf5", border: "1px solid #a7f3d0", textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: "#059669" }}>{sendResult.sent}</div>
                      <div style={{ fontSize: 11, color: "#065f46", fontWeight: 600 }}>Enviados</div>
                    </div>
                    <div style={{ padding: "8px 12px", borderRadius: 10, background: sendResult.errors > 0 ? "#fff5f5" : "#f8fafc", border: `1px solid ${sendResult.errors > 0 ? "#fed7d7" : "rgba(15,23,42,0.06)"}`, textAlign: "center" }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: sendResult.errors > 0 ? "#dc2626" : "#94a3b8" }}>{sendResult.errors}</div>
                      <div style={{ fontSize: 11, color: sendResult.errors > 0 ? "#9b2c2c" : "#94a3b8", fontWeight: 600 }}>Errores</div>
                    </div>
                    <div style={{ padding: "8px 12px", borderRadius: 10, background: "#f8fafc", border: "1px solid rgba(15,23,42,0.06)", textAlign: "center" }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#64748b", lineHeight: 1.8 }}>Lote</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", wordBreak: "break-all" }}>{sendResult.batch_id}</div>
                    </div>
                  </div>
                  {sendResult.warning ? (
                    <div style={{ fontSize: 12, color: "#b45309", marginBottom: 6 }}>⚠️ {sendResult.warning}</div>
                  ) : null}
                  <div className="table-scroll" style={{ border: "1px solid rgba(15,23,42,0.06)", borderRadius: 10, overflow: "hidden" }}>
                    <table className="table" style={{ fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: "#f8fafc" }}>
                          <th>Email</th>
                          <th>Estado</th>
                          <th>Detalle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sendResult.results.map((row, idx) => (
                          <tr key={`${row.email}-${idx}`}>
                            <td style={{ color: "#4f46e5" }}>{row.email || "—"}</td>
                            <td>
                              <StatusPill ok={row.status === "sent"} label={row.status} />
                            </td>
                            <td style={{ fontSize: 12, color: "#64748b" }}>{row.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </BlockPanel>
    );
  }
};
