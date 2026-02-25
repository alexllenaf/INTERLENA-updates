import React from "react";
import StarRating from "../StarRating";
import { DateCell, DateTimeCell, SelectCell, TextAreaCell, TextCell, type SelectOption } from "../TableCells";
import { type EditableTableColumnKind } from "../pageBuilder/types";
import { isCompactTextValue } from "../../shared/textControl";

type TypologyFieldControlProps = {
  kind: EditableTableColumnKind;
  fieldKey: string;
  value: unknown;
  enabledLabel: string;
  selectOptions?: SelectOption[];
  onCreateSelectOption?: (label: string) => Promise<string | null> | string | null;
  onUpdateSelectOptionColor?: (label: string, color: string) => Promise<void> | void;
  onDeleteSelectOption?: (label: string) => Promise<void> | void;
  onReorderSelectOption?: (fromLabel: string, toLabel: string) => Promise<void> | void;
  isLongText?: boolean;
  preferMultilineText?: boolean;
  onCommit: (nextValue: unknown) => void;
};

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const TypologyFieldControl: React.FC<TypologyFieldControlProps> = ({
  kind,
  fieldKey,
  value,
  enabledLabel,
  selectOptions,
  onCreateSelectOption,
  onUpdateSelectOptionColor,
  onDeleteSelectOption,
  onReorderSelectOption,
  isLongText = false,
  preferMultilineText,
  onCommit
}) => {
  if (kind === "rating") {
    return (
      <StarRating
        value={toNumberOrNull(value)}
        step={0.5}
        onChange={(nextValue) => {
          onCommit(nextValue);
        }}
      />
    );
  }

  if (kind === "checkbox") {
    return (
      <label className="checkbox-inline">
        <input
          className="cell-checkbox"
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => {
            onCommit(event.target.checked);
          }}
        />
        <span>{enabledLabel}</span>
      </label>
    );
  }

  if (kind === "select") {
    return (
      <SelectCell
        value={value === null || value === undefined ? "" : String(value)}
        options={selectOptions || [{ label: "", display: "—", editable: false }]}
        onCreateOption={onCreateSelectOption}
        onUpdateOptionColor={onUpdateSelectOptionColor}
        onDeleteOption={onDeleteSelectOption}
        onReorderOption={onReorderSelectOption}
        onCommit={(nextValue) => {
          onCommit(nextValue);
        }}
      />
    );
  }

  if (kind === "number") {
    const numberValue = toNumberOrNull(value);
    return (
      <input
        className="cell-number"
        type="number"
        value={numberValue === null ? "" : String(numberValue)}
        onChange={(event) => {
          onCommit(event.target.value);
        }}
      />
    );
  }

  if (kind === "date") {
    const textValue = value === null || value === undefined ? "" : String(value);
    if (fieldKey === "interview_datetime") {
      return (
        <DateTimeCell
          value={textValue}
          onCommit={(nextValue) => {
            onCommit(nextValue);
          }}
        />
      );
    }
    return (
      <DateCell
        value={textValue}
        onCommit={(nextValue) => {
          onCommit(nextValue);
        }}
      />
    );
  }

  const prefersTextarea =
    kind === "text" && (typeof preferMultilineText === "boolean" ? preferMultilineText : isLongText);
  const shouldUseTextarea = prefersTextarea && !isCompactTextValue(value);

  if (shouldUseTextarea) {
    return (
      <TextAreaCell
        value={value === null || value === undefined ? "" : String(value)}
        rows={3}
        onCommit={(nextValue) => {
          onCommit(nextValue);
        }}
      />
    );
  }

  return (
    <TextCell
      value={value === null || value === undefined ? "" : String(value)}
      onCommit={(nextValue) => {
        onCommit(nextValue);
      }}
    />
  );
};

export default TypologyFieldControl;
