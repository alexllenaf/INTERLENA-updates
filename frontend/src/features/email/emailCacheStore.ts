import { create } from "zustand";

type EmailCacheState = {
  maxEntries: number;
  order: string[];
  bodies: Record<string, string>;
  configureLimit: (next: number) => void;
  getBody: (messageId: string) => string | undefined;
  setBody: (messageId: string, body: string) => void;
};

const clampLimit = (value: number) => Math.max(30, Math.min(50, Math.round(value)));

export const useEmailCacheStore = create<EmailCacheState>((set, get) => ({
  maxEntries: 50,
  order: [],
  bodies: {},
  configureLimit: (next) => {
    const nextLimit = clampLimit(next);
    const { order, bodies } = get();
    if (order.length <= nextLimit) {
      set({ maxEntries: nextLimit });
      return;
    }

    const removeCount = order.length - nextLimit;
    const removeIds = order.slice(0, removeCount);
    const nextBodies = { ...bodies };
    removeIds.forEach((id) => {
      delete nextBodies[id];
    });

    set({
      maxEntries: nextLimit,
      order: order.slice(removeCount),
      bodies: nextBodies
    });
  },
  getBody: (messageId) => get().bodies[messageId],
  setBody: (messageId, body) => {
    const { maxEntries, order, bodies } = get();
    const hasMessage = Boolean(bodies[messageId]);
    const nextOrder = hasMessage ? order.filter((id) => id !== messageId) : [...order];
    nextOrder.push(messageId);

    const nextBodies = { ...bodies, [messageId]: body };
    while (nextOrder.length > maxEntries) {
      const oldest = nextOrder.shift();
      if (oldest) {
        delete nextBodies[oldest];
      }
    }

    set({ order: nextOrder, bodies: nextBodies });
  }
}));
