import { Settings } from "../../types";
import { PAGE_BLOCK_REGISTRY, createDefaultPageBlock } from "./blockRegistry";
import { GridLayout, PAGE_CONFIG_VERSION, PageBlockConfig, PageBlockType, PageConfig, clampColSpan } from "./types";
import { snapColStartToSpanGrid } from "./gridSlots";

export const PAGE_CONFIGS_SETTINGS_KEY = "page_configs";
const PAGE_CONFIGS_LOCAL_KEY = "page_configs_local_v1";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const withTimestamp = (pageConfig: PageConfig): PageConfig =>
  pageConfig.updated_at
    ? pageConfig
    : { ...pageConfig, updated_at: new Date().toISOString() };

const parseTimestamp = (value: unknown): number | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

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

export const hasStoredPageConfig = (settings: Settings, pageId: string): boolean => {
  const root = settings as unknown as Record<string, unknown>;
  const settingsConfigs = isRecord(root[PAGE_CONFIGS_SETTINGS_KEY]) ? root[PAGE_CONFIGS_SETTINGS_KEY] : null;
  const hasSettingsConfig = Boolean(settingsConfigs && isRecord(settingsConfigs[pageId]));
  if (hasSettingsConfig) return true;
  const localConfigs = readLocalPageConfigs();
  return isRecord(localConfigs[pageId]);
};

const writeLocalPageConfig = (pageId: string, pageConfig: PageConfig) => {
  if (typeof window === "undefined") return;
  try {
    const nextConfig = withTimestamp(pageConfig);
    const all = readLocalPageConfigs();
    const next = { ...all, [pageId]: nextConfig };
    window.localStorage.setItem(PAGE_CONFIGS_LOCAL_KEY, JSON.stringify(next));
  } catch {
    // ignore storage failures
  }
};

export const persistPageConfigLocal = (pageId: string, pageConfig: PageConfig) => {
  writeLocalPageConfig(pageId, pageConfig);
};

const normalizeLayout = (raw: unknown, fallback: GridLayout): GridLayout => {
  if (!isRecord(raw)) return fallback;
  const colSpanRaw = Number(raw.colSpan);
  const colStartRaw = raw.colStart === undefined ? undefined : Number(raw.colStart);
  const rowStartRaw = raw.rowStart === undefined ? undefined : Number(raw.rowStart);
  const colSpan = Number.isFinite(colSpanRaw) ? clampColSpan(colSpanRaw) : fallback.colSpan;
  const colStart =
    colStartRaw !== undefined && Number.isFinite(colStartRaw)
      ? snapColStartToSpanGrid(colStartRaw, colSpan)
      : undefined;
  const rowStart =
    rowStartRaw !== undefined && Number.isFinite(rowStartRaw) ? Math.max(1, Math.round(rowStartRaw)) : undefined;
  return { colSpan, colStart, rowStart };
};

const isKnownType = (value: unknown): value is PageBlockType =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(PAGE_BLOCK_REGISTRY, value);

const normalizeBlock = (raw: unknown, index: number): PageBlockConfig | null => {
  if (!isRecord(raw) || !isKnownType(raw.type)) return null;
  const template = createDefaultPageBlock(raw.type, `${raw.type}:${index}`);
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id : template.id;
  const layout = normalizeLayout(raw.layout, template.layout);
  const props = isRecord(raw.props) ? { ...template.props, ...raw.props } : template.props;
  return {
    ...template,
    id,
    layout,
    props: props as any
  };
};

export const normalizePageConfig = (pageId: string, raw: unknown, fallback: PageConfig): PageConfig => {
  if (!isRecord(raw)) {
    return {
      ...fallback,
      id: pageId,
      version: fallback.version || PAGE_CONFIG_VERSION
    };
  }
  const rawBlocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  const blocks = rawBlocks
    .map((item, index) => normalizeBlock(item, index))
    .filter((item): item is PageBlockConfig => Boolean(item));
  return {
    id: pageId,
    version:
      typeof raw.version === "number" && Number.isFinite(raw.version)
        ? Math.max(1, Math.round(raw.version))
        : fallback.version || PAGE_CONFIG_VERSION,
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : fallback.updated_at,
    blocks: blocks.length > 0 ? blocks : fallback.blocks
  };
};

export const readPageConfig = (settings: Settings, pageId: string, fallback: PageConfig): PageConfig => {
  const all = (settings as unknown as Record<string, unknown>)[PAGE_CONFIGS_SETTINGS_KEY];
  const settingsRaw = isRecord(all) ? all[pageId] : null;
  const fromSettings = isRecord(all) ? normalizePageConfig(pageId, settingsRaw, fallback) : normalizePageConfig(pageId, null, fallback);
  const localAll = readLocalPageConfigs();
  const localRaw = localAll[pageId];
  if (!isRecord(localRaw)) return fromSettings;

  const fromLocal = normalizePageConfig(pageId, localRaw, fallback);
  const localTs = parseTimestamp(fromLocal.updated_at);
  const settingsTs = parseTimestamp(fromSettings.updated_at);

  if (localTs !== null && settingsTs !== null) {
    if (localTs >= settingsTs) return fromLocal;
    writeLocalPageConfig(pageId, fromSettings);
    return fromSettings;
  }
  if (localTs !== null) return fromLocal;
  if (settingsTs !== null) {
    writeLocalPageConfig(pageId, fromSettings);
    return fromSettings;
  }
  return fromLocal;
};

export const writePageConfig = (settings: Settings, pageId: string, pageConfig: PageConfig): Settings => {
  const nextConfig = withTimestamp(pageConfig);
  writeLocalPageConfig(pageId, nextConfig);
  const root = settings as unknown as Record<string, unknown>;
  const current = isRecord(root[PAGE_CONFIGS_SETTINGS_KEY]) ? root[PAGE_CONFIGS_SETTINGS_KEY] : {};
  const next = { ...current, [pageId]: nextConfig };
  return {
    ...settings,
    [PAGE_CONFIGS_SETTINGS_KEY]: next
  } as Settings;
};
