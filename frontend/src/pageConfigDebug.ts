// Optional diagnostics for page-config persistence.
// Disabled by default; enable only when debugging:
//   localStorage.setItem("debug:page-config-trace", "1")
//   window.__PAGE_CONFIG_TRACE_LOGS__ = []
// Disable again:
//   localStorage.removeItem("debug:page-config-trace")
//   delete window.__PAGE_CONFIG_TRACE_LOGS__
const PAGE_CONFIG_TRACE_FLAG_KEY = "debug:page-config-trace";
const MAX_TRACE_ENTRIES = 500;

type TraceEntry = {
  at: string;
  event: string;
  payload?: Record<string, unknown>;
};

type TraceWindow = Window & {
  __PAGE_CONFIG_TRACE_LOGS__?: TraceEntry[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const getTraceWindow = (): TraceWindow | null => {
  if (typeof window === "undefined") return null;
  return window as TraceWindow;
};

export const isPageConfigTraceEnabled = (): boolean => {
  const traceWindow = getTraceWindow();
  if (!traceWindow) return false;
  return traceWindow.localStorage.getItem(PAGE_CONFIG_TRACE_FLAG_KEY) === "1";
};

const pushTraceBuffer = (entry: TraceEntry) => {
  const traceWindow = getTraceWindow();
  if (!traceWindow) return;
  const buffer = Array.isArray(traceWindow.__PAGE_CONFIG_TRACE_LOGS__)
    ? [...traceWindow.__PAGE_CONFIG_TRACE_LOGS__]
    : [];
  buffer.push(entry);
  if (buffer.length > MAX_TRACE_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_TRACE_ENTRIES);
  }
  traceWindow.__PAGE_CONFIG_TRACE_LOGS__ = buffer;
};

export const tracePageConfig = (event: string, payload?: Record<string, unknown>) => {
  if (!isPageConfigTraceEnabled()) return;
  let safePayload: Record<string, unknown> | undefined = undefined;
  if (payload) {
    try {
      safePayload = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
    } catch {
      safePayload = { ...payload };
    }
  }
  const entry: TraceEntry = {
    at: new Date().toISOString(),
    event,
    payload: safePayload
  };
  pushTraceBuffer(entry);
  // eslint-disable-next-line no-console
  console.debug(`[page-config] ${entry.at} ${event}`, safePayload || {});
};

export const summarizePageConfig = (value: unknown): Record<string, unknown> | null => {
  if (!isRecord(value)) return null;
  const blocksRaw = Array.isArray(value.blocks) ? value.blocks : [];
  const blocks = blocksRaw.map((item, index) => {
    if (!isRecord(item)) {
      return { index, invalid: true };
    }
    const layout = isRecord(item.layout) ? item.layout : {};
    return {
      id: typeof item.id === "string" ? item.id : `#${index}`,
      type: typeof item.type === "string" ? item.type : null,
      colSpan: Number(layout.colSpan) || null,
      colStart: layout.colStart === undefined ? null : Number(layout.colStart) || null,
      rowStart: layout.rowStart === undefined ? null : Number(layout.rowStart) || null
    };
  });
  return {
    id: typeof value.id === "string" ? value.id : null,
    updated_at: typeof value.updated_at === "string" ? value.updated_at : null,
    blockCount: blocks.length,
    blocks
  };
};

export const summarizePageConfigs = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) return {};
  const out: Record<string, unknown> = {};
  Object.entries(value).forEach(([pageId, pageConfig]) => {
    const summary = summarizePageConfig(pageConfig);
    out[pageId] = summary
      ? {
          updated_at: summary.updated_at,
          blockCount: summary.blockCount
        }
      : { invalid: true };
  });
  return out;
};
