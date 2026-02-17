import React, { useCallback, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { BlockSlotResolver, PageBuilderPage } from "../components/pageBuilder";
import { useI18n } from "../i18n";
import { useAppData } from "../state";
import { averageOfferScore, followupStatus, formatDate, successRate } from "../utils";

type ChartKey = "outcomes" | "stages" | "timeline" | "score";

const DashboardPage: React.FC = () => {
  const { t } = useI18n();
  const { applications, settings } = useAppData();
  const [expandedChart, setExpandedChart] = useState<ChartKey | null>(null);

  const truncateLabel = (value: string, max = 14) =>
    value.length > max ? `${value.slice(0, max)}...` : value;

  const metrics = useMemo(() => {
    const total = applications.length;
    const offers = applications.filter((app) => app.outcome === "Offer").length;
    const rejected = applications.filter((app) => app.outcome === "Rejected").length;
    const activeCount = applications.filter((app) => app.outcome === "In Progress").length;
    const favorites = applications.filter((app) => app.favorite).length;
    return {
      total,
      offers,
      rejected,
      active: activeCount,
      favorites,
      successRate: successRate(applications),
      avgScore: averageOfferScore(applications)
    };
  }, [applications]);

  const outcomeData = useMemo(() => {
    const map = new Map<string, number>();
    applications.forEach((app) => {
      map.set(app.outcome, (map.get(app.outcome) || 0) + 1);
    });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [applications]);

  const stageData = useMemo(() => {
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

  const timelineData = useMemo(() => {
    const map = new Map<string, number>();
    applications.forEach((app) => {
      if (!app.application_date) return;
      const date = new Date(app.application_date);
      if (Number.isNaN(date.getTime())) return;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, count]) => ({ month, count }));
  }, [applications]);

  const active = useMemo(
    () => applications.filter((app) => app.outcome === "In Progress"),
    [applications]
  );

  const alerts = useMemo(() => {
    const items: Array<{
      id: string;
      type: "Follow-Up" | "To-Do";
      company: string;
      detail: string;
      date?: string | null;
      status: ReturnType<typeof followupStatus>;
    }> = [];

    applications.forEach((app) => {
      const followupStatusValue = followupStatus(app.followup_date);
      if (followupStatusValue === "overdue" || followupStatusValue === "soon") {
        items.push({
          id: `${app.application_id}-followup`,
          type: "Follow-Up",
          company: app.company_name,
          detail: app.position,
          date: app.followup_date,
          status: followupStatusValue
        });
      }

      (app.todo_items || []).forEach((todo) => {
        const todoStatus = followupStatus(todo.due_date);
        if (todoStatus === "overdue" || todoStatus === "soon") {
          items.push({
            id: `${app.application_id}-todo-${todo.id}`,
            type: "To-Do",
            company: app.company_name,
            detail: todo.task,
            date: todo.due_date,
            status: todoStatus
          });
        }
      });
    });

    return items;
  }, [applications]);

  const renderChartShell = (chart: React.ReactElement, className?: string) => (
    <div className={`chart-shell${className ? ` ${className}` : ""}`}>
      <ResponsiveContainer width="100%" height="100%">
        {chart}
      </ResponsiveContainer>
    </div>
  );

  const renderOutcomeChart = () => (
    <BarChart data={outcomeData} margin={{ top: 8, right: 20, left: 20, bottom: 40 }}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis
        dataKey="name"
        interval={0}
        angle={-25}
        textAnchor="end"
        height={60}
        padding={{ left: 8, right: 8 }}
        tickFormatter={(value) => truncateLabel(String(value))}
        tick={{ fontSize: 11 }}
      />
      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
      <Tooltip />
      <Bar dataKey="value" fill="#2B6CB0" radius={[6, 6, 0, 0]} />
    </BarChart>
  );

  const renderStageChart = () => (
    <BarChart data={stageData} margin={{ top: 8, right: 20, left: 20, bottom: 40 }}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis
        dataKey="name"
        interval={0}
        angle={-25}
        textAnchor="end"
        height={60}
        padding={{ left: 8, right: 8 }}
        tickFormatter={(value) => truncateLabel(String(value))}
        tick={{ fontSize: 11 }}
      />
      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
      <Tooltip />
      <Bar dataKey="value" fill="#D69E2E" radius={[6, 6, 0, 0]} />
    </BarChart>
  );

  const renderTimelineChart = () => (
    <LineChart data={timelineData} margin={{ top: 8, right: 20, left: 20, bottom: 32 }}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="month" tick={{ fontSize: 11 }} padding={{ left: 8, right: 8 }} />
      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
      <Tooltip />
      <Line type="monotone" dataKey="count" stroke="#2F855A" strokeWidth={3} />
    </LineChart>
  );

  const renderScoreChart = () => (
    <BarChart data={scoreData} margin={{ top: 8, right: 20, left: 20, bottom: 32 }}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="score" tick={{ fontSize: 11 }} padding={{ left: 8, right: 8 }} />
      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
      <Tooltip />
      <Bar dataKey="value" fill="#2F855A" radius={[6, 6, 0, 0]} />
    </BarChart>
  );

  const chartPanels: Array<{
    key: ChartKey;
    title: string;
    render: () => React.ReactElement;
  }> = [
    { key: "outcomes", title: "Outcomes Distribution", render: renderOutcomeChart },
    { key: "stages", title: "Applications per Stage", render: renderStageChart },
    { key: "timeline", title: "Timeline Applications", render: renderTimelineChart },
    { key: "score", title: "Score Distribution", render: renderScoreChart }
  ];

  const expandedConfig = expandedChart
    ? chartPanels.find((panel) => panel.key === expandedChart) ?? null
    : null;

  const resolveDashboardSlot = useCallback<BlockSlotResolver>(
    (slotId) => {
      if (slotId === "dashboard:kpi:total:value") return metrics.total;
      if (slotId === "dashboard:kpi:offers:value") return metrics.offers;
      if (slotId === "dashboard:kpi:rejected:value") return metrics.rejected;
      if (slotId === "dashboard:kpi:active:value") return metrics.active;
      if (slotId === "dashboard:kpi:favorites:value") return metrics.favorites;
      if (slotId === "dashboard:kpi:success:value") return metrics.successRate;
      if (slotId === "dashboard:kpi:avgscore:value") return metrics.avgScore ? metrics.avgScore.toFixed(2) : t("N/A");

      if (slotId === "dashboard:chart:outcomes:action") {
        return (
          <button
            className="icon-button chart-expand"
            type="button"
            onClick={() => setExpandedChart("outcomes")}
            aria-label={t("Expand {title}", { title: t("Outcomes Distribution") })}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M11 3a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0V4.41l-4.29 4.3a1 1 0 0 1-1.42-1.42L14.59 3H12a1 1 0 0 1-1-1Zm-2 14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-5a1 1 0 1 1 2 0v3.59l4.29-4.3a1 1 0 1 1 1.42 1.42L5.41 16H8a1 1 0 0 1 1 1Z" />
            </svg>
          </button>
        );
      }
      if (slotId === "dashboard:chart:stages:action") {
        return (
          <button
            className="icon-button chart-expand"
            type="button"
            onClick={() => setExpandedChart("stages")}
            aria-label={t("Expand {title}", { title: t("Applications per Stage") })}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M11 3a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0V4.41l-4.29 4.3a1 1 0 0 1-1.42-1.42L14.59 3H12a1 1 0 0 1-1-1Zm-2 14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-5a1 1 0 1 1 2 0v3.59l4.29-4.3a1 1 0 1 1 1.42 1.42L5.41 16H8a1 1 0 0 1 1 1Z" />
            </svg>
          </button>
        );
      }
      if (slotId === "dashboard:chart:timeline:action") {
        return (
          <button
            className="icon-button chart-expand"
            type="button"
            onClick={() => setExpandedChart("timeline")}
            aria-label={t("Expand {title}", { title: t("Timeline Applications") })}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M11 3a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0V4.41l-4.29 4.3a1 1 0 0 1-1.42-1.42L14.59 3H12a1 1 0 0 1-1-1Zm-2 14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-5a1 1 0 1 1 2 0v3.59l4.29-4.3a1 1 0 1 1 1.42 1.42L5.41 16H8a1 1 0 0 1 1 1Z" />
            </svg>
          </button>
        );
      }
      if (slotId === "dashboard:chart:score:action") {
        return (
          <button
            className="icon-button chart-expand"
            type="button"
            onClick={() => setExpandedChart("score")}
            aria-label={t("Expand {title}", { title: t("Score Distribution") })}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M11 3a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0V4.41l-4.29 4.3a1 1 0 0 1-1.42-1.42L14.59 3H12a1 1 0 0 1-1-1Zm-2 14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-5a1 1 0 1 1 2 0v3.59l4.29-4.3a1 1 0 1 1 1.42 1.42L5.41 16H8a1 1 0 0 1 1 1Z" />
            </svg>
          </button>
        );
      }

      if (slotId === "dashboard:chart:outcomes:content") return renderChartShell(renderOutcomeChart());
      if (slotId === "dashboard:chart:stages:content") return renderChartShell(renderStageChart());
      if (slotId === "dashboard:chart:timeline:content") return renderChartShell(renderTimelineChart());
      if (slotId === "dashboard:chart:score:content") return renderChartShell(renderScoreChart());

      if (slotId === "dashboard:table:alerts:content") {
        return alerts.length === 0 ? (
          <div className="empty">{t("No event alerts.")}</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t("Type")}</th>
                <th>{t("Company")}</th>
                <th>{t("Detail")}</th>
                <th>{t("Date")}</th>
                <th>{t("Status")}</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((item) => (
                <tr key={item.id}>
                  <td>{item.type}</td>
                  <td>{item.company}</td>
                  <td>{item.detail}</td>
                  <td>{formatDate(item.date)}</td>
                  <td>
                    <span className={`tag tag-${item.status}`}>{item.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      }

      if (slotId === "dashboard:table:active:content") {
        return active.length === 0 ? (
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
        );
      }

      return null;
    },
    [
      active,
      alerts,
      metrics.active,
      metrics.avgScore,
      metrics.favorites,
      metrics.offers,
      metrics.rejected,
      metrics.successRate,
      metrics.total,
      t
    ]
  );

  return (
    <>
      <PageBuilderPage pageId="dashboard" className="dashboard" resolveSlot={resolveDashboardSlot} />

      {!settings && <div className="empty">{t("Loading settings...")}</div>}

      {expandedConfig && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={() => setExpandedChart(null)}
        >
          <div className="modal chart-modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <div>
                <h2>{expandedConfig.title}</h2>
              </div>
              <button
                className="ghost"
                onClick={() => setExpandedChart(null)}
                type="button"
                aria-label={t("Close")}
              >
                x
              </button>
            </header>
            {renderChartShell(expandedConfig.render(), "chart-shell-lg")}
          </div>
        </div>
      )}
    </>
  );
};

export default DashboardPage;
