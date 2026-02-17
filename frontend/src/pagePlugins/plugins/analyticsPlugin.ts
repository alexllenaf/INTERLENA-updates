import React from "react";
import { CorePagePlugin } from "../types";

const loadAnalyticsPage = () => import("../../pages/AnalyticsPage");

const AnalyticsPage = React.lazy(loadAnalyticsPage);

export const analyticsPlugin: CorePagePlugin = {
  id: "analytics",
  path: "/analytics",
  labelKey: "Analytics",
  showInSidebar: false,
  showTopbar: true,
  component: AnalyticsPage,
  preload: loadAnalyticsPage
};
