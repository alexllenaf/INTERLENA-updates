import React from "react";
import BlockPanel from "../../BlockPanel";
import { createSlotContext } from "./shared";
import { type BlockDefinition } from "./types";

export const KPI_BLOCK_DEFINITION: BlockDefinition<"kpi"> = {
  type: "kpi",
  defaultLayout: { colSpan: 12 },
  createDefaultProps: () => ({ label: "KPI", value: "0" }),
  component: ({ block, mode, updateBlockProps, patchBlockProps, resolveSlot, menuActions }) => {
    const slotContext = createSlotContext(mode, updateBlockProps, patchBlockProps);
    const value = block.props.valueSlotId
      ? resolveSlot?.(block.props.valueSlotId, block, slotContext)
      : block.props.value || "0";
    return (
      <BlockPanel id={block.id} as="section" className="kpi-card-block" menuActions={menuActions}>
        <p>{block.props.label || "KPI"}</p>
        <h2>{value}</h2>
      </BlockPanel>
    );
  }
};
