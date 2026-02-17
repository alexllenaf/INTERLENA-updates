import React from "react";
import { CorePagePlugin } from "../types";

const loadPipelinePage = () => import("../../pages/PipelinePage");

const PipelinePage = React.lazy(loadPipelinePage);

export const pipelinePlugin: CorePagePlugin = {
  id: "pipeline",
  path: "/pipeline",
  labelKey: "Pipeline",
  showInSidebar: true,
  component: PipelinePage,
  preload: loadPipelinePage
};
