import type { Document } from "./model.js";
import { timestampFromDate } from "./model.js";
import { parse } from "./parse.js";
import { serialize } from "./serialize.js";
import { ensureIds, rename as renameNode } from "./ops.js";
import { renameInArchive, sweep as sweepDoc } from "./archive.js";
import type { SweepResult } from "./archive.js";
import { history as historyOf } from "./history.js";
import type { HistoryEvent } from "./history.js";
import type { Settings } from "./settings.js";
import { ARCHIVE_FILE, HISTORY_DIR, TASKS_FILE } from "./settings.js";

/** The few file operations the store needs, so a frontend can supply its own (an Obsidian vault adapter, a mock). */
export interface FileSystem {
  read(path: string): Promise<string | undefined>;
  write(path: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  /** Last modification time in milliseconds, or undefined when the file is missing. */
  mtime(path: string): Promise<number | undefined>;
}

export type ChangeSource = "save" | "disk";
export type ChangeListener = (doc: Document, source: ChangeSource) => void;

function joinPath(folder: string, name: string): string {
  if (folder === "") return name;
  const sep = folder.includes("\\") && !folder.includes("/") ? "\\" : "/";
  return folder.endsWith(sep) ? folder + name : folder + sep + name;
}

export class Store {
  doc: Document;
  archiveText: string;
  readonly settings: Settings;
  private readonly fs: FileSystem;
  private readonly clock: () => Date;
  private listeners = new Set<ChangeListener>();
  private lastWritten: string;
  private lastMtime: number | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  private constructor(settings: Settings, fs: FileSystem, clock: () => Date, doc: Document, archiveText: string, text: string, mtime: number | undefined) {
    this.settings = settings;
    this.fs = fs;
    this.clock = clock;
    this.doc = doc;
    this.archiveText = archiveText;
    this.lastWritten = text;
    this.lastMtime = mtime;
  }

  static async open(settings: Settings, fs: FileSystem, clock: () => Date = () => new Date()): Promise<Store> {
    const tasksPath = joinPath(settings.folder, TASKS_FILE);
    const text = (await fs.read(tasksPath)) ?? "";
    const archiveText = (await fs.read(joinPath(settings.folder, ARCHIVE_FILE))) ?? "";
    const today = timestampFromDate(clock(), false).date;
    const doc = parse(text, { today });
    const mtime = await fs.mtime(tasksPath);
    return new Store(settings, fs, clock, doc, archiveText, text, mtime);
  }

  get tasksPath(): string {
    return joinPath(this.settings.folder, TASKS_FILE);
  }

  get archivePath(): string {
    return joinPath(this.settings.folder, ARCHIVE_FILE);
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(source: ChangeSource): void {
    for (const l of this.listeners) l(this.doc, source);
  }

  /** Writes tasks.md. Assigns missing IDs first and takes the daily snapshot when enabled. */
  async save(): Promise<void> {
    ensureIds(this.doc);
    const text = serialize(this.doc);
    if (this.settings.snapshots) await this.snapshot();
    if (text !== this.lastWritten || !(await this.fs.exists(this.tasksPath))) {
      await this.fs.write(this.tasksPath, text);
      this.lastWritten = text;
      this.lastMtime = await this.fs.mtime(this.tasksPath);
    }
    this.emit("save");
  }

  /** Copies the file as it was before today's first save into history/. */
  private async snapshot(): Promise<void> {
    const date = timestampFromDate(this.clock(), false).date;
    const dir = joinPath(this.settings.folder, HISTORY_DIR);
    const path = joinPath(dir, `tasks-${date}.md`);
    if (await this.fs.exists(path)) return;
    const current = await this.fs.read(this.tasksPath);
    if (current === undefined) return;
    await this.fs.mkdir(dir);
    await this.fs.write(path, current);
  }

  /** Re-reads tasks.md if something else changed it. Returns true when the model was replaced. */
  async reloadIfChanged(): Promise<boolean> {
    const mtime = await this.fs.mtime(this.tasksPath);
    if (mtime === this.lastMtime) return false;
    const text = await this.fs.read(this.tasksPath);
    this.lastMtime = mtime;
    if (text === undefined || text === this.lastWritten) return false;
    const today = timestampFromDate(this.clock(), false).date;
    this.doc = parse(text, { today });
    this.lastWritten = text;
    this.emit("disk");
    return true;
  }

  startPolling(intervalMs = 2000): void {
    this.stopPolling();
    this.timer = setInterval(() => void this.reloadIfChanged(), intervalMs);
  }

  stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async rename(id: string, name: string): Promise<void> {
    renameNode(this.doc, id, name);
    const next = renameInArchive(this.archiveText, id, name);
    if (next !== this.archiveText) {
      this.archiveText = next;
      await this.fs.write(this.archivePath, next);
    }
    await this.save();
  }

  async sweep(): Promise<SweepResult> {
    ensureIds(this.doc);
    const today = timestampFromDate(this.clock(), false).date;
    const result = sweepDoc(this.doc, this.archiveText, { today, keepEvents: this.settings.keepEvents });
    this.doc = result.doc;
    if (result.archiveText !== this.archiveText) {
      this.archiveText = result.archiveText;
      await this.fs.write(this.archivePath, result.archiveText);
    }
    await this.save();
    return result;
  }

  history(id: string): HistoryEvent[] {
    return historyOf(this.doc, this.archiveText, id);
  }
}
