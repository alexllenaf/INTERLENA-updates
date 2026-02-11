import React, { useEffect, useState } from "react";

import { toDateInputValue, toDateTimeLocalValue } from "../utils";

type TextCellProps = {
  value?: string | null;
  placeholder?: string;
  onCommit: (next: string) => void;
};

export const TextCell: React.FC<TextCellProps> = ({ value, placeholder, onCommit }) => {
  const [draft, setDraft] = useState(value ?? "");
  const [dirty, setDirty] = useState(false);

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

  return (
    <input
      className="cell-input"
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        setDirty(true);
      }}
      onBlur={commit}
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
