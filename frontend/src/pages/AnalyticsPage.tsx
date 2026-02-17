import React, { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { AppBlockConfig, GRID_SPAN } from "../components/blocks/types";
import GridPageLayout from "../components/layout/GridPageLayout";
import { useI18n } from "../i18n";
import { useAppData } from "../state";
import { formatDate } from "../utils";

const AnalyticsPage: React.FC = () => {
  const { t } = useI18n();
  const { applications } = useAppData();

  const outcomes = useMemo(() => {
    const map = new Map<string, number>();
    applications.forEach((app) => {
      map.set(app.outcome, (map.get(app.outcome) || 0) + 1);
    });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [applications]);

  const stages = useMemo(() => {
    const map = new Map<string, number>();
    applications.forEach((app) => {
      map.set(app.stage, (map.get(app.stage) || 0) + 1);
    });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [applications]);

  const scoreData = useMemo(() => {
    const map = new Map<string, number>();
    applications.forEach((app) => {
      if (app.my_interview_score === null || app.my_interview_score === undefined) return;
      const bucket = app.my_interview_score.toFixed(0);
      map.set(bucket, (map.get(bucket) || 0) + 1);
    });
    return Array.from(map.entries()).map(([score, value]) => ({ score, value }));
  }, [applications]);

  const active = applications.filter((app) => app.outcome === "In Progress");

  const blocks: AppBlockConfig[] = [
    {
      id: "analytics:intro",
      type: "titleDescription",
      layout: { colSpan: GRID_SPAN.full },
      data: {
        title: t("Analytics"),
        description: t("Break down outcomes, stages, and score distribution.")
      }
    },
    {
      id: "analytics:chart:outcomes",
      type: "chart",
      layout: { colSpan: GRID_SPAN.chartMedium },
      data: {
        title: t("Outcomes"),
        size: "medium",
        content: (
          <div className="chart-shell">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={outcomes}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#2B6CB0" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )
      }
    },
    {
      id: "analytics:chart:stages",
      type: "chart",
      layout: { colSpan: GRID_SPAN.chartMedium },
      data: {
        title: t("Stages"),
        size: "medium",
        content: (
          <div className="chart-shell">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stages}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#D69E2E" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )
      }
    },
    {
      id: "analytics:chart:score",
      type: "chart",
      layout: { colSpan: GRID_SPAN.chartMedium },
      data: {
        title: t("Score Distribution"),
        size: "medium",
        content: (
          <div className="chart-shell">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={scoreData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="score" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="#2F855A" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )
      }
    },
    {
      id: "analytics:active",
      type: "informationalTable",
      layout: { colSpan: GRID_SPAN.full },
      data: {
        title: t("Active Processes"),
        description: t("Applications currently in progress."),
        content:
          active.length === 0 ? (
            <div className="empty">{t("No active processes.")}</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>{t("Company")}</th>
                  <th>{t("Position")}</th>
                  <th>{t("Stage")}</th>
                  <th>{t("Application Date")}</th>
                </tr>
              </thead>
              <tbody>
                {active.map((app) => (
                  <tr key={app.id}>
                    <td>{app.company_name}</td>
                    <td>{app.position}</td>
                    <td>{app.stage}</td>
                    <td>{formatDate(app.application_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
      }
    }
  ];

  return <GridPageLayout blocks={blocks} className="analytics" />;
};

export default AnalyticsPage;
