import React from "react";
import BlockPanel from "../../BlockPanel";
import { createSlotContext, renderHeader } from "./shared";
import { type BlockDefinition } from "./types";

export const TITLE_DESCRIPTION_BLOCK_DEFINITION: BlockDefinition<"titleDescription"> = {
  type: "titleDescription",
  defaultLayout: { colSpan: 60 },
  createDefaultProps: () => ({ title: "Title", description: "Description" }),
  component: ({ block, mode, patchBlockProps, updateBlockProps, resolveSlot, menuActions }) => {
    const slotContext = createSlotContext(mode, updateBlockProps, patchBlockProps);
    const actions = block.props.actionsSlotId ? resolveSlot?.(block.props.actionsSlotId, block, slotContext) : null;
    return (
      <BlockPanel id={block.id} as="section" menuActions={menuActions}>
        {renderHeader(
          block.id,
          mode,
          block.props.title || "",
          block.props.description || "",
          (patch) => patchBlockProps(patch),
          actions
        )}
      </BlockPanel>
    );
  }
};
