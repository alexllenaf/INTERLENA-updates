export const COMPACT_TEXT_MAX_CHARS = 40;

export const isCompactTextValue = (value: unknown, maxChars = COMPACT_TEXT_MAX_CHARS): boolean => {
  const text = value === null || value === undefined ? "" : String(value);
  const trimmed = text.trim();
  if (!trimmed) return true;
  return !trimmed.includes("\n") && trimmed.length <= maxChars;
};
