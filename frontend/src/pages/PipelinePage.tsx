import React, { useMemo, useRef, useState } from "react";
import StarRating from "../components/StarRating";
import { BlockSlotResolver, PageBuilderPage } from "../components/pageBuilder";
import {
  PIPELINE_SOURCE_TABLE_LINK_KEY,
  collectEditableTableTargets,
  getBlockLink,
  type EditableTableTarget
} from "../components/pageBuilder/blockLinks";
import { type EditableTableColumnKind } from "../components/pageBuilder/types";
import { useI18n } from "../i18n";
import { useAppData } from "../state";
import { type Application, type ApplicationInput, type CustomProperty, type Settings } from "../types";
import { followupStatus, formatDateTime } from "../utils";
import {
  TRACKER_BASE_COLUMN_ORDER,
  TRACKER_COLUMN_LABELS,
  TRACKER_COLUMN_KINDS
} from "../shared/columnSchema";
import {
  isRecord,
  normalizeString,
  normalizeStringArray,
  normalizeCustomProperties,
  customPropertyKind
} from "../shared/normalize";

type TrackerColumnProjection = {
  labelToKey: Record<string, string>;
  kindByKey: Record<string, EditableTableColumnKind>;
};

type PipelineGroupingConfig = {
  key: string;
  values: string[];
  colors: Record<string, string>;
  allowColumnReorder: boolean;
};

const DEFAULT_COLUMN_COLOR = "#E2E8F0";

const createUniqueLabel = (label: string, used: Set<string>): string => {
  const base = label.trim() || "Column";
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let attempt = 2;
  while (used.has(`${base} (${attempt})`)) {
    attempt += 1;
  }
  const next = `${base} (${attempt})`;
  used.add(next);
  return next;
};

const reorderList = (list: string[], fromLabel: string, toLabel: string) => {
  if (fromLabel === toLabel) return list;
  const next = [...list];
  const fromIndex = next.indexOf(fromLabel);
  const toIndex = next.indexOf(toLabel);
  if (fromIndex < 0 || toIndex < 0) return list;
  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, fromLabel);
  return next;
};

const readGroupValue = (app: Application, key: string): string => {
  if (key.startsWith("prop__")) {
    const propertyKey = key.slice("prop__".length);
    return app.properties?.[propertyKey] || "";
  }
  const raw = (app as Record<string, unknown>)[key];
  if (raw === null || raw === undefined) return "";
  return String(raw);
};

const buildGroupUpdatePayload = (
  app: Application,
  key: string,
  nextValue: string
): Partial<ApplicationInput> => {
  if (key.startsWith("prop__")) {
    const propertyKey = key.slice("prop__".length);
    return {
      properties: {
        ...(app.properties || {}),
        [propertyKey]: nextValue
      }
    };
  }
  if (key === "stage" || key === "outcome" || key === "job_type") {
    return { [key]: nextValue } as Partial<ApplicationInput>;
  }
  return { [key]: nextValue } as Partial<ApplicationInput>;
};

const isTrackerSourceTarget = (target: EditableTableTarget): boolean => {
  const schemaRef = normalizeString(target.props.schemaRef);
  const contentSlotId = normalizeString(target.props.contentSlotId);
  return (
    schemaRef === "tracker.applications@1" ||
    target.pageId === "tracker" ||
    target.blockId === "tracker:table" ||
    contentSlotId.startsWith("tracker:content")
  );
};

const buildTrackerColumnProjection = (
  settings: Settings,
  targetProps: Record<string, unknown>
): TrackerColumnProjection => {
  const columnLabels = isRecord(settings.column_labels)
    ? (settings.column_labels as Record<string, unknown>)
    : {};
  const customProps = Array.isArray(settings.custom_properties) ? settings.custom_properties : [];
  const customPropByKey = new Map(customProps.map((prop) => [prop.key, prop]));
  const overrideOrder = isRecord(targetProps.overrides)
    ? normalizeStringArray((targetProps.overrides as Record<string, unknown>).columnOrder)
    : [];
  const settingsOrder = normalizeStringArray(settings.table_columns);

  const orderedKeys: string[] = [];
  const pushKey = (key: string) => {
    const normalized = key.trim();
    if (!normalized || orderedKeys.includes(normalized)) return;
    orderedKeys.push(normalized);
  };

  (overrideOrder.length > 0 ? overrideOrder : settingsOrder).forEach(pushKey);
  TRACKER_BASE_COLUMN_ORDER.forEach(pushKey);
  customProps.forEach((prop) => pushKey(`prop__${prop.key}`));

  const labelToKey: Record<string, string> = {};
  const kindByKey: Record<string, EditableTableColumnKind> = {};
  const usedLabels = new Set<string>();

  orderedKeys.forEach((key) => {
    const labelOverride = columnLabels[key];
    let labelSeed = typeof labelOverride === "string" ? labelOverride.trim() : "";
    let kind: EditableTableColumnKind = "text";

    if (key.startsWith("prop__")) {
      const propKey = key.slice("prop__".length);
      const prop = customPropByKey.get(propKey) || null;
      if (!labelSeed) labelSeed = prop?.name || key;
      kind = customPropertyKind(prop);
    } else {
      if (!labelSeed) labelSeed = TRACKER_COLUMN_LABELS[key] || key;
      kind = TRACKER_COLUMN_KINDS[key] || "text";
    }

    const label = createUniqueLabel(labelSeed || key, usedLabels);
    labelToKey[label] = key;
    kindByKey[key] = kind;
  });

  return {
    labelToKey,
    kindByKey
  };
};

const buildPipelineGroupingConfig = (
  blockProps: Record<string, unknown>,
  settings: Settings,
  applications: Application[],
  tableTargets: EditableTableTarget[]
): PipelineGroupingConfig => {
  let sourceKey = "stage";
  let baseValues = normalizeStringArray(settings.stages);
  let colors: Record<string, string> = settings.stage_colors || {};
  let allowColumnReorder = true;

  const linkedTableId = getBlockLink(blockProps, PIPELINE_SOURCE_TABLE_LINK_KEY);
  const sourceColumn = normalizeString(blockProps.sourceColumn);
  const linkedTableTarget = linkedTableId
    ? tableTargets.find((target) => target.blockId === linkedTableId) || null
    : null;

  if (linkedTableTarget && sourceColumn && isTrackerSourceTarget(linkedTableTarget)) {
    const projection = buildTrackerColumnProjection(settings, linkedTableTarget.props);
    const resolvedKey = projection.labelToKey[sourceColumn];
    if (resolvedKey && projection.kindByKey[resolvedKey] === "select") {
      sourceKey = resolvedKey;
      allowColumnReorder = sourceKey === "stage";

      if (sourceKey === "stage") {
        baseValues = normalizeStringArray(settings.stages);
        colors = settings.stage_colors || {};
      } else if (sourceKey === "outcome") {
        baseValues = normalizeStringArray(settings.outcomes);
        colors = settings.outcome_colors || {};
      } else if (sourceKey === "job_type") {
        baseValues = normalizeStringArray(settings.job_types);
        colors = settings.job_type_colors || {};
      } else if (sourceKey.startsWith("prop__")) {
        const propertyKey = sourceKey.slice("prop__".length);
        const customProp =
          settings.custom_properties.find((prop) => prop.key === propertyKey && prop.type === "select") || null;
        baseValues = customProp
          ? customProp.options
              .map((option) => normalizeString(option.label))
              .filter(Boolean)
          : [];
        colors = customProp
          ? Object.fromEntries(
              customProp.options
                .map((option) => [normalizeString(option.label), normalizeString(option.color) || DEFAULT_COLUMN_COLOR])
                .filter(([label]) => Boolean(label))
            )
          : {};
      }
    }
  }

  const values: string[] = [];
  const seen = new Set<string>();
  const pushValue = (value: string) => {
    const normalized = normalizeString(value);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    values.push(normalized);
  };

  baseValues.forEach(pushValue);

  let hasEmptyValues = false;
  applications.forEach((app) => {
    const value = normalizeString(readGroupValue(app, sourceKey));
    if (!value) {
      hasEmptyValues = true;
      return;
    }
    pushValue(value);
  });

  if (hasEmptyValues) {
    pushValue("");
  }

  if (values.length === 0) {
    values.push("");
  }

  return {
    key: sourceKey,
    values,
    colors,
    allowColumnReorder
  };
};

const PipelinePage: React.FC = () => {
  const { t } = useI18n();
  const { applications, settings, updateApplication, saveSettings } = useAppData();
  const [columnDragOver, setColumnDragOver] = useState<string | null>(null);
  const [draggedApp, setDraggedApp] = useState<{ id: number; columnValue: string } | null>(null);
  const [dragOverAppId, setDragOverAppId] = useState<number | null>(null);
  const [dragOverAppColumn, setDragOverAppColumn] = useState<string | null>(null);
  const draggedColumnRef = useRef<string | null>(null);
  const draggedAppRef = useRef<{ id: number; columnValue: string } | null>(null);

  if (!settings) {
    return <div className="empty">{t("Loading settings...")}</div>;
  }

  const tableTargets = useMemo(
    () => collectEditableTableTargets(settings, { excludeVariants: ["todo"], excludeTypes: ["todoTable"] }),
    [settings]
  );

  const resetColumnDrag = () => {
    draggedColumnRef.current = null;
    setColumnDragOver(null);
  };

  const resetAppDrag = () => {
    draggedAppRef.current = null;
    setDraggedApp(null);
    setDragOverAppId(null);
    setDragOverAppColumn(null);
  };

  const syncStageOrder = async (stage: string, ordered: Application[]) => {
    const updates = ordered
      .map((app, index) => {
        const payload: Partial<ApplicationInput> = {};
        if (app.pipeline_order !== index) {
          payload.pipeline_order = index;
        }
        if (app.stage !== stage) {
          payload.stage = stage;
        }
        if (Object.keys(payload).length === 0) return null;
        return updateApplication(app.id, payload);
      })
      .filter(Boolean) as Promise<void>[];
    if (updates.length === 0) return;
    await Promise.all(updates);
  };

  const resolvePipelineSlot: BlockSlotResolver = (slotId, block) => {
    if (slotId !== "pipeline:board:content") return null;

    const blockProps = isRecord(block.props) ? block.props : {};
    const grouping = buildPipelineGroupingConfig(blockProps, settings, applications, tableTargets);
    const columns = grouping.values;

    const getColumnItems = (columnValue: string) => {
      const items = applications.filter((app) => normalizeString(readGroupValue(app, grouping.key)) === columnValue);
      if (grouping.key !== "stage") return items;

      const fullyOrdered =
        items.length > 0 &&
        items.every((app) => app.pipeline_order !== null && app.pipeline_order !== undefined);
      if (!fullyOrdered) return items;
      return [...items]
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
          const aOrder = a.item.pipeline_order ?? 0;
          const bOrder = b.item.pipeline_order ?? 0;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return a.index - b.index;
        })
        .map(({ item }) => item);
    };

    const reorderableStages = normalizeStringArray(settings.stages);
    const reorderableStageSet = new Set(reorderableStages);

    const handleColumnDrop = async (targetColumn: string) => {
      if (!grouping.allowColumnReorder || grouping.key !== "stage") {
        resetColumnDrag();
        return;
      }
      const fromColumn = draggedColumnRef.current;
      if (!fromColumn || fromColumn === targetColumn) {
        resetColumnDrag();
        return;
      }
      if (!reorderableStageSet.has(fromColumn) || !reorderableStageSet.has(targetColumn)) {
        resetColumnDrag();
        return;
      }
      const nextStages = reorderList(reorderableStages, fromColumn, targetColumn);
      if (nextStages !== reorderableStages) {
        await saveSettings({ stages: nextStages });
      }
      resetColumnDrag();
    };

    const handleAppDrop = async (targetColumn: string, targetId: number | null) => {
      const dragged = draggedAppRef.current;
      if (!dragged) return;
      const { id: draggedId, columnValue: sourceColumn } = dragged;
      if (targetId === draggedId) {
        resetAppDrag();
        return;
      }

      const draggedItem = applications.find((app) => app.id === draggedId);
      if (!draggedItem) {
        resetAppDrag();
        return;
      }

      if (grouping.key === "stage") {
        const sourceItems = getColumnItems(sourceColumn);
        const targetItems = sourceColumn === targetColumn ? sourceItems : getColumnItems(targetColumn);
        const sourceWithout = sourceItems.filter((item) => item.id !== draggedId);
        const insertionBase = sourceColumn === targetColumn ? sourceWithout : targetItems;
        let insertIndex = targetId
          ? insertionBase.findIndex((item) => item.id === targetId)
          : insertionBase.length;
        if (insertIndex < 0) insertIndex = insertionBase.length;

        const nextTarget = [...insertionBase];
        nextTarget.splice(insertIndex, 0, draggedItem);

        if (sourceColumn === targetColumn) {
          await syncStageOrder(targetColumn, nextTarget);
        } else {
          await Promise.all([
            syncStageOrder(targetColumn, nextTarget),
            syncStageOrder(sourceColumn, sourceWithout)
          ]);
        }
      } else {
        const currentValue = normalizeString(readGroupValue(draggedItem, grouping.key));
        if (currentValue !== targetColumn) {
          await updateApplication(draggedItem.id, buildGroupUpdatePayload(draggedItem, grouping.key, targetColumn));
        }
      }

      resetAppDrag();
    };

    const moveAppToColumn = async (app: Application, targetColumn: string) => {
      if (grouping.key === "stage") {
        await updateApplication(app.id, { stage: targetColumn });
        return;
      }
      await updateApplication(app.id, buildGroupUpdatePayload(app, grouping.key, targetColumn));
    };

    return (
      <div className="pipeline-grid">
        {columns.map((column, index) => {
          const items = getColumnItems(column);
          const canDragColumn = grouping.allowColumnReorder && reorderableStageSet.has(column);
          const isColumnDragOver = columnDragOver === column;
          const isAppDrop = Boolean(draggedApp && dragOverAppColumn === column);
          const columnLabel = column || "Sin valor";
          const columnColor = column ? grouping.colors[column] || DEFAULT_COLUMN_COLOR : DEFAULT_COLUMN_COLOR;

          return (
            <div
              key={`${grouping.key}:${column || "empty"}`}
              className={`pipeline-column${isColumnDragOver ? " stage-drag-over" : ""}${
                isAppDrop ? " app-drop" : ""
              }`}
            >
              <div
                className={`pipeline-header${canDragColumn ? " draggable" : ""}`}
                draggable={canDragColumn && !draggedApp}
                onDragStart={(event) => {
                  if (!canDragColumn || draggedAppRef.current) return;
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", column);
                  draggedColumnRef.current = column;
                }}
                onDragOver={(event) => {
                  const currentDraggedColumn = draggedColumnRef.current;
                  const currentDraggedApp = draggedAppRef.current;
                  if (canDragColumn && currentDraggedColumn && currentDraggedColumn !== column) {
                    event.preventDefault();
                    setColumnDragOver(column);
                    return;
                  }
                  if (currentDraggedApp) {
                    event.preventDefault();
                    setDragOverAppColumn(column);
                    setDragOverAppId(null);
                  }
                }}
                onDragLeave={() => {
                  if (columnDragOver === column) setColumnDragOver(null);
                }}
                onDrop={(event) => {
                  const currentDraggedColumn = draggedColumnRef.current;
                  const currentDraggedApp = draggedAppRef.current;
                  if (canDragColumn && currentDraggedColumn && currentDraggedColumn !== column) {
                    event.preventDefault();
                    void handleColumnDrop(column);
                    return;
                  }
                  if (currentDraggedApp) {
                    event.preventDefault();
                    void handleAppDrop(column, null);
                  }
                }}
                onDragEnd={() => {
                  resetColumnDrag();
                }}
              >
                <div className="pipeline-header-title">
                  <span className="pipeline-drag-handle" aria-hidden="true" />
                  <span className="tag" style={{ background: columnColor }}>
                    {columnLabel}
                  </span>
                </div>
                <span>{items.length}</span>
              </div>
              <div
                className="pipeline-cards"
                onDragOver={(event) => {
                  if (!draggedAppRef.current) return;
                  event.preventDefault();
                  setDragOverAppColumn(column);
                  setDragOverAppId(null);
                }}
                onDrop={(event) => {
                  if (!draggedAppRef.current) return;
                  event.preventDefault();
                  void handleAppDrop(column, null);
                }}
              >
                {items.length === 0 && <div className="empty">{t("No items")}</div>}
                {items.map((app) => {
                  const followupState = followupStatus(app.followup_date);
                  const currentValue = normalizeString(readGroupValue(app, grouping.key));
                  const currentIndex = columns.indexOf(currentValue);
                  const leftColumn = currentIndex > 0 ? columns[currentIndex - 1] : null;
                  const rightColumn = currentIndex >= 0 && currentIndex < columns.length - 1
                    ? columns[currentIndex + 1]
                    : null;

                  return (
                    <div
                      key={app.id}
                      className={`pipeline-card${draggedApp?.id === app.id ? " dragging" : ""}${
                        dragOverAppId === app.id ? " drag-over" : ""
                      }`}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", String(app.id));
                        const startColumn = normalizeString(readGroupValue(app, grouping.key));
                        draggedAppRef.current = { id: app.id, columnValue: startColumn };
                        setDraggedApp({ id: app.id, columnValue: startColumn });
                      }}
                      onDragOver={(event) => {
                        const currentDraggedApp = draggedAppRef.current;
                        if (!currentDraggedApp || currentDraggedApp.id === app.id) return;
                        event.preventDefault();
                        setDragOverAppId(app.id);
                        setDragOverAppColumn(column);
                      }}
                      onDragLeave={() => {
                        if (dragOverAppId === app.id) setDragOverAppId(null);
                      }}
                      onDrop={(event) => {
                        if (!draggedAppRef.current) return;
                        event.preventDefault();
                        void handleAppDrop(column, app.id);
                      }}
                      onDragEnd={() => {
                        resetAppDrag();
                      }}
                    >
                      <span className="pipeline-card-handle" aria-hidden="true" />
                      <div className="pipeline-card-title">
                        <h4>{app.company_name}</h4>
                        <p>{app.position}</p>
                      </div>
                      <div className="pipeline-meta">
                        <span>{app.outcome}</span>
                        <span>{formatDateTime(app.interview_datetime)}</span>
                        <span className="pipeline-score">
                          <span>{t("Score")}</span>
                          <StarRating
                            value={app.my_interview_score ?? null}
                            size="sm"
                            step={0.5}
                            readonly
                          />
                        </span>
                        {followupState === "overdue" && (
                          <span className="tag tag-overdue">{t("Follow-up overdue")}</span>
                        )}
                        {followupState === "soon" && (
                          <span className="tag tag-soon">{t("Follow-up soon")}</span>
                        )}
                      </div>
                      <div className="pipeline-actions">
                        <button
                          className="ghost"
                          onClick={() => {
                            if (!leftColumn && leftColumn !== "") return;
                            void moveAppToColumn(app, leftColumn);
                          }}
                          disabled={leftColumn === null}
                        >
                          &larr;
                        </button>
                        <span>{currentValue || "Sin valor"}</span>
                        <button
                          className="ghost"
                          onClick={() => {
                            if (!rightColumn && rightColumn !== "") return;
                            void moveAppToColumn(app, rightColumn);
                          }}
                          disabled={rightColumn === null}
                        >
                          &rarr;
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return <PageBuilderPage pageId="pipeline" className="pipeline" resolveSlot={resolvePipelineSlot} />;
};

export default PipelinePage;
