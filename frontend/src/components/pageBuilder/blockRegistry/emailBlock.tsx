import React, { useEffect, useMemo, useRef, useState } from "react";
import BlockPanel from "../../BlockPanel";
import RichTextEditor from "../../RichTextEditor";
import MergeTagPicker, { buildMergeTagsFromContacts } from "../../MergeTagPicker";
import type { MergeTag } from "../../MergeTagPicker";
import {
  ApiError,
  disconnectGoogleOAuth,
  disconnectSingleGoogleAccount,
  getGoogleOAuthStartUrl,
  getEmailSendStats,
  listEmailSendContacts,
  listGoogleAccounts,
  selectGoogleAccount,
  sendEmailBatch,
} from "../../../api";
import { type EmailSendBatchResult, type EmailSendContact, type EmailSendStats, type GoogleAccount } from "../../../types";
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
  borderRadius: 12,
  padding: "14px 18px",
  background: "linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
};

const rowGridStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
};

const stepBadge = (num: number, active: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
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
  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
    <span style={stepBadge(num, active || done)}>
      {done ? "✓" : num}
    </span>
    <span style={{ fontWeight: 600, fontSize: 13, color: active ? "var(--text, #0f172a)" : "#64748b" }}>
      {label}
    </span>
  </div>
);

const StatusPill: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "3px 10px",
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 600,
      background: ok ? "#ecfdf5" : "#fef3c7",
      color: ok ? "#059669" : "#b45309",
      border: `1px solid ${ok ? "#a7f3d0" : "#fde68a"}`,
    }}
  >
    <span style={{ fontSize: 11 }}>{ok ? "●" : "○"}</span>
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
    const [googleAccounts, setGoogleAccounts] = useState<GoogleAccount[]>([]);
    const [acctDropdownOpen, setAcctDropdownOpen] = useState(false);

    const subjectInputRef = useRef<HTMLInputElement>(null);
    const acctDropdownRef = useRef<HTMLDivElement>(null);

    /* ── Available merge tags derived from loaded contacts ────────── */
    const mergeTags = useMemo(() => buildMergeTagsFromContacts(contacts), [contacts]);

    const insertTagInSubject = (tag: MergeTag) => {
      const input = subjectInputRef.current;
      const variable = `{{${tag.key}}}`;
      if (!input) {
        patchBlockProps({ sendSubjectTemplate: (block.props.sendSubjectTemplate || "") + variable });
        return;
      }
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      const before = input.value.slice(0, start);
      const after = input.value.slice(end);
      patchBlockProps({ sendSubjectTemplate: before + variable + after });
      // Restore cursor position after React re-render
      requestAnimationFrame(() => {
        input.selectionStart = input.selectionEnd = start + variable.length;
        input.focus();
      });
    };

    const refreshSendStats = React.useCallback(async () => {
      try {
        const stats = await getEmailSendStats();
        setSendStats(stats);
      } catch {
        setSendStats(null);
      }
      try {
        const accts = await listGoogleAccounts();
        setGoogleAccounts(accts);
      } catch {
        /* ignore */
      }
    }, []);

    useEffect(() => {
      void refreshSendStats();
    }, [refreshSendStats]);

    /* Close account dropdown on outside click */
    useEffect(() => {
      const handler = (e: MouseEvent) => {
        if (acctDropdownRef.current && !acctDropdownRef.current.contains(e.target as Node)) {
          setAcctDropdownOpen(false);
        }
      };
      if (acctDropdownOpen) {
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
      }
    }, [acctDropdownOpen]);

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

    /* Auto-load contacts when connected and list is empty */
    useEffect(() => {
      if (isConnected && contacts.length === 0 && !loadingContacts) {
        void loadContacts();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isConnected]);

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
        Nombre: first.first_name || first.name?.split(" ")[0] || "",
        nombre: first.first_name || first.name?.split(" ")[0] || "",
        first_name: first.first_name || first.name?.split(" ")[0] || "",
        last_name: first.last_name || "",
        Apellidos: first.last_name || "",
        apellidos: first.last_name || "",
        email: first.email || "",
        Email: first.email || "",
        company: first.company || "",
        Empresa: first.company || "",
        empresa: first.company || "",
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

        {mode === "edit" ? null : null}

        {slot ? (
          slot
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {/* ── Hero header (compact bar) ────────────────────── */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                padding: "12px 16px",
                borderRadius: 12,
                background: "linear-gradient(135deg, #eef2ff 0%, #f8fafc 50%, #f0fdf4 100%)",
                border: "1px solid rgba(79, 70, 229, 0.10)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18 }}>✉️</span>
                <span style={{ fontWeight: 700, fontSize: 15 }}>Envío de emails</span>
                <span style={{ fontSize: 12, color: "#64748b" }}>— Google OAuth</span>
              </div>
              <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                <StatusPill ok={isConnected} label={isConnected ? "Conectado" : "Sin sesión"} />
                <button
                  className="ghost"
                  type="button"
                  onClick={() => void refreshSendStats()}
                  title="Actualizar estado"
                  style={{ padding: "4px 8px", fontSize: 13, minWidth: "unset", borderRadius: 6 }}
                >
                  ↻
                </button>
              </div>
            </div>

            {/* ── Feedback area ───────────────────────────────── */}
            {sendMessage ? (
              <div
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  background: "#ecfdf5",
                  border: "1px solid #a7f3d0",
                  color: "#065f46",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                <span style={{ fontSize: 13 }}>✅</span>
                {sendMessage}
              </div>
            ) : null}
            {sendError ? (
              <div className="alert" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "8px 14px" }}>
                <span style={{ fontSize: 13 }}>⚠️</span>
                {sendError}
              </div>
            ) : null}

            {/* ── STEP 1 — Google Auth ────────────────────────── */}
            {isConnected && googleAccounts.length > 0 ? (
              /* ── Connected: compact single-line with dropdown ── */
              <div
                style={{
                  ...sectionCardStyle,
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                {/* Active account avatar + dropdown trigger */}
                {(() => {
                  const active = googleAccounts.find((a) => a.active);
                  const activeEmail = active?.email || connectedEmail || "—";
                  return (
                    <div ref={acctDropdownRef} style={{ position: "relative" }}>
                      <button
                        type="button"
                        onClick={() => setAcctDropdownOpen((p) => !p)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "4px 10px",
                          borderRadius: 8,
                          border: "1px solid #e2e8f0",
                          background: "#f8fafc",
                          cursor: "pointer",
                          transition: "all 150ms ease",
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.borderColor = "#a5b4fc";
                          (e.currentTarget as HTMLButtonElement).style.background = "#eef2ff";
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLButtonElement).style.borderColor = "#e2e8f0";
                          (e.currentTarget as HTMLButtonElement).style.background = "#f8fafc";
                        }}
                      >
                        {/* Round avatar */}
                        <span
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: "50%",
                            background: "var(--accent, #4f46e5)",
                            color: "#fff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 12,
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {activeEmail.charAt(0).toUpperCase()}
                        </span>
                        <strong style={{ fontSize: 12, color: "#1e293b", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {activeEmail}
                        </strong>
                        <span style={{ fontSize: 10, color: "#94a3b8", transition: "transform 150ms", transform: acctDropdownOpen ? "rotate(180deg)" : "rotate(0)" }}>▾</span>
                      </button>

                      {/* Dropdown menu */}
                      {acctDropdownOpen ? (
                        <div
                          style={{
                            position: "absolute",
                            top: "calc(100% + 4px)",
                            left: 0,
                            minWidth: 260,
                            background: "#fff",
                            border: "1px solid #e2e8f0",
                            borderRadius: 10,
                            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                            zIndex: 50,
                            padding: "4px 0",
                            animation: "fadeIn 100ms ease",
                          }}
                        >
                          <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
                          {googleAccounts.map((acct) => (
                            <div
                              key={acct.email}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "8px 12px",
                                cursor: acct.active ? "default" : "pointer",
                                background: acct.active ? "#eef2ff" : "transparent",
                                transition: "background 100ms ease",
                              }}
                              onMouseEnter={(e) => {
                                if (!acct.active) (e.currentTarget as HTMLElement).style.background = "#f8fafc";
                              }}
                              onMouseLeave={(e) => {
                                if (!acct.active) (e.currentTarget as HTMLElement).style.background = "transparent";
                              }}
                              onClick={() => {
                                if (!acct.active) {
                                  void (async () => {
                                    try {
                                      await selectGoogleAccount(acct.email);
                                      await refreshSendStats();
                                    } catch (err) {
                                      if (err instanceof ApiError) setSendError(err.message);
                                    }
                                  })();
                                }
                                setAcctDropdownOpen(false);
                              }}
                            >
                              {/* Avatar */}
                              <span
                                style={{
                                  width: 24,
                                  height: 24,
                                  borderRadius: "50%",
                                  background: acct.active ? "var(--accent, #4f46e5)" : "#e2e8f0",
                                  color: acct.active ? "#fff" : "#64748b",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 11,
                                  fontWeight: 700,
                                  flexShrink: 0,
                                }}
                              >
                                {acct.email.charAt(0).toUpperCase()}
                              </span>
                              <span style={{ flex: 1, fontSize: 12, fontWeight: acct.active ? 700 : 400, color: acct.active ? "var(--accent, #4f46e5)" : "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {acct.email}
                              </span>
                              {acct.active ? (
                                <span style={{ fontSize: 10, color: "#6366f1", fontWeight: 600 }}>● Activa</span>
                              ) : (
                                /* Disconnect single */
                                <span
                                  role="button"
                                  tabIndex={0}
                                  title={`Desconectar ${acct.email}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void (async () => {
                                      setSendError(null);
                                      setSendMessage(null);
                                      try {
                                        const out = await disconnectSingleGoogleAccount(acct.email);
                                        setSendMessage(out.message || "Cuenta desconectada.");
                                        await refreshSendStats();
                                      } catch (err) {
                                        if (err instanceof ApiError) setSendError(err.message);
                                        else setSendError("No se pudo desconectar la cuenta.");
                                      }
                                      setAcctDropdownOpen(false);
                                    })();
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.target as HTMLElement).click(); }
                                  }}
                                  style={{
                                    fontSize: 11,
                                    color: "#94a3b8",
                                    cursor: "pointer",
                                    padding: "2px 4px",
                                    borderRadius: 4,
                                    transition: "color 100ms, background 100ms",
                                  }}
                                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#dc2626"; (e.currentTarget as HTMLElement).style.background = "#fef2f2"; }}
                                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "#94a3b8"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                                >
                                  ✕
                                </span>
                              )}
                            </div>
                          ))}
                          {/* Divider + Add account */}
                          <div style={{ height: 1, background: "#f1f5f9", margin: "4px 0" }} />
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              padding: "8px 12px",
                              cursor: oauthStarting ? "not-allowed" : "pointer",
                              opacity: oauthStarting ? 0.6 : 1,
                              transition: "background 100ms ease",
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f8fafc"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                            onClick={() => {
                              if (!oauthStarting) {
                                setAcctDropdownOpen(false);
                                startGoogleLoginForSend();
                              }
                            }}
                          >
                            <span style={{ width: 24, height: 24, borderRadius: "50%", background: "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: "#64748b" }}>+</span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>{oauthStarting ? "Abriendo…" : "Añadir cuenta"}</span>
                            <GoogleIcon />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })()}

                {/* Stats pills */}
                {sendStats ? (
                  <>
                    <span style={{ fontSize: 12, color: "#64748b", display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, background: "#f8fafc", border: "1px solid rgba(15,23,42,0.06)" }}>
                      📊 <strong style={{ color: "#1e293b" }}>{sendStats.sent_today}/{sendStats.daily_limit}</strong> hoy
                    </span>
                    <span style={{ fontSize: 12, color: "#64748b", display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 6, background: "#f8fafc", border: "1px solid rgba(15,23,42,0.06)" }}>
                      📨 <strong style={{ color: "#1e293b" }}>{sendStats.remaining_today}</strong> restantes
                    </span>
                    {sendStats.warning ? (
                      <span style={{ fontSize: 12, color: "#b45309" }}>⚠️ {sendStats.warning}</span>
                    ) : null}
                  </>
                ) : null}

                {/* Spacer */}
                <span style={{ flex: 1 }} />

                {/* Disconnect all */}
                <button
                  className="ghost"
                  type="button"
                  style={{ fontSize: 12, padding: "5px 10px", borderRadius: 6, color: "#dc2626" }}
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
              </div>
            ) : (
              /* ── Not connected: full login card ───────────── */
              <div style={sectionCardStyle}>
                <StepHeader num={1} label="Conectar cuenta de Google" active done={false} />
                <Divider />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => startGoogleLoginForSend()}
                    disabled={oauthStarting}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 14px",
                      borderRadius: 8,
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
                    {oauthStarting ? "Abriendo Google…" : "Iniciar sesión con Google"}
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 2 — Load contacts ──────────────────────── */}
            <div style={{ ...sectionCardStyle, opacity: isConnected ? 1 : 0.55, transition: "opacity 200ms ease" }}>
              <StepHeader num={2} label="Cargar contactos del tracker" active={isConnected && contacts.length === 0} done={contacts.length > 0} />
              <Divider />
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                <button
                  className="ghost"
                  type="button"
                  onClick={() => void loadContacts()}
                  disabled={loadingContacts || !isConnected}
                  style={{ fontSize: 13, padding: "7px 14px", borderRadius: 8 }}
                >
                  {loadingContacts ? "Cargando…" : "Cargar lista de contactos"}
                </button>
                {contacts.length > 0 ? (
                  <span style={{ fontSize: 13, color: "#64748b" }}>
                    {contacts.length} contacto{contacts.length !== 1 ? "s" : ""} · {selectedContacts.length} seleccionado{selectedContacts.length !== 1 ? "s" : ""}
                  </span>
                ) : (
                  <span style={{ fontSize: 13, color: "#94a3b8" }}>
                    Se extraerán del tracker activo
                  </span>
                )}
              </div>

              {contacts.length > 0 ? (
                <div
                  className="table-scroll"
                  style={{
                    marginTop: 8,
                    border: "1px solid rgba(15, 23, 42, 0.06)",
                    borderRadius: 8,
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
                              style={{ fontSize: 13 }}
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

              <div style={{ ...rowGridStyle, marginTop: 6 }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                    <label
                      htmlFor={`${block.id}-send-subject`}
                      style={{ fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.4px" }}
                    >
                      Asunto base
                    </label>
                    {mergeTags.length > 0 && (
                      <MergeTagPicker
                        tags={mergeTags}
                        onInsert={insertTagInSubject}
                        compact
                      />
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>
                    Haz clic en <strong style={{ color: "#4338ca" }}>{"{\u27e9} Variables"}</strong> para insertar datos del contacto
                  </div>
                  <input
                    ref={subjectInputRef}
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
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>
                    Editor de texto enriquecido — usa <strong style={{ color: "#4338ca" }}>{"{⟩} Variables"}</strong> en la barra para insertar datos del contacto
                  </div>
                  <RichTextEditor
                    value={block.props.sendBodyTemplate || ""}
                    onChange={(html) => patchBlockProps({ sendBodyTemplate: html })}
                    placeholder="Hola {{Nombre}}, ..."
                    minHeight={120}
                    toolbarExtra={mergeTags.length > 0 ? (editor) => (
                      <MergeTagPicker
                        tags={mergeTags}
                        onInsert={(tag) => {
                          editor.chain().focus().insertContent(`{{${tag.key}}}`).run();
                        }}
                        buttonLabel="Variables"
                      />
                    ) : undefined}
                  />
                </div>
              </div>

              {preview ? (
                <div
                  style={{
                    marginTop: 8,
                    padding: "8px 12px",
                    borderRadius: 8,
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
                      fontSize: 13,
                      color: "#44403c",
                      lineHeight: 1.5,
                    }}
                    dangerouslySetInnerHTML={{ __html: preview.body }}
                  />
                </div>
              ) : null}
            </div>

            {/* ── STEP 4 — Send ───────────────────────────────── */}
            <div style={{ ...sectionCardStyle, opacity: isConnected ? 1 : 0.55, transition: "opacity 200ms ease" }}>
              <StepHeader num={4} label="Enviar emails" active={selectedContacts.length > 0 && !sendResult} done={!!sendResult} />
              <Divider />
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                <button
                  className="primary"
                  type="button"
                  onClick={() => void runSend()}
                  disabled={sending || selectedContacts.length === 0 || !isConnected}
                  style={{
                    fontSize: 13,
                    padding: "8px 18px",
                    borderRadius: 8,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
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
                  <span style={{ fontSize: 13, color: "#94a3b8" }}>
                    Selecciona al menos un contacto arriba
                  </span>
                ) : null}
              </div>

              {sendResult ? (
                <div style={{ marginTop: 8 }}>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ padding: "5px 12px", borderRadius: 8, background: "#ecfdf5", border: "1px solid #a7f3d0", fontSize: 13, fontWeight: 700, color: "#059669" }}>
                      {sendResult.sent} enviados
                    </span>
                    <span style={{ padding: "5px 12px", borderRadius: 8, background: sendResult.errors > 0 ? "#fff5f5" : "#f8fafc", border: `1px solid ${sendResult.errors > 0 ? "#fed7d7" : "rgba(15,23,42,0.06)"}`, fontSize: 13, fontWeight: 700, color: sendResult.errors > 0 ? "#dc2626" : "#94a3b8" }}>
                      {sendResult.errors} errores
                    </span>
                    <span style={{ padding: "5px 12px", borderRadius: 8, background: "#f8fafc", border: "1px solid rgba(15,23,42,0.06)", fontSize: 12, color: "#94a3b8" }}>
                      Lote: {sendResult.batch_id}
                    </span>
                  </div>
                  {sendResult.warning ? (
                    <div style={{ fontSize: 13, color: "#b45309", marginBottom: 6 }}>⚠️ {sendResult.warning}</div>
                  ) : null}
                  <div className="table-scroll" style={{ border: "1px solid rgba(15,23,42,0.06)", borderRadius: 8, overflow: "hidden" }}>
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
                            <td style={{ fontSize: 13, color: "#64748b" }}>{row.message}</td>
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
