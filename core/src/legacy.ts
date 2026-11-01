import type { Document, Event, Info, Item, Timestamp } from "./model.js";
import { items, workstreams } from "./model.js";
import { parse } from "./parse.js";
import { serialize } from "./serialize.js";

/**
 * Converts task lists written before HotTasks existed: dates in parentheses or as DD/MM,
 * bare times at the end of a line, the task written last, bold names on top-level bullets.
 */

const DAY_WORDS = /\b(?:today|yesterday|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const TIME = String.raw`(\d{1,2}):(\d{2})`;
const ISO_IN_PARENS = new RegExp(String.raw`(?:\b(?:on|at|today|yesterday|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+)?\((\d{4})-(\d{2})-(\d{2})\)(?:,?\s*(?:at\s+)?${TIME})?`, "i");
const DAY_MONTH = new RegExp(String.raw`(?:^|[\s,(])(\d{1,2})/(\d{1,2})(?:,?\s+(?:at\s+)?${TIME})?(?=$|[\s,).])`);
const BARE_TIME = new RegExp(String.raw`(?:^|[\s,])(?:at\s+)?${TIME}\s*$`);

export interface LegacyExtract {
  text: string;
  at?: Timestamp;
}

function pad(n: string): string {
  return n.padStart(2, "0");
}

function tidy(text: string): string {
  return text
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*$/, "")
    .replace(/^\s*,\s*/, "")
    .trim();
}

/** Pulls a legacy date or time out of a line. `noteDate` supplies the year or the day when the line has none. */
export function extractLegacyTimestamp(line: string, noteDate: string): LegacyExtract {
  const year = noteDate.slice(0, 4);
  let m = ISO_IN_PARENS.exec(line);
  if (m) {
    const at: Timestamp = { date: `${m[1]}-${m[2]}-${m[3]}` };
    if (m[4] !== undefined) at.time = `${pad(m[4])}:${m[5]}`;
    return { text: tidy(line.slice(0, m.index) + " " + line.slice(m.index + m[0].length)), at };
  }
  m = DAY_MONTH.exec(line);
  if (m) {
    const at: Timestamp = { date: `${year}-${pad(m[2]!)}-${pad(m[1]!)}` };
    if (m[3] !== undefined) at.time = `${pad(m[3])}:${m[4]}`;
    const lead = /^[\s,(]/.test(m[0]) ? 1 : 0;
    return { text: tidy(line.slice(0, m.index + lead) + line.slice(m.index + m[0].length)), at };
  }
  if (!DAY_WORDS.test(line)) {
    m = BARE_TIME.exec(line);
    if (m) {
      const at: Timestamp = { date: noteDate, time: `${pad(m[1]!)}:${m[2]}` };
      return { text: tidy(line.slice(0, m.index)), at };
    }
  }
  return { text: line };
}

function stripBold(name: string): string {
  const m = /^\*\*(.+)\*\*$/.exec(name.trim());
  return m ? m[1]! : name;
}

function reclassify(item: Item, noteDate: string): void {
  const lines: Array<Info | Event> = [...item.info, ...item.events];
  const info: Info[] = [];
  const events: Event[] = [];
  let last: Timestamp | undefined;
  for (const line of lines) {
    const explicitEvent = "explicit" in line && line.explicit;
    const { text, at } = explicitEvent ? { text: line.text, at: (line as Event).at } : extractLegacyTimestamp(line.text, noteDate);
    if (at) {
      last = at;
      events.push({ format: line.format, text, at, explicit: true, children: line.children });
    } else if (events.length === 0) {
      info.push({ format: line.format, text, children: line.children });
    } else {
      const ev: Event = { format: line.format, text, explicit: false, children: line.children };
      if (last) ev.at = last;
      events.push(ev);
    }
  }
  item.info = info;
  item.events = events;
  item.name = stripBold(item.name);
  for (const task of item.tasks) {
    const m = /^(.*?)(?:\s+(?:on\s+)?)?\b(\d{4}-\d{2}-\d{2})\b\s*$/.exec(task.text);
    if (m && !task.notBefore) {
      task.text = m[1]!.replace(/[(,\s]+$/, "").trim();
      task.notBefore = { date: m[2]! };
    }
  }
}

/** Rewrites a legacy document in place so that serialize() gives canonical markup. */
export function migrateLegacy(doc: Document, noteDate: string): Document {
  for (const ws of workstreams(doc)) ws.name = stripBold(ws.name);
  for (const { item } of items(doc)) reclassify(item, noteDate);
  return doc;
}

/** Convenience for scripts: legacy text in, canonical text out. */
export function migrateLegacyText(text: string, noteDate: string): string {
  return serialize(migrateLegacy(parse(text, { today: noteDate }), noteDate));
}
