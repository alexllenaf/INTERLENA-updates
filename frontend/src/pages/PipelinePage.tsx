import React, { useRef, useState } from "react";
import BlockPanel from "../components/BlockPanel";
import StarRating from "../components/StarRating";
import { useI18n } from "../i18n";
import { useAppData } from "../state";
import { Application, ApplicationInput } from "../types";
import { followupStatus, formatDateTime } from "../utils";

const PipelinePage: React.FC = () => {
  const { t } = useI18n();
  const { applications, settings, updateApplication, saveSettings } = useAppData();
  const [draggedStage, setDraggedStage] = useState<string | null>(null);
  const [stageDragOver, setStageDragOver] = useState<string | null>(null);
  const [draggedApp, setDraggedApp] = useState<{ id: number; stage: string } | null>(null);
  const [dragOverAppId, setDragOverAppId] = useState<number | null>(null);
  const [dragOverAppStage, setDragOverAppStage] = useState<string | null>(null);
  // Keep drag source in a ref so drop handlers work reliably even if React doesn't re-render during drag.
  const draggedStageRef = useRef<string | null>(null);
  const draggedAppRef = useRef<{ id: number; stage: string } | null>(null);

  if (!settings) {
    return <div className="empty">{t("Loading settings...")}</div>;
  }

  const stages = settings.stages;

  const getStageItems = (stage: string) => {
    const items = applications.filter((app) => app.stage === stage);
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

  const resetStageDrag = () => {
    draggedStageRef.current = null;
    setDraggedStage(null);
    setStageDragOver(null);
  };

  const resetAppDrag = () => {
    draggedAppRef.current = null;
    setDraggedApp(null);
    setDragOverAppId(null);
    setDragOverAppStage(null);
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

  const handleStageDrop = async (targetStage: string) => {
    const fromStage = draggedStageRef.current;
    if (!fromStage || fromStage === targetStage) {
      resetStageDrag();
      return;
    }
    const nextStages = reorderList(stages, fromStage, targetStage);
    if (nextStages !== stages) {
      await saveSettings({ ...settings, stages: nextStages });
    }
    resetStageDrag();
  };

  const handleAppDrop = async (targetStage: string, targetId: number | null) => {
    const dragged = draggedAppRef.current;
    if (!dragged) return;
    const { id: draggedId, stage: sourceStage } = dragged;
    if (targetId === draggedId) {
      resetAppDrag();
      return;
    }
    const draggedItem = applications.find((app) => app.id === draggedId);
    if (!draggedItem) {
      resetAppDrag();
      return;
    }
    const sourceItems = getStageItems(sourceStage);
    const targetItems = sourceStage === targetStage ? sourceItems : getStageItems(targetStage);
    const sourceWithout = sourceItems.filter((item) => item.id !== draggedId);
    const insertionBase = sourceStage === targetStage ? sourceWithout : targetItems;
    let insertIndex = targetId
      ? insertionBase.findIndex((item) => item.id === targetId)
      : insertionBase.length;
    if (insertIndex < 0) insertIndex = insertionBase.length;
    const nextTarget = [...insertionBase];
    nextTarget.splice(insertIndex, 0, draggedItem);
    if (sourceStage === targetStage) {
      await syncStageOrder(targetStage, nextTarget);
    } else {
      await Promise.all([
        syncStageOrder(targetStage, nextTarget),
        syncStageOrder(sourceStage, sourceWithout)
      ]);
    }
    resetAppDrag();
  };

  return (
    <div className="pipeline">
      <BlockPanel id="pipeline:intro" as="section">
        <h2>{t("Pipeline")}</h2>
        <p>{t("Drag or push opportunities across stages as you progress.")}</p>
      </BlockPanel>
      <div className="pipeline-grid">
        {stages.map((stage, index) => {
          const items = getStageItems(stage);
          const isStageDragOver = stageDragOver === stage;
          const isAppDrop = Boolean(draggedApp && dragOverAppStage === stage);
          return (
            <div
              key={stage}
              className={`pipeline-column${isStageDragOver ? " stage-drag-over" : ""}${
                isAppDrop ? " app-drop" : ""
              }`}
            >
              <div
                className="pipeline-header draggable"
                draggable={!draggedApp}
                onDragStart={(event) => {
                  if (draggedAppRef.current) return;
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", stage);
                  draggedStageRef.current = stage;
                  setDraggedStage(stage);
                }}
                onDragOver={(event) => {
                  const currentDraggedStage = draggedStageRef.current;
                  const currentDraggedApp = draggedAppRef.current;
                  if (currentDraggedStage && currentDraggedStage !== stage) {
                    event.preventDefault();
                    setStageDragOver(stage);
                    return;
                  }
                  if (currentDraggedApp) {
                    event.preventDefault();
                    setDragOverAppStage(stage);
                    setDragOverAppId(null);
                  }
                }}
                onDragLeave={() => {
                  if (stageDragOver === stage) setStageDragOver(null);
                }}
                onDrop={(event) => {
                  const currentDraggedStage = draggedStageRef.current;
                  const currentDraggedApp = draggedAppRef.current;
                  if (currentDraggedStage && currentDraggedStage !== stage) {
                    event.preventDefault();
                    handleStageDrop(stage);
                    return;
                  }
                  if (currentDraggedApp) {
                    event.preventDefault();
                    handleAppDrop(stage, null);
                  }
                }}
                onDragEnd={() => {
                  resetStageDrag();
                }}
              >
                <div className="pipeline-header-title">
                  <span className="pipeline-drag-handle" aria-hidden="true" />
                  <span className="tag" style={{ background: settings.stage_colors[stage] || "#E2E8F0" }}>
                    {stage}
                  </span>
                </div>
                <span>{items.length}</span>
              </div>
              <div
                className="pipeline-cards"
                onDragOver={(event) => {
                  if (!draggedAppRef.current) return;
                  event.preventDefault();
                  setDragOverAppStage(stage);
                  setDragOverAppId(null);
                }}
                onDrop={(event) => {
                  if (!draggedAppRef.current) return;
                  event.preventDefault();
                  handleAppDrop(stage, null);
                }}
              >
                {items.length === 0 && <div className="empty">{t("No items")}</div>}
                {items.map((app) => {
                  const leftStage = index > 0 ? stages[index - 1] : null;
                  const rightStage = index < stages.length - 1 ? stages[index + 1] : null;
                  const followupState = followupStatus(app.followup_date);
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
                        draggedAppRef.current = { id: app.id, stage: app.stage };
                        setDraggedApp({ id: app.id, stage: app.stage });
                      }}
                      onDragOver={(event) => {
                        const currentDraggedApp = draggedAppRef.current;
                        if (!currentDraggedApp || currentDraggedApp.id === app.id) return;
                        event.preventDefault();
                        setDragOverAppId(app.id);
                        setDragOverAppStage(stage);
                      }}
                      onDragLeave={() => {
                        if (dragOverAppId === app.id) setDragOverAppId(null);
                      }}
                      onDrop={(event) => {
                        if (!draggedAppRef.current) return;
                        event.preventDefault();
                        handleAppDrop(stage, app.id);
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
                          onClick={() => leftStage && updateApplication(app.id, { stage: leftStage })}
                          disabled={!leftStage}
                        >
                          ←
                        </button>
                        <span>{app.stage}</span>
                        <button
                          className="ghost"
                          onClick={() => rightStage && updateApplication(app.id, { stage: rightStage })}
                          disabled={!rightStage}
                        >
                          →
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
    </div>
  );
};

export default PipelinePage;
