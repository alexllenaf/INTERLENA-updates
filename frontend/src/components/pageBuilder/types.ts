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
  "email",
  "databaseView"
] as const;

export type PageBlockType = (typeof PAGE_BLOCK_TYPES)[number];

export type ChartSize = "small" | "medium" | "large";
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

/**
 * Links map: each key is a link slot name, each value is a globally unique blockId.
 * The pageId is resolved at runtime via the global BlockGraph index — never stored in the link.
 * This is the Notion model: blockId is the only pointer, the index knows where it lives.
 */
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

export type AlertItemType = "followup" | "todo" | "interview" | "application";
export type AlertStatusFilter = "overdue" | "soon" | "ok";
export type AlertSortOrder = "date-asc" | "date-desc" | "status-first";
export type AlertVisibleColumn = "type" | "company" | "detail" | "date" | "status";

export type InformationalTableBlockProps = LinkableBlockProps & {
  title: string;
  description: string;
  contentSlotId?: string;
  columns?: string[];
  rows?: string[][];
  columnWidths?: Record<string, number>;
  sourceMode?: "manual" | "editableTable" | "email" | "applicationAlerts";
  /** @deprecated Legacy field cleared on re-link; use BlockLinksMap instead */
  sourceCanonicalTableRef?: unknown;
  sourceColumnOrder?: string[];
  sourceVisibleColumns?: string[];
  emailRecentLimit?: number;
  emailLookbackDays?: number;
  emailAccountFilter?: string;
  emailCompanyFilter?: string | string[];
  emailContactFilter?: string | string[];
  emailFolderFilter?: string;
  emailSummaryVolumeDays?: number;
  emailSummaryTimelineDays?: number;
  emailSummaryAwaitingReplyDays?: number;
  emailSummaryAwaitingResponseDays?: number;
  emailSummaryCardOrder?: Array<"recentVolume" | "receivedTimeline" | "awaitingReply" | "awaitingResponse">;
  /** Calendar alerts mode config */
  alertTypes?: AlertItemType[];
  alertStatuses?: AlertStatusFilter[];
  alertSortOrder?: AlertSortOrder;
  alertMaxRows?: number;
  alertVisibleColumns?: AlertVisibleColumn[];
  alertColumnOrder?: AlertVisibleColumn[];
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
  readEnabled?: boolean;
  sendEnabled?: boolean;
  folder: string;
  cacheSize: number;
  readStartDate?: string;
  readLoadFullContent?: boolean;
  readAccountFilter?: string;
  readSearchHistory?: Array<
    | string
    | {
        query: string;
        scope?: "all" | "from" | "subject" | "attachment" | "message";
      }
  >;
  sendSubjectTemplate?: string;
  sendBodyTemplate?: string;
  sendContactLimit?: number;
  sendSelectedRecipients?: Record<string, boolean>;
  sendDraftAttachments?: Array<{
    id: string;
    kind: "image" | "document";
    filename: string;
    contentType?: string;
    size: number;
    lastModified: number;
    dataBase64: string;
    sendDataBase64?: string;
    sendContentType?: string;
    sendSizeBytes?: number;
    renderWidth?: number;
    naturalWidth?: number;
    naturalHeight?: number;
  }>;
  sendDraftEntries?: Array<{
    id: string;
    subjectTemplate: string;
    bodyTemplate: string;
    attachments: Array<{
      id: string;
      kind: "image" | "document";
      filename: string;
      contentType?: string;
      size: number;
      lastModified: number;
      dataBase64: string;
      sendDataBase64?: string;
      sendContentType?: string;
      sendSizeBytes?: number;
      renderWidth?: number;
      naturalWidth?: number;
      naturalHeight?: number;
    }>;
    selectedRecipients?: Record<string, boolean>;
    recipientCount: number;
    updatedAt: string;
  }>;
  sendSentEntries?: Array<{
    id: string;
    subjectTemplate: string;
    bodyTemplate: string;
    attachments: Array<{
      id: string;
      kind: "image" | "document";
      filename: string;
      contentType?: string;
      size: number;
      lastModified: number;
      dataBase64: string;
      sendDataBase64?: string;
      sendContentType?: string;
      sendSizeBytes?: number;
      renderWidth?: number;
      naturalWidth?: number;
      naturalHeight?: number;
    }>;
    recipientCount: number;
    updatedAt: string;
  }>;
  contentSlotId?: string;
};

export type DatabaseViewBlockProps = LinkableBlockProps & {
  title: string;
  description?: string;
  databaseId: string;
  viewId?: string;
  emptyMessage?: string;
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
  databaseView: DatabaseViewBlockProps;
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
