import React from "react";
import { GRID_SPAN } from "../../blocks/types";
import { type PageBlockPropsMap } from "../types";
import { type BlockRenderMode, type BlockSlotContext } from "./types";

export const normalizeChartSize = (size: unknown): PageBlockPropsMap["chart"]["size"] => {
  switch (size) {
    case "small":
    case "medium":
    case "large":
      return size;
    case "xlarge":
      return "large";
    default:
      return "medium";
  }
};

export const chartSizeClass = (size: unknown) => {
  switch (normalizeChartSize(size)) {
    case "medium":
      return "chart-size-medium";
    case "large":
      return "chart-size-large";
    default:
      return "chart-size-small";
  }
};

export const chartSizeColSpan = (size: unknown) => {
  switch (normalizeChartSize(size)) {
    case "medium":
      return GRID_SPAN.half;
    case "large":
      return GRID_SPAN.full;
    default:
      return GRID_SPAN.quarter;
  }
};

export const chartSizeWidthLabel = (size: unknown) => {
  switch (normalizeChartSize(size)) {
    case "medium":
      return "1/2 ancho";
    case "large":
      return "Ancho completo";
    default:
      return "1/4 ancho";
  }
};

export const renderHeader = (
  id: string,
  mode: BlockRenderMode,
  title: string,
  description: string,
  onChange: (patch: { title?: string; description?: string }) => void,
  actions?: React.ReactNode
) => (
  <div className="panel-header block-header-editor">
    <div>
      {mode === "edit" ? (
        <input
          className="block-edit-title"
          value={title}
          onChange={(event) => onChange({ title: event.target.value })}
          placeholder="Title"
          aria-label={`${id}-title`}
        />
      ) : (
        <h3>{title}</h3>
      )}
      {mode === "edit" ? (
        <textarea
          className="block-edit-description"
          value={description}
          rows={1}
          onChange={(event) => onChange({ description: event.target.value })}
          placeholder="Description"
          aria-label={`${id}-description`}
        />
      ) : (
        description && <p>{description}</p>
      )}
    </div>
    {actions ? <div className="block-header-actions">{actions}</div> : null}
  </div>
);

export const BrokenLinkBadge: React.FC<{ keys?: string[] }> = ({ keys }) => {
  if (!keys || keys.length === 0) return null;
  return (
    <span
      className="broken-link-badge"
      title={`La fuente vinculada ya no está disponible (${keys.join(", ")})`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        <line x1="2" y1="2" x2="22" y2="22" />
      </svg>
    </span>
  );
};

export const createSlotContext = (
  mode: BlockRenderMode,
  updateBlockProps: (nextProps: any) => void,
  patchBlockProps: (patch: any) => void
): BlockSlotContext => ({
  mode,
  updateBlockProps: (nextProps) => updateBlockProps(nextProps),
  patchBlockProps: (patch) => patchBlockProps(patch)
});
