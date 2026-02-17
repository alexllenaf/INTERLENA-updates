import { createDefaultPageBlock } from "./blockRegistry";
import {
  PageTemplateBlock,
  getBlockPresetById,
  getDefaultPresetForType,
  getPageTemplateById
} from "./pageData";
import { PAGE_CONFIG_VERSION, PageBlockConfig, PageConfig } from "./types";

const applyTemplateBlock = (templateBlock: PageTemplateBlock): PageBlockConfig => {
  const fallback = createDefaultPageBlock(templateBlock.type, templateBlock.id);
  const specificPreset = getBlockPresetById(templateBlock.presetId);
  const defaultPreset = getDefaultPresetForType(templateBlock.type);
  const preset =
    specificPreset && specificPreset.type === templateBlock.type
      ? specificPreset
      : defaultPreset && defaultPreset.type === templateBlock.type
      ? defaultPreset
      : null;

  return {
    ...fallback,
    id: templateBlock.id,
    layout: {
      ...fallback.layout,
      ...(preset?.layout || {}),
      ...(templateBlock.layout || {})
    },
    props: {
      ...fallback.props,
      ...(preset?.props || {}),
      ...(templateBlock.props || {})
    } as any
  };
};

export const createPageConfigFromTemplate = (pageId: string): PageConfig => {
  const template = getPageTemplateById(pageId);
  if (!template || !Array.isArray(template.blocks) || template.blocks.length === 0) {
    return {
      id: pageId,
      version: PAGE_CONFIG_VERSION,
      blocks: [createDefaultPageBlock("text", `${pageId}:notes`)]
    };
  }

  return {
    id: pageId,
    version: PAGE_CONFIG_VERSION,
    blocks: template.blocks.map(applyTemplateBlock)
  };
};

export const createTrackerDefaultPageConfig = (title: string, description: string): PageConfig => {
  const base = createPageConfigFromTemplate("tracker");
  return {
    ...base,
    id: "tracker",
    blocks: base.blocks.map((block) => {
      if (block.id !== "tracker:table" || block.type !== "editableTable") return block;
      return {
        ...block,
        props: {
          ...block.props,
          title,
          description
        }
      } as PageBlockConfig;
    })
  };
};
