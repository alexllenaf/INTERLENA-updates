import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getBlockHtmlOverride, setBlockHtmlOverride } from "../BlockPanel";
import {
  BlockRegistry,
  BlockSlotResolver,
  PAGE_BLOCK_REGISTRY,
  createDefaultPageBlock
} from "./blockRegistry";
import { PAGE_BLOCK_LIBRARY, getBlockPresetById, type PageBlockLibraryEntry } from "./pageData";
import PageRenderer from "./PageRenderer";
import {
  GridLayout,
  PageBlockConfig,
  PageConfig,
  PageBlockType,
  PAGE_CONFIG_VERSION,
  clampColSpan
} from "./types";
import { getAllowedColStartsForSpan, snapColStartToSpanGrid } from "./gridSlots";
import {
  clearCrossPageDragState,
  getCrossPageDragState,
  setCrossPageDragState,
  type SharedDragState
} from "./crossPageDragStore";
import { generateId } from "../../utils";

const GRID_COLUMNS = 60;
const DRAG_START_THRESHOLD_PX = 8;
const DRAG_SLOT_HYSTERESIS_PX = 14;
const DROP_OUTSIDE_PADDING_PX = 64;
const AUTO_SCROLL_EDGE_PX = 84;
const AUTO_SCROLL_STEP_PX = 18;
const PLACEHOLDER_ID = "__drag_placeholder__";
const SHARED_DRAG_STALE_MS = 5000;

type DragState = SharedDragState;

type PackedPosition = {
  colStart: number;
  rowStart: number;
};

type DragPreview = {
  layoutOverrides: Record<string, GridLayout>;
  placeholderLayout: GridLayout | null;
  order: string[];
};

type Props = {
  pageId: string;
  pageConfig: PageConfig;
  onChange: (next: PageConfig) => void;
  onDropFromAnotherPage?: (payload: CrossPageDropPayload) => void;
  className?: string;
  registry?: BlockRegistry;
  resolveSlot?: BlockSlotResolver;
  resolveBlockProps?: (block: PageBlockConfig) => Record<string, unknown> | null;
  resolveDuplicateProps?: (block: PageBlockConfig) => Record<string, unknown> | null;
  createBlockForType?: (type: PageBlockType, id: string) => PageBlockConfig | null;
};

type HtmlEditorState = {
  blockId: string;
  blockLabel: string;
  html: string;
  error: string | null;
  previewClassName: string;
  previewStyle: string;
  previewCssText: string;
  previewRootVars: string;
};

type PendingDeleteState = {
  blockId: string;
  label: string;
};

export type CrossPageDropPayload = {
  sourcePageId: string;
  sourceBlockId: string;
  block: PageBlockConfig;
  nextBlocks: PageBlockConfig[];
};

type PackItem = {
  id: string;
  span: number;
  preferredCol: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const packGridItems = (items: PackItem[]): Record<string, PackedPosition> => {
  const occupied: Map<number, boolean[]> = new Map();
  const rowSpanByRow: Map<number, number> = new Map();
  const getRow = (row: number) => {
    const existing = occupied.get(row);
    if (existing) return existing;
    const next = Array.from({ length: GRID_COLUMNS + 1 }, () => false);
    occupied.set(row, next);
    return next;
  };
  const canPlace = (row: number, colStart: number, span: number) => {
    const maxColStart = GRID_COLUMNS - span + 1;
    if (colStart < 1 || colStart > maxColStart) return false;
    const rowSpan = rowSpanByRow.get(row);
    if (rowSpan !== undefined && rowSpan !== span) return false;
    const rowCells = getRow(row);
    for (let col = colStart; col < colStart + span; col += 1) {
      if (rowCells[col]) return false;
    }
    return true;
  };
  const markPlace = (row: number, colStart: number, span: number) => {
    if (!rowSpanByRow.has(row)) {
      rowSpanByRow.set(row, span);
    }
    const rowCells = getRow(row);
    for (let col = colStart; col < colStart + span; col += 1) {
      rowCells[col] = true;
    }
  };
  const findSlot = (preferredCol: number, span: number) => {
    const allowedStarts = getAllowedColStartsForSpan(span, GRID_COLUMNS);
    const preferred = snapColStartToSpanGrid(preferredCol, span, GRID_COLUMNS);
    const maxRows = Math.max(12, items.length * 6 + 20);

    // First, try to keep the block in its preferred column across rows.
    // This enables true vertical stacks (e.g. several fifth-width blocks).
    for (let row = 1; row <= maxRows; row += 1) {
      if (canPlace(row, preferred, span)) {
        return { rowStart: row, colStart: preferred };
      }
    }

    // If preferred column is not available, then fallback to any allowed column.
    for (let row = 1; row <= maxRows; row += 1) {
      for (let i = 0; i < allowedStarts.length; i += 1) {
        const col = allowedStarts[i];
        if (col === preferred) continue;
        if (canPlace(row, col, span)) {
          return { rowStart: row, colStart: col };
        }
      }
    }
    return { rowStart: maxRows, colStart: allowedStarts[0] || 1 };
  };

  const out: Record<string, PackedPosition> = {};
  items.forEach((item) => {
    const span = clampColSpan(item.span);
    const pos = findSlot(item.preferredCol, span);
    markPlace(pos.rowStart, pos.colStart, span);
    out[item.id] = pos;
  });
  return out;
};

const applyPackedLayout = (
  blocks: PageBlockConfig[],
  packed: Record<string, PackedPosition>
): PageBlockConfig[] =>
  blocks.map((block) => {
    const pos = packed[block.id];
    if (!pos) return block;
    return {
      ...block,
      layout: {
        ...block.layout,
        colStart: pos.colStart,
        rowStart: pos.rowStart
      }
    };
  });

const compactBlocks = (blocks: PageBlockConfig[]): PageBlockConfig[] => {
  const items: PackItem[] = blocks.map((block) => ({
    id: block.id,
    span: clampColSpan(block.layout.colSpan),
    preferredCol: block.layout.colStart || 1
  }));
  const packed = packGridItems(items);
  return applyPackedLayout(blocks, packed);
};

const createUniqueBlockId = (type: string, existingIds: Set<string>) => {
  for (let i = 0; i < 100; i += 1) {
    const candidate = `${type}:${generateId()}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `${type}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
};

const cloneBlockPropsForDuplicate = (props: Record<string, unknown>, suffix: string) => {
  const cloned = JSON.parse(JSON.stringify(props || {})) as Record<string, unknown>;
  Object.keys(cloned).forEach((key) => {
    if (!/slotid$/i.test(key)) return;
    const value = cloned[key];
    if (typeof value !== "string" || !value.trim()) return;
    cloned[key] = `${value}:${suffix}`;
  });
  return cloned;
};

const BLOCK_NAME_KEYS = ["title", "label"] as const;
type BlockNameKey = (typeof BLOCK_NAME_KEYS)[number];

const normalizeName = (value: string) => value.trim().toLocaleLowerCase();

const readBlockName = (props: Record<string, unknown>): { key: BlockNameKey; value: string } | null => {
  for (const key of BLOCK_NAME_KEYS) {
    const raw = props[key];
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value) continue;
    return { key, value };
  }
  return null;
};

const collectUsedNames = (blocks: PageBlockConfig[]): Set<string> => {
  const used = new Set<string>();
  blocks.forEach((block) => {
    const named = readBlockName(block.props as Record<string, unknown>);
    if (!named) return;
    used.add(normalizeName(named.value));
  });
  return used;
};

const resolveUniqueBlockName = (desired: string, usedNames: Set<string>): string => {
  const desiredNorm = normalizeName(desired);
  let hasBase = false;
  let maxSuffix = 0;

  usedNames.forEach((name) => {
    if (name === desiredNorm) {
      hasBase = true;
      return;
    }
    if (!name.startsWith(`${desiredNorm} `)) return;
    const suffixRaw = name.slice(desiredNorm.length + 1).trim();
    if (!/^\d+$/.test(suffixRaw)) return;
    const suffix = Number(suffixRaw);
    if (!Number.isInteger(suffix) || suffix <= 0) return;
    if (suffix > maxSuffix) {
      maxSuffix = suffix;
    }
  });

  if (!hasBase && maxSuffix === 0) return desired;
  const nextSuffix = Math.max(1, maxSuffix + 1);
  return `${desired} ${nextSuffix}`;
};

const withUniqueBlockName = (candidate: PageBlockConfig, existingBlocks: PageBlockConfig[]): PageBlockConfig => {
  const props = candidate.props as Record<string, unknown>;
  const named = readBlockName(props);
  if (!named) return candidate;
  const usedNames = collectUsedNames(existingBlocks);
  const nextName = resolveUniqueBlockName(named.value, usedNames);
  if (nextName === named.value) return candidate;
  return {
    ...candidate,
    props: {
      ...props,
      [named.key]: nextName
    } as any
  };
};

const normalizeBlockLayoutToSpanSlots = (block: PageBlockConfig): PageBlockConfig => {
  const span = clampColSpan(block.layout.colSpan);
  const colStart =
    block.layout.colStart === undefined
      ? undefined
      : snapColStartToSpanGrid(block.layout.colStart, span, GRID_COLUMNS);
  return {
    ...block,
    layout: {
      ...block.layout,
      colSpan: span,
      colStart
    }
  };
};

const withTimestamp = (pageConfig: PageConfig, blocks: PageBlockConfig[]): PageConfig => ({
  ...pageConfig,
  version: pageConfig.version || PAGE_CONFIG_VERSION,
  updated_at: new Date().toISOString(),
  blocks: blocks.map(normalizeBlockLayoutToSpanSlots)
});

const computeGridSnapColStart = (container: HTMLElement, clientX: number, span: number): number => {
  const rect = container.getBoundingClientRect();
  const style = window.getComputedStyle(container);
  const gap = Number.parseFloat(style.columnGap || style.gap || "0") || 0;
  const maxColStart = Math.max(1, GRID_COLUMNS - span + 1);
  const totalGap = gap * (GRID_COLUMNS - 1);
  const colWidth = (rect.width - totalGap) / GRID_COLUMNS;
  const track = colWidth + gap;
  const localX = clamp(clientX - rect.left, 0, Math.max(0, rect.width));
  const snapped = Math.round(localX / Math.max(track, 1)) + 1;
  const clamped = clamp(snapped, 1, maxColStart);
  return snapColStartToSpanGrid(clamped, span, GRID_COLUMNS);
};

const computeInsertionIndex = (
  container: HTMLElement,
  dragBlockId: string,
  pointerY: number
): number => {
  const elements = Array.from(
    container.querySelectorAll<HTMLElement>(".page-builder-item[data-block-id]")
  ).filter((el) => el.dataset.blockId && el.dataset.blockId !== dragBlockId);

  for (let i = 0; i < elements.length; i += 1) {
    const rect = elements[i].getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    if (pointerY < centerY) {
      return i;
    }
  }
  return elements.length;
};

const isDropInvalid = (container: HTMLElement, clientX: number, clientY: number): boolean => {
  const rect = container.getBoundingClientRect();
  const outLeft = clientX < rect.left - DROP_OUTSIDE_PADDING_PX;
  const outRight = clientX > rect.right + DROP_OUTSIDE_PADDING_PX;
  const outTop = clientY < rect.top - DROP_OUTSIDE_PADDING_PX;
  const outBottom = clientY > rect.bottom + DROP_OUTSIDE_PADDING_PX;
  return outLeft || outRight || outTop || outBottom;
};

const runAutoScroll = (clientY: number) => {
  if (clientY < AUTO_SCROLL_EDGE_PX) {
    window.scrollBy({ top: -AUTO_SCROLL_STEP_PX, behavior: "auto" });
    return;
  }
  if (clientY > window.innerHeight - AUTO_SCROLL_EDGE_PX) {
    window.scrollBy({ top: AUTO_SCROLL_STEP_PX, behavior: "auto" });
  }
};

const computeDragPreview = (pageConfig: PageConfig, drag: DragState | null): DragPreview | null => {
  if (!drag || !drag.active) return null;
  const dragged = drag.dragBlock;
  const draggingFromCurrentPage = drag.sourcePageId === pageConfig.id;

  const withoutDragged = draggingFromCurrentPage
    ? pageConfig.blocks.filter((block) => block.id !== dragged.id)
    : pageConfig.blocks;
  const insertion = clamp(drag.insertionIndex, 0, withoutDragged.length);
  const order = [...withoutDragged.map((block) => block.id)];
  order.splice(insertion, 0, PLACEHOLDER_ID);

  const byId = new Map(pageConfig.blocks.map((block) => [block.id, block]));
  const placeholderSpan = clampColSpan(dragged.layout.colSpan);

  const items: PackItem[] = order.map((id) => {
    if (id === PLACEHOLDER_ID) {
      return {
        id,
        span: placeholderSpan,
        preferredCol: drag.targetColStart
      };
    }
    const block = byId.get(id)!;
    return {
      id: block.id,
      span: clampColSpan(block.layout.colSpan),
      preferredCol: block.layout.colStart || 1
    };
  });

  const packed = packGridItems(items);
  const layoutOverrides: Record<string, GridLayout> = {};
  pageConfig.blocks.forEach((block) => {
    if (draggingFromCurrentPage && block.id === dragged.id) return;
    const packedPos = packed[block.id];
    if (!packedPos) return;
    layoutOverrides[block.id] = {
      ...block.layout,
      colStart: packedPos.colStart,
      rowStart: packedPos.rowStart
    };
  });

  const placeholderPos = packed[PLACEHOLDER_ID];
  return {
    layoutOverrides,
    placeholderLayout: placeholderPos
      ? {
          colSpan: placeholderSpan,
          colStart: placeholderPos.colStart,
          rowStart: placeholderPos.rowStart
        }
      : null,
    order
  };
};

const getBlockDisplayName = (block: PageBlockConfig): string => {
  const props = block.props as Record<string, unknown>;
  const title = typeof props.title === "string" ? props.title.trim() : "";
  if (title) return title;
  const label = typeof props.label === "string" ? props.label.trim() : "";
  if (label) return label;
  return block.type;
};

const validateHtml = (html: string): string | null => {
  if (!html.trim()) {
    return "El código HTML no puede estar vacío.";
  }
  try {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const parserError = parsed.querySelector("parsererror");
    if (!parserError) return null;
    return parserError.textContent?.trim() || "Error de sintaxis en el HTML.";
  } catch {
    return "No se pudo parsear el HTML.";
  }
};

const escapeHtmlAttr = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const collectRootCssVarsText = (): string => {
  if (typeof window === "undefined") return "";
  const rootStyle = window.getComputedStyle(document.documentElement);
  const parts: string[] = [":root{"];
  for (let i = 0; i < rootStyle.length; i += 1) {
    const key = rootStyle.item(i);
    if (!key || !key.startsWith("--")) continue;
    const value = rootStyle.getPropertyValue(key).trim();
    if (!value) continue;
    parts.push(`${key}:${value};`);
  }
  parts.push("}");
  return parts.join("");
};

const collectDocumentCssText = (): string => {
  if (typeof document === "undefined") return "";
  const chunks: string[] = [];
  Array.from(document.styleSheets).forEach((sheet) => {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      return;
    }
    if (!rules) return;
    for (let i = 0; i < rules.length; i += 1) {
      const rule = rules.item(i);
      if (rule?.cssText) chunks.push(rule.cssText);
    }
  });
  return chunks.join("\n");
};

const buildPreviewSrcDoc = (state: HtmlEditorState): string => {
  const className = escapeHtmlAttr(state.previewClassName || "panel block-panel block-flat");
  const styleAttr = state.previewStyle ? ` style="${escapeHtmlAttr(state.previewStyle)}"` : "";
  return [
    "<!doctype html>",
    '<html lang="es">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    "<style>",
    state.previewRootVars,
    state.previewCssText,
    "html,body{margin:0;padding:0;}",
    "body{padding:10px;background:var(--surface);color:var(--text);}",
    ".block-settings{display:none !important;}",
    "</style>",
    "</head>",
    "<body>",
    `<section class=\"${className}\"${styleAttr}>${state.html}</section>`,
    "</body>",
    "</html>"
  ].join("\n");
};

const PageEditor: React.FC<Props> = ({
  pageId,
  pageConfig,
  onChange,
  onDropFromAnotherPage,
  className = "",
  registry = PAGE_BLOCK_REGISTRY,
  resolveSlot,
  resolveBlockProps,
  resolveDuplicateProps,
  createBlockForType
}) => {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [htmlEditor, setHtmlEditor] = useState<HtmlEditorState | null>(null);
  const [isHtmlEditorExpanded, setIsHtmlEditorExpanded] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const pageConfigRef = useRef(pageConfig);
  const dragRef = useRef<DragState | null>(null);
  const droppedRef = useRef(false);
  pageConfigRef.current = pageConfig;
  dragRef.current = drag;

  const dragPreview = useMemo(() => computeDragPreview(pageConfig, drag), [pageConfig, drag]);
  const htmlPreviewSrcDoc = useMemo(() => {
    if (!htmlEditor) return "";
    return buildPreviewSrcDoc(htmlEditor);
  }, [htmlEditor]);

  useEffect(() => {
    if (drag) return;
    if (droppedRef.current) return;
    const shared = getCrossPageDragState();
    if (!shared || !shared.active) return;
    if (Date.now() - shared.updatedAt > SHARED_DRAG_STALE_MS) {
      clearCrossPageDragState();
      return;
    }
    setDrag(shared);
  }, [drag, pageId]);

  useEffect(() => {
    if (!drag) return;
    // Avoid writing stale drag snapshots after drop/cancel transitions.
    if (dragRef.current !== drag) return;
    setCrossPageDragState(drag);
  }, [drag]);

  useEffect(() => {
    if (!isAddOpen) return;
    const onOutside = (event: MouseEvent) => {
      if (!addMenuRef.current) return;
      if (event.target instanceof Node && addMenuRef.current.contains(event.target)) return;
      setIsAddOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [isAddOpen]);

  useEffect(() => {
    if (!drag) return;
    const handlePointerMove = (event: PointerEvent) => {
      setDrag((prev) => {
        if (!prev || prev.pointerId !== event.pointerId) return prev;
        const clientX = event.clientX;
        const clientY = event.clientY;
        const moved = Math.hypot(clientX - prev.startX, clientY - prev.startY);
        const nowActive = prev.active || moved >= DRAG_START_THRESHOLD_PX;
        runAutoScroll(clientY);

        if (!containerRef.current) {
          return {
            ...prev,
            pointerX: clientX,
            pointerY: clientY,
            active: nowActive,
            updatedAt: Date.now()
          };
        }

        const candidateCol = computeGridSnapColStart(
          containerRef.current,
          clientX,
          clampColSpan(prev.dragBlock.layout.colSpan)
        );
        const candidateIndex = computeInsertionIndex(containerRef.current, prev.blockId, clientY);
        const candidateInvalid = isDropInvalid(containerRef.current, clientX, clientY);
        const changed =
          candidateCol !== prev.targetColStart ||
          candidateIndex !== prev.insertionIndex ||
          candidateInvalid !== prev.invalid;

        if (!nowActive) {
          return {
            ...prev,
            pointerX: clientX,
            pointerY: clientY,
            updatedAt: Date.now()
          };
        }

        if (!changed) {
          return {
            ...prev,
            pointerX: clientX,
            pointerY: clientY,
            active: true,
            updatedAt: Date.now()
          };
        }

        const deltaFromStable = Math.hypot(clientX - prev.lastStableX, clientY - prev.lastStableY);
        if (deltaFromStable < DRAG_SLOT_HYSTERESIS_PX) {
          return {
            ...prev,
            pointerX: clientX,
            pointerY: clientY,
            active: true,
            updatedAt: Date.now()
          };
        }

        return {
          ...prev,
          pointerX: clientX,
          pointerY: clientY,
          active: true,
          insertionIndex: candidateIndex,
          targetColStart: candidateCol,
          invalid: candidateInvalid,
          lastStableX: clientX,
          lastStableY: clientY,
          updatedAt: Date.now()
        };
      });
    };

    const finishDrag = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      droppedRef.current = true;
      setDrag(null);
      clearCrossPageDragState();
      // Reset the dropped flag after a tick so future drags work normally.
      queueMicrotask(() => { droppedRef.current = false; });
      if (!current.active || current.invalid) return;
      const isSamePage = current.sourcePageId === pageId;
      const sourceStillExists = pageConfig.blocks.some((block) => block.id === current.blockId);
      if (isSamePage && !sourceStillExists) return;

      const withoutDragged = isSamePage
        ? pageConfig.blocks.filter((block) => block.id !== current.blockId)
        : pageConfig.blocks;
      const insertion = clamp(current.insertionIndex, 0, withoutDragged.length);
      const ordered = [...withoutDragged];
      const usedIds = new Set(ordered.map((block) => block.id));
      const droppedBlock =
        !isSamePage && usedIds.has(current.dragBlock.id)
          ? {
              ...current.dragBlock,
              id: createUniqueBlockId(current.dragBlock.type, usedIds)
            }
          : current.dragBlock;
      ordered.splice(insertion, 0, droppedBlock);

      const items: PackItem[] = ordered.map((block) => ({
        id: block.id,
        span: clampColSpan(block.layout.colSpan),
        preferredCol: block.id === droppedBlock.id ? current.targetColStart : block.layout.colStart || 1
      }));
      const packed = packGridItems(items);
      const nextBlocks = applyPackedLayout(ordered, packed);
      if (isSamePage) {
        onChange(withTimestamp(pageConfig, nextBlocks));
        return;
      }
      onDropFromAnotherPage?.({
        sourcePageId: current.sourcePageId,
        sourceBlockId: current.blockId,
        block: droppedBlock,
        nextBlocks
      });
    };

    const cancelDrag = (event: PointerEvent) => {
      const current = dragRef.current;
      if (!current || current.pointerId !== event.pointerId) return;
      droppedRef.current = true;
      setDrag(null);
      clearCrossPageDragState();
      queueMicrotask(() => { droppedRef.current = false; });
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup", finishDrag, { passive: true });
    window.addEventListener("pointercancel", cancelDrag, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", cancelDrag);
    };
  }, [drag, onChange, onDropFromAnotherPage, pageConfig, pageId]);

  useEffect(() => {
    if (!drag?.active) return;
    document.body.classList.add("page-editor-no-select");
    return () => document.body.classList.remove("page-editor-no-select");
  }, [drag?.active]);

  const updateBlocks = (nextBlocks: PageBlockConfig[]) => {
    const currentConfig = pageConfigRef.current;
    const nextConfig = withTimestamp(currentConfig, nextBlocks);
    pageConfigRef.current = nextConfig;
    onChange(nextConfig);
  };

  const handlePropsUpdate = (blockId: string, nextProps: Record<string, unknown>) => {
    const nextBlocks = pageConfigRef.current.blocks.map((block) =>
      block.id === blockId ? ({ ...block, props: nextProps } as PageBlockConfig) : block
    );
    updateBlocks(nextBlocks);
  };

  const handleLayoutUpdate = (blockId: string, nextLayout: GridLayout) => {
    const nextBlocks = pageConfigRef.current.blocks.map((block) =>
      block.id === blockId
        ? normalizeBlockLayoutToSpanSlots({
            ...block,
            layout: nextLayout
          })
        : block
    );
    updateBlocks(compactBlocks(nextBlocks));
  };

  const handleDuplicate = (block: PageBlockConfig) => {
    const sourceIndex = pageConfig.blocks.findIndex((item) => item.id === block.id);
    if (sourceIndex < 0) return;
    const existingIds = new Set(pageConfig.blocks.map((item) => item.id));
    const nextId = createUniqueBlockId(block.type, existingIds);
    const suffix = nextId.replace(/[^a-zA-Z0-9_-]/g, "");
    const duplicateOverrides = resolveDuplicateProps?.(block) || null;
    const sourceProps = {
      ...(block.props as Record<string, unknown>),
      ...(duplicateOverrides || {})
    };
    const clone: PageBlockConfig = {
      ...block,
      id: nextId,
      layout: { ...block.layout },
      props: cloneBlockPropsForDuplicate(sourceProps, suffix) as any
    };
    const uniqueClone = withUniqueBlockName(clone, pageConfig.blocks);
    const next = [...pageConfig.blocks];
    next.splice(sourceIndex + 1, 0, uniqueClone);
    updateBlocks(compactBlocks(next));
  };

  const resolveDeleteLabel = (blockId: string) => {
    const targetBlock = pageConfig.blocks.find((block) => block.id === blockId);
    const rawTitle =
      targetBlock && targetBlock.props && typeof (targetBlock.props as Record<string, unknown>).title === "string"
        ? String((targetBlock.props as Record<string, unknown>).title)
        : "";
    return rawTitle.trim() || targetBlock?.type || "block";
  };

  const requestDeleteBlock = (blockId: string) => {
    setPendingDelete({
      blockId,
      label: resolveDeleteLabel(blockId)
    });
  };

  const confirmDeleteBlock = () => {
    if (!pendingDelete) return;
    const exists = pageConfig.blocks.some((block) => block.id === pendingDelete.blockId);
    if (!exists) {
      setPendingDelete(null);
      return;
    }
    const next = pageConfig.blocks.filter((block) => block.id !== pendingDelete.blockId);
    updateBlocks(compactBlocks(next));
    setPendingDelete(null);
  };

  const readCurrentBlockSnapshot = (blockId: string) => {
    const fallbackCss = collectDocumentCssText();
    const fallbackVars = collectRootCssVarsText();
    if (typeof document === "undefined") {
      return {
        html: "",
        previewClassName: "panel block-panel block-flat",
        previewStyle: "",
        previewCssText: fallbackCss,
        previewRootVars: fallbackVars
      };
    }
    const blockItem = Array.from(document.querySelectorAll<HTMLElement>(".page-builder-item[data-block-id]"))
      .find((item) => item.dataset.blockId === blockId);
    const panel = blockItem?.querySelector<HTMLElement>(".block-panel");
    if (!panel) {
      return {
        html: "",
        previewClassName: "panel block-panel block-flat",
        previewStyle: "",
        previewCssText: fallbackCss,
        previewRootVars: fallbackVars
      };
    }
    const clone = panel.cloneNode(true) as HTMLElement;
    clone.querySelector(".block-settings")?.remove();
    return {
      html: clone.innerHTML.trim(),
      previewClassName: panel.className || "panel block-panel block-flat",
      previewStyle: panel.getAttribute("style") || "",
      previewCssText: fallbackCss,
      previewRootVars: fallbackVars
    };
  };

  const openHtmlEditor = (block: PageBlockConfig) => {
    const snapshot = readCurrentBlockSnapshot(block.id);
    const existing = getBlockHtmlOverride(block.id);
    const sourceHtml = existing ?? snapshot.html;
    setHtmlEditor({
      blockId: block.id,
      blockLabel: getBlockDisplayName(block),
      html: sourceHtml,
      error: validateHtml(sourceHtml),
      previewClassName: snapshot.previewClassName,
      previewStyle: snapshot.previewStyle,
      previewCssText: snapshot.previewCssText,
      previewRootVars: snapshot.previewRootVars
    });
    setIsHtmlEditorExpanded(false);
  };

  const closeHtmlEditor = () => {
    setHtmlEditor(null);
    setIsHtmlEditorExpanded(false);
  };

  const handleHtmlUpdate = () => {
    if (!htmlEditor) return;
    if (htmlEditor.error) return;
    setBlockHtmlOverride(htmlEditor.blockId, htmlEditor.html);
    closeHtmlEditor();
  };

  const handleResetHtmlOverride = () => {
    if (!htmlEditor) return;
    setBlockHtmlOverride(htmlEditor.blockId, null);
    closeHtmlEditor();
  };

  const startDrag = (event: React.PointerEvent, block: PageBlockConfig) => {
    const blockEl = (event.currentTarget as HTMLElement).closest(".page-builder-item");
    const rect = blockEl?.getBoundingClientRect();
    if (!rect) return;
    const sourceIndex = pageConfig.blocks.findIndex((item) => item.id === block.id);
    if (sourceIndex < 0) return;

    setDrag({
      sourcePageId: pageId,
      blockId: block.id,
      dragBlock: block,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      pointerX: event.clientX,
      pointerY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      sourceIndex,
      insertionIndex: sourceIndex,
      targetColStart: snapColStartToSpanGrid(
        block.layout.colStart || 1,
        clampColSpan(block.layout.colSpan),
        GRID_COLUMNS
      ),
      lastStableX: event.clientX,
      lastStableY: event.clientY,
      active: false,
      invalid: false,
      ghostRect: { width: rect.width, height: rect.height },
      updatedAt: Date.now()
    });
  };

  const addBlock = (entry: PageBlockLibraryEntry) => {
    const id = `${entry.type}:${generateId()}`;
    let block = createBlockForType?.(entry.type, id) || createDefaultPageBlock(entry.type, id);
    const preset = getBlockPresetById(entry.presetId);
    if (preset && preset.type === entry.type) {
      block = {
        ...block,
        layout: {
          ...block.layout,
          ...(preset.layout || {})
        },
        props: {
          ...(block.props as Record<string, unknown>),
          ...(preset.props as Record<string, unknown>)
        } as any
      };
    }
    block = withUniqueBlockName(block, pageConfig.blocks);
    const next = compactBlocks([...pageConfig.blocks, block]);
    updateBlocks(next);
    setIsAddOpen(false);
  };

  const draggedBlock = drag?.dragBlock || null;
  const GhostBlockComponent = draggedBlock
    ? (registry[draggedBlock.type].component as React.ComponentType<any>)
    : null;

  const ghost =
    drag?.active && draggedBlock && GhostBlockComponent && typeof document !== "undefined"
      ? createPortal(
          <div
            className={`page-editor-ghost ${drag.invalid ? "invalid" : ""}`}
            style={{
              top: drag.pointerY - drag.offsetY,
              left: drag.pointerX - drag.offsetX,
              width: drag.ghostRect.width,
              height: drag.ghostRect.height
            }}
          >
            <GhostBlockComponent
              key={draggedBlock.id}
              block={({
                ...draggedBlock,
                props: {
                  ...(draggedBlock.props as Record<string, unknown>),
                  ...(resolveBlockProps?.(draggedBlock) || {})
                }
              } as any)}
              mode="view"
              resolveSlot={resolveSlot}
              updateBlockProps={() => undefined}
              patchBlockProps={() => undefined}
            />
          </div>,
          document.body
        )
      : null;

  const hiddenBlockIds =
    drag?.active && draggedBlock && drag.sourcePageId === pageId
      ? new Set<string>([draggedBlock.id])
      : undefined;

  const extraItems =
    drag?.active && dragPreview?.placeholderLayout
      ? [
          {
            key: "drag-placeholder",
            layout: dragPreview.placeholderLayout,
            className: `page-editor-drop-placeholder ${drag.invalid ? "invalid" : "valid"}`,
            children: (
              <div
                className="page-editor-drop-placeholder-inner"
                style={{
                  height: drag.ghostRect.height,
                  minHeight: drag.ghostRect.height
                }}
              />
            )
          }
        ]
      : [];

  const resolveMenuActions = (block: PageBlockConfig) => [
    {
      key: `code-${block.id}`,
      label: "Código",
      icon: (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="16" height="16">
          <path d="M8.7 7.3 4 12l4.7 4.7 1.1-1.1L6.2 12l3.6-3.6-1.1-1.1Zm6.6 0-1.1 1.1 3.6 3.6-3.6 3.6 1.1 1.1L20 12l-4.7-4.7Z" />
        </svg>
      ),
      onClick: () => openHtmlEditor(block)
    },
    {
      key: `duplicate-${block.id}`,
      label: "Duplicar bloque",
      onClick: () => handleDuplicate(block)
    },
    {
      key: `delete-${block.id}`,
      label: "Eliminar bloque",
      tone: "danger" as const,
      onClick: () => requestDeleteBlock(block.id)
    }
  ];

  return (
    <div className={["page-editor-shell", className].filter(Boolean).join(" ")} data-page-id={pageId}>
      <div className="page-editor-toolbar">
        <div className="page-editor-add" ref={addMenuRef}>
          <button className="ghost" type="button" onClick={() => setIsAddOpen((prev) => !prev)}>
            + Add block
          </button>
          {isAddOpen && (
            <div className="page-editor-add-menu" role="menu" aria-label="Add block">
              {PAGE_BLOCK_LIBRARY.map((entry) => (
                <button key={entry.id} type="button" onClick={() => addBlock(entry)}>
                  <span>{entry.label}</span>
                  <small>{entry.description}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <PageRenderer
        pageConfig={pageConfig}
        className="page-editor-grid"
        mode="edit"
        registry={registry}
        resolveSlot={resolveSlot}
        resolveBlockProps={resolveBlockProps}
        resolveBlockMenuActions={resolveMenuActions}
        onUpdateBlockProps={handlePropsUpdate}
        onUpdateBlockLayout={handleLayoutUpdate}
        hiddenBlockIds={hiddenBlockIds}
        layoutOverrides={dragPreview?.layoutOverrides}
        extraItems={extraItems}
        containerRef={containerRef}
        blockClassName={(block) => {
          if (drag?.active && drag.sourcePageId === pageId && block.id === drag.blockId) return "drag-source-hidden";
          return "";
        }}
        renderBlockControls={(block) => {
          return (
            <div className="page-editor-block-controls">
              <button
                className="page-editor-drag-handle"
                type="button"
                onPointerDown={(event) => startDrag(event, block)}
                aria-label="Drag block"
                title="Drag block"
              />
            </div>
          );
        }}
      />
      {ghost}
      {htmlEditor && typeof document !== "undefined"
        ? createPortal(
            <div
              className={`modal-backdrop ${isHtmlEditorExpanded ? "page-editor-html-backdrop-expanded" : ""}`}
              role="dialog"
              aria-modal="true"
              onClick={closeHtmlEditor}
            >
              <div className={`modal page-editor-html-modal ${isHtmlEditorExpanded ? "expanded" : ""}`} onClick={(event) => event.stopPropagation()}>
                <header className="modal-header page-editor-html-modal-header">
                  <div>
                    <h3>HTML</h3>
                    <p>{htmlEditor.blockLabel}</p>
                  </div>
                  <div className="page-editor-html-modal-header-actions">
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => setIsHtmlEditorExpanded((prev) => !prev)}
                      aria-label={isHtmlEditorExpanded ? "Salir de pantalla grande" : "Ampliar editor"}
                      title={isHtmlEditorExpanded ? "Salir de pantalla grande" : "Ampliar editor"}
                    >
                      {isHtmlEditorExpanded ? "↙" : "⤢"}
                    </button>
                    <button className="ghost" type="button" onClick={closeHtmlEditor}>
                      Cerrar
                    </button>
                  </div>
                </header>

                <div className="page-editor-html-modal-body">
                  <div className="page-editor-html-editor-col">
                    <label htmlFor="block-html-editor">Código</label>
                    <textarea
                      id="block-html-editor"
                      className="page-editor-html-textarea"
                      value={htmlEditor.html}
                      onChange={(event) => {
                        const nextHtml = event.target.value;
                        setHtmlEditor((prev) =>
                          prev
                            ? {
                                ...prev,
                                html: nextHtml,
                                error: validateHtml(nextHtml)
                              }
                            : prev
                        );
                      }}
                      spellCheck={false}
                      placeholder="Escribe HTML…"
                    />
                    {htmlEditor.error ? <div className="page-editor-html-error">{htmlEditor.error}</div> : null}
                  </div>

                  <div className="page-editor-html-preview-col">
                    <label>Previsualización</label>
                    <iframe
                      title="Vista previa HTML del bloque"
                      className="page-editor-html-preview"
                      sandbox="allow-scripts allow-same-origin allow-presentation"
                      srcDoc={htmlPreviewSrcDoc}
                    />
                  </div>
                </div>

                <footer className="page-editor-html-modal-footer">
                  <div className="page-editor-html-modal-footer-left">
                    <button type="button" className="ghost" onClick={handleResetHtmlOverride}>
                      Restablecer original
                    </button>
                  </div>
                  <div className="page-editor-html-modal-footer-right">
                    <button type="button" className="ghost" onClick={closeHtmlEditor}>
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="primary"
                      onClick={handleHtmlUpdate}
                      disabled={Boolean(htmlEditor.error)}
                    >
                      Actualizar
                    </button>
                  </div>
                </footer>
              </div>
            </div>,
            document.body
          )
        : null}
      {pendingDelete && typeof document !== "undefined"
        ? createPortal(
            <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setPendingDelete(null)}>
              <div className="modal confirm-modal" onClick={(event) => event.stopPropagation()}>
                <div className="confirm-modal-body">
                  <h3>Eliminar bloque</h3>
                  <p>¿Eliminar bloque "{pendingDelete.label}"?</p>
                </div>
                <div className="confirm-modal-actions">
                  <button className="ghost" type="button" onClick={() => setPendingDelete(null)}>
                    Cancelar
                  </button>
                  <button className="danger" type="button" onClick={confirmDeleteBlock}>
                    Eliminar
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
};

export default PageEditor;
