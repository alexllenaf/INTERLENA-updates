import React, { useEffect, useState } from "react";
import { getDatabaseRecords } from "../../../api";
import { DatabaseRecordsResult } from "../../../types";
import BlockPanel from "../../BlockPanel";
import { type BlockDefinition, type BlockRenderContext } from "./types";

const renderValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
};

const DatabaseViewBlock: React.FC<BlockRenderContext<"databaseView">> = ({
  block,
  mode,
  updateBlockProps,
  patchBlockProps,
  menuActions
}) => {
  void updateBlockProps;
  const [payload, setPayload] = useState<DatabaseRecordsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const databaseId = (block.props.databaseId || "").trim();
  const viewId = (block.props.viewId || "").trim();

  useEffect(() => {
    let active = true;
    if (!databaseId) {
      setPayload(null);
      setError(null);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setError(null);
    getDatabaseRecords(databaseId, { view_id: viewId || undefined })
      .then((next) => {
        if (!active) return;
        setPayload(next);
      })
      .catch((err) => {
        if (!active) return;
        setPayload(null);
        setError(err instanceof Error ? err.message : "Unable to load records.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [databaseId, viewId]);

  const columns = payload?.properties || [];
  const rows = payload?.records || [];
  const emptyMessage = block.props.emptyMessage || "No records for this view.";

  return (
    <BlockPanel id={block.id} as="section" menuActions={menuActions}>
      <div className="table-panel-header">
        <h3>{block.props.title || "Database View"}</h3>
        {block.props.description ? <p>{block.props.description}</p> : null}
      </div>

      {mode === "edit" ? (
        <div className="table-panel-toolbar" style={{ gap: 8, flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <small>Database ID</small>
            <input
              className="settings-input"
              value={databaseId}
              onChange={(event) => patchBlockProps({ databaseId: event.target.value })}
              placeholder="Database UUID"
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <small>View ID</small>
            <input
              className="settings-input"
              value={viewId}
              onChange={(event) => patchBlockProps({ viewId: event.target.value })}
              placeholder="Optional view UUID"
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 220 }}>
            <small>Title</small>
            <input
              className="settings-input"
              value={block.props.title || ""}
              onChange={(event) => patchBlockProps({ title: event.target.value })}
              placeholder="Database view"
            />
          </label>
        </div>
      ) : null}

      {loading ? <div className="empty">Loading records...</div> : null}
      {!loading && error ? <div className="alert">{error}</div> : null}

      {!loading && !error && rows.length === 0 ? <div className="empty">{emptyMessage}</div> : null}

      {!loading && !error && rows.length > 0 ? (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column.id}>{column.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {columns.map((column) => (
                    <td key={`${row.id}:${column.id}`}>{renderValue(row.properties?.[column.name]) || "-"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </BlockPanel>
  );
};

export const DATABASE_VIEW_BLOCK_DEFINITION: BlockDefinition<"databaseView"> = {
  type: "databaseView",
  defaultLayout: { colSpan: 60 },
  createDefaultProps: () => ({
    title: "Database View",
    description: "Render records from a canonical database view.",
    databaseId: "",
    viewId: "",
    emptyMessage: "No records for this view."
  }),
  component: ({
    block,
    mode,
    updateBlockProps,
    patchBlockProps,
    updateBlockLayout,
    patchBlockLayout,
    menuActions
  }) => (
    <DatabaseViewBlock
      block={block}
      mode={mode}
      updateBlockProps={updateBlockProps}
      patchBlockProps={patchBlockProps}
      updateBlockLayout={updateBlockLayout}
      patchBlockLayout={patchBlockLayout}
      menuActions={menuActions}
    />
  )
};
