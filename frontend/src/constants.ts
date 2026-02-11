export const TODO_STATUSES = ["Not started", "In progress", "Done"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export const TODO_STATUS_CLASS: Record<TodoStatus, string> = {
  "Not started": "not-started",
  "In progress": "in-progress",
  Done: "done"
};

export const normalizeTodoStatus = (status?: string): TodoStatus => {
  if (status === "In progress" || status === "Done") {
    return status;
  }
  return "Not started";
};
