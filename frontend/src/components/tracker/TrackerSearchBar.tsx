import React, { useEffect, useMemo, useRef, useState } from "react";

type FilterOption = {
  value: string;
  label: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  stageFilter: string;
  onStageFilterChange: (value: string) => void;
  stages: readonly string[];
  stageOptions?: FilterOption[];
  outcomeFilter: string;
  onOutcomeFilterChange: (value: string) => void;
  outcomes: readonly string[];
  outcomeOptions?: FilterOption[];
  placeholder: string;
  allLabel: string;
  stageAllLabel?: string;
  outcomeAllLabel?: string;
  stageLabel: string;
  outcomeLabel: string;
  hideOutcomeFilter?: boolean;
  filterAriaLabel: string;
  clearAriaLabel: string;
  alwaysShowClearButton?: boolean;
  showAdvancedFilters?: boolean;
};

const TrackerSearchBar: React.FC<Props> = ({
  value,
  onChange,
  stageFilter,
  onStageFilterChange,
  stages,
  stageOptions,
  outcomeFilter,
  onOutcomeFilterChange,
  outcomes,
  outcomeOptions,
  placeholder,
  allLabel,
  stageAllLabel,
  outcomeAllLabel,
  stageLabel,
  outcomeLabel,
  hideOutcomeFilter,
  filterAriaLabel,
  clearAriaLabel,
  alwaysShowClearButton,
  showAdvancedFilters = true
}) => {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent) => {
      if (!popoverRef.current) return;
      if (event.target instanceof Node && !popoverRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const hasActiveAdvancedFilters = useMemo(
    () =>
      showAdvancedFilters &&
      (stageFilter !== "all" || (!hideOutcomeFilter && outcomeFilter !== "all")),
    [showAdvancedFilters, stageFilter, outcomeFilter, hideOutcomeFilter]
  );
  const resolvedStageOptions = useMemo<FilterOption[]>(
    () =>
      stageOptions && stageOptions.length > 0
        ? stageOptions
        : stages.map((stage) => ({ value: stage, label: stage })),
    [stageOptions, stages]
  );
  const resolvedOutcomeOptions = useMemo<FilterOption[]>(
    () =>
      outcomeOptions && outcomeOptions.length > 0
        ? outcomeOptions
        : outcomes.map((outcome) => ({ value: outcome, label: outcome })),
    [outcomeOptions, outcomes]
  );

  const showClearButton = Boolean(alwaysShowClearButton || value.trim());

  useEffect(() => {
    if (!showAdvancedFilters && open) {
      setOpen(false);
    }
  }, [open, showAdvancedFilters]);

  return (
    <div className="tracker-search" ref={popoverRef}>
      <div className="tracker-search-input-wrap">
        <span className="tracker-search-leading" aria-hidden="true">
          <svg viewBox="0 0 20 20">
            <path d="M12.9 14 17 18.1l1.1-1.1-4.1-4.1a6.5 6.5 0 1 0-1.1 1.1ZM4.5 8.5a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" />
          </svg>
        </span>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="tracker-search-input"
        />
        <div className="tracker-search-actions">
          {showClearButton && (
            <button
              type="button"
              className="tracker-search-clear"
              onClick={() => onChange("")}
              aria-label={clearAriaLabel}
              title={clearAriaLabel}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M5.22 5.22a.75.75 0 0 1 1.06 0L10 8.94l3.72-3.72a.75.75 0 0 1 1.06 1.06L11.06 10l3.72 3.72a.75.75 0 0 1-1.06 1.06L10 11.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06L8.94 10 5.22 6.28a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </button>
          )}
          {showAdvancedFilters && (
            <button
              type="button"
              className={`tracker-search-filter ${open ? "open" : ""} ${hasActiveAdvancedFilters ? "active" : ""}`}
              onClick={() => setOpen((prev) => !prev)}
              aria-label={filterAriaLabel}
              aria-expanded={open}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M3 4.75A.75.75 0 0 1 3.75 4h12.5a.75.75 0 0 1 .56 1.25L12 10.54V15a.75.75 0 0 1-1.2.6l-2-1.5a.75.75 0 0 1-.3-.6v-2.96L3.19 5.25A.75.75 0 0 1 3 4.75Z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {open && showAdvancedFilters && (
        <div className="tracker-search-popover" role="dialog" aria-label={filterAriaLabel}>
          <div className="tracker-search-popover-row">
            <label>{stageLabel}</label>
            <select value={stageFilter} onChange={(event) => onStageFilterChange(event.target.value)}>
              <option value="all">{stageAllLabel || allLabel}</option>
              {resolvedStageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {!hideOutcomeFilter && (
            <div className="tracker-search-popover-row">
              <label>{outcomeLabel}</label>
              <select value={outcomeFilter} onChange={(event) => onOutcomeFilterChange(event.target.value)}>
                <option value="all">{outcomeAllLabel || allLabel}</option>
                {resolvedOutcomeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TrackerSearchBar;
