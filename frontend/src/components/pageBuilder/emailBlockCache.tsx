/**
 * EmailBlockCache — lightweight React context that lets an email block
 * publish its already-loaded messages so that sibling blocks (e.g.
 * informational table) can reuse them without re-fetching from the API.
 *
 * The cache is keyed by the **source email block id**. Each entry stores
 * the array of messages together with a `ready` flag that consumer blocks
 * can check before falling back to their own HTTP requests.
 */

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { EmailMetadata } from "../../types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Shape stored for every message published by an email block. */
export type CachedEmailMessage = EmailMetadata & {
  contactEmail: string;
  contactName: string;
  contactCompany: string;
};

export type EmailBlockCacheEntry = {
  /** `true` once the email block has finished at least one successful load. */
  ready: boolean;
  /** `true` while the email block is actively loading / refreshing. */
  loading: boolean;
  messages: CachedEmailMessage[];
  /** Timestamp (ms) of last publish so consumers can react to updates. */
  updatedAt: number;
};

type PublishPayload = {
  blockId: string;
  ready: boolean;
  loading: boolean;
  messages: CachedEmailMessage[];
};

type EmailBlockCacheContextValue = {
  /** Get a snapshot for a specific email block.  Returns `null` when nothing has been published yet. */
  get: (blockId: string) => EmailBlockCacheEntry | null;
  /** Called by email blocks to publish / update their loaded messages. */
  publish: (payload: PublishPayload) => void;
  /** Remove a block's entry (e.g. on unmount). */
  evict: (blockId: string) => void;
  /** Monotonic counter bumped on every publish — lets consumers trigger re-renders via `useMemo`. */
  version: number;
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const EmailBlockCacheContext = createContext<EmailBlockCacheContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const EmailBlockCacheProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const cacheRef = useRef<Map<string, EmailBlockCacheEntry>>(new Map());
  const [version, setVersion] = useState(0);

  const publish = useCallback((payload: PublishPayload) => {
    const next: EmailBlockCacheEntry = {
      ready: payload.ready,
      loading: payload.loading,
      messages: payload.messages,
      updatedAt: Date.now(),
    };
    cacheRef.current.set(payload.blockId, next);
    setVersion((v) => v + 1);
  }, []);

  const evict = useCallback((blockId: string) => {
    if (cacheRef.current.delete(blockId)) {
      setVersion((v) => v + 1);
    }
  }, []);

  const get = useCallback((blockId: string): EmailBlockCacheEntry | null => {
    return cacheRef.current.get(blockId) ?? null;
  }, []);

  const value = useMemo<EmailBlockCacheContextValue>(
    () => ({ get, publish, evict, version }),
    [get, publish, evict, version],
  );

  return (
    <EmailBlockCacheContext.Provider value={value}>
      {children}
    </EmailBlockCacheContext.Provider>
  );
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Use inside a block that **produces** email messages (email block). */
export const useEmailBlockCachePublisher = () => {
  const ctx = useContext(EmailBlockCacheContext);
  return ctx;
};

/** Use inside a block that **consumes** cached messages (informational table, etc.). */
export const useEmailBlockCacheEntry = (sourceBlockId: string | null | undefined): EmailBlockCacheEntry | null => {
  const ctx = useContext(EmailBlockCacheContext);
  // Subscribe to version so we re-render when the cache updates
  const _version = ctx?.version;
  void _version; // read dependency
  if (!ctx || !sourceBlockId) return null;
  return ctx.get(sourceBlockId);
};
