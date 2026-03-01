import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BlockPanel from "../../BlockPanel";
import { useAppData } from "../../../state";
import { createSlotContext, renderHeader } from "./shared";
import { type BlockDefinition } from "./types";
import type {
  CalendarEventType,
  CalendarDisplayMode,
  CalendarColorScheme,
  AlertStatusFilter
} from "../types";
import {
  collectEditableTableTargets,
  buildBlockGraph,
  resolveBlock,
  type EditableTableTarget
} from "../blockLinks";

/* ── Calendar Config constants ─────────────────────────────────── */

const ALL_EVENT_TYPES: CalendarEventType[] = ["Application", "Interview", "Follow-Up", "To-Do"];
const EVENT_TYPE_LABELS: Record<CalendarEventType, string> = {
  Application: "Candidatura",
  Interview: "Entrevista",
  "Follow-Up": "Seguimiento",
  "To-Do": "Tarea"
};

const DISPLAY_MODE_LABELS: Record<CalendarDisplayMode, string> = {
  month: "Mes",
  week: "Semana"
};

const COLOR_SCHEME_LABELS: Record<CalendarColorScheme, string> = {
  type: "Por tipo de evento",
  status: "Por estado",
  company: "Por empresa"
};

const ALL_STATUS_FILTERS: AlertStatusFilter[] = ["overdue", "soon", "ok"];
const STATUS_FILTER_LABELS: Record<AlertStatusFilter, string> = {
  overdue: "Vencido",
  soon: "Próximo",
  ok: "OK"
};

const WEEKDAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: "Lunes" },
  { value: 1, label: "Martes" },
  { value: 2, label: "Miércoles" },
  { value: 3, label: "Jueves" },
  { value: 4, label: "Viernes" },
  { value: 5, label: "Sábado" },
  { value: 6, label: "Domingo" }
];

const DEFAULT_MAX_EVENTS_PER_DAY = 3;
const MIN_MAX_EVENTS = 1;
const MAX_MAX_EVENTS = 10;

const FLOATING_MENU_GUTTER = 12;
const FLOATING_MENU_OFFSET = 6;

/* ── Normalizers ───────────────────────────────────────────────── */

const normalizeEventTypes = (raw: unknown): CalendarEventType[] => {
  if (!Array.isArray(raw) || raw.length === 0) return [...ALL_EVENT_TYPES];
  const valid = raw.filter((v): v is CalendarEventType => ALL_EVENT_TYPES.includes(v as CalendarEventType));
  return valid.length > 0 ? valid : [...ALL_EVENT_TYPES];
};

const normalizeStatusFilters = (raw: unknown): AlertStatusFilter[] => {
  if (!Array.isArray(raw) || raw.length === 0) return [...ALL_STATUS_FILTERS];
  const valid = raw.filter((v): v is AlertStatusFilter => ALL_STATUS_FILTERS.includes(v as AlertStatusFilter));
  return valid.length > 0 ? valid : [...ALL_STATUS_FILTERS];
};

const normalizeDisplayMode = (raw: unknown): CalendarDisplayMode => {
  if (raw === "month" || raw === "week") return raw;
  return "month";
};

const normalizeColorScheme = (raw: unknown): CalendarColorScheme => {
  if (raw === "type" || raw === "status" || raw === "company") return raw;
  return "type";
};

const normalizeMaxEventsPerDay = (raw: unknown): number => {
  const num = Math.round(Number(raw) || DEFAULT_MAX_EVENTS_PER_DAY);
  return Math.max(MIN_MAX_EVENTS, Math.min(MAX_MAX_EVENTS, num));
};

const normalizeWeekStartDay = (raw: unknown): number => {
  const num = Number(raw);
  if (Number.isFinite(num) && num >= 0 && num <= 6) return Math.round(num);
  return 0;
};

const normalizeCompanyFilter = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v) => typeof v === "string" && v.trim().length > 0);
};

const normalizeLinkedTableIds = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v) => typeof v === "string" && v.trim().length > 0);
};

const formatTargetLabel = (target: { pageId: string; title: string }) => `[${target.pageId}] ${target.title}`;

export const CALENDAR_BLOCK_DEFINITION: BlockDefinition<"calendar"> = {
  type: "calendar",
  defaultLayout: { colSpan: 60 },
  createDefaultProps: () => ({
    title: "Calendar",
    description: "Track interviews and follow-ups."
  }),
  component: ({ block, mode, patchBlockProps, updateBlockProps, resolveSlot, menuActions }) => {
    const slotContext = createSlotContext(mode, updateBlockProps, patchBlockProps);
    const slot = block.props.contentSlotId ? resolveSlot?.(block.props.contentSlotId, block, slotContext) : null;

    const { applications, settings } = useAppData();

    // ── Config modal state ──
    const [isConfigOpen, setIsConfigOpen] = useState(false);

    // ── Editable table targets (excluding todo tables) ──
    const tableTargets = useMemo(
      () => collectEditableTableTargets(settings, { excludeVariants: ["todo"], excludeTypes: ["todoTable"] }),
      [settings]
    );
    const graph = useMemo(() => buildBlockGraph(settings), [settings]);

    // ── Derived config values ──
    const visibleEventTypes = useMemo(
      () => normalizeEventTypes(block.props.visibleEventTypes),
      [block.props.visibleEventTypes]
    );
    const displayMode = normalizeDisplayMode(block.props.displayMode);
    const colorScheme = normalizeColorScheme(block.props.colorScheme);
    const showDayPanel = block.props.showDayPanel !== false;
    const showEventCount = block.props.showEventCount !== false;
    const showTimeLabels = block.props.showTimeLabels !== false;
    const maxEventsPerDay = normalizeMaxEventsPerDay(block.props.maxEventsPerDay);
    const weekStartDay = normalizeWeekStartDay(block.props.weekStartDay);
    const companyFilter = useMemo(
      () => normalizeCompanyFilter(block.props.companyFilter),
      [block.props.companyFilter]
    );
    const statusFilter = useMemo(
      () => normalizeStatusFilters(block.props.statusFilter),
      [block.props.statusFilter]
    );
    const linkedTableIds = useMemo(
      () => normalizeLinkedTableIds(block.props.linkedTableIds),
      [block.props.linkedTableIds]
    );

    // ── Resolve linked table snapshots ──
    const linkedTableSnapshots = useMemo(
      () => linkedTableIds.map((id) => resolveBlock(graph, id)).filter(Boolean) as Array<{ pageId: string; blockId: string; title: string; type: string }>,
      [linkedTableIds, graph]
    );

    // ── Available companies from applications ──
    const availableCompanies = useMemo(() => {
      const set = new Set<string>();
      (applications || []).forEach((app) => {
        if (app.company_name) set.add(app.company_name);
      });
      return Array.from(set).sort();
    }, [applications]);

    // ── Floating menu state: event types ──
    const [eventTypeFilterOpen, setEventTypeFilterOpen] = useState(false);
    const [eventTypeFilterPos, setEventTypeFilterPos] = useState<{ top: number; left: number } | null>(null);
    const eventTypeFilterTriggerRef = useRef<HTMLButtonElement>(null);
    const eventTypeFilterMenuRef = useRef<HTMLDivElement>(null);

    // ── Floating menu state: status filter ──
    const [statusFilterOpen, setStatusFilterOpen] = useState(false);
    const [statusFilterPos, setStatusFilterPos] = useState<{ top: number; left: number } | null>(null);
    const statusFilterTriggerRef = useRef<HTMLButtonElement>(null);
    const statusFilterMenuRef = useRef<HTMLDivElement>(null);

    // ── Floating menu state: company filter ──
    const [companyFilterOpen, setCompanyFilterOpen] = useState(false);
    const [companyFilterPos, setCompanyFilterPos] = useState<{ top: number; left: number } | null>(null);
    const companyFilterTriggerRef = useRef<HTMLButtonElement>(null);
    const companyFilterMenuRef = useRef<HTMLDivElement>(null);

    // ── Floating menu state: linked tables ──
    const [linkedTablesMenuOpen, setLinkedTablesMenuOpen] = useState(false);
    const [linkedTablesMenuPos, setLinkedTablesMenuPos] = useState<{ top: number; left: number } | null>(null);
    const linkedTablesTriggerRef = useRef<HTMLButtonElement>(null);
    const linkedTablesMenuRef = useRef<HTMLDivElement>(null);

    // ── Cleanup menus on config close ──
    useEffect(() => {
      if (!isConfigOpen) {
        setEventTypeFilterOpen(false);
        setEventTypeFilterPos(null);
        setStatusFilterOpen(false);
        setStatusFilterPos(null);
        setCompanyFilterOpen(false);
        setCompanyFilterPos(null);
        setLinkedTablesMenuOpen(false);
        setLinkedTablesMenuPos(null);
      }
    }, [isConfigOpen]);

    // ── Event type filter floating menu positioning ──
    useEffect(() => {
      if (!eventTypeFilterOpen || !eventTypeFilterTriggerRef.current) return;
      const MENU_WIDTH = 260;
      const updatePosition = () => {
        if (!eventTypeFilterTriggerRef.current) return;
        const rect = eventTypeFilterTriggerRef.current.getBoundingClientRect();
        const menuHeight = eventTypeFilterMenuRef.current?.offsetHeight || 200;
        const menuWidth = Math.min(MENU_WIDTH, window.innerWidth - FLOATING_MENU_GUTTER * 2);
        const maxLeft = Math.max(FLOATING_MENU_GUTTER, window.innerWidth - menuWidth - FLOATING_MENU_GUTTER);
        const left = Math.min(Math.max(rect.left, FLOATING_MENU_GUTTER), maxLeft);
        const spaceBelow = window.innerHeight - rect.bottom;
        const shouldFlip = spaceBelow < menuHeight + FLOATING_MENU_OFFSET && rect.top > spaceBelow;
        const rawTop = shouldFlip ? rect.top - menuHeight - FLOATING_MENU_OFFSET : rect.bottom + FLOATING_MENU_OFFSET;
        const maxTop = Math.max(FLOATING_MENU_GUTTER, window.innerHeight - menuHeight - FLOATING_MENU_GUTTER);
        const top = Math.min(Math.max(rawTop, FLOATING_MENU_GUTTER), maxTop);
        setEventTypeFilterPos({ top, left });
      };
      const handleOutside = (event: MouseEvent) => {
        const target = event.target as Node;
        if (eventTypeFilterMenuRef.current?.contains(target) || eventTypeFilterTriggerRef.current?.contains(target)) return;
        setEventTypeFilterOpen(false);
      };
      updatePosition();
      document.addEventListener("mousedown", handleOutside);
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
      return () => {
        document.removeEventListener("mousedown", handleOutside);
        window.removeEventListener("scroll", updatePosition, true);
        window.removeEventListener("resize", updatePosition);
      };
    }, [eventTypeFilterOpen]);

    // ── Status filter floating menu positioning ──
    useEffect(() => {
      if (!statusFilterOpen || !statusFilterTriggerRef.current) return;
      const MENU_WIDTH = 220;
      const updatePosition = () => {
        if (!statusFilterTriggerRef.current) return;
        const rect = statusFilterTriggerRef.current.getBoundingClientRect();
        const menuHeight = statusFilterMenuRef.current?.offsetHeight || 180;
        const menuWidth = Math.min(MENU_WIDTH, window.innerWidth - FLOATING_MENU_GUTTER * 2);
        const maxLeft = Math.max(FLOATING_MENU_GUTTER, window.innerWidth - menuWidth - FLOATING_MENU_GUTTER);
        const left = Math.min(Math.max(rect.left, FLOATING_MENU_GUTTER), maxLeft);
        const spaceBelow = window.innerHeight - rect.bottom;
        const shouldFlip = spaceBelow < menuHeight + FLOATING_MENU_OFFSET && rect.top > spaceBelow;
        const rawTop = shouldFlip ? rect.top - menuHeight - FLOATING_MENU_OFFSET : rect.bottom + FLOATING_MENU_OFFSET;
        const maxTop = Math.max(FLOATING_MENU_GUTTER, window.innerHeight - menuHeight - FLOATING_MENU_GUTTER);
        const top = Math.min(Math.max(rawTop, FLOATING_MENU_GUTTER), maxTop);
        setStatusFilterPos({ top, left });
      };
      const handleOutside = (event: MouseEvent) => {
        const target = event.target as Node;
        if (statusFilterMenuRef.current?.contains(target) || statusFilterTriggerRef.current?.contains(target)) return;
        setStatusFilterOpen(false);
      };
      updatePosition();
      document.addEventListener("mousedown", handleOutside);
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
      return () => {
        document.removeEventListener("mousedown", handleOutside);
        window.removeEventListener("scroll", updatePosition, true);
        window.removeEventListener("resize", updatePosition);
      };
    }, [statusFilterOpen]);

    // ── Company filter floating menu positioning ──
    useEffect(() => {
      if (!companyFilterOpen || !companyFilterTriggerRef.current) return;
      const MENU_WIDTH = 300;
      const updatePosition = () => {
        if (!companyFilterTriggerRef.current) return;
        const rect = companyFilterTriggerRef.current.getBoundingClientRect();
        const menuHeight = companyFilterMenuRef.current?.offsetHeight || 240;
        const menuWidth = Math.min(MENU_WIDTH, window.innerWidth - FLOATING_MENU_GUTTER * 2);
        const maxLeft = Math.max(FLOATING_MENU_GUTTER, window.innerWidth - menuWidth - FLOATING_MENU_GUTTER);
        const left = Math.min(Math.max(rect.left, FLOATING_MENU_GUTTER), maxLeft);
        const spaceBelow = window.innerHeight - rect.bottom;
        const shouldFlip = spaceBelow < menuHeight + FLOATING_MENU_OFFSET && rect.top > spaceBelow;
        const rawTop = shouldFlip ? rect.top - menuHeight - FLOATING_MENU_OFFSET : rect.bottom + FLOATING_MENU_OFFSET;
        const maxTop = Math.max(FLOATING_MENU_GUTTER, window.innerHeight - menuHeight - FLOATING_MENU_GUTTER);
        const top = Math.min(Math.max(rawTop, FLOATING_MENU_GUTTER), maxTop);
        setCompanyFilterPos({ top, left });
      };
      const handleOutside = (event: MouseEvent) => {
        const target = event.target as Node;
        if (companyFilterMenuRef.current?.contains(target) || companyFilterTriggerRef.current?.contains(target)) return;
        setCompanyFilterOpen(false);
      };
      updatePosition();
      document.addEventListener("mousedown", handleOutside);
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
      return () => {
        document.removeEventListener("mousedown", handleOutside);
        window.removeEventListener("scroll", updatePosition, true);
        window.removeEventListener("resize", updatePosition);
      };
    }, [companyFilterOpen]);

    // ── Linked tables floating menu positioning ──
    useEffect(() => {
      if (!linkedTablesMenuOpen || !linkedTablesTriggerRef.current) return;
      const MENU_WIDTH = 360;
      const updatePosition = () => {
        if (!linkedTablesTriggerRef.current) return;
        const rect = linkedTablesTriggerRef.current.getBoundingClientRect();
        const menuHeight = linkedTablesMenuRef.current?.offsetHeight || 280;
        const menuWidth = Math.min(MENU_WIDTH, window.innerWidth - FLOATING_MENU_GUTTER * 2);
        const maxLeft = Math.max(FLOATING_MENU_GUTTER, window.innerWidth - menuWidth - FLOATING_MENU_GUTTER);
        const left = Math.min(Math.max(rect.left, FLOATING_MENU_GUTTER), maxLeft);
        const spaceBelow = window.innerHeight - rect.bottom;
        const shouldFlip = spaceBelow < menuHeight + FLOATING_MENU_OFFSET && rect.top > spaceBelow;
        const rawTop = shouldFlip ? rect.top - menuHeight - FLOATING_MENU_OFFSET : rect.bottom + FLOATING_MENU_OFFSET;
        const maxTop = Math.max(FLOATING_MENU_GUTTER, window.innerHeight - menuHeight - FLOATING_MENU_GUTTER);
        const top = Math.min(Math.max(rawTop, FLOATING_MENU_GUTTER), maxTop);
        setLinkedTablesMenuPos({ top, left });
      };
      const handleOutside = (event: MouseEvent) => {
        const target = event.target as Node;
        if (linkedTablesMenuRef.current?.contains(target) || linkedTablesTriggerRef.current?.contains(target)) return;
        setLinkedTablesMenuOpen(false);
      };
      updatePosition();
      document.addEventListener("mousedown", handleOutside);
      window.addEventListener("scroll", updatePosition, true);
      window.addEventListener("resize", updatePosition);
      return () => {
        document.removeEventListener("mousedown", handleOutside);
        window.removeEventListener("scroll", updatePosition, true);
        window.removeEventListener("resize", updatePosition);
      };
    }, [linkedTablesMenuOpen]);

    // ── Toggle helpers ──
    const toggleEventType = useCallback(
      (eventType: CalendarEventType) => {
        const next = visibleEventTypes.includes(eventType)
          ? visibleEventTypes.filter((t) => t !== eventType)
          : [...visibleEventTypes, eventType];
        patchBlockProps({ visibleEventTypes: next.length > 0 && next.length < ALL_EVENT_TYPES.length ? next : undefined });
      },
      [visibleEventTypes, patchBlockProps]
    );

    const toggleStatus = useCallback(
      (status: AlertStatusFilter) => {
        const next = statusFilter.includes(status)
          ? statusFilter.filter((s) => s !== status)
          : [...statusFilter, status];
        patchBlockProps({ statusFilter: next.length > 0 && next.length < ALL_STATUS_FILTERS.length ? next : undefined });
      },
      [statusFilter, patchBlockProps]
    );

    const toggleCompany = useCallback(
      (company: string) => {
        const next = companyFilter.includes(company)
          ? companyFilter.filter((c) => c !== company)
          : [...companyFilter, company];
        patchBlockProps({ companyFilter: next.length > 0 ? next : undefined });
      },
      [companyFilter, patchBlockProps]
    );

    const toggleLinkedTable = useCallback(
      (blockId: string) => {
        const next = linkedTableIds.includes(blockId)
          ? linkedTableIds.filter((id) => id !== blockId)
          : [...linkedTableIds, blockId];
        patchBlockProps({ linkedTableIds: next.length > 0 ? next : undefined });
      },
      [linkedTableIds, patchBlockProps]
    );

    // ── Summary labels ──
    const eventTypesSummary = visibleEventTypes.length === ALL_EVENT_TYPES.length
      ? "Todos los tipos"
      : visibleEventTypes.length === 1
        ? EVENT_TYPE_LABELS[visibleEventTypes[0]]
        : `${EVENT_TYPE_LABELS[visibleEventTypes[0]]} +${visibleEventTypes.length - 1}`;

    const statusSummary = statusFilter.length === ALL_STATUS_FILTERS.length
      ? "Todos los estados"
      : statusFilter.length === 1
        ? STATUS_FILTER_LABELS[statusFilter[0]]
        : `${STATUS_FILTER_LABELS[statusFilter[0]]} +${statusFilter.length - 1}`;

    const companySummary = companyFilter.length === 0
      ? "Todas las empresas"
      : companyFilter.length === 1
        ? companyFilter[0]
        : `${companyFilter[0]} +${companyFilter.length - 1}`;

    const linkedTablesSummary = linkedTableIds.length === 0
      ? "Sin vincular"
      : linkedTableSnapshots.length === 1
        ? formatTargetLabel(linkedTableSnapshots[0])
        : `${linkedTableSnapshots.length} tablas vinculadas`;

    // ── Menu actions ──
    const blockMenuActions = mode === "edit"
      ? [
          {
            key: `calendar-config-${block.id}`,
            label: "Configurar calendario",
            onClick: () => setIsConfigOpen(true)
          },
          ...(menuActions || [])
        ]
      : menuActions;

    return (
      <>
        <BlockPanel id={block.id} as="section" menuActions={blockMenuActions}>
          {renderHeader(
            block.id,
            mode,
            block.props.title || "",
            block.props.description || "",
            (patch) => patchBlockProps(patch)
          )}
          {slot || <div className="empty">Calendar content is not connected yet.</div>}
        </BlockPanel>

        {/* ── Configuration Modal ── */}
        {isConfigOpen &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              className="modal-backdrop"
              role="dialog"
              aria-modal="true"
              onClick={() => setIsConfigOpen(false)}
            >
              <div className="modal block-config-modal" onClick={(event) => event.stopPropagation()}>
                <header className="modal-header">
                  <div>
                    <h2>Configurar calendario</h2>
                    <p>Define qué eventos mostrar, cómo visualizarlos y qué filtros aplicar.</p>
                  </div>
                  <button className="ghost" type="button" onClick={() => setIsConfigOpen(false)} aria-label="Close">
                    ×
                  </button>
                </header>

                <div className="block-config-layout calendar-config-layout">
                  <div className="block-config-main">
                    {/* ── Vinculación ── */}
                    <section className="block-config-section">
                      <div className="block-config-section-head">
                        <div>
                          <h3>Vinculación</h3>
                          <p>Conecta el calendario con una o varias tablas editables para alimentar los eventos.</p>
                        </div>
                      </div>

                      <div className="block-config-grid">
                        <div className="field full">
                          <span className="block-field-label">Tablas editables vinculadas</span>
                          <p className="block-field-hint">
                            Selecciona las tablas editables de las que el calendario obtendrá datos.
                            Las tablas de tipo To-Do no aparecen porque están conectadas a su tabla editable padre.
                          </p>
                          <div className="informational-table-columns-control">
                            <button
                              ref={linkedTablesTriggerRef}
                              type="button"
                              className={`select-trigger informational-table-columns-trigger ${linkedTablesMenuOpen ? "open" : ""}`}
                              onClick={() => setLinkedTablesMenuOpen((c) => !c)}
                              disabled={tableTargets.length === 0}
                              aria-haspopup="listbox"
                              aria-expanded={linkedTablesMenuOpen}
                            >
                              <span className="select-pill">{linkedTablesSummary}</span>
                              <span className="select-caret">▾</span>
                            </button>
                            {linkedTableIds.length > 0 ? (
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => patchBlockProps({ linkedTableIds: undefined })}
                              >
                                Desvincular todas
                              </button>
                            ) : null}
                          </div>
                          {tableTargets.length === 0 ? (
                            <p className="block-field-hint">No hay tablas editables disponibles en el workspace.</p>
                          ) : null}
                          {linkedTableSnapshots.length > 0 ? (
                            <div className="calendar-linked-tables-list">
                              {linkedTableSnapshots.map((snap) => (
                                <span key={snap.blockId} className="calendar-linked-table-tag">
                                  {formatTargetLabel(snap)}
                                  <button
                                    type="button"
                                    className="calendar-linked-table-tag-remove"
                                    onClick={() => toggleLinkedTable(snap.blockId)}
                                    aria-label={`Desvincular ${snap.title}`}
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </section>

                    {/* ── Visualización ── */}
                    <section className="block-config-section">
                      <div className="block-config-section-head">
                        <div>
                          <h3>Visualización</h3>
                          <p>Controla cómo se presenta el calendario y sus eventos.</p>
                        </div>
                      </div>

                      <div className="block-config-grid">
                        <div className="field">
                          <label htmlFor={`${block.id}-calendar-display-mode`}>Vista</label>
                          <select
                            id={`${block.id}-calendar-display-mode`}
                            value={displayMode}
                            onChange={(event) =>
                              patchBlockProps({ displayMode: (event.target.value as CalendarDisplayMode) || undefined })
                            }
                          >
                            {(Object.keys(DISPLAY_MODE_LABELS) as CalendarDisplayMode[]).map((key) => (
                              <option key={key} value={key}>
                                {DISPLAY_MODE_LABELS[key]}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="field">
                          <label htmlFor={`${block.id}-calendar-color-scheme`}>Color de eventos</label>
                          <select
                            id={`${block.id}-calendar-color-scheme`}
                            value={colorScheme}
                            onChange={(event) =>
                              patchBlockProps({ colorScheme: (event.target.value as CalendarColorScheme) || undefined })
                            }
                          >
                            {(Object.keys(COLOR_SCHEME_LABELS) as CalendarColorScheme[]).map((key) => (
                              <option key={key} value={key}>
                                {COLOR_SCHEME_LABELS[key]}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="field">
                          <label htmlFor={`${block.id}-calendar-week-start`}>Inicio de semana</label>
                          <select
                            id={`${block.id}-calendar-week-start`}
                            value={weekStartDay}
                            onChange={(event) =>
                              patchBlockProps({ weekStartDay: Number(event.target.value) || undefined })
                            }
                          >
                            {WEEKDAY_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="field">
                          <label htmlFor={`${block.id}-calendar-max-events`}>Eventos por celda</label>
                          <input
                            id={`${block.id}-calendar-max-events`}
                            type="number"
                            min={MIN_MAX_EVENTS}
                            max={MAX_MAX_EVENTS}
                            value={maxEventsPerDay}
                            onChange={(event) =>
                              patchBlockProps({ maxEventsPerDay: normalizeMaxEventsPerDay(event.target.value) })
                            }
                          />
                          <p className="block-field-hint">Eventos visibles en cada celda antes de mostrar "+N más".</p>
                        </div>
                      </div>
                    </section>

                    {/* ── Opciones de presentación ── */}
                    <section className="block-config-section">
                      <div className="block-config-section-head">
                        <div>
                          <h3>Opciones de presentación</h3>
                          <p>Activa o desactiva elementos visuales del calendario.</p>
                        </div>
                      </div>

                      <div className="calendar-config-toggles">
                        <button
                          type="button"
                          className={`block-inline-toggle ${showDayPanel ? "active" : ""}`}
                          onClick={() => patchBlockProps({ showDayPanel: !showDayPanel })}
                        >
                          Panel de día
                        </button>
                        <button
                          type="button"
                          className={`block-inline-toggle ${showEventCount ? "active" : ""}`}
                          onClick={() => patchBlockProps({ showEventCount: !showEventCount })}
                        >
                          Contador de eventos
                        </button>
                        <button
                          type="button"
                          className={`block-inline-toggle ${showTimeLabels ? "active" : ""}`}
                          onClick={() => patchBlockProps({ showTimeLabels: !showTimeLabels })}
                        >
                          Hora en eventos
                        </button>
                      </div>
                    </section>

                    {/* ── Filtros ── */}
                    <section className="block-config-section">
                      <div className="block-config-section-head">
                        <div>
                          <h3>Filtros</h3>
                          <p>Filtra qué eventos se muestran en el calendario.</p>
                        </div>
                      </div>

                      <div className="block-config-grid">
                        <div className="field">
                          <span className="block-field-label">Tipos de evento</span>
                          <p className="block-field-hint">Selecciona qué tipos de evento mostrar.</p>
                          <div className="informational-table-columns-control">
                            <button
                              ref={eventTypeFilterTriggerRef}
                              type="button"
                              className={`select-trigger informational-table-columns-trigger ${eventTypeFilterOpen ? "open" : ""}`}
                              onClick={() => setEventTypeFilterOpen((c) => !c)}
                              aria-haspopup="listbox"
                              aria-expanded={eventTypeFilterOpen}
                            >
                              <span className="select-pill">{eventTypesSummary}</span>
                              <span className="select-caret">▾</span>
                            </button>
                          </div>
                        </div>

                        <div className="field">
                          <span className="block-field-label">Estados visibles</span>
                          <p className="block-field-hint">Filtra por estado de la alerta.</p>
                          <div className="informational-table-columns-control">
                            <button
                              ref={statusFilterTriggerRef}
                              type="button"
                              className={`select-trigger informational-table-columns-trigger ${statusFilterOpen ? "open" : ""}`}
                              onClick={() => setStatusFilterOpen((c) => !c)}
                              aria-haspopup="listbox"
                              aria-expanded={statusFilterOpen}
                            >
                              <span className="select-pill">{statusSummary}</span>
                              <span className="select-caret">▾</span>
                            </button>
                          </div>
                        </div>

                        <div className="field">
                          <span className="block-field-label">Empresa</span>
                          <p className="block-field-hint">Filtra eventos por empresa.</p>
                          <div className="informational-table-columns-control">
                            <button
                              ref={companyFilterTriggerRef}
                              type="button"
                              className={`select-trigger informational-table-columns-trigger ${companyFilterOpen ? "open" : ""}`}
                              onClick={() => setCompanyFilterOpen((c) => !c)}
                              disabled={availableCompanies.length === 0}
                              aria-haspopup="listbox"
                              aria-expanded={companyFilterOpen}
                            >
                              <span className="select-pill">{companySummary}</span>
                              <span className="select-caret">▾</span>
                            </button>
                          </div>
                          {availableCompanies.length === 0 ? (
                            <p className="block-field-hint">No hay empresas disponibles.</p>
                          ) : null}
                        </div>
                      </div>
                    </section>
                  </div>

                  {/* ── Sidebar: estado actual ── */}
                  <aside className="block-config-sidebar">
                    <section className="block-config-sidebar-card calendar-config-status-card">
                      <div className="block-config-section-head compact">
                        <div>
                          <h3>Estado actual</h3>
                          <p>Resumen rápido de la configuración activa del calendario.</p>
                        </div>
                      </div>
                      <div className="calendar-config-status-list">
                        <div className="calendar-config-status-item">
                          <span>Tablas vinculadas</span>
                          <strong>
                            {linkedTableIds.length === 0
                              ? "Ninguna"
                              : linkedTableSnapshots.map((s) => s.title).join(", ")}
                          </strong>
                        </div>
                        <div className="calendar-config-status-item">
                          <span>Vista</span>
                          <strong>{DISPLAY_MODE_LABELS[displayMode]}</strong>
                        </div>
                        <div className="calendar-config-status-item">
                          <span>Color</span>
                          <strong>{COLOR_SCHEME_LABELS[colorScheme]}</strong>
                        </div>
                        <div className="calendar-config-status-item">
                          <span>Inicio semana</span>
                          <strong>{WEEKDAY_OPTIONS.find((o) => o.value === weekStartDay)?.label || "Lunes"}</strong>
                        </div>
                        <div className="calendar-config-status-item">
                          <span>Eventos/celda</span>
                          <strong>{maxEventsPerDay}</strong>
                        </div>
                        <div className="calendar-config-status-item">
                          <span>Tipos de evento</span>
                          <strong>
                            {visibleEventTypes.length === ALL_EVENT_TYPES.length
                              ? "Todos"
                              : visibleEventTypes.map((t) => EVENT_TYPE_LABELS[t]).join(", ")}
                          </strong>
                        </div>
                        <div className="calendar-config-status-item">
                          <span>Estados</span>
                          <strong>
                            {statusFilter.length === ALL_STATUS_FILTERS.length
                              ? "Todos"
                              : statusFilter.map((s) => STATUS_FILTER_LABELS[s]).join(", ")}
                          </strong>
                        </div>
                        <div className="calendar-config-status-item">
                          <span>Empresa</span>
                          <strong>{companyFilter.length === 0 ? "Todas" : companyFilter.join(", ")}</strong>
                        </div>
                        <div className="calendar-config-status-item">
                          <span>Panel de día</span>
                          <strong>{showDayPanel ? "Sí" : "No"}</strong>
                        </div>
                        <div className="calendar-config-status-item">
                          <span>Contador</span>
                          <strong>{showEventCount ? "Sí" : "No"}</strong>
                        </div>
                        <div className="calendar-config-status-item">
                          <span>Hora en eventos</span>
                          <strong>{showTimeLabels ? "Sí" : "No"}</strong>
                        </div>
                      </div>
                    </section>

                    <section className="block-config-sidebar-card">
                      <div className="block-config-section-head compact">
                        <div>
                          <h3>Acciones rápidas</h3>
                        </div>
                      </div>
                      <div className="calendar-config-quick-actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() =>
                            patchBlockProps({
                              linkedTableIds: undefined,
                              visibleEventTypes: undefined,
                              statusFilter: undefined,
                              companyFilter: undefined,
                              displayMode: undefined,
                              colorScheme: undefined,
                              showDayPanel: undefined,
                              showEventCount: undefined,
                              showTimeLabels: undefined,
                              maxEventsPerDay: undefined,
                              weekStartDay: undefined
                            })
                          }
                        >
                          Restablecer configuración
                        </button>
                      </div>
                    </section>
                  </aside>
                </div>
              </div>
            </div>,
            document.body
          )}

        {/* ── Floating Menu: Event Types ── */}
        {eventTypeFilterOpen &&
          eventTypeFilterPos &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              ref={eventTypeFilterMenuRef}
              className="select-menu informational-email-filter-menu"
              style={{
                position: "fixed",
                top: eventTypeFilterPos.top,
                left: eventTypeFilterPos.left,
                width:
                  typeof window !== "undefined"
                    ? Math.min(280, window.innerWidth - FLOATING_MENU_GUTTER * 2)
                    : 280,
                zIndex: 80
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div
                className="select-options informational-email-filter-list"
                role="listbox"
                aria-label="Tipos de evento"
                aria-multiselectable="true"
              >
                {ALL_EVENT_TYPES.map((et) => {
                  const checked = visibleEventTypes.includes(et);
                  return (
                    <button
                      type="button"
                      key={`${block.id}-event-type-option-${et}`}
                      className={`select-option${checked ? " selected" : ""}`}
                      onClick={() => toggleEventType(et)}
                    >
                      <span className="select-label">{EVENT_TYPE_LABELS[et]}</span>
                      <span className="select-check">{checked ? "✓" : ""}</span>
                    </button>
                  );
                })}
                <div className="column-menu-separator" />
                <button
                  type="button"
                  className="select-option"
                  onClick={() => {
                    patchBlockProps({ visibleEventTypes: undefined });
                    setEventTypeFilterOpen(false);
                  }}
                  disabled={visibleEventTypes.length >= ALL_EVENT_TYPES.length}
                >
                  <span className="select-label">Seleccionar todos</span>
                </button>
              </div>
            </div>,
            document.body
          )}

        {/* ── Floating Menu: Status Filter ── */}
        {statusFilterOpen &&
          statusFilterPos &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              ref={statusFilterMenuRef}
              className="select-menu informational-email-filter-menu"
              style={{
                position: "fixed",
                top: statusFilterPos.top,
                left: statusFilterPos.left,
                width:
                  typeof window !== "undefined"
                    ? Math.min(240, window.innerWidth - FLOATING_MENU_GUTTER * 2)
                    : 240,
                zIndex: 80
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div
                className="select-options informational-email-filter-list"
                role="listbox"
                aria-label="Estados visibles"
                aria-multiselectable="true"
              >
                {ALL_STATUS_FILTERS.map((st) => {
                  const checked = statusFilter.includes(st);
                  return (
                    <button
                      type="button"
                      key={`${block.id}-status-option-${st}`}
                      className={`select-option${checked ? " selected" : ""}`}
                      onClick={() => toggleStatus(st)}
                    >
                      <span className="select-label"><span className={`tag tag-${st}`}>{STATUS_FILTER_LABELS[st]}</span></span>
                      <span className="select-check">{checked ? "✓" : ""}</span>
                    </button>
                  );
                })}
                <div className="column-menu-separator" />
                <button
                  type="button"
                  className="select-option"
                  onClick={() => {
                    patchBlockProps({ statusFilter: undefined });
                    setStatusFilterOpen(false);
                  }}
                  disabled={statusFilter.length >= ALL_STATUS_FILTERS.length}
                >
                  <span className="select-label">Seleccionar todos</span>
                </button>
              </div>
            </div>,
            document.body
          )}

        {/* ── Floating Menu: Company Filter ── */}
        {companyFilterOpen &&
          companyFilterPos &&
          availableCompanies.length > 0 &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              ref={companyFilterMenuRef}
              className="select-menu informational-email-filter-menu"
              style={{
                position: "fixed",
                top: companyFilterPos.top,
                left: companyFilterPos.left,
                width:
                  typeof window !== "undefined"
                    ? Math.min(320, window.innerWidth - FLOATING_MENU_GUTTER * 2)
                    : 320,
                zIndex: 80
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div
                className="select-options informational-email-filter-list"
                role="listbox"
                aria-label="Filtro por empresa"
                aria-multiselectable="true"
              >
                {availableCompanies.map((company) => {
                  const checked = companyFilter.includes(company);
                  return (
                    <button
                      type="button"
                      key={`${block.id}-company-option-${company}`}
                      className={`select-option${checked ? " selected" : ""}`}
                      onClick={() => toggleCompany(company)}
                    >
                      <span className="select-label">{company}</span>
                      <span className="select-check">{checked ? "✓" : ""}</span>
                    </button>
                  );
                })}
                <div className="column-menu-separator" />
                <button
                  type="button"
                  className="select-option"
                  onClick={() => {
                    patchBlockProps({ companyFilter: undefined });
                    setCompanyFilterOpen(false);
                  }}
                  disabled={companyFilter.length === 0}
                >
                  <span className="select-label">Mostrar todas</span>
                </button>
              </div>
            </div>,
            document.body
          )}

        {/* ── Floating Menu: Linked Tables ── */}
        {linkedTablesMenuOpen &&
          linkedTablesMenuPos &&
          tableTargets.length > 0 &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              ref={linkedTablesMenuRef}
              className="select-menu informational-email-filter-menu"
              style={{
                position: "fixed",
                top: linkedTablesMenuPos.top,
                left: linkedTablesMenuPos.left,
                width:
                  typeof window !== "undefined"
                    ? Math.min(380, window.innerWidth - FLOATING_MENU_GUTTER * 2)
                    : 380,
                zIndex: 80
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div
                className="select-options informational-email-filter-list"
                role="listbox"
                aria-label="Tablas editables"
                aria-multiselectable="true"
              >
                {tableTargets.map((target) => {
                  const checked = linkedTableIds.includes(target.blockId);
                  return (
                    <button
                      type="button"
                      key={`${block.id}-linked-table-option-${target.blockId}`}
                      className={`select-option${checked ? " selected" : ""}`}
                      onClick={() => toggleLinkedTable(target.blockId)}
                    >
                      <span className="select-label">{formatTargetLabel(target)}</span>
                      <span className="select-check">{checked ? "✓" : ""}</span>
                    </button>
                  );
                })}
                <div className="column-menu-separator" />
                <button
                  type="button"
                  className="select-option"
                  onClick={() => {
                    patchBlockProps({ linkedTableIds: undefined });
                    setLinkedTablesMenuOpen(false);
                  }}
                  disabled={linkedTableIds.length === 0}
                >
                  <span className="select-label">Desvincular todas</span>
                </button>
              </div>
            </div>,
            document.body
          )}
      </>
    );
  }
};
