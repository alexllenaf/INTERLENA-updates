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
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";

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
  { label: "Arial", value: "Arial, sans-serif" },
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
}

const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value,
  onChange,
  placeholder = "Escribe aquí…",
  minHeight = 200,
  className,  toolbarExtra,}) => {
  /** Track whether the last HTML change came from the editor itself. */
  const internalChange = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      TextStyle,
      Color,
      FontFamily,
      FontSize,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder }),
    ],
    content: value || "",
    onUpdate: ({ editor: ed }) => {
      internalChange.current = true;
      onChange(ed.getHTML());
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
      <style>{`
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
      `}</style>
    </div>
  );
};

export default RichTextEditor;
