import React from "react";
import BlockPanel from "../../BlockPanel";
import { type BlockDefinition } from "./types";

const ORPHAN_TYPE_PREFIX = "__orphan__";

export const TEXT_BLOCK_DEFINITION: BlockDefinition<"text"> = {
  type: "text",
  defaultLayout: { colSpan: 20 },
  createDefaultProps: () => ({ text: "Write your notes here..." }),
  component: ({ block, mode, patchBlockProps, menuActions }) => {
    const text = block.props.text || "";
    if (text.startsWith(ORPHAN_TYPE_PREFIX)) {
      const originalType = text.slice(ORPHAN_TYPE_PREFIX.length) || "desconocido";
      return (
        <BlockPanel id={block.id} as="section" menuActions={menuActions}>
          <div className="block-orphan-placeholder">
            <span className="block-orphan-icon">⚠</span>
            <span className="block-orphan-label">
              Bloque <em>{originalType}</em> no disponible
            </span>
            <span className="block-orphan-hint">
              Este bloque fue preservado automáticamente. Se restaurará si el tipo vuelve a estar disponible.
            </span>
          </div>
        </BlockPanel>
      );
    }
    return (
      <BlockPanel id={block.id} as="section" menuActions={menuActions}>
        {mode === "edit" ? (
          <textarea
            className="block-edit-text"
            rows={3}
            value={text}
            onChange={(event) => patchBlockProps({ text: event.target.value })}
            placeholder="Write your notes here..."
          />
        ) : (
          <div className="page-builder-text">{text || "—"}</div>
        )}
      </BlockPanel>
    );
  }
};
