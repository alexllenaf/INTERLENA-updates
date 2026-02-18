export type TableColumnSchema = {
  key: string;
  label: string;
  typeRef: string;
  width?: number;
  defaultValue?: string;
  config?: Record<string, unknown>;
};

export type TableSchema = {
  ref: string;
  columns: TableColumnSchema[];
};

type TableSchemaContext = {
  settings: unknown;
};

const TRACKER_APPLICATION_COLUMNS: TableColumnSchema[] = [
  { key: "company_name", label: "Company", typeRef: "text.basic@1", width: 200 },
  { key: "position", label: "Position", typeRef: "text.basic@1", width: 190 },
  { key: "job_type", label: "Job Type", typeRef: "select.settings.job_types@1", width: 150 },
  { key: "location", label: "Location", typeRef: "text.basic@1", width: 160 },
  { key: "stage", label: "Stage", typeRef: "select.settings.stages@1", width: 140 },
  { key: "outcome", label: "Outcome", typeRef: "select.settings.outcomes@1", width: 140 },
  { key: "application_date", label: "Application Date", typeRef: "date.iso@1", width: 160 },
  { key: "interview_datetime", label: "Interview", typeRef: "datetime.iso@1", width: 180 },
  { key: "followup_date", label: "Follow-Up", typeRef: "date.iso@1", width: 160 },
  { key: "interview_rounds", label: "Interview Rounds", typeRef: "number.basic@1", width: 150 },
  { key: "interview_type", label: "Interview Type", typeRef: "text.basic@1", width: 160 },
  { key: "interviewers", label: "Interviewers", typeRef: "text.basic@1", width: 200 },
  { key: "company_score", label: "Company Score", typeRef: "rating.stars_0_5_half@1", width: 160 },
  { key: "contacts", label: "Contacts", typeRef: "contacts.list@1", width: 260 },
  { key: "last_round_cleared", label: "Last Round Cleared", typeRef: "text.basic@1", width: 170 },
  { key: "total_rounds", label: "Total Rounds", typeRef: "number.basic@1", width: 150 },
  { key: "my_interview_score", label: "Interview Score", typeRef: "rating.stars_0_5_half@1", width: 150 },
  { key: "improvement_areas", label: "Improvement Areas", typeRef: "text.basic@1", width: 220 },
  { key: "skill_to_upgrade", label: "Skill To Upgrade", typeRef: "text.basic@1", width: 220 },
  { key: "job_description", label: "Job Description", typeRef: "text.basic@1", width: 240 },
  { key: "notes", label: "Notes", typeRef: "text.basic@1", width: 240 },
  { key: "todo_items", label: "To-Do Items", typeRef: "todo.items@1", width: 280 },
  { key: "documents_links", label: "Documents / Links", typeRef: "documents.list@1", width: 220 },
  { key: "favorite", label: "Favorite", typeRef: "checkbox.bool@1", width: 100 }
];

const TABLE_SCHEMA_REGISTRY: Record<string, (ctx: TableSchemaContext) => TableSchema> = {
  "tracker.applications@1": (_ctx: TableSchemaContext) => ({
    ref: "tracker.applications@1",
    columns: TRACKER_APPLICATION_COLUMNS
  })
};

export function getTableSchema(schemaRef: string, ctx: { settings: unknown }): TableSchema {
  const resolver = TABLE_SCHEMA_REGISTRY[schemaRef];
  if (!resolver) {
    return {
      ref: schemaRef,
      columns: []
    };
  }
  return resolver(ctx);
}
