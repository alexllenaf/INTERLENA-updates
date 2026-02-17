import React from "react";
import { type PageBlockPropsMap } from "../types";
import { type BlockRenderMode, type BlockSlotContext } from "./types";

export const chartSizeClass = (size: PageBlockPropsMap["chart"]["size"]) => {
  switch (size) {
    case "medium":
      return "chart-size-medium";
    case "large":
      return "chart-size-large";
    case "xlarge":
      return "chart-size-xlarge";
    default:
      return "chart-size-small";
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

export const createSlotContext = (
  mode: BlockRenderMode,
  updateBlockProps: (nextProps: any) => void,
  patchBlockProps: (patch: any) => void
): BlockSlotContext => ({
  mode,
  updateBlockProps: (nextProps) => updateBlockProps(nextProps),
  patchBlockProps: (patch) => patchBlockProps(patch)
});
