export interface Settings {
  /** Folder holding tasks.md, tasks-archive.md and history/. */
  folder: string;
  /** Events kept on an item after a sweep. */
  keepEvents: number;
  /** Below this age an item is hot. */
  hotMs: number;
  /** Below this age an item is warm, beyond it cold. */
  warmMs: number;
  /** Statuses that stop an item counting toward heat, compared case-insensitively. */
  terminalStatuses: string[];
  /** Copy tasks.md into history/ once per day on first save. */
  snapshots: boolean;
}

export const HOUR_MS = 60 * 60 * 1000;

export const DEFAULT_SETTINGS: Settings = {
  folder: "",
  keepEvents: 3,
  hotMs: 24 * HOUR_MS,
  warmMs: 72 * HOUR_MS,
  terminalStatuses: ["Released", "Rejected", "Deleted", "Cancelled"],
  snapshots: true
};

export const TASKS_FILE = "tasks.md";
export const ARCHIVE_FILE = "tasks-archive.md";
export const HISTORY_DIR = "history";

export function withDefaults(partial: Partial<Settings> | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...(partial ?? {}) };
}
