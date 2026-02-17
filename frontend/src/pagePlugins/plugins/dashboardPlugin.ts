import React from "react";
import { CorePagePlugin } from "../types";

const loadDashboardPage = () => import("../../pages/DashboardPage");

const DashboardPage = React.lazy(loadDashboardPage);

export const dashboardPlugin: CorePagePlugin = {
  id: "dashboard",
  path: "/",
  labelKey: "Dashboard",
  end: true,
  showInSidebar: true,
  showTopbar: true,
  component: DashboardPage,
  preload: loadDashboardPage
};
