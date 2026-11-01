import type { Document, Event, Fact, Item, Lane, Node, Task, Timestamp, Workstream } from "./model.js";

function box(lane: Lane): string {
  switch (lane) {
    case "now":
      return "[ ]";
    case "later":
      return "[>]";
    case "done":
      return "[x]";
  }
}

export function formatTimestamp(ts: Timestamp): string {
  return ts.time === undefined ? ts.date : `${ts.date} ${ts.time}`;
}

function head(name: string, status: string | undefined, id: string | undefined): string {
  let s = name;
  if (status !== undefined) s += `: *${status}*`;
  if (id !== undefined) s = s === "" ? `^${id}` : `${s} ^${id}`;
  return s;
}

function taskLines(t: Task, out: string[]): void {
  let line = `${t.format.indent}${t.format.marker} **${t.text}**`;
  if (t.notBefore) line += ` @${t.notBefore.date}`;
  out.push(line, ...t.children);
}

function factLines(f: Fact, out: string[]): void {
  out.push(`${f.format.indent}${f.format.marker} ${f.text}`, ...f.children);
}

function eventLines(e: Event, out: string[]): void {
  let body = e.text;
  if (e.explicit && e.at) body = body === "" ? `@${formatTimestamp(e.at)}` : `@${formatTimestamp(e.at)} ${body}`;
  out.push(`${e.format.indent}${e.format.marker} ${body}`, ...e.children);
}

function itemLines(it: Item, out: string[]): void {
  out.push(`${it.format.indent}${it.format.marker} ${box(it.lane)} ${head(it.name, it.status, it.id)}`.trimEnd());
  if (it.lead) out.push(...it.lead);
  if (it.task) taskLines(it.task, out);
  for (const f of it.facts) factLines(f, out);
  for (const e of it.events) eventLines(e, out);
}

function workstreamLines(ws: Workstream, out: string[]): void {
  out.push(`${ws.format.indent}${ws.format.marker} ${head(ws.name, undefined, ws.id)}`);
  for (const c of ws.children) {
    if (c.kind === "opaque") out.push(c.text);
    else itemLines(c, out);
  }
}

function nodeLines(n: Node, out: string[]): void {
  switch (n.kind) {
    case "opaque":
      out.push(n.text);
      return;
    case "item":
      itemLines(n, out);
      return;
    case "workstream":
      workstreamLines(n, out);
      return;
  }
}

export function serialize(doc: Document): string {
  const out: string[] = [];
  for (const n of doc.nodes) nodeLines(n, out);
  let text = out.join(doc.eol);
  if (doc.trailingNewline) text += doc.eol;
  return text;
}
