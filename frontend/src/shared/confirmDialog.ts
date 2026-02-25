export type ConfirmDialogTone = "default" | "danger";

export type ConfirmDialogOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmDialogTone;
};

export type ConfirmDialogRequest = {
  id: string;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: ConfirmDialogTone;
  resolve: (confirmed: boolean) => void;
};

type ConfirmDialogSubscriber = (request: ConfirmDialogRequest) => void;

let subscriber: ConfirmDialogSubscriber | null = null;
const queuedRequests: ConfirmDialogRequest[] = [];
let requestCounter = 0;

const normalizeRequest = (
  options: ConfirmDialogOptions,
  resolve: (confirmed: boolean) => void
): ConfirmDialogRequest => {
  requestCounter += 1;
  return {
    id: `confirm-${Date.now()}-${requestCounter}`,
    title: options.title || "Confirm action",
    message: options.message,
    confirmLabel: options.confirmLabel || "Confirm",
    cancelLabel: options.cancelLabel || "Cancel",
    tone: options.tone || "default",
    resolve
  };
};

const flushQueue = () => {
  if (!subscriber || queuedRequests.length === 0) return;
  while (queuedRequests.length > 0) {
    const next = queuedRequests.shift();
    if (!next) break;
    subscriber(next);
  }
};

export const subscribeConfirmDialog = (nextSubscriber: ConfirmDialogSubscriber): (() => void) => {
  subscriber = nextSubscriber;
  flushQueue();
  return () => {
    if (subscriber === nextSubscriber) {
      subscriber = null;
    }
  };
};

export const confirmDialog = (options: ConfirmDialogOptions): Promise<boolean> => {
  return new Promise((resolve) => {
    const request = normalizeRequest(options, resolve);
    if (subscriber) {
      subscriber(request);
      return;
    }
    queuedRequests.push(request);
  });
};
