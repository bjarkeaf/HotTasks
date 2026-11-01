export type Lane = "now" | "later" | "done";

/** A point in time as written in the file. `time` is absent for date-only values. */
export interface Timestamp {
  date: string;
  time?: string;
}

/** Formatting carried on every bullet so the file comes back unchanged. */
export interface LineFormat {
  indent: string;
  marker: string;
}

export interface Task {
  format: LineFormat;
  text: string;
  notBefore?: Timestamp;
  children: string[];
}

export interface Fact {
  format: LineFormat;
  text: string;
  children: string[];
}

export interface Event {
  format: LineFormat;
  text: string;
  /** Resolved time. Absent only when nothing above it had a timestamp either. */
  at?: Timestamp;
  /** True when the line carried its own timestamp, false when inherited. */
  explicit: boolean;
  children: string[];
}

export interface Item {
  kind: "item";
  format: LineFormat;
  /** True when the line had a checkbox. Plain bullets that turn out to be items get one on save. */
  checkbox: boolean;
  id?: string;
  name: string;
  status?: string;
  lane: Lane;
  /** Non-bullet lines directly under the item line, kept verbatim. */
  lead?: string[];
  task?: Task;
  facts: Fact[];
  events: Event[];
}

export interface Workstream {
  kind: "workstream";
  format: LineFormat;
  id?: string;
  name: string;
  children: Array<Item | Opaque>;
}

/** Any line the model does not understand. Kept in place, written back verbatim. */
export interface Opaque {
  kind: "opaque";
  text: string;
}

export type Node = Workstream | Item | Opaque;

export interface Document {
  nodes: Node[];
  /** Line ending in use, preserved on save. */
  eol: "\n" | "\r\n";
  /** True when the file ended with a line ending. */
  trailingNewline: boolean;
}

export const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export const ID_LENGTH = 4;

export type IdKind = "ws" | "it";

export function isId(value: string, kind?: IdKind): boolean {
  const prefix = kind ? kind : "(?:ws|it)";
  return new RegExp(`^${prefix}-[a-z0-9]{${ID_LENGTH}}$`).test(value);
}

/** Random IDs, retried until unused. `random` is injectable for tests. */
export function newId(kind: IdKind, used: Set<string>, random: () => number = Math.random): string {
  for (;;) {
    let body = "";
    for (let i = 0; i < ID_LENGTH; i++) {
      body += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)];
    }
    const id = `${kind}-${body}`;
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
}

export function* items(doc: Document): Generator<{ item: Item; workstream?: Workstream }> {
  for (const node of doc.nodes) {
    if (node.kind === "item") yield { item: node };
    if (node.kind === "workstream") {
      for (const child of node.children) {
        if (child.kind === "item") yield { item: child, workstream: node };
      }
    }
  }
}

export function* workstreams(doc: Document): Generator<Workstream> {
  for (const node of doc.nodes) if (node.kind === "workstream") yield node;
}

export function usedIds(doc: Document): Set<string> {
  const used = new Set<string>();
  for (const ws of workstreams(doc)) if (ws.id) used.add(ws.id);
  for (const { item } of items(doc)) if (item.id) used.add(item.id);
  return used;
}

export function findItem(doc: Document, id: string): { item: Item; workstream?: Workstream } | undefined {
  for (const entry of items(doc)) if (entry.item.id === id) return entry;
  return undefined;
}

export function findWorkstream(doc: Document, id: string): Workstream | undefined {
  for (const ws of workstreams(doc)) if (ws.id === id) return ws;
  return undefined;
}

export function compareTimestamps(a: Timestamp, b: Timestamp): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const at = a.time ?? "24:00";
  const bt = b.time ?? "24:00";
  if (at === bt) return 0;
  return at < bt ? -1 : 1;
}

/** Milliseconds since epoch, local time. A date with no time counts as the end of that day. */
export function timestampToMillis(ts: Timestamp): number {
  const [y, m, d] = ts.date.split("-").map(Number) as [number, number, number];
  if (ts.time === undefined) return new Date(y, m - 1, d + 1).getTime() - 1;
  const [hh, mm] = ts.time.split(":").map(Number) as [number, number];
  return new Date(y, m - 1, d, hh, mm).getTime();
}

export function timestampFromDate(d: Date, withTime = true): Timestamp {
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime ? { date, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` } : { date };
}
