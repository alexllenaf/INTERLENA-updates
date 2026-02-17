import React from "react";
import BlockPanel from "../../BlockPanel";
import { chartSizeClass, createSlotContext } from "./shared";
import { type BlockDefinition } from "./types";

export const CHART_BLOCK_DEFINITION: BlockDefinition<"chart"> = {
  type: "chart",
  defaultLayout: { colSpan: 20 },
  createDefaultProps: () => ({ title: "Chart", size: "medium" }),
  component: ({ block, mode, patchBlockProps, updateBlockProps, resolveSlot, menuActions }) => {
    const slotContext = createSlotContext(mode, updateBlockProps, patchBlockProps);
    const action = block.props.actionSlotId ? resolveSlot?.(block.props.actionSlotId, block, slotContext) : null;
    const slot = block.props.contentSlotId ? resolveSlot?.(block.props.contentSlotId, block, slotContext) : null;
    return (
      <BlockPanel
        id={block.id}
        as="section"
        className={["chart-panel", chartSizeClass(block.props.size || "medium")].join(" ")}
        menuActions={menuActions}
      >
        <div className="panel-header panel-header-inline">
          {mode === "edit" ? (
            <input
              className="block-edit-title"
              value={block.props.title || ""}
              onChange={(event) => patchBlockProps({ title: event.target.value })}
              placeholder="Chart title"
            />
          ) : (
            <h3>{block.props.title || "Chart"}</h3>
          )}
          {action}
        </div>
        {slot || <div className="empty">Chart data is not connected yet.</div>}
      </BlockPanel>
    );
  }
};
