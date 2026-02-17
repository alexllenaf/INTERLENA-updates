import React from "react";
import { CorePagePlugin } from "../types";

const loadCalendarPage = () => import("../../pages/CalendarPage");

const CalendarPage = React.lazy(loadCalendarPage);

export const calendarPlugin: CorePagePlugin = {
  id: "calendar",
  path: "/calendar",
  labelKey: "Calendar",
  showInSidebar: true,
  component: CalendarPage,
  preload: loadCalendarPage
};
