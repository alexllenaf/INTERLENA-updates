import React, { useState } from "react";

export type ExpandedFieldRow = {
  key: string;
  label: string;
  value: React.ReactNode;
  canReorder?: boolean;
  labelTitle?: string;
  dragAriaLabel?: string;
  onLabelClick?: (event: React.MouseEvent<HTMLSpanElement>) => void;
};

type ExpandedFieldsSectionProps = {
  title: string;
  addLabel: string;
  emptyRowsLabel: string;
  clickForSettingsLabel: string;
  dragToReorderLabel: string;
  showAddButton?: boolean;
  canAddField?: boolean;
  onAddField?: () => void;
  rows: ExpandedFieldRow[];
  onReorderField?: (fromKey: string, toKey: string) => void;
};

const ExpandedFieldsSection: React.FC<ExpandedFieldsSectionProps> = ({
  title,
  addLabel,
  emptyRowsLabel,
  clickForSettingsLabel,
  dragToReorderLabel,
  showAddButton = true,
  canAddField = true,
  onAddField,
  rows,
  onReorderField
}) => {
  const [draggedFieldKey, setDraggedFieldKey] = useState<string | null>(null);
  const [dragOverFieldKey, setDragOverFieldKey] = useState<string | null>(null);

  return (
    <section className="card-gallery-config-fields">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h3>{title}</h3>
        {showAddButton ? (
          <button
            type="button"
            className="ghost"
            disabled={!canAddField || !onAddField}
            onClick={() => {
              onAddField?.();
            }}
          >
            + {addLabel}
          </button>
        ) : null}
      </div>

      <div className="card-gallery-properties">
        {rows.length === 0 ? (
          <p className="muted">{emptyRowsLabel}</p>
        ) : (
          rows.map((row) => {
            const canReorder = Boolean(row.canReorder && onReorderField);
            return (
              <div
                key={row.key}
                className={`card-gallery-field-editor ${dragOverFieldKey === row.key ? "drag-over" : ""}`}
                onDragOver={(event) => {
                  if (!canReorder || !draggedFieldKey || draggedFieldKey === row.key) return;
                  event.preventDefault();
                  setDragOverFieldKey(row.key);
                }}
                onDragLeave={() => {
                  if (dragOverFieldKey === row.key) {
                    setDragOverFieldKey(null);
                  }
                }}
                onDrop={(event) => {
                  if (!canReorder || !draggedFieldKey || draggedFieldKey === row.key || !onReorderField) return;
                  event.preventDefault();
                  onReorderField(draggedFieldKey, row.key);
                  setDraggedFieldKey(null);
                  setDragOverFieldKey(null);
                }}
              >
                <div className="card-gallery-field-header">
                  {canReorder ? (
                    <div
                      className="card-gallery-field-drag-handle row-grip-handle"
                      draggable
                      aria-label={row.dragAriaLabel || `Reorder ${row.label}`}
                      title={dragToReorderLabel}
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/plain", row.key);
                        event.dataTransfer.effectAllowed = "move";
                        setDraggedFieldKey(row.key);
                      }}
                      onDragEnd={() => {
                        setDraggedFieldKey(null);
                        setDragOverFieldKey(null);
                      }}
                    />
                  ) : null}
                  <span
                    className="card-gallery-field-label"
                    title={row.labelTitle || clickForSettingsLabel}
                    onClick={row.onLabelClick}
                  >
                    {row.label}
                  </span>
                </div>
                <div className="card-gallery-field-value">{row.value}</div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};

export default ExpandedFieldsSection;
