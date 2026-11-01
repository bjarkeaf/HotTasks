import { Notice } from "obsidian";
import type { Document, Item, Store, Timestamp } from "@hottasks/core";
import { StoreConflict, parse, serialize } from "@hottasks/core";
import type { PaneHost } from "./pane-state";

const UNDO_DEPTH = 30;

/**
 * Every change goes the same way: apply a backend operation to store.doc, redraw at once, then save.
 * Saves run one after the other, so a quick second edit never races the first write.
 * The file text before each change is kept, so Ctrl+Z can put it back.
 */
export class Actions {
  private tail: Promise<void> = Promise.resolve();
  private readonly undoStack: string[] = [];

  constructor(
    private readonly host: PaneHost,
    private readonly redraw: () => void
  ) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Restores the text from before the last change made through the pane. */
  undo(): boolean {
    const store = this.host.store;
    const text = this.undoStack.pop();
    if (!store || text === undefined) return false;
    store.doc = parse(text);
    this.redraw();
    const prev = this.tail;
    this.tail = (async () => {
      await prev;
      try {
        await store.save();
      } catch (e) {
        await this.failed(e);
        this.redraw();
      }
    })();
    return true;
  }

  do(fn: (store: Store) => void | Promise<void>): void {
    const store = this.host.store;
    if (!store) return;
    const before = serialize(store.doc);
    let pending: Promise<void>;
    try {
      pending = Promise.resolve(fn(store));
      if (serialize(store.doc) !== before) {
        this.undoStack.push(before);
        if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
      }
    } catch (e) {
      void this.failed(e);
      return;
    }
    void pending.catch(() => undefined);
    this.redraw();
    const prev = this.tail;
    this.tail = (async () => {
      await prev;
      try {
        await pending;
        await store.save();
      } catch (e) {
        await this.failed(e);
        this.redraw();
      }
      // On success the store's own change notice redraws.
    })();
  }

  private async failed(e: unknown): Promise<void> {
    if (e instanceof StoreConflict) {
      // The store has already reloaded from disk, the redraw shows what is there now.
      new Notice("File changed on disk, try again");
      return;
    }
    new Notice(`HotTasks: ${e instanceof Error ? e.message : String(e)}`);
    await this.host.reopenStore();
  }
}

/** There is no backend operation for events beyond add, so these two edit the event list directly. The save still goes through the store. */
export function removeEvent(item: Item, index: number): void {
  const event = item.events[index];
  if (!event) return;
  item.events.splice(index, 1);
  // A following line without its own stamp would otherwise inherit from the one before.
  const next = item.events[index];
  if (next && !next.explicit && event.at) {
    next.explicit = true;
    next.at = event.at;
  }
}

export function editEvent(item: Item, index: number, patch: { text?: string; at?: Timestamp }): void {
  const event = item.events[index];
  if (!event) return;
  if (patch.text !== undefined) event.text = patch.text;
  if (!patch.at) return;
  // Lines after it that inherited its time keep the old one.
  for (let i = index + 1; i < item.events.length; i++) {
    const e = item.events[i]!;
    if (e.explicit) break;
    if (event.at) {
      e.explicit = true;
      e.at = event.at;
    }
  }
  event.explicit = true;
  event.at = patch.at;
}

/** Only for a workstream with no items left. Anything else is archived by setting its items to Done. */
export function removeEmptyWorkstream(doc: Document, id: string): boolean {
  const i = doc.nodes.findIndex((n) => n.kind === "workstream" && n.id === id);
  const ws = doc.nodes[i];
  if (!ws || ws.kind !== "workstream") return false;
  if (ws.children.some((c) => c.kind === "item" || (c.kind === "opaque" && c.text.trim() !== ""))) return false;
  doc.nodes.splice(i, 1);
  return true;
}
