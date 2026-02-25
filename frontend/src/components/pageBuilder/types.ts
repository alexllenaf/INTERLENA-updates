import { GRID_TOTAL_COLUMNS } from "../blocks/types";

export const PAGE_CONFIG_VERSION = 1;

export const PAGE_BLOCK_TYPES = [
  "text",
  "titleDescription",
  "cardGallery",
  "editableTable",
  "todoTable",
  "informationalTable",
  "calendar",
  "chart",
  "kpi",
  "pipeline",
  "email"
] as const;

export type PageBlockType = (typeof PAGE_BLOCK_TYPES)[number];

export type ChartSize = "small" | "medium" | "large" | "xlarge";
export type ChartVisualType = "bar" | "line" | "area" | "pie" | "timeline";
export type ChartMetricOp = "count_rows" | "count_values" | "sum" | "avg";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type GridLayout = {
  colSpan: number;
  colStart?: number;
  rowStart?: number;
};

export type BlockLinksMap = Record<string, string>;

type LinkableBlockProps = {
  links?: BlockLinksMap;
};

export type TextBlockProps = LinkableBlockProps & {
  text: string;
};

export type TitleDescriptionBlockProps = LinkableBlockProps & {
  title: string;
  description: string;
  actionsSlotId?: string;
};

export type CardGalleryItem = {
  title: string;
  subtitle?: string;
  tag?: string;
  date?: string;
  imageUrl?: string;
};

export type CardGalleryCustomField = {
  key: string;
  label: string;
  kind: EditableTableColumnKind;
  value: string;
  selectOptions?: EditableTableSelectOption[];
};

export type CardGalleryManualCard = {
  key: string;
  title: string;
  imageUrl?: string;
  imagePosition?: string;
  fields?: CardGalleryCustomField[];
};

export type CardGalleryBlockProps = LinkableBlockProps & {
  title: string;
  description: string;
  /** Global source column used as title/groupBy when linked */
  groupByColumn?: string;
  /** Global visible columns applied to every card when linking table */
  visibleColumns?: string[];
  /** @deprecated Legacy props; use manualCards for manual mode */
  items?: CardGalleryItem[];
  contentSlotId?: string;
  /** Manual cards with typed fields */
  manualCards?: CardGalleryManualCard[];
  /** Per-card image override when linking table */
  sourceImageByTitle?: Record<string, string>;
  /** Per-card image position (percentage) when linking table */
  sourceImagePositionByTitle?: Record<string, string>;
  /** Per-card field configuration when linking table */
  cardFieldConfigs?: Record<
    string,
    {
      titleColumn?: string;
      visibleColumns?: string[];
      imageColumn?: string;
    }
  >;
  /** Per-card field value overrides when linking table: cardKey -> fieldLabel -> value */
  fieldValueOverrides?: Record<string, Record<string, string>>;
};

export type EditableTableBlockProps = LinkableBlockProps & {
  title: string;
  description?: string;
  variant?: "tracker" | "todo";
  schemaRef?: string;
  overrides?: TableOverrides;
  customColumns?: string[];
  customColumnTypes?: Record<string, EditableTableColumnKind>;
  customSelectOptions?: Record<string, EditableTableSelectOption[]>;
  customRows?: string[][];
  searchPlaceholder?: string;
  addActionLabel?: string;
  toolbarActionsSlotId?: string;
  panelClassName?: string;
  actionsSlotId?: string;
  toolbarSlotId?: string;
  contentSlotId?: string;
};

export type TodoTableBlockProps = Omit<EditableTableBlockProps, "variant"> & {
  variant?: "todo";
};

export type EditableTableColumnKind =
  | "text"
  | "number"
  | "select"
  | "date"
  | "checkbox"
  | "rating"
  | "todo"
  | "contacts"
  | "links"
  | "documents";

export type TableSelectTypeOverride = {
  addOptions?: string[];
  relabelOptions?: Record<string, string>;
  hideOptions?: string[];
};

export type EditableTableSelectOption = {
  label: string;
  color?: string;
  display?: string;
  editable?: boolean;
};

export type TableOverrides = {
  hiddenColumns?: string[];
  columnOrder?: string[];
  columnWidths?: Record<string, number>;
  labelOverrides?: Record<string, string>;
  typeOverrides?: Record<string, TableSelectTypeOverride>;
};

export type InformationalTableBlockProps = LinkableBlockProps & {
  title: string;
  description: string;
  contentSlotId?: string;
  columns?: string[];
  rows?: string[][];
};

export type CalendarBlockProps = LinkableBlockProps & {
  title: string;
  description: string;
  contentSlotId?: string;
};

export type ChartBlockProps = LinkableBlockProps & {
  title: string;
  size: ChartSize;
  actionSlotId?: string;
  contentSlotId?: string;
  chartType?: ChartVisualType;
  seriesColor?: string;
  metricOp?: ChartMetricOp;
  sourceCategoryColumn?: string;
  sourceValueColumn?: string;
};

export type KpiMetricOp =
  | "count_rows"
  | "count_values"
  | "count_empty"
  | "unique_values"
  | "value_count"
  | "sum"
  | "avg";

export type KpiBlockProps = LinkableBlockProps & {
  label: string;
  labelAuto?: boolean;
  value?: string;
  valueSlotId?: string;
  sourceColumn?: string;
  metricOp?: KpiMetricOp;
  metricTargetValue?: string;
  metricTargetValues?: string[];
  metricAsPercent?: boolean;
};

export type PipelineBlockProps = LinkableBlockProps & {
  title: string;
  description: string;
  contentSlotId?: string;
  sourceColumn?: string;
};

export type EmailBlockProps = LinkableBlockProps & {
  title: string;
  description: string;
  contactId: string;
  folder: string;
  cacheSize: number;
  sendSubjectTemplate?: string;
  sendBodyTemplate?: string;
  sendContactLimit?: number;
  contentSlotId?: string;
};

export type PageBlockPropsMap = {
  text: TextBlockProps;
  titleDescription: TitleDescriptionBlockProps;
  cardGallery: CardGalleryBlockProps;
  editableTable: EditableTableBlockProps;
  todoTable: TodoTableBlockProps;
  informationalTable: InformationalTableBlockProps;
  calendar: CalendarBlockProps;
  chart: ChartBlockProps;
  kpi: KpiBlockProps;
  pipeline: PipelineBlockProps;
  email: EmailBlockProps;
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
