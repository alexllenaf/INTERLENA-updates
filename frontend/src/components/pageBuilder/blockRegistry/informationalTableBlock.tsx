import React from "react";
import BlockPanel from "../../BlockPanel";
import { createSlotContext, renderHeader } from "./shared";
import { type BlockDefinition } from "./types";

export const INFORMATIONAL_TABLE_BLOCK_DEFINITION: BlockDefinition<"informationalTable"> = {
  type: "informationalTable",
  defaultLayout: { colSpan: 60 },
  createDefaultProps: () => ({
    title: "Informational table",
    description: "Read-only metrics table",
    columns: ["Column A", "Column B"],
    rows: [["-", "-"]]
  }),
  component: ({ block, mode, patchBlockProps, updateBlockProps, resolveSlot, menuActions }) => {
    const slotContext = createSlotContext(mode, updateBlockProps, patchBlockProps);
    const slot = block.props.contentSlotId ? resolveSlot?.(block.props.contentSlotId, block, slotContext) : null;
    const columns = block.props.columns || [];
    const rows = block.props.rows || [];
    return (
      <BlockPanel id={block.id} as="section" menuActions={menuActions}>
        {renderHeader(
          block.id,
          mode,
          block.props.title || "",
          block.props.description || "",
          (patch) => patchBlockProps(patch)
        )}
        {slot || (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  {columns.map((col, index) => (
                    <th key={`${block.id}-head-${index}`}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={`${block.id}-row-${rowIndex}`}>
                    {row.map((value, cellIndex) => (
                      <td key={`${block.id}-cell-${rowIndex}-${cellIndex}`}>{value}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </BlockPanel>
    );
  }
};
