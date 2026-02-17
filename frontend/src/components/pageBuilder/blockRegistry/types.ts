import React from "react";
import { type BlockPanelMenuAction } from "../../BlockPanel";
import {
  type GridLayout,
  type PageBlockConfig,
  type PageBlockPropsMap,
  type PageBlockType
} from "../types";

export type BlockRenderMode = "view" | "edit";

export type BlockSlotContext = {
  mode: BlockRenderMode;
  updateBlockProps: (nextProps: Record<string, unknown>) => void;
  patchBlockProps: (patch: Partial<Record<string, unknown>>) => void;
};

export type BlockSlotResolver = (
  slotId: string,
  block: PageBlockConfig,
  context?: BlockSlotContext
) => React.ReactNode;

export type BlockRenderContext<TType extends PageBlockType = PageBlockType> = {
  block: PageBlockConfig<TType>;
  mode: BlockRenderMode;
  resolveSlot?: BlockSlotResolver;
  menuActions?: BlockPanelMenuAction[];
  updateBlockProps: (nextProps: PageBlockPropsMap[TType]) => void;
  patchBlockProps: (patch: Partial<PageBlockPropsMap[TType]>) => void;
};

export type BlockDefinition<TType extends PageBlockType = PageBlockType> = {
  type: TType;
  component: (ctx: BlockRenderContext<TType>) => React.ReactNode;
  createDefaultProps: () => PageBlockPropsMap[TType];
  defaultLayout: GridLayout;
};

export type BlockRegistry = {
  [TType in PageBlockType]: BlockDefinition<TType>;
};
