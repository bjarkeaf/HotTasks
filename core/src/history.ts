import type { Document, Event, Timestamp } from "./model.js";
import { compareTimestamps, findItem, items } from "./model.js";
import { parse } from "./parse.js";
import { parseArchive } from "./archive.js";

export interface HistoryEvent {
  at?: Timestamp;
  text: string;
  source: "live" | "archive";
}

const ITEM_LINE = /^[-*+][ \t]+\[[ >xX]\][ \t]/;
const FLOOR: Timestamp = { date: "0000-00-00" };

function archivedEvents(lines: string[]): Event[] {
  const text = ITEM_LINE.test(lines[0] ?? "") ? lines.join("\n") : ["- [ ] x", ...lines.map((l) => `\t${l}`)].join("\n");
  const first = [...items(parse(text, { today: "1970-01-01" }))][0];
  return first ? first.item.events : [];
}

export function history(doc: Document, archiveText: string, id: string): HistoryEvent[] {
  const keyed: Array<{ key: Timestamp; event: HistoryEvent }> = [];
  const add = (events: Event[], source: "live" | "archive") => {
    let key = FLOOR;
    for (const e of events) {
      if (e.at) key = e.at;
      const event: HistoryEvent = { text: e.text, source };
      if (e.at) event.at = e.at;
      keyed.push({ key, event });
    }
  };
  for (const entry of parseArchive(archiveText)) if (entry.id === id) add(archivedEvents(entry.lines), "archive");
  const live = findItem(doc, id);
  if (live) add(live.item.events, "live");
  return keyed.sort((a, b) => compareTimestamps(a.key, b.key)).map((k) => k.event);
}

export function currentName(doc: Document, archiveText: string, id: string): string | undefined {
  const live = findItem(doc, id);
  if (live) return live.item.name;
  let newest: { date: string; name: string } | undefined;
  for (const entry of parseArchive(archiveText)) {
    if (entry.id === id && (!newest || entry.date >= newest.date)) newest = entry;
  }
  return newest?.name;
}
