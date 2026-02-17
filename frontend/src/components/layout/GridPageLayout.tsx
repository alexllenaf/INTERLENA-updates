import React from "react";
import { AppBlockConfig } from "../blocks/types";
import BlockRenderer from "../blocks/BlockRenderer";

type Props = {
  blocks: AppBlockConfig[];
  className?: string;
};

const GridPageLayout: React.FC<Props> = ({ blocks, className = "" }) => {
  const classes = ["grid-page-layout", className].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      {blocks.map((block) => {
        const style: React.CSSProperties & Record<string, string> = {
          "--grid-col-span": String(block.layout.colSpan)
        };

        if (block.layout.colStart !== undefined) {
          style["--grid-col-start"] = String(block.layout.colStart);
        }

        if (block.layout.rowStart !== undefined) {
          style["--grid-row-start"] = String(block.layout.rowStart);
        }

        return (
          <div
            key={block.id}
            className={`grid-page-item block-type-${block.type}`}
            style={style}
            data-block-id={block.id}
            data-block-type={block.type}
          >
            <BlockRenderer block={block} />
          </div>
        );
      })}
    </div>
  );
};

export default GridPageLayout;
