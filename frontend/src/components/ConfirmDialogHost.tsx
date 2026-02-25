import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  subscribeConfirmDialog,
  type ConfirmDialogRequest
} from "../shared/confirmDialog";

const ConfirmDialogHost: React.FC = () => {
  const [queue, setQueue] = useState<ConfirmDialogRequest[]>([]);

  const closeCurrent = useCallback((confirmed: boolean) => {
    setQueue((prev) => {
      if (!prev.length) return prev;
      const [current, ...rest] = prev;
      current.resolve(confirmed);
      return rest;
    });
  }, []);

  useEffect(() => {
    return subscribeConfirmDialog((request) => {
      setQueue((prev) => [...prev, request]);
    });
  }, []);

  useEffect(() => {
    return () => {
      setQueue((prev) => {
        prev.forEach((request) => request.resolve(false));
        return [];
      });
    };
  }, []);

  const current = queue[0] || null;

  useEffect(() => {
    if (!current) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCurrent(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeCurrent, current]);

  if (!current || typeof document === "undefined") return null;

  const confirmButtonClass = current.tone === "danger" ? "danger" : "primary";

  return createPortal(
    <div
      className="confirm-dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={current.title}
      onClick={() => closeCurrent(false)}
    >
      <div className="confirm-dialog-modal" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-dialog-body">
          <h3>{current.title}</h3>
          <p>{current.message}</p>
        </div>
        <div className="confirm-dialog-actions">
          <button type="button" className="ghost" onClick={() => closeCurrent(false)}>
            {current.cancelLabel}
          </button>
          <button
            type="button"
            className={confirmButtonClass}
            onClick={() => closeCurrent(true)}
          >
            {current.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ConfirmDialogHost;
