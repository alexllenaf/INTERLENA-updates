import React, { useMemo } from "react";
import { BlockRegistry, BlockRenderMode, BlockSlotResolver, PAGE_BLOCK_REGISTRY } from "./blockRegistry";
import { GridLayout, PageBlockConfig, PageConfig } from "./types";
import { BlockPanelMenuAction } from "../BlockPanel";

type GridExtraItem = {
  key: string;
  layout: GridLayout;
  className?: string;
  children?: React.ReactNode;
};

type Props = {
  pageConfig: PageConfig;
  className?: string;
  mode?: BlockRenderMode;
  registry?: BlockRegistry;
  resolveSlot?: BlockSlotResolver;
  resolveBlockProps?: (block: PageBlockConfig) => Record<string, unknown> | null;
  resolveBlockMenuActions?: (block: PageBlockConfig) => BlockPanelMenuAction[] | undefined;
  onUpdateBlockProps?: (blockId: string, nextProps: Record<string, unknown>) => void;
  renderBlockControls?: (block: PageBlockConfig) => React.ReactNode;
  blockClassName?: (block: PageBlockConfig) => string;
  hiddenBlockIds?: Set<string>;
  layoutOverrides?: Record<string, GridLayout>;
  extraItems?: GridExtraItem[];
  containerRef?: React.Ref<HTMLDivElement>;
};

const toGridVars = (layout: GridLayout): React.CSSProperties & Record<string, string> => {
  const style: React.CSSProperties & Record<string, string> = {
    "--grid-col-span": String(layout.colSpan)
  };
  if (layout.colStart !== undefined) {
    style["--grid-col-start"] = String(layout.colStart);
  }
  if (layout.rowStart !== undefined) {
    style["--grid-row-start"] = String(layout.rowStart);
  }
  return style;
};

const PageRenderer: React.FC<Props> = ({
  pageConfig,
  className = "",
  mode = "view",
  registry = PAGE_BLOCK_REGISTRY,
  resolveSlot,
  resolveBlockProps,
  resolveBlockMenuActions,
  onUpdateBlockProps,
  renderBlockControls,
  blockClassName,
  hiddenBlockIds,
  layoutOverrides,
  extraItems,
  containerRef
}) => {
  const blocks = useMemo(() => pageConfig.blocks || [], [pageConfig.blocks]);

  return (
    <div className={["grid-page-layout", className].filter(Boolean).join(" ")} ref={containerRef}>
      {blocks.map((block) => {
        if (hiddenBlockIds?.has(block.id)) return null;
        const definition = registry[block.type];
        if (!definition) return null;
        const dynamicProps = resolveBlockProps?.(block);
        const effectiveBlock = dynamicProps
          ? ({
              ...block,
              props: { ...(block.props as Record<string, unknown>), ...dynamicProps }
            } as PageBlockConfig)
          : block;
        const layout = layoutOverrides?.[block.id] || block.layout;
        const style = toGridVars(layout);
        const nextProps = (patch: Partial<Record<string, unknown>>) => {
          if (!onUpdateBlockProps) return;
          onUpdateBlockProps(block.id, { ...(block.props as Record<string, unknown>), ...patch });
        };
        const content = definition.component({
          block: effectiveBlock as any,
          mode,
          resolveSlot,
          menuActions: resolveBlockMenuActions?.(block),
          updateBlockProps: (next: Record<string, unknown>) =>
            onUpdateBlockProps?.(block.id, next as Record<string, unknown>),
          patchBlockProps: (patch: Partial<Record<string, unknown>>) =>
            nextProps(patch as Record<string, unknown>)
        } as any);
        const extraClass = blockClassName?.(block) || "";
        return (
          <div
            key={block.id}
            className={["grid-page-item", "page-builder-item", `block-type-${block.type}`, extraClass]
              .filter(Boolean)
              .join(" ")}
            style={style}
            data-block-id={block.id}
            data-block-type={block.type}
          >
            {renderBlockControls?.(block)}
            {content}
          </div>
        );
      })}
      {(extraItems || []).map((item) => (
        <div
          key={item.key}
          className={["grid-page-item", "page-builder-extra-item", item.className || ""].filter(Boolean).join(" ")}
          style={toGridVars(item.layout)}
        >
          {item.children || null}
        </div>
      ))}
    </div>
  );
};

export default PageRenderer;
