import React from "react";

export type SourceTablePreviewData = {
  columns: string[];
  rows: string[][];
};

type SourceTablePreviewProps = {
  table: SourceTablePreviewData;
  title?: string;
  maxRows?: number;
  keyPrefix?: string;
  emptyMessage?: string;
};

export const SourceTablePreview: React.FC<SourceTablePreviewProps> = ({
  table,
  title = "Vista previa de tabla",
  maxRows = 12,
  keyPrefix = "table-preview",
  emptyMessage = "Sin filas en esta tabla."
}) => {
  const previewRows = table.rows.slice(0, maxRows);

  return (
    <section className="block-source-preview">
      <div className="block-source-preview-head">
        <h3>{title}</h3>
        <p>
          {table.rows.length} filas
          {table.rows.length > previewRows.length ? ` (mostrando ${previewRows.length})` : ""}
        </p>
      </div>
      <div className="table-scroll block-source-preview-scroll">
        <table className="table block-source-preview-table">
          <thead>
            <tr>
              {table.columns.map((column, columnIndex) => (
                <th key={`${keyPrefix}-head-${columnIndex}`} title={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.length === 0 ? (
              <tr>
                <td colSpan={Math.max(1, table.columns.length)}>{emptyMessage}</td>
              </tr>
            ) : (
              previewRows.map((row, rowIndex) => (
                <tr key={`${keyPrefix}-row-${rowIndex}`}>
                  {table.columns.map((_, colIndex) => {
                    const cellValue = row[colIndex] || "";
                    return (
                      <td key={`${keyPrefix}-cell-${rowIndex}-${colIndex}`}>
                        <span className="block-preview-cell" title={cellValue}>
                          {cellValue}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
