import { MarkdownView, Notice, Plugin } from "obsidian";
import type { Editor, MarkdownFileInfo } from "obsidian";
import type { Lane, Settings } from "@hottasks/core";
import { Store, addEvent, setLane, touch, withDefaults } from "@hottasks/core";
import { itemAtLine } from "./cursor";
import { heatDecorations, refreshEditors } from "./decorations";
import { HistoryModal, TextModal } from "./modals";
import { HotTasksSettingTab } from "./settings-tab";
import { vaultFileSystem } from "./vault-fs";

type Ctx = MarkdownView | MarkdownFileInfo;
type Run = (store: Store, id: string, name: string) => void;

export default class HotTasksPlugin extends Plugin {
  override settings: Settings = withDefaults({ folder: "0_Tasks" });
  store: Store | undefined;

  override async onload(): Promise<void> {
    this.settings = withDefaults({ folder: "0_Tasks", ...((await this.loadData()) as Partial<Settings> | null) });
    await this.openStore();

    this.addSettingTab(new HotTasksSettingTab(this.app, this));
    this.registerEditorExtension(heatDecorations(() => this.store));

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        const store = this.store;
        if (!store || file.path !== store.tasksPath) return;
        void store.reloadIfChanged().then(() => refreshEditors(this.app));
      })
    );
    this.registerInterval(window.setInterval(() => refreshEditors(this.app), 60_000));

    this.addCommand({ id: "sweep", name: "Sweep now", callback: () => void this.sweep() });
    this.addCommand({
      id: "touch",
      name: "Touch item under cursor",
      editorCallback: (editor, ctx) => void this.onItem(editor, ctx, (store, id) => void touch(store.doc, id))
    });
    const lanes: Array<[Lane, string]> = [["now", "Now"], ["later", "Later"], ["done", "Done"]];
    for (const [lane, name] of lanes) {
      this.addCommand({
        id: `lane-${lane}`,
        name: `Set lane: ${name}`,
        editorCallback: (editor, ctx) => void this.onItem(editor, ctx, (store, id) => setLane(store.doc, id, lane))
      });
    }
    this.addCommand({
      id: "add-event",
      name: "Add event under cursor",
      editorCallback: (editor, ctx) =>
        new TextModal(this.app, "Add event", (text) => {
          if (text !== "") void this.onItem(editor, ctx, (store, id) => void addEvent(store.doc, id, text));
        }).open()
    });
    this.addCommand({
      id: "history",
      name: "Show history for item under cursor",
      editorCallback: (editor, ctx) =>
        void this.onItem(editor, ctx, (store, id, name) => new HistoryModal(this.app, name, store.history(id)).open(), false)
    });
  }

  override onunload(): void {
    this.store?.stopPolling();
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    this.settings = withDefaults({ ...this.settings, ...patch });
    await this.saveData(this.settings);
    await this.openStore();
    refreshEditors(this.app);
  }

  private async openStore(): Promise<void> {
    this.store = await Store.open(this.settings, vaultFileSystem(this.app.vault.adapter));
  }

  /** Writes unsaved edits of the open tasks file so the store reads what the editor shows. */
  private async flush(store: Store): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof MarkdownView && leaf.view.file?.path === store.tasksPath) await leaf.view.save();
    }
    await store.reloadIfChanged();
  }

  private async sweep(): Promise<void> {
    const store = this.store;
    if (!store) return;
    await this.flush(store);
    const result = await store.sweep();
    new Notice(`Sweep done, ${result.archivedItems.length} item(s) archived`);
  }

  /** Runs an operation on the item at or above the cursor, assigning an ID first when the line has none. */
  private async onItem(editor: Editor, ctx: Ctx, run: Run, save = true): Promise<void> {
    const store = this.store;
    if (!store || ctx.file?.path !== store.tasksPath) {
      new Notice("Open the HotTasks file first");
      return;
    }
    await this.flush(store);
    const item = itemAtLine(editor.getValue(), store.doc, editor.getCursor().line);
    if (!item) {
      new Notice("No item at the cursor");
      return;
    }
    if (!item.id) await store.save();
    const id = item.id;
    if (!id) return;
    run(store, id, item.name);
    if (save) await store.save();
  }
}
