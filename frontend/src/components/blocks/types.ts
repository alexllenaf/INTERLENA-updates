import React from "react";

export const GRID_TOTAL_COLUMNS = 60;
export const GRID_SPAN = {
  full: 60,
  half: 30,
  third: 20,
  quarter: 15,
  kpi: 12,
  chartSmall: 15,
  chartMedium: 20,
  chartLarge: 30,
  chartXLarge: 60,
  standardTable: 60,
  standardCalendar: 60,
  standardPipeline: 60
} as const;

export type BlockLayout = {
  colSpan: number;
  colStart?: number;
  rowStart?: number;
};

type BaseBlock<TType extends string, TData> = {
  id: string;
  type: TType;
  layout: BlockLayout;
  data: TData;
};

export type TextBlockData = {
  text: string;
};

export type TitleDescriptionBlockData = {
  title: string;
  description: string;
  actions?: React.ReactNode;
};

export type EditableTableBlockData = {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  panelClassName?: string;
  content: React.ReactNode;
};

export type InformationalTableBlockData = {
  title: string;
  description: string;
  content: React.ReactNode;
};

export type CalendarBlockData = {
  title: string;
  description: string;
  content: React.ReactNode;
};

export type ChartSize = "small" | "medium" | "large" | "xlarge";

export type ChartBlockData = {
  title: string;
  size: ChartSize;
  action?: React.ReactNode;
  content: React.ReactNode;
};

export type KpiCardBlockData = {
  label: string;
  value: React.ReactNode;
};

export type PipelineBlockData = {
  title: string;
  description: string;
  content: React.ReactNode;
};

export type TextBlock = BaseBlock<"text", TextBlockData>;
export type TitleDescriptionBlock = BaseBlock<"titleDescription", TitleDescriptionBlockData>;
export type EditableTableBlock = BaseBlock<"editableTable", EditableTableBlockData>;
export type InformationalTableBlock = BaseBlock<"informationalTable", InformationalTableBlockData>;
export type CalendarBlock = BaseBlock<"calendar", CalendarBlockData>;
export type ChartBlock = BaseBlock<"chart", ChartBlockData>;
export type KpiCardBlock = BaseBlock<"kpiCard", KpiCardBlockData>;
export type PipelineBlock = BaseBlock<"pipeline", PipelineBlockData>;

export type AppBlockConfig =
  | TextBlock
  | TitleDescriptionBlock
  | EditableTableBlock
  | InformationalTableBlock
  | CalendarBlock
  | ChartBlock
  | KpiCardBlock
  | PipelineBlock;
