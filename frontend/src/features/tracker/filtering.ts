import { Application } from "../../types";

export const normalizeText = (value: string): string => value.trim().toLowerCase();

export const matchesSearchQuery = (app: Application, query: string): boolean => {
  const needle = normalizeText(query);
  if (!needle) return true;

  return (
    app.company_name.toLowerCase().includes(needle) ||
    app.position.toLowerCase().includes(needle) ||
    (app.location || "").toLowerCase().includes(needle)
  );
};

export const matchesStageOutcome = (
  app: Application,
  stageFilter: string,
  outcomeFilter: string
): boolean => {
  const stageOk = stageFilter === "all" || app.stage === stageFilter;
  const outcomeOk = outcomeFilter === "all" || app.outcome === outcomeFilter;
  return stageOk && outcomeOk;
};
