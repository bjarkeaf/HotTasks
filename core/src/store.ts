import type { Document, Item, Lane } from "./model.js";
import { findItem, items, timestampFromDate } from "./model.js";
import { parse } from "./parse.js";
import { serialize } from "./serialize.js";
import { addEvent, ensureIds, rename as renameNode } from "./ops.js";
import { parseArchive, renameInArchive, sweep as sweepDoc } from "./archive.js";
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

/** Thrown by save() when the file changed on disk since it was last read. The store has reloaded; redo the operation. */
export class StoreConflict extends Error {
  constructor() {
    super("tasks.md changed on disk, the store reloaded it");
    this.name = "StoreConflict";
  }
}

function joinPath(folder: string, name: string): string {
  if (folder === "") return name;
  const sep = folder.includes("\\") && !folder.includes("/") ? "\\" : "/";
  return folder.endsWith(sep) ? folder + name : folder + sep + name;
}

function laneEvent(lane: Lane): string {
  return lane === "done" ? "Done" : lane === "later" ? "Lane: Later" : "Lane: Now";
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
  private busy = false;
  private sweptOn: string | undefined;

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

  private get today(): string {
    return timestampFromDate(this.clock(), false).date;
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(source: ChangeSource): void {
    for (const l of this.listeners) l(this.doc, source);
  }

  private archiveIds(): string[] {
    return parseArchive(this.archiveText).map((e) => e.id);
  }

  /**
   * Writes tasks.md. Assigns missing IDs first, takes the daily snapshot and runs the daily sweep.
   * Refuses with StoreConflict if the file changed on disk since it was last read.
   */
  async save(): Promise<void> {
    if (await this.diskChanged()) {
      await this.reloadIfChanged();
      throw new StoreConflict();
    }
    this.busy = true;
    try {
      ensureIds(this.doc, undefined, this.archiveIds());
      if (this.settings.snapshots) await this.snapshot();
      if (this.sweptOn !== this.today) await this.runSweep();
      await this.writeTasks();
    } finally {
      this.busy = false;
    }
    this.emit("save");
  }

  private async writeTasks(): Promise<void> {
    const text = serialize(this.doc);
    if (text !== this.lastWritten || !(await this.fs.exists(this.tasksPath))) {
      await this.fs.write(this.tasksPath, text);
      this.lastWritten = text;
      this.lastMtime = await this.fs.mtime(this.tasksPath);
    }
  }

  private async diskChanged(): Promise<boolean> {
    const mtime = await this.fs.mtime(this.tasksPath);
    if (mtime === this.lastMtime) return false;
    const text = await this.fs.read(this.tasksPath);
    return text !== undefined && text !== this.lastWritten;
  }

  /** Copies the file as it was before today's first save into history/. */
  private async snapshot(): Promise<void> {
    const dir = joinPath(this.settings.folder, HISTORY_DIR);
    const path = joinPath(dir, `tasks-${this.today}.md`);
    if (await this.fs.exists(path)) return;
    const current = await this.fs.read(this.tasksPath);
    if (current === undefined) return;
    await this.fs.mkdir(dir);
    await this.fs.write(path, current);
  }

  private async runSweep(): Promise<SweepResult> {
    const result = sweepDoc(this.doc, this.archiveText, { today: this.today, keepEvents: this.settings.keepEvents });
    this.doc = result.doc;
    this.sweptOn = this.today;
    if (result.archiveText !== this.archiveText) {
      this.archiveText = result.archiveText;
      await this.fs.write(this.archivePath, result.archiveText);
    }
    return result;
  }

  /**
   * Re-reads tasks.md if something else changed it. Returns true when the model was replaced.
   * Lane and status changes made by hand get the event the UI would have written.
   */
  async reloadIfChanged(): Promise<boolean> {
    if (this.busy) return false;
    const mtime = await this.fs.mtime(this.tasksPath);
    if (mtime === this.lastMtime) return false;
    const text = await this.fs.read(this.tasksPath);
    if (this.busy) return false;
    this.lastMtime = mtime;
    if (text === undefined || text === this.lastWritten) return false;
    const previous = this.doc;
    this.doc = parse(text, { today: this.today });
    this.lastWritten = text;
    const changed = this.recordHandEdits(previous);
    this.emit("disk");
    if (changed) await this.save();
    return true;
  }

  private recordHandEdits(previous: Document): boolean {
    const now = this.clock();
    let changed = false;
    for (const { item } of items(this.doc)) {
      if (!item.id) continue;
      const before = findItem(previous, item.id)?.item;
      if (!before) continue;
      if (before.lane !== item.lane && !endsWithEvent(item, laneEvent(item.lane))) {
        addEvent(this.doc, item.id, laneEvent(item.lane), undefined, now);
        changed = true;
      }
      if (before.status !== item.status && item.status !== undefined && !endsWithEvent(item, `Status: ${item.status}`)) {
        addEvent(this.doc, item.id, `Status: ${item.status}`, undefined, now);
        changed = true;
      }
    }
    return changed;
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
    if (await this.diskChanged()) {
      await this.reloadIfChanged();
      throw new StoreConflict();
    }
    this.busy = true;
    let result: SweepResult;
    try {
      ensureIds(this.doc, undefined, this.archiveIds());
      result = await this.runSweep();
      await this.writeTasks();
    } finally {
      this.busy = false;
    }
    this.emit("save");
    return result;
  }

  history(id: string): HistoryEvent[] {
    return historyOf(this.doc, this.archiveText, id);
  }
}

function endsWithEvent(item: Item, text: string): boolean {
  const last = item.events[item.events.length - 1];
  return last !== undefined && last.text.trim() === text;
}
