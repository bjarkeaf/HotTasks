import type { Document, Event, Item, LineFormat, Node, Timestamp, Workstream } from "./model.js";
import { compareTimestamps } from "./model.js";
import { serialize } from "./serialize.js";

export interface ArchiveEntry {
  date: string;
  id: string;
  name: string;
  workstream?: string;
  /** Raw bullet lines, first-level lines at column 0, deeper lines keep their relative indentation. */
  lines: string[];
}

export interface SweepOptions {
  today: string;
  keepEvents: number;
  snapshot?: boolean;
}

export interface SweepResult {
  doc: Document;
  archiveText: string;
  archivedItems: string[];
  trimmedItems: string[];
}

const DAY_HEADING = /^##[ \t]+(\S+)[ \t]*$/;
const ENTRY_HEADING = /^###[ \t]+((?:ws|it)-[a-z0-9]{4})(?:[ \t]+(.*))?$/;
const TRAILING_WORKSTREAM = /^(.*?)[ \t]+\(([^()]*)\)$/;

function splitText(text: string): { lines: string[]; eol: string } {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const body = text.endsWith("\n") ? text.slice(0, text.length - eol.length) : text;
  return { lines: text === "" ? [] : body.split(eol), eol };
}

function headingLine(entry: Pick<ArchiveEntry, "id" | "name" | "workstream">): string {
  const ws = entry.workstream !== undefined ? ` (${entry.workstream})` : "";
  return `### ${entry.id} ${entry.name}${ws}`;
}

function splitHeading(rest: string): { name: string; workstream?: string } {
  const m = TRAILING_WORKSTREAM.exec(rest);
  if (!m) return { name: rest };
  return { name: m[1]!, workstream: m[2]! };
}

export function parseArchive(text: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  let date: string | undefined;
  let current: ArchiveEntry | undefined;
  for (const line of splitText(text).lines) {
    const day = DAY_HEADING.exec(line);
    if (day) {
      date = day[1]!;
      current = undefined;
      continue;
    }
    const head = ENTRY_HEADING.exec(line);
    if (head && date !== undefined) {
      const { name, workstream } = splitHeading((head[2] ?? "").trim());
      current = { date, id: head[1]!, name, lines: [] };
      if (workstream !== undefined) current.workstream = workstream;
      entries.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  for (const e of entries) while (e.lines.length > 0 && e.lines[e.lines.length - 1]!.trim() === "") e.lines.pop();
  return entries;
}

function entryBlock(entry: ArchiveEntry): string[] {
  return [headingLine(entry), ...entry.lines];
}

export function serializeArchive(entries: ArchiveEntry[]): string {
  const out: string[] = [];
  let date: string | undefined;
  for (const entry of entries) {
    if (entry.date !== date) {
      if (out.length > 0) out.push("");
      out.push(`## ${entry.date}`, "");
      date = entry.date;
    } else {
      out.push("");
    }
    out.push(...entryBlock(entry));
  }
  return out.length === 0 ? "" : out.join("\n") + "\n";
}

export function appendArchive(text: string, entries: ArchiveEntry[]): string {
  if (entries.length === 0) return text;
  const { lines, eol } = splitText(text);
  const dates: string[] = [];
  for (const e of entries) if (!dates.includes(e.date)) dates.push(e.date);

  for (const date of dates) {
    const block: string[] = [];
    for (const e of entries.filter((x) => x.date === date)) block.push("", ...entryBlock(e));
    const start = lines.findIndex((l) => DAY_HEADING.exec(l)?.[1] === date);
    if (start < 0) {
      if (lines.length > 0 && lines[lines.length - 1]!.trim() !== "") lines.push("");
      lines.push(`## ${date}`, ...block);
      continue;
    }
    let end = start + 1;
    while (end < lines.length && !DAY_HEADING.test(lines[end]!)) end++;
    let insertAt = end;
    while (insertAt > start + 1 && lines[insertAt - 1]!.trim() === "") insertAt--;
    lines.splice(insertAt, 0, ...block);
  }
  return lines.join(eol) + eol;
}

export function renameInArchive(text: string, id: string, newName: string): string {
  const { lines, eol } = splitText(text);
  let changed = false;
  const out = lines.map((line) => {
    const head = ENTRY_HEADING.exec(line);
    if (!head || head[1] !== id) return line;
    changed = true;
    const { workstream } = splitHeading((head[2] ?? "").trim());
    return headingLine(workstream !== undefined ? { id, name: newName, workstream } : { id, name: newName });
  });
  if (!changed) return text;
  return out.join(eol) + (text.endsWith("\n") ? eol : "");
}

function deindent(lines: string[], base: string): string[] {
  return lines.map((l) => (l.startsWith(base) ? l.slice(base.length) : l));
}

function renderLines(item: Item): string[] {
  const tmp: Document = { nodes: [item], eol: "\n", trailingNewline: false };
  return serialize(tmp).split("\n");
}

function doneTime(item: Item): Timestamp | undefined {
  let done: Timestamp | undefined;
  for (const e of item.events) {
    if (e.text.trim() === "Done" && e.at && (!done || compareTimestamps(e.at, done) > 0)) done = e.at;
  }
  if (done) return done;
  for (const e of item.events) if (e.at && (!done || compareTimestamps(e.at, done) > 0)) done = e.at;
  return done;
}

function isArchivable(item: Item, today: string): boolean {
  if (item.lane !== "done" || item.id === undefined) return false;
  const at = doneTime(item);
  return at === undefined || at.date < today;
}

function eventFormat(item: Item): LineFormat {
  const last = [...item.events, ...item.info, ...item.tasks]
    .reverse()
    .find((x) => x.format.marker !== "");
  return last ? last.format : { indent: `${item.format.indent}\t`, marker: "-" };
}

function mapItems(doc: Document, fn: (item: Item, ws?: Workstream) => Item | undefined): Document {
  const nodes: Node[] = [];
  for (const node of doc.nodes) {
    if (node.kind === "item") {
      const next = fn(node);
      if (next) nodes.push(next);
    } else if (node.kind === "workstream") {
      const children: Workstream["children"] = [];
      for (const child of node.children) {
        if (child.kind !== "item") {
          children.push(child);
          continue;
        }
        const next = fn(child, node);
        if (next) children.push(next);
      }
      nodes.push({ ...node, children });
    } else {
      nodes.push(node);
    }
  }
  return { ...doc, nodes };
}

function entryFor(item: Item, ws: Workstream | undefined, date: string, lines: string[]): ArchiveEntry {
  const entry: ArchiveEntry = { date, id: item.id!, name: item.name, lines };
  if (ws) entry.workstream = ws.name;
  return entry;
}

export function sweep(doc: Document, archiveText: string, opts: SweepOptions): SweepResult {
  const { today } = opts;
  const keep = Math.max(0, opts.keepEvents);
  const entries: ArchiveEntry[] = [];
  const archivedItems: string[] = [];
  const trimmedItems: string[] = [];

  const afterArchive = mapItems(doc, (item, ws) => {
    if (!isArchivable(item, today)) return item;
    const archived: Event = {
      format: eventFormat(item),
      text: "Archived",
      at: { date: today, time: "00:00" },
      explicit: true,
      children: []
    };
    const lines = deindent(renderLines({ ...item, events: [...item.events, archived] }), item.format.indent);
    entries.push(entryFor(item, ws, today, lines));
    archivedItems.push(item.id!);
    return undefined;
  });

  const afterTrim = mapItems(afterArchive, (item, ws) => {
    const excess = item.events.length - keep;
    if (excess <= 0 || item.id === undefined) return item;
    const removed = item.events.slice(0, excess).map((e): Event => (e.explicit || !e.at ? e : { ...e, explicit: true }));
    const kept = item.events.slice(excess).map((e, i): Event => (i === 0 && !e.explicit && e.at ? { ...e, explicit: true } : e));
    const head: Item = {
      kind: "item",
      format: item.format,
      checkbox: item.checkbox,
      name: item.name,
      lane: item.lane,
      tasks: [],
      info: [],
      events: removed
    };
    const lines = deindent(renderLines(head).slice(1), removed[0]!.format.indent);
    entries.push(entryFor(item, ws, today, lines));
    trimmedItems.push(item.id);
    return { ...item, events: kept };
  });

  return { doc: afterTrim, archiveText: appendArchive(archiveText, entries), archivedItems, trimmedItems };
}
