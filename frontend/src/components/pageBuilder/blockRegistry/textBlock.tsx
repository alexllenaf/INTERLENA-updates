import React from "react";
import BlockPanel from "../../BlockPanel";
import { type BlockDefinition } from "./types";

export const TEXT_BLOCK_DEFINITION: BlockDefinition<"text"> = {
  type: "text",
  defaultLayout: { colSpan: 20 },
  createDefaultProps: () => ({ text: "Write your notes here..." }),
  component: ({ block, mode, patchBlockProps, menuActions }) => (
    <BlockPanel id={block.id} as="section" menuActions={menuActions}>
      {mode === "edit" ? (
        <textarea
          className="block-edit-text"
          rows={3}
          value={block.props.text || ""}
          onChange={(event) => patchBlockProps({ text: event.target.value })}
          placeholder="Write your notes here..."
        />
      ) : (
        <div className="page-builder-text">{block.props.text || "—"}</div>
      )}
    </BlockPanel>
  )
};
