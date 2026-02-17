import { analyticsPlugin } from "./plugins/analyticsPlugin";
import { calendarPlugin } from "./plugins/calendarPlugin";
import { dashboardPlugin } from "./plugins/dashboardPlugin";
import { pipelinePlugin } from "./plugins/pipelinePlugin";
import { trackerPlugin } from "./plugins/trackerPlugin";
import { CorePagePlugin } from "./types";

export const CORE_PAGE_PLUGINS: CorePagePlugin[] = [
  dashboardPlugin,
  trackerPlugin,
  pipelinePlugin,
  calendarPlugin,
  analyticsPlugin
];

export type { CorePagePlugin } from "./types";
