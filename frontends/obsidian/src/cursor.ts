import type { Document, Item } from "@hottasks/core";
import { items } from "@hottasks/core";

export interface ItemLine {
  /** Zero-based line number in the text. */
  line: number;
  item: Item;
}

const CHECKBOX_LINE = /^([ \t]*)[-*+][ \t]+\[[ >xX]\][ \t]/;
const BULLET_LINE = /^([ \t]*)[-*+][ \t]/;
const HEADING_LINE = /^#{1,6}[ \t]/;
const LINE_ID = /\^((?:ws|it)-[a-z0-9]{4})[ \t]*$/;

function width(indent: string): number {
  let w = 0;
  for (const ch of indent) w += ch === "\t" ? 4 : 1;
  return w;
}

/** Pairs each item line in the text with its parsed item. Empty when the two disagree, so callers never act on the wrong item. */
export function itemLines(text: string, doc: Document): ItemLine[] {
  const lines = text.split(/\r?\n/);
  const candidates: number[] = [];
  let itemWidth: number | undefined;
  lines.forEach((line, i) => {
    const box = CHECKBOX_LINE.exec(line);
    if (box) {
      const w = width(box[1]!);
      if (itemWidth !== undefined && w > itemWidth) return;
      itemWidth = w;
      candidates.push(i);
      return;
    }
    const bullet = BULLET_LINE.exec(line);
    if (line.trim() === "" || HEADING_LINE.test(line) || (bullet && itemWidth !== undefined && width(bullet[1]!) <= itemWidth)) {
      itemWidth = undefined;
    }
  });

  const parsed = [...items(doc)].map((e) => e.item).filter((i) => i.checkbox);
  if (parsed.length !== candidates.length) return [];
  const out: ItemLine[] = [];
  for (let k = 0; k < candidates.length; k++) {
    const line = candidates[k]!;
    const item = parsed[k]!;
    const id = LINE_ID.exec(lines[line]!)?.[1];
    if (id !== undefined && item.id !== id) return [];
    out.push({ line, item });
  }
  return out;
}

/** The nearest item line at or above the given zero-based line. */
export function itemAtLine(text: string, doc: Document, line: number): Item | undefined {
  let found: Item | undefined;
  for (const entry of itemLines(text, doc)) {
    if (entry.line > line) break;
    found = entry.item;
  }
  return found;
}
