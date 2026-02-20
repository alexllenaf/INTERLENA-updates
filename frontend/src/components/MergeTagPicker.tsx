/**
 * MergeTagPicker — Visual dropdown to insert {{merge_tags}} into email
 * templates.  Shows available fields grouped by category with a search
 * filter.  Each tag is rendered as a colourful pill that the user clicks
 * to insert into the subject or body editor.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

/* ── Types ──────────────────────────────────────────────────────────── */

export interface MergeTag {
  /** The key that will be inserted as {{key}} */
  key: string;
  /** Human-readable label shown in the picker */
  label: string;
  /** Category / group name */
  group: string;
  /** Preview / example value (shown as tooltip) */
  preview?: string;
}

export interface MergeTagPickerProps {
  /** All available tags to show */
  tags: MergeTag[];
  /** Called when the user selects a tag */
  onInsert: (tag: MergeTag) => void;
  /** Button label — defaults to "{{ }}  Variables" */
  buttonLabel?: string;
  /** Compact mode (icon only) */
  compact?: boolean;
}

/* ── Group colour palette ───────────────────────────────────────────── */

const GROUP_COLORS: Record<string, { bg: string; fg: string; border: string }> = {
  "Contacto": { bg: "#eff6ff", fg: "#1d4ed8", border: "#bfdbfe" },
  "Empresa": { bg: "#f0fdf4", fg: "#15803d", border: "#bbf7d0" },
  "Proceso": { bg: "#fefce8", fg: "#a16207", border: "#fde68a" },
  "Entrevista": { bg: "#fdf4ff", fg: "#9333ea", border: "#e9d5ff" },
  "Personalizado": { bg: "#fff7ed", fg: "#c2410c", border: "#fed7aa" },
};

const getGroupColor = (group: string) =>
  GROUP_COLORS[group] ?? { bg: "#f8fafc", fg: "#475569", border: "#e2e8f0" };

/* ── Component ──────────────────────────────────────────────────────── */

const MergeTagPicker: React.FC<MergeTagPickerProps> = ({
  tags,
  onInsert,
  buttonLabel,
  compact = false,
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [dropPos, setDropPos] = useState<{ top: number; left: number } | null>(null);

  /* Calculate dropdown position when opened */
  useEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setDropPos({ top: rect.bottom + 6, left: rect.left });
  }, [open]);

  /* Close on outside click */
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        wrapperRef.current && !wrapperRef.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  /* Focus search when opened */
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  /* Filtered & grouped tags */
  const grouped = useMemo(() => {
    const q = search.toLowerCase().trim();
    const filtered = q
      ? tags.filter(
          (t) =>
            t.key.toLowerCase().includes(q) ||
            t.label.toLowerCase().includes(q) ||
            t.group.toLowerCase().includes(q)
        )
      : tags;

    const groups: Record<string, MergeTag[]> = {};
    for (const tag of filtered) {
      (groups[tag.group] ??= []).push(tag);
    }
    return groups;
  }, [tags, search]);

  const handleSelect = (tag: MergeTag) => {
    onInsert(tag);
    setOpen(false);
    setSearch("");
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative", display: "inline-block" }}>
      {/* Trigger button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        title="Insertar variable del contacto"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: compact ? "5px 8px" : "6px 14px",
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 600,
          border: "1px solid #c7d2fe",
          background: open ? "#eef2ff" : "linear-gradient(135deg, #eef2ff 0%, #fff 100%)",
          color: "#4338ca",
          cursor: "pointer",
          transition: "all 150ms ease",
          whiteSpace: "nowrap",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget.style.background = "#eef2ff");
          (e.currentTarget.style.borderColor = "#a5b4fc");
        }}
        onMouseLeave={(e) => {
          (e.currentTarget.style.background = open ? "#eef2ff" : "linear-gradient(135deg, #eef2ff 0%, #fff 100%)");
          (e.currentTarget.style.borderColor = "#c7d2fe");
        }}
      >
        <span style={{ fontFamily: "monospace", fontSize: 15, letterSpacing: -1 }}>{"{⟩}"}</span>
        {!compact && (buttonLabel || "Variables")}
      </button>

      {/* Dropdown (rendered via portal to escape overflow:hidden parents) */}
      {open && dropPos && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: "fixed",
            top: dropPos.top,
            left: dropPos.left,
            zIndex: 99999,
            width: 340,
            maxHeight: 420,
            borderRadius: 14,
            border: "1px solid rgba(15, 23, 42, 0.10)",
            background: "#fff",
            boxShadow: "0 12px 40px rgba(15, 23, 42, 0.15), 0 2px 8px rgba(15, 23, 42, 0.08)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            animation: "mergeTagFadeIn 120ms ease",
          }}
        >
          {/* Search bar */}
          <div style={{ padding: "10px 12px 8px", borderBottom: "1px solid rgba(15, 23, 42, 0.06)" }}>
            <div style={{ position: "relative" }}>
              <span
                style={{
                  position: "absolute",
                  left: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: 14,
                  color: "#94a3b8",
                  pointerEvents: "none",
                }}
              >
                🔍
              </span>
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar variable…"
                style={{
                  width: "100%",
                  padding: "8px 10px 8px 32px",
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  fontSize: 13,
                  outline: "none",
                  background: "#f8fafc",
                  transition: "border-color 150ms ease",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => (e.target.style.borderColor = "#a5b4fc")}
                onBlur={(e) => (e.target.style.borderColor = "#e2e8f0")}
              />
            </div>
          </div>

          {/* Tag groups */}
          <div style={{ overflowY: "auto", padding: "6px 0" }}>
            {Object.keys(grouped).length === 0 ? (
              <div style={{ padding: "20px 16px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                No se encontraron variables
              </div>
            ) : (
              Object.entries(grouped).map(([groupName, groupTags]) => {
                const colors = getGroupColor(groupName);
                return (
                  <div key={groupName} style={{ marginBottom: 4 }}>
                    {/* Group header */}
                    <div
                      style={{
                        padding: "6px 14px 4px",
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        color: colors.fg,
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: colors.fg,
                          opacity: 0.5,
                          flexShrink: 0,
                        }}
                      />
                      {groupName}
                    </div>
                    {/* Tags as pills */}
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                        padding: "4px 14px 8px",
                      }}
                    >
                      {groupTags.map((tag) => (
                        <button
                          key={tag.key}
                          type="button"
                          onClick={() => handleSelect(tag)}
                          title={tag.preview ? `Ejemplo: ${tag.preview}` : `Insertar {{${tag.key}}}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 4,
                            padding: "4px 10px",
                            borderRadius: 20,
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                            border: `1px solid ${colors.border}`,
                            background: colors.bg,
                            color: colors.fg,
                            transition: "all 120ms ease",
                            whiteSpace: "nowrap",
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget.style.transform = "scale(1.05)");
                            (e.currentTarget.style.boxShadow = `0 2px 8px ${colors.border}`);
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget.style.transform = "scale(1)");
                            (e.currentTarget.style.boxShadow = "none");
                          }}
                        >
                          <span style={{ fontFamily: "monospace", fontSize: 10, opacity: 0.6 }}>{"{{"}</span>
                          {tag.label}
                          <span style={{ fontFamily: "monospace", fontSize: 10, opacity: 0.6 }}>{"}}"}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer hint */}
          <div
            style={{
              borderTop: "1px solid rgba(15, 23, 42, 0.06)",
              padding: "8px 14px",
              fontSize: 11,
              color: "#94a3b8",
              background: "#fafbfc",
              textAlign: "center",
            }}
          >
            Haz clic en una variable para insertarla en la plantilla
          </div>
          {/* Keyframe animation (inside portal) */}
          <style>{`
            @keyframes mergeTagFadeIn {
              from { opacity: 0; transform: translateY(-4px); }
              to { opacity: 1; transform: translateY(0); }
            }
          `}</style>
        </div>,
        document.body
      )}

      {/* Keyframe animation (for SSR / fallback) */}
      <style>{`
        @keyframes mergeTagFadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

export default MergeTagPicker;

/* ── Helpers to build the default tag list ──────────────────────────── */

/** Built-in tags that are always available */
const BUILTIN_TAGS: MergeTag[] = [
  { key: "Nombre", label: "Nombre", group: "Contacto" },
  { key: "Apellidos", label: "Apellidos", group: "Contacto" },
  { key: "Email", label: "Email", group: "Contacto" },
  { key: "Empresa", label: "Empresa", group: "Empresa" },
];

/** Standard application-field tags (these come from backend in custom_fields) */
const APP_FIELD_TAGS: MergeTag[] = [
  { key: "Posición", label: "Posición", group: "Proceso" },
  { key: "Tipo de empleo", label: "Tipo de empleo", group: "Proceso" },
  { key: "Ubicación", label: "Ubicación", group: "Proceso" },
  { key: "Etapa", label: "Etapa", group: "Proceso" },
  { key: "Resultado", label: "Resultado", group: "Proceso" },
  { key: "Fecha aplicación", label: "Fecha aplicación", group: "Proceso" },
  { key: "Fecha seguimiento", label: "Fecha seguimiento", group: "Proceso" },
  { key: "Fecha entrevista", label: "Fecha entrevista", group: "Entrevista" },
  { key: "Rondas entrevista", label: "Rondas entrevista", group: "Entrevista" },
  { key: "Tipo entrevista", label: "Tipo entrevista", group: "Entrevista" },
  { key: "Entrevistadores", label: "Entrevistadores", group: "Entrevista" },
  { key: "Puntuación empresa", label: "Puntuación empresa", group: "Entrevista" },
  { key: "Última ronda superada", label: "Última ronda superada", group: "Entrevista" },
  { key: "Total rondas", label: "Total rondas", group: "Entrevista" },
  { key: "Mi puntuación", label: "Mi puntuación", group: "Entrevista" },
  { key: "Áreas de mejora", label: "Áreas de mejora", group: "Entrevista" },
  { key: "Skill a mejorar", label: "Skill a mejorar", group: "Entrevista" },
  { key: "Notas", label: "Notas", group: "Proceso" },
];

/** Known keys from built-in + app fields (to avoid duplicating them as "custom") */
const KNOWN_KEYS = new Set([
  ...BUILTIN_TAGS.map((t) => t.key.toLowerCase()),
  ...APP_FIELD_TAGS.map((t) => t.key.toLowerCase()),
  "name", "first_name", "last_name", "email", "company",
  "nombre", "apellidos", "empresa",
]);

/**
 * Build the full list of available merge tags from a set of contacts.
 * Includes built-in, standard app fields (ALWAYS shown), plus any extra
 * custom fields found in the contacts that aren't already known.
 */
export function buildMergeTagsFromContacts(
  contacts: Array<{ name?: string; email?: string; company?: string; custom_fields?: Record<string, string> }>
): MergeTag[] {
  // Gather all unique custom field keys across all contacts
  const customKeySet = new Set<string>();
  const previewMap: Record<string, string> = {};

  for (const contact of contacts) {
    if (!contact.custom_fields) continue;
    for (const [key, value] of Object.entries(contact.custom_fields)) {
      if (!customKeySet.has(key) && value) {
        previewMap[key] = value; // store first non-empty value as preview
      }
      customKeySet.add(key);
    }
  }

  // Built-in tags with preview from first contact
  const firstContact = contacts[0];
  const builtinWithPreview: MergeTag[] = BUILTIN_TAGS.map((t) => {
    let pv = "";
    if (firstContact) {
      if (t.key === "Nombre") {
        const fc = firstContact as any;
        pv = fc.first_name || (firstContact.name || "").split(" ")[0] || "";
      } else if (t.key === "Apellidos") {
        pv = (firstContact as any).last_name || "";
      } else if (t.key === "Email") pv = firstContact.email || "";
      else if (t.key === "Empresa") pv = firstContact.company || "";
    }
    return { ...t, preview: pv || undefined };
  });

  // App field tags — ALWAYS shown so the user can compose templates freely.
  // If a contact has that field populated we attach the preview value.
  const appFieldsWithPreview = APP_FIELD_TAGS.map((t) => ({
    ...t,
    preview: previewMap[t.key] || undefined,
  }));

  // Extra custom fields not in known list
  const extraCustom: MergeTag[] = [];
  for (const key of customKeySet) {
    if (KNOWN_KEYS.has(key.toLowerCase())) continue;
    // Skip keys that match an APP_FIELD_TAGS key
    if (APP_FIELD_TAGS.some((t) => t.key === key)) continue;
    extraCustom.push({
      key,
      label: key,
      group: "Personalizado",
      preview: previewMap[key] || undefined,
    });
  }

  return [...builtinWithPreview, ...appFieldsWithPreview, ...extraCustom];
}
