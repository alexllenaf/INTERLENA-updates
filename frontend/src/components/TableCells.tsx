import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { buildHighlightChunks } from "../features/tracker/highlight";
import { formatDateDisplay, formatDateOnlyDisplay, toDateInputValue, toDateTimeLocalValue } from "../utils";

type TextCellProps = {
  value?: string | null;
  placeholder?: string;
  highlightQuery?: string;
  readOnly?: boolean;
  onCommit: (next: string) => void;
};

export const TextCell: React.FC<TextCellProps> = ({
  value,
  placeholder,
  highlightQuery = "",
  readOnly = false,
  onCommit
}) => {
  const [draft, setDraft] = useState(value ?? "");
  const [dirty, setDirty] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    setDraft(value ?? "");
    setDirty(false);
  }, [value]);

  const commit = () => {
    if (readOnly) return;
    if (!dirty) return;
    const next = draft;
    if (next === (value ?? "")) {
      setDirty(false);
      return;
    }
    onCommit(next);
    setDirty(false);
  };

  const chunks = buildHighlightChunks(draft, highlightQuery);
  const hasMatch = chunks.some((chunk) => chunk.match);

  return (
    <div className="cell-input-wrap">
      {!isFocused && highlightQuery.trim() && hasMatch ? (
        <div className="cell-input-highlight">
          {chunks.map((chunk, index) =>
            chunk.match ? (
              <mark key={`${chunk.text}-${index}`}>{chunk.text}</mark>
            ) : (
              <span key={`${chunk.text}-${index}`}>{chunk.text}</span>
            )
          )}
        </div>
      ) : null}
      <input
        className={`cell-input ${!isFocused && hasMatch ? "cell-input-transparent" : ""}`}
        value={draft}
        onChange={(event) => {
          if (readOnly) return;
          setDraft(event.target.value);
          setDirty(true);
        }}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          if (readOnly) return;
          commit();
        }}
        onKeyDown={(event) => {
          if (readOnly) return;
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            setDraft(value ?? "");
            setDirty(false);
          }
        }}
        placeholder={placeholder}
        readOnly={readOnly}
      />
    </div>
  );
};

type TextAreaCellProps = {
  value?: string | null;
  placeholder?: string;
  rows?: number;
  readOnly?: boolean;
  onCommit: (next: string) => void;
};

export const TextAreaCell: React.FC<TextAreaCellProps> = ({
  value,
  placeholder,
  rows = 3,
  readOnly = false,
  onCommit
}) => {
  const [draft, setDraft] = useState(value ?? "");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(value ?? "");
    setDirty(false);
  }, [value]);

  const commit = () => {
    if (readOnly) return;
    if (!dirty) return;
    const next = draft;
    if (next === (value ?? "")) {
      setDirty(false);
      return;
    }
    onCommit(next);
    setDirty(false);
  };

  return (
    <textarea
      className="cell-textarea"
      value={draft}
      rows={rows}
      style={{ margin: 0, height: `${Math.max(rows, 1) * 22}px`, width: "100%" }}
      onChange={(event) => {
        if (readOnly) return;
        setDraft(event.target.value);
        setDirty(true);
      }}
      onBlur={() => {
        if (readOnly) return;
        commit();
      }}
      onKeyDown={(event) => {
        if (readOnly) return;
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(value ?? "");
          setDirty(false);
        }
      }}
      placeholder={placeholder}
      readOnly={readOnly}
    />
  );
};

type DateCellProps = {
  value?: string | null;
  onCommit: (next: string) => void;
};

type DatePopoverProps = {
  value?: string | null;
  allowTime: boolean;
  canEdit: boolean;
  onCommit: (next: string) => void;
  inputClassName: string;
};

type DateValueDisplayProps = {
  value?: string | null;
  allowTime: boolean;
  className?: string;
};

const DATE_WEEKDAYS = ["do", "lu", "ma", "mi", "ju", "vi", "sa"];

const parseDateParts = (value?: string | null) => {
  if (!value) return null;
  const normalized = toDateInputValue(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map((part) => Number(part));
  if (!year || !month || !day) return null;
  return { year, month, day };
};

const formatDateInput = (value?: string | null) => toDateInputValue(value);

const formatDateTimeInput = (value?: string | null) => toDateTimeLocalValue(value);

const resolveDateDisplayValue = (value: string | null | undefined, allowTime: boolean) =>
  allowTime ? formatDateDisplay(value) : formatDateOnlyDisplay(value);

export const DateValueDisplay: React.FC<DateValueDisplayProps> = ({ value, allowTime, className }) => {
  const displayValue = resolveDateDisplayValue(value, allowTime);
  const isEmpty = displayValue === "—";

  return (
    <span className={[className, "cell-date-display", isEmpty ? "cell-date-placeholder" : ""].filter(Boolean).join(" ")}>
      {displayValue}
    </span>
  );
};

const buildMonthGrid = (year: number, monthIndex: number) => {
  const first = new Date(year, monthIndex, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, monthIndex, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, idx) => {
    const dayOffset = idx - startDay + 1;
    const inMonth = dayOffset >= 1 && dayOffset <= daysInMonth;
    const day = inMonth
      ? dayOffset
      : dayOffset < 1
        ? daysInPrevMonth + dayOffset
        : dayOffset - daysInMonth;
    const monthShift = inMonth ? 0 : dayOffset < 1 ? -1 : 1;
    const date = new Date(year, monthIndex + monthShift, day);
    return { date, inMonth };
  });
  return cells;
};

const DatePopover: React.FC<DatePopoverProps> = ({
  value,
  allowTime,
  canEdit,
  onCommit,
  inputClassName
}) => {
  const [open, setOpen] = useState(false);
  const [showTime, setShowTime] = useState(allowTime);
  const [showEndDate, setShowEndDate] = useState(false);
  const [dateFormat, setDateFormat] = useState("Fecha completa");
  const [timeFormat, setTimeFormat] = useState("24 horas");
  const [timezone, setTimezone] = useState("Local");
  const [reminder, setReminder] = useState("Ninguno");
  const [draftDate, setDraftDate] = useState(formatDateInput(value));
  const [draftTime, setDraftTime] = useState("00:00");
  const [draftEndDate, setDraftEndDate] = useState("");
  const [draftEndTime, setDraftEndTime] = useState("00:00");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const displayValue = resolveDateDisplayValue(value, allowTime);
  const isEmpty = displayValue === "—";

  useEffect(() => {
    setDraftDate(formatDateInput(value));
    if (allowTime) {
      const raw = formatDateTimeInput(value);
      const timePart = raw.split("T")[1] || "00:00";
      setDraftTime(timePart);
      setDraftEndTime(timePart);
    }
  }, [allowTime, value]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (triggerRef.current && target && triggerRef.current.contains(target)) return;
      if (popoverRef.current && target && popoverRef.current.contains(target)) return;
      setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const estimatedWidth = 300;
    const estimatedHeight = 430;
    let left = rect.left;
    let top = rect.bottom + 8;
    if (left + estimatedWidth > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - estimatedWidth - 12);
    }
    if (top + estimatedHeight > window.innerHeight - 12) {
      top = Math.max(12, rect.top - estimatedHeight - 8);
    }
    setPopoverPos({ top, left });
  }, [open]);

  const currentMonth = useMemo(() => {
    const parsed = parseDateParts(draftDate || value || "");
    return parsed ? new Date(parsed.year, parsed.month - 1, 1) : new Date();
  }, [draftDate, value]);

  const monthCells = useMemo(
    () => buildMonthGrid(currentMonth.getFullYear(), currentMonth.getMonth()),
    [currentMonth]
  );

  const commitValue = (nextDate: string, nextTime: string = draftTime, nextShowTime = showTime) => {
    if (!canEdit) return;
    const next = allowTime
      ? nextDate
        ? `${nextDate}T${nextShowTime ? nextTime || "00:00" : "00:00"}`
        : ""
      : nextDate;
    const current = allowTime ? formatDateTimeInput(value) : formatDateInput(value);
    if (next === (current || "")) return;
    onCommit(next);
  };

  const commitIfChanged = () => {
    commitValue(draftDate || "");
  };

  const showRangeInputs = allowTime && showTime && showEndDate;

  return (
    <div className="date-popover-anchor">
      <button
        ref={triggerRef}
        type="button"
        className={[inputClassName, "cell-date-display", "cell-date-trigger", isEmpty ? "cell-date-placeholder" : ""]
          .filter(Boolean)
          .join(" ")}
        onClick={() => {
          if (!canEdit) return;
          setOpen(true);
        }}
        disabled={!canEdit}
        aria-haspopup={canEdit ? "dialog" : undefined}
      >
        {displayValue}
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="date-popover-layer" style={{ top: popoverPos.top, left: popoverPos.left }}>
            <div className="date-popover-panel" ref={popoverRef} role="dialog">
              <div className="date-popover-body">
                {showRangeInputs ? (
                  <div className="date-popover-range-row">
                    <div className="date-popover-range-input active">
                      <input
                        type="text"
                        value={draftDate}
                        onChange={(event) => setDraftDate(event.target.value)}
                        placeholder="yyyy-mm-dd"
                        onBlur={commitIfChanged}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            commitIfChanged();
                            event.currentTarget.blur();
                          }
                        }}
                        disabled={!canEdit}
                      />
                      <span className="date-popover-divider" />
                      <input
                        type="time"
                        value={draftTime}
                        onChange={(event) => setDraftTime(event.target.value)}
                        onBlur={commitIfChanged}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            commitIfChanged();
                            event.currentTarget.blur();
                          }
                        }}
                        disabled={!canEdit}
                      />
                    </div>
                    <div className="date-popover-range-gap" />
                    <div className="date-popover-range-input">
                      <input
                        type="text"
                        value={draftEndDate}
                        onChange={(event) => setDraftEndDate(event.target.value)}
                        placeholder="fin"
                        disabled={!canEdit}
                      />
                      <span className="date-popover-divider" />
                      <input
                        type="time"
                        value={draftEndTime}
                        onChange={(event) => setDraftEndTime(event.target.value)}
                        disabled={!canEdit}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="date-popover-inputs">
                    <input
                      type="text"
                      value={draftDate}
                      onChange={(event) => setDraftDate(event.target.value)}
                      placeholder="yyyy-mm-dd"
                      onBlur={commitIfChanged}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          commitIfChanged();
                          event.currentTarget.blur();
                        }
                      }}
                      disabled={!canEdit}
                    />
                    <span className="date-popover-divider" />
                    {showEndDate ? (
                      <input
                        type="text"
                        value={draftEndDate}
                        onChange={(event) => setDraftEndDate(event.target.value)}
                        placeholder="fin"
                        disabled={!canEdit}
                      />
                    ) : (
                      <input
                        type="time"
                        value={draftTime}
                        onChange={(event) => setDraftTime(event.target.value)}
                        onBlur={commitIfChanged}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            commitIfChanged();
                            event.currentTarget.blur();
                          }
                        }}
                        disabled={!canEdit || !allowTime || !showTime}
                      />
                    )}
                  </div>
                )}
                <div className="date-popover-calendar">
                  <div className="date-popover-calendar-header">
                    <div className="date-popover-month">
                      {currentMonth.toLocaleString("es-ES", { month: "short", year: "numeric" })}
                    </div>
                    <div className="date-popover-actions">
                      <button
                        type="button"
                        className="date-popover-now"
                        onClick={() => {
                          const today = new Date();
                          const next = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
                            today.getDate()
                          ).padStart(2, "0")}`;
                          setDraftDate(next);
                          commitValue(next);
                        }}
                      >
                        Ahora
                      </button>
                      <button
                        type="button"
                        className="date-popover-nav"
                        onClick={() => {
                          const nextMonth = new Date(
                            currentMonth.getFullYear(),
                            currentMonth.getMonth() - 1,
                            1
                          );
                          setDraftDate(
                            `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`
                          );
                        }}
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        className="date-popover-nav"
                        onClick={() => {
                          const nextMonth = new Date(
                            currentMonth.getFullYear(),
                            currentMonth.getMonth() + 1,
                            1
                          );
                          setDraftDate(
                            `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`
                          );
                        }}
                      >
                        ›
                      </button>
                    </div>
                  </div>
                  <div className="date-popover-weekdays">
                    {DATE_WEEKDAYS.map((day) => (
                      <span key={day}>{day}</span>
                    ))}
                  </div>
                  <div className="date-popover-grid">
                    {monthCells.map((cell) => {
                      const cellDate = `${cell.date.getFullYear()}-${String(
                        cell.date.getMonth() + 1
                      ).padStart(2, "0")}-${String(cell.date.getDate()).padStart(2, "0")}`;
                      const selected = draftDate === cellDate;
                      return (
                        <button
                          key={cellDate}
                          type="button"
                          className={`date-popover-day ${cell.inMonth ? "" : "muted"} ${
                            selected ? "selected" : ""
                          }`}
                          onClick={() => {
                            setDraftDate(cellDate);
                            commitValue(cellDate);
                          }}
                        >
                          {cell.date.getDate()}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="date-popover-options">
                  <button
                    type="button"
                    className="date-popover-row"
                    onClick={() =>
                      setShowEndDate((prev) => {
                        const next = !prev;
                        if (next && !draftEndDate) {
                          setDraftEndDate(draftDate || "");
                          setDraftEndTime(draftTime || "00:00");
                        }
                        return next;
                      })
                    }
                  >
                    <span>Fecha de finalizacion</span>
                    <span className="date-popover-pill">{showEndDate ? "Si" : "No"}</span>
                  </button>
                  <button
                    type="button"
                    className="date-popover-row"
                    onClick={() => {
                      if (!allowTime) return;
                      setShowTime((prev) => !prev);
                    }}
                  >
                    <span>Incluir hora</span>
                    <span className={`date-popover-toggle ${showTime ? "on" : ""}`} />
                  </button>
                  <button
                    type="button"
                    className="date-popover-row"
                    onClick={() =>
                      setDateFormat((prev) =>
                        prev === "Fecha completa" ? "DD/MM/AA" : prev === "DD/MM/AA" ? "YYYY-MM-DD" : "Fecha completa"
                      )
                    }
                  >
                    <span>Formato de fecha</span>
                    <span className="date-popover-muted">{dateFormat}</span>
                  </button>
                  <button
                    type="button"
                    className="date-popover-row"
                    onClick={() =>
                      setTimeFormat((prev) => (prev === "24 horas" ? "12 horas" : "24 horas"))
                    }
                  >
                    <span>Formato de hora</span>
                    <span className="date-popover-muted">{timeFormat}</span>
                  </button>
                  <button
                    type="button"
                    className="date-popover-row"
                    onClick={() =>
                      setTimezone((prev) => (prev === "Local" ? "UTC" : prev === "UTC" ? "GMT+1" : "Local"))
                    }
                  >
                    <span>Zona horaria</span>
                    <span className="date-popover-muted">{timezone}</span>
                  </button>
                  <button
                    type="button"
                    className="date-popover-row"
                    onClick={() =>
                      setReminder((prev) =>
                        prev === "Ninguno"
                          ? "30 minutos antes"
                          : prev === "30 minutos antes"
                            ? "1 hora antes"
                            : "Ninguno"
                      )
                    }
                  >
                    <span>Recordatorio</span>
                    <span className="date-popover-muted">{reminder}</span>
                  </button>
                  <button
                    type="button"
                    className="date-popover-row danger"
                    onClick={() => {
                      if (!canEdit) return;
                      setDraftDate("");
                      onCommit("");
                      setOpen(false);
                    }}
                  >
                    Borrar
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export const DateCell: React.FC<DateCellProps> = ({ value, onCommit }) => {
  return (
    <DatePopover
      value={value}
      allowTime={false}
      canEdit
      onCommit={onCommit}
      inputClassName="cell-date"
    />
  );
};

type DateTimeCellProps = {
  value?: string | null;
  onCommit: (next: string) => void;
};

export const DateTimeCell: React.FC<DateTimeCellProps> = ({ value, onCommit }) => {
  return (
    <DatePopover
      value={value}
      allowTime
      canEdit
      onCommit={onCommit}
      inputClassName="cell-datetime"
    />
  );
};

export type SelectOption = {
  label: string;
  display?: string;
  color?: string;
  editable?: boolean;
};

type SelectCellProps = {
  value?: string | null;
  options: SelectOption[];
  placeholder?: string;
  onCommit: (next: string) => void;
  onCreateOption?: (label: string) => Promise<string | null> | string | null;
  onUpdateOptionColor?: (label: string, color: string) => Promise<void> | void;
  onDeleteOption?: (label: string) => Promise<void> | void;
  onReorderOption?: (fromLabel: string, toLabel: string) => Promise<void> | void;
};

function getContrastColor(hex?: string): string {
  if (!hex) return "var(--text)";
  const cleaned = hex.replace("#", "");
  if (cleaned.length !== 6) return "var(--text)";
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 160 ? "#1b1f24" : "#ffffff";
}

const DEFAULT_OPTION_COLOR = "#E2E8F0";

export const SelectCell: React.FC<SelectCellProps> = ({
  value,
  options,
  placeholder = "—",
  onCommit,
  onCreateOption,
  onUpdateOptionColor,
  onDeleteOption,
  onReorderOption
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dragOption, setDragOption] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Keep drag source in a ref so drop handlers still work if React doesn't re-render during drag.
  const dragOptionRef = React.useRef<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const resolved = value ?? "";
  const currentOption = options.find((opt) => opt.label === resolved);
  const displayValue = resolved ? currentOption?.display ?? resolved : placeholder;
  const color = currentOption?.color;

  React.useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (event.target instanceof Node && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setMenuFor(null);
      setDragOption(null);
      setDragOver(null);
      dragOptionRef.current = null;
    }
  }, [open]);

  const normalizedQuery = query.trim();
  const queryLower = normalizedQuery.toLowerCase();
  const exactMatch = normalizedQuery
    ? options.find((opt) => opt.label.toLowerCase() === queryLower)
    : undefined;
  const filteredOptions = normalizedQuery
    ? options.filter((opt) => {
        const label = (opt.display ?? opt.label).toLowerCase();
        return label.includes(queryLower);
      })
    : options;
  const canManage = Boolean(onUpdateOptionColor || onDeleteOption);

  const handleSelect = (label: string) => {
    onCommit(label);
    setOpen(false);
    setMenuFor(null);
  };

  const handleCreate = async () => {
    if (!normalizedQuery) return;
    if (exactMatch) {
      handleSelect(exactMatch.label);
      return;
    }
    if (!onCreateOption) return;
    const created = await Promise.resolve(onCreateOption(normalizedQuery));
    if (created) {
      handleSelect(created);
    }
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleCreate();
    }
    if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="select-cell" ref={containerRef}>
      <button
        className={`select-trigger ${open ? "open" : ""}`}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span
          className="select-pill"
          style={color ? { backgroundColor: color, color: getContrastColor(color) } : undefined}
        >
          {displayValue}
        </span>
        <span className="select-caret">▾</span>
      </button>
      {open && (
        <div className="select-menu">
          {onCreateOption && (
            <div className="select-search">
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder="Search or create..."
              />
            </div>
          )}
          <div className="select-options">
            {onCreateOption && normalizedQuery && !exactMatch && (
              <div className="select-option select-create" onClick={() => void handleCreate()}>
                <span className="select-swatch" />
                <span className="select-label">Create "{normalizedQuery}"</span>
              </div>
            )}
            {filteredOptions.length === 0 && (!normalizedQuery || exactMatch) && (
              <div className="select-empty">No options</div>
            )}
            {filteredOptions.map((option) => {
              const isSelected = option.label === resolved;
              const showMenu = canManage && option.editable !== false;
              const optionColor = option.color;
              const optionDisplay = (option.display ?? option.label) || placeholder;
              const draggable = Boolean(onReorderOption && option.editable !== false);
              const isDragOver = dragOver === option.label;
              return (
                <React.Fragment key={option.label || "empty"}>
                  <div
                    className={`select-option ${isSelected ? "selected" : ""} ${
                      draggable ? "draggable" : ""
                    } ${isDragOver ? "drag-over" : ""}`}
                    onClick={() => handleSelect(option.label)}
                    draggable={draggable}
                    onDragStart={(event) => {
                      if (!draggable) return;
                      event.dataTransfer.setData("text/plain", option.label);
                      event.dataTransfer.effectAllowed = "move";
                      dragOptionRef.current = option.label;
                      setDragOption(option.label);
                    }}
                    onDragOver={(event) => {
                      if (!draggable || !dragOptionRef.current) return;
                      event.preventDefault();
                      setDragOver(option.label);
                    }}
                    onDragLeave={() => {
                      if (dragOver === option.label) setDragOver(null);
                    }}
                    onDrop={(event) => {
                      const fromLabel = dragOptionRef.current;
                      if (!fromLabel || !draggable || fromLabel === option.label) return;
                      event.preventDefault();
                      void onReorderOption?.(fromLabel, option.label);
                      dragOptionRef.current = null;
                      setDragOption(null);
                      setDragOver(null);
                    }}
                    onDragEnd={() => {
                      dragOptionRef.current = null;
                      setDragOption(null);
                      setDragOver(null);
                    }}
                  >
                    {draggable && <span className="select-drag">||</span>}
                    <span
                      className="select-swatch"
                      style={{ backgroundColor: optionColor || DEFAULT_OPTION_COLOR }}
                    />
                    <span className="select-label">{optionDisplay}</span>
                    {isSelected && <span className="select-check">✓</span>}
                    {showMenu && (
                      <button
                        className="select-more"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuFor((prev) => (prev === option.label ? null : option.label));
                        }}
                        aria-label="Option actions"
                      >
                        ⋯
                      </button>
                    )}
                  </div>
                  {showMenu && menuFor === option.label && (
                    <div
                      className="select-option-actions"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {onUpdateOptionColor && (
                        <label className="select-color-row">
                          <span>Color</span>
                          <input
                            type="color"
                            value={optionColor || DEFAULT_OPTION_COLOR}
                            onChange={(event) => onUpdateOptionColor(option.label, event.target.value)}
                          />
                        </label>
                      )}
                      {onDeleteOption && (
                        <button
                          className="danger"
                          type="button"
                          onClick={() => {
                            void onDeleteOption(option.label);
                            setMenuFor(null);
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
