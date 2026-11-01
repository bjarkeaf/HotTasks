import { editorInfoField, MarkdownView } from "obsidian";
import type { App } from "obsidian";
import { Decoration, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import { StateEffect } from "@codemirror/state";
import type { EditorState, Extension, Range } from "@codemirror/state";
import type { Heat, Item, Store } from "@hottasks/core";
import { formatAge, itemHeat, parse, timestampToMillis } from "@hottasks/core";
import { itemLines } from "./cursor";

export const refreshEffect = StateEffect.define<null>();

const STAMP = /@(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?/g;
const TRAILING_ID = /[ \t]*\^(?:ws|it)-[a-z0-9]{4}[ \t]*$/;

class TextWidget extends WidgetType {
  constructor(
    private readonly text: string,
    private readonly cls: string,
    private readonly title: string = ""
  ) {
    super();
  }

  override eq(other: TextWidget): boolean {
    return other.text === this.text && other.cls === this.cls && other.title === this.title;
  }

  override toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = this.cls;
    el.textContent = this.text;
    if (this.title) el.title = this.title;
    return el;
  }
}

class AgeWidget extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly later: boolean
  ) {
    super();
  }

  override eq(other: AgeWidget): boolean {
    return other.label === this.label && other.later === this.later;
  }

  override toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "hottasks-age";
    if (this.later) {
      const badge = document.createElement("span");
      badge.className = "hottasks-badge";
      badge.textContent = "Later";
      wrap.appendChild(badge);
    }
    wrap.appendChild(document.createTextNode(this.label));
    return wrap;
  }
}

function dayDiff(date: string, now: Date): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((new Date(y, m - 1, d).getTime() - start) / 86_400_000);
}

function relativeStamp(date: string, hh: string | undefined, mm: string | undefined, now: Date): string {
  if (hh === undefined || mm === undefined) {
    const days = dayDiff(date, now);
    return days === 0 ? "today" : days > 0 ? `in ${days} d` : `${-days} d ago`;
  }
  const ms = timestampToMillis({ date, time: `${hh.padStart(2, "0")}:${mm}` }) - now.getTime();
  return ms >= 0 ? `in ${formatAge(ms)}` : `${formatAge(-ms)} ago`;
}

function label(item: Item, heat: Heat): string {
  if (item.lane === "done") return "done";
  if (heat.state === "terminal") return item.status ?? "";
  if (heat.state === "parked") return `parked until ${heat.parkedUntil?.date ?? ""}`;
  return heat.ageMs !== undefined ? formatAge(heat.ageMs) : "no dates";
}

function build(view: EditorView, store: Store): DecorationSet {
  const text = view.state.doc.toString();
  const now = new Date();
  const opts = {
    thresholds: { hotMs: store.settings.hotMs, warmMs: store.settings.warmMs },
    terminalStatuses: store.settings.terminalStatuses
  };
  const active = new Set<number>();
  for (const r of view.state.selection.ranges) {
    const from = view.state.doc.lineAt(r.from).number;
    const to = view.state.doc.lineAt(r.to).number;
    for (let n = from; n <= to; n++) active.add(n);
  }

  const heatByLine = new Map<number, { item: Item; heat: Heat }>();
  for (const { line, item } of itemLines(text, parse(text))) heatByLine.set(line + 1, { item, heat: itemHeat(item, now, opts) });

  const out: Range<Decoration>[] = [];
  for (let n = 1; n <= view.state.doc.lines; n++) {
    const line = view.state.doc.line(n);
    const entry = heatByLine.get(n);
    if (entry) {
      const done = entry.item.lane === "done" ? " hottasks-done" : "";
      out.push(Decoration.line({ class: `hottasks-line hottasks-${entry.heat.state}${done}` }).range(line.from));
      const widget = new AgeWidget(label(entry.item, entry.heat), entry.item.lane === "later");
      out.push(Decoration.widget({ widget, side: 1 }).range(line.to));
    }
    if (active.has(n)) continue;

    const idMatch = TRAILING_ID.exec(line.text);
    const idFrom = idMatch ? line.from + idMatch.index : line.to;
    if (idMatch) out.push(Decoration.replace({}).range(idFrom, line.to));
    for (const m of line.text.matchAll(STAMP)) {
      const from = line.from + m.index;
      const to = from + m[0].length;
      if (to > idFrom) continue;
      const widget = new TextWidget(relativeStamp(m[1]!, m[2], m[3], now), "hottasks-stamp", m[0].slice(1));
      out.push(Decoration.replace({ widget }).range(from, to));
    }
  }
  return Decoration.set(out, true);
}

function headLine(state: EditorState): number {
  return state.doc.lineAt(state.selection.main.head).number;
}

export function heatDecorations(getStore: () => Store | undefined): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.compute(view);
      }

      update(u: ViewUpdate): void {
        const refresh = u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshEffect)));
        const moved = u.selectionSet && (headLine(u.state) !== headLine(u.startState) || !u.state.selection.main.empty);
        if (u.docChanged || refresh || moved) this.decorations = this.compute(u.view);
      }

      compute(view: EditorView): DecorationSet {
        const store = getStore();
        const path = view.state.field(editorInfoField, false)?.file?.path;
        if (!store || path !== store.tasksPath) return Decoration.none;
        return build(view, store);
      }
    },
    { decorations: (v) => v.decorations }
  );
}

/** Asks every open editor to rebuild. Uses the undocumented `editor.cm` handle that Obsidian's own plugins rely on. */
export function refreshEditors(app: App): void {
  app.workspace.iterateAllLeaves((leaf) => {
    if (!(leaf.view instanceof MarkdownView)) return;
    const cm = (leaf.view.editor as unknown as { cm?: EditorView }).cm;
    cm?.dispatch({ effects: refreshEffect.of(null) });
  });
}
