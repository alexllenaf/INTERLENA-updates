import React from "react";
import BlockPanel from "../../BlockPanel";
import { createSlotContext, renderHeader } from "./shared";
import { type BlockDefinition } from "./types";

export const PIPELINE_BLOCK_DEFINITION: BlockDefinition<"pipeline"> = {
  type: "pipeline",
  defaultLayout: { colSpan: 60 },
  createDefaultProps: () => ({
    title: "Pipeline",
    description: "Track stages as opportunities move."
  }),
  component: ({ block, mode, patchBlockProps, updateBlockProps, resolveSlot, menuActions }) => {
    const slotContext = createSlotContext(mode, updateBlockProps, patchBlockProps);
    const slot = block.props.contentSlotId ? resolveSlot?.(block.props.contentSlotId, block, slotContext) : null;
    return (
      <BlockPanel id={block.id} as="section" menuActions={menuActions}>
        {renderHeader(
          block.id,
          mode,
          block.props.title || "",
          block.props.description || "",
          (patch) => patchBlockProps(patch)
        )}
        {slot || <div className="empty">Pipeline content is not connected yet.</div>}
      </BlockPanel>
    );
  }
};
