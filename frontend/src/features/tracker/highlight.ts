export type HighlightChunk = {
  text: string;
  match: boolean;
};

export const buildHighlightChunks = (text: string, query: string): HighlightChunk[] => {
  const source = text || "";
  const needle = query.trim();
  if (!source || !needle) return [{ text: source, match: false }];

  const lowerSource = source.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const chunks: HighlightChunk[] = [];

  let cursor = 0;
  while (cursor < source.length) {
    const idx = lowerSource.indexOf(lowerNeedle, cursor);
    if (idx < 0) {
      chunks.push({ text: source.slice(cursor), match: false });
      break;
    }
    if (idx > cursor) {
      chunks.push({ text: source.slice(cursor, idx), match: false });
    }
    chunks.push({ text: source.slice(idx, idx + needle.length), match: true });
    cursor = idx + needle.length;
  }

  return chunks.length ? chunks : [{ text: source, match: false }];
};
