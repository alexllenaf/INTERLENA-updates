import { getDefaultPresetForType } from "./pageData";
import {
  type PageBlockConfig,
  type PageBlockPropsMap,
  type PageBlockType
} from "./types";
import { CALENDAR_BLOCK_DEFINITION } from "./blockRegistry/calendarBlock";
import { CHART_BLOCK_DEFINITION } from "./blockRegistry/chartBlock";
import { EDITABLE_TABLE_BLOCK_DEFINITION } from "./blockRegistry/editableTableBlock";
import { INFORMATIONAL_TABLE_BLOCK_DEFINITION } from "./blockRegistry/informationalTableBlock";
import { KPI_BLOCK_DEFINITION } from "./blockRegistry/kpiBlock";
import { PIPELINE_BLOCK_DEFINITION } from "./blockRegistry/pipelineBlock";
import { TEXT_BLOCK_DEFINITION } from "./blockRegistry/textBlock";
import { TITLE_DESCRIPTION_BLOCK_DEFINITION } from "./blockRegistry/titleDescriptionBlock";
import { type BlockRegistry } from "./blockRegistry/types";

export type {
  BlockDefinition,
  BlockRegistry,
  BlockRenderContext,
  BlockRenderMode,
  BlockSlotContext,
  BlockSlotResolver
} from "./blockRegistry/types";

export const PAGE_BLOCK_REGISTRY: BlockRegistry = {
  text: TEXT_BLOCK_DEFINITION,
  titleDescription: TITLE_DESCRIPTION_BLOCK_DEFINITION,
  editableTable: EDITABLE_TABLE_BLOCK_DEFINITION,
  informationalTable: INFORMATIONAL_TABLE_BLOCK_DEFINITION,
  calendar: CALENDAR_BLOCK_DEFINITION,
  chart: CHART_BLOCK_DEFINITION,
  kpi: KPI_BLOCK_DEFINITION,
  pipeline: PIPELINE_BLOCK_DEFINITION
};

export const createDefaultPageBlock = <TType extends PageBlockType>(
  type: TType,
  id: string
): PageBlockConfig<TType> => {
  const definition = PAGE_BLOCK_REGISTRY[type];
  const preset = getDefaultPresetForType(type);
  const presetLayout = preset && preset.type === type ? (preset.layout || {}) : {};
  const presetProps =
    preset && preset.type === type ? (preset.props as unknown as Partial<PageBlockPropsMap[TType]>) : {};

  return {
    id,
    type,
    layout: {
      ...definition.defaultLayout,
      ...presetLayout
    },
    props: {
      ...definition.createDefaultProps(),
      ...presetProps
    }
  };
};
