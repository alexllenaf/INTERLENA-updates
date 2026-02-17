import { GRID_TOTAL_COLUMNS } from "../blocks/types";

export const PAGE_CONFIG_VERSION = 1;

export const PAGE_BLOCK_TYPES = [
  "text",
  "titleDescription",
  "editableTable",
  "informationalTable",
  "calendar",
  "chart",
  "kpi",
  "pipeline"
] as const;

export type PageBlockType = (typeof PAGE_BLOCK_TYPES)[number];

export type ChartSize = "small" | "medium" | "large" | "xlarge";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type GridLayout = {
  colSpan: number;
  colStart?: number;
  rowStart?: number;
};

export type TextBlockProps = {
  text: string;
};

export type TitleDescriptionBlockProps = {
  title: string;
  description: string;
  actionsSlotId?: string;
};

export type EditableTableBlockProps = {
  title: string;
  description?: string;
  variant?: "tracker" | "todo";
  customColumns?: string[];
  customColumnTypes?: Record<string, EditableTableColumnKind>;
  customRows?: string[][];
  searchPlaceholder?: string;
  addActionLabel?: string;
  toolbarActionsSlotId?: string;
  panelClassName?: string;
  actionsSlotId?: string;
  toolbarSlotId?: string;
  contentSlotId?: string;
};

export type EditableTableColumnKind =
  | "text"
  | "number"
  | "select"
  | "date"
  | "checkbox"
  | "rating"
  | "contacts"
  | "links"
  | "documents";

export type InformationalTableBlockProps = {
  title: string;
  description: string;
  contentSlotId?: string;
  columns?: string[];
  rows?: string[][];
};

export type CalendarBlockProps = {
  title: string;
  description: string;
  contentSlotId?: string;
};

export type ChartBlockProps = {
  title: string;
  size: ChartSize;
  actionSlotId?: string;
  contentSlotId?: string;
};

export type KpiBlockProps = {
  label: string;
  value?: string;
  valueSlotId?: string;
};

export type PipelineBlockProps = {
  title: string;
  description: string;
  contentSlotId?: string;
};

export type PageBlockPropsMap = {
  text: TextBlockProps;
  titleDescription: TitleDescriptionBlockProps;
  editableTable: EditableTableBlockProps;
  informationalTable: InformationalTableBlockProps;
  calendar: CalendarBlockProps;
  chart: ChartBlockProps;
  kpi: KpiBlockProps;
  pipeline: PipelineBlockProps;
};

export type PageBlockConfig<TType extends PageBlockType = PageBlockType> = {
  id: string;
  type: TType;
  layout: GridLayout;
  props: PageBlockPropsMap[TType];
};

export type PageConfig = {
  id: string;
  version: number;
  blocks: PageBlockConfig[];
  updated_at?: string;
};

export const clampColSpan = (value: number) =>
  Math.max(1, Math.min(GRID_TOTAL_COLUMNS, Math.round(value)));
