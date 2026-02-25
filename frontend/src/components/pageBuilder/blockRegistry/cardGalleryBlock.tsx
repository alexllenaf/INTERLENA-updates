import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useAppData } from "../../../state";
import { type Application, type Settings } from "../../../types";
import ExpandedFieldsSection, { type ExpandedFieldRow } from "../../expanded/ExpandedFieldsSection";
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
import { COMPACT_TEXT_MAX_CHARS } from "../../../shared/textControl";
import BlockPanel from "../../BlockPanel";
import { EditableTableToolbar } from "../../blocks/BlockRenderer";
import {
  TYPE_REGISTRY,
  type ColumnTypeDef,
  type ColumnTypeSelectActions,
  type TypeRegistryContext
} from "../../dataTypes/typeRegistryCore";
import {
  CARD_GALLERY_SOURCE_TABLE_LINK_KEY,
  TODO_SOURCE_TABLE_LINK_KEY,
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
import {
  columnMenuIconHide,
  columnMenuIconTrash,
  columnMenuIconChangeType,
  ColumnMenuChevronRight,
  columnMenuIconTypeText,
  columnMenuIconTypeNumber,
  columnMenuIconTypeDate,
  columnMenuIconTypeCheckbox,
  columnMenuIconTypeSelect,
  columnMenuIconTypeRating,
  columnMenuIconTypeContacts,
  columnMenuIconTypeLinks,
  columnMenuIconTypeDocuments,
  columnMenuIconTypeTodo
} from "../../columnMenuIcons";
import { normalizeTodoStatus } from "../../../constants";
import { confirmDialog } from "../../../shared/confirmDialog";

// API Gallery Types
type APIImage = {
  id: string;
  url: string;
  thumbnail?: string;
  title: string;
  author?: string;
};

type APIGallery = {
  id: string;
  name: string;
  apiName: string;
  fetchImages: (count?: number) => Promise<APIImage[]>;
};

// API Gallery Configurations
const API_GALLERIES: APIGallery[] = [
  {
    id: "met",
    name: "Metropolitan Museum",
    apiName: "The Metropolitan Museum of Art API",
    fetchImages: async (count = 100) => {
      try {
        const searchRes = await fetch("https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=painting");
        const searchData = await searchRes.json();
        const objectIDs = searchData.objectIDs?.slice(0, count) || [];
        const images: APIImage[] = [];
        
        for (const id of objectIDs) {
          try {
            const objRes = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
            const objData = await objRes.json();
            if (objData.primaryImage) {
              images.push({
                id: String(id),
                url: objData.primaryImage,
                thumbnail: objData.primaryImageSmall || objData.primaryImage,
                title: objData.title || "Sin título",
                author: objData.artistDisplayName || undefined
              });
            }
          } catch {}
          if (images.length >= count) break;
        }
        return images;
      } catch {
        return [];
      }
    }
  },
  {
    id: "art_institute",
    name: "Art Institute of Chicago",
    apiName: "Art Institute of Chicago API",
    fetchImages: async (count = 100) => {
      try {
        const res = await fetch(`https://api.artic.edu/api/v1/artworks?limit=${count}&fields=id,title,artist_display,image_id`);
        const data = await res.json();
        return (data.data || []).filter((art: any) => art.image_id).map((art: any) => ({
          id: String(art.id),
          url: `https://www.artic.edu/iiif/2/${art.image_id}/full/843,/0/default.jpg`,
          thumbnail: `https://www.artic.edu/iiif/2/${art.image_id}/full/400,/0/default.jpg`,
          title: art.title || "Sin título",
          author: art.artist_display
        }));
      } catch {
        return [];
      }
    }
  },
  {
    id: "rijksmuseum",
    name: "Rijksmuseum",
    apiName: "Rijksmuseum API",
    fetchImages: async (count = 100) => {
      try {
        const res = await fetch(`https://www.rijksmuseum.nl/api/en/collection?key=0fiuZFh4&imgonly=true&ps=${count}`);
        const data = await res.json();
        return (data.artObjects || []).map((art: any) => ({
          id: art.objectNumber,
          url: art.webImage?.url || art.headerImage?.url,
          thumbnail: art.webImage?.url,
          title: art.title || "Sin título",
          author: art.principalOrFirstMaker
        }));
      } catch {
        return [];
      }
    }
  },
  {
    id: "chicago_artic",
    name: "Chicago Art Institute (Extended)",
    apiName: "Art Institute of Chicago API",
    fetchImages: async (count = 100) => {
      try {
        const res = await fetch(`https://api.artic.edu/api/v1/artworks/search?q=portrait&limit=${count}&fields=id,title,artist_display,image_id`);
        const data = await res.json();
        return (data.data || []).filter((art: any) => art.image_id).map((art: any) => ({
          id: String(art.id),
          url: `https://www.artic.edu/iiif/2/${art.image_id}/full/843,/0/default.jpg`,
          thumbnail: `https://www.artic.edu/iiif/2/${art.image_id}/full/400,/0/default.jpg`,
          title: art.title || "Sin título",
          author: art.artist_display
        }));
      } catch {
        return [];
      }
    }
  },
  {
    id: "cleveland",
    name: "Cleveland Museum",
    apiName: "Cleveland Museum of Art API",
    fetchImages: async (count = 100) => {
      try {
        const res = await fetch(`https://openaccess-api.clevelandart.org/api/artworks/?has_image=1&limit=${count}`);
        const data = await res.json();
        return (data.data || []).filter((art: any) => art.images?.web?.url).map((art: any) => ({
          id: String(art.id),
          url: art.images.web.url,
          thumbnail: art.images.web.url,
          title: art.title || "Sin título",
          author: art.creators?.[0]?.description
        }));
      } catch {
        return [];
      }
    }
  },
  {
    id: "smithsonian",
    name: "Smithsonian",
    apiName: "Smithsonian Open Access API",
    fetchImages: async (count = 100) => {
      try {
        const res = await fetch(`https://api.si.edu/openaccess/api/v1.0/search?q=painting&media.usage.access=CC0&rows=${count}&api_key=DEMO_KEY`);
        const data = await res.json();
        return (data.response?.rows || []).filter((art: any) => art.content?.descriptiveNonRepeating?.online_media?.media?.[0]?.content).map((art: any) => {
          const media = art.content.descriptiveNonRepeating.online_media.media[0];
          return {
            id: art.id,
            url: media.content,
            thumbnail: media.thumbnail,
            title: art.title || "Sin título",
            author: art.content?.freetext?.name?.[0]?.content
          };
        });
      } catch {
        return [];
      }
    }
  },
  {
    id: "unsplash",
    name: "Unsplash",
    apiName: "Unsplash API",
    fetchImages: async (count = 100) => {
      try {
        // Unsplash API solo permite hasta 30 imágenes a la vez
        const batchSize = 30;
        const batches = Math.ceil(count / batchSize);
        const allImages: APIImage[] = [];
        
        for (let i = 0; i < batches && allImages.length < count; i++) {
          const res = await fetch(`https://api.unsplash.com/photos?page=${i + 1}&per_page=${batchSize}&client_id=demo`);
          const data = await res.json();
          const images = (Array.isArray(data) ? data : []).map((photo: any) => ({
            id: photo.id,
            url: photo.urls.regular,
            thumbnail: photo.urls.small,
            title: photo.description || photo.alt_description || "Sin título",
            author: photo.user?.name
          }));
          allImages.push(...images);
        }
        return allImages.slice(0, count);
      } catch {
        return [];
      }
    }
  },
  {
    id: "pexels",
    name: "Pexels",
    apiName: "Pexels API",
    fetchImages: async (count = 100) => {
      try {
        const res = await fetch(`https://api.pexels.com/v1/curated?per_page=${Math.min(count, 80)}&page=1`, {
          headers: { Authorization: "demo" }
        });
        const data = await res.json();
        return (data.photos || []).map((photo: any) => ({
          id: String(photo.id),
          url: photo.src.large,
          thumbnail: photo.src.medium,
          title: photo.alt || "Sin título",
          author: photo.photographer
        }));
      } catch {
        return [];
      }
    }
  },
  {
    id: "pixabay",
    name: "Pixabay",
    apiName: "Pixabay API",
    fetchImages: async (count = 100) => {
      try {
        const res = await fetch(`https://pixabay.com/api/?key=demo&per_page=${Math.min(count, 200)}`);
        const data = await res.json();
        return (data.hits || []).map((photo: any) => ({
          id: String(photo.id),
          url: photo.largeImageURL,
          thumbnail: photo.webformatURL,
          title: photo.tags || "Sin título",
          author: photo.user
        }));
      } catch {
        return [];
      }
    }
  },
  {
    id: "lorem_picsum",
    name: "Lorem Picsum",
    apiName: "Lorem Picsum API",
    fetchImages: async (count = 100) => {
      const images: APIImage[] = [];
      for (let i = 0; i < count; i++) {
        const id = Math.floor(Math.random() * 1000);
        images.push({
          id: String(id),
          url: `https://picsum.photos/id/${id}/800/600`,
          thumbnail: `https://picsum.photos/id/${id}/400/300`,
          title: `Imagen ${i + 1}`
        });
      }
      return images;
    }
  },
  {
    id: "nasa",
    name: "NASA Image Library",
    apiName: "NASA Image and Video Library API",
    fetchImages: async (count = 100) => {
      try {
        const res = await fetch(`https://images-api.nasa.gov/search?q=space&media_type=image&page_size=${count}`);
        const data = await res.json();
        return (data.collection?.items || []).slice(0, count).map((item: any) => ({
          id: item.data[0].nasa_id,
          url: item.links?.[0]?.href || "",
          thumbnail: item.links?.[0]?.href,
          title: item.data[0].title || "Sin título",
          author: item.data[0].photographer || item.data[0].secondary_creator
        }));
      } catch {
        return [];
      }
    }
  }
];

type CardField = {
  label: string;
  value: string;
  kind?: EditableTableColumnKind;
  selectOptions?: EditableTableSelectOption[];
};

const FALLBACK_TYPE_REF = "text.basic@1";
const DEFAULT_SELECT_OPTION_COLOR = "#E2E8F0";
const LEGACY_KIND_TYPE_REFS: Record<EditableTableColumnKind, string> = {
  text: "text.basic@1",
  number: "number.basic@1",
  select: "select.local@1",
  date: "date.iso@1",
  checkbox: "checkbox.bool@1",
  rating: "rating.stars_0_5_half@1",
  todo: "todo.items@1",
  contacts: "contacts.list@1",
  links: "links.list@1",
  documents: "documents.list@1"
};

const resolveTypeDef = (kind: EditableTableColumnKind | undefined): ColumnTypeDef => {
  const typeRef = kind ? LEGACY_KIND_TYPE_REFS[kind] || FALLBACK_TYPE_REF : FALLBACK_TYPE_REF;
  return TYPE_REGISTRY[typeRef] || TYPE_REGISTRY[FALLBACK_TYPE_REF];
};

const normalizeSelectOptions = (
  options: EditableTableSelectOption[] | undefined
): EditableTableSelectOption[] => {
  if (!options) return [];
  const seen = new Set<string>();
  return options
    .map((option) => ({
      ...option,
      label: typeof option.label === "string" ? option.label.trim() : ""
    }))
    .filter((option) => {
      if (!option.label || seen.has(option.label)) return false;
      seen.add(option.label);
      return true;
    });
};

type TableSnapshot = {
  columns: string[];
  rows: string[][];
  columnKinds: Record<string, EditableTableColumnKind>;
  sourceColumnKeyByLabel?: Record<string, string>;
};

type GalleryCardView = {
  key: string;
  title: string;
  imageUrl?: string;
  imagePosition?: string;
  fields: CardField[];
  sourceRowIndex?: number;
  sourceRowIndices?: number[];
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
    return JSON.stringify(
      (app.contacts || [])
        .filter((contact) => contact && typeof contact === "object")
        .map((contact) => ({
          id: contact.id,
          name: contact.name || "",
          information: contact.information || undefined,
          email: contact.email || undefined,
          phone: contact.phone || undefined,
          first_name: contact.first_name || undefined,
          last_name: contact.last_name || undefined
        }))
        .filter((contact) => contact.name.trim().length > 0)
    );
  }
  if (key === "todo_items") {
    return JSON.stringify(
      (app.todo_items || [])
        .filter((todo) => todo && typeof todo === "object")
        .map((todo) => ({
          id: todo.id,
          task: todo.task || "",
          due_date: todo.due_date || undefined,
          status: normalizeTodoStatus(todo.status),
          task_location: todo.task_location || undefined,
          notes: todo.notes || undefined,
          documents_links: todo.documents_links || undefined
        }))
        .filter((todo) => todo.task.trim().length > 0)
    );
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
  const sourceColumnKeyByLabel: Record<string, string> = {};
  columns.forEach((label, index) => {
    sourceColumnKeyByLabel[label] = keyByLabel[index] || label;
  });
  return { columns, rows, columnKinds, sourceColumnKeyByLabel };
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

const splitGroupValues = (raw: string, kind?: EditableTableColumnKind): string[] => {
  const seed = raw.trim();
  if (!seed) return ["Sin título"];
  const splitKinds = new Set<EditableTableColumnKind>(["contacts", "links", "documents", "todo"]);
  if (!kind || !splitKinds.has(kind)) return [seed];
  const parts = seed
    .split(/[|\n;]+/)
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
    const { settings, saveSettings, applications, updateApplication } = useAppData();
    const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
    const [isLinkMenuOpen, setIsLinkMenuOpen] = useState(false);
    const linkMenuRef = useRef<HTMLDivElement | null>(null);
    const [activeCardIndex, setActiveCardIndex] = useState<number | null>(null);
    const [activeCardKey, setActiveCardKey] = useState<string | null>(null);
    const [draftTitle, setDraftTitle] = useState("");
    const [draftImageUrl, setDraftImageUrl] = useState("");
    const [draftFields, setDraftFields] = useState<CardGalleryCustomField[]>([]);
    const [linkedSelectOptionsOverrides, setLinkedSelectOptionsOverrides] = useState<
      Record<string, EditableTableSelectOption[]>
    >({});
    const [draftSourceColumns, setDraftSourceColumns] = useState<{
      titleColumn: string;
      visibleColumns: string[];
      imageColumn: string;
    }>({ titleColumn: "", visibleColumns: [], imageColumn: "" });
    const [activeSourceRowIndex, setActiveSourceRowIndex] = useState<number | null>(null);
    const [fieldMenuOpen, setFieldMenuOpen] = useState<string | null>(null);
    const [fieldMenuPos, setFieldMenuPos] = useState<{ top: number; left: number } | null>(null);
    const [fieldMenuView, setFieldMenuView] = useState<"root" | "type">("root");
    const [showCoverMenu, setShowCoverMenu] = useState(false);
    const [coverMenuExpanded, setCoverMenuExpanded] = useState(false);
    const [showChangeSubmenu, setShowChangeSubmenu] = useState(false);
    const [isRepositioning, setIsRepositioning] = useState(false);
    const [coverPosition, setCoverPosition] = useState(50);
    const [coverIsDragging, setCoverIsDragging] = useState(false);
    const [coverDragStartY, setCoverDragStartY] = useState(0);
    const [coverDragStartPos, setCoverDragStartPos] = useState(50);
    const [showImageGalleryModal, setShowImageGalleryModal] = useState(false);
    const [imageGalleryTab, setImageGalleryTab] = useState<"gallery" | "upload" | "link" | "recent">("gallery");
    const [selectedAPIGallery, setSelectedAPIGallery] = useState<string | null>(null);
    const [apiImages, setApiImages] = useState<Record<string, APIImage[]>>({});
    const [apiFullGallerySearch, setApiFullGallerySearch] = useState("");
    const [apiGalleryLoading, setApiGalleryLoading] = useState<Record<string, boolean>>({});
    const [recentImages, setRecentImages] = useState<APIImage[]>(() => {
      try {
        const stored = localStorage.getItem('cardGallery_recentImages');
        return stored ? JSON.parse(stored) : [];
      } catch {
        return [];
      }
    });
    const fieldMenuRef = useRef<HTMLDivElement | null>(null);
    const titleInputRef = useRef<HTMLInputElement | null>(null);
    const returnFocusRef = useRef<HTMLElement | null>(null);
    const lastAutoSavedSignatureRef = useRef<string>("");
    const persistEditorDraftRef = useRef<(() => void) | null>(null);

    // Helper para agregar imagen al historial de recientes
    const addToRecentImages = useCallback((url: string, title?: string, thumbnail?: string) => {
      const newImage: APIImage = {
        id: Date.now().toString(),
        url,
        thumbnail: thumbnail || url,
        title: title || "Imagen reciente"
      };
      
      setRecentImages((prev) => {
        const filtered = prev.filter((img) => img.url !== url);
        const updated = [newImage, ...filtered].slice(0, 30); // Mantener solo las últimas 30
        try {
          localStorage.setItem('cardGallery_recentImages', JSON.stringify(updated));
        } catch (e) {
          console.error('Error guardando imágenes recientes:', e);
        }
        return updated;
      });
    }, []);

    const slotContext = createSlotContext(mode, updateBlockProps, patchBlockProps);
    const slot = block.props.contentSlotId ? resolveSlot?.(block.props.contentSlotId, block, slotContext) : null;

    const tableTargets = useMemo(() => collectEditableTableTargets(settings), [settings]);
    const linkedTableId = getBlockLink(block.props, CARD_GALLERY_SOURCE_TABLE_LINK_KEY);
    const selectedLinkedTableTarget = linkedTableId
      ? tableTargets.find((target) => target.blockId === linkedTableId) || null
      : null;

    const linkedTableTarget = useMemo(() => {
      if (!selectedLinkedTableTarget) return null;
      let current = selectedLinkedTableTarget;
      const visited = new Set<string>([current.blockId]);

      while (current.type === "todoTable") {
        const nextId = getBlockLink(current.props, TODO_SOURCE_TABLE_LINK_KEY);
        if (!nextId || visited.has(nextId)) break;
        const nextTarget = tableTargets.find((target) => target.blockId === nextId) || null;
        if (!nextTarget) break;
        visited.add(nextId);
        current = nextTarget;
      }

      return current;
    }, [selectedLinkedTableTarget, tableTargets]);

    const linkedEditableModel = useMemo(() => {
      if (!linkedTableTarget) return null;
      if (isTrackerSourceTarget(linkedTableTarget)) return null;
      return resolveEditableTableModel(linkedTableTarget.props as PageBlockPropsMap["editableTable"], {
        settings,
        saveSettings
      });
    }, [linkedTableTarget, saveSettings, settings]);

    useEffect(() => {
      setLinkedSelectOptionsOverrides({});
    }, [linkedTableId]);

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

    const buildSelectOptionsFromTable = useCallback(
      (columnLabel: string): EditableTableSelectOption[] => {
        const overrideOptions = linkedSelectOptionsOverrides[columnLabel];
        if (overrideOptions && overrideOptions.length > 0) {
          return overrideOptions;
        }
        const linkedOptions = linkedEditableModel?.selectOptionsByColumn?.[columnLabel];
        if (linkedOptions && linkedOptions.length > 0) {
          return linkedOptions as EditableTableSelectOption[];
        }
        if (!tableSnapshot) return [];
        const colIndex = tableSnapshot.columns.indexOf(columnLabel);
        if (colIndex < 0) return [];
        const sourceKey = tableSnapshot.sourceColumnKeyByLabel?.[columnLabel] || "";
        const colorMap =
          sourceKey === "stage"
            ? (settings?.stage_colors as Record<string, string> | undefined)
            : sourceKey === "outcome"
            ? (settings?.outcome_colors as Record<string, string> | undefined)
            : sourceKey === "job_type"
            ? (settings?.job_type_colors as Record<string, string> | undefined)
            : undefined;
        const seen = new Set<string>();
        const options: EditableTableSelectOption[] = [];
        tableSnapshot.rows.forEach((row) => {
          const raw = row[colIndex] || "";
          const value = typeof raw === "string" ? raw.trim() : "";
          if (!value || seen.has(value)) return;
          seen.add(value);
          options.push({ label: value, color: colorMap?.[value] });
        });
        return options;
      },
      [linkedEditableModel, linkedSelectOptionsOverrides, settings, tableSnapshot]
    );

    const linkedCards = useMemo(() => {
      if (!tableSnapshot || !isLinkedMode) return [] as GalleryCardView[];

      const configs = block.props.cardFieldConfigs || {};
      const globalVisibleColumns =
        block.props.visibleColumns && block.props.visibleColumns.length > 0
          ? block.props.visibleColumns
          : undefined;
      const globalImageOverrides = block.props.sourceImageByTitle || {};
      const globalImagePositionOverrides = block.props.sourceImagePositionByTitle || {};
      const valueOverrides = block.props.fieldValueOverrides || {};
      const groupByColumn = block.props.groupByColumn || tableSnapshot.columns[0] || "";
      const groupByIndex = tableSnapshot.columns.indexOf(groupByColumn);
      const groupByKind = groupByColumn ? tableSnapshot.columnKinds[groupByColumn] : undefined;

      type GroupedCard = {
        key: string;
        title: string;
        visibleColumns: string[];
        imageColumn: string;
        rowIndices: number[];
      };

      const grouped = new Map<string, GroupedCard>();

      tableSnapshot.rows.forEach((row, rowIndex) => {
        const titleSeed = groupByIndex >= 0 ? row[groupByIndex] || "" : row[0] || "";
        const groupValues = splitGroupValues(titleSeed, groupByKind);

        groupValues.forEach((groupValue) => {
          const title = groupValue.trim() || "Sin título";
          const groupKey = `${groupByColumn}::${title}`;
          const rowConfig = configs[groupKey] || {};

          const existing = grouped.get(groupKey);
          if (existing) {
            existing.rowIndices.push(rowIndex);
            return;
          }

          const defaultVisible = tableSnapshot.columns
            .filter((column) => column !== groupByColumn)
            .slice(0, 3);

          grouped.set(groupKey, {
            key: groupKey,
            title,
            visibleColumns: globalVisibleColumns || rowConfig.visibleColumns || defaultVisible,
            imageColumn: rowConfig.imageColumn || "",
            rowIndices: [rowIndex]
          });
        });
      });

      const result: GalleryCardView[] = [];
      grouped.forEach((group) => {
        const cardValueOverrides = valueOverrides[group.key] || {};
        const firstRowIndex = group.rowIndices[0] ?? 0;
        const firstRow = tableSnapshot.rows[firstRowIndex] || [];

        const fields: CardField[] = [];
        group.visibleColumns.forEach((colName) => {
          const colIndex = tableSnapshot.columns.indexOf(colName);
          const hasSourceColumn = colIndex >= 0;
          if (!hasSourceColumn) {
            const overrideValue = cardValueOverrides[colName] || "";
            if (!overrideValue.trim()) return;
            fields.push({
              label: colName,
              value: overrideValue,
              kind: "text"
            });
            return;
          }

          const uniqueValues = new Set<string>();
          group.rowIndices.forEach((rowIndex) => {
            const value = tableSnapshot.rows[rowIndex]?.[colIndex] || "";
            if (value.trim()) uniqueValues.add(value);
          });
          const value = Array.from(uniqueValues).join(" | ");
          if (!value.trim()) return;
          const fieldKind = tableSnapshot.columnKinds[colName];
          const selectOptions =
            fieldKind === "select" ? buildSelectOptionsFromTable(colName) : undefined;
          fields.push({
            label: colName,
            value,
            kind: fieldKind,
            selectOptions
          });
        });

        const imageValue = group.imageColumn
          ? firstRow[tableSnapshot.columns.indexOf(group.imageColumn)] || ""
          : "";
        const finalImageUrl = globalImageOverrides[group.key] || imageValue || undefined;
        const finalImagePosition = globalImagePositionOverrides[group.key] || undefined;

        result.push({
          key: group.key,
          title: group.title,
          imageUrl: finalImageUrl,
          imagePosition: finalImagePosition,
          fields,
          sourceRowIndex: firstRowIndex,
          sourceRowIndices: group.rowIndices
        });
      });

      return result;
    }, [
      block.props.cardFieldConfigs,
      block.props.fieldValueOverrides,
      block.props.groupByColumn,
      block.props.visibleColumns,
      block.props.sourceImageByTitle,
      block.props.sourceImagePositionByTitle,
      buildSelectOptionsFromTable,
      isLinkedMode,
      tableSnapshot
    ]);

    const cardsForDisplay: GalleryCardView[] = isLinkedMode
      ? linkedCards
      : manualCards.map((card) => ({
          key: card.key,
          title: card.title,
          imageUrl: card.imageUrl,
          imagePosition: card.imagePosition,
          fields: (card.fields || []).map((field) => ({
            label: field.label,
            value: field.value,
            kind: field.kind,
            selectOptions: field.selectOptions
          }))
        }));

    const visibleDraftFieldLabels = useMemo(() => {
      if (isLinkedMode) {
        return draftFields.map((field) => field.label);
      }
      if (draftSourceColumns.visibleColumns.length > 0) {
        return draftSourceColumns.visibleColumns.filter(
          (column) => column !== draftSourceColumns.titleColumn
        );
      }
      return draftFields
        .map((field) => field.label)
        .filter((column) => column !== draftSourceColumns.titleColumn);
    }, [draftFields, draftSourceColumns.titleColumn, draftSourceColumns.visibleColumns, isLinkedMode]);

    const draftFieldsForEditor = useMemo(() => {
      if (isLinkedMode) {
        return draftFields;
      }
      const fieldsByLabel = new Map(draftFields.map((field) => [field.label, field]));
      return visibleDraftFieldLabels
        .map((label) => fieldsByLabel.get(label))
        .filter((field): field is CardGalleryCustomField => Boolean(field));
    }, [draftFields, isLinkedMode, visibleDraftFieldLabels]);

    const isEditorOpen = activeCardIndex !== null && activeCardKey !== null;

    useEffect(() => {
      if (!isEditorOpen || !isLinkedMode || activeSourceRowIndex === null) return;

      const nextIndex = cardsForDisplay.findIndex((card) =>
        (card.sourceRowIndices || []).includes(activeSourceRowIndex)
      );

      const resolvedIndex = nextIndex >= 0
        ? nextIndex
        : Math.max(0, Math.min(activeCardIndex ?? 0, cardsForDisplay.length - 1));
      const nextCard = cardsForDisplay[resolvedIndex];
      if (!nextCard) return;

      const nextFieldValues: CardGalleryCustomField[] = nextCard.fields.map((field) => ({
        key: field.label,
        label: field.label,
        kind: field.kind || "text",
        value: field.value
      }));

      const sameCard = nextCard.key === activeCardKey;
      const sameIndex = resolvedIndex === activeCardIndex;
      const sameTitle = nextCard.title === draftTitle;
      const sameImage = (nextCard.imageUrl || "") === draftImageUrl;
      const nextPosition = nextCard.imagePosition ? parseFloat(nextCard.imagePosition) : 50;
      const samePosition = Math.abs(nextPosition - coverPosition) < 0.01;
      const sameFields = JSON.stringify(nextFieldValues) === JSON.stringify(draftFields);
      if (sameCard && sameIndex && sameTitle && sameImage && samePosition && sameFields) return;
      
      // Si la tarjeta es la misma pero los datos han cambiado, no sobrescribir lo que el usuario está editando
      if (sameCard && sameIndex) return;

      setActiveCardIndex(resolvedIndex);
      setActiveCardKey(nextCard.key);
      setDraftTitle(nextCard.title);
      setDraftImageUrl(nextCard.imageUrl || "");
      setCoverPosition(nextPosition);
      setDraftFields(nextFieldValues);
    }, [
      activeCardIndex,
      activeCardKey,
      activeSourceRowIndex,
      cardsForDisplay,
      coverPosition,
      draftFields,
      draftImageUrl,
      draftTitle,
      isEditorOpen,
      isLinkedMode
    ]);

    const openEditor = (index: number, card: GalleryCardView) => {
      if (!isEditorOpen && typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
        returnFocusRef.current = document.activeElement;
      }
      setActiveCardIndex(index);
      setActiveCardKey(card.key);
      setActiveSourceRowIndex(card.sourceRowIndex ?? null);
      setDraftTitle(card.title);
      setDraftImageUrl(card.imageUrl || "");
      setCoverPosition(card.imagePosition ? parseFloat(card.imagePosition) : 50);

      if (isLinkedMode && tableSnapshot) {
        const config = block.props.cardFieldConfigs?.[card.key] || {};
        const titleColumn = block.props.groupByColumn || tableSnapshot.columns[0] || "";
        const visibleColumns =
          (block.props.visibleColumns && block.props.visibleColumns.length > 0
            ? block.props.visibleColumns
            : config.visibleColumns) ||
          tableSnapshot.columns.filter((column) => column !== titleColumn).slice(0, 3);
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
          value: field.value,
          selectOptions: field.selectOptions
        }));
        setDraftFields(fieldValues);
        const initialPosition = card.imagePosition ? parseFloat(card.imagePosition) : 50;
        lastAutoSavedSignatureRef.current = JSON.stringify({
          activeCardKey: card.key,
          isLinkedMode: true,
          draftTitle: card.title,
          draftImageUrl: card.imageUrl || "",
          coverPosition: initialPosition,
          draftFields: fieldValues,
          draftSourceColumns: {
            titleColumn,
            visibleColumns,
            imageColumn
          }
        });
      } else {
        const manualCard = manualCards.find((c) => c.key === card.key);
        const nextManualFields = manualCard?.fields || [];
        const titleColumn = nextManualFields[0]?.label || "";
        setDraftFields(nextManualFields);
        setDraftSourceColumns({
          titleColumn,
          visibleColumns: nextManualFields
            .map((field) => field.label)
            .filter((column) => column !== titleColumn),
          imageColumn: ""
        });
        const initialPosition = card.imagePosition ? parseFloat(card.imagePosition) : 50;
        lastAutoSavedSignatureRef.current = JSON.stringify({
          activeCardKey: card.key,
          isLinkedMode: false,
          draftTitle: card.title,
          draftImageUrl: card.imageUrl || "",
          coverPosition: initialPosition,
          draftFields: nextManualFields,
          draftSourceColumns: {
            titleColumn,
            visibleColumns: nextManualFields
              .map((field) => field.label)
              .filter((column) => column !== titleColumn),
            imageColumn: ""
          }
        });
      }
    };

    const closeEditor = () => {
      persistEditorDraftRef.current?.();
      setActiveCardIndex(null);
      setActiveCardKey(null);
      setDraftTitle("");
      setDraftImageUrl("");
      setDraftFields([]);
      setActiveSourceRowIndex(null);
      setDraftSourceColumns({ titleColumn: "", visibleColumns: [], imageColumn: "" });
      setCoverPosition(50);
      lastAutoSavedSignatureRef.current = "";
      const returnEl = returnFocusRef.current;
      if (returnEl) {
        window.setTimeout(() => {
          returnEl.focus();
        }, 0);
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

    const buildFieldTypeContext = useCallback(
      (
        field: CardGalleryCustomField | CardField,
        options: EditableTableSelectOption[] | undefined,
        expandedComplexEditors: boolean,
        textControl: "input" | "textarea" | undefined,
        onOptionsChange?: (next: EditableTableSelectOption[]) => void
      ): TypeRegistryContext => ({
        column: {
          key: field.label,
          label: field.label
        },
        selectState:
          field.kind === "select"
            ? {
                options,
                setOptions: onOptionsChange,
                defaultColor: DEFAULT_SELECT_OPTION_COLOR
              }
            : undefined,
        ui: {
          expandedComplexEditors,
          textControl,
          textRows: textControl === "textarea" ? 3 : undefined
        }
      }),
      []
    );

    const serializeTypedFieldValue = useCallback(
      (
        field: CardGalleryCustomField | CardField,
        nextValue: unknown,
        context: TypeRegistryContext
      ): string | null => {
        const typeDef = resolveTypeDef(field.kind);
        const serialized = typeDef.serialize(nextValue, context);
        const parsed = typeDef.parse(serialized, context);
        const validation = typeDef.validate?.(parsed, context);
        if (validation && !validation.valid) return null;
        return serialized;
      },
      []
    );

    const renderTypedFieldCell = useCallback(
      ({
        field,
        rawValue,
        canEdit,
        selectOptions,
        onCommit,
        onOptionsChange,
        typeDefOverride,
        typeContextOverride,
        selectActionsOverride,
        optionsOverride,
        textControl,
        expandedComplexEditors = false
      }: {
        field: CardGalleryCustomField | CardField;
        rawValue: string;
        canEdit: boolean;
        selectOptions?: EditableTableSelectOption[];
        onCommit: (serialized: string) => void;
        onOptionsChange?: (next: EditableTableSelectOption[]) => void;
        typeDefOverride?: ColumnTypeDef | null;
        typeContextOverride?: TypeRegistryContext | null;
        selectActionsOverride?: ColumnTypeSelectActions;
        optionsOverride?: EditableTableSelectOption[];
        textControl?: "input" | "textarea";
        expandedComplexEditors?: boolean;
      }) => {
        const resolvedOptions = normalizeSelectOptions(selectOptions);
        const resolvedOverrideOptions = normalizeSelectOptions(optionsOverride);
        const context =
          typeContextOverride ||
          buildFieldTypeContext(
            field,
            field.kind === "select" ? resolvedOptions : undefined,
            expandedComplexEditors,
            textControl,
            onOptionsChange
              ? (next) => onOptionsChange(normalizeSelectOptions(next))
              : undefined
          );
        const typeDef = typeDefOverride || resolveTypeDef(field.kind);
        const parsed = typeDef.parse(rawValue, context);
        const fallbackSelectActions =
          canEdit && field.kind === "select" && onOptionsChange
            ? {
                onCreateOption: (label: string) => {
                  const trimmed = label.trim();
                  if (!trimmed) return null;
                  const options = normalizeSelectOptions(resolvedOptions);
                  const existing = options.find((option) => option.label === trimmed);
                  if (existing) return existing.label;
                  const next = [
                    ...options,
                    {
                      label: trimmed,
                      color: DEFAULT_SELECT_OPTION_COLOR,
                      editable: true
                    }
                  ];
                  onOptionsChange(next);
                  return trimmed;
                },
                onUpdateOptionColor: (label: string, color: string) => {
                  const next = normalizeSelectOptions(resolvedOptions).map((option) =>
                    option.label === label ? { ...option, color } : option
                  );
                  onOptionsChange(next);
                },
                onDeleteOption: (label: string) => {
                  const next = normalizeSelectOptions(resolvedOptions).filter(
                    (option) => option.label !== label
                  );
                  onOptionsChange(next);
                },
                onReorderOption: (fromLabel: string, toLabel: string) => {
                  const options = normalizeSelectOptions(resolvedOptions);
                  const labels = options.map((option) => option.label);
                  const fromIndex = labels.indexOf(fromLabel);
                  const toIndex = labels.indexOf(toLabel);
                  if (fromIndex < 0 || toIndex < 0) return;
                  const nextLabels = [...labels];
                  const [removed] = nextLabels.splice(fromIndex, 1);
                  nextLabels.splice(toIndex, 0, removed);
                  const byLabel = new Map(options.map((option) => [option.label, option]));
                  const next = nextLabels
                    .map((label) => byLabel.get(label))
                    .filter((option): option is EditableTableSelectOption => Boolean(option));
                  onOptionsChange(next);
                }
              }
            : undefined;
        const selectActions = canEdit
          ? {
              ...(fallbackSelectActions || {}),
              ...(typeDef.getSelectActions?.(context) || {}),
              ...(selectActionsOverride || {})
            }
          : undefined;
        const options =
          field.kind === "select"
            ? typeDef.getOptions?.(context) ||
              (resolvedOverrideOptions.length > 0 ? resolvedOverrideOptions : resolvedOptions)
            : undefined;

        return typeDef.renderCell({
          value: parsed,
          rawValue,
          canEdit,
          options,
          context,
          selectActions,
          onCommit: (next: unknown) => {
            const serialized = serializeTypedFieldValue(field, next, context);
            if (serialized === null) return;
            onCommit(serialized);
          }
        });
      },
      [buildFieldTypeContext, serializeTypedFieldValue]
    );

    const textInputModeByFieldLabel = useMemo<Record<string, "input" | "textarea">>(() => {
      const next: Record<string, "input" | "textarea"> = {};

      draftFieldsForEditor.forEach((field) => {
        if (field.kind !== "text") return;

        const samples: string[] = [];
        if (isLinkedMode && tableSnapshot) {
          const colIndex = tableSnapshot.columns.indexOf(field.label);
          if (colIndex >= 0) {
            tableSnapshot.rows.forEach((row) => {
              const raw = row[colIndex];
              if (raw === null || raw === undefined) return;
              samples.push(String(raw));
            });
          }
        } else {
          manualCards.forEach((card) => {
            const match = (card.fields || []).find((entry) => entry.label === field.label);
            if (typeof match?.value === "string") {
              samples.push(match.value);
            }
          });
        }
        samples.push(field.value || "");

        let maxLength = 0;
        let hasLineBreak = false;
        samples.forEach((sample) => {
          if (!sample) return;
          if (sample.includes("\n")) hasLineBreak = true;
          const normalizedLength = sample.trim().length;
          if (normalizedLength > maxLength) {
            maxLength = normalizedLength;
          }
        });

        const shouldUseCompact = !hasLineBreak && maxLength <= COMPACT_TEXT_MAX_CHARS;
        next[field.label] = shouldUseCompact ? "input" : "textarea";
      });

      return next;
    }, [draftFieldsForEditor, isLinkedMode, manualCards, tableSnapshot]);

    const updateDraftField = (index: number, patch: Partial<CardGalleryCustomField>) => {
      setDraftFields((prev) =>
        prev.map((field, i) => (i === index ? { ...field, ...patch } : field))
      );
    };

    const syncDraftFieldsWithVisibleColumns = useCallback(
      (nextVisibleColumns: string[]) => {
        if (!isLinkedMode) return;
        setDraftFields((prev) => {
          const prevByLabel = new Map(prev.map((field) => [field.label, field]));
          return nextVisibleColumns.map((column) => {
            const existing = prevByLabel.get(column);
            if (existing) return existing;
            const colIndex = tableSnapshot?.columns.indexOf(column) ?? -1;
            const seededValue =
              colIndex >= 0 && activeSourceRowIndex !== null
                ? tableSnapshot?.rows[activeSourceRowIndex]?.[colIndex] || ""
                : "";
            return {
              key: column,
              label: column,
              kind: tableSnapshot?.columnKinds[column] || "text",
              value: seededValue,
              selectOptions:
                tableSnapshot?.columnKinds[column] === "select"
                  ? buildSelectOptionsFromTable(column)
                  : undefined
            } as CardGalleryCustomField;
          });
        });
      },
      [activeSourceRowIndex, buildSelectOptionsFromTable, isLinkedMode, tableSnapshot]
    );

    const toggleDraftVisibleColumn = (column: string) => {
      setDraftSourceColumns((prev) => {
        const exists = prev.visibleColumns.includes(column);
        const next = exists
          ? prev.visibleColumns.filter((c) => c !== column)
          : [...prev.visibleColumns, column];
        syncDraftFieldsWithVisibleColumns(next);
        return { ...prev, visibleColumns: next };
      });
    };

    const reorderVisibleColumn = (fromLabel: string, toLabel: string) => {
      if (!isLinkedMode) {
        setDraftFields((prev) => {
          const next = [...prev];
          const fromIndex = next.findIndex((field) => field.label === fromLabel);
          const toIndex = next.findIndex((field) => field.label === toLabel);
          if (fromIndex < 0 || toIndex < 0) return prev;
          const [removed] = next.splice(fromIndex, 1);
          next.splice(toIndex, 0, removed);
          return next;
        });
        setDraftSourceColumns((prev) => {
          const columns = [...prev.visibleColumns];
          const fromIndex = columns.indexOf(fromLabel);
          const toIndex = columns.indexOf(toLabel);
          if (fromIndex < 0 || toIndex < 0) return prev;
          const [removed] = columns.splice(fromIndex, 1);
          columns.splice(toIndex, 0, removed);
          return { ...prev, visibleColumns: columns };
        });
        return;
      }

      setDraftSourceColumns((prev) => {
        const columns = [...prev.visibleColumns];
        const fromIndex = columns.indexOf(fromLabel);
        const toIndex = columns.indexOf(toLabel);
        if (fromIndex < 0 || toIndex < 0) return prev;
        
        const [removed] = columns.splice(fromIndex, 1);
        columns.splice(toIndex, 0, removed);
        syncDraftFieldsWithVisibleColumns(columns);
        
        return { ...prev, visibleColumns: columns };
      });
    };

    const openFieldMenu = (fieldLabel: string, event: React.MouseEvent) => {
      const target = event.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      const menuWidth = 220;
      const menuHeight = 200;
      
      let left = rect.left;
      if (left + menuWidth > window.innerWidth) {
        left = window.innerWidth - menuWidth - 10;
      }
      
      let top = rect.bottom + 4;
      if (top + menuHeight > window.innerHeight) {
        top = rect.top - menuHeight - 4;
      }
      
      setFieldMenuPos({ top, left });
      setFieldMenuOpen(fieldLabel);
      setFieldMenuView("root");
    };

    const closeFieldMenu = () => {
      setFieldMenuOpen(null);
      setFieldMenuPos(null);
      setFieldMenuView("root");
    };

    const changeFieldType = (fieldLabel: string, newKind: EditableTableColumnKind) => {
      const fieldIndex = draftFields.findIndex((f) => f.label === fieldLabel);
      if (fieldIndex < 0) return;
      updateDraftField(fieldIndex, { kind: newKind });
      closeFieldMenu();
    };

    const hideField = (fieldLabel: string) => {
      if (isLinkedMode) {
        toggleDraftVisibleColumn(fieldLabel);
      } else {
        setDraftSourceColumns((prev) => ({
          ...prev,
          visibleColumns: prev.visibleColumns.filter((column) => column !== fieldLabel)
        }));
      }
      closeFieldMenu();
    };

    const deleteField = async (fieldLabel: string) => {
      const confirmed = await confirmDialog({
        title: "Eliminar campo",
        message: `¿Eliminar el campo "${fieldLabel}"?`,
        confirmLabel: "Eliminar",
        cancelLabel: "Cancelar",
        tone: "danger"
      });
      if (!confirmed) return;

      if (isLinkedMode) {
        toggleDraftVisibleColumn(fieldLabel);
      } else {
        const nextFields = draftFields.filter((field) => field.label !== fieldLabel);
        const nextTitleColumn =
          draftSourceColumns.titleColumn === fieldLabel
            ? nextFields[0]?.label || ""
            : draftSourceColumns.titleColumn;
        setDraftFields(nextFields);
        setDraftSourceColumns((prev) => ({
          ...prev,
          titleColumn: nextTitleColumn,
          visibleColumns: prev.visibleColumns.filter((column) => column !== fieldLabel)
        }));
      }
      closeFieldMenu();
    };

    const addCustomFieldToDraft = () => {
      const nextKey = `custom-field-${Date.now()}`;
      const newFieldLabel = `Campo ${draftFields.length + 1}`;

      setDraftFields((prev) => [
        ...prev,
        {
          key: nextKey,
          label: newFieldLabel,
          kind: "text",
          value: ""
        }
      ]);

      setDraftSourceColumns((prev) => ({
        ...prev,
        titleColumn: prev.titleColumn || newFieldLabel,
        visibleColumns: [...prev.visibleColumns, newFieldLabel]
      }));
    };

    const updateLinkedSourceRow = useCallback(
      (cardKey: string, rowIndexHint: number | null, fieldUpdates: Record<string, string>) => {
        if (!linkedTableTarget || !tableSnapshot) return;
        const updateEntries = Object.entries(fieldUpdates);
        if (updateEntries.length === 0) return;

        const rowIndex =
          rowIndexHint !== null && rowIndexHint >= 0 && rowIndexHint < tableSnapshot.rows.length
            ? rowIndexHint
            : tableSnapshot.rows.findIndex((row) => {
                const firstValue = row[0] || "";
                const titleValues = splitTitleValues(firstValue, false);
                return titleValues.includes(cardKey);
              });

        if (rowIndex < 0) return;

        if (isTrackerSourceTarget(linkedTableTarget)) {
          const app = applications[rowIndex];
          if (!app) return;

          const normalizeDateTimeValue = (raw: string): string | null => {
            const trimmed = raw.trim();
            return trimmed ? trimmed : null;
          };

          const sanitizeContactsPayload = (raw: string): Array<Record<string, unknown>> => {
            const trimmed = raw.trim();
            if (!trimmed) return [];
            try {
              const parsed = JSON.parse(trimmed);
              if (!Array.isArray(parsed)) return app.contacts || [];
              return parsed.reduce<Array<Record<string, unknown>>>((acc, item, index) => {
                if (!item || typeof item !== "object") return acc;
                const entry = item as Record<string, unknown>;
                const name = typeof entry.name === "string" ? entry.name.trim() : "";
                if (!name) return acc;
                const idSeed = typeof entry.id === "string" ? entry.id.trim() : "";
                const id = idSeed || `contact-${Date.now()}-${index}`;
                acc.push({
                  id,
                  name,
                  first_name:
                    typeof entry.first_name === "string" && entry.first_name.trim()
                      ? entry.first_name.trim()
                      : undefined,
                  last_name:
                    typeof entry.last_name === "string" && entry.last_name.trim()
                      ? entry.last_name.trim()
                      : undefined,
                  information:
                    typeof entry.information === "string" && entry.information.trim()
                      ? entry.information.trim()
                      : undefined,
                  email:
                    typeof entry.email === "string" && entry.email.trim() ? entry.email.trim() : undefined,
                  phone:
                    typeof entry.phone === "string" && entry.phone.trim() ? entry.phone.trim() : undefined
                });
                return acc;
              }, []);
            } catch {
              return app.contacts || [];
            }
          };

          const sanitizeTodoPayload = (raw: string): Array<Record<string, unknown>> => {
            const trimmed = raw.trim();
            if (!trimmed) return [];
            try {
              const parsed = JSON.parse(trimmed);
              if (!Array.isArray(parsed)) return app.todo_items || [];
              return parsed.reduce<Array<Record<string, unknown>>>((acc, item, index) => {
                if (!item || typeof item !== "object") return acc;
                const entry = item as Record<string, unknown>;
                const task = typeof entry.task === "string" ? entry.task.trim() : "";
                if (!task) return acc;
                const idSeed = typeof entry.id === "string" ? entry.id.trim() : "";
                const id = idSeed || `todo-${Date.now()}-${index}`;
                const dueDate =
                  typeof entry.due_date === "string" && entry.due_date.trim()
                    ? entry.due_date.trim()
                    : undefined;
                const statusRaw = typeof entry.status === "string" ? entry.status : undefined;
                acc.push({
                  id,
                  task,
                  due_date: dueDate,
                  status: normalizeTodoStatus(statusRaw),
                  task_location:
                    typeof entry.task_location === "string" && entry.task_location.trim()
                      ? entry.task_location.trim()
                      : undefined,
                  notes:
                    typeof entry.notes === "string" && entry.notes.trim() ? entry.notes.trim() : undefined,
                  documents_links:
                    typeof entry.documents_links === "string" && entry.documents_links.trim()
                      ? entry.documents_links.trim()
                      : undefined
                });
                return acc;
              }, []);
            } catch {
              return app.todo_items || [];
            }
          };

          const payload: Record<string, unknown> = {};

          updateEntries.forEach(([fieldLabel, value]) => {
            const sourceKey = tableSnapshot.sourceColumnKeyByLabel?.[fieldLabel] || fieldLabel;
            if (!sourceKey) return;

            if (sourceKey === "contacts") {
              payload.contacts = sanitizeContactsPayload(value);
              return;
            }

            if (sourceKey === "todo_items") {
              payload.todo_items = sanitizeTodoPayload(value);
              return;
            }

            if (sourceKey.startsWith("prop__")) {
              const propertyKey = sourceKey.slice("prop__".length);
              payload.properties = {
                ...(app.properties || {}),
                [propertyKey]: value
              };
              return;
            }

            if (sourceKey === "favorite") {
              const normalized = value.trim().toLowerCase();
              payload.favorite =
                normalized === "true" ||
                normalized === "1" ||
                normalized === "yes" ||
                normalized === "si" ||
                normalized === "y";
              return;
            }

            if (
              sourceKey === "company_score" ||
              sourceKey === "interview_rounds" ||
              sourceKey === "total_rounds" ||
              sourceKey === "my_interview_score" ||
              sourceKey === "pipeline_order"
            ) {
              const trimmed = value.trim();
              if (!trimmed) {
                payload[sourceKey] = null;
                return;
              }
              const parsed = Number(trimmed);
              payload[sourceKey] = Number.isFinite(parsed) ? parsed : value;
              return;
            }

            if (
              sourceKey === "application_date" ||
              sourceKey === "interview_datetime" ||
              sourceKey === "followup_date"
            ) {
              payload[sourceKey] = normalizeDateTimeValue(value);
              return;
            }

            payload[sourceKey] = value;
          });

          if (Object.keys(payload).length > 0) {
            void updateApplication(app.id, payload as Partial<Application>);
          }
          return;
        }

        if (!settings || !isRecord(settings) || !isRecord(settings.page_configs)) return;

        const pages = settings.page_configs as Record<
          string,
          { blocks?: Array<{ id: string; props?: Record<string, unknown> }> }
        >;

        let targetPageId: string | null = null;
        let targetBlock: { id: string; props?: Record<string, unknown> } | null = null;

        for (const [pageId, pageConfig] of Object.entries(pages)) {
          const found = (pageConfig.blocks || []).find((candidate) => candidate.id === linkedTableId) || null;
          if (found) {
            targetPageId = pageId;
            targetBlock = found;
            break;
          }
        }

        if (!targetPageId || !targetBlock) return;

        const linkedProps = (targetBlock.props || {}) as PageBlockPropsMap["editableTable"];
        const model = resolveEditableTableModel(linkedProps, {
          settings,
          saveSettings
        });

        const nextRows = model.rows.map((row, idx) => {
          if (idx !== rowIndex) return row;
          const nextRow = [...row];
          updateEntries.forEach(([fieldLabel, value]) => {
            const colIndex = model.columns.indexOf(fieldLabel);
            if (colIndex >= 0) {
              nextRow[colIndex] = value;
            }
          });
          return nextRow;
        });

        const nextPages = { ...pages };
        const nextBlocks = (nextPages[targetPageId].blocks || []).map((candidate) => {
          if (candidate.id !== linkedTableId) return candidate;
          return {
            ...candidate,
            props: {
              ...candidate.props,
              customRows: model.remapRowsForPersistence(nextRows)
            }
          };
        });

        nextPages[targetPageId] = {
          ...nextPages[targetPageId],
          blocks: nextBlocks
        };

        void saveSettings({ ...settings, page_configs: nextPages });
      },
      [applications, linkedTableId, linkedTableTarget, saveSettings, settings, tableSnapshot, updateApplication]
    );

    const updateLinkedSelectOptions = useCallback(
      (columnLabel: string, nextOptions: EditableTableSelectOption[]) => {
        if (!linkedTableTarget) return;
        if (isTrackerSourceTarget(linkedTableTarget)) {
          if (!tableSnapshot?.sourceColumnKeyByLabel) return;
          const sourceKey = tableSnapshot.sourceColumnKeyByLabel[columnLabel] || "";
          const listKey =
            sourceKey === "stage"
              ? "stages"
              : sourceKey === "outcome"
              ? "outcomes"
              : sourceKey === "job_type"
              ? "job_types"
              : null;
          const colorKey =
            sourceKey === "stage"
              ? "stage_colors"
              : sourceKey === "outcome"
              ? "outcome_colors"
              : sourceKey === "job_type"
              ? "job_type_colors"
              : null;
          if (!listKey || !colorKey) return;

          const normalized = normalizeSelectOptions(nextOptions || []);
          const nextList = normalized.map((option) => option.label).filter(Boolean);
          const currentColors =
            settings && isRecord(settings[colorKey])
              ? { ...(settings[colorKey] as Record<string, string>) }
              : {};

          Object.keys(currentColors).forEach((label) => {
            if (!nextList.includes(label)) {
              delete currentColors[label];
            }
          });
          normalized.forEach((option) => {
            if (option.color) currentColors[option.label] = option.color;
          });

          setLinkedSelectOptionsOverrides((prev) => ({
            ...prev,
            [columnLabel]: normalized
          }));

          void saveSettings({
            [listKey]: nextList,
            [colorKey]: currentColors
          } as Partial<Settings>);
          return;
        }
        if (!settings || !isRecord(settings) || !isRecord(settings.page_configs)) return;

        const pages = settings.page_configs as Record<
          string,
          { blocks?: Array<{ id: string; props?: Record<string, unknown> }> }
        >;

        let targetPageId: string | null = null;
        let targetBlock: { id: string; props?: Record<string, unknown> } | null = null;

        for (const [pageId, pageConfig] of Object.entries(pages)) {
          const found = (pageConfig.blocks || []).find((candidate) => candidate.id === linkedTableId) || null;
          if (found) {
            targetPageId = pageId;
            targetBlock = found;
            break;
          }
        }

        if (!targetPageId || !targetBlock) return;

        const linkedProps = (targetBlock.props || {}) as PageBlockPropsMap["editableTable"];
        if (linkedProps.schemaRef) return;

        const model = resolveEditableTableModel(linkedProps, {
          settings,
          saveSettings
        });
        if (!model.columns.includes(columnLabel)) return;

        const normalized = normalizeSelectOptions(nextOptions || []);
        setLinkedSelectOptionsOverrides((prev) => ({
          ...prev,
          [columnLabel]: normalized
        }));
        const nextByColumn = { ...(linkedProps.customSelectOptions as Record<string, EditableTableSelectOption[]> || {}) };
        if (normalized.length > 0) {
          nextByColumn[columnLabel] = normalized;
        } else {
          delete nextByColumn[columnLabel];
        }

        const nextPages = { ...pages };
        const nextBlocks = (nextPages[targetPageId].blocks || []).map((candidate) => {
          if (candidate.id !== linkedTableId) return candidate;
          return {
            ...candidate,
            props: {
              ...candidate.props,
              customSelectOptions: Object.keys(nextByColumn).length > 0 ? nextByColumn : undefined
            }
          };
        });

        nextPages[targetPageId] = {
          ...nextPages[targetPageId],
          blocks: nextBlocks
        };

        void saveSettings({ ...settings, page_configs: nextPages });
      },
      [linkedTableId, linkedTableTarget, saveSettings, settings, tableSnapshot]
    );

    const expandedEditorRows = useMemo<ExpandedFieldRow[]>(() => {
      return draftFieldsForEditor.reduce<ExpandedFieldRow[]>((acc, field) => {
        const fieldIndex = draftFields.findIndex((item) => item.key === field.key);
        if (fieldIndex < 0) return acc;

        acc.push({
          key: field.label,
          label: field.label,
          canReorder: mode === "edit",
          dragAriaLabel: `Reordenar campo ${field.label}`,
          onLabelClick:
            mode === "edit"
              ? (event) => {
                  openFieldMenu(field.label, event);
                }
              : undefined,
          value: renderTypedFieldCell({
            field,
            rawValue: field.value,
            canEdit: mode === "edit",
            expandedComplexEditors: true,
            textControl: field.kind === "text" ? textInputModeByFieldLabel[field.label] || "textarea" : undefined,
            selectOptions:
              field.kind === "select"
                ? isLinkedMode
                  ? field.selectOptions || buildSelectOptionsFromTable(field.label)
                  : field.selectOptions
                : undefined,
            onOptionsChange:
              field.kind === "select"
                ? (nextOptions) => {
                    if (isLinkedMode) {
                      updateLinkedSelectOptions(field.label, nextOptions);
                      return;
                    }
                    updateDraftField(fieldIndex, { selectOptions: nextOptions });
                  }
                : undefined,
            typeDefOverride: isLinkedMode
              ? linkedEditableModel?.schemaColumnByLabel?.[field.label]?.typeDef || null
              : null,
            typeContextOverride: isLinkedMode
              ? linkedEditableModel?.schemaColumnByLabel?.[field.label]?.typeContext || null
              : null,
            selectActionsOverride:
              isLinkedMode && linkedEditableModel?.schemaColumnByLabel?.[field.label]
                ? linkedEditableModel.schemaColumnByLabel[field.label].typeDef.getSelectActions?.(
                    linkedEditableModel.schemaColumnByLabel[field.label].typeContext
                  )
                : undefined,
            optionsOverride: isLinkedMode
              ? (linkedEditableModel?.schemaColumnByLabel?.[field.label]?.selectOptions as
                  | EditableTableSelectOption[]
                  | undefined)
              : undefined,
            onCommit: (next) => updateDraftField(fieldIndex, { value: next })
          })
        });

        return acc;
      }, []);
    }, [
      buildSelectOptionsFromTable,
      draftFields,
      draftFieldsForEditor,
      isLinkedMode,
      linkedEditableModel,
      mode,
      openFieldMenu,
      renderTypedFieldCell,
      textInputModeByFieldLabel,
      updateDraftField,
      updateLinkedSelectOptions
    ]);

    const commitInlineCardFieldValue = useCallback(
      (card: GalleryCardView, field: CardField, nextValue: string, nextOptions?: EditableTableSelectOption[]) => {
        if (mode !== "edit") return;

        if (isLinkedMode) {
          const sourceColumns = new Set(tableSnapshot?.columns || []);
          if (sourceColumns.has(field.label)) {
            updateLinkedSourceRow(card.key, card.sourceRowIndex ?? null, {
              [field.label]: nextValue
            });
            return;
          }

          const nextOverrides = { ...(block.props.fieldValueOverrides || {}) };
          const cardOverrides = { ...(nextOverrides[card.key] || {}) };
          if (nextValue.trim()) {
            cardOverrides[field.label] = nextValue;
          } else {
            delete cardOverrides[field.label];
          }
          if (Object.keys(cardOverrides).length > 0) {
            nextOverrides[card.key] = cardOverrides;
          } else {
            delete nextOverrides[card.key];
          }
          patchBlockProps({
            fieldValueOverrides: Object.keys(nextOverrides).length > 0 ? nextOverrides : undefined
          });
          return;
        }

        const nextCards = manualCards.map((manualCard) => {
          if (manualCard.key !== card.key) return manualCard;
          const nextFields = (manualCard.fields || []).map((item) =>
            item.label === field.label
              ? {
                  ...item,
                  value: nextValue,
                  selectOptions: nextOptions ?? item.selectOptions
                }
              : item
          );
          return { ...manualCard, fields: nextFields };
        });
        patchBlockProps({ manualCards: nextCards });
      },
      [
        block.props.fieldValueOverrides,
        isLinkedMode,
        manualCards,
        mode,
        patchBlockProps,
        tableSnapshot?.columns,
        updateLinkedSourceRow
      ]
    );

    const persistEditorDraft = useCallback(() => {
      if (activeCardKey === null) return;

      if (isLinkedMode) {
        const nextConfigs = { ...(block.props.cardFieldConfigs || {}) };
        nextConfigs[activeCardKey] = {
          imageColumn: draftSourceColumns.imageColumn
        };

        const nextImageOverrides = { ...(block.props.sourceImageByTitle || {}) };
        const normalizedImage = normalizeString(draftImageUrl);
        if (normalizedImage) {
          nextImageOverrides[activeCardKey] = normalizedImage;
        } else {
          delete nextImageOverrides[activeCardKey];
        }

        const nextImagePositionOverrides = { ...(block.props.sourceImagePositionByTitle || {}) };
        if (normalizedImage && coverPosition !== 50) {
          nextImagePositionOverrides[activeCardKey] = coverPosition.toString();
        } else {
          delete nextImagePositionOverrides[activeCardKey];
        }

        const nextFieldOverrides = { ...(block.props.fieldValueOverrides || {}) };
        const cardOverrides: Record<string, string> = {};
        const sourceFieldUpdates: Record<string, string> = {};
        const sourceColumns = new Set(tableSnapshot?.columns || []);

        const titleColumn = draftSourceColumns.titleColumn;
        if (titleColumn && sourceColumns.has(titleColumn)) {
          sourceFieldUpdates[titleColumn] = draftTitle;
        }

        draftFields.forEach((field) => {
          if (sourceColumns.has(field.label)) {
            sourceFieldUpdates[field.label] = field.value;
            return;
          }
          if (field.value.trim()) {
            cardOverrides[field.label] = field.value;
          }
        });
        if (Object.keys(cardOverrides).length > 0) {
          nextFieldOverrides[activeCardKey] = cardOverrides;
        } else {
          delete nextFieldOverrides[activeCardKey];
        }

        // Solo actualizar fila origen si hay cambios reales en los campos fuente
        if (Object.keys(sourceFieldUpdates).length > 0) {
          updateLinkedSourceRow(activeCardKey, activeSourceRowIndex, sourceFieldUpdates);
        }

        patchBlockProps({
          groupByColumn: draftSourceColumns.titleColumn || undefined,
          visibleColumns:
            draftSourceColumns.visibleColumns.length > 0 ? draftSourceColumns.visibleColumns : undefined,
          cardFieldConfigs: nextConfigs,
          sourceImageByTitle: Object.keys(nextImageOverrides).length > 0 ? nextImageOverrides : undefined,
          sourceImagePositionByTitle: Object.keys(nextImagePositionOverrides).length > 0 ? nextImagePositionOverrides : undefined,
          fieldValueOverrides: Object.keys(nextFieldOverrides).length > 0 ? nextFieldOverrides : undefined
        });
      } else {
        const nextCards = manualCards.map((card) =>
          card.key === activeCardKey
            ? {
                ...card,
                title: draftTitle,
                imageUrl: normalizeString(draftImageUrl) || undefined,
                imagePosition: normalizeString(draftImageUrl) && coverPosition !== 50 ? coverPosition.toString() : undefined,
                fields: draftFields
              }
            : card
        );
        patchBlockProps({ manualCards: nextCards });
      }
    }, [
      activeCardKey,
      activeSourceRowIndex,
      block.props.cardFieldConfigs,
      block.props.fieldValueOverrides,
      block.props.sourceImageByTitle,
      block.props.sourceImagePositionByTitle,
      coverPosition,
      draftFields,
      draftImageUrl,
      draftSourceColumns,
      draftTitle,
      isLinkedMode,
      manualCards,
      patchBlockProps,
      tableSnapshot,
      updateLinkedSourceRow
    ]);

    useEffect(() => {
      persistEditorDraftRef.current = persistEditorDraft;
    }, [persistEditorDraft]);

    useEffect(() => {
      if (mode !== "edit" || !isEditorOpen || activeCardKey === null) return;
      
      const signature = JSON.stringify({
        activeCardKey,
        isLinkedMode,
        draftTitle,
        draftImageUrl,
        coverPosition,
        draftFields,
        draftSourceColumns
      });
      
      if (signature === lastAutoSavedSignatureRef.current) return;
      
      lastAutoSavedSignatureRef.current = signature;
      persistEditorDraft();
    }, [
      activeCardKey,
      coverPosition,
      draftFields,
      draftImageUrl,
      draftSourceColumns,
      draftTitle,
      isEditorOpen,
      isLinkedMode,
      mode,
      persistEditorDraft
    ]);

    const setLinkedTable = (nextBlockId?: string | null) => {
      patchBlockProps({
        ...(patchBlockLink(
          block.props,
          CARD_GALLERY_SOURCE_TABLE_LINK_KEY,
          nextBlockId || null
        ) as Partial<PageBlockPropsMap["cardGallery"]>),
        cardFieldConfigs: undefined,
        visibleColumns: undefined,
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

    useEffect(() => {
      if (!fieldMenuOpen) return;
      const handleClickOutside = (event: MouseEvent) => {
        if (fieldMenuRef.current && !fieldMenuRef.current.contains(event.target as Node)) {
          closeFieldMenu();
        }
      };
      const handleEscape = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          closeFieldMenu();
        }
      };
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleEscape);
      };
    }, [fieldMenuOpen]);

    useEffect(() => {
      if (!coverIsDragging) return;
      const handleGlobalMouseUp = () => {
        setCoverIsDragging(false);
      };
      const handleGlobalMouseMove = (e: MouseEvent) => {
        if (coverIsDragging && isRepositioning) {
          // El movimiento se maneja en el onMouseMove del contenedor
        }
      };
      document.addEventListener("mouseup", handleGlobalMouseUp);
      document.addEventListener("mousemove", handleGlobalMouseMove);
      return () => {
        document.removeEventListener("mouseup", handleGlobalMouseUp);
        document.removeEventListener("mousemove", handleGlobalMouseMove);
      };
    }, [coverIsDragging, isRepositioning]);

    useEffect(() => {
      if (!isRepositioning) return;
      const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (!target.closest('.card-gallery-cover-container')) {
          setIsRepositioning(false);
        }
      };
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }, [isRepositioning]);

    useEffect(() => {
      if (!showImageGalleryModal) return;
      const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('image-gallery-modal-overlay')) {
          setShowImageGalleryModal(false);
        }
      };
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }, [showImageGalleryModal]);

    // Cargar imágenes de las APIs cuando se abre el modal
    useEffect(() => {
      if (!showImageGalleryModal) return;
      
      API_GALLERIES.forEach(async (gallery) => {
        if (apiImages[gallery.id]) return; // Ya cargadas
        
        setApiGalleryLoading(prev => ({ ...prev, [gallery.id]: true }));
        try {
          const images = await gallery.fetchImages(15); // Solo 15 para vista previa
          setApiImages(prev => ({ ...prev, [gallery.id]: images }));
        } catch (error) {
          console.error(`Error cargando ${gallery.name}:`, error);
          setApiImages(prev => ({ ...prev, [gallery.id]: [] }));
        } finally {
          setApiGalleryLoading(prev => ({ ...prev, [gallery.id]: false }));
        }
      });
    }, [showImageGalleryModal]);

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
              <div
                className="card-gallery-item-button"
                key={`${block.id}-card-${card.key}`}
                role="button"
                tabIndex={0}
                onClick={() => openEditor(index, card)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openEditor(index, card);
                  }
                }}
                aria-label={`Abrir editor de tarjeta ${card.title}`}
              >
                <article className="card-gallery-item">
                  <div className="card-gallery-cover">
                    {card.imageUrl ? (
                      <img 
                        src={card.imageUrl} 
                        alt="" 
                        loading="lazy"
                        style={card.imagePosition ? { objectPosition: `center ${card.imagePosition}%` } : undefined}
                      />
                    ) : null}
                  </div>
                  <div className="card-gallery-body">
                    <h4>{card.title || "Sin título"}</h4>
                    <div className="card-gallery-meta">
                      {card.fields.map((field) => {
                        if (mode !== "edit") {
                          return (
                            <span key={`${card.key}-${field.label}`} className="card-gallery-meta-field" title={field.value}>
                              <strong>{field.label}:</strong> {field.value}
                            </span>
                          );
                        }

                        return (
                          <div
                            key={`${card.key}-${field.label}`}
                            className="card-gallery-meta-field"
                            title={field.value}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <strong>{field.label}:</strong>
                            <div className="card-gallery-meta-value">
                              {renderTypedFieldCell({
                                field,
                                rawValue: field.value,
                                canEdit: true,
                                expandedComplexEditors: false,
                                selectOptions:
                                  field.kind === "select"
                                    ? field.selectOptions || buildSelectOptionsFromTable(field.label)
                                    : undefined,
                                onOptionsChange:
                                  field.kind === "select"
                                    ? (nextOptions) => {
                                        if (isLinkedMode) {
                                          updateLinkedSelectOptions(field.label, nextOptions);
                                          return;
                                        }
                                        commitInlineCardFieldValue(card, field, field.value, nextOptions);
                                      }
                                    : undefined,
                                typeDefOverride: linkedEditableModel?.schemaColumnByLabel?.[field.label]?.typeDef || null,
                                typeContextOverride: linkedEditableModel?.schemaColumnByLabel?.[field.label]?.typeContext || null,
                                selectActionsOverride: linkedEditableModel?.schemaColumnByLabel?.[field.label]
                                  ? linkedEditableModel.schemaColumnByLabel[field.label].typeDef.getSelectActions?.(
                                      linkedEditableModel.schemaColumnByLabel[field.label].typeContext
                                    )
                                  : undefined,
                                optionsOverride: linkedEditableModel?.schemaColumnByLabel?.[field.label]?.selectOptions as
                                  | EditableTableSelectOption[]
                                  | undefined,
                                onCommit: (next) =>
                                  commitInlineCardFieldValue(card, field, next, field.selectOptions)
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </article>
              </div>
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
                    <button className="ghost" type="button" onClick={closeEditor} aria-label="Close">
                      ×
                    </button>
                  </div>
                </header>

                <div className="card-gallery-editor-shell">
                  {!draftImageUrl && (
                    <div className="card-gallery-add-image-container">
                      <div
                        role="button"
                        tabIndex={0}
                        className="card-gallery-add-image-button"
                        onClick={() => {
                          setShowImageGalleryModal(true);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setShowImageGalleryModal(true);
                          }
                        }}
                      >
                        <svg
                          aria-hidden="true"
                          role="graphics-symbol"
                          viewBox="2.37 4.12 15.25 11.75"
                          className="card-gallery-add-image-icon"
                        >
                          <path d="M2.375 6.25c0-1.174.951-2.125 2.125-2.125h11c1.174 0 2.125.951 2.125 2.125v7.5a2.125 2.125 0 0 1-2.125 2.125h-11a2.125 2.125 0 0 1-2.125-2.125zm1.25 7.5c0 .483.392.875.875.875h11a.875.875 0 0 0 .875-.875v-2.791l-2.87-2.871a.625.625 0 0 0-.884 0l-4.137 4.136-1.98-1.98a.625.625 0 0 0-.883 0L3.625 12.24zM8.5 9.31a1.5 1.5 0 0 0 1.33-.806 1.094 1.094 0 0 1-.702-2.058A1.5 1.5 0 1 0 8.5 9.31"></path>
                        </svg>
                        Añadir imagen
                      </div>
                    </div>
                  )}

                  {draftImageUrl && (
                    <div 
                      className={`card-gallery-cover-container ${isRepositioning ? 'repositioning' : ''}`}
                      onMouseDown={(e) => {
                        if (isRepositioning && e.button === 0) {
                          setCoverIsDragging(true);
                          setCoverDragStartY(e.clientY);
                          setCoverDragStartPos(coverPosition);
                          e.preventDefault();
                        }
                      }}
                      onMouseMove={(e) => {
                        if (coverIsDragging && isRepositioning) {
                          const deltaY = e.clientY - coverDragStartY;
                          const containerHeight = e.currentTarget.clientHeight;
                          const deltaPercent = (deltaY / containerHeight) * 100;
                          const newPosition = Math.max(0, Math.min(100, coverDragStartPos - deltaPercent));
                          setCoverPosition(newPosition);
                        }
                      }}
                      onMouseUp={() => {
                        if (coverIsDragging) {
                          setCoverIsDragging(false);
                        }
                      }}
                      onMouseLeave={() => {
                        if (coverIsDragging) {
                          setCoverIsDragging(false);
                        }
                      }}
                    >
                      <div className="card-gallery-cover-wrapper">
                        <img 
                          className="card-gallery-cover-image" 
                          src={draftImageUrl} 
                          alt="Cover" 
                          style={{ 
                            objectPosition: `center ${coverPosition}%` 
                          }}
                          draggable={false}
                        />
                      </div>
                      <div className="card-gallery-cover-actions">
                        <button
                          type="button"
                          className={`card-gallery-cover-menu-button ${coverMenuExpanded ? 'expanded' : ''}`}
                          onClick={() => {
                            if (!coverMenuExpanded) {
                              setCoverMenuExpanded(true);
                            }
                          }}
                          onMouseLeave={() => {
                            // Cerrar el menú cuando el mouse sale
                            setTimeout(() => {
                              if (!showChangeSubmenu) {
                                setCoverMenuExpanded(false);
                              }
                            }, 200);
                          }}
                        >
                          {!coverMenuExpanded ? (
                            <div className="card-gallery-cover-menu-dots">⋯</div>
                          ) : (
                            <div className="card-gallery-cover-toolbar">
                              <button
                                type="button"
                                className="card-gallery-cover-button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowImageGalleryModal(true);
                                  setCoverMenuExpanded(false);
                                }}
                                aria-label="Cambiar imagen de portada"
                              >
                                Cambiar
                              </button>
                              <div className="card-gallery-cover-divider" />
                              <button
                                type="button"
                                className="card-gallery-cover-button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setIsRepositioning(!isRepositioning);
                                  setCoverMenuExpanded(false);
                                }}
                                aria-label="Reposicionar imagen de portada"
                              >
                                Reposicionar
                              </button>
                              <div className="card-gallery-cover-divider" />
                              <button
                                type="button"
                                className="card-gallery-cover-button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const link = document.createElement('a');
                                  link.href = draftImageUrl;
                                  link.download = 'cover-image.jpg';
                                  link.click();
                                }}
                                aria-label="Descargar imagen de portada"
                              >
                                <svg 
                                  aria-hidden="true" 
                                  role="graphics-symbol" 
                                  viewBox="0 0 20 20" 
                                  style={{ width: '16px', height: '16px', display: 'block', fill: 'currentColor' }}
                                >
                                  <path d="M10 2.4c.345 0 .625.28.625.625v9.966l3.333-3.333a.625.625 0 1 1 .884.884l-4.4 4.4a.625.625 0 0 1-.884 0l-4.4-4.4a.625.625 0 0 1 .884-.884l3.333 3.333V3.025c0-.345.28-.625.625-.625M4.15 16.35a.625.625 0 1 0 0 1.25h11.7a.625.625 0 0 0 0-1.25z"></path>
                                </svg>
                              </button>
                              <div className="card-gallery-cover-divider" />
                              <button
                                type="button"
                                className="card-gallery-cover-button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void (async () => {
                                    const confirmed = await confirmDialog({
                                      title: "Eliminar imagen de portada",
                                      message: "¿Eliminar imagen de portada?",
                                      confirmLabel: "Eliminar",
                                      cancelLabel: "Cancelar",
                                      tone: "danger"
                                    });
                                    if (!confirmed) return;
                                    setDraftImageUrl("");
                                    setCoverMenuExpanded(false);
                                  })();
                                }}
                                aria-label="Eliminar imagen de portada"
                              >
                                <svg 
                                  aria-hidden="true" 
                                  role="graphics-symbol" 
                                  viewBox="0 0 20 20" 
                                  style={{ width: '16px', height: '16px', display: 'block', fill: 'currentColor' }}
                                >
                                  <path d="M8.5 2h3a.5.5 0 0 1 .5.5V3h3.25a.75.75 0 0 1 0 1.5H14v10.75c0 .966-.784 1.75-1.75 1.75h-4.5A1.75 1.75 0 0 1 6 15.25V4.5H4.75a.75.75 0 0 1 0-1.5H8v-.5a.5.5 0 0 1 .5-.5M7.5 4.5v10.75c0 .138.112.25.25.25h4.5a.25.25 0 0 0 .25-.25V4.5z"></path>
                                </svg>
                              </button>
                            </div>
                          )}
                        </button>
                      </div>

                      {isRepositioning && (
                        <div className="card-gallery-reposition-hint">
                          <span className="card-gallery-reposition-hint-text">
                            Arrastra para reposicionar
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  <input
                    ref={titleInputRef}
                    className="block-edit-title card-gallery-editor-title"
                    value={draftTitle || ""}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    placeholder="Título"
                    disabled={mode !== "edit"}
                  />

                  {isLinkedMode && tableSnapshot ? (
                    <>
                      <div className="card-gallery-properties">

                        <label className="card-gallery-property-row">
                          <span>Columna título</span>
                          <select
                            value={draftSourceColumns.titleColumn}
                            onChange={(event) => {
                              const nextTitleColumn = event.target.value;
                              setDraftSourceColumns((prev) => {
                                const nextVisibleColumns = prev.visibleColumns.filter((column) => column !== nextTitleColumn);
                                syncDraftFieldsWithVisibleColumns(nextVisibleColumns);
                                return {
                                  ...prev,
                                  titleColumn: nextTitleColumn,
                                  visibleColumns: nextVisibleColumns
                                };
                              });
                            }}
                            disabled={mode !== "edit"}
                          >
                            {tableSnapshot.columns.map((column) => (
                              <option key={`title-${column}`} value={column}>
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
                                        const nextVisibleColumns = tableSnapshot.columns.filter(
                                          (c) => c !== draftSourceColumns.titleColumn
                                        );
                                        setDraftSourceColumns((prev) => ({
                                          ...prev,
                                          visibleColumns: nextVisibleColumns
                                        }));
                                        syncDraftFieldsWithVisibleColumns(nextVisibleColumns);
                                      }
                                    }
                                  : undefined
                            }
                          }}
                        />
                      </section>

                      <ExpandedFieldsSection
                        title="Campos personalizados"
                        addLabel="Añadir campo"
                        emptyRowsLabel="No hay campos configurados."
                        clickForSettingsLabel="Click para ajustes"
                        dragToReorderLabel="Arrastrar para reordenar"
                        showAddButton={mode === "edit"}
                        onAddField={addCustomFieldToDraft}
                        rows={expandedEditorRows}
                        onReorderField={(fromFieldLabel, toFieldLabel) => {
                          if (mode !== "edit") return;
                          reorderVisibleColumn(fromFieldLabel, toFieldLabel);
                        }}
                      />
                    </>
                  ) : (
                    <>
                      <div className="card-gallery-properties">
                        <label className="card-gallery-property-row">
                          <span>Columna título</span>
                          <select
                            value={draftSourceColumns.titleColumn}
                            onChange={(event) => {
                              const nextTitleColumn = event.target.value;
                              setDraftSourceColumns((prev) => {
                                const nextVisibleColumns = prev.visibleColumns.filter(
                                  (column) => column !== nextTitleColumn
                                );
                                return {
                                  ...prev,
                                  titleColumn: nextTitleColumn,
                                  visibleColumns: nextVisibleColumns
                                };
                              });
                            }}
                            disabled={mode !== "edit"}
                          >
                            {draftFields.length === 0 && <option value="">—</option>}
                            {draftFields.map((field) => (
                              <option key={`manual-title-${field.key}`} value={field.label}>
                                {field.label}
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
                              items: draftFields
                                .filter((field) => field.label !== draftSourceColumns.titleColumn)
                                .map((field) => ({
                                  key: field.label,
                                  label: field.label,
                                  visible: visibleDraftFieldLabels.includes(field.label),
                                  disabled: mode !== "edit"
                                })),
                              onToggle: (key) => {
                                if (mode !== "edit") return;
                                setDraftSourceColumns((prev) => {
                                  const exists = prev.visibleColumns.includes(key);
                                  const nextVisibleColumns = exists
                                    ? prev.visibleColumns.filter((column) => column !== key)
                                    : [...prev.visibleColumns, key];
                                  const dedupedVisible = nextVisibleColumns.filter(
                                    (column) => column !== prev.titleColumn
                                  );
                                  return {
                                    ...prev,
                                    visibleColumns: dedupedVisible
                                  };
                                });
                              }
                            }
                          }}
                        />
                      </section>

                      <ExpandedFieldsSection
                        title="Campos personalizados"
                        addLabel="Añadir campo"
                        emptyRowsLabel="No hay campos configurados."
                        clickForSettingsLabel="Click para ajustes"
                        dragToReorderLabel="Arrastrar para reordenar"
                        showAddButton={mode === "edit"}
                        onAddField={addCustomFieldToDraft}
                        rows={expandedEditorRows}
                        onReorderField={(fromFieldLabel, toFieldLabel) => {
                          if (mode !== "edit") return;
                          reorderVisibleColumn(fromFieldLabel, toFieldLabel);
                        }}
                      />
                    </>
                  )}

                  {mode === "edit" && !isLinkedMode ? (
                    <div className="card-gallery-editor-footer">
                      <button className="ghost" type="button" onClick={removeCurrent}>
                        Eliminar tarjeta
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body
          )}
        {fieldMenuOpen &&
          fieldMenuPos &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              className="column-menu open"
              ref={fieldMenuRef}
              style={{
                position: "fixed",
                top: `${fieldMenuPos.top}px`,
                left: `${fieldMenuPos.left}px`,
                zIndex: 50
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="column-menu-content">
                {fieldMenuView === "root" ? (
                  <div className="column-menu-list" role="menu">
                    <div
                      className="column-menu-item"
                      role="menuitem"
                      onClick={() => setFieldMenuView("type")}
                    >
                      <span className="column-menu-item-icon">{columnMenuIconChangeType}</span>
                      <span className="column-menu-item-label">Cambiar tipo</span>
                      <span className="column-menu-item-end">
                        <ColumnMenuChevronRight />
                      </span>
                    </div>
                    <div className="column-menu-separator" role="separator" />
                    <div
                      className="column-menu-item"
                      role="menuitem"
                      onClick={() => hideField(fieldMenuOpen)}
                    >
                      <span className="column-menu-item-icon">{columnMenuIconHide}</span>
                      <span className="column-menu-item-label">Ocultar</span>
                    </div>
                    <div
                      className="column-menu-item"
                      role="menuitem"
                      onClick={() => deleteField(fieldMenuOpen)}
                    >
                      <span className="column-menu-item-icon">{columnMenuIconTrash}</span>
                      <span className="column-menu-item-label">Eliminar</span>
                    </div>
                  </div>
                ) : (
                  <div className="column-menu-list" role="menu">
                    <div
                      className="column-menu-item"
                      role="menuitem"
                      onClick={() => setFieldMenuView("root")}
                    >
                      <span className="column-menu-back">←</span>
                      <span className="column-menu-item-label">Volver</span>
                    </div>
                    <div className="column-menu-separator" role="separator" />
                    <div
                      className="column-menu-item"
                      role="menuitem"
                      onClick={() => changeFieldType(fieldMenuOpen, "text")}
                    >
                      <span className="column-menu-item-icon">{columnMenuIconTypeText}</span>
                      <span className="column-menu-item-label">Texto</span>
                    </div>
                    <div
                      className="column-menu-item"
                      role="menuitem"
                      onClick={() => changeFieldType(fieldMenuOpen, "number")}
                    >
                      <span className="column-menu-item-icon">{columnMenuIconTypeNumber}</span>
                      <span className="column-menu-item-label">Número</span>
                    </div>
                    <div
                      className="column-menu-item"
                      role="menuitem"
                      onClick={() => changeFieldType(fieldMenuOpen, "date")}
                    >
                      <span className="column-menu-item-icon">{columnMenuIconTypeDate}</span>
                      <span className="column-menu-item-label">Fecha</span>
                    </div>
                    <div
                      className="column-menu-item"
                      role="menuitem"
                      onClick={() => changeFieldType(fieldMenuOpen, "checkbox")}
                    >
                      <span className="column-menu-item-icon">{columnMenuIconTypeCheckbox}</span>
                      <span className="column-menu-item-label">Checkbox</span>
                    </div>
                    <div
                      className="column-menu-item"
                      role="menuitem"
                      onClick={() => changeFieldType(fieldMenuOpen, "select")}
                    >
                      <span className="column-menu-item-icon">{columnMenuIconTypeSelect}</span>
                      <span className="column-menu-item-label">Select</span>
                    </div>
                    <div
                      className="column-menu-item"
                      role="menuitem"
                      onClick={() => changeFieldType(fieldMenuOpen, "rating")}
                    >
                      <span className="column-menu-item-icon">{columnMenuIconTypeRating}</span>
                      <span className="column-menu-item-label">Rating</span>
                    </div>
                    <div
                      className="column-menu-item"
                      role="menuitem"
                      onClick={() => changeFieldType(fieldMenuOpen, "contacts")}
                    >
                      <span className="column-menu-item-icon">{columnMenuIconTypeContacts}</span>
                      <span className="column-menu-item-label">Contactos</span>
                    </div>
                    <div
                      className="column-menu-item"
                      role="menuitem"
                      onClick={() => changeFieldType(fieldMenuOpen, "links")}
                    >
                      <span className="column-menu-item-icon">{columnMenuIconTypeLinks}</span>
                      <span className="column-menu-item-label">Enlaces</span>
                    </div>
                    <div
                      className="column-menu-item"
                      role="menuitem"
                      onClick={() => changeFieldType(fieldMenuOpen, "documents")}
                    >
                      <span className="column-menu-item-icon">{columnMenuIconTypeDocuments}</span>
                      <span className="column-menu-item-label">Documentos</span>
                    </div>
                    <div
                      className="column-menu-item"
                      role="menuitem"
                      onClick={() => changeFieldType(fieldMenuOpen, "todo")}
                    >
                      <span className="column-menu-item-icon">{columnMenuIconTypeTodo}</span>
                      <span className="column-menu-item-label">Todo</span>
                    </div>
                  </div>
                )}
              </div>
            </div>,
            document.body
          )}

        {showImageGalleryModal && createPortal(
          <div className="image-gallery-modal-overlay">
            <div className="image-gallery-modal">
              <div className="image-gallery-modal-header">
                <div className="image-gallery-modal-tabs">
                  <button
                    type="button"
                    className={`image-gallery-tab ${imageGalleryTab === "gallery" ? "active" : ""}`}
                    onClick={() => setImageGalleryTab("gallery")}
                  >
                    Galería
                  </button>
                  <button
                    type="button"
                    className={`image-gallery-tab ${imageGalleryTab === "recent" ? "active" : ""}`}
                    onClick={() => setImageGalleryTab("recent")}
                  >
                    Recientes
                  </button>
                  <button
                    type="button"
                    className={`image-gallery-tab ${imageGalleryTab === "upload" ? "active" : ""}`}
                    onClick={() => setImageGalleryTab("upload")}
                  >
                    Subir
                  </button>
                  <button
                    type="button"
                    className={`image-gallery-tab ${imageGalleryTab === "link" ? "active" : ""}`}
                    onClick={() => setImageGalleryTab("link")}
                  >
                    Enlace
                  </button>
                </div>
                <button
                  type="button"
                  className="image-gallery-close-button"
                  onClick={() => setShowImageGalleryModal(false)}
                  aria-label="Cerrar"
                >
                  ✕
                </button>
              </div>

              <div className="image-gallery-modal-content">
                {imageGalleryTab === "gallery" && !selectedAPIGallery && (
                  <div className="image-gallery-apis">
                    {API_GALLERIES
                      .filter((gallery) => {
                        const images = apiImages[gallery.id] || [];
                        return images.length > 0; // Solo mostrar galerías con imágenes
                      })
                      .map((gallery) => {
                      const images = apiImages[gallery.id] || [];
                      const isLoading = apiGalleryLoading[gallery.id];
                      const displayImages = images.slice(0, 15);
                      
                      return (
                        <div key={gallery.id} className="api-gallery-section">
                          <div className="api-gallery-header">
                            <span className="api-gallery-name">{gallery.name}</span>
                          </div>
                          <div className="api-gallery-grid">
                            {isLoading ? (
                              Array.from({ length: 15 }).map((_, i) => (
                                <div key={i} className="api-gallery-image-skeleton" />
                              ))
                            ) : (
                              <>
                                {displayImages.slice(0, 15).map((image, idx) => (
                                  <button
                                    key={image.id}
                                    type="button"
                                    className="api-gallery-image-button"
                                    onClick={() => {
                                      setDraftImageUrl(image.url);
                                      addToRecentImages(image.url, image.title, image.thumbnail);
                                      setShowImageGalleryModal(false);
                                    }}
                                    title={image.title}
                                  >
                                    <img
                                      src={image.thumbnail || image.url}
                                      alt={image.title}
                                      loading="lazy"
                                    />
                                  </button>
                                ))}
                                {displayImages.length >= 15 && (
                                  <button
                                    type="button"
                                    className="api-gallery-more-button"
                                    onClick={async () => {
                                      setSelectedAPIGallery(gallery.id);
                                      // Cargar más imágenes si solo tenemos 15
                                      if (images.length <= 15) {
                                        setApiGalleryLoading(prev => ({ ...prev, [gallery.id]: true }));
                                        try {
                                          const moreImages = await gallery.fetchImages(100);
                                          setApiImages(prev => ({ ...prev, [gallery.id]: moreImages }));
                                        } catch (error) {
                                          console.error(`Error cargando más imágenes de ${gallery.name}:`, error);
                                        } finally {
                                          setApiGalleryLoading(prev => ({ ...prev, [gallery.id]: false }));
                                        }
                                      }
                                    }}
                                  >
                                    <span className="api-gallery-more-dots">⋯</span>
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {imageGalleryTab === "gallery" && selectedAPIGallery && (
                  <div className="api-gallery-full-view">
                    <div className="api-gallery-full-header">
                      <button
                        type="button"
                        className="api-gallery-back-button"
                        onClick={() => {
                          setSelectedAPIGallery(null);
                          setApiFullGallerySearch("");
                        }}
                      >
                        ← Volver
                      </button>
                      <div className="api-gallery-full-search">
                        <input
                          type="text"
                          className="api-gallery-search-input"
                          placeholder="Buscar..."
                          value={apiFullGallerySearch}
                          onChange={(e) => setApiFullGallerySearch(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="api-gallery-full-grid">
                      {(apiImages[selectedAPIGallery] || [])
                        .filter((img) =>
                          !apiFullGallerySearch ||
                          img.title.toLowerCase().includes(apiFullGallerySearch.toLowerCase()) ||
                          img.author?.toLowerCase().includes(apiFullGallerySearch.toLowerCase())
                        )
                        .map((image) => (
                          <button
                            key={image.id}
                            type="button"
                            className="api-gallery-image-button"
                            onClick={() => {
                              setDraftImageUrl(image.url);
                              addToRecentImages(image.url, image.title, image.thumbnail);
                              setShowImageGalleryModal(false);
                              setSelectedAPIGallery(null);
                            }}
                            title={`${image.title}${image.author ? ` - ${image.author}` : ""}`}
                          >
                            <img
                              src={image.thumbnail || image.url}
                              alt={image.title}
                              loading="lazy"
                            />
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                {imageGalleryTab === "recent" && (
                  <div className="image-gallery-recent-tab">
                    {recentImages.length === 0 ? (
                      <div className="image-gallery-empty-state">
                        <div className="image-gallery-empty-icon">🕐</div>
                        <div className="image-gallery-empty-text">
                          No hay imágenes recientes
                        </div>
                        <div className="image-gallery-empty-hint">
                          Las imágenes que selecciones aparecerán aquí
                        </div>
                      </div>
                    ) : (
                      <div className="api-gallery-full-grid">
                        {recentImages.map((image) => (
                          <button
                            key={image.id}
                            type="button"
                            className="api-gallery-image-button"
                            onClick={() => {
                              setDraftImageUrl(image.url);
                              addToRecentImages(image.url, image.title, image.thumbnail);
                              setShowImageGalleryModal(false);
                            }}
                            title={image.title}
                          >
                            <img
                              src={image.thumbnail || image.url}
                              alt={image.title}
                              loading="lazy"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {imageGalleryTab === "upload" && (
                  <div className="image-gallery-upload-tab">
                    <label className="image-gallery-upload-area-large">
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = (event) => {
                              const url = event.target?.result as string;
                              setDraftImageUrl(url);
                              addToRecentImages(url, file.name);
                              setShowImageGalleryModal(false);
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                      <div className="image-gallery-upload-icon-large">📁</div>
                      <div className="image-gallery-upload-text-large">
                        <div className="image-gallery-upload-title">Subir archivo</div>
                        <div className="image-gallery-upload-subtitle">
                          Arrastra una imagen aquí o haz clic para seleccionar
                        </div>
                      </div>
                    </label>
                  </div>
                )}

                {imageGalleryTab === "link" && (
                  <div className="image-gallery-link-tab">
                    <div className="image-gallery-link-content">
                      <div className="image-gallery-link-title">Enlace de imagen</div>
                      <input
                        type="url"
                        className="image-gallery-link-input"
                        placeholder="Pega el enlace de la imagen..."
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const url = e.currentTarget.value.trim();
                            if (url) {
                              setDraftImageUrl(url);
                              addToRecentImages(url);
                              setShowImageGalleryModal(false);
                            }
                          }
                        }}
                      />
                      {tableSnapshot && (
                        <>
                          <div className="image-gallery-link-divider">O</div>
                          <div className="image-gallery-link-title">Desde columna</div>
                          <select
                            className="image-gallery-link-select"
                            value=""
                            onChange={(e) => {
                              if (e.target.value && activeSourceRowIndex !== null) {
                                const colIndex = tableSnapshot.columns.indexOf(e.target.value);
                                if (colIndex >= 0) {
                                  const row = tableSnapshot.rows[activeSourceRowIndex];
                                  if (row && row[colIndex]) {
                                    const url = row[colIndex];
                                    setDraftImageUrl(url);
                                    addToRecentImages(url);
                                    setShowImageGalleryModal(false);
                                  }
                                }
                              }
                            }}
                          >
                            <option value="">Seleccionar columna...</option>
                            {tableSnapshot.columns.map((col) => (
                              <option key={col} value={col}>{col}</option>
                            ))}
                          </select>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
      </BlockPanel>
    );
  }
};
