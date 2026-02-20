/**
 * Canonical tracker column metadata.
 *
 * This is the **single source of truth** for column order, labels, types and
 * default widths used across TrackerPage, PipelinePage and every page-builder
 * block that operates on tracker data (todoTableBlock, kpiBlock, pipelineBlock,
 * chartBlock).
 *
 * Previously each consumer carried its own copy — this module eliminates that
 * duplication.
 */

import { type EditableTableColumnKind } from "../components/pageBuilder/types";

/* ---------- column order ---------- */

export const TRACKER_BASE_COLUMN_ORDER = [
  "company_name",
  "position",
  "job_type",
  "location",
  "stage",
  "outcome",
  "application_date",
  "interview_datetime",
  "followup_date",
  "interview_rounds",
  "interview_type",
  "interviewers",
  "company_score",
  "contacts",
  "last_round_cleared",
  "total_rounds",
  "my_interview_score",
  "improvement_areas",
  "skill_to_upgrade",
  "job_description",
  "notes",
  "todo_items",
  "documents_links",
  "favorite"
] as const;

/* ---------- human-readable labels ---------- */

export const TRACKER_COLUMN_LABELS: Record<string, string> = {
  company_name: "Company",
  position: "Position",
  job_type: "Job Type",
  location: "Location",
  stage: "Stage",
  outcome: "Outcome",
  application_date: "Application Date",
  interview_datetime: "Interview",
  followup_date: "Follow-Up",
  interview_rounds: "Interview Rounds",
  interview_type: "Interview Type",
  interviewers: "Interviewers",
  company_score: "Company Score",
  contacts: "Contacts",
  last_round_cleared: "Last Round Cleared",
  total_rounds: "Total Rounds",
  my_interview_score: "Interview Score",
  improvement_areas: "Improvement Areas",
  skill_to_upgrade: "Skill To Upgrade",
  job_description: "Job Description",
  notes: "Notes",
  todo_items: "To-Do Items",
  documents_links: "Documents / Links",
  favorite: "Favorite"
};

/* ---------- column kinds (page-builder granular type) ---------- */

export const TRACKER_COLUMN_KINDS: Record<string, EditableTableColumnKind> = {
  company_name: "text",
  position: "text",
  job_type: "select",
  location: "text",
  stage: "select",
  outcome: "select",
  application_date: "date",
  interview_datetime: "date",
  followup_date: "date",
  interview_rounds: "number",
  interview_type: "text",
  interviewers: "text",
  company_score: "rating",
  contacts: "contacts",
  last_round_cleared: "text",
  total_rounds: "number",
  my_interview_score: "rating",
  improvement_areas: "text",
  skill_to_upgrade: "text",
  job_description: "text",
  notes: "text",
  todo_items: "todo",
  documents_links: "documents",
  favorite: "checkbox"
};

/* ---------- column types (UI display strings, used by TrackerPage) ---------- */

export const TRACKER_COLUMN_TYPES: Record<string, string> = {
  company_name: "Text",
  position: "Text",
  job_type: "Select",
  location: "Text",
  stage: "Select",
  outcome: "Select",
  application_date: "Date",
  interview_datetime: "Date & Time",
  followup_date: "Date",
  interview_rounds: "Number",
  interview_type: "Text",
  interviewers: "Text",
  company_score: "Rating",
  contacts: "Contacts",
  last_round_cleared: "Text",
  total_rounds: "Number",
  my_interview_score: "Rating",
  improvement_areas: "Long Text",
  skill_to_upgrade: "Long Text",
  job_description: "Long Text",
  notes: "Long Text",
  todo_items: "To-Do Items",
  documents_links: "Text",
  favorite: "Checkbox"
};

/* ---------- default column widths (px) ---------- */

export const TRACKER_DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
  company_name: 200,
  position: 190,
  job_type: 150,
  location: 160,
  stage: 140,
  outcome: 140,
  application_date: 160,
  interview_datetime: 180,
  followup_date: 160,
  interview_rounds: 150,
  interview_type: 160,
  interviewers: 200,
  company_score: 160,
  contacts: 260,
  last_round_cleared: 170,
  total_rounds: 150,
  my_interview_score: 150,
  improvement_areas: 220,
  skill_to_upgrade: 220,
  job_description: 240,
  notes: 240,
  todo_items: 300,
  documents_links: 220,
  favorite: 100
};

export const DEFAULT_COLUMN_WIDTH = 160;
