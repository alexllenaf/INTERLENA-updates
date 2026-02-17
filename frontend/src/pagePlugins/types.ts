import React from "react";

export type CorePagePlugin = {
  id: string;
  path: string;
  labelKey: string;
  end?: boolean;
  showInSidebar?: boolean;
  showTopbar?: boolean;
  component: React.LazyExoticComponent<React.ComponentType>;
  preload: () => Promise<unknown>;
};
