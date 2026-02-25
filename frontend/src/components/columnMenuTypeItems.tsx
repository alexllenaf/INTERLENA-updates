import React from "react";
import {
  columnMenuIconTypeCheckbox,
  columnMenuIconTypeContacts,
  columnMenuIconTypeDate,
  columnMenuIconTypeDocuments,
  columnMenuIconTypeLinks,
  columnMenuIconTypeNumber,
  columnMenuIconTypeRating,
  columnMenuIconTypeSelect,
  columnMenuIconTypeText
} from "./columnMenuIcons";
import { type CustomProperty } from "../types";

export type CustomPropertyTypeMenuItem = {
  kind: CustomProperty["type"];
  label: string;
  icon: React.ReactNode;
};

export const CUSTOM_PROPERTY_TYPE_MENU_ITEMS: CustomPropertyTypeMenuItem[] = [
  { kind: "text", label: "Texto", icon: columnMenuIconTypeText },
  { kind: "number", label: "Número", icon: columnMenuIconTypeNumber },
  { kind: "date", label: "Fecha", icon: columnMenuIconTypeDate },
  { kind: "checkbox", label: "Checkbox", icon: columnMenuIconTypeCheckbox },
  { kind: "select", label: "Select", icon: columnMenuIconTypeSelect },
  { kind: "rating", label: "Rating", icon: columnMenuIconTypeRating },
  { kind: "contacts", label: "Contactos", icon: columnMenuIconTypeContacts },
  { kind: "links", label: "Enlaces", icon: columnMenuIconTypeLinks },
  { kind: "documents", label: "Documentos", icon: columnMenuIconTypeDocuments }
];
