/**
 * RichTextEditor — WYSIWYG email body editor powered by TipTap (MIT).
 *
 * Features: bold, italic, underline, strikethrough, headings, font family,
 * font size, text colour, highlight, alignment, bullet / ordered lists,
 * links, undo / redo, and clear formatting.
 *
 * The editor outputs HTML via `onChange(html)`.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import Placeholder from "@tiptap/extension-placeholder";
import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";

/* ── Custom FontSize extension (TipTap doesn't ship one by default) ─── */
import { Extension } from "@tiptap/react";

const FontSize = Extension.create({
  name: "fontSize",
  addOptions() {
    return { types: ["textStyle"] };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el) => el.style.fontSize?.replace(/['"]+/g, "") || null,
            renderHTML: (attrs) => {
              if (!attrs.fontSize) return {};
              return { style: `font-size: ${attrs.fontSize}` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }: { chain: () => any }) =>
          chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }: { chain: () => any }) =>
          chain().setMark("textStyle", { fontSize: null }).run(),
    } as any;
  },
});

const ATTACHMENT_ICON_MIN_SIZE = 28;
const ATTACHMENT_ICON_MAX_SIZE = 96;
const ATTACHMENT_ICON_DEFAULT_SIZE = 42;
const ATTACHMENT_IMAGE_MIN_WIDTH = 120;
const ATTACHMENT_IMAGE_MAX_WIDTH = 960;
const ATTACHMENT_IMAGE_DEFAULT_WIDTH = 360;

const clampAttachmentIconSize = (value: number): number =>
  Math.max(ATTACHMENT_ICON_MIN_SIZE, Math.min(ATTACHMENT_ICON_MAX_SIZE, Math.round(value || ATTACHMENT_ICON_DEFAULT_SIZE)));

const clampAttachmentImageWidth = (value: number): number =>
  Math.max(
    ATTACHMENT_IMAGE_MIN_WIDTH,
    Math.min(ATTACHMENT_IMAGE_MAX_WIDTH, Math.round(value || ATTACHMENT_IMAGE_DEFAULT_WIDTH))
  );

type EmailAttachmentKind = "image" | "document";

type RichTextAttachmentCatalogItem = {
  kind: EmailAttachmentKind;
  filename: string;
  sizeBytes: number;
  previewUrl?: string;
  renderWidth?: number;
};

const formatAttachmentSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
};

const listInlineAttachmentIds = (editor: Editor): string[] => {
  const ids = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (node.type?.name !== "emailAttachment") return;
    const id = String((node.attrs as Record<string, unknown>)?.attachmentId || "").trim();
    if (id) ids.add(id);
  });
  return Array.from(ids);
};

const EmailAttachmentIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg
    viewBox="0 0 20 20"
    aria-hidden="true"
    style={{ width: size, height: size, display: "block" }}
  >
    <path
      d="M5 2.75A1.75 1.75 0 0 0 3.25 4.5v11A1.75 1.75 0 0 0 5 17.25h10A1.75 1.75 0 0 0 16.75 15.5V7.19a1.75 1.75 0 0 0-.5-1.23l-2.72-2.71a1.75 1.75 0 0 0-1.23-.5H5Zm0 1.5h6.75v2.5c0 .97.78 1.75 1.75 1.75h1.75v7a.25.25 0 0 1-.25.25H5a.25.25 0 0 1-.25-.25v-11c0-.14.11-.25.25-.25Zm1.5 7.25a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1-.75-.75Zm0 2.5a.75.75 0 0 1 .75-.75h3.75a.75.75 0 0 1 0 1.5H7.25a.75.75 0 0 1-.75-.75Z"
      fill="currentColor"
    />
  </svg>
);

const EmailAttachmentNodeView: React.FC<NodeViewProps> = (props) => {
  const { node, selected, updateAttributes, extension } = props;
  const attachmentId = String(node.attrs.attachmentId || "");
  const extensionOptions = ((extension as any)?.options || {}) as {
    resolveAttachment?: (id: string) => RichTextAttachmentCatalogItem | null;
    onAttachmentResize?: (id: string, width: number) => void;
  };
  const resolved = extensionOptions.resolveAttachment?.(attachmentId) || null;
  const nodeKind: EmailAttachmentKind = node.attrs.kind === "image" ? "image" : "document";
  const resolvedKind: EmailAttachmentKind | null =
    resolved?.kind === "image" || resolved?.kind === "document" ? resolved.kind : null;
  const kind: EmailAttachmentKind = resolvedKind || nodeKind;
  const filename = String(node.attrs.filename || resolved?.filename || "Documento");
  const sizeBytes = Number(resolved?.sizeBytes || node.attrs.sizeBytes || 0) || 0;
  const renderWidth = clampAttachmentImageWidth(
    Number(node.attrs.renderWidth || resolved?.renderWidth || ATTACHMENT_IMAGE_DEFAULT_WIDTH)
  );
  const previewUrl = kind === "image" ? String(resolved?.previewUrl || "").trim() : "";
  const iconSize = clampAttachmentIconSize(Number(node.attrs.iconSize) || ATTACHMENT_ICON_DEFAULT_SIZE);
  const resizeStartRef = useRef<{ x: number; width: number } | null>(null);

  // Keep stored HTML attrs aligned with the canonical attachment type.
  useEffect(() => {
    if (!resolvedKind || resolvedKind === nodeKind) return;
    updateAttributes({ kind: resolvedKind });
  }, [nodeKind, resolvedKind, updateAttributes]);

  const setPresetSize = useCallback(
    (next: number, notify = false) => {
      const width = clampAttachmentImageWidth(next);
      updateAttributes({ renderWidth: width });
      if (notify && attachmentId) {
        extensionOptions.onAttachmentResize?.(attachmentId, width);
      }
    },
    [attachmentId, extensionOptions, updateAttributes]
  );

  const onResizeStart = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (kind !== "image") return;
      event.preventDefault();
      event.stopPropagation();
      resizeStartRef.current = { x: event.clientX, width: renderWidth };
      let latestWidth = renderWidth;

      const onMove = (moveEvent: MouseEvent) => {
        const start = resizeStartRef.current;
        if (!start) return;
        const delta = moveEvent.clientX - start.x;
        latestWidth = clampAttachmentImageWidth(start.width + delta);
        updateAttributes({ renderWidth: latestWidth });
      };

      const onUp = () => {
        resizeStartRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (attachmentId) {
          extensionOptions.onAttachmentResize?.(attachmentId, latestWidth);
        }
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [attachmentId, extensionOptions, kind, renderWidth, updateAttributes]
  );

  return (
    <NodeViewWrapper
      as="span"
      className={`email-attachment-node-view${selected ? " is-selected" : ""}`}
      draggable
      data-email-attachment="true"
      data-attachment-id={String(node.attrs.attachmentId || "")}
      data-attachment-kind={kind}
      data-icon-size={String(iconSize)}
      data-render-width={kind === "image" ? String(renderWidth) : undefined}
      style={{
        ["--email-attachment-icon-size" as any]: `${iconSize}px`,
        ["--email-attachment-render-width" as any]: kind === "image" ? `${renderWidth}px` : undefined,
      }}
    >
      <div className="email-attachment-node-main" contentEditable={false} data-drag-handle title="Arrastrar adjunto">
        {kind === "image" ? (
          <span className="email-attachment-image-wrap">
            {previewUrl ? (
              <img src={previewUrl} alt={filename} className="email-attachment-image" draggable={false} />
            ) : (
              <span className="email-attachment-image-fallback">Imagen</span>
            )}
            <span className="email-attachment-meta email-attachment-meta-image">
              <span className="email-attachment-name" title={filename}>{filename}</span>
              <span className="email-attachment-size">{formatAttachmentSize(sizeBytes)}</span>
            </span>
          </span>
        ) : (
          <span className="email-attachment-file-wrap">
            <span className="email-attachment-icon-wrap email-attachment-icon-wrap-file">
              <EmailAttachmentIcon size={iconSize} />
            </span>
            <span className="email-attachment-meta email-attachment-meta-file">
              <span className="email-attachment-name" title={filename}>{filename}</span>
              <span className="email-attachment-size">{formatAttachmentSize(sizeBytes)}</span>
            </span>
          </span>
        )}
      </div>
      {selected && kind === "image" ? (
        <div className="email-attachment-node-controls" contentEditable={false}>
          <button type="button" onClick={() => setPresetSize(220, true)} title="Tamaño pequeño">S</button>
          <button type="button" onClick={() => setPresetSize(360, true)} title="Tamaño medio">M</button>
          <button type="button" onClick={() => setPresetSize(520, true)} title="Tamaño grande">L</button>
          <button
            type="button"
            className="email-attachment-resize-handle"
            onMouseDown={onResizeStart}
            title="Redimensionar imagen"
            aria-label="Redimensionar imagen"
          >
            ↔
          </button>
        </div>
      ) : null}
    </NodeViewWrapper>
  );
};

const EmailAttachment = TiptapNode.create({
  name: "emailAttachment",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,
  addOptions() {
    return {
      resolveAttachment: null,
      onAttachmentResize: null,
    } as {
      resolveAttachment: ((id: string) => RichTextAttachmentCatalogItem | null) | null;
      onAttachmentResize: ((id: string, width: number) => void) | null;
    };
  },
  addAttributes() {
    return {
      attachmentId: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-attachment-id") || "",
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-attachment-id": String(attributes.attachmentId || ""),
        }),
      },
      kind: {
        default: "document",
        parseHTML: (element: HTMLElement) => {
          const raw = String(element.getAttribute("data-kind") || "").trim().toLowerCase();
          return raw === "image" ? "image" : "document";
        },
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-kind": attributes.kind === "image" ? "image" : "document",
        }),
      },
      filename: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-filename") || "",
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-filename": String(attributes.filename || ""),
        }),
      },
      sizeBytes: {
        default: 0,
        parseHTML: (element: HTMLElement) => Number(element.getAttribute("data-size-bytes") || 0) || 0,
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-size-bytes": String(Number(attributes.sizeBytes || 0) || 0),
        }),
      },
      renderWidth: {
        default: ATTACHMENT_IMAGE_DEFAULT_WIDTH,
        parseHTML: (element: HTMLElement) =>
          clampAttachmentImageWidth(Number(element.getAttribute("data-render-width")) || ATTACHMENT_IMAGE_DEFAULT_WIDTH),
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-render-width": String(
            clampAttachmentImageWidth(Number(attributes.renderWidth) || ATTACHMENT_IMAGE_DEFAULT_WIDTH)
          ),
        }),
      },
    };
  },
  parseHTML() {
    return [
      { tag: "span[data-email-attachment='true']" },
      { tag: "div[data-email-attachment='true']" },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const kind = HTMLAttributes.kind === "image" ? "image" : "document";
    const filename = String(HTMLAttributes.filename || "Documento");
    const sizeBytes = Number(HTMLAttributes.sizeBytes || 0) || 0;
    const renderWidth = clampAttachmentImageWidth(Number(HTMLAttributes.renderWidth) || ATTACHMENT_IMAGE_DEFAULT_WIDTH);
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "email-inline-attachment",
        "data-email-attachment": "true",
        "data-kind": kind,
        style: kind === "image" ? `--email-attachment-render-width:${renderWidth}px` : undefined,
      }),
      kind === "image"
        ? [
            "span",
            { class: "email-inline-attachment-image-wrap" },
            ["span", { class: "email-inline-attachment-image-fallback" }, "Imagen"],
            [
              "span",
              { class: "email-inline-attachment-meta email-inline-attachment-meta-image" },
              ["span", { class: "email-inline-attachment-name", title: filename }, filename],
              ["span", { class: "email-inline-attachment-size" }, formatAttachmentSize(sizeBytes)],
            ],
          ]
        : [
            "span",
            { class: "email-inline-attachment-file-wrap" },
            [
              "span",
              { class: "email-inline-attachment-icon-wrap", "aria-hidden": "true" },
              [
                "svg",
                { viewBox: "0 0 20 20", width: "20", height: "20" },
                [
                  "path",
                  {
                    d: "M5 2.75A1.75 1.75 0 0 0 3.25 4.5v11A1.75 1.75 0 0 0 5 17.25h10A1.75 1.75 0 0 0 16.75 15.5V7.19a1.75 1.75 0 0 0-.5-1.23l-2.72-2.71a1.75 1.75 0 0 0-1.23-.5H5Zm0 1.5h6.75v2.5c0 .97.78 1.75 1.75 1.75h1.75v7a.25.25 0 0 1-.25.25H5a.25.25 0 0 1-.25-.25v-11c0-.14.11-.25.25-.25Zm1.5 7.25a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1-.75-.75Zm0 2.5a.75.75 0 0 1 .75-.75h3.75a.75.75 0 0 1 0 1.5H7.25a.75.75 0 0 1-.75-.75Z",
                    fill: "currentColor",
                  },
                ],
              ],
            ],
            [
              "span",
              { class: "email-inline-attachment-meta" },
              ["span", { class: "email-inline-attachment-name", title: filename }, filename],
              ["span", { class: "email-inline-attachment-size" }, formatAttachmentSize(sizeBytes)],
            ],
          ],
    ];
  },
  addCommands() {
    return {
      insertEmailAttachment:
        (attrs: {
          attachmentId: string;
          kind: EmailAttachmentKind;
          filename: string;
          sizeBytes: number;
          renderWidth?: number;
        }) =>
        ({ chain }: { chain: () => any }) =>
          chain()
            .insertContent({
              type: this.name,
              attrs: {
                attachmentId: attrs.attachmentId,
                kind: attrs.kind,
                filename: attrs.filename,
                sizeBytes: Number(attrs.sizeBytes || 0) || 0,
                renderWidth: clampAttachmentImageWidth(Number(attrs.renderWidth) || ATTACHMENT_IMAGE_DEFAULT_WIDTH),
              },
            })
            .run(),
      removeEmailAttachmentById:
        (attachmentId: string) =>
        ({ state, dispatch }: { state: any; dispatch?: ((tr: any) => void) | undefined }) => {
          const ranges: Array<{ from: number; to: number }> = [];
          state.doc.descendants((node: any, pos: number) => {
            if (node.type?.name === this.name && String(node.attrs?.attachmentId || "") === String(attachmentId || "")) {
              ranges.push({ from: pos, to: pos + node.nodeSize });
            }
          });
          if (!ranges.length) return false;
          if (dispatch) {
            const tr = state.tr;
            ranges
              .sort((a, b) => b.from - a.from)
              .forEach((range) => {
                tr.delete(range.from, range.to);
              });
            dispatch(tr);
          }
          return true;
        },
    } as any;
  },
  addNodeView() {
    return ReactNodeViewRenderer(EmailAttachmentNodeView);
  },
});

/* ── Toolbar button ─────────────────────────────────────────────────── */

const btnStyle = (active: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 28,
  height: 28,
  padding: "0 6px",
  border: "1px solid transparent",
  borderRadius: 6,
  fontSize: 13,
  fontWeight: active ? 700 : 500,
  cursor: "pointer",
  background: active ? "rgba(79,70,229,0.12)" : "transparent",
  color: active ? "#4f46e5" : "#475569",
  transition: "all 120ms ease",
});

const TBtn: React.FC<{
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ title, active = false, disabled = false, onClick, children }) => (
  <button
    type="button"
    title={title}
    disabled={disabled}
    onClick={onClick}
    style={{ ...btnStyle(active), opacity: disabled ? 0.4 : 1, cursor: disabled ? "not-allowed" : "pointer" }}
    onMouseEnter={(e) => {
      if (!disabled) (e.currentTarget.style.background = active ? "rgba(79,70,229,0.18)" : "#f1f5f9");
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = active ? "rgba(79,70,229,0.12)" : "transparent";
    }}
  >
    {children}
  </button>
);

const ToolbarSeparator = () => (
  <span style={{ display: "inline-block", width: 1, height: 18, background: "#e2e8f0", margin: "0 4px", flexShrink: 0 }} />
);

/* ── Font family & size options ─────────────────────────────────────── */

const FONT_FAMILIES = [
  { label: "Por defecto", value: "" },
  { label: "McKinsey Sans (App)", value: "var(--font-body)" },
  { label: "Helvetica", value: "Helvetica, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: "'Times New Roman', serif" },
  { label: "Verdana", value: "Verdana, sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', sans-serif" },
  { label: "Courier New", value: "'Courier New', monospace" },
  { label: "Tahoma", value: "Tahoma, sans-serif" },
];

/** Preset sizes shown in the dropdown (like Word). */
const FONT_SIZE_PRESETS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 60, 72];

const COLORS = [
  "#000000", "#374151", "#6b7280", "#dc2626", "#ea580c", "#d97706",
  "#16a34a", "#0891b2", "#2563eb", "#7c3aed", "#c026d3", "#e11d48",
];

/* ── Toolbar ────────────────────────────────────────────────────────── */

const MenuBar: React.FC<{ editor: Editor }> = ({ editor }) => {
  const colorRef = useRef<HTMLInputElement>(null);
  const highlightRef = useRef<HTMLInputElement>(null);
  const [sizeDropdownOpen, setSizeDropdownOpen] = useState(false);
  const sizeWrapperRef = useRef<HTMLDivElement>(null);

  /* Close size dropdown on outside click */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sizeWrapperRef.current && !sizeWrapperRef.current.contains(e.target as Node)) {
        setSizeDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const currentSize = parseInt(editor.getAttributes("textStyle").fontSize || "14", 10) || 14;

  const applyFontSize = (n: number) => {
    const clamped = Math.max(1, Math.min(200, n));
    (editor.commands as any).setFontSize(`${clamped}px`);
    setSizeDropdownOpen(false);
    editor.commands.focus();
  };

  const setLink = useCallback(() => {
    const prev = editor.getAttributes("link").href || "";
    const url = window.prompt("URL del enlace:", prev);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 2,
        padding: "6px 8px",
        borderBottom: "1px solid rgba(15,23,42,0.08)",
        background: "#fafbfc",
        borderRadius: "10px 10px 0 0",
        alignItems: "center",
      }}
    >
      {/* Undo / Redo */}
      <TBtn title="Deshacer" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
        ↩
      </TBtn>
      <TBtn title="Rehacer" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
        ↪
      </TBtn>

      <ToolbarSeparator />

      {/* Font family */}
      <select
        title="Tipo de letra"
        value={editor.getAttributes("textStyle").fontFamily || ""}
        onChange={(e) => {
          const val = e.target.value;
          if (val) editor.chain().focus().setFontFamily(val).run();
          else editor.chain().focus().unsetFontFamily().run();
        }}
        style={{
          height: 28,
          fontSize: 12,
          border: "1px solid #e2e8f0",
          borderRadius: 6,
          padding: "0 4px",
          background: "#fff",
          cursor: "pointer",
          maxWidth: 130,
        }}
      >
        {FONT_FAMILIES.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>

      {/* Font size — combo: input numérico + dropdown de presets (como Word) */}
      <div ref={sizeWrapperRef} style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
        <input
          title="Tamaño de letra (px)"
          type="number"
          min={1}
          max={200}
          step={1}
          value={currentSize}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (n >= 1 && n <= 200) applyFontSize(n);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              editor.commands.focus();
            }
          }}
          onFocus={() => setSizeDropdownOpen(true)}
          style={{
            height: 28,
            width: 44,
            fontSize: 12,
            fontWeight: 600,
            textAlign: "center" as const,
            border: "1px solid #e2e8f0",
            borderRadius: "6px 0 0 6px",
            padding: "0 2px",
            background: "#fff",
            MozAppearance: "textfield" as any,
          }}
        />
        <button
          type="button"
          title="Tamaños predefinidos"
          onClick={() => setSizeDropdownOpen((prev) => !prev)}
          style={{
            height: 28,
            width: 18,
            border: "1px solid #e2e8f0",
            borderLeft: "none",
            borderRadius: "0 6px 6px 0",
            background: "#fff",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 9,
            color: "#64748b",
            padding: 0,
          }}
        >
          ▾
        </button>

        {sizeDropdownOpen && (
          <div
            style={{
              position: "absolute",
              top: 30,
              left: 0,
              zIndex: 50,
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              boxShadow: "0 4px 12px rgba(0,0,0,0.10)",
              maxHeight: 200,
              overflowY: "auto",
              width: 62,
            }}
          >
            {FONT_SIZE_PRESETS.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => applyFontSize(size)}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "4px 10px",
                  border: "none",
                  background: size === currentSize ? "rgba(79,70,229,0.10)" : "transparent",
                  color: size === currentSize ? "#4f46e5" : "#374151",
                  fontWeight: size === currentSize ? 700 : 400,
                  fontSize: 12,
                  textAlign: "left",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => { (e.currentTarget.style.background = "rgba(79,70,229,0.06)"); }}
                onMouseLeave={(e) => { (e.currentTarget.style.background = size === currentSize ? "rgba(79,70,229,0.10)" : "transparent"); }}
              >
                {size}
              </button>
            ))}
          </div>
        )}
      </div>

      <ToolbarSeparator />

      {/* Headings */}
      <TBtn
        title="Título 1"
        active={editor.isActive("heading", { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        H1
      </TBtn>
      <TBtn
        title="Título 2"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </TBtn>
      <TBtn
        title="Título 3"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        H3
      </TBtn>

      <ToolbarSeparator />

      {/* Inline formatting */}
      <TBtn title="Negrita" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <strong>B</strong>
      </TBtn>
      <TBtn title="Cursiva" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <em>I</em>
      </TBtn>
      <TBtn title="Subrayado" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <u>U</u>
      </TBtn>
      <TBtn title="Tachado" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <s>S</s>
      </TBtn>

      <ToolbarSeparator />

      {/* Text color */}
      <div style={{ position: "relative", display: "inline-flex" }}>
        <TBtn title="Color de texto" active={!!editor.getAttributes("textStyle").color} onClick={() => colorRef.current?.click()}>
          <span style={{ borderBottom: `3px solid ${editor.getAttributes("textStyle").color || "#000"}`, lineHeight: 1, paddingBottom: 1 }}>A</span>
        </TBtn>
        <input
          ref={colorRef}
          type="color"
          value={editor.getAttributes("textStyle").color || "#000000"}
          onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
          style={{ position: "absolute", opacity: 0, width: 0, height: 0, pointerEvents: "none" }}
        />
      </div>

      {/* Color quick-pick */}
      <div style={{ display: "flex", gap: 1, alignItems: "center" }}>
        {COLORS.slice(0, 6).map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            onClick={() => editor.chain().focus().setColor(c).run()}
            style={{
              width: 16,
              height: 16,
              borderRadius: 4,
              border: editor.getAttributes("textStyle").color === c ? "2px solid #4f46e5" : "1px solid #d1d5db",
              background: c,
              cursor: "pointer",
              padding: 0,
            }}
          />
        ))}
      </div>

      {/* Highlight */}
      <div style={{ position: "relative", display: "inline-flex", marginLeft: 2 }}>
        <TBtn title="Resaltar texto" active={editor.isActive("highlight")} onClick={() => highlightRef.current?.click()}>
          <span style={{ background: editor.getAttributes("highlight").color || "#fde68a", padding: "0 3px", borderRadius: 3, lineHeight: 1 }}>H</span>
        </TBtn>
        <input
          ref={highlightRef}
          type="color"
          value={editor.getAttributes("highlight").color || "#fde68a"}
          onChange={(e) => editor.chain().focus().toggleHighlight({ color: e.target.value }).run()}
          style={{ position: "absolute", opacity: 0, width: 0, height: 0, pointerEvents: "none" }}
        />
      </div>

      <ToolbarSeparator />

      {/* Alignment */}
      <TBtn title="Alinear izquierda" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
        ≡
      </TBtn>
      <TBtn title="Centrar" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
        ≡
      </TBtn>
      <TBtn title="Alinear derecha" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
        ≡
      </TBtn>
      <TBtn title="Justificar" active={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()}>
        ≡
      </TBtn>

      <ToolbarSeparator />

      {/* Lists */}
      <TBtn title="Lista con viñetas" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        •≡
      </TBtn>
      <TBtn title="Lista numerada" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        1.
      </TBtn>

      <ToolbarSeparator />

      {/* Link */}
      <TBtn title="Enlace" active={editor.isActive("link")} onClick={setLink}>
        🔗
      </TBtn>

      {/* Block quote */}
      <TBtn title="Cita" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        ❝
      </TBtn>

      {/* Horizontal rule */}
      <TBtn title="Línea horizontal" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        —
      </TBtn>

      <ToolbarSeparator />

      {/* Clear formatting */}
      <TBtn
        title="Limpiar formato"
        onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
      >
        ✕
      </TBtn>
    </div>
  );
};

/* ── Editor component ───────────────────────────────────────────────── */

export interface RichTextEditorProps {
  /** Current HTML content */
  value: string;
  /** Fires whenever the content changes (debounced ~150ms) */
  onChange: (html: string) => void;
  /** Placeholder shown when empty */
  placeholder?: string;
  /** Min-height of the editable region */
  minHeight?: number;
  /** Extra className on the wrapper */
  className?: string;
  /** Extra content rendered at the end of the toolbar (receives the TipTap editor) */
  toolbarExtra?: (editor: Editor) => React.ReactNode;
  /** Optional overlay rendered on top of the editable content area. */
  contentOverlay?: React.ReactNode;
  /** Gives access to the underlying TipTap editor instance. */
  onEditorReady?: (editor: Editor | null) => void;
  /** Attachment metadata used to render inline previews in the editor. */
  attachmentCatalog?: Record<string, RichTextAttachmentCatalogItem>;
  /** Called when inline image width changes. */
  onAttachmentResize?: (attachmentId: string, width: number) => void;
  /** Called whenever the set of inline attachment IDs in body changes. */
  onAttachmentIdsChange?: (attachmentIds: string[]) => void;
}

const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value,
  onChange,
  placeholder = "Escribe aquí…",
  minHeight = 200,
  className,
  toolbarExtra,
  contentOverlay,
  onEditorReady,
  attachmentCatalog,
  onAttachmentResize,
  onAttachmentIdsChange,
}) => {
  /** Track whether the last HTML change came from the editor itself. */
  const internalChange = useRef(false);
  const attachmentCatalogRef = useRef<Record<string, RichTextAttachmentCatalogItem>>(attachmentCatalog || {});
  const onAttachmentResizeRef = useRef<typeof onAttachmentResize>(onAttachmentResize);
  const onAttachmentIdsChangeRef = useRef<typeof onAttachmentIdsChange>(onAttachmentIdsChange);

  useEffect(() => {
    attachmentCatalogRef.current = attachmentCatalog || {};
  }, [attachmentCatalog]);

  useEffect(() => {
    onAttachmentResizeRef.current = onAttachmentResize;
  }, [onAttachmentResize]);

  useEffect(() => {
    onAttachmentIdsChangeRef.current = onAttachmentIdsChange;
  }, [onAttachmentIdsChange]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true },
        underline: {},
      }),
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      EmailAttachment.configure({
        resolveAttachment: (id: string) => attachmentCatalogRef.current[String(id || "")] || null,
        onAttachmentResize: (id: string, width: number) => onAttachmentResizeRef.current?.(id, width),
      }),
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder }),
    ],
    content: value || "",
    onUpdate: ({ editor: ed }) => {
      internalChange.current = true;
      onChange(ed.getHTML());
      onAttachmentIdsChangeRef.current?.(listInlineAttachmentIds(ed));
    },
  });

  /* Sync external value changes (e.g. template switching) */
  useEffect(() => {
    if (!editor) return;
    if (internalChange.current) {
      internalChange.current = false;
      return;
    }
    const current = editor.getHTML();
    if (current !== value) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  }, [value, editor]);

  useEffect(() => {
    if (!onEditorReady) return;
    onEditorReady(editor || null);
    return () => onEditorReady(null);
  }, [editor, onEditorReady]);

  if (!editor) return null;

  return (
    <div
      className={className}
      style={{
        border: "1px solid rgba(15,23,42,0.10)",
        borderRadius: 10,
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <MenuBar editor={editor} />
      {toolbarExtra ? (
        <div style={{ padding: "4px 8px", borderBottom: "1px solid rgba(15,23,42,0.06)", background: "#fafbfc" }}>
          {toolbarExtra(editor)}
        </div>
      ) : null}
      <div className="rich-text-editor-content-wrap">
        {contentOverlay ? <div className="rich-text-editor-content-overlay">{contentOverlay}</div> : null}
        <EditorContent
          editor={editor}
          style={{
            minHeight,
            padding: "12px 14px",
            fontSize: 14,
            lineHeight: 1.6,
            outline: "none",
          }}
        />
      </div>
      <style>{`
        .rich-text-editor-content-wrap { position: relative; }
        .rich-text-editor-content-overlay {
          position: absolute;
          top: 8px;
          right: 8px;
          z-index: 20;
        }
        .ProseMirror { outline: none; min-height: ${minHeight}px; }
        .ProseMirror p { margin: 0.25em 0; }
        .ProseMirror h1 { font-size: 1.6em; margin: 0.4em 0 0.2em; }
        .ProseMirror h2 { font-size: 1.3em; margin: 0.4em 0 0.2em; }
        .ProseMirror h3 { font-size: 1.1em; margin: 0.3em 0 0.2em; }
        .ProseMirror ul, .ProseMirror ol { padding-left: 1.4em; margin: 0.3em 0; }
        .ProseMirror blockquote { border-left: 3px solid #d1d5db; margin: 0.4em 0; padding-left: 12px; color: #64748b; }
        .ProseMirror a { color: #2563eb; text-decoration: underline; cursor: pointer; }
        .ProseMirror hr { border: none; border-top: 1px solid #e2e8f0; margin: 0.6em 0; }
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #94a3b8;
          pointer-events: none;
          height: 0;
        }
        .ProseMirror .email-attachment-node-view {
          display: inline-flex;
          flex-direction: column;
          vertical-align: middle;
          margin: 0.1em 0.2em;
        }
        .ProseMirror .email-attachment-node-main {
          display: inline-flex;
          align-items: flex-start;
          gap: 8px;
          border: 1px solid rgba(15, 23, 42, 0.14);
          border-radius: 12px;
          background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
          padding: 8px;
          max-width: min(100%, 520px);
          vertical-align: middle;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
          cursor: grab;
        }
        .ProseMirror .email-attachment-node-main:active {
          cursor: grabbing;
        }
        .ProseMirror .email-attachment-node-view.is-selected .email-attachment-node-main {
          border-color: rgba(43, 108, 176, 0.42);
          box-shadow: 0 0 0 2px rgba(43, 108, 176, 0.16);
        }
        .ProseMirror .email-attachment-file-wrap {
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          min-width: 88px;
        }
        .ProseMirror .email-attachment-icon-wrap-file {
          width: var(--email-attachment-icon-size, 42px);
          height: var(--email-attachment-icon-size, 42px);
          color: #1f5e99;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(36, 89, 143, 0.2);
          border-radius: 10px;
          background: #f2f7ff;
          padding: 6px;
          box-sizing: border-box;
        }
        .ProseMirror .email-attachment-image-wrap {
          width: min(100%, var(--email-attachment-render-width, 360px));
          display: inline-flex;
          flex-direction: column;
          gap: 6px;
          min-width: 140px;
        }
        .ProseMirror .email-attachment-image {
          width: 100%;
          display: block;
          border-radius: 10px;
          border: 1px solid rgba(15, 23, 42, 0.11);
          background: #fff;
          box-shadow: 0 2px 8px -6px rgba(15, 23, 42, 0.45);
        }
        .ProseMirror .email-attachment-image-fallback {
          width: 100%;
          min-height: 84px;
          border-radius: 10px;
          border: 1px dashed rgba(15, 23, 42, 0.18);
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 700;
          color: #64748b;
          background: #f8fbff;
        }
        .ProseMirror .email-attachment-meta {
          min-width: 0;
          display: grid;
          gap: 2px;
          text-align: center;
        }
        .ProseMirror .email-attachment-meta-image {
          text-align: left;
        }
        .ProseMirror .email-attachment-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12.5px;
          color: #0f172a;
          font-weight: 700;
          text-align: center;
        }
        .ProseMirror .email-attachment-size {
          font-size: 11px;
          color: #64748b;
          line-height: 1.2;
        }
        .ProseMirror .email-attachment-node-controls {
          margin-top: 6px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 6px;
          border-radius: 9px;
          border: 1px solid rgba(15, 23, 42, 0.11);
          background: #f8fbff;
        }
        .ProseMirror .email-attachment-node-controls button {
          border: 1px solid #d6deea;
          border-radius: 7px;
          background: #fff;
          color: #334155;
          min-height: 24px;
          padding: 3px 8px;
          font-size: 11px;
          font-weight: 700;
          line-height: 1;
          cursor: pointer;
        }
        .ProseMirror .email-attachment-node-controls .email-attachment-resize-handle {
          min-width: 30px;
          color: #24598f;
        }
        .email-inline-attachment {
          display: inline-flex;
          align-items: flex-start;
          gap: 8px;
          border: 1px solid rgba(15, 23, 42, 0.14);
          border-radius: 12px;
          background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
          padding: 8px;
          max-width: min(100%, 520px);
          margin: 0.1em 0.2em;
          vertical-align: middle;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
        }
        .email-inline-attachment-file-wrap {
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          min-width: 88px;
        }
        .email-inline-attachment-icon-wrap,
        .email-inline-attachment-icon {
          width: var(--email-attachment-icon-size, 42px);
          height: var(--email-attachment-icon-size, 42px);
          color: #1f5e99;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          border: 1px solid rgba(36, 89, 143, 0.2);
          border-radius: 10px;
          background: #f2f7ff;
          padding: 6px;
          box-sizing: border-box;
        }
        .email-inline-attachment-image-wrap {
          width: min(100%, var(--email-attachment-render-width, 360px));
          display: inline-flex;
          flex-direction: column;
          gap: 6px;
          min-width: 140px;
        }
        .email-inline-attachment-image {
          width: 100%;
          display: block;
          border-radius: 10px;
          border: 1px solid rgba(15, 23, 42, 0.11);
          background: #fff;
          box-shadow: 0 2px 8px -6px rgba(15, 23, 42, 0.45);
        }
        .email-inline-attachment-image-fallback,
        .email-inline-attachment-image-placeholder {
          width: min(100%, var(--email-attachment-render-width, 360px));
          min-height: 84px;
          border-radius: 10px;
          border: 1px dashed rgba(15, 23, 42, 0.2);
          background: #f8fbff;
          color: #64748b;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          font-size: 12px;
          font-weight: 700;
          padding: 8px;
          box-sizing: border-box;
        }
        .email-inline-attachment-icon-wrap svg,
        .email-inline-attachment-icon svg {
          width: 100%;
          height: 100%;
          display: block;
        }
        .email-inline-attachment-meta {
          min-width: 0;
          display: grid;
          gap: 2px;
          text-align: center;
        }
        .email-inline-attachment-meta-image {
          text-align: left;
        }
        .email-inline-attachment-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12.5px;
          color: #0f172a;
          font-weight: 700;
          text-align: center;
        }
        .email-inline-attachment-size {
          font-size: 11px;
          color: #64748b;
          line-height: 1.2;
        }
      `}</style>
    </div>
  );
};

export default RichTextEditor;
