import type { Document, Event, Info, Item, Lane, LineFormat, Node, Opaque, Task, Timestamp, Workstream } from "./model.js";
import { timestampFromDate } from "./model.js";

export interface ParseOptions {
  /** Date used to resolve bare `@HH:MM` timestamps. Defaults to the current local date. */
  today?: string;
}

const BULLET = /^([ \t]*)([-*+])[ \t]+(.*)$/;
const HEADING = /^#{1,6}[ \t]/;
const CHECKBOX = /^\[( |>|x|X)\](?:[ \t]+(.*))?$/;
const TRAILING_ID = /(?:^|[ \t]+)\^((?:ws|it)-[a-z0-9]{4})[ \t]*$/;
const TRAILING_STATUS = /^(.*?):[ \t]+(?:\*([^*]+)\*|_([^_]+)_)[ \t]*$/;
const BOLD_LINE = /^\*\*(.+?)\*\*(?:[ \t]+@(\d{4}-\d{2}-\d{2}))?[ \t]*$/;
const FULL_STAMP = /^@(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?(?:[ \t]+(.*))?$/;
const BARE_STAMP = /^@(\d{1,2}:\d{2})(?:[ \t]+(.*))?$/;

interface RawBullet {
  format: LineFormat;
  checkbox?: string;
  text: string;
  width: number;
  bullets: RawBullet[];
  /** Non-bullet lines indented under this bullet, kept verbatim. */
  loose: string[];
}

function indentWidth(indent: string): number {
  let w = 0;
  for (const ch of indent) w += ch === "\t" ? 4 : 1;
  return w;
}

function normalizeTime(t: string): string {
  const [h, m] = t.split(":") as [string, string];
  return `${h.padStart(2, "0")}:${m}`;
}

function laneFromHeading(text: string): Lane {
  const lower = text.toLowerCase();
  if (/\bdone\b/.test(lower)) return "done";
  if (/\blater\b/.test(lower) || /not urgent/.test(lower)) return "later";
  return "now";
}

/** A checkbox is authoritative. Only a bullet with no checkbox takes its lane from the heading above it. */
function laneFromCheckbox(box: string | undefined, context: Lane): Lane {
  if (box === "x" || box === "X") return "done";
  if (box === ">") return "later";
  if (box === undefined) return context;
  return "now";
}

/** Splits the file into top-level groups: either a bullet tree or a single opaque line. */
function group(lines: string[]): Array<RawBullet | string> {
  const out: Array<RawBullet | string> = [];
  let stack: RawBullet[] = [];
  // Blank lines wait until the next line shows whether they sit inside a tree or after it.
  let pending: string[] = [];
  const flushInside = () => {
    if (pending.length === 0) return;
    stack[stack.length - 1]!.loose.push(...pending);
    pending = [];
  };
  const flushOutside = () => {
    out.push(...pending);
    pending = [];
  };
  for (const line of lines) {
    const m = BULLET.exec(line);
    if (!m || HEADING.test(line)) {
      if (HEADING.test(line) || stack.length === 0) {
        flushOutside();
        out.push(line);
        stack = [];
      } else if (line.trim() === "") {
        pending.push(line);
      } else {
        flushInside();
        stack[stack.length - 1]!.loose.push(line);
      }
      continue;
    }
    const [, indent, marker, rest] = m as unknown as [string, string, string, string];
    const width = indentWidth(indent);
    if (stack.length > 0 && width > 0 && width > stack[0]!.width) flushInside();
    else flushOutside();
    const cb = CHECKBOX.exec(rest);
    const bullet: RawBullet = {
      format: { indent, marker },
      text: cb ? (cb[2] ?? "") : rest,
      width,
      bullets: [],
      loose: []
    };
    if (cb) bullet.checkbox = cb[1]!;
    while (stack.length > 0 && stack[stack.length - 1]!.width >= width) stack.pop();
    if (stack.length === 0) out.push(bullet);
    else stack[stack.length - 1]!.bullets.push(bullet);
    stack.push(bullet);
  }
  flushOutside();
  return out;
}

function splitHead(text: string): { name: string; status?: string; id?: string } {
  let rest = text;
  let id: string | undefined;
  const idm = TRAILING_ID.exec(rest);
  if (idm) {
    id = idm[1]!;
    rest = rest.slice(0, idm.index);
  }
  let status: string | undefined;
  const sm = TRAILING_STATUS.exec(rest);
  if (sm) {
    status = (sm[2] ?? sm[3])!.trim();
    rest = sm[1]!;
  }
  const result: { name: string; status?: string; id?: string } = { name: rest.trim() };
  if (status !== undefined) result.status = status;
  if (id !== undefined) result.id = id;
  return result;
}

/** Flattens a content bullet's own sub-bullets and loose lines back to raw text. */
function rawChildren(b: RawBullet): string[] {
  const out: string[] = [];
  const walk = (x: RawBullet) => {
    for (const child of x.bullets) {
      const box = child.checkbox !== undefined ? `[${child.checkbox}] ` : "";
      out.push(`${child.format.indent}${child.format.marker} ${box}${child.text}`);
      out.push(...child.loose);
      walk(child);
    }
  };
  out.push(...b.loose);
  walk(b);
  return out;
}

function isItemLike(b: RawBullet): boolean {
  if (b.checkbox !== undefined) return true;
  return b.bullets.some((c) => BOLD_LINE.test(c.text) || FULL_STAMP.test(c.text) || BARE_STAMP.test(c.text));
}

function buildItem(b: RawBullet, context: Lane, today: string): Item {
  const head = splitHead(b.text);
  const item: Item = {
    kind: "item",
    format: b.format,
    checkbox: b.checkbox !== undefined,
    name: head.name,
    lane: laneFromCheckbox(b.checkbox, context),
    tasks: [],
    info: [],
    events: []
  };
  if (head.id) item.id = head.id;
  if (head.status !== undefined) item.status = head.status;

  if (b.loose.length > 0) item.lead = b.loose;

  let lastStamp: Timestamp | undefined;
  for (const c of b.bullets) {
    const children = rawChildren(c);
    if (c.checkbox !== undefined) {
      // A checkbox nested under an item is kept as text so nothing is lost.
      const text = `[${c.checkbox}] ${c.text}`.trimEnd();
      if (item.events.length === 0) item.info.push({ format: c.format, text, children });
      else {
        const ev: Event = { format: c.format, text, explicit: false, children };
        if (lastStamp) ev.at = lastStamp;
        item.events.push(ev);
      }
      continue;
    }
    const bold = BOLD_LINE.exec(c.text);
    if (bold && item.events.length === 0) {
      const task: Task = { format: c.format, text: bold[1]!, children };
      if (bold[2]) task.notBefore = { date: bold[2] };
      item.tasks.push(task);
      continue;
    }
    const full = FULL_STAMP.exec(c.text);
    const bare = full ? null : BARE_STAMP.exec(c.text);
    if (full || bare) {
      let at: Timestamp;
      let text: string;
      if (full) {
        at = full[2] ? { date: full[1]!, time: normalizeTime(full[2]) } : { date: full[1]! };
        text = full[3] ?? "";
      } else {
        at = { date: today, time: normalizeTime(bare![1]!) };
        text = bare![2] ?? "";
      }
      lastStamp = at;
      const ev: Event = { format: c.format, text, at, explicit: true, children };
      item.events.push(ev);
      continue;
    }
    if (item.events.length === 0) {
      const info: Info = { format: c.format, text: c.text, children };
      item.info.push(info);
    } else {
      const ev: Event = { format: c.format, text: c.text, explicit: false, children };
      if (lastStamp) ev.at = lastStamp;
      item.events.push(ev);
    }
  }
  return item;
}

function buildWorkstream(b: RawBullet, context: Lane, today: string): Workstream {
  const head = splitHead(b.text);
  const ws: Workstream = { kind: "workstream", format: b.format, name: head.name, children: [] };
  if (head.id) ws.id = head.id;
  if (head.status !== undefined) ws.name = `${ws.name}: *${head.status}*`;
  for (const line of b.loose) ws.children.push({ kind: "opaque", text: line });
  for (const c of b.bullets) ws.children.push(buildItem(c, context, today));
  return ws;
}

function buildTop(b: RawBullet, context: Lane, today: string): Node {
  if (b.checkbox !== undefined) return buildItem(b, context, today);
  const id = TRAILING_ID.exec(b.text)?.[1];
  if (id?.startsWith("ws-")) return buildWorkstream(b, context, today);
  if (id?.startsWith("it-")) return buildItem(b, context, today);
  if (b.bullets.some(isItemLike)) return buildWorkstream(b, context, today);
  return buildItem(b, context, today);
}

export function parse(text: string, options: ParseOptions = {}): Document {
  const today = options.today ?? timestampFromDate(new Date(), false).date;
  const eol: "\n" | "\r\n" = text.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = text.endsWith("\n");
  const body = text.endsWith("\r\n") ? text.slice(0, -2) : trailingNewline ? text.slice(0, -1) : text;
  const lines = body === "" ? [] : body.split(/\r?\n/);

  const nodes: Node[] = [];
  let context: Lane = "now";
  for (const g of group(lines)) {
    if (typeof g === "string") {
      if (HEADING.test(g)) context = laneFromHeading(g.replace(/^#+/, ""));
      const op: Opaque = { kind: "opaque", text: g };
      nodes.push(op);
      continue;
    }
    nodes.push(buildTop(g, context, today));
  }
  return { nodes, eol, trailingNewline };
}
