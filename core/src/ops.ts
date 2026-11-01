import type { Document, Event, Info, Item, Lane, LineFormat, Node, Task, Timestamp, Workstream } from "./model.js";
import { findItem, findWorkstream, newId, timestampFromDate, usedIds } from "./model.js";
import { parse } from "./parse.js";

export interface AddItemOptions {
  parentId?: string;
  lane?: Lane;
  status?: string;
  ids?: Set<string>;
}

export interface ImportOptions {
  lane?: Lane;
  ids?: Set<string>;
  now?: Date;
  random?: () => number;
}

function requireItem(doc: Document, id: string): Item {
  const found = findItem(doc, id);
  if (!found) throw new Error(`Item not found: ${id}`);
  return found.item;
}

function requireWorkstream(doc: Document, id: string): Workstream {
  const ws = findWorkstream(doc, id);
  if (!ws) throw new Error(`Workstream not found: ${id}`);
  return ws;
}

function indentUnit(indent: string): string {
  return indent === "" || indent.includes("\t") ? "\t" : "  ";
}

/** Format for a new line directly under an item, copied from an existing child where there is one. */
function childFormat(item: Item): LineFormat {
  const existing = item.tasks[0]?.format ?? item.info.find((f) => f.format.marker !== "")?.format ?? item.events[0]?.format;
  if (existing) return { ...existing };
  return { indent: item.format.indent + indentUnit(item.format.indent), marker: item.format.marker };
}

function topLevelFormat(doc: Document): LineFormat {
  const first = doc.nodes.find((n): n is Item | Workstream => n.kind !== "opaque");
  return { indent: "", marker: first ? first.format.marker : "-" };
}

/** Format for an item placed under `parent`, or at top level when `parent` is undefined. */
function itemFormat(doc: Document, parent: Workstream | undefined, exclude?: Item): LineFormat {
  if (!parent) return topLevelFormat(doc);
  const sibling = parent.children.find((c): c is Item => c.kind === "item" && c !== exclude);
  if (sibling) return { ...sibling.format };
  return { indent: parent.format.indent + indentUnit(parent.format.indent), marker: parent.format.marker };
}

function reindentIndent(indent: string, from: string, to: string): string {
  return indent.startsWith(from) ? to + indent.slice(from.length) : indent;
}

function reindentLine(line: string, from: string, to: string): string {
  return line.trim() === "" ? line : reindentIndent(line, from, to);
}

/** Replaces the leading `from` of every line of the item with `to`, so the whole subtree moves together. */
function reindentItem(item: Item, from: string, to: string): void {
  if (from === to) return;
  const shift = (parts: Array<Task | Info | Event>) => {
    for (const p of parts) {
      if (p.format.marker !== "") p.format.indent = reindentIndent(p.format.indent, from, to);
      p.children = p.children.map((line) => reindentLine(line, from, to));
    }
  };
  item.format.indent = reindentIndent(item.format.indent, from, to);
  shift(item.tasks);
  shift(item.info);
  shift(item.events);
}

function appendEvent(item: Item, text: string, at: Timestamp): Event {
  const format = item.events[0] ? { ...item.events[0].format } : childFormat(item);
  const event: Event = { format, text, at, explicit: true, children: [] };
  item.events.push(event);
  return event;
}

export function setLane(doc: Document, id: string, lane: Lane, now: Date = new Date()): void {
  const item = requireItem(doc, id);
  if (item.lane === lane) return;
  item.lane = lane;
  appendEvent(item, lane === "done" ? "Done" : lane === "later" ? "Lane: Later" : "Lane: Now", timestampFromDate(now));
}

/** Clearing the status writes no event, the vocabulary only has `Status: <text>`. */
export function setStatus(doc: Document, id: string, status: string | undefined, now: Date = new Date()): void {
  const item = requireItem(doc, id);
  // Asterisks and underscores would break the italic marker on the line.
  const cleaned = status?.replace(/[*_]/g, "").trim();
  const next = cleaned === undefined || cleaned === "" ? undefined : cleaned;
  if (next === item.status) return;
  if (next === undefined) {
    delete item.status;
    return;
  }
  item.status = next;
  appendEvent(item, `Status: ${next}`, timestampFromDate(now));
}

export function addEvent(doc: Document, id: string, text: string, at?: Timestamp | Date, now: Date = new Date()): Event {
  const item = requireItem(doc, id);
  const when = at instanceof Date ? timestampFromDate(at) : (at ?? timestampFromDate(now));
  return appendEvent(item, text, when);
}

export function touch(doc: Document, id: string, now: Date = new Date()): Event {
  return addEvent(doc, id, "Touched", undefined, now);
}

function requireTask(item: Item, index: number): Task {
  const task = item.tasks[index];
  if (!task) throw new Error(`Task not found: ${item.id ?? item.name} #${index}`);
  return task;
}

export function addTask(doc: Document, id: string, text: string, notBefore?: Timestamp): Task {
  const item = requireItem(doc, id);
  const last = item.tasks[item.tasks.length - 1];
  const task: Task = { format: last ? { ...last.format } : childFormat(item), text: text.trim(), children: [] };
  if (notBefore) task.notBefore = notBefore;
  item.tasks.push(task);
  return task;
}

/** Empty text removes the task. `notBefore` is cleared when omitted. */
export function editTask(doc: Document, id: string, index: number, text: string, notBefore?: Timestamp): Task | undefined {
  const item = requireItem(doc, id);
  const task = requireTask(item, index);
  const body = text.trim();
  if (body === "") {
    item.tasks.splice(index, 1);
    return undefined;
  }
  task.text = body;
  if (notBefore) task.notBefore = notBefore;
  else delete task.notBefore;
  return task;
}

export function removeTask(doc: Document, id: string, index: number): void {
  const item = requireItem(doc, id);
  requireTask(item, index);
  item.tasks.splice(index, 1);
}

const DONE_PREFIX = "Done: ";

/** The task's own sub-lines move onto the new event. */
export function completeTask(doc: Document, id: string, index: number, now: Date = new Date()): Event {
  const item = requireItem(doc, id);
  const task = requireTask(item, index);
  item.tasks.splice(index, 1);
  const event = appendEvent(item, `${DONE_PREFIX}${task.text}`, timestampFromDate(now));
  event.children = task.children;
  return event;
}

export function reopenTask(doc: Document, id: string, eventIndex: number): Task {
  const item = requireItem(doc, id);
  const event = item.events[eventIndex];
  if (!event || !event.text.startsWith(DONE_PREFIX)) throw new Error(`Not a Done event: ${item.id ?? item.name} #${eventIndex}`);
  item.events.splice(eventIndex, 1);
  // A following event without its own stamp would otherwise inherit from the one before.
  const next = item.events[eventIndex];
  if (next && !next.explicit && event.at) {
    next.explicit = true;
    next.at = event.at;
  }
  const last = item.tasks[item.tasks.length - 1];
  const task: Task = { format: last ? { ...last.format } : childFormat(item), text: event.text.slice(DONE_PREFIX.length), children: event.children };
  item.tasks.push(task);
  return task;
}

export function addInfo(doc: Document, id: string, text: string): Info {
  const item = requireItem(doc, id);
  const info: Info = { format: childFormat(item), text, children: [] };
  item.info.push(info);
  return info;
}

/** Replaces all info lines. The first lines keep their format and sub-lines, extra lines take the usual child format. */
export function setInfo(doc: Document, id: string, lines: string[]): Info[] {
  const item = requireItem(doc, id);
  const fallback = childFormat(item);
  const old = item.info;
  item.info = lines.map((text, i): Info => {
    const prev = old[i];
    return prev ? { format: prev.format, text, children: prev.children } : { format: { ...fallback }, text, children: [] };
  });
  return item.info;
}

export function rename(doc: Document, id: string, name: string): void {
  const target = findItem(doc, id)?.item ?? findWorkstream(doc, id);
  if (!target) throw new Error(`Item or workstream not found: ${id}`);
  target.name = name.trim();
}

function newItem(format: LineFormat, name: string, id: string | undefined, lane: Lane): Item {
  const item: Item = { kind: "item", format, checkbox: true, name, lane, tasks: [], info: [], events: [] };
  if (id !== undefined) item.id = id;
  return item;
}

export function addItem(doc: Document, name: string, opts: AddItemOptions = {}): Item {
  const parent = opts.parentId === undefined ? undefined : requireWorkstream(doc, opts.parentId);
  const ids = opts.ids ?? usedIds(doc);
  const item = newItem(itemFormat(doc, parent), name.trim(), newId("it", ids), opts.lane ?? "now");
  if (opts.status !== undefined && opts.status.trim() !== "") item.status = opts.status.trim();
  if (parent) parent.children.push(item);
  else doc.nodes.push(item);
  return item;
}

export function addWorkstream(doc: Document, name: string, ids: Set<string> = usedIds(doc)): Workstream {
  const ws: Workstream = { kind: "workstream", format: topLevelFormat(doc), id: newId("ws", ids), name: name.trim(), children: [] };
  doc.nodes.push(ws);
  return ws;
}

/** `index` counts entries in the target's child list as stored, opaque lines included, after the item is removed. */
export function move(doc: Document, id: string, parentId: string | undefined, index: number): void {
  const found = findItem(doc, id);
  if (!found) throw new Error(`Item not found: ${id}`);
  const parent = parentId === undefined ? undefined : requireWorkstream(doc, parentId);
  const item = found.item;

  const from: Array<Node | Item> = found.workstream ? found.workstream.children : doc.nodes;
  from.splice(from.indexOf(item), 1);

  const target = itemFormat(doc, parent, item);
  const oldIndent = item.format.indent;
  item.format.marker = target.marker;
  reindentItem(item, oldIndent, target.indent);

  const into: Array<Node | Item> = parent ? parent.children : doc.nodes;
  into.splice(Math.max(0, Math.min(index, into.length)), 0, item);
}

/** `index` counts all top-level nodes as stored, opaque lines included, after the workstream is removed. */
export function moveWorkstream(doc: Document, id: string, index: number): void {
  const ws = requireWorkstream(doc, id);
  doc.nodes.splice(doc.nodes.indexOf(ws), 1);
  doc.nodes.splice(Math.max(0, Math.min(index, doc.nodes.length)), 0, ws);
}

/** Position directly after sibling `afterId`, or before the first item or workstream when null. Opaque lines such as headings stay above. */
function slotAfter(list: Array<Node | Item>, afterId: string | null): number {
  if (afterId === null) return Math.max(0, list.findIndex((n) => n.kind !== "opaque"));
  const at = list.findIndex((n) => n.kind !== "opaque" && n.id === afterId);
  if (at < 0) throw new Error(`Sibling not found: ${afterId}`);
  return at + 1;
}

/** Places the item right after sibling `afterId` in the target container, or first when null. Dropping it after itself changes nothing. */
export function moveItemAfter(doc: Document, id: string, parentId: string | undefined, afterId: string | null): void {
  const found = findItem(doc, id);
  if (!found) throw new Error(`Item not found: ${id}`);
  const parent = parentId === undefined ? undefined : requireWorkstream(doc, parentId);
  if (afterId === id) return;
  const list: Array<Node | Item> = parent ? parent.children : doc.nodes;
  const rest = list.filter((n) => n !== found.item);
  move(doc, id, parentId, slotAfter(rest, afterId));
}

/** Places the workstream right after workstream `afterId`, or first when null. */
export function moveWorkstreamAfter(doc: Document, id: string, afterId: string | null): void {
  const ws = requireWorkstream(doc, id);
  if (afterId === id) return;
  if (afterId !== null) requireWorkstream(doc, afterId);
  const rest = doc.nodes.filter((n) => n !== ws);
  const at = afterId === null ? rest.findIndex((n) => n.kind === "workstream") : rest.findIndex((n) => n.kind === "workstream" && n.id === afterId) + 1;
  moveWorkstream(doc, id, Math.max(0, at));
}

export function importBullet(doc: Document, text: string, parentId?: string, opts: ImportOptions = {}): Workstream | Item {
  const now = opts.now ?? new Date();
  const parsed = parse(text, { today: timestampFromDate(now, false).date });
  const node = parsed.nodes.find((n): n is Item | Workstream => n.kind !== "opaque");
  if (!node) throw new Error("No bullet found in the text to import");
  const ids = opts.ids ?? usedIds(doc);
  const claim = (kind: "ws" | "it", existing: string | undefined): string => {
    if (existing !== undefined && !ids.has(existing)) {
      ids.add(existing);
      return existing;
    }
    return newId(kind, ids, opts.random);
  };
  const from = node.format.indent;

  if (node.kind === "workstream") {
    node.id = claim("ws", node.id);
    node.format = { indent: "", marker: topLevelFormat(doc).marker };
    for (const child of node.children) {
      if (child.kind !== "item") continue;
      child.id = claim("it", child.id);
      child.checkbox = true;
      reindentItem(child, from, "");
    }
    doc.nodes.push(node);
    return node;
  }

  const parent = parentId === undefined ? undefined : requireWorkstream(doc, parentId);
  const target = itemFormat(doc, parent);
  node.id = claim("it", node.id);
  node.checkbox = true;
  if (opts.lane) node.lane = opts.lane;
  node.format.marker = target.marker;
  reindentItem(node, from, target.indent);
  if (parent) parent.children.push(node);
  else doc.nodes.push(node);
  return node;
}

/** `reserved` holds ids that must not be handed out again, such as those already in the archive. */
export function ensureIds(doc: Document, random?: () => number, reserved?: Iterable<string>): number {
  const used = usedIds(doc);
  if (reserved) for (const id of reserved) used.add(id);
  let count = 0;
  for (const node of doc.nodes) {
    if (node.kind === "workstream") {
      if (!node.id) {
        node.id = newId("ws", used, random);
        count++;
      }
      for (const child of node.children) {
        if (child.kind === "item" && !child.id) {
          child.id = newId("it", used, random);
          count++;
        }
      }
    } else if (node.kind === "item" && !node.id) {
      node.id = newId("it", used, random);
      count++;
    }
  }
  return count;
}
