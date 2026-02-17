import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import BlockPanel from "../BlockPanel";
import { AppBlockConfig, ChartSize } from "./types";

type EditableContent = {
  title?: string;
  description?: string;
  text?: string;
};

const editableStorageKey = (blockId: string) => `grid_block_content_v1:${blockId}`;

const readEditableContent = (blockId: string): EditableContent => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(editableStorageKey(blockId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as EditableContent;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
};

const writeEditableContent = (blockId: string, content: EditableContent) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(editableStorageKey(blockId), JSON.stringify(content));
  } catch {
    // ignore storage failures
  }
};

const useEditableContent = (blockId: string, initial: EditableContent) => {
  const [content, setContent] = useState<EditableContent>(() => ({
    ...initial,
    ...readEditableContent(blockId)
  }));

  React.useEffect(() => {
    setContent((prev) => ({
      ...initial,
      ...readEditableContent(blockId),
      ...prev
    }));
  }, [blockId, initial.description, initial.text, initial.title]);

  React.useEffect(() => {
    writeEditableContent(blockId, content);
  }, [blockId, content]);

  return [content, setContent] as const;
};

type AutoGrowTextareaProps = {
  value: string;
  className: string;
  placeholder?: string;
  onChange: (next: string) => void;
};

const AutoGrowTextarea: React.FC<AutoGrowTextareaProps> = ({ value, className, placeholder, onChange }) => {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      className={className}
      value={value}
      placeholder={placeholder}
      rows={1}
      onChange={(event) => onChange(event.target.value)}
    />
  );
};

const HeaderEditor: React.FC<{
  id: string;
  title: string;
  description: string;
  className?: string;
  actions?: React.ReactNode;
}> = ({ id, title, description, className = "", actions }) => {
  const [content, setContent] = useEditableContent(id, { title, description });

  return (
    <div className={["panel-header", "block-header-editor", className].filter(Boolean).join(" ")}>
      <div>
        <AutoGrowTextarea
          className="block-edit-title"
          value={content.title || ""}
          onChange={(next) => setContent((prev) => ({ ...prev, title: next }))}
        />
        <AutoGrowTextarea
          className="block-edit-description"
          value={content.description || ""}
          onChange={(next) => setContent((prev) => ({ ...prev, description: next }))}
        />
      </div>
      {actions ? <div className="block-header-actions">{actions}</div> : null}
    </div>
  );
};

const chartSizeClass = (size: ChartSize): string => {
  switch (size) {
    case "medium":
      return "chart-size-medium";
    case "large":
      return "chart-size-large";
    case "xlarge":
      return "chart-size-xlarge";
    default:
      return "chart-size-small";
  }
};

const BlockRenderer: React.FC<{ block: AppBlockConfig }> = ({ block }) => {
  const chartClassName = useMemo(() => {
    if (block.type !== "chart") return "";
    return chartSizeClass(block.data.size);
  }, [block]);

  switch (block.type) {
    case "text": {
      const [content, setContent] = useEditableContent(block.id, { text: block.data.text });
      return (
        <BlockPanel id={block.id} as="section">
          <AutoGrowTextarea
            className="block-edit-text"
            value={content.text || ""}
            onChange={(next) => setContent((prev) => ({ ...prev, text: next }))}
          />
        </BlockPanel>
      );
    }

    case "titleDescription": {
      return (
        <BlockPanel id={block.id} as="section">
          <HeaderEditor
            id={block.id}
            title={block.data.title}
            description={block.data.description}
            actions={block.data.actions}
          />
        </BlockPanel>
      );
    }

    case "editableTable": {
      return (
        <BlockPanel
          id={block.id}
          as="section"
          className={["table-panel-standard", block.data.panelClassName || ""].filter(Boolean).join(" ")}
        >
          <HeaderEditor
            id={`${block.id}:header`}
            title={block.data.title}
            description={block.data.description || ""}
            actions={block.data.actions}
          />
          {block.data.content}
        </BlockPanel>
      );
    }

    case "informationalTable": {
      return (
        <BlockPanel id={block.id} as="section">
          <HeaderEditor id={block.id} title={block.data.title} description={block.data.description} />
          {block.data.content}
        </BlockPanel>
      );
    }

    case "calendar": {
      return (
        <BlockPanel id={block.id} as="section">
          <HeaderEditor id={block.id} title={block.data.title} description={block.data.description} />
          {block.data.content}
        </BlockPanel>
      );
    }

    case "chart": {
      return (
        <BlockPanel id={block.id} as="section" className={`chart-panel ${chartClassName}`.trim()}>
          <div className="panel-header panel-header-inline">
            <h3>{block.data.title}</h3>
            {block.data.action}
          </div>
          {block.data.content}
        </BlockPanel>
      );
    }

    case "kpiCard": {
      return (
        <BlockPanel id={block.id} as="section" className="kpi-card-block">
          <p>{block.data.label}</p>
          <h2>{block.data.value}</h2>
        </BlockPanel>
      );
    }

    case "pipeline": {
      return (
        <BlockPanel id={block.id} as="section">
          <HeaderEditor id={block.id} title={block.data.title} description={block.data.description} />
          {block.data.content}
        </BlockPanel>
      );
    }

    default:
      return null;
  }
};

export default BlockRenderer;
