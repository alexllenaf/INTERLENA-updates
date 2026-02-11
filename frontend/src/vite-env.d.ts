/// <reference types="vite/client" />

type IdleRequestCallback = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void;
type IdleRequestOptions = { timeout?: number };

interface Window {
  requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  cancelIdleCallback?: (handle: number) => void;
}
