import { GridLayout, PageBlockPropsMap, PageBlockType, PAGE_BLOCK_TYPES } from "./types";

export type BlockPresetDefinition<TType extends PageBlockType = PageBlockType> = {
  id: string;
  type: TType;
  props: PageBlockPropsMap[TType];
  layout?: Partial<GridLayout>;
};

export type PageTemplateBlock<TType extends PageBlockType = PageBlockType> = {
  id: string;
  type: TType;
  presetId?: string;
  layout?: Partial<GridLayout>;
  props?: Partial<PageBlockPropsMap[TType]>;
};

export type PageTemplateDefinition = {
  id: string;
  blocks: PageTemplateBlock[];
};

export type PageBlockLibraryEntry = {
  id: string;
  type: PageBlockType;
  label: string;
  description: string;
  presetId?: string;
};

const preset = <TType extends PageBlockType>(definition: BlockPresetDefinition<TType>) => definition;
const templateBlock = <TType extends PageBlockType>(block: PageTemplateBlock<TType>) => block;

const BLOCK_PRESET_LIST = [
  preset({
    id: "text.default",
    type: "text",
    props: {
      text: "Write your notes here..."
    },
    layout: { colSpan: 20 }
  }),
  preset({
    id: "titleDescription.default",
    type: "titleDescription",
    props: {
      title: "Title",
      description: "Description"
    },
    layout: { colSpan: 60 }
  }),
  preset({
    id: "editableTable.default",
    type: "editableTable",
    props: {
      title: "Editable table",
      description: "Table block",
      variant: "tracker",
      customColumns: ["Column 1", "Column 2", "Column 3"],
      customRows: [["", "", ""]]
    },
    layout: { colSpan: 60 }
  }),
  preset({
    id: "informationalTable.default",
    type: "informationalTable",
    props: {
      title: "Informational table",
      description: "Read-only metrics table",
      columns: ["Column A", "Column B"],
      rows: [["-", "-"]]
    },
    layout: { colSpan: 60 }
  }),
  preset({
    id: "calendar.default",
    type: "calendar",
    props: {
      title: "Calendar",
      description: "Track interviews and follow-ups."
    },
    layout: { colSpan: 60 }
  }),
  preset({
    id: "chart.default",
    type: "chart",
    props: {
      title: "Chart",
      size: "medium"
    },
    layout: { colSpan: 20 }
  }),
  preset({
    id: "kpi.default",
    type: "kpi",
    props: {
      label: "KPI",
      value: "0"
    },
    layout: { colSpan: 12 }
  }),
  preset({
    id: "pipeline.default",
    type: "pipeline",
    props: {
      title: "Pipeline",
      description: "Track stages as opportunities move."
    },
    layout: { colSpan: 60 }
  }),
  preset({
    id: "tracker.table",
    type: "editableTable",
    props: {
      variant: "tracker",
      schemaRef: "tracker.applications@1",
      title: "Tracker Table",
      description: "Search, edit, and manage every application.",
      actionsSlotId: "tracker:actions",
      toolbarSlotId: "tracker:toolbar",
      contentSlotId: "tracker:content"
    },
    layout: { colSpan: 60 }
  }),
  preset({
    id: "dashboard.kpi.total",
    type: "kpi",
    props: { label: "Total Applications", valueSlotId: "dashboard:kpi:total:value" },
    layout: { colSpan: 12 }
  }),
  preset({
    id: "dashboard.kpi.offers",
    type: "kpi",
    props: { label: "Total Offers", valueSlotId: "dashboard:kpi:offers:value" },
    layout: { colSpan: 12 }
  }),
  preset({
    id: "dashboard.kpi.rejected",
    type: "kpi",
    props: { label: "Total Rejections", valueSlotId: "dashboard:kpi:rejected:value" },
    layout: { colSpan: 12 }
  }),
  preset({
    id: "dashboard.kpi.active",
    type: "kpi",
    props: { label: "Active Processes", valueSlotId: "dashboard:kpi:active:value" },
    layout: { colSpan: 12 }
  }),
  preset({
    id: "dashboard.kpi.favorites",
    type: "kpi",
    props: { label: "Favorites", valueSlotId: "dashboard:kpi:favorites:value" },
    layout: { colSpan: 12 }
  }),
  preset({
    id: "dashboard.kpi.success",
    type: "kpi",
    props: { label: "Offer Success Rate", valueSlotId: "dashboard:kpi:success:value" },
    layout: { colSpan: 12 }
  }),
  preset({
    id: "dashboard.kpi.avgscore",
    type: "kpi",
    props: { label: "Avg Score (Offers)", valueSlotId: "dashboard:kpi:avgscore:value" },
    layout: { colSpan: 12 }
  }),
  preset({
    id: "dashboard.chart.outcomes",
    type: "chart",
    props: {
      title: "Outcomes Distribution",
      size: "small",
      actionSlotId: "dashboard:chart:outcomes:action",
      contentSlotId: "dashboard:chart:outcomes:content"
    },
    layout: { colSpan: 15 }
  }),
  preset({
    id: "dashboard.chart.stages",
    type: "chart",
    props: {
      title: "Applications per Stage",
      size: "small",
      actionSlotId: "dashboard:chart:stages:action",
      contentSlotId: "dashboard:chart:stages:content"
    },
    layout: { colSpan: 15 }
  }),
  preset({
    id: "dashboard.chart.timeline",
    type: "chart",
    props: {
      title: "Timeline Applications",
      size: "small",
      actionSlotId: "dashboard:chart:timeline:action",
      contentSlotId: "dashboard:chart:timeline:content"
    },
    layout: { colSpan: 15 }
  }),
  preset({
    id: "dashboard.chart.score",
    type: "chart",
    props: {
      title: "Score Distribution",
      size: "small",
      actionSlotId: "dashboard:chart:score:action",
      contentSlotId: "dashboard:chart:score:content"
    },
    layout: { colSpan: 15 }
  }),
  preset({
    id: "dashboard.table.alerts",
    type: "informationalTable",
    props: {
      title: "Event Alerts",
      description: "Upcoming or overdue follow-ups and to-do items.",
      contentSlotId: "dashboard:table:alerts:content"
    },
    layout: { colSpan: 60 }
  }),
  preset({
    id: "dashboard.table.active",
    type: "informationalTable",
    props: {
      title: "Active Processes",
      description: "Applications currently in progress.",
      contentSlotId: "dashboard:table:active:content"
    },
    layout: { colSpan: 60 }
  }),
  preset({
    id: "analytics.header",
    type: "titleDescription",
    props: {
      title: "Analytics",
      description: "Break down outcomes, stages, and score distribution."
    },
    layout: { colSpan: 60 }
  }),
  preset({
    id: "analytics.chart.outcomes",
    type: "chart",
    props: {
      title: "Outcomes",
      size: "medium",
      contentSlotId: "analytics:chart:outcomes:content"
    },
    layout: { colSpan: 20 }
  }),
  preset({
    id: "analytics.chart.stages",
    type: "chart",
    props: {
      title: "Stages",
      size: "medium",
      contentSlotId: "analytics:chart:stages:content"
    },
    layout: { colSpan: 20 }
  }),
  preset({
    id: "analytics.chart.score",
    type: "chart",
    props: {
      title: "Score Distribution",
      size: "medium",
      contentSlotId: "analytics:chart:score:content"
    },
    layout: { colSpan: 20 }
  }),
  preset({
    id: "analytics.table.active",
    type: "informationalTable",
    props: {
      title: "Active Processes",
      description: "Applications currently in progress.",
      contentSlotId: "analytics:table:active:content"
    },
    layout: { colSpan: 60 }
  }),
  preset({
    id: "pipeline.board",
    type: "pipeline",
    props: {
      title: "Pipeline",
      description: "Drag or push opportunities across stages as you progress.",
      contentSlotId: "pipeline:board:content"
    },
    layout: { colSpan: 60 }
  }),
  preset({
    id: "calendar.alerts",
    type: "informationalTable",
    props: {
      title: "Calendar Alerts",
      description: "Upcoming or overdue follow-ups and to-do items.",
      contentSlotId: "calendar:alerts:content"
    },
    layout: { colSpan: 60 }
  }),
  preset({
    id: "calendar.month",
    type: "calendar",
    props: {
      title: "Calendar",
      description: "Track interviews and follow-ups with a consolidated event list.",
      contentSlotId: "calendar:month:content"
    },
    layout: { colSpan: 60 }
  }),
  preset({
    id: "calendar.todo",
    type: "editableTable",
    props: {
      title: "To-Do List",
      description: "Manage preparation tasks linked to each application.",
      variant: "todo",
      toolbarSlotId: "calendar:todo:toolbar",
      contentSlotId: "calendar:todo:content"
    },
    layout: { colSpan: 60 }
  })
] as const;

export const PAGE_BLOCK_PRESETS: Record<string, BlockPresetDefinition> = Object.fromEntries(
  BLOCK_PRESET_LIST.map((entry) => [entry.id, entry])
) as Record<string, BlockPresetDefinition>;

export const DEFAULT_PRESET_ID_BY_BLOCK_TYPE: Record<PageBlockType, string> = {
  text: "text.default",
  titleDescription: "titleDescription.default",
  editableTable: "editableTable.default",
  informationalTable: "informationalTable.default",
  calendar: "calendar.default",
  chart: "chart.default",
  kpi: "kpi.default",
  pipeline: "pipeline.default"
};

const BLOCK_LIBRARY_LABELS: Record<PageBlockType, { label: string; description: string }> = {
  text: {
    label: "Text",
    description: "Simple editable text block."
  },
  titleDescription: {
    label: "Title + description",
    description: "Section title with supporting description."
  },
  editableTable: {
    label: "Editable table",
    description: "Editable table area (Tracker / To-do)."
  },
  informationalTable: {
    label: "Informational table",
    description: "Read-only style table with editable header."
  },
  calendar: {
    label: "Calendar",
    description: "Calendar module with editable heading."
  },
  chart: {
    label: "Chart",
    description: "Chart block with multiple sizes."
  },
  kpi: {
    label: "KPI",
    description: "Compact KPI metric card."
  },
  pipeline: {
    label: "Pipeline",
    description: "Pipeline board with editable heading."
  }
};

export const PAGE_BLOCK_LIBRARY: PageBlockLibraryEntry[] = [
  ...PAGE_BLOCK_TYPES.map((type) => ({
    id: `${type}.default`,
    type,
    label: BLOCK_LIBRARY_LABELS[type].label,
    description: BLOCK_LIBRARY_LABELS[type].description
  })),
  {
    id: "editableTable.todo",
    type: "editableTable",
    label: "To-Do List",
    description: "Editable table preset for to-do management.",
    presetId: "calendar.todo"
  }
];

const PAGE_TEMPLATE_LIST: PageTemplateDefinition[] = [
  {
    id: "tracker",
    blocks: [
      templateBlock({
        id: "tracker:table",
        type: "editableTable",
        presetId: "tracker.table"
      })
    ]
  },
  {
    id: "dashboard",
    blocks: [
      templateBlock({ id: "dashboard:kpi:total", type: "kpi", presetId: "dashboard.kpi.total" }),
      templateBlock({ id: "dashboard:kpi:offers", type: "kpi", presetId: "dashboard.kpi.offers" }),
      templateBlock({ id: "dashboard:kpi:rejected", type: "kpi", presetId: "dashboard.kpi.rejected" }),
      templateBlock({ id: "dashboard:kpi:active", type: "kpi", presetId: "dashboard.kpi.active" }),
      templateBlock({ id: "dashboard:kpi:favorites", type: "kpi", presetId: "dashboard.kpi.favorites" }),
      templateBlock({ id: "dashboard:kpi:success", type: "kpi", presetId: "dashboard.kpi.success" }),
      templateBlock({ id: "dashboard:kpi:avgscore", type: "kpi", presetId: "dashboard.kpi.avgscore" }),
      templateBlock({
        id: "dashboard:chart:outcomes",
        type: "chart",
        presetId: "dashboard.chart.outcomes"
      }),
      templateBlock({
        id: "dashboard:chart:stages",
        type: "chart",
        presetId: "dashboard.chart.stages"
      }),
      templateBlock({
        id: "dashboard:chart:timeline",
        type: "chart",
        presetId: "dashboard.chart.timeline"
      }),
      templateBlock({
        id: "dashboard:chart:score",
        type: "chart",
        presetId: "dashboard.chart.score"
      }),
      templateBlock({
        id: "dashboard:alerts",
        type: "informationalTable",
        presetId: "dashboard.table.alerts"
      }),
      templateBlock({
        id: "dashboard:active",
        type: "informationalTable",
        presetId: "dashboard.table.active"
      })
    ]
  },
  {
    id: "analytics",
    blocks: [
      templateBlock({ id: "analytics:intro", type: "titleDescription", presetId: "analytics.header" }),
      templateBlock({
        id: "analytics:chart:outcomes",
        type: "chart",
        presetId: "analytics.chart.outcomes"
      }),
      templateBlock({
        id: "analytics:chart:stages",
        type: "chart",
        presetId: "analytics.chart.stages"
      }),
      templateBlock({ id: "analytics:chart:score", type: "chart", presetId: "analytics.chart.score" }),
      templateBlock({ id: "analytics:active", type: "informationalTable", presetId: "analytics.table.active" })
    ]
  },
  {
    id: "pipeline",
    blocks: [
      templateBlock({ id: "pipeline:board", type: "pipeline", presetId: "pipeline.board" })
    ]
  },
  {
    id: "calendar",
    blocks: [
      templateBlock({ id: "calendar:alerts", type: "informationalTable", presetId: "calendar.alerts" }),
      templateBlock({ id: "calendar:month", type: "calendar", presetId: "calendar.month" }),
      templateBlock({ id: "calendar:todo", type: "editableTable", presetId: "calendar.todo" })
    ]
  }
];

export const PAGE_TEMPLATES: Record<string, PageTemplateDefinition> = Object.fromEntries(
  PAGE_TEMPLATE_LIST.map((entry) => [entry.id, entry])
) as Record<string, PageTemplateDefinition>;

export const getBlockPresetById = (presetId?: string): BlockPresetDefinition | null => {
  if (!presetId) return null;
  return PAGE_BLOCK_PRESETS[presetId] || null;
};

export const getDefaultPresetForType = (type: PageBlockType): BlockPresetDefinition | null => {
  const presetId = DEFAULT_PRESET_ID_BY_BLOCK_TYPE[type];
  return getBlockPresetById(presetId);
};

export const getPageTemplateById = (pageId: string): PageTemplateDefinition | null => {
  return PAGE_TEMPLATES[pageId] || null;
};
