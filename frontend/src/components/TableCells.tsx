import React, { useEffect, useState } from "react";

import { buildHighlightChunks } from "../features/tracker/highlight";
import { toDateInputValue, toDateTimeLocalValue } from "../utils";

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

type DateCellProps = {
  value?: string | null;
  onCommit: (next: string) => void;
};

export const DateCell: React.FC<DateCellProps> = ({ value, onCommit }) => {
  const [draft, setDraft] = useState(toDateInputValue(value));

  useEffect(() => {
    setDraft(toDateInputValue(value));
  }, [value]);

  const commit = (next: string) => {
    const current = toDateInputValue(value);
    if (next === current) return;
    onCommit(next);
  };

  return (
    <input
      className="cell-date"
      type="date"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(toDateInputValue(value));
        }
      }}
    />
  );
};

type DateTimeCellProps = {
  value?: string | null;
  onCommit: (next: string) => void;
};

export const DateTimeCell: React.FC<DateTimeCellProps> = ({ value, onCommit }) => {
  const [draft, setDraft] = useState(toDateTimeLocalValue(value));

  useEffect(() => {
    setDraft(toDateTimeLocalValue(value));
  }, [value]);

  const commit = (next: string) => {
    const current = toDateTimeLocalValue(value);
    if (next === current) return;
    onCommit(next);
  };

  return (
    <input
      className="cell-datetime"
      type="datetime-local"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          setDraft(toDateTimeLocalValue(value));
        }
      }}
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
