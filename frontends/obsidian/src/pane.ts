import { ItemView, MarkdownView, Notice, TFile } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type { Item, Lane, Store } from "@hottasks/core";
import { addWorkstream, findItem, setLane, touch } from "@hottasks/core";
import { HistoryModal } from "./modals";
import { Actions } from "./pane-actions";
import type { Ctx } from "./pane-card";
import { focusItem, takeRefocus } from "./pane-card";
import { closeFloating, cx, dropdown, h, icon, inputPopover, isEditing, LIMITS, menuAt, menuHeading, menuItem, onFloatingDismiss, onOutsideMouseDown, onSwallowedClick, setRendering } from "./pane-edit";
import { renderList, renderSummary } from "./pane-render";
import type { PaneHost } from "./pane-state";
import { LANES, LANE_NAMES, VIEW_TYPE } from "./pane-state";

export class HotTasksPane extends ItemView {
  private list!: HTMLElement;
  private summary!: HTMLElement;
  private badge!: HTMLElement;
  private readonly actions: Actions;
  private readonly allEvents = new Set<string>();
  private lastIdAttempt = 0;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: PaneHost
  ) {
    super(leaf);
    this.actions = new Actions(host, () => this.render());
  }

  override getViewType(): string {
    return VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "HotTasks";
  }

  override getIcon(): string {
    return "flame";
  }

  override onOpen(): Promise<void> {
    this.contentEl.addClass("hottasks-view");
    this.build();
    this.registerDomEvent(document, "mousedown", onOutsideMouseDown, true);
    this.registerDomEvent(document, "click", onSwallowedClick, true);
    this.registerDomEvent(document, "click", onFloatingDismiss);
    this.registerDomEvent(document, "keydown", onFloatingDismiss);
    this.registerDomEvent(document, "click", (e) => this.closeOpenItem(e));
    this.registerDomEvent(this.contentEl, "mousedown", () => void this.host.flush());
    this.registerInterval(window.setInterval(() => this.render(), 60_000));
    this.render();
    return Promise.resolve();
  }

  override onClose(): Promise<void> {
    closeFloating();
    return Promise.resolve();
  }

  /** Redraws the list, keeping the scroll position and any half-typed field. Does nothing while a field is being edited in place. */
  render(): void {
    if (isEditing() || !this.list) return;
    const keep = this.captureFocus();
    let moved = false;
    setRendering(true);
    try {
      moved = this.draw();
    } finally {
      setRendering(false);
    }
    if (!moved) this.restoreFocus(keep);
    if (this.host.store) this.assignIds(this.host.store);
  }

  private captureFocus(): { id: string; sel: string; value: string; start: number | null; end: number | null } | undefined {
    const a = document.activeElement;
    if (!(a instanceof HTMLInputElement) || a.type === "checkbox" || !this.list.contains(a)) return undefined;
    const id = a.closest<HTMLElement>(`.${cx("card")}`)?.dataset.id;
    if (!id) return undefined;
    const sel = a.dataset.input ? `input[data-input="${a.dataset.input}"]` : `.${cx("newtask")}`;
    return { id, sel, value: a.value, start: a.selectionStart, end: a.selectionEnd };
  }

  private restoreFocus(keep: ReturnType<HotTasksPane["captureFocus"]>): void {
    if (!keep) return;
    const el = this.list.querySelector<HTMLInputElement>(`[data-id="${keep.id}"] ${keep.sel}`);
    if (!el) return;
    el.value = keep.value;
    el.focus();
    if (keep.start !== null && keep.end !== null) el.setSelectionRange(keep.start, keep.end);
  }

  /** Returns true when it moved the focus itself. */
  private draw(): boolean {
    const store = this.host.store;
    const scroll = this.list.scrollTop;
    if (!store) {
      this.list.replaceChildren();
      h("div", "empty", "No tasks file, check the folder in the plugin settings", this.list);
      return false;
    }
    const ctx = this.ctx(store);
    renderList(ctx, this.list);
    renderSummary(ctx, this.summary);
    const { lanes } = this.host.prefs;
    this.badge.textContent = lanes.length === 1 && lanes[0] === "now" ? "" : LANES.filter((l) => lanes.includes(l)).map((l) => l[0]!.toUpperCase()).join("");
    this.list.scrollTop = scroll;
    const refocus = takeRefocus();
    if (refocus) this.list.querySelector<HTMLElement>(`[data-id="${refocus}"] .${cx("newtask")}`)?.focus();
    return refocus !== null;
  }

  /** Rows without an ID cannot be acted on. Saving gives them one. */
  private assignIds(store: Store): void {
    const missing = [...store.doc.nodes].some((n) => (n.kind === "workstream" && (!n.id || n.children.some((c) => c.kind === "item" && !c.id))) || (n.kind === "item" && !n.id));
    if (!missing || Date.now() - this.lastIdAttempt < 5000) return;
    this.lastIdAttempt = Date.now();
    this.actions.do(() => undefined);
  }

  private ctx(store: Store): Ctx {
    const s = store.settings;
    return {
      store,
      host: this.host,
      actions: this.actions,
      now: new Date(),
      opts: { thresholds: { hotMs: s.hotMs, warmMs: s.warmMs }, terminalStatuses: s.terminalStatuses },
      allEvents: this.allEvents,
      component: this,
      draw: () => this.render(),
      toggle: (id) => {
        const { prefs } = this.host;
        prefs.open = prefs.open === id ? null : id;
        focusItem(prefs.open);
        this.host.savePrefs();
        this.render();
      }
    };
  }

  private build(): void {
    const pane = h("section", "pane", undefined, this.contentEl);
    pane.setAttribute("aria-label", "HotTasks pane");
    const bar = h("div", "toolbar", undefined, pane);
    const title = h("div", "title", undefined, bar);
    h("span", "flame", undefined, title);
    title.append("HotTasks");

    const addWs = this.toolButton(bar, "plus", "New workstream", 16);
    addWs.addEventListener("click", (e) => {
      e.stopPropagation();
      inputPopover(addWs, { label: "New workstream", placeholder: "Name", max: LIMITS.workstream, ok: "Create" }, (name) => {
        this.host.prefs.view = "ws";
        this.host.savePrefs();
        this.actions.do((s) => void addWorkstream(s.doc, name));
      });
    });
    const sort = this.toolButton(bar, "sort", "Sort", 16);
    sort.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown(sort, (menu, rebuild) => {
        const { prefs } = this.host;
        menuHeading(menu, "Sort");
        const pick = (view: "ws" | "heat", text: string) =>
          menuItem(menu, text, prefs.view === view, () => {
            prefs.view = view;
            this.host.savePrefs();
            rebuild();
            this.render();
          });
        pick("ws", "By workstream");
        pick("heat", "Coldest first");
      });
    });
    const filter = this.toolButton(bar, "filter", "Filter lanes", 16);
    this.badge = h("span", "n", undefined, filter);
    filter.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown(filter, (menu, rebuild) => this.lanesMenu(menu, rebuild));
    });

    this.list = h("div", "list", undefined, pane);
    this.list.addEventListener("contextmenu", (e) => this.contextMenu(e));

    const footer = h("div", "footer", undefined, pane);
    this.summary = h("div", "summary", undefined, footer);
    const search = h("div", "search", undefined, footer);
    const q = h("input", "", undefined, search);
    q.type = "search";
    q.placeholder = "Search";
    q.value = this.host.prefs.q;
    q.setAttribute("aria-label", "Search");
    q.addEventListener("input", () => {
      this.host.prefs.q = q.value;
      this.host.savePrefs();
      this.render();
    });
  }

  private toolButton(bar: HTMLElement, name: "plus" | "sort" | "filter", title: string, size: number): HTMLButtonElement {
    const b = h("button", "tb", undefined, bar);
    b.title = title;
    b.setAttribute("aria-haspopup", "menu");
    b.appendChild(icon(name, size));
    return b;
  }

  /** Checkboxes on the right combine lanes, a click on the name shows that lane alone. */
  private lanesMenu(menu: HTMLElement, rebuild: () => void): void {
    const { prefs } = this.host;
    const set = (lanes: Lane[]) => {
      prefs.lanes = lanes;
      this.host.savePrefs();
      rebuild();
      this.render();
    };
    menuHeading(menu, "Lanes");
    for (const lane of LANES) {
      const row = h("div", "mrow", undefined, menu);
      const name = menuItem(row, LANE_NAMES[lane], false, () => set([lane]));
      name.title = `Show only ${LANE_NAMES[lane]}`;
      const on = prefs.lanes.includes(lane);
      const box = h("button", on ? "box on" : "box", undefined, row);
      box.title = `Show or hide ${LANE_NAMES[lane]}`;
      box.setAttribute("aria-pressed", String(on));
      box.addEventListener("click", () => set(on ? prefs.lanes.filter((l) => l !== lane) : LANES.filter((l) => l === lane || prefs.lanes.includes(l))));
    }
    h("hr", "", undefined, menu);
    menuItem(menu, "Show all", false, () => set([...LANES]));
  }

  /** Clicking anywhere outside the open item closes it, unless a menu or popover is in play. */
  private closeOpenItem(e: MouseEvent): void {
    const { prefs } = this.host;
    if (!prefs.open || isEditing()) return;
    const inside = e.composedPath().some((n) => n instanceof HTMLElement && (n.classList.contains(cx("card")) || n.classList.contains(cx("pop")) || n.classList.contains(cx("menu"))));
    if (inside) return;
    prefs.open = null;
    this.host.savePrefs();
    this.render();
  }

  private contextMenu(e: MouseEvent): void {
    const card = (e.target as HTMLElement).closest<HTMLElement>(`.${cx("card")}`);
    const id = card?.dataset.id;
    const store = this.host.store;
    const found = store && id ? findItem(store.doc, id) : undefined;
    if (!found) return;
    e.preventDefault();
    const { item } = found;
    const done = () => closeFloating();
    menuAt(e.clientX, e.clientY, (m) => {
      menuItem(m, "Touch", false, () => {
        done();
        this.actions.do((s) => void touch(s.doc, id!));
      });
      menuItem(m, "Add event", false, () => {
        done();
        this.reveal(id!, "[data-input=event]");
      });
      menuItem(m, "Set status", false, () => {
        done();
        this.reveal(id!, "[data-edit=status]", true);
      });
      h("hr", "", undefined, m);
      menuHeading(m, "Lane");
      for (const lane of LANES) {
        menuItem(m, LANE_NAMES[lane], item.lane === lane, () => {
          done();
          this.actions.do((s) => setLane(s.doc, id!, lane));
        });
      }
      h("hr", "", undefined, m);
      menuItem(m, "History", false, () => {
        done();
        this.showHistory(item, id!);
      });
      menuItem(m, "Open in note", false, () => {
        done();
        void this.openInNote(id!);
      });
    });
  }

  /** Opens the item, then focuses a field in it, or clicks it to start editing. */
  private reveal(id: string, selector: string, click = false): void {
    this.host.prefs.open = id;
    this.host.savePrefs();
    this.render();
    const el = this.list.querySelector<HTMLElement>(`[data-id="${id}"] ${selector}`);
    if (click) el?.click();
    else el?.focus();
  }

  private showHistory(item: Item, id: string): void {
    const store = this.host.store;
    if (store) new HistoryModal(this.app, item.name, store.history(id)).open();
  }

  /** Opens tasks.md with the cursor on the item's line, found by its ^id. */
  private async openInNote(id: string): Promise<void> {
    const store = this.host.store;
    if (!store) return;
    const file = this.app.vault.getAbstractFileByPath(store.tasksPath);
    if (!(file instanceof TFile)) {
      new Notice("Tasks file not found");
      return;
    }
    const line = (await this.app.vault.read(file)).split(/\r?\n/).findIndex((l) => l.trimEnd().endsWith(`^${id}`));
    const open = this.app.workspace.getLeavesOfType("markdown").find((l) => l.view instanceof MarkdownView && l.view.file?.path === file.path);
    const leaf = open ?? this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    if (line >= 0 && leaf.view instanceof MarkdownView) {
      const at = { line, ch: 0 };
      leaf.view.editor.setCursor(at);
      leaf.view.editor.scrollIntoView({ from: at, to: at }, true);
    }
  }
}
