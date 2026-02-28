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

export type PipelineCardConfig = {
  pipeline_field?: string;
  title_column?: string;
  visible_fields?: string[];
};

export type ImapEmailSyncSettings = {
  host: string;
  port: number;
  username: string;
  password: string;
  use_ssl: boolean;
  folder: string;
};

export type EmailSyncSettings = {
  provider: "none" | "imap" | "oauth_google" | "oauth_microsoft";
  read_enabled?: boolean;
  imap: ImapEmailSyncSettings;
  oauth?: {
    providers?: Record<
      string,
      {
        client_id?: string;
        client_secret?: string;
        redirect_uri?: string;
        tenant_id?: string;
        access_token?: string;
        refresh_token?: string;
        token_type?: string;
        scope?: string;
        expires_at?: string;
      }
    >;
  };
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
  pipeline_card_config?: PipelineCardConfig;
  brand_profile?: BrandProfile;
  page_configs?: Record<string, unknown>;
  email_sync?: EmailSyncSettings;
};

export type CanonicalPage = {
  id: string;
  title: string;
  icon?: string | null;
  cover?: string | null;
  legacy_key?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type CanonicalBlock = {
  id: string;
  type: string;
  parent_id?: string | null;
  position?: string | null;
  layout: Record<string, unknown>;
  props: Record<string, unknown>;
  content?: unknown;
};

export type PageResolveResult = {
  page: CanonicalPage;
};

export type PageBlocksResult = {
  page_id: string;
  blocks: CanonicalBlock[];
};

export type CanonicalDatabase = {
  id: string;
  name: string;
  properties: number;
  views: number;
  created_at?: string | null;
  updated_at?: string | null;
};

export type DatabaseRecordsResult = {
  database: {
    id: string;
    name: string;
    created_at?: string | null;
    updated_at?: string | null;
  };
  view?: {
    id: string;
    name: string;
    type: string;
    config: Record<string, unknown>;
  } | null;
  properties: Array<{
    id: string;
    name: string;
    type: string;
    config: Record<string, unknown>;
    property_order: number;
  }>;
  records: Array<{
    id: string;
    database_id: string;
    page_id: string;
    page_title?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    properties: Record<string, unknown>;
  }>;
};

export type CanonicalDatabaseDetail = {
  database: {
    id: string;
    name: string;
    created_at?: string | null;
    updated_at?: string | null;
  };
  properties: Array<{
    id: string;
    name: string;
    type: string;
    config: Record<string, unknown>;
    property_order: number;
  }>;
  views: Array<{
    id: string;
    database_id: string;
    name: string;
    type: string;
    config: Record<string, unknown>;
    created_at?: string | null;
    updated_at?: string | null;
  }>;
};

export type CanonicalDatabaseRecord = {
  id: string;
  database_id: string;
  page_id: string;
  page_title?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  properties: Record<string, unknown>;
};

export type OnboardingStatus = {
  completed: boolean;
};

export type OnboardingTemplate = {
  id: string;
  name: string;
  description: string;
  version: string;
};

export type OnboardingCompleteInput = {
  template_id: string;
  workspace_name?: string;
};

export type OnboardingCompleteResult = {
  completed: boolean;
  home_page_id: string;
  seed_version: string;
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
  first_name?: string;
  last_name?: string;
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
  database_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type EmailMetadata = {
  message_id: string;
  contact_id: string;
  from_address: string;
  to_address: string;
  subject: string;
  date: string;
  is_read: boolean;
  folder: string;
  body_cached: boolean;
};

export type EmailMetadataInput = {
  message_id: string;
  from_address: string;
  to_address: string;
  subject: string;
  date: string;
  is_read: boolean;
  folder?: string;
};

export type EmailMetadataSyncResult = {
  contact_id: string;
  folder: string;
  cutoff_date?: string | null;
  last_synced_at?: string | null;
  inserted: number;
  skipped_existing: number;
  skipped_out_of_window: number;
};

export type EmailBodyResult = {
  message_id: string;
  body: string;
  cached: boolean;
};

export type EmailConnectionTestInput = {
  provider: "none" | "imap" | "oauth_google" | "oauth_microsoft";
  imap?: {
    host: string;
    port: number;
    username: string;
    password: string;
    use_ssl: boolean;
    folder?: string;
  };
};

export type EmailOAuthStartInput = {
  provider: "oauth_google" | "oauth_microsoft";
  client_id: string;
  client_secret: string;
  redirect_uri?: string;
  tenant_id?: string;
  scope?: string;
};

export type EmailOAuthStartResult = {
  ok: boolean;
  provider: string;
  message: string;
  state: string;
  auth_url: string;
};

export type EmailConnectionTestResult = {
  ok: boolean;
  provider: string;
  message: string;
};

export type EmailFoldersListResult = {
  ok: boolean;
  provider: string;
  message: string;
  folders: string[];
};

export type EmailSendContact = {
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  company: string;
  custom_fields: Record<string, string>;
};

export type EmailSendStats = {
  connected?: boolean;
  sent_by: string;
  sent_today: number;
  remaining_today: number;
  daily_limit: number;
  warning?: string | null;
};

export type EmailReadStats = {
  connected?: boolean;
  provider: string;
  account_id: string;
  downloaded_today_bytes: number;
  remaining_today_bytes: number;
  daily_limit_bytes: number;
  used_percent: number;
  tracked_by_app: boolean;
  warning?: string | null;
  limit_label?: string | null;
};

export type GoogleAccount = {
  email: string;
  active: boolean;
};

export type EmailSendResultItem = {
  email: string;
  name: string;
  status: string;
  message: string;
  provider_message_id?: string | null;
};

export type EmailSendBatchResult = {
  ok: boolean;
  batch_id: string;
  sent_by: string;
  total: number;
  sent: number;
  errors: number;
  warning?: string | null;
  daily_limit: number;
  sent_today: number;
  remaining_today: number;
  results: EmailSendResultItem[];
};
