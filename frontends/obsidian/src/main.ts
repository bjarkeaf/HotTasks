import { MarkdownView, Notice, Plugin } from "obsidian";
import type { Editor, MarkdownFileInfo } from "obsidian";
import type { Lane, Settings } from "@hottasks/core";
import { DEFAULT_SETTINGS, Store, addEvent, setLane, touch, withDefaults } from "@hottasks/core";
import { itemAtLine } from "./cursor";
import { heatDecorations, refreshEditors } from "./decorations";
import { HistoryModal, TextModal } from "./modals";
import { HotTasksPane } from "./pane";
import type { PaneHost, Prefs } from "./pane-state";
import { VIEW_TYPE, readPrefs } from "./pane-state";
import { HotTasksSettingTab } from "./settings-tab";
import { vaultFileSystem } from "./vault-fs";

type Ctx = MarkdownView | MarkdownFileInfo;
type Run = (store: Store, id: string, name: string) => void;

export default class HotTasksPlugin extends Plugin implements PaneHost {
  override settings: Settings = withDefaults({ folder: "Tasks" });
  prefs: Prefs = readPrefs(undefined);
  store: Store | undefined;
  private unsubscribe: (() => void) | undefined;
  private prefsTimer: number | undefined;

  override async onload(): Promise<void> {
    const data = (await this.loadData()) as (Partial<Settings> & Partial<Prefs>) | null;
    this.prefs = readPrefs(data);
    this.settings = withDefaults({ folder: "Tasks", ...pickSettings(data) });
    await this.openStore();

    this.registerView(VIEW_TYPE, (leaf) => new HotTasksPane(leaf, this));
    this.addRibbonIcon("flame", "Open HotTasks pane", () => void this.openPane());
    this.addCommand({ id: "open-pane", name: "Open HotTasks pane", callback: () => void this.openPane() });

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
    this.unsubscribe?.();
    this.store?.stopPolling();
    window.clearTimeout(this.prefsTimer);
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    this.settings = withDefaults({ ...this.settings, ...patch });
    await this.persist();
    await this.openStore();
    refreshEditors(this.app);
  }

  private async persist(): Promise<void> {
    await this.saveData({ ...this.settings, ...this.prefs });
  }

  savePrefs(): void {
    window.clearTimeout(this.prefsTimer);
    this.prefsTimer = window.setTimeout(() => void this.persist(), 500);
  }

  private async openStore(): Promise<void> {
    this.unsubscribe?.();
    const store = await Store.open(this.settings, vaultFileSystem(this.app.vault.adapter));
    this.store = store;
    this.unsubscribe = store.onChange(() => {
      this.refreshPanes();
      refreshEditors(this.app);
    });
    this.refreshPanes();
  }

  async reopenStore(): Promise<void> {
    await this.openStore();
  }

  private refreshPanes(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof HotTasksPane) leaf.view.render();
    }
  }

  /** Shows the pane in the right sidebar, opening it first if needed. */
  private async openPane(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      await leaf?.setViewState({ type: VIEW_TYPE, active: true });
    }
    if (leaf) await workspace.revealLeaf(leaf);
  }

  /** Writes unsaved edits of the open tasks file so the store reads what the editor shows. */
  async flush(store: Store | undefined = this.store): Promise<void> {
    if (!store) return;
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

/** The plugin data holds the backend settings and the pane's own preferences side by side. */
function pickSettings(data: Partial<Settings> | null): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const value = (data as Record<string, unknown> | null)?.[key];
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<Settings>;
}
