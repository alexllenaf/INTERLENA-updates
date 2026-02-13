import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";

type BlockTexture = "flat" | "glass";

type BlockStyle = {
  texture: BlockTexture;
  color: string | null;
};

const STORAGE_KEY = "block_styles_v1";
const MENU_WIDTH = 320;
const MENU_GUTTER = 12;
const MENU_OFFSET = 8;
const MENU_ANIM_MS = 160;

const DEFAULT_STYLE: BlockStyle = { texture: "flat", color: null };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const parseHexColor = (raw: string): { r: number; g: number; b: number } | null => {
  const hex = raw.trim();
  const cleaned = hex.startsWith("#") ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(cleaned)) return null;
  const full =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : cleaned;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return { r, g, b };
};

const parseRgbColor = (
  raw: string
): { r: number; g: number; b: number; a: number } | null => {
  const m = raw
    .trim()
    .match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+)\s*)?\)$/i);
  if (!m) return null;
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  const a = m[4] === undefined ? 1 : Number(m[4]);
  if ([r, g, b, a].some((n) => Number.isNaN(n))) return null;
  return {
    r: clamp(r, 0, 255),
    g: clamp(g, 0, 255),
    b: clamp(b, 0, 255),
    a: clamp(a, 0, 1)
  };
};

const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

const isDarkOnWhite = (r: number, g: number, b: number, a: number) => {
  // Assume the page background is light, so translucent colors trend toward white.
  const blended = a * luma(r, g, b) + (1 - a) * 255;
  return blended < 145;
};

const rgba = (r: number, g: number, b: number, a: number) => `rgba(${r},${g},${b},${a})`;

const readAll = (): Record<string, BlockStyle> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const obj = parsed as Record<string, unknown>;
    const next: Record<string, BlockStyle> = {};
    Object.entries(obj).forEach(([key, value]) => {
      if (!value || typeof value !== "object") return;
      const v = value as Record<string, unknown>;
      const texture = v.texture === "glass" || v.texture === "flat" ? v.texture : "flat";
      const color = typeof v.color === "string" ? v.color : null;
      next[key] = { texture, color };
    });
    return next;
  } catch {
    return {};
  }
};

const writeAll = (map: Record<string, BlockStyle>) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
};

const readStyle = (id: string): BlockStyle => {
  const map = readAll();
  return map[id] || DEFAULT_STYLE;
};

const writeStyle = (id: string, style: BlockStyle) => {
  const next = readAll();
  const isDefault = style.texture === DEFAULT_STYLE.texture && !style.color;
  if (isDefault) {
    delete next[id];
  } else {
    next[id] = style;
  }
  writeAll(next);
};

const COLOR_SWATCHES: { key: string; label: string; value: string | null }[] = [
  { key: "default", label: "Default", value: null },
  { key: "white", label: "White", value: "#ffffff" },
  { key: "paper", label: "Paper", value: "#f7fafc" },
  { key: "sand", label: "Sand", value: "#f6f1ea" },
  { key: "mint", label: "Mint", value: "#d1fae5" },
  { key: "sage", label: "Sage", value: "#dcfce7" },
  { key: "sky", label: "Sky", value: "#e0f2fe" },
  { key: "blue", label: "Blue", value: "#2f42c6" },
  { key: "indigo", label: "Indigo", value: "#4f46e5" },
  { key: "purple", label: "Purple", value: "#7c3aed" },
  { key: "rose", label: "Rose", value: "#fb7185" },
  { key: "slate", label: "Slate", value: "#0f172a" }
];

type Props = {
  id: string;
  as?: "section" | "div";
  className?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
};

const BlockPanel: React.FC<Props> = ({ id, as = "section", className = "", children, style }) => {
  const { t } = useI18n();
  const [blockStyle, setBlockStyle] = useState<BlockStyle>(() => readStyle(id));
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; placement: "top" | "bottom" } | null>(
    null
  );
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setBlockStyle(readStyle(id));
  }, [id]);

  const computePos = useCallback(() => {
    const anchor = buttonRef.current;
    const menu = menuRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = menu?.offsetWidth || MENU_WIDTH;
    const height = menu?.offsetHeight || 260;
    const maxLeft = Math.max(MENU_GUTTER, window.innerWidth - width - MENU_GUTTER);
    const left = clamp(rect.right - width, MENU_GUTTER, maxLeft);

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const shouldFlip = spaceBelow < height + MENU_OFFSET && spaceAbove > spaceBelow;
    const placement: "top" | "bottom" = shouldFlip ? "top" : "bottom";
    const rawTop =
      placement === "bottom"
        ? rect.bottom + MENU_OFFSET
        : rect.top - height - MENU_OFFSET;
    const maxTop = Math.max(MENU_GUTTER, window.innerHeight - height - MENU_GUTTER);
    const top = clamp(rawTop, MENU_GUTTER, maxTop);
    setPos({ top, left, placement });
  }, []);

  const closeMenuImmediate = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(false);
    setPos(null);
    setVisible(false);
  };

  const closeMenu = () => {
    setVisible(false);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      closeMenuImmediate();
      buttonRef.current?.focus();
    }, MENU_ANIM_MS);
  };

  useEffect(() => {
    if (!open) return;
    const raf = window.requestAnimationFrame(() => {
      computePos();
      setVisible(true);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [open, computePos]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event: MouseEvent) => {
      const menuEl = menuRef.current;
      const anchor = buttonRef.current;
      if (!menuEl || !anchor) return;
      if (!(event.target instanceof Node)) return;
      if (menuEl.contains(event.target) || anchor.contains(event.target)) return;
      closeMenu();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
      }
    };
    const handleReflow = () => computePos();
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleReflow, true);
    window.addEventListener("resize", handleReflow);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleReflow, true);
      window.removeEventListener("resize", handleReflow);
    };
  }, [open, computePos]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  const updateBlockStyle = (patch: Partial<BlockStyle>) => {
    setBlockStyle((prev) => {
      const next = { ...prev, ...patch };
      writeStyle(id, next);
      return next;
    });
  };

  const derived = useMemo(() => {
    const texture = blockStyle.texture;
    const color = blockStyle.color;
    const vars: Record<string, string> = {};
    let dark = false;
    if (color) {
      const rgb =
        parseHexColor(color) ||
        (() => {
          const parsed = parseRgbColor(color);
          return parsed ? { r: parsed.r, g: parsed.g, b: parsed.b } : null;
        })();
      if (texture === "glass") {
        const alpha = 0.36;
        if (rgb) {
          vars["--block-bg"] = rgba(rgb.r, rgb.g, rgb.b, alpha);
          vars["--block-shadow"] = `0 10px 24px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.26)`;
          dark = isDarkOnWhite(rgb.r, rgb.g, rgb.b, alpha);
        } else {
          vars["--block-bg"] = color;
        }
      } else {
        vars["--block-bg"] = color;
        if (rgb) {
          dark = isDarkOnWhite(rgb.r, rgb.g, rgb.b, 1);
        }
      }
    }

    if (dark) {
      vars["--text"] = "#ffffff";
      vars["--muted"] = "rgba(255,255,255,0.78)";
      vars["--border"] = "rgba(255,255,255,0.20)";
      vars["--surface-alt"] = "rgba(255,255,255,0.10)";
    }

    return { vars, dark };
  }, [blockStyle]);

  const panelClass = [
    "panel",
    "block-panel",
    blockStyle.texture === "glass" ? "block-glass" : "block-flat",
    className
  ]
    .filter(Boolean)
    .join(" ");

  const mergedStyle: React.CSSProperties = useMemo(() => {
    const next: React.CSSProperties = { ...(style || {}) };
    Object.entries(derived.vars).forEach(([key, value]) => {
      (next as any)[key] = value;
    });
    return next;
  }, [style, derived.vars]);

  const Tag = as;
  const menu = open && pos && typeof document !== "undefined"
    ? createPortal(
        <div
          className={`block-style-menu ${visible ? "open" : ""}`}
          data-placement={pos.placement}
          style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
          ref={menuRef}
          role="dialog"
          aria-modal="false"
        >
          <div className="block-style-menu-header">
            <div className="block-style-menu-title">{t("Block style")}</div>
            <button className="ghost small" type="button" onClick={closeMenu}>
              {t("Close")}
            </button>
          </div>

          <div className="block-style-menu-section">
            <div className="block-style-menu-label">{t("Texture")}</div>
            <div className="block-style-toggle">
              <button
                type="button"
                className={blockStyle.texture === "flat" ? "active" : ""}
                onClick={() => updateBlockStyle({ texture: "flat" })}
              >
                {t("Flat")}
              </button>
              <button
                type="button"
                className={blockStyle.texture === "glass" ? "active" : ""}
                onClick={() => updateBlockStyle({ texture: "glass" })}
              >
                {t("Glass")}
              </button>
            </div>
          </div>

          <div className="block-style-menu-section">
            <div className="block-style-menu-label">{t("Color")}</div>
            <div className="block-style-swatches">
              {COLOR_SWATCHES.map((swatch) => {
                const selected = swatch.value === blockStyle.color;
                const isDefault = swatch.value === null && blockStyle.color === null;
                const isSelected = selected || isDefault;
                const swatchLabel = t(swatch.label);
                return (
                  <button
                    key={swatch.key}
                    type="button"
                    className={`block-style-swatch ${isSelected ? "selected" : ""} ${
                      swatch.value === null ? "default" : ""
                    }`}
                    title={swatchLabel}
                    aria-label={swatchLabel}
                    style={swatch.value ? { background: swatch.value } : undefined}
                    onClick={() => updateBlockStyle({ color: swatch.value })}
                  />
                );
              })}
            </div>
            <div className="block-style-custom">
              <label className="block-style-custom-label">
                {t("Custom")}
                <input
                  type="color"
                  value={parseHexColor(blockStyle.color || "#ffffff") ? (blockStyle.color as string) : "#ffffff"}
                  onChange={(event) => updateBlockStyle({ color: event.target.value })}
                />
              </label>
              <button
                className="ghost small"
                type="button"
                onClick={() => updateBlockStyle(DEFAULT_STYLE)}
              >
                {t("Reset")}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <Tag
        className={panelClass}
        style={mergedStyle}
        data-block-id={id}
        data-settings-open={open ? "true" : "false"}
      >
        <div className="block-settings">
          <button
            className="block-settings-button"
            type="button"
            aria-label={t("Block settings")}
            ref={buttonRef}
            onClick={() => {
              if (open) closeMenuImmediate();
              else setOpen(true);
            }}
          >
            ...
          </button>
        </div>
        {children}
      </Tag>
      {menu}
    </>
  );
};

export default BlockPanel;
