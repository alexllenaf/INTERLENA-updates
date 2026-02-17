import React, { useEffect, useState } from "react";

import { buildHighlightChunks } from "../features/tracker/highlight";
import { toDateInputValue, toDateTimeLocalValue } from "../utils";

type TextCellProps = {
  value?: string | null;
  placeholder?: string;
  highlightQuery?: string;
  onCommit: (next: string) => void;
};

export const TextCell: React.FC<TextCellProps> = ({
  value,
  placeholder,
  highlightQuery = "",
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
          setDraft(event.target.value);
          setDirty(true);
        }}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false);
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            setDraft(value ?? "");
            setDirty(false);
          }
        }}
        placeholder={placeholder}
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
