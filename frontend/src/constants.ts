export const TODO_STATUSES = ["Not started", "In progress", "Done"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export const TODO_STATUS_CLASS: Record<TodoStatus, string> = {
  "Not started": "not-started",
  "In progress": "in-progress",
  Done: "done"
};

export const TODO_STATUS_PILL_COLORS: Record<TodoStatus, string> = {
  "Not started": "#CBD5E1",
  "In progress": "#FDE68A",
  Done: "#86EFAC"
};

export const normalizeTodoStatus = (status?: string): TodoStatus => {
  if (status === "In progress" || status === "Done") {
    return status;
  }
  return "Not started";
};
