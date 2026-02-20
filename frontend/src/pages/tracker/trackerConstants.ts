import type { SelectOption } from "../../components/TableCells";
import { TODO_STATUSES, TODO_STATUS_PILL_COLORS } from "../../constants";

export const SELECTION_COLUMN_WIDTH = 22;
export const ACTIONS_COLUMN_WIDTH = 96;
export const COLUMN_MENU_WIDTH = 240;
export const COLUMN_MENU_GUTTER = 12;
export const COLUMN_MENU_OFFSET = 6;
export const COLUMN_MENU_X_OFFSET = -6;
export const COLUMN_MENU_HEIGHT_ESTIMATE = 420;
export const COLUMN_MENU_ANIM_MS = 160;

export type ColumnMenuView = "root" | "type" | "filter" | "sort" | "group" | "calculate";

export type ColumnCalcOp =
  | "none"
  | "count"
  | "count_values"
  | "count_empty"
  | "unique"
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "checked"
  | "unchecked";

export const DEFAULT_OPTION_COLOR = "#E2E8F0";
export const TODO_STATUS_SELECT_OPTIONS: SelectOption[] = TODO_STATUSES.map((status) => ({
  label: status,
  color: TODO_STATUS_PILL_COLORS[status]
}));

export const TRACKER_PRIMARY_TABLE_ID = "tracker:table";
