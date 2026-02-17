import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Locale = "en" | "es";

type Vars = Record<string, string | number | null | undefined>;

type I18nContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (message: string, vars?: Vars) => string;
};

const STORAGE_KEY = "app_locale_v1";

const ES: Record<string, string> = {
  "Dashboard": "Dashboard",
  "Tracker Table": "Tabla Tracker",
  "Pipeline": "Pipeline",
  "Calendar": "Calendario",
  "Settings": "Ajustes",
  "Local-first · SQLite/Postgres": "Local-first · SQLite/Postgres",
  "Personal Interview & Application Tracker": "Tracker de entrevistas y candidaturas",
  "Offline-first workspace for your job search pipeline.": "Espacio de trabajo offline-first para tu proceso de busqueda de empleo.",
  "Loading...": "Cargando...",
  "Ready": "Listo",
  "New version {version} available.": "Nueva version {version} disponible.",
  "Download the latest build to update.": "Descarga la ultima version para actualizar.",
  "Updating...": "Actualizando...",
  "Download update": "Descargar actualizacion",
  "Loading page...": "Cargando pagina...",

  "Change photo": "Cambiar foto",
  "Upload photo": "Subir foto",
  "Take photo": "Tomar foto",
  "Edit name": "Editar nombre",
  "Edit role": "Editar posicion",
  "Close": "Cerrar",
  "Cancel": "Cancelar",
  "Capture": "Capturar",
  "Your browser cannot open the camera. Use Upload photo.": "Tu navegador no permite abrir la camara. Usa Subir foto.",
  "Camera is not ready yet.": "La camara aun no esta lista.",
  "Could not access the camera. Use Upload photo.": "No se pudo acceder a la camara. Usa Subir foto.",
  "Use the camera to update your profile photo.": "Usa la camara para actualizar tu foto de perfil.",

  "Language": "Idioma",
  "Change the app language.": "Cambia el idioma de la app.",
  "App language": "Idioma de la app",
  "English": "Ingles",
  "Spanish": "Castellano",

  "Storage & Backups": "Almacenamiento y copias de seguridad",
  "Data is stored in the system app data directory, not inside the app bundle.": "Los datos se guardan en la carpeta de datos del sistema, no dentro del paquete de la app.",
  "Data folder": "Carpeta de datos",
  "Database": "Base de datos",
  "Uploads": "Subidas",
  "Backups": "Copias de seguridad",
  "State": "Estado",
  "Storage info unavailable.": "Informacion de almacenamiento no disponible.",
  "Download backup (.zip)": "Descargar copia (.zip)",

  "Block style": "Estilo del bloque",
  "Texture": "Textura",
  "Flat": "Plana",
  "Glass": "Cristal",
  "Color": "Color",
  "Custom": "Personalizado",
  "Reset": "Restablecer",
  "Block settings": "Ajustes del bloque",

  "Upload documents": "Subir documentos",
  "Drag documents or click to browse Finder": "Arrastra documentos o haz clic para buscar en Finder",
  "PDF, DOCX, PNG, etc.": "PDF, DOCX, PNG, etc.",

  "No contacts yet.": "Aun no hay contactos.",
  "Remove contact": "Eliminar contacto",
  "Name": "Nombre",
  "Information": "Informacion",
  "Email": "Email",
  "Phone": "Telefono",
  "Add contact": "Anadir contacto",

  "Could not auto-install.": "No se pudo instalar automaticamente.",
  "You're already on the latest version.": "Ya estas en la ultima version.",
  "{message} Opening the package...": "{message} Abriendo el paquete...",

  "Total Applications": "Total de aplicaciones",
  "Total Offers": "Total de ofertas",
  "Total Rejections": "Total de rechazos",
  "Active Processes": "Procesos activos",
  "Favorites": "Favoritos",
  "Offer Success Rate": "Tasa de exito (Ofertas)",
  "Avg Score (Offers)": "Puntuacion media (Ofertas)",
  "N/A": "N/D",
  "Expand {title}": "Expandir {title}",

  "Outcomes Distribution": "Distribucion de resultados",
  "Applications per Stage": "Aplicaciones por etapa",
  "Timeline Applications": "Evolucion de aplicaciones",
  "Score Distribution": "Distribucion de puntuaciones",

  "Event Alerts": "Alertas",
  "Upcoming or overdue follow-ups and to-do items.": "Seguimientos y tareas proximas o vencidas.",
  "No event alerts.": "No hay alertas.",
  "Type": "Tipo",
  "Company": "Empresa",
  "Detail": "Detalle",
  "Date": "Fecha",
  "Status": "Estado",
  "Applications currently in progress.": "Aplicaciones actualmente en curso.",
  "No active processes.": "No hay procesos activos.",
  "Loading settings...": "Cargando ajustes...",

  "Analytics": "Analiticas",
  "Break down outcomes, stages, and score distribution.": "Analiza resultados, etapas y distribucion de puntuaciones.",
  "Outcomes": "Resultados",
  "Stages": "Etapas",

  "Drag or push opportunities across stages as you progress.": "Arrastra o mueve oportunidades entre etapas a medida que avanzas.",
  "No items": "No hay elementos",
  "Score": "Puntuacion",
  "Follow-up overdue": "Seguimiento vencido",
  "Follow-up soon": "Seguimiento pronto",

  "Track interviews and follow-ups with a consolidated event list.": "Sigue entrevistas y seguimientos con una lista consolidada.",
  "Calendar Alerts": "Alertas del calendario",
  "{count} events scheduled this month.": "{count} eventos programados este mes.",
  "Download All (ICS)": "Descargar todo (ICS)",
  "Download Selected": "Descargar seleccion",
  "Previous": "Anterior",
  "Today": "Hoy",
  "Next": "Siguiente",
  "+{count} more": "+{count} mas",
  "No events scheduled.": "No hay eventos programados.",
  "To-Do List": "Lista de tareas",
  "Manage preparation tasks linked to each application.": "Gestiona tareas de preparacion vinculadas a cada aplicacion.",
  "Create an application to start a to-do list.": "Crea una aplicacion para empezar una lista de tareas.",
  "{count} pending": "{count} pendientes",
  "Application": "Aplicacion",
  "All applications": "Todas las aplicaciones",
  "Add To-Do": "Anadir tarea",
  "No applications yet. Add one to start tracking tasks.": "Aun no hay aplicaciones. Anade una para empezar.",
  "No to-do items for this application.": "No hay tareas para esta aplicacion.",
  "No to-do items yet.": "Aun no hay tareas.",
  "Task Location": "Ubicacion de tarea",
  "Links": "Enlaces",
  "Document {name}": "Documento {name}",
  "Details": "Detalles",
  "Download": "Descargar",
  "Edit": "Editar",
  "Delete": "Eliminar",
  "All-day": "Todo el dia",
  "Meeting room, HQ, remote...": "Sala, oficina, remoto...",
  "No documents uploaded.": "No hay documentos subidos.",
  "Save": "Guardar",
  "Save changes": "Guardar cambios",
  "Document": "Documento",
  "Added": "Anadido",
  "Size": "Tamano",
  "To-Do": "Tarea",

  "Edit Application": "Editar aplicacion",
  "New Application": "Nueva aplicacion",
  "Capture each touchpoint and keep your pipeline accurate.": "Registra cada punto de contacto y manten tu pipeline actualizado.",
  "Company Name": "Nombre de empresa",
  "Position": "Puesto",
  "Job Type": "Tipo de puesto",
  "Stage": "Etapa",
  "Outcome": "Resultado",
  "Location": "Ubicacion",
  "Remote, City, Country": "Remoto, ciudad, pais",
  "Application Date": "Fecha de aplicacion",
  "Interview Date & Time": "Fecha y hora de entrevista",
  "Follow-Up Date": "Fecha de seguimiento",
  "Interview Rounds": "Rondas de entrevista",
  "Total Rounds": "Rondas totales",
  "My Interview Score": "Mi puntuacion de entrevista",
  "Company Score": "Puntuacion de empresa",
  "Interview Type": "Tipo de entrevista",
  "Interviewers": "Entrevistadores",
  "Last Round Cleared": "Ultima ronda superada",
  "Improvement Areas": "Areas de mejora",
  "Skill to Upgrade": "Habilidad a mejorar",
  "Job Description": "Descripcion del puesto",
  "Notes": "Notas",
  "Documents / Links": "Documentos / Enlaces",
  "Attach resumes, portfolios, or offer letters.": "Adjunta CVs, portfolios o cartas de oferta.",
  "Remove": "Quitar",
  "To-Do Items": "Tareas",
  "Track preparation tasks for this application.": "Sigue tareas de preparacion para esta aplicacion.",
  "Task": "Tarea",
  "Due Date": "Fecha limite",
  "Actions": "Acciones",
  "New task": "Nueva tarea",
  "Add": "Anadir",
  "Custom Properties": "Propiedades personalizadas",
  "Select": "Seleccionar",
  "Favorite": "Favorito",
  "Save Changes": "Guardar cambios",
  "Create Application": "Crear aplicacion",

  "Search, edit, and manage every application.": "Busca, edita y gestiona todas las aplicaciones.",
  "Density": "Densidad",
  "Comfortable": "Comoda",
  "Compact": "Compacta",
  "Search": "Buscar",
  "Filter": "Filtrar",
  "Clear search": "Limpiar busqueda",
  "Company, role, location...": "Empresa, puesto, ubicacion...",
  "All": "Todos",
  "Columns": "Columnas",
  "Choose which columns are visible in the table.": "Elige que columnas son visibles en la tabla.",
  "Hide columns": "Ocultar columnas",
  "Show columns": "Mostrar columnas",
  "Show all": "Mostrar todo",
  "Save columns": "Guardar columnas",
  "Export All": "Exportar todo",
  "Export Favorites": "Exportar favoritos",
  "Export Active": "Exportar activos",
  "{count} selected": "{count} seleccionadas",
  "Set stage...": "Asignar etapa...",
  "Set outcome...": "Asignar resultado...",
  "Export Selected": "Exportar seleccion",
  "Delete Selected": "Eliminar seleccionadas"
};

const interpolate = (template: string, vars?: Vars) => {
  if (!vars) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
    const value = vars[key];
    return value === null || value === undefined ? "" : String(value);
  });
};

const readStoredLocale = (): Locale | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "en" || raw === "es") return raw;
  } catch {
    // ignore
  }
  return null;
};

const guessLocale = (): Locale => {
  if (typeof navigator === "undefined") return "en";
  const lang = navigator.language || "";
  if (lang.toLowerCase().startsWith("es")) return "es";
  return "en";
};

const I18nContext = createContext<I18nContextValue | null>(null);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale() ?? guessLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback(
    (message: string, vars?: Vars) => {
      const template = locale === "es" ? ES[message] ?? message : message;
      return interpolate(template, vars);
    },
    [locale]
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within LanguageProvider");
  }
  return ctx;
};
