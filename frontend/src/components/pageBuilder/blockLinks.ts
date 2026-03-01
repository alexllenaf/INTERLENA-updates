import { getTableSchema } from "./tableSchemaRegistry";
import type { BlockLinksMap } from "./types";

const PAGE_CONFIGS_LOCAL_KEY = "page_configs_local_v1";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const parseTimestamp = (value: unknown): number | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

export type { BlockLinksMap };

export const TODO_SOURCE_TABLE_LINK_KEY = "todo.sourceTable";
export const KPI_SOURCE_TABLE_LINK_KEY = "kpi.sourceTable";
export const CHART_SOURCE_TABLE_LINK_KEY = "chart.sourceTable";
export const PIPELINE_SOURCE_TABLE_LINK_KEY = "pipeline.sourceTable";
export const CARD_GALLERY_SOURCE_TABLE_LINK_KEY = "cardGallery.sourceTable";
export const INFORMATIONAL_TABLE_SOURCE_TABLE_LINK_KEY = "informationalTable.sourceTable";
export const INFORMATIONAL_TABLE_SOURCE_EMAIL_LINK_KEY = "informationalTable.sourceEmail";

// ---------------------------------------------------------------------------
// Link normalization — links are always plain blockId strings (Notion model)
// ---------------------------------------------------------------------------

export const normalizeBlockLinks = (raw: unknown): BlockLinksMap => {
  if (!isRecord(raw)) return {};
  const next: BlockLinksMap = {};
  Object.entries(raw).forEach(([key, value]) => {
    const linkKey = normalizeString(key);
    if (!linkKey) return;
    // Support legacy BlockRef objects by extracting blockId
    if (isRecord(value) && typeof value.blockId === "string") {
      const blockId = normalizeString(value.blockId);
      if (blockId) next[linkKey] = blockId;
      return;
    }
    const linkValue = normalizeString(value);
    if (!linkValue) return;
    next[linkKey] = linkValue;
  });
  return next;
};

/** Get the blockId for a link key. */
export const getBlockLink = (props: unknown, linkKey: string): string | null => {
  if (!isRecord(props)) return null;
  const key = normalizeString(linkKey);
  if (!key) return null;
  const links = normalizeBlockLinks(props.links);
  return links[key] || null;
};

/** Patch a link — always stores a plain blockId string. */
export const patchBlockLink = (
  currentProps: unknown,
  linkKey: string,
  nextBlockId?: string | null
): { links?: BlockLinksMap } => {
  const key = normalizeString(linkKey);
  const nextId = normalizeString(nextBlockId);
  const links = isRecord(currentProps) ? normalizeBlockLinks(currentProps.links) : {};
  if (!key) {
    return Object.keys(links).length > 0 ? { links } : { links: undefined };
  }
  if (nextId) {
    links[key] = nextId;
  } else {
    delete links[key];
  }
  return Object.keys(links).length > 0 ? { links } : { links: undefined };
};

// ---------------------------------------------------------------------------
// BlockGraph — global index that maps blockId → location (Notion model)
//
// Links store ONLY the blockId. The graph knows which page each block lives on.
// This is the single source of truth for resolving any block reference.
// ---------------------------------------------------------------------------

export type BlockTargetSnapshot = {
  pageId: string;
  blockId: string;
  type: string;
  title: string;
  variant?: string;
  props: Record<string, unknown>;
};

export type BlockGraph = {
  /** blockId → snapshot. Since blockIds are globally unique, this is the primary index. */
  byBlockId: Map<string, BlockTargetSnapshot>;
  /** All block snapshots for iteration / dropdowns */
  all: BlockTargetSnapshot[];
};

/** Build the global block graph from settings. Memoize with useMemo in components. */
export const buildBlockGraph = (settings: unknown): BlockGraph => {
  const all = collectBlockTargets(settings);
  const byBlockId = new Map<string, BlockTargetSnapshot>();

  for (const target of all) {
    // First-seen wins if there's ever a collision (shouldn't happen with unique IDs)
    if (!byBlockId.has(target.blockId)) {
      byBlockId.set(target.blockId, target);
    }
  }

  return { byBlockId, all };
};

/** Resolve a blockId to its full snapshot (including which page it lives on). */
export const resolveBlock = (
  graph: BlockGraph,
  blockId: string | null | undefined
): BlockTargetSnapshot | null => {
  if (!blockId) return null;
  return graph.byBlockId.get(blockId) || null;
};

/** Resolve a link key from block props using the global graph. */
export const resolveLinkedBlock = (
  graph: BlockGraph,
  props: unknown,
  linkKey: string
): BlockTargetSnapshot | null => {
  const blockId = getBlockLink(props, linkKey);
  return resolveBlock(graph, blockId);
};

/** Validate all links in a block's props. Returns link keys whose targets don't exist. */
export const validateBlockLinks = (
  graph: BlockGraph,
  props: unknown
): string[] => {
  if (!isRecord(props)) return [];
  const links = normalizeBlockLinks(props.links);
  const broken: string[] = [];
  for (const [key, blockId] of Object.entries(links)) {
    if (!graph.byBlockId.has(blockId)) {
      broken.push(key);
    }
  }
  return broken;
};

// ---------------------------------------------------------------------------
// Page config merging & block collection (unchanged)
// ---------------------------------------------------------------------------

const readLocalPageConfigs = (): Record<string, unknown> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PAGE_CONFIGS_LOCAL_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const pickNewestPageConfig = (base: unknown, incoming: unknown): unknown => {
  if (!isRecord(base)) return incoming;
  if (!isRecord(incoming)) return base;
  const baseTs = parseTimestamp(base.updated_at);
  const incomingTs = parseTimestamp(incoming.updated_at);
  if (baseTs !== null && incomingTs !== null) {
    return incomingTs >= baseTs ? incoming : base;
  }
  if (baseTs === null && incomingTs !== null) return incoming;
  if (baseTs !== null && incomingTs === null) return base;
  return incoming;
};

const mergePageConfigs = (settings: unknown): Record<string, unknown> => {
  const fromSettings =
    isRecord(settings) && isRecord(settings.page_configs)
      ? (settings.page_configs as Record<string, unknown>)
      : {};
  const fromLocal = readLocalPageConfigs();
  const merged: Record<string, unknown> = { ...fromSettings };
  Object.entries(fromLocal).forEach(([pageId, pageConfig]) => {
    merged[pageId] = pickNewestPageConfig(merged[pageId], pageConfig);
  });
  return merged;
};

const readAllPageBlocks = (settings: unknown): Array<{ pageId: string; block: Record<string, unknown>; index: number }> => {
  const rootConfigs = mergePageConfigs(settings);
  const out: Array<{ pageId: string; block: Record<string, unknown>; index: number }> = [];
  Object.entries(rootConfigs).forEach(([pageId, pageRaw]) => {
    if (!isRecord(pageRaw)) return;
    const blocks = Array.isArray(pageRaw.blocks) ? pageRaw.blocks : [];
    blocks.forEach((item, index) => {
      if (!isRecord(item)) return;
      out.push({ pageId, block: item, index });
    });
  });
  return out;
};

export const collectBlockTargets = (settings: unknown): BlockTargetSnapshot[] => {
  const items = readAllPageBlocks(settings)
    .map(({ pageId, block, index }): BlockTargetSnapshot | null => {
      const type = normalizeString(block.type);
      if (!type) return null;
      const blockId = normalizeString(block.id) || `${pageId}:${type}:${index + 1}`;
      const props = isRecord(block.props) ? block.props : {};
      const title =
        normalizeString(props.title) ||
        normalizeString(props.label) ||
        normalizeString(props.text) ||
        blockId;
      const variant = normalizeString(props.variant) || undefined;
      return {
        pageId,
        blockId,
        type,
        title,
        variant,
        props
      };
    })
    .filter((item): item is BlockTargetSnapshot => Boolean(item));

  return items.sort((a, b) => {
    if (a.pageId !== b.pageId) return a.pageId.localeCompare(b.pageId);
    if (a.title !== b.title) return a.title.localeCompare(b.title);
    return a.blockId.localeCompare(b.blockId);
  });
};

export type EditableTableTarget = BlockTargetSnapshot & {
  hasTodoColumn: boolean;
};

const TODO_COLUMN_LABEL_PATTERN = /\bto\s*-?\s*do\b|\btodo\b|\btareas?\b/i;

const editableTableHasTodoColumn = (target: BlockTargetSnapshot, settings: unknown): boolean => {
  const props = target.props || {};
  const schemaRef = normalizeString(props.schemaRef);
  if (schemaRef) {
    const schema = getTableSchema(schemaRef, { settings });
    if (
      schema.columns.some((column) => {
        const typeRef = normalizeString(column.typeRef);
        return typeRef === "todo" || Boolean(typeRef?.startsWith("todo."));
      })
    ) {
      return true;
    }
  }
  if (isRecord(props.customColumnTypes)) {
    const hasTodoType = Object.values(props.customColumnTypes).some((value) => {
      const kind = normalizeString(value);
      return kind === "todo" || Boolean(kind?.startsWith("todo."));
    });
    if (hasTodoType) return true;
  }
  if (Array.isArray(props.customColumns)) {
    const hasTodoLabel = props.customColumns.some((value) => {
      if (typeof value !== "string") return false;
      return TODO_COLUMN_LABEL_PATTERN.test(value.trim());
    });
    if (hasTodoLabel) return true;
  }
  const contentSlotId = normalizeString(props.contentSlotId);
  if (contentSlotId?.startsWith("tracker:content")) return true;
  if (target.pageId === "tracker" && target.blockId === "tracker:table") return true;
  return false;
};

export const collectEditableTableTargets = (
  settings: unknown,
  opts?: { excludeVariants?: string[]; excludeTypes?: string[] }
): EditableTableTarget[] => {
  const exclude = new Set((opts?.excludeVariants || []).map((value) => value.trim()).filter(Boolean));
  const excludeTypes = new Set((opts?.excludeTypes || []).map((value) => value.trim()).filter(Boolean));
  return collectBlockTargets(settings)
    .filter((item) => item.type === "editableTable" || item.type === "todoTable")
    .filter((item) => !excludeTypes.has(item.type))
    .filter((item) => !item.variant || !exclude.has(item.variant))
    .map((item) => ({
      ...item,
      hasTodoColumn: editableTableHasTodoColumn(item, settings)
    }));
};

export const formatBlockTargetLabel = (target: { pageId: string; title: string; blockId: string }) =>
  `[${target.pageId}] ${target.title} (${target.blockId})`;
