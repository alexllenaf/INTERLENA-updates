import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useAppData } from "../../../state";
import { type Application } from "../../../types";
import {
  TRACKER_BASE_COLUMN_ORDER,
  TRACKER_COLUMN_LABELS,
  TRACKER_COLUMN_KINDS
} from "../../../shared/columnSchema";
import {
  customPropertyKind,
  isRecord,
  normalizeCustomProperties,
  normalizeString,
  normalizeStringArray
} from "../../../shared/normalize";
import BlockPanel from "../../BlockPanel";
import { EditableTableToolbar } from "../../blocks/BlockRenderer";
import {
  CARD_GALLERY_SOURCE_TABLE_LINK_KEY,
  collectEditableTableTargets,
  getBlockLink,
  patchBlockLink
} from "../blockLinks";
import { resolveEditableTableModel } from "./editableTableBlock";
import { createSlotContext, renderHeader } from "./shared";
import {
  type CardGalleryItem,
  type CardGalleryCustomField,
  type CardGalleryManualCard,
  type EditableTableColumnKind,
  type EditableTableSelectOption,
  type PageBlockPropsMap
} from "../types";
import { type BlockDefinition } from "./types";

type CardField = {
  label: string;
  value: string;
  kind?: EditableTableColumnKind;
};

type TableSnapshot = {
  columns: string[];
  rows: string[][];
  columnKinds: Record<string, EditableTableColumnKind>;
};

type GalleryCardView = {
  key: string;
  title: string;
  imageUrl?: string;
  fields: CardField[];
};

const getDefaultManualCards = (): CardGalleryManualCard[] => [
  {
    key: "card-1",
    title: "Nueva oportunidad",
    fields: [
      { key: "city", label: "Ciudad", kind: "text", value: "Barcelona" },
      { key: "mode", label: "Modalidad", kind: "select", value: "Híbrido", selectOptions: [
        { label: "Híbrido" },
        { label: "Remoto" },
        { label: "On-site" }
      ]},
      { key: "date", label: "Fecha", kind: "date", value: "2026-02-21" }
    ]
  }
];

const toUniqueLabel = (label: string, used: Set<string>): string => {
  const base = label.trim() || "Column";
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let attempt = 2;
  while (used.has(`${base} (${attempt})`)) {
    attempt += 1;
  }
  const next = `${base} (${attempt})`;
  used.add(next);
  return next;
};

const trackerValueForColumn = (app: Application, key: string): string => {
  if (key.startsWith("prop__")) {
    const propertyKey = key.slice("prop__".length);
    return app.properties?.[propertyKey] || "";
  }
  if (key === "contacts") {
    return (app.contacts || [])
      .map((contact) => contact.name || "")
      .filter(Boolean)
      .join(" | ");
  }
  if (key === "todo_items") {
    return (app.todo_items || [])
      .map((todo) => todo.task || "")
      .filter(Boolean)
      .join(" | ");
  }
  if (key === "documents_links") {
    return app.documents_links || "";
  }
  if (key === "favorite") {
    return app.favorite ? "true" : "false";
  }
  const raw = (app as Record<string, unknown>)[key];
  if (raw === null || raw === undefined) return "";
  return String(raw);
};

const isTrackerSourceTarget = (target: {
  type: string;
  pageId: string;
  blockId: string;
  props: Record<string, unknown>;
}) => {
  const schemaRef = normalizeString(target.props.schemaRef);
  const contentSlotId = normalizeString(target.props.contentSlotId);
  return (
    schemaRef === "tracker.applications@1" ||
    target.blockId === "tracker:table" ||
    contentSlotId.startsWith("tracker:content")
  );
};

const buildTrackerSnapshot = (
  targetProps: Record<string, unknown>,
  settings: unknown,
  applications: Application[]
): TableSnapshot => {
  const settingsRecord = isRecord(settings) ? settings : {};
  const columnLabels = isRecord(settingsRecord.column_labels)
    ? (settingsRecord.column_labels as Record<string, unknown>)
    : {};
  const customProps = normalizeCustomProperties(settingsRecord.custom_properties);
  const customPropByKey = new Map(customProps.map((prop) => [prop.key, prop]));
  const overrideOrder = isRecord(targetProps.overrides)
    ? normalizeStringArray((targetProps.overrides as Record<string, unknown>).columnOrder)
    : [];
  const settingsOrder = normalizeStringArray(settingsRecord.table_columns);
  const orderedKeys: string[] = [];

  const pushKey = (key: string) => {
    const normalized = key.trim();
    if (!normalized || orderedKeys.includes(normalized)) return;
    orderedKeys.push(normalized);
  };

  (overrideOrder.length > 0 ? overrideOrder : settingsOrder).forEach(pushKey);
  TRACKER_BASE_COLUMN_ORDER.forEach(pushKey);
  customProps.forEach((prop) => pushKey(`prop__${prop.key}`));

  const columns: string[] = [];
  const columnKinds: Record<string, EditableTableColumnKind> = {};
  const keyByLabel: string[] = [];
  const usedLabels = new Set<string>();

  orderedKeys.forEach((key) => {
    const labelOverride = columnLabels[key];
    let labelSeed = typeof labelOverride === "string" ? labelOverride.trim() : "";
    let kind: EditableTableColumnKind = "text";

    if (key.startsWith("prop__")) {
      const propKey = key.slice("prop__".length);
      const prop = customPropByKey.get(propKey) || null;
      if (!labelSeed) labelSeed = prop?.name || key;
      kind = customPropertyKind(prop);
    } else {
      if (!labelSeed) labelSeed = TRACKER_COLUMN_LABELS[key] || key;
      kind = TRACKER_COLUMN_KINDS[key] || "text";
    }

    const label = toUniqueLabel(labelSeed || key, usedLabels);
    columns.push(label);
    keyByLabel.push(key);
    columnKinds[label] = kind;
  });

  const rows = applications.map((app) => keyByLabel.map((columnKey) => trackerValueForColumn(app, columnKey)));
  return { columns, rows, columnKinds };
};

const splitTitleValues = (raw: string, splitByTokens: boolean): string[] => {
  const seed = raw.trim();
  if (!seed) return ["Sin título"];
  if (!splitByTokens) return [seed];
  const parts = seed
    .split(/[|,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [seed];
};

export const CARD_GALLERY_BLOCK_DEFINITION: BlockDefinition<"cardGallery"> = {
  type: "cardGallery",
  defaultLayout: { colSpan: 60 },
  createDefaultProps: () => ({
    title: "Galería de tarjetas",
    description: "Vista compacta de elementos en formato tarjeta.",
    manualCards: getDefaultManualCards()
  }),
  component: ({ block, mode, patchBlockProps, updateBlockProps, resolveSlot, menuActions }) => {
    const { settings, saveSettings, applications } = useAppData();
    const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
    const [isLinkMenuOpen, setIsLinkMenuOpen] = useState(false);
    const linkMenuRef = useRef<HTMLDivElement | null>(null);
    const [activeCardIndex, setActiveCardIndex] = useState<number | null>(null);
    const [activeCardKey, setActiveCardKey] = useState<string | null>(null);
    const [draftTitle, setDraftTitle] = useState("");
    const [draftImageUrl, setDraftImageUrl] = useState("");
    const [draftFields, setDraftFields] = useState<CardGalleryCustomField[]>([]);
    const [draftSourceColumns, setDraftSourceColumns] = useState<{
      titleColumn: string;
      visibleColumns: string[];
      imageColumn: string;
    }>({ titleColumn: "", visibleColumns: [], imageColumn: "" });
    const [draggedField, setDraggedField] = useState<string | null>(null);
    const [dragOverField, setDragOverField] = useState<string | null>(null);
    const titleInputRef = useRef<HTMLInputElement | null>(null);
    const returnFocusRef = useRef<HTMLElement | null>(null);

    const slotContext = createSlotContext(mode, updateBlockProps, patchBlockProps);
    const slot = block.props.contentSlotId ? resolveSlot?.(block.props.contentSlotId, block, slotContext) : null;

    const tableTargets = useMemo(() => collectEditableTableTargets(settings), [settings]);
    const linkedTableId = getBlockLink(block.props, CARD_GALLERY_SOURCE_TABLE_LINK_KEY);
    const linkedTableTarget = linkedTableId
      ? tableTargets.find((target) => target.blockId === linkedTableId) || null
      : null;

    const resolveSnapshotForTarget = useCallback(
      (target: typeof linkedTableTarget | null): TableSnapshot | null => {
        if (!target) return null;
        if (isTrackerSourceTarget(target)) {
          return buildTrackerSnapshot(target.props, settings, applications);
        }
        const model = resolveEditableTableModel(target.props as PageBlockPropsMap["editableTable"], {
          settings,
          saveSettings
        });
        return {
          columns: model.columns,
          rows: model.rows,
          columnKinds: model.columnKinds
        };
      },
      [applications, saveSettings, settings]
    );

    const tableSnapshot = useMemo(
      () => resolveSnapshotForTarget(linkedTableTarget),
      [linkedTableTarget, resolveSnapshotForTarget]
    );

    const isLinkedMode = Boolean(linkedTableTarget && tableSnapshot);

    // Migrate legacy items to manualCards
    useEffect(() => {
      if (!block.props.items || block.props.manualCards) return;
      const legacyItems = block.props.items;
      const migrated: CardGalleryManualCard[] = legacyItems.map((item, index) => {
        const fields: CardGalleryCustomField[] = [];
        if (item.subtitle) fields.push({ key: "subtitle", label: "Subtítulo", kind: "text", value: item.subtitle });
        if (item.tag) fields.push({ key: "tag", label: "Etiqueta", kind: "text", value: item.tag });
        if (item.date) fields.push({ key: "date", label: "Fecha", kind: "date", value: item.date });
        return {
          key: `card-${index + 1}`,
          title: item.title || "Sin título",
          imageUrl: item.imageUrl,
          fields
        };
      });
      patchBlockProps({ manualCards: migrated, items: undefined });
    }, [block.props.items, block.props.manualCards, patchBlockProps]);

    const manualCards = block.props.manualCards || getDefaultManualCards();

    const linkedCards = useMemo(() => {
      if (!tableSnapshot || !isLinkedMode) return [] as GalleryCardView[];

      const configs = block.props.cardFieldConfigs || {};
      const globalImageOverrides = block.props.sourceImageByTitle || {};
      const valueOverrides = block.props.fieldValueOverrides || {};

      const result: GalleryCardView[] = [];

      tableSnapshot.rows.forEach((row) => {
        const firstValue = row[0] || "Sin título";
        const titleValues = splitTitleValues(firstValue, false);

        titleValues.forEach((titleValue) => {
          const cardKey = titleValue;
          const config = configs[cardKey] || {};
          const titleColumn = config.titleColumn || tableSnapshot.columns[0] || "";
          const visibleColumns = config.visibleColumns || tableSnapshot.columns.slice(1, 4);
          const imageColumn = config.imageColumn || "";
          const cardValueOverrides = valueOverrides[cardKey] || {};

          const fields: CardField[] = [];
          visibleColumns.forEach((colName) => {
            const colIndex = tableSnapshot.columns.indexOf(colName);
            if (colIndex < 0) return;
            // Use override if available, otherwise use table value
            const value = cardValueOverrides[colName] || row[colIndex] || "";
            if (!value.trim()) return;
            fields.push({
              label: colName,
              value,
              kind: tableSnapshot.columnKinds[colName]
            });
          });

          const imageValue = imageColumn
            ? row[tableSnapshot.columns.indexOf(imageColumn)] || ""
            : "";
          const finalImageUrl = globalImageOverrides[cardKey] || imageValue || undefined;

          result.push({
            key: cardKey,
            title: titleValue,
            imageUrl: finalImageUrl,
            fields
          });
        });
      });

      return result;
    }, [block.props.cardFieldConfigs, block.props.fieldValueOverrides, block.props.sourceImageByTitle, isLinkedMode, tableSnapshot]);

    const cardsForDisplay: GalleryCardView[] = isLinkedMode
      ? linkedCards
      : manualCards.map((card) => ({
          key: card.key,
          title: card.title,
          imageUrl: card.imageUrl,
          fields: (card.fields || []).map((field) => ({
            label: field.label,
            value: field.value,
            kind: field.kind
          }))
        }));

    const isEditorOpen = activeCardIndex !== null && activeCardKey !== null;

    const openEditor = (index: number, card: GalleryCardView) => {
      if (!isEditorOpen && typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
        returnFocusRef.current = document.activeElement;
      }
      setActiveCardIndex(index);
      setActiveCardKey(card.key);
      setDraftTitle(card.title);
      setDraftImageUrl(card.imageUrl || "");

      if (isLinkedMode && tableSnapshot) {
        const config = block.props.cardFieldConfigs?.[card.key] || {};
        const titleColumn = config.titleColumn || tableSnapshot.columns[0] || "";
        const visibleColumns = config.visibleColumns || tableSnapshot.columns.slice(1, 4);
        const imageColumn = config.imageColumn || "";
        
        setDraftSourceColumns({
          titleColumn,
          visibleColumns,
          imageColumn
        });
        
        // Load current field values from the card
        const fieldValues: CardGalleryCustomField[] = card.fields.map((field) => ({
          key: field.label,
          label: field.label,
          kind: field.kind || "text",
          value: field.value
        }));
        setDraftFields(fieldValues);
      } else {
        const manualCard = manualCards.find((c) => c.key === card.key);
        setDraftFields(manualCard?.fields || []);
        setDraftSourceColumns({ titleColumn: "", visibleColumns: [], imageColumn: "" });
      }
    };

    const closeEditor = () => {
      setActiveCardIndex(null);
      setActiveCardKey(null);
      setDraftTitle("");
      setDraftImageUrl("");
      setDraftFields([]);
      setDraftSourceColumns({ titleColumn: "", visibleColumns: [], imageColumn: "" });
      const returnEl = returnFocusRef.current;
      if (returnEl) {
        window.setTimeout(() => {
          returnEl.focus();
        }, 0);
      }
    };

    const saveEditor = () => {
      if (activeCardKey === null || activeCardIndex === null) return;

      if (isLinkedMode) {
        const nextConfigs = { ...(block.props.cardFieldConfigs || {}) };
        nextConfigs[activeCardKey] = {
          titleColumn: draftSourceColumns.titleColumn,
          visibleColumns: draftSourceColumns.visibleColumns,
          imageColumn: draftSourceColumns.imageColumn
        };

        const nextImageOverrides = { ...(block.props.sourceImageByTitle || {}) };
        const normalizedImage = normalizeString(draftImageUrl);
        if (normalizedImage) {
          nextImageOverrides[activeCardKey] = normalizedImage;
        } else {
          delete nextImageOverrides[activeCardKey];
        }

        // Save field value overrides
        const nextFieldOverrides = { ...(block.props.fieldValueOverrides || {}) };
        const cardOverrides: Record<string, string> = {};
        draftFields.forEach((field) => {
          if (field.value.trim()) {
            cardOverrides[field.label] = field.value;
          }
        });
        if (Object.keys(cardOverrides).length > 0) {
          nextFieldOverrides[activeCardKey] = cardOverrides;
        } else {
          delete nextFieldOverrides[activeCardKey];
        }

        patchBlockProps({
          cardFieldConfigs: nextConfigs,
          sourceImageByTitle: Object.keys(nextImageOverrides).length > 0 ? nextImageOverrides : undefined,
          fieldValueOverrides: Object.keys(nextFieldOverrides).length > 0 ? nextFieldOverrides : undefined
        });
        closeEditor();
      } else {
        const nextCards = manualCards.map((card) =>
          card.key === activeCardKey
            ? {
                ...card,
                title: draftTitle,
                imageUrl: normalizeString(draftImageUrl) || undefined,
                fields: draftFields
              }
            : card
        );
        patchBlockProps({ manualCards: nextCards });
        closeEditor();
      }
    };

    const removeCurrent = () => {
      if (activeCardKey === null) return;

      if (isLinkedMode) {
        const nextConfigs = { ...(block.props.cardFieldConfigs || {}) };
        delete nextConfigs[activeCardKey];
        const nextImageOverrides = { ...(block.props.sourceImageByTitle || {}) };
        delete nextImageOverrides[activeCardKey];
        patchBlockProps({
          cardFieldConfigs: Object.keys(nextConfigs).length > 0 ? nextConfigs : undefined,
          sourceImageByTitle: Object.keys(nextImageOverrides).length > 0 ? nextImageOverrides : undefined
        });
        closeEditor();
      } else {
        const nextCards = manualCards.filter((card) => card.key !== activeCardKey);
        patchBlockProps({ manualCards: nextCards.length > 0 ? nextCards : getDefaultManualCards() });
        closeEditor();
      }
    };

    const openRelative = (delta: -1 | 1) => {
      if (activeCardIndex === null) return;
      const nextIndex = activeCardIndex + delta;
      if (nextIndex < 0 || nextIndex >= cardsForDisplay.length) return;
      const nextCard = cardsForDisplay[nextIndex];
      if (!nextCard) return;
      openEditor(nextIndex, nextCard);
    };

    const addManualCard = () => {
      const nextKey = `card-${Date.now()}`;
      const newCard: CardGalleryManualCard = {
        key: nextKey,
        title: "Nueva tarjeta",
        fields: []
      };
      patchBlockProps({
        manualCards: [...manualCards, newCard]
      });
    };

    const addFieldToDraft = () => {
      const nextKey = `field-${Date.now()}`;
      setDraftFields([
        ...draftFields,
        {
          key: nextKey,
          label: "Nuevo campo",
          kind: "text",
          value: ""
        }
      ]);
    };

    const updateDraftField = (index: number, patch: Partial<CardGalleryCustomField>) => {
      setDraftFields((prev) =>
        prev.map((field, i) => (i === index ? { ...field, ...patch } : field))
      );
    };

    const removeDraftField = (index: number) => {
      setDraftFields((prev) => prev.filter((_, i) => i !== index));
    };

    const toggleDraftVisibleColumn = (column: string) => {
      setDraftSourceColumns((prev) => {
        const exists = prev.visibleColumns.includes(column);
        const next = exists
          ? prev.visibleColumns.filter((c) => c !== column)
          : [...prev.visibleColumns, column];
        return { ...prev, visibleColumns: next };
      });
    };

    const reorderVisibleColumn = (fromLabel: string, toLabel: string) => {
      setDraftSourceColumns((prev) => {
        const columns = [...prev.visibleColumns];
        const fromIndex = columns.indexOf(fromLabel);
        const toIndex = columns.indexOf(toLabel);
        if (fromIndex < 0 || toIndex < 0) return prev;
        
        const [removed] = columns.splice(fromIndex, 1);
        columns.splice(toIndex, 0, removed);
        
        return { ...prev, visibleColumns: columns };
      });
    };

    const handleFieldReorder = (targetField: string) => {
      if (!draggedField || draggedField === targetField) return;
      reorderVisibleColumn(draggedField, targetField);
      setDraggedField(null);
      setDragOverField(null);
    };

    const addCustomFieldToDraft = () => {
      const nextKey = `custom-field-${Date.now()}`;
      const newFieldLabel = `Campo ${draftFields.length + 1}`;
      
      // Añadir a draftFields para la sesión de edición
      setDraftFields([
        ...draftFields,
        {
          key: nextKey,
          label: newFieldLabel,
          kind: "text",
          value: ""
        }
      ]);
      
      // Añadir a las columnas visibles
      setDraftSourceColumns((prev) => ({
        ...prev,
        visibleColumns: [...prev.visibleColumns, newFieldLabel]
      }));
    };

    const updateLinkedTableCell = useCallback(
      (cardKey: string, fieldLabel: string, newValue: string) => {
        if (!linkedTableTarget || !tableSnapshot) return;

        const rowIndex = tableSnapshot.rows.findIndex((row) => {
          const firstValue = row[0] || "";
          const titleValues = splitTitleValues(firstValue, false);
          return titleValues.includes(cardKey);
        });

        if (rowIndex < 0) return;

        const colIndex = tableSnapshot.columns.indexOf(fieldLabel);
        if (colIndex < 0) return;

        // Update the linked table's row
        const nextRows = tableSnapshot.rows.map((row, index) => {
          if (index !== rowIndex) return row;
          return row.map((cell, cellIndex) => (cellIndex === colIndex ? newValue : cell));
        });

        // Find and update the linked table block in settings
        if (!settings || !settings.page_configs) return;

        const pages = settings.page_configs as Record<string, { blocks?: any[] }>;
        let targetPage: string | null = null;
        let targetBlock: any = null;

        for (const [pageId, pageConfig] of Object.entries(pages)) {
          const found = (pageConfig.blocks || []).find(
            (b: any) => b.id === linkedTableId
          );
          if (found) {
            targetPage = pageId;
            targetBlock = found;
            break;
          }
        }

        if (!targetPage || !targetBlock) return;

        const nextPages = { ...pages };
        const nextBlocks = (nextPages[targetPage].blocks || []).map((b: any) => {
          if (b.id !== linkedTableId) return b;
          return {
            ...b,
            props: {
              ...b.props,
              customRows: nextRows
            }
          };
        });

        nextPages[targetPage] = {
          ...nextPages[targetPage],
          blocks: nextBlocks
        };

        void saveSettings({ ...settings, page_configs: nextPages });
      },
      [linkedTableTarget, linkedTableId, tableSnapshot, settings, saveSettings]
    );

    const setLinkedTable = (nextBlockId?: string | null) => {
      patchBlockProps({
        ...(patchBlockLink(
          block.props,
          CARD_GALLERY_SOURCE_TABLE_LINK_KEY,
          nextBlockId || null
        ) as Partial<PageBlockPropsMap["cardGallery"]>),
        cardFieldConfigs: undefined,
        sourceImageByTitle: undefined
      });
      setIsLinkMenuOpen(false);
    };

    const openLinkPicker = useCallback(() => {
      setIsLinkModalOpen(true);
      setIsLinkMenuOpen(false);
    }, []);

    const closeLinkPicker = useCallback(() => {
      setIsLinkMenuOpen(false);
      setIsLinkModalOpen(false);
    }, []);

    const linkLabel = linkedTableTarget
      ? `Tabla vinculada: ${linkedTableTarget.title}`
      : "Vincular con tabla editable";

    const blockMenuActions =
      mode === "edit"
        ? [
            {
              key: `card-gallery-link-${block.id}`,
              label: linkLabel,
              onClick: openLinkPicker
            },
            ...(menuActions || [])
          ]
        : menuActions;

    useEffect(() => {
      if (!isLinkModalOpen || !isLinkMenuOpen) return;
      const handleDocumentMouseDown = (event: MouseEvent) => {
        if (!(event.target instanceof Node)) return;
        if (linkMenuRef.current?.contains(event.target)) return;
        setIsLinkMenuOpen(false);
      };
      const handleWindowKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          setIsLinkMenuOpen(false);
        }
      };
      document.addEventListener("mousedown", handleDocumentMouseDown);
      window.addEventListener("keydown", handleWindowKeyDown);
      return () => {
        document.removeEventListener("mousedown", handleDocumentMouseDown);
        window.removeEventListener("keydown", handleWindowKeyDown);
      };
    }, [isLinkMenuOpen, isLinkModalOpen]);

    useEffect(() => {
      if (!isEditorOpen) return;
      const handleWindowKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeEditor();
        }
      };
      window.addEventListener("keydown", handleWindowKeyDown);
      return () => {
        window.removeEventListener("keydown", handleWindowKeyDown);
      };
    }, [isEditorOpen]);

    useEffect(() => {
      if (!isEditorOpen) return;
      window.setTimeout(() => {
        titleInputRef.current?.focus();
      }, 0);
    }, [isEditorOpen, activeCardIndex]);

    return (
      <BlockPanel id={block.id} as="section" menuActions={blockMenuActions}>
        {renderHeader(
          block.id,
          mode,
          block.props.title || "",
          block.props.description || "",
          (patch) => patchBlockProps(patch)
        )}

        {slot || (
          <div className="card-gallery-grid">
            {cardsForDisplay.map((card, index) => (
              <button
                className="card-gallery-item-button"
                key={`${block.id}-card-${card.key}`}
                type="button"
                onClick={() => openEditor(index, card)}
                aria-label={`Abrir editor de tarjeta ${card.title}`}
              >
                <article className="card-gallery-item">
                  <div className="card-gallery-cover">
                    {card.imageUrl ? <img src={card.imageUrl} alt="" loading="lazy" /> : null}
                  </div>
                  <div className="card-gallery-body">
                    <h4>{card.title || "Sin título"}</h4>
                    <div className="card-gallery-meta">
                      {card.fields.map((field) => (
                        <span key={`${card.key}-${field.label}`} className="card-gallery-meta-field" title={field.value}>
                          <strong>{field.label}:</strong> {field.value}
                        </span>
                      ))}
                    </div>
                  </div>
                </article>
              </button>
            ))}
            {!isLinkedMode && mode === "edit" ? (
              <button className="card-gallery-add" type="button" onClick={addManualCard}>
                + Nueva tarjeta
              </button>
            ) : null}
          </div>
        )}

        {isLinkModalOpen &&
          typeof document !== "undefined" &&
          createPortal(
            <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={closeLinkPicker}>
              <div className="modal" onClick={(event) => event.stopPropagation()}>
                <header className="modal-header">
                  <div>
                    <h2>Vincular tabla editable</h2>
                    <p>Selecciona una tabla para vincular la galería.</p>
                  </div>
                  <button className="ghost" type="button" onClick={closeLinkPicker} aria-label="Close">
                    ×
                  </button>
                </header>
                <div className="todo-link-modal-body">
                  <div className="field todo-link-select-field">
                    <span>Tabla vinculada</span>
                    <div className="todo-link-select-wrap" ref={linkMenuRef}>
                      <button
                        type="button"
                        className={`select-trigger ${isLinkMenuOpen ? "open" : ""}`}
                        onClick={() => setIsLinkMenuOpen((prev) => !prev)}
                        aria-haspopup="listbox"
                        aria-expanded={isLinkMenuOpen}
                      >
                        <span className="select-pill">
                          {linkedTableTarget
                            ? `[${linkedTableTarget.pageId}] ${linkedTableTarget.title}`
                            : "Sin vínculo"}
                        </span>
                        <span className="select-caret">▾</span>
                      </button>
                      {isLinkMenuOpen && (
                        <div className="select-menu todo-link-select-menu">
                          {tableTargets.length === 0 ? (
                            <div className="select-empty">No hay tablas editables disponibles.</div>
                          ) : (
                            <div className="select-options" role="listbox" aria-label="Tablas editables">
                              <button
                                type="button"
                                className={`select-option ${!linkedTableId ? "selected" : ""}`}
                                onClick={() => setLinkedTable(null)}
                              >
                                <span className="select-swatch" style={{ backgroundColor: "var(--panel)" }} />
                                <span className="select-label">Sin vínculo</span>
                                <span className="select-check">{!linkedTableId ? "✓" : ""}</span>
                              </button>
                              <div className="column-menu-separator" />
                              {tableTargets.map((target) => {
                                const isActive = target.blockId === linkedTableId;
                                return (
                                  <button
                                    type="button"
                                    key={target.blockId}
                                    className={`select-option ${isActive ? "selected" : ""}`}
                                    onClick={() => setLinkedTable(target.blockId)}
                                  >
                                    <span className="select-swatch" style={{ backgroundColor: "var(--panel)" }} />
                                    <span className="select-label">{target.title}</span>
                                    <span className="select-check">{isActive ? "✓" : ""}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {linkedTableId && !linkedTableTarget && (
                    <p className="kpi-edit-hint">La tabla vinculada ya no existe. Selecciona otra.</p>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )}

        {isEditorOpen &&
          typeof document !== "undefined" &&
          createPortal(
            <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={closeEditor}>
              <div className="modal card-gallery-editor-modal" onClick={(event) => event.stopPropagation()}>
                <header className="modal-header card-gallery-editor-head">
                  <div className="card-gallery-editor-nav">
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => openRelative(-1)}
                      disabled={activeCardIndex === 0}
                      aria-label="Tarjeta anterior"
                    >
                      ↑
                    </button>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => openRelative(1)}
                      disabled={activeCardIndex === cardsForDisplay.length - 1}
                      aria-label="Tarjeta siguiente"
                    >
                      ↓
                    </button>
                  </div>
                  <div className="card-gallery-editor-actions">
                    <button className="ghost" type="button" onClick={closeEditor}>
                      Cerrar
                    </button>
                  </div>
                </header>

                <div className="card-gallery-editor-shell">
                  <input
                    ref={titleInputRef}
                    className="block-edit-title card-gallery-editor-title"
                    value={draftTitle || ""}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    placeholder="Título"
                    disabled={mode !== "edit" || isLinkedMode}
                  />

                  {isLinkedMode && tableSnapshot ? (
                    <>
                      <div className="card-gallery-properties">
                        <label className="card-gallery-property-row">
                          <span>Columna título</span>
                          <select
                            value={draftSourceColumns.titleColumn}
                            onChange={(event) =>
                              setDraftSourceColumns((prev) => ({ ...prev, titleColumn: event.target.value }))
                            }
                            disabled={mode !== "edit"}
                          >
                            {tableSnapshot.columns.map((column) => (
                              <option key={`title-${column}`} value={column}>
                                {column}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="card-gallery-property-row">
                          <span>Columna imagen (opcional)</span>
                          <select
                            value={draftSourceColumns.imageColumn}
                            onChange={(event) =>
                              setDraftSourceColumns((prev) => ({ ...prev, imageColumn: event.target.value }))
                            }
                            disabled={mode !== "edit"}
                          >
                            <option value="">Sin columna de imagen</option>
                            {tableSnapshot.columns.map((column) => (
                              <option key={`image-${column}`} value={column}>
                                {column}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <section className="card-gallery-config-fields">
                        <h3>Campos visibles en tarjeta</h3>
                        <EditableTableToolbar
                          toolbar={{
                            columns: {
                              label: "Campos",
                              items: tableSnapshot.columns
                                .filter((column) => column !== draftSourceColumns.titleColumn)
                                .map((column) => ({
                                  key: column,
                                  label: column,
                                  visible: draftSourceColumns.visibleColumns.includes(column),
                                  disabled: mode !== "edit"
                                })),
                              onToggle: (key) => {
                                if (mode === "edit") {
                                  toggleDraftVisibleColumn(key);
                                }
                              },
                              onShowAll:
                                draftSourceColumns.visibleColumns.length <
                                tableSnapshot.columns.filter((c) => c !== draftSourceColumns.titleColumn).length
                                  ? () => {
                                      if (mode === "edit") {
                                        setDraftSourceColumns((prev) => ({
                                          ...prev,
                                          visibleColumns: tableSnapshot.columns.filter(
                                            (c) => c !== draftSourceColumns.titleColumn
                                          )
                                        }));
                                      }
                                    }
                                  : undefined
                            }
                          }}
                        />
                      </section>

                      <section className="card-gallery-config-fields">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <h3>Valores de los campos</h3>
                          {mode === "edit" && (
                            <button className="ghost" type="button" onClick={addCustomFieldToDraft}>
                              + Añadir campo
                            </button>
                          )}
                        </div>
                        <div className="card-gallery-properties">
                          {draftFields.map((field, index) => (
                            <div 
                              key={field.key} 
                              className={`card-gallery-field-editor ${dragOverField === field.label ? "drag-over" : ""}`}
                              draggable={mode === "edit"}
                              onDragStart={(event) => {
                                if (mode !== "edit") return;
                                event.dataTransfer.setData("text/plain", field.label);
                                event.dataTransfer.effectAllowed = "move";
                                setDraggedField(field.label);
                              }}
                              onDragEnd={() => {
                                setDraggedField(null);
                                setDragOverField(null);
                              }}
                              onDragOver={(event) => {
                                if (mode !== "edit" || !draggedField || draggedField === field.label) return;
                                event.preventDefault();
                                setDragOverField(field.label);
                              }}
                              onDragLeave={() => setDragOverField(null)}
                              onDrop={(event) => {
                                if (mode !== "edit") return;
                                event.preventDefault();
                                handleFieldReorder(field.label);
                              }}
                            >
                              <div className="card-gallery-field-header">
                                <input
                                  className="block-edit-description"
                                  value={field.label}
                                  placeholder="Nombre del campo"
                                  disabled={true}
                                  style={{ fontWeight: 600, background: "var(--surface-alt)" }}
                                />
                              </div>
                              <input
                                className="block-edit-description"
                                value={field.value}
                                onChange={(event) => {
                                  updateDraftField(index, { value: event.target.value });
                                  // Update linked table immediately
                                  if (activeCardKey) {
                                    updateLinkedTableCell(activeCardKey, field.label, event.target.value);
                                  }
                                }}
                                placeholder="Valor"
                                disabled={mode !== "edit"}
                              />
                            </div>
                          ))}
                        </div>
                      </section>
                    </>
                  ) : (
                    <>
                      <label className="card-gallery-property-row">
                        <span>Imagen (URL)</span>
                        <input
                          className="block-edit-description"
                          value={draftImageUrl || ""}
                          onChange={(event) => setDraftImageUrl(event.target.value)}
                          placeholder="https://..."
                          disabled={mode !== "edit"}
                        />
                      </label>

                      <section className="card-gallery-config-fields">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <h3>Campos personalizados</h3>
                          {mode === "edit" && (
                            <button className="ghost" type="button" onClick={addFieldToDraft}>
                              + Añadir campo
                            </button>
                          )}
                        </div>
                        <div className="card-gallery-properties">
                          {draftFields.map((field, index) => (
                            <div key={field.key} className="card-gallery-field-editor">
                              <div className="card-gallery-field-header">
                                <input
                                  className="block-edit-description"
                                  value={field.label}
                                  onChange={(event) => updateDraftField(index, { label: event.target.value })}
                                  placeholder="Nombre del campo"
                                  disabled={mode !== "edit"}
                                />
                                <select
                                  value={field.kind}
                                  onChange={(event) =>
                                    updateDraftField(index, { kind: event.target.value as EditableTableColumnKind })
                                  }
                                  disabled={mode !== "edit"}
                                >
                                  <option value="text">Texto</option>
                                  <option value="number">Número</option>
                                  <option value="date">Fecha</option>
                                  <option value="checkbox">Checkbox</option>
                                  <option value="select">Select</option>
                                  <option value="rating">Rating</option>
                                  <option value="contacts">Contactos</option>
                                  <option value="links">Enlaces</option>
                                  <option value="documents">Documentos</option>
                                  <option value="todo">Todo</option>
                                </select>
                                {mode === "edit" && (
                                  <button
                                    className="ghost"
                                    type="button"
                                    onClick={() => removeDraftField(index)}
                                    aria-label="Eliminar campo"
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                              <input
                                className="block-edit-description"
                                value={field.value}
                                onChange={(event) => updateDraftField(index, { value: event.target.value })}
                                placeholder="Valor"
                                disabled={mode !== "edit"}
                              />
                            </div>
                          ))}
                        </div>
                      </section>
                    </>
                  )}

                  {mode === "edit" ? (
                    <div className="card-gallery-editor-footer">
                      <button className="ghost" type="button" onClick={removeCurrent}>
                        {isLinkedMode ? "Restablecer configuración" : "Eliminar tarjeta"}
                      </button>
                      <button className="primary" type="button" onClick={saveEditor}>
                        Guardar cambios
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body
          )}
      </BlockPanel>
    );
  }
};
