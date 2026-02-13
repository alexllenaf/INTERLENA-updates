export type CustomPropertyOption = {
  label: string;
  color?: string;
};

export type CustomProperty = {
  key: string;
  name: string;
  type: "select" | "text" | "number" | "date" | "checkbox" | "rating" | "contacts" | "links" | "documents";
  options: CustomPropertyOption[];
};

export type BrandProfile = {
  name: string;
  role: string;
  avatarSrc: string;
  avatarAlt: string;
};

export type Settings = {
  stages: string[];
  outcomes: string[];
  job_types: string[];
  stage_colors: Record<string, string>;
  outcome_colors: Record<string, string>;
  job_type_colors?: Record<string, string>;
  score_scale: { min: number; max: number };
  table_columns: string[];
  hidden_columns: string[];
  column_widths?: Record<string, number>;
  column_labels?: Record<string, string>;
  table_density?: "compact" | "comfortable";
  dark_mode: boolean;
  custom_properties: CustomProperty[];
  brand_profile?: BrandProfile;
};

export type UpdateInfo = {
  current_version: string;
  latest_version?: string | null;
  update_available: boolean;
  url?: string | null;
  notes?: string | null;
  checked_at?: string | null;
  error?: string | null;
};

export type DocumentFile = {
  id: string;
  name: string;
  size?: number;
  content_type?: string;
  uploaded_at?: string;
};

export type Contact = {
  id: string;
  name: string;
  information?: string;
  email?: string;
  phone?: string;
};

export type TodoItem = {
  id: string;
  task: string;
  due_date?: string;
  status?: string;
  task_location?: string;
  notes?: string;
  documents_links?: string;
};

export type Application = {
  id: number;
  application_id: string;
  company_name: string;
  position: string;
  job_type: string;
  stage: string;
  outcome: string;
  pipeline_order?: number | null;
  location?: string | null;
  application_date?: string | null;
  interview_datetime?: string | null;
  followup_date?: string | null;
  interview_rounds?: number | null;
  interview_type?: string | null;
  interviewers?: string | null;
  company_score?: number | null;
  last_round_cleared?: string | null;
  total_rounds?: number | null;
  my_interview_score?: number | null;
  improvement_areas?: string | null;
  skill_to_upgrade?: string | null;
  job_description?: string | null;
  notes?: string | null;
  todo_items?: TodoItem[];
  documents_links?: string | null;
  documents_files?: DocumentFile[];
  contacts?: Contact[];
  favorite: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  last_viewed?: string | null;
  created_by?: string | null;
  properties: Record<string, string>;
};

export type ApplicationInput = Partial<Application> & {
  company_name: string;
  position: string;
  job_type: string;
  stage: string;
  outcome: string;
};

export type View = {
  view_id: string;
  name: string;
  view_type: string;
  config: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
};
