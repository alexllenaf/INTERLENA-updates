import React from "react";
import { CorePagePlugin } from "../types";

const loadTrackerPage = () => import("../../pages/TrackerPage");

const TrackerPage = React.lazy(loadTrackerPage);

export const trackerPlugin: CorePagePlugin = {
  id: "tracker",
  path: "/tracker",
  labelKey: "Tracker Table",
  showInSidebar: true,
  component: TrackerPage,
  preload: loadTrackerPage
};
