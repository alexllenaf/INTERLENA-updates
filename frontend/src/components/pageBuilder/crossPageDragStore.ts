import { PageBlockConfig } from "./types";

export type SharedDragState = {
  sourcePageId: string;
  blockId: string;
  dragBlock: PageBlockConfig;
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
  updatedAt: number;
};

let sharedDragState: SharedDragState | null = null;

export const getCrossPageDragState = (): SharedDragState | null => sharedDragState;

export const setCrossPageDragState = (next: SharedDragState | null) => {
  sharedDragState = next;
};

export const clearCrossPageDragState = () => {
  sharedDragState = null;
};
