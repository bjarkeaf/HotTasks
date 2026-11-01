import { findItem, moveItemAfter, moveWorkstreamAfter, workstreams } from "@hottasks/core";
import type { Ctx } from "./pane-card";
import { cx, h } from "./pane-edit";

/**
 * Drag to reorder in the By workstream view. Only the position in the file changes, so items stay in
 * their lane and may only be dropped among boxes of the same lane section.
 */
interface Drag {
  kind: "item" | "ws";
  id: string;
  lane: string;
}

let drag: Drag | null = null;
let line: HTMLElement | null = null;
let pending: (() => void) | null = null;

function clear(): void {
  line?.remove();
  pending = null;
}

function end(el: HTMLElement): void {
  el.classList.remove(cx("dragging"));
  clear();
  drag = null;
}

function source(el: HTMLElement, mark: HTMLElement, d: Drag): void {
  el.draggable = true;
  el.addEventListener("dragstart", (e) => {
    // A field being edited in place must keep its text selection.
    if (el.querySelector(`input, .${cx("live")}`)) return e.preventDefault();
    e.stopPropagation();
    drag = d;
    mark.classList.add(cx("dragging"));
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", d.id);
    }
  });
  el.addEventListener("dragend", () => end(mark));
}

/** A closed item row, dragged by the whole row. */
export function itemSource(card: HTMLElement, row: HTMLElement, id: string, lane: string): void {
  source(row, card, { kind: "item", id, lane });
}

/** A workstream box, dragged by its header only. */
export function wsSource(box: HTMLElement, head: HTMLElement, id: string, lane: string): void {
  source(head, box, { kind: "ws", id, lane });
}

function show(at: HTMLElement, where: "before" | "after" | "end"): void {
  line ??= h("div", "dropline");
  if (where === "before") at.before(line);
  else if (where === "after") at.after(line);
  else at.appendChild(line);
}

/** Ids of the lines that count as siblings of an item: the workstream's items, or everything at top level. */
function siblings(ctx: Ctx, wsId: string | undefined): string[] {
  const doc = ctx.store.doc;
  const list = wsId === undefined ? doc.nodes : (workstreamNodes(ctx).find((w) => w.id === wsId)?.children ?? []);
  return list.flatMap((n) => (n.kind !== "opaque" && n.id ? [n.id] : []));
}

function workstreamNodes(ctx: Ctx) {
  return [...workstreams(ctx.store.doc)];
}

function itemOver(ctx: Ctx, box: HTMLElement, e: DragEvent, wsId: string | undefined, d: Drag): void {
  const cards = [...box.children].filter((c): c is HTMLElement => c instanceof HTMLElement && c.classList.contains(cx("card")) && c.dataset.id !== d.id);
  const before = cards.find((c) => {
    const r = c.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2;
  });
  const last = cards[cards.length - 1];
  if (!before && !last) return clear();

  const rest = siblings(ctx, wsId).filter((id) => id !== d.id);
  let after: string | null;
  if (before) {
    const at = rest.indexOf(before.dataset.id ?? "");
    after = at > 0 ? rest[at - 1]! : null;
  } else {
    after = last!.dataset.id ?? null;
  }

  // Dropped where it already sits.
  const found = findItem(ctx.store.doc, d.id);
  if (found?.workstream?.id === wsId) {
    const all = siblings(ctx, wsId);
    const i = all.indexOf(d.id);
    if (after === (i > 0 ? all[i - 1]! : null)) return clear();
  }
  show(before ?? box, before ? "before" : "end");
  pending = () => ctx.actions.do((s) => moveItemAfter(s.doc, d.id, wsId, after));
}

function wsOver(ctx: Ctx, box: HTMLElement, e: DragEvent, wsId: string, d: Drag): void {
  if (wsId === d.id) return clear();
  const r = box.getBoundingClientRect();
  const above = e.clientY < r.top + r.height / 2;
  const all = workstreamNodes(ctx).flatMap((w) => (w.id ? [w.id] : []));
  const rest = all.filter((id) => id !== d.id);
  const at = rest.indexOf(wsId);
  const after = above ? (at > 0 ? rest[at - 1]! : null) : wsId;
  const i = all.indexOf(d.id);
  if (after === (i > 0 ? all[i - 1]! : null)) return clear();
  show(box, above ? "before" : "after");
  pending = () => ctx.actions.do((s) => moveWorkstreamAfter(s.doc, d.id, after));
}

/** Makes a box accept drops of the same lane section. Elsewhere the browser shows the not-allowed cursor. */
export function dropZone(ctx: Ctx, box: HTMLElement, wsId: string | undefined, lane: string): void {
  box.addEventListener("dragover", (e) => {
    const d = drag;
    if (!d || d.lane !== lane || (d.kind === "ws" && wsId === undefined)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    if (d.kind === "item") itemOver(ctx, box, e, wsId, d);
    else wsOver(ctx, box, e, wsId!, d);
  });
  box.addEventListener("drop", (e) => {
    const run = pending;
    if (!drag || !run) return;
    e.preventDefault();
    clear();
    run();
  });
}
