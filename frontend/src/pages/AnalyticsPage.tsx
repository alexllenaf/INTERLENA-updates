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
import { useAppData } from "../state";
import { formatDate } from "../utils";

const AnalyticsPage: React.FC = () => {
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

  return (
    <div className="analytics">
      <section className="panel">
        <h2>Analytics</h2>
        <p>Break down outcomes, stages, and score distribution.</p>
      </section>

      <section className="grid charts">
        <div className="panel">
          <h3>Outcomes</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={outcomes}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" fill="#2B6CB0" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="panel">
          <h3>Stages</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={stages}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" fill="#D69E2E" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="panel">
          <h3>Score Distribution</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={scoreData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="score" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" fill="#2F855A" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel">
        <h3>Active Processes</h3>
        {active.length === 0 ? (
          <div className="empty">No active processes.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Position</th>
                <th>Stage</th>
                <th>Application Date</th>
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
        )}
      </section>
    </div>
  );
};

export default AnalyticsPage;
