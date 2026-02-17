import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BlockRegistry,
  BlockSlotResolver,
  PAGE_BLOCK_REGISTRY,
  createDefaultPageBlock
} from "./blockRegistry";
import { PAGE_BLOCK_LIBRARY } from "./pageData";
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
import { generateId } from "../../utils";

const GRID_COLUMNS = 60;
const DRAG_START_THRESHOLD_PX = 8;
const DRAG_SLOT_HYSTERESIS_PX = 14;
const DROP_OUTSIDE_PADDING_PX = 64;
const AUTO_SCROLL_EDGE_PX = 84;
const AUTO_SCROLL_STEP_PX = 18;
const PLACEHOLDER_ID = "__drag_placeholder__";

type DragState = {
  blockId: string;
  pointerId: number;
  startX: number;
  startY: number;
  pointerX: number;
  pointerY: number;
  offsetX: number;
  offsetY: number;
  sourceIndex: number;
  insertionIndex: number;
  targetColStart: number;
  lastStableX: number;
  lastStableY: number;
  active: boolean;
  invalid: boolean;
  ghostRect: { width: number; height: number };
};

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
  className?: string;
  registry?: BlockRegistry;
  resolveSlot?: BlockSlotResolver;
  resolveBlockProps?: (block: PageBlockConfig) => Record<string, unknown> | null;
  resolveDuplicateProps?: (block: PageBlockConfig) => Record<string, unknown> | null;
  createBlockForType?: (type: PageBlockType, id: string) => PageBlockConfig | null;
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
  const dragged = pageConfig.blocks.find((block) => block.id === drag.blockId);
  if (!dragged) return null;

  const withoutDragged = pageConfig.blocks.filter((block) => block.id !== dragged.id);
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
    if (block.id === dragged.id) return;
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

const PageEditor: React.FC<Props> = ({
  pageId,
  pageConfig,
  onChange,
  className = "",
  registry = PAGE_BLOCK_REGISTRY,
  resolveSlot,
  resolveBlockProps,
  resolveDuplicateProps,
  createBlockForType
}) => {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);

  const dragPreview = useMemo(() => computeDragPreview(pageConfig, drag), [pageConfig, drag]);

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
            active: nowActive
          };
        }

        const draggedBlock = pageConfig.blocks.find((block) => block.id === prev.blockId);
        if (!draggedBlock) {
          return {
            ...prev,
            pointerX: clientX,
            pointerY: clientY,
            active: nowActive
          };
        }

        const candidateCol = computeGridSnapColStart(
          containerRef.current,
          clientX,
          clampColSpan(draggedBlock.layout.colSpan)
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
            pointerY: clientY
          };
        }

        if (!changed) {
          return {
            ...prev,
            pointerX: clientX,
            pointerY: clientY,
            active: true
          };
        }

        const deltaFromStable = Math.hypot(clientX - prev.lastStableX, clientY - prev.lastStableY);
        if (deltaFromStable < DRAG_SLOT_HYSTERESIS_PX) {
          return {
            ...prev,
            pointerX: clientX,
            pointerY: clientY,
            active: true
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
          lastStableY: clientY
        };
      });
    };

    const finishDrag = (event: PointerEvent) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      setDrag(null);
      if (!drag.active || drag.invalid) return;
      const draggedBlock = pageConfig.blocks.find((block) => block.id === drag.blockId);
      if (!draggedBlock) return;
      const withoutDragged = pageConfig.blocks.filter((block) => block.id !== draggedBlock.id);
      const insertion = clamp(drag.insertionIndex, 0, withoutDragged.length);
      const ordered = [...withoutDragged];
      ordered.splice(insertion, 0, draggedBlock);

      const items: PackItem[] = ordered.map((block) => ({
        id: block.id,
        span: clampColSpan(block.layout.colSpan),
        preferredCol: block.id === draggedBlock.id ? drag.targetColStart : block.layout.colStart || 1
      }));
      const packed = packGridItems(items);
      const nextBlocks = applyPackedLayout(ordered, packed);
      onChange(withTimestamp(pageConfig, nextBlocks));
    };

    const cancelDrag = (event: PointerEvent) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      setDrag(null);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup", finishDrag, { passive: true });
    window.addEventListener("pointercancel", cancelDrag, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", cancelDrag);
    };
  }, [drag, onChange, pageConfig]);

  useEffect(() => {
    if (!drag?.active) return;
    document.body.classList.add("page-editor-no-select");
    return () => document.body.classList.remove("page-editor-no-select");
  }, [drag?.active]);

  const updateBlocks = (nextBlocks: PageBlockConfig[]) => {
    onChange(withTimestamp(pageConfig, nextBlocks));
  };

  const handlePropsUpdate = (blockId: string, nextProps: Record<string, unknown>) => {
    const nextBlocks = pageConfig.blocks.map((block) =>
      block.id === blockId ? ({ ...block, props: nextProps } as PageBlockConfig) : block
    );
    updateBlocks(nextBlocks);
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
    const next = [...pageConfig.blocks];
    next.splice(sourceIndex + 1, 0, clone);
    updateBlocks(compactBlocks(next));
  };

  const handleDelete = (blockId: string) => {
    const targetBlock = pageConfig.blocks.find((block) => block.id === blockId);
    const rawTitle =
      targetBlock && targetBlock.props && typeof (targetBlock.props as Record<string, unknown>).title === "string"
        ? String((targetBlock.props as Record<string, unknown>).title)
        : "";
    const label = rawTitle.trim() || targetBlock?.type || "block";
    const confirmed = window.confirm(`Delete "${label}" block? This action cannot be undone.`);
    if (!confirmed) return;
    const next = pageConfig.blocks.filter((block) => block.id !== blockId);
    updateBlocks(compactBlocks(next));
  };

  const startDrag = (event: React.PointerEvent, block: PageBlockConfig) => {
    const blockEl = (event.currentTarget as HTMLElement).closest(".page-builder-item");
    const rect = blockEl?.getBoundingClientRect();
    if (!rect) return;
    const sourceIndex = pageConfig.blocks.findIndex((item) => item.id === block.id);
    if (sourceIndex < 0) return;

    setDrag({
      blockId: block.id,
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
      ghostRect: { width: rect.width, height: rect.height }
    });
  };

  const addBlock = (type: PageBlockType) => {
    const id = `${type}:${generateId()}`;
    const block = createBlockForType?.(type, id) || createDefaultPageBlock(type, id);
    const next = compactBlocks([...pageConfig.blocks, block]);
    updateBlocks(next);
    setIsAddOpen(false);
  };

  const draggedBlock = drag?.blockId
    ? pageConfig.blocks.find((block) => block.id === drag.blockId) || null
    : null;

  const ghost =
    drag?.active && draggedBlock && typeof document !== "undefined"
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
            {registry[draggedBlock.type].component({
              block: ({
                ...draggedBlock,
                props: {
                  ...(draggedBlock.props as Record<string, unknown>),
                  ...(resolveBlockProps?.(draggedBlock) || {})
                }
              } as any),
              mode: "view",
              resolveSlot,
              updateBlockProps: () => undefined,
              patchBlockProps: () => undefined
            } as any)}
          </div>,
          document.body
        )
      : null;

  const hiddenBlockIds =
    drag?.active && draggedBlock ? new Set<string>([draggedBlock.id]) : undefined;

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
      key: `duplicate-${block.id}`,
      label: "Duplicar bloque",
      onClick: () => handleDuplicate(block)
    },
    {
      key: `delete-${block.id}`,
      label: "Eliminar bloque",
      tone: "danger" as const,
      onClick: () => handleDelete(block.id)
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
                <button key={entry.type} type="button" onClick={() => addBlock(entry.type)}>
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
        hiddenBlockIds={hiddenBlockIds}
        layoutOverrides={dragPreview?.layoutOverrides}
        extraItems={extraItems}
        containerRef={containerRef}
        blockClassName={(block) => {
          if (drag?.active && block.id === drag.blockId) return "drag-source-hidden";
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
    </div>
  );
};

export default PageEditor;
