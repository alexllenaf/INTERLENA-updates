import { GRID_TOTAL_COLUMNS } from "../blocks/types";
import { clampColSpan } from "./types";

export const getAllowedColStartsForSpan = (
  colSpan: number,
  totalColumns: number = GRID_TOTAL_COLUMNS
): number[] => {
  const span = clampColSpan(colSpan);
  const maxColStart = Math.max(1, totalColumns - span + 1);
  const starts: number[] = [];
  for (let colStart = 1; colStart <= maxColStart; colStart += span) {
    starts.push(colStart);
  }
  if (starts.length === 0 || starts[starts.length - 1] !== maxColStart) {
    starts.push(maxColStart);
  }
  return starts;
};

export const snapColStartToSpanGrid = (
  colStart: number,
  colSpan: number,
  totalColumns: number = GRID_TOTAL_COLUMNS
): number => {
  const starts = getAllowedColStartsForSpan(colSpan, totalColumns);
  const target = Math.max(1, Math.round(colStart));

  let best = starts[0];
  let bestDistance = Math.abs(target - best);

  for (let index = 1; index < starts.length; index += 1) {
    const candidate = starts[index];
    const distance = Math.abs(target - candidate);
    if (distance < bestDistance || (distance === bestDistance && candidate < best)) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
};
